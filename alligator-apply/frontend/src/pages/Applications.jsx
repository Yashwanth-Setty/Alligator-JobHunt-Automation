import { useCallback, useEffect, useState } from 'react';
import { Download, LayoutGrid, List, Upload } from 'lucide-react';
import ApplicationStats from '@/components/ApplicationStats';
import ApplicationKanban from '@/components/ApplicationKanban';
import ApplicationTable, { ApplicationFilters } from '@/components/ApplicationTable';
import ApplicationDetailModal from '@/components/ApplicationDetailModal';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState(null);
  const [view, setView] = useState('kanban');
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api.getApplications(filters).then((res) => {
      setApplications(res.data);
      setStats(res.stats);
    });
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const filteredApps = applications;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleStatusChange = async (id, status) => {
    await api.updateApplicationCrm(id, { status });
    load();
    showToast('Status updated');
  };

  const handleSave = async (id, payload) => {
    await api.updateApplicationCrm(id, payload);
    load();
    showToast('Application saved');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this application?')) return;
    await api.deleteApplication(id);
    load();
    showToast('Application deleted');
  };

  const handleExport = async () => {
    const blob = await api.exportApplications(filters);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const csv = await file.text();
      const result = await api.importApplications(csv);
      load();
      showToast(`Imported ${result.imported} application(s)`);
    };
    input.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-sm text-muted-foreground">
            Track your pipeline from ready to apply through offer or rejection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === 'kanban' ? 'default' : 'outline'} size="sm" onClick={() => setView('kanban')}>
            <LayoutGrid className="mr-2 h-4 w-4" /> Kanban
          </Button>
          <Button variant={view === 'table' ? 'default' : 'outline'} size="sm" onClick={() => setView('table')}>
            <List className="mr-2 h-4 w-4" /> Table
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
        </div>
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {toast}
        </div>
      )}

      <ApplicationStats stats={stats} />

      <ApplicationFilters filters={filters} onFilterChange={setFilters} />

      {view === 'kanban' ? (
        <ApplicationKanban
          applications={filteredApps}
          onStatusChange={handleStatusChange}
          onSelect={setSelected}
        />
      ) : (
        <ApplicationTable
          applications={filteredApps}
          onSelect={setSelected}
          onDelete={handleDelete}
        />
      )}

      <ApplicationDetailModal
        application={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        onSave={handleSave}
      />
    </div>
  );
}
