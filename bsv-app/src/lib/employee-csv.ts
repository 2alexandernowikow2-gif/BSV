import Papa from 'papaparse';
import { employeeInput, type EmployeeInput } from './account-rules';

export type ImportRow = { line: number; email: string; name: string; input: EmployeeInput | null; state: 'ready' | 'error' | 'skipped' | 'success'; message: string };
export function parseEmployees(csv: string, existingEmails: Set<string> = new Set()): ImportRow[] {
  const result = Papa.parse<Record<string,string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', delimiter: '', delimitersToGuess: [';', ','],
    transformHeader: header => header.trim().toLowerCase().replace(/\s+/g, '')
  });
  const fields = result.meta.fields ?? [];
  if (!['vorname','nachname','email'].every(field => fields.includes(field))) throw new Error('CSV benoetigt die Spalten vorname, nachname und email; optional rolle.');
  if (fields.length !== new Set(fields).size || Object.keys(result.meta.renamedHeaders ?? {}).length) throw new Error('CSV enthaelt doppelte Spaltennamen.');
  if (result.data.length > 1000) throw new Error('Bitte maximal 1000 Mitarbeiter pro Datei importieren.');
  const counts = new Map<string,number>();
  for (const row of result.data) { const email = (row.email ?? '').trim().toLowerCase(); if (email) counts.set(email,(counts.get(email) ?? 0) + 1); }
  return result.data.map((row,index) => {
    const email = (row.email ?? '').trim().toLowerCase();
    const name = `${row.vorname ?? ''} ${row.nachname ?? ''}`.trim();
    const parsed = employeeInput.safeParse({ vorname: row.vorname ?? '', nachname: row.nachname ?? '', email, role: row.rolle?.trim().toLowerCase() || 'mitarbeiter' });
    const parseError = result.errors.find(error => error.row === index || error.row === undefined);
    const error = parseError ? 'CSV-Zeile ist nicht korrekt getrennt oder zitiert.'
      : !email ? 'E-Mail-Adresse fehlt.' : !parsed.success ? 'Name, E-Mail-Adresse oder Rolle ungueltig.'
      : (counts.get(email) ?? 0) > 1 ? 'E-Mail-Adresse mehrfach in der Datei.' : '';
    const existing = existingEmails.has(email);
    return { line:index + 2, email, name, input: parsed.success ? parsed.data : null,
      state: error ? 'error' : existing ? 'skipped' : 'ready', message: error || (existing ? 'Benutzer bereits vorhanden.' : 'Bereit zur Einladung.') };
  });
}