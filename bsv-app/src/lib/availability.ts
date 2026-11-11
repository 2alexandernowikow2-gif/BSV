import { localDate, seasonForDate, type AvailabilityException } from './domain';

export type AvailabilityMember = { id: string; name: string; winterActive: boolean; summerActive: boolean };
export type AvailabilityDay = { date: string; count: number; published: boolean; mixed: boolean; assigned: boolean; assignedMemberIds?: string[] };
export type AvailabilityData = { memberId: string; admin: boolean; members: AvailabilityMember[]; days: AvailabilityDay[]; exceptions: AvailabilityException[] };
export function serviceDatesInRange(days: AvailabilityDay[], from: string, to: string, now = new Date()): string[] {
  if (!from || !to || from > to) throw new Error('Bitte einen gueltigen Zeitraum waehlen.');
  return days.filter(day => day.date >= localDate(now) && day.date >= from && day.date <= to).map(day => day.date);
}
export function dayMembers(data: AvailabilityData, date: string): AvailabilityMember[] {
  return data.members.filter(member => seasonForDate(date) === 'winter' ? member.winterActive : member.summerActive);
}