import { Badge, formatStatus, statusVariant } from './ui/badge';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

const WORK_MODE_LABELS = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite' };

export default function JobsTable({ jobs, onAction, scanCompleted }) {
  if (!scanCompleted) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Run a job hunt to discover matching roles.
      </p>
    );
  }

  if (!jobs?.length) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        No jobs match your filters. Adjust filters and run another hunt.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {['Match', 'Job Title', 'Company', 'Location', 'Work Mode', 'Visa Fit', 'Source', 'Auto-Apply', 'Application Status', 'Actions'].map((h) => (
              <th key={h} className="px-3 py-2.5 font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2.5">
                <span className={job.score >= 75 ? 'font-semibold text-emerald-600' : ''}>{job.score}%</span>
              </td>
              <td className="px-3 py-2.5 font-medium">{job.title}</td>
              <td className="px-3 py-2.5">{job.company}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{job.location}</td>
              <td className="px-3 py-2.5">{WORK_MODE_LABELS[job.remote_type] || job.remote_type || '—'}</td>
              <td className="px-3 py-2.5 capitalize">{(job.visa_fit || '').replace(/_/g, ' ')}</td>
              <td className="px-3 py-2.5 capitalize">{job.source}</td>
              <td className="px-3 py-2.5">
                <Badge variant={job.auto_apply_eligible ? 'green' : 'gray'}>
                  {job.auto_apply_eligible ? 'Eligible' : 'Manual'}
                </Badge>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant={statusVariant(job.pipeline_status)}>{formatStatus(job.pipeline_status)}</Badge>
              </td>
              <td className="px-3 py-2.5">
                <JobActions job={job} onAction={onAction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobActions({ job, onAction }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="sm" variant="outline" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAction('view', job)}>View Job</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('packet', job)}>Generate Packet</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('autoApply', job)} disabled={!job.auto_apply_eligible}>
          Auto Apply
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('manual', job)}>Move to Manual</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('skip', job)}>Skip</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
