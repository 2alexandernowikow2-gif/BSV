import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { matchesAppOrigin } from './request-origin';
import { requireActiveAdmin, type Account } from './account-rules';

export function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
export async function database() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: values => { try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { } } }
  });
}
export function privilegedDatabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server-Zugang fuer Einladungen fehlt.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function identity() {
  const member = await currentAccount();
  if (!member) return null;
  return { id: member.user_id!, memberId: member.id, name: member.name, role: member.role === 'admin' ? 'admin' : 'member' };
}
export async function currentAccount(): Promise<Account | null> {
  if (!configured()) return null;
  const client = await database();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client.rpc('current_member');
  if (error) return null;
  return data as Account | null;
}
export async function adminAccount() {
  const actor = await currentAccount();
  requireActiveAdmin(actor);
  return actor!;
}
export function sameOrigin(request: Request) {
  return matchesAppOrigin(request, process.env.APP_URL);
}