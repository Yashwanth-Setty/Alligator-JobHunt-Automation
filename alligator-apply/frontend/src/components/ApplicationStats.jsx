import { Card, CardContent } from './ui/card';

export default function ApplicationStats({ stats }) {
  if (!stats) return null;

  const items = [
    { label: 'Applications', value: stats.total, sub: `${stats.applied || 0} applied` },
    { label: 'Interview rate', value: `${stats.interviewRate}%`, sub: `${stats.interviewed || 0} in pipeline` },
    { label: 'Offer rate', value: `${stats.offerRate}%`, sub: `${stats.offers || 0} offers` },
    { label: 'Rejection rate', value: `${stats.rejectionRate}%`, sub: `${stats.followUpDue || 0} follow-ups due` },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-2xl font-bold tabular-nums">{item.value}</p>
            <p className="text-xs text-muted-foreground">{item.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
