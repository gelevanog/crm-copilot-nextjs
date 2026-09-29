'use client';

import type { ProposedActionStatus, ProposedActionView } from '@crm/shared';
import { ArrowRight, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUS: Record<
  ProposedActionStatus,
  { label: string; tone: 'amber' | 'emerald' | 'neutral' | 'rose' }
> = {
  pending: { label: 'Needs your approval', tone: 'amber' },
  approved: { label: 'Approved · applied', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  stale: { label: 'Not applied', tone: 'rose' },
};

type DecisionResponse = ProposedActionView | { message?: string; proposal?: ProposedActionView };

const minutesUntil = (iso: string) =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));

/** Minutes until expiry, re-evaluated every 15 seconds while pending. */
function useMinutesLeft(proposal: ProposedActionView): number {
  const [minutes, setMinutes] = useState(() => minutesUntil(proposal.expiresAt));
  useEffect(() => {
    if (proposal.status !== 'pending') return;
    const timer = setInterval(() => setMinutes(minutesUntil(proposal.expiresAt)), 15_000);
    return () => clearInterval(timer);
  }, [proposal.status, proposal.expiresAt]);
  return minutes;
}

/**
 * Confirmation card for a change the copilot proposed. Nothing has been
 * written yet: Approve and Reject are ordinary authenticated API calls made by
 * the user, and the server re-checks scope, expiry and staleness.
 */
export function ProposalCard({ proposal: initial }: { proposal: ProposedActionView }) {
  const router = useRouter();
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const minutesLeft = useMinutesLeft(proposal);
  const status: ProposedActionStatus =
    proposal.status === 'pending' && minutesLeft === 0 ? 'expired' : proposal.status;

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/ai/actions/${proposal.id}/${action}`, { method: 'POST' });
      const body = (await res.json()) as DecisionResponse;
      if (res.ok) {
        setProposal(body as ProposedActionView);
        // Refresh server components so the page behind the drawer shows the change.
        if (action === 'approve') router.refresh();
      } else {
        if ('proposal' in body && body.proposal) setProposal(body.proposal);
        setError(('message' in body && body.message) || 'Could not update the proposal.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-ai-soft/40 space-y-2.5 border-t px-2.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ai flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
          <ShieldCheck className="size-3.5" />
          Confirm change
        </p>
        <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
      </div>

      <div>
        <p className="text-sm font-semibold">{proposal.title}</p>
        {proposal.target.href ? (
          <Link href={proposal.target.href} className="text-ai text-xs hover:underline">
            {proposal.target.label}
          </Link>
        ) : (
          <p className="text-muted-foreground text-xs">{proposal.target.label}</p>
        )}
      </div>

      <dl className="bg-card divide-y rounded-md border text-xs">
        {proposal.changes.map((c) => (
          <div key={c.field} className="flex items-start gap-3 px-2.5 py-1.5">
            <dt className="text-muted-foreground w-24 shrink-0">{c.label}</dt>
            <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {c.before !== null && (
                <>
                  <span className="text-muted-foreground line-through">{c.before}</span>
                  <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                </>
              )}
              <span className="break-words font-medium">{c.after ?? '—'}</span>
            </dd>
          </div>
        ))}
      </dl>

      {proposal.reason && (
        <p className="text-muted-foreground text-xs italic">“{proposal.reason}”</p>
      )}

      {status === 'pending' ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ai"
            disabled={busy !== null}
            onClick={() => void decide('approve')}
          >
            {busy === 'approve' ? <Loader2 className="animate-spin" /> : <Check />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void decide('reject')}
          >
            {busy === 'reject' ? <Loader2 className="animate-spin" /> : <X />}
            Reject
          </Button>
          <span className="text-muted-foreground ml-auto text-[11px]">
            Expires in {minutesLeft} min
          </span>
        </div>
      ) : (
        proposal.resultMessage && (
          <p className="text-muted-foreground text-xs">Reason: {proposal.resultMessage}.</p>
        )
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
