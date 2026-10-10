import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CACHE_MAX_BYTES, CACHE_MAX_ENTRIES, IndexedFeedCache, isCacheFresh, type CachedWindow } from '../src/cache';
import { analyze, defaultSettings, loadFeeds, type Feed } from '../src/data';

const DAY = 86400000;
const now = Date.parse('2026-10-10T12:00:00Z');
const start = Date.parse('2026-10-05T10:00:00Z');
const range = { start, end: start + 3600000 };
const sample = (timestamp: number): Feed => ({ created_at: new Date(timestamp).toISOString(), entry_id: timestamp / 60000, field1: String(timestamp / 3600000), field2: '33', field3: '500' });
const entry = (key: string, savedAt = now): Omit<CachedWindow, 'bytes'> => ({ key, end: now - 3 * DAY, fetchedUntil: now - 3 * DAY, savedAt, channel: { id: 1, name: 'Test' }, feeds: [sample(start)] });
const cacheName = () => `test-${crypto.randomUUID()}`;

async function metadata(name: string): Promise<{ key: string; bytes: number }[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('metadata');
      const items = transaction.objectStore('metadata').getAll();
      items.onsuccess = () => resolve(items.result);
      transaction.oncomplete = () => database.close();
    };
  });
}
test('IndexedDB persists across cache instances, expires old data and clears it', async () => {
  const name = cacheName();
  const first = new IndexedFeedCache(name), reloaded = new IndexedFeedCache(name);
  await first.put(entry('history'));
  assert.deepEqual((await reloaded.get('history', now + DAY - 1))?.feeds, [sample(start)]);
  assert.equal(await reloaded.get('history', now + DAY), null);
  await first.put(entry('again'));
  await first.clear();
  assert.equal(await reloaded.get('again', now), null);
});
test('recent and incomplete windows expire after a minute, including midnight rollover', () => {
  const historical = { ...entry('history'), bytes: 100 };
  const recent = { ...historical, end: now - 3600000, fetchedUntil: now - 3600000 };
  const unfinished = { ...historical, fetchedUntil: historical.end - 1000 };
  for (const value of [recent, unfinished]) {
    assert.equal(isCacheFresh(value, now + 59999), true);
    assert.equal(isCacheFresh(value, now + 60000), false);
  }
  assert.equal(isCacheFresh(historical, now - 1), false);
});
test('least recently used entries are evicted at the entry limit', async () => {
  const name = cacheName(), cache = new IndexedFeedCache(name);
  for (let index = 0; index < CACHE_MAX_ENTRIES; index++) await cache.put(entry(String(index), now + index));
  await cache.get('0', now + 1000);
  await cache.put(entry('new', now + 1001));
  assert(await cache.get('0', now + 1002));
  assert.equal(await cache.get('1', now + 1002), null);
  assert.equal((await metadata(name)).length, CACHE_MAX_ENTRIES);
});
test('payload budget stays bounded and individual oversized responses are skipped', async () => {
  const name = cacheName(), cache = new IndexedFeedCache(name);
  const feeds = Array.from({ length: 4000 }, (_, index) => sample(start + index * 60000));
  for (let index = 0; index < 16; index++) await cache.put({ ...entry(String(index), now + index), feeds });
  const retained = await metadata(name);
  assert(retained.length < 16);
  assert(retained.reduce((sum, item) => sum + item.bytes, 0) <= CACHE_MAX_BYTES);
  await cache.put({ ...entry('too-large'), feeds: Array.from({ length: 20000 }, (_, index) => sample(start + index * 60000)) });
  assert.equal(await cache.get('too-large', now), null);
});
test('stable windows share cached measurements across overlapping searches and force refresh bypasses them', async () => {
  const originalFetch = globalThis.fetch;
  const cache = new IndexedFeedCache(cacheName());
  let requests = 0, at = now;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests++;
    const url = new URL(String(input));
    const begin = Date.parse(url.searchParams.get('start')!.replace(' ', 'T') + 'Z');
    const end = Date.parse(url.searchParams.get('end')!.replace(' ', 'T') + 'Z');
    const feeds = [];
    for (let timestamp = begin; timestamp <= end; timestamp += 30 * 60000) feeds.push(sample(timestamp));
    return new Response(JSON.stringify({ channel: { id: Number(url.pathname.split('/')[2]), name: 'Test' }, feeds }));
  }) as typeof fetch;
  const load = (channel: string, selected = range, forceRefresh = false) => loadFeeds(channel, selected, new AbortController().signal, () => {}, { cache, forceRefresh, clock: () => at });
  try {
    const first = await load('2184811');
    assert.equal(requests, 1);
    const repeat = await load('2184811');
    assert.deepEqual(repeat.feeds, first.feeds);
    assert.equal(repeat.cacheHits, 1); assert.equal(requests, 1);
    assert(Math.abs(analyze(repeat.feeds, range, 'hour', defaultSettings).importEnergy! - 1) < 1e-9);
    await load('2184811', { start: start + 60000, end: range.end });
    assert.equal(requests, 1);
    await load('2184812'); assert.equal(requests, 2);
    await load('2184811', range, true); assert.equal(requests, 3);
    at += DAY;
    await load('2184811'); assert.equal(requests, 4);
  } finally { globalThis.fetch = originalFetch; }
});
test('unavailable or full browser storage does not stop live requests', async () => {
  const originalOpen = indexedDB.open.bind(indexedDB), originalFetch = globalThis.fetch;
  const name = cacheName();
  indexedDB.open = () => { throw new DOMException('Storage denied', 'SecurityError'); };
  const unavailable = new IndexedFeedCache(name);
  globalThis.fetch = (async () => new Response(JSON.stringify({ channel: { id: 1, name: 'Test' }, feeds: [sample(start), sample(range.end)] }))) as typeof fetch;
  try {
    const result = await loadFeeds('1', range, new AbortController().signal, () => {}, { cache: unavailable, clock: () => now });
    assert.equal(result.feeds.length, 2); assert.equal(result.cacheHits, 0);
  } finally { indexedDB.open = originalOpen; globalThis.fetch = originalFetch; }
  const cache = new IndexedFeedCache(cacheName());
  await cache.put(entry('seed')); // Open the database before simulating a quota failure.
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  try { await cache.put(entry('quota')); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  assert.equal(await cache.get('quota', now), null);
});
test('searches exceeding cache capacity still reuse retained windows before eviction', async () => {
  const originalFetch = globalThis.fetch;
  const cache = new IndexedFeedCache(cacheName());
  let requests = 0;
  const end = Math.floor((now - 3 * DAY) / DAY) * DAY;
  const selected = { start: end - 66 * DAY, end };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests++;
    const url = new URL(String(input));
    const begin = Date.parse(url.searchParams.get('start')!.replace(' ', 'T') + 'Z');
    const stop = Date.parse(url.searchParams.get('end')!.replace(' ', 'T') + 'Z');
    return new Response(JSON.stringify({ channel: { id: 1, name: 'Test' }, feeds: [sample(begin), sample(stop)] }));
  }) as typeof fetch;
  try {
    const first = await loadFeeds('1', selected, new AbortController().signal, () => {}, { cache, clock: () => now });
    const initialRequests = requests;
    const repeated = await loadFeeds('1', selected, new AbortController().signal, () => {}, { cache, clock: () => now + 1000 });
    assert.deepEqual(repeated.feeds, first.feeds);
    assert.equal(repeated.cacheHits, CACHE_MAX_ENTRIES);
    assert.equal(requests - initialRequests, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test('cached boundaries preserve each counter when neighboring feeds have missing fields', async () => {
  const originalFetch = globalThis.fetch;
  const cache = new IndexedFeedCache(cacheName());
  const feeds = [
    { ...sample(start - 30 * 60000), field1: '100' },
    { ...sample(start - 15 * 60000), field1: null },
    { ...sample(start + 30 * 60000), field1: '102' },
    { ...sample(range.end + 15 * 60000), field1: null },
    { ...sample(range.end + 30 * 60000), field1: '104' },
  ];
  globalThis.fetch = (async () => new Response(JSON.stringify({ channel: { id: 1, name: 'Test' }, feeds }))) as typeof fetch;
  try {
    await loadFeeds('1', range, new AbortController().signal, () => {}, { cache, clock: () => now });
    const result = await loadFeeds('1', range, new AbortController().signal, () => {}, { cache, clock: () => now });
    assert.equal(result.cacheHits, 1);
    const model = analyze(result.feeds, range, 'hour', defaultSettings);
    assert(Math.abs(model.importEnergy! - 2) < 1e-9);
    assert.equal(model.coverage, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test('failed and cancelled windows cannot be reused as complete data', async () => {
  const originalFetch = globalThis.fetch;
  const cache = new IndexedFeedCache(cacheName());
  const options = { cache, clock: () => now };
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(loadFeeds('1', range, new AbortController().signal, () => {}, options), /HTTP 503/);
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      controller.abort();
      return new Response(JSON.stringify({ channel: { id: 1, name: 'Test' }, feeds: [sample(start)] }));
    }) as typeof fetch;
    await assert.rejects(loadFeeds('1', range, controller.signal, () => {}, options), /aborted/);
    const day = Math.floor(start / DAY) * DAY;
    assert.equal(await cache.get(`1:${day}:${day + DAY}:8000`, now), null);
  } finally { globalThis.fetch = originalFetch; }
});
