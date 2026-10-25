'use client';

import { useRef, useState } from 'react';
import { Check, Mail, Pencil, Plus, Search, Users, X } from 'lucide-react';
import { memberSeasonStatus, QUALIFICATION_NAMES, validEmail, type Command, type Member, type MemberStatus } from '../lib/domain';
import { useDialog } from './useDialog';

type Props = { members: Member[]; demo: boolean; busy: boolean; run: (command: Command) => Promise<boolean>; invite: (member: Member) => Promise<void>; actionError: string };

export default function MemberDirectory({ members, demo, busy, run, invite, actionError }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | MemberStatus>('all');
  const [editing, setEditing] = useState<Member | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, !!editing, () => setEditing(null));
  const filtered = members.filter(member => `${member.name} ${member.email ?? ''} ${member.qualifications.join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (status === 'all' || (status === 'winter' ? member.winterActive : status === 'summer' ? member.summerActive : memberSeasonStatus(member) === status)));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim(); const email = String(data.get('email')).trim();
    if (!name || (email && !validEmail(email))) { setError('Bitte Name und gueltige E-Mail pruefen.'); return; }
    const selectedQualifications = data.getAll('qualifications').map(String);
    const legacyQualifications = editing.qualifications.filter(value => !QUALIFICATION_NAMES.includes(value));
    const success = await run({ type: 'updateMember', member: { id: editing.id, name, email: email || null, winterActive: data.get('winterActive') === 'on', summerActive: data.get('summerActive') === 'on', qualifications: [...new Set([...legacyQualifications, ...selectedQualifications])] } });
    if (success) setEditing(null);
  }
  return <section>
    <div className="section-heading"><div><h2>Mitarbeiter</h2><p>{members.length} Mitglieder · {members.filter(member => member.winterActive).length} Winter · {members.filter(member => member.summerActive).length} Sommer · {members.filter(member => member.status === 'inactive').length} inaktiv</p></div><button className="primary-button" onClick={() => { setError(''); setEditing({ id: crypto.randomUUID(), name: '', email: '', winterActive: true, summerActive: false, status: 'winter', active: true, qualifications: [] }); }}><Plus size={17} />Mitglied anlegen</button></div>
    <div className="notice neutral"><Users size={18} /><span>Winter und Sommer können unabhängig aktiviert werden. Inaktive Mitglieder behalten Zugang, werden aber nicht in die monatliche Planung einbezogen.</span></div>
    <div className="filter-bar"><label className="search-field"><Search size={17} /><input aria-label="Mitarbeiter suchen" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, E-Mail oder Qualifikation" /></label><select aria-label="Mitgliederstatus" value={status} onChange={event => setStatus(event.target.value as 'all' | MemberStatus)}><option value="all">Alle Mitglieder</option><option value="winter">Winter aktiv</option><option value="summer">Sommer aktiv</option><option value="both">Winter und Sommer</option><option value="inactive">Inaktiv</option></select><span className="muted">{filtered.length} Treffer</span></div>
    <div className="table-scroll"><table className="member-table"><thead><tr><th>Name</th><th>E-Mail</th><th>Qualifikationen</th><th>Status</th><th><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{filtered.map(member => { const memberStatus = memberSeasonStatus(member); return <tr key={member.id}><td><div className="member-name"><span className="avatar">{member.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><strong>{member.name}</strong></div></td><td>{member.email ?? <span className="muted">Nicht hinterlegt</span>}</td><td><div className="qualification-list">{member.qualifications.length ? member.qualifications.map(value => <span className={`badge ${member.qualifications.includes(value) && QUALIFICATION_NAMES.includes(value) ? 'qualification-badge' : 'neutral'}`} key={value}>{value}</span>) : <span className="muted">Keine</span>}</div></td><td><span className={`badge member-status ${memberStatus}`}>{memberStatus === 'both' ? 'Winter + Sommer' : memberStatus === 'winter' ? 'Winter aktiv' : memberStatus === 'summer' ? 'Sommer aktiv' : 'Inaktiv'}</span></td><td><div className="row-actions"><button className="icon-button" title={`${member.name} bearbeiten`} aria-label={`${member.name} bearbeiten`} onClick={() => { setError(''); setEditing(member); }}><Pencil size={17} /></button><button className="icon-button" title={!member.email ? 'E-Mail fehlt' : demo ? 'Demo-Einladung (kein Versand)' : 'Einladung senden'} aria-label={`${member.name} einladen`} disabled={busy || !member.email} onClick={() => void invite(member)}><Mail size={17} /></button></div></td></tr>; })}</tbody></table></div>
    {!filtered.length && <div className="empty-state"><Search size={28} /><h3>Keine passenden Mitglieder</h3></div>}
    {editing && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="member-editor-title">
      <header className="modal-heading"><div><p className="eyebrow">MITARBEITER</p><h2 id="member-editor-title">{editing.name || 'Neues Mitglied'}</h2></div><button className="icon-button" title="Schliessen" aria-label="Schliessen" onClick={() => setEditing(null)}><X size={20} /></button></header>
      <form onSubmit={save}><div className="form-grid">
        <label>Name<input name="name" required defaultValue={editing.name} /></label>
        <label>E-Mail<input name="email" type="email" defaultValue={editing.email ?? ''} /></label>
        <fieldset className="member-season-options span-all"><legend>Aktiv in</legend><label className="check-label"><input name="winterActive" type="checkbox" defaultChecked={editing.winterActive} />Winter</label><label className="check-label"><input name="summerActive" type="checkbox" defaultChecked={editing.summerActive} />Sommer</label><small>Beide nicht gewählt: Inaktiv. Inaktive Mitglieder behalten Zugang.</small></fieldset>
        <div className="qualification-fieldset span-all"><strong>Qualifikationen</strong><div className="qualification-checkboxes">{QUALIFICATION_NAMES.map(qualification => <label className="check-label" key={qualification}><input name="qualifications" type="checkbox" value={qualification} defaultChecked={editing.qualifications.includes(qualification)} />{qualification}</label>)}</div></div>
      </div>{(error || actionError) && <p className="error-text" role="alert">{error || actionError}</p>}<footer className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Abbrechen</button><button disabled={busy} className="primary-button"><Check size={17} />Speichern</button></footer></form>
    </section></div>}
  </section>;
}