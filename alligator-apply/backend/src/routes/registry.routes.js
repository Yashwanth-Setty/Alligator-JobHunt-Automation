import { Router } from 'express';
import {
  createCompanyFromBody,
  createEntryFromBody,
  getCompaniesResponse,
  getEntriesResponse,
  getRegistryTagsResponse,
  getStatsSummaryResponse,
  patchRegistryEntry,
  toggleRegistryEntryById,
} from '../services/registryService.js';

const router = Router();

router.get('/companies', (req, res) => {
  try {
    res.json(getCompaniesResponse(req.query));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/companies', (req, res) => {
  try {
    res.status(201).json(createCompanyFromBody(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/entries', (req, res) => {
  try {
    res.json(getEntriesResponse(req.query));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/entries', (req, res) => {
  try {
    res.status(201).json(createEntryFromBody(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/entries/:id', (req, res) => {
  try {
    const entry = patchRegistryEntry(req.params.id, req.body || {});
    if (!entry) {
      res.status(404).json({ error: 'Registry entry not found' });
      return;
    }
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/entries/:id/toggle', (req, res) => {
  try {
    const entry = toggleRegistryEntryById(req.params.id, req.body || {});
    if (!entry) {
      res.status(404).json({ error: 'Registry entry not found' });
      return;
    }
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tags', (_req, res) => {
  res.json(getRegistryTagsResponse());
});

router.get('/stats/summary', (_req, res) => {
  res.json(getStatsSummaryResponse());
});

export default router;
