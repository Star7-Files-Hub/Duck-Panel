const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/services/jinja');
const { EmbyNotifier, parseWebhook } = require('../src/services/embyNotifier');

test('renders variables, filters and control flow', () => {
  const value = render('{% if title %}{{ title|replace(" ", "-") }}{% endif %}: {{ missing|default("N/A") }} {{ tags|join(", ") }}', {
    title: 'A New Show', tags: ['TV', 'HD']
  });
  assert.equal(value, 'A-New-Show: N/A TV, HD');
});

test('renders loops with loop metadata', () => {
  assert.equal(render('{% for item in items %}{{ loop.index }}={{ item }}{% if not loop.last %}, {% endif %}{% endfor %}', { items: ['one', 'two'] }), '1=one, 2=two');
});

test('renders date filter', () => {
  assert.equal(render('{{ timestamp|date("%Y-%m-%d") }}', { timestamp: '2025-03-04T12:00:00Z' }), '2025-03-04');
});

test('parses Emby ItemAdded payload', () => {
  const event = parseWebhook({ Event: 'ItemAdded', Item: { Id: 'x1', Name: 'Dune', Type: 'Movie', ProductionYear: 2021 }, Server: { Name: 'Home' } });
  assert.deepEqual({ title: event.title, itemId: event.itemId, type: event.type, year: event.year, server: event.server }, { title: 'Dune', itemId: 'x1', type: 'Movie', year: 2021, server: 'Home' });
  assert.equal(parseWebhook({ Event: 'PlaybackStart', Item: { Name: 'Dune' } }), null);
});

test('sends rendered notification through injected Telegram service', async () => {
  const sent = [];
  const notifier = new EmbyNotifier({ sendMessage: async text => { sent.push(text); return true; } }, { template: '{{ title }}{% for x in genres %} #{{ x }}{% endfor %}' });
  assert.equal(await notifier.handle({ Event: 'ItemAdded', Item: { Name: 'Dune', GenreItems: [{ Name: 'Sci-Fi' }] } }), true);
  assert.deepEqual(sent, ['Dune #Sci-Fi']);
  assert.equal(await notifier.handle({ Event: 'PlaybackStart', Item: { Name: 'x' } }), false);
});
