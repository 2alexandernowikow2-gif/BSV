import { NextResponse } from 'next/server';
import { z } from 'zod';
import { configured, database, FIRST_ADMIN_EMAIL, identity, privilegedDatabase, sameOrigin } from '@/lib/server';

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
    if (!configured()) return NextResponse.json({ available: false });
    try {
      const { data, error } = await privilegedDatabase().from('members').select('id').eq('role', 'admin').eq('active', true).not('user_id', 'is', null).limit(1);
      if (error) return errorResponse('Ersteinrichtung derzeit nicht verfuegbar.', 503);
      return NextResponse.json({ available: data.length === 0, email: FIRST_ADMIN_EMAIL });
    } catch { return errorResponse('Ersteinrichtung derzeit nicht verfuegbar.', 503); }
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
      return error ? errorResponse('Anmeldung fehlgeschlagen.', 401) : NextResponse.json({ ok: true });
    }
    if (action === 'bootstrap') {
      const input = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(body);
      const appUrl = process.env.APP_URL;
      if (!appUrl) return errorResponse('APP_URL fehlt.', 503);
      const admin = privilegedDatabase();
      const { data: existingAdmins, error: adminError } = await admin.from('members').select('id').eq('role', 'admin').eq('active', true).not('user_id', 'is', null).limit(1);
      if (adminError) return errorResponse('Ersteinrichtung derzeit nicht verfuegbar.', 503);
      if (existingAdmins.length > 0) return errorResponse('Der erste Admin-Zugang ist bereits eingerichtet. Bitte normal anmelden.', 409);
      const { error } = await client.auth.signInWithOtp({
        email: FIRST_ADMIN_EMAIL,
        options: {
          shouldCreateUser: true,
          data: { full_name: input.name },
          emailRedirectTo: `${appUrl}/auth/callback?flow=first-admin`
        }
      });
      if (error) return errorResponse('Anmeldelink konnte nicht versendet werden. Bitte pruefe die Supabase-Mailkonfiguration.');
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
        const memberCommand = z.object({ type: z.literal('updateMember'), member: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), email: z.union([z.email(), z.literal('')]).nullable(), winterActive: z.boolean(), summerActive: z.boolean(), qualifications: z.array(z.string().trim().min(1).max(80)).max(64) }).strict() }).strict().parse(command);
        result = await client.rpc('update_member_seasons', { expected_version: version, member_data: { ...memberCommand.member, email: memberCommand.member.email || null } });
      } else if (command.type === 'monthPhase') {
        const phaseCommand = z.object({ type: z.literal('monthPhase'), month: z.string().regex(/^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$/), phase: z.enum(['open', 'closed']) }).strict().parse(command);
        result = await client.rpc('set_month_phase', { expected_version: version, month_key: phaseCommand.month, next_phase: phaseCommand.phase });
      } else result = await client.rpc('mutate_schedule', { expected_version: version, command });
      const { data, error } = result;
      return error ? errorResponse(error.code === '40001' ? 'Plan wurde inzwischen geaendert. Bitte neu laden.' : error.message, error.code === '40001' ? 409 : 400) : NextResponse.json(data);
    }
    if (action === 'invite') {
      if (actor.role !== 'admin') return errorResponse('Nur fuer Admins.', 403);
      const { memberId } = z.object({ memberId: z.uuid() }).parse(body);
      const admin = privilegedDatabase();
      const { data: member } = await admin.from('members').select('id,email,user_id,active').eq('id', memberId).single();
      if (!member?.active || !member.email) return errorResponse('Aktives Mitglied mit E-Mail erforderlich.');
      if (member.user_id) return errorResponse('Mitglied hat bereits einen Zugang.');
      const appUrl = process.env.APP_URL;
      if (!appUrl) return errorResponse('APP_URL fehlt.', 503);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(member.email, { redirectTo: `${appUrl}/auth/callback` });
      if (error || !data.user) return errorResponse('Einladung fehlgeschlagen. Bitte Mailkonfiguration pruefen.');
      const { error: linkError } = await admin.from('members').update({ user_id: data.user.id }).eq('id', member.id).is('user_id', null);
      if (linkError) return errorResponse('Einladung versandt, aber Zuordnung fehlgeschlagen. Admin muss den Zugang zuordnen.', 500);
      return NextResponse.json({ ok: true });
    }
    return errorResponse('Nicht gefunden.', 404);
  } catch (error) {
    return errorResponse(error instanceof z.ZodError ? 'Eingaben ungueltig.' : 'Aktion fehlgeschlagen. Bitte Server-Konfiguration pruefen.');
  }
}