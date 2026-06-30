import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const DEFAULT_PAGE_SIZE = 25;

function normalizeJobsResponse(res) {
  const jobs = res.jobs ?? res.data ?? [];
  const page = res.page ?? res.pagination?.page ?? 1;
  const limit = res.limit ?? res.pagination?.limit ?? DEFAULT_PAGE_SIZE;
  const total = res.totalJobs ?? res.pagination?.total ?? jobs.length;
  const totalPages = res.totalPages ?? res.pagination?.totalPages ?? 1;
  return {
    jobs,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      totalJobs: total,
      hasMore: page < totalPages,
      returned: jobs.length,
    },
    filterPipeline: res.filterPipeline || null,
    locationFallback: res.locationFallback || null,
    locationHints: res.locationHints || null,
  };
}

function logFilterPipeline(pipeline, scanRunId) {
  if (!pipeline) return;
  console.log(
    `[JobResults] scanRunId=${scanRunId ?? 'auto'} totalJobs=${pipeline.totalJobs} afterKeywordFilter=${pipeline.afterKeywordFilter} afterLocationFilter=${pipeline.afterLocationFilter} renderedJobs=${pipeline.renderedJobs}`
  );
}

function buildListParams(f, t, s, o, pageNum, limit, runId) {
  const params = {
    ...f,
    page: pageNum,
    limit,
    tab: t,
    sortBy: s,
    sortOrder: o,
    order: o,
  };
  if (runId) params.scanRunId = runId;
  return params;
}

export function useJobResults({
  apiFilters,
  tab,
  sortBy,
  sortOrder = 'desc',
  enabled,
  scanRunId,
  requireScanRunId = false,
}) {
  const [jobs, setJobs] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalJobs: 0,
    totalPages: 1,
    limit: DEFAULT_PAGE_SIZE,
    hasMore: false,
    returned: 0,
  });
  const [funnel, setFunnel] = useState(null);
  const [locationHints, setLocationHints] = useState(null);
  const [locationFallback, setLocationFallback] = useState(null);
  const [filterPipeline, setFilterPipeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const pageRef = useRef(1);
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);

  const filtersRef = useRef({
    apiFilters,
    tab,
    sortBy,
    sortOrder,
    enabled,
    scanRunId,
    requireScanRunId,
  });
  filtersRef.current = { apiFilters, tab, sortBy, sortOrder, enabled, scanRunId, requireScanRunId };

  const queryKey = JSON.stringify({ tab, sortBy, sortOrder, apiFilters, scanRunId, requireScanRunId });

  const emptyPagination = {
    page: 1,
    total: 0,
    totalJobs: 0,
    totalPages: 1,
    limit: DEFAULT_PAGE_SIZE,
    hasMore: false,
    returned: 0,
  };

  const fetchPage = useCallback(async (pageNum, limit, { refreshFunnel = false, scanRunIdOverride } = {}) => {
    const {
      apiFilters: f,
      tab: t,
      sortBy: s,
      sortOrder: o,
      enabled: on,
      scanRunId: runId,
      requireScanRunId: mustHaveRunId,
    } = filtersRef.current;
    if (!on) return;

    const effectiveRunId = scanRunIdOverride ?? runId;
    if (mustHaveRunId && !effectiveRunId) {
      console.log('[JobResults] skip fetch — scanRunId required but not set');
      return;
    }

    const reqId = ++requestIdRef.current;
    setError(null);
    setLoading(true);

    try {
      const jobParams = buildListParams(f, t, s, o, pageNum, limit, effectiveRunId);
      const funnelParams = { ...f };
      if (effectiveRunId) funnelParams.scanRunId = effectiveRunId;

      console.log('[JobResults] getFunnel scanRunId=', effectiveRunId ?? 'none', 'tab=', t);
      console.log('[JobResults] getJobs scanRunId=', effectiveRunId ?? 'none', 'tab=', t, 'page=', pageNum);

      const [res, funnelRes] = await Promise.all([
        api.getJobs(jobParams),
        refreshFunnel ? api.getJobFunnel(funnelParams) : Promise.resolve(null),
      ]);

      if (reqId !== requestIdRef.current) return;

      const normalized = normalizeJobsResponse(res);
      logFilterPipeline(normalized.filterPipeline, effectiveRunId);

      setJobs(normalized.jobs);
      setPagination(normalized.pagination);
      setFilterPipeline(normalized.filterPipeline);
      setLocationFallback(normalized.locationFallback);
      setLocationHints(normalized.locationHints);
      setPage(normalized.pagination.page);
      pageRef.current = normalized.pagination.page;

      if (funnelRes) {
        logFilterPipeline(funnelRes.filterPipeline, effectiveRunId);
        setFunnel(funnelRes);
        if (funnelRes.locationFallback) {
          setLocationFallback(funnelRes.locationFallback);
        }
      }
    } catch (err) {
      if (reqId === requestIdRef.current) setError(err.message);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const goToPage = useCallback(
    (nextPage) => {
      const totalPages = pagination.totalPages || 1;
      const target = Math.max(1, Math.min(Number(nextPage), totalPages));
      pageRef.current = target;
      setPage(target);
      fetchPage(target, pageSizeRef.current);
    },
    [fetchPage, pagination.totalPages]
  );

  const changePageSize = useCallback(
    (nextSize) => {
      const limit = Number(nextSize) || DEFAULT_PAGE_SIZE;
      pageSizeRef.current = limit;
      setPageSize(limit);
      pageRef.current = 1;
      setPage(1);
      fetchPage(1, limit, { refreshFunnel: true });
    },
    [fetchPage]
  );

  const reload = useCallback(
    (scanRunIdOverride) => {
      fetchPage(pageRef.current, pageSizeRef.current, {
        refreshFunnel: true,
        scanRunIdOverride,
      });
    },
    [fetchPage]
  );

  const prevQueryKeyRef = useRef(null);
  const prevEnabledRef = useRef(enabled);
  useEffect(() => {
    if (prevEnabledRef.current !== enabled) {
      console.log('[JobResults] enabled=', enabled, 'scanRunId=', scanRunId ?? 'none');
      prevEnabledRef.current = enabled;
    }
    if (!enabled) {
      if (!scanRunId) {
        prevQueryKeyRef.current = null;
        setJobs([]);
        setPagination(emptyPagination);
        setFunnel(null);
        setLocationHints(null);
        setLocationFallback(null);
        setFilterPipeline(null);
      }
      return;
    }
    const queryChanged = prevQueryKeyRef.current !== queryKey;
    prevQueryKeyRef.current = queryKey;
    if (queryChanged) {
      pageRef.current = 1;
      setPage(1);
      fetchPage(1, pageSizeRef.current, { refreshFunnel: true });
    }
  }, [enabled, queryKey, fetchPage]);

  const removeJob = useCallback((jobId) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setPagination((p) => ({
      ...p,
      total: Math.max(0, p.total - 1),
      totalJobs: Math.max(0, (p.totalJobs ?? p.total) - 1),
    }));
  }, []);

  const updateJobInList = useCallback((updated) => {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)));
  }, []);

  return {
    jobs,
    pagination,
    funnel,
    locationHints,
    locationFallback,
    filterPipeline,
    loading,
    error,
    reload,
    goToPage,
    changePageSize,
    pageSize,
    page,
    removeJob,
    updateJobInList,
  };
}
