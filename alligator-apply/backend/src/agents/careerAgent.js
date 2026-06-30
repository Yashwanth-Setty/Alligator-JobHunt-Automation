/**
 * Career agent provider selection for application packets.
 */

import { generateTemplatePacket } from './templateCareerAgent.js';
import { generateWatsonxPacket, isWatsonxCareerAgentReady } from './watsonxCareerAgent.js';
import { runTemplateCopilotChat } from './templateCopilotAgent.js';
import { runWatsonxCopilotChat } from './watsonxCopilotAgent.js';

export async function generateApplicationPacket(context) {
  if (isWatsonxCareerAgentReady()) {
    return generateWatsonxPacket(context);
  }
  return generateTemplatePacket(context);
}

export async function runCopilotChat(context, request) {
  if (isWatsonxCareerAgentReady()) {
    return runWatsonxCopilotChat(context, request);
  }
  return runTemplateCopilotChat(context, request);
}

export { isWatsonxCareerAgentReady };
