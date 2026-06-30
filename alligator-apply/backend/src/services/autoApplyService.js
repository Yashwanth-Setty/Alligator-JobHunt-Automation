import { getDb, now } from '../db/database.js';
import { getJobById, isMockMode } from '../services/jobScanService.js';
import { launchApplySession } from '../services/playwrightService.js';
import { reasonAboutJob } from '../services/watsonxAgentService.js';

const PAUSE_FIELDS = ['visa', 'eeo', 'salary', 'captcha', 'final_submit'];

let autoApplyState = { status: 'idle', progress: 0, message: 'Ready', processed: 0, total: 0 };

export function getAutoApplyStatus() {
  return { ...autoApplyState };
}

export function listManualReview() {
  return getDb()
    .prepare(
      `SELECT m.*, j.title, j.company, j.url, j.score
       FROM manual_review_items m
       JOIN jobs j ON j.id = m.job_id
       WHERE m.status = 'open'
       ORDER BY m.created_at DESC`
    )
    .all();
}

export async function mockAutoApplyJob(jobId) {
  if (isMockMode()) {
    return {
      success: false,
      jobId,
      message: 'Auto apply disabled in mock mode.',
      reason: 'mock_mode',
    };
  }

  const job = getJobById(jobId);
  if (!job) return { success: false, message: 'Job not found' };

  if (job.data_source === 'mock' || String(jobId).startsWith('mock-')) {
    return { success: false, jobId, message: 'Cannot auto-apply to mock jobs.' };
  }

  if (!job.auto_apply_eligible || job.score < 65) {
    const reason = job.score < 65 ? 'Match score below 65' : 'Not eligible for auto-apply';
    addManualReview(jobId, 'auto_apply_failed', reason);
    recordAttempt(jobId, 'failed', reason);
    return { success: false, jobId, status: 'manual_pending', reason, message: reason };
  }

  if ((job.url || '').toLowerCase().includes('workday')) {
    const reason = 'Complex Workday form — manual review required';
    addManualReview(jobId, 'complex_workday_form', reason);
    recordAttempt(jobId, 'paused', reason);
    updateJobStatus(jobId, 'manual_pending');
    return { success: false, jobId, status: 'manual_pending', reason, pausedAt: PAUSE_FIELDS };
  }

  await reasonAboutJob(job);
  const session = await launchApplySession(job);
  recordAttempt(jobId, 'paused', 'Paused before sensitive fields', JSON.stringify(session.fieldsFilled));
  updateJobStatus(jobId, 'auto_applied');
  return {
    success: true,
    jobId,
    status: 'auto_applied',
    pausedAt: PAUSE_FIELDS,
    fieldsFilled: session.fieldsFilled,
    message: 'Mock auto-apply complete. Paused at visa/EEO/salary/CAPTCHA — never auto-submits.',
  };
}

export function startBatchAutoApply(onProgress) {
  if (isMockMode()) {
    return { started: false, message: 'Auto apply disabled in mock mode.' };
  }

  if (autoApplyState.status === 'running') {
    return { started: false, message: 'Auto-apply already running' };
  }

  const eligible = getDb()
    .prepare('SELECT id FROM jobs WHERE auto_apply_eligible = 1 AND score >= 65')
    .all();

  autoApplyState = {
    status: 'running',
    progress: 0,
    message: 'Starting batch auto-apply…',
    processed: 0,
    total: eligible.length,
  };

  setImmediate(async () => {
    for (let i = 0; i < eligible.length; i++) {
      const result = await mockAutoApplyJob(eligible[i].id);
      autoApplyState.processed = i + 1;
      autoApplyState.progress = Math.round(((i + 1) / eligible.length) * 100);
      autoApplyState.message = result.message || `Processed ${i + 1}/${eligible.length}`;
      onProgress?.(autoApplyState);
      await new Promise((r) => setTimeout(r, 400));
    }
    autoApplyState.status = 'completed';
    autoApplyState.message = `Batch complete — ${eligible.length} jobs processed`;
    onProgress?.(autoApplyState);
  });

  return { started: true, total: eligible.length };
}

export function resolveManualReview(id, action, jobId) {
  const db = getDb();
  db.prepare('UPDATE manual_review_items SET status = ?, resolved_at = ? WHERE id = ?').run(
    action,
    now(),
    id
  );
  if (action === 'applied') updateJobStatus(jobId, 'applied');
  if (action === 'skipped') updateJobStatus(jobId, 'skipped');
}

function addManualReview(jobId, reason, details) {
  getDb()
    .prepare(
      'INSERT INTO manual_review_items (job_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(jobId, reason, details, 'open', now());
}

function recordAttempt(jobId, status, reason, fieldsFilled = '') {
  getDb()
    .prepare(
      'INSERT INTO auto_apply_attempts (job_id, status, reason, fields_filled, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(jobId, status, reason, fieldsFilled, now());
}

function updateJobStatus(jobId, status) {
  const ts = now();
  getDb().prepare('UPDATE jobs SET pipeline_status = ?, updated_at = ? WHERE id = ?').run(status, ts, jobId);
  getDb().prepare('UPDATE applications SET pipeline_status = ?, updated_at = ? WHERE job_id = ?').run(status, ts, jobId);
}
