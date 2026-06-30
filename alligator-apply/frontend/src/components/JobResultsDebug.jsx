import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function JobResultsDebug({ pagination, jobsLength, tab, sortBy }) {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    api.getScanMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, [pagination.total, pagination.page, jobsLength]);

  return (
    <div className="rounded-md border border-dashed border-blue-300 bg-blue-50/50 p-3 font-mono text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
      <p className="mb-1 font-semibold">Debug — data integrity</p>
      <div className="grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
        <span>Last scan ID: {metrics?.scanId || '—'}</span>
        <span>Jobs fetched (report): {metrics?.jobsFetched ?? metrics?.scanReport?.totalFetched ?? '—'}</span>
        <span>Jobs persisted (DB): {metrics?.jobsFound ?? '—'}</span>
        <span>After filter: {metrics?.scanReport?.pipeline?.afterFilter ?? metrics?.scanReport?.afterFilter ?? '—'}</span>
        <span>After match: {metrics?.scanReport?.pipeline?.afterMatch ?? metrics?.scanReport?.afterMatch ?? '—'}</span>
        <span>Eligible (DB): {metrics?.eligible ?? '—'}</span>
        <span>Jobs displayed (page): {jobsLength}</span>
        <span>Tab: {tab}</span>
        <span>Sort: {sortBy}</span>
        <span>Current page: {pagination.page}</span>
        <span>Total pages: {pagination.totalPages}</span>
        <span>Total jobs (API): {pagination.total}</span>
        <span>Rows per page: {pagination.limit}</span>
      </div>
    </div>
  );
}
