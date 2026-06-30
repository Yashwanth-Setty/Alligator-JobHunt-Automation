import { runCopilotChat } from '../agents/careerAgent.js';
import {
  buildCopilotContext,
  isValidCopilotAction,
  COPILOT_ACTIONS,
} from './copilotContext.js';

export async function handleCopilotChat(body = {}) {
  const action = body.action || 'recommend_next_action';
  if (!isValidCopilotAction(action)) {
    throw new Error(`Invalid action. Supported: ${COPILOT_ACTIONS.join(', ')}`);
  }

  const context = await buildCopilotContext({ jobId: body.jobId });
  const response = await runCopilotChat(context, {
    action,
    message: body.message || '',
  });

  return {
    ...response,
    contextSummary: {
      resumeLoaded: context.resume.loaded,
      resumeParseStatus: context.resume.parseStatus,
      recentJobCount: context.recentJobs.length,
      applicationCount: context.applications.length,
      selectedJobId: context.selectedJob?.id || null,
      candidateName: context.candidate.name,
    },
  };
}

export { COPILOT_ACTIONS };
