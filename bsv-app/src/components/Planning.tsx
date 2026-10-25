'use client';

import { useState } from 'react';
import { AlertTriangle, BarChart3, Check, CheckSquare, Eye, EyeOff, Plus, Send, Users, Wand2 } from 'lucide-react';
import { generateShifts, instant, KIND_LABELS, localDate, localTime, makeShift, missingQualification, nextDate, OPTIONAL_TASK_NAMES, previewTimes, QUALIFICATION_NAMES, TASK_NAMES, type Actor, type Command, type Shift, type Snapshot, type TimeUpdate } from '../lib/domain';
import { germanDate } from './ScheduleCalendar';
import MonthlyWorkflow from './MonthlyWorkflow';
import AssignmentReport from './AssignmentReport';

type Props = { snapshot: Snapshot; actor: Actor; busy: boolean; run: (command: Command) => Promise<boolean>; onSelect: (shift: Shift) => void };
type Preview = { command: Command; shifts: Shift[]; updates: TimeUpdate[]; conflicts: string[]; version: number };
const defaultTimes: Record<string, { start: string; end: string }> = { friday: { start: '18:00', end: '22:00' }, early: { start: '09:30', end: '14:00' }, late: { start: '14:00', end: '18:30' }, extra: { start: '16:00', end: '19:00' } };

