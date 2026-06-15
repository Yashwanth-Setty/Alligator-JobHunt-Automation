import { Router } from 'express';
import { getPipeline, getStats, PIPELINE_STATUSES, updateApplication } from '../services/applicationTracker.js';

const router = Router();

router.get('/stats', (_req, res) => {
  res.json(getStats());
});

router.get('/pipeline', (_req, res) => {
  res.json(getPipeline());
});

router.get('/statuses', (_req, res) => {
  res.json({ statuses: PIPELINE_STATUSES });
});

router.patch('/:jobId', (req, res) => {
  const updated = updateApplication(req.params.jobId, req.body);
  if (!updated) return res.status(404).json({ error: 'Job not found' });
  res.json(updated);
});

export default router;
