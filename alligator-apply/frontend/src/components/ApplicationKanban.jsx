import { useState } from 'react';
import { Badge, formatStatus, statusVariant } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const COLUMNS = [
  { id: 'ready', label: 'Ready', color: 'border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30' },
  { id: 'applied', label: 'Applied', color: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30' },
  { id: 'interview', label: 'Interview', color: 'border-violet-200 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/30' },
  { id: 'offer', label: 'Offer', color: 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30' },
  { id: 'rejected', label: 'Rejected', color: 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30' },
];

const COLUMN_STATUSES = {
  ready: ['found', 'matched', 'ready_to_apply'],
  applied: ['applied', 'auto_applied', 'waiting'],
  interview: ['recruiter_screen', 'hr_round', 'technical_interview', 'final_interview'],
  offer: ['offer', 'hired'],
  rejected: ['rejected', 'failed', 'skipped'],
};

const COLUMN_DEFAULT_STATUS = {
  ready: 'ready_to_apply',
  applied: 'applied',
  interview: 'recruiter_screen',
  offer: 'offer',
  rejected: 'rejected',
};

export default function ApplicationKanban({ applications, onStatusChange, onSelect }) {
  const [draggingId, setDraggingId] = useState(null);

  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = applications.filter((a) => COLUMN_STATUSES[col.id].includes(a.status));
    return acc;
  }, {});

  const handleDrop = (columnId) => {
    if (!draggingId) return;
    const app = applications.find((a) => a.id === draggingId);
    if (!app) return;
    const currentCol = Object.keys(COLUMN_STATUSES).find((k) => COLUMN_STATUSES[k].includes(app.status));
    if (currentCol === columnId && COLUMN_STATUSES[columnId].includes(app.status)) return;
    const newStatus = COLUMN_STATUSES[columnId].includes(app.status)
      ? app.status
      : COLUMN_DEFAULT_STATUS[columnId];
    onStatusChange(app.id, newStatus);
    setDraggingId(null);
  };

  return (
    <div className="grid gap-3 overflow-x-auto lg:grid-cols-5">
      {COLUMNS.map((col) => (
        <Card
          key={col.id}
          className={`min-w-[220px] ${col.color}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(col.id)}
        >
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="flex items-center justify-between text-sm">
              {col.label}
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-normal tabular-nums">
                {grouped[col.id]?.length || 0}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-3">
            {(grouped[col.id] || []).map((app) => (
              <div
                key={app.id}
                draggable
                onDragStart={() => setDraggingId(app.id)}
                onDragEnd={() => setDraggingId(null)}
                onClick={() => onSelect(app)}
                className="cursor-grab rounded-md border bg-card p-2.5 shadow-sm transition hover:shadow active:cursor-grabbing"
              >
                <p className="truncate text-sm font-medium">{app.title}</p>
                <p className="truncate text-xs text-muted-foreground">{app.company}</p>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <Badge variant={statusVariant(app.status)} className="text-[10px]">
                    {formatStatus(app.status)}
                  </Badge>
                  {app.followUpDate && (
                    <span className="text-[10px] text-amber-600">↗ {app.followUpDate.slice(0, 10)}</span>
                  )}
                </div>
              </div>
            ))}
            {!grouped[col.id]?.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">Drop here</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
