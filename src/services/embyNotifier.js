const { render } = require('./jinja');

function parseWebhook(payload) {
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== 'object') return null;
  const event = payload.Event || payload.event || payload.eventName || '';
  if (!/itemadded|library.new|new.?item/i.test(String(event))) return null;
  const item = payload.Item || payload.item || payload;
  const server = payload.Server || payload.server || {};
  const title = item.Name || item.name || item.SeriesName || '未知媒体';
  const type = item.Type || item.type || '';
  return {
    event: String(event), title, type,
    itemId: item.Id || item.id || '',
    path: item.Path || item.path || '',
    year: item.ProductionYear || item.productionYear || '',
    overview: item.Overview || item.overview || '',
    genres: (item.GenreItems || item.genres || []).map(value => typeof value === 'string' ? value : value.Name || value.name).filter(Boolean),
    series: item.SeriesName || item.seriesName || '',
    season: item.ParentIndexNumber ?? item.parentIndexNumber ?? '',
    episode: item.IndexNumber ?? item.indexNumber ?? '',
    server: server.Name || server.name || payload.ServerName || '',
    timestamp: payload.Timestamp || payload.timestamp || new Date().toISOString(),
    raw: payload,
  };
}

class EmbyNotifier {
  constructor(telegram, options = {}) {
    if (!telegram || typeof telegram.sendMessage !== 'function') throw new TypeError('telegram.sendMessage is required');
    this.telegram = telegram;
    this.template = options.template || '📺 新增入库：{{ title }}{% if year %} ({{ year }}){% endif %}';
    this.filter = options.filter || null;
  }

  async handle(payload) {
    const event = parseWebhook(payload);
    if (!event || (this.filter && !this.filter(event))) return false;
    const text = render(this.template, event);
    return this.telegram.sendMessage(text);
  }

  async notify(payload) { return this.handle(payload); }
}

module.exports = { EmbyNotifier, parseWebhook };
