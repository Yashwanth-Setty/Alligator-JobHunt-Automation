import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from './ui/card';

const TABS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'auto_apply', label: 'Auto Apply' },
];

export default function JobResultsTabs({ activeTab, onTabChange, funnel, tabCounts, scanJobsFound, visibleCount, loading }) {
  const counts = tabCounts || {
    all: funnel?.afterFilters ?? 0,
    recommended: funnel?.recommended ?? funnel?.afterMatch ?? 0,
    auto_apply: funnel?.autoApplyEligible ?? 0,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 tabular-nums text-xs opacity-70">({counts[tab.id] ?? 0})</span>
          </button>
        ))}
        {loading && <span className="self-center text-xs text-muted-foreground">Updating…</span>}
      </div>

      {scanJobsFound != null && visibleCount != null && scanJobsFound !== visibleCount && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Scan session: {scanJobsFound} jobs persisted · Visible in results: {visibleCount}
        </p>
      )}
    </div>
  );
}

export function ResultsDiagnostic({ funnel, tab, displayed, onSwitchToAll }) {
  if (!funnel || funnel.fetched === 0 || displayed > 0) return null;

  const rc = funnel.rejectionCounts || {};
  const reasons = [
    rc.scoreBelowThreshold > 0 && `${rc.scoreBelowThreshold} below match threshold (${funnel.threshold}%)`,
    rc.visaUnknown > 0 && `${rc.visaUnknown} with visa unknown`,
    rc.missingSkills > 0 && `${rc.missingSkills} missing keyword/skills match`,
    rc.locationMismatch > 0 && `${rc.locationMismatch} location mismatch`,
  ].filter(Boolean);

  return (
    <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
      <CardContent className="flex gap-3 pt-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-2 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {funnel.fetched} jobs fetched but none shown in &ldquo;{tabLabel(tab)}&rdquo;
          </p>
          <p className="text-amber-800/90 dark:text-amber-300/90">
            Fetched {funnel.fetched} → After filters {funnel.afterFilters} → After match {funnel.afterMatch} →
            Auto apply eligible {funnel.autoApplyEligible}
          </p>
          {reasons.length > 0 && (
            <ul className="list-inside list-disc text-amber-800 dark:text-amber-300">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {tab !== 'all' && (
            <button
              type="button"
              onClick={onSwitchToAll}
              className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-400"
            >
              Switch to All Jobs to see every fetched role
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function tabLabel(tab) {
  return TABS.find((t) => t.id === tab)?.label || tab;
}
