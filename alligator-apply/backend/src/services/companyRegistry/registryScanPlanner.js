/**
 * Scan target planning — registry-first with legacy fallback (Phase 1C).
 */

import { getEnabledTargetsForSource } from '../sourceStore.js';
import { buildCareersUrl, slugToCompanyName } from './registryImport.js';
import {
  countRegistryEntriesForSource,
  listEnabledRegistryEntriesForSource,
} from './registryStore.js';

// ── role-aware prioritization ─────────────────────────────────────────────────

/**
 * Board tokens that should be pulled to the front of Greenhouse scans when the
 * search query signals Java/Spring/JVM intent. These companies have confirmed
 * Java job postings (verified by debug:source-keyword-coverage on 2026-06-28).
 */
const JAVA_PRIORITY_TOKENS = new Set([
  'elastic',
  'okta',
  'squarespace',
  'datadog',
]);

/**
 * Board tokens prioritized for generic backend/platform role searches.
 * These companies regularly post backend SWE roles across languages.
 */
const BACKEND_PRIORITY_TOKENS = new Set([
  'databricks',
  'affirm',
  'gitlab',
  'palantir',
  'brex',
  'verkada',
  'coinbase',
  'okta',
]);

/**
 * Board tokens prioritized for AI/ML/LLM role searches on Greenhouse.
 * Includes companies with confirmed AI engineering roles.
 * Tokens not in the current registry are included for future-proofing.
 */
export const AI_PRIORITY_TOKENS = new Set([
  'openai',
  'anthropic',
  'databricks',
  'huggingface',
  'cohere',
  'perplexity',
  'scaleai',
  'deepgram',
  'assemblyai',
  'cursor',
  'weights',
  'together',
  'langchain',
  'pinecone',
  'modal',
]);

/**
 * SmartRecruiters board tokens for non-tech companies that flood engineering
 * searches with irrelevant results (food service, retail, apparel).
 * These are moved to the END of the SmartRecruiters list — not removed.
 */
const SMARTRECRUITERS_NOISE_TOKENS = new Set([
  'Sodexo',
  'McDonaldsCorporation',
  'Skechers',
  'IKEA',
]);

/**
 * Detect search intent from a keyword string.
 * Returns { java, backend, ai, engineering }.
 */
export function detectScanIntent(keywords = '') {
  const kw = String(keywords || '').toLowerCase();
  const java        = /\bjava\b|\bspring\b|\bjvm\b/.test(kw);
  const backend     = /\bbackend\b/.test(kw);
  const ai          = /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b|\bllm\b|\bgenerative ai\b/.test(kw);
  // engineering = any tech role keyword; used for SmartRecruiters noise suppression
  const engineering = java || backend || ai ||
    /engineer|developer|software|frontend|fullstack|full.?stack|devops|platform|sre|data scientist|analyst/i.test(kw);
  return { java, backend, ai, engineering };
}

/**
 * Move priority tokens to the FRONT. Relative order within each group preserved.
 */
function promoteTargets(targets, prioritySet) {
  const priority = targets.filter((t) => prioritySet.has(t.boardToken));
  const rest     = targets.filter((t) => !prioritySet.has(t.boardToken));
  return [...priority, ...rest];
}

/**
 * Move noise tokens to the END. Relative order within each group preserved.
 */
function demoteTargets(targets, noiseSet) {
  const keep  = targets.filter((t) => !noiseSet.has(t.boardToken));
  const noise = targets.filter((t) =>  noiseSet.has(t.boardToken));
  return [...keep, ...noise];
}

/**
 * @typedef {object} RegistryTarget
 * @property {string|null} id
 * @property {string|null} companyId
 * @property {string} companyName
 * @property {string} source
 * @property {string} careersUrl
 * @property {string} boardToken
 * @property {object} connectionPayload
 * @property {number} priority
 * @property {boolean} enabled
 * @property {string} origin - 'registry' | 'legacy'
 * @property {string} [industry]
 * @property {string} [visaSponsorHint]
 * @property {string} [remotePolicy]
 */

function entryToRegistryTarget(entry) {
  return {
    id: entry.id,
    companyId: entry.companyId,
    companyName: entry.companyName || '',
    source: entry.source,
    careersUrl: entry.careersUrl || buildCareersUrl(entry.source, entry.boardToken),
    boardToken: entry.boardToken,
    connectionPayload: entry.connectionPayload || {},
    priority: entry.priority ?? 50,
    enabled: entry.enabled !== false,
    origin: 'registry',
    industry: entry.industry || '',
    visaSponsorHint: entry.visaSponsorHint || 'unknown',
    remotePolicy: entry.remotePolicy || 'unknown',
    lastScanStatus: entry.lastScanStatus,
    consecutiveFailures: entry.consecutiveFailures ?? 0,
  };
}

