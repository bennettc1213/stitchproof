import type { Order, Garment, Spec } from './domain';
export const demoPolicy =
  'Customer-supplied garments are inspected at intake. Please review the design, placement, spelling, and garment quantities before approving. Contact Cedar Stitch Demo with any questions before production begins. This fictional policy is for the product tour only.';
const sizes = [
  { size: 'S', expected: 6, received: 6 },
  { size: 'M', expected: 8, received: 7 },
  { size: 'L', expected: 6, received: 6 },
  { size: 'XL', expected: 4, received: 4 },
];
export const demoGarments: Garment[] = [
  { description: 'Company polos', color: 'Sandstone', sizes },
];
export const demoSpec: Spec = {
  placement: 'Left chest',
  design: 'Northline wordmark',
  dimensions: '3.0 × 1.2 in',
  thread: 'Forest green · single color',
  text: 'NORTHLINE',
  instructions: 'Center above the left chest seam. Keep all polos consistent.',
};
const rows = [
  [
    'northline',
    'Northline team polos',
    'Alex Morgan',
    'Northline Studio',
    'open',
    'not_requested',
    24,
    23,
    '2026-10-23',
  ],
  [
    'fieldwork',
    'Fieldwork crew jackets',
    'Jamie Chen',
    'Fieldwork Collective',
    'open',
    'pending',
    12,
    12,
    '2026-10-24',
  ],
  [
    'olive',
    'Olive & Oak aprons',
    'Sam Rivera',
    'Olive & Oak',
    'open',
    'changes_requested',
    18,
    18,
    '2026-10-25',
  ],
  [
    'ridge',
    'Ridgeway staff fleeces',
    'Taylor Brooks',
    'Ridgeway Supply',
    'open',
    'approved',
    8,
    8,
    '2026-10-26',
  ],
  [
    'goodday',
    'Good Day café caps',
    'Jordan Lee',
    'Good Day Café',
    'in_production',
    'approved',
    30,
    30,
    '2026-10-27',
  ],
  [
    'studio',
    'Studio Eight totes',
    'Casey Park',
    'Studio Eight',
    'ready_for_pickup',
    'approved',
    20,
    20,
    '2026-10-28',
  ],
  [
    'moss',
    'Moss garden workwear',
    'Riley Quinn',
    'Moss Garden Co.',
    'completed',
    'approved',
    10,
    10,
    '2026-10-18',
  ],
] as const;
export const demoOrders: Order[] = rows.map((r, i) => ({
  id: r[0],
  number: 1048 - i,
  title: r[1],
  due_date: r[8],
  lifecycle: r[4],
  approval: r[5],
  revision: 1,
  customer_id: 'customer-' + r[0],
  customers: { name: r[2], company: r[3], email: r[0] + '@example.test' },
  garments:
    i === 0
      ? structuredClone(demoGarments)
      : [
          {
            description: r[1].split(' ').slice(-1)[0],
            color: i === 1 ? 'Charcoal' : 'Natural',
            sizes: [{ size: 'Mixed sizes', expected: r[6], received: r[7] }],
          },
        ],
  spec: { ...demoSpec, design: r[3] + ' wordmark', text: r[3].toUpperCase() },
  internal_notes: 'Fictional internal note. This is never shown in the customer review.',
  proofs:
    i === 0
      ? []
      : [
          {
            id: 'proof-' + i,
            version: i === 3 ? 2 : 1,
            snapshot: {
              garments: [
                {
                  description: r[1],
                  color: 'Natural',
                  sizes: [{ size: 'Mixed sizes', expected: r[6], received: r[7] }],
                },
              ],
              spec: { ...demoSpec, text: r[3].toUpperCase() },
              policy: demoPolicy,
              policy_version: 1,
            },
            files: [
              {
                id: 'sample',
                name: 'left-chest-proof.png',
                mime: 'image/png',
                digest: 'demonstration',
              },
            ],
            choice: ['approved', 'changes_requested'].includes(r[5])
              ? r[5]
              : i > 3
                ? 'approved'
                : undefined,
            name: i > 2 ? r[2] : undefined,
            comments: i === 2 ? 'Could we make the logo a little smaller?' : undefined,
            decided_at: i > 1 ? '2026-10-19T16:00:00Z' : undefined,
          },
        ],
  events: [
    {
      id: 'e' + i,
      kind: 'Order created',
      created_at: '2026-10-18T16:00:00Z',
      details: {},
    },
    {
      id: 'i' + i,
      kind: 'Garments received',
      created_at: '2026-10-19T16:00:00Z',
      details: {
        reason:
          i === 0
            ? 'One medium polo missing at intake. Customer notified.'
            : 'Counts checked at intake.',
      },
    },
  ],
}));
export const demoShop = {
  id: 'demo',
  name: 'Cedar Stitch Demo',
  timezone: 'America/Los_Angeles',
  policy: demoPolicy,
  policy_version: 1,
  contact_email: 'hello@example.test',
  trial_ends_at: '2026-10-26T00:00:00Z',
  storage_used: 0,
  storage_limit: 2147483648,
};
