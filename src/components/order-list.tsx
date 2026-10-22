'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  ListFilter,
  Package,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { Order, AssignmentMember } from '@/lib/domain';
import { dateOnly, totals } from '@/lib/domain';
import { Status, Avatar, Empty } from './ui';
import { AssignmentLabel } from './order-controls';
import {
  orderFilters,
  orderListHref,
  orderSorts,
  orderStatuses,
  type OrderDirectory,
  type OrderFilters,
  type OrderListItem,
  type OrderSort,
  type OrderStatus,
} from '@/lib/order-directory';
const defaults = orderFilters({});
function rowTotals(order: Order | OrderListItem) {
  return 'expected' in order
    ? { expected: order.expected, received: order.received }
    : totals(order.garments);
}
export function OrderList({
  orders,
  demo,
  members = [],
  directory,
  filters = defaults,
}: {
  orders: (Order | OrderListItem)[];
  demo: boolean;
  members?: AssignmentMember[];
  directory?: OrderDirectory;
  filters?: OrderFilters;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(filters.query);
  const [tab, setTab] = useState<OrderStatus>(filters.status);
  const [sort, setSort] = useState<OrderSort>(filters.sort);
  const [assignee, setAssignee] = useState(filters.assignee);
  const archived = filters.archived;
  const chooseStatus = (status: OrderStatus) => {
    if (directory)
      router.push(orderListHref(filters, { query, status, sort, assignee, page: 1 }), {
        scroll: false,
      });
    else setTab(status);
  };
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const base = demo ? '/demo' : '/app';
  const attention = (o: Order | OrderListItem) =>
    !['completed', 'cancelled'].includes(o.lifecycle) &&
    (o.approval === 'changes_requested' ||
      o.approval === 'invalidated' ||
      rowTotals(o).expected !== rowTotals(o).received);
  let shown = directory
    ? orders
    : orders
        .filter((o) =>
          `${o.title} ${o.customers.name} ${o.customers.company} ${o.customers.email} #${o.number}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .filter(
          (o) =>
            tab === 'all' ||
            (tab === 'attention' && attention(o)) ||
            o.lifecycle === tab ||
            (o.approval === tab && !['completed', 'cancelled'].includes(o.lifecycle)),
        );
  if (!directory && sort === 'due_asc')
    shown = [...shown].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const needs = directory?.summary.attention ?? orders.filter(attention).length,
    pending =
      directory?.summary.pending ??
      orders.filter(
        (o) => o.approval === 'pending' && !['completed', 'cancelled'].includes(o.lifecycle),
      ).length,
    ready =
      directory?.summary.ready ?? orders.filter((o) => o.lifecycle === 'ready_for_pickup').length;
  const total = directory?.total ?? orders.length;
  const detailHref = (id: string) =>
    base +
    '/orders/' +
    id +
    (directory ? '?from=' + encodeURIComponent(orderListHref(filters)) : '');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR SHOP, IN ORDER</div>
          <h1>
            {archived ? 'Archived orders' : 'Orders'}
            <span className="heading-count">{total}</span>
          </h1>
          <p>A clear path from the first garment to the final pickup.</p>
        </div>
        <Link href={base + '/orders/new'} className="button primary">
          <Plus size={17} />
          {demo ? 'Preview new order' : 'New order'}
        </Link>
      </div>
      {!demo && (
        <nav aria-label="Order visibility" className="order-visibility">
          <Link
            href={orderListHref(filters, { archived: false, page: 1 })}
            aria-current={!archived ? 'page' : undefined}
          >
            Current orders
          </Link>
          <Link
            href={orderListHref(filters, { archived: true, page: 1 })}
            aria-current={archived ? 'page' : undefined}
          >
            Archived orders
          </Link>
        </nav>
      )}
      <div className="order-summary">
        <button onClick={() => chooseStatus('attention')}>
          <span className="summary-icon amber">
            <TriangleAlert size={18} />
          </span>
          <div>
            <strong>
              {needs}
              <span>need{needs === 1 ? 's' : ''} attention</span>
            </strong>
            <small>Discrepancies & requested changes</small>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => chooseStatus('pending')}>
          <span className="summary-icon lavender">
            <ClipboardCheck size={18} />
          </span>
          <div>
            <strong>
              {pending}
              <span>awaiting approval</span>
            </strong>
            <small>With your customers for review</small>
          </div>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => chooseStatus('ready_for_pickup')}>
          <span className="summary-icon green">
            <Package size={18} />
          </span>
          <div>
            <strong>
              {ready}
              <span>ready for pickup</span>
            </strong>
            <small>Finished, counted, good to go</small>
          </div>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="orders-panel">
        <div className="list-tabs" role="tablist" aria-label="Order status">
          {orderStatuses.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={value === tab}
              className={value === tab ? 'selected' : ''}
              onClick={() => chooseStatus(value)}
            >
              {label}
              {value === 'all' && <span>{directory?.summary.all ?? orders.length}</span>}
            </button>
          ))}
        </div>
        <form
          className={`list-toolbar ${directory ? 'order-filters' : ''}`}
          action={base + '/orders'}
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            if (directory)
              router.push(orderListHref(filters, { query, status: tab, sort, assignee, page: 1 }), {
                scroll: false,
              });
          }}
        >
          <input type="hidden" name="status" value={tab} />
          {archived && <input type="hidden" name="view" value="archived" />}
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              ref={searchRef}
              name="q"
              maxLength={160}
              aria-label="Search orders"
              placeholder="Search orders, customers, or order #…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
          {directory ? (
            <>
              <label className="order-filter">
                <span>Assigned to</span>
                <select
                  aria-label="Filter by assigned member"
                  name="assignee"
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                >
                  <option value="all">All team members</option>
                  <option value="unassigned">Unassigned</option>
                  {members.map((member) => (
                    <option value={member.user_id} key={member.user_id}>
                      {member.email}
                    </option>
                  ))}
                  {!['all', 'unassigned'].includes(assignee) &&
                    !members.some((member) => member.user_id === assignee) && (
                      <option value={assignee}>Former or unavailable member</option>
                    )}
                </select>
              </label>
              <label className="order-filter">
                <span>Sort</span>
                <select
                  aria-label="Sort orders"
                  name="sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as OrderSort)}
                >
                  {orderSorts.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary small" type="submit">
                Apply filters
              </button>
              {(filters.query ||
                filters.status !== 'all' ||
                filters.assignee !== 'all' ||
                filters.sort !== 'newest') && (
                <Link className="text-link" href={orderListHref(defaults, { archived })}>
                  Clear filters
                </Link>
              )}
            </>
          ) : (
            <button
              type="button"
              className={`button secondary small ${sort === 'due_asc' ? 'pressed' : ''}`}
              onClick={() => setSort(sort === 'due_asc' ? 'newest' : 'due_asc')}
            >
              <ListFilter size={15} />
              {sort === 'due_asc' ? 'Due date ↑' : 'Sort by due date'}
            </button>
          )}
        </form>
        <div className="table-scroll">
          <table className="orders-table">
            <thead>
              <tr>
                <th>
                  ORDER <ArrowDown size={11} />
                </th>
                <th>CUSTOMER</th>
                <th>GARMENTS</th>
                <th>STATUS</th>
                <th>DUE DATE</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const t = rowTotals(o);
                const mismatch =
                  'discrepancy' in o
                    ? o.discrepancy
                    : o.garments.some((group) =>
                        group.sizes.some((size) => size.expected !== size.received),
                      );
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={detailHref(o.id)} className="order-title">
                        <span className="order-number">#{o.number}</span>
                        <strong>{o.title}</strong>
                        {!demo && (
                          <small className="cell-hint">
                            <AssignmentLabel order={o} members={members} />
                          </small>
                        )}
                      </Link>
                    </td>
                    <td>
                      <div className="customer-cell">
                        <Avatar name={o.customers.company || o.customers.name} />
                        <div>
                          <strong>{o.customers.company || o.customers.name}</strong>
                          <span>{o.customers.name}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={mismatch ? 'count-warning' : 'garment-count'}>
                        {t.received}
                        <span> / {t.expected}</span>
                        {mismatch && <TriangleAlert size={12} />}
                      </span>
                      <small className="cell-hint">
                        {mismatch
                          ? t.expected === t.received
                            ? 'Size counts differ'
                            : t.expected > t.received
                              ? `${t.expected - t.received} missing`
                              : `${t.received - t.expected} extra`
                          : 'received'}
                      </small>
                    </td>
                    <td>
                      <Status
                        value={
                          o.lifecycle === 'open' || o.lifecycle === 'draft'
                            ? o.approval
                            : o.lifecycle
                        }
                      />
                    </td>
                    <td>
                      <span className="due-date">{dateOnly(o.due_date)}</span>
                      <small className="cell-hint">
                        {o.lifecycle === 'completed'
                          ? 'Collected'
                          : o.due_date?.slice(0, 4) || 'Not set'}
                      </small>
                    </td>
                    <td>
                      <Link
                        className="row-arrow"
                        href={detailHref(o.id)}
                        aria-label={`Open order ${o.number}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && (
          <Empty
            title={
              directory
                ? filters.query || filters.status !== 'all' || filters.assignee !== 'all'
                  ? 'No matching orders'
                  : archived
                    ? 'No archived orders yet'
                    : 'Your first order starts here'
                : orders.length
                  ? 'No matching orders'
                  : 'Your first order starts here'
            }
          >
            {directory &&
            archived &&
            !filters.query &&
            filters.status === 'all' &&
            filters.assignee === 'all'
              ? 'Collected and cancelled orders appear here when archived.'
              : orders.length ||
                  (directory &&
                    (filters.query || filters.status !== 'all' || filters.assignee !== 'all'))
                ? 'Try a different search or status.'
                : 'Create an order, count the garments, and keep every detail together.'}
          </Empty>
        )}
        <div className="table-footer">
          <span>
            Showing {shown.length} of {total} orders
          </span>
          <span>
            <CheckCheck size={14} />{' '}
            {demo ? 'Fictional records for exploration' : 'All matching shop records'}
          </span>
        </div>
      </div>
      {directory && directory.total > 0 && (
        <nav aria-label="Order pages" className="customer-pagination">
          <p>
            {(directory.page - 1) * directory.page_size + 1}–
            {Math.min(directory.page * directory.page_size, directory.total)} of {directory.total}
          </p>
          <div>
            {directory.page > 1 && (
              <Link
                className="button secondary small"
                href={orderListHref(filters, { page: directory.page - 1 })}
              >
                Previous
              </Link>
            )}
            <span>
              Page {directory.page} of {directory.pages}
            </span>
            {directory.page < directory.pages && (
              <Link
                className="button secondary small"
                href={orderListHref(filters, { page: directory.page + 1 })}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
      {demo && (
        <div className="workflow-callout">
          <div className="callout-visual">
            <span>01</span>
            <div className="stitch-line" />
            <span>02</span>
            <div className="stitch-line" />
            <span>03</span>
          </div>
          <div>
            <span className="eyebrow">FROM INTAKE TO “ALL SET”</span>
            <h3>One order. Every detail connected.</h3>
            <p>
              Follow 24 polos through a missing garment, a revised proof, and a confident pickup.
            </p>
          </div>
          <Link href="/demo/story" className="button secondary">
            Walk through the order
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <div className="workspace-tip">
        <span className="tip-dot" />
        <span>A small habit, a smoother day.</span> Confirm garment counts before sending a proof.
      </div>
    </>
  );
}
