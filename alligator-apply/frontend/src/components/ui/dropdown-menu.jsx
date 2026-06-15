import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const DropdownContext = createContext({ open: false, setOpen: () => {} });

export function DropdownMenu({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({ children }) {
  const { open, setOpen } = useContext(DropdownContext);
  return (
    <div onClick={() => setOpen(!open)} role="button" tabIndex={0}>
      {children}
    </div>
  );
}

export function DropdownMenuContent({ align = 'start', children }) {
  const { open, setOpen } = useContext(DropdownContext);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 mt-1 min-w-[10rem] rounded-md border bg-card p-1 shadow-lg',
        align === 'end' ? 'right-0' : 'left-0'
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, disabled }) {
  const { setOpen } = useContext(DropdownContext);
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
      onClick={() => {
        onClick?.();
        setOpen(false);
      }}
    >
      {children}
    </button>
  );
}
