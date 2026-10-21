import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { appOrigin } from '@/lib/config';
import { authNext } from '@/lib/auth-next';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(appOrigin() + authNext(url.searchParams.get('next')));
  }
  return NextResponse.redirect(appOrigin() + '/login?error=verification');
}
