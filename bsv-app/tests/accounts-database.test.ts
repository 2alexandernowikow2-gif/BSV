import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const adminId = '10000000-0000-4000-8000-000000000001';
const memberId = '10000000-0000-4000-8000-000000000002';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, encrypted_password text, invited_at timestamptz default now(),
      banned_until timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
    create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('iat',extract(epoch from now())::bigint) $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;
  `);
  const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) await db.exec(readFileSync(resolve(directory,file),'utf8'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at,encrypted_password,raw_user_meta_data) values
    ($1,'admin@example.invalid',now(),'hashed','{"role":"admin"}'),($2,'member@example.invalid',now(),'hashed','{}')`, [adminId,memberId]);
  await db.query(`update public.members set role = 'admin',account_status = 'aktiv' where user_id = $1;`, [adminId]);
  await db.query(`update public.members set account_status = 'aktiv' where user_id = $1`, [memberId]);
}, 60000);
afterAll(async () => { await db.close(); });

describe.sequential('PostgreSQL-Kontoschutz', () => {
  it('ignoriert selbst gesetzte Rollenmetadaten beim Auth-Trigger', async () => {
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values ('10000000-0000-4000-8000-000000000003','untrusted@example.invalid','{"role":"admin"}');`);
    const result = await db.query<{ role: string }>(`select role from public.members where email = 'untrusted@example.invalid'`);
    expect(result.rows[0].role).toBe('mitarbeiter');
  });
  it('erlaubt nur das eigene Profil und keine Rollen-/Status-/E-Mail-Aenderung', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','${memberId}',false); set role authenticated;`);
    try {
      const result = await db.query(`select * from public.members`);
      expect(result.rows).toHaveLength(1);
      await expect(db.exec(`update public.members set role = 'admin'`)).rejects.toThrow();
      await expect(db.exec(`update public.members set account_status = 'aktiv'`)).rejects.toThrow();
      await expect(db.exec(`update public.members set email = 'other@example.invalid'`)).rejects.toThrow();
      await db.exec(`update public.members set vorname = 'Eigener Name'`);
      await expect(db.query(`select public.admin_edit_member($1,(select id from public.members limit 1),'{}')`, [memberId])).rejects.toThrow();
    } finally { await db.exec('reset role'); }
  });
  it('verhindert Letzt-Admin-Entfernung und Auth-Loeschung direkt in PostgreSQL', async () => {
    await expect(db.query(`update public.members set role = 'mitarbeiter' where user_id = $1`, [adminId])).rejects.toThrow('letzte aktive Admin');
    await expect(db.query(`update public.members set account_status = 'deaktiviert' where user_id = $1`, [adminId])).rejects.toThrow('letzte aktive Admin');
    await expect(db.query(`delete from auth.users where id = $1`, [adminId])).rejects.toThrow('letzte aktive Admin');
  });
  it('blockiert deaktivierte Benutzer auch in alten Dienstplan-RPCs', async () => {
    await db.query(`update public.members set account_status = 'deaktiviert' where user_id = $1`, [memberId]);
    await db.exec(`select set_config('request.jwt.claim.sub','${memberId}',false); set role authenticated;`);
    try { await expect(db.query(`select public.load_schedule()`)).rejects.toThrow('Aktiver Mitarbeiterzugang'); }
    finally { await db.exec('reset role'); }
    await db.query(`update public.members set account_status = 'aktiv' where user_id = $1`, [memberId]);
  });
  it('nimmt Bootstrap bei vorhandenem aktivem Admin nicht erneut an', async () => {
    const result = await db.query<{ claim: { claimed: boolean } }>(`select public.claim_admin_bootstrap('admin@example.invalid') as claim`);
    expect(result.rows[0].claim.claimed).toBe(false);
  });
  it('sperrt alle frueheren Mitarbeiter-Schreib-RPCs auch fuer Admin-Sessions',async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      await expect(db.query(`select public.update_member(0,'{}')`)).rejects.toThrow('permission denied');
      await expect(db.query(`select public.update_member_seasons(0,'{}')`)).rejects.toThrow('permission denied');
      await expect(db.query(`select public.bootstrap_first_admin($1,'Test')`,[adminId])).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  });
  it('erlaubt die angeforderte Alt-Admin-Reparatur genau einmal', async () => {
    const first = await db.query<{ claim: { claimed:boolean;userId:string } }>(`select public.claim_admin_bootstrap('admin@example.invalid',true) as claim`);
    const second = await db.query<{ claim: { claimed:boolean } }>(`select public.claim_admin_bootstrap('admin@example.invalid',true) as claim`);
    expect(first.rows[0].claim).toMatchObject({ claimed:true,userId:adminId });
    expect(second.rows[0].claim.claimed).toBe(false);
  });
  it('blockiert Selbstregistrierung ohne Einladung', async () => {
    await expect(db.exec(`insert into auth.users(id,email,invited_at) values('10000000-0000-4000-8000-000000000004','signup@example.invalid',null)`)).rejects.toThrow('Zugang nur mit Einladung');
  });
  it('reaktiviert unbestaetigte Konten nur als eingeladen, nicht als aktive Benutzer',async () => {
    const target = await db.query<{id:string}>(`select id from public.members where email = 'untrusted@example.invalid'`);
    await db.query(`select public.admin_edit_member($1,$2,'{"account_status":"deaktiviert"}')`,[adminId,target.rows[0].id]);
    await db.query(`select public.admin_edit_member($1,$2,'{"account_status":"aktiv"}')`,[adminId,target.rows[0].id]);
    const restored = await db.query<{account_status:string}>(`select account_status from public.members where id = $1`,[target.rows[0].id]);
    expect(restored.rows[0].account_status).toBe('eingeladen');
  });
  it('sperrt laufende Sessions und verbietet Selbstdeaktivierung auch im Admin-RPC', async () => {
    const target = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[memberId]);
    const actor = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[adminId]);
    await expect(db.query(`select public.admin_edit_member($1,$2,'{"account_status":"deaktiviert"}')`,[adminId,actor.rows[0].id])).rejects.toThrow('eigenen Zugang');
    await db.query(`insert into auth.sessions(user_id) values($1)`,[memberId]);
    await db.query(`select public.admin_edit_member($1,$2,'{"account_status":"deaktiviert"}')`,[adminId,target.rows[0].id]);
    expect((await db.query(`select * from auth.sessions where user_id = $1`,[memberId])).rows).toHaveLength(0);
    expect((await db.query<{tokens_revoked_at:string}>(`select tokens_revoked_at from public.members where user_id = $1`,[memberId])).rows[0].tokens_revoked_at).toBeTruthy();
    await db.query(`select public.admin_edit_member($1,$2,'{"account_status":"aktiv"}')`,[adminId,target.rows[0].id]);
  });
  it('loescht Auth und zukuenftige Zuweisungen, behaelt vergangene Namen', async () => {
    const target = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[memberId]);
    const id = target.rows[0].id;
    const shifts = ['2000-01-02','2090-01-02'].map((date,index) => ({ id:`history-${index}`,date,title:'Test',kind:'manual',start:'09:00',end:'12:00',published:false,
      tasks:[{ id:`task-history-${index}`,name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:id }] }));
    await db.query(`update public.schedule_state set data = $1::jsonb where id = 1`,[JSON.stringify(shifts)]);
    await db.query(`delete from auth.users where id = $1`,[memberId]);
    const result = await db.query<{data:typeof shifts}>(`select data from public.schedule_state where id = 1`);
    expect(result.rows[0].data[0].tasks[0].memberId).toBe(id);
    expect(result.rows[0].data[1].tasks[0].memberId).toBe(null);
    const archived = await db.query<{user_id:string|null;archived_at:string;name:string}>(`select user_id,archived_at,name from public.members where id = $1`,[id]);
    expect(archived.rows[0].user_id).toBe(null);
    expect(archived.rows[0].archived_at).toBeTruthy();
    expect(archived.rows[0].name).toBe('Eigener Name');
  });
});