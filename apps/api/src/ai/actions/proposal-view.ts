import type { ProposedAction } from '@prisma/client';
import { z } from 'zod';
import type { ProposedActionStatus, ProposedActionView } from '@crm/shared';

/** Confirmation card content stored with each proposal (`ProposedAction.preview`). */
export const proposalPreviewSchema = z.object({
  title: z.string(),
  target: z.object({ label: z.string(), href: z.string().nullable() }),
  changes: z.array(
    z.object({
      field: z.string(),
      label: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
});
export type ProposalPreview = z.infer<typeof proposalPreviewSchema>;

/** A pending proposal past its deadline reads as expired even before it is settled. */
export function effectiveStatus(
  row: Pick<ProposedAction, 'status' | 'expiresAt'>,
  now: Date,
): ProposedActionStatus {
  return row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status;
}

export function toProposalView(row: ProposedAction, now: Date = new Date()): ProposedActionView {
  const preview = proposalPreviewSchema.parse(row.preview);
  return {
    id: row.id,
    kind: row.kind,
    status: effectiveStatus(row, now),
    title: preview.title,
    target: preview.target,
    changes: preview.changes,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    resultMessage: row.resultMessage,
  };
}
