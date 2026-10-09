import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, defaultSettings, loadFeeds, numeric, type Feed } from '../src/data';
import { bucketStart, fromInput, nextBucket, presetRange, toInput } from '../src/time';
const start = Date.parse('2026-10-08T10:00:00Z');
const close = (actual: number | null, expected: number) => assert(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} should be approximately ${expected}`);
const feed = (minutes: number, value: string | null, power: string | null = '500'): Feed => ({ created_at: new Date(start + minutes * 60000).toISOString(), entry_id: minutes + 100, field1: value, field2: '33', field3: power });

test('counter differences, boundary interpolation, hourly allocation and costs agree', () => {
  const result = analyze([feed(-30, '100'), feed(30, '102'), feed(90, '104')], { start, end: start + 3600000 }, 'hour', defaultSettings);
  close(result.importEnergy, 2);
  close(result.costs, 0.64);
  assert.equal(result.coverage, 1);
  assert.equal(result.exportEnergy, 0);
  close(result.buckets[0].importEnergy, 2);
});
test('Wh and kW source values convert to kWh and W', () => {
  const result = analyze([feed(0, '1000', '1.5'), feed(60, '2000', '2')], { start, end: start + 3600000 }, 'hour', { ...defaultSettings, counterUnit: 'Wh', powerUnit: 'kW' });
  close(result.importEnergy, 1);
  assert.equal(result.peakPower, 1500);
});
test('nulls never become zero, sparse power values remain absent', () => {
  assert.equal(numeric(null), null); assert.equal(numeric(''), null); assert.equal(numeric('no data'), null);
  const result = analyze([feed(0, null, null), feed(60, null, null)], { start, end: start + 7200000 }, 'hour', defaultSettings);
  assert.equal(result.importEnergy, null); assert.equal(result.averagePower, null); assert.equal(result.buckets[0].power, null);
});
test('counter resets are excluded and visibly flagged', () => {
  const result = analyze([feed(0, '100'), feed(30, '99'), feed(60, '100')], { start, end: start + 3600000 }, 'hour', defaultSettings);
  close(result.importEnergy, 1);
  assert(result.warnings.some(w => w.includes('gesunken')));
  assert.equal(result.coverage, 0.5);
});
test('large gaps are not extrapolated into reassuring consumption figures', () => {
  const result = analyze([feed(0, '100'), feed(181, '120')], { start, end: start + 181 * 60000 }, 'hour', defaultSettings);
  assert.equal(result.importEnergy, null); assert.equal(result.coverage, 0);
  assert(result.warnings.some(w => w.includes('Messlücken')));
});
test('duplicate overlapping feeds are counted once and sorted', () => {
  const result = analyze([feed(60, '102'), feed(0, '100'), feed(60, '102')], { start, end: start + 3600000 }, 'hour', defaultSettings);
  close(result.importEnergy, 2); assert.equal(result.selected.length, 1);
});
test('Berlin days respect the 23-hour and 25-hour DST transitions', () => {
  const spring = fromInput('2026-03-29T00:00');
  const autumn = fromInput('2026-10-25T00:00');
  assert.equal((nextBucket(spring, 'day') - spring) / 3600000, 23);
  assert.equal((nextBucket(autumn, 'day') - autumn) / 3600000, 25);
  assert.equal(bucketStart(fromInput('2026-10-25T18:00'), 'day'), autumn);
  assert.throws(() => fromInput('2026-03-29T02:30'), /Zeitumstellung/);
  assert.equal(toInput(new Date(fromInput('2026-10-09T12:15'))), '2026-10-09T12:15');
});
test('yesterday is a local calendar day rather than an arbitrary 24-hour interval', () => {
  const range = presetRange('yesterday', Date.parse('2026-03-30T10:00:00Z'));
  assert.equal((range.end - range.start) / 3600000, 23);
});
test('saturated ThingSpeak responses split and are deduplicated rather than truncated', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const urls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    const queryStart = url.searchParams.get('start');
    const queryEnd = url.searchParams.get('end');
    let feeds: Feed[];
    if (url.searchParams.get('results') === '1') feeds = [feed(-1, '99')];
    else if (queryStart === '2026-10-08 10:00:00' && queryEnd === '2026-10-08 11:00:00') feeds = Array.from({ length: 8000 }, () => feed(0, '100'));
    else if (queryStart === '2026-10-08 10:00:00') feeds = [feed(0, '100'), feed(30, '101')];
    else if (queryStart === '2026-10-08 10:30:00') feeds = [feed(30, '101'), feed(60, '102')];
    else feeds = [feed(60, '102')];
    return new Response(JSON.stringify({ channel: { id: 2184811, name: 'Test' }, feeds }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await loadFeeds('2184811', { start, end: start + 3600000 }, controller.signal, () => {});
    assert.equal(result.feeds.length, 4);
    assert(urls.some(u => u.searchParams.get('start') === '2026-10-08 10:30:00'));
    close(analyze(result.feeds, { start, end: start + 3600000 }, 'hour', defaultSettings).importEnergy, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test('non-public or denied feeds produce an actionable error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;
  try { await assert.rejects(loadFeeds('2184811', { start, end: start + 3600000 }, new AbortController().signal, () => {}), /HTTP 403/); }
  finally { globalThis.fetch = originalFetch; }
});
