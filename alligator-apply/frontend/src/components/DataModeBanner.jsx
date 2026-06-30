import { useEffect, useState } from 'react';
import { AlertTriangle, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { formatLiveSources } from '@/lib/jobSearchConstants';

export default function DataModeBanner() {
  const [mode, setMode] = useState(null);
  const [liveSources, setLiveSources] = useState([]);

  useEffect(() => {
    Promise.all([api.health(), api.getCapabilities()])
      .then(([h, caps]) => {
        setMode(h.mockMode ? 'mock' : 'live');
        setLiveSources(caps?.features?.jobScan?.sources || []);
      })
      .catch(() => setMode(null));
  }, []);

  if (!mode) return null;

  if (mode === 'mock') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <strong>MOCK MODE:</strong> Demo jobs only — data comes from mock_jobs.json, not real job boards.
        </span>
      </div>
    );
  }

  const sourceText = formatLiveSources(liveSources) || 'Greenhouse, Lever, Ashby, SmartRecruiters';

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
      <Radio className="h-4 w-4 shrink-0" />
      <span>
        <strong>LIVE MODE:</strong> Real job boards — {sourceText}.
      </span>
    </div>
  );
}

export function DataSourceBadge({ dataSource }) {
  const src = (dataSource || 'live').toLowerCase();
  const labels = { mock: 'Mock', live: 'Live', cache: 'Cache' };
  const variants = {
    mock: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
    live: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
    cache: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${variants[src] || variants.live}`}
    >
      {labels[src] || 'Live'}
    </span>
  );
}
