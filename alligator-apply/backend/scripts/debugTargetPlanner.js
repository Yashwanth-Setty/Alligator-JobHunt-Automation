/**
 * Target planner diagnostic — shows which companies are selected and in what order
 * for a given keyword query, with intent detection breakdown.
 *
 * Usage:
 *   npm run debug:target-planner -- --keywords "Java Backend Developer"
 *   npm run debug:target-planner -- --keywords "React Developer" --source greenhouse
 *   npm run debug:target-planner -- --keywords "backend engineer" --limit 20
 */

import { getDb } from '../src/db/database.js';
import { planTargetsForSource, detectScanIntent } from '../src/services/companyRegistry/registryScanPlanner.js';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const keywords = getArg('keywords') || '';
const source   = getArg('source') || 'greenhouse';
const limit    = getArg('limit') ? parseInt(getArg('limit'), 10) : undefined;

if (!keywords) {
  console.error('ERROR: --keywords is required');
  console.error('  example: npm run debug:target-planner -- --keywords "Java Backend Developer"');
  process.exit(1);
}

// ── main ──────────────────────────────────────────────────────────────────────
getDb();

const intent = detectScanIntent(keywords);

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('TARGET PLANNER DIAGNOSTIC');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  keywords : "${keywords}"`);
console.log(`  source   : ${source}`);
console.log(`  limit    : ${limit ?? '(none)'}`);
console.log(`\n  Detected intent:`);
console.log(`    java/spring/jvm : ${intent.java ? '✓ YES' : '✗ NO'}`);
console.log(`    backend         : ${intent.backend ? '✓ YES' : '✗ NO'}`);
console.log(`    ai/ml/llm       : ${intent.ai ? '✓ YES' : '✗ NO'}`);
console.log(`    engineering     : ${intent.engineering ? '✓ YES' : '✗ NO'}`);

const plan = planTargetsForSource(source, { filters: { keywords }, limit });

console.log(`\n  origin   : ${plan.origin}`);
console.log(`  total targets returned: ${plan.targets.length}`);

// Promotion / demotion status
const JAVA_SET    = new Set(['elastic','okta','squarespace','datadog']);
const BACKEND_SET = new Set(['databricks','affirm','gitlab','palantir','brex','verkada','coinbase','okta']);
const AI_SET      = new Set(['openai','anthropic','databricks','huggingface','cohere','perplexity','scaleai','deepgram','assemblyai','cursor','weights','together','langchain','pinecone','modal']);
const NOISE_SET   = new Set(['Sodexo','McDonaldsCorporation','Skechers','IKEA']);
const activeSet   = intent.ai ? AI_SET : intent.java ? JAVA_SET : intent.backend ? BACKEND_SET : new Set();

if (activeSet.size > 0) {
  const promoted = plan.targets.filter(t => activeSet.has(t.boardToken)).map(t => t.boardToken);
  const missing  = [...activeSet].filter(tok => !plan.targets.some(t => t.boardToken === tok));
  console.log(`\n  Priority tokens present in plan  : ${promoted.join(', ') || '(none found)'}`);
  if (missing.length) {
    console.log(`  Priority tokens NOT in registry  : ${missing.join(', ')}`);
  }
} else {
  console.log('\n  No role-aware promotion applied (generic search).');
}

// SmartRecruiters noise suppression indicator
if (source === 'smartrecruiters' && intent.engineering) {
  const noisePositions = plan.targets
    .map((t, i) => NOISE_SET.has(t.boardToken) ? `${t.boardToken}@${i+1}` : null)
    .filter(Boolean);
  console.log(`\n  Noise suppression active (engineering intent):`);
  console.log(`  Noise tokens positions: ${noisePositions.join(', ') || '(none in registry)'}`);
}

// Print first 20 targets with rank
console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`FIRST ${Math.min(20, plan.targets.length)} TARGETS (scan order)`);
console.log(`══════════════════════════════════════════════════════════════════`);
console.log(`  ${'#'.padEnd(4)} ${'token'.padEnd(32)} ${'company'.padEnd(35)} ${'priority'.padStart(8)}  promoted`);
console.log(`  ${'-'.repeat(85)}`);

plan.targets.slice(0, 20).forEach((t, i) => {
  const isPromoted = activeSet.size > 0 && activeSet.has(t.boardToken) ? '✓' : '';
  console.log(
    `  ${String(i + 1).padEnd(4)} ${t.boardToken.padEnd(32)} ${(t.companyName || '').padEnd(35)} ${String(t.priority).padStart(8)}  ${isPromoted}`
  );
});

if (plan.targets.length > 20) {
  console.log(`  … and ${plan.targets.length - 20} more targets`);
}

// Summary verdict
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('VERDICT');
console.log('══════════════════════════════════════════════════════════════════');
if (intent.ai || intent.java || intent.backend) {
  const promoLabel = intent.ai ? 'AI/ML/LLM' : intent.java ? 'Java/Spring/JVM' : 'Backend';
  const promoSet = intent.ai ? AI_SET : intent.java ? JAVA_SET : BACKEND_SET;
  const top10tokens = plan.targets.slice(0, 10).map(t => t.boardToken);
  const inTop10 = [...promoSet].filter(tok => top10tokens.includes(tok));
  const inPlan  = [...promoSet].filter(tok => plan.targets.some(t => t.boardToken === tok));

  console.log(`  Intent detected   : ${promoLabel}`);
  console.log(`  Priority set size : ${promoSet.size} tokens`);
  console.log(`  Present in plan   : ${inPlan.length} of ${promoSet.size} (${inPlan.join(', ') || 'none'})`);
  console.log(`  In first 10       : ${inTop10.length} of ${inPlan.length} (${inTop10.join(', ') || 'none'})`);
  if (inPlan.length > 0 && inTop10.length === inPlan.length) {
    console.log(`  ✓ All present priority targets appear in first 10.`);
  } else if (inPlan.length > 0) {
    console.log(`  ✗ ${inPlan.length - inTop10.length} priority target(s) are NOT in first 10 — check registry or token mismatch.`);
  } else {
    console.log(`  !! None of the priority tokens exist in the ${source} registry.`);
    console.log(`     Run: npm run registry:seed:expansion  to add them.`);
  }
} else {
  console.log('  Generic search — default priority order preserved, no promotion applied.');
}
console.log('');
