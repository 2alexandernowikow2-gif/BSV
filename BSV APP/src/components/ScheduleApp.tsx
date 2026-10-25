'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Bell, CalendarDays, Check, ClipboardList, Clock, FlaskConical, KeyRound, LoaderCircle, LogOut, Mail, RefreshCw, Search, Settings, ShieldCheck, Users, X } from 'lucide-react';
import { applyCommand, demoSeed, localDate, localTime, memberSeasonStatus, nextDate, normalizeQualification, normalizeTaskName, QUALIFICATION_NAMES, taskWindow, validEmail, validateSnapshot, type Actor, type Command, type Member, type Notification, type Snapshot } from '../lib/domain';
import ScheduleCalendar, { germanDate, ShiftRow } from './ScheduleCalendar';
import MemberDirectory from './MemberDirectory';
import Planning from './Planning';
import ShiftDetail from './ShiftDetail';

type SessionUser = { id: string; memberId: string; role: string; name: string };
type Session = { configured: boolean; user: SessionUser | null };
type Tab = 'calendar' | 'duties' | 'members' | 'planning' | 'settings';
type StoredDemo = { snapshot: Snapshot; email: string; notifications: Notification[] };
const STORAGE_KEY = 'bsv-weitnau-demo-v1';
const navigation = [
  { id: 'calendar', name: 'Dienstkalender', icon: CalendarDays, admin: false },
  { id: 'duties', name: 'Meine Dienste', icon: ClipboardList, admin: false },
  { id: 'planning', name: 'Planung', icon: CalendarDays, admin: true },
  { id: 'members', name: 'Mitarbeiter', icon: Users, admin: true },
  { id: 'settings', name: 'Einstellungen', icon: Settings, admin: false },
] as const;

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 204) return undefined as T;
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('Der Server hat keine gueltige Antwort geliefert.'); }
  if (!response.ok || (typeof payload === 'object' && payload !== null && 'error' in payload)) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload ? String(payload.error) : `Serverfehler (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}
function checkSnapshot(payload: Snapshot): Snapshot {
  if (!payload || !Array.isArray(payload.shifts) || !Array.isArray(payload.members) || !Number.isInteger(payload.version)) throw new Error('Ungueltiger Planungsstand vom Server.');
  return payload;
}

function Login({ onLogin, onBootstrap, bootstrapAvailable, bootstrapEmail, busy, error }: { onLogin: (email: string, password: string) => Promise<void>; onBootstrap: (name: string) => Promise<boolean>; bootstrapAvailable: boolean; bootstrapEmail: string; busy: boolean; error: string }) {
  const [firstAdmin, setFirstAdmin] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  return <main className="auth-page"><div className="auth-brand"><span className="brand-mark">BSV</span><div><strong>BSV Weitnau</strong><span>Dienstplanung</span></div></div><section className="auth-form"><div className="auth-icon"><KeyRound size={25} /></div><h1>{firstAdmin ? 'Admin-Erstanmeldung' : 'Anmelden'}</h1><p className="muted">{firstAdmin ? 'Einmaligen Anmeldelink per E-Mail erhalten' : 'Persoenlicher Vereinszugang'}</p>{submitted ? <div className="notice green" role="status"><Mail size={17} /><span>Wenn die Adresse zugelassen ist, wurde ein Anmeldelink versendet. Öffne ihn in deinem Postfach, um den Admin-Zugang einzurichten.</span></div> : <form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); if (firstAdmin) void onBootstrap(String(values.get('name'))).then(sent => { if (sent) setSubmitted(true); }); else void onLogin(String(values.get('email')), String(values.get('password'))); }}>
    {firstAdmin && <label>Name<input autoComplete="name" name="name" required maxLength={120} /></label>}
    <label>E-Mail<input key={firstAdmin ? 'first-admin-email' : 'login-email'} autoComplete="username" name="email" type="email" required autoFocus value={firstAdmin ? bootstrapEmail : undefined} readOnly={firstAdmin} /></label>
    {!firstAdmin && <label>Passwort<input autoComplete="current-password" name="password" type="password" required /></label>}
    {error && <div className="notice error" role="alert"><AlertCircle size={17} />{error}</div>}
    <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : firstAdmin ? <Mail size={17} /> : <ArrowRight size={17} />}{firstAdmin ? 'Anmeldelink senden' : 'Anmelden'}</button>
  </form>}
  {!submitted && bootstrapAvailable && <button className="text-button" onClick={() => setFirstAdmin(current => !current)} type="button">{firstAdmin ? 'Zur Anmeldung' : 'Ersten Admin-Zugang einrichten'}</button>}
  {!firstAdmin && <p className="small muted">Zugang nur mit Einladung der Vereinsverwaltung.</p>}</section></main>;
}

export default function ScheduleApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [demoActor, setDemoActor] = useState<Actor>({ memberId: '', role: 'admin' });
  const [email, setEmail] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [tab, setTab] = useState<Tab>('calendar');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [past, setPast] = useState(false);
  const [dutyFrom, setDutyFrom] = useState('');
  const [dutyTo, setDutyTo] = useState('');
  const [calendarRange, setCalendarRange] = useState(() => {
    const today = localDate();
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    const start = nextDate(today, -((day + 6) % 7));
    return { start, end: nextDate(start, 7) };
  });
  const [passwordMode, setPasswordMode] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [bootstrapEmail, setBootstrapEmail] = useState('');
  const pending = useRef(false);
  const demo = session?.configured === false;
  const actor: Actor = demo ? demoActor : { memberId: session?.user?.memberId ?? '', role: session?.user?.role ?? 'member' };
  const admin = actor.role === 'admin';
  const name = demo ? snapshot?.members.find(member => member.id === actor.memberId)?.name ?? 'Demo Mitglied' : session?.user?.name ?? '';

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const current = await request<Session>('/api/session', { signal: controller.signal });
        if (!current || typeof current.configured !== 'boolean' || (current.user && (!current.user.memberId || !['admin', 'member'].includes(current.user.role)))) throw new Error('Ungueltige Session-Antwort.');
        if (controller.signal.aborted) return;
        setSession(current);
        if (current.configured && !current.user) {
          try {
            const setup = await request<{ available: boolean; email?: string }>('/api/bootstrap-status', { signal: controller.signal });
            setBootstrapAvailable(setup.available);
            setBootstrapEmail(setup.email ?? '');
          } catch { setBootstrapAvailable(false); }
        }
        if (!current.configured) {
          const saved = localStorage.getItem(STORAGE_KEY);
          let stored: StoredDemo;
          if (saved) {
            try { stored = JSON.parse(saved); stored.snapshot.shifts = stored.snapshot.shifts.map(shift => ({ ...shift, tasks: shift.tasks.map(task => { const name = normalizeTaskName(task.name); const qualification = task.qualification ? normalizeQualification(task.qualification) : QUALIFICATION_NAMES.includes(name) ? name : null; return { ...task, name, qualification }; }) })); stored.snapshot.members = stored.snapshot.members.map((member, index) => { const winterActive = member.winterActive ?? (member.status === 'both' || member.status === 'winter' || (!member.status && member.active && (index === 0 || index % 2 === 0))); const summerActive = member.summerActive ?? (member.status === 'both' || member.status === 'summer' || (!member.status && member.active && index > 0 && index % 2 === 1)); return { ...member, qualifications: [...new Set(member.qualifications.map(normalizeQualification))], winterActive, summerActive, status: memberSeasonStatus({ winterActive, summerActive }), active: true }; }); validateSnapshot(stored.snapshot); if (!Array.isArray(stored.notifications) || typeof stored.email !== 'string') throw new Error('Speicherformat ungueltig.'); }
            catch { throw new Error('Lokale Demo-Daten sind beschaedigt. Mit „Demo zuruecksetzen“ neu beginnen.'); }
          } else {
            stored = { snapshot: demoSeed(), email: 'demo0@example.invalid', notifications: [] };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
          }
          setSnapshot(stored.snapshot); setEmail(stored.email); setNotifications(stored.notifications);
          setDemoActor({ memberId: stored.snapshot.members.find(member => member.role === 'admin')?.id ?? stored.snapshot.members[0]?.id ?? '', role: 'admin' });
        } else if (current.user) {
          const data = checkSnapshot(await request<Snapshot>('/api/schedule', { signal: controller.signal }));
          if (controller.signal.aborted) return;
          setSnapshot(data);
        }
        const query = new URLSearchParams(window.location.search);
        setPasswordMode(query.get('setPassword') === '1' || query.get('mode') === 'password' || query.get('type') === 'recovery');
        if (query.get('shift')) setSelectedId(query.get('shift'));
        if (query.get('authError') === '1') setError('Einladungslink ungueltig oder abgelaufen. Bitte die Verwaltung kontaktieren.');
        if (query.get('bootstrapError') === '1') setError('Ersteinrichtung fehlgeschlagen. Pruefe die E-Mail-Bestaetigung oder wende dich an die Verwaltung.');
      } catch (issue) { if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : 'Laden fehlgeschlagen.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function refresh() {
    if (demo || pending.current) return;
    setBusy(true); pending.current = true; setError('');
    try { setSnapshot(checkSnapshot(await request<Snapshot>('/api/schedule'))); setMessage('Planungsstand aktualisiert.'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Aktualisierung fehlgeschlagen.'); }
    finally { setBusy(false); pending.current = false; }
  }
  async function run(command: Command): Promise<boolean> {
    if (!snapshot || pending.current) return false;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (demo) {
        const result = applyCommand(snapshot, command, actor, new Date(), email);
        const nextEmail = command.type === 'settings' ? command.email : email;
        const nextNotifications = [...result.notifications, ...notifications];
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ snapshot: result.snapshot, email: nextEmail, notifications: nextNotifications }));
        setSnapshot(result.snapshot); setEmail(nextEmail); setNotifications(nextNotifications);
      } else {
        const data = checkSnapshot(await request<Snapshot>('/api/schedule', { method: 'POST', body: JSON.stringify({ version: snapshot.version, command }) }));
        setSnapshot(data);
        if (command.type === 'settings') setEmail(command.email);
      }
      setMessage(command.type === 'withdraw' ? demo ? 'Dienst zurueckgegeben. Demo: kein Versand. Lokaler Benachrichtigungseintrag angelegt.' : 'Dienst zurueckgegeben. Die Benachrichtigung wird serverseitig verarbeitet.' : command.type === 'settings' ? 'Benachrichtigungsadresse gespeichert.' : 'Aenderung gespeichert.');
      return true;
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Aenderung fehlgeschlagen.');
      if (!demo) {
        try { setSnapshot(checkSnapshot(await request<Snapshot>('/api/schedule'))); } catch { setMessage('Aktualisierung nicht moeglich. Bitte erneut laden.'); }
      }
      return false;
    } finally { pending.current = false; setBusy(false); }
  }
  async function invite(member: Member) {
    if (pending.current || !member.email || !window.confirm(`${member.name} an ${member.email} einladen?${demo ? ' Demo: kein Versand.' : ''}`)) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (!demo) await request('/api/invite', { method: 'POST', body: JSON.stringify({ memberId: member.id }) });
      setMessage(demo ? `Demo-Einladung fuer ${member.name}: kein Versand.` : `Einladung fuer ${member.name} angefordert.`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Einladung fehlgeschlagen.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function login(loginEmail: string, password: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await request('/api/login', { method: 'POST', body: JSON.stringify({ email: loginEmail, password }) }); window.location.assign('/'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Anmeldung fehlgeschlagen.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function bootstrap(name: string): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError('');
    try {
      await request('/api/bootstrap', { method: 'POST', body: JSON.stringify({ name }) });
      return true;
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Ersteinrichtung fehlgeschlagen.'); return false; }
    finally { pending.current = false; setBusy(false); }
  }
  async function logout() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await request('/api/logout', { method: 'POST', body: JSON.stringify({}) }); setSnapshot(null); setSession({ configured: true, user: null }); setSelectedId(null); setMessage(''); setTab('calendar'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Abmeldung fehlgeschlagen.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const password = String(values.get('password'));
    if (password.length < 12 || password !== String(values.get('confirm'))) { setError('Mindestens 12 Zeichen verwenden und Passwort identisch bestaetigen.'); return; }
    if (demo) { setMessage('Demo: kein Passwort gespeichert.'); form.reset(); return; }
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await request('/api/password', { method: 'POST', body: JSON.stringify({ password }) }); form.reset(); setMessage('Passwort aktualisiert.'); setPasswordMode(false); window.history.replaceState(null, '', '/'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Passwortaenderung fehlgeschlagen.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function resetDemo() {
    if (!window.confirm('Alle lokalen Demo-Aenderungen und Benachrichtigungen verwerfen?')) return;
    try { localStorage.removeItem(STORAGE_KEY); window.location.assign('/'); } catch { setError('Lokaler Speicher ist nicht verfuegbar.'); }
  }
  function navigate(next: Tab) { setTab(next); setError(''); setMessage(''); setSelectedId(null); setPasswordMode(false); }

  if (loading) return <main className="loading-screen"><span className="brand-mark">BSV</span><h1>BSV Weitnau</h1><p><LoaderCircle size={19} className="spin" />Dienstplanung wird geladen</p></main>;
  if (session?.configured && !session.user) return <Login onLogin={login} onBootstrap={bootstrap} bootstrapAvailable={bootstrapAvailable} bootstrapEmail={bootstrapEmail} busy={busy} error={error} />;
  if (!snapshot) return <main className="loading-screen"><AlertCircle size={32} /><h1>Dienstplanung nicht verfuegbar</h1><p role="alert">{error || 'Keine Planungsdaten vorhanden.'}</p><button className="primary-button" onClick={() => window.location.reload()}><RefreshCw size={17} />Erneut laden</button>{demo && <button className="secondary-button" onClick={resetDemo}>Demo zuruecksetzen</button>}</main>;

  const visible = snapshot.shifts.filter(shift => admin || shift.published);
  const periodShifts = visible.filter(shift => shift.date >= calendarRange.start && shift.date < calendarRange.end);
  const plannedCount = periodShifts.reduce((total, shift) => total + shift.tasks.length, 0);
  const openCount = periodShifts.reduce((total, shift) => total + shift.tasks.filter(task => !task.memberId && taskWindow(shift, task).start > Date.now()).length, 0);
  const myShiftCount = periodShifts.reduce((total, shift) => total + shift.tasks.filter(task => task.memberId === actor.memberId).length, 0);
  const ownTasks = visible.flatMap(shift => shift.tasks.filter(task => task.memberId === actor.memberId).map(task => ({ shift, task, window: taskWindow(shift, task) }))).sort((first, second) => first.window.start - second.window.start);
  const upcoming = ownTasks.filter(item => item.window.end > Date.now());
  const ownFiltered = ownTasks.filter(item => (past || item.window.end > Date.now()) && (!dutyFrom || item.shift.date >= dutyFrom) && (!dutyTo || item.shift.date <= dutyTo) && `${item.shift.title} ${item.task.name} ${item.shift.date} ${germanDate(item.shift.date)}`.toLowerCase().includes(search.toLowerCase()));
  const selected = visible.find(shift => shift.id === selectedId);
  const safeTab = !admin && (tab === 'members' || tab === 'planning') ? 'calendar' : tab;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="BSV Weitnau Dienstplanung"><span className="brand-mark">BSV</span><span><strong>BSV Weitnau</strong><small>Dienstplanung</small></span></a><p className="nav-label">VEREIN</p><nav aria-label="Hauptnavigation">{navigation.filter(item => !item.admin || admin).map(item => <button key={item.id} className={safeTab === item.id ? 'active' : ''} aria-current={safeTab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={20} />{item.name}{item.id === 'duties' && upcoming.length > 0 && <span className="nav-count">{upcoming.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="club-season"><span className="legend-dot green" />Vereinsbetrieb <strong>{localDate().slice(0, 4)}</strong></div><div className="profile"><span className="avatar">{name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><div><strong>{name}</strong><small>{demo ? 'DEMO · ' : ''}{admin ? 'Administration' : 'Mitglied'}</small></div>{!demo && <button className="icon-button" title="Abmelden" aria-label="Abmelden" disabled={busy} onClick={() => void logout()}><LogOut size={18} /></button>}</div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="mobile-brand"><span className="brand-mark small-mark">BSV</span><strong>BSV Weitnau</strong></div><span className="desktop-breadcrumb">BSV Weitnau <span>/</span> {navigation.find(item => item.id === safeTab)?.name}</span><div className="topbar-actions"><span className="access-label"><ShieldCheck size={15} />{demo ? 'Lokale Demo' : 'Persoenlicher Zugang'}</span>{!demo && <><button className="icon-button" title="Daten aktualisieren" aria-label="Daten aktualisieren" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} className={busy ? 'spin' : ''} /></button><button className="icon-button mobile-logout" title="Abmelden" aria-label="Abmelden" disabled={busy} onClick={() => void logout()}><LogOut size={18} /></button></>}</div></header>
    {demo && <div className="demo-banner"><div><FlaskConical size={18} /><span><strong>DEMO</strong> · Fiktive Mitglieder, Speicherung nur in diesem Browser. Kein E-Mail-Versand.</span></div><div className="demo-switch"><label><span className="sr-only">DEMO Rolle</span><select aria-label="DEMO Rolle" value={demoActor.role} onChange={event => { setDemoActor(current => ({ ...current, role: event.target.value })); setSelectedId(null); setTab('calendar'); }}><option value="admin">DEMO Administration</option><option value="member">DEMO Mitglied</option></select></label><label><span className="sr-only">DEMO Mitglied</span><select aria-label="DEMO Mitglied" value={demoActor.memberId} onChange={event => { setDemoActor(current => ({ ...current, memberId: event.target.value })); setSelectedId(null); }}>{snapshot.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className="icon-button" title="Demo zuruecksetzen" aria-label="Demo zuruecksetzen" disabled={busy} onClick={resetDemo}><RefreshCw size={17} /></button></div></div>}
    <main className="main-content" id="main-content"><div className="page-heading"><div><p className="eyebrow">{admin ? 'VEREINSORGANISATION' : 'MEIN VEREIN'}</p><h1>{passwordMode ? 'Passwort festlegen' : navigation.find(item => item.id === safeTab)?.name}</h1></div><span className="today-label">{germanDate(localDate(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
    <div aria-live="polite" className="status-area">{message && <div className="notice green"><Check size={18} /><span>{message}</span><button className="icon-button" title="Meldung schliessen" aria-label="Meldung schliessen" onClick={() => setMessage('')}><X size={15} /></button></div>}{error && <div className="notice error" role="alert"><AlertCircle size={18} /><span>{error}</span><button className="icon-button" title="Fehler schliessen" aria-label="Fehler schliessen" onClick={() => setError('')}><X size={15} /></button></div>}</div>
    {!passwordMode && safeTab === 'calendar' && <><div className="summary-strip"><div><CalendarDays size={21} /><span><strong>{plannedCount}</strong><small>Geplante Dienste</small></span></div><div><Users size={21} /><span><strong>{openCount}</strong><small>Offene Dienste</small></span></div><button onClick={() => navigate('duties')}><ClipboardList size={21} /><span><strong>{myShiftCount}</strong><small>Meine Dienste</small></span><ArrowRight size={17} /></button></div><ScheduleCalendar shifts={visible} memberId={actor.memberId} onSelect={shift => setSelectedId(shift.id)} onRangeChange={setCalendarRange} /><section className="upcoming-section"><div className="section-heading"><h2>Meine naechsten Dienste</h2><button className="text-button" onClick={() => navigate('duties')}>Alle anzeigen <ArrowRight size={16} /></button></div>{upcoming.length ? [...new Map(upcoming.map(item => [item.shift.id, item.shift])).values()].slice(0, 3).map(shift => <ShiftRow key={shift.id} shift={shift} memberId={actor.memberId} onSelect={item => setSelectedId(item.id)} />) : <div className="empty-inline"><ClipboardList size={20} /><span>Aktuell keine eigenen Dienste eingetragen.</span></div>}</section></>}
    {!passwordMode && safeTab === 'duties' && <section><div className="filter-bar duty-filters"><label className="search-field"><Search size={17} /><input aria-label="Meine Dienste suchen" placeholder="Aufgabe, Dienst oder Datum suchen" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Von<input type="date" value={dutyFrom} onChange={event => setDutyFrom(event.target.value)} /></label><label>Bis<input type="date" value={dutyTo} onChange={event => setDutyTo(event.target.value)} /></label><label className="check-label"><input type="checkbox" checked={past} onChange={event => setPast(event.target.checked)} />Vergangene anzeigen</label></div><div className="section-heading"><h2>{ownFiltered.length} {ownFiltered.length === 1 ? 'Aufgabe' : 'Aufgaben'}</h2><button className="text-button" onClick={() => { setSearch(''); setDutyFrom(''); setDutyTo(''); setPast(false); }}>Filter zuruecksetzen</button></div><div className="duty-list">{ownFiltered.map(item => <button className="duty-row" key={item.task.id} onClick={() => setSelectedId(item.shift.id)}><span className="date-block"><strong>{germanDate(item.shift.date, { day: '2-digit' })}</strong><span>{germanDate(item.shift.date, { month: 'short' })}</span></span><span><strong>{item.task.name}</strong><small>{item.shift.title} · {germanDate(item.shift.date, { weekday: 'long' })}</small></span><span className="duty-time"><Clock size={15} />{localTime(new Date(item.window.start).toISOString())} - {localTime(new Date(item.window.end).toISOString())}</span><span className={`badge ${item.window.end <= Date.now() ? 'neutral' : 'green'}`}>{item.window.end <= Date.now() ? 'Vergangen' : 'Eingetragen'}</span><ArrowRight size={17} /></button>)}</div>{!ownFiltered.length && <div className="empty-state"><ClipboardList size={30} /><h3>Keine Dienste gefunden</h3></div>}</section>}
    {!passwordMode && safeTab === 'members' && admin && <MemberDirectory members={snapshot.members} demo={demo} busy={busy} run={run} invite={invite} actionError={error} />}
    {!passwordMode && safeTab === 'planning' && admin && <Planning snapshot={snapshot} actor={actor} busy={busy} run={run} onSelect={shift => setSelectedId(shift.id)} />}
    {(passwordMode || safeTab === 'settings') && <section className="settings-section">{admin && !passwordMode && <><section className="settings-band"><div><Bell size={23} /><h2>Benachrichtigungen</h2><p className="muted">Empfaengeradresse fuer Dienst-Ruecktritte</p></div><form onSubmit={event => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get('email')).trim(); if (!validEmail(value)) { setError('Bitte gueltige Empfaengeradresse angeben.'); return; } void run({ type: 'settings', email: value }); }}><label>E-Mail<input key={email} name="email" type="email" required defaultValue={email} placeholder={demo ? 'demo0@example.invalid' : 'E-Mail-Adresse'} /></label><button className="primary-button" disabled={busy}><Check size={17} />Adresse speichern</button><p className="small muted">{demo ? 'Demo: kein Versand. Die Adresse wird nur lokal gespeichert.' : 'Versand und Warteschlange werden ausschliesslich vom Server verwaltet.'}</p></form></section>{demo && <section className="notification-section"><div className="section-heading"><h2>Lokale Ruecktrittsmeldungen</h2><span className="badge amber">Demo: kein Versand</span></div>{notifications.length ? <div className="notification-list">{notifications.map(item => <article key={item.id}><Mail size={19} /><div><strong>{item.member} · {item.task}</strong><p>{item.shift}</p><small>An: {item.recipient || 'Keine Adresse'} · {new Date(item.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</small></div><span className="badge neutral">{item.status}</span></article>)}</div> : <div className="empty-inline"><Bell size={20} /><span>Noch keine lokalen Ruecktrittsmeldungen.</span></div>}</section>}</>}
    <section className="settings-band"><div><KeyRound size={23} /><h2>{passwordMode ? 'Neues Passwort' : 'Persoenlicher Zugang'}</h2><p className="muted">{name}</p></div><form onSubmit={savePassword}><label>Neues Passwort<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label><label>Passwort bestaetigen<input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></label><button className="primary-button" disabled={busy}><KeyRound size={17} />Passwort speichern</button>{demo && <p className="small muted">Demo: keine echte Passwortaenderung.</p>}</form></section></section>}
    <footer className="page-footer"><span>BSV Weitnau · Interne Dienstplanung</span><span>{demo ? 'DEMO · ' : ''}Stand {snapshot.version} · Europe/Berlin</span></footer></main>
    </div><nav className="mobile-nav" aria-label="Mobile Hauptnavigation">{navigation.filter(item => !item.admin || admin).map(item => <button key={item.id} className={safeTab === item.id ? 'active' : ''} aria-current={safeTab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={20} /><span>{item.id === 'calendar' ? 'Kalender' : item.id === 'duties' ? 'Dienste' : item.id === 'settings' ? 'Konto' : item.name}</span></button>)}</nav>
    {selected && <ShiftDetail key={selected.id} shift={selected} snapshot={snapshot} actor={actor} busy={busy} run={run} close={() => setSelectedId(null)} actionError={error} />}
    </div>;
}