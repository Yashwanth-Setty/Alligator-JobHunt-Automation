import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getDb, now } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = path.join(__dirname, '../../data/mock_jobs.json');

let scanState = {
  id: null,
  status: 'idle',
  progress: 0,
  message: 'Ready',
  currentSource: null,
  jobsFound: 0,
  jobsMatched: 0,
  eligibleCount: 0,
  failedSources: [],
  logs: [],
  startedAt: null,
  finishedAt: null,
};

let scanTimer = null;
let scanAborted = false;

function pushLog(message) {
  const entry = { time: now(), message };
  scanState.logs = [...(scanState.logs || []), entry].slice(-50);
}

export function getScanStatus() {
  if (scanState.status === 'running' || scanState.status === 'cancelled') {
    return { ...scanState };
  }
  const dbRow = getDb()
    .prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1')
    .get();
  if (dbRow) {
    return {
      id: dbRow.id,
      status: dbRow.status,
      progress: dbRow.progress,
      message: dbRow.message,
      currentSource: scanState.currentSource,
      jobsFound: dbRow.jobs_found,
      jobsMatched: scanState.jobsMatched,
      eligibleCount: scanState.eligibleCount,
      failedSources: scanState.failedSources,
      logs: scanState.logs,
      startedAt: dbRow.started_at,
      finishedAt: dbRow.finished_at,
    };
  }
  return { ...scanState };
}

export function isScanRunning() {
  return scanState.status === 'running';
}

export function stopScanJob() {
  if (scanState.status !== 'running') {
    return { stopped: false, message: 'No scan running' };
  }
  scanAborted = true;
  if (scanTimer) clearTimeout(scanTimer);
  scanState.status = 'cancelled';
  scanState.message = 'Scan stopped by user';
  scanState.finishedAt = now();
  pushLog('Scan cancelled by user');
  getDb()
    .prepare(
      `UPDATE scan_runs SET status = 'cancelled', message = ?, finished_at = ? WHERE id = ?`
    )
    .run(scanState.message, scanState.finishedAt, scanState.id);
  return { stopped: true, status: getScanStatus() };
}

