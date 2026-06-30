import { CollapsibleSection } from './ScanControlCard';
import SourceManager from './SourceManager';
import { Link } from 'react-router-dom';

export default function AdvancedSourcesPanel({ config, onToggle, loading }) {
  return (
    <CollapsibleSection title="Advanced sources" defaultOpen={false}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Enable job boards for the next scan. Detailed fetch stats live on{' '}
          <Link to="/analytics" className="text-primary hover:underline">Analytics</Link>.
        </p>
        <SourceManager config={config} onToggle={onToggle} loading={loading} showStats={false} embedded />
        <Link to="/settings" className="inline-block text-xs text-muted-foreground hover:text-foreground">
          Manage company targets in Settings →
        </Link>
      </div>
    </CollapsibleSection>
  );
}
