'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TransferPipeline } = require('../src/services/transferPipeline');

function fixture(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-pipeline-test-'));
  const state = new Map();
  const calls = { discover: 0, download: 0, validate: 0, upload: 0, strm: 0, media: 0, notify: 0 };
  const db = {
    getTransfer: key => state.get(key),
    saveTransfer: task => { state.set(task.idempotencyKey, structuredClone(task)); }
  };
  const source123 = {
    discover: async input => { calls.discover++; return input.resource || { id: 'source-1', name: 'Film.mkv', size: 4, targetPath: '/Movies/Film.mkv' }; },
    download: async (_resource, dest) => { calls.download++; fs.writeFileSync(dest, 'film'); return dest; },
    validate: async file => { calls.validate++; return fs.statSync(file).size === 4; }
  };
  const targetOfficial = {
    upload: async () => { calls.upload++; return { key: 'remote-1' }; },
    createStrm: async (logical, remote) => { calls.strm++; assert.equal(remote.key, 'remote-1'); return { path: logical + '.strm' }; }
  };
  const mediaInfo = { get: async () => { calls.media++; return { title: 'Film', year: 2024 }; } };
  const telegram = { sendMessage: async text => { calls.notify++; return text; } };
  const pipeline = new TransferPipeline({ source123, targetOfficial, mediaInfo, telegram, db, tempDir: dir, template: '{{ mediaInfo.title }} {{ strmPath }}', ...overrides });
  return { pipeline, calls, state, dir };
}

test('runs discover-download-validate-upload-strm-media-notify in order and persists completion', async () => {
  const { pipeline, calls, state } = fixture();
  const result = await pipeline.run({ idempotencyKey: 'job-1', url: 'https://123.example/share' });
  assert.equal(result.state, 'completed');
  assert.equal(result.progress, 1);
  assert.equal(result.notificationText, 'Film /Movies/Film.mkv.strm');
  assert.deepEqual(calls, { discover: 1, download: 1, validate: 1, upload: 1, strm: 1, media: 1, notify: 1 });
  assert.equal(state.get('job-1').state, 'completed');
});

test('is idempotent for completed jobs and resumes after upload failure without re-uploading', async () => {
  const f = fixture();
  const original = f.pipeline.targetOfficial.upload;
  f.pipeline.targetOfficial.upload = async () => { f.calls.upload++; throw new Error('temporary upload error'); };
  await assert.rejects(f.pipeline.run({ idempotencyKey: 'retry-1' }), /temporary upload error/);
  assert.equal(f.state.get('retry-1').state, 'failed');
  f.pipeline.targetOfficial.upload = original;
  const done = await f.pipeline.resume({ idempotencyKey: 'retry-1' });
  assert.equal(done.state, 'completed');
  assert.equal(f.calls.download, 1);
  assert.equal(f.calls.validate, 1);
  assert.equal(f.calls.upload, 2);
  await f.pipeline.run({ idempotencyKey: 'retry-1' });
  assert.equal(f.calls.upload, 2);
  assert.equal(f.calls.notify, 1);
});

test('rejects invalid downloads and records persistent failure state', async () => {
  const f = fixture();
  f.pipeline.source123.validate = async () => false;
  await assert.rejects(f.pipeline.run({ idempotencyKey: 'bad-file' }), /validation|invalid/i);
  assert.equal(f.state.get('bad-file').state, 'failed');
  assert.equal(f.calls.upload, 0);
});

test('uses Jinja conditional and title metadata in Telegram notification', async () => {
  const f = fixture({ template: '{% if mediaInfo.year %}{{ mediaInfo.title }} ({{ mediaInfo.year }}){% endif %}' });
  const result = await f.pipeline.process({ idempotencyKey: 'template-job' });
  assert.equal(result.notificationText, 'Film (2024)');
});

test('accepts supplied resource and leaves its source-owned local path intact', async () => {
  const f = fixture();
  const local = path.join(f.dir, 'input.mkv');
  fs.writeFileSync(local, 'film');
  const result = await f.pipeline.run({ idempotencyKey: 'local-job', resource: { id: 'local', name: 'Input.mkv', localPath: local, size: 4 } });
  assert.equal(result.state, 'completed');
  assert.equal(fs.existsSync(local), true);
  assert.equal(f.calls.discover, 0);
});
