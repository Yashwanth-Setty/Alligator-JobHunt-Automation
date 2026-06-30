import crypto from 'crypto';
import { getSourceCacheTtlMinutes } from './scanConfig.js';

const cache = new Map();

/** Fields that affect fetched/cached job sets per target. */
export const CACHE_FILTER_KEYS = ['keywords', 'location', 'remoteType', 'source', 'minScore', 'company'];

export function normalizeCacheFilters(filters = {}) {
  const out = {};
  for (const k of CACHE_FILTER_KEYS) {
    const v = filters[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      out[k] = String(v).trim();
    }
  }
  return out;
}

export function hashTargetList(targets = []) {
  const slugs = targets
    .map((t) => {
      if (typeof t === 'string') return t;
      return t.boardToken || t.id || '';
    })
    .filter(Boolean)
    .sort();
  return crypto.createHash('md5').update(slugs.join(',')).digest('hex').slice(0, 16);
}

function cacheKey(source, target, filters = {}, targetsHash = '') {
  const normalized = normalizeCacheFilters(filters);
  const raw = `${source}|${target}|${targetsHash}|${JSON.stringify(normalized)}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

export function getCachedSourceResult(source, target, filters, targetsHash = '') {
  const key = cacheKey(source, target, filters, targetsHash);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return { ...entry.data, fromCache: true };
}

export function setCachedSourceResult(source, target, filters, data, targetsHash = '') {
  const key = cacheKey(source, target, filters, targetsHash);
  const ttlMin = getSourceCacheTtlMinutes();
  cache.set(key, {
    data,
    expires: Date.now() + ttlMin * 60 * 1000,
  });
}

export function clearSourceCache() {
  cache.clear();
}
