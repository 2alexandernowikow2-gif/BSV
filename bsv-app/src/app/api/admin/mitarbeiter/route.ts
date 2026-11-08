import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccountError, employeeInput, importEmployeeInput } from '@/lib/account-rules';
import { adminAccount, sameOrigin } from '@/lib/server';
import { changeEmployeeStatus, deleteEmployee, importEmployees, importPreview, inviteEmployee, inviteExistingEmployee, listAccounts, sendAccountMail, updateEmployee } from '@/lib/accounts-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const command = z.discriminatedUnion('action',[
  z.object({ action:z.literal('invite'),input:employeeInput }).strict(),
  z.object({ action:z.literal('edit'),id:z.uuid(),input:employeeInput }).strict(),
  z.object({ action:z.literal('status'),id:z.uuid(),enabled:z.boolean() }).strict(),
  z.object({ action:z.literal('inviteExisting'),id:z.uuid() }).strict(),
  z.object({ action:z.literal('delete'),id:z.uuid(),confirmation:z.string().min(1).max(120) }).strict(),
  z.object({ action:z.literal('mail'),id:z.uuid(),invitation:z.boolean() }).strict(),
  z.object({ action:z.literal('preview'),csv:z.string().max(1_000_000) }).strict(),
  z.object({ action:z.literal('import'),rows:z.array(z.object({ line:z.number().int().min(2),input:importEmployeeInput }).strict()).min(1).max(3) }).strict()
]);
function failure(error: unknown) {
  return NextResponse.json({ error:error instanceof AccountError ? error.message : error instanceof z.ZodError ? 'Eingaben ungueltig.' : 'Aktion derzeit nicht verfuegbar. Bitte Serverkonfiguration pruefen.' },
    { status:error instanceof AccountError ? error.status : error instanceof z.ZodError ? 400 : 503, headers:{ 'Cache-Control':'no-store' } });
}
export async function GET() {
  try { await adminAccount(); return NextResponse.json({ accounts:await listAccounts() },{ headers:{ 'Cache-Control':'no-store' } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AccountError('Ungueltiger Ursprung.',403);
    const actor = await adminAccount();
    if (Number(request.headers.get('content-length') ?? 0) > 1_100_000) throw new AccountError('Datei ist zu gross.',413);
    const text = await request.text();
    if (text.length > 1_100_000) throw new AccountError('Datei ist zu gross.',413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AccountError('Ungueltige Anfrage.'); }
    const input = command.parse(body);
    if (input.action === 'preview') return NextResponse.json({ rows:await importPreview(input.csv) });
    if (input.action === 'import') return NextResponse.json({ rows:await importEmployees(actor,input.rows) });
    if (input.action === 'invite') return NextResponse.json(await inviteEmployee(input.input,actor));
    if (input.action === 'inviteExisting') { await inviteExistingEmployee(actor,input.id); return NextResponse.json({ ok:true }); }
    if (input.action === 'edit') {
      await updateEmployee(actor,input.id,input.input);
      if (input.id === actor.id && input.input.role !== 'admin') return NextResponse.json({ ok:true,redirect:'/' });
    }
    if (input.action === 'status') await changeEmployeeStatus(actor,input.id,input.enabled);
    if (input.action === 'delete') await deleteEmployee(actor,input.id,input.confirmation);
    if (input.action === 'mail') await sendAccountMail(input.id,input.invitation);
    return NextResponse.json({ ok:true });
  } catch (error) { return failure(error); }
}