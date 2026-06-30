import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import SourceManager from '@/components/SourceManager';
import TargetCompanyManager from '@/components/TargetCompanyManager';
import CompanyRegistryManager from '@/components/CompanyRegistryManager';
import { CollapsibleSection } from '@/components/ScanControlCard';
import { api } from '@/lib/api';
import { useSidebar } from '@/components/AppLayout';

export default function Settings() {
  const { refresh: refreshSidebar } = useSidebar();
  const [settings, setSettings] = useState(null);
  const [sourcesConfig, setSourcesConfig] = useState(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');

  const loadSources = () => api.getSources().then(setSourcesConfig);

  useEffect(() => {
    api.getSettings().then(setSettings);
    loadSources();
  }, []);

  const save = async () => {
    await api.updateSettings({
      profile: settings.profile,
      preferences: settings.preferences,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (settings.preferences.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    refreshSidebar();
  };

  const handleToggleSource = async (name, enabled) => {
    setSourcesLoading(true);
    try {
      const cfg = await api.toggleSource(name, enabled);
      setSourcesConfig(cfg);
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleAddTarget = async (source, slug) => {
    setSourcesLoading(true);
    try {
      const cfg = await api.addSourceTarget(source, slug);
      setSourcesConfig(cfg);
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleRemoveTarget = async (id) => {
    setSourcesLoading(true);
    try {
      const cfg = await api.removeSourceTarget(id);
      setSourcesConfig(cfg);
    } finally {
      setSourcesLoading(false);
    }
  };

  const handleClearMock = async () => {
    if (!window.confirm('Delete all mock jobs and reset scan history? Resume and settings will be kept.')) return;
    setClearing(true);
    try {
      const r = await api.clearMockData();
      setClearMsg(`Removed ${r.deleted} mock job(s). Scan history reset.`);
      setTimeout(() => setClearMsg(''), 4000);
    } catch (e) {
      setClearMsg(e.message);
    } finally {
      setClearing(false);
    }
  };

  if (!settings) return <p className="text-muted-foreground">Loading settings…</p>;

  const setProfile = (k, v) => setSettings((s) => ({ ...s, profile: { ...s.profile, [k]: v } }));
  const setPref = (k, v) => setSettings((s) => ({ ...s, preferences: { ...s.preferences, [k]: v } }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Profile, company registry, job sources, and integrations.</p>
      </div>

      <CompanyRegistryManager />

      <CollapsibleSection title="Legacy Source Manager" defaultOpen={false}>
        <div className="space-y-4">
          <SourceManager
            config={sourcesConfig}
            onToggle={handleToggleSource}
            loading={sourcesLoading}
            showStats={false}
            embedded
          />
          <TargetCompanyManager
            config={sourcesConfig}
            onAdd={handleAddTarget}
            onRemove={handleRemoveTarget}
            loading={sourcesLoading}
          />
        </div>
      </CollapsibleSection>
      <p className="text-xs text-muted-foreground -mt-4">
        Source fetch stats and scan funnel are on the{' '}
        <Link to="/analytics" className="text-primary hover:underline">
          Analytics
        </Link>{' '}
        page. Live scans prefer the Company Registry when entries exist; legacy targets are used as fallback.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Used for form autofill — not committed to git</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Full name</label>
            <Input value={settings.profile.fullName} onChange={(e) => setProfile('fullName', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <Input type="email" value={settings.profile.email} onChange={(e) => setProfile('email', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Phone</label>
            <Input value={settings.profile.phone} onChange={(e) => setProfile('phone', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work authorization & location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Preferred locations</label>
            <Input value={settings.preferences.preferredLocations} onChange={(e) => setPref('preferredLocations', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Visa status</label>
            <Input value={settings.preferences.visaStatus} onChange={(e) => setPref('visaStatus', e.target.value)} placeholder="e.g. cpt, opt, h1b" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Sponsorship</label>
            <Input value={settings.preferences.sponsorshipRequired} onChange={(e) => setPref('sponsorshipRequired', e.target.value)} placeholder="future / not_required" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.preferences.darkMode} onChange={(e) => setPref('darkMode', e.target.checked)} />
            Dark mode
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Environment flags and what this stack actually implements</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <p>Mock mode: <strong className={settings.integrations.mockMode ? 'text-amber-600' : 'text-emerald-600'}>{settings.integrations.mockMode ? 'MOCK — demo jobs only' : 'LIVE — real job boards'}</strong></p>
            <p>Auto-submit: <strong className="text-red-600">{settings.integrations.autoSubmit ? 'ENABLED' : 'disabled'}</strong></p>
            <p className="text-muted-foreground">Pause fields: {settings.integrations.playwright.pauseFields.join(', ')}</p>
          </div>
          {settings.integrations.capabilities && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <p className="font-medium">Stack capabilities (Node/React)</p>
              <p className="text-xs text-muted-foreground">{settings.integrations.capabilities.legacyNote}</p>
              <ul className="space-y-1.5">
                {Object.entries(settings.integrations.capabilities.features).map(([key, feat]) => (
                  <li key={key} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs">{key}</span>
                    <CapabilityBadge status={feat.status} />
                    {feat.detail && <span className="text-xs text-muted-foreground">— {feat.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data management</CardTitle>
          <CardDescription>Clean up demo data without affecting your resume or profile</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="destructive" onClick={handleClearMock} disabled={clearing}>
            {clearing ? 'Clearing…' : 'Clear Mock Data'}
          </Button>
          {clearMsg && <p className="text-sm text-muted-foreground">{clearMsg}</p>}
          <p className="text-xs text-muted-foreground">
            Deletes jobs with mock IDs, resets scan stats, and clears source cache. Resume and settings are preserved.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save}>{saved ? 'Saved!' : 'Save settings'}</Button>
        {settings.integrations.mockMode && (
          <Button variant="outline" onClick={() => api.seedJobs().then(() => alert('Mock jobs loaded'))}>
            Load mock jobs
          </Button>
        )}
      </div>
    </div>
  );
}

function CapabilityBadge({ status }) {
  const styles = {
    live: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    mock: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    heuristic: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
    live_template: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    planned: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    not_implemented: 'bg-muted text-muted-foreground',
    not_configured: 'bg-muted text-muted-foreground',
    unavailable: 'bg-muted text-muted-foreground',
    disabled_mock_mode: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${styles[status] || styles.not_implemented}`}>
      {String(status).replace(/_/g, ' ')}
    </span>
  );
}
