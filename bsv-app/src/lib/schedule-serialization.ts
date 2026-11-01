import { instant, localTime, type Command, type Shift, type Snapshot } from './domain';

function shiftToDatabase(shift: Shift): Shift {
  return { ...shift,start:localTime(shift.start),end:localTime(shift.end) };
}

function shiftFromDatabase(shift: Shift): Shift {
  const start = /^\d{4}-\d{2}-\d{2}T/.test(shift.start) ? shift.start : instant(shift.date,shift.start);
  const end = /^\d{4}-\d{2}-\d{2}T/.test(shift.end) ? shift.end : instant(shift.date,shift.end);
  return { ...shift,start,end };
}

export function commandToDatabase(command: Command): Command {
  if (command.type === 'create') return { ...command,shift:shiftToDatabase(command.shift) };
  if (command.type === 'generate') return { ...command,shifts:command.shifts.map(shiftToDatabase) };
  if (command.type === 'updateTimes') return { ...command,updates:command.updates.map(update => ({ ...update,start:localTime(update.start),end:localTime(update.end) })) };
  return command;
}

export function snapshotFromDatabase(snapshot: Snapshot): Snapshot {
  return { ...snapshot,shifts:snapshot.shifts.map(shiftFromDatabase) };
}