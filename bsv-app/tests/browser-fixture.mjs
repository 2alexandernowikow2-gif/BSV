import { createServer } from 'node:http';
import { cpSync,mkdtempSync,realpathSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const app = realpathSync.native(dirname(dirname(fileURLToPath(import.meta.url))));
const temporary = mkdtempSync(join(tmpdir(),'bsv-account-browser-'));
for (const file of ['src','package.json','tsconfig.json','next.config.ts']) cpSync(join(app,file),join(temporary,file),{ recursive:true });
symlinkSync(join(app,'node_modules'),join(temporary,'node_modules'),process.platform === 'win32' ? 'junction' : 'dir');
const makeAccount = (index,vorname,nachname,email,role,status,user = true) => ({
  id:`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`,user_id:user ? `10000000-0000-4000-8000-${String(index).padStart(12,'0')}` : null,
  name:`${vorname} ${nachname}`,vorname,nachname,email,role,account_status:status,winter_active:true,summer_active:index % 2 === 0,
  qualifications:[],archived_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()
});
const accounts = [
  makeAccount(1,'Test','Administration','admin@example.invalid','admin','aktiv'),
  makeAccount(2,'Anna','Mitarbeiterin','anna@example.invalid','mitarbeiter','aktiv'),
  makeAccount(3,'Max','Eingeladen','max@example.invalid','mitarbeiter','eingeladen'),
  makeAccount(4,'Altbestand','Ohne Zugang',null,'mitarbeiter','eingeladen',false)
];
const schedule = { version:0,shifts:[],members:[],planningPeriods:{} };
const availabilityExceptions = [];
for (const offset of [1,3,5]) {
  const date = new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
  for (const index of [0,1]) schedule.shifts.push({ id:`availability-${offset}-${index}`,date,title:index ? 'Spaetdienst' : 'Fruehdienst',kind:'manual',
    start:index ? '14:00' : '09:30',end:index ? '18:00' : '13:30',published:index === 0,
    tasks:[{id:`availability-task-${offset}-${index}`,name:'Kasse',qualification:null,offsetMinutes:0,durationMinutes:null,memberId:offset === 1 ? accounts[0].id : null}] });
}
function user(account) { return { id:account.user_id,email:account.email,aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString(),
  app_metadata:{ provider:'email',providers:['email'] },user_metadata:{ role:'admin' },created_at:new Date().toISOString() }; }
function session(account) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token:`${encode({ alg:'HS256',typ:'JWT' })}.${encode({ sub:account.user_id,role:'authenticated',aud:'authenticated',iss:'http://127.0.0.1:42790/auth/v1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600 })}.fixture`,
    refresh_token:'fixture-refresh-token',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(account) };
}
const backend = createServer(async (request,response) => {
  response.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3012');
  response.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');
  response.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,OPTIONS');
  response.setHeader('Content-Type','application/json');
  if (request.method === 'OPTIONS') { response.end();return; }
  let text = '';for await (const chunk of request) text += chunk;
  let body;try { body = text ? JSON.parse(text) : {}; } catch { response.statusCode = 400;response.end('{}');return; }
  const url = new URL(request.url,'http://127.0.0.1:42790');
  let actor = accounts[0];
  try { const token = request.headers.authorization?.split(' ')[1];const id = JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub;actor = accounts.find(account => account.user_id === id) ?? accounts[0]; } catch { }
  const send = data => response.end(JSON.stringify(data));
  if (url.pathname === '/auth/v1/token') return send(session(accounts.find(account => account.email === body.email) ?? accounts[0]));
  if (url.pathname === '/auth/v1/verify') return send(session(accounts[2]));
  if (url.pathname === '/auth/v1/user') return send(user(actor));
  if (url.pathname === '/auth/v1/logout' || url.pathname === '/auth/v1/recover') return send({});
  if (url.pathname === '/auth/v1/invite') {
    const account = accounts.find(account => account.email === body.email);
    account.user_id ??= `10000000-0000-4000-8000-${String(accounts.indexOf(account)+1).padStart(12,'0')}`;
    return send(user(account));
  }
  if (url.pathname.startsWith('/auth/v1/admin/users/')) {
    const account = accounts.find(account => account.user_id === url.pathname.split('/').at(-1));
    if (body.email) account.email = body.email;
    if (request.method === 'DELETE') { account.archived_at = new Date().toISOString();account.user_id = null; }
    return send(user(account));
  }
  if (url.pathname === '/rest/v1/rpc/current_member') return send(actor.account_status === 'aktiv' ? actor : null);
  if (url.pathname === '/rest/v1/rpc/load_availability') {
    const dates = [...new Set(schedule.shifts.map(shift => shift.date))].sort();
    return send({ memberId:actor.id,admin:actor.role === 'admin',exceptions:availabilityExceptions,
      members:accounts.filter(account => account.account_status === 'aktiv').map(account => ({id:account.id,name:account.name,winterActive:account.winter_active,summerActive:account.summer_active})),
      days:dates.map(date => {
        const shifts = schedule.shifts.filter(shift => shift.date === date);
        return {date,count:shifts.length,published:shifts.every(shift => shift.published),mixed:shifts.some(shift => shift.published) && !shifts.every(shift => shift.published),
          assigned:shifts.some(shift => shift.tasks.some(task => task.memberId === actor.id)),assignedMemberIds:actor.role === 'admin' ? [...new Set(shifts.flatMap(shift => shift.tasks.map(task => task.memberId).filter(Boolean)))] : []};
      }) });
  }
  if (['/rest/v1/rpc/set_availability','/rest/v1/rpc/restore_availability'].includes(url.pathname)) {
    if (actor.role !== 'admin' && actor.id !== body.target_member_id) { response.statusCode = 403; return send({code:'42501',message:'Nur eigene Meldungen sind aenderbar.'}); }
    for (const date of body.service_dates) {
      const index = availabilityExceptions.findIndex(entry => entry.memberId === body.target_member_id && entry.date === date);
      const available = body.available ?? !body.unavailable_dates.includes(date);
      if (available && index >= 0) availabilityExceptions.splice(index,1);
      if (!available && index < 0) availabilityExceptions.push({memberId:body.target_member_id,date});
    }
    return send(null);
  }
  if (url.pathname === '/rest/v1/rpc/load_schedule') {
    schedule.availabilityExceptions = availabilityExceptions;
    schedule.activatedMemberIds = accounts.filter(account => account.account_status === 'aktiv').map(account => account.id);
    schedule.members = accounts.filter(account => !account.archived_at).map(account => ({
      id:account.id,name:account.name,active:account.account_status === 'aktiv',qualifications:account.qualifications,
      winterActive:account.winter_active,summerActive:account.summer_active,
      status:account.winter_active && account.summer_active ? 'both' : account.winter_active ? 'winter' : account.summer_active ? 'summer' : 'inactive',
      ...(actor.role === 'admin' ? { email:account.email,role:account.role } : {})
    }));
    return send(schedule);
  }
  if (url.pathname === '/rest/v1/rpc/delete_drafts') {
    if (actor.role !== 'admin') { response.statusCode = 403;return send({code:'42501',message:'Administrator required'}); }
    if (body.expected_version !== schedule.version) { response.statusCode = 409;return send({code:'40001',message:'Schedule version conflict'}); }
    const ids = body.shift_ids;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
      || ids.some(id => { const shift = schedule.shifts.find(item => item.id === id); return !shift || shift.published || schedule.planningPeriods[shift.date.slice(0,7)] === 'closed'; })) {
      response.statusCode = 400;return send({code:'22023',message:'Only future drafts can be deleted'});
    }
    schedule.shifts = schedule.shifts.filter(shift => !ids.includes(shift.id));
    schedule.version += 1;
    return send(schedule);
  }
  if (url.pathname === '/rest/v1/rpc/mutate_schedule') {
    const command = body.command;
    if (body.expected_version !== schedule.version) { response.statusCode = 409;return send({ code:'40001',message:'Schedule version conflict' }); }
    if (command?.type === 'generate') {
      const knownIds = new Set(schedule.shifts.map(shift => shift.id));
      for (const shift of command.shifts ?? []) if (!knownIds.has(shift.id)) { schedule.shifts.push(shift);knownIds.add(shift.id); }
    } else if (command?.type === 'create' && command.shift) {
      if (schedule.shifts.some(shift => shift.id === command.shift.id)) { response.statusCode = 400;return send({ code:'23505',message:'Dienst existiert bereits.' }); }
      schedule.shifts.push(command.shift);
    } else if (command?.type === 'updateTimes') {
      for (const update of command.updates ?? []) {
        const shift = schedule.shifts.find(item => item.id === update.id);
        if (!shift) { response.statusCode = 400;return send({ code:'22023',message:'Dienst nicht gefunden.' }); }
        shift.start = update.start;shift.end = update.end;
      }
    } else if (command?.type === 'publish') {
      for (const id of command.ids ?? []) {
        const shift = schedule.shifts.find(item => item.id === id);
        if (shift) { shift.published = true;schedule.planningPeriods[shift.date.slice(0,7)] = 'open'; }
      }
    } else if (command?.type === 'monthPhase') {
      schedule.planningPeriods[command.month] = command.phase;
    } else if (command?.type === 'assign' || command?.type === 'signup' || command?.type === 'withdraw') {
      const shift = schedule.shifts.find(item => item.tasks.some(task => task.id === command.taskId));
      const task = shift?.tasks.find(item => item.id === command.taskId);
      if (!task) { response.statusCode = 400;return send({ code:'22023',message:'Aufgabe nicht gefunden.' }); }
      task.memberId = command.type === 'withdraw' ? null : command.memberId ?? actor.id;
    } else {
      response.statusCode = 400;return send({ code:'22023',message:'Unsupported fixture schedule command' });
    }
    schedule.version += 1;
    return send(schedule);
  }
  if (url.pathname === '/rest/v1/rpc/find_account_by_email') return send(accounts.find(account => account.email === body.account_email)?.user_id ?? null);
  if (url.pathname === '/rest/v1/rpc/claim_employee_invite' || url.pathname === '/rest/v1/rpc/reserve_account_mail') return send(true);
  if (url.pathname === '/rest/v1/rpc/activate_own_account') { actor.account_status = 'aktiv';return send(null); }
  if (url.pathname === '/rest/v1/rpc/admin_edit_member') {
    const account = accounts.find(account => account.id === body.target_id);Object.assign(account,body.changes);account.name = `${account.vorname} ${account.nachname}`.trim();return send(account);
  }
  if (url.pathname === '/rest/v1/members') {
    if (request.method === 'POST') { const account = makeAccount(accounts.length+1,body.vorname,body.nachname,body.email,body.role,'eingeladen',false);accounts.push(account);return send(account); }
    const filtered = accounts.filter(account => !account.archived_at && ['id','user_id','email'].every(key => !url.searchParams.has(key) || account[key] === url.searchParams.get(key).replace(/^eq\./,'')));
    if (request.method === 'PATCH') for (const account of filtered) Object.assign(account,body);
    return send(request.headers.accept?.includes('application/vnd.pgrst.object+json') ? filtered[0] ?? null : filtered);
  }
  response.statusCode = 404;send({ error:'Unsupported fixture endpoint' });
});
await new Promise(resolve => backend.listen(42790,'127.0.0.1',resolve));
const child = spawn(process.execPath,[join(app,'node_modules/next/dist/bin/next'),'dev',temporary,'--webpack','--hostname','127.0.0.1','--port','3012'],{
  stdio:'inherit',env:{ ...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:42790',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-key',
    SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',APP_URL:'http://127.0.0.1:3012',ADMIN_EMAIL:'admin@example.invalid',BOOTSTRAP_SECRET:'fixture-only-not-a-real-secret-123456',NEXT_TELEMETRY_DISABLED:'1' }
});
function close() { child.kill();backend.close();try { rmSync(temporary,{ recursive:true,force:true }); } catch { } }
process.on('SIGINT',() => { close();process.exit(); });process.on('SIGTERM',() => { close();process.exit(); });
child.on('exit',code => { backend.close();process.exitCode = code ?? 0; });
console.log('Isolated fixture: http://127.0.0.1:3012 (admin@example.invalid, any nonempty password). No real email delivery.');