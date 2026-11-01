import { NextResponse } from 'next/server';
import { z } from 'zod';
import { database, sameOrigin } from '@/lib/server';
import { AccountError } from '@/lib/account-rules';

export const dynamic = 'force-dynamic';
const inputSchema = z.discriminatedUnion('action',[
  z.object({ action:z.literal('name'),vorname:z.string().trim().min(1).max(60),nachname:z.string().trim().max(60) }).strict(),
  z.object({ action:z.literal('password'),password:z.string().min(6).max(256) }).strict()
]);
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AccountError('Ungueltiger Ursprung.',403);
    const client = await database();
    const { data:{ user },error:authError } = await client.auth.getUser();
    if (authError || !user) throw new AccountError('Bitte einen gueltigen Einladungs- oder Reset-Link verwenden beziehungsweise neu anmelden.',403);
    const { data:member,error:memberError } = await client.from('members').select('id,role,account_status').eq('user_id',user.id).is('archived_at',null).maybeSingle();
    if (memberError || !member || !['aktiv','eingeladen'].includes(member.account_status)) throw new AccountError('Dieser Zugang ist deaktiviert oder nicht freigegeben.',403);
    const body = inputSchema.parse(await request.json());
    if (body.action === 'name') {
      const { error } = await client.from('members').update({ vorname:body.vorname,nachname:body.nachname }).eq('id',member.id);
      if (error) throw new AccountError('Name konnte nicht gespeichert werden.');
    } else {
      const { error } = await client.auth.updateUser({ password:body.password });
      if (error) throw new AccountError('Passwort konnte nicht gespeichert werden. Link eventuell abgelaufen oder Passwort bereits verwendet.');
      const { error:activationError } = await client.rpc('activate_own_account');
      if (activationError) throw new AccountError('Passwort gespeichert, Zugang konnte aber nicht aktiviert werden. Bitte die Verwaltung kontaktieren.',503);
    }
    return NextResponse.json({ ok:true,redirect:member.role === 'admin' ? '/admin/mitarbeiter' : '/' });
  } catch (error) {
    return NextResponse.json({ error:error instanceof AccountError ? error.message : 'Eingaben ungueltig.' },{ status:error instanceof AccountError ? error.status : 400 });
  }
}