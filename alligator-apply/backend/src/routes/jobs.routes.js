import { Router } from 'express';
import { getActiveResume } from '../services/resumeService.js';
import {
  countEligibleJobs,
  generatePacket,
  getHuntKpis,
  getJobById,
  getScanStatus,
  isScanRunning,
  listJobs,
  moveJobToManual,
  seedFromMock,
  skipJob,
  startScanJob,
  stopScanJob,
} from '../services/jobScanService.js';

const router = Router();

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
  const filters = {
    keywords: req.query.keywords,
    location: req.query.location,
    company: req.query.company,
    source: req.query.source,
    minScore: req.query.minScore,
    remoteType: req.query.remoteType,
    visaFit: req.query.visaFit,
    employmentType: req.query.employmentType,
    experienceLevel: req.query.experienceLevel,
    datePostedDays: req.query.datePostedDays,
    salaryMin: req.query.salaryMin,
    salaryMax: req.query.salaryMax,
    pipelineStatus: req.query.pipelineStatus,
    autoApplyEligible: req.query.autoApplyEligible,
  };
  res.json(listJobs({ page, limit, filters }));
});

router.get('/kpi', (_req, res) => {
  res.json(getHuntKpis());
});

router.get('/eligible/count', (_req, res) => {
  res.json({ count: countEligibleJobs() });
});

router.get('/scan/status', (_req, res) => {
  res.json(getScanStatus());
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

router.post('/:jobId/packet', (req, res) => {
  const out = generatePacket(req.params.jobId);
  if (!out) return res.status(404).json({ error: 'Job not found' });
  res.json(out);
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
  const job = getJobById(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
