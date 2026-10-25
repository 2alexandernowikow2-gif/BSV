import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const ZONE = 'Europe/Berlin';
export type Task = { id: string; name: string; qualification: string | null; offsetMinutes: number; durationMinutes: number | null; memberId: string | null };
export type Shift = { id: string; date: string; title: string; kind: string; start: string; end: string; published: boolean; tasks: Task[] };
export type MemberStatus = 'winter' | 'summer' | 'both' | 'inactive';
export type Member = { id: string; name: string; email?: string; role?: string; status: MemberStatus; winterActive: boolean; summerActive: boolean; active: boolean; qualifications: string[] };
export type PlanningPhase = 'draft' | 'open' | 'closed';
export type Snapshot = { shifts: Shift[]; members: Member[]; version: number; planningPeriods?: Record<string, PlanningPhase> };
export type Actor = { memberId: string; role: string };
export type TimeUpdate = { id: string; start: string; end: string };
export type Command =
  | { type: 'signup' | 'withdraw'; taskId: string }
  | { type: 'assign'; taskId: string; memberId: string | null }
  | { type: 'create'; shift: Shift }
  | { type: 'generate'; shifts: Shift[] }
  | { type: 'updateTimes'; updates: TimeUpdate[] }
  | { type: 'publish'; ids: string[] }
  | { type: 'monthPhase'; month: string; phase: 'open' | 'closed' }
  | { type: 'updateMember'; member: { id: string; name: string; email: string | null; winterActive: boolean; summerActive: boolean; qualifications: string[] } }
  | { type: 'settings'; email: string };
export type Notification = { id: string; createdAt: string; member: string; task: string; shift: string; recipient: string; status: 'Demo: kein Versand' };
export const TASK_NAMES = ['Betriebswart', 'Kasse', 'Bergstation'];
export const OPTIONAL_TASK_NAMES = ['Bügel/Liftaufsicht'];
export const QUALIFICATION_NAMES = TASK_NAMES;
export function normalizeTaskName(name: string): string {
  return ({ Berghuette: 'Bergstation', 'Kasse / Buegel': 'Kasse', Liftaufsicht: 'Bügel/Liftaufsicht' } as Record<string, string>)[name] ?? name;
}
export function normalizeQualification(name: string): string {
  return ({ Berghuette: 'Bergstation', 'Kasse / Buegel': 'Kasse', Liftaufsicht: 'Bügel/Liftaufsicht', Liftbetrieb: 'Bügel/Liftaufsicht' } as Record<string, string>)[name] ?? name;
}
export const KIND_LABELS: Record<string, string> = { friday: 'Freitag', early: 'Fruehdienst', late: 'Spaetdienst', extra: 'Zusatzdienst' };
export type AssignmentSuggestion = { taskId: string; memberId: string; memberName: string; date: string; shiftTitle: string; taskName: string; missingQualification: string | null };
export type AssignmentReportRow = { member: Member; total: number; average: number; monthly: Record<string, number> };

export function reportMonths(count: number, now = new Date()): string[] {
  const safeCount = Math.max(1, Math.min(12, Math.floor(count)));
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
  return Array.from({ length: safeCount }, (_, index) => {
    const month = new Date(current);
    month.setUTCMonth(current.getUTCMonth() - safeCount + index + 1);
    return month.toISOString().slice(0, 7);
  });
}

export function assignmentReport(snapshot: Snapshot, months: string[]): AssignmentReportRow[] {
  return snapshot.members.map(member => {
    const monthly = Object.fromEntries(months.map(month => [month, snapshot.shifts
      .filter(shift => shift.date.startsWith(month))
      .reduce((total, shift) => total + shift.tasks.filter(task => task.memberId === member.id).length, 0)]));
    const total = Object.values(monthly).reduce((sum, value) => sum + value, 0);
    return { member, total, average: total / months.length, monthly };
  }).sort((first, second) => second.total - first.total || first.member.name.localeCompare(second.member.name, 'de'));
}

