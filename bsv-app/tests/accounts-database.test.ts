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
  it('loescht mehrere Entwuerfe atomar, nur als Admin und bei passender Version', async () => {
    const shifts = [1,2,3].map(index => ({id:`bulk-draft-${index}`,date:`2091-01-0${index}`,title:'Test',kind:'manual',start:'09:00',end:'12:00',published:index === 3,
      tasks:[{id:`bulk-task-${index}`,name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:null}]}));
    await db.query(`update public.schedule_state set data = $1::jsonb,version = 0 where id = 1`,[JSON.stringify(shifts)]);
    await db.exec(`select set_config('request.jwt.claim.sub','${memberId}',false);set role authenticated;`);
    try { await expect(db.query(`select public.delete_drafts(0,array['bulk-draft-1','bulk-draft-2'])`)).rejects.toThrow('Administrator'); }
    finally { await db.exec('reset role'); }
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      await expect(db.query(`select public.delete_drafts(0,array['bulk-draft-1','bulk-draft-3'])`)).rejects.toThrow('Published');
      await expect(db.query(`select public.delete_drafts(1,array['bulk-draft-1'])`)).rejects.toThrow('version conflict');
      await expect(db.query(`select public.delete_drafts(0,array['bulk-draft-1','unknown'])`)).rejects.toThrow('not found');
      await expect(db.query(`select public.delete_drafts(0,array['bulk-draft-1','bulk-draft-1'])`)).rejects.toThrow('Invalid');
      const unchanged = await db.query<{snapshot:{shifts:unknown[];version:number}}>(`select public.load_schedule() as snapshot`);
      expect(unchanged.rows[0].snapshot.shifts).toHaveLength(3);
      expect(unchanged.rows[0].snapshot.version).toBe(0);
      const result = await db.query<{snapshot:{shifts:Array<{id:string}>;version:number}}>(`select public.delete_drafts(0,array['bulk-draft-1','bulk-draft-2']) as snapshot`);
      expect(result.rows[0].snapshot.shifts.map(shift => shift.id)).toEqual(['bulk-draft-3']);
      expect(result.rows[0].snapshot.version).toBe(1);
    } finally { await db.exec('reset role'); }
  });
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
  it('speichert Dienstinformationen ueber den Admin-Mitarbeiter-RPC', async () => {
    const target = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[memberId]);
    await db.query(`select public.admin_edit_member($1,$2,'{"service_info":"Nur an Wochenenden"}'::jsonb)`,[adminId,target.rows[0].id]);
    const result = await db.query<{service_info:string}>(`select service_info from public.members where id = $1`,[target.rows[0].id]);
    expect(result.rows[0].service_info).toBe('Nur an Wochenenden');
  });
  it('sagt freigegebene Dienste ab, informiert Zugeordnete und loescht Entwuerfe', async () => {
    const assigned = await db.query<{ id:string }>(`select id from public.members where user_id = $1`,[memberId]);
    await db.query(`update public.members set account_status = 'aktiv',tokens_revoked_at = null where user_id = $1`,[memberId]);
    const shifts = [
      { id:'weather-shift',date:'2090-01-02',title:'Fruehdienst',kind:'early',start:'09:00',end:'12:00',published:true,
        tasks:[{ id:'weather-task',name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:assigned.rows[0].id }] },
      { id:'draft-shift',date:'2090-02-02',title:'Entwurf',kind:'early',start:'09:00',end:'12:00',published:false,
        tasks:[{ id:'draft-task',name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:null }] },
      { id:'publish-shift',date:'2090-02-03',title:'Zu veroeffentlichen',kind:'early',start:'09:00',end:'12:00',published:false,
        tasks:[{ id:'publish-task',name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:null }] },
    ];
      await db.query(`insert into public.admin_settings(id,email) values(1,'admin@example.invalid') on conflict (id) do update set email = excluded.email`);
    await db.query(`update public.schedule_state set data = $1::jsonb,version = 0 where id = 1`,[JSON.stringify(shifts)]);
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    let cancelled: { version:number;shifts:Array<{id:string;cancellation?:{reason:string|null}}> };
    try {
      const result = await db.query<{ snapshot:typeof cancelled }>(`select public.manage_shift(0,'cancelShift','weather-shift','Schlechtes Wetter') as snapshot`);
      cancelled = result.rows[0].snapshot;
      expect(cancelled.shifts.find(item => item.id === 'weather-shift')?.cancellation?.reason).toBe('Schlechtes Wetter');
    } finally { await db.exec('reset role'); }
    expect((await db.query<{ count:string }>(`select count(*)::text as count from public.notification_outbox where event_key like 'cancel:%'`)).rows[0].count).toBe('1');

    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      const published = await db.query<{ snapshot:{shifts:Array<{id:string;published:boolean;cancellation?:{reason:string|null}|null}>} }>(
        `select public.mutate_schedule(1,'{"type":"publish","ids":["publish-shift"]}'::jsonb) as snapshot`);
      expect(published.rows[0].snapshot.shifts.find(item => item.id === 'publish-shift')?.published).toBe(true);
      expect(published.rows[0].snapshot.shifts.find(item => item.id === 'weather-shift')?.cancellation?.reason).toBe('Schlechtes Wetter');
    } finally { await db.exec('reset role'); }

    await db.exec(`select set_config('request.jwt.claim.sub','${memberId}',false);set role authenticated;`);
    try {
      const result = await db.query<{ snapshot:typeof cancelled }>(`select public.load_schedule() as snapshot`);
      expect(result.rows[0].snapshot.shifts.some(item => item.id === 'weather-shift')).toBe(false);
      await expect(db.query(`select public.mutate_schedule(2,'{"type":"withdraw","taskId":"weather-task"}'::jsonb)`)).rejects.toThrow('Cancelled shifts cannot be changed');
    } finally { await db.exec('reset role'); }

    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      const restored = await db.query<{ snapshot:typeof cancelled }>(`select public.manage_shift(2,'reactivateShift','weather-shift',null) as snapshot`);
      expect(restored.rows[0].snapshot.shifts.find(item => item.id === 'weather-shift')?.cancellation).toBeNull();
      const deleted = await db.query<{ snapshot:typeof cancelled }>(`select public.manage_shift(3,'deleteDraft','draft-shift',null) as snapshot`);
      expect(deleted.rows[0].snapshot.shifts.some(item => item.id === 'draft-shift')).toBe(false);
    } finally { await db.exec('reset role'); }
    expect((await db.query<{ count:string }>(`select count(*)::text as count from public.notification_outbox where event_key like 'reactivate:%'`)).rows[0].count).toBe('1');
  });
  it('loescht abgelaufene unveroeffentlichte Dienste beim Laden automatisch', async () => {
    const shifts = [
      { id:'expired-draft',date:'2000-01-02',title:'Vergangener Entwurf',kind:'manual',start:'09:00',end:'12:00',published:false,tasks:[] },
      { id:'future-draft',date:'2090-01-02',title:'Zukuenftiger Entwurf',kind:'manual',start:'09:00',end:'12:00',published:false,tasks:[] },
      { id:'past-published',date:'2000-02-02',title:'Veroeffentlichter Dienst',kind:'manual',start:'09:00',end:'12:00',published:true,tasks:[] },
    ];
    await db.query(`update public.schedule_state set data = $1::jsonb,version = 0 where id = 1`,[JSON.stringify(shifts)]);
    await db.query(`insert into public.planning_periods(month,status) values ('2000-01-01','closed') on conflict (month) do update set status = 'closed'`);
    await db.query(`insert into public.shift_cancellations(shift_id,cancelled_at) values ('past-published',now())`);
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      const result = await db.query<{ snapshot:{shifts:Array<{id:string}>} }>(`select public.load_schedule() as snapshot`);
      expect(result.rows[0].snapshot.shifts.map(shift => shift.id)).toEqual(['future-draft','past-published']);
    } finally { await db.exec('reset role'); }
    const stored = await db.query<{ data:Array<{id:string}> }>(`select data from public.schedule_state where id = 1`);
    expect(stored.rows[0].data.map(shift => shift.id)).toEqual(['future-draft','past-published']);
    await db.query(`update public.shift_cancellations set reactivated_at = now() where shift_id = 'past-published'`);
  });
  it('loescht Auth und zukuenftige Zuweisungen, behaelt vergangene Namen', async () => {
    const target = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[memberId]);
    const id = target.rows[0].id;
    const shifts = ['2000-01-02','2090-01-02'].map((date,index) => ({ id:`history-${index}`,date,title:'Test',kind:'manual',start:'09:00',end:'12:00',published:false,
      tasks:[{ id:`task-history-${index}`,name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:id }] }));
    await db.query(`update public.schedule_state set data = $1::jsonb where id = 1`,[JSON.stringify(shifts)]);
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    await db.query(`delete from auth.users where id = $1`,[memberId]);
    const result = await db.query<{data:typeof shifts}>(`select data from public.schedule_state where id = 1`);
    expect(result.rows[0].data[0].tasks[0].memberId).toBe(id);
    expect(result.rows[0].data[1].tasks[0].memberId).toBe(null);
    const archived = await db.query<{user_id:string|null;archived_at:string;name:string}>(`select user_id,archived_at,name from public.members where id = $1`,[id]);
    expect(archived.rows[0].user_id).toBe(null);
    expect(archived.rows[0].archived_at).toBeTruthy();
    expect(archived.rows[0].name).toBe('Eigener Name');
  });
  it('speichert Verfuegbarkeit idempotent, prueft RLS und Berliner Datumsgrenzen', async () => {
    const owner = await db.query<{id:string}>(`select id from public.members where user_id = $1`,[adminId]);
    const other = await db.query<{id:string}>(`select id from public.members where email = 'untrusted@example.invalid'`);
    const today = await db.query<{date:string}>(`select to_char(now() at time zone 'Europe/Berlin','YYYY-MM-DD') as date`);
    const shifts = [today.rows[0].date,'2090-04-01','2000-04-01'].map((date,index) => ({ id:`availability-${index}`,date,title:'Test',kind:'manual',start:'09:00',end:'23:59',published:false,
      tasks:[{id:`availability-task-${index}`,name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:null}] }));
    await db.query(`update public.schedule_state set data = $1::jsonb where id = 1`,[JSON.stringify(shifts)]);
    await db.query(`update public.members set account_status = 'aktiv',tokens_revoked_at = null where id = $1`,[other.rows[0].id]);
    await db.exec(`select set_config('request.jwt.claim.sub','${adminId}',false);set role authenticated;`);
    try {
      const loaded = await db.query<{data:{days:Array<{date:string;assignedMemberIds:string[]}>;members:Array<{id:string}>}}>(`select public.load_availability() as data`);
      expect(loaded.rows[0].data.days.map(day => day.date)).toEqual([today.rows[0].date,'2090-04-01']);
      await db.query(`select public.set_availability($1,array[$2::date],false)`,[owner.rows[0].id,today.rows[0].date]);
      await db.query(`select public.set_availability($1,array[$2::date],false)`,[owner.rows[0].id,today.rows[0].date]);
      expect((await db.query(`select * from public.availability_exceptions`)).rows).toHaveLength(1);
      await expect(db.query(`select public.set_availability($1,array['2000-04-01'::date],false)`,[owner.rows[0].id])).rejects.toThrow('kommende Diensttage');
      await expect(db.query(`select public.set_availability($1,array['2090-04-02'::date],false)`,[owner.rows[0].id])).rejects.toThrow('kommende Diensttage');
      await db.query(`select public.set_availability($1,array['2090-04-01'::date],false)`,[other.rows[0].id]);
      await expect(db.query(`select public.mutate_schedule((select (public.load_schedule()->>'version')::bigint),$1::jsonb)`,
        [JSON.stringify({type:'assign',taskId:'availability-task-1',memberId:other.rows[0].id})])).rejects.toThrow('nicht verfuegbar');
      await db.query(`select public.mutate_schedule((select (public.load_schedule()->>'version')::bigint),$1::jsonb)`,
        [JSON.stringify({type:'assign',taskId:'availability-task-1',memberId:other.rows[0].id,availabilityConfirmed:true})]);
      const conflict = await db.query<{data:{days:Array<{date:string;assignedMemberIds:string[]}>}}>(`select public.load_availability() as data`);
      expect(conflict.rows[0].data.days.find(day => day.date === '2090-04-01')?.assignedMemberIds).toContain(other.rows[0].id);
      await db.query(`select public.restore_availability($1,array[$2::date,'2090-04-01'::date],array['2090-04-01'::date])`,[owner.rows[0].id,today.rows[0].date]);
    } finally { await db.exec('reset role'); }
    await db.exec(`select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);set role authenticated;`);
    try {
      expect((await db.query(`select * from public.availability_exceptions`)).rows).toHaveLength(2);
      await expect(db.query(`insert into public.availability_exceptions(member_id,date) values ($1,'2090-04-01')`,[owner.rows[0].id])).rejects.toThrow();
      await expect(db.query(`insert into public.availability_exceptions(member_id,date) values ($1,'2000-04-01')`,[other.rows[0].id])).rejects.toThrow('kommende Diensttage');
      await db.query(`delete from public.availability_exceptions where member_id = $1`,[owner.rows[0].id]);
      expect((await db.query(`select * from public.availability_exceptions where member_id = $1`,[owner.rows[0].id])).rows).toHaveLength(1);
      await expect(db.query(`select public.set_availability($1,array['2090-04-01'::date],true)`,[owner.rows[0].id])).rejects.toThrow('eigene Meldungen');
      await db.query(`select public.set_availability($1,array['2090-04-01'::date],true)`,[other.rows[0].id]);
      await db.query(`select public.set_availability($1,array['2090-04-01'::date],true)`,[other.rows[0].id]);
    } finally { await db.exec('reset role'); }
  });
});