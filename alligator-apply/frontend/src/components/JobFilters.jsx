import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input, Select } from './ui/input';

const VISA_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'cpt_friendly', label: 'CPT Friendly' },
  { value: 'sponsorship_friendly', label: 'Sponsorship Friendly' },
  { value: 'no_sponsorship', label: 'No Sponsorship' },
  { value: 'sponsorship_unknown', label: 'Unknown' },
];

export default function JobFilters({ filters, onChange, disabled }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Job Search Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Field label="Keywords / job title">
            <Input placeholder="e.g. backend engineer" value={filters.keywords || ''} onChange={(e) => set('keywords', e.target.value)} />
          </Field>
          <Field label="Location">
            <Input placeholder="City, state, remote" value={filters.location || ''} onChange={(e) => set('location', e.target.value)} />
          </Field>
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
          <Field label="Minimum match %">
            <Input type="number" min={0} max={100} value={filters.minScore ?? '50'} onChange={(e) => set('minScore', e.target.value)} />
          </Field>
          <Field label="Salary min ($k)">
            <Input type="number" min={0} placeholder="0" value={filters.salaryMinK || ''} onChange={(e) => set('salaryMinK', e.target.value)} />
          </Field>
          <Field label="Salary max ($k)">
            <Input type="number" min={0} placeholder="Any" value={filters.salaryMaxK || ''} onChange={(e) => set('salaryMaxK', e.target.value)} />
          </Field>
        </fieldset>
      </CardContent>
    </Card>
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
