import { createActiveProviders } from './providers/providerRegistry.js';
import { runProviderSearch } from './providers/providerRunner.js';
import { dedupeJobsWithStats } from './dedupe.js';
import { lightEnrichJob, enrichJobQuality } from './qualityScore.js';
import { getMaxTotalResults, getPerProviderTimeoutMs, isFastScan, SCAN_PHASES } from './scanConfig.js';
import { mergeRejectionCounts } from './jobFetchFilter.js';
import { withTimeout } from './utils.js';
import { enrichFailedSourceStatus } from '../services/scanDiagnostics.js';

const SOURCE_LABELS = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workday: 'Workday',
};

const PHASE_PROGRESS = {
  fetching: 15,
  filtering: 35,
  deduplicating: 55,
  visa_detection: 75,
  quality_scoring: 90,
  completed: 100,
};

function buildScanReport(jobs, meta) {
  const jobsBySource = {};
  let visaPositive = 0;
  let visaNegative = 0;
  let visaUnknown = 0;

  for (const job of jobs) {
    jobsBySource[job.source] = (jobsBySource[job.source] || 0) + 1;
    const fit = job.visaSignals?.fit || 'unknown';
    if (fit === 'positive') visaPositive += 1;
    else if (fit === 'negative') visaNegative += 1;
    else visaUnknown += 1;
  }

  const threshold = meta.matchThreshold ?? 50;

  return {
    pipeline: {
      fetched: meta.totalFetched ?? 0,
      afterFilter: meta.afterFilter ?? 0,
      afterDedupe: meta.afterDedupe ?? jobs.length,
      afterMatch: meta.afterMatch ?? jobs.filter((j) => (j.score || 0) >= threshold).length,
      persisted: meta.persisted ?? 0,
    },
    totalFetched: meta.totalFetched,
    afterFilter: meta.afterFilter,
    filteredOut: meta.filteredOut,
    duplicatesRemoved: meta.duplicatesRemoved,
    finalJobs: jobs.length,
    jobsBySource,
    visaPositive,
    visaNegative,
    visaUnknown,
    avgQualityScore:
      jobs.length > 0
        ? Math.round(jobs.reduce((s, j) => s + (j.qualityScore || 0), 0) / jobs.length)
        : 0,
    afterMatch: meta.afterMatch ?? jobs.filter((j) => (j.score || 0) >= threshold).length,
    autoApplyEligible:
      meta.autoApplyEligible ??
      jobs.filter((j) => (j.score || 0) >= 65 && j.autoApplyEligible !== false).length,
    rejectionCounts: meta.rejectionCounts ?? {},
    scoreBelowThreshold: meta.scoreBelowThreshold ?? 0,
    timings: meta.timings || {},
  };
}

function enrichFailedStatuses(sourceStatuses, diagnostics) {
  if (!diagnostics) return sourceStatuses;
  return sourceStatuses.map((s) => enrichFailedSourceStatus(s, diagnostics));
}

function formatMs(ms) {
  return `${ms}ms`;
}

/**
 * @param {object} params
 * @param {import('./types.js').SearchFilters} params.filters
 * @param {() => boolean} params.isAborted
 * @param {(patch: object) => void} params.onProgress
 * @param {(jobs: import('./types.js').Job[], meta?: object) => void | Promise<void>} [params.onJobsReady]
 * @param {(jobs: import('./types.js').Job[]) => void | Promise<void>} [params.onEnrichmentBatch]
 * @param {(info: object) => void} [params.onPersistStats]
 */
