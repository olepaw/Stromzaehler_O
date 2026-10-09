import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savedSettings, settingsStorageKey } from '../src/settings';

function storage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}
test('new visitors use a price of 27 cents per kWh', () => {
  assert.equal(savedSettings(storage()).tariff, 0.27);
});
test('existing browser preferences move to the new name and receive the requested price once', () => {
  const browserStorage = storage({ 'strom-ott-settings': JSON.stringify({ channelId: '12345', counterUnit: 'Wh', tariff: 0.32 }) });
  const migrated = savedSettings(browserStorage);
  assert.equal(migrated.channelId, '12345');
  assert.equal(migrated.counterUnit, 'Wh');
  assert.equal(migrated.tariff, 0.27);
  assert.equal(browserStorage.getItem('strom-ott-settings'), null);
  assert.equal(JSON.parse(browserStorage.getItem(settingsStorageKey)!).tariff, 0.27);
  browserStorage.setItem(settingsStorageKey, JSON.stringify({ ...migrated, tariff: 0.4 }));
  assert.equal(savedSettings(browserStorage).tariff, 0.4);
});
