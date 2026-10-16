'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { render } = require('./jinja');

const STEPS = ['discovered', 'downloaded', 'validated', 'uploaded', 'strm', 'media_info', 'notified', 'completed'];

function idFor(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value.id ?? value.messageId ?? value.message_id ?? value.remoteKey ?? value.key ?? value.url ?? null;
}

function call(obj, names, args = [], required = true) {
  for (const name of names) if (obj && typeof obj[name] === 'function') return obj[name](...args);
  if (required) throw new TypeError('Injected dependency must provide one of: ' + names.join(', '));
  return undefined;
}

class TransferPipeline {
  constructor(options = {}) {
    this.source123 = options.source123;
    this.targetOfficial = options.targetOfficial;
    this.mediaInfo = options.mediaInfo;
    this.telegram = options.telegram;
    this.db = options.db;
    this.tempDir = options.tempDir || os.tmpdir();
    this.template = options.template || options.notificationTemplate || '✅ {{ title|default(name) }} 已转存{% if strmPath %}\n{{ strmPath }}{% endif %}';
    this.keepTemp = options.keepTemp === true;
    if (!this.source123 || !this.targetOfficial || !this.db) throw new TypeError('source123, targetOfficial and db are required');
  }

  async _load(key) {
    if (typeof this.db.getTransfer === 'function') return await this.db.getTransfer(key);
    if (typeof this.db.getTransferTask === 'function') return await this.db.getTransferTask(key);
    if (typeof this.db.prepare === 'function') {
      const row = this.db.prepare("SELECT payload,state,error,progress FROM jobs WHERE type=? AND json_extract(payload,'$.idempotencyKey')=? ORDER BY id DESC LIMIT 1").get('transfer', key);
      if (row) return { ...(JSON.parse(row.payload || '{}')), state: row.state, error: row.error, progress: row.progress };
    }
    return null;
  }

