import { NextResponse } from 'next/server';
import { z } from 'zod';
import { configured, database, identity, sameOrigin } from '@/lib/server';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
const errorResponse = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request, context: Context) {
  const { action } = await context.params;
  if (action === 'session') {
    try { return NextResponse.json({ configured: configured(), user: await identity() }); }
    catch { return errorResponse('Supabase-Konfiguration oder Datenbank nicht erreichbar.', 503); }
  }
  if (action === 'bootstrap-status') {
    return NextResponse.json({ available: false });
  }
  if (action !== 'schedule') return errorResponse('Nicht gefunden.', 404);
  if (!configured()) return errorResponse('Onlinebetrieb nicht eingerichtet.', 503);
  const client = await database();
  const { data, error } = await client.rpc('load_schedule');
  return error ? errorResponse(error.message, 403) : NextResponse.json(data);
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return errorResponse('Ungueltiger Ursprung.', 403);
  if (!configured()) return errorResponse('Onlinebetrieb nicht eingerichtet.', 503);
  const { action } = await context.params;
  try {
    const client = await database();
    if (action === 'logout') {
      await client.auth.signOut();
      return NextResponse.json({ ok: true });
    }
    const body: unknown = await request.json();
    if (action === 'login') {
      const credentials = z.object({ email: z.email(), password: z.string().min(1).max(256) }).parse(body);
      const { error } = await client.auth.signInWithPassword(credentials);
      if (error) return errorResponse('Anmeldung fehlgeschlagen. Bitte Zugangsdaten pruefen; gesperrte Zugaenge koennen sich nicht anmelden.', 401);
      if (!(await identity())) {
        const { data:member } = await client.from('members').select('account_status').maybeSingle();
        await client.auth.signOut();
        return errorResponse(member?.account_status === 'eingeladen' ? 'Bitte zuerst die Einladung annehmen und ueber den E-Mail-Link ein Passwort setzen.' : 'Dieser Zugang ist deaktiviert oder noch nicht freigegeben.',403);
      }
      return NextResponse.json({ ok: true });
    }
    const actor = await identity();
    if (!actor) return errorResponse('Bitte anmelden.', 401);
    if (action === 'password') {
      const { password } = z.object({ password: z.string().min(12).max(256) }).parse(body);
      const { error } = await client.auth.updateUser({ password });
      return error ? errorResponse('Passwort konnte nicht gespeichert werden.') : NextResponse.json({ ok: true });
    }
    if (action === 'schedule') {
      const { version, command } = z.object({ version: z.number().int().nonnegative(), command: z.record(z.string(), z.unknown()) }).parse(body);
      let result;
      if (command.type === 'updateMember') {
        return errorResponse('Bitte die zentrale Mitarbeiterverwaltung verwenden.',403);
      } else if (command.type === 'monthPhase') {
        const phaseCommand = z.object({ type: z.literal('monthPhase'), month: z.string().regex(/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/), phase: z.enum(['open', 'closed']) }).strict().parse(command);
        result = await client.rpc('set_month_phase', { expected_version: version, month_key: phaseCommand.month, next_phase: phaseCommand.phase });
      } else result = await client.rpc('mutate_schedule', { expected_version: version, command });
      const { data, error } = result;
      return error ? errorResponse(error.code === '40001' ? 'Plan wurde inzwischen geaendert. Bitte neu laden.' : error.message, error.code === '40001' ? 409 : 400) : NextResponse.json(data);
    }
    if (action === 'invite') {
      return errorResponse('Bitte die zentrale Mitarbeiterverwaltung verwenden.',403);
    }
    return errorResponse('Nicht gefunden.', 404);
  } catch (error) {
    return errorResponse(error instanceof z.ZodError ? 'Eingaben ungueltig.' : 'Aktion fehlgeschlagen. Bitte Server-Konfiguration pruefen.');
  }
}