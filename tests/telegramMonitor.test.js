'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TelegramMonitor, parseMessageLinks } = require('../src/services/telegramMonitor');

test('parses Telegram message links and removes duplicates', () => {
  assert.deepEqual(parseMessageLinks('看 https://t.me/news/42 and t.me/news/42, plus https://t.me/other/7?x=1'), [
    { channel: 'news', messageId: '42', url: 'https://t.me/news/42' },
    { channel: 'other', messageId: '7', url: 'https://t.me/other/7' }
  ]);
});

test('scans channels, queues messages, and deduplicates repeats', async () => {
  const queued = [];
  const seen = new Set();
  const db = {
    listTelegramChannels: () => [{ id: 'news', enabled: true }, { id: 'off', enabled: false }],
    claimSeenMessage: (channel, id) => { const key = channel + ':' + id; if (seen.has(key)) return false; seen.add(key); return true; },
    enqueueTelegramMessage: item => { queued.push(item); }
  };
  const tg = { getChannelMessages: async channel => channel.id === 'news' ? [{ id: 1, text: 'https://t.me/news/1' }, { id: 1, text: 'same' }, { id: 2, caption: 'https://t.me/other/9' }] : [] };
  const monitor = new TelegramMonitor({ db, tg, now: () => new Date('2025-01-01T00:00:00Z') });
  const result = await monitor.scan();
  assert.equal(result.length, 1);
  assert.equal(result[0].queued, 2);
  assert.equal(result[0].duplicates, 1);
  assert.equal(queued[1].links[0].messageId, '9');
  assert.equal((await monitor.scan())[0].queued, 0);
});

test('supports scheduled start and stop', async () => {
  const db = { listTelegramChannels: () => [], claimSeenMessage: () => true, enqueueTelegramMessage: () => {} };
  const monitor = new TelegramMonitor({ db, tg: { getMessages: async () => [] }, intervalMinutes: 1 });
  monitor.start({ immediate: false });
  assert.equal(monitor.running, true);
  assert.ok(monitor.timer);
  monitor.stop();
  assert.equal(monitor.running, false);
  assert.equal(monitor.timer, null);
});