export function deterministicUuid(value: string): string {
  const words = [2166136261, 2246822519, 3266489917, 668265263];
  for (let index = 0; index < value.length; index++) {
    for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (value.charCodeAt(index) + lane), 16777619) >>> 0;
  }
  const hex = words.map(word => word.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function localDate(now: Date = new Date()): string { return formatInTimeZone(now, ZONE, 'yyyy-MM-dd'); }
export function localTime(value: string): string { return formatInTimeZone(value, ZONE, 'HH:mm'); }
export function seasonForDate(date: string): 'winter' | 'summer' {
  const monthDay = date.slice(5);
  return monthDay >= '11-15' || monthDay <= '03-15' ? 'winter' : 'summer';
}
export function memberSeasonStatus(member: Pick<Member, 'winterActive' | 'summerActive'>): MemberStatus {
  if (member.winterActive && member.summerActive) return 'both';
  if (member.winterActive) return 'winter';
  if (member.summerActive) return 'summer';
  return 'inactive';
}
export function instant(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Datum oder Uhrzeit ungueltig.');
  const result = fromZonedTime(`${date}T${time}:00`, ZONE);
  if (Number.isNaN(result.getTime()) || formatInTimeZone(result, ZONE, 'yyyy-MM-dd HH:mm') !== `${date} ${time}`) throw new Error('Diese lokale Uhrzeit existiert nicht.');
  return result.toISOString();
}
export function nextDate(date: string, days = 1): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function taskWindow(shift: Shift, task: Task): { start: number; end: number } {
  const start = Date.parse(shift.start) + task.offsetMinutes * 60000;
  return { start, end: task.durationMinutes === null ? Date.parse(shift.end) : start + task.durationMinutes * 60000 };
}
export function overlaps(first: { start: number; end: number }, second: { start: number; end: number }): boolean {
  return first.start < second.end && second.start < first.end;
}
export function eligibility(snapshot: Snapshot, shift: Shift, task: Task, member: Member, now = new Date()): string | null {
  if (!member.active) return 'Mitgliedszugang ist deaktiviert.';
  if (taskWindow(shift, task).start <= now.getTime()) return 'Dieser Dienst hat bereits begonnen.';
  for (const otherShift of snapshot.shifts) for (const otherTask of otherShift.tasks) {
    if (otherTask.id !== task.id && otherTask.memberId === member.id && overlaps(taskWindow(shift, task), taskWindow(otherShift, otherTask))) return `Zeitkonflikt: ${otherShift.date}, ${otherTask.name}`;
  }
  return null;
}
export function missingQualification(task: Task, member: Member): string | null {
  return task.qualification && !member.qualifications.includes(task.qualification) ? task.qualification : null;
}
export function suggestMonthlyAssignments(snapshot: Snapshot, month: string, now = new Date()): AssignmentSuggestion[] {
  const virtual: Snapshot = structuredClone(snapshot);
  const monthShifts = virtual.shifts.filter(shift => shift.date.startsWith(month));
  const availableShifts = monthShifts.filter(shift => shift.published && Date.parse(shift.start) > now.getTime()).sort((first, second) => first.start.localeCompare(second.start));
  const isActiveForSeason = (member: Member, shift: Shift) => seasonForDate(shift.date) === 'winter' ? member.winterActive : member.summerActive;
  const monthCounts = new Map(virtual.members.map(member => [member.id, monthShifts.reduce((total, shift) => total + (isActiveForSeason(member, shift) ? shift.tasks.filter(task => task.memberId === member.id).length : 0), 0)]));
  const totalCounts = new Map(virtual.members.map(member => [member.id, virtual.shifts.reduce((total, shift) => total + (isActiveForSeason(member, shift) && Date.parse(shift.start) > now.getTime() ? shift.tasks.filter(task => task.memberId === member.id).length : 0), 0)]));
  const suggestions: AssignmentSuggestion[] = [];
  for (const shift of availableShifts) for (const task of shift.tasks) {
    if (task.memberId) continue;
    const candidates = virtual.members.filter(member => member.active && isActiveForSeason(member, shift) && !eligibility(virtual, shift, task, member, now)).sort((first, second) =>
      Number(!!missingQualification(task, first)) - Number(!!missingQualification(task, second))
      || (monthCounts.get(first.id) ?? 0) - (monthCounts.get(second.id) ?? 0)
      || (totalCounts.get(first.id) ?? 0) - (totalCounts.get(second.id) ?? 0)
      || first.name.localeCompare(second.name, 'de')
    );
    const member = candidates[0];
    if (!member) continue;
    task.memberId = member.id;
    monthCounts.set(member.id, (monthCounts.get(member.id) ?? 0) + 1);
    totalCounts.set(member.id, (totalCounts.get(member.id) ?? 0) + 1);
    suggestions.push({ taskId: task.id, memberId: member.id, memberName: member.name, date: shift.date, shiftTitle: shift.title, taskName: task.name, missingQualification: missingQualification(task, member) });
  }
  return suggestions;
}
export function validateSnapshot(snapshot: Snapshot): void {
  const ids = new Set<string>();
  const assignments: { memberId: string; shift: Shift; task: Task }[] = [];
  for (const shift of snapshot.shifts) {
    if (ids.has(shift.id)) throw new Error('Doppelte Dienst-ID.');
    ids.add(shift.id);
    if (!Number.isFinite(Date.parse(shift.start)) || !Number.isFinite(Date.parse(shift.end)) || Date.parse(shift.end) <= Date.parse(shift.start)) throw new Error('Endzeit muss nach der Startzeit liegen.');
    if (localDate(new Date(shift.start)) !== shift.date || localDate(new Date(shift.end)) !== shift.date) throw new Error('Dienstzeiten muessen auf dem gewaehlten Datum liegen.');
    if (!shift.title.trim() || !shift.tasks.length) throw new Error('Titel und mindestens eine Aufgabe erforderlich.');
    for (const task of shift.tasks) {
      if (ids.has(task.id)) throw new Error('Doppelte Aufgaben-ID.');
      ids.add(task.id);
      const window = taskWindow(shift, task);
      if (!task.name.trim() || !Number.isInteger(task.offsetMinutes) || task.offsetMinutes < 0 || (task.durationMinutes !== null && (!Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0)) || window.end > Date.parse(shift.end) || window.start >= window.end) throw new Error(`Ungueltige Aufgabendauer: ${task.name}`);
      if (task.memberId) assignments.push({ memberId: task.memberId, shift, task });
    }
  }
  for (let index = 0; index < assignments.length; index++) {
    const first = assignments[index];
    for (const second of assignments.slice(index + 1)) if (first.memberId === second.memberId && overlaps(taskWindow(first.shift, first.task), taskWindow(second.shift, second.task))) throw new Error(`Zeitkonflikt: ${first.shift.date}, ${first.task.name} / ${second.task.name}`);
  }
}
export function makeShift(date: string, kind: string, start: string, end: string, names: string[], title = KIND_LABELS[kind] ?? kind, id = deterministicUuid(`${date}:${kind}`), qualifications: Record<string, string> = {}): Shift {
  return { id, date, kind, title, start: instant(date, start), end: instant(date, end), published: false, tasks: names.map((name, index) => ({ id: deterministicUuid(`${id}:task:${index}:${name}`), name, qualification: qualifications[name]?.trim() || (QUALIFICATION_NAMES.includes(name) ? name : null), offsetMinutes: 0, durationMinutes: name === 'Bügel/Liftaufsicht' && kind === 'early' ? 120 : null, memberId: null })) };
}
export function generateShifts(from: string, to: string, fridayTasks: string[], qualifications: Record<string, string> = {}, includeLift = false): Shift[] {
  if (!fridayTasks.length) throw new Error('Bitte Freitagsaufgaben ausdruecklich auswaehlen.');
  instant(from, '12:00'); instant(to, '12:00');
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new Error('Zeitraum muss zwischen 1 und 367 Tagen liegen.');
  const shifts: Shift[] = [];
  for (let date = from; date <= to; date = nextDate(date)) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (day === 5) shifts.push(makeShift(date, 'friday', '18:00', '22:00', fridayTasks, undefined, undefined, qualifications));
    if (day === 6 || day === 0) {
      shifts.push(makeShift(date, 'early', '09:30', '14:00', [...TASK_NAMES, ...(includeLift ? OPTIONAL_TASK_NAMES : [])], undefined, undefined, qualifications));
      shifts.push(makeShift(date, 'late', '14:00', '18:30', TASK_NAMES.slice(0, 3), undefined, undefined, qualifications));
    }
  }
  validateSnapshot({ shifts, members: [], version: 0 });
  return shifts;
}
export function applyCommand(snapshot: Snapshot, command: Command, actor: Actor, now = new Date(), notificationEmail = ''): { snapshot: Snapshot; notifications: Notification[] } {
  const next: Snapshot = structuredClone(snapshot);
  const notifications: Notification[] = [];
  const admin = actor.role === 'admin';
  const ensureMonthEditable = (shift: Shift) => {
    if (next.planningPeriods?.[shift.date.slice(0, 7)] === 'closed') throw new Error('Dieser Monat ist abgeschlossen und schreibgeschuetzt.');
  };
  if (!['signup', 'withdraw'].includes(command.type) && !admin) throw new Error('Nur die Administration darf diese Aktion ausfuehren.');
  if (command.type === 'signup' || command.type === 'withdraw' || command.type === 'assign') {
    const shift = next.shifts.find(item => item.tasks.some(task => task.id === command.taskId));
    const task = shift?.tasks.find(item => item.id === command.taskId);
    if (!shift || !task) throw new Error('Aufgabe nicht gefunden.');
    ensureMonthEditable(shift);
    if (taskWindow(shift, task).start <= now.getTime()) throw new Error('Dieser Dienst hat bereits begonnen.');
    if (command.type !== 'assign' && !shift.published) throw new Error('Dienst ist noch nicht veroeffentlicht.');
    if (command.type === 'withdraw') {
      if (task.memberId !== actor.memberId) throw new Error('Nur eigene Dienste koennen zurueckgegeben werden.');
      notifications.push({ id: deterministicUuid(`${task.id}:${now.toISOString()}:${snapshot.version}`), createdAt: now.toISOString(), member: next.members.find(member => member.id === actor.memberId)?.name ?? 'Mitglied', task: task.name, shift: `${shift.date} ${shift.title}`, recipient: notificationEmail, status: 'Demo: kein Versand' });
      task.memberId = null;
    } else {
      if (command.type === 'signup' && task.memberId) throw new Error('Aufgabe ist bereits besetzt.');
      const memberId = command.type === 'assign' ? command.memberId : actor.memberId;
      if (memberId) {
        const member = next.members.find(item => item.id === memberId);
        if (!member) throw new Error('Mitglied nicht gefunden.');
        const reason = eligibility(next, shift, task, member, now);
        if (reason) throw new Error(reason);
      }
      task.memberId = memberId;
    }
  } else if (command.type === 'create' || command.type === 'generate') {
    const additions = command.type === 'create' ? [command.shift] : command.shifts;
    for (const shift of additions) {
      ensureMonthEditable(shift);
      if (next.shifts.some(item => item.id === shift.id)) {
        if (command.type === 'create') throw new Error('Dienst existiert bereits.');
        continue;
      }
      if (Date.parse(shift.start) <= now.getTime()) throw new Error('Neue Dienste muessen in der Zukunft liegen.');
      if (shift.tasks.some(task => task.memberId !== null)) throw new Error('Neue Aufgaben muessen unbesetzt sein.');
      next.shifts.push(structuredClone(shift));
    }
  } else if (command.type === 'updateTimes') {
    for (const update of command.updates) {
      const shift = next.shifts.find(item => item.id === update.id);
      if (!shift) throw new Error('Dienst nicht gefunden.');
      ensureMonthEditable(shift);
      if (Date.parse(shift.start) <= now.getTime() || Date.parse(update.start) <= now.getTime()) throw new Error('Vergangene oder begonnene Dienste sind schreibgeschuetzt.');
      shift.start = update.start; shift.end = update.end;
    }
  } else if (command.type === 'publish') {
    if (!validEmail(notificationEmail)) throw new Error('Bitte zuerst die Benachrichtigungsadresse speichern.');
    for (const id of command.ids) {
      const shift = next.shifts.find(item => item.id === id);
      if (!shift) throw new Error('Dienst nicht gefunden.');
      ensureMonthEditable(shift);
      if (Date.parse(shift.start) <= now.getTime()) throw new Error('Vergangene Dienste koennen nicht veroeffentlicht werden.');
      shift.published = true;
    }
    for (const id of command.ids) {
      const shift = next.shifts.find(item => item.id === id)!;
      if (next.planningPeriods?.[shift.date.slice(0, 7)] !== 'closed') next.planningPeriods = { ...next.planningPeriods, [shift.date.slice(0, 7)]: 'open' };
    }
  } else if (command.type === 'monthPhase') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(command.month)) throw new Error('Monat ungueltig.');
    const shifts = next.shifts.filter(shift => shift.date.startsWith(command.month));
    if (!shifts.length) throw new Error('Keine Dienste fuer diesen Monat vorhanden.');
    if (command.phase === 'open') {
      if (next.planningPeriods?.[command.month] !== 'closed') throw new Error('Nur abgeschlossene Monate koennen wieder geoeffnet werden.');
      next.planningPeriods = { ...next.planningPeriods, [command.month]: 'open' };
    } else {
      const future = shifts.filter(shift => Date.parse(shift.start) > now.getTime());
      if (future.some(shift => !shift.published || shift.tasks.some(task => !task.memberId))) throw new Error('Zum Abschliessen muessen alle zukuenftigen Dienste veroeffentlicht und besetzt sein.');
      next.planningPeriods = { ...next.planningPeriods, [command.month]: 'closed' };
    }
  } else if (command.type === 'updateMember') {
    const existing = next.members.find(member => member.id === command.member.id);
    if (!command.member.name.trim() || (command.member.email && !validEmail(command.member.email))) throw new Error('Name und gueltige E-Mail erforderlich.');
    const member: Member = { ...existing, ...command.member, email: command.member.email ?? undefined, status: memberSeasonStatus(command.member), active: true, qualifications: [...new Set(command.member.qualifications.map(value => value.trim()).filter(Boolean))] };
    if (existing) Object.assign(existing, member); else next.members.push(member);
  } else if (command.type === 'settings' && !validEmail(command.email)) throw new Error('Bitte eine gueltige E-Mail angeben.');
  validateSnapshot(next);
  next.version++;
  return { snapshot: next, notifications };
}
export function validEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
export function previewTimes(snapshot: Snapshot, updates: TimeUpdate[], actor: Actor, now = new Date()): string[] {
  try { applyCommand(snapshot, { type: 'updateTimes', updates }, actor, now); return []; } catch (error) { return [error instanceof Error ? error.message : 'Aenderung ungueltig.']; }
}
export function demoSeed(now = new Date()): Snapshot {
  const date = localDate(now);
  const from = `${date.slice(0, 7)}-01`;
  const boundary = new Date(`${from}T12:00:00Z`);
  boundary.setUTCMonth(boundary.getUTCMonth() + 2);
  const to = nextDate(boundary.toISOString().slice(0, 10), -1);
  const members: Member[] = Array.from({ length: 8 }, (_, index) => { const winterActive = index !== 7 && index % 2 === 0; const summerActive = index !== 7 && (index % 2 === 1 || index === 0); return { id: deterministicUuid(`demo-member-${index}`), name: index === 0 ? 'Demo Verwaltung' : `Demo Mitglied ${index}`, email: `demo${index}@example.invalid`, role: index === 0 ? 'admin' : 'member', winterActive, summerActive, status: memberSeasonStatus({ winterActive, summerActive }), active: true, qualifications: index % 2 ? ['Bügel/Liftaufsicht'] : ['Betriebswart', 'Kasse', 'Bergstation'] }; });
  const shifts = generateShifts(from, to, TASK_NAMES.slice(0, 3));
  shifts.forEach((shift, index) => {
    shift.published = index % 7 !== 0;
    if (Date.parse(shift.start) > now.getTime()) {
      shift.tasks[0].memberId = members[1 + index % 5].id;
      if (index % 3 === 0) shift.tasks[1].memberId = members[6].id;
    }
  });
  return { shifts, members, version: 0 };
}