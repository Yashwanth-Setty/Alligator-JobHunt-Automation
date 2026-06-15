import { getDb, now } from '../db/database.js';

const PIPELINE_STATUSES = [
  'found', 'matched', 'ready_to_apply', 'auto_applied', 'manual_pending',
  'applied', 'waiting', 'recruiter_screen', 'hr_round', 'technical_interview',
  'final_interview', 'offer', 'hired', 'rejected', 'failed', 'skipped',
];

export function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
  const byStatus = db
    .prepare('SELECT pipeline_status, COUNT(*) AS c FROM jobs GROUP BY pipeline_status')
    .all();
  const statusMap = Object.fromEntries(byStatus.map((r) => [r.pipeline_status, r.c]));

  const count = (...keys) => keys.reduce((s, k) => s + (statusMap[k] || 0), 0);

  return {
    total_found: total,
    jobs_matched: count('matched', 'ready_to_apply', 'auto_applied', 'applied', 'waiting'),
    auto_applied: count('auto_applied'),
    manual_pending: count('manual_pending') + db.prepare("SELECT COUNT(*) AS c FROM manual_review_items WHERE status = 'open'").get().c,
    applications_submitted: count('applied', 'auto_applied'),
    waiting: count('waiting'),
    recruiter_screen: count('recruiter_screen'),
    hr_round: count('hr_round'),
    technical_interview: count('technical_interview'),
    final_interview: count('final_interview'),
    offer: count('offer'),
    hired: count('hired'),
    rejected: count('rejected'),
    failed: count('failed'),
    skipped: count('skipped'),
    by_status: statusMap,
    by_source: Object.fromEntries(
      db.prepare('SELECT source, COUNT(*) AS c FROM jobs GROUP BY source').all().map((r) => [r.source, r.c])
    ),
    by_location: Object.fromEntries(
      db.prepare('SELECT location, COUNT(*) AS c FROM jobs GROUP BY location').all().map((r) => [r.location, r.c])
    ),
    score_distribution: {
      '0-49': db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE score < 50').get().c,
      '50-64': db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE score >= 50 AND score < 65').get().c,
      '65-74': db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE score >= 65 AND score < 75').get().c,
      '75-100': db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE score >= 75').get().c,
    },
  };
}

export function getPipeline() {
  return getDb()
    .prepare(
      `SELECT j.*, a.notes AS app_notes, a.date_applied, a.next_followup_date, a.interview_stage
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       ORDER BY j.score DESC`
    )
    .all()
    .map((r) => ({
      ...r,
      auto_apply_eligible: Boolean(r.auto_apply_eligible),
    }));
}

export function updateApplication(jobId, payload) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const ts = now();
  if (payload.pipeline_status) {
    db.prepare('UPDATE jobs SET pipeline_status = ?, updated_at = ? WHERE id = ?').run(
      payload.pipeline_status,
      ts,
      jobId
    );
    const app = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
    const appId = app?.id || `app_${jobId}`;
    if (!app) {
      db.prepare(
        'INSERT INTO applications (id, job_id, pipeline_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(appId, jobId, payload.pipeline_status, ts, ts);
    } else {
      db.prepare('UPDATE applications SET pipeline_status = ?, updated_at = ? WHERE job_id = ?').run(
        payload.pipeline_status,
        ts,
        jobId
      );
    }
    db.prepare(
      `INSERT INTO application_status_history (application_id, job_id, from_status, to_status, note, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(appId, jobId, job.pipeline_status, payload.pipeline_status, payload.notes || '', ts);
  }

  const appFields = {};
  if (payload.notes !== undefined) appFields.notes = payload.notes;
  if (payload.date_applied !== undefined) appFields.date_applied = payload.date_applied;
  if (payload.next_followup_date !== undefined) appFields.next_followup_date = payload.next_followup_date;
  if (payload.interview_stage !== undefined) appFields.interview_stage = payload.interview_stage;

  if (Object.keys(appFields).length) {
    const sets = Object.keys(appFields).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE applications SET ${sets}, updated_at = @updated_at WHERE job_id = @job_id`).run({
      ...appFields,
      updated_at: ts,
      job_id: jobId,
    });
  }

  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
}

export { PIPELINE_STATUSES };
