import { describe, expect, it } from 'vitest';
import { applyCommand, assignmentReport, demoSeed, deterministicUuid, eligibility, generateShifts, instant, makeShift, memberSeasonStatus, missingQualification, OPTIONAL_TASK_NAMES, overlaps, previewTimes, QUALIFICATION_NAMES, reportMonths, seasonForDate, suggestMonthlyAssignments, TASK_NAMES, taskWindow, type Snapshot, type Shift } from '../src/lib/domain';
import { matchesAppOrigin as sameOrigin } from '../src/lib/request-origin';

const now = new Date('2026-01-01T00:00:00Z');
const admin = { memberId: deterministicUuid('admin'), role: 'admin' };
const member = { id: deterministicUuid('member'), name: 'Demo Mitglied', status: 'winter' as const, winterActive: true, summerActive: false, active: true, qualifications: ['Bergstation'] };
const actor = { memberId: member.id, role: 'member' };
const fixture = (shifts: Shift[]): Snapshot => ({ shifts, members: [member], version: 0 });
const shift = () => ({ ...makeShift('2026-01-03', 'early', '09:30', '14:00', ['Bergstation', 'Bügel/Liftaufsicht']), published: true });

describe('Dienstplanung lokal', () => {
  it('generiert Freitag und zwei Wochenenddienste je Tag', () => {
    const result = generateShifts('2026-01-02', '2026-01-04', ['Bergstation']);
    expect(result).toHaveLength(5);
    expect(result[0].tasks).toHaveLength(1);
    expect(result[1].tasks).toHaveLength(3);
    expect(result[2].tasks).toHaveLength(3);
    expect(result[1].tasks.map(task => task.name)).toEqual(TASK_NAMES);
    expect(result[1].tasks.every(task => task.qualification === task.name)).toBe(true);
  });
  it('fügt Bügel/Liftaufsicht nur auf ausdrückliche Auswahl hinzu', () => {
    const shifts = generateShifts('2026-01-03', '2026-01-04', ['Betriebswart'], {}, true);
    expect(shifts[0].tasks.map(task => task.name)).toEqual([...TASK_NAMES, ...OPTIONAL_TASK_NAMES]);
    expect(shifts[0].tasks.at(-1)?.durationMinutes).toBe(120);
  });
  it('verwendet die drei gleichnamigen Standardqualifikationen', () => {
    expect(TASK_NAMES).toEqual(['Betriebswart', 'Kasse', 'Bergstation']);
    expect(QUALIFICATION_NAMES.slice(0, 3)).toEqual(TASK_NAMES);
  });
  it('verlangt eine ausdrueckliche Freitagsauswahl', () => {
    expect(() => generateShifts('2026-01-02', '2026-01-04', [])).toThrow('Freitagsaufgaben');
  });
  it('erzeugt stabile gueltige UUIDs', () => {
    expect(deterministicUuid('2026-01-02:friday')).toBe(deterministicUuid('2026-01-02:friday'));
    expect(deterministicUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid('x')).not.toBe(deterministicUuid('y'));
  });
  it('regeneriert idempotent ohne individuelle Zeiten zu ueberschreiben', () => {
    const generated = generateShifts('2026-01-02', '2026-01-04', ['Bergstation']);
    const first = applyCommand(fixture([]), { type: 'generate', shifts: generated }, admin, now).snapshot;
    first.shifts[0].start = instant(first.shifts[0].date, '19:00');
    const second = applyCommand(first, { type: 'generate', shifts: generated }, admin, now).snapshot;
    expect(second.shifts).toHaveLength(5);
    expect(second.shifts[0].start).toBe(first.shifts[0].start);
  });
  it('berechnet volle Schicht und erste 120 Minuten relativ', () => {
    const item = shift();
    expect(taskWindow(item, item.tasks[0]).end).toBe(Date.parse(item.end));
    expect(taskWindow(item, item.tasks[1]).end - taskWindow(item, item.tasks[1]).start).toBe(120 * 60000);
  });
  it('erlaubt angrenzende halboffene Intervalle', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
  it('verhindert doppelte Besetzung und Ueberschneidungen', () => {
    const item = shift();
    const first = applyCommand(fixture([item]), { type: 'signup', taskId: item.tasks[0].id }, actor, now).snapshot;
    expect(() => applyCommand(first, { type: 'signup', taskId: item.tasks[0].id }, actor, now)).toThrow('besetzt');
    expect(() => applyCommand(first, { type: 'signup', taskId: item.tasks[1].id }, actor, now)).toThrow('Zeitkonflikt');
  });
  it('erlaubt Eintragung ohne Qualifikation und liefert nur einen Hinweis', () => {
    const item = shift(); item.tasks[0].qualification = 'Andere Qualifikation';
    const assigned = applyCommand(fixture([item]), { type: 'signup', taskId: item.tasks[0].id }, actor, now).snapshot;
    expect(assigned.shifts[0].tasks[0].memberId).toBe(member.id);
    expect(missingQualification(item.tasks[0], member)).toBe('Andere Qualifikation');
    expect(() => applyCommand(assigned, { type: 'updateMember', member: { ...member, email: null, qualifications: [] } }, admin, now)).not.toThrow();
  });
  it('entzieht Mitgliedern administrativen Zugriff', () => {
    expect(() => applyCommand(fixture([]), { type: 'create', shift: shift() }, actor, now)).toThrow('Administration');
  });
  it('zieht nur eigene zukuenftige Dienste zurueck und protokolliert einmal', () => {
    const item = shift(); item.tasks[0].memberId = member.id;
    const result = applyCommand(fixture([item]), { type: 'withdraw', taskId: item.tasks[0].id }, actor, now, 'demo@example.invalid');
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].status).toBe('Demo: kein Versand');
    expect(() => applyCommand(result.snapshot, { type: 'withdraw', taskId: item.tasks[0].id }, actor, now)).toThrow('eigene');
    expect(() => applyCommand(fixture([item]), { type: 'withdraw', taskId: item.tasks[0].id }, actor, new Date(item.start))).toThrow('begonnen');
  });
  it('aendert historische Zeiten nicht', () => {
    const item = shift();
    expect(() => applyCommand(fixture([item]), { type: 'updateTimes', updates: [{ id: item.id, start: instant(item.date, '10:00'), end: instant(item.date, '14:00') }] }, admin, new Date('2026-02-01'))).toThrow('schreibgeschuetzt');
  });
  it('verhindert zu kurze Schichten und liefert eine konfliktfreie Vorschau', () => {
    const item = shift();
    expect(previewTimes(fixture([item]), [{ id: item.id, start: instant(item.date, '10:00'), end: instant(item.date, '11:00') }], admin, now)[0]).toContain('Aufgabendauer');
    expect(previewTimes(fixture([item]), [{ id: item.id, start: instant(item.date, '10:00'), end: instant(item.date, '14:00') }], admin, now)).toEqual([]);
  });
  it('rollt konfligierende Bulk-Aenderungen vollstaendig zurueck', () => {
    const early = shift(); early.tasks[0].memberId = member.id;
    const late = makeShift(early.date, 'late', '14:00', '18:30', ['Bergstation']); late.tasks[0].memberId = member.id;
    const original = fixture([early, late]);
    expect(() => applyCommand(original, { type: 'updateTimes', updates: [{ id: early.id, start: early.start, end: instant(early.date, '15:00') }] }, admin, now)).toThrow('Zeitkonflikt');
    expect(original.shifts[0].end).toBe(instant(early.date, '14:00'));
    expect(original.version).toBe(0);
  });
  it('unterstuetzt beliebige Wochentage', () => {
    const extra = makeShift('2026-01-06', 'extra', '16:00', '19:00', ['Materialausgabe'], 'Zusatzdienst');
    expect(applyCommand(fixture([]), { type: 'create', shift: extra }, admin, now).snapshot.shifts[0].date).toBe('2026-01-06');
  });
  it('beruecksichtigt Berliner Sommerzeit und lehnt die DST-Luecke ab', () => {
    expect(instant('2026-01-03', '09:30')).toBe('2026-01-03T08:30:00.000Z');
    expect(instant('2026-07-03', '09:30')).toBe('2026-07-03T07:30:00.000Z');
    expect(() => instant('2026-03-29', '02:30')).toThrow('existiert nicht');
  });
  it('behaelt Rollen beim Bearbeiten von Mitgliedern', () => {
    const original = { ...fixture([]), members: [{ ...member, role: 'admin' }] };
    const result = applyCommand(original, { type: 'updateMember', member: { ...member, name: 'Demo Bearbeitet', email: null } }, admin, now).snapshot;
    expect(result.members[0].role).toBe('admin');
  });
  it('erstellt aktuelle und naechste Monatsdaten ausschliesslich als Demo', () => {
    const result = demoSeed(new Date('2026-10-10T12:00:00Z'));
    expect(new Set(result.shifts.map(item => item.date.slice(0, 7)))).toEqual(new Set(['2026-10', '2026-11']));
    expect(result.members.every(item => item.name.startsWith('Demo'))).toBe(true);
  });
  it('verteilt Monatsvorschlaege zuerst an Mitglieder mit weniger Diensten', () => {
    const other = { ...member, id: deterministicUuid('other'), name: 'Anderes Mitglied' };
    const first = makeShift('2026-01-03', 'early', '09:30', '14:00', ['Bergstation']);
    const second = makeShift('2026-01-04', 'early', '09:30', '14:00', ['Bergstation']);
    first.published = true; second.published = true; first.tasks[0].memberId = member.id;
    const proposals = suggestMonthlyAssignments({ shifts: [first, second], members: [member, other], version: 0 }, '2026-01', now);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].memberId).toBe(other.id);
  });
  it('verwaltet Saisonstatus getrennt von Dienstzugang', () => {
    const summer = { ...member, status: 'summer' as const, winterActive: false, summerActive: true, active: true };
    expect(eligibility(fixture([]), shift(), shift().tasks[0], summer, now)).toBeNull();
    const inactive = { ...member, status: 'inactive' as const, winterActive: false, summerActive: false, active: true };
    expect(eligibility(fixture([]), shift(), shift().tasks[0], inactive, now)).toBeNull();
    const result = applyCommand(fixture([]), { type: 'updateMember', member: { ...member, email: null, winterActive: false, summerActive: false } }, admin, now).snapshot;
    expect(result.members[0].status).toBe('inactive');
    expect(result.members[0].active).toBe(true);
    expect(result.members[0].winterActive).toBe(false);
    expect(result.members[0].summerActive).toBe(false);
  });
  it('laesst inaktive Mitglieder sich weiterhin selbst fuer Dienste eintragen', () => {
    const item = shift();
    const updated = applyCommand(fixture([item]), { type: 'updateMember', member: { ...member, email: null, winterActive: false, summerActive: false } }, admin, now).snapshot;
    expect(updated.members[0].active).toBe(true);
    const joined = applyCommand(updated, { type: 'signup', taskId: item.tasks[0].id }, actor, now).snapshot;
    expect(joined.shifts[0].tasks[0].memberId).toBe(member.id);
  });
  it('wendet die Saisonwechsel am 15. November und 15. Maerz an', () => {
    expect(seasonForDate('2026-03-15')).toBe('winter');
    expect(seasonForDate('2026-03-16')).toBe('summer');
    expect(seasonForDate('2026-11-14')).toBe('summer');
    expect(seasonForDate('2026-11-15')).toBe('winter');
  });
  it('schlaegt nur Mitglieder der passenden Saison vor', () => {
    const winter = { ...member, id: deterministicUuid('winter') };
    const summer = { ...member, id: deterministicUuid('summer'), status: 'summer' as const, winterActive: false, summerActive: true };
    const inactive = { ...member, id: deterministicUuid('inactive'), status: 'inactive' as const, winterActive: false, summerActive: false };
    const item = makeShift('2026-01-03', 'early', '09:30', '14:00', ['Bergstation']);
    item.published = true;
    const proposals = suggestMonthlyAssignments({ shifts: [item], members: [winter, summer, inactive], version: 0 }, '2026-01', now);
    expect(proposals.map(proposal => proposal.memberId)).toEqual([winter.id]);
  });
  it('bevorzugt bei automatischen Vorschlaegen Mitglieder mit passender Qualifikation', () => {
    const qualified = { ...member, id: deterministicUuid('qualified'), name: 'Qualifiziert', qualifications: ['Bergstation'] };
    const unqualified = { ...member, id: deterministicUuid('unqualified'), name: 'Nicht qualifiziert', qualifications: [] };
    const item = makeShift('2026-01-03', 'early', '09:30', '14:00', ['Bergstation']);
    item.published = true;
    const proposals = suggestMonthlyAssignments({ shifts: [item], members: [unqualified, qualified], version: 0 }, '2026-01', now);
    expect(proposals[0].memberId).toBe(qualified.id);
    expect(proposals[0].missingQualification).toBeNull();
  });
  it('bildet beide angehakten Saisons als Winter und Sommer ab', () => {
    expect(memberSeasonStatus({ winterActive: true, summerActive: true })).toBe('both');
    expect(memberSeasonStatus({ winterActive: true, summerActive: false })).toBe('winter');
    expect(memberSeasonStatus({ winterActive: false, summerActive: true })).toBe('summer');
    expect(memberSeasonStatus({ winterActive: false, summerActive: false })).toBe('inactive');
  });
  it('beruecksichtigt doppelt aktive Mitglieder in beiden Saisonpools', () => {
    const dual = { ...member, id: deterministicUuid('dual'), status: 'both' as const, winterActive: true, summerActive: true };
    const winterShift = makeShift('2026-01-03', 'early', '09:30', '14:00', ['Winteraufgabe']);
    const summerShift = makeShift('2026-06-06', 'early', '09:30', '14:00', ['Sommeraufgabe']);
    winterShift.published = true; summerShift.published = true;
    const suggestions = suggestMonthlyAssignments({ shifts: [winterShift, summerShift], members: [dual], version: 0 }, '2026', now);
    expect(suggestions.map(item => item.memberId)).toEqual([dual.id, dual.id]);
  });
  it('ermittelt 1 bis 12 letzte Kalendermonate inklusive aktuellem Monat', () => {
    expect(reportMonths(3, new Date('2026-10-11T12:00:00Z'))).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(reportMonths(1, new Date('2026-01-11T12:00:00Z'))).toEqual(['2026-01']);
    expect(reportMonths(13, new Date('2026-01-11T12:00:00Z'))).toHaveLength(12);
  });
  it('wertet besetzte Einzelaufgaben pro Mitarbeiter inklusive inzwischen Inaktiver aus', () => {
    const inactive = { ...member, id: deterministicUuid('former-member'), name: 'Ehemalig', status: 'inactive' as const, winterActive: false, active: true };
    const previousMonth = makeShift('2026-09-05', 'early', '09:30', '14:00', ['Kasse', 'Bergstation']);
    const currentMonth = makeShift('2026-10-03', 'early', '09:30', '14:00', ['Kasse']);
    previousMonth.tasks[0].memberId = member.id;
    previousMonth.tasks[1].memberId = inactive.id;
    currentMonth.tasks[0].memberId = member.id;
    const rows = assignmentReport({ shifts: [previousMonth, currentMonth], members: [member, inactive], version: 0 }, ['2026-09', '2026-10']);
    expect(rows[0]).toMatchObject({ member: { id: member.id }, total: 2, average: 1, monthly: { '2026-09': 1, '2026-10': 1 } });
    expect(rows[1]).toMatchObject({ member: { id: inactive.id }, total: 1, average: 0.5, monthly: { '2026-09': 1, '2026-10': 0 } });
  });
  it('öffnet Monatsstatus beim Veröffentlichen und schliesst erst vollständig besetzte Monate', () => {
    const item = makeShift('2026-01-03', 'early', '09:30', '14:00', ['Bergstation']);
    let snapshot = fixture([item]);
    snapshot = applyCommand(snapshot, { type: 'publish', ids: [item.id] }, admin, now, 'demo@example.invalid').snapshot;
    expect(snapshot.planningPeriods?.['2026-01']).toBe('open');
    expect(() => applyCommand(snapshot, { type: 'monthPhase', month: '2026-01', phase: 'closed' }, admin, now)).toThrow('besetzt');
    snapshot.shifts[0].tasks[0].memberId = member.id;
    snapshot = applyCommand(snapshot, { type: 'monthPhase', month: '2026-01', phase: 'closed' }, admin, now).snapshot;
    expect(snapshot.planningPeriods?.['2026-01']).toBe('closed');
    expect(() => applyCommand(snapshot, { type: 'assign', taskId: item.tasks[0].id, memberId: null }, admin, now)).toThrow('schreibgeschuetzt');
    snapshot = applyCommand(snapshot, { type: 'monthPhase', month: '2026-01', phase: 'open' }, admin, now).snapshot;
    expect(snapshot.planningPeriods?.['2026-01']).toBe('open');
  });

  it('akzeptiert lokale Loopback-Varianten als gleichen Ursprung', () => {
    expect(sameOrigin(new Request('http://127.0.0.1:3008/api/login', { headers: { origin: 'http://localhost:3008' } }))).toBe(true);
    expect(sameOrigin(new Request('http://localhost:3008/api/login', { headers: { referer: 'http://127.0.0.1:3008/' } }))).toBe(true);
  });
  it('verwendet APP_URL auch hinter einem internen Serverhost', () => {
    expect(sameOrigin(new Request('http://localhost:3000/api/login', { headers: { origin: 'http://127.0.0.1:3008' } }), 'http://127.0.0.1:3008')).toBe(true);
  });
  it('lehnt fremde Origins, Protokolle, Ports und fehlende Herkunft ab', () => {
    for (const origin of ['http://example.com:3008', 'https://localhost:3008', 'http://localhost:3009', 'null']) {
      expect(sameOrigin(new Request('http://127.0.0.1:3008/api/login', { headers: { origin, referer: 'http://127.0.0.1:3008/' } }))).toBe(false);
    }
    expect(sameOrigin(new Request('http://127.0.0.1:3008/api/login'))).toBe(false);
  });
});