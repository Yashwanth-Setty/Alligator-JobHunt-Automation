import { useEffect, useState } from 'react';
import StatsCards from '@/components/StatsCards';
import PipelineChart from '@/components/PipelineChart';
import { Badge, formatStatus, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function JobStatistics() {
  const [stats, setStats] = useState(null);
  const [pipeline, setPipeline] = useState([]);

  useEffect(() => {
    api.getStats().then(setStats);
    api.getPipeline().then(setPipeline);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Track pipeline progress, sources, and match quality.</p>
      </div>

      <StatsCards stats={stats} />
      <PipelineChart stats={stats} />

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
