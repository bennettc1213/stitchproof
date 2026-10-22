'use server';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase/server';
import { admin } from '@/lib/supabase/admin';
import { appOrigin } from '@/lib/config';
import { intakeSchema } from '@/lib/domain';
import { validateUpload } from '@/lib/uploads';
import { saveShopLogo, removeShopLogo } from '@/lib/shop-logo';
import { reviewAccess } from '@/lib/review-access';
import { authNext } from '@/lib/auth-next';
import { checkout, billingPortal, refreshBilling } from '@/lib/billing';
import { enforceAuthLimit } from '@/lib/auth-limits';
import { userError } from '@/lib/user-error';
export type ActionState = { error?: string; success?: string; link?: string; revision?: number };
export async function perform(_previous: ActionState, form: FormData): Promise<ActionState> {
  let destination: string | undefined;
  const str = (key: string) => String(form.get(key) || '');
  try {
    const db = await supabase();
    const intent = str('intent');
    if (['login', 'signup', 'forgot'].includes(intent)) {
      const email = z.email().max(254).parse(str('email').trim().toLowerCase());
      if (intent === 'login' || intent === 'signup') {
        const password = z.string().min(12).max(128).parse(str('password'));
        await enforceAuthLimit(intent, email);
        const result =
          intent === 'login'
            ? await db.auth.signInWithPassword({ email, password })
            : await db.auth.signUp({
                email,
                password,
                options: {
                  emailRedirectTo:
                    appOrigin() +
                    '/auth/callback?next=' +
                    encodeURIComponent(authNext(str('next'))),
                },
              });
        if (result.error) return { error: result.error.message };
        if (intent === 'signup')
          return {
            success:
              'Check your inbox to verify your email before continuing. Local Supabase mail appears at http://localhost:54324.',
          };
        destination = authNext(str('next'));
      } else if (intent === 'forgot') {
        await enforceAuthLimit('forgot', email);
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: appOrigin() + '/auth/callback?next=/reset-password',
        });
        if (error) throw error;
        return {
          success:
            'If this email has an account, a recovery link has been requested. Check your inbox.',
        };
      }
    } else if (intent === 'update-password') {
      const password = z.string().min(12).max(128).parse(str('password'));
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      destination = '/app/orders';
    } else if (intent === 'logout') {
      await db.auth.signOut();
      destination = str('next').startsWith('/invite/') ? authNext(str('next')) : '/login';
    } else {
      const { data, error } = await db.auth.getClaims();
      if (error || !data?.claims) return { error: 'Your session expired. Sign in again.' };
      if (intent === 'onboard') {
        const { data: workspace, error } = await db.rpc('onboard_shop', {
          p_name: str('name'),
          p_timezone: str('timezone'),
          p_policy: str('policy'),
        });
        if (error) throw error;
        const logo = form.get('logo');
        if (logo instanceof File && logo.size > 0) {
          try {
            await saveShopLogo(db, workspace, logo);
          } catch (logoError) {
            // Onboarding is idempotent, so submitting again retries only the logo.
            return {
              error: `Your shop was created, but the logo was not saved: ${(logoError as Error).message} Submit again, or add it later in Shop settings.`,
            };
          }
        }
        destination = '/app/orders';
      } else if (intent === 'billing-checkout') {
        if (form.get('confirm') !== 'on')
          throw new Error('Acknowledge the immediate subscription start.');
        destination = await checkout();
      } else if (intent === 'billing-portal') {
        destination = await billingPortal();
      } else if (intent === 'billing-refresh') {
        await refreshBilling();
      } else if (intent === 'invite-staff') {
        const token = randomBytes(32).toString('hex');
        const queued = form.get('queue_email') === 'on';
        const { error } = await db.rpc(queued ? 'email_invitation' : 'invite_staff', {
          p_email: z.email().max(254).parse(str('email').trim().toLowerCase()),
          ...(queued
            ? { p_token: token }
            : { p_digest: createHash('sha256').update(token).digest('hex') }),
        });
        if (error) throw error;
        revalidatePath('/app/settings/team');
        return {
          success: queued
            ? 'Invitation created and email queued. Delivery is tracked in Shop profile. Copy this link now if needed.'
            : 'Invitation created. No email was sent. Copy this private link now; it is only shown once.',
          link: appOrigin() + '/invite/' + token,
        };
      } else if (intent === 'accept-invitation') {
        const token = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(str('token'));
        const { error } = await db.rpc('accept_invitation', {
          p_digest: createHash('sha256').update(token).digest('hex'),
        });
        if (error) throw error;
        destination = '/app/orders';
      } else if (intent === 'revoke-invitation' || intent === 'remove-staff') {
        if (intent === 'remove-staff' && form.get('confirm') !== 'on')
          throw new Error('Confirm staff removal.');
        const { error } =
          intent === 'remove-staff'
            ? await db.rpc('remove_staff', { p_user: z.uuid().parse(str('user')) })
            : await db.rpc('revoke_invitation', { p_id: z.uuid().parse(str('invitation')) });
        if (error) throw error;
      } else if (intent === 'create-order') {
        const { data, error } = await db.rpc('create_order', {
          p_title: str('title'),
          p_customer_name: str('customer_name'),
          p_email: z.email().parse(str('email')),
          p_company: str('company'),
          p_due: str('due_date') || null,
          p_key: z.uuid().parse(str('key')),
        });
        if (error) throw error;
        destination = '/app/orders/' + data;
      } else if (intent === 'order-control') {
        const p_order = z.uuid().parse(str('order'));
        const p_revision = z.coerce.number().int().min(0).parse(str('revision'));
        const operation = z
          .enum(['assign', 'cancel', 'archive', 'restore'])
          .parse(str('operation'));
        const result =
          operation === 'assign'
            ? await db.rpc('assign_order', {
                p_order,
                p_revision,
                p_user: str('assigned_to') ? z.uuid().parse(str('assigned_to')) : null,
              })
            : operation === 'cancel'
              ? await db.rpc('cancel_order', {
                  p_order,
                  p_revision,
                  p_reason: z.string().trim().min(3).max(1000).parse(str('reason')),
                  p_confirm: form.get('confirm_cancel') === 'on',
                })
              : await db.rpc('archive_order', {
                  p_order,
                  p_revision,
                  p_archived: operation === 'archive',
                });
        if (result.error) throw result.error;
        revalidatePath('/app', 'layout');
        return {
          success:
            operation === 'assign'
              ? 'Assignment saved.'
              : operation === 'cancel'
                ? 'Order cancelled. Pending review links are inactive.'
                : operation === 'archive'
                  ? 'Order archived. Its records remain available.'
                  : 'Order restored to the current list.',
          revision: result.data,
        };
      } else if (intent === 'update-customer') {
        const { data: revision, error } = await db.rpc('update_customer', {
          p_customer: z.uuid().parse(str('customer')),
          p_revision: z.coerce.number().int().min(0).parse(str('revision')),
          p_name: z.string().trim().min(1).max(160).parse(str('name')),
          p_company: z.string().trim().max(160).parse(str('company')),
          p_email: z.email().max(254).parse(str('email').trim().toLowerCase()),
          p_phone: z.string().trim().max(80).parse(str('phone')),
          p_notes: z.string().max(10000).parse(str('notes')),
        });
        if (error) throw error;
        revalidatePath('/app', 'layout');
        return { success: 'Customer saved successfully.', revision };
      } else if (intent === 'intake') {
        const input = intakeSchema.parse({
          garments: JSON.parse(str('garments')),
          spec: JSON.parse(str('spec')),
          reason: str('reason'),
        });
        const { error } = await db.rpc('save_intake', {
          p_order: str('order'),
          p_revision: Number(str('revision')),
          p_garments: input.garments,
          p_spec: input.spec,
          p_reason: input.reason,
        });
        if (error) throw error;
      } else if (intent === 'note') {
        const { error } = await db.rpc('save_internal_note', {
          p_order: str('order'),
          p_revision: Number(str('revision')),
          p_note: str('note'),
        });
        if (error) throw error;
      } else if (intent === 'upload') {
        const file = form.get('file');
        if (!(file instanceof File)) throw new Error('Choose a file.');
        const content = await validateUpload(file, str('purpose'));
        const service = admin();
        const { data: reservation, error } = await db.rpc('reserve_attachment', {
          p_order: str('order'),
          p_name: file.name,
          p_mime: content.mime,
          p_bytes: content.bytes.length,
          p_purpose: str('purpose'),
          p_caption: str('caption'),
        });
        if (error) throw error;
        const upload = await service.storage
          .from('order-files')
          .upload(reservation.path, content.bytes, {
            contentType: content.mime,
            upsert: false,
          });
        const finalized = await service.rpc('finalize_attachment', {
          p_id: reservation.id,
          p_digest: content.digest,
          p_success: !upload.error,
        });
        if (upload.error || finalized.error)
          throw new Error('Upload could not be completed. Please retry.');
      } else if (intent === 'send-proof') {
        const token = randomBytes(32).toString('hex');
        const queued = form.get('queue_email') === 'on';
        const { error } = await db.rpc(queued ? 'email_proof' : 'send_proof', {
          p_order: str('order'),
          p_revision: Number(str('revision')),
          p_files: form.getAll('files').map(String),
          ...(queued
            ? { p_token: token }
            : { p_digest: createHash('sha256').update(token).digest('hex') }),
        });
        if (error) throw error;
        revalidatePath('/app/orders', 'layout');
        return {
          success: queued
            ? 'Review link created and email queued. Delivery is tracked in Shop profile. Copy this link now if needed.'
            : 'Review link created. No email was sent. Copy this link now; it is only shown once.',
          link: appOrigin() + '/review/' + token,
        };
      } else if (intent === 'pickup-email' || intent === 'retry-email') {
        const { error } =
          intent === 'pickup-email'
            ? await db.rpc('queue_pickup_notice', { p_order: z.uuid().parse(str('order')) })
            : await db.rpc('retry_email', { p_id: z.uuid().parse(str('email_id')) });
        if (error) throw error;
        revalidatePath('/app', 'layout');
        return {
          success: 'Email queued. The worker must process it; delivery is tracked in Shop profile.',
        };
      } else if (intent === 'start-production' || intent === 'revoke') {
        const { error } = await db.rpc(intent === 'revoke' ? 'revoke_review' : 'start_production', {
          p_order: str('order'),
        });
        if (error) throw error;
      } else if (intent === 'ready') {
        const { error } = await db.rpc('mark_ready', {
          p_order: str('order'),
          p_counts: JSON.parse(str('counts')),
        });
        if (error) throw error;
      } else if (intent === 'collect') {
        const { error } = await db.rpc('collect_order', {
          p_order: str('order'),
          p_collector: str('collector'),
          p_confirm: form.get('confirm') === 'on',
        });
        if (error) throw error;
      } else if (intent === 'shop-logo') {
        const { data: member } = await db
          .from('memberships')
          .select('workspace_id,role')
          .eq('user_id', data.claims.sub)
          .single();
        if (member?.role !== 'owner') throw new Error('Owner access required');
        if (str('operation') === 'remove') {
          if (form.get('confirm') !== 'on') throw new Error('Confirm logo removal.');
          await removeShopLogo(db, member.workspace_id);
          revalidatePath('/app', 'layout');
          return { success: 'Logo removed. Your shop name is shown instead.' };
        }
        const file = form.get('logo');
        if (!(file instanceof File) || file.size < 1) throw new Error('Choose a logo image.');
        await saveShopLogo(db, member.workspace_id, file);
        revalidatePath('/app', 'layout');
        return { success: 'Logo saved. It now appears in your workspace, proofs, and PDFs.' };
      } else if (intent === 'shop') {
        const { error } = await db.rpc('update_shop', {
          p_name: str('name'),
          p_timezone: str('timezone'),
          p_policy: str('policy'),
          p_email: str('contact_email'),
        });
        if (error) throw error;
      } else return { error: 'Unknown action.' };
    }
    revalidatePath('/app', 'layout');
  } catch (error) {
    unstable_rethrow(error);
    return {
      revision: _previous.revision,
      error: userError(
        error,
        'The change could not be saved. Your input is still here. Please retry.',
      ),
    };
  }
  if (destination) redirect(destination);
  return { success: 'Saved successfully.' };
}
export async function decide(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const token = String(form.get('token') || '');
    const { service, digest } = await reviewAccess(token);
    const { error } = await service.rpc('decide_review', {
      p_digest: digest,
      p_choice: String(form.get('choice')),
      p_name: String(form.get('name') || ''),
      p_comments: String(form.get('comments') || ''),
      p_design: form.get('design') === 'on',
      p_policy: form.get('policy') === 'on',
    });
    if (error) throw error;
    revalidatePath('/review/' + token);
    return { success: 'Your decision has been recorded. Thank you.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: userError(error, 'Could not record your decision. Please retry.') };
  }
}
