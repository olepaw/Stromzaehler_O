import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const exec = promisify(execFile);
const baseUrl = process.env.STROM_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, timezoneId: 'Europe/Berlin', locale: 'de-DE' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let behavior = 'fixture';
let liveRequests = 0;
const step = 15 * 60000;
const fixtureFeed = timestamp => ({
  created_at: new Date(timestamp).toISOString(), entry_id: Math.floor(timestamp / step),
  field1: (50000 + (timestamp - Date.parse('2026-01-01T00:00:00Z')) / 3600000 * 0.6).toFixed(4),
  field2: (33 + (timestamp - Date.parse('2026-01-01T00:00:00Z')) / 3600000 * 0.01).toFixed(4),
  field3: String(400 + Math.abs(Math.sin(timestamp / 3600000)) * 1000),
});
await page.route('https://api.thingspeak.com/**', async route => {
  if (behavior === 'fail') return route.fulfill({ status: 403, body: 'Forbidden' });
  if (behavior === 'live') {
    liveRequests++;
    try {
      // The cloud provides HTTPS egress through curl; TLS and policy checks remain enabled.
      const { stdout } = await exec('curl', ['--fail', '--silent', '--show-error', '--max-time', '30', route.request().url()], { maxBuffer: 32 * 1024 * 1024 });
      return await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: stdout });
    } catch { return route.abort('failed').catch(() => {}); }
  }
  const url = new URL(route.request().url());
  const end = Date.parse(url.searchParams.get('end').replace(' ', 'T') + 'Z');
  const start = url.searchParams.get('start') ? Date.parse(url.searchParams.get('start').replace(' ', 'T') + 'Z') : end - step;
  const feeds = [];
  if (url.searchParams.get('results') === '1') feeds.push(fixtureFeed(Math.floor(end / step) * step));
  else for (let t = Math.ceil(start / step) * step; t <= Math.min(end, Date.now()); t += step) feeds.push(fixtureFeed(t));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channel: { id: 2184811, name: 'Test fixture' }, feeds }) });
});
async function settled() {
  await page.waitForFunction(() => ['Live verbunden', 'Daten geladen', 'Demo-Modus', 'Nicht verbunden'].includes(document.querySelector('.connection-badge')?.textContent), null, { timeout: 90000 });
  await page.waitForTimeout(200);
}
try {
  await page.goto(baseUrl);
  await settled();
  assert.equal(await page.locator('.error-notice').count(), 0);
  assert(!/—/.test(await page.locator('.stat-number').first().innerText()));
  assert(await page.locator('.recharts-bar').count() > 0);
  console.log('PASS: public-channel loading and consumption diagram');

  await page.getByRole('button', { name: 'Heute', exact: true }).click();
  await settled();
  await page.getByRole('button', { name: 'Verbrauchsanalyse', exact: true }).click();
  await page.getByLabel('Einspeisung', { exact: true }).check();
  await page.getByLabel('Diagrammtyp').selectOption('line');
  assert(await page.locator('.recharts-line').count() >= 2);
  await page.getByRole('button', { name: 'Leistung', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Leistung im Verlauf' }).count(), 1);
  await page.getByRole('button', { name: 'Verbrauch', exact: true }).click();
  await page.getByLabel('Mindestverbrauch in kWh').fill('99999');
  assert.equal(await page.getByRole('heading', { name: 'Kein Intervall passt zum Filter' }).count(), 1);
  await page.getByLabel('Höchstverbrauch in kWh').fill('5');
  assert.equal(await page.getByRole('alert').count(), 1);
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await page.getByLabel('Mindestverbrauch in kWh').fill('0.1');
  await page.getByLabel('Höchstverbrauch in kWh').fill('2');
  assert(await page.locator('.interval-panel tbody tr').count() > 0);
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  const csvDownload = await csvEvent;
  const csv = await readFile(await csvDownload.path(), 'utf8');
  assert(csv.includes('Erfasster Netzbezug (kWh)'));
  assert(csv.split('\r\n').length > 1);
  console.log('PASS: chart controls, consumption filters, validation and CSV');

  await page.getByRole('button', { name: 'Messwerte', exact: true }).click();
  assert(await page.locator('tbody tr').count() > 0);
  await page.getByLabel('Messwerte durchsuchen').fill('definitely-no-match');
  assert.equal(await page.getByRole('heading', { name: 'Keine passenden Messwerte' }).count(), 1);
  await page.getByLabel('Suche zurücksetzen').click();
  await page.getByRole('button', { name: 'Zeitpunkt (Berlin)' }).click();
  assert(await page.locator('tbody tr').count() > 0);
  console.log('PASS: measurement search and sorting');

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Strompreis in Euro pro kWh').fill('0.4');
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  assert.equal(await page.getByRole('button', { name: 'Gespeichert' }).count(), 1);
  await page.reload(); await settled();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  assert.equal(await page.getByLabel('Strompreis in Euro pro kWh').inputValue(), '0.4');
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.getByLabel('Zeitraum von').fill('2026-10-09T23:59');
  await page.getByLabel('Zeitraum bis').fill('2026-10-09T00:00');
  await page.getByRole('button', { name: 'Zeitraum anzeigen' }).click();
  assert((await page.getByRole('alert').innerText()).includes('„Von“ muss vor „Bis“ liegen.'));
  console.log('PASS: persisted settings and invalid date-range validation');

  await mkdir('/tmp/strom-ott-tests', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(400);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({tag:e.tagName, class:e.className, right:e.getBoundingClientRect().right}))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `/tmp/strom-ott-tests/${width}.png`, fullPage: true });
  }
  await page.getByLabel('Navigation öffnen').click();
  await page.getByRole('button', { name: 'Messwerte', exact: true }).click();
  assert.equal(await page.locator('.sidebar.open').count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Jeder Messwert zählt.' }).count(), 1);
  console.log('PASS: desktop/tablet/mobile layouts and mobile navigation');

  behavior = 'fail';
  await page.reload(); await settled();
  assert.equal(await page.getByRole('alert').count(), 1);
  await page.getByRole('button', { name: 'Demo ansehen' }).click(); await settled();
  assert.equal(await page.locator('.demo-notice').count(), 1);
  assert((await page.locator('.demo-notice').innerText()).includes('stammen nicht aus deinem Kanal'));
  console.log('PASS: connection errors and explicitly labeled demo');

  if (process.env.STROM_LIVE_TEST === '1') {
    behavior = 'live';
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.getByRole('button', { name: 'Live-Daten laden' }).click();
    await settled();
    assert.equal(await page.locator('.error-notice').count(), 0);
    assert.equal(await page.locator('.demo-notice').count(), 0);
    assert((await page.locator('.selection-caption').innerText()).includes('Messwerte'));
    await page.getByRole('button', { name: 'Messwerte', exact: true }).click();
    assert((await page.locator('tbody tr').count()) > 0);
    console.log(`PASS: real ThingSpeak data loaded through HTTPS egress (${liveRequests} requests)`);
    console.log(await page.locator('.selection-caption').innerText());
  }
  assert.deepEqual(errors, []);
  console.log('All browser checks passed; no uncaught application errors.');
} finally { await browser.close(); }
