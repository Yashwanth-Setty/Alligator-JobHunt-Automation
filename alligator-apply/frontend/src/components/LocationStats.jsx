import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { api } from '@/lib/api';

export default function LocationStats({ filters, onSelectLocation, visible }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    api
      .getLocationStats(filters)
      .then((res) => {
        if (!cancelled) setLocations(res.locations || []);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, JSON.stringify(filters)]);

  if (!visible || loading || locations.length === 0) return null;

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" />
        Locations found
      </div>
      <div className="flex flex-wrap gap-2">
        {locations.map((loc) => (
          <button
            key={loc.label}
            type="button"
            onClick={() => onSelectLocation(loc.value || loc.label)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
          >
            {loc.label}
            <span className="ml-1 tabular-nums text-muted-foreground">({loc.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
