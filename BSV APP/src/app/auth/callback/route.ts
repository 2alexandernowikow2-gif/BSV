import { NextResponse } from 'next/server';
import { database, FIRST_ADMIN_EMAIL, privilegedDatabase } from '@/lib/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = await database();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const tokenType = url.searchParams.get('type');
  const firstAdminFlow = url.searchParams.get('flow') === 'first-admin';
  const result = tokenHash
    ? await client.auth.verifyOtp({ token_hash: tokenHash, type: tokenType === 'signup' ? 'signup' : tokenType === 'magiclink' ? 'magiclink' : 'invite' })
    : code ? await client.auth.exchangeCodeForSession(code) : { error: true };
  if (!result.error && firstAdminFlow) {
    const { data: { user } } = await client.auth.getUser();
    const name = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
    if (!user || user.email?.toLowerCase() !== FIRST_ADMIN_EMAIL || !user.email_confirmed_at || !name) {
      await client.auth.signOut();
      return NextResponse.redirect(new URL('/?bootstrapError=1', url.origin));
    }
    const { error } = await privilegedDatabase().rpc('bootstrap_first_admin', { account_id: user.id, member_name: name });
    if (error) {
      await client.auth.signOut();
      return NextResponse.redirect(new URL('/?bootstrapError=1', url.origin));
    }
    return NextResponse.redirect(new URL('/', url.origin));
  }
  return NextResponse.redirect(new URL(result.error ? firstAdminFlow ? '/?bootstrapError=1' : '/?authError=1' : '/?setPassword=1', url.origin));
}