import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import resumeRoutes from './routes/resume.routes.js';
import jobsRoutes from './routes/jobs.routes.js';
import applicationsRoutes from './routes/applications.routes.js';
import autoApplyRoutes from './routes/autoApply.routes.js';
import sourcesRoutes from './routes/sources.routes.js';
import copilotRoutes from './routes/copilot.routes.js';
import registryRoutes from './routes/registry.routes.js';
import { getDb } from './db/database.js';
import { recoverInterruptedScans } from './services/scanMetrics.js';
import { getSettings, updateSettings } from './services/settingsService.js';
import { getProductCapabilities } from './config/productCapabilities.js';
import { backfillNormalizedLocations } from './services/locationQuery.js';

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

getDb();
recoverInterruptedScans();
const backfilled = backfillNormalizedLocations();
if (backfilled > 0) console.log(`Backfilled normalized_location for ${backfilled} jobs`);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'alligator-apply-api',
    autoSubmit: process.env.AUTO_SUBMIT === 'true',
    mockMode: process.env.MOCK_MODE !== 'false',
  });
});

app.get('/api/settings', (_req, res) => res.json(getSettings()));
app.get('/api/capabilities', (_req, res) => res.json(getProductCapabilities()));
app.put('/api/settings', (req, res) => res.json(updateSettings(req.body)));

app.use('/api/sources', sourcesRoutes);
app.use('/api/resume', resumeRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/auto-apply', autoApplyRoutes);
app.use('/api/copilot', copilotRoutes);
app.use('/api/registry', registryRoutes);

app.listen(PORT, () => {
  console.log(`Alligator Apply API running on http://localhost:${PORT}`);
});
