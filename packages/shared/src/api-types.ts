import { z } from 'zod';
import { ACTIVITY_TYPES, DEAL_STAGES, type ActivityType, type DealStage } from './enums';

/* Response DTOs of the REST API. Dates are ISO-8601 strings on the wire. */

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  workspace: { id: string; name: string };
}

export interface LoginResponse {
  accessToken: string;
  user: CurrentUser;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface CompanyRef {
  id: string;
  name: string;
}

export interface DealListItem {
  id: string;
  title: string;
  amount: number;
  stage: DealStage;
  stageChangedAt: string;
  daysInStage: number;
  expectedCloseDate: string | null;
  /** Changes on every update; used for optimistic concurrency checks. */
  updatedAt: string;
  company: CompanyRef;
  owner: UserRef;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  phone: string | null;
  company: CompanyRef;
}

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurredAt: string;
  author: UserRef;
  company: CompanyRef | null;
  deal: { id: string; title: string } | null;
  contact: { id: string; name: string } | null;
}

export interface DealDetail extends DealListItem {
  createdAt: string;
  contact: Contact | null;
  activities: Activity[];
}

export interface CompanyListItem {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employees: number | null;
  city: string | null;
  country: string | null;
  openDeals: number;
  openPipeline: number;
  lastActivityAt: string | null;
}

export interface CompanyDetail extends CompanyListItem {
  contacts: Contact[];
  deals: DealListItem[];
  activities: Activity[];
}

export interface PipelineStats {
  stages: { stage: DealStage; count: number; amount: number }[];
  openCount: number;
  openAmount: number;
  wonAmountLast90Days: number;
  winRateLast90Days: number | null;
  stuckOver14Days: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

/* Request bodies */

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const updateDealRequestSchema = z
  .object({
    stage: z.enum(DEAL_STAGES).optional(),
    amount: z.number().int().nonnegative().optional(),
    expectedCloseDate: z.iso.date().nullable().optional(),
    /** Must be a user of the same workspace (checked server-side). */
    ownerId: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateDealRequest = z.infer<typeof updateDealRequestSchema>;

export const createActivityRequestSchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().max(5000).optional(),
    dealId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => v.dealId !== undefined || v.companyId !== undefined, {
    message: 'An activity must be linked to a deal or a company',
  });
export type CreateActivityRequest = z.infer<typeof createActivityRequestSchema>;
