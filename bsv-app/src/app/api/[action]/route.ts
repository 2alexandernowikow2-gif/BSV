import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { configured, database, identity, sameOrigin } from '@/lib/server';
import { REMEMBER_SESSION_COOKIE, REMEMBER_SESSION_MAX_AGE } from '@/lib/auth-session';
import { commandToDatabase, snapshotFromDatabase } from '@/lib/schedule-serialization';
import type { Command, Snapshot } from '@/lib/domain';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };
const errorResponse = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const shiftManagementCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deleteDraft'), shiftId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).strict(),
  z.object({ type: z.literal('cancelShift'), shiftId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), reason: z.string().max(160).nullable() }).strict(),
  z.object({ type: z.literal('reactivateShift'), shiftId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).strict(),
]);

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
  return error ? errorResponse(error.message, 403) : NextResponse.json(snapshotFromDatabase(data as Snapshot));
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return errorResponse('Ungueltiger Ursprung.', 403);
  if (!configured()) return errorResponse('Onlinebetrieb nicht eingerichtet.', 503);
  const { action } = await context.params;
  try {
    if (action === 'logout') {
      const client = await database();
      await client.auth.signOut();
      (await cookies()).delete(REMEMBER_SESSION_COOKIE);
      return NextResponse.json({ ok: true });
    }
    const body: unknown = await request.json();
    if (action === 'login') {
      const credentials = z.object({ email: z.email(), password: z.string().min(1).max(256), rememberSession: z.boolean().default(false) }).strict().parse(body);
      const client = await database({ rememberSession: credentials.rememberSession });
      const { email, password, rememberSession } = credentials;
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return errorResponse('Anmeldung fehlgeschlagen. Bitte Zugangsdaten pruefen; gesperrte Zugaenge koennen sich nicht anmelden.', 401);
      const cookieStore = await cookies();
      if (rememberSession) cookieStore.set(REMEMBER_SESSION_COOKIE,'1',{ httpOnly:true,secure:process.env.NODE_ENV === 'production',sameSite:'lax',path:'/',maxAge:REMEMBER_SESSION_MAX_AGE });
      else cookieStore.delete(REMEMBER_SESSION_COOKIE);
      if (!(await identity())) {
        const { data:member } = await client.from('members').select('account_status').maybeSingle();
        await client.auth.signOut();
        cookieStore.delete(REMEMBER_SESSION_COOKIE);
        return errorResponse(member?.account_status === 'eingeladen' ? 'Bitte zuerst die Einladung annehmen und ueber den E-Mail-Link ein Passwort setzen.' : 'Dieser Zugang ist deaktiviert oder noch nicht freigegeben.',403);
      }
      return NextResponse.json({ ok: true });
    }
    const client = await database();
    const actor = await identity();
    if (!actor) return errorResponse('Bitte anmelden.', 401);
    if (action === 'password') {
      const { password } = z.object({ password: z.string().min(6).max(256) }).parse(body);
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
      } else if (['deleteDraft','cancelShift','reactivateShift'].includes(String(command.type))) {
        const lifecycle = shiftManagementCommand.parse(command);
        result = await client.rpc('manage_shift', {
          expected_version: version,
          action: lifecycle.type,
          shift_id: lifecycle.shiftId,
          reason: lifecycle.type === 'cancelShift' ? lifecycle.reason : null,
        });
      } else result = await client.rpc('mutate_schedule', { expected_version: version, command:commandToDatabase(command as unknown as Command) });
      const { data, error } = result;
      return error ? errorResponse(error.code === '40001' ? 'Plan wurde inzwischen geaendert. Bitte neu laden.' : error.message, error.code === '40001' ? 409 : 400) : NextResponse.json(snapshotFromDatabase(data as Snapshot));
    }
    if (action === 'invite') {
      return errorResponse('Bitte die zentrale Mitarbeiterverwaltung verwenden.',403);
    }
    return errorResponse('Nicht gefunden.', 404);
  } catch (error) {
    return errorResponse(error instanceof z.ZodError ? 'Eingaben ungueltig.' : 'Aktion fehlgeschlagen. Bitte Server-Konfiguration pruefen.');
  }
}