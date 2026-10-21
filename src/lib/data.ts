import 'server-only';
import { redirect } from 'next/navigation';
import { supabase } from './supabase/server';
import { configured } from './config';
import type { Order, Proof, Approval, AssignmentMember } from './domain';
import type { Customer, CustomerDirectory, CustomerHistory } from './customers';
import type { OrderDirectory, OrderFilters } from './order-directory';
export async function context() {
  if (!configured()) redirect('/login?setup=1');
  const db = await supabase();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims) redirect('/login');
  const { data: member } = await db
    .from('memberships')
    .select('workspace_id,role')
    .eq('user_id', data.claims.sub)
    .single();
  if (!member) redirect('/onboarding');
  const { data: shop, error: shopError } = await db
    .from('workspaces')
    .select('*')
    .eq('id', member.workspace_id)
    .single();
  if (shopError || !shop) throw new Error('Could not load your shop. Please retry.');
  const readOnly =
    Math.max(
      ...[shop.trial_ends_at, shop.paid_through, shop.grace_until].map((value) =>
        value ? new Date(value).getTime() : 0,
      ),
    ) <= Date.now();
  return { db, member, shop, user: data.claims, readOnly };
}
async function orders(id: string) {
  const { db, shop } = await context();
  let query = db
    .from('orders')
    .select('*,customers(name,company,email)')
    .eq('workspace_id', shop.id)
    .order('created_at', { ascending: false });
  query = query.eq('id', id).limit(1);
  const { data, error } = await query;
  if (error) throw new Error('Could not load orders. Please retry.');
  const ids = (data || []).map((x) => x.id);
  if (!ids.length) return [];
  const [versions, decisions, requests] = await Promise.all([
    db.from('proof_versions').select('*').in('order_id', ids).order('version'),
    db.from('approval_decisions').select('*').in('order_id', ids),
    db
      .from('review_requests')
      .select('order_id,proof_id,expires_at,revoked_at,decided_at')
      .in('order_id', ids),
  ]);
  if (versions.error || decisions.error || requests.error)
    throw new Error('Could not load approval records. Please retry.');
  return (data || []).map((row) => {
    const proofs = (versions.data || [])
      .filter((p) => p.order_id === row.id)
      .map((p) => ({
        ...p,
        ...(decisions.data || []).find((d) => d.proof_id === p.id),
        id: p.id,
      })) as Proof[];
    const latest = (versions.data || []).filter((p) => p.order_id === row.id).at(-1);
    const decision = (decisions.data || []).find((d) => d.proof_id === latest?.id);
    let approval: Approval = latest ? 'pending' : 'not_requested';
    if (decision) approval = decision.choice;
    const review = (requests.data || []).find((r) => r.proof_id === latest?.id);
    if (
      latest &&
      !decision &&
      (!review || review.revoked_at || new Date(review.expires_at).getTime() <= Date.now())
    )
      approval = 'invalidated';
    if (
      latest &&
      (latest.spec_revision !== row.spec_revision ||
        latest.snapshot.policy_version !== shop.policy_version)
    )
      approval = 'invalidated';
    return { ...row, proofs, approval, events: [] } as Order;
  });
}

export async function orderDirectory(filters: OrderFilters) {
  const { db } = await context();
  const { data, error } = await db.rpc('order_directory', {
    p_query: filters.query,
    p_status: filters.status,
    p_assignee: filters.assignee,
    p_archived: filters.archived,
    p_sort: filters.sort,
    p_page: filters.page,
  });
  if (error) throw new Error('Could not load orders. Please retry.');
  return data as OrderDirectory;
}

export async function assignmentMembers() {
  const { db } = await context();
  const { data, error } = await db.rpc('assignment_members');
  if (error) throw new Error('Could not load assignment choices. Please retry.');
  return data as AssignmentMember[];
}
export async function order(id: string) {
  const all = await orders(id);
  const found = all.find((o) => o.id === id);
  if (!found) return null;
  const { db } = await context();
  const [events, files] = await Promise.all([
    db
      .from('order_events')
      .select('id,kind,created_at,details')
      .eq('order_id', id)
      .order('created_at'),
    db
      .from('attachments')
      .select('id,name,mime,purpose,caption,state,bytes')
      .eq('order_id', id)
      .eq('state', 'ready')
      .order('created_at'),
  ]);
  if (events.error || files.error) throw new Error('Could not load order records. Please retry.');
  return {
    order: { ...found, events: events.data || [] },
    files: files.data || [],
  };
}

export async function customerDirectory(query: string, page: number) {
  const { db } = await context();
  const { data, error } = await db.rpc('customer_directory', { p_query: query, p_page: page });
  if (error) throw new Error('Could not load customers. Please retry.');
  return data as CustomerDirectory;
}

export async function customerDetail(id: string, page: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return null;
  const { db, shop } = await context();
  const { data: customer, error } = await db
    .from('customers')
    .select('*')
    .eq('workspace_id', shop.id)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Could not load this customer. Please retry.');
  if (!customer) return null;
  const history = await db.rpc('customer_order_history', { p_customer: id, p_page: page });
  if (history.error) throw new Error('Could not load customer orders. Please retry.');
  return { customer: customer as Customer, history: history.data as CustomerHistory };
}
