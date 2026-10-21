import type { Order } from './domain';

export type Customer = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone?: string;
  internal_notes?: string;
  revision?: number;
  order_count?: number;
};
export type PageInfo = { total: number; page: number; pages: number; page_size: number };
export type CustomerDirectory = PageInfo & { customers: Customer[]; query: string };
export type CustomerOrder = Pick<Order, 'id' | 'number' | 'title' | 'lifecycle'> & {
  created_at: string;
};
export type CustomerHistory = PageInfo & { orders: CustomerOrder[] };
export type CustomerSearchParams = Record<string, string | string[] | undefined>;

export function customerSearch(params: CustomerSearchParams) {
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, 160) : '';
  const value = typeof params.page === 'string' ? params.page : '';
  const page = /^\d{1,10}$/.test(value) ? Math.max(1, Math.min(2147483647, Number(value))) : 1;
  return { query, page };
}

export function customerPageHref(path: string, page: number, query = '') {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  return path + (params.size ? '?' + params.toString() : '');
}