function legacySlugToTarget(source, slug) {
  const boardToken = String(slug || '').trim();
  return {
    id: null,
    companyId: null,
    companyName: slugToCompanyName(boardToken),
    source,
    careersUrl: buildCareersUrl(source, boardToken),
    boardToken,
    connectionPayload: {},
    priority: 50,
    enabled: true,
    origin: 'legacy',
    industry: '',
    visaSponsorHint: 'unknown',
    remotePolicy: 'unknown',
  };
}

function loadLegacyTargets(source) {
  try {
    return getEnabledTargetsForSource(source).map((slug) => legacySlugToTarget(source, slug));
  } catch {
    return [];
  }
}

/**
 * Plan scan targets for a job source.
 * Uses company_registry_entries when any enabled rows exist; otherwise source_targets.
 *
 * Intent-aware reordering (in-memory only, no DB writes):
 *   Greenhouse  — java intent:       promote elastic/okta/squarespace/datadog
 *   Greenhouse  — backend intent:    promote databricks/affirm/gitlab/palantir/brex/verkada/coinbase/okta
 *   Greenhouse  — ai intent:         promote openai/anthropic/databricks/huggingface/cohere/perplexity/scaleai/…
 *   SmartRecru. — engineering intent: demote Sodexo/McDonaldsCorporation/Skechers/IKEA to end
 *
 * @param {string} source
 * @param {{ limit?: number, filters?: { keywords?: string } }} [options]
 * @returns {{ source: string, origin: 'registry'|'legacy', targets: RegistryTarget[], intent: object }}
 */
export function planTargetsForSource(source, options = {}) {
  const src = String(source || '').trim().toLowerCase();
  const limit = options.limit;
  const intent = detectScanIntent(options.filters?.keywords);

  if (countRegistryEntriesForSource(src) > 0) {
    const entries = listEnabledRegistryEntriesForSource(src, {
      limit: limit ?? undefined,
    });
    let targets = entries.map(entryToRegistryTarget);

    // ── Greenhouse: role-aware promotion ──────────────────────────────────────
    if (src === 'greenhouse') {
      let promotedSet = null;
      let intentLabel = '';

      if (intent.ai) {
        // AI intent takes precedence over java/backend when searching for AI roles
        targets    = promoteTargets(targets, AI_PRIORITY_TOKENS);
        promotedSet = AI_PRIORITY_TOKENS;
        intentLabel = 'ai';
      } else if (intent.java) {
        targets    = promoteTargets(targets, JAVA_PRIORITY_TOKENS);
        promotedSet = JAVA_PRIORITY_TOKENS;
        intentLabel = 'java';
      } else if (intent.backend) {
        targets    = promoteTargets(targets, BACKEND_PRIORITY_TOKENS);
        promotedSet = BACKEND_PRIORITY_TOKENS;
        intentLabel = 'backend';
      }

      if (promotedSet) {
        const promoted = targets
          .filter((t) => promotedSet.has(t.boardToken))
          .map((t) => t.boardToken);
        if (promoted.length > 0) {
          console.log(`[planner] source=greenhouse intent=${intentLabel} promoted=${promoted.join(',')}`);
        }
      }
    }

    // ── SmartRecruiters: noise suppression for engineering searches ───────────
    if (src === 'smartrecruiters' && intent.engineering) {
      const before = targets.filter((t) => SMARTRECRUITERS_NOISE_TOKENS.has(t.boardToken)).map((t) => t.boardToken);
      targets = demoteTargets(targets, SMARTRECRUITERS_NOISE_TOKENS);
      if (before.length > 0) {
        console.log(`[planner] source=smartrecruiters intent=engineering demoted=${before.join(',')}`);
      }
    }

    return { source: src, origin: 'registry', targets, intent };
  }

  let legacy = loadLegacyTargets(src);
  if (limit != null) legacy = legacy.slice(0, limit);
  return { source: src, origin: 'legacy', targets: legacy, intent };
}

/** Extract board tokens for adapters that still expect string slugs. */
export function registryTargetsToSlugs(targets) {
  return targets.map((t) => t.boardToken).filter(Boolean);
}

export { registryTargetsToSlugs as toAdapterSlugs };
