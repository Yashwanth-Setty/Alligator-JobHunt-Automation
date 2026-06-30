import { cn } from '@/lib/utils';

const colors = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  purple: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
};

export function Badge({ className, variant = 'gray', children }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', colors[variant], className)}>
      {children}
    </span>
  );
}

export function statusVariant(status) {
  const map = {
    found: 'gray',
    matched: 'blue',
    recommended: 'blue',
    ready_to_apply: 'green',
    applying: 'amber',
    auto_applied: 'green',
    manual_pending: 'amber',
    applied: 'green',
    waiting: 'blue',
    recruiter_screen: 'purple',
    hr_round: 'purple',
    technical_interview: 'purple',
    final_interview: 'purple',
    interview: 'purple',
    offer: 'green',
    hired: 'green',
    rejected: 'red',
    failed: 'red',
    skipped: 'gray',
  };
  return map[status] || 'gray';
}

const STATUS_LABELS = {
  found: 'Matched',
  matched: 'Matched',
  recommended: 'Recommended',
  ready_to_apply: 'Ready to Apply',
  applying: 'Applying',
  auto_applied: 'Applied',
  applied: 'Applied',
  manual_pending: 'Manual Required',
  waiting: 'Applying',
  recruiter_screen: 'Interview',
  hr_round: 'Interview',
  technical_interview: 'Interview',
  final_interview: 'Interview',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Offer',
  rejected: 'Rejected',
  failed: 'Rejected',
  skipped: 'Skipped',
};

export function formatStatus(s) {
  if (STATUS_LABELS[s]) return STATUS_LABELS[s];
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
