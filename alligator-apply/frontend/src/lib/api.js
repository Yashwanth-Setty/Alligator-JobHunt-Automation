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
  getCapabilities: () => request('/capabilities'),
  getSettings: () => request('/settings'),
  updateSettings: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),

  getResume: () => request('/resume'),
  uploadResume: (file) => {
    const fd = new FormData();
    fd.append('resume', file);
    return fetch(`${BASE}/resume/upload`, { method: 'POST', body: fd }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(data.error || r.statusText);
        err.status = r.status;
        err.resume = data.resume;
        err.parseFailed = data.parseFailed;
        throw err;
      }
      return data;
    });
  },
  deleteResume: () => request('/resume', { method: 'DELETE' }),

  getJobs: (params) => request(`/jobs?${buildJobQuery(params)}`),
  getJobFunnel: (params) => request(`/jobs/funnel?${buildJobQuery(params)}`),
  suggestLocations: (q, limit = 10) =>
    request(`/jobs/locations/suggest?q=${encodeURIComponent(q)}&limit=${limit}`),
  getLocationStats: (params = {}) => request(`/jobs/locations/stats?${buildJobQuery(params)}`),
  getJob: (id, params = {}) => request(`/jobs/${id}?${buildJobQuery(params)}`),
  updateJob: (id, body) => request(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getKpi: (params = {}) => request(`/jobs/kpi?${buildJobQuery(params)}`),
  getEligibleCount: () => request('/jobs/eligible/count'),
  getScanStatus: () => request('/jobs/scan/status'),
  getScanMetrics: () => request('/jobs/scan/metrics'),
  startScan: (filters) => {
    console.log('[api] POST /jobs/scan filters', filters);
    return request('/jobs/scan', { method: 'POST', body: JSON.stringify({ filters }) });
  },
  stopScan: () => request('/jobs/scan/stop', { method: 'POST' }),
  seedJobs: () => request('/jobs/seed', { method: 'POST' }),
  clearMockData: () => request('/jobs/clear-mock', { method: 'POST' }),
  exportJobs: (params = {}) => {
    const q = buildJobQuery(params);
    return fetch(`${BASE}/jobs/export?${q}`).then((r) => {
      if (!r.ok) throw new Error('Export failed');
      return r.blob();
    });
  },

  getSources: () => request('/sources'),
  toggleSource: (name, enabled) =>
    request(`/sources/${name}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  addSourceTarget: (source, slug) =>
    request(`/sources/${source}/targets`, { method: 'POST', body: JSON.stringify({ slug }) }),
  removeSourceTarget: (id) => request(`/sources/targets/${id}`, { method: 'DELETE' }),
  setSourceTargets: (source, targets) =>
    request(`/sources/${source}/targets`, { method: 'PUT', body: JSON.stringify({ targets }) }),

  generatePacket: (jobId) => request(`/jobs/${jobId}/packet`, { method: 'POST' }),
  moveToManual: (jobId, body) => request(`/jobs/${jobId}/manual`, { method: 'POST', body: JSON.stringify(body) }),
  skipJob: (jobId) => request(`/jobs/${jobId}/skip`, { method: 'POST' }),

  getStats: () => request('/applications/stats'),
  getCrmStats: () => request('/applications/stats/crm'),
  getPipeline: () => request('/applications/pipeline'),
  getApplications: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    return request(`/applications?${q}`);
  },
  createApplication: (body) => request('/applications', { method: 'POST', body: JSON.stringify(body) }),
  trackApplication: (jobId) =>
    request('/applications', { method: 'POST', body: JSON.stringify({ jobId, status: 'ready_to_apply' }) }),
  updateApplicationCrm: (id, body) =>
    request(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteApplication: (id) => request(`/applications/${id}`, { method: 'DELETE' }),
  exportApplications: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
    return fetch(`${BASE}/applications/export?${q}`).then((r) => {
      if (!r.ok) throw new Error('Export failed');
      return r.blob();
    });
  },
  importApplications: (csv) =>
    request('/applications/import', { method: 'POST', body: JSON.stringify({ csv }) }),
  updateApplication: (jobId, body) =>
    request(`/applications/${jobId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getAutoApplyStatus: () => request('/auto-apply/status'),
  startBatchAutoApply: () => request('/auto-apply/batch', { method: 'POST' }),
  autoApplyJob: (jobId) => request(`/auto-apply/${jobId}`, { method: 'POST' }),
  getManualReview: () => request('/auto-apply/manual-review'),
  resolveManualReview: (id, body) =>
    request(`/auto-apply/manual-review/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),

  getCopilotActions: () => request('/copilot/actions'),
  copilotChat: (body) => request('/copilot/chat', { method: 'POST', body: JSON.stringify(body) }),

  getRegistryTags: () => request('/registry/tags'),
  getRegistryStats: () => request('/registry/stats/summary'),
  getRegistryCompanies: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    });
    return request(`/registry/companies?${q}`);
  },
  createRegistryCompany: (body) =>
    request('/registry/companies', { method: 'POST', body: JSON.stringify(body) }),
  getRegistryEntries: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    });
    return request(`/registry/entries?${q}`);
  },
  createRegistryEntry: (body) =>
    request('/registry/entries', { method: 'POST', body: JSON.stringify(body) }),
  patchRegistryEntry: (id, body) =>
    request(`/registry/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  toggleRegistryEntry: (id, body = {}) =>
    request(`/registry/entries/${id}/toggle`, { method: 'POST', body: JSON.stringify(body) }),

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
