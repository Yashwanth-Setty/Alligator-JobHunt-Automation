const BASE = '/api';
const SAVED_SEARCH_KEY = 'alligator_saved_search';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function buildJobQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  });
  if (params.salaryMinK) q.set('salaryMin', String(Number(params.salaryMinK) * 1000));
  if (params.salaryMaxK) q.set('salaryMax', String(Number(params.salaryMaxK) * 1000));
  return q.toString();
}

export const api = {
  health: () => request('/health'),
  getSettings: () => request('/settings'),
  updateSettings: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),

  getResume: () => request('/resume'),
  uploadResume: (file) => {
    const fd = new FormData();
    fd.append('resume', file);
    return fetch(`${BASE}/resume/upload`, { method: 'POST', body: fd }).then((r) => r.json());
  },
  deleteResume: () => request('/resume', { method: 'DELETE' }),

  getJobs: (params) => request(`/jobs?${buildJobQuery(params)}`),
  getKpi: () => request('/jobs/kpi'),
  getEligibleCount: () => request('/jobs/eligible/count'),
  getScanStatus: () => request('/jobs/scan/status'),
  startScan: (filters) => request('/jobs/scan', { method: 'POST', body: JSON.stringify({ filters }) }),
  stopScan: () => request('/jobs/scan/stop', { method: 'POST' }),
  seedJobs: () => request('/jobs/seed', { method: 'POST' }),

  generatePacket: (jobId) => request(`/jobs/${jobId}/packet`, { method: 'POST' }),
  moveToManual: (jobId, body) => request(`/jobs/${jobId}/manual`, { method: 'POST', body: JSON.stringify(body) }),
  skipJob: (jobId) => request(`/jobs/${jobId}/skip`, { method: 'POST' }),

  getStats: () => request('/applications/stats'),
  getPipeline: () => request('/applications/pipeline'),
  updateApplication: (jobId, body) =>
    request(`/applications/${jobId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getAutoApplyStatus: () => request('/auto-apply/status'),
  startBatchAutoApply: () => request('/auto-apply/batch', { method: 'POST' }),
  autoApplyJob: (jobId) => request(`/auto-apply/${jobId}`, { method: 'POST' }),
  getManualReview: () => request('/auto-apply/manual-review'),
  resolveManualReview: (id, body) =>
    request(`/auto-apply/manual-review/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),

  saveSearch: (filters) => {
    localStorage.setItem(SAVED_SEARCH_KEY, JSON.stringify(filters));
    return filters;
  },
  loadSavedSearch: () => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_SEARCH_KEY) || 'null');
    } catch {
      return null;
    }
  },
};
