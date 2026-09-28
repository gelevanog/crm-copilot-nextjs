import { DEAL_STAGE_LABELS, type DealStage } from '@crm/shared';
import { Badge } from './ui/badge';

const TONE: Record<DealStage, 'slate' | 'sky' | 'amber' | 'violet' | 'emerald' | 'rose'> = {
  LEAD: 'slate',
  QUALIFIED: 'sky',
  PROPOSAL: 'amber',
  NEGOTIATION: 'violet',
  WON: 'emerald',
  LOST: 'rose',
};

export const STAGE_DOT: Record<DealStage, string> = {
  LEAD: 'bg-slate-400',
  QUALIFIED: 'bg-sky-500',
  PROPOSAL: 'bg-amber-500',
  NEGOTIATION: 'bg-violet-500',
  WON: 'bg-emerald-500',
  LOST: 'bg-rose-500',
};

export function StageBadge({ stage }: { stage: DealStage }) {
  return (
    <Badge tone={TONE[stage]}>
      <span className={`size-1.5 rounded-full ${STAGE_DOT[stage]}`} />
      {DEAL_STAGE_LABELS[stage]}
    </Badge>
  );
}