  async _save(task) {
    const now = new Date().toISOString();
    task.updatedAt = now;
    if (typeof this.db.saveTransfer === 'function') return this.db.saveTransfer(task);
    if (typeof this.db.upsertTransfer === 'function') return this.db.upsertTransfer(task);
    if (typeof this.db.saveTransferTask === 'function') return this.db.saveTransferTask(task);
    if (typeof this.db.prepare === 'function') {
      const payload = JSON.stringify(task);
      const existing = this.db.prepare("SELECT id FROM jobs WHERE type=? AND json_extract(payload,'$.idempotencyKey')=? ORDER BY id DESC LIMIT 1").get('transfer', task.idempotencyKey);
      if (existing) this.db.prepare('UPDATE jobs SET state=?,payload=?,progress=?,error=?,updated_at=? WHERE id=?').run(task.state, payload, task.progress || 0, task.error || null, now, existing.id);
      else this.db.prepare('INSERT INTO jobs(type,state,payload,progress,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('transfer', task.state, payload, task.progress || 0, task.error || null, task.createdAt || now, now);
    }
    return task;
  }

  _key(input) { return input.idempotencyKey || input.key || input.messageId || input.sourceId || crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'); }

  async _discover(input) {
    if (input.resource) return input.resource;
    const result = await call(this.source123, ['discover', 'find', 'getResource', 'fetch'], [input]);
    return Array.isArray(result) ? result[0] : result;
  }

  async _download(resource, task) {
    if (resource.localPath && fs.existsSync(resource.localPath)) return resource.localPath;
    const destination = resource.localPath || path.join(this.tempDir, 'duck-transfer-' + task.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const result = await call(this.source123, ['download', 'downloadTo', 'downloadFile'], [resource, destination]);
    return typeof result === 'string' ? result : (result?.path || destination);
  }

  async _validate(file, resource) {
    if (typeof this.source123.validate === 'function') return (await this.source123.validate(file, resource)) !== false;
    if (typeof this.targetOfficial.validate === 'function') return (await this.targetOfficial.validate(file, resource)) !== false;
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size === 0) throw new Error('downloaded file is empty');
    if (resource.size != null && Number(resource.size) !== stat.size) throw new Error('downloaded file size mismatch');
    return true;
  }

  async _upload(file, resource, task) {
    const existing = task.remoteKey || task.upload;
    if (existing) return existing;
    const result = await call(this.targetOfficial, ['upload', 'uploadFile', 'put', 'import'], [file, resource.targetPath || resource.path || resource.name, resource]);
    return result;
  }

  async _strm(remote, resource, task) {
    if (task.strmPath) return task.strmPath;
    const logical = resource.strmPath || resource.logicalPath || resource.targetPath || resource.name;
    let result;
    if (typeof this.targetOfficial.createStrm === 'function') result = await this.targetOfficial.createStrm(logical, remote, resource);
    else if (typeof this.targetOfficial.generateStrm === 'function') result = await this.targetOfficial.generateStrm(logical, remote, resource);
    else if (typeof this.targetOfficial.writeStrm === 'function') result = await this.targetOfficial.writeStrm(logical, remote, resource);
    else {
      const file = path.join(this.tempDir, 'duck-' + task.idempotencyKey + '.strm');
      await fs.promises.writeFile(file, String(remote));
      result = { path: file, remoteKey: file };
    }
    return typeof result === 'string' ? result : (result?.path || result?.strmPath || result?.remoteKey || result);
  }

  async _media(resource, task) {
    if (!this.mediaInfo) return resource.mediaInfo || {};
    return call(this.mediaInfo, ['get', 'fetch', 'lookup', 'probe'], [resource, task.localPath || task.remoteKey]);
  }

  async run(input = {}) {
    const key = this._key(input);
    let task = await this._load(key);
    if (task?.state === 'completed') return task.result || task;
    task = task || { idempotencyKey: key, state: 'queued', progress: 0, createdAt: new Date().toISOString(), attempts: 0 };
    task.attempts = (task.attempts || 0) + 1;
    try {
      if (!task.resource) { task.state = 'discovering'; await this._save(task); task.resource = await this._discover(input); if (!task.resource) throw new Error('source resource not found'); task.state = 'discovered'; await this._save(task); }
      if (!task.localPath) { task.state = 'downloading'; await this._save(task); task.localPath = await this._download(task.resource, task); task.state = 'downloaded'; await this._save(task); }
      if (!task.validated) { task.state = 'validating'; await this._save(task); const valid = await this._validate(task.localPath, task.resource); if (!valid) throw new Error('download validation failed'); task.validated = true; task.state = 'validated'; await this._save(task); }
      if (!task.remoteKey) { task.state = 'uploading'; await this._save(task); const uploaded = await this._upload(task.localPath, task.resource, task); task.remoteKey = idFor(uploaded) || uploaded; task.upload = uploaded; task.state = 'uploaded'; await this._save(task); }
      if (!task.strmPath) { task.state = 'writing_strm'; await this._save(task); task.strmPath = await this._strm(task.upload || task.remoteKey, task.resource, task); task.state = 'strm'; await this._save(task); }
      if (!task.mediaInfo) { task.state = 'media_info'; await this._save(task); task.mediaInfo = await this._media(task.resource, task); await this._save(task); }
      if (!task.notified && this.telegram) { task.state = 'notifying'; await this._save(task); const context = { ...task.resource, ...task, mediaInfo: task.mediaInfo, remoteKey: task.remoteKey, strmPath: task.strmPath }; const text = render(this.template, context); task.notification = await call(this.telegram, ['sendMessage', 'send'], [text]); task.notified = true; task.notificationText = text; await this._save(task); }
      task.state = 'completed'; task.progress = 1; task.result = task; await this._save(task);
      if (!this.keepTemp && task.localPath && !task.resource.localPath) await fs.promises.rm(task.localPath, { force: true }).catch(() => {});
      return task;
    } catch (error) { task.state = 'failed'; task.error = error.message; await this._save(task); throw error; }
  }

  async resume(input) { return this.run(input); }
  async process(input) { return this.run(input); }
}

function createTransferPipeline(options) { return new TransferPipeline(options); }
module.exports = { TransferPipeline, createTransferPipeline, STEPS };