import 'server-only';
import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import { AccountError, bootstrapOnce, employeeInput, protectAccount, type Account, type EmployeeInput } from './account-rules';
import { parseEmployees, type ImportRow } from './employee-csv';
import { privilegedDatabase } from './server';

export function accountMessage(error: { code?: string; message?: string; status?: number }) {
  if (error.code === '23505' || ['email_exists','user_already_exists'].includes(error.code ?? '')) return 'E-Mail-Adresse existiert bereits.';
  if (error.code === 'email_address_not_authorized') return 'Die Mailkonfiguration erlaubt diese Empfaengeradresse noch nicht. Bitte einen eigenen SMTP-Versand einrichten.';
  if (error.status === 429 || error.code?.includes('rate_limit')) return 'Zu viele E-Mails angefordert. Bitte spaeter erneut versuchen.';
  if (error.code === '23514') return 'Der letzte aktive Admin muss erhalten bleiben.';
  if (error.code === '42501') return 'Diese Aktion ist nicht erlaubt.';
  return 'Aktion fehlgeschlagen. Bitte Eingaben und Server-/Mailkonfiguration pruefen.';
}
function checked(error: { code?: string; message?: string; status?: number } | null) {
  if (error) throw new AccountError(accountMessage(error), error.status === 429 ? 429 : 400);
}
export function passwordRedirect() {
  const value = process.env.APP_URL;
  if (!value) throw new AccountError('APP_URL ist nicht konfiguriert.',503);
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new AccountError('APP_URL muss HTTPS verwenden.',503);
  return `${url.origin}/auth/passwort-setzen`;
}
export async function listAccounts(): Promise<Account[]> {
  const { data,error } = await privilegedDatabase().from('members').select('*').is('archived_at',null).order('name');
  checked(error);
  return (data ?? []) as Account[];
}
async function findAuth(email: string) {
  const { data,error } = await privilegedDatabase().rpc('find_account_by_email',{ account_email:email });
  checked(error); return data as string | null;
}
async function targetAccount(id: string) {
  const { data,error } = await privilegedDatabase().from('members').select('*').eq('id',id).is('archived_at',null).single();
  if (error || !data) throw new AccountError('Mitarbeiter nicht gefunden.',404);
  return data as Account;
}
async function editProfile(actor: Account, target: Account, changes: Record<string,unknown>) {
  const { data,error } = await privilegedDatabase().rpc('admin_edit_member',{ actor_id:actor.user_id, target_id:target.id, changes });
  checked(error); return data as Account;
}
export async function inviteEmployee(input: EmployeeInput, actor: Account) {
  const admin = privilegedDatabase();
  const redirectTo = passwordRedirect();
  if (await findAuth(input.email)) return { skipped:true, message:'Benutzer bereits vorhanden; keine weitere Einladung versendet.' };
  const { data: existing,error: lookupError } = await admin.from('members').select('*').eq('email',input.email).is('archived_at',null).maybeSingle();
  checked(lookupError);
  if (existing?.user_id) return { skipped:true, message:'Benutzer bereits vorhanden.' };
  let member = existing as Account | null;
  if (!member) {
    const { data,error } = await admin.from('members').insert({ email:input.email, name:`${input.vorname} ${input.nachname}`.trim(),
      vorname:input.vorname,nachname:input.nachname,role:'mitarbeiter',winter_active:input.winterActive,summer_active:input.summerActive,qualifications:input.qualifications }).select('*').single();
    if (error?.code === '23505') return { skipped:true,message:'Benutzer wird bereits angelegt; keine doppelte Einladung.' };
    checked(error); member = data as Account;
  }
  const { data: claim,error: claimError } = await admin.rpc('claim_employee_invite',{ actor_id:actor.user_id,member_id:member.id });
  checked(claimError);
  if (!claim) return { skipped:true,message:'Einladung bereits angefordert. Bei Bedarf gezielt erneut senden.' };
  const { data: allowed,error: reserveError } = await admin.rpc('reserve_account_mail',{ member_id:member.id });
  checked(reserveError);
  if (!allowed) throw new AccountError('Mailversand derzeit begrenzt. Bitte Einladung gezielt erneut senden.',429);
  await editProfile(actor,member,{ vorname:input.vorname,nachname:input.nachname,role:input.role,winter_active:input.winterActive,summer_active:input.summerActive,qualifications:input.qualifications });
  const { error } = await admin.auth.admin.inviteUserByEmail(input.email,{ redirectTo,data:{ full_name:`${input.vorname} ${input.nachname}`.trim() } });
  checked(error);
  return { skipped:false,message:'Einladung versendet.' };
}
export async function updateEmployee(actor: Account, id: string, input: EmployeeInput) {
  const target = await targetAccount(id);
  const accounts = await listAccounts();
  protectAccount(actor.user_id!,target,'edit',input.role,accounts.filter(account => account.role === 'admin' && account.account_status === 'aktiv').length);
  if (accounts.some(account => account.id !== id && account.email?.toLowerCase() === input.email)) throw new AccountError('E-Mail-Adresse existiert bereits.',409);
  if (input.email !== target.email?.toLowerCase()) {
    if (target.user_id) {
      const { error } = await privilegedDatabase().auth.admin.updateUserById(target.user_id,{ email:input.email,email_confirm:true });
      checked(error);
    } else {
      const { error } = await privilegedDatabase().from('members').update({ email:input.email }).eq('id',id);
      checked(error);
    }
  }
  return editProfile(actor,target,{ vorname:input.vorname,nachname:input.nachname,role:input.role,winter_active:input.winterActive,summer_active:input.summerActive,qualifications:input.qualifications });
}
export async function changeEmployeeStatus(actor: Account, id: string, enabled: boolean) {
  const target = await targetAccount(id);
  const accounts = await listAccounts();
  if (!enabled) protectAccount(actor.user_id!,target,'deactivate',target.role,accounts.filter(account => account.role === 'admin' && account.account_status === 'aktiv').length);
  if (!target.user_id) throw new AccountError('Zuerst eine Einladung fuer diesen Mitarbeiter senden.');
  const admin = privilegedDatabase();
  if (enabled) {
    const { error } = await admin.auth.admin.updateUserById(target.user_id,{ ban_duration:'none' });
    checked(error);
    await editProfile(actor,target,{ account_status:'aktiv' });
  } else {
    await editProfile(actor,target,{ account_status:'deaktiviert' });
    const { error } = await admin.auth.admin.updateUserById(target.user_id,{ ban_duration:'876000h' });
    if (error) throw new AccountError('App-Zugang und Sessions gesperrt, Auth-Sperre fehlgeschlagen. Aktion erneut ausfuehren.',503);
  }
}
export async function deleteEmployee(actor: Account, id: string, confirmation: string) {
  const target = await targetAccount(id);
  if (confirmation.trim() !== target.name) throw new AccountError('Bitte den vollstaendigen Namen zur Bestaetigung eingeben.');
  const accounts = await listAccounts();
  protectAccount(actor.user_id!,target,'delete',target.role,accounts.filter(account => account.role === 'admin' && account.account_status === 'aktiv').length);
  if (!target.user_id) {
    const { error } = await privilegedDatabase().rpc('archive_unlinked_member',{ actor_id:actor.user_id,member_id:target.id });
    checked(error); return;
  }
  const { error } = await privilegedDatabase().auth.admin.deleteUser(target.user_id);
  checked(error);
}
export async function sendAccountMail(id: string, invitation: boolean) {
  const target = await targetAccount(id);
  if (!target.email || target.account_status === 'deaktiviert') throw new AccountError('E-Mail fehlt oder Zugang ist deaktiviert.');
  if (invitation && target.account_status !== 'eingeladen') throw new AccountError('Nur fuer noch eingeladene Mitarbeiter.');
  const admin = privilegedDatabase();
  const { data: allowed,error: reserveError } = await admin.rpc('reserve_account_mail',{ member_id:target.id });
  checked(reserveError);
  if (!allowed) throw new AccountError('Bitte vor dem erneuten Mailversand mindestens eine Minute warten.',429);
  if (!target.user_id) {
    const { error } = await admin.auth.admin.inviteUserByEmail(target.email,{ redirectTo:passwordRedirect() });
    checked(error);
  } else {
    const { error } = await admin.auth.resetPasswordForEmail(target.email,{ redirectTo:passwordRedirect() });
    checked(error);
  }
}
export async function importPreview(csv: string) {
  const accounts = await listAccounts();
  try { return parseEmployees(csv,new Set(accounts.filter(account => account.user_id).map(account => account.email?.toLowerCase() ?? ''))); }
  catch (error) { throw new AccountError(error instanceof Error ? error.message : 'CSV konnte nicht verarbeitet werden.'); }
}
export async function importEmployees(actor: Account, rows: { line:number; input:EmployeeInput }[]): Promise<ImportRow[]> {
  const result: ImportRow[] = [];
  for (const [index,row] of rows.entries()) {
    if (index > 0) await pause(1100);
    const base = { line:row.line,email:row.input.email,name:`${row.input.vorname} ${row.input.nachname}`.trim(),input:row.input };
    try {
      const outcome = await inviteEmployee(employeeInput.parse(row.input),actor);
      result.push({ ...base,state:outcome.skipped ? 'skipped' : 'success',message:outcome.message });
    } catch (error) {
      result.push({ ...base,state:'error',message:error instanceof AccountError ? error.message : 'Einladung fehlgeschlagen.' });
    }
  }
  return result;
}
export async function bootstrapAdmin() {
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  passwordRedirect();
  const admin = privilegedDatabase();
  return bootstrapOnce({
    claim: async () => { const { data,error } = await admin.rpc('claim_admin_bootstrap',{ admin_email:email,repair_existing:process.env.BOOTSTRAP_REPAIR_EXISTING_ADMIN === 'true' }); checked(error); return data; },
    deliver: async claim => {
      const result = claim.userId
        ? await admin.auth.resetPasswordForEmail(email,{ redirectTo:passwordRedirect() })
        : await admin.auth.admin.inviteUserByEmail(email,{ redirectTo:passwordRedirect() });
      checked(result.error);
    },
    finish: async status => { const { error } = await admin.rpc('finish_admin_bootstrap',{ admin_email:email,result_status:status }); checked(error); }
  });
}