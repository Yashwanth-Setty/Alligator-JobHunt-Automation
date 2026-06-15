import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Square, Save, Zap } from 'lucide-react';
import ResumeUpload from '@/components/ResumeUpload';
import JobFilters from '@/components/JobFilters';
import HuntKpiCards from '@/components/HuntKpiCards';
import ScanProgress from '@/components/ScanProgress';
import JobsTable from '@/components/JobsTable';
import ManualReviewPanel from '@/components/ManualReviewPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSidebar } from '@/components/AppLayout';
import { api } from '@/lib/api';

const DEFAULT_FILTERS = { minScore: '50' };

const AUTO_APPLY_CONFIRM =
  'This will fill eligible applications but will not submit final applications. It will pause for visa, EEO, salary, CAPTCHA, and final submit.';

export default function JobHunt() {
  const { refresh: refreshSidebar } = useSidebar();
  const [resume, setResume] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [jobs, setJobs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [kpi, setKpi] = useState(null);
  const [eligible, setEligible] = useState(0);
  const [manualReview, setManualReview] = useState([]);
  const [scanStatus, setScanStatus] = useState(null);
  const [autoApplyStatus, setAutoApplyStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [confirmAutoApply, setConfirmAutoApply] = useState(false);
  const [toast, setToast] = useState('');

  const hasResume = Boolean(resume?.loaded);
  const scanRunning = scanStatus?.status === 'running';
  const canAutoApply = hasResume && scanCompleted && eligible > 0 && !scanRunning;

  const apiFilters = useMemo(() => {
    const { salaryMinK, salaryMaxK, ...rest } = filters;
    return { ...rest, salaryMinK, salaryMaxK, page: undefined };
  }, [filters]);

  const loadResume = () =>
    api.getResume().then(setResume).catch(() => setResume({ loaded: false })).finally(refreshSidebar);

  const loadKpi = () => api.getKpi().then(setKpi).catch(() => {});

  const loadJobs = useCallback((page = 1) => {
    if (!scanCompleted) return;
    setLoading(true);
    api.getJobs({ page, limit: 10, ...apiFilters })
      .then((res) => {
        setJobs(res.data);
        setPagination(res.pagination);
      })
      .finally(() => setLoading(false));
  }, [apiFilters, scanCompleted]);

  const refreshMeta = useCallback(() => {
    loadKpi();
    api.getEligibleCount().then((r) => setEligible(r.count)).finally(refreshSidebar);
    api.getManualReview().then(setManualReview);
    api.getScanStatus().then((s) => {
      setScanStatus(s);
      if (s.status === 'completed') setScanCompleted(true);
    });
    api.getAutoApplyStatus().then(setAutoApplyStatus);
  }, [refreshSidebar]);

  useEffect(() => {
    loadResume();
    const saved = api.loadSavedSearch();
    if (saved) setFilters(saved);
    api.getScanStatus().then((s) => {
      setScanStatus(s);
      if (s.status === 'completed') setScanCompleted(true);
    });
    refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    if (scanCompleted) loadJobs(pagination.page);
  }, [scanCompleted, loadJobs, pagination.page, apiFilters]);

  useEffect(() => {
    if (!scanRunning && autoApplyStatus?.status !== 'running') return;
    const id = setInterval(() => {
      api.getScanStatus().then((s) => {
        setScanStatus(s);
        if (s.status === 'completed') {
          setScanCompleted(true);
          refreshMeta();
          loadJobs(1);
        }
      });
      api.getAutoApplyStatus().then(setAutoApplyStatus);
    }, 800);
    return () => clearInterval(id);
  }, [scanRunning, autoApplyStatus?.status, refreshMeta, loadJobs]);

  useEffect(() => {
    if (autoApplyStatus?.status === 'completed') refreshMeta();
  }, [autoApplyStatus?.status, refreshMeta]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleStartHunt = async () => {
    try {
      const { salaryMinK, salaryMaxK, ...rest } = filters;
      const payload = { ...rest };
      if (salaryMinK) payload.salaryMin = String(Number(salaryMinK) * 1000);
      if (salaryMaxK) payload.salaryMax = String(Number(salaryMaxK) * 1000);
      await api.startScan(payload);
      setScanCompleted(false);
      setJobs([]);
      api.getScanStatus().then(setScanStatus);
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

  const handleConfirmAutoApply = async () => {
    setConfirmAutoApply(false);
    await api.startBatchAutoApply();
    api.getAutoApplyStatus().then(setAutoApplyStatus);
  };

  const handleJobAction = async (action, job) => {
    try {
      if (action === 'view' && job.url) window.open(job.url, '_blank');
      if (action === 'packet') {
        const r = await api.generatePacket(job.id);
        showToast(r.message);
        refreshMeta();
        loadJobs(pagination.page);
      }
      if (action === 'autoApply') {
        const r = await api.autoApplyJob(job.id);
        showToast(r.message);
        refreshMeta();
        loadJobs(pagination.page);
      }
      if (action === 'manual') {
        await api.moveToManual(job.id, { reason: 'unknown_field', details: 'Moved manually from results' });
        refreshMeta();
        loadJobs(pagination.page);
      }
      if (action === 'skip') {
        await api.skipJob(job.id);
        refreshMeta();
        loadJobs(pagination.page);
      }
    } catch (e) {
      showToast(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job Hunt</h1>
        <p className="text-sm text-muted-foreground">
          Resume → Filters → Scan → Results → Apply → Track
        </p>
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {toast}
        </div>
      )}

      <HuntKpiCards kpi={kpi} />

      {/* 1. Resume */}
      <ResumeUpload resume={resume} onChange={() => { loadResume(); refreshMeta(); }} />

      {/* 2. Filters */}
      <JobFilters filters={filters} onChange={setFilters} disabled={scanRunning} />

      {/* 3. Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleStartHunt} disabled={!hasResume || scanRunning}>
          {scanRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Run Job Hunt
        </Button>
        <Button variant="outline" onClick={handleStopScan} disabled={!scanRunning}>
          <Square className="mr-2 h-4 w-4" />
          Stop Scan
        </Button>
        <Button variant="outline" onClick={handleSaveSearch}>
          <Save className="mr-2 h-4 w-4" />
          Save Search
        </Button>
        <Button onClick={() => setConfirmAutoApply(true)} disabled={!canAutoApply || autoApplyStatus?.status === 'running'}>
          {autoApplyStatus?.status === 'running' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          Review & Auto Apply Eligible Jobs ({eligible})
        </Button>
      </div>

      {!hasResume && (
        <p className="text-sm text-amber-700 dark:text-amber-400">Upload your resume to start job matching.</p>
      )}

      {/* 4. Scan progress */}
      {(scanRunning || scanStatus?.status === 'completed' || scanStatus?.status === 'cancelled') && (
        <ScanProgress status={scanStatus} />
      )}

      {/* 5. Results */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Job Results</h2>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <JobsTable jobs={jobs} scanCompleted={scanCompleted} onAction={handleJobAction} />
        {scanCompleted && pagination.total > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} jobs
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => loadJobs(pagination.page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => loadJobs(pagination.page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 6. Manual review */}
      <ManualReviewPanel
        items={manualReview}
        onResolve={async (id, action, jobId) => {
          await api.resolveManualReview(id, { action, jobId });
          refreshMeta();
          loadJobs(pagination.page);
        }}
        onRetry={async (jobId) => {
          await api.autoApplyJob(jobId);
          refreshMeta();
          loadJobs(pagination.page);
        }}
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
