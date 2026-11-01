import { NextResponse } from 'next/server';
import { database } from '@/lib/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = await database();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const tokenType = url.searchParams.get('type');
  const result = tokenHash
    ? await client.auth.verifyOtp({ token_hash: tokenHash, type: tokenType === 'recovery' ? 'recovery' : tokenType === 'signup' ? 'signup' : tokenType === 'magiclink' ? 'magiclink' : 'invite' })
    : code ? await client.auth.exchangeCodeForSession(code) : { error: true };
  return NextResponse.redirect(new URL(result.error ? '/auth/passwort-setzen?error=link' : '/auth/passwort-setzen', url.origin));
}