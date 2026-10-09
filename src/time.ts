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
export type Granularity = 'hour' | 'day' | 'month';
export function presetRange(preset: string, now = Date.now()): Range {
  const today = toInput(new Date(now)).slice(0, 10);
  const shiftDate = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  if (preset === 'yesterday') return { start: fromInput(`${shiftDate(-1)}T00:00`), end: fromInput(`${today}T00:00`) };
  const days = preset === 'week' ? -6 : preset === 'month' ? -29 : 0;
  return { start: fromInput(`${shiftDate(days)}T00:00`), end: now };
}
export function bucketStart(timestamp: number, granularity: Granularity): number {
  if (granularity === 'hour') return Math.floor(timestamp / 3600000) * 3600000;
  const day = toInput(new Date(timestamp)).slice(0, 10);
  return fromInput(`${granularity === 'month' ? `${day.slice(0, 7)}-01` : day}T00:00`);
}
export function nextBucket(timestamp: number, granularity: Granularity): number {
  if (granularity === 'hour') return timestamp + 3600000;
  const day = toInput(new Date(timestamp)).slice(0, 10);
  const date = new Date(`${day}T12:00:00Z`);
  if (granularity === 'day') date.setUTCDate(date.getUTCDate() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return fromInput(`${date.toISOString().slice(0, 10)}T00:00`);
}
export function formatDate(timestamp: number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', ...options }).format(timestamp);
}
export function formatNumber(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
