import { D1Database } from '@cloudflare/workers-types';

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get a setting value, using an in-memory cache to avoid redundant D1 reads.
 * Settings like 'email_ttl_days' and 'domain' change rarely (once a week at most),
 * so caching them eliminates a DB read on every incoming email.
 */
export async function getSetting(
  db: D1Database,
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.value;
  }

  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();

  if (row) {
    cache.set(key, { value: row.value, fetchedAt: Date.now() });
    return row.value;
  }

  return null;
}

/**
 * Get a setting value with a fallback default.
 */
export async function getSettingWithDefault(
  db: D1Database,
  key: string,
  defaultValue: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const value = await getSetting(db, key, ttlMs);
  return value ?? defaultValue;
}

/**
 * Invalidate cached entries. Call this after updating settings via admin endpoints.
 * Pass a specific key to invalidate, or call with no args to clear everything.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
