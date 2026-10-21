import { notFound } from 'next/navigation';
import { Shell } from '@/components/shell';
import { OrderList } from '@/components/order-list';
import { OrderDetail } from '@/components/order-detail';
import { Settings } from '@/components/settings';
import { NewOrder } from '@/components/new-order';
import { Customers } from '@/components/customers';
import { Story } from '@/components/story';
import { ReviewPage } from '@/components/review';
import { demoOrders, demoShop, demoGarments, demoSpec } from '@/lib/demo';
import { customerSearch, type CustomerSearchParams } from '@/lib/customers';
export const metadata = {
  title: 'Explore the demo',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<CustomerSearchParams>;
}) {
  const { path = [] } = await params;
  const [section, id] = path;
  let content;
  if (!section || (section === 'orders' && !id)) content = <OrderList orders={demoOrders} demo />;
  else if (section === 'orders' && id === 'new') content = <NewOrder demo />;
  else if (section === 'orders') {
    const order = demoOrders.find((o) => o.id === id);
    if (!order) notFound();
    content = <OrderDetail order={order} demo />;
  } else if (section === 'customers') {
    const { query } = customerSearch(await searchParams);
    const customers = Array.from(
      new Map(
        demoOrders.map((o) => [o.customer_id, { id: o.customer_id, ...o.customers }]),
      ).values(),
    );
    if (id && !customers.some((c) => c.id === id)) notFound();
    const matched = id
      ? customers
      : customers.filter((c) =>
          `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(query.toLowerCase()),
        );
    content = (
      <Customers
        demo
        id={id}
        orders={demoOrders}
        customers={matched}
        directory={{
          customers: matched,
          total: matched.length,
          page: 1,
          pages: 1,
          page_size: 24,
          query,
        }}
      />
    );
  } else if (section === 'settings' && ['shop', 'team', 'billing', 'data'].includes(id))
    content = <Settings shop={demoShop} demo tab={id} />;
  else if (section === 'story') content = <Story />;
  else if (section === 'review')
    return (
      <ReviewPage
        demo
        review={{
          id: 'demo',
          version: 2,
          snapshot: {
            garments: demoGarments.map((g) => ({
              ...g,
              sizes: g.sizes.map((s) => ({ ...s, received: s.expected })),
            })),
            spec: demoSpec,
            policy: demoShop.policy,
            policy_version: 1,
          },
          files: [],
        }}
      />
    );
  else notFound();
  return (
    <Shell demo shopName={demoShop.name}>
      {content}
    </Shell>
  );
}