export function startScanJob(filters = {}, onProgress) {
  if (scanState.status === 'running') {
    return { started: false, message: 'Scan already in progress' };
  }

  scanAborted = false;
  const scanId = uuidv4();
  scanState = {
    id: scanId,
    status: 'running',
    progress: 0,
    message: 'Starting job hunt…',
    currentSource: null,
    jobsFound: 0,
    jobsMatched: 0,
    eligibleCount: 0,
    failedSources: [],
    logs: [],
    startedAt: now(),
    finishedAt: null,
  };
  pushLog('Job hunt started');

  const db = getDb();
  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at)
     VALUES (?, 'running', 0, ?, 0, ?)`
  ).run(scanId, scanState.message, scanState.startedAt);

  setImmediate(() => runMockScan(scanId, filters, onProgress));
  return { started: true, scanId };
}

function runMockScan(scanId, filters, onProgress) {
  const steps = [
    { progress: 12, source: 'greenhouse', message: 'Scanning Greenhouse…' },
    { progress: 28, source: 'lever', message: 'Scanning Lever…' },
    { progress: 44, source: 'ashby', message: 'Scanning Ashby…' },
    { progress: 58, source: 'workday', message: 'Scanning Workday…', mayFail: true },
    { progress: 72, source: 'smartrecruiters', message: 'Scanning SmartRecruiters…' },
    { progress: 86, source: 'scoring', message: 'Scoring jobs against resume…' },
    { progress: 95, source: 'dedupe', message: 'Deduplicating and saving…' },
  ];

  let i = 0;
  const tick = () => {
    if (scanAborted) return;

    if (i < steps.length) {
      const step = steps[i++];
      scanState.progress = step.progress;
      scanState.currentSource = step.source;
      scanState.message = step.message;
      pushLog(step.message);

      if (step.mayFail && Math.random() < 0.35) {
        scanState.failedSources = [...scanState.failedSources, 'workday'];
        pushLog('Workday: rate limited — will retry next hunt');
      }

      getDb()
        .prepare('UPDATE scan_runs SET progress = ?, message = ? WHERE id = ?')
        .run(step.progress, step.message, scanId);
      onProgress?.(scanState);
      scanTimer = setTimeout(tick, 700);
      return;
    }

    const { count, matched, eligible } = seedFromMock(filters);
    scanState.progress = 100;
    scanState.status = 'completed';
    scanState.jobsFound = count;
    scanState.jobsMatched = matched;
    scanState.eligibleCount = eligible;
    scanState.message = `Hunt complete — ${count} jobs found, ${eligible} eligible for auto-apply`;
    scanState.finishedAt = now();
    scanState.currentSource = null;
    pushLog(scanState.message);

    getDb()
      .prepare(
        `UPDATE scan_runs SET status = 'completed', progress = 100, message = ?, jobs_found = ?, finished_at = ? WHERE id = ?`
      )
      .run(scanState.message, count, scanState.finishedAt, scanId);
    onProgress?.(scanState);
  };
  tick();
}

function jobMatchesFilters(job, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  const kw = (filters.keywords || '').toLowerCase();
  if (kw && !job.title.toLowerCase().includes(kw) && !job.company.toLowerCase().includes(kw)) return false;
  if (filters.location && !(job.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.company && !job.company.toLowerCase().includes(filters.company.toLowerCase())) return false;
  if (filters.source && job.source !== filters.source) return false;
  if (filters.remoteType && job.remote_type !== filters.remoteType) return false;
  if (filters.visaFit && job.visa_fit !== filters.visaFit) return false;
  if (filters.employmentType && job.employment_type !== filters.employmentType) return false;
  if (filters.experienceLevel && job.experience_level !== filters.experienceLevel) return false;
  if (filters.minScore && job.score < Number(filters.minScore)) return false;
  if (filters.salaryMin && (job.salary_max || 0) < Number(filters.salaryMin)) return false;
  if (filters.salaryMax && (job.salary_min || 999999) > Number(filters.salaryMax)) return false;
  return true;
}

export function seedFromMock(filters = {}) {
  const raw = fs.readFileSync(MOCK_PATH, 'utf8');
  const allJobs = JSON.parse(raw);
  const jobs = allJobs.filter((j) => jobMatchesFilters(j, filters));
  const db = getDb();
  const insertJob = db.prepare(
    `INSERT INTO jobs (id, company, title, url, source, score, location, remote_type,
      employment_type, experience_level, visa_fit, auto_apply_eligible, pipeline_status,
      salary_min, salary_max, date_posted, created_at, updated_at)
     VALUES (@id, @company, @title, @url, @source, @score, @location, @remote_type,
      @employment_type, @experience_level, @visa_fit, @auto_apply_eligible, @pipeline_status,
      @salary_min, @salary_max, @date_posted, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
      score = excluded.score,
      pipeline_status = excluded.pipeline_status,
      updated_at = excluded.updated_at`
  );
  const insertApp = db.prepare(
    `INSERT INTO applications (id, job_id, pipeline_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO NOTHING`
  );

  const ts = now();
  let matched = 0;
  let eligible = 0;
  const tx = db.transaction((items) => {
    for (const j of items) {
      const status = j.score >= 50 ? 'matched' : 'found';
      if (j.score >= 50) matched += 1;
      if (j.auto_apply_eligible && j.score >= 65) eligible += 1;
      insertJob.run({
        id: j.id,
        company: j.company,
        title: j.title,
        url: j.url,
        source: j.source,
        score: j.score,
        location: j.location,
        remote_type: j.remote_type,
        employment_type: j.employment_type,
        experience_level: j.experience_level,
        visa_fit: j.visa_fit,
        auto_apply_eligible: j.auto_apply_eligible ? 1 : 0,
        pipeline_status: j.pipeline_status || status,
        salary_min: j.salary_min || null,
        salary_max: j.salary_max || null,
        date_posted: j.date_posted || null,
        created_at: ts,
        updated_at: ts,
      });
      insertApp.run(`app_${j.id}`, j.id, j.pipeline_status || status, ts, ts);
    }
  });
  tx(jobs);
  return { count: jobs.length, matched, eligible };
}

export function listJobs({ page = 1, limit = 10, filters = {} }) {
  const db = getDb();
  const where = ['1=1'];
  const params = {};

  if (filters.keywords) {
    where.push('(LOWER(title) LIKE @kw OR LOWER(company) LIKE @kw)');
    params.kw = `%${filters.keywords.toLowerCase()}%`;
  }
  if (filters.location) {
    where.push('LOWER(location) LIKE @loc');
    params.loc = `%${filters.location.toLowerCase()}%`;
  }
  if (filters.company) {
    where.push('LOWER(company) LIKE @co');
    params.co = `%${filters.company.toLowerCase()}%`;
  }
  if (filters.source) {
    where.push('source = @source');
    params.source = filters.source;
  }
  if (filters.minScore) {
    where.push('score >= @minScore');
    params.minScore = Number(filters.minScore);
  }
  if (filters.remoteType) {
    where.push('remote_type = @remoteType');
    params.remoteType = filters.remoteType;
  }
  if (filters.visaFit) {
    where.push('visa_fit = @visaFit');
    params.visaFit = filters.visaFit;
  }
  if (filters.employmentType) {
    where.push('employment_type = @employmentType');
    params.employmentType = filters.employmentType;
  }
  if (filters.experienceLevel) {
    where.push('experience_level = @experienceLevel');
    params.experienceLevel = filters.experienceLevel;
  }
  if (filters.datePostedDays) {
    where.push("date_posted >= date('now', @dateOffset)");
    params.dateOffset = `-${Number(filters.datePostedDays)} days`;
  }
  if (filters.salaryMin) {
    where.push('(salary_max IS NULL OR salary_max >= @salaryMin)');
    params.salaryMin = Number(filters.salaryMin);
  }
  if (filters.salaryMax) {
    where.push('(salary_min IS NULL OR salary_min <= @salaryMax)');
    params.salaryMax = Number(filters.salaryMax);
  }
  if (filters.pipelineStatus) {
    where.push('pipeline_status = @pipelineStatus');
    params.pipelineStatus = filters.pipelineStatus;
  }
  if (filters.autoApplyEligible === 'true') {
    where.push('auto_apply_eligible = 1');
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${whereSql}`).get(params).c;
  const offset = (page - 1) * limit;
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE ${whereSql} ORDER BY score DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return {
    data: rows.map(normalizeJob),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export function getJobById(id) {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? normalizeJob(row) : null;
}

function normalizeJob(row) {
  return {
    ...row,
    auto_apply_eligible: Boolean(row.auto_apply_eligible),
    match_score: row.score,
    apply_url: row.url,
    role: row.title,
  };
}

export function countEligibleJobs() {
  return getDb()
    .prepare('SELECT COUNT(*) AS c FROM jobs WHERE auto_apply_eligible = 1 AND score >= 65')
    .get().c;
}

export function getHuntKpis() {
  const db = getDb();
  const manualOpen = db.prepare("SELECT COUNT(*) AS c FROM manual_review_items WHERE status = 'open'").get().c;
  return {
    jobsFound: db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c,
    matched: db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE score >= 50').get().c,
    eligible: countEligibleJobs(),
    applied: db.prepare(
      "SELECT COUNT(*) AS c FROM jobs WHERE pipeline_status IN ('applied', 'auto_applied')"
    ).get().c,
    manualPending:
      db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE pipeline_status = 'manual_pending'").get().c + manualOpen,
  };
}

export function generatePacket(jobId) {
  const job = getJobById(jobId);
  if (!job) return null;
  const ts = now();
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'ready_to_apply', updated_at = ? WHERE id = ?")
    .run(ts, jobId);
  return {
    success: true,
    jobId,
    path: `outputs/application_packets/${job.company}_${job.title}.md`,
    message: 'Application packet generated (mock)',
  };
}

export function moveJobToManual(jobId, reason = 'unknown_field', details = '') {
  const job = getJobById(jobId);
  if (!job) return null;
  const ts = now();
  getDb()
    .prepare(
      'INSERT INTO manual_review_items (job_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(jobId, reason, details, 'open', ts);
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'manual_pending', updated_at = ? WHERE id = ?")
    .run(ts, jobId);
  return { success: true, jobId, reason };
}

export function skipJob(jobId) {
  const ts = now();
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'skipped', updated_at = ? WHERE id = ?")
    .run(ts, jobId);
  return { success: true, jobId };
}
