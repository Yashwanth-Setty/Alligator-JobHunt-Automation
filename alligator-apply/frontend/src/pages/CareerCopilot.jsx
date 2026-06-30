import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Briefcase, Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const ACTION_OPTIONS = [
  { id: 'recommend_next_action', label: 'Next action' },
  { id: 'explain_match', label: 'Explain match' },
  { id: 'suggest_resume_changes', label: 'Resume tips' },
  { id: 'prepare_interview', label: 'Interview prep' },
  { id: 'generate_recruiter_message', label: 'Recruiter message' },
  { id: 'explain_rejection', label: 'Explain rejection' },
];

const VALID_ACTIONS = new Set(ACTION_OPTIONS.map((a) => a.id));

function formatReply(text) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={line.startsWith('•') ? 'ml-2' : undefined}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={j}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part}</span>
          )
        )}
      </p>
    );
  });
}

export default function CareerCopilot() {
  const [searchParams] = useSearchParams();
  const jobIdFromUrl = searchParams.get('jobId') || '';
  const actionFromUrl = searchParams.get('action') || '';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [action, setAction] = useState(
    VALID_ACTIONS.has(actionFromUrl) ? actionFromUrl : 'recommend_next_action'
  );
  const [jobId, setJobId] = useState(jobIdFromUrl);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contextSummary, setContextSummary] = useState(null);
  const bottomRef = useRef(null);
  const lastDeepLink = useRef('');

  useEffect(() => {
    if (jobIdFromUrl) setJobId(jobIdFromUrl);
  }, [jobIdFromUrl]);

  useEffect(() => {
    if (VALID_ACTIONS.has(actionFromUrl)) setAction(actionFromUrl);
  }, [actionFromUrl]);

  useEffect(() => {
    const id = jobId.trim();
    if (!id) {
      setSelectedJob(null);
      return;
    }
    setJobLoading(true);
    api
      .getJob(id)
      .then(setSelectedJob)
      .catch(() => setSelectedJob(null))
      .finally(() => setJobLoading(false));
  }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const runQuery = useCallback(async (chosenAction, jobIdValue, messageText = '') => {
    const userText =
      messageText.trim() || ACTION_OPTIONS.find((a) => a.id === chosenAction)?.label || chosenAction;
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setLoading(true);
    try {
      const res = await api.copilotChat({
        action: chosenAction,
        message: messageText.trim(),
        jobId: jobIdValue?.trim() || undefined,
      });
      setContextSummary(res.contextSummary);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.reply,
          provider: res.provider,
          suggestions: res.suggestions || [],
        },
      ]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', text: e.message, error: true }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!jobIdFromUrl || !VALID_ACTIONS.has(actionFromUrl)) return;
    const key = `${jobIdFromUrl}:${actionFromUrl}`;
    if (lastDeepLink.current === key) return;
    lastDeepLink.current = key;
    runQuery(actionFromUrl, jobIdFromUrl, '');
  }, [jobIdFromUrl, actionFromUrl, runQuery]);

  const send = async (overrideAction) => {
    const chosenAction = overrideAction || action;
    const messageText = input;
    setInput('');
    await runQuery(chosenAction, jobId, messageText);
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" />
          Career Copilot
        </h1>
        <p className="text-sm text-muted-foreground">
          Context-aware guidance from your resume, jobs, and applications. Template mode until watsonx is live.
        </p>
      </div>

      <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[1fr_280px]">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="border-b border-border py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Chat
            </CardTitle>
            {contextSummary && (
              <CardDescription>
                {contextSummary.candidateName} · {contextSummary.recentJobCount} jobs ·{' '}
                {contextSummary.applicationCount} applications
                {contextSummary.selectedJobId ? ` · focused job` : ''}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Pick an action below or type a question. Context includes your active resume, recent jobs, and
                  application pipeline.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm',
                    m.role === 'user'
                      ? 'ml-8 bg-primary/10 text-foreground'
                      : m.error
                        ? 'mr-8 border border-destructive/30 bg-destructive/5 text-destructive'
                        : 'mr-8 border border-border bg-muted/40'
                  )}
                >
                  {m.role === 'assistant' && m.provider && (
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{m.provider}</p>
                  )}
                  <div className="space-y-1">{formatReply(m.text)}</div>
                  {m.suggestions?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setInput(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
              {ACTION_OPTIONS.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={action === opt.id ? 'default' : 'outline'}
                  onClick={() => {
                    setAction(opt.id);
                    send(opt.id);
                  }}
                  disabled={loading}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading) send();
              }}
            >
              <textarea
                className="min-h-[44px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Optional note for the copilot…"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
              />
              <Button type="submit" disabled={loading} className="shrink-0 self-end">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Context</CardTitle>
            <CardDescription>
              {jobId.trim() ? 'Selected job from Job Hunt' : 'Optional job focus for role-specific answers'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobId.trim() && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                {jobLoading && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading job…
                  </p>
                )}
                {!jobLoading && selectedJob && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">{selectedJob.title}</p>
                        <p className="text-xs text-muted-foreground">{selectedJob.company}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {selectedJob.score}% match
                      </span>
                      {selectedJob.location && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {selectedJob.location}
                        </span>
                      )}
                    </div>
                    {selectedJob.required_skills?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Matched: {selectedJob.required_skills.slice(0, 6).join(', ')}
                        {selectedJob.required_skills.length > 6 ? '…' : ''}
                      </p>
                    )}
                    {selectedJob.missing_skills?.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Missing: {selectedJob.missing_skills.slice(0, 6).join(', ')}
                        {selectedJob.missing_skills.length > 6 ? '…' : ''}
                      </p>
                    )}
                  </div>
                )}
                {!jobLoading && !selectedJob && (
                  <p className="text-xs text-destructive">Job not found. Check the ID or run a new scan.</p>
                )}
              </div>
            )}
            <label className="block text-xs font-medium text-muted-foreground">Job ID</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Paste job UUID from Job Hunt"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use <strong>Ask Copilot</strong> in Job Hunt to open this page with the job and action pre-filled.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
