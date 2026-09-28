'use client';

import { Sparkles } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';

interface CopilotContextValue {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  /** A question queued by another component (e.g. "Ask about this deal"). */
  pendingQuestion: string | null;
  ask: (question: string) => void;
  consumePending: () => string | null;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [pendingQuestion, setPending] = useState<string | null>(null);

  const ask = useCallback((question: string) => {
    setPending(question);
    setOpen(true);
  }, []);

  const consumePending = useCallback(() => {
    const q = pendingQuestion;
    setPending(null);
    return q;
  }, [pendingQuestion]);

  // Cmd/Ctrl + K toggles the copilot from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(
    () => ({ isOpen, setOpen, pendingQuestion, ask, consumePending }),
    [isOpen, pendingQuestion, ask, consumePending],
  );
  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilot must be used inside CopilotProvider');
  return ctx;
}

export function AskCopilotButton() {
  const { setOpen } = useCopilot();
  return (
    <Button variant="ai" size="sm" onClick={() => setOpen(true)}>
      <Sparkles />
      Ask your CRM
      <kbd className="bg-ai-foreground/15 ml-1 hidden rounded px-1 text-[10px] sm:inline">⌘K</kbd>
    </Button>
  );
}

export function AskAboutButton({ question, label }: { question: string; label: string }) {
  const { ask } = useCopilot();
  return (
    <Button variant="ai-outline" size="sm" onClick={() => ask(question)}>
      <Sparkles />
      {label}
    </Button>
  );
}
