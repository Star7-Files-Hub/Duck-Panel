'use strict';

const { fetch: defaultFetch } = require('undici');
const fs = require('fs');

function getPath(value, path) {
  if (path == null) return undefined;
  if (typeof path === 'function') return path(value);
  return String(path).split('.').filter(Boolean).reduce((v, k) => v == null ? undefined : v[k], value);
}
function applyTemplate(template, values) {
  if (typeof template === 'function') return template(values);
  return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));
}
function required(value, name) { if (!value) throw new TypeError(`Missing adapter configuration: ${name}`); return value; }

class Cloud123Adapter {
  constructor(options = {}) {
    this.config = options;
    this.fetch = options.fetch || defaultFetch;
    this.baseUrl = options.baseUrl || '';
    this.headers = options.headers || {};
    this.endpoints = options.endpoints || {};
    this.map = options.map || {};
    this.buildRequest = options.buildRequest || {};
  }
  endpoint(name, values = {}) { return applyTemplate(required(this.endpoints[name], `endpoints.${name}`), values); }
  async request(name, { values = {}, body, headers = {}, method, ...rest } = {}) {
    const url = /^https?:\/\//i.test(String(this.endpoint(name, values))) ? this.endpoint(name, values) : `${this.baseUrl.replace(/\/$/, '')}${this.endpoint(name, values)}`;
    const custom = this.buildRequest[name];
    const init = custom ? await custom({ values, body, headers, method, url, query: rest.query, ...rest }) : { ...rest, method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...this.headers, ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array || body?.pipe || body?.[Symbol.asyncIterator] ? body : JSON.stringify(body) }) };
    const response = await this.fetch(init.url || url, init);
    if (!response.ok) throw Object.assign(new Error(`provider request failed: ${response.status}`), { status: response.status, response });
    return response;
  }
  async json(name, options) { const r = await this.request(name, options); if (r.status === 204) return null; const text = await r.text(); return text ? JSON.parse(text) : null; }
  field(name, value) { return getPath(value, this.map[name]); }
  list(path = '', params = {}) { return this.json('list', { values: { path }, query: params }); }
  async direct(remoteKey) { const data = await this.json('direct', { values: { remoteKey } }); return this.field('directUrl', data); }
  async quota() { const data = await this.json('quota'); const result = { raw: data }; for (const [key, mapping] of [['total', 'quotaTotal'], ['used', 'quotaUsed'], ['available', 'quotaAvailable'], ['egress', 'quotaEgress']]) { const value = this.field(mapping, data); if (value !== undefined) result[key] = value; } return result; }
  async importShare(share, target) { return this.json('importShare', { values: { share, target }, body: this.config.map?.importBody ? this.config.map.importBody({ share, target }) : undefined }); }
  async download(remoteKey, options = {}) { const response = await this.request('download', { values: { remoteKey }, headers: options.headers || {}, method: options.method || 'GET' }); return response.body; }
  async downloadTo(remoteKey, destination, options = {}) {
    const stream = await this.download(remoteKey, options);
    if (!stream) throw new Error('download response has no body');
    if (typeof options.writeStream === 'function') return options.writeStream(stream, destination);
    const output = fs.createWriteStream(destination);
    await new Promise((resolve, reject) => { stream.pipe(output); stream.once('error', reject); output.once('error', reject); output.once('finish', resolve); });
    return destination;
  }
  async upload(file, target, metadata = {}) {
    const stat = typeof file === 'string' ? await fs.promises.stat(file) : null;
    const source = stat ? fs.createReadStream(file) : file;
    const size = metadata.size ?? stat?.size;
    const threshold = this.config.multipartThreshold ?? Infinity;
    if (size != null && size > threshold && this.endpoints.uploadInit && this.endpoints.uploadPart && this.endpoints.uploadComplete) return this.uploadMultipart(source, target, { ...metadata, size });
    const response = await this.request('upload', { values: { target }, body: source, headers: { ...(size == null ? {} : { 'content-length': String(size) }), ...(metadata.contentType ? { 'content-type': metadata.contentType } : {}) }, method: 'POST' });
    return this.jsonResponse(response, 'uploadResult');
  }
  async jsonResponse(response, mapping) { const text = await response.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } } return this.map[mapping] ? this.field(mapping, data) : data; }
  async uploadMultipart(source, target, metadata) {
    const init = await this.json('uploadInit', { values: { target }, body: { ...metadata, target } });
    const session = this.field('uploadSession', init);
    const partSize = this.config.partSize;
    if (!Number.isInteger(partSize) || partSize < 1) throw new TypeError('partSize must be a positive integer for multipart upload');
    const chunks = [];
    for await (const chunk of source) {
      let buffer = Buffer.from(chunk);
      while (buffer.length) { const room = partSize - (chunks.at(-1)?.length || 0); const take = Math.min(room, buffer.length); if (!chunks.length || chunks.at(-1).length === partSize) chunks.push(Buffer.alloc(0)); chunks[chunks.length - 1] = Buffer.concat([chunks.at(-1), buffer.subarray(0, take)]); buffer = buffer.subarray(take); }
    }
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const response = await this.request('uploadPart', { values: { session, target, partNumber: i + 1 }, body: chunks[i], method: 'PUT', headers: { 'content-length': String(chunks[i].length) } });
      const text = await response.text(); parts.push(text ? JSON.parse(text) : null);
    }
    return this.json('uploadComplete', { values: { session, target }, body: { parts, metadata } });
  }
}

module.exports = { Cloud123Adapter };
