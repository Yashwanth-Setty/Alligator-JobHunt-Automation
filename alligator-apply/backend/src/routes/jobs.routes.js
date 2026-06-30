import { Router } from 'express';
import { getActiveResume } from '../services/resumeService.js';
import {
  countEligibleJobs,
  getHuntKpis,
  getJobById,
  getScanStatus,
  getScanMetrics,
  isScanRunning,
  listJobs,
  getJobFunnelStats,
  getJobsListDebug,
  getScanDebugReport,
  updateJobRecord,
  moveJobToManual,
  seedFromMock,
  skipJob,
  startScanJob,
  stopScanJob,
  exportJobsCsv,
  clearMockData,
} from '../services/jobScanService.js';
import { generatePacketForJob } from '../services/packetService.js';
import { suggestLocations, getLocationStats } from '../services/locationQuery.js';

const router = Router();

function parseJobFilters(query) {
  return {
    keywords: query.keywords,
    location: query.location,
    company: query.company,
    source: query.source,
    minScore: query.minScore,
    remoteType: query.remoteType,
    visaFit: query.visaFit,
    employmentType: query.employmentType,
    experienceLevel: query.experienceLevel,
    datePostedDays: query.datePostedDays,
    salaryMin: query.salaryMin,
    salaryMax: query.salaryMax,
    pipelineStatus: query.pipelineStatus,
    autoApplyEligible: query.autoApplyEligible,
    savedOnly: query.savedOnly,
    scanRunId: query.scanRunId,
  };
}

router.get('/locations/suggest', (req, res) => {
  const q = req.query.q || '';
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || '10', 10)));
  res.json({ suggestions: suggestLocations(q, limit) });
});

router.get('/locations/stats', (req, res) => {
  res.json({ locations: getLocationStats(parseJobFilters(req.query)) });
});

router.get('/funnel', (req, res) => {
  res.json(getJobFunnelStats(parseJobFilters(req.query)));
});

router.get('/debug/list', (req, res) => {
  const tab = req.query.tab || 'all';
  res.json(getJobsListDebug(parseJobFilters(req.query), tab));
});

router.get('/debug/scan/:scanRunId', (req, res) => {
  const report = getScanDebugReport(req.params.scanRunId);
  if (!report) return res.status(404).json({ error: 'Scan run not found' });
  res.json(report);
});

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '25', 10)));
  const tab = req.query.tab || 'all';
  const sortBy = req.query.sortBy || 'score';
  const sortOrder = req.query.sortOrder || req.query.order || 'desc';
  const filters = parseJobFilters(req.query);
  // [DIAG-2] GET /api/jobs received
  console.log('[DIAG-2] GET /api/jobs', JSON.stringify({ keywords: filters.keywords, location: filters.location, scanRunId: filters.scanRunId, sortBy }));
  res.json(listJobs({ page, limit, filters, tab, sortBy, sortOrder }));
});

router.get('/kpi', (req, res) => {
  res.json(getHuntKpis(parseJobFilters(req.query)));
});

router.get('/eligible/count', (_req, res) => {
  res.json({ count: countEligibleJobs() });
});

router.get('/scan/status', (_req, res) => {
  res.json(getScanStatus());
});

router.get('/scan/metrics', (_req, res) => {
  res.json(getScanMetrics());
});

router.post('/scan', (req, res) => {
  const resume = getActiveResume();
  if (!resume) {
    return res.status(400).json({ error: 'Upload a resume before running a job hunt' });
  }
  if (isScanRunning()) {
    return res.status(409).json({ error: 'Scan already running', status: getScanStatus() });
  }
  const filters = req.body?.filters || {};
  // [DIAG-1] POST /api/jobs/scan received
  console.log('[DIAG-1] POST /api/jobs/scan', JSON.stringify({ keywords: filters.keywords, location: filters.location, scanRunId: filters.scanRunId ?? '(not in body)' }));
  const result = startScanJob(filters);
  res.json({ ...result, status: getScanStatus() });
});

router.post('/scan/stop', (_req, res) => {
  res.json(stopScanJob());
});

router.post('/seed', (_req, res) => {
  const { count } = seedFromMock();
  res.json({ success: true, count });
});

router.post('/clear-mock', (_req, res) => {
  res.json(clearMockData());
});

router.get('/export', (req, res) => {
  const filters = {
    keywords: req.query.keywords,
    location: req.query.location,
    company: req.query.company,
    source: req.query.source,
    minScore: req.query.minScore,
    remoteType: req.query.remoteType,
    visaFit: req.query.visaFit,
    employmentType: req.query.employmentType,
    pipelineStatus: req.query.pipelineStatus,
  };
  const csv = exportJobsCsv(filters);
  const format = (req.query.format || 'csv').toLowerCase();
  const filename = `alligator-jobs-${new Date().toISOString().slice(0, 10)}.${format === 'xlsx' ? 'csv' : 'csv'}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.post('/:jobId/packet', async (req, res) => {
  try {
    const out = await generatePacketForJob(req.params.jobId);
    if (!out) return res.status(404).json({ error: 'Job not found' });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:jobId/manual', (req, res) => {
  const out = moveJobToManual(req.params.jobId, req.body?.reason, req.body?.details);
  if (!out) return res.status(404).json({ error: 'Job not found' });
  res.json(out);
});

router.post('/:jobId/skip', (req, res) => {
  const out = skipJob(req.params.jobId);
  if (!out) return res.status(404).json({ error: 'Job not found' });
  res.json(out);
});

router.get('/:jobId', (req, res) => {
  const job = getJobById(req.params.jobId, {
    minScore: req.query.minScore,
    keywords: req.query.keywords,
    location: req.query.location,
    visaFit: req.query.visaFit,
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.patch('/:jobId', (req, res) => {
  const job = updateJobRecord(req.params.jobId, req.body);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
