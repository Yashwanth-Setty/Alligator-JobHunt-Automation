import { Loader2, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, formatStatus, statusVariant } from './ui/badge';
import { DataSourceBadge } from './DataModeBanner';
import { Button } from './ui/button';
import { Select } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const WORK_MODE_LABELS = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite' };

const SORT_OPTIONS = [
  { value: 'score', label: 'Match %' },
  { value: 'date_posted', label: 'Date posted' },
  { value: 'salary', label: 'Salary' },
  { value: 'company', label: 'Company' },
  { value: 'location', label: 'Location' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function JobsTable({
  jobs,
  onAction,
  onJobClick,
  scanCompleted,
  enriching,
  showRejections,
  sortBy,
  onSortChange,
  loading,
  pagination,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  if (!scanCompleted && !enriching) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Run a job hunt to discover matching roles.
      </p>
    );
  }

  if (loading && !jobs?.length) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading jobs…
      </div>
    );
  }

  if (!jobs?.length) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        {enriching
          ? 'Fetching jobs… results will appear shortly.'
          : 'No jobs in this view. Try the All Jobs tab or adjust filters.'}
      </p>
    );
  }

  const headers = [
    'Match', 'Job Title', 'Company', 'Location', 'Work Mode', 'Visa Fit', 'Source', 'Data Source',
    ...(showRejections ? ['Not Recommended Because'] : []),
    'Auto-Apply', 'Application Status', 'Actions',
  ];

  const total = pagination?.totalJobs ?? pagination?.total ?? jobs.length;
  const totalPages = pagination?.totalPages ?? 1;
  const currentPage = page ?? pagination?.page ?? 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card" style={{ height: '600px' }}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm text-muted-foreground">
          {total} jobs · Page {currentPage} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Rows</label>
          <Select
            value={String(pageSize || pagination?.limit || 25)}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
            className="h-8 w-16 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
          <label className="text-xs text-muted-foreground">Sort</label>
          <Select value={sortBy || 'score'} onChange={(e) => onSortChange?.(e.target.value)} className="h-8 w-36 text-sm">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className={`min-h-0 flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted/95 backdrop-blur">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2.5">
                  <span className={job.score >= 75 ? 'font-semibold text-emerald-600' : job.score >= 50 ? 'text-foreground' : 'text-muted-foreground'}>
                    {job.score}%
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onJobClick?.(job)}
                    className="text-left font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    {job.title}
                    {job.is_saved ? <span className="ml-1 text-amber-500">★</span> : null}
                  </button>
                </td>
                <td className="px-3 py-2.5">{job.company}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{job.location}</td>
                <td className="px-3 py-2.5">{WORK_MODE_LABELS[job.remote_type] || job.remote_type || '—'}</td>
                <td className="px-3 py-2.5"><VisaBadge fit={job.visa_fit} /></td>
                <td className="px-3 py-2.5 capitalize">{job.source}</td>
                <td className="px-3 py-2.5"><DataSourceBadge dataSource={job.data_source} /></td>
                {showRejections && (
                  <td className="max-w-[180px] px-3 py-2.5">
                    {job.rejection_reasons?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {job.rejection_reasons.map((r) => (
                          <span key={r} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{r}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-emerald-600">Recommended</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <Badge variant={job.auto_apply_eligible ? 'green' : 'gray'}>
                    {job.auto_apply_eligible ? 'Eligible' : 'Manual'}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={statusVariant(job.pipeline_status)}>{formatStatus(job.pipeline_status)}</Badge>
                </td>
                <td className="px-3 py-2.5">
                  <JobActions job={job} onAction={onAction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Showing {(currentPage - 1) * (pageSize || 25) + 1}–
          {Math.min(currentPage * (pageSize || 25), total)} of {total}
        </p>
        <PaginationBar
          page={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </div>
  );
}

function PaginationBar({ page, totalPages, onPageChange, loading }) {
  const pages = buildPageNumbers(page, totalPages);

  const handlePage = (target) => {
    if (target < 1 || target > totalPages || target === page) return;
    onPageChange?.(target);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page <= 1}
        onClick={() => handlePage(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            type="button"
            variant={p === page ? 'default' : 'outline'}
            size="sm"
            className="h-8 min-w-8 px-2"
            aria-current={p === page ? 'page' : undefined}
            onClick={() => handlePage(p)}
          >
            {p}
          </Button>
        )
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={page >= totalPages}
        onClick={() => handlePage(page + 1)}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (current > 3) pages.push(1, '…');
  for (let p = Math.max(1, current - 2); p <= Math.min(total, current + 2); p += 1) {
    pages.push(p);
  }
  if (current < total - 2) pages.push('…', total);
  return pages;
}

function VisaBadge({ fit }) {
  const normalized = normalizeVisaDisplay(fit);
  const label = normalized === 'positive' ? 'Positive' : normalized === 'negative' ? 'Negative' : 'Unknown';
  return <Badge variant={normalized === 'positive' ? 'green' : 'gray'}>{label}</Badge>;
}

function normalizeVisaDisplay(fit) {
  const v = (fit || 'unknown').toLowerCase();
  if (v === 'positive' || v.includes('cpt') || v.includes('sponsor')) return 'positive';
  if (v === 'negative' || v === 'review' || v.includes('no_sponsorship')) return 'negative';
  return 'unknown';
}

function JobActions({ job, onAction }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="sm" variant="outline" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAction('details', job)}>View Job</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('view', job)}>Open Apply URL</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('save', job)}>
          {job.is_saved ? 'Unsave Job' : 'Save Job'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('hide', job)}>Hide Job</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('applied', job)}>Mark Applied</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('interview', job)}>Mark Interview</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('rejected', job)}>Mark Rejected</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('notes', job)}>Add Notes</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('track', job)}>Track Application</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('packet', job)}>Generate Application Packet</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('autoApply', job)} disabled={!job.auto_apply_eligible}>
          Auto Apply
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
