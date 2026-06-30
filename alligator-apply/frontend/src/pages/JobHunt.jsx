import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { Loader2, Save, Zap, Download } from 'lucide-react';
import ScanControlCard from '@/components/ScanControlCard';
import AdvancedSourcesPanel from '@/components/AdvancedSourcesPanel';
import JobFilters from '@/components/JobFilters';
import HuntKpiCards from '@/components/HuntKpiCards';
import JobsTable from '@/components/JobsTable';
import JobResultsTabs, { ResultsDiagnostic } from '@/components/JobResultsTabs';
import LocationZeroResults from '@/components/LocationZeroResults';
import JobDetailDrawer from '@/components/JobDetailDrawer';
import ApplicationPacketModal from '@/components/ApplicationPacketModal';
import ManualReviewPanel from '@/components/ManualReviewPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSidebar } from '@/components/AppLayout';
import { useJobResults } from '@/hooks/useJobResults';
import { api } from '@/lib/api';
import { resultsScopeFiltersKey } from '@/lib/scanResultsScope';

const DEFAULT_FILTERS = { minScore: '50' };
const DEFAULT_TAB = 'all';

const AUTO_APPLY_CONFIRM =
  'This will fill eligible applications but will not submit final applications. It will pause for visa, EEO, salary, CAPTCHA, and final submit.';

