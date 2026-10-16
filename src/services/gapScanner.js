'use strict';

const PROVIDERS = ['tvmaze', 'tvdb'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProviderName(name) {
  const provider = String(name || 'tvmaze').toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new Error('Unsupported episode provider: ' + provider);
  return provider;
}

function episodeKey(season, episode) {
  return String(Number(season)) + ':' + String(Number(episode));
}

function normalizeEpisode(episode, fallbackSeason) {
  const season = Number(episode.seasonNumber ?? episode.season ?? fallbackSeason);
  const number = Number(episode.number ?? episode.episodeNumber ?? episode.episode);
  if (!Number.isInteger(season) || !Number.isInteger(number) || season < 0 || number < 1) return null;
  return {
    season,
    episode: number,
    id: episode.id ?? episode.tvdbId ?? episode.guid,
    title: episode.name ?? episode.title ?? null,
    airdate: episode.airdate ?? episode.aired ?? episode.firstAired ?? null,
    overview: episode.summary ?? episode.overview ?? null
  };
}

function normalizeStandard(data) {
  const source = data && (data.episodes || data.data?.episodes || data.data || data.results || data);
  const episodes = asArray(source).map(item => normalizeEpisode(item)).filter(Boolean);
  const unique = new Map(episodes.map(item => [episodeKey(item.season, item.episode), item]));
  return [...unique.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function normalizeEmbySeries(series) {
  const episodes = asArray(series.episodes || series.items || series.children || series.MediaItems);
  const present = new Set();
  for (const item of episodes) {
    const season = Number(item.ParentIndexNumber ?? item.season ?? item.Season);
    const episode = Number(item.IndexNumber ?? item.episode ?? item.Episode);
    if (Number.isInteger(season) && Number.isInteger(episode) && season >= 0 && episode > 0) present.add(episodeKey(season, episode));
  }
  return present;
}

async function requestJson(httpClient, url, options) {
  if (typeof httpClient === 'function') return httpClient(url, options);
  if (httpClient && typeof httpClient.get === 'function') return httpClient.get(url, options);
  throw new Error('An injected httpClient is required for remote providers');
}

function unwrapResponse(response) {
  if (response && typeof response.json === 'function') return response.json();
  if (response && response.data !== undefined && !Array.isArray(response)) return response.data;
  return response;
}

function createTvMazeProvider({ httpClient }) {
  return {
    name: 'tvmaze',
    async getEpisodes(series) {
      const externalId = series.tvmazeId || series.providerId;
      let show = externalId;
      if (!show) {
        const title = encodeURIComponent(series.title || series.name || '');
        const search = await unwrapResponse(await requestJson(httpClient, 'https://api.tvmaze.com/singlesearch/shows?q=' + title));
        show = search && search.id;
      }
      if (!show) return [];
      const response = await requestJson(httpClient, 'https://api.tvmaze.com/shows/' + encodeURIComponent(show) + '/episodes');
      return normalizeStandard(await unwrapResponse(response));
    }
  };
}

function createTvdbProvider({ httpClient, apiKey, token }) {
  return {
    name: 'tvdb',
    async getEpisodes(series) {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      let id = series.tvdbId || series.providerId;
      if (!id) {
        const title = encodeURIComponent(series.title || series.name || '');
        const response = await requestJson(httpClient, 'https://api4.thetvdb.com/v4/search?query=' + title + '&type=series', { headers, apiKey });
        const body = await unwrapResponse(response);
        id = body?.data?.[0]?.tvdb_id || body?.data?.[0]?.id;
      }
      if (!id) return [];
      const response = await requestJson(httpClient, 'https://api4.thetvdb.com/v4/series/' + encodeURIComponent(id) + '/episodes/default?page=0', { headers, apiKey });
      return normalizeStandard(await unwrapResponse(response));
    }
  };
}

function makeProvider(provider, options) {
  if (provider && typeof provider.getEpisodes === 'function') return provider;
  const name = normalizeProviderName(provider);
  return name === 'tvmaze' ? createTvMazeProvider(options) : createTvdbProvider(options);
}

class GapScanner {
  constructor(options = {}) {
    this.providerName = normalizeProviderName(options.provider || 'tvmaze');
    this.httpClient = options.httpClient;
    this.provider = makeProvider(options.providerInstance || this.providerName, options);
  }

  async scan({ libraries = [], selectedLibraryIds, series = [] } = {}) {
    const selected = selectedLibraryIds ? new Set(selectedLibraryIds) : null;
    const source = series.length ? series : asArray(libraries).filter(library => !selected || selected.has(library.id)).flatMap(library => asArray(library.series || library.items));
    const queue = [];
    for (const item of source) {
      const standard = await this.provider.getEpisodes(item);
      const present = normalizeEmbySeries(item);
      for (const episode of standard) {
        const key = episodeKey(episode.season, episode.episode);
        if (!present.has(key)) queue.push({
          type: 'missing-episode', provider: this.provider.name || this.providerName,
          libraryId: item.libraryId || item.parentId || null, seriesId: item.id || item.seriesId || null,
          seriesTitle: item.title || item.name || null, season: episode.season, episode: episode.episode,
          episodeId: episode.id ?? null, title: episode.title, airdate: episode.airdate,
          overview: episode.overview, key
        });
      }
    }
    return { provider: this.provider.name || this.providerName, scannedSeries: source.length, queue };
  }

  async scanMissing(options) { return this.scan(options); }
}

function createGapScanner(options) { return new GapScanner(options); }

module.exports = { GapScanner, createGapScanner, createTvMazeProvider, createTvdbProvider, normalizeStandard, normalizeEmbySeries, episodeKey };
