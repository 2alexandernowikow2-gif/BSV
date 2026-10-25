'use client';

import { useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Users } from 'lucide-react';
import { assignmentReport, reportMonths, type MemberStatus, type Snapshot } from '../lib/domain';

type Props = { snapshot: Snapshot };

const seasonLabel: Record<MemberStatus, string> = {
  winter: 'Winter',
  summer: 'Sommer',
  both: 'Winter + Sommer',
  inactive: 'Inaktiv'
};

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${month}-01T12:00:00Z`));
}

export default function AssignmentReport({ snapshot }: Props) {
  const [monthCount, setMonthCount] = useState(3);
  const months = useMemo(() => reportMonths(monthCount), [monthCount]);
  const rows = useMemo(() => assignmentReport(snapshot, months), [snapshot, months]);
  const assignmentTotal = rows.reduce((total, row) => total + row.total, 0);
  const activeMembers = rows.filter(row => row.total > 0).length;

  return <section className="assignment-report" aria-labelledby="assignment-report-title">
    <div className="report-heading">
      <div>
        <h3 id="assignment-report-title"><BarChart3 size={19} /> Besetzte Aufgaben je Mitarbeiter</h3>
        <p className="muted">Jede besetzte Aufgabe zählt einzeln. Die Übernahme kann selbstständig oder durch den Admin erfolgt sein.</p>
      </div>
      <label className="report-period"><CalendarRange size={17} /><span>Zeitraum</span><select aria-label="Auswertungszeitraum in Monaten" value={monthCount} onChange={event => setMonthCount(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map(count => <option value={count} key={count}>{count} {count === 1 ? 'Monat' : 'Monate'}</option>)}</select></label>
    </div>
    <div className="report-summary" aria-live="polite">
      <div><strong>{assignmentTotal}</strong><span>Besetzte Einzelaufgaben</span></div>
      <div><strong>{activeMembers}</strong><span>Mitarbeiter mit Einteilung</span></div>
      <div><strong>{months.length ? (assignmentTotal / months.length).toFixed(1).replace('.', ',') : '0'}</strong><span>Aufgaben je Monat</span></div>
      <span className="report-range">{monthLabel(months[0])} – {monthLabel(months[months.length - 1])}</span>
    </div>
    <div className="report-table-scroll">
      <table className="assignment-table">
        <thead><tr><th scope="col">Mitarbeiter</th><th scope="col">Saison</th><th scope="col" className="number-cell">Aufgaben</th>{months.map(month => <th scope="col" className="number-cell" key={month}>{monthLabel(month)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.member.id}>
          <th scope="row">{row.member.name}</th>
          <td><span className={`badge member-status ${row.member.status}`}>{seasonLabel[row.member.status]}</span></td>
          <td className="number-cell total-cell">{row.total}</td>
          {months.map(month => <td className="number-cell" key={month}>{row.monthly[month]}</td>)}
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="empty-inline"><Users size={18} />Keine Mitglieder vorhanden.</div>}
    </div>
    <p className="report-footnote muted">Auch inzwischen inaktive Mitglieder erscheinen, wenn sie im Zeitraum besetzte Aufgaben hatten. Offene Aufgaben werden nicht mitgezählt.</p>
  </section>;
}
