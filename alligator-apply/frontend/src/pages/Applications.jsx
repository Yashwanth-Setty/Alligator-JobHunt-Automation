import { useEffect, useState } from 'react';
import { Badge, formatStatus, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ManualReviewPanel from '@/components/ManualReviewPanel';
import { api } from '@/lib/api';

export default function Applications() {
  const [pipeline, setPipeline] = useState([]);
  const [manualReview, setManualReview] = useState([]);

  const load = () => {
    api.getPipeline().then(setPipeline);
    api.getManualReview().then(setManualReview);
  };

  useEffect(() => { load(); }, []);

  const active = pipeline.filter((r) => !['skipped', 'rejected'].includes(r.pipeline_status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Track application status, interview stages, and manual review items.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No applications yet. Run a job hunt to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    {['Role', 'Company', 'Score', 'Status', 'Interview', 'Applied'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{row.title}</td>
                      <td className="px-3 py-2">{row.company}</td>
                      <td className="px-3 py-2">{row.score}%</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(row.pipeline_status)}>
                          {formatStatus(row.pipeline_status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{formatStatus(row.interview_stage) || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {(row.date_applied || '').slice(0, 10) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ManualReviewPanel
        items={manualReview}
        onResolve={async (id, action, jobId) => {
          await api.resolveManualReview(id, { action, jobId });
          load();
        }}
        onRetry={async (jobId) => {
          await api.autoApplyJob(jobId);
          load();
        }}
      />
    </div>
  );
}
