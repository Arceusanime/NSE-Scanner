/** Limited mock calendar, NOT an authoritative NSE exchange holiday calendar. */
export const SAMPLE_HOLIDAYS = new Set([
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21',
  '2025-10-22', '2025-11-05', '2025-12-25', '2026-01-26', '2026-03-03', '2026-03-26',
  '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01', '2026-08-15', '2026-10-02', '2026-12-25'
]);
export const CALENDAR_NOTE = 'Limited sample holidays and weekends only; not an authoritative NSE calendar.';

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function isValidDate(date: string): boolean {
  return isCalendarDate(date) && date >= '1970-01-01' && date <= '2100-12-31';
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}
// Calendar arithmetic must extend before the public query range: 1970-01-01
// has a valid previous session in 1969. Applying query bounds here never terminates.
export function isTradingDay(date: string): boolean { return isCalendarDate(date) && !isWeekend(date) && !SAMPLE_HOLIDAYS.has(date); }
export function previousSession(date: string): string {
  if (!isCalendarDate(date) || date <= '0001-01-01') throw new Error('Invalid date for previous session');
  let previous = shiftDate(date, -1);
  while (!isTradingDay(previous)) previous = shiftDate(previous, -1);
  return previous;
}
export function todayIST(now = new Date()): string { return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10); }
export function defaultSessionDate(now = new Date()): string { return previousSession(todayIST(now)); }
export interface ResolvedDate { requestedDate: string; date: string; previousSessionDate: string; holiday: boolean; }
export function resolveSession(requestedDate: string): ResolvedDate {
  if (!isValidDate(requestedDate)) throw new Error('Invalid date; expected a real YYYY-MM-DD date between 1970 and 2100');
  // Explicit sample holidays are visibly unavailable; weekend requests resolve to a session.
  const holiday = SAMPLE_HOLIDAYS.has(requestedDate);
  const date = !holiday && isWeekend(requestedDate) ? previousSession(requestedDate) : requestedDate;
  return { requestedDate, date, previousSessionDate: previousSession(date), holiday };
}
export function sessionStart(date: string): number { return Date.parse(`${date}T03:45:00.000Z`); }
export function sessionEnd(date: string): number { return Date.parse(`${date}T10:00:00.000Z`); }
