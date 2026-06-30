import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const STATUS_STYLES = {
  enabled: 'text-emerald-600',
  disabled: 'text-muted-foreground',
  scanning: 'text-amber-600',
  completed: 'text-emerald-600',
  failed: 'text-red-600',
};

export default function SourceManager({ config, onToggle, loading, showStats = true, embedded = false }) {
  if (!config?.sources?.length) return null;

  const list = (
    <div className={embedded ? 'space-y-2' : 'space-y-3'}>
      {config.sources.map((src) => (
        <div
          key={src.name}
          className="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={src.enabled}
              disabled={loading}
              onChange={(e) => onToggle(src.name, e.target.checked)}
              className="mt-1"
            />
            <div>
              <p className="font-medium">{src.label}</p>
              <p className={`text-xs capitalize ${STATUS_STYLES[src.status] || ''}`}>{src.status}</p>
              {src.error && <p className="mt-1 text-xs text-red-600">{src.error}</p>}
            </div>
          </div>
          {showStats && (
            <div className="grid grid-cols-3 gap-2 text-xs sm:text-right">
              <div>
                <p className="text-muted-foreground">Fetched</p>
                <p className="font-semibold tabular-nums">{src.jobsFetched ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">After filters</p>
                <p className="font-semibold tabular-nums">{src.jobsAfterFilters ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last scan</p>
                <p className="font-medium">
                  {src.lastScanTime ? new Date(src.lastScanTime).toLocaleString() : '—'}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (embedded) return list;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Source Manager</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enable or disable job sources. Mode: {config.mockMode ? 'mock' : 'live'}
        </p>
      </CardHeader>
      <CardContent>{list}</CardContent>
    </Card>
  );
}
