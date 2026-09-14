// @TASK P29-CALENDAR - Past-work calendar: pure date/grouping helpers
// @SPEC 사용자 요청 "이전작업내역을 달력형태로 볼 수 있으면 좋겠습니다" (feedback-2026-09-11)
// No date library is added (see task constraints); this module is the whole
// date surface the calendar needs, kept pure and unit-tested on its own.
import type { SessionListItem } from '@/types/api';

/**
 * `GET /api/sessions` returns `uploaded_at` as a UTC wall-clock string, e.g.
 * `"2026-09-14 04:55:29"` -- space-separated, no timezone marker. That exact
 * shape is NOT the ISO 8601 form the Date constructor's spec-guaranteed
 * parsing covers: browsers fall back to a non-standard parse that treats it
 * as *local* time (verified against this repo's actual engine). Read as
 * local time in a KST browser, a dawn upload would silently jump to the
 * previous calendar day and the user could never find it there.
 *
 * We anchor every unmarked string as UTC explicitly instead of trusting the
 * engine's fallback. A bare date (`"2026-09-07"`) is left alone -- that form
 * *is* spec-defined as UTC midnight, so no correction is needed. A string
 * that already carries an explicit `Z`/offset is trusted as-is.
 */
export function parseUploadedAtUtc(raw: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasExplicitOffset = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const iso = hasExplicitOffset
    ? trimmed
    : trimmed.includes(' ')
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed.includes('T')
        ? `${trimmed}Z`
        : trimmed;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Local (browser-timezone) calendar-day key, `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Groups sessions by their local upload day. Entries whose `uploaded_at`
 * cannot be parsed are dropped from the calendar (they remain visible in
 * the existing table view, which renders the raw list unfiltered) rather
 * than throwing or corrupting a bucket.
 */
export function groupSessionsByDate(sessions: SessionListItem[]): Map<string, SessionListItem[]> {
  const groups = new Map<string, SessionListItem[]>();
  for (const item of sessions) {
    const date = parseUploadedAtUtc(item.uploaded_at);
    if (!date) continue;
    const key = localDateKey(date);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item); else groups.set(key, [item]);
  }
  return groups;
}

export type CalendarDay = { date: Date; dateKey: string; inMonth: boolean };

/**
 * Full-week calendar grid (Monday-first, matching KR convention) for the
 * given `year`/`month` (0-indexed), padded with the adjacent months' days
 * so every week has 7 entries.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const firstOfMonth = new Date(year, month, 1);
  // getDay(): 0=Sun..6=Sat. Convert to a Monday-first offset (0=Mon..6=Sun).
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);

  const lastOfMonth = new Date(year, month + 1, 0);
  const trailingOffset = (7 - ((lastOfMonth.getDay() + 6) % 7) - 1) % 7;
  const totalDays = mondayOffset + lastOfMonth.getDate() + trailingOffset;

  const days: CalendarDay[] = Array.from({ length: totalDays }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { date, dateKey: localDateKey(date), inMonth: date.getMonth() === month };
  });

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}
