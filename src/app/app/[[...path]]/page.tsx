import { notFound, redirect } from 'next/navigation';
import {
  context,
  orderDirectory,
  order,
  customerDirectory,
  customerDetail,
  assignmentMembers,
} from '@/lib/data';
import { Shell } from '@/components/shell';
import { OrderList } from '@/components/order-list';
import { OrderDetail } from '@/components/order-detail';
import { Settings } from '@/components/settings';
import { NewOrder } from '@/components/new-order';
import { Customers } from '@/components/customers';
import { emailConfiguration } from '@/lib/email';
import { billingConfiguration } from '@/lib/billing-domain';
import { customerSearch, type CustomerSearchParams } from '@/lib/customers';
import { orderFilters, orderListHref, orderReturnHref } from '@/lib/order-directory';
import { logoInfo } from '@/lib/shop-logo';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<CustomerSearchParams>;
}) {
  const { path = [] } = await params;
  if (!path.length) redirect('/app/orders');
  const { shop, member, db, readOnly } = await context();
  const query = await searchParams;
  const search = customerSearch(query);
  const logo = logoInfo(shop);
  const [section, id] = path;
  let content;
  if (section === 'orders' && !id) {
    const filters = orderFilters(query);
    const directory = await orderDirectory(filters);
    if (directory.page !== filters.page) redirect(orderListHref(filters, { page: directory.page }));
    content = (
      <OrderList
        key={orderListHref(filters)}
        orders={directory.orders}
        directory={directory}
        filters={filters}
        demo={false}
        members={await assignmentMembers()}
      />
    );
  } else if (section === 'orders' && id === 'new') content = <NewOrder />;
  else if (section === 'orders') {
    const result = await order(id);
    if (!result) notFound();
    content = (
      <OrderDetail
        order={result.order}
        files={result.files}
        timezone={shop.timezone}
        readOnly={readOnly}
        backHref={orderReturnHref(query.from)}
        members={await assignmentMembers()}
      />
    );
  } else if (section === 'customers') {
    if (path.length > 2) notFound();
    if (id) {
      const detail = await customerDetail(id, search.page);
      if (!detail) notFound();
      content = (
        <Customers
          customers={[detail.customer]}
          history={detail.history}
          id={id}
          readOnly={readOnly}
        />
      );
    } else {
      const directory = await customerDirectory(search.query, search.page);
      content = <Customers customers={directory.customers} directory={directory} />;
    }
  } else if (section === 'settings' && ['shop', 'team', 'billing', 'data'].includes(id)) {
    const team = id === 'team' && member.role === 'owner' ? await db.rpc('team_details') : null;
    if (team?.error) throw new Error('Could not load your team. Please retry.');
    const messages =
      id === 'shop' && member.role === 'owner' ? await db.rpc('outbox_status') : null;
    if (messages?.error) throw new Error('Could not load email status. Please retry.');
    const billing =
      id === 'billing' && member.role === 'owner' ? await db.rpc('billing_summary') : null;
    if (billing?.error) throw new Error('Could not load billing status. Please retry.');
    const billingConfig = billingConfiguration();
    content = (
      <Settings
        shop={shop}
        tab={id}
        owner={member.role === 'owner'}
        team={team?.data}
        email={emailConfiguration()}
        messages={messages?.data}
        billing={billing?.data}
        billingMode={billingConfig ? (billingConfig.live ? 'live' : 'test') : 'unconfigured'}
        logo={logo}
      />
    );
  } else notFound();
  return (
    <Shell shopName={shop.name} role={member.role} readOnly={readOnly} logo={logo}>
      {content}
    </Shell>
  );
}
