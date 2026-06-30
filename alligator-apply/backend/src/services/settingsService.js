import { getDb, now } from '../db/database.js';
import { seedFromMock } from '../services/jobScanService.js';
import { getWatsonxStatus } from '../services/watsonxAgentService.js';
import { getPlaywrightConfig } from '../services/playwrightService.js';
import { getProductCapabilities } from '../config/productCapabilities.js';

const DEFAULTS = {
  full_name: '',
  email: '',
  phone: '',
  preferred_locations: 'Remote (US)',
  visa_status: 'cpt',
  sponsorship_required: 'future',
  dark_mode: 'false',
};

export function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM user_settings').all();
  const settings = { ...DEFAULTS };
  for (const r of rows) settings[r.key] = r.value;

  return {
    profile: {
      fullName: settings.full_name,
      email: settings.email,
      phone: settings.phone,
    },
    preferences: {
      preferredLocations: settings.preferred_locations,
      visaStatus: settings.visa_status,
      sponsorshipRequired: settings.sponsorship_required,
      darkMode: settings.dark_mode === 'true',
    },
    integrations: {
      mockMode: process.env.MOCK_MODE !== 'false',
      autoSubmit: process.env.AUTO_SUBMIT === 'true',
      watsonx: getWatsonxStatus(),
      playwright: getPlaywrightConfig(),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      capabilities: getProductCapabilities(),
    },
  };
}

export function updateSettings(payload) {
  const db = getDb();
  const ts = now();
  const upsert = db.prepare(
    `INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const map = {
    fullName: 'full_name',
    email: 'email',
    phone: 'phone',
    preferredLocations: 'preferred_locations',
    visaStatus: 'visa_status',
    sponsorshipRequired: 'sponsorship_required',
    darkMode: 'dark_mode',
  };

  if (payload.profile) {
    for (const [k, v] of Object.entries(payload.profile)) {
      const key = map[k] || k;
      upsert.run(key, String(v ?? ''), ts);
    }
  }
  if (payload.preferences) {
    for (const [k, v] of Object.entries(payload.preferences)) {
      const key = map[k] || k;
      upsert.run(key, k === 'darkMode' ? (v ? 'true' : 'false') : String(v ?? ''), ts);
    }
  }
  return getSettings();
}

export function initDemoData() {
  if (process.env.MOCK_MODE === 'false') return 0;
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
  if (count > 0) return 0;
  const { count: seeded } = seedFromMock();
  return seeded;
}
