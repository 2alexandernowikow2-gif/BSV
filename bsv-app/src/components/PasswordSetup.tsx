'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useEffect,useRef,useState } from 'react';
import { Check,KeyRound,LoaderCircle } from 'lucide-react';
import { accountRequest } from '../lib/account-client';

export default function PasswordSetup() {
  const [ready,setReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const initialization = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let mounted = true;
    initialization.current ??= (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('Onlinebetrieb nicht eingerichtet.');
      const client = createBrowserClient(url,key);
      const query = new URLSearchParams(window.location.search);const hash = new URLSearchParams(window.location.hash.slice(1));
      if (query.has('error') || hash.has('error')) throw new Error('Link ist ungueltig oder abgelaufen. Bitte einen neuen Einrichtungslink anfordern.');
      const code = query.get('code');const tokenHash = query.get('token_hash');
      if (code) { const { error } = await client.auth.exchangeCodeForSession(code);if (error) throw new Error('Link konnte nicht bestaetigt werden. Bitte den Link erneut im urspruenglichen Browser oeffnen oder einen neuen Link anfordern.'); }
      else if (tokenHash) {
        const { error } = await client.auth.verifyOtp({ token_hash:tokenHash,type:query.get('type') === 'recovery' ? 'recovery' : 'invite' });
        if (error) throw new Error('Einrichtungslink ist ungueltig oder abgelaufen.');
      } else if (hash.get('access_token') && hash.get('refresh_token')) {
        const { error } = await client.auth.setSession({ access_token:hash.get('access_token')!,refresh_token:hash.get('refresh_token')! });
        if (error) throw new Error('Einrichtungslink ist ungueltig oder abgelaufen.');
      }
      const { data:{ user },error } = await client.auth.getUser();
      if (error || !user) throw new Error('Bitte diese Seite ueber den Einladungs- oder Passwort-Reset-Link aus deiner E-Mail oeffnen.');
      window.history.replaceState(null,'','/auth/passwort-setzen');
    })();
    initialization.current.then(() => { if (mounted) setReady(true); }).catch(issue => { if (mounted) setError(issue instanceof Error ? issue.message : 'Linkpruefung fehlgeschlagen.'); });
    return () => { mounted = false; };
  },[]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if (busy) return;
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) { setError('Passwoerter stimmen nicht ueberein.');return; }
    setBusy(true);setError('');
    try {
      const result = await accountRequest<{ redirect:string }>('/api/account',{ action:'password',password:String(data.get('password')) });
      window.location.assign(result.redirect);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Passwort konnte nicht gespeichert werden.');setBusy(false); }
  }
  return <main className="auth-page"><a className="auth-brand" href="/"><span className="brand-mark">BSV</span><div><strong>BSV Weitnau</strong><span>Dienstplanung</span></div></a><section className="auth-form"><div className="auth-icon"><KeyRound size={25} /></div><h1>Passwort setzen</h1>{error && <p className="notice error" role="alert">{error}</p>}{!ready && !error && <p role="status"><LoaderCircle size={18} className="spin" />Link wird geprueft</p>}{ready && <form onSubmit={save}><label>Neues Passwort<input name="password" type="password" minLength={6} maxLength={256} required autoComplete="new-password" autoFocus /></label><label>Passwort bestaetigen<input name="confirm" type="password" minLength={6} maxLength={256} required autoComplete="new-password" /></label><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}Passwort speichern</button></form>}<a className="text-button" href="/">Zur Anmeldung</a></section></main>;
}