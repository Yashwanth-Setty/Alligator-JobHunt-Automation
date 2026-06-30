import { Link } from 'react-router-dom';
import { X, ExternalLink, Sparkles } from 'lucide-react';
import { Badge, formatStatus, statusVariant } from './ui/badge';
import { Button } from './ui/button';
import { DataSourceBadge } from './DataModeBanner';
import { cn } from '@/lib/utils';

const DRAWER_COPILOT_ACTIONS = [
  { action: 'explain_match', label: 'Explain match' },
  { action: 'suggest_resume_changes', label: 'Suggest resume changes' },
  { action: 'prepare_interview', label: 'Prepare interview' },
  { action: 'generate_recruiter_message', label: 'Generate recruiter message' },
];

function copilotHref(jobId, action) {
  const params = new URLSearchParams({ jobId, action });
  return `/copilot?${params.toString()}`;
}

function CopilotLink({ to, onNavigate, variant = 'outline', className, children }) {
  const styles = {
    outline: 'border border-input bg-background hover:bg-accent',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  };
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        styles[variant],
        className
      )}
    >
      {children}
    </Link>
  );
}

export default function JobDetailDrawer({ job, open, onClose, filters, onGeneratePacket }) {
  if (!open || !job) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l bg-background shadow-xl">
        <div className="flex items-start justify-between border-b p-4">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-semibold leading-tight">{job.title}</h2>
            <p className="text-sm text-muted-foreground">{job.company}</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section className="flex flex-wrap gap-2">
            <Badge variant={job.score >= 65 ? 'green' : 'blue'}>{job.score}% match</Badge>
            <DataSourceBadge dataSource={job.data_source} />
            <Badge variant={statusVariant(job.pipeline_status)}>
              {formatStatus(job.pipeline_status)}
            </Badge>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Company</h3>
            <p className="text-sm">{job.company}</p>
            <p className="text-sm text-muted-foreground">{job.location || '—'}</p>
            <p className="text-sm capitalize text-muted-foreground">
              {job.remote_type || '—'} · {job.source} · {job.employment_type?.replace('_', ' ') || '—'}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Match score breakdown</h3>
            {job.score_skill_source && (
              <p className="mb-2 text-xs text-muted-foreground">
                Skill source: <strong className="capitalize">{job.score_skill_source}</strong>
              </p>
            )}
            <div className="space-y-2">
              {(job.match_breakdown || []).map((row) => (
                <div key={row.label} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{row.label}</span>
                    {row.label !== 'Missing skills' && (
                      <span className="tabular-nums">{row.points}/{row.max}</span>
                    )}
                  </div>
                  {row.detail && (
                    <p className="text-xs text-muted-foreground">{row.detail}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {(job.required_skills?.length > 0 || job.missing_skills?.length > 0) && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Skills vs job</h3>
              {job.required_skills?.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-xs text-muted-foreground">Matched</p>
                  <div className="flex flex-wrap gap-1.5">
                    {job.required_skills.map((s) => (
                      <span key={`m-${s}`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {job.missing_skills?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Missing from job description</p>
                  <div className="flex flex-wrap gap-1.5">
                    {job.missing_skills.slice(0, 12).map((s) => (
                      <span key={`x-${s}`} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Sponsorship indicators</h3>
            <div className="space-y-1 text-sm">
              <p>Visa fit: <strong className="capitalize">{job.visa_indicators?.fit || job.visa_fit || 'unknown'}</strong></p>
              <p className="text-muted-foreground">
                Sponsorship mentioned: {job.visa_indicators?.sponsorshipMentioned ? 'Yes' : 'No / unknown'}
              </p>
              <p className="text-muted-foreground">
                CPT mentioned: {job.visa_indicators?.cptMentioned ? 'Yes' : 'No / unknown'}
              </p>
            </div>
          </section>

          {job.required_skills?.length > 0 && !job.missing_skills?.length && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Skills detected</h3>
              <div className="flex flex-wrap gap-1.5">
                {job.required_skills.map((s) => (
                  <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{s}</span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Description</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {job.description?.trim() || 'No description available for this listing.'}
            </p>
          </section>

          {job.rejection_reasons?.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Not recommended because</h3>
              <div className="flex flex-wrap gap-1">
                {job.rejection_reasons.map((r) => (
                  <span key={r} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {r}
                  </span>
                ))}
              </div>
            </section>
          )}

          {job.notes && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Notes</h3>
              <p className="text-sm">{job.notes}</p>
            </section>
          )}
        </div>

        <div className="border-t p-4 space-y-3">
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Career Copilot</p>
            <CopilotLink
              to={copilotHref(job.id, 'explain_match')}
              onNavigate={onClose}
              className="h-10 w-full"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Ask Copilot
            </CopilotLink>
            <div className="grid grid-cols-2 gap-2">
              {DRAWER_COPILOT_ACTIONS.map(({ action, label }) => (
                <CopilotLink
                  key={action}
                  to={copilotHref(job.id, action)}
                  onNavigate={onClose}
                  variant="secondary"
                  className="h-auto whitespace-normal px-2 py-2 text-xs"
                >
                  {label}
                </CopilotLink>
              ))}
            </div>
          </section>
          {onGeneratePacket && (
            <Button className="w-full" variant="secondary" onClick={() => onGeneratePacket(job)}>
              Generate Application Packet
            </Button>
          )}
          {(job.url || job.apply_url) && (
            <Button className="w-full" onClick={() => window.open(job.url || job.apply_url, '_blank', 'noopener')}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open apply URL
            </Button>
          )}
        </div>
      </aside>
    </>
  );
}
