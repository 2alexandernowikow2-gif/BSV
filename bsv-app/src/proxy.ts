import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  const deny = () => {
    const denied = request.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({ error:'Nur fuer aktive Administratoren.' },{ status:403 })
      : NextResponse.redirect(new URL('/?access=denied',request.url));
    for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
    return denied;
  };
  if (!url || !key) return deny();
  const client = createServerClient(url,key,{ cookies:{
    getAll:() => request.cookies.getAll(),
    setAll:values => {
      for (const value of values) request.cookies.set(value.name,value.value);
      response = NextResponse.next({ request });
      for (const value of values) response.cookies.set(value.name,value.value,value.options);
    }
  } });
  const { data:{ user },error } = await client.auth.getUser();
  if (error || !user) return deny();
  const { data:member,error:profileError } = await client.rpc('current_member');
  if (profileError || !member || member.account_status !== 'aktiv' || member.archived_at) return deny();
  if ((request.nextUrl.pathname.startsWith('/admin') || request.nextUrl.pathname.startsWith('/api/admin')) && member.role !== 'admin') return deny();
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config = { matcher:['/admin/:path*','/konto/:path*','/api/admin/:path*'] };