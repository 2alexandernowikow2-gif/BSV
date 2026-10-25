import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { matchesAppOrigin } from './request-origin';

export const FIRST_ADMIN_EMAIL = '2alexander.nowikow2@gmail.com';

export function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
export async function database() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: values => values.forEach(({ name, value, options }) => jar.set(name, value, options)) }
  });
}
export function privilegedDatabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server-Zugang fuer Einladungen fehlt.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function identity() {
  if (!configured()) return null;
  const client = await database();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client.rpc('load_schedule');
  if (error) return null;
  const admin = privilegedDatabase();
  const { data: member } = await admin.from('members').select('id,name,role,active').eq('user_id', user.id).eq('active', true).single();
  if (!member || !data) return null;
  return { id: user.id, memberId: member.id as string, name: member.name as string, role: member.role as string };
}
export function sameOrigin(request: Request) {
  return matchesAppOrigin(request, process.env.APP_URL);
}