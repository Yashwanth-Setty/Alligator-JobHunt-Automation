import { useState } from 'react';
import { ChevronDown, Loader2, Play, Square } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import LocationAutocomplete from './LocationAutocomplete';
import KeywordAutocomplete from './KeywordAutocomplete';
import ResumeUpload from './ResumeUpload';
import ScanProgress from './ScanProgress';
import { cn } from '@/lib/utils';

export default function ScanControlCard({
  resume,
  onResumeChange,
  filters,
  onFiltersChange,
  disabled,
  hasResume,
  scanRunning,
  scanStatus,
  onStartScan,
  onStopScan,
  advancedFilters,
  advancedSources,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const remoteOn = filters.remoteType === 'remote';

  const set = (key, value) => onFiltersChange({ ...filters, [key]: value });

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 p-4">
        <ResumeUpload resume={resume} onChange={onResumeChange} variant="minimal" />

        <div className="grid gap-3 overflow-visible sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div className="relative overflow-visible">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Keywords</label>
            <KeywordAutocomplete
              value={filters.keywords || ''}
              onChange={(v) => set('keywords', v)}
              disabled={disabled}
            />
          </div>
          <div className="relative overflow-visible">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Location</label>
            <LocationAutocomplete
              value={filters.location || ''}
              onChange={(v) => set('location', v)}
              disabled={disabled}
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5 lg:pb-2">
            <button
              type="button"
              role="switch"
              aria-checked={remoteOn}
              disabled={disabled}
              onClick={() => set('remoteType', remoteOn ? '' : 'remote')}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors',
                remoteOn ? 'border-primary bg-primary' : 'border-input bg-muted',
                disabled && 'opacity-50'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-background shadow transition-transform',
                  remoteOn ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
            <span className="text-sm font-medium">Remote only</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onStartScan} disabled={!hasResume || scanRunning}>
            {scanRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Start Scan
          </Button>
          <Button variant="outline" onClick={onStopScan} disabled={!scanRunning}>
            <Square className="mr-2 h-4 w-4" />
            Stop
          </Button>
          {!hasResume && (
            <span className="text-xs text-amber-700 dark:text-amber-400">Upload a resume to scan.</span>
          )}
        </div>

        {scanRunning && scanStatus && <ScanProgress status={scanStatus} compact />}

        <div className="space-y-2 border-t border-border pt-3">
          <CollapsibleSection
            title="Advanced search filters"
            open={filtersOpen}
            onToggle={() => setFiltersOpen((o) => !o)}
          >
            {advancedFilters}
          </CollapsibleSection>
          {advancedSources}
        </div>
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({ title, open, onToggle, defaultOpen = false, children }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const toggle = onToggle ?? (() => setInternalOpen((o) => !o));

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
      >
        {title}
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}

export { CollapsibleSection };
