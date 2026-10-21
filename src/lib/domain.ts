import { z } from 'zod';
export const sizeSchema = z.object({
  size: z.string().trim().min(1).max(24),
  expected: z.number().int().min(0).max(100000),
  received: z.number().int().min(0).max(100000),
});
export const garmentSchema = z
  .object({
    description: z.string().trim().min(1).max(160),
    color: z.string().trim().max(80),
    sizes: z.array(sizeSchema).min(1).max(30),
  })
  .refine(
    (g) => new Set(g.sizes.map((s) => s.size.toLowerCase())).size === g.sizes.length,
    'Size labels must be unique.',
  );
export const specSchema = z.object({
  placement: z.string().trim().min(1).max(160),
  design: z.string().trim().max(160),
  dimensions: z.string().trim().max(80),
  thread: z.string().trim().max(500),
  text: z.string().max(500),
  instructions: z.string().max(2000),
});
export const intakeSchema = z.object({
  garments: z.array(garmentSchema).min(1).max(20),
  spec: specSchema,
  reason: z.string().trim().min(3).max(1000),
});
export type Garment = z.infer<typeof garmentSchema>;
export type Spec = z.infer<typeof specSchema>;
export type Lifecycle =
  'draft' | 'open' | 'in_production' | 'ready_for_pickup' | 'completed' | 'cancelled';
export type Approval =
  'not_requested' | 'pending' | 'changes_requested' | 'approved' | 'invalidated';
export type Proof = {
  id: string;
  version: number;
  snapshot: {
    shop?: string;
    title?: string;
    order_number?: number;
    due_date?: string | null;
    garments: Garment[];
    spec: Spec;
    policy: string;
    policy_version: number;
  };
  files: { id: string; name: string; mime: string; digest: string }[];
  choice?: string;
  name?: string;
  comments?: string;
  decided_at?: string;
};
export type Order = {
  id: string;
  number: number;
  title: string;
  due_date: string;
  lifecycle: Lifecycle;
  approval: Approval;
  revision: number;
  customer_id: string;
  customers: { name: string; company: string; email: string };
  garments: Garment[];
  spec: Spec;
  internal_notes: string;
  proofs: Proof[];
  events: {
    id: string;
    kind: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
  completed?: number;
  exceptions?: number;
  collector?: string;
  assigned_to?: string | null;
  assigned_label?: string;
  archived_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string;
};
export type AssignmentMember = { user_id: string; email: string; role: 'owner' | 'staff' };
export const labels: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  in_production: 'In production',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Collected',
  cancelled: 'Cancelled',
  not_requested: 'Not requested',
  pending: 'Awaiting approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  invalidated: 'Needs new approval',
};
export function totals(garments: Garment[]) {
  return garments
    .flatMap((g) => g.sizes)
    .reduce(
      (a, s) => ({
        expected: a.expected + s.expected,
        received: a.received + s.received,
      }),
      { expected: 0, received: 0 },
    );
}
export function dateOnly(value: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value + 'T12:00:00Z'));
}
export const DESIGN_CONFIRMATION =
  'I approve the displayed design, instructions, and garment quantities.';
export const POLICY_CONFIRMATION = 'I acknowledge the shop policy displayed with this proof.';
