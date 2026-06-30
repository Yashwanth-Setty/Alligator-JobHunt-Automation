import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, now } from '../db/database.js';
import { parseResumeBuffer } from './resumeParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = process.env.RESUMES_DIR || path.join(__dirname, '../../uploads/resumes');
const ALLOWED = new Set(['.pdf', '.docx']);

export function ensureResumesDir() {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
}

function parseProfileJson(row) {
  if (!row?.parsed_profile) return {};
  try {
    return JSON.parse(row.parsed_profile);
  } catch {
    return {};
  }
}

export function formatResumeResponse(row) {
  if (!row) {
    return { loaded: false, message: 'No resume uploaded' };
  }

  const profile = parseProfileJson(row);
  const parseStatus = row.parse_status || 'pending';

  return {
    loaded: true,
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at,
    parsing: {
      status: parseStatus,
      error: row.parse_error || '',
      parsedAt: row.parsed_at || null,
      charCount: row.extracted_text ? row.extracted_text.length : 0,
      pagesParsed: profile._pagesParsed ?? null,
      skillsCount: Array.isArray(profile.skills) ? profile.skills.length : 0,
    },
    profile: {
      name: profile.name || '',
      email: profile.email || '',
      phone: profile.phone || '',
      location: profile.location || '',
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      yearsOfExperience: profile.yearsOfExperience ?? null,
    },
  };
}

export function getActiveResume() {
  const row = getDb()
    .prepare('SELECT * FROM resume_profiles WHERE is_active = 1 ORDER BY uploaded_at DESC LIMIT 1')
    .get();
  return row || null;
}

export function getResumeText(maxChars = 5000) {
  const row = getActiveResume();
  if (!row?.extracted_text || row.parse_status !== 'success') return '';
  return row.extracted_text.slice(0, maxChars);
}

async function persistParseResult(resumeId, parsed) {
  const db = getDb();
  const profilePayload = {
    ...parsed.profile,
    _pagesParsed: parsed.pagesParsed,
  };
  const ts = now();

  db.prepare(
    `UPDATE resume_profiles SET
      extracted_text = ?,
      parsed_profile = ?,
      parse_status = ?,
      parse_error = ?,
      parsed_at = ?
     WHERE id = ?`
  ).run(
    parsed.extractedText || '',
    JSON.stringify(profilePayload),
    parsed.ok ? 'success' : 'failed',
    parsed.error || '',
    ts,
    resumeId
  );
}

export async function saveResume(file) {
  ensureResumesDir();
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new Error('Only PDF and DOCX files are allowed');
  }

  const destName = `resume${ext}`;
  const destPath = path.join(RESUMES_DIR, destName);
  fs.writeFileSync(destPath, file.buffer);

  const db = getDb();
  const uploadedAt = now();
  db.prepare('UPDATE resume_profiles SET is_active = 0').run();

  const insert = db.prepare(
    `INSERT INTO resume_profiles (
      file_name, file_path, file_type, file_size, uploaded_at, is_active,
      extracted_text, parsed_profile, parse_status, parse_error, parsed_at
    ) VALUES (?, ?, ?, ?, ?, 1, '', '{}', 'pending', '', NULL)`
  );
  const info = insert.run(file.originalname, destPath, ext.slice(1), file.size, uploadedAt);
  const resumeId = info.lastInsertRowid;

  const parsed = await parseResumeBuffer(file.buffer, ext);
  await persistParseResult(resumeId, parsed);

  const row = getActiveResume();
  const response = formatResumeResponse(row);
  if (!parsed.ok) {
    const err = new Error(parsed.error || 'Resume parsing failed');
    err.resume = response;
    err.parseFailed = true;
    throw err;
  }
  return response;
}

export function deleteActiveResume() {
  const active = getActiveResume();
  if (!active) return false;
  if (fs.existsSync(active.file_path)) {
    fs.unlinkSync(active.file_path);
  }
  getDb().prepare('UPDATE resume_profiles SET is_active = 0 WHERE id = ?').run(active.id);
  return true;
}

export { RESUMES_DIR };
