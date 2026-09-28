export const DEAL_STAGES = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Stages that still count towards the open pipeline. */
export const OPEN_DEAL_STAGES = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
] as const satisfies readonly DealStage[];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

export const ACTIVITY_TYPES = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const EMAIL_TONES = ['friendly', 'formal', 'concise', 'persuasive'] as const;
export type EmailTone = (typeof EMAIL_TONES)[number];

export const AI_FEATURES = ['chat', 'follow_up_email', 'notes_summary', 'nl_filter'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  chat: 'Copilot chat',
  follow_up_email: 'Follow-up email',
  notes_summary: 'Notes summary',
  nl_filter: 'Natural-language filter',
};
