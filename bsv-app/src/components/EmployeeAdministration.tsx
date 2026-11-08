'use client';

import { useRef,useState } from 'react';
import Papa from 'papaparse';
import { ArrowLeft,Check,Download,KeyRound,LoaderCircle,LockKeyhole,Mail,Pencil,Plus,RefreshCw,Search,ShieldCheck,Trash2,UnlockKeyhole,Upload,X } from 'lucide-react';
import { employeeInput,isPlaceholderEmail,type Account,type ImportEmployeeInput } from '../lib/account-rules';
import { accountRequest } from '../lib/account-client';
import type { ImportRow } from '../lib/employee-csv';
import { QUALIFICATION_NAMES } from '../lib/domain';
import { useDialog } from './useDialog';

const endpoint = '/api/admin/mitarbeiter';
const statuses = { eingeladen:'Eingeladen',aktiv:'Aktiv',deaktiviert:'Deaktiviert' };
const rowLabels = { ready:'Bereit',success:'Erfolgreich',skipped:'Uebersprungen',error:'Fehler' };
type Props = { initialAccounts:Account[]; actorId:string };

export default function EmployeeAdministration({ initialAccounts,actorId }: Props) {
  const [accounts,setAccounts] = useState(initialAccounts);
  const [search,setSearch] = useState('');
  const [role,setRole] = useState('all');
  const [status,setStatus] = useState('all');
  const [editing,setEditing] = useState<Account | 'new' | null>(null);
  const [deleting,setDeleting] = useState<Account | null>(null);
  const [confirmation,setConfirmation] = useState('');
  const [rows,setRows] = useState<ImportRow[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [importing,setImporting] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const pending = useRef(false);
  const stopImport = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const activeAdmins = accounts.filter(account => account.role === 'admin' && account.account_status === 'aktiv').length;
  const visible = accounts.filter(account => `${account.name} ${account.email ?? ''}`.toLowerCase().includes(search.toLowerCase())
    && (role === 'all' || account.role === role)
    && (status === 'all' || (status === 'incomplete' ? !account.email || !account.user_id : account.account_status === status)));
  function closeDialog() { if (!pending.current) { setEditing(null);setDeleting(null);setRows(null);setConfirmation(''); } }
  useDialog(dialog,!!editing || !!deleting || !!rows,closeDialog);
  async function refresh() { const data = await accountRequest<{ accounts:Account[] }>(endpoint);setAccounts(data.accounts); }
  async function perform(body: unknown,success: string,close = false) {
    if (pending.current) return;
    pending.current = true;setBusy(true);setError('');setMessage('');
    try {
      const result = await accountRequest<{ message?:string;redirect?:string }>(endpoint,body);
      if (result.redirect) { window.location.assign(result.redirect);return; }
      await refresh();setMessage(result.message ?? success);
      if (close) { setEditing(null);setDeleting(null);setConfirmation(''); }
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Aktion fehlgeschlagen.'); }
    finally { pending.current = false;setBusy(false); }
  }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const legacy = editing && editing !== 'new' ? editing.qualifications.filter(value => !QUALIFICATION_NAMES.includes(value)) : [];
    const input = employeeInput.safeParse({ vorname:String(values.get('vorname')),nachname:String(values.get('nachname')),
      email:String(values.get('email')),role:values.get('role'),winterActive:values.get('winterActive') === 'on',summerActive:values.get('summerActive') === 'on',
      qualifications:[...new Set([...values.getAll('qualifications').map(String),...legacy])],serviceInfo:String(values.get('serviceInfo')) });
    if (!input.success) { setError('Bitte Name, E-Mail-Adresse und Rolle pruefen.');return; }
    void perform(editing === 'new' ? { action:'invite',input:input.data } : { action:'edit',id:editing?.id,input:input.data },editing === 'new' ? 'Einladung versendet.' : 'Mitarbeiter gespeichert.',true);
  }
  async function preview(file?: File) {
    if (!file || pending.current) return;
    pending.current = true;setBusy(true);setError('');setMessage('');
    try {
      if (file.size > 1_000_000) throw new Error('CSV darf maximal 1 MB gross sein.');
      let csv: string;
      try { csv = new TextDecoder('utf-8',{ fatal:true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('CSV bitte als UTF-8-Datei speichern und erneut auswaehlen.'); }
      const data = await accountRequest<{ rows:ImportRow[] }>(endpoint,{ action:'preview',csv });
      setRows(data.rows);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'CSV konnte nicht gelesen werden. Bitte als UTF-8 speichern.'); }
    finally { pending.current = false;setBusy(false);if (fileInput.current) fileInput.current.value = ''; }
  }
  async function startImport() {
    if (!rows || pending.current) return;
    const ready = rows.filter((row): row is ImportRow & { input:ImportEmployeeInput } => row.state === 'ready' && !!row.input);
    pending.current = true;stopImport.current = false;setBusy(true);setImporting(true);setError('');
    try {
      for (let offset = 0;offset < ready.length && !stopImport.current;offset += 3) {
        if (offset > 0) await new Promise(resolve => setTimeout(resolve,1100));
        if (stopImport.current) break;
        const data = await accountRequest<{ rows:ImportRow[] }>(endpoint,{ action:'import',rows:ready.slice(offset,offset + 3).map(row => ({ line:row.line,input:row.input })) });
        setRows(current => current?.map(row => data.rows.find(result => result.line === row.line) ?? row) ?? null);
      }
      await refresh();setMessage(stopImport.current ? 'Import nach dem letzten Batch angehalten.' : 'Import abgeschlossen.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Import unterbrochen. Bereits angelegte Zugaenge werden nicht doppelt erstellt.'); }
    finally { pending.current = false;setBusy(false);setImporting(false); }
  }
  function downloadReport() {
    if (!rows) return;
    const csv = Papa.unparse(rows.map(row => ({ zeile:row.line,name:row.name,email:row.email,mitgliedsstatus:row.input?.inactive ? 'inaktiv' : 'aktiv',qualifikationen:row.input?.qualifications.join('|') ?? '',info_zu_dienst:row.input?.serviceInfo ?? '',status:rowLabels[row.state],ergebnis:row.message })),{ delimiter:';',escapeFormulae:true });
    const url = URL.createObjectURL(new Blob(['\uFEFF',csv],{ type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');link.href = url;link.download = 'mitarbeiter-import-bericht.csv';link.click();URL.revokeObjectURL(url);
  }
  const current = editing && editing !== 'new' ? editing : null;
  return <div className="management-shell">
    <header className="management-header"><a className="brand" href="/"><span className="brand-mark">BSV</span><span><strong>BSV Weitnau</strong><small>Mitarbeiterverwaltung</small></span></a><nav><a href="/"><ArrowLeft size={17} />Dienstkalender</a><a href="/konto"><ShieldCheck size={17} />Mein Profil</a></nav></header>
    <main className="management-content"><div className="page-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Mitarbeiter</h1></div><span className="badge neutral">Version 0.2.0</span></div>
      <div className="management-feedback" aria-live="polite">{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice green" role="status"><Check size={17} />{message}</p>}</div>
      <section><div className="section-heading"><div><h2>Benutzer und Zugaenge</h2><p>{accounts.length} Mitarbeiter · {activeAdmins} aktive Admins</p></div><div className="management-actions"><button className="icon-button" title="Aktualisieren" aria-label="Aktualisieren" disabled={busy} onClick={() => { setError('');void refresh().catch(() => setError('Aktualisierung fehlgeschlagen.')); }}><RefreshCw size={17} /></button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={event => void preview(event.target.files?.[0])} /><button className="secondary-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} />CSV importieren</button><button className="primary-button" disabled={busy} onClick={() => { setError('');setEditing('new'); }}><Plus size={17} />Mitarbeiter einladen</button></div></div>
      <div className="filter-bar"><label className="search-field"><Search size={17} /><input aria-label="Mitarbeiter suchen" placeholder="Name oder E-Mail" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Rolle filtern" value={role} onChange={event => setRole(event.target.value)}><option value="all">Alle Rollen</option><option value="admin">Admin</option><option value="mitarbeiter">Mitarbeiter</option></select><select aria-label="Kontostatus filtern" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Alle Kontostatus</option>{Object.entries(statuses).map(([value,label]) => <option key={value} value={value}>{label}</option>)}<option value="incomplete">Unvollstaendig</option></select><span className="muted">{visible.length} Treffer</span></div>
      <div className="table-scroll"><table className="member-table account-table"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Kontostatus</th><th>Saison</th><th>Qualifikationen</th><th>Info zu Dienst</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{visible.map(account => {
        const self = account.user_id === actorId;
        const protectedAdmin = account.role === 'admin' && account.account_status === 'aktiv' && activeAdmins === 1;
        return <tr key={account.id}><td><strong>{account.name}</strong>{self && <small className="muted account-subline">Dein Zugang</small>}</td><td>{account.email || <span className="muted">E-Mail fehlt</span>}{isPlaceholderEmail(account.email) && <small className="account-subline muted">E-Mail noch eintragen</small>}</td><td><span className={`badge ${account.role === 'admin' ? 'amber' : 'neutral'}`}>{account.role === 'admin' ? 'Admin' : 'Mitarbeiter'}</span></td><td><span className={`badge ${account.account_status === 'aktiv' ? 'green' : account.account_status === 'eingeladen' ? 'amber' : 'neutral'}`}>{statuses[account.account_status]}</span>{(!account.email || !account.user_id) && <small className="account-subline muted">Unvollstaendig</small>}</td><td>{[account.winter_active ? 'Winter' : '',account.summer_active ? 'Sommer' : ''].filter(Boolean).join(' + ') || <span className="muted">Keine</span>}</td><td>{account.qualifications.length ? account.qualifications.join(', ') : <span className="muted">Keine</span>}</td><td className="account-service-info" title={account.service_info}>{account.service_info || <span className="muted">-</span>}</td><td><div className="row-actions"><button className="icon-button" title="Mitarbeiter und Rolle bearbeiten" aria-label={`${account.name} bearbeiten`} disabled={busy} onClick={() => { setError('');setEditing(account); }}><Pencil size={17} /></button><button className="icon-button" title={account.account_status === 'deaktiviert' ? 'Zugang aktivieren' : 'Zugang deaktivieren'} aria-label={`${account.name} ${account.account_status === 'deaktiviert' ? 'aktivieren' : 'deaktivieren'}`} disabled={busy || !account.user_id || (account.account_status !== 'deaktiviert' && (self || protectedAdmin))} onClick={() => void perform({ action:'status',id:account.id,enabled:account.account_status === 'deaktiviert' },'Kontostatus gespeichert.')} >{account.account_status === 'deaktiviert' ? <UnlockKeyhole size={17} /> : <LockKeyhole size={17} />}</button><button className="icon-button" title={account.user_id ? 'Einladung erneut senden' : 'Mitarbeiter einladen'} aria-label={`${account.name} ${account.user_id ? 'erneut einladen' : 'einladen'}`} disabled={busy || !account.email || isPlaceholderEmail(account.email) || (!!account.user_id && account.account_status !== 'eingeladen')} onClick={() => void perform(account.user_id ? { action:'mail',id:account.id,invitation:true } : { action:'inviteExisting',id:account.id },'Einrichtungsmail angefordert.')}><Mail size={17} /></button><button className="icon-button" title="Passwort-Reset senden" aria-label={`${account.name} Passwort zuruecksetzen`} disabled={busy || !account.email || !account.user_id || account.account_status === 'deaktiviert'} onClick={() => void perform({ action:'mail',id:account.id,invitation:false },'Passwort-Reset angefordert.')}><KeyRound size={17} /></button><button className="icon-button danger" title="Endgueltig loeschen" aria-label={`${account.name} loeschen`} disabled={busy || self || protectedAdmin} onClick={() => { setError('');setConfirmation('');setDeleting(account); }}><Trash2 size={17} /></button></div></td></tr>;
      })}</tbody></table></div>{!visible.length && <div className="empty-state"><Search size={28} /><h3>Keine passenden Mitarbeiter</h3></div>}</section>
    </main>
    {(editing || deleting || rows) && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}><section ref={dialog} className={`modal ${rows ? 'import-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><header className="modal-heading"><h2 id="account-dialog-title">{editing ? current ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter einladen' : deleting ? 'Zugang endgueltig loeschen' : 'CSV-Import'}</h2><button className="icon-button" title="Schliessen" aria-label="Schliessen" disabled={busy} onClick={closeDialog}><X size={20} /></button></header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {editing && <form onSubmit={save}><div className="form-grid"><label>Vorname<input name="vorname" autoComplete="given-name" required maxLength={60} defaultValue={current?.vorname ?? ''} /></label><label>Nachname<input name="nachname" autoComplete="family-name" maxLength={60} defaultValue={current?.nachname ?? ''} /></label><label className="span-all">E-Mail<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={current?.email && !isPlaceholderEmail(current.email) ? current.email : ''} placeholder={isPlaceholderEmail(current?.email) ? 'Echte E-Mail-Adresse eintragen' : undefined} /></label><label>Rolle<select name="role" defaultValue={current?.role ?? 'mitarbeiter'}><option value="mitarbeiter">Mitarbeiter</option><option value="admin">Admin</option></select></label><fieldset className="member-season-options span-all"><legend>Aktiv in der Planung</legend><label className="check-label"><input type="checkbox" name="winterActive" defaultChecked={current?.winter_active ?? true} />Winter</label><label className="check-label"><input type="checkbox" name="summerActive" defaultChecked={current?.summer_active ?? false} />Sommer</label></fieldset><fieldset className="qualification-fieldset span-all"><legend>Qualifikationen</legend><div className="qualification-checkboxes">{QUALIFICATION_NAMES.map(qualification => <label className="check-label" key={qualification}><input type="checkbox" name="qualifications" value={qualification} defaultChecked={current?.qualifications.includes(qualification)} />{qualification}</label>)}</div></fieldset><label className="span-all">Info zu Dienst<textarea name="serviceInfo" rows={3} maxLength={500} defaultValue={current?.service_info ?? ''} /></label></div><footer className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Abbrechen</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{current ? 'Speichern' : 'Einladen'}</button></footer></form>}
      {deleting && <form onSubmit={event => { event.preventDefault();void perform({ action:'delete',id:deleting.id,confirmation },'Zugang geloescht. Vergangene Dienste bleiben erhalten.',true); }}><p><strong>{deleting.name}</strong> verliert den Login. Zukuenftige Dienstzuweisungen werden entfernt; vergangene Dienste bleiben mit dem bisherigen Namen erhalten.</p><label>Vollstaendigen Namen bestaetigen<input autoComplete="off" required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><footer className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Abbrechen</button><button className="primary-button danger-button" disabled={busy || confirmation.trim() !== deleting.name}><Trash2 size={17} />Endgueltig loeschen</button></footer></form>}
      {rows && <><p className="small muted">Alle Datensätze werden ohne Einladungsmail importiert. Einladungen versendet ein Admin später manuell; inaktive Kontakte bleiben bis dahin deaktiviert.</p><div className="import-summary">{Object.entries(rowLabels).map(([value,label]) => <span className="badge neutral" key={value}>{label}: {rows.filter(row => row.state === value).length}</span>)}</div><div className="table-scroll import-preview"><table className="member-table"><thead><tr><th>Zeile</th><th>Name</th><th>E-Mail</th><th>Mitgliedsstatus</th><th>Qualifikationen</th><th>Info zu Dienst</th><th>Importstatus</th><th>Ergebnis</th></tr></thead><tbody>{rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.name}</td><td>{row.email || '-'}</td><td>{row.input?.inactive ? 'Inaktiv' : 'Aktiv'}</td><td>{row.input?.qualifications.join(', ') || '-'}</td><td>{row.input?.serviceInfo || '-'}</td><td><span className={`badge ${row.state === 'success' ? 'green' : row.state === 'error' ? 'amber' : 'neutral'}`}>{rowLabels[row.state]}</span></td><td>{row.message}</td></tr>)}</tbody></table></div><footer className="form-actions"><button className="secondary-button" onClick={downloadReport}><Download size={17} />Bericht</button>{importing ? <button className="secondary-button" onClick={() => { stopImport.current = true; }}>Nach Batch anhalten</button> : <button className="secondary-button" onClick={closeDialog}>Schliessen</button>}<button className="primary-button" disabled={busy || !rows.some(row => row.state === 'ready')} onClick={() => void startImport()}>{importing ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{rows.filter(row => row.state === 'ready').length} importieren</button></footer></>}
    </section></div>}
  </div>;
}