export default function Planning({ snapshot, actor, busy, run, onSelect }: Props) {
  const today = localDate();
  const [panel, setPanel] = useState<'generate' | 'extra' | 'times' | 'month' | 'report'>('month');
  const [from, setFrom] = useState(nextDate(today));
  const [to, setTo] = useState(nextDate(today, 30));
  const [friday, setFriday] = useState<string[]>([]);
  const [includeLift, setIncludeLift] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showHelpers, setShowHelpers] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [kind, setKind] = useState('all');
  const [weekday, setWeekday] = useState('all');
  const [scope, setScope] = useState('selection');
  const [times, setTimes] = useState(defaultTimes);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [extraTasks, setExtraTasks] = useState<string[]>(TASK_NAMES);
  const [customTask, setCustomTask] = useState('');
  const matches = snapshot.shifts.filter(shift => shift.date.startsWith(month) && (kind === 'all' || shift.kind === kind) && (weekday === 'all' || new Date(`${shift.date}T12:00:00Z`).getUTCDay() === Number(weekday))).sort((first, second) => first.start.localeCompare(second.start));
  const future = matches.filter(shift => Date.parse(shift.start) > Date.now());
  const target = scope === 'month' ? future : snapshot.shifts.filter(shift => selected.includes(shift.id) && Date.parse(shift.start) > Date.now());
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); setPreview(null); }
  function prepareGenerate() {
    setError('');
    try {
      const all = generateShifts(from, to, friday, {}, includeLift);
      const shifts = all.filter(shift => Date.parse(shift.start) > Date.now() && !snapshot.shifts.some(existing => existing.id === shift.id));
      if (!shifts.length) throw new Error('Keine neuen zukuenftigen Dienste im Zeitraum. Bestehende Dienste bleiben unveraendert.');
      setPreview({ command: { type: 'generate', shifts }, shifts, updates: [], conflicts: [], version: snapshot.version });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Generierung fehlgeschlagen.'); setPreview(null); }
  }
  function prepareExtra(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const data = new FormData(event.currentTarget);
      const names = [...extraTasks, ...customTask.split(',').map(value => value.trim()).filter(Boolean)];
      if (!names.length) throw new Error('Bitte mindestens eine Aufgabe waehlen.');
      const shift = makeShift(String(data.get('date')), 'extra', String(data.get('start')), String(data.get('end')), [...new Set(names)], String(data.get('title')).trim(), crypto.randomUUID());
      if (data.get('first120') === 'on') shift.tasks = shift.tasks.map(task => task.name === 'Bügel/Liftaufsicht' ? { ...task, durationMinutes: 120 } : task);
      if (Date.parse(shift.start) <= Date.now()) throw new Error('Zusatzdienste muessen in der Zukunft liegen.');
      const invalid = shift.tasks.find(task => task.durationMinutes !== null && task.durationMinutes * 60000 > Date.parse(shift.end) - Date.parse(shift.start));
      if (Date.parse(shift.end) <= Date.parse(shift.start) || invalid) throw new Error('Zeiten oder Aufgabendauer ungueltig.');
      setPreview({ command: { type: 'create', shift }, shifts: [shift], updates: [], conflicts: [], version: snapshot.version });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Zusatzdienst ungueltig.'); setPreview(null); }
  }
  function prepareTimes() {
    setError('');
    try {
      if (!target.length) throw new Error('Bitte zukuenftige Dienste auswaehlen.');
      const updates = target.map(shift => ({ id: shift.id, start: instant(shift.date, (times[shift.kind] ?? times.extra).start), end: instant(shift.date, (times[shift.kind] ?? times.extra).end) }));
      setPreview({ command: { type: 'updateTimes', updates }, shifts: target, updates, conflicts: previewTimes(snapshot, updates, actor), version: snapshot.version });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Zeiten ungueltig.'); setPreview(null); }
  }
  async function commit() { if (preview && preview.version === snapshot.version && !preview.conflicts.length && await run(preview.command)) { setPreview(null); setSelected([]); } }
  return <section>
    <div className="section-heading"><div><h2>Planung</h2><p>{snapshot.shifts.filter(shift => !shift.published && Date.parse(shift.start) > Date.now()).length} zukuenftige Entwuerfe · {selected.length} ausgewaehlt</p></div></div>
    <div className="planning-tabs" role="tablist" aria-label="Planungswerkzeuge">{([{ id: 'month', name: 'Monatsübersicht', icon: Users }, { id: 'generate', name: 'Zeitraum erzeugen', icon: Wand2 }, { id: 'extra', name: 'Zusatzdienst', icon: Plus }, { id: 'times', name: 'Zeiten bearbeiten', icon: CheckSquare }, { id: 'report', name: 'Auswertung', icon: BarChart3 }] as const).map(item => <button key={item.id} role="tab" aria-selected={panel === item.id} onClick={() => { setPanel(item.id); setPreview(null); setError(''); }}><item.icon size={17} />{item.name}</button>)}</div>
    {panel === 'report' && <AssignmentReport snapshot={snapshot} />}
    {panel !== 'report' && <div className={`planning-workspace ${panel === 'month' ? 'monthly-view' : ''}`}>
      {panel === 'month' && <MonthlyWorkflow month={month} snapshot={snapshot} busy={busy} run={run} />}
      {panel === 'generate' && <div className="planning-form"><h3>Freitag und Wochenende</h3><div className="form-grid"><label>Von<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPreview(null); }} /></label><label>Bis<input type="date" value={to} onChange={event => { setTo(event.target.value); setPreview(null); }} /></label></div><div className="template-lines"><div><strong>Freitag</strong><span>18:00 - 22:00</span></div><div><strong>Samstag / Sonntag · Frühdienst</strong><span>09:30 - 14:00</span></div><div><strong>Samstag / Sonntag · Spätdienst</strong><span>14:00 - 18:30</span></div></div><fieldset><legend>Freitagsaufgaben <span className="badge amber">Auswahl erforderlich</span></legend>{TASK_NAMES.map(name => <label key={name} className="check-label"><input type="checkbox" checked={friday.includes(name)} onChange={event => { setFriday(current => event.target.checked ? [...current, name] : current.filter(item => item !== name)); setPreview(null); }} />{name}</label>)}</fieldset><fieldset><legend>Optionale Wochenendaufgabe</legend>{OPTIONAL_TASK_NAMES.map(name => <label key={name} className="check-label"><input type="checkbox" checked={includeLift} onChange={event => { setIncludeLift(event.target.checked); setPreview(null); }} />{name}</label>)}</fieldset><details className="requirements"><summary>Qualifikationen der Standardaufgaben</summary><div className="template-lines">{QUALIFICATION_NAMES.map(name => <div key={name}><strong>{name}</strong><span>Qualifikation: {name}</span></div>)}</div></details><p className="muted small">Qualifikationsabweichungen blockieren keine Anmeldung. Sie werden im Planungsbereich gelb zur Prüfung markiert.</p><button className="primary-button" onClick={prepareGenerate}><Eye size={17} />Vorschau erstellen</button></div>}
      {panel === 'extra' && <form className="planning-form" onSubmit={prepareExtra} onChange={() => setPreview(null)}><h3>Individueller Zusatzdienst</h3><div className="form-grid"><label className="span-all">Titel<input name="title" required defaultValue="Zusatzdienst" /></label><label className="span-all">Datum<input name="date" required type="date" min={today} defaultValue={nextDate(today)} /></label><label>Beginn<input name="start" required type="time" defaultValue="16:00" /></label><label>Ende<input name="end" required type="time" defaultValue="19:00" /></label></div><fieldset><legend>Aufgaben</legend>{[...TASK_NAMES, ...OPTIONAL_TASK_NAMES].map(name => <label className="check-label" key={name}><input type="checkbox" checked={extraTasks.includes(name)} onChange={event => setExtraTasks(current => event.target.checked ? [...current, name] : current.filter(item => item !== name))} />{name}</label>)}<label className="check-label"><input type="checkbox" name="first120" disabled={!extraTasks.includes('Bügel/Liftaufsicht')} />Bügel/Liftaufsicht nur erste 120 Minuten</label></fieldset><label>Weitere Aufgaben, kommagetrennt<input value={customTask} onChange={event => setCustomTask(event.target.value)} placeholder="Materialausgabe" /></label><button className="primary-button"><Eye size={17} />Vorschau erstellen</button></form>}
      {panel === 'times' && <div className="planning-form"><h3>Zeitenaenderung</h3><div className="segmented scope-control"><button aria-pressed={scope === 'selection'} onClick={() => { setScope('selection'); setPreview(null); }}>Auswahl ({selected.length})</button><button aria-pressed={scope === 'month'} onClick={() => { setScope('month'); setPreview(null); }}>Monatsfilter ({future.length})</button></div><p className="muted small">Datum und Besetzung bleiben erhalten. Alle Aenderungen werden gemeinsam geprueft. Vergangene Dienste sind schreibgeschuetzt.</p><div className="time-rules">{Object.keys(defaultTimes).map(key => <div className="time-rule" key={key}><strong>{KIND_LABELS[key]}</strong><label><span className="sr-only">{KIND_LABELS[key]} Beginn</span><input type="time" value={times[key].start} onChange={event => { setTimes(current => ({ ...current, [key]: { ...current[key], start: event.target.value } })); setPreview(null); }} /></label><span>-</span><label><span className="sr-only">{KIND_LABELS[key]} Ende</span><input type="time" value={times[key].end} onChange={event => { setTimes(current => ({ ...current, [key]: { ...current[key], end: event.target.value } })); setPreview(null); }} /></label></div>)}</div><button className="primary-button" onClick={prepareTimes}><Eye size={17} />{target.length} Dienste pruefen</button></div>}
      <div className="planning-roster"><div className="roster-heading"><h3>Dienste im Monat</h3><div className="roster-actions"><button className="text-button" aria-pressed={showHelpers} onClick={() => setShowHelpers(value => !value)}>{showHelpers ? <EyeOff size={16} /> : <Eye size={16} />}{showHelpers ? 'Helfer ausblenden' : 'Helfer einblenden'}</button><button className="text-button" onClick={() => { setSelected(current => future.every(shift => current.includes(shift.id)) ? current.filter(id => !future.some(shift => current.includes(id))) : [...new Set([...current, ...future.map(shift => shift.id)])]); setPreview(null); }}>{future.length && future.every(shift => selected.includes(shift.id)) ? 'Auswahl aufheben' : 'Alle markieren'}</button></div></div>
      <div className="roster-list">{matches.map(shift => { const historical = Date.parse(shift.start) <= Date.now(); const qualificationIssues = historical ? [] : shift.tasks.flatMap(task => { const assigned = snapshot.members.find(member => member.id === task.memberId); const missing = assigned ? missingQualification(task, assigned) : null; return assigned && missing && Date.parse(shift.start) > Date.now() ? [{ task, assigned, missing }] : []; }); return <div className="roster-entry" key={shift.id}><div className={`roster-row ${historical ? 'historical' : ''}`}><input type="checkbox" aria-label={`${shift.date} ${shift.title} auswaehlen`} checked={selected.includes(shift.id)} disabled={historical} onChange={() => toggle(shift.id)} /><button onClick={() => onSelect(shift)}><strong>{germanDate(shift.date)} · {shift.title}</strong><span>{localTime(shift.start)} - {localTime(shift.end)}</span></button>{qualificationIssues.length > 0 && <span className="badge qualification-review-badge" title={qualificationIssues.map(issue => `${issue.assigned.name}: ${issue.missing}`).join('; ')}><AlertTriangle size={13} />{qualificationIssues.length} Qualifikation prüfen</span>}<span className={`badge ${historical ? 'neutral' : shift.published ? 'green' : 'amber'}`}>{historical ? 'Historie' : shift.published ? 'Publiziert' : 'Entwurf'}</span></div>{showHelpers && <div className="roster-helpers">{shift.tasks.filter(task => task.memberId).length ? shift.tasks.filter(task => task.memberId).map(task => { const assigned = snapshot.members.find(member => member.id === task.memberId); const missing = assigned ? missingQualification(task, assigned) : null; return <span className={missing ? 'qualification-helper-warning' : ''} key={task.id}><strong>{task.name}</strong><span>{assigned?.name ?? 'Mitglied nicht gefunden'}</span>{missing && <small>Qualifikation prüfen: {missing} fehlt</small>}</span>; }) : <span className="muted">Noch keine Helfer eingetragen</span>}</div>}</div>; })}{!matches.length && <p className="empty-state">Keine Dienste im Filter.</p>}</div>
      <div className="roster-footer"><span className="muted small">{matches.length} Dienste · {matches.length - future.length} historisch</span><button className="secondary-button" disabled={busy || !selected.some(id => snapshot.shifts.some(shift => shift.id === id && !shift.published && Date.parse(shift.start) > Date.now()))} onClick={() => { const ids = selected.filter(id => snapshot.shifts.some(shift => shift.id === id && !shift.published && Date.parse(shift.start) > Date.now())); if (window.confirm(`${ids.length} Dienste veroeffentlichen?`)) void run({ type: 'publish', ids }).then(success => { if (success) setSelected([]); }); }}><Send size={16} />Veroeffentlichen</button></div></div>
    </div>}
    {error && <div className="notice error" role="alert"><AlertTriangle size={18} />{error}</div>}
    {preview && <section className="preview-section"><div className="section-heading"><div><p className="eyebrow">VORSCHAU</p><h3>{preview.shifts.length} {preview.command.type === 'updateTimes' ? 'Zeitenaenderungen' : 'neue Dienste'}</h3></div><button className="text-button" onClick={() => setPreview(null)}>Verwerfen</button></div>{preview.conflicts.map(conflict => <div className="notice error" role="alert" key={conflict}><AlertTriangle size={18} />{conflict}</div>)}{preview.version !== snapshot.version && <div className="notice amber">Daten wurden geaendert. Bitte Vorschau erneut erstellen.</div>}<div className="preview-list">{preview.shifts.map(shift => { const update = preview.updates.find(item => item.id === shift.id); return <div key={shift.id}><strong>{germanDate(shift.date)} · {shift.title}</strong><span>{localTime(shift.start)} - {localTime(shift.end)}{update && <> → <b>{localTime(update.start)} - {localTime(update.end)}</b></>}</span><small>{shift.tasks.length} Aufgaben{shift.tasks.some(task => task.durationMinutes === 120) ? ' · Liftaufsicht 120 Min.' : ''}</small></div>; })}</div><footer className="form-actions"><span className="muted">{preview.conflicts.length ? 'Aenderung blockiert' : 'Keine lokalen Zeitkonflikte'}</span><button className="primary-button" disabled={busy || !!preview.conflicts.length || preview.version !== snapshot.version} onClick={() => void commit()}><Check size={17} />{preview.command.type === 'updateTimes' ? 'Zeiten uebernehmen' : 'Als Entwurf anlegen'}</button></footer></section>}
  </section>;
}