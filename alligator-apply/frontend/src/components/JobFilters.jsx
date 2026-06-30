import { Input, Select } from './ui/input';

const VISA_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'positive', label: 'Visa positive' },
  { value: 'negative', label: 'Visa negative' },
  { value: 'unknown', label: 'Unknown' },
];

export default function JobFilters({ filters, onChange, disabled, advanced = false }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  if (!advanced) return null;

  return (
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company">
            <Input placeholder="Company name" value={filters.company || ''} onChange={(e) => set('company', e.target.value)} />
          </Field>
          <Field label="Source">
            <Select value={filters.source || ''} onChange={(e) => set('source', e.target.value)}>
              <option value="">All sources</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="workday">Workday</option>
              <option value="smartrecruiters">SmartRecruiters</option>
            </Select>
          </Field>
          <Field label="Work mode">
            <Select value={filters.remoteType || ''} onChange={(e) => set('remoteType', e.target.value)}>
              <option value="">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </Select>
          </Field>
          <Field label="Visa fit">
            <Select value={filters.visaFit || ''} onChange={(e) => set('visaFit', e.target.value)}>
              {VISA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">Applies to Recommended tab only.</p>
          </Field>
          <Field label="Employment type">
            <Select value={filters.employmentType || ''} onChange={(e) => set('employmentType', e.target.value)}>
              <option value="">Any</option>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </Select>
          </Field>
          <Field label="Experience level">
            <Select value={filters.experienceLevel || ''} onChange={(e) => set('experienceLevel', e.target.value)}>
              <option value="">Any</option>
              <option value="entry">Entry</option>
              <option value="mid">Mid</option>
              <option value="senior">Senior</option>
              <option value="staff">Staff</option>
            </Select>
          </Field>
          <Field label="Date posted">
            <Select value={filters.datePostedDays || ''} onChange={(e) => set('datePostedDays', e.target.value)}>
              <option value="">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </Field>
          <Field label="Recommended match threshold %">
            <Input type="number" min={0} max={100} value={filters.minScore ?? '50'} onChange={(e) => set('minScore', e.target.value)} />
            <p className="mt-1 text-[10px] text-muted-foreground">Used for Recommended tab only. All Jobs shows every result.</p>
          </Field>
          <Field label="Salary min ($k)">
            <Input type="number" min={0} placeholder="0" value={filters.salaryMinK || ''} onChange={(e) => set('salaryMinK', e.target.value)} />
          </Field>
          <Field label="Salary max ($k)">
            <Input type="number" min={0} placeholder="Any" value={filters.salaryMaxK || ''} onChange={(e) => set('salaryMaxK', e.target.value)} />
          </Field>
        </fieldset>
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