export async function runSourceScan({
  filters = {},
  enrichOpts = {},
  matchThreshold = 50,
  isAborted = () => false,
  onProgress = () => {},
  onJobsReady = async () => {},
  onEnrichmentBatch = async () => {},
  onPersistStats = () => {},
  diagnostics = null,
}) {
  const providers = createActiveProviders();
  const sourceStatuses = [];
  const failedSources = [];
  const logs = [];
  const timings = { sources: {}, phases: {} };
  let totalFetched = 0;
  let totalAfterFilters = 0;
  let totalPersisted = 0;
  let fetchRejectionCounts = mergeRejectionCounts();
  const allJobs = [];

  const pushLog = (message) => {
    logs.push({ time: new Date().toISOString(), message });
    onProgress({ logs: [...logs] });
  };

  const setPhase = (phase, message) => {
    onProgress({
      phase,
      message,
      progress: PHASE_PROGRESS[phase] ?? 0,
      sourceStatuses: sourceStatuses.map((s) => ({ ...s })),
      failedSources: [...failedSources],
      logs: [...logs],
    });
  };

  // ── Phase: Fetching (parallel sources) ──
  setPhase('fetching', 'Fetching jobs from sources…');
  pushLog(`Starting parallel scan (${providers.length} sources, concurrency per source)`);
  const fetchPhaseStart = Date.now();

  for (const provider of providers) {
    sourceStatuses.push({
      name: provider.name,
      label: SOURCE_LABELS[provider.name] || provider.metadata?.().label || provider.name,
      status: 'scanning',
      jobsFound: 0,
      jobsFetched: 0,
      jobsAfterFilters: 0,
    });
  }
  onProgress({ sourceStatuses: sourceStatuses.map((s) => ({ ...s })), logs: [...logs] });

  const perProviderTimeoutMs = getPerProviderTimeoutMs(providers.length);

  const sourceSettled = await Promise.allSettled(
    providers.map(async (provider, idx) => {
      if (isAborted()) return { provider, jobs: [], error: 'aborted', stats: {}, durationMs: 0 };

      const label = SOURCE_LABELS[provider.name] || provider.metadata?.().label || provider.name;
      const statusRow = sourceStatuses[idx];
      const sourceStart = Date.now();

      console.log(`[scan] START ${provider.name}`);
      pushLog(`${label} started`);
      onProgress({
        currentSource: provider.name,
        message: `${label} fetching…`,
        sourceStatuses: sourceStatuses.map((s) => ({ ...s })),
        logs: [...logs],
      });

      try {
        const result = await withTimeout(
          runProviderSearch(provider, filters, {
            onCompanyDone: (info) => {
              pushLog(
                `${label}/${info.target}: ${info.jobs} jobs in ${formatMs(info.durationMs)}${info.fromCache ? ' (cache)' : ''}`
              );
            },
          }),
          perProviderTimeoutMs,
          `${provider.name} provider`
        );

        const durationMs = result.durationMs ?? Date.now() - sourceStart;
        timings.sources[provider.name] = { fetchMs: durationMs, ...result.stats };

        if (result.error) {
          statusRow.status = 'failed';
          statusRow.error = result.error;
          statusRow.stack = result.stack ?? null;
          statusRow.durationMs = durationMs;
          failedSources.push(provider.name);
          diagnostics?.recordProviderResult(provider.name, {
            jobs: [],
            error: result.error,
            stack: result.stack,
          });
          Object.assign(statusRow, enrichFailedSourceStatus(statusRow, diagnostics));
          pushLog(`${label} failed: ${result.error}`);
          console.log(
            `[scan] END ${provider.name} jobs=0 duration=${durationMs}ms error=${result.error}`
          );
          return { provider, ...result };
        }

        const fetched = result.stats?.fetched ?? result.jobs.length;
        const afterFilters = result.stats?.afterFilters ?? result.jobs.length;
        if (result.stats?.rejectionCounts) {
          fetchRejectionCounts = mergeRejectionCounts(fetchRejectionCounts, result.stats.rejectionCounts);
        }
        statusRow.jobsFetched = fetched;
        statusRow.jobsAfterFilters = afterFilters;
        statusRow.jobsFound = result.jobs.length;
        statusRow.status = 'completed';
        statusRow.durationMs = durationMs;
        statusRow.finishedAt = new Date().toISOString();

        pushLog(
          `${label}: Fetched=${fetched} AfterFilter=${afterFilters} Returned=${result.jobs.length} (${formatMs(durationMs)})`
        );
        if (fetched > afterFilters) {
          pushLog(`${label}: ${fetched - afterFilters} rejected at fetch filter — see scan report`);
        }

        const lightJobs = result.jobs.map((job) => lightEnrichJob(job, enrichOpts));
        diagnostics?.recordProviderResult(provider.name, {
          jobs: result.jobs,
          scoredJobs: lightJobs,
          stats: result.stats,
        });

        if (lightJobs.length > 0 && !isAborted()) {
          await onJobsReady(lightJobs, { source: provider.name, partial: true });
          totalPersisted += lightJobs.length;
          diagnostics?.recordPersistedBySource(provider.name, lightJobs.length);
          onPersistStats({ persisted: totalPersisted, source: provider.name, count: lightJobs.length });
        }

        totalFetched += fetched;
        totalAfterFilters += afterFilters;
        allJobs.push(...lightJobs);

        onProgress({
          currentSource: provider.name,
          message: `${label} done — ${result.jobs.length} jobs`,
          jobsFound: allJobs.length,
          partialResults: allJobs.length > 0,
          sourceStatuses: sourceStatuses.map((s) => ({ ...s })),
          failedSources: [...failedSources],
          logs: [...logs],
        });

        console.log(
          `[scan] END ${provider.name} jobs=${result.jobs.length} duration=${durationMs}ms`
        );
        return { provider, jobs: lightJobs, stats: result.stats, durationMs };
      } catch (err) {
        const durationMs = Date.now() - sourceStart;
        const message = err.message || String(err);
        statusRow.status = 'failed';
        statusRow.error = message;
        statusRow.stack = err.stack ?? null;
        statusRow.durationMs = durationMs;
        failedSources.push(provider.name);
        diagnostics?.recordProviderResult(provider.name, {
          jobs: [],
          error: message,
          stack: err.stack,
        });
        Object.assign(statusRow, enrichFailedSourceStatus(statusRow, diagnostics));
        pushLog(`${label} failed: ${message}`);
        console.log(
          `[scan] END ${provider.name} jobs=0 duration=${durationMs}ms error=${message}`
        );
        return { provider, jobs: [], error: message, durationMs };
      }
    })
  );

  for (const settled of sourceSettled) {
    if (settled.status === 'rejected') {
      const message = settled.reason?.message || String(settled.reason);
      pushLog(`Provider task rejected: ${message}`);
      console.log(`[scan] END unknown jobs=0 duration=0 error=${message}`);
    }
  }

  timings.phases.fetchingMs = Date.now() - fetchPhaseStart;
  pushLog(
    `Pipeline — Fetched: ${totalFetched} | After Filter: ${totalAfterFilters} | In memory: ${allJobs.length}`
  );
  pushLog(`Fetch phase complete in ${formatMs(timings.phases.fetchingMs)}`);

  if (isAborted()) {
    return { jobs: [], sourceStatuses, failedSources, logs, dedupedCount: 0, scanReport: null, aborted: true };
  }

  // ── Phase: Filtering (cap totals) ──
  setPhase('filtering', 'Applying limits and filters…');
  const filterStart = Date.now();
  let capped = allJobs.slice(0, getMaxTotalResults());
  timings.phases.filteringMs = Date.now() - filterStart;
  pushLog(`After cap: ${capped.length} jobs (max ${getMaxTotalResults()})`);

  // ── Phase: Deduplicating ──
  setPhase('deduplicating', 'Deduplicating results…');
  const dedupeStart = Date.now();
  const { jobs: deduped, removed: duplicatesRemoved, duplicateIds } = dedupeJobsWithStats(capped);
  timings.phases.dedupeMs = Date.now() - dedupeStart;
  if (duplicatesRemoved > 0) {
    fetchRejectionCounts.duplicate += duplicatesRemoved;
    pushLog(`Removed ${duplicatesRemoved} duplicate(s) in ${formatMs(timings.phases.dedupeMs)}`);
  }
  pushLog(`Pipeline — After Dedupe: ${deduped.length}`);

  if (diagnostics) {
    const bySource = {};
    for (const job of deduped) {
      bySource[job.source] = (bySource[job.source] || 0) + 1;
    }
    diagnostics.recordGlobalDedupe(bySource);
  }

  // Persist deduped light jobs immediately
  if (deduped.length > 0) {
    await onJobsReady(deduped, { source: 'dedupe', partial: true, replace: true });
    onPersistStats({ persisted: deduped.length, source: 'dedupe', count: deduped.length });
  }

  onProgress({
    jobsFound: deduped.length,
    partialResults: deduped.length > 0,
    progress: PHASE_PROGRESS.deduplicating,
    logs: [...logs],
  });

  // ── Phase: Visa + Quality enrichment (batched, skippable in fast mode) ──
  let enriched = deduped;
  if (!isFastScan() && deduped.length > 0) {
    setPhase('visa_detection', 'Detecting visa signals…');
    const visaStart = Date.now();
    const batchSize = 25;
    enriched = [];

    for (let i = 0; i < deduped.length; i += batchSize) {
      if (isAborted()) break;
      const batch = deduped.slice(i, i + batchSize);
      const enrichedBatch = batch.map((job) =>
        enrichJobQuality(job, { ...enrichOpts, isDuplicate: duplicateIds.has(job.id) })
      );
      enriched.push(...enrichedBatch);
      await onEnrichmentBatch(enrichedBatch);
      onProgress({
        phase: i + batchSize >= deduped.length ? 'quality_scoring' : 'visa_detection',
        message: `Enriched ${Math.min(i + batchSize, deduped.length)}/${deduped.length} jobs…`,
        progress: PHASE_PROGRESS.quality_scoring,
        jobsFound: enriched.length,
        partialResults: true,
        logs: [...logs],
      });
    }
    timings.phases.enrichmentMs = Date.now() - visaStart;
    pushLog(`Enrichment complete in ${formatMs(timings.phases.enrichmentMs)}`);
  } else {
    enriched = deduped.map((job) =>
      enrichJobQuality(job, { ...enrichOpts, isDuplicate: duplicateIds.has(job.id) })
    );
    if (enriched.length) await onEnrichmentBatch(enriched);
  }

  const matched = enriched.filter((j) => (j.score || 0) >= matchThreshold).length;
  const belowThreshold = enriched.filter((j) => (j.score || 0) < matchThreshold).length;
  const eligible = enriched.filter(
    (j) => (j.score || 0) >= 65 && j.autoApplyEligible !== false
  ).length;

  if (belowThreshold > 0) {
    fetchRejectionCounts.scoreBelowThreshold =
      (fetchRejectionCounts.scoreBelowThreshold || 0) + belowThreshold;
  }

  pushLog(
    `Pipeline — After Match (≥${matchThreshold}): ${matched} | Below threshold: ${belowThreshold} | Eligible: ${eligible}`
  );

  const filteredOut = Math.max(0, totalFetched - totalAfterFilters);
  const scanReport = buildScanReport(enriched, {
    totalFetched,
    afterFilter: totalAfterFilters,
    afterDedupe: deduped.length,
    filteredOut,
    duplicatesRemoved,
    timings,
    afterMatch: matched,
    autoApplyEligible: eligible,
    persisted: totalPersisted,
    rejectionCounts: fetchRejectionCounts,
    scoreBelowThreshold: belowThreshold,
    matchThreshold,
  });

  setPhase('completed', `Scan complete — ${enriched.length} jobs`);
  pushLog(
    `Summary: Fetched=${totalFetched} Filter=${totalAfterFilters} Dedupe=${deduped.length} Match=${matched} Persisted≈${totalPersisted}`
  );

  const finalSourceStatuses = enrichFailedStatuses(sourceStatuses, diagnostics);

  return {
    jobs: enriched,
    sourceStatuses: finalSourceStatuses,
    failedSources,
    logs,
    dedupedCount: enriched.length,
    jobsMatched: matched,
    eligibleCount: eligible,
    scanReport,
    diagnostics,
    aborted: false,
    phase: 'completed',
  };
}

export { dedupeJobsWithStats } from './dedupe.js';
export { SCAN_PHASES } from './scanConfig.js';
