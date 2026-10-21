import { z } from 'zod';

export function emailConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const transport = env.EMAIL_TRANSPORT || 'unconfigured';
  if (transport === 'local') {
    if (
      env.NODE_ENV === 'production' ||
      !env.NEXT_PUBLIC_SUPABASE_URL ||
      !['localhost', '127.0.0.1'].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)
    ) {
      throw new Error(
        'The development email outbox requires local Supabase and cannot run in production.',
      );
    }
    return 'local' as const;
  }
  if (transport === 'resend' && env.RESEND_API_KEY && z.email().safeParse(env.EMAIL_FROM).success)
    return 'resend' as const;
  return 'unconfigured' as const;
}

export type EmailJob = {
  id: string;
  lease_id: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
};
export function emailMessage(job: EmailJob, origin: string) {
  const recipient = z.email().max(254).parse(job.recipient);
  const payload = job.payload;
  const shop =
    typeof payload.shop === 'string'
      ? payload.shop.replace(/[\r\n]/g, ' ').slice(0, 100)
      : 'Your shop';
  const number = String(payload.order_number || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 12);
  if (job.template === 'review' || job.template === 'invitation') {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(payload.token);
    const link = new URL((job.template === 'review' ? '/review/' : '/invite/') + token, origin)
      .href;
    return {
      to: [recipient],
      subject:
        job.template === 'review'
          ? `${shop}: review order #${number}`
          : `${shop}: join your shop team`,
      text:
        job.template === 'review'
          ? `${shop} has a proof ready for order #${number}. Review the design, garment quantities, and shop policy before deciding.\n\n${link}\n\nThis private link expires after seven days. If replaced or revoked, ask the shop for a current link.`
          : `${shop} invited you to join its team. Verify and sign in with ${recipient}, then accept the invitation.\n\n${link}\n\nThis private link expires after seven days. If you were not expecting it, you can ignore it.`,
    };
  }
  if (job.template === 'decision') {
    const choice = payload.choice === 'approved' ? 'approved the proof' : 'requested changes';
    return {
      to: [recipient],
      subject: `Order #${number}: customer decision recorded`,
      text: `The customer ${choice} for order #${number}. Sign in to review the exact version and recorded decision.\n\n${new URL('/app/orders', origin).href}`,
    };
  }
  if (job.template === 'pickup')
    return {
      to: [recipient],
      subject: `${shop}: order #${number} is ready for pickup`,
      text: `${shop} marked order #${number} ready for pickup. Contact the shop to arrange collection.${typeof payload.contact_email === 'string' && payload.contact_email ? '\n\nShop contact: ' + payload.contact_email.slice(0, 254) : ''}`,
    };
  throw new Error('Unsupported email template.');
}
