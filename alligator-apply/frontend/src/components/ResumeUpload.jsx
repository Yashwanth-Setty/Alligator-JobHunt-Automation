import { useRef, useState } from 'react';
import { Upload, Trash2, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '@/lib/api';

export default function ResumeUpload({ resume, onChange, compact = true }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await api.uploadResume(file);
      onChange?.();
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await api.deleteResume();
      onChange?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Resume</p>
            {resume?.loaded ? (
              <>
                <p className="truncate text-sm font-medium">{resume.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {resume.uploadedAt
                    ? `Uploaded ${new Date(resume.uploadedAt).toLocaleDateString()}`
                    : 'Active resume'}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Upload your resume to start job matching.</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleUpload} />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={loading}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {resume?.loaded ? 'Replace' : 'Upload & Save'}
          </Button>
          {resume?.loaded && (
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={loading}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
