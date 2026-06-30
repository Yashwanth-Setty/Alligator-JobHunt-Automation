import { Router } from 'express';
import { getPipeline, getStats, PIPELINE_STATUSES, updateApplication as legacyUpdate } from '../services/applicationTracker.js';
import {
  APPLICATION_STATUSES,
  KANBAN_COLUMNS,
  createApplication,
  createFromJob,
  deleteApplication,
  exportApplicationsCsv,
  getApplicationById,
  getCrmStats,
  importApplicationsCsv,
  listApplications,
  updateApplication,
} from '../services/applicationCrmService.js';

const router = Router();

router.get('/stats', (_req, res) => {
  res.json(getStats());
});

router.get('/stats/crm', (_req, res) => {
  res.json(getCrmStats());
});

router.get('/pipeline', (_req, res) => {
  res.json(getPipeline());
});

router.get('/statuses', (_req, res) => {
  res.json({ statuses: APPLICATION_STATUSES, kanban: KANBAN_COLUMNS, legacy: PIPELINE_STATUSES });
});

router.get('/export', (req, res) => {
  const filters = {
    status: req.query.status,
    company: req.query.company,
    source: req.query.source,
    appliedAfter: req.query.appliedAfter,
    appliedBefore: req.query.appliedBefore,
  };
  const csv = exportApplicationsCsv(filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="applications.csv"');
  res.send(csv);
});

router.post('/import', (req, res) => {
  const csv = req.body?.csv || req.body?.data || '';
  if (!csv) return res.status(400).json({ error: 'CSV data required' });
  res.json(importApplicationsCsv(csv));
});

router.get('/', (req, res) => {
  const filters = {
    status: req.query.status,
    company: req.query.company,
    source: req.query.source,
    appliedAfter: req.query.appliedAfter,
    appliedBefore: req.query.appliedBefore,
    followUpDue: req.query.followUpDue === 'true',
  };
  res.json({ data: listApplications(filters), stats: getCrmStats() });
});

router.post('/', (req, res) => {
  try {
    if (req.body?.jobId) {
      const app = createFromJob(req.body.jobId, req.body);
      if (!app) return res.status(404).json({ error: 'Job not found' });
      return res.status(201).json(app);
    }
    const app = createApplication(req.body);
    res.status(201).json(app);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const app = getApplicationById(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(app);
});

router.patch('/:id', (req, res) => {
  const app = updateApplication(req.params.id, req.body);
  if (!app) {
    const legacy = legacyUpdate(req.params.id, req.body);
    if (!legacy) return res.status(404).json({ error: 'Application not found' });
    return res.json(legacy);
  }
  res.json(app);
});

router.delete('/:id', (req, res) => {
  const ok = deleteApplication(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Application not found' });
  res.json({ success: true });
});

export default router;
