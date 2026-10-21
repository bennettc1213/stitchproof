import type { Order } from './domain';
import { customerSearch, type CustomerSearchParams, type PageInfo } from './customers';

export const orderStatuses = [
  ['all', 'All orders'],
  ['attention', 'Needs attention'],
  ['pending', 'Awaiting approval'],
  ['in_production', 'In production'],
  ['ready_for_pickup', 'Ready for pickup'],
  ['completed', 'Collected'],
  ['cancelled', 'Cancelled'],
  ['draft', 'Draft'],
  ['open', 'Open'],
  ['approved', 'Approved'],
  ['changes_requested', 'Changes requested'],
  ['invalidated', 'Needs new approval'],
] as const;
export const orderSorts = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['due_asc', 'Due date: earliest'],
  ['due_desc', 'Due date: latest'],
] as const;
export type OrderStatus = (typeof orderStatuses)[number][0];
export type OrderSort = (typeof orderSorts)[number][0];
export type OrderFilters = {
  query: string;
  status: OrderStatus;
  assignee: string;
  archived: boolean;
  sort: OrderSort;
  page: number;
};
export type OrderListItem = Pick<
  Order,
  | 'id'
  | 'number'
  | 'title'
  | 'due_date'
  | 'lifecycle'
  | 'approval'
  | 'assigned_to'
  | 'assigned_label'
  | 'archived_at'
  | 'customers'
> & { expected: number; received: number; discrepancy: boolean; created_at: string };
export type OrderDirectory = PageInfo & {
  orders: OrderListItem[];
  summary: { all: number; attention: number; pending: number; ready: number };
};
export function orderFilters(params: CustomerSearchParams): OrderFilters {
  const { query, page } = customerSearch(params);
  const status = orderStatuses.find(([value]) => value === params.status)?.[0] || 'all';
  const sort = orderSorts.find(([value]) => value === params.sort)?.[0] || 'newest';
  const assignee =
    typeof params.assignee === 'string' &&
    (params.assignee === 'unassigned' ||
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.assignee))
      ? params.assignee.toLowerCase()
      : 'all';
  return { query, page, status, sort, assignee, archived: params.view === 'archived' };
}
export function orderListHref(filters: OrderFilters, changes: Partial<OrderFilters> = {}) {
  const value = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (value.query) params.set('q', value.query);
  if (value.status !== 'all') params.set('status', value.status);
  if (value.assignee !== 'all') params.set('assignee', value.assignee);
  if (value.archived) params.set('view', 'archived');
  if (value.sort !== 'newest') params.set('sort', value.sort);
  if (value.page > 1) params.set('page', String(value.page));
  return '/app/orders' + (params.size ? '?' + params.toString() : '');
}
export function orderReturnHref(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^\/app\/orders(?:\?|$)/.test(value)) return '/app/orders';
  const parsed = new URL(value, 'http://threadproof.invalid');
  if (parsed.pathname !== '/app/orders') return '/app/orders';
  return orderListHref(orderFilters(Object.fromEntries(parsed.searchParams)));
}
