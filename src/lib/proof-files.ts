import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin } from './supabase/admin';
import { ARTWORK_BYTE_LIMIT, ProofArtworkError, type ProofFileLoader } from './proof-artwork';

// Metadata reads use the current member's RLS; the service client only retrieves
// an already-authorized ready proof file belonging to this exact order.
export function proofFileLoader(db: SupabaseClient, orderId: string): ProofFileLoader {
  let total = 0;
  return async (expected) => {
    const { data: file, error } = await db
      .from('attachments')
      .select('path,mime,digest,bytes')
      .eq('id', expected.id)
      .eq('order_id', orderId)
      .eq('state', 'ready')
      .eq('purpose', 'proof')
      .single();
    if (error || !file || file.mime !== expected.mime || file.digest !== expected.digest)
      throw new ProofArtworkError(
        'A proof file is unavailable. Restore the original file before downloading this record.',
      );
    total += file.bytes;
    if (file.bytes <= 0 || file.bytes > 10 * 1024 * 1024 || total > ARTWORK_BYTE_LIMIT)
      throw new ProofArtworkError(
        'Artwork exceeds the approval-record limit of 40 MiB. Download the original proof files separately.',
      );
    const { data, error: downloadError } = await admin()
      .storage.from('order-files')
      .download(file.path);
    if (downloadError || !data || data.size !== file.bytes)
      throw new ProofArtworkError(
        'A proof file is missing or damaged. Restore the original file before downloading this record.',
      );
    return new Uint8Array(await data.arrayBuffer());
  };
}
