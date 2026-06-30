import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogDescription, DialogTitle } from './ui/dialog';
import { Input, Select } from './ui/input';
import { formatStatus } from './ui/badge';

const STATUS_OPTIONS = [
  'found', 'matched', 'ready_to_apply', 'applied', 'waiting',
  'recruiter_screen', 'hr_round', 'technical_interview', 'final_interview',
  'offer', 'hired', 'rejected', 'skipped',
];

export default function ApplicationDetailModal({ application, open, onClose, onSave }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    if (application) {
      setForm({
        status: application.status || 'ready_to_apply',
        notes: application.notes || '',
        appliedDate: (application.appliedDate || '').slice(0, 10),
        followUpDate: (application.followUpDate || '').slice(0, 10),
        recruiterName: application.recruiterName || '',
        recruiterEmail: application.recruiterEmail || '',
      });
    }
  }, [application]);

  if (!open || !application) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    onSave(application.id, {
      status: form.status,
      notes: form.notes,
      appliedDate: form.appliedDate || null,
      followUpDate: form.followUpDate || null,
      recruiterName: form.recruiterName,
      recruiterEmail: form.recruiterEmail,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{application.title}</DialogTitle>
      <DialogDescription>{application.company} · {application.source}</DialogDescription>

      <div className="mt-4 space-y-3">
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{formatStatus(s)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Applied date">
            <Input type="date" value={form.appliedDate} onChange={(e) => set('appliedDate', e.target.value)} />
          </Field>
          <Field label="Follow-up date">
            <Input type="date" value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Recruiter name">
            <Input value={form.recruiterName} onChange={(e) => set('recruiterName', e.target.value)} />
          </Field>
          <Field label="Recruiter email">
            <Input type="email" value={form.recruiterEmail} onChange={(e) => set('recruiterEmail', e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Interview prep, recruiter feedback, next steps…"
          />
        </Field>
        {application.applyUrl && (
          <a href={application.applyUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            Open job posting →
          </a>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
