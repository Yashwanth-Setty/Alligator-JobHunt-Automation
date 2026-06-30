import {
  normalizeCompany,
  normalizeLocation,
  normalizeTitle,
  titlesAreSimilar,
} from './normalize.js';

/**
 * Deduplicate jobs with stronger matching:
 * - same applyUrl → duplicate
 * - normalized company + similar title + normalized location → duplicate
 * @param {import('./types.js').Job[]} jobs
 * @returns {{ jobs: import('./types.js').Job[], removed: number, duplicateIds: Set<string> }}
 */
export function dedupeJobsWithStats(jobs) {
  const kept = [];
  const duplicateIds = new Set();
  let removed = 0;

  for (const job of jobs) {
    const dupOf = findDuplicateIndex(kept, job);
    if (dupOf >= 0) {
      removed += 1;
      duplicateIds.add(job.id);
      const existing = kept[dupOf];
      if ((job.qualityScore || 0) > (existing.qualityScore || 0)) {
        kept[dupOf] = { ...job, _duplicate: true };
      }
      continue;
    }
    kept.push(job);
  }

  return { jobs: kept, removed, duplicateIds };
}

/** @param {import('./types.js').Job[]} jobs */
export function dedupeJobs(jobs) {
  return dedupeJobsWithStats(jobs).jobs;
}

/**
 * @param {import('./types.js').Job[]} kept
 * @param {import('./types.js').Job} job
 */
function findDuplicateIndex(kept, job) {
  const urlKey = normalizeApplyUrl(job.applyUrl);
  const company = normalizeCompany(job.company);
  const title = normalizeTitle(job.title);
  const location = normalizeLocation(job.location);

  for (let i = 0; i < kept.length; i += 1) {
    const other = kept[i];
    const otherUrl = normalizeApplyUrl(other.applyUrl);

    if (urlKey && otherUrl && urlKey === otherUrl) return i;

    const sameCompany = company && normalizeCompany(other.company) === company;
    const sameLocation = location && normalizeLocation(other.location) === location;

    if (sameCompany && sameLocation && titlesAreSimilar(job.title, other.title)) {
      return i;
    }

    if (
      sameCompany &&
      title &&
      normalizeTitle(other.title) === title &&
      (!location || !normalizeLocation(other.location) || sameLocation)
    ) {
      return i;
    }
  }
  return -1;
}

export function dedupeKey(job) {
  const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return [
    normalizeCompany(job.company),
    normalizeTitle(job.title),
    normalizeLocation(job.location),
    normalizeApplyUrl(job.applyUrl),
  ].join('|');
}

function normalizeApplyUrl(url = '') {
  return String(url || '')
    .toLowerCase()
    .trim()
    .replace(/\/$/, '')
    .replace(/\?.*$/, '');
}
