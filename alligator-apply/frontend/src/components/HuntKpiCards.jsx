import { Card, CardContent } from './ui/card';

const ITEMS = [
  { key: 'jobsFound', label: 'Jobs Found' },
  { key: 'matched', label: 'Matched' },
  { key: 'eligible', label: 'Eligible' },
  { key: 'applied', label: 'Applied' },
  { key: 'manualPending', label: 'Manual Pending' },
];

export default function HuntKpiCards({ kpi }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {ITEMS.map(({ key, label }) => (
        <Card key={key} className="shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{kpi?.[key] ?? 0}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
