import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from './ui/card';

export default function LocationZeroResults({ hints, locationFallback, scanCompleted }) {
  if (locationFallback?.active) {
    const query = locationFallback.query || 'your location';
    return (
      <Card className="border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardContent className="flex gap-3 pt-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            No exact matches for &ldquo;{query}&rdquo;. Showing all scanned jobs.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (scanCompleted) return null;

  if (!hints?.query) return null;
  const suggestions = hints.suggestions || [];
  if (!suggestions.length) return null;

  return (
    <Card className="border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/30">
      <CardContent className="flex gap-3 pt-4">
        <p className="text-sm text-sky-900 dark:text-sky-200">
          No jobs found for &ldquo;{hints.query}&rdquo; yet. Try a different location before scanning.
        </p>
      </CardContent>
    </Card>
  );
}
