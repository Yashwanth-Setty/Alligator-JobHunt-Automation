import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { AlertTriangle } from 'lucide-react';

const REASON_LABELS = {
  captcha: 'CAPTCHA detected',
  complex_workday_form: 'Complex Workday form',
  complex_form: 'Complex form detected',
  visa_question: 'Visa answer needs review',
  eeo_required: 'EEO question detected',
  salary_required: 'Salary question detected',
  file_upload_issue: 'Resume upload failed',
  unknown_field: 'Unknown field mapping',
  auto_apply_failed: 'Automation blocked',
  greenhouse_blocked: 'Greenhouse form blocked automation',
};

function formatReason(code) {
  return REASON_LABELS[code] || (code || 'unknown').replace(/_/g, ' ');
}

export default function ManualReviewPanel({ items, onResolve, onRetry }) {
  return (
    <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Manual Apply Required
        </CardTitle>
        <CardDescription>
          CAPTCHA, complex forms, visa/EEO/salary questions, upload failures, or blocked automation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!items?.length ? (
          <p className="text-sm text-muted-foreground">No manual applications pending.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">{item.title} @ {item.company}</p>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {formatReason(item.reason)}
                </p>
                {item.details && <p className="text-xs text-muted-foreground">{item.details}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                  >
                    Open Apply Page
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => onRetry(item.job_id)}>Retry Auto Apply</Button>
                <Button size="sm" onClick={() => onResolve(item.id, 'applied', item.job_id)}>Mark Applied</Button>
                <Button size="sm" variant="secondary" onClick={() => onResolve(item.id, 'skipped', item.job_id)}>Skip</Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
