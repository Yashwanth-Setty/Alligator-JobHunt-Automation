import { Router } from 'express';
import multer from 'multer';
import { deleteActiveResume, getActiveResume, saveResume } from '../services/resumeService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', (_req, res) => {
  const resume = getActiveResume();
  if (!resume) {
    return res.json({ loaded: false, message: 'No resume uploaded' });
  }
  res.json({
    loaded: true,
    fileName: resume.file_name,
    fileType: resume.file_type,
    fileSize: resume.file_size,
    uploadedAt: resume.uploaded_at,
  });
});

router.post('/upload', upload.single('resume'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const saved = saveResume(req.file);
    res.json({ success: true, resume: saved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/', (_req, res) => {
  const ok = deleteActiveResume();
  res.json({ success: ok });
});

export default router;
