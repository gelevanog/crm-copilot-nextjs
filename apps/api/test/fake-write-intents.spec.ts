import { describe, expect, it } from 'vitest';
import { planToolCalls } from '../src/ai/llm/fake/fake.provider';
import { planWriteCall } from '../src/ai/llm/fake/write-intents';

describe('fake provider: change requests -> propose* tool calls', () => {
  it.each([
    [
      'Move the Acme deal to Proposal',
      { name: 'proposeDealStageChange', input: { deal: 'Acme', stage: 'PROPOSAL' } },
    ],
    [
      'Mark Store analytics platform as won.',
      { name: 'proposeDealStageChange', input: { deal: 'Store analytics platform', stage: 'WON' } },
    ],
    [
      'Set the amount of Patient intake portal to $70k',
      { name: 'proposeDealUpdate', input: { deal: 'Patient intake portal', amount: 70000 } },
    ],
    [
      'Push the close date of Fleet telematics rollout to 2026-11-30',
      {
        name: 'proposeDealUpdate',
        input: { deal: 'Fleet telematics rollout', expectedCloseDate: '2026-11-30' },
      },
    ],
    [
      'Reassign the Acme deal to Sam',
      { name: 'proposeDealUpdate', input: { deal: 'Acme', ownerName: 'Sam' } },
    ],
    [
      'Log a note on Acme: Dana asked for revised pricing',
      {
        name: 'proposeActivity',
        input: { type: 'NOTE', subject: 'Dana asked for revised pricing', companyName: 'Acme' },
      },
    ],
    [
      'Create a task for the Fleet telematics deal: send the revised order form by Friday',
      {
        name: 'proposeActivity',
        input: {
          type: 'TASK',
          subject: 'Send the revised order form by Friday',
          deal: 'Fleet telematics',
        },
      },
    ],
  ])('%s', (question, expected) => {
    expect(planWriteCall(question)).toEqual(expected);
    expect(planToolCalls(question)).toEqual([expected]);
  });

  it('leaves read-only questions to the read tools', () => {
    expect(planWriteCall('Which deals should I move to negotiation?')).toBeUndefined();
    expect(planToolCalls('Which deals are in Proposal?')[0]?.name).toBe('searchDeals');
  });
});
