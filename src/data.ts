import { bucketStart, nextBucket, type Range, type Granularity } from './time';
export type Feed = { created_at: string; entry_id: number; [key: string]: string | number | null };
export type Channel = { id: number; name: string; [key: string]: unknown };
export type Settings = { channelId: string; importField: string; exportField: string; powerField: string; counterUnit: 'kWh' | 'Wh'; powerUnit: 'W' | 'kW'; tariff: number };
export const defaultSettings: Settings = { channelId: '2184811', importField: 'field1', exportField: 'field2', powerField: 'field3', counterUnit: 'kWh', powerUnit: 'W', tariff: 0.27 };
export function numeric(value: unknown): number | null {
  if (value == null || typeof value !== 'string' && typeof value !== 'number' || typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function normalizeFeeds(feeds: Feed[]): Feed[] {
  const unique = new Map<number, Feed>();
  for (const feed of feeds) {
    const timestamp = Date.parse(feed.created_at);
    if (Number.isFinite(timestamp)) unique.set(timestamp, feed);
  }
  return [...unique.entries()].sort(([a], [b]) => a - b).map(([, f]) => f);
}
export type Bucket = { timestamp: number; importEnergy: number | null; exportEnergy: number | null; power: number | null; peak: number | null };
export function analyze(feeds: Feed[], range: Range, granularity: Granularity, settings: Settings, intervalHours = 6) {
  const sorted = normalizeFeeds(feeds);
  const rows = new Map<number, Bucket>();
  for (let t = bucketStart(range.start, granularity, intervalHours); t < range.end; t = nextBucket(t, granularity, intervalHours)) {
    rows.set(t, { timestamp: t, importEnergy: null, exportEnergy: null, power: null, peak: null });
    if (rows.size > 10000) throw new Error('Bitte eine gröbere Auflösung wählen.');
  }
  const warnings = new Set<string>();
  const scale = settings.counterUnit === 'Wh' ? 0.001 : 1;
  const energy = (field: string, target: 'importEnergy' | 'exportEnergy') => {
    const values = sorted.map(f => ({ t: Date.parse(f.created_at), v: numeric(f[field]) })).filter((p): p is { t: number; v: number } => p.v !== null);
    let covered = 0;
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1], b = values[i];
      const left = Math.max(a.t, range.start), right = Math.min(b.t, range.end);
      if (right <= left) continue;
      if (b.v < a.v) { warnings.add('Ein Zählerstand ist gesunken. Das betroffene Intervall wird nicht als Verbrauch gerechnet.'); continue; }
      if (b.t - a.t > 2 * 3600000) { warnings.add('Messlücken über 2 Stunden werden nicht hochgerechnet. Verbrauch und Kosten können unvollständig sein.'); continue; }
      covered += right - left;
      const rate = (b.v - a.v) * scale / (b.t - a.t);
      let cursor = left;
      while (cursor < right) {
        const start = bucketStart(cursor, granularity, intervalHours);
        const stop = Math.min(nextBucket(start, granularity, intervalHours), right);
        const row = rows.get(start);
        if (row) row[target] = (row[target] ?? 0) + rate * (stop - cursor);
        cursor = stop;
      }
    }
    const first = values.find(p => p.t >= range.start && p.t < range.end);
    const last = [...values].reverse().find(p => p.t >= range.start && p.t <= range.end);
    return { covered, first, last };
  };
  const importInfo = energy(settings.importField, 'importEnergy');
  const exportInfo = energy(settings.exportField, 'exportEnergy');
  const selected = sorted.filter(f => { const t = Date.parse(f.created_at); return t >= range.start && t < range.end; });
  const powers = new Map<number, { sum: number; count: number; peak: number }>();
  for (const feed of selected) {
    const value = numeric(feed[settings.powerField]);
    if (value === null) continue;
    const power = value * (settings.powerUnit === 'kW' ? 1000 : 1);
    const bucket = bucketStart(Date.parse(feed.created_at), granularity, intervalHours);
    const aggregate = powers.get(bucket) ?? { sum: 0, count: 0, peak: -Infinity };
    aggregate.sum += power;
    aggregate.count++;
    aggregate.peak = Math.max(aggregate.peak, power);
    powers.set(bucket, aggregate);
  }
  for (const [timestamp, values] of powers) {
    const row = rows.get(timestamp);
    if (row) { row.power = values.sum / values.count; row.peak = values.peak; }
  }
  const buckets = [...rows.values()];
  const sum = (field: 'importEnergy' | 'exportEnergy') => buckets.some(b => b[field] !== null) ? buckets.reduce((total, b) => total + (b[field] ?? 0), 0) : null;
  const allPowers = [...powers.values()];
  const powerCount = allPowers.reduce((sum, p) => sum + p.count, 0);
  const importEnergy = sum('importEnergy');
  const coverage = Math.min(1, importInfo.covered / (range.end - range.start));
  if (selected.length > 0 && coverage < 0.98) warnings.add('Der gewählte Zeitraum ist nicht vollständig durch Zählerwerte abgedeckt. Angezeigt wird nur der erfasste Verbrauch.');
  return {
    buckets, selected, importEnergy, exportEnergy: sum('exportEnergy'),
    costs: importEnergy === null ? null : importEnergy * settings.tariff,
    averagePower: powerCount ? allPowers.reduce((sum, p) => sum + p.sum, 0) / powerCount : null,
    peakPower: powerCount ? allPowers.reduce((max, p) => Math.max(max, p.peak), -Infinity) : null,
    latestPower: numeric(selected.at(-1)?.[settings.powerField]) === null ? null : Number(selected.at(-1)?.[settings.powerField]) * (settings.powerUnit === 'kW' ? 1000 : 1),
    coverage, importInfo, exportInfo, warnings: [...warnings],
  };
}

