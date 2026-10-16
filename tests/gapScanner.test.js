const test = require('node:test');
const assert = require('node:assert/strict');
const { GapScanner, createTvMazeProvider, createTvdbProvider } = require('../src/services/gapScanner');

test('scans only selected libraries and queues episodes absent from Emby', async () => {
  const calls = [];
  const scanner = new GapScanner({
    provider: 'tvmaze',
    httpClient: async url => {
      calls.push(url);
      return { json: async () => [
        { id: 101, season: 1, number: 1, name: 'Pilot' },
        { id: 102, season: 1, number: 2, name: 'Second' },
        { id: 103, season: 2, number: 1, name: 'Return' }
      ] };
    }
  });
  const result = await scanner.scan({
    selectedLibraryIds: ['tv'],
    libraries: [
      { id: 'tv', series: [{ id: 'show-1', title: 'Example', tvmazeId: 9, episodes: [{ ParentIndexNumber: 1, IndexNumber: 1 }, { ParentIndexNumber: 2, IndexNumber: 1 }] }] },
      { id: 'ignored', series: [{ id: 'show-2', title: 'Ignored', tvmazeId: 10, episodes: [] }] }
    ]
  });
  assert.equal(result.scannedSeries, 1);
  assert.deepEqual(result.queue.map(x => x.key), ['1:2']);
  assert.equal(result.queue[0].type, 'missing-episode');
  assert.equal(calls.length, 1);
});

test('resolves TVMaze series by title when no provider id exists', async () => {
  const urls = [];
  const provider = createTvMazeProvider({ httpClient: async url => {
    urls.push(url);
    if (url.includes('/singlesearch/')) return { id: 42 };
    return [{ season: 1, number: 1, name: 'Pilot' }];
  } });
  const episodes = await provider.getEpisodes({ title: 'My Show' });
  assert.equal(episodes[0].episode, 1);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /q=My%20Show/);
});

test('supports TVDB provider and injected response data', async () => {
  const urls = [];
  const provider = createTvdbProvider({ token: 'secret', httpClient: async (url, options) => {
    urls.push({ url, options });
    if (url.includes('/search?')) return { data: { data: [{ id: 'tvdb-1' }] } };
    return { data: { data: [{ id: 'e1', seasonNumber: 1, number: 1 }, { id: 'e2', seasonNumber: 1, number: 2 }] } };
  } });
  const episodes = await provider.getEpisodes({ title: 'Show' });
  assert.deepEqual(episodes.map(x => x.episode), [1, 2]);
  assert.equal(urls[0].options.headers.Authorization, 'Bearer secret');
});

test('accepts direct series input and scanMissing alias', async () => {
  const scanner = new GapScanner({ providerInstance: { name: 'fixture', getEpisodes: async () => [{ season: 0, episode: 1, title: 'Special' }] } });
  const result = await scanner.scanMissing({ series: [{ id: 's', episodes: [] }] });
  assert.equal(result.provider, 'fixture');
  assert.equal(result.queue[0].season, 0);
});
