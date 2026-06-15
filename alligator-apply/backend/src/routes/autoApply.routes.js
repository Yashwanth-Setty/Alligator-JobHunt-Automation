import { Router } from 'express';
import {
  getAutoApplyStatus,
  listManualReview,
  mockAutoApplyJob,
  resolveManualReview,
  startBatchAutoApply,
} from '../services/autoApplyService.js';
import { getPlaywrightConfig } from '../services/playwrightService.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getAutoApplyStatus());
});

router.get('/manual-review', (_req, res) => {
  res.json(listManualReview());
});

router.get('/config', (_req, res) => {
  res.json(getPlaywrightConfig());
});

router.post('/batch', (_req, res) => {
  const state = getAutoApplyStatus();
  if (state.status === 'running') {
    return res.status(409).json({ error: 'Auto-apply already running', status: state });
  }
  const result = startBatchAutoApply();
  res.json({ ...result, status: getAutoApplyStatus() });
});

router.post('/manual-review/:id/resolve', (req, res) => {
  const { action, jobId } = req.body;
  resolveManualReview(parseInt(req.params.id, 10), action, jobId);
  res.json({ success: true });
});

router.post('/:jobId', async (req, res) => {
  const result = await mockAutoApplyJob(req.params.jobId);
  res.json(result);
});

export default router;