export async function loadFeeds(channelId: string, range: Range, signal: AbortSignal, progress: (requests: number) => void): Promise<{ channel: Channel; feeds: Feed[] }> {
  if (!/^\d+$/.test(channelId)) throw new Error('Die Kanal-ID muss eine Zahl sein.');
  let requests = 0;
  let channel: Channel = { id: Number(channelId), name: 'Stromzähler' };
  async function request(start: number | null, end: number, results = 8000): Promise<Feed[]> {
    if (++requests > 240) throw new Error('Dieser Zeitraum benötigt zu viele Abfragen. Bitte den Zeitraum verkleinern.');
    progress(requests);
    const url = new URL(`https://api.thingspeak.com/channels/${channelId}/feeds.json`);
    url.searchParams.set('results', String(results));
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('end', new Date(end).toISOString().slice(0, 19).replace('T', ' '));
    if (start !== null) url.searchParams.set('start', new Date(start).toISOString().slice(0, 19).replace('T', ' '));
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
    if (!response.ok) throw new Error(`ThingSpeak ist nicht erreichbar (HTTP ${response.status}). Prüfe, ob der Kanal öffentlich und der Zugriff erlaubt ist.`);
    const data = await response.json();
    if (!data || !Array.isArray(data.feeds) || !data.channel) throw new Error('Der Kanal liefert keine lesbaren Daten. Bitte öffentliche Freigabe und Kanal-ID prüfen.');
    channel = data.channel;
    return data.feeds;
  }
  async function window(start: number, end: number, depth = 0): Promise<Feed[]> {
    const feeds = await request(start, end);
    if (feeds.length < 8000) return feeds;
    if (depth >= 16 || end - start < 2000) throw new Error('ThingSpeak liefert zu viele Messwerte pro Intervall. Die Abfrage wurde gestoppt, um keine Daten abzuschneiden.');
    const mid = Math.floor((start + end) / 2000) * 1000;
    return [...await window(start, mid, depth + 1), ...await window(mid, end, depth + 1)];
  }
  const result: Feed[] = [];
  // Keep requests bounded and split saturated responses instead of silently truncating at 8,000.
  const week = 7 * 86400000;
  for (let start = range.start; start < range.end; start += week) result.push(...await window(start, Math.min(start + week, range.end)));
  // A value before the selection enables interpolation at its exact start boundary.
  const previous = await request(null, range.start, 1);
  result.push(...previous);
  // Historical ranges also need the first following value to interpolate the end boundary.
  if (range.end < Date.now() - 60000) {
    const following = await window(range.end, Math.min(Date.now(), range.end + 2 * 3600000));
    const first = normalizeFeeds(following).find(f => Date.parse(f.created_at) >= range.end);
    if (first) result.push(first);
  }
  return { channel, feeds: normalizeFeeds(result) };
}

export function demoFeeds(range: Range): Feed[] {
  const feeds: Feed[] = [];
  const step = Math.max(300000, Math.ceil((range.end - range.start) / 6000 / 60000) * 60000);
  let imported = 56200, exported = 33;
  for (let t = range.start - step, i = 0; t <= range.end; t += step, i++) {
    const hour = new Date(t).getUTCHours() + 2;
    const wave = Math.sin(i * 1.7) * 100 + Math.sin(i * 0.38) * 70;
    const power = Math.max(80, 230 + wave + (hour % 24 >= 17 && hour % 24 <= 21 ? 900 + Math.abs(Math.sin(i * 0.28)) * 1500 : 0) + (i % 61 < 4 ? 1700 : 0));
    imported += power * step / 3600000 / 1000;
    exported += Math.max(0, Math.sin((hour - 7) / 10 * Math.PI)) * 0.00015;
    feeds.push({ created_at: new Date(t).toISOString(), entry_id: i + 1, field1: imported.toFixed(5), field2: exported.toFixed(5), field3: power.toFixed(1) });
  }
  return feeds;
}
