import type { ActivityType, DealStage } from '@crm/shared';

/**
 * Fictional demo data. Two workspaces prove tenant isolation: both contain a
 * company called "Acme ...", so "tell me about Acme" must resolve differently
 * depending on who is asking. All dates are relative to "now" at seed time.
 */

export const DEMO_PASSWORD = 'demo1234';

export interface SeedUser {
  key: string;
  name: string;
  email: string;
}

export interface SeedCompany {
  name: string;
  domain: string;
  industry: string;
  employees: number;
  city: string;
  country: string;
  contacts: { firstName: string; lastName: string; title: string; phone?: string }[];
}

export interface SeedDeal {
  company: string;
  title: string;
  amount: number;
  stage: DealStage;
  /** Days since the deal entered its current stage. */
  daysInStage: number;
  /** Expected close relative to today (negative = in the past). */
  closeInDays: number;
  owner: string;
}

export interface SeedActivity {
  company: string;
  deal?: string;
  type: ActivityType;
  subject: string;
  body?: string;
  daysAgo: number;
  author: string;
}

export interface SeedWorkspace {
  name: string;
  slug: string;
  users: SeedUser[];
  companies: SeedCompany[];
  deals: SeedDeal[];
  /** Hand-written history on top of the generated per-deal activities. */
  activities: SeedActivity[];
}

