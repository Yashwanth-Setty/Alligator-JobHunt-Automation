import {
  getEnabledTargetsForSource,
  listJobSources,
  parseEnvJobSources,
  syncJobSourcesFromEnv,
} from '../services/sourceStore.js';
import {
  planTargetsForSource,
  registryTargetsToSlugs,
} from '../services/companyRegistry/registryScanPlanner.js';

/** @returns {string[]} Active scan providers: JOB_SOURCES env, minus sources disabled in job_sources. */
export function parseJobSources() {
  syncJobSourcesFromEnv();
  const fromEnv = parseEnvJobSources();
  if (fromEnv.length === 0) return [];

  try {
    const disabled = new Set(
      listJobSources().filter((row) => !row.enabled).map((row) => row.source)
    );
    return fromEnv.filter((name) => !disabled.has(name));
  } catch {
    return fromEnv;
  }
}

/**
 * Resolve scan target slugs for adapters (registry-first, legacy fallback).
 * Env var lists still override when set.
 * Pass `options.filters` (with `keywords`) to enable role-aware target promotion.
 * @param {string} sourceName
 * @param {{ filters?: { keywords?: string } }} [options]
 * @returns {string[]}
 */
export function getTargetsForSource(sourceName, options = {}) {
  const ENV_LIST_KEYS = {
    greenhouse: 'GREENHOUSE_BOARDS',
    lever: 'LEVER_COMPANIES',
    ashby: 'ASHBY_BOARDS',
    smartrecruiters: 'SMARTRECRUITERS_COMPANIES',
  };
  const envKey = ENV_LIST_KEYS[sourceName];
  if (envKey && process.env[envKey]) {
    return process.env[envKey].split(',').map((s) => s.trim()).filter(Boolean);
  }

  const plan = planTargetsForSource(sourceName, { filters: options.filters });
  if (plan.targets.length > 0) {
    return registryTargetsToSlugs(plan.targets);
  }

  try {
    return getEnabledTargetsForSource(sourceName);
  } catch {
    return [];
  }
}

/** @returns {import('../services/companyRegistry/registryScanPlanner.js').RegistryTarget[]} */
export function getTargetPlanForSource(sourceName, options = {}) {
  const ENV_LIST_KEYS = {
    greenhouse: 'GREENHOUSE_BOARDS',
    lever: 'LEVER_COMPANIES',
    ashby: 'ASHBY_BOARDS',
    smartrecruiters: 'SMARTRECRUITERS_COMPANIES',
  };
  const envKey = ENV_LIST_KEYS[sourceName];
  if (envKey && process.env[envKey]) {
    const slugs = process.env[envKey].split(',').map((s) => s.trim()).filter(Boolean);
    return {
      source: sourceName,
      origin: 'env',
      targets: slugs.map((slug) => ({
        boardToken: slug,
        origin: 'env',
        source: sourceName,
      })),
    };
  }
  return planTargetsForSource(sourceName, options);
}

export function getAllSourceTargets() {
  const sources = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday'];
  const out = {};
  for (const s of sources) out[s] = getTargetsForSource(s);
  return out;
}

export function clearSourceConfigCache() {}

export { planTargetsForSource } from '../services/companyRegistry/registryScanPlanner.js';
