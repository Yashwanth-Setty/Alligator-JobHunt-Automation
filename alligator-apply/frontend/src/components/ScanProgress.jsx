import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

export default function ScanProgress({ status }) {
  if (!status || (status.status !== 'running' && status.status !== 'completed' && status.status !== 'cancelled')) {
    return null;
  }

  const failed = status.failedSources?.length ? status.failedSources.join(', ') : 'None';

  return (
    <Card className="border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Scan Progress</CardTitle>
        <p className="text-sm text-muted-foreground">{status.message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Current source" value={status.currentSource || (status.status === 'completed' ? 'Done' : '—')} />
          <Stat label="Jobs found" value={status.jobsFound ?? 0} />
          <Stat label="Jobs matched" value={status.jobsMatched ?? 0} />
          <Stat label="Eligible" value={status.eligibleCount ?? 0} />
          <Stat label="Progress" value={`${status.progress || 0}%`} />
          <Stat label="Failed sources" value={failed} />
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

function Stat({ label, value }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold capitalize">{String(value)}</p>
    </div>
  );
}