export default function JobHunt() {
  const { refresh: refreshSidebar } = useSidebar();
  const [resume, setResume] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [quickStats, setQuickStats] = useState(null);
  const [eligible, setEligible] = useState(0);
  const [manualReview, setManualReview] = useState([]);
  const [scanStatus, setScanStatus] = useState(null);
  const [autoApplyStatus, setAutoApplyStatus] = useState(null);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [confirmAutoApply, setConfirmAutoApply] = useState(false);
  const [sourcesConfig, setSourcesConfig] = useState(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [mockMode, setMockMode] = useState(false);
  const [resultsTab, setResultsTab] = useState(DEFAULT_TAB);
  const [sortBy, setSortBy] = useState('score');
  const [selectedJob, setSelectedJob] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [packetResult, setPacketResult] = useState(null);
  const [packetModalOpen, setPacketModalOpen] = useState(false);
  const [resultsScanRunId, setResultsScanRunId] = useState(null);
  const [sessionScopeKey, setSessionScopeKey] = useState(null);
  const resultsScanRunIdRef = useRef(null);
  const completionHandledRef = useRef(null);
  const allowScopeClearRef = useRef(false);

  useEffect(() => {
    resultsScanRunIdRef.current = resultsScanRunId;
  }, [resultsScanRunId]);

  const setResultsScanRunIdKeep = useCallback((runId) => {
    resultsScanRunIdRef.current = runId;
    setResultsScanRunId(runId);
  }, []);

  const apiFilters = useMemo(() => {
    const { salaryMinK, salaryMaxK, page: _page, ...rest } = filters;
    return { ...rest, salaryMinK, salaryMaxK };
  }, [filters]);

  const hasResume = Boolean(resume?.loaded);
  const scanRunning = scanStatus?.status === 'running';
  const scanCompletedForSession = scanCompleted && scanStatus?.status === 'completed';
  const currentScopeKey = useMemo(() => resultsScopeFiltersKey(apiFilters), [apiFilters]);
  /** Keep results visible once we have a scanRunId (running or completed). */
  const showResults = Boolean(resultsScanRunId);
  const enriching = scanRunning && showResults;
  const canAutoApply = hasResume && scanCompletedForSession && eligible > 0 && !scanRunning && !mockMode;

  const canFetchResults = Boolean(resultsScanRunId);

  useEffect(() => {
    if (!allowScopeClearRef.current) return;
    if (!sessionScopeKey || !resultsScanRunId) return;
    if (currentScopeKey !== sessionScopeKey) {
      console.log('[JobHunt] scope filters changed — clearing resultsScanRunId', {
        was: sessionScopeKey,
        now: currentScopeKey,
      });
      setScanCompleted(false);
      completionHandledRef.current = null;
      setResultsScanRunIdKeep(null);
    }
  }, [currentScopeKey, sessionScopeKey, resultsScanRunId, setResultsScanRunIdKeep]);

  const {
    jobs,
    pagination,
    funnel,
    locationHints,
    locationFallback,
    loading,
    reload,
    goToPage,
    changePageSize,
    removeJob,
    updateJobInList,
    pageSize,
    page,
  } = useJobResults({
    apiFilters,
    tab: resultsTab,
    sortBy,
    scanRunId: resultsScanRunId,
    requireScanRunId: true,
    enabled: canFetchResults,
  });

  const loadQuickStats = useCallback(async (scanRunId) => {
    if (!scanRunId) return;
    try {
      const kpiParams = { ...apiFilters, scanRunId };
      console.log('[JobHunt] getKpi scanRunId=', scanRunId);
      const [kpiData, stats, savedRes] = await Promise.all([
        api.getKpi(kpiParams),
        api.getStats(),
        api.getJobs({ savedOnly: 'true', page: 1, limit: 1 }),
      ]);
      const interviews =
        (stats.recruiter_screen || 0) +
        (stats.hr_round || 0) +
        (stats.technical_interview || 0) +
        (stats.final_interview || 0);
      setQuickStats({
        jobsFound: kpiData.jobsFound ?? 0,
        strongMatches: kpiData.matched ?? 0,
        saved: kpiData.saved ?? savedRes.pagination?.total ?? 0,
        applied: kpiData.applied ?? 0,
        interviews,
      });
    } catch {
      setQuickStats(null);
    }
  }, [apiFilters]);

  const parseSearchFilters = (searchFilters) => {
    if (!searchFilters) return null;
    try {
      return typeof searchFilters === 'string' ? JSON.parse(searchFilters) : searchFilters;
    } catch {
      return null;
    }
  };

  const applyScanScope = useCallback((s, { logLabel = 'refreshMeta' } = {}) => {
    const runId = s.scanId || s.id;
    if (runId && (s.status === 'running' || s.status === 'completed')) {
      if (resultsScanRunIdRef.current !== runId) {
        console.log(`[JobHunt] ${logLabel} resultsScanRunId=`, runId, 'status=', s.status);
      }
      setResultsScanRunIdKeep(runId);
    }
    if (s.status === 'completed' && runId) {
      setScanCompleted(true);
      console.log('[JobHunt] scan completed id=', runId);
    }
    const parsed = parseSearchFilters(s.searchFilters);
    if (parsed && !sessionScopeKey) {
      setSessionScopeKey(resultsScopeFiltersKey(parsed));
    }
    return runId;
  }, [sessionScopeKey, setResultsScanRunIdKeep]);

  const refreshMeta = useCallback(
    async (scanRunIdOverride) => {
      api.getEligibleCount().then((r) => setEligible(r.count)).finally(refreshSidebar);
      api.getManualReview().then(setManualReview);
      api.getAutoApplyStatus().then(setAutoApplyStatus);
      api.getSources().then(setSourcesConfig).catch(() => {});

      const s = await api.getScanStatus();
      setScanStatus(s);
      const runId = applyScanScope(s, { logLabel: 'refreshMeta' });
      const kpiScope = scanRunIdOverride ?? runId ?? resultsScanRunIdRef.current;
      if (kpiScope) {
        loadQuickStats(kpiScope);
      }
    },
    [applyScanScope, loadQuickStats, refreshSidebar]
  );

  const loadResume = () =>
    api.getResume().then(setResume).catch(() => setResume({ loaded: false })).finally(refreshSidebar);

  useEffect(() => {
    loadResume();
    api.health().then((h) => setMockMode(Boolean(h.mockMode))).catch(() => {});
    const saved = api.loadSavedSearch();
    if (saved) {
      setFilters(saved);
      setSessionScopeKey(resultsScopeFiltersKey(saved));
    }
    refreshMeta().finally(() => {
      requestAnimationFrame(() => {
        allowScopeClearRef.current = true;
      });
    });
  }, [refreshMeta]);

  useEffect(() => {
    if (!funnel) return;
    setQuickStats((prev) => ({
      ...(prev || {}),
      jobsFound: pagination.total ?? funnel.afterFilters ?? funnel.jobsFound ?? prev?.jobsFound ?? 0,
      strongMatches: funnel.recommended ?? funnel.afterMatch ?? prev?.strongMatches ?? 0,
    }));
  }, [funnel?.afterFilters, funnel?.recommended, funnel?.afterMatch, funnel?.jobsFound, pagination.total]);

  useEffect(() => {
    if (scanStatus?.status !== 'completed') return;
    const runId = scanStatus.scanId || scanStatus.id;
    if (!runId || completionHandledRef.current === runId) return;
    completionHandledRef.current = runId;
    setResultsScanRunIdKeep(runId);
    setScanCompleted(true);
    console.log('[JobHunt] scan completed id=', runId);
    reload(runId);
    loadQuickStats(runId);
  }, [scanStatus?.status, scanStatus?.scanId, scanStatus?.id, reload, loadQuickStats, setResultsScanRunIdKeep]);

  useEffect(() => {
    if (!scanRunning && autoApplyStatus?.status !== 'running') return;
    const id = setInterval(() => {
      api.getScanStatus().then((s) => {
        setScanStatus(s);
        const runId = s.scanId || s.id;

        if (s.status === 'running' && runId) {
          setResultsScanRunIdKeep(runId);
        }

        const partial = s.status === 'running' && (s.partialResults || (s.jobsFound ?? 0) > 0);
        if (partial && runId) {
          console.log('[JobHunt] partial results during scan scanRunId=', runId, 'jobs=', s.jobsFound);
          reload(runId);
          refreshMeta(runId);
        } else if (s.status === 'completed' && runId) {
          applyScanScope(s, { logLabel: 'poll-complete' });
          reload(runId);
          refreshMeta(runId);
        }
      });
      api.getAutoApplyStatus().then(setAutoApplyStatus);
    }, 800);
    return () => clearInterval(id);
  }, [scanRunning, autoApplyStatus?.status, refreshMeta, reload, applyScanScope, setResultsScanRunIdKeep]);

  useEffect(() => {
    if (autoApplyStatus?.status === 'completed') refreshMeta();
  }, [autoApplyStatus?.status, refreshMeta]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const openJobDetails = async (job) => {
    try {
      const detail = await api.getJob(job.id, apiFilters);
      setSelectedJob(detail);
      setDrawerOpen(true);
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleTabChange = (tab) => setResultsTab(tab);

  const handleStartHunt = async () => {
    try {
      const { salaryMinK, salaryMaxK, ...rest } = filters;
      const payload = { ...rest };
      if (salaryMinK) payload.salaryMin = String(Number(salaryMinK) * 1000);
      if (salaryMaxK) payload.salaryMax = String(Number(salaryMaxK) * 1000);
      console.log('[JobHunt] scan request payload', payload);
      completionHandledRef.current = null;
      setScanCompleted(false);
      setResultsScanRunIdKeep(null);
      setSessionScopeKey(resultsScopeFiltersKey({ ...rest }));
      setResultsTab(DEFAULT_TAB);
      setScanStatus({
        status: 'running',
        progress: 0,
        message: 'Starting job hunt…',
        jobsFound: 0,
        partialResults: false,
      });
      const result = await api.startScan(payload);
      const runId = result.scanId || result.status?.scanId || result.status?.id;
      if (runId) {
        setResultsScanRunIdKeep(runId);
        console.log('[JobHunt] scan started id=', runId);
      }
      setScanStatus(result.status || { status: 'running' });
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleStopScan = async () => {
    await api.stopScan();
    api.getScanStatus().then(setScanStatus);
  };

  const handleSaveSearch = () => {
    api.saveSearch(filters);
    showToast('Search filters saved');
  };

  const handleToggleSource = async (name, enabled) => {
    setSourcesLoading(true);
    try {
      const cfg = await api.toggleSource(name, enabled);
      setSourcesConfig(cfg);
      showToast(`${name} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      showToast(e.message);
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportJobs({ ...apiFilters, tab: resultsTab });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alligator-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Export downloaded');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleConfirmAutoApply = async () => {
    setConfirmAutoApply(false);
    await api.startBatchAutoApply();
    api.getAutoApplyStatus().then(setAutoApplyStatus);
  };

  const handleJobAction = async (action, job) => {
    try {
      if (action === 'details') {
        await openJobDetails(job);
        return;
      }
      if (action === 'view' && (job.url || job.apply_url)) {
        window.open(job.url || job.apply_url, '_blank', 'noopener');
        return;
      }
      if (action === 'save') {
        const updated = await api.updateJob(job.id, { action: job.is_saved ? 'unsave' : 'save' });
        updateJobInList(updated);
        showToast(job.is_saved ? 'Job unsaved' : 'Job saved');
        refreshMeta();
        return;
      }
      if (action === 'hide') {
        await api.updateJob(job.id, { action: 'hide' });
        removeJob(job.id);
        showToast('Job hidden');
        reload();
        return;
      }
      if (action === 'applied' || action === 'interview' || action === 'rejected') {
        const updated = await api.updateJob(job.id, { action });
        updateJobInList(updated);
        showToast(`Marked as ${action}`);
        refreshMeta();
        return;
      }
      if (action === 'notes') {
        const notes = window.prompt('Add notes for this job:', job.notes || '');
        if (notes === null) return;
        const updated = await api.updateJob(job.id, { notes });
        updateJobInList(updated);
        showToast('Notes saved');
        return;
      }
      if (action === 'track') {
        await api.trackApplication(job.id);
        showToast(`Tracking ${job.title} at ${job.company}`);
        refreshMeta();
        reload();
      }
      if (action === 'packet') {
        const r = await api.generatePacket(job.id);
        setPacketResult(r);
        setPacketModalOpen(true);
        showToast(r.message || 'Application packet generated');
        refreshMeta();
        reload();
      }
      if (action === 'autoApply') {
        const r = await api.autoApplyJob(job.id);
        showToast(r.message);
        refreshMeta();
        reload();
      }
      if (action === 'manual') {
        await api.moveToManual(job.id, { reason: 'unknown_field', details: 'Moved manually from results' });
        refreshMeta();
        reload();
      }
      if (action === 'skip') {
        await api.skipJob(job.id);
        refreshMeta();
        reload();
      }
    } catch (e) {
      showToast(e.message);
    }
  };

  const tabCounts = {
    all: pagination.total ?? funnel?.afterFilters ?? 0,
    recommended: funnel?.recommended ?? funnel?.afterMatch ?? 0,
    auto_apply: funnel?.autoApplyEligible ?? funnel?.eligible ?? 0,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job Hunt</h1>
        <p className="text-sm text-muted-foreground">Upload resume, scan, and review matching roles.</p>
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {toast}
        </div>
      )}

      <ScanControlCard
        resume={resume}
        onResumeChange={() => {
          loadResume();
          refreshMeta();
        }}
        filters={filters}
        onFiltersChange={setFilters}
        disabled={scanRunning}
        hasResume={hasResume}
        scanRunning={scanRunning}
        scanStatus={scanStatus}
        onStartScan={handleStartHunt}
        onStopScan={handleStopScan}
        advancedFilters={<JobFilters filters={filters} onChange={setFilters} disabled={scanRunning} advanced />}
        advancedSources={
          <AdvancedSourcesPanel
            config={sourcesConfig}
            onToggle={handleToggleSource}
            loading={sourcesLoading || scanRunning}
          />
        }
      />

      <HuntKpiCards stats={quickStats} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Job Results</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSaveSearch}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save search
            </Button>
            {canAutoApply && (
              <Button size="sm" onClick={() => setConfirmAutoApply(true)} disabled={autoApplyStatus?.status === 'running'}>
                {autoApplyStatus?.status === 'running' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                )}
                Auto apply ({eligible})
              </Button>
            )}
            {showResults && pagination.total > 0 && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
            )}
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {mockMode && (
          <p className="text-xs text-muted-foreground">Auto apply is disabled in mock mode.</p>
        )}

        <JobResultsTabs
          activeTab={resultsTab}
          onTabChange={handleTabChange}
          funnel={funnel}
          tabCounts={tabCounts}
          scanJobsFound={scanStatus?.jobsFound ?? 0}
          visibleCount={Math.min(pagination.total ?? 0, scanStatus?.jobsFound ?? pagination.total ?? 0)}
          loading={loading}
        />

        <LocationZeroResults
          hints={locationHints}
          locationFallback={locationFallback}
          scanCompleted={scanCompleted}
        />

        <ResultsDiagnostic
          funnel={funnel}
          tab={resultsTab}
          displayed={pagination.total}
          onSwitchToAll={() => handleTabChange('all')}
        />

        <JobsTable
          jobs={jobs}
          scanCompleted={showResults}
          enriching={enriching}
          showRejections={resultsTab === 'all'}
          sortBy={sortBy}
          onSortChange={setSortBy}
          loading={loading}
          pagination={pagination}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
          onJobClick={openJobDetails}
          onAction={handleJobAction}
        />
      </section>

      {manualReview.length > 0 && (
        <ManualReviewPanel
          items={manualReview}
          onResolve={async (id, action, jobId) => {
            await api.resolveManualReview(id, { action, jobId });
            refreshMeta();
            reload();
          }}
          onRetry={async (jobId) => {
            await api.autoApplyJob(jobId);
            refreshMeta();
            reload();
          }}
        />
      )}

      <JobDetailDrawer
        job={selectedJob}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        filters={apiFilters}
        onGeneratePacket={async (job) => {
          try {
            const r = await api.generatePacket(job.id);
            setPacketResult(r);
            setPacketModalOpen(true);
            showToast(r.message || 'Application packet generated');
            refreshMeta();
            reload();
          } catch (e) {
            showToast(e.message);
          }
        }}
      />

      <ApplicationPacketModal
        open={packetModalOpen}
        packetResult={packetResult}
        onClose={() => setPacketModalOpen(false)}
      />

      <Dialog open={confirmAutoApply} onClose={() => setConfirmAutoApply(false)}>
        <DialogTitle>Review & Auto Apply</DialogTitle>
        <DialogDescription>{AUTO_APPLY_CONFIRM}</DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmAutoApply(false)}>Cancel</Button>
          <Button onClick={handleConfirmAutoApply}>Continue</Button>
        </div>
      </Dialog>
    </div>
  );
}
