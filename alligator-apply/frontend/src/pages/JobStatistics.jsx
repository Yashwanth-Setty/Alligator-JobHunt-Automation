import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import StatsCards from '@/components/StatsCards';
import PipelineChart from '@/components/PipelineChart';
import ScanSummaryReport from '@/components/ScanSummaryReport';
import { Badge, formatStatus, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function JobStatistics() {
  const [stats, setStats] = useState(null);
  const [pipeline, setPipeline] = useState([]);
  const [scanStatus, setScanStatus] = useState(null);
  const [scanMetrics, setScanMetrics] = useState(null);
  const [sourcesConfig, setSourcesConfig] = useState(null);

  useEffect(() => {
    api.getStats().then(setStats);
    api.getPipeline().then(setPipeline);
    api.getScanStatus().then(setScanStatus);
    api.getScanMetrics().then(setScanMetrics).catch(() => {});
    api.getSources().then(setSourcesConfig).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Pipeline progress, scan funnel, and source performance.</p>
      </div>

      <StatsCards stats={stats} />
      <PipelineChart stats={stats} />

      {(scanMetrics || scanStatus?.scanReport) && (
        <Card>
          <CardHeader>
            <CardTitle>Last scan metrics</CardTitle>
            <CardDescription>Persisted counts and funnel breakdown from the most recent hunt</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {scanMetrics && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Jobs found" value={scanMetrics.jobsFound} />
                <Metric label="Matched (≥50%)" value={scanMetrics.jobsMatched} />
                <Metric label="Auto-apply eligible" value={scanMetrics.eligible} />
                <Metric label="Sources" value={Object.keys(scanMetrics.sourceMetrics || {}).length || '—'} />
              </div>
            )}
            <ScanSummaryReport scanStatus={scanStatus} />
          </CardContent>
        </Card>
      )}

      {scanMetrics?.sourceStatuses?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Source performance</CardTitle>
            <CardDescription>Fetched, filtered, and persisted counts from the last scan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    {['Source', 'Status', 'Fetched', 'After filters', 'Persisted', 'Eligible'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scanMetrics.sourceStatuses.map((src) => (
                    <tr key={src.name} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{src.label || src.name}</td>
                      <td className="px-3 py-2 capitalize text-muted-foreground">{src.status}</td>
                      <td className="px-3 py-2 tabular-nums">{src.jobsFetched ?? 0}</td>
                      <td className="px-3 py-2 tabular-nums">{src.jobsAfterFilters ?? 0}</td>
                      <td className="px-3 py-2 tabular-nums">{src.jobsPersisted ?? src.jobsFound ?? 0}</td>
                      <td className="px-3 py-2 tabular-nums">{src.jobsEligible ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Enable or disable sources on{' '}
              <Link to="/settings" className="text-primary hover:underline">Settings</Link> or Job Hunt → Advanced sources.
            </p>
          </CardContent>
        </Card>
      )}

      {sourcesConfig && scanMetrics?.sourceStatuses?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Configured sources</CardTitle>
            <CardDescription>Run a scan on Job Hunt to populate source stats</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {sourcesConfig.sources.map((s) => (
                <li key={s.name} className="flex justify-between gap-4">
                  <span>{s.label}</span>
                  <span className="text-muted-foreground">{s.enabled ? 'Enabled' : 'Disabled'}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Application Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  {['Role', 'Company', 'Score', 'Status', 'Interview Stage', 'Applied'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pipeline.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{row.title}</td>
                    <td className="px-3 py-2">{row.company}</td>
                    <td className="px-3 py-2">{row.score}%</td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(row.pipeline_status)}>{formatStatus(row.pipeline_status)}</Badge>
                    </td>
                    <td className="px-3 py-2">{formatStatus(row.interview_stage) || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{(row.date_applied || '').slice(0, 10) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value ?? '—'}</p>
    </div>
  );
}
