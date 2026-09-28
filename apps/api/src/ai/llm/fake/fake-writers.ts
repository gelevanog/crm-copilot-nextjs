import {
  DEAL_STAGE_LABELS,
  describeDealFilter,
  type DealFilter,
  type FollowUpEmail,
  type NotesSummary,
  type PipelineStats,
} from '@crm/shared';
import type { GetCompanyData, ListActivitiesData, SearchDealsData } from '../../tools/crm-tools';
import type { FollowUpContext, NotesSummaryContext } from '../../prompts/templates';

/* Deterministic, template-based writers used by the fake provider. */

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const stage = (s: keyof typeof DEAL_STAGE_LABELS) => DEAL_STAGE_LABELS[s];
const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/* -------------------------------- chat answers ----------------------------- */

export function answerSearchDeals(data: SearchDealsData, filter: DealFilter): string {
  const criteria = describeDealFilter(filter)
    .map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1))
    .join(', ');
  const scope = criteria ? ` (${criteria})` : '';
  if (data.total === 0) {
    return `I couldn't find any deals matching your criteria${scope}. Try widening the amount range or the time window.`;
  }
  const lines = data.deals
    .slice(0, 5)
    .map(
      (d) =>
        `- **${d.title}** (${d.company}): ${usd(d.amount)}, ${d.daysInStage} days in ${stage(d.stage)}, owner ${d.owner}`,
    );
  const more = data.total > 5 ? `\n\n${data.total - 5} more in the table above.` : '';
  const noun = data.total === 1 ? 'deal matches' : 'deals match';
  return `${data.total} ${noun}${scope}, worth ${usd(data.totalAmount)} in total:\n\n${lines.join('\n')}${more}`;
}

export function answerCompany(company: GetCompanyData, activities?: ListActivitiesData): string {
  const profile = [
    company.industry,
    company.employees ? `${company.employees.toLocaleString('en-US')} employees` : null,
    company.location,
  ]
    .filter(Boolean)
    .join(', ');
  const header = `**${company.name}**${profile ? ` (${profile})` : ''} has ${company.openDeals} open deal${company.openDeals === 1 ? '' : 's'} worth ${usd(company.openPipeline)}.`;
  const items = (activities?.activities ?? company.recentActivities).slice(0, 5);
  if (items.length === 0) return `${header}\n\nThere are no logged interactions yet.`;
  const lines = items.map((a) => {
    const detail = a.body ? `: ${firstSentence(a.body)}` : '';
    return `- ${shortDate(a.date)}, ${a.type.toLowerCase()} by ${a.author}, "${a.subject}"${detail}`;
  });
  const contact = company.contacts[0];
  const contactLine = contact
    ? `\n\nMain contact: ${contact.name}${contact.title ? `, ${contact.title}` : ''}.`
    : '';
  return `${header} Latest interactions:\n\n${lines.join('\n')}${contactLine}`;
}

export function answerPipeline(stats: PipelineStats): string {
  const byStage = stats.stages
    .filter((s) => s.count > 0)
    .map((s) => `- ${stage(s.stage)}: ${s.count} deal${s.count === 1 ? '' : 's'}, ${usd(s.amount)}`)
    .join('\n');
  const winRate =
    stats.winRateLast90Days === null ? 'n/a' : `${Math.round(stats.winRateLast90Days * 100)}%`;
  return [
    `Open pipeline: **${stats.openCount} deals worth ${usd(stats.openAmount)}**.`,
    '',
    byStage,
    '',
    `Won in the last 90 days: ${usd(stats.wonAmountLast90Days)} (win rate ${winRate}). ${stats.stuckOver14Days} open deal${stats.stuckOver14Days === 1 ? ' has' : 's have'} not moved for more than 14 days.`,
  ].join('\n');
}

export const HELP_ANSWER = [
  'I can answer questions about your CRM data. Try for example:',
  '',
  '- "Which deals over $20k are stuck in Negotiation for more than 2 weeks?"',
  '- "Summarize my last interactions with Acme"',
  '- "How is the pipeline looking?"',
  '- "Show my deals closing this month"',
].join('\n');

