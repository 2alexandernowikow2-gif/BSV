import Papa from 'papaparse';
import { importEmployeeInput, isPlaceholderEmail, type ImportEmployeeInput } from './account-rules';

export type ImportRow = { line: number; email: string; name: string; input: ImportEmployeeInput | null; state: 'ready' | 'error' | 'skipped' | 'success'; message: string };
export function parseEmployees(csv: string, existingEmails: Set<string> = new Set()): ImportRow[] {
  const result = Papa.parse<Record<string,string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', delimiter: '', delimitersToGuess: [';', ','],
    transformHeader: header => header.trim().toLowerCase().replace(/[\s_-]+/g, '')
  });
  const fields = result.meta.fields ?? [];
  if (!['vorname','nachname','email'].every(field => fields.includes(field))) throw new Error('CSV benoetigt die Spalten vorname, nachname und email; optional rolle, qualifikationen, info zu dienst und status.');
  if (fields.length !== new Set(fields).size || Object.keys(result.meta.renamedHeaders ?? {}).length) throw new Error('CSV enthaelt doppelte Spaltennamen.');
  if (result.data.length > 1000) throw new Error('Bitte maximal 1000 Mitarbeiter pro Datei importieren.');
  const counts = new Map<string,number>();
  for (const row of result.data) { const email = (row.email ?? '').trim().toLowerCase(); if (email) counts.set(email,(counts.get(email) ?? 0) + 1); }
  return result.data.map((row,index) => {
    const email = (row.email ?? '').trim().toLowerCase();
    const name = `${row.vorname ?? ''} ${row.nachname ?? ''}`.trim();
    const qualificationText = row.qualifikation ?? row.qualifikationen ?? '';
    const qualifications = [...new Set(qualificationText.split(/[;,|]/).map(value => value.trim()).filter(Boolean))];
    const sourceStatus = (row.status ?? row.kontostatus ?? '').trim().toLowerCase();
    const inactiveStatuses = ['inaktiv','inactive','deaktiviert','deactivated','disabled','passiv','ausgetreten','false','0'];
    const activeStatuses = ['aktiv','active','eingeladen','invited','enabled','true','1','mitglied'];
    const inactive = inactiveStatuses.includes(sourceStatus);
    const statusError = sourceStatus && !inactive && !activeStatuses.includes(sourceStatus) ? 'Unbekannter Status.' : '';
    const parsed = importEmployeeInput.safeParse({
      vorname: row.vorname ?? '', nachname: row.nachname ?? '', email,
      role: 'mitarbeiter', qualifications,
      serviceInfo: row.infozudienst ?? row.dienstinfo ?? row.zusatzinfo ?? '', inactive
    });
    const parseError = result.errors.find(error => error.row === index || error.row === undefined);
    let error = parseError ? 'CSV-Zeile ist nicht korrekt getrennt oder zitiert.' : '';
    if (!error && !email) error = 'E-Mail-Adresse fehlt.';
    if (!error && statusError) error = statusError;
    if (!error && !parsed.success) error = 'Name, E-Mail-Adresse oder Importdaten ungueltig.';
    if (!error && (counts.get(email) ?? 0) > 1) error = 'E-Mail-Adresse mehrfach in der Datei.';
    const existing = existingEmails.has(email);
    return { line:index + 2, email, name, input: parsed.success && !statusError ? parsed.data : null,
      state: error ? 'error' : existing ? 'skipped' : 'ready', message: error || (existing ? 'Benutzer bereits vorhanden.' : inactive ? 'Wird deaktiviert importiert; keine Einladung.' : isPlaceholderEmail(email) ? 'Dummy-Adresse; nach Korrektur manuell einladen.' : 'Wird ohne Einladung importiert.') };
  });
}