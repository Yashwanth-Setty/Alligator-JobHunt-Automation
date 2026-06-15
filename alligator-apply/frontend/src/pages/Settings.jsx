import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSidebar } from '@/components/AppLayout';

export default function Settings() {
  const { refresh: refreshSidebar } = useSidebar();
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.getSettings().then(setSettings); }, []);

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

  if (!settings) return <p className="text-muted-foreground">Loading settings…</p>;

  const setProfile = (k, v) => setSettings((s) => ({ ...s, profile: { ...s.profile, [k]: v } }));
  const setPref = (k, v) => setSettings((s) => ({ ...s, preferences: { ...s.preferences, [k]: v } }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Profile, preferences, and integrations. API keys live in .env only.</p>
      </div>

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
          <CardDescription>Configured via environment variables</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>OpenAI: {settings.integrations.openaiConfigured ? '✓ configured' : '○ not set'}</p>
          <p>watsonx: {settings.integrations.watsonx.configured ? '✓ configured' : '○ placeholder'}</p>
          <p>Auto-submit: <strong className="text-red-600">{settings.integrations.autoSubmit ? 'ENABLED' : 'disabled'}</strong></p>
          <p>Mock mode: {settings.integrations.mockMode ? 'on' : 'off'}</p>
          <p className="text-muted-foreground">Pause fields: {settings.integrations.playwright.pauseFields.join(', ')}</p>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save}>{saved ? 'Saved!' : 'Save settings'}</Button>
        <Button variant="outline" onClick={() => api.seedJobs().then(() => alert('Mock jobs loaded'))}>Load mock jobs</Button>
      </div>
    </div>
  );
}
