import { v4 as uuidv4 } from 'uuid';
import { getDb, now } from '../db/database.js';

export const APPLICATION_STATUSES = [
  'found',
  'matched',
  'ready_to_apply',
  'applied',
  'waiting',
  'recruiter_screen',
  'hr_round',
  'technical_interview',
  'final_interview',
  'offer',
  'hired',
  'rejected',
  'skipped',
];

export const KANBAN_COLUMNS = [
  {
    id: 'ready',
    label: 'Ready',
    statuses: ['found', 'matched', 'ready_to_apply'],
    defaultStatus: 'ready_to_apply',
  },
  {
    id: 'applied',
    label: 'Applied',
    statuses: ['applied', 'auto_applied', 'waiting'],
    defaultStatus: 'applied',
  },
  {
    id: 'interview',
    label: 'Interview',
    statuses: ['recruiter_screen', 'hr_round', 'technical_interview', 'final_interview'],
    defaultStatus: 'recruiter_screen',
  },
  {
    id: 'offer',
    label: 'Offer',
    statuses: ['offer', 'hired'],
    defaultStatus: 'offer',
  },
  {
    id: 'rejected',
    label: 'Rejected',
    statuses: ['rejected', 'failed', 'skipped'],
    defaultStatus: 'rejected',
  },
];

export function kanbanColumnForStatus(status) {
  const col = KANBAN_COLUMNS.find((c) => c.statuses.includes(status));
  return col?.id || 'ready';
}

export function statusForKanbanColumn(columnId, currentStatus) {
  const col = KANBAN_COLUMNS.find((c) => c.id === columnId);
  if (!col) return currentStatus;
  if (col.statuses.includes(currentStatus)) return currentStatus;
  return col.defaultStatus;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    company: row.company || row.job_company || '',
    title: row.title || row.job_title || '',
    source: row.source || row.job_source || '',
    status: row.pipeline_status,
    appliedDate: row.date_applied || null,
    recruiterName: row.recruiter_name || '',
    recruiterEmail: row.recruiter_email || '',
    notes: row.notes || '',
    followUpDate: row.next_followup_date || null,
    interviewStage: row.interview_stage || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    location: row.job_location || '',
    score: row.job_score ?? null,
    applyUrl: row.job_url || '',
  };
}

const SELECT_JOIN = `
  SELECT a.*,
    j.company AS job_company,
    j.title AS job_title,
    j.source AS job_source,
    j.location AS job_location,
    j.score AS job_score,
    j.url AS job_url
  FROM applications a
  LEFT JOIN jobs j ON j.id = a.job_id
`;

export function listApplications(filters = {}) {
  const db = getDb();
  const where = ['1=1'];
  const params = {};

  if (filters.status) {
    where.push('a.pipeline_status = @status');
    params.status = filters.status;
  }
  if (filters.company) {
    where.push('(LOWER(a.company) LIKE @company OR LOWER(j.company) LIKE @company)');
    params.company = `%${filters.company.toLowerCase()}%`;
  }
  if (filters.source) {
    where.push('(a.source = @source OR j.source = @source)');
    params.source = filters.source;
  }
  if (filters.appliedAfter) {
    where.push('a.date_applied >= @appliedAfter');
    params.appliedAfter = filters.appliedAfter;
  }
  if (filters.appliedBefore) {
    where.push('a.date_applied <= @appliedBefore');
    params.appliedBefore = filters.appliedBefore;
  }
  if (filters.followUpDue) {
    where.push('a.next_followup_date IS NOT NULL AND a.next_followup_date <= @today');
    params.today = now().slice(0, 10);
  }

  const sql = `${SELECT_JOIN} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC`;
  return db.prepare(sql).all(params).map(normalizeRow);
}

export function getApplicationById(id) {
  const row = getDb()
    .prepare(`${SELECT_JOIN} WHERE a.id = ?`)
    .get(id);
  return normalizeRow(row);
}

export function createFromJob(jobId, overrides = {}) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const existing = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId);
  if (existing) {
    return updateApplication(existing.id, {
      status: overrides.status || 'ready_to_apply',
      notes: overrides.notes,
      appliedDate: overrides.appliedDate,
      followUpDate: overrides.followUpDate,
      recruiterName: overrides.recruiterName,
      recruiterEmail: overrides.recruiterEmail,
    });
  }

  const ts = now();
  const id = uuidv4();
  const status = overrides.status || 'ready_to_apply';

  db.prepare(
    `INSERT INTO applications (
      id, job_id, pipeline_status, company, title, source,
      notes, date_applied, next_followup_date, recruiter_name, recruiter_email,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    jobId,
    status,
    job.company,
    job.title,
    job.source,
    overrides.notes || '',
    overrides.appliedDate || null,
    overrides.followUpDate || null,
    overrides.recruiterName || '',
    overrides.recruiterEmail || '',
    ts,
    ts
  );

  syncJobStatus(jobId, status, ts);
  recordHistory(id, jobId, job.pipeline_status, status, 'Tracked from job hunt');

  return getApplicationById(id);
}

export function createApplication(payload) {
  const db = getDb();
  const ts = now();
  const id = payload.id || uuidv4();
  const jobId = payload.jobId || payload.job_id || null;

  if (jobId) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error('Job not found');
    return createFromJob(jobId, payload);
  }

  db.prepare(
    `INSERT INTO applications (
      id, job_id, pipeline_status, company, title, source,
      notes, date_applied, next_followup_date, recruiter_name, recruiter_email,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    `manual_${id}`,
    payload.status || 'ready_to_apply',
    payload.company || '',
    payload.title || '',
    payload.source || '',
    payload.notes || '',
    payload.appliedDate || null,
    payload.followUpDate || null,
    payload.recruiterName || '',
    payload.recruiterEmail || '',
    ts,
    ts
  );

  return getApplicationById(id);
}

