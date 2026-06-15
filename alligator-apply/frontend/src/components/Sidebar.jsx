import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  FolderKanban,
  BarChart3,
  Settings,
  FileText,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/job-hunt', label: 'Job Hunt', icon: Briefcase },
  { to: '/applications', label: 'Applications', icon: FolderKanban },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ profile }) {
  return (
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="border-b border-border px-4 py-4">
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          Alligator <span className="text-primary">Apply</span>
        </h1>
      </div>

      {/* Profile card */}
      <div className="border-b border-border p-3">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {(profile?.name || 'Y').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{profile?.name || 'Your Name'}</p>
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      profile?.resumeLoaded ? 'bg-emerald-500' : 'bg-amber-400'
                    )}
                  />
                  <span className="truncate">
                    {profile?.resumeLoaded
                      ? profile.resumeName || 'Resume loaded'
                      : 'No resume'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Zap className="h-3 w-3 shrink-0 text-primary" />
                  <span>
                    <span className="font-medium text-foreground">{profile?.eligible ?? 0}</span>
                    {' '}eligible jobs
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Semi-automated · Never auto-submits
        </p>
      </div>
    </aside>
  );
}
