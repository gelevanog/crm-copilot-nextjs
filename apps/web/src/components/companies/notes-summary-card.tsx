'use client';

import type { NotesSummary } from '@crm/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const SENTIMENT = {
  positive: { label: 'Positive', tone: 'emerald' },
  neutral: { label: 'Neutral', tone: 'slate' },
  at_risk: { label: 'At risk', tone: 'rose' },
} as const;

/** Smart action: structured summary of a company's notes and activities. */
export function NotesSummaryCard({ companyId }: { companyId: string }) {
  const [summary, setSummary] = useState<NotesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/companies/${companyId}/summary`, { method: 'POST' });
      const body = (await res.json()) as NotesSummary & { message?: string };
      if (!res.ok) setError(body.message ?? 'Could not summarize the notes.');
      else setSummary(body);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-ai-border/70">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="text-ai size-4" />
            Account summary
          </CardTitle>
          <CardDescription>
            Summarizes notes, calls and meetings into a structured brief.
          </CardDescription>
        </div>
        <Button variant="ai" size="sm" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {summary ? 'Refresh' : 'Summarize notes'}
        </Button>
      </CardHeader>
      {(summary || error) && (
        <CardContent className="space-y-4">
          {error && <p className="text-danger text-xs">{error}</p>}
          {summary && (
            <>
              <div className="flex items-start gap-3">
                <Badge tone={SENTIMENT[summary.sentiment].tone}>
                  {SENTIMENT[summary.sentiment].label}
                </Badge>
                <p className="text-sm leading-relaxed">{summary.summary}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <List title="Key points" items={summary.keyPoints} />
                <List title="Suggested next steps" items={summary.nextSteps} />
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">None</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
