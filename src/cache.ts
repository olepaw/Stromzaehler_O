import type { Channel, Feed } from './data';

// IndexedDB keeps large responses out of synchronous localStorage and JS memory.
// These are conservative payload estimates, not a promise about browser disk overhead.
export const CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const CACHE_MAX_ENTRIES = 64;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const DAY = 86400000;
export type CachedWindow = {
  key: string; end: number; fetchedUntil: number; savedAt: number;
  channel: Channel; feeds: Feed[]; bytes: number;
};
type Metadata = { key: string; bytes: number; accessedAt: number; expiresAt: number };
export type FeedCache = {
  get(key: string, now: number): Promise<CachedWindow | null>;
  put(value: Omit<CachedWindow, 'bytes'>): Promise<void>;
};
export function cacheLifetime(value: Pick<CachedWindow, 'end' | 'fetchedUntil'>, now: number): number {
  // An unfinished window stays short-lived even after midnight.
  return value.fetchedUntil < value.end || value.end > now - DAY ? 60000 : DAY;
}
export function isCacheFresh(value: CachedWindow, now: number): boolean {
  const age = now - value.savedAt;
  return age >= 0 && age < cacheLifetime(value, now);
}
function estimateBytes(value: Omit<CachedWindow, 'bytes'>): number {
  let bytes = 512 + value.key.length * 2;
  for (const feed of value.feeds) {
    bytes += 64;
    for (const [key, field] of Object.entries(feed)) bytes += 32 + key.length * 2 + (typeof field === 'string' ? field.length * 2 : 8);
    if (bytes > MAX_ENTRY_BYTES) break;
  }
  return bytes;
}
export class IndexedFeedCache implements FeedCache {
  private database: Promise<IDBDatabase | null> | undefined;
  constructor(private name = 'strom-o-feeds-v1') {}
  private open(): Promise<IDBDatabase | null> {
    if (!this.database) this.database = new Promise(resolve => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let settled = false;
      const finish = (database: IDBDatabase | null) => {
        if (settled) { database?.close(); return; }
        settled = true; clearTimeout(timer); resolve(database);
      };
      // A blocked or unavailable database must never stall a ThingSpeak request.
      const timer = setTimeout(() => finish(null), 1000);
      try {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('windows', { keyPath: 'key' });
          request.result.createObjectStore('metadata', { keyPath: 'key' });
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => { database.close(); this.database = undefined; };
          finish(database);
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch { finish(null); }
    });
    return this.database;
  }
  async get(key: string, now: number): Promise<CachedWindow | null> {
    const database = await this.open();
    if (!database) return null;
    return new Promise(resolve => {
      try {
        const transaction = database.transaction(['windows', 'metadata'], 'readwrite');
        let value: CachedWindow | null = null;
        const request = transaction.objectStore('windows').get(key);
        request.onsuccess = () => {
          try {
            const stored = request.result as CachedWindow | undefined;
            if (stored && isCacheFresh(stored, now)) {
              value = stored;
              transaction.objectStore('metadata').put({ key, bytes: stored.bytes, accessedAt: now, expiresAt: stored.savedAt + cacheLifetime(stored, now) } satisfies Metadata);
            } else if (stored) {
              transaction.objectStore('windows').delete(key);
              transaction.objectStore('metadata').delete(key);
            }
          } catch { transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = transaction.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async put(value: Omit<CachedWindow, 'bytes'>): Promise<void> {
    const bytes = estimateBytes(value);
    if (bytes > MAX_ENTRY_BYTES) return;
    const database = await this.open();
    if (!database) return;
    await new Promise<void>(resolve => {
      try {
        const transaction = database.transaction(['windows', 'metadata'], 'readwrite');
        const windows = transaction.objectStore('windows'), metadata = transaction.objectStore('metadata');
        const request = metadata.getAll();
        request.onsuccess = () => {
          try {
            // Only small metadata records are scanned; never clone the entire cache.
            const retained: Metadata[] = [];
            for (const entry of request.result as Metadata[]) {
              if (entry.key === value.key || entry.expiresAt <= value.savedAt) { windows.delete(entry.key); metadata.delete(entry.key); }
              else retained.push(entry);
            }
            retained.sort((a, b) => a.accessedAt - b.accessedAt);
            let total = retained.reduce((sum, entry) => sum + entry.bytes, 0) + bytes;
            while (retained.length >= CACHE_MAX_ENTRIES || total > CACHE_MAX_BYTES) {
              const oldest = retained.shift()!;
              total -= oldest.bytes; windows.delete(oldest.key); metadata.delete(oldest.key);
            }
            windows.put({ ...value, bytes } satisfies CachedWindow);
            metadata.put({ key: value.key, bytes, accessedAt: value.savedAt, expiresAt: value.savedAt + cacheLifetime(value, value.savedAt) } satisfies Metadata);
          } catch { transaction.abort(); }
        };
        transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
      } catch { resolve(); }
    });
  }
  async clear(): Promise<void> {
    const database = await this.open();
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      try {
        const transaction = database.transaction(['windows', 'metadata'], 'readwrite');
        transaction.objectStore('windows').clear(); transaction.objectStore('metadata').clear();
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error('Der Datencache konnte nicht geleert werden.'));
      } catch { reject(new Error('Der Datencache konnte nicht geleert werden.')); }
    });
  }
}
export const feedCache = new IndexedFeedCache();
