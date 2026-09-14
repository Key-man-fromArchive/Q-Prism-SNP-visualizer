import { afterEach, describe, expect, it } from 'vitest';
import { groupSessionsByDate, localDateKey, monthGrid, parseUploadedAtUtc } from './session-calendar';
import type { SessionListItem } from '@/types/api';

const originalTz = process.env.TZ;
afterEach(() => { process.env.TZ = originalTz; });

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return { session_id: 's', instrument: 'CFX Opus', num_wells: 96, num_cycles: 40, uploaded_at: '2026-09-14 04:55:29', ...overrides };
}

describe('parseUploadedAtUtc', () => {
  it('anchors the backend\'s space-separated wall-clock string as UTC, not local time', () => {
    process.env.TZ = 'Asia/Seoul';
    const date = parseUploadedAtUtc('2026-09-14 04:55:29');
    expect(date?.toISOString()).toBe('2026-09-14T04:55:29.000Z');
  });
  it('accepts a bare date (already unambiguous UTC per the Date spec)', () => {
    const date = parseUploadedAtUtc('2026-09-07');
    expect(date?.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });
  it('trusts a string that already carries an explicit UTC marker', () => {
    const date = parseUploadedAtUtc('2026-09-14T04:55:29Z');
    expect(date?.toISOString()).toBe('2026-09-14T04:55:29.000Z');
  });
  it('returns null for empty or unparseable input instead of throwing', () => {
    expect(parseUploadedAtUtc('')).toBeNull();
    expect(parseUploadedAtUtc('not a date')).toBeNull();
  });
});

describe('localDateKey', () => {
  it('formats using the runtime local calendar day, not UTC', () => {
    process.env.TZ = 'Asia/Seoul';
    // 20:00 UTC on the 13th is 05:00 KST on the 14th -- a dawn upload that
    // must not be filed under the previous day.
    const date = parseUploadedAtUtc('2026-09-13 20:00:00')!;
    expect(localDateKey(date)).toBe('2026-09-14');
  });
  it('does not roll the date backward for a UTC evening timestamp read in UTC', () => {
    process.env.TZ = 'UTC';
    const date = parseUploadedAtUtc('2026-09-13 20:00:00')!;
    expect(localDateKey(date)).toBe('2026-09-13');
  });
});

describe('groupSessionsByDate', () => {
  it('buckets sessions by their local upload day, preserving newest-first order within a day', () => {
    process.env.TZ = 'Asia/Seoul';
    const a = session({ session_id: 'a', uploaded_at: '2026-08-31 23:00:00' });
    const b = session({ session_id: 'b', uploaded_at: '2026-08-31 01:00:00' });
    const c = session({ session_id: 'c', uploaded_at: '2026-08-30 12:00:00' });
    const groups = groupSessionsByDate([a, b, c]);
    expect([...groups.keys()].sort()).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    expect(groups.get('2026-09-01')?.map(s => s.session_id)).toEqual(['a']);
    expect(groups.get('2026-08-31')?.map(s => s.session_id)).toEqual(['b']);
  });
  it('drops entries whose uploaded_at cannot be parsed instead of crashing', () => {
    const groups = groupSessionsByDate([session({ session_id: 'bad', uploaded_at: 'garbage' })]);
    expect(groups.size).toBe(0);
  });
  it('handles an empty session list', () => {
    expect(groupSessionsByDate([]).size).toBe(0);
  });
  it('keeps all 9 same-day sessions in one bucket', () => {
    const nine = Array.from({ length: 9 }, (_, i) => session({ session_id: `s${i}`, uploaded_at: `2026-08-31 0${i}:00:00` }));
    const groups = groupSessionsByDate(nine);
    expect(groups.get('2026-08-31')).toHaveLength(9);
  });
});

describe('monthGrid', () => {
  it('covers the full month in whole weeks starting Monday, marking days outside the month', () => {
    const weeks = monthGrid(2026, 8); // September 2026 (0-indexed month)
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    for (const week of weeks) expect(week).toHaveLength(7);
    const flat = weeks.flat();
    expect(flat[0].date.getDay()).toBe(1); // Monday
    const sep1 = flat.find(day => day.dateKey === '2026-09-01');
    expect(sep1?.inMonth).toBe(true);
    const sep30 = flat.find(day => day.dateKey === '2026-09-30');
    expect(sep30?.inMonth).toBe(true);
    const leading = flat[0];
    if (leading.dateKey !== '2026-09-01') expect(leading.inMonth).toBe(false);
  });
  it('produces contiguous, non-repeating date keys across the whole grid', () => {
    const flat = monthGrid(2026, 1).flat(); // February 2026
    const keys = flat.map(day => day.dateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
