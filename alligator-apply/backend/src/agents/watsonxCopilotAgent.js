/**
 * Watsonx Career Copilot — planned provider (template fallback).
 */

import { runTemplateCopilotChat } from './templateCopilotAgent.js';
import { getWatsonxStatus } from '../services/watsonxAgentService.js';

export async function runWatsonxCopilotChat(context, request) {
  const status = getWatsonxStatus();
  const result = await runTemplateCopilotChat(context, request);
  return {
    ...result,
    provider: 'watsonx_planned',
    providerNote:
      'Watsonx credentials detected but copilot LLM is not wired yet. Returned template-based guidance.',
    watsonx: {
      configured: status.configured,
      projectId: status.projectId,
      modelId: status.modelId,
    },
  };
}
