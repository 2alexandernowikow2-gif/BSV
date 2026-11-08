'use client';

import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Check, LockKeyhole, RotateCcw, Send, Sparkles } from 'lucide-react';
import { missingQualification, suggestMonthlyAssignments, taskWindow, type Command, type PlanningPhase, type Snapshot } from '../lib/domain';

type Props = { month: string; snapshot: Snapshot; busy: boolean; run: (command: Command) => Promise<boolean> };

export default function MonthlyWorkflow({ month, snapshot, busy, run }: Props) {
  const monthShifts = snapshot.shifts.filter(shift => shift.date.startsWith(month));
  const shifts = monthShifts.filter(shift => !shift.cancellation);
  const futureShifts = shifts.filter(shift => Date.parse(shift.start) > Date.now());
  const phase: PlanningPhase = snapshot.planningPeriods?.[month] ?? (monthShifts.some(shift => shift.published) ? 'open' : 'draft');
  const taskCount = shifts.reduce((total, shift) => total + shift.tasks.length, 0);
  const assignedCount = shifts.reduce((total, shift) => total + shift.tasks.filter(task => task.memberId).length, 0);
  const openTaskCount = futureShifts.reduce((total, shift) => total + shift.tasks.filter(task => !task.memberId).length, 0);
  const suggestions = useMemo(() => suggestMonthlyAssignments(snapshot, month), [snapshot, month]);
  const qualificationIssues = futureShifts.flatMap(shift => shift.tasks.flatMap(task => {
    const assigned = snapshot.members.find(member => member.id === task.memberId);
    const missing = assigned ? missingQualification(task, assigned) : null;
    return assigned && missing && taskWindow(shift, task).start > Date.now() ? [{ shift, task, member: assigned, qualification: missing }] : [];
  }));
  const registrationIds = futureShifts.filter(shift => !shift.published).map(shift => shift.id);
  const phaseLabels: Record<PlanningPhase, string> = { draft: 'Entwurf', open: 'Anmeldung offen', closed: 'Abgeschlossen' };

  return <div className="planning-form monthly-workflow">
    <h3>Monatsablauf</h3>
    <div className={`monthly-phase ${phase}`}><span className="legend-dot" /><strong>{phaseLabels[phase]}</strong><span>{new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00Z`))}</span></div>
    <div className="monthly-progress" aria-label="Monatsfortschritt">
      <div><strong>{shifts.length}</strong><span>Termine</span></div>
      <div><strong>{assignedCount} / {taskCount}</strong><span>Aufgaben besetzt</span></div>
      <div><strong>{openTaskCount}</strong><span>Offene Aufgaben</span></div>
      <div className={qualificationIssues.length ? 'needs-review' : ''}><strong>{qualificationIssues.length}</strong><span>Qualifikation prüfen</span></div>
    </div>
    {!!qualificationIssues.length && <details className="qualification-review"><summary><AlertTriangle size={15} /><strong>Qualifikation prüfen · {qualificationIssues.length} unverbindliche Hinweise</strong><span className="qualification-toggle"><span className="when-closed">Details anzeigen</span><span className="when-open">Details ausblenden</span></span></summary><div className="qualification-review-list">{qualificationIssues.map(({ shift, task, member, qualification }) => <p key={task.id}>{shift.date.slice(8, 10)}. · {shift.title} · {task.name}: {member.name} hat „{qualification}“ nicht hinterlegt.</p>)}</div></details>}
    {phase === 'draft' && <div className="monthly-step"><strong>1. Plan vorbereiten</strong><p>Zeiten prüfen und den Entwurf freigeben. Mitglieder können sich danach selbst eintragen.</p><button className="primary-button" disabled={busy || !registrationIds.length} onClick={() => void run({ type: 'publish', ids: registrationIds })}><Send size={16} />Anmeldung für {registrationIds.length} Dienste öffnen</button></div>}
    {phase === 'open' && <div className="monthly-step"><strong>2. Anmeldungen ausgleichen</strong><p>Vorschläge bevorzugen passende Qualifikationen und berücksichtigen Zeitkonflikte sowie die bisherige Verteilung der Saison. Abweichungen bleiben unverbindlich.</p><div className="monthly-suggestions">{suggestions.slice(0, 8).map(suggestion => <div className={`monthly-suggestion ${suggestion.missingQualification ? 'needs-review' : ''}`} key={suggestion.taskId}><span><strong>{suggestion.memberName}</strong><small>{suggestion.date.slice(8, 10)}. · {suggestion.shiftTitle} · {suggestion.taskName}</small>{suggestion.missingQualification && <small className="qualification-hint">Qualifikation prüfen: {suggestion.missingQualification} fehlt</small>}</span><button className="icon-button" title={`Vorschlag für ${suggestion.memberName} übernehmen`} aria-label={`Vorschlag für ${suggestion.memberName} übernehmen`} disabled={busy} onClick={() => void run({ type: 'assign', taskId: suggestion.taskId, memberId: suggestion.memberId })}><Check size={17} /></button></div>)}</div>{suggestions.length > 8 && <p className="small muted">Weitere Vorschläge erscheinen nach der Übernahme der nächsten Zuweisung.</p>}{!suggestions.length && <p className="small muted">Für offene Aufgaben gibt es aktuell keine konfliktfreien, saisonpassenden Vorschläge.</p>}</div>}
    {phase === 'closed' && <div className="monthly-step"><strong>3. Monat abgeschlossen</strong><p>Der Monat ist schreibgeschützt. Mitglieder können sich nicht mehr ein- oder austragen.</p></div>}
    {phase === 'open' && <button className="secondary-button monthly-close" disabled={busy || !monthShifts.length || futureShifts.some(shift => !shift.published || shift.tasks.some(task => !task.memberId))} onClick={() => void run({ type: 'monthPhase', month, phase: 'closed' })}><LockKeyhole size={16} />Monat abschließen</button>}
    {phase === 'closed' && <button className="secondary-button monthly-close" disabled={busy} onClick={() => void run({ type: 'monthPhase', month, phase: 'open' })}><RotateCcw size={16} />Anmeldung wieder öffnen</button>}
    {phase === 'open' && assignedCount < taskCount && <p className="small muted monthly-note"><ArrowRight size={14} /> Abschließen wird möglich, sobald alle zukünftigen Aufgaben besetzt sind.</p>}
    {phase === 'open' && assignedCount === taskCount && <p className="small muted monthly-note"><Sparkles size={14} />Alle Aufgaben sind besetzt und der Monat kann abgeschlossen werden.</p>}
  </div>;
}
