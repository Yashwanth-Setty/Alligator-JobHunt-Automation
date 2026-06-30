/**
 * Job source provider plugin contract (Phase 2A).
 *
 * All live and future ATS integrations implement this interface.
 * The scan pipeline calls fetchJobs() only — never provider-specific APIs.
 */

import { getTargetPlanForSource } from '../sourceConfig.js';

/**
 * @typedef {object} ProviderMetadata
 * @property {string} name
 * @property {string} atsType
 * @property {string} label
 * @property {boolean} implemented
 * @property {'board_token'|'connection_payload'} targetKind
 * @property {boolean} supportsMock
 * @property {boolean} supportsRegistry
 * @property {string} [careersUrlTemplate]
 * @property {string} [targetLabel]
 */

/**
 * @typedef {object} ProviderTarget
 * @property {string} boardToken
 * @property {string} [companyName]
 * @property {string} [source]
 * @property {object} [connectionPayload]
 * @property {string} [origin]
 */

/**
 * @typedef {object} TargetValidationResult
 * @property {boolean} valid
 * @property {string} [error]
 */

/**
 * @typedef {object} ProviderHealthResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} [latencyMs]
 * @property {string} [mode]
 * @property {number} [sampleCount]
 */

export class JobSourceProvider {
  /**
   * @param {object} config
   * @param {string} config.name
   * @param {string} config.atsType
   * @param {string} [config.label]
   * @property {string} targetKind
   * @param {number} [config.timeoutMs]
   * @param {number} [config.maxResults]
   * @param {boolean} [config.implemented]
   */
  constructor(config) {
    this.name = config.name;
    this.atsType = config.atsType || config.name;
    this.label = config.label || config.name;
    this.targetKind = config.targetKind || 'board_token';
    this.timeoutMs = config.timeoutMs ?? Number(process.env.SOURCE_TIMEOUT_MS || 12000);
    this.maxResults = config.maxResults ?? Number(process.env.MAX_RESULTS_PER_SOURCE || 50);
    this.implemented = config.implemented !== false;
  }

  /**
   * Provider descriptor for registry UI and diagnostics.
   * @returns {ProviderMetadata}
   */
  metadata() {
    return {
      name: this.name,
      atsType: this.atsType,
      label: this.label,
      implemented: this.implemented,
      targetKind: this.targetKind,
      supportsMock: true,
      supportsRegistry: true,
      targetLabel: 'Board token',
    };
  }

  /**
   * Validate a scan target before fetch.
   * @param {string|ProviderTarget} target
   * @returns {TargetValidationResult}
   */
  validateTarget(target) {
    return validateBoardTokenTarget(target);
  }

  /**
   * Fetch normalized or raw jobs for configured targets.
   * @param {import('../types.js').SearchFilters} _filters
   * @param {import('../types.js').SearchOptions} _options
   * @returns {Promise<import('../types.js').SearchResult>}
   */
  async fetchJobs(_filters, _options = {}) {
    throw new Error(`${this.name} provider: fetchJobs() not implemented`);
  }

  /**
   * Backward-compatible alias used by legacy adapter tests.
   * @param {import('../types.js').SearchFilters} filters
   * @param {import('../types.js').SearchOptions} options
   */
  async search(filters, options = {}) {
    return this.fetchJobs(filters, options);
  }

  /**
   * @param {object} _rawJob
   * @param {string|object} [_context]
   * @returns {import('../types.js').Job}
   */
  normalize(_rawJob, _context) {
    throw new Error(`${this.name} provider: normalize() not implemented`);
  }

  /**
   * Lightweight connectivity check for a single target.
   * @param {string|ProviderTarget} target
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<ProviderHealthResult>}
   */
  async healthCheck(_target, _options = {}) {
    return { ok: false, error: 'healthCheck() not implemented' };
  }

  /**
   * List configured targets from registry-first planner.
   * @returns {ProviderTarget[]}
   */
  discover() {
    const plan = getTargetPlanForSource(this.name);
    return (plan.targets || []).map((t) => ({
      boardToken: t.boardToken,
      companyName: t.companyName || '',
      source: t.source,
      connectionPayload: t.connectionPayload || {},
      origin: t.origin,
    }));
  }
}

/** @deprecated Use JobSourceProvider */
export const JobSourceAdapter = JobSourceProvider;

/**
 * @param {string|ProviderTarget} target
 * @returns {TargetValidationResult}
 */
export function validateBoardTokenTarget(target) {
  const token =
    typeof target === 'string' ? target : target?.boardToken || target?.target || '';
  const value = String(token || '').trim();
  if (!value) {
    return { valid: false, error: 'boardToken is required' };
  }
  if (/\s/.test(value)) {
    return { valid: false, error: 'boardToken must not contain whitespace' };
  }
  return { valid: true };
}

export function resolveBoardToken(target) {
  if (typeof target === 'string') return target.trim();
  return String(target?.boardToken || target?.target || '').trim();
}
