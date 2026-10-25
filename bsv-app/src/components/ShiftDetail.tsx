'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, LockKeyhole, Send, ShieldCheck, UserPlus, X } from 'lucide-react';
import { eligibility, instant, localTime, missingQualification, previewTimes, taskWindow, type Actor, type Command, type Shift, type Snapshot, type TimeUpdate } from '../lib/domain';
import { germanDate } from './ScheduleCalendar';
import { useDialog } from './useDialog';

export default function ShiftDetail({ shift, snapshot, actor, busy, run, close, actionError }: { shift: Shift; snapshot: Snapshot; actor: Actor; busy: boolean; run: (command: Command) => Promise<boolean>; close: () => void; actionError: string }) {
  const dialog = useRef<HTMLElement>(null);
  const [start, setStart] = useState(localTime(shift.start));
  const [end, setEnd] = useState(localTime(shift.end));
  const [preview, setPreview] = useState<{ update: TimeUpdate; conflicts: string[]; version: number } | null>(null);
  const [error, setError] = useState('');
  const admin = actor.role === 'admin';
  const historical = Date.parse(shift.start) <= Date.now();
  const member = snapshot.members.find(item => item.id === actor.memberId);
  useDialog(dialog, true, close);
  function checkTimes() {
    try {
      const update = { id: shift.id, start: instant(shift.date, start), end: instant(shift.date, end) };
      setPreview({ update, conflicts: previewTimes(snapshot, [update], actor), version: snapshot.version }); setError('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Ungueltige Uhrzeit.'); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section ref={dialog} className="modal shift-detail" role="dialog" aria-modal="true" aria-labelledby="shift-detail-title"><header className="modal-heading"><div><p className="eyebrow">{germanDate(shift.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p><h2 id="shift-detail-title">{shift.title}</h2></div><button className="icon-button" onClick={close} title="Schliessen" aria-label="Schliessen"><X size={21} /></button></header><div className="detail-summary"><span><Clock size={17} />{localTime(shift.start)} - {localTime(shift.end)}</span><span className={`badge ${shift.published ? 'green' : 'amber'}`}>{shift.published ? 'Veroeffentlicht' : 'Entwurf'}</span>{historical && <span className="badge neutral"><LockKeyhole size={12} />Historie</span>}</div>
    {actionError && <div className="notice error" role="alert"><AlertTriangle size={17} />{actionError}</div>}
    <div className="task-list">{shift.tasks.map(task => {
      const window = taskWindow(shift, task);
      const owner = snapshot.members.find(item => item.id === task.memberId);
      const mine = task.memberId === actor.memberId;
      const qualificationWarning = admin && owner ? missingQualification(task, owner) : null;
      const reason = member ? eligibility(snapshot, shift, task, member) : 'Mitgliedsprofil nicht verfuegbar.';
      const started = window.start <= Date.now();
      return <article className={`task-item ${mine ? 'is-mine' : ''}`} key={task.id}><div className="task-heading"><h3>{task.name}</h3><span className={`badge ${task.memberId ? 'green' : 'amber'}`}>{task.memberId ? 'Besetzt' : 'Frei'}</span></div><div className="task-meta"><span><Clock size={14} />{localTime(new Date(window.start).toISOString())} - {localTime(new Date(window.end).toISOString())}</span>{task.qualification && <span><ShieldCheck size={14} />{task.qualification}</span>}</div><p className="task-owner">{owner?.name ?? (task.memberId ? 'Mitglied' : 'Noch nicht besetzt')}{mine && <span className="badge neutral">Mein Dienst</span>}</p>{qualificationWarning && <div className="notice amber qualification-warning" role="status"><AlertTriangle size={15} /><span><strong>Qualifikation prüfen:</strong> {owner?.name} hat „{qualificationWarning}“ nicht hinterlegt. Bitte kurz prüfen; die Zuweisung bleibt gültig.</span></div>}{admin && <label className="assignment-label">Zuweisung<select aria-label={`${task.name} zuweisen`} value={task.memberId ?? ''} disabled={busy || started} onChange={event => void run({ type: 'assign', taskId: task.id, memberId: event.target.value || null })}><option value="">Unbesetzt</option>{snapshot.members.map(candidate => { const unavailable = eligibility(snapshot, shift, task, candidate); return <option key={candidate.id} value={candidate.id} disabled={!!unavailable && candidate.id !== task.memberId}>{candidate.name}{unavailable ? ` · ${unavailable}` : ''}</option>; })}</select></label>}{mine ? <button className="danger-button" disabled={busy || started || !shift.published} onClick={() => { if (globalThis.confirm(`${task.name} am ${germanDate(shift.date)} zurueckgeben?`)) void run({ type: 'withdraw', taskId: task.id }); }}>Dienst zurueckgeben</button> : !task.memberId && <><button className="secondary-button" disabled={busy || !!reason || !shift.published} onClick={() => void run({ type: 'signup', taskId: task.id })}><UserPlus size={16} />Dienst uebernehmen</button>{reason && <p className="muted small">{reason}</p>}</>}</article>;
    })}</div>
    {admin && <section className="individual-time-editor"><h3>Dienstzeiten bearbeiten</h3>{historical ? <p className="muted"><LockKeyhole size={15} />Historische Zeiten bleiben unveraendert.</p> : <><div className="inline-time-form"><label>Beginn<input type="time" value={start} onChange={event => { setStart(event.target.value); setPreview(null); }} /></label><label>Ende<input type="time" value={end} onChange={event => { setEnd(event.target.value); setPreview(null); }} /></label><button className="secondary-button" onClick={checkTimes}>Pruefen</button></div>{error && <p className="error-text" role="alert">{error}</p>}{preview && <div className="inline-preview">{preview.conflicts.length ? preview.conflicts.map(conflict => <p role="alert" className="error-text" key={conflict}><AlertTriangle size={16} />{conflict}</p>) : <p>{localTime(shift.start)} - {localTime(shift.end)} → {start} - {end} · Keine lokalen Konflikte</p>}{preview.version !== snapshot.version && <p className="error-text">Daten geaendert. Bitte erneut pruefen.</p>}<button className="primary-button" disabled={busy || !!preview.conflicts.length || preview.version !== snapshot.version} onClick={() => void run({ type: 'updateTimes', updates: [preview.update] }).then(success => { if (success) setPreview(null); })}><Check size={16} />Zeiten speichern</button></div>}</>}{!shift.published && !historical && <button className="secondary-button" disabled={busy} onClick={() => void run({ type: 'publish', ids: [shift.id] })}><Send size={16} />Dienst veroeffentlichen</button>}</section>}
    </section></div>;
}