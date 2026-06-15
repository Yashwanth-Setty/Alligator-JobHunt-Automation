/**
 * Playwright browser automation — placeholder for v1.
 * AUTO_SUBMIT=false: pauses at visa, EEO, salary, CAPTCHA, final submit.
 */

const PAUSE_FIELDS = ['visa', 'eeo', 'salary', 'captcha', 'final_submit'];
const AUTO_SUBMIT = process.env.AUTO_SUBMIT === 'true';

export async function launchApplySession(job) {
  return {
    success: true,
    mock: true,
    jobId: job.id,
    autoSubmit: AUTO_SUBMIT,
    pausedAt: PAUSE_FIELDS,
    message: AUTO_SUBMIT
      ? 'AUTO_SUBMIT enabled — not recommended'
      : 'Playwright session placeholder. Safe fields would be filled; paused before sensitive fields.',
    fieldsFilled: ['name', 'email', 'phone', 'resume'],
  };
}

export function getPlaywrightConfig() {
  return {
    autoSubmit: AUTO_SUBMIT,
    pauseFields: PAUSE_FIELDS,
    installed: false,
    note: 'Install playwright and wire launchApplySession in a future milestone.',
  };
}
