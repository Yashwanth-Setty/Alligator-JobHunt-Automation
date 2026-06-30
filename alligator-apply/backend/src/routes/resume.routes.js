import { Router } from 'express';
import multer from 'multer';
import {
  deleteActiveResume,
  formatResumeResponse,
  getActiveResume,
  saveResume,
} from '../services/resumeService.js';

const router = Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

function uploadResumeFile(req, res, next) {
  upload.single('resume')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File exceeds ${MAX_FILE_SIZE / (1024 * 1024)} MB limit`
          : err.message;
      return res.status(400).json({ error: message });
    }
    next(err);
  });
}

router.get('/', (_req, res) => {
  const resume = getActiveResume();
  if (!resume) {
    return res.json({ loaded: false, message: 'No resume uploaded' });
  }
  res.json(formatResumeResponse(resume));
});

router.post('/upload', uploadResumeFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const saved = await saveResume(req.file);
    res.json({ success: true, resume: saved });
  } catch (e) {
    if (e.parseFailed && e.resume) {
      return res.status(422).json({
        error: e.message,
        resume: e.resume,
        parseFailed: true,
      });
    }
    res.status(400).json({ error: e.message });
  }
});

router.delete('/', (_req, res) => {
  const ok = deleteActiveResume();
  res.json({ success: ok });
});

export default router;
