'use client';

import { EMAIL_TONES, type EmailTone, type FollowUpEmail } from '@crm/shared';
import { Check, Copy, Loader2, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';

/** Smart action: drafts a follow-up email from the deal and its recent activities. */
export function FollowUpCard({ dealId }: { dealId: string }) {
  const [tone, setTone] = useState<EmailTone>('friendly');
  const [draft, setDraft] = useState<FollowUpEmail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/deals/${dealId}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      });
      const body = (await res.json()) as FollowUpEmail & { message?: string };
      if (!res.ok) setError(body.message ?? 'Could not draft the email.');
      else setDraft(body);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!draft) return;
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="border-ai-border/70">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Mail className="text-ai size-4" />
            Draft follow-up email
          </CardTitle>
          <CardDescription>Uses this deal and its latest activities as context.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Select
            value={tone}
            onChange={(e) => setTone(e.target.value as EmailTone)}
            aria-label="Tone"
            className="h-8 w-44 text-xs"
          >
            {EMAIL_TONES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)} tone
              </option>
            ))}
          </Select>
          <Button variant="ai" size="sm" onClick={() => void generate()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {draft ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
        {error && <p className="text-danger text-xs">{error}</p>}
        {draft && (
          <div className="space-y-3">
            <div className="bg-muted/40 rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <p className="truncate text-sm font-medium">{draft.subject}</p>
                <Button variant="ghost" size="icon-sm" onClick={() => void copy()} title="Copy">
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap px-3 py-2.5 font-sans text-sm leading-relaxed">
                {draft.body}
              </pre>
            </div>
            {draft.keyPoints.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">Grounded in</p>
                <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                  {draft.keyPoints.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
