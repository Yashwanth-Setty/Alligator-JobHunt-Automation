import { Badge, formatStatus, statusVariant } from './ui/badge';
import { Input, Select } from './ui/input';
import { Button } from './ui/button';

const STATUS_OPTIONS = [
  'found', 'matched', 'ready_to_apply', 'applied', 'waiting',
  'recruiter_screen', 'hr_round', 'technical_interview', 'final_interview',
  'offer', 'hired', 'rejected', 'skipped',
];

export function ApplicationFilters({ filters, onFilterChange }) {
  const set = (k, v) => onFilterChange({ ...filters, [k]: v });

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Select value={filters.status || ''} onChange={(e) => set('status', e.target.value)}>
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{formatStatus(s)}</option>
        ))}
      </Select>
      <Input placeholder="Filter company…" value={filters.company || ''} onChange={(e) => set('company', e.target.value)} />
      <Select value={filters.source || ''} onChange={(e) => set('source', e.target.value)}>
        <option value="">All sources</option>
        <option value="greenhouse">Greenhouse</option>
        <option value="lever">Lever</option>
        <option value="ashby">Ashby</option>
        <option value="smartrecruiters">SmartRecruiters</option>
      </Select>
      <Input type="date" value={filters.appliedAfter || ''} onChange={(e) => set('appliedAfter', e.target.value)} title="Applied after" />
    </div>
  );
}

export default function ApplicationTable({ applications, onSelect, onDelete }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {['Role', 'Company', 'Source', 'Status', 'Applied', 'Follow-up', 'Recruiter', 'Actions'].map((h) => (
              <th key={h} className="px-3 py-2.5 font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr key={app.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2.5 font-medium">{app.title}</td>
              <td className="px-3 py-2.5">{app.company}</td>
              <td className="px-3 py-2.5 capitalize">{app.source || '—'}</td>
              <td className="px-3 py-2.5">
                <Badge variant={statusVariant(app.status)}>{formatStatus(app.status)}</Badge>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{(app.appliedDate || '').slice(0, 10) || '—'}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{(app.followUpDate || '').slice(0, 10) || '—'}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{app.recruiterName || '—'}</td>
              <td className="px-3 py-2.5">
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => onSelect(app)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(app.id)}>Delete</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!applications.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">No applications match your filters.</p>
      )}
    </div>
  );
}
