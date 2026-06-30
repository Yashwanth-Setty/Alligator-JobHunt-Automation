import { X, Copy, FileText } from 'lucide-react';
import { Button } from './ui/button';

export default function ApplicationPacketModal({ open, packetResult, onClose }) {
  if (!open || !packetResult?.packet) return null;

  const { packet, paths, provider, message } = packetResult;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden />
      <div className="fixed inset-4 z-50 mx-auto flex max-w-3xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:inset-y-8">
        <div className="flex items-start justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Application Packet</h2>
            <p className="text-xs text-muted-foreground">
              Provider: {provider} · {paths?.relativeMarkdownPath}
            </p>
            {message && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
          </div>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
          <PacketSection title="Resume improvements">
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              {packet.resumeImprovements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </PacketSection>

          <PacketSection title="Cover letter" onCopy={() => copyText(packet.coverLetter)}>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{packet.coverLetter}</pre>
          </PacketSection>

          <PacketSection
            title="Recruiter email"
            onCopy={() => copyText(`${packet.recruiterEmail.subject}\n\n${packet.recruiterEmail.body}`)}
          >
            <p className="mb-2 font-medium">Subject: {packet.recruiterEmail.subject}</p>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{packet.recruiterEmail.body}</pre>
          </PacketSection>

          <PacketSection title="LinkedIn message" onCopy={() => copyText(packet.linkedInMessage)}>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{packet.linkedInMessage}</pre>
          </PacketSection>

          <PacketSection
            title="Follow-up email"
            onCopy={() => copyText(`${packet.followUpEmail.subject}\n\n${packet.followUpEmail.body}`)}
          >
            <p className="mb-2 font-medium">Subject: {packet.followUpEmail.subject}</p>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{packet.followUpEmail.body}</pre>
          </PacketSection>

          <PacketSection title="Application answer guidance">
            <div className="space-y-3">
              {packet.applicationAnswers.map((item) => (
                <div key={item.question} className="rounded-md border p-3">
                  <p className="font-medium">{item.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.guidance}</p>
                  <pre className="mt-2 whitespace-pre-wrap text-xs">{item.suggestion}</pre>
                  {item.requiresConfirmation && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Requires manual confirmation</p>
                  )}
                </div>
              ))}
            </div>
          </PacketSection>
        </div>

        <div className="border-t p-4">
          <Button variant="outline" className="w-full" onClick={onClose}>
            <FileText className="mr-2 h-4 w-4" />
            Close
          </Button>
        </div>
      </div>
    </>
  );
}

function PacketSection({ title, children, onCopy }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
        {onCopy && (
          <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            <Copy className="h-3 w-3" />
            Copy
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
