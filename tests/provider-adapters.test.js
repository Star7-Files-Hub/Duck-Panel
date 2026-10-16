'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { Cloud123Adapter } = require('../src/adapters/cloud123');
const { OfficialDriveAdapter } = require('../src/adapters/officialDrive');

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, body: Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]), async text() { return typeof body === 'string' ? body : JSON.stringify(body); } }; }

test('list, direct, quota and share import are configured and mapped', async () => {
  const calls = [];
  const api = new Cloud123Adapter({ baseUrl: 'https://drive.test', fetch: async (url, init) => { calls.push([url, init]); if (url.includes('items')) return response({ entries: [1] }); if (url.includes('link')) return response({ link: 'https://dl.test/a' }); if (url.includes('capacity')) return response({ totalBytes: 10, usedBytes: 4 }); return response({ ok: true }); }, endpoints: { list: '/items', direct: '/link/{remoteKey}', quota: '/capacity', importShare: '/transfer' }, map: { directUrl: 'link', quotaTotal: 'totalBytes', quotaUsed: 'usedBytes', quotaAvailable: v => v.totalBytes - v.usedBytes }, buildRequest: { list: ({ url, values }) => ({ method: 'GET', headers: {}, url: url + '?p=' + encodeURIComponent(values.path) }), importShare: ({ url, body }) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }) } });
  assert.deepEqual(await api.list('/folder'), { entries: [1] });
  assert.equal(await api.direct('a b'), 'https://dl.test/a');
  assert.deepEqual(await api.quota(), { raw: { totalBytes: 10, usedBytes: 4 }, total: 10, used: 4, available: 6 });
  await api.importShare('share', '/dst');
  assert.equal(calls[0][0], 'https://drive.test/items?p=%2Ffolder');
  assert.equal(calls.at(-1)[1].method, 'POST');
});

test('download returns injected response stream and direct upload streams the source', async () => {
  const calls = [];
  const api = new OfficialDriveAdapter({ fetch: async (url, init) => { calls.push([url, init]); return response('ok'); }, endpoints: { download: '/file/{remoteKey}', upload: '/put/{target}' } });
  const downloaded = await api.download('k');
  assert.equal((await new Promise((resolve, reject) => { const parts=[]; downloaded.on('data', x=>parts.push(x)); downloaded.on('end',()=>resolve(Buffer.concat(parts).toString())); downloaded.on('error',reject); })), 'ok');
  await api.upload(Readable.from([Buffer.from('abc')]), 'dir/file', { size: 3 });
  assert.equal(calls[1][0], '/put/dir%2Ffile');
  assert.equal(calls[1][1].body.readable, true);
});

test('multipart upload sends sequential configured parts and completes', async () => {
  const calls = [];
  const api = new Cloud123Adapter({ fetch: async (url, init) => { calls.push([url, init]); if (url === '/begin') return response({ session: 's1' }); if (url.startsWith('/part/')) return response({ etag: url }); if (url === '/finish') return response({ file: 'done' }); return response({}); }, endpoints: { uploadInit: '/begin', uploadPart: '/part/{session}/{partNumber}', uploadComplete: '/finish' }, map: { uploadSession: 'session' }, partSize: 2, multipartThreshold: 2 });
  assert.deepEqual(await api.upload(Readable.from([Buffer.from('abcde')]), 'x', { size: 5 }), { file: 'done' });
  assert.deepEqual(calls.slice(1, 3).map(x => x[1].body.toString()), ['ab', 'cd']);
  assert.equal(calls[3][1].body.toString(), 'e');
  assert.equal(calls[4][0], '/finish');
});

test('missing endpoint and HTTP errors are explicit', async () => {
  const api = new Cloud123Adapter({ fetch: async () => response('bad', 503) });
  await assert.rejects(api.list(), /endpoints.list/);
  const configured = new Cloud123Adapter({ fetch: async () => response('bad', 503), endpoints: { list: '/list' } });
  await assert.rejects(configured.list(), error => error.status === 503);
});
