import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { api } from '@/lib/api';

const SidebarContext = createContext({ refresh: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export default function AppLayout() {
  const [profile, setProfile] = useState({
    name: 'Your Name',
    resumeLoaded: false,
    resumeName: null,
    eligible: 0,
  });

  const refresh = useCallback(() => {
    Promise.all([api.getSettings(), api.getResume(), api.getEligibleCount()])
      .then(([settings, resume, eligible]) => {
        setProfile({
          name: settings?.profile?.fullName?.trim() || 'Your Name',
          resumeLoaded: Boolean(resume?.loaded),
          resumeName: resume?.fileName || null,
          eligible: eligible?.count ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const id = setInterval(refresh, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, [refresh]);

  return (
    <SidebarContext.Provider value={{ refresh }}>
      <div className="flex min-h-screen bg-background">
        <Sidebar profile={profile} />
        <main className="min-h-screen flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl p-5 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
