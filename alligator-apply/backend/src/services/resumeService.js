import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, now } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = process.env.RESUMES_DIR || path.join(__dirname, '../../uploads/resumes');
const ALLOWED = new Set(['.pdf', '.docx']);

export function ensureResumesDir() {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
}

export function getActiveResume() {
  const row = getDb()
    .prepare('SELECT * FROM resume_profiles WHERE is_active = 1 ORDER BY uploaded_at DESC LIMIT 1')
    .get();
  return row || null;
}

export function saveResume(file) {
  ensureResumesDir();
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new Error('Only PDF and DOCX files are allowed');
  }
  const destName = `resume${ext}`;
  const destPath = path.join(RESUMES_DIR, destName);
  fs.writeFileSync(destPath, file.buffer);

  const db = getDb();
  db.prepare('UPDATE resume_profiles SET is_active = 0').run();
  db.prepare(
    `INSERT INTO resume_profiles (file_name, file_path, file_type, file_size, uploaded_at, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(file.originalname, destPath, ext.slice(1), file.size, now());

  return getActiveResume();
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
