'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { dayMembers, serviceDatesInRange, type AvailabilityData } from '../lib/availability';
import { localDate, type AvailabilityException } from '../lib/domain';
import { germanDate } from './ScheduleCalendar';

export default function Availability() {
  const [data,setData] = useState<AvailabilityData | null>(null);
  const [view,setView] = useState<'own' | 'overview'>('own');
  const [target,setTarget] = useState('');
  const [from,setFrom] = useState(localDate());
  const [to,setTo] = useState(localDate());
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [undo,setUndo] = useState<{ memberId:string; dates:string[]; previous:AvailabilityException[] } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/availability',{ cache:'no-store',signal:controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Verfuegbarkeit konnte nicht geladen werden.');
      const result = await response.json() as AvailabilityData;
      setData(result); setTarget(result.memberId);
    }).catch(issue => { if (!controller.signal.aborted) setError(issue.message); });
    return () => controller.abort();
  },[]);
  async function write(memberId: string, dates: string[], available: boolean) {
    const response = await fetch('/api/availability',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ memberId,dates,available }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Speichern fehlgeschlagen.');
  }
  async function save(dates: string[], available: boolean) {
    if (!data || pending.current) return;
    if (!dates.length) { setError('Keine kommenden Diensttage im Zeitraum.'); return; }
    const previous = data.exceptions;
    const memberId = target;
    const next = previous.filter(entry => entry.memberId !== memberId || !dates.includes(entry.date));
    if (!available) next.push(...dates.map(date => ({ memberId,date })));
    pending.current = true; setBusy(true); setError(''); setMessage('');
    setData({ ...data,exceptions:next });
    try {
      await write(memberId,dates,available);
      setUndo({ memberId,dates,previous });
      const assigned = data.days.some(day => dates.includes(day.date) && (memberId === data.memberId ? day.assigned : day.assignedMemberIds?.includes(memberId)));
      setMessage(!available && assigned
        ? memberId === data.memberId ? 'Du bist an diesem Tag eingeplant. Bitte melde dich beim Admin. Die Meldung wurde gespeichert.' : 'Das Mitglied ist bereits eingeplant. Die Meldung wurde als Konflikt gespeichert.' : 'Meldung gespeichert.');
    } catch (issue) { setData({ ...data,exceptions:previous }); setError(issue instanceof Error ? issue.message : 'Speichern fehlgeschlagen.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function restore() {
    if (!undo || !data || pending.current) return;
    const current = data;
    pending.current = true; setBusy(true); setError('');
    const unavailable = undo.dates.filter(date => undo.previous.some(entry => entry.memberId === undo.memberId && entry.date === date));
    try {
      const response = await fetch('/api/availability',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ memberId:undo.memberId,dates:undo.dates,unavailableDates:unavailable }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Rueckgaengig fehlgeschlagen.');
      setData({ ...data,exceptions:[...data.exceptions.filter(entry => entry.memberId !== undo.memberId || !undo.dates.includes(entry.date)),
        ...undo.previous.filter(entry => entry.memberId === undo.memberId && undo.dates.includes(entry.date))] });
      setUndo(null); setMessage('Meldung rueckgaengig gemacht.');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Rueckgaengig fehlgeschlagen.');
      try { const response = await fetch('/api/availability',{ cache:'no-store' }); if (response.ok) setData(await response.json()); else setData(current); } catch { setData(current); }
    } finally { pending.current = false; setBusy(false); }
  }
  function range(available: boolean) {
    if (!data) return;
    try { void save(serviceDatesInRange(data.days,from,to),available); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Zeitraum ungueltig.'); }
  }
  return <main className="availability-page">
    <a href="/" className="text-button"><ArrowLeft size={18} />Dienstplanung</a>
    <h1><CalendarDays size={26} />Verfuegbarkeit</h1>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!data && !error && <p role="status"><LoaderCircle size={20} className="spin" />Verfuegbarkeit wird geladen</p>}
    {data && <>
      <div className="planning-tabs" role="tablist" aria-label="Verfuegbarkeitsansichten">
        <button role="tab" aria-selected={view === 'own'} onClick={() => setView('own')}>Meine Meldungen</button>
        <button role="tab" aria-selected={view === 'overview'} onClick={() => setView('overview')}>Uebersicht</button>
      </div>
      {message && <div className="notice green" role="status"><span>{message}</span>{undo && <button className="text-button" disabled={busy} onClick={() => void restore()}><RotateCcw size={18} />Rueckgaengig</button>}</div>}
      {view === 'own' && <>
        {data.admin && <label className="availability-member">Meldungen fuer<select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>{data.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === data.memberId ? ' (ich)' : ''}</option>)}</select></label>}
        <fieldset className="availability-range"><legend>Zeitraum</legend><div className="form-grid"><label>Von<input type="date" min={localDate()} value={from} onChange={event => setFrom(event.target.value)} /></label><label>Bis<input type="date" min={from} value={to} onChange={event => setTo(event.target.value)} /></label></div>
          <div className="form-actions"><button className="secondary-button" disabled={busy} onClick={() => range(false)}><X size={18} />Nicht verfuegbar</button><button className="secondary-button" disabled={busy} onClick={() => range(true)}><Check size={18} />Verfuegbar</button></div>
        </fieldset>
      </>}
      <div className="availability-days">{data.days.filter(day => day.date >= localDate()).map(day => {
        const eligible = dayMembers(data,day.date);
        const availableMembers = eligible.filter(member => !data.exceptions.some(entry => entry.memberId === member.id && entry.date === day.date));
        const available = !data.exceptions.some(entry => entry.memberId === target && entry.date === day.date);
        return <section className="availability-day" key={day.date}>
          <div><strong>{germanDate(day.date,{ weekday:'long',day:'2-digit',month:'2-digit',year:'numeric' })}</strong><small>{day.count} {day.count === 1 ? 'Dienst' : 'Dienste'} <span className={`badge ${day.published ? 'green' : 'amber'}`}>{day.mixed ? 'Entwurf / Freigegeben' : day.published ? 'Freigegeben' : 'Entwurf'}</span></small></div>
          {view === 'own' ? <button className={`availability-switch ${available ? 'available' : 'unavailable'}`} role="switch" aria-checked={available} aria-label={`Verfuegbarkeit am ${day.date}`} disabled={busy} onClick={() => void save([day.date],!available)}>{available ? <Check size={21} /> : <X size={21} />}{available ? 'Verfuegbar' : 'Nicht verfuegbar'}</button>
            : <details><summary>Verfuegbar ({availableMembers.length})</summary>{availableMembers.length ? <ul>{availableMembers.map(member => <li key={member.id}>{member.name}</li>)}</ul> : <p>Keine verfuegbaren Mitglieder.</p>}</details>}
          {view === 'own' && target === data.memberId && day.assigned && !available && <p className="availability-conflict" role="status">Du bist an diesem Tag eingeplant. Bitte melde dich beim Admin.</p>}
        </section>;
      })}</div>
      {!data.days.some(day => day.date >= localDate()) && <div className="empty-state"><CalendarDays size={28} /><h2>Keine kommenden Diensttage</h2></div>}
    </>}
  </main>;
}