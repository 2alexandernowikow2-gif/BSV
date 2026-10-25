'use client';

import { useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import deLocale from '@fullcalendar/core/locales/de';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Users } from 'lucide-react';
import { localDate, localTime, nextDate, ZONE, type Shift } from '../lib/domain';

export function germanDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: 'short' }): string {
  return new Intl.DateTimeFormat('de-DE', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
export function ShiftRow({ shift, onSelect, memberId }: { shift: Shift; onSelect: (shift: Shift) => void; memberId?: string }) {
  const occupied = shift.tasks.filter(task => task.memberId).length;
  const mine = shift.tasks.some(task => task.memberId === memberId);
  const weekend = [0, 6].includes(new Date(`${shift.date}T12:00:00Z`).getUTCDay());
  const weekday = germanDate(shift.date, { weekday: 'long' });
  return <button className={`shift-row ${mine ? 'is-mine' : ''}`} onClick={() => onSelect(shift)}>
    <span className="date-block"><strong>{germanDate(shift.date, { day: '2-digit' })}</strong><span>{germanDate(shift.date, { month: 'short' })}</span></span>
    <span className="shift-row-main"><strong>{weekend ? weekday : shift.title}</strong><span><Clock size={14} />{localTime(shift.start)} - {localTime(shift.end)}<span className="weekday">{weekend ? shift.title : weekday}</span></span></span>
    <span className="shift-row-status"><span className={`badge ${!shift.published ? 'neutral' : occupied < shift.tasks.length ? 'amber' : 'green'}`}>{!shift.published ? 'Entwurf' : `${shift.tasks.length - occupied} frei`}</span>{mine && <small>Mein Dienst</small>}</span>
    <ChevronRight size={18} />
  </button>;
}

export default function ScheduleCalendar({ shifts, memberId, onSelect, onRangeChange }: { shifts: Shift[]; memberId: string; onSelect: (shift: Shift) => void; onRangeChange: (range: { start: string; end: string }) => void }) {
  const calendar = useRef<FullCalendar>(null);
  const [view, setView] = useState<'timeGridWeek' | 'dayGridMonth'>('timeGridWeek');
  const [title, setTitle] = useState('Dienstkalender');
  const [range, setRange] = useState(() => {
    const today = localDate();
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    const start = nextDate(today, -((day + 6) % 7));
    return { start, end: nextDate(start, 7) };
  });
  const agenda = shifts.filter(shift => shift.date >= range.start && shift.date < range.end).sort((first, second) => first.start.localeCompare(second.start));
  function changeView(next: typeof view) { setView(next); calendar.current?.getApi().changeView(next); }
  return <section aria-label="Dienstkalender" className="calendar-section">
    <div className="calendar-toolbar">
      <div className="calendar-navigation"><button className="icon-button" title="Vorheriger Zeitraum" aria-label="Vorheriger Zeitraum" onClick={() => calendar.current?.getApi().prev()}><ChevronLeft size={19} /></button><button className="icon-button" title="Naechster Zeitraum" aria-label="Naechster Zeitraum" onClick={() => calendar.current?.getApi().next()}><ChevronRight size={19} /></button><button className="text-button" onClick={() => calendar.current?.getApi().today()}>Heute</button></div>
      <h2>{title}</h2>
      <div className="segmented" aria-label="Kalenderansicht"><button aria-pressed={view === 'timeGridWeek'} onClick={() => changeView('timeGridWeek')}>Woche</button><button aria-pressed={view === 'dayGridMonth'} onClick={() => changeView('dayGridMonth')}>Monat</button></div>
    </div>
    <div className="calendar-legend"><span><i className="legend-dot green" />Besetzt</span><span><i className="legend-dot amber" />Offene Aufgaben</span><span><i className="legend-dot neutral" />Entwurf</span><span className="timezone">Europe/Berlin</span></div>
    <div className="desktop-calendar"><FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} locale={deLocale} initialView="timeGridWeek" initialDate={localDate()} headerToolbar={false} firstDay={1} allDaySlot={false} slotMinTime="08:00:00" slotMaxTime="23:00:00" slotDuration="01:00:00" height="auto" nowIndicator now={() => formatInTimeZone(new Date(), ZONE, "yyyy-MM-dd'T'HH:mm:ss")} dayMaxEvents={3} displayEventEnd eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      datesSet={info => {
        setTitle(info.view.title);
        const nextRange = { start: info.view.type === 'dayGridMonth' ? format(info.view.currentStart, 'yyyy-MM-dd') : info.startStr.slice(0, 10), end: info.view.type === 'dayGridMonth' ? format(info.view.currentEnd, 'yyyy-MM-dd') : info.endStr.slice(0, 10) };
        setRange(nextRange);
        onRangeChange(nextRange);
      }}
      events={shifts.map(shift => {
        const free = shift.tasks.filter(task => !task.memberId).length;
        return { id: shift.id, title: shift.title, start: formatInTimeZone(shift.start, ZONE, "yyyy-MM-dd'T'HH:mm:ss"), end: formatInTimeZone(shift.end, ZONE, "yyyy-MM-dd'T'HH:mm:ss"), classNames: [!shift.published ? 'event-draft' : free ? 'event-open' : 'event-full', shift.tasks.some(task => task.memberId === memberId) ? 'event-mine' : ''], extendedProps: { shift, free } };
      })}
      eventClick={info => onSelect(info.event.extendedProps.shift as Shift)}
      eventDidMount={info => { info.el.setAttribute('tabindex', '0'); info.el.setAttribute('role', 'button'); info.el.setAttribute('aria-label', `${info.event.title}, ${info.event.extendedProps.free} freie Aufgaben`); info.el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(info.event.extendedProps.shift as Shift); } }); }}
      eventContent={info => <div className="calendar-event"><strong>{info.event.title}</strong><span>{info.timeText}</span><small><Users size={12} />{info.event.extendedProps.free} frei{!(info.event.extendedProps.shift as Shift).published ? ' · Entwurf' : ''}</small></div>}
    /></div>
    <div className="mobile-agenda">{agenda.length ? agenda.map(shift => <ShiftRow key={shift.id} shift={shift} memberId={memberId} onSelect={onSelect} />) : <div className="empty-state"><CalendarDays size={30} /><h3>Keine Dienste im Zeitraum</h3></div>}</div>
  </section>;
}