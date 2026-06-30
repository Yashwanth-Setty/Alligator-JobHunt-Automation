import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Check, Circle, Loader2 } from 'lucide-react';

const DEFAULT_SOURCES = [
  { name: 'greenhouse', label: 'Greenhouse', status: 'pending', jobsFound: 0 },
  { name: 'lever', label: 'Lever', status: 'pending', jobsFound: 0 },
  { name: 'ashby', label: 'Ashby', status: 'pending', jobsFound: 0 },
  { name: 'smartrecruiters', label: 'SmartRecruiters', status: 'pending', jobsFound: 0 },
];

const PHASES = [
  { id: 'fetching', label: 'Fetching jobs' },
  { id: 'filtering', label: 'Filtering' },
  { id: 'deduplicating', label: 'Deduplicating' },
  { id: 'visa_detection', label: 'Visa detection' },
  { id: 'quality_scoring', label: 'Quality scoring' },
  { id: 'completed', label: 'Completed' },
];

export default function ScanProgress({ status, compact = false }) {
  if (!status || (status.status !== 'running' && status.status !== 'completed' && status.status !== 'cancelled')) {
    return null;
  }

  if (compact) {
    if (status.status !== 'running') return null;
    return (
      <div className="rounded-md border border-emerald-200/60 bg-emerald-50/30 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{status.message || 'Scanning…'}</span>
          <span className="font-medium tabular-nums">{status.progress || 0}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>
        {status.partialResults && (
          <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            Partial results appearing below as sources finish.
          </p>
        )}
      </div>
    );
  }

  const failed = status.failedSources?.length ? status.failedSources.join(', ') : 'None';
  const sourceStatuses =
    status.sourceStatuses?.length > 0 ? status.sourceStatuses : DEFAULT_SOURCES;
  const currentPhase = status.phase || (status.status === 'completed' ? 'completed' : 'fetching');
  const phaseIndex = PHASES.findIndex((p) => p.id === currentPhase);

  return (
    <Card className="border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Scan Progress</CardTitle>
        <p className="text-sm text-muted-foreground">{status.message}</p>
        {status.id && (
          <p className="font-mono text-[10px] text-muted-foreground">Scan ID: {status.id}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>

        <div className="rounded-md border bg-background/80 p-3">
          <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Scan phases</p>
          <div className="flex flex-wrap gap-2">
            {PHASES.map((phase, i) => {
              const done = phaseIndex > i || (currentPhase === 'completed' && phase.id === 'completed');
              const active = phase.id === currentPhase && status.status === 'running';
              return (
                <div
                  key={phase.id}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                    active
                      ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200'
                      : done
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                        : 'border-muted bg-muted/30 text-muted-foreground'
                  }`}
                >
                  {active ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : done ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  {phase.label}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Current source" value={status.currentSource || (status.status === 'completed' ? 'Done' : '—')} />
          <Stat label="Jobs found" value={status.jobsFound ?? 0} />
          <Stat label="Jobs matched" value={status.jobsMatched ?? 0} />
          <Stat label="Eligible" value={status.eligibleCount ?? 0} />
          <Stat label="Progress" value={`${status.progress || 0}%`} />
          <Stat label="Failed sources" value={failed} />
        </div>

        {status.partialResults && status.status === 'running' && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Partial results available — jobs appear below as sources finish.
          </p>
        )}

        <div className="rounded-md border bg-background/80 p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Source status</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sourceStatuses.map((src) => (
              <SourceRow key={src.name} source={src} />
            ))}
          </div>
        </div>

        {status.logs?.length > 0 && (
          <div className="rounded-md border bg-background/80 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Logs</p>
            <div className="max-h-32 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
              {status.logs.map((log, i) => (
                <div key={i}>
                  <span className="text-foreground/60">[{new Date(log.time).toLocaleTimeString()}]</span> {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SourceRow({ source }) {
  const statusLabel = {
    pending: 'Pending',
    scanning: 'Scanning…',
    completed: 'Completed',
    failed: 'Failed',
    skipped: 'Skipped',
  }[source.status] || source.status;

  const statusColor = {
    pending: 'text-muted-foreground',
    scanning: 'text-amber-600 dark:text-amber-400',
    completed: 'text-emerald-600 dark:text-emerald-400',
    failed: 'text-red-600 dark:text-red-400',
    skipped: 'text-muted-foreground',
  }[source.status] || 'text-muted-foreground';

  const persisted = source.jobsPersisted ?? source.jobsFound ?? 0;

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{source.label || source.name}</p>
          <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
        </div>
        <p className="font-semibold tabular-nums">{persisted}</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>Fetched: {source.jobsFetched ?? 0}</span>
        <span>Filtered: {source.jobsAfterFilters ?? 0}</span>
        <span>Persisted: {persisted}</span>
        <span>Eligible: {source.jobsEligible ?? 0}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold capitalize">{String(value)}</p>
    </div>
  );
}
