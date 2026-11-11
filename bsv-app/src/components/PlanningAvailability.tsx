'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { availabilityCounts, isAvailable, localDate, type Snapshot } from '../lib/domain';
import { germanDate } from './ScheduleCalendar';

export default function PlanningAvailability({ snapshot,month }: { snapshot:Snapshot; month:string }) {
  const [conflictsOnly,setConflictsOnly] = useState(false);
  const dates = [...new Set(snapshot.shifts.filter(shift => !shift.cancellation && shift.date.startsWith(month) && shift.date >= localDate()).map(shift => shift.date))].sort();
  return <section className="planning-availability">
    <div className="section-heading"><h4>Verfuegbarkeit je Tag</h4><label className="check-label"><input type="checkbox" checked={conflictsOnly} onChange={event => setConflictsOnly(event.target.checked)} />Nur Konflikte</label></div>
    {dates.map(date => {
      const counts = availabilityCounts(snapshot,date);
      const conflicts = snapshot.shifts.filter(shift => shift.date === date && !shift.cancellation).flatMap(shift => shift.tasks
        .filter(task => task.memberId && !isAvailable(snapshot,task.memberId,date))
        .map(task => ({ shift,task,member:snapshot.members.find(member => member.id === task.memberId) })));
      if (conflictsOnly && !conflicts.length) return null;
      return <div className="planning-availability-day" key={date}><strong>{germanDate(date)}</strong><span>{counts.available} von {counts.total} verfuegbar</span>
        {!!conflicts.length && <div className="availability-conflict"><AlertTriangle size={16} />{conflicts.map(item => <p key={item.task.id}>{item.member?.name ?? 'Mitglied'} · {item.shift.title} · {item.task.name}: nicht verfuegbar</p>)}</div>}
      </div>;
    })}
    <a className="text-button" href="/verfuegbarkeit">Meldungen verwalten</a>
  </section>;
}