/**
 * IBM watsonx agent reasoning — placeholder for v1.
 */

export async function reasonAboutJob(job, context = {}) {
  return {
    mock: true,
    agent: 'watsonx-placeholder',
    jobId: job.id,
    recommendation: job.auto_apply_eligible
      ? 'Eligible for guided auto-apply after human review of visa answers.'
      : 'Route to manual review — complex form or low confidence.',
    confidence: job.score >= 75 ? 0.82 : 0.55,
    context,
    message: 'watsonx integration not configured. Set WATSONX_API_KEY in .env for future use.',
  };
}

export function getWatsonxStatus() {
  return {
    configured: Boolean(process.env.WATSONX_API_KEY),
    projectId: process.env.WATSONX_PROJECT_ID || null,
    modelId: process.env.WATSONX_MODEL_ID || 'ibm/granite-13b-chat-v2',
  };
}
