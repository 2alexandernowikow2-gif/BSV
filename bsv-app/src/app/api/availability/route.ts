import { NextResponse } from 'next/server';
import { z } from 'zod';
import { database, identity, sameOrigin } from '@/lib/server';

export async function GET() {
  if (!await identity()) return NextResponse.json({ error: 'Bitte anmelden.' },{ status:401 });
  const client = await database();
  const { data,error } = await client.rpc('load_availability');
  return error ? NextResponse.json({ error:'Verfuegbarkeit konnte nicht geladen werden.' },{ status:503 })
    : NextResponse.json(data,{ headers:{ 'Cache-Control':'private, no-store' } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error:'Anfrage nicht erlaubt.' },{ status:403 });
  const actor = await identity();
  if (!actor) return NextResponse.json({ error:'Bitte anmelden.' },{ status:401 });
  try {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const base = { memberId:z.string().uuid(),dates:z.array(date).min(1).max(1000) };
    const input = z.union([z.object({ ...base,available:z.boolean() }).strict(),z.object({ ...base,unavailableDates:z.array(date).max(1000) }).strict()]).parse(await request.json());
    if (actor.role !== 'admin' && actor.memberId !== input.memberId) return NextResponse.json({ error:'Nur eigene Meldungen sind aenderbar.' },{ status:403 });
    const client = await database();
    const { error } = 'available' in input
      ? await client.rpc('set_availability',{ target_member_id:input.memberId,service_dates:input.dates,available:input.available })
      : await client.rpc('restore_availability',{ target_member_id:input.memberId,service_dates:input.dates,unavailable_dates:input.unavailableDates });
    if (error) return NextResponse.json({ error:error.message },{ status:error.code === '42501' ? 403 : 400 });
    return NextResponse.json({ ok:true });
  } catch { return NextResponse.json({ error:'Meldung ungueltig.' },{ status:400 }); }
}