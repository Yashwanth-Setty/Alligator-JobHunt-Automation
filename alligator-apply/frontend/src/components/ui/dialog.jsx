import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">{children}</div>
    </div>
  );
}

export function DialogTitle({ className, children }) {
  return <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>;
}

export function DialogDescription({ className, children }) {
  return <p className={cn('mt-2 text-sm text-muted-foreground', className)}>{children}</p>;
}
