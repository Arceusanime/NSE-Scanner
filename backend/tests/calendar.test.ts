import { describe, expect, it } from 'vitest';
import { defaultSessionDate, isTradingDay, isValidDate, previousSession, resolveSession, todayIST } from '../src/services/calendar.js';

describe('IST sample calendar', () => {
  it('uses IST midnight rather than the host timezone and skips holidays/weekends', () => {
    expect(todayIST(new Date('2025-01-15T18:29:59Z'))).toBe('2025-01-15');
    expect(todayIST(new Date('2025-01-15T18:30:00Z'))).toBe('2025-01-16');
    expect(defaultSessionDate(new Date('2025-01-15T18:30:00Z'))).toBe('2025-01-15');
    expect(defaultSessionDate(new Date('2025-08-18T06:00:00Z'))).toBe('2025-08-14');
  });

  it('resolves weekends to the preceding session while exposing explicit holidays', () => {
    expect(resolveSession('2025-08-17')).toEqual({ requestedDate: '2025-08-17', date: '2025-08-14', previousSessionDate: '2025-08-13', holiday: false });
    expect(resolveSession('2025-08-15')).toEqual({ requestedDate: '2025-08-15', date: '2025-08-15', previousSessionDate: '2025-08-14', holiday: true });
  });

  it.each([
    ['2025-01-20', '2025-01-17'], // Monday follows a weekend.
    ['2025-08-18', '2025-08-14'], // Monday follows the Friday holiday.
    ['2025-10-23', '2025-10-20'], // Consecutive configured holidays.
    ['2026-01-27', '2026-01-23'], // Monday holiday follows a weekend.
    ['2025-01-01', '2024-12-31'], // Year boundary.
  ])('uses the immediately preceding open session for %s', (date, expected) => {
    expect(previousSession(date)).toBe(expected);
    expect(previousSession(previousSession(date)) < expected).toBe(true);
    expect(isTradingDay(expected)).toBe(true);
  });

  it('resolves a weekend after consecutive holidays without reusing the selected session as its reference', () => {
    expect(resolveSession('2025-10-26')).toEqual({
      requestedDate: '2025-10-26', date: '2025-10-24', previousSessionDate: '2025-10-23', holiday: false
    });
  });

  it('handles the public lower date boundary without an unbounded calendar search', () => {
    expect(resolveSession('1970-01-01').previousSessionDate).toBe('1969-12-31');
    expect(previousSession('1969-12-31')).toBe('1969-12-30');
    expect(isValidDate('2100-12-31')).toBe(true);
  });

  it.each(['2025-02-29', '2025-02-30', '2025-13-01', 'not-a-date', '1969-12-31', '2101-01-01'])('rejects an invalid public date %s', (date) => {
    expect(isValidDate(date)).toBe(false);
    expect(() => resolveSession(date)).toThrow(/Invalid date/);
  });

  it('does not classify impossible calendar dates as trading days', () => {
    expect(isTradingDay('2025-02-30')).toBe(false);
    expect(isTradingDay('2024-02-29')).toBe(true);
    expect(() => previousSession('not-a-date')).toThrow(/Invalid date/);
  });
});
