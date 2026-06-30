/**
 * Tests for AshbyAdapter retry + backoff behaviour.
 * Run: npm run test:ashby-retry
 *
 * Uses dependency injection — no HTTP calls, no DB.
 */

import { AshbyAdapter } from '../src/sources/ashby.adapter.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function makeErr(message, httpStatus = null) {
  const err = new Error(message);
  if (httpStatus !== null) err.httpStatus = httpStatus;
  return err;
}

/**
 * Inject a fake fetchBoardJobs onto the adapter instance so we can control
 * exactly how many times it fails and with what error.
 */
function withFakeBoards(adapter, fakeImpl) {
  adapter.fetchBoardJobs = fakeImpl;
}

// Speed up tests by replacing delay() with a no-op inside the adapter's
// fetchBoardJobsWithRetry — we monkey-patch the imported delay via the
// adapter's module scope isn't possible directly, so we shrink the backoff by
// patching Date.now to make jitter negligible and intercept via short timeouts.
// Simpler: just call fetchBoardJobsWithRetry directly and measure call counts.

console.log('\n── AshbyAdapter retry behaviour ──\n');

// ── Test 1: success on first attempt — no retry ───────────────────────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    return [{ board: 'test', job: { title: 'Engineer' } }];
  });

  const result = await adapter.fetchBoardJobsWithRetry('test-board', {});
  assert(calls === 1, 'succeeds on first attempt with 1 call');
  assert(Array.isArray(result) && result.length === 1, 'returns jobs on success');
}

// ── Test 2: transient 408 timeout retries and eventually succeeds ─────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    if (calls < 3) throw makeErr('Request timed out after 30000ms', 408);
    return [{ board: 'test', job: { title: 'Java Developer' } }];
  });

  const result = await adapter.fetchBoardJobsWithRetry('timeout-board', {});
  assert(calls === 3, 'retries twice on 408 timeout (3 total calls)');
  assert(Array.isArray(result) && result.length === 1, 'returns jobs after recovery');
}

// ── Test 3: transient 503 retries ────────────────────────────────────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    if (calls === 1) throw makeErr('HTTP 503 Service Unavailable', 503);
    return [];
  });

  const result = await adapter.fetchBoardJobsWithRetry('flaky-board', {});
  assert(calls === 2, 'retries once on 503 and succeeds');
  assert(Array.isArray(result), 'returns empty array after recovery');
}

// ── Test 4: non-transient 404 does NOT retry ──────────────────────────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    throw makeErr('HTTP 404 Not Found', 404);
  });

  let threw = false;
  try {
    await adapter.fetchBoardJobsWithRetry('missing-board', {});
  } catch (err) {
    threw = true;
    assert(err.httpStatus === 404, '404 error propagates unchanged');
  }
  assert(threw, 'throws on non-transient 404');
  assert(calls === 1, '404 does not retry (1 call only)');
}

// ── Test 5: exhausted retries throws last error ───────────────────────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    throw makeErr('HTTP 429 Too Many Requests', 429);
  });

  let finalErr = null;
  try {
    await adapter.fetchBoardJobsWithRetry('rate-limited-board', {});
  } catch (err) {
    finalErr = err;
  }
  assert(calls === 3, 'exhausts all 3 attempts on persistent 429');
  assert(finalErr?.httpStatus === 429, 'throws the last error after retries exhausted');
}

// ── Test 6: AbortError (network timeout) is treated as transient ──────────
{
  const adapter = new AshbyAdapter();
  let calls = 0;
  withFakeBoards(adapter, async () => {
    calls++;
    if (calls < 2) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return [{ board: 'b', job: { title: 'Backend Engineer' } }];
  });

  const result = await adapter.fetchBoardJobsWithRetry('slow-board', {});
  assert(calls === 2, 'AbortError is transient — retries and succeeds');
  assert(Array.isArray(result), 'returns result after AbortError recovery');
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n── summary: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
