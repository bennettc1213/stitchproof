import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin } from './supabase/admin';
import { validateLogo } from './uploads';
const bucket = 'shop-logos';
export type ShopLogo = { url: string; width: number; height: number };
type LogoColumns = {
  logo_path?: string | null;
  logo_digest?: string | null;
  logo_width?: number | null;
  logo_height?: number | null;
};
// The digest prefix changes on every replacement, so browsers revalidate a new logo.
export function logoInfo(shop: LogoColumns, token?: string): ShopLogo | null {
  if (!shop.logo_path || !shop.logo_digest) return null;
  const query = new URLSearchParams({ v: shop.logo_digest.slice(0, 16) });
  if (token) query.set('token', token);
  return {
    url: '/api/logo?' + query,
    width: shop.logo_width || 1,
    height: shop.logo_height || 1,
  };
}
export async function saveShopLogo(db: SupabaseClient, workspace: string, file: File) {
  const logo = await validateLogo(file);
  const service = admin();
  const path = `${workspace}/${randomUUID()}.png`;
  const upload = await service.storage
    .from(bucket)
    .upload(path, logo.bytes, { contentType: 'image/png', upsert: false });
  if (upload.error) throw new Error('The logo could not be uploaded. Please retry.');
  const { data: previous, error } = await db.rpc('set_shop_logo', {
    p_path: path,
    p_digest: logo.digest,
    p_bytes: logo.bytes.length,
    p_width: logo.width,
    p_height: logo.height,
  });
  if (error) {
    await service.storage.from(bucket).remove([path]);
    throw error;
  }
  await discard(workspace, previous, path);
}
export async function removeShopLogo(db: SupabaseClient, workspace: string) {
  const { data: previous, error } = await db.rpc('remove_shop_logo');
  if (error) throw error;
  await discard(workspace, previous, null);
}
// Each swap deletes exactly the object it displaced. The sweep only touches objects older
// than an hour, so it can never remove an in-flight upload that has not been saved yet.
async function discard(workspace: string, previous: string | null, current: string | null) {
  const storage = admin().storage.from(bucket);
  try {
    if (previous) await storage.remove([previous]);
    const { data } = await storage.list(workspace, { limit: 100 });
    const stale = (data || [])
      .filter(
        (object) =>
          `${workspace}/${object.name}` !== current &&
          object.created_at &&
          Date.parse(object.created_at) < Date.now() - 60 * 60 * 1000,
      )
      .map((object) => `${workspace}/${object.name}`);
    if (stale.length) await storage.remove(stale);
  } catch {
    // The saved logo is already correct; a leftover object is retried on the next change.
  }
}
export async function logoBytes(path: string | null | undefined) {
  if (!path) return null;
  try {
    const { data, error } = await admin().storage.from(bucket).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
