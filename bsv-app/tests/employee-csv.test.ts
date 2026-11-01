import { describe,expect,it } from 'vitest';
import { parseEmployees } from '../src/lib/employee-csv';

describe('Mitarbeiter-CSV', () => {
  it('verarbeitet Excel-BOM, Semikolon und tolerante Kopfzeilen', () => {
    const rows = parseEmployees('\uFEFF Vorname ; NACHNAME ; E Mail \nAnna;Test;ANNA@example.invalid');
    expect(rows[0].input).toMatchObject({ vorname:'Anna', nachname:'Test', email:'anna@example.invalid', role:'mitarbeiter' });
    expect(rows[0].state).toBe('ready');
  });
  it('verarbeitet Kommas und zitierte Felder', () => {
    const rows = parseEmployees('vorname,nachname,email,rolle\n"Anna, Maria",Test,anna@example.invalid,admin');
    expect(rows[0].input?.vorname).toBe('Anna, Maria');
    expect(rows[0].input?.role).toBe('admin');
  });
  it('meldet alle Duplikate und fehlende oder ungueltige E-Mails', () => {
    const rows = parseEmployees('vorname;nachname;email\nA;B;a@example.invalid\nC;D;A@example.invalid\nE;F;\nG;H;falsch');
    expect(rows.map(row => row.state)).toEqual(['error','error','error','error']);
  });
  it('ueberspringt bestehende Benutzer ohne eine weitere Einladung', () => {
    expect(parseEmployees('vorname;nachname;email\nA;B;a@example.invalid',new Set(['a@example.invalid']))[0].state).toBe('skipped');
  });
  it('weist falsche Kopfzeilen und fehlerhafte CSV-Zeilen zurueck', () => {
    expect(() => parseEmployees('Name;Adresse\nA;B')).toThrow('Spalten');
    expect(parseEmployees('vorname;nachname;email\nA;B;a@example.invalid;extra')[0].state).toBe('error');
  });
});