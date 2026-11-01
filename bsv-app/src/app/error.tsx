'use client';

import { AlertCircle,RefreshCw } from 'lucide-react';

export default function ErrorPage({ reset }: { reset:() => void }) {
  return <main className="loading-screen"><AlertCircle size={32} /><h1>Seite derzeit nicht verfuegbar</h1><p role="alert">Daten konnten nicht geladen werden. Bitte erneut versuchen oder die Vereinsverwaltung kontaktieren.</p><button className="primary-button" onClick={reset}><RefreshCw size={17} />Erneut versuchen</button><a className="text-button" href="/">Zur Anmeldung</a></main>;
}