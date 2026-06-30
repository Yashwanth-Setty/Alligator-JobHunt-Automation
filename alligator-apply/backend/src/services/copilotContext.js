/**
 * Assemble context for Career Copilot requests.
 */

import { getDb } from '../db/database.js';
import { getActiveResume } from './resumeService.js';
import { listApplications } from './applicationCrmService.js';
import { getActiveScanRunId } from './scanMetrics.js';

function parseProfile(row) {
  if (!row?.parsed_profile) return {};
  try {
    return JSON.parse(row.parsed_profile);
  } catch {
    return {};
  }
}

function loadSettings() {
  const rows = getDb().prepare('SELECT key, value FROM user_settings').all();
  const s = {};
  for (const row of rows) s[row.key] = row.value;
  return {
    fullName: s.full_name || '',
    email: s.email || '',
    preferredLocations: s.preferred_locations || '',
    visaStatus: s.visa_status || '',
  };
}

function getRecentJobs(limit = 8) {
  const db = getDb();
  const scanRunId = getActiveScanRunId();
  let sql = `SELECT id, company, title, location, score, pipeline_status, visa_fit, source
             FROM jobs WHERE COALESCE(is_hidden, 0) = 0`;
  const params = { limit };
  if (scanRunId) {
    sql += ' AND scan_run_id = @scanRunId';
    params.scanRunId = scanRunId;
  }
  sql += ' ORDER BY score DESC, updated_at DESC LIMIT @limit';
  return db.prepare(sql).all(params);
}

async function getSelectedJob(jobId) {
  if (!jobId) return null;
  const { getJobById } = await import('./jobScanService.js');
  return getJobById(jobId);
}

export async function buildCopilotContext({ jobId } = {}) {
  const resumeRow = getActiveResume();
  const profile = parseProfile(resumeRow);
  const settings = loadSettings();
  const recentJobs = getRecentJobs();
  const applications = listApplications().slice(0, 10);
  const selectedJob = await getSelectedJob(jobId);

  return {
    candidate: {
      name: profile.name || settings.fullName || 'Candidate',
      email: profile.email || settings.email || '',
      location: profile.location || settings.preferredLocations || '',
      visaStatus: settings.visaStatus || 'unknown',
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      yearsOfExperience: profile.yearsOfExperience ?? null,
    },
    resume: {
      loaded: Boolean(resumeRow),
      parseStatus: resumeRow?.parse_status || 'none',
      fileName: resumeRow?.file_name || '',
      charCount: resumeRow?.extracted_text?.length || 0,
      excerpt: (resumeRow?.extracted_text || '').slice(0, 1200),
    },
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      company: j.company,
      title: j.title,
      location: j.location,
      score: j.score,
      status: j.pipeline_status,
      visaFit: j.visa_fit,
      source: j.source,
    })),
    applications: applications.map((a) => ({
      id: a.id,
      company: a.company,
      title: a.title,
      status: a.status || a.pipeline_status,
      appliedDate: a.appliedDate || a.date_applied,
      followUpDate: a.followUpDate || a.next_followup_date,
    })),
    selectedJob: selectedJob
      ? {
          id: selectedJob.id,
          company: selectedJob.company,
          title: selectedJob.title,
          location: selectedJob.location,
          score: selectedJob.score,
          description: (selectedJob.description || '').slice(0, 1500),
          visaFit: selectedJob.visa_fit,
          matchedSkills: selectedJob.required_skills || [],
          missingSkills: selectedJob.missing_skills || [],
          rejectionReasons: selectedJob.rejection_reasons || [],
          url: selectedJob.url || selectedJob.apply_url,
        }
      : null,
  };
}

export const COPILOT_ACTIONS = [
  'explain_match',
  'suggest_resume_changes',
  'prepare_interview',
  'generate_recruiter_message',
  'explain_rejection',
  'recommend_next_action',
];

export function isValidCopilotAction(action) {
  return COPILOT_ACTIONS.includes(action);
}
