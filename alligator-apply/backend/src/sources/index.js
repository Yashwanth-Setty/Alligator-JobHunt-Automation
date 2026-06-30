import { dedupeJobs, dedupeJobsWithStats } from './dedupe.js';
import {
  createActiveProviders,
  createAllProviders,
  getProviderFactory,
  listProviderNames,
  getProviderMetadata,
  getAllProviderMetadata,
} from './providers/providerRegistry.js';
import { runProviderSearch, runAdapterSearch } from './providers/providerRunner.js';
import {
  parseJobSources,
  getTargetsForSource,
  getAllSourceTargets,
  getTargetPlanForSource,
  planTargetsForSource,
} from './sourceConfig.js';
import { isMockMode } from './liveSearch.js';

export {
  createActiveProviders,
  createAllProviders,
  getProviderFactory,
  listProviderNames,
  getProviderMetadata,
  getAllProviderMetadata,
  runProviderSearch,
  runAdapterSearch,
  dedupeJobs,
  dedupeJobsWithStats,
  parseJobSources,
  getTargetsForSource,
  getAllSourceTargets,
  getTargetPlanForSource,
  planTargetsForSource,
  isMockMode,
};

/** @deprecated Use createActiveProviders */
export const createActiveAdapters = createActiveProviders;

/** @deprecated Use createAllProviders */
export const createAllAdapters = createAllProviders;

export {
  JobSourceProvider,
  JobSourceAdapter,
  validateBoardTokenTarget,
  resolveBoardToken,
} from './providers/providerContract.js';

export { GreenhouseAdapter } from './greenhouse.adapter.js';
export { LeverAdapter } from './lever.adapter.js';
export { AshbyAdapter } from './ashby.adapter.js';
export { SmartRecruitersAdapter } from './smartrecruiters.adapter.js';
