import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

const SOURCE_LABELS = {
  greenhouse: 'Greenhouse boards',
  lever: 'Lever companies',
  ashby: 'Ashby boards',
  smartrecruiters: 'SmartRecruiters companies',
};

export default function TargetCompanyManager({ config, onAdd, onRemove, onReplace, loading }) {
  const [drafts, setDrafts] = useState({});

  if (!config?.sources?.length) return null;

  const setDraft = (source, value) => setDrafts((d) => ({ ...d, [source]: value }));

  const handleAdd = async (source) => {
    const slug = (drafts[source] || '').trim();
    if (!slug) return;
    await onAdd(source, slug);
    setDraft(source, '');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target Companies / Boards</CardTitle>
        <p className="text-sm text-muted-foreground">
          Company slugs used when MOCK_MODE=false. Stored in the database.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {config.sources.map((src) => (
          <div key={src.name} className="space-y-2">
            <p className="text-sm font-medium">{SOURCE_LABELS[src.name] || src.label}</p>
            <div className="flex flex-wrap gap-2">
              {(src.targets || []).map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs"
                >
                  {t.slug}
                  <button
                    type="button"
                    disabled={loading}
                    className="text-muted-foreground hover:text-red-600"
                    onClick={() => onRemove(t.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {!(src.targets || []).length && (
                <span className="text-xs text-muted-foreground">No targets configured</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add slug…"
                value={drafts[src.name] || ''}
                disabled={loading}
                onChange={(e) => setDraft(src.name, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd(src.name)}
              />
              <Button size="sm" variant="outline" disabled={loading} onClick={() => handleAdd(src.name)}>
                Add
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
