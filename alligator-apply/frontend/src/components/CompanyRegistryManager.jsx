import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogDescription, DialogTitle } from './ui/dialog';
import { Input, Select } from './ui/input';
import { api } from '@/lib/api';

const SOURCES = [
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'lever', label: 'Lever' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'smartrecruiters', label: 'SmartRecruiters' },
];

const SCAN_STATUS_VARIANT = {
  success: 'green',
  failed: 'red',
  skipped: 'gray',
  cached: 'blue',
  never: 'gray',
};

const EMPTY_FORM = {
  companyName: '',
  source: 'greenhouse',
  boardToken: '',
  careersUrl: '',
  tags: [],
  priority: 50,
  enabled: true,
};

function formatScanStatus(status) {
  return (status || 'never').replace(/_/g, ' ');
}

export default function CompanyRegistryManager() {
  const [entries, setEntries] = useState([]);
  const [companiesById, setCompaniesById] = useState({});
  const [tagCatalog, setTagCatalog] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ search: '', source: '', enabled: '' });
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const entryParams = { limit: 500 };
      if (filters.source) entryParams.source = filters.source;
      if (filters.enabled === 'true') entryParams.enabled = 'true';
      if (filters.enabled === 'false') entryParams.enabled = 'false';

      const [entriesRes, companiesRes, tagsRes, statsRes] = await Promise.all([
        api.getRegistryEntries(entryParams),
        api.getRegistryCompanies({ limit: 500 }),
        api.getRegistryTags(),
        api.getRegistryStats(),
      ]);

      setEntries(entriesRes.entries || []);
      const map = {};
      for (const company of companiesRes.companies || []) {
        map[company.id] = company;
      }
      setCompaniesById(map);
      setTagCatalog(tagsRes.tags || []);
      setStats(statsRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.source, filters.enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleEntries = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        (entry.companyName || '').toLowerCase().includes(q) ||
        (entry.boardToken || '').toLowerCase().includes(q)
    );
  }, [entries, filters.search]);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const setFormField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleTag = (slug) => {
    setForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(slug)
        ? prev.tags.filter((t) => t !== slug)
        : [...prev.tags, slug],
    }));
  };

  const openModal = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const handleToggle = async (entry) => {
    setMutating(true);
    setError('');
    try {
      const result = await api.toggleRegistryEntry(entry.id);
      setEntries((prev) =>
        prev.map((row) => (row.id === entry.id ? { ...row, ...result.entry } : row))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setMutating(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const name = form.companyName.trim();
    const token = form.boardToken.trim();
    if (!name || !token) {
      setFormError('Company name and board token are required.');
      return;
    }

    setMutating(true);
    setFormError('');
    try {
      const searchRes = await api.getRegistryCompanies({ search: name, limit: 10 });
      const existing = (searchRes.companies || []).find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );

      let companyId;
      if (existing) {
        companyId = existing.id;
      } else {
        const created = await api.createRegistryCompany({
          name,
          tags: form.tags,
        });
        companyId = created.company.id;
      }

      await api.createRegistryEntry({
        companyId,
        source: form.source,
        boardToken: token,
        careersUrl: form.careersUrl.trim() || undefined,
        priority: Number(form.priority) || 50,
        enabled: form.enabled,
      });

      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setMutating(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Company Registry</CardTitle>
            <CardDescription>
              Registry-first scan targets for Greenhouse, Lever, Ashby, and SmartRecruiters.
              {stats && (
                <span className="mt-1 block text-xs">
                  {stats.totalCompanies} companies · {stats.enabledEntries}/{stats.totalEntries} entries enabled
                </span>
              )}
            </CardDescription>
          </div>
          <Button size="sm" onClick={openModal} disabled={loading || mutating}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add company / entry
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <Input
                placeholder="Company or board token…"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Source</label>
              <Select value={filters.source} onChange={(e) => setFilter('source', e.target.value)}>
                <option value="">All sources</option>
                {SOURCES.map((src) => (
                  <option key={src.value} value={src.value}>
                    {src.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Enabled</label>
              <Select value={filters.enabled} onChange={(e) => setFilter('enabled', e.target.value)}>
                <option value="">All</option>
                <option value="true">Enabled only</option>
                <option value="false">Disabled only</option>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading registry…
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Company</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Board token</th>
                    <th className="px-3 py-2.5 font-medium">Tags</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Enabled</th>
                    <th className="px-3 py-2.5 font-medium">Last scan</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                        No registry entries match your filters.
                      </td>
                    </tr>
                  )}
                  {visibleEntries.map((entry) => {
                    const company = companiesById[entry.companyId];
                    const tags = company?.tags || [];
                    return (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium">{entry.companyName || '—'}</td>
                        <td className="px-3 py-2.5 capitalize">{entry.source}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{entry.boardToken || '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {tags.length ? (
                              tags.map((tag) => (
                                <span
                                  key={tag.slug}
                                  className="rounded-full border bg-muted px-2 py-0.5 text-[10px]"
                                >
                                  {tag.label}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{entry.priority}</td>
                        <td className="px-3 py-2.5">
                          <Button
                            size="sm"
                            variant={entry.enabled ? 'default' : 'outline'}
                            disabled={mutating}
                            onClick={() => handleToggle(entry)}
                          >
                            {entry.enabled ? 'Enabled' : 'Disabled'}
                          </Button>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={SCAN_STATUS_VARIANT[entry.lastScanStatus] || 'gray'}>
                            {formatScanStatus(entry.lastScanStatus)}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onClose={() => !mutating && setModalOpen(false)}>
        <DialogTitle>Add company / registry entry</DialogTitle>
        <DialogDescription>
          Creates a company (or reuses an existing name match) and adds a board entry for scanning.
        </DialogDescription>

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <Field label="Company name">
            <Input
              value={form.companyName}
              onChange={(e) => setFormField('companyName', e.target.value)}
              placeholder="e.g. Acme Corp"
              required
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source">
              <Select value={form.source} onChange={(e) => setFormField('source', e.target.value)}>
                {SOURCES.map((src) => (
                  <option key={src.value} value={src.value}>
                    {src.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Board token">
              <Input
                value={form.boardToken}
                onChange={(e) => setFormField('boardToken', e.target.value)}
                placeholder="e.g. stripe"
                required
              />
            </Field>
          </div>
          <Field label="Careers URL (optional)">
            <Input
              value={form.careersUrl}
              onChange={(e) => setFormField('careersUrl', e.target.value)}
              placeholder="Auto-generated from source + token if empty"
            />
          </Field>
          <Field label="Tags">
            <div className="flex flex-wrap gap-2">
              {tagCatalog.map((tag) => (
                <label
                  key={tag.slug}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={form.tags.includes(tag.slug)}
                    onChange={() => toggleTag(tag.slug)}
                  />
                  {tag.label}
                </label>
              ))}
              {!tagCatalog.length && (
                <span className="text-xs text-muted-foreground">No tags loaded</span>
              )}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Priority">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.priority}
                onChange={(e) => setFormField('priority', e.target.value)}
              />
            </Field>
            <Field label="Enabled">
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setFormField('enabled', e.target.checked)}
                />
                Include in scans
              </label>
            </Field>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={mutating} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutating}>
              {mutating ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
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
