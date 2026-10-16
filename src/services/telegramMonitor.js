'use strict';

const LINK_RE = /(?:https?:\/\/)?(?:t(?:elegram)?\.me|telegram\.dog)\/([^\s/?#]+)(?:\/(\d+))?(?:\?[^\s]*)?/gi;

function parseMessageLinks(text = '') {
  const links = [];
  const seen = new Set();
  if (typeof text !== 'string') return links;
  for (const match of text.matchAll(LINK_RE)) {
    const username = match[1];
    const messageId = match[2];
    if (!messageId || username.startsWith('+') || username === 'joinchat') continue;
    const channel = username.replace(/^@/, '');
    const key = channel + ':' + messageId;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      channel,
      messageId: String(messageId),
      url: 'https://t.me/' + channel + '/' + messageId
    });
  }
  return links;
}

function messageText(message) {
  return message?.text || message?.message || message?.caption || message?.rawText || '';
}

function messageId(message) {
  return message?.id ?? message?.message_id ?? message?.messageId;
}

function channelKey(channel) {
  if (typeof channel === 'string' || typeof channel === 'number') return String(channel);
  return String(channel?.id ?? channel?.username ?? channel?.peerId ?? channel?.channel ?? '');
}

class TelegramMonitor {
  constructor(options = {}) {
    this.db = options.db;
    this.tg = options.tg || options.telegram;
    if (!this.db) throw new TypeError('TelegramMonitor requires db');
    if (!this.tg) throw new TypeError('TelegramMonitor requires tg');
    this.channels = options.channels || options.config?.telegram?.channels || [];
    this.intervalMinutes = Number(options.intervalMinutes || options.config?.telegram?.scanIntervalMinutes || 30);
    this.now = options.now || (() => new Date());
    this.timer = null;
    this.running = false;
  }

  listChannels() {
    if (typeof this.db.listTelegramChannels === 'function') return this.db.listTelegramChannels();
    return Array.isArray(this.channels) ? this.channels.slice() : [];
  }

  addChannel(channel) {
    const normalized = typeof channel === 'string' ? { id: channel, title: channel, enabled: true } : { ...channel };
    normalized.id = channelKey(normalized);
    normalized.title = normalized.title || normalized.username || normalized.id;
    normalized.enabled = normalized.enabled !== false;
    if (typeof this.db.upsertTelegramChannel === 'function') this.db.upsertTelegramChannel(normalized);
    else {
      this.channels = this.channels.filter(c => channelKey(c) !== normalized.id).concat(normalized);
    }
    return normalized;
  }

  removeChannel(channel) {
    const id = channelKey(channel);
    if (typeof this.db.removeTelegramChannel === 'function') return this.db.removeTelegramChannel(id);
    this.channels = this.channels.filter(c => channelKey(c) !== id);
    return true;
  }

  async fetchMessages(channel, options = {}) {
    if (typeof this.tg.scanChannel === 'function') return this.tg.scanChannel(channel, options);
    if (typeof this.tg.getChannelMessages === 'function') return this.tg.getChannelMessages(channel, options);
    if (typeof this.tg.getMessages === 'function') return this.tg.getMessages(channel, options);
    if (typeof this.tg.messages === 'function') return this.tg.messages(channel, options);
    throw new TypeError('tg must provide scanChannel, getChannelMessages, getMessages, or messages');
  }

  async claimSeen(channelId, id) {
    if (typeof this.db.claimSeenMessage === 'function') return Boolean(await this.db.claimSeenMessage(channelId, String(id)));
    if (typeof this.db.markSeen === 'function') return Boolean(await this.db.markSeen(channelId, String(id)));
    if (typeof this.db.prepare === 'function') {
      const result = this.db.prepare('INSERT OR IGNORE INTO seen_messages(channel_id,message_id,seen_at) VALUES(?,?,?)').run(String(channelId), String(id), this.now().toISOString());
      return result.changes === 1;
    }
    if (!this._seen) this._seen = new Set();
    const key = String(channelId) + ':' + String(id);
    if (this._seen.has(key)) return false;
    this._seen.add(key);
    return true;
  }

  async enqueue(item) {
    if (typeof this.db.enqueueTelegramMessage === 'function') return this.db.enqueueTelegramMessage(item);
    if (typeof this.db.enqueueMonitorTask === 'function') return this.db.enqueueMonitorTask(item);
    if (typeof this.db.queueTask === 'function') return this.db.queueTask(item);
    if (typeof this.db.prepare === 'function') {
      const now = this.now().toISOString();
      return this.db.prepare("INSERT INTO jobs(type,state,payload,created_at,updated_at) VALUES(?,?,?,?,?)").run('telegram_message', 'queued', JSON.stringify(item), now, now);
    }
    throw new TypeError('db must provide a queue insertion interface');
  }

  async scanChannel(channel, options = {}) {
    const channelId = channelKey(channel);
    const messages = await this.fetchMessages(channel, options) || [];
    const queued = [];
    let duplicates = 0;
    for (const message of messages) {
      const id = messageId(message);
      if (id === undefined || id === null) continue;
      if (!await this.claimSeen(channelId, id)) { duplicates++; continue; }
      const links = parseMessageLinks(messageText(message));
      const item = { channelId, messageId: String(id), message, text: messageText(message), links, receivedAt: this.now().toISOString() };
      await this.enqueue(item);
      queued.push(item);
    }
    if (typeof this.db.markTelegramChannelScanned === 'function') await this.db.markTelegramChannelScanned(channelId, this.now().toISOString());
    return { channel: channelId, fetched: messages.length, queued: queued.length, duplicates, items: queued };
  }

  async scan(options = {}) {
    const channels = this.listChannels().filter(channel => channel?.enabled !== false);
    const results = [];
    for (const channel of channels) results.push(await this.scanChannel(channel, options));
    return results;
  }

  start(options = {}) {
    if (this.timer) return this;
    this.running = true;
    const interval = Math.max(1, Number(options.intervalMinutes || this.intervalMinutes)) * 60 * 1000;
    const tick = async () => {
      if (!this.running) return;
      try { await this.scan(options); } catch (error) { if (typeof options.onError === 'function') options.onError(error); }
    };
    this.timer = setInterval(tick, interval);
    if (options.immediate !== false) void tick();
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { TelegramMonitor, parseMessageLinks };
