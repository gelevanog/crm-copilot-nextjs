'use client';

import { dealFilterToParams, type ParsedFilter } from '@crm/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

const EXAMPLES = [
  'negotiation deals over $20k stuck for 2 weeks',
  'my open deals closing this month',
  'top 5 biggest proposals',
];

/**
 * Natural-language filter: text -> POST /ai/parse-filter -> validated DealFilter
 * -> ordinary query-string filters on the existing list page.
 */
export function NlFilterBar({ initialText }: { initialText?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initialText ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  async function apply(query: string) {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/parse-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
      });
      const body = (await res.json()) as ParsedFilter & { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Could not interpret that request.');
        return;
      }
      const params = dealFilterToParams(body.filter);
      params.set('nl', query);
      params.set('why', body.explanation);
      startTransition(() => router.push(`/deals?${params.toString()}`));
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply(text);
        }}
        className="focus-within:border-ai-border focus-within:ring-ai/15 bg-card shadow-xs flex items-center gap-2 rounded-xl border p-1.5 pl-3 focus-within:ring-4"
      >
        <Sparkles className="text-ai size-4 shrink-0" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder='Describe the deals you want, e.g. "negotiation deals over $20k stuck for 2 weeks"'
          className="placeholder:text-muted-foreground h-8 min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-0"
        />
        <Button type="submit" variant="ai" size="sm" disabled={loading || text.trim().length < 2}>
          {loading ? <Loader2 className="animate-spin" /> : null}
          Filter
        </Button>
      </form>
      {error ? (
        <p className="text-danger text-xs">{error}</p>
      ) : (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="hover:text-ai underline decoration-dotted underline-offset-2"
              onClick={() => {
                setText(ex);
                void apply(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
