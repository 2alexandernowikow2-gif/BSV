'use client';

import { useState } from 'react';
import { Ban, RotateCcw, Trash2 } from 'lucide-react';
import type { Actor, Command, Shift } from '../lib/domain';

type Props = { shift: Shift; actor: Actor; busy: boolean; run: (command: Command) => Promise<boolean> };

export default function ShiftAdminActions({ shift, actor, busy, run }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const historical = Date.parse(shift.start) <= Date.now();
  if (actor.role !== 'admin') return null;

  if (shift.cancellation) return <section className="shift-admin-actions" data-cancelled="true" aria-label="Absagestatus">
    <div><span className="badge cancelled"><Ban size={13} />Abgesagt</span><p>{shift.cancellation.reason || 'Kein Absagegrund angegeben'}</p></div>
    {!historical && <button className="secondary-button" disabled={busy} onClick={() => void run({ type: 'reactivateShift', shiftId: shift.id })}><RotateCcw size={16} />Dienst reaktivieren</button>}
  </section>;

  if (historical) return null;

  if (!shift.published) return <section className="shift-admin-actions" aria-label="Entwurf verwalten">
    <div><strong>Entwurf entfernen</strong><p>Der Dienst und seine Zuordnungen werden endgültig gelöscht.</p></div>
    <button className="danger-button" disabled={busy} onClick={() => {
      if (globalThis.confirm(`Entwurf „${shift.title}“ am ${shift.date} endgültig löschen?`)) void run({ type: 'deleteDraft', shiftId: shift.id });
    }}><Trash2 size={16} />Entwurf löschen</button>
  </section>;

  async function cancel() {
    const value = reason === 'weather' ? 'Schlechtes Wetter' : reason === 'other' ? details.trim() || 'Sonstiger Grund' : null;
    if (await run({ type: 'cancelShift', shiftId: shift.id, reason: value })) setConfirming(false);
  }

  return <section className="shift-admin-actions" aria-label="Dienst absagen">
    {!confirming ? <button className="danger-button" disabled={busy} onClick={() => setConfirming(true)}><Ban size={16} />Dienst absagen</button> : <div className="cancel-confirmation">
      <strong>Dienst für Mitarbeiter ausblenden?</strong>
      <p>Zuordnungen bleiben erhalten. Zugeordnete Mitarbeiter werden informiert.</p>
      <label>Absagegrund <select value={reason} onChange={event => setReason(event.target.value)}>
        <option value="">Kein Grund angeben</option>
        <option value="weather">Schlechtes Wetter</option>
        <option value="other">Sonstiger Grund</option>
      </select></label>
      {reason === 'other' && <label>Details (optional)<input maxLength={130} value={details} onChange={event => setDetails(event.target.value)} /></label>}
      <div className="cancel-confirmation-actions"><button className="text-button" disabled={busy} onClick={() => setConfirming(false)}>Abbrechen</button><button className="danger-button" disabled={busy} onClick={() => void cancel()}><Ban size={16} />Jetzt absagen</button></div>
    </div>}
  </section>;
}
