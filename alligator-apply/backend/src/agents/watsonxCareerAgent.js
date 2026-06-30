/**
 * IBM watsonx career agent — planned provider.
 * Falls back to template generation until watsonx API is wired.
 */

import { generateTemplatePacket } from './templateCareerAgent.js';
import { getWatsonxStatus } from '../services/watsonxAgentService.js';

export function isWatsonxCareerAgentReady() {
  const status = getWatsonxStatus();
  return Boolean(status.configured && status.projectId);
}

export async function generateWatsonxPacket(context) {
  const status = getWatsonxStatus();
  const packet = await generateTemplatePacket(context);
  return {
    ...packet,
    provider: 'watsonx_planned',
    providerNote:
      'WATSONX credentials detected but LLM packet generation is not wired yet. Returned template-based draft.',
    watsonx: {
      configured: status.configured,
      projectId: status.projectId,
      modelId: status.modelId,
    },
  };
}
