import {
  SOURCE_META,
  addTarget,
  getLastCompletedScanRow,
  getEnabledSourceNames,
  getEnabledTargetsForSource,
  listJobSources,
  listSourceTargets,
  removeTarget,
  replaceTargets,
  safeJson,
  seedSourcesIfEmpty,
  setSourceEnabled,
} from './sourceStore.js';

export { getEnabledSourceNames, getEnabledTargetsForSource } from './sourceStore.js';

export function getSourcesConfig(liveScanStatus = null) {
  seedSourcesIfEmpty();

  const sources = listJobSources().map((row) => ({
    name: row.source,
    label: row.label,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  }));

  const targets = listSourceTargets().map((row) => ({
    id: row.id,
    source: row.source,
    slug: row.target_slug,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const lastScan = buildLastScanSummary();
  const scan = liveScanStatus || {};

  const sourcesWithStatus = sources.map((src) => {
    const liveRow = (scan.sourceStatuses || []).find((s) => s.name === src.name);
    const lastRow = (lastScan?.sourceStatuses || []).find((s) => s.name === src.name);

    let status = 'disabled';
    if (src.enabled) {
      if (scan.status === 'running' && liveRow?.status === 'scanning') status = 'scanning';
      else if (liveRow?.status === 'failed' || lastRow?.status === 'failed') status = 'failed';
      else if (liveRow?.status === 'completed' || lastRow?.status === 'completed') status = 'completed';
      else status = 'enabled';
    }

    return {
      ...src,
      status,
      jobsFetched: liveRow?.jobsFetched ?? lastRow?.jobsFetched ?? 0,
      jobsAfterFilters: liveRow?.jobsAfterFilters ?? lastRow?.jobsAfterFilters ?? 0,
      lastScanTime: lastRow?.finishedAt || lastScan?.finishedAt || null,
      error: liveRow?.error || lastRow?.error || null,
      targets: targets.filter((t) => t.source === src.name),
    };
  });

  return {
    sources: sourcesWithStatus,
    targets,
    mockMode: process.env.MOCK_MODE !== 'false',
    lastScan,
  };
}

function buildLastScanSummary() {
  const row = getLastCompletedScanRow();
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobsFound: row.jobs_found,
    jobsMatched: row.jobs_matched,
    eligibleCount: row.eligible_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceStatuses: safeJson(row.source_summary, []),
    scanReport: safeJson(row.scan_report, null),
    failedSources: safeJson(row.failed_sources, []),
  };
}

export function updateSourceEnabled(sourceName, enabled) {
  setSourceEnabled(sourceName, enabled);
  return getSourcesConfig();
}

export function updateSourcesEnabled(updates) {
  for (const { name, enabled } of updates) {
    setSourceEnabled(name, enabled);
  }
  return getSourcesConfig();
}

export function addSourceTarget(source, slug) {
  addTarget(source, slug);
  return getSourcesConfig();
}

export function removeSourceTarget(id) {
  removeTarget(id);
  return getSourcesConfig();
}

export function setSourceTargets(source, slugs) {
  replaceTargets(source, slugs);
  return getSourcesConfig();
}

export { SOURCE_META };
