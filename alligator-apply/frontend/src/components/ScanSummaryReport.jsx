import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const REJECTION_LABELS = {
  keywordMismatch: 'Keyword mismatch',
  locationMismatch: 'Location mismatch',
  companyMismatch: 'Company mismatch',
  sourceMismatch: 'Source mismatch',
  remoteTypeMismatch: 'Work mode mismatch',
  visaMismatch: 'Visa mismatch',
  employmentTypeMismatch: 'Employment type mismatch',
  experienceLevelMismatch: 'Experience mismatch',
  scoreBelowThreshold: 'Score below threshold',
  salaryMismatch: 'Salary mismatch',
  invalidUrl: 'Invalid URL',
  duplicate: 'Duplicate',
};

export default function ScanSummaryReport({ report, scanStatus }) {
  const data = report || scanStatus?.scanReport;
  if (!data || scanStatus?.status !== 'completed') return null;

  const pipeline = data.pipeline || {};
  const sourceEntries = Object.entries(data.jobsBySource || {});
  const rejectionEntries = Object.entries(data.rejectionCounts || {}).filter(([, n]) => n > 0);

  return (
    <Card className="border-blue-200/60 bg-blue-50/20 dark:border-blue-900 dark:bg-blue-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Scan Summary Report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Fetched" value={pipeline.fetched ?? data.totalFetched ?? 0} />
          <Stat label="After filter" value={pipeline.afterFilter ?? data.afterFilter ?? 0} />
          <Stat label="After dedupe" value={pipeline.afterDedupe ?? data.finalJobs ?? 0} />
          <Stat label="After match" value={pipeline.afterMatch ?? data.afterMatch ?? 0} />
          <Stat label="Persisted (DB)" value={pipeline.persisted ?? scanStatus.jobsFound ?? 0} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Auto apply eligible" value={data.autoApplyEligible ?? 0} />
          <Stat label="Filtered out" value={data.filteredOut ?? 0} />
          <Stat label="Duplicates removed" value={data.duplicatesRemoved ?? 0} />
          <Stat label="Below threshold" value={data.scoreBelowThreshold ?? 0} />
        </div>

        {rejectionEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Rejected because</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rejectionEntries.map(([key, count]) => (
                <div key={key} className="flex justify-between rounded-md border bg-card px-3 py-2 text-sm">
                  <span>{REJECTION_LABELS[key] || key}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Visa positive" value={data.visaPositive ?? 0} className="text-emerald-700" />
          <Stat label="Visa negative" value={data.visaNegative ?? 0} className="text-red-700" />
          <Stat label="Visa unknown" value={data.visaUnknown ?? 0} />
        </div>

        {sourceEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Jobs by source</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {sourceEntries.map(([source, count]) => (
                <div key={source} className="flex justify-between rounded-md border bg-card px-3 py-2 text-sm">
                  <span className="capitalize">{source}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, className = '' }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-semibold tabular-nums ${className}`}>{value}</p>
    </div>
  );
}
