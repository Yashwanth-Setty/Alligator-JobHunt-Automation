import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { legacyMockToJob } from './types.js';
import { filterJobsWithStats } from './jobFetchFilter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = path.join(__dirname, '../../data/mock_jobs.json');

let cache = null;

export function loadMockJobs() {
  if (!cache) {
    const raw = fs.readFileSync(MOCK_PATH, 'utf8');
    cache = JSON.parse(raw).map(legacyMockToJob);
  }
  return cache;
}

export function clearMockCache() {
  cache = null;
}

export function filterJobs(jobs, filters = {}) {
  return filterJobsWithStats(jobs, filters, { forFetch: true }).jobs;
}

export function paginateJobs(jobs, page = 1, limit = 50) {
  const total = jobs.length;
  const offset = (page - 1) * limit;
  const slice = jobs.slice(offset, offset + limit);
  return {
    jobs: slice,
    page,
    limit,
    total,
    hasMore: offset + slice.length < total,
  };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout(promise, ms, label = 'operation') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
