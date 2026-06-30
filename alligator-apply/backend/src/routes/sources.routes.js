import { Router } from 'express';
import {
  addSourceTarget,
  getSourcesConfig,
  removeSourceTarget,
  setSourceTargets,
  updateSourceEnabled,
  updateSourcesEnabled,
} from '../services/sourcesService.js';
import { getScanStatus } from '../services/jobScanService.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getSourcesConfig(getScanStatus()));
});

router.patch('/:name/enabled', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  res.json(updateSourceEnabled(req.params.name, enabled));
});

router.put('/enabled', (req, res) => {
  const updates = req.body?.sources || [];
  res.json(updateSourcesEnabled(updates));
});

router.post('/:source/targets', (req, res) => {
  try {
    const slug = req.body?.slug || req.body?.target;
    res.json(addSourceTarget(req.params.source, slug));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:source/targets', (req, res) => {
  const slugs = req.body?.targets || req.body?.slugs || [];
  res.json(setSourceTargets(req.params.source, slugs));
});

router.delete('/targets/:id', (req, res) => {
  res.json(removeSourceTarget(Number(req.params.id)));
});

export default router;
