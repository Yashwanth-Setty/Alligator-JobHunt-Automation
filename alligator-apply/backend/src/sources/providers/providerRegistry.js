import { GreenhouseAdapter } from '../greenhouse.adapter.js';
import { LeverAdapter } from '../lever.adapter.js';
import { AshbyAdapter } from '../ashby.adapter.js';
import { SmartRecruitersAdapter } from '../smartrecruiters.adapter.js';
import { BambooHRAdapter } from '../bamboohr.adapter.js';
import { WorkdayAdapter } from '../workday.adapter.js';
import { ICimsAdapter } from '../icims.adapter.js';
import { JobviteAdapter } from '../jobvite.adapter.js';
import { JazzHRAdapter } from '../jazzhr.adapter.js';
import { TeamtailorAdapter } from '../teamtailor.adapter.js';
import { parseJobSources } from '../sourceConfig.js';
import { getSourceTimeoutMs, getMaxResultsPerSource } from '../scanConfig.js';

const PROVIDER_FACTORIES = {
  greenhouse: (shared) => new GreenhouseAdapter(shared),
  lever: (shared) => new LeverAdapter(shared),
  ashby: (shared) => new AshbyAdapter(shared),
  smartrecruiters: (shared) => new SmartRecruitersAdapter(shared),
  bamboohr: (shared) => new BambooHRAdapter(shared),
  workday: (shared) => new WorkdayAdapter(shared),
  icims: (shared) => new ICimsAdapter(shared),
  jobvite: (shared) => new JobviteAdapter(shared),
  jazzhr: (shared) => new JazzHRAdapter(shared),
  teamtailor: (shared) => new TeamtailorAdapter(shared),
};

function sharedConfig() {
  return {
    timeoutMs: getSourceTimeoutMs(),
    maxResults: getMaxResultsPerSource(),
  };
}

/** Providers enabled via JOB_SOURCES */
export function createActiveProviders() {
  const shared = sharedConfig();
  const enabled = parseJobSources();

  return enabled
    .filter((name) => PROVIDER_FACTORIES[name])
    .map((name) => PROVIDER_FACTORIES[name](shared));
}

/** All registered providers (including stubs) */
export function createAllProviders() {
  const shared = sharedConfig();
  return Object.keys(PROVIDER_FACTORIES).map((name) => PROVIDER_FACTORIES[name](shared));
}

export function getProviderFactory(name) {
  return PROVIDER_FACTORIES[name] || null;
}

export function listProviderNames() {
  return Object.keys(PROVIDER_FACTORIES);
}

export function getProviderMetadata(name) {
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) return null;
  const provider = factory(sharedConfig());
  return provider.metadata();
}

export function getAllProviderMetadata() {
  return listProviderNames().map((name) => getProviderMetadata(name)).filter(Boolean);
}

/** @deprecated Use createActiveProviders */
export const createActiveAdapters = createActiveProviders;

/** @deprecated Use createAllProviders */
export const createAllAdapters = createAllProviders;
