/** Shared text normalization for dedupe and matching */

export function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function normalizeCompany(name = '') {
  return normalizeText(name)
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|holdings)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_NOISE = /\b(senior|sr|junior|jr|lead|staff|principal|i{1,3}|ii{1,3}|iv|v|1|2|3|4|5)\b/g;

export function normalizeTitle(title = '') {
  return normalizeText(title).replace(TITLE_NOISE, '').replace(/\s+/g, ' ').trim();
}

export function normalizeLocation(location = '') {
  return normalizeText(location)
    .replace(/\b(united states|usa|us)\b/g, 'us')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-set Jaccard similarity (0–1).
 * @param {string} a
 * @param {string} b
 */
export function titleSimilarity(a, b) {
  const ta = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export function titlesAreSimilar(a, b, threshold = 0.82) {
  return titleSimilarity(a, b) >= threshold;
}
