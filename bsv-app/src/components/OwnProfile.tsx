'use client';

import { useState } from 'react';
import { ArrowLeft,Check,KeyRound,LoaderCircle,Users } from 'lucide-react';
import { accountRequest } from '../lib/account-client';

type Props = { vorname:string;nachname:string;email:string;admin:boolean };
export default function OwnProfile({ vorname,nachname,email,admin }: Props) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>,password: boolean) {
    event.preventDefault();if (busy) return;
    const form = event.currentTarget;const values = new FormData(form);
    if (password && values.get('password') !== values.get('confirm')) { setError('Passwoerter stimmen nicht ueberein.');return; }
    setBusy(true);setError('');setMessage('');
    try {
      await accountRequest('/api/account',password ? { action:'password',password:String(values.get('password')) } : { action:'name',vorname:String(values.get('vorname')),nachname:String(values.get('nachname')) });
      setMessage(password ? 'Passwort gespeichert.' : 'Name gespeichert.');if (password) form.reset();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <div className="management-shell"><header className="management-header"><a className="brand" href="/"><span className="brand-mark">BSV</span><strong>BSV Weitnau</strong></a><nav><a href="/"><ArrowLeft size={17} />Dienstkalender</a>{admin && <a href="/admin/mitarbeiter"><Users size={17} />Mitarbeiter</a>}</nav></header><main className="management-content profile-content"><div className="page-heading"><h1>Mein Profil</h1></div><div aria-live="polite">{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice green">{message}</p>}</div><section className="settings-band"><div><h2>Persoenliche Daten</h2><p className="muted">{email}</p></div><form onSubmit={event => void save(event,false)}><label>Vorname<input name="vorname" required maxLength={60} autoComplete="given-name" defaultValue={vorname} /></label><label>Nachname<input name="nachname" maxLength={60} autoComplete="family-name" defaultValue={nachname} /></label><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}Speichern</button></form></section><section className="settings-band"><div><KeyRound size={23} /><h2>Passwort aendern</h2></div><form onSubmit={event => void save(event,true)}><label>Neues Passwort<input name="password" type="password" required minLength={6} maxLength={256} autoComplete="new-password" /></label><label>Passwort bestaetigen<input name="confirm" type="password" required minLength={6} maxLength={256} autoComplete="new-password" /></label><button className="primary-button" disabled={busy}><KeyRound size={17} />Passwort speichern</button></form></section></main></div>;
}