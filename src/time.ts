export const TIME_ZONE = 'Europe/Berlin';
const partsFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const parts = (date: Date) => Object.fromEntries(partsFormatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
const inputCache = new Map<string, number>();
export function toInput(date: Date): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function fromInput(input: string): number {
  const cached = inputCache.get(input);
  if (cached !== undefined) return cached;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error('Bitte einen gültigen Zeitpunkt eingeben.');
  const expected = Date.parse(`${input}:00Z`);
  let candidate = expected;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(candidate));
    const observed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if (observed === expected) break;
    candidate += expected - observed;
  }
  if (!Number.isFinite(candidate) || toInput(new Date(candidate)) !== input) {
    throw new Error('Dieser Zeitpunkt existiert wegen der Zeitumstellung nicht. Bitte eine andere Uhrzeit wählen.');
  }
  if (inputCache.size > 4096) inputCache.clear();
  inputCache.set(input, candidate);
  return candidate;
}
export type Range = { start: number; end: number };
export type Granularity = 'hour' | 'day' | 'month' | 'custom';
export const intervalHourOptions = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export function normalizeIntervalHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) throw new Error('Bitte eine Stundenzahl zwischen 1 und 24 eingeben.');
  return intervalHourOptions.find(option => option >= hours)!;
}
function clockBoundary(day: string, hour: number): number {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.floor(hour / 24));
  const calendarDay = date.toISOString().slice(0, 10);
  const localHour = hour % 24;
  // Spring's missing 02:00 boundary moves to 03:00. In autumn, use the
  // first occurrence of an ambiguous boundary so both repeated hours belong
  // to the same clock-based section. One-hour sections use real hourly bins.
  for (let shift = 0; shift <= 1; shift++) {
    const input = `${calendarDay}T${String(localHour + shift).padStart(2, '0')}:00`;
    try {
      const timestamp = fromInput(input);
      const earlier = timestamp - 3600000;
      return toInput(new Date(earlier)) === input ? earlier : timestamp;
    } catch { /* Try the first valid clock time after a spring transition. */ }
  }
  throw new Error('Die Intervallgrenze konnte nicht berechnet werden.');
}
export function presetRange(preset: string, now = Date.now()): Range {
  const today = toInput(new Date(now)).slice(0, 10);
  const shiftDate = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  if (preset === 'yesterday') return { start: fromInput(`${shiftDate(-1)}T00:00`), end: fromInput(`${today}T00:00`) };
  const days = preset === 'week' ? -6 : preset === 'month' ? -29 : 0;
  return { start: fromInput(`${shiftDate(days)}T00:00`), end: now };
}
export function bucketStart(timestamp: number, granularity: Granularity, intervalHours = 6): number {
  if (granularity === 'custom') {
    const hours = normalizeIntervalHours(intervalHours);
    if (hours === 1) return Math.floor(timestamp / 3600000) * 3600000;
    const local = toInput(new Date(timestamp));
    return clockBoundary(local.slice(0, 10), Math.floor(Number(local.slice(11, 13)) / hours) * hours);
  }
  if (granularity === 'hour') return Math.floor(timestamp / 3600000) * 3600000;
  const day = toInput(new Date(timestamp)).slice(0, 10);
  return fromInput(`${granularity === 'month' ? `${day.slice(0, 7)}-01` : day}T00:00`);
}
export function nextBucket(timestamp: number, granularity: Granularity, intervalHours = 6): number {
  if (granularity === 'custom') {
    const hours = normalizeIntervalHours(intervalHours);
    if (hours === 1) return timestamp + 3600000;
    const local = toInput(new Date(timestamp));
    return clockBoundary(local.slice(0, 10), (Math.floor(Number(local.slice(11, 13)) / hours) + 1) * hours);
  }
  if (granularity === 'hour') return timestamp + 3600000;
  const day = toInput(new Date(timestamp)).slice(0, 10);
  const date = new Date(`${day}T12:00:00Z`);
  if (granularity === 'day') date.setUTCDate(date.getUTCDate() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return fromInput(`${date.toISOString().slice(0, 10)}T00:00`);
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<number, Intl.NumberFormat>();
export function formatDate(timestamp: number, options: Intl.DateTimeFormatOptions = {}): string {
  const resolved = { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', ...options };
  // JSON omits undefined; filter first so an explicitly removed day/month remains distinct.
  const fields = Object.entries(resolved).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify(fields);
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('de-DE', Object.fromEntries(fields));
    if (dateFormatters.size >= 32) dateFormatters.clear();
    dateFormatters.set(key, formatter);
  }
  return formatter.format(timestamp);
}
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (numberFormatters.size >= 24) numberFormatters.clear();
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}
