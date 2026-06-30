import { Router } from 'express';
import { COPILOT_ACTIONS, handleCopilotChat } from '../services/copilotService.js';

const router = Router();

router.get('/actions', (_req, res) => {
  res.json({ actions: COPILOT_ACTIONS });
});

router.post('/chat', async (req, res) => {
  try {
    const result = await handleCopilotChat(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
