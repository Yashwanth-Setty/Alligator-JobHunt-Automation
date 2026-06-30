/**
 * Smoke test for Career Copilot chat endpoint.
 * Run: npm run test:copilot
 */

import { getDb } from '../src/db/database.js';
import { handleCopilotChat } from '../src/services/copilotService.js';

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function main() {
  console.log('\n── Career Copilot smoke test ──');
  getDb();

  const result = await handleCopilotChat({ action: 'recommend_next_action' });
  assert(result.provider === 'template' || result.provider === 'watsonx_planned', 'provider set');
  assert(typeof result.reply === 'string' && result.reply.length > 20, 'reply is non-empty');
  assert(result.contextSummary, 'contextSummary present');
  assert(Array.isArray(result.suggestions), 'suggestions array');
  console.log('Provider:', result.provider);
  console.log('Reply preview:', result.reply.slice(0, 120).replace(/\n/g, ' ') + '…');
  console.log('Context:', result.contextSummary);

  const job = getDb()
    .prepare('SELECT id FROM jobs WHERE COALESCE(is_hidden, 0) = 0 ORDER BY score DESC LIMIT 1')
    .get();
  if (job?.id) {
    const match = await handleCopilotChat({ action: 'explain_match', jobId: job.id });
    assert(match.reply.includes('match') || match.reply.includes('%'), 'explain_match uses job context');
    console.log('explain_match with jobId: OK');
  } else {
    console.log('No jobs in DB — skipped job-scoped explain_match');
  }

  try {
    await handleCopilotChat({ action: 'invalid_action' });
    throw new Error('expected invalid action to throw');
  } catch (e) {
    assert(e.message.includes('Invalid action'), 'invalid action rejected');
  }

  console.log('\n✓ Copilot smoke test passed\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