export const WORKSPACES: SeedWorkspace[] = [
  {
    name: 'Northwind Sales',
    slug: 'northwind',
    users: [
      { key: 'alex', name: 'Alex Morgan', email: 'alex@northwind.test' },
      { key: 'sam', name: 'Sam Rivera', email: 'sam@northwind.test' },
    ],
    companies: [
      {
        name: 'Acme Logistics',
        domain: 'acme-logistics.example',
        industry: 'Logistics',
        employees: 1200,
        city: 'Chicago',
        country: 'US',
        contacts: [
          {
            firstName: 'Dana',
            lastName: 'Whitfield',
            title: 'VP Operations',
            phone: '+1 312 555 0142',
          },
          { firstName: 'Marcus', lastName: 'Chen', title: 'Procurement Manager' },
        ],
      },
      {
        name: 'Brightwave Health',
        domain: 'brightwave.example',
        industry: 'Healthcare',
        employees: 850,
        city: 'Boston',
        country: 'US',
        contacts: [{ firstName: 'Priya', lastName: 'Nair', title: 'CIO' }],
      },
      {
        name: 'Cobalt Robotics',
        domain: 'cobalt-robotics.example',
        industry: 'Manufacturing',
        employees: 320,
        city: 'Pittsburgh',
        country: 'US',
        contacts: [{ firstName: 'Tom', lastName: 'Becker', title: 'CTO' }],
      },
      {
        name: 'Driftwood Hotels',
        domain: 'driftwood.example',
        industry: 'Hospitality',
        employees: 2400,
        city: 'Miami',
        country: 'US',
        contacts: [
          { firstName: 'Laura', lastName: 'Gomez', title: 'Director of Guest Experience' },
        ],
      },
      {
        name: 'Evergreen Foods',
        domain: 'evergreen-foods.example',
        industry: 'Food & Beverage',
        employees: 560,
        city: 'Portland',
        country: 'US',
        contacts: [{ firstName: 'Nate', lastName: 'Olsen', title: 'Head of Supply Chain' }],
      },
      {
        name: 'Fjord Analytics',
        domain: 'fjord.example',
        industry: 'Software',
        employees: 140,
        city: 'Oslo',
        country: 'NO',
        contacts: [{ firstName: 'Ingrid', lastName: 'Solberg', title: 'CEO' }],
      },
      {
        name: 'Granite Insurance',
        domain: 'granite-ins.example',
        industry: 'Insurance',
        employees: 3100,
        city: 'Hartford',
        country: 'US',
        contacts: [
          { firstName: 'Robert', lastName: 'Hale', title: 'Head of Claims' },
          { firstName: 'Nina', lastName: 'Park', title: 'CFO' },
        ],
      },
      {
        name: 'Helios Solar',
        domain: 'helios-solar.example',
        industry: 'Energy',
        employees: 410,
        city: 'Phoenix',
        country: 'US',
        contacts: [{ firstName: 'Maya', lastName: 'Patel', title: 'COO' }],
      },
      {
        name: 'Ironclad Security',
        domain: 'ironclad.example',
        industry: 'Cybersecurity',
        employees: 220,
        city: 'Austin',
        country: 'US',
        contacts: [{ firstName: 'Ethan', lastName: 'Brooks', title: 'VP Engineering' }],
      },
      {
        name: 'Juniper Education',
        domain: 'juniper-edu.example',
        industry: 'Education',
        employees: 95,
        city: 'Denver',
        country: 'US',
        contacts: [{ firstName: 'Sofia', lastName: 'Russo', title: 'Program Director' }],
      },
      {
        name: 'Keystone Manufacturing',
        domain: 'keystone-mfg.example',
        industry: 'Manufacturing',
        employees: 1800,
        city: 'Cleveland',
        country: 'US',
        contacts: [{ firstName: 'Greg', lastName: 'Novak', title: 'Plant Director' }],
      },
      {
        name: 'Lumen Retail',
        domain: 'lumen-retail.example',
        industry: 'Retail',
        employees: 5200,
        city: 'Seattle',
        country: 'US',
        contacts: [
          { firstName: 'Hannah', lastName: 'Kim', title: 'VP Digital' },
          { firstName: 'Omar', lastName: 'Haddad', title: 'Head of Store Operations' },
        ],
      },
    ],
    deals: [
      {
        company: 'Acme Logistics',
        title: 'Fleet telematics rollout',
        amount: 48000,
        stage: 'NEGOTIATION',
        daysInStage: 23,
        closeInDays: 20,
        owner: 'alex',
      },
      {
        company: 'Acme Logistics',
        title: 'Warehouse dashboard add-on',
        amount: 12000,
        stage: 'PROPOSAL',
        daysInStage: 9,
        closeInDays: 35,
        owner: 'alex',
      },
      {
        company: 'Acme Logistics',
        title: 'Pilot program 2025',
        amount: 18000,
        stage: 'WON',
        daysInStage: 60,
        closeInDays: -60,
        owner: 'alex',
      },
      {
        company: 'Acme Logistics',
        title: 'Driver safety training',
        amount: 8000,
        stage: 'LEAD',
        daysInStage: 4,
        closeInDays: 60,
        owner: 'sam',
      },
      {
        company: 'Brightwave Health',
        title: 'Patient intake portal',
        amount: 64000,
        stage: 'PROPOSAL',
        daysInStage: 12,
        closeInDays: 40,
        owner: 'sam',
      },
      {
        company: 'Brightwave Health',
        title: 'Data migration services',
        amount: 22000,
        stage: 'QUALIFIED',
        daysInStage: 5,
        closeInDays: 70,
        owner: 'sam',
      },
      {
        company: 'Brightwave Health',
        title: 'Compliance reporting',
        amount: 30000,
        stage: 'WON',
        daysInStage: 20,
        closeInDays: -20,
        owner: 'sam',
      },
      {
        company: 'Cobalt Robotics',
        title: 'Robot fleet monitoring',
        amount: 38000,
        stage: 'QUALIFIED',
        daysInStage: 20,
        closeInDays: 60,
        owner: 'alex',
      },
      {
        company: 'Cobalt Robotics',
        title: 'Support plan upgrade',
        amount: 9000,
        stage: 'WON',
        daysInStage: 25,
        closeInDays: -25,
        owner: 'alex',
      },
      {
        company: 'Driftwood Hotels',
        title: 'Guest messaging upgrade',
        amount: 36000,
        stage: 'NEGOTIATION',
        daysInStage: 6,
        closeInDays: 14,
        owner: 'sam',
      },
      {
        company: 'Driftwood Hotels',
        title: 'Loyalty app redesign',
        amount: 45000,
        stage: 'LOST',
        daysInStage: 40,
        closeInDays: -40,
        owner: 'sam',
      },
      {
        company: 'Evergreen Foods',
        title: 'Supplier portal',
        amount: 27000,
        stage: 'PROPOSAL',
        daysInStage: 26,
        closeInDays: 25,
        owner: 'alex',
      },
      {
        company: 'Evergreen Foods',
        title: 'Demand forecasting POC',
        amount: 16000,
        stage: 'LEAD',
        daysInStage: 3,
        closeInDays: 90,
        owner: 'alex',
      },
      {
        company: 'Evergreen Foods',
        title: 'Cold chain sensors',
        amount: 41000,
        stage: 'QUALIFIED',
        daysInStage: 16,
        closeInDays: 55,
        owner: 'alex',
      },
      {
        company: 'Fjord Analytics',
        title: 'Embedded analytics OEM',
        amount: 120000,
        stage: 'QUALIFIED',
        daysInStage: 8,
        closeInDays: 75,
        owner: 'sam',
      },
      {
        company: 'Fjord Analytics',
        title: 'Partner referral agreement',
        amount: 5000,
        stage: 'LEAD',
        daysInStage: 15,
        closeInDays: 100,
        owner: 'sam',
      },
      {
        company: 'Granite Insurance',
        title: 'Claims automation suite',
        amount: 96000,
        stage: 'NEGOTIATION',
        daysInStage: 31,
        closeInDays: 10,
        owner: 'alex',
      },
      {
        company: 'Granite Insurance',
        title: 'Broker portal',
        amount: 42000,
        stage: 'LOST',
        daysInStage: 70,
        closeInDays: -70,
        owner: 'alex',
      },
      {
        company: 'Helios Solar',
        title: 'Field service app',
        amount: 15000,
        stage: 'NEGOTIATION',
        daysInStage: 40,
        closeInDays: 5,
        owner: 'sam',
      },
      {
        company: 'Helios Solar',
        title: 'Installer scheduling',
        amount: 28000,
        stage: 'WON',
        daysInStage: 12,
        closeInDays: -12,
        owner: 'sam',
      },
      {
        company: 'Ironclad Security',
        title: 'SOC dashboard integration',
        amount: 33000,
        stage: 'PROPOSAL',
        daysInStage: 17,
        closeInDays: 30,
        owner: 'alex',
      },
      {
        company: 'Ironclad Security',
        title: 'Threat intel feed',
        amount: 21000,
        stage: 'LEAD',
        daysInStage: 2,
        closeInDays: 80,
        owner: 'alex',
      },
      {
        company: 'Ironclad Security',
        title: 'Pen-test retainer',
        amount: 26000,
        stage: 'WON',
        daysInStage: 50,
        closeInDays: -50,
        owner: 'alex',
      },
      {
        company: 'Juniper Education',
        title: 'Learning platform licenses',
        amount: 14000,
        stage: 'QUALIFIED',
        daysInStage: 11,
        closeInDays: 45,
        owner: 'sam',
      },
      {
        company: 'Juniper Education',
        title: 'Teacher training add-on',
        amount: 6000,
        stage: 'WON',
        daysInStage: 33,
        closeInDays: -33,
        owner: 'sam',
      },
      {
        company: 'Keystone Manufacturing',
        title: 'Predictive maintenance pilot',
        amount: 54000,
        stage: 'NEGOTIATION',
        daysInStage: 10,
        closeInDays: 18,
        owner: 'alex',
      },
      {
        company: 'Keystone Manufacturing',
        title: 'MES integration',
        amount: 88000,
        stage: 'PROPOSAL',
        daysInStage: 22,
        closeInDays: 50,
        owner: 'alex',
      },
      {
        company: 'Keystone Manufacturing',
        title: 'Spare parts portal',
        amount: 19000,
        stage: 'LOST',
        daysInStage: 15,
        closeInDays: -15,
        owner: 'alex',
      },
      {
        company: 'Lumen Retail',
        title: 'Store analytics platform',
        amount: 72000,
        stage: 'NEGOTIATION',
        daysInStage: 18,
        closeInDays: 12,
        owner: 'sam',
      },
      {
        company: 'Lumen Retail',
        title: 'Loyalty data pipeline',
        amount: 58000,
        stage: 'QUALIFIED',
        daysInStage: 4,
        closeInDays: 65,
        owner: 'sam',
      },
      {
        company: 'Lumen Retail',
        title: 'Holiday campaign tooling',
        amount: 24000,
        stage: 'WON',
        daysInStage: 45,
        closeInDays: -45,
        owner: 'sam',
      },
      {
        company: 'Lumen Retail',
        title: 'Kiosk software refresh',
        amount: 31000,
        stage: 'LEAD',
        daysInStage: 7,
        closeInDays: 95,
        owner: 'sam',
      },
    ],
    activities: [
      {
        company: 'Acme Logistics',
        deal: 'Fleet telematics rollout',
        type: 'TASK',
        subject: 'Send revised order form to Marcus',
        daysAgo: 1,
        author: 'alex',
      },
      {
        company: 'Acme Logistics',
        deal: 'Fleet telematics rollout',
        type: 'CALL',
        subject: 'Check-in with Dana on rollout plan',
        body: 'Dana confirmed the pilot results were strong: fuel costs down 7% on the two pilot routes. Procurement is still waiting on our security questionnaire before final sign-off. Concern: they need the rollout live in all three depots before the Q4 peak.',
        daysAgo: 3,
        author: 'alex',
      },
      {
        company: 'Acme Logistics',
        deal: 'Fleet telematics rollout',
        type: 'EMAIL',
        subject: 'Sent security questionnaire answers',
        body: 'Shared completed questionnaire, SOC 2 report and data retention policy with Marcus. Asked for feedback by end of next week.',
        daysAgo: 9,
        author: 'alex',
      },
      {
        company: 'Acme Logistics',
        deal: 'Warehouse dashboard add-on',
        type: 'MEETING',
        subject: 'On-site workshop at Chicago depot',
        body: 'Great workshop with the ops leads, who were excited about route-level dashboards. They asked about SSO and how long raw GPS data is retained. Dana wants the warehouse dashboard bundled if the price works.',
        daysAgo: 16,
        author: 'alex',
      },
      {
        company: 'Acme Logistics',
        deal: 'Fleet telematics rollout',
        type: 'CALL',
        subject: 'Negotiation kickoff with procurement',
        body: 'Marcus asked for a 12% discount on a 3-year term. We offered 8% plus free onboarding for all depots. He will take it to the budget committee.',
        daysAgo: 23,
        author: 'alex',
      },
      {
        company: 'Granite Insurance',
        deal: 'Claims automation suite',
        type: 'CALL',
        subject: 'Pricing follow-up with Robert',
        body: 'Robert raised a concern about a budget freeze until the new fiscal year. A competitor is also in the running with a lower upfront price. He still sees strong fit for the claims triage module.',
        daysAgo: 12,
        author: 'alex',
      },
      {
        company: 'Granite Insurance',
        deal: 'Claims automation suite',
        type: 'EMAIL',
        subject: 'No response to revised proposal',
        body: 'Sent the revised proposal with phased payments two weeks ago; no response yet. Pinged Robert again today.',
        daysAgo: 6,
        author: 'alex',
      },
      {
        company: 'Granite Insurance',
        deal: 'Claims automation suite',
        type: 'TASK',
        subject: 'Schedule exec sponsor call with Nina Park (CFO)',
        daysAgo: 2,
        author: 'alex',
      },
      {
        company: 'Lumen Retail',
        deal: 'Store analytics platform',
        type: 'MEETING',
        subject: 'Store pilot review with Hannah and Omar',
        body: 'Pilot in 12 stores showed 4% uplift in basket size. Omar is a strong champion; legal is reviewing the data processing addendum.',
        daysAgo: 19,
        author: 'sam',
      },
      {
        company: 'Fjord Analytics',
        deal: 'Embedded analytics OEM',
        type: 'CALL',
        subject: 'OEM terms discussion',
        body: 'Ingrid is interested in white-labelling the charts module. Needs a revenue-share model instead of per-seat pricing.',
        daysAgo: 8,
        author: 'sam',
      },
    ],
  },
  {
    name: 'Globex Partners',
    slug: 'globex',
    users: [{ key: 'jordan', name: 'Jordan Lee', email: 'jordan@globex.test' }],
    companies: [
      {
        name: 'Acme Media',
        domain: 'acme-media.example',
        industry: 'Media',
        employees: 300,
        city: 'Los Angeles',
        country: 'US',
        contacts: [{ firstName: 'Olivia', lastName: 'Grant', title: 'CMO' }],
      },
      {
        name: 'Orbit Telecom',
        domain: 'orbit-telecom.example',
        industry: 'Telecom',
        employees: 4000,
        city: 'Dallas',
        country: 'US',
        contacts: [
          { firstName: 'Victor', lastName: 'Ramos', title: 'Director of Network Operations' },
        ],
      },
      {
        name: 'Pinnacle Legal',
        domain: 'pinnacle-legal.example',
        industry: 'Legal',
        employees: 150,
        city: 'New York',
        country: 'US',
        contacts: [{ firstName: 'Claire', lastName: 'Dubois', title: 'Managing Partner' }],
      },
      {
        name: 'Quartz Biotech',
        domain: 'quartz-bio.example',
        industry: 'Biotech',
        employees: 260,
        city: 'San Diego',
        country: 'US',
        contacts: [{ firstName: 'Arjun', lastName: 'Mehta', title: 'Head of Lab Informatics' }],
      },
      {
        name: 'Redwood Capital',
        domain: 'redwood-capital.example',
        industry: 'Finance',
        employees: 80,
        city: 'San Francisco',
        country: 'US',
        contacts: [{ firstName: 'Emily', lastName: 'Stone', title: 'COO' }],
      },
    ],
    deals: [
      {
        company: 'Acme Media',
        title: 'Content analytics suite',
        amount: 52000,
        stage: 'NEGOTIATION',
        daysInStage: 25,
        closeInDays: 15,
        owner: 'jordan',
      },
      {
        company: 'Acme Media',
        title: 'Ad ops automation',
        amount: 23000,
        stage: 'PROPOSAL',
        daysInStage: 8,
        closeInDays: 40,
        owner: 'jordan',
      },
      {
        company: 'Orbit Telecom',
        title: 'Network ops dashboard',
        amount: 140000,
        stage: 'QUALIFIED',
        daysInStage: 14,
        closeInDays: 80,
        owner: 'jordan',
      },
      {
        company: 'Orbit Telecom',
        title: 'Field technician app',
        amount: 35000,
        stage: 'WON',
        daysInStage: 30,
        closeInDays: -30,
        owner: 'jordan',
      },
      {
        company: 'Pinnacle Legal',
        title: 'Matter management',
        amount: 47000,
        stage: 'NEGOTIATION',
        daysInStage: 19,
        closeInDays: 20,
        owner: 'jordan',
      },
      {
        company: 'Quartz Biotech',
        title: 'Lab data platform',
        amount: 66000,
        stage: 'PROPOSAL',
        daysInStage: 21,
        closeInDays: 45,
        owner: 'jordan',
      },
      {
        company: 'Quartz Biotech',
        title: 'Compliance module',
        amount: 18000,
        stage: 'LEAD',
        daysInStage: 3,
        closeInDays: 90,
        owner: 'jordan',
      },
      {
        company: 'Redwood Capital',
        title: 'Portfolio reporting',
        amount: 29000,
        stage: 'LOST',
        daysInStage: 35,
        closeInDays: -35,
        owner: 'jordan',
      },
      {
        company: 'Redwood Capital',
        title: 'Investor portal',
        amount: 39000,
        stage: 'QUALIFIED',
        daysInStage: 9,
        closeInDays: 60,
        owner: 'jordan',
      },
    ],
    activities: [
      {
        company: 'Acme Media',
        deal: 'Content analytics suite',
        type: 'CALL',
        subject: 'Contract redlines with Olivia',
        body: 'Olivia wants a 60-day termination clause. Otherwise ready to sign.',
        daysAgo: 4,
        author: 'jordan',
      },
    ],
  },
];