function firstSentence(text: string): string {
  const sentence = /^.*?[.!?](\s|$)/.exec(text)?.[0]?.trim() ?? text;
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

/* ------------------------------ structured outputs ------------------------- */

const GREETING: Record<FollowUpContext['tone'], (name: string) => string> = {
  friendly: (n) => `Hi ${n},`,
  formal: (n) => `Dear ${n},`,
  concise: (n) => `Hi ${n},`,
  persuasive: (n) => `Hi ${n},`,
};

const CLOSING: Record<FollowUpContext['tone'], string> = {
  friendly: 'Thanks so much, and talk soon!',
  formal: 'Kind regards,',
  concise: 'Thanks,',
  persuasive: 'Looking forward to moving this forward together.',
};

export function writeFollowUpEmail(ctx: FollowUpContext): FollowUpEmail {
  const firstName = ctx.contact?.firstName ?? 'there';
  // Tasks are internal to-dos, not conversations with the customer.
  const last = ctx.recentActivities.find((a) => a.type !== 'TASK');
  const next = nextStepFor(ctx.deal.stage);
  const recap = last
    ? `following up on our ${last.type.toLowerCase()} on ${shortDate(last.date)} ("${last.subject}")`
    : `following up on ${ctx.deal.title}`;

  const bodyByTone: Record<FollowUpContext['tone'], string[]> = {
    friendly: [
      `I hope your week is going well! I'm ${recap}.`,
      `It was great to hear how ${ctx.company.name} is thinking about ${ctx.deal.title.toLowerCase()}. As a next step, I'd suggest we ${next}.`,
      'Would any time later this week work for you?',
    ],
    formal: [
      `I am writing ${recap}.`,
      `To keep ${ctx.deal.title} on track, I would propose that we ${next}.`,
      'Please let me know which dates would suit you, and I will arrange the details.',
    ],
    concise: [`Quick follow-up on ${ctx.deal.title}.`, `Next step: ${next}. Does this week work?`],
    persuasive: [
      `I'm ${recap}.`,
      `Teams like ${ctx.company.name} usually see the most value when they move quickly after this stage, so I'd propose we ${next}.`,
      'If we lock in a time this week, we can keep the rollout plan on schedule.',
    ],
  };

  const subjectByTone: Record<FollowUpContext['tone'], string> = {
    friendly: `Next steps for ${ctx.deal.title}`,
    formal: `Follow-up: ${ctx.deal.title}`,
    concise: `${ctx.deal.title}: next step`,
    persuasive: `Keeping ${ctx.deal.title} on schedule`,
  };

  const body = [
    GREETING[ctx.tone](firstName),
    '',
    bodyByTone[ctx.tone].join(ctx.tone === 'concise' ? ' ' : '\n\n'),
    '',
    CLOSING[ctx.tone],
    ctx.senderName,
  ].join('\n');

  const keyPoints = [
    `Deal: ${ctx.deal.title} (${usd(ctx.deal.amount)}, ${stage(ctx.deal.stage)}, ${ctx.deal.daysInStage} days in stage)`,
    last
      ? `Last interaction: ${last.type.toLowerCase()} on ${last.date.slice(0, 10)} - ${last.subject}`
      : 'No logged interactions yet',
    `Proposed next step: ${next}`,
  ];
  return { subject: subjectByTone[ctx.tone], body, keyPoints };
}

function nextStepFor(dealStage: FollowUpContext['deal']['stage']): string {
  switch (dealStage) {
    case 'LEAD':
      return 'book a 30-minute discovery call';
    case 'QUALIFIED':
      return 'schedule a tailored demo with your team';
    case 'PROPOSAL':
      return 'walk through the proposal together and answer open questions';
    case 'NEGOTIATION':
      return 'align on the remaining contract points and a target signature date';
    case 'WON':
      return 'plan the kickoff and onboarding timeline';
    case 'LOST':
      return 'check in on how things are going and whether priorities have changed';
  }
}

const POSITIVE =
  /\b(excited|great|happy|approved|signed|positive|interested|champion|love|strong fit|green light|expand)/i;
const RISK =
  /\b(concern|delay|risk|budget (?:cut|freeze)|unhappy|complain|blocked|competitor|frozen|pushback|churn|slipp|stalled|no response|cancel)/i;

export function writeNotesSummary(ctx: NotesSummaryContext): NotesSummary {
  const acts = ctx.activities;
  const pos = acts.filter((a) => POSITIVE.test(`${a.subject} ${a.body ?? ''}`)).length;
  const risk = acts.filter((a) => RISK.test(`${a.subject} ${a.body ?? ''}`)).length;
  const sentiment: NotesSummary['sentiment'] =
    risk > pos
      ? 'at_risk'
      : pos > 0 && risk === 0
        ? 'positive'
        : pos > risk
          ? 'positive'
          : 'neutral';

  const pipeline = ctx.openDeals.reduce((n, d) => n + d.amount, 0);
  const latest = acts.find((a) => a.type !== 'TASK');
  const summary =
    acts.length === 0
      ? `There are no logged notes or activities for ${ctx.company.name} yet.`
      : [
          `${ctx.company.name} has ${acts.length} logged interaction${acts.length === 1 ? '' : 's'} and ${ctx.openDeals.length} open deal${ctx.openDeals.length === 1 ? '' : 's'} worth ${usd(pipeline)}.`,
          latest
            ? `The most recent touchpoint was a ${latest.type.toLowerCase()} on ${shortDate(latest.date)}: "${latest.subject}".`
            : '',
          sentiment === 'at_risk'
            ? 'Recent notes mention concerns that need attention.'
            : sentiment === 'positive'
              ? 'The relationship is progressing well.'
              : 'There are no strong positive or negative signals.',
        ]
          .filter(Boolean)
          .join(' ');

  const keyPoints = acts
    .slice(0, 4)
    .map((a) => `${a.date.slice(0, 10)} ${a.type.toLowerCase()}: ${a.subject}`);
  const nextSteps = [
    ...acts.filter((a) => a.type === 'TASK').map((a) => a.subject),
    ...ctx.openDeals
      .filter((d) => d.daysInStage > 14)
      .map((d) => `Re-engage on ${d.title} (${d.daysInStage} days in ${stage(d.stage)})`),
  ].slice(0, 4);
  if (nextSteps.length === 0 && ctx.openDeals[0]) {
    nextSteps.push(`Agree next milestone for ${ctx.openDeals[0].title}`);
  }
  return { summary, keyPoints, sentiment, nextSteps };
}