export function updateApplication(id, payload) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!current) return null;

  const ts = now();
  const fields = {};
  if (payload.status !== undefined) fields.pipeline_status = payload.status;
  if (payload.pipeline_status !== undefined) fields.pipeline_status = payload.pipeline_status;
  if (payload.notes !== undefined) fields.notes = payload.notes;
  if (payload.appliedDate !== undefined) fields.date_applied = payload.appliedDate;
  if (payload.date_applied !== undefined) fields.date_applied = payload.date_applied;
  if (payload.followUpDate !== undefined) fields.next_followup_date = payload.followUpDate;
  if (payload.next_followup_date !== undefined) fields.next_followup_date = payload.next_followup_date;
  if (payload.recruiterName !== undefined) fields.recruiter_name = payload.recruiterName;
  if (payload.recruiterEmail !== undefined) fields.recruiter_email = payload.recruiterEmail;
  if (payload.company !== undefined) fields.company = payload.company;
  if (payload.title !== undefined) fields.title = payload.title;
  if (payload.source !== undefined) fields.source = payload.source;
  if (payload.interviewStage !== undefined) fields.interview_stage = payload.interviewStage;

  if (Object.keys(fields).length) {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE applications SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
      ...fields,
      updated_at: ts,
      id,
    });
  }

  const newStatus = fields.pipeline_status || current.pipeline_status;
  if (fields.pipeline_status && current.job_id && !current.job_id.startsWith('manual_')) {
    syncJobStatus(current.job_id, newStatus, ts);
    recordHistory(id, current.job_id, current.pipeline_status, newStatus, payload.note || '');
  }

  return getApplicationById(id);
}

export function deleteApplication(id) {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!app) return false;
  db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  if (app.job_id && !app.job_id.startsWith('manual_')) {
    db.prepare("UPDATE jobs SET pipeline_status = 'found', updated_at = ? WHERE id = ?").run(now(), app.job_id);
  }
  return true;
}

function syncJobStatus(jobId, status, ts) {
  getDb()
    .prepare('UPDATE jobs SET pipeline_status = ?, updated_at = ? WHERE id = ?')
    .run(status, ts, jobId);
  getDb()
    .prepare('UPDATE applications SET pipeline_status = ?, updated_at = ? WHERE job_id = ?')
    .run(status, ts, jobId);
}

function recordHistory(appId, jobId, fromStatus, toStatus, note) {
  getDb()
    .prepare(
      `INSERT INTO application_status_history (application_id, job_id, from_status, to_status, note, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(appId, jobId, fromStatus, toStatus, note || '', now());
}

export function getCrmStats() {
  const apps = listApplications();
  const total = apps.length;
  if (total === 0) {
    return {
      total: 0,
      interviewRate: 0,
      offerRate: 0,
      rejectionRate: 0,
      byStatus: {},
      followUpDue: 0,
    };
  }

  const interviewStatuses = new Set([
    'recruiter_screen',
    'hr_round',
    'technical_interview',
    'final_interview',
    'offer',
    'hired',
  ]);
  const appliedStatuses = new Set(['applied', 'auto_applied', 'waiting', ...interviewStatuses]);
  const offerStatuses = new Set(['offer', 'hired']);
  const rejectedStatuses = new Set(['rejected', 'failed', 'skipped']);

  let interviewed = 0;
  let applied = 0;
  let offers = 0;
  let rejected = 0;
  const byStatus = {};

  const today = now().slice(0, 10);
  let followUpDue = 0;

  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] || 0) + 1;
    if (appliedStatuses.has(app.status)) applied += 1;
    if (interviewStatuses.has(app.status)) interviewed += 1;
    if (offerStatuses.has(app.status)) offers += 1;
    if (rejectedStatuses.has(app.status)) rejected += 1;
    if (app.followUpDate && app.followUpDate <= today) followUpDue += 1;
  }

  return {
    total,
    applied,
    interviewed,
    offers,
    rejected,
    interviewRate: applied > 0 ? Math.round((interviewed / applied) * 100) : 0,
    offerRate: total > 0 ? Math.round((offers / total) * 100) : 0,
    rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
    byStatus,
    followUpDue,
  };
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportApplicationsCsv(filters = {}) {
  const apps = listApplications(filters);
  const headers = [
    'id',
    'jobId',
    'company',
    'title',
    'source',
    'status',
    'appliedDate',
    'recruiterName',
    'recruiterEmail',
    'notes',
    'followUpDate',
    'updatedAt',
  ];
  const rows = apps.map((a) =>
    [
      a.id,
      a.jobId,
      a.company,
      a.title,
      a.source,
      a.status,
      a.appliedDate,
      a.recruiterName,
      a.recruiterEmail,
      a.notes,
      a.followUpDate,
      a.updatedAt,
    ]
      .map(escapeCsv)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function importApplicationsCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return { imported: 0, errors: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  let imported = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    try {
      const values = parseCsvLine(lines[i]);
      const row = Object.fromEntries(headers.map((h, idx) => [h, values[idx] || '']));
      if (row.jobId && !row.jobId.startsWith('manual_')) {
        createFromJob(row.jobId, {
          status: row.status,
          notes: row.notes,
          appliedDate: row.appliedDate || null,
          followUpDate: row.followUpDate || null,
          recruiterName: row.recruiterName,
          recruiterEmail: row.recruiterEmail,
        });
      } else if (row.id) {
        const existing = getApplicationById(row.id);
        if (existing) {
          updateApplication(row.id, row);
        } else {
          createApplication(row);
        }
      } else {
        createApplication(row);
      }
      imported += 1;
    } catch (err) {
      errors.push({ line: i + 1, error: err.message });
    }
  }

  return { imported, errors };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
