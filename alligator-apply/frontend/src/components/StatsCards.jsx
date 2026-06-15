import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const CARD_ITEMS = [
  ['total_found', 'Total Jobs Found'],
  ['auto_applied', 'Auto Applied'],
  ['manual_pending', 'Manual Pending'],
  ['applications_submitted', 'Applied'],
  ['waiting', 'Waiting'],
  ['recruiter_screen', 'Recruiter Screen'],
  ['hr_round', 'HR Round'],
  ['technical_interview', 'Technical Interview'],
  ['final_interview', 'Final Interview'],
  ['offer', 'Offer'],
  ['hired', 'Hired'],
  ['rejected', 'Rejected'],
];

export default function StatsCards({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {CARD_ITEMS.map(([key, label]) => (
        <Card key={key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats[key] ?? 0}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
