import { Card, CardContent } from './ui/card';

const ITEMS = [
  { key: 'jobsFound', label: 'Jobs Found' },
  { key: 'strongMatches', label: 'Strong Matches' },
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
  { key: 'interviews', label: 'Interviews' },
];

export default function HuntKpiCards({ stats, kpi }) {
  const data = stats || {
    jobsFound: kpi?.jobsFound,
    strongMatches: kpi?.matched,
    saved: kpi?.saved,
    applied: kpi?.applied,
    interviews: kpi?.interviews,
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {ITEMS.map(({ key, label }) => (
        <Card key={key} className="shadow-sm">
          <CardContent className="p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{data?.[key] ?? 0}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
