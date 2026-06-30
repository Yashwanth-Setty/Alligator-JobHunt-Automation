import { useRef, useState } from 'react';
import { Upload, Trash2, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const PARSE_LABELS = {
  success: 'Parsed',
  failed: 'Parse failed',
  pending: 'Parsing…',
};

export default function ResumeUpload({ resume, onChange, variant = 'default' }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setUploadError('');
    try {
      await api.uploadResume(file);
      onChange?.();
    } catch (err) {
      if (err.parseFailed && err.resume) {
        setUploadError(err.message || 'Resume saved but parsing failed.');
        onChange?.();
      } else {
        setUploadError(err.message || 'Upload failed');
      }
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setUploadError('');
    try {
      await api.deleteResume();
      onChange?.();
    } finally {
      setLoading(false);
    }
  };

  const parsing = resume?.parsing;
  const parseStatus = parsing?.status;
  const parseOk = parseStatus === 'success';
  const parseFailed = parseStatus === 'failed';

  if (variant === 'minimal') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              resume?.loaded ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950' : 'bg-muted text-muted-foreground'
            )}
          >
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Resume</p>
            {resume?.loaded ? (
              <>
                <p className="truncate text-sm font-medium">{resume.fileName}</p>
                <p className="flex items-center gap-1 text-xs">
                  {parseOk && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                  {parseFailed && <AlertCircle className="h-3 w-3 text-amber-600" />}
                  <span
                    className={cn(
                      parseOk && 'text-emerald-700 dark:text-emerald-400',
                      parseFailed && 'text-amber-700 dark:text-amber-400',
                      !parseOk && !parseFailed && 'text-muted-foreground'
                    )}
                  >
                    {PARSE_LABELS[parseStatus] || 'Uploaded'}
                    {parseFailed && parsing?.error ? ` — ${parsing.error}` : ''}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No resume uploaded</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleUpload} />
          <Button size="sm" variant={resume?.loaded ? 'outline' : 'default'} onClick={() => inputRef.current?.click()} disabled={loading}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {resume?.loaded ? 'Replace' : 'Upload'}
          </Button>
          {resume?.loaded && (
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={loading}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {uploadError && <p className="w-full text-xs text-amber-700 dark:text-amber-400 sm:col-span-2">{uploadError}</p>}
      </div>
    );
  }

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
                {parsing && (
                  <p className="mt-1 flex items-center gap-1 text-xs">
                    {parseOk && (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Parsed — {parsing.charCount?.toLocaleString()} chars
                          {parsing.skillsCount > 0 ? `, ${parsing.skillsCount} skills` : ''}
                        </span>
                      </>
                    )}
                    {parseFailed && (
                      <>
                        <AlertCircle className="h-3 w-3 text-amber-600" />
                        <span className="text-amber-700 dark:text-amber-400">
                          Parse failed{parsing.error ? `: ${parsing.error}` : ''}
                        </span>
                      </>
                    )}
                    {parseStatus === 'pending' && (
                      <span className="text-muted-foreground">Parsing pending…</span>
                    )}
                  </p>
                )}
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
      {uploadError && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{uploadError}</p>
      )}
    </div>
  );
}