/** Stage-appropriate history generated for every deal (oldest first). */
export const STAGE_HISTORY: Record<
  DealStage,
  { type: ActivityType; subject: string; body: string }[]
> = {
  LEAD: [
    {
      type: 'EMAIL',
      subject: 'Intro email sent',
      body: 'Shared a short overview and a relevant case study; asked for a 30-minute discovery call.',
    },
  ],
  QUALIFIED: [
    {
      type: 'EMAIL',
      subject: 'Intro email sent',
      body: 'Shared a short overview and a relevant case study; asked for a discovery call.',
    },
    {
      type: 'CALL',
      subject: 'Discovery call',
      body: 'Confirmed budget owner and timeline. Main pain point: manual reporting takes about two days every month.',
    },
  ],
  PROPOSAL: [
    {
      type: 'CALL',
      subject: 'Discovery call',
      body: 'Confirmed budget owner, success criteria and a decision before quarter end.',
    },
    {
      type: 'MEETING',
      subject: 'Demo with stakeholders',
      body: 'Demo went well; the team liked the dashboard views and asked for pricing on a 3-year term.',
    },
    {
      type: 'EMAIL',
      subject: 'Proposal sent',
      body: 'Sent the proposal with two pricing options and an implementation plan.',
    },
  ],
  NEGOTIATION: [
    {
      type: 'MEETING',
      subject: 'Demo with stakeholders',
      body: 'Positive demo; technical team signed off on the integration approach.',
    },
    {
      type: 'EMAIL',
      subject: 'Proposal sent',
      body: 'Sent the final proposal and the MSA for legal review.',
    },
    {
      type: 'CALL',
      subject: 'Pricing discussion',
      body: 'Procurement is pushing for a 10% discount; legal is reviewing our MSA redlines.',
    },
  ],
  WON: [
    {
      type: 'EMAIL',
      subject: 'Proposal sent',
      body: 'Sent the proposal with implementation timeline.',
    },
    {
      type: 'NOTE',
      subject: 'Contract signed',
      body: 'Signed. Kickoff scheduled with the onboarding team; customer is happy with the plan.',
    },
  ],
  LOST: [
    {
      type: 'EMAIL',
      subject: 'Proposal sent',
      body: 'Sent the proposal and followed up twice.',
    },
    {
      type: 'NOTE',
      subject: 'Closed lost',
      body: 'Lost to a competitor on price. Revisit in six months.',
    },
  ],
};
