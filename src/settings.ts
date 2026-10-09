import { defaultSettings, type Settings } from './data';

export const settingsStorageKey = 'strom-o-settings';
// Only retained for migrating preferences from the previous name.
const legacyStorageKey = 'strom-ott-settings';
type SettingsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function savedSettings(storage: SettingsStorage = localStorage): Settings {
  try {
    const current = storage.getItem(settingsStorageKey);
    if (current) return { ...defaultSettings, ...JSON.parse(current) };
    const legacy = storage.getItem(legacyStorageKey);
    if (legacy) {
      const migrated = { ...defaultSettings, ...JSON.parse(legacy), tariff: defaultSettings.tariff };
      storage.setItem(settingsStorageKey, JSON.stringify(migrated));
      storage.removeItem(legacyStorageKey);
      return migrated;
    }
  } catch { /* Unavailable or invalid browser storage falls back to defaults. */ }
  return { ...defaultSettings };
}
