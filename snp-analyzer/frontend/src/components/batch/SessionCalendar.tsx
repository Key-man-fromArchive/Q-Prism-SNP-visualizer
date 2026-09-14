// @TASK P29-CALENDAR - Calendar view of past sessions
// @SPEC 사용자 요청 "이전작업내역을 달력형태로 볼 수 있으면 좋겠습니다" (feedback-2026-09-11)
// @TEST src/components/batch/SessionCalendar.test.tsx
import { useMemo, useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { groupSessionsByDate, localDateKey, monthGrid, parseUploadedAtUtc } from '@/lib/session-calendar';
import { navigateGrid } from '@/lib/tab-keyboard';
import type { SessionListItem } from '@/types/api';

export type SessionCalendarProps = {
  sessions: SessionListItem[];
  onOpen: (sessionId: string) => void;
  activeSessionId?: string | null;
};

// Monday-first weekday order, expressed as JS's native 0=Sun..6=Sat indices,
// so it stays consistent with `monthGrid`'s Monday-first layout while still
// letting the translation function key off the everyday Sun..Sat numbering.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function initialViewDate(sessions: SessionListItem[]): Date {
  let latest: Date | null = null;
  for (const s of sessions) {
    const parsed = parseUploadedAtUtc(s.uploaded_at);
    if (parsed && (!latest || parsed > latest)) latest = parsed;
  }
  const base = latest ?? new Date();
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

export function SessionCalendar({ sessions, onOpen, activeSessionId }: SessionCalendarProps) {
  const { t } = useI18n();
  const [viewDate, setViewDate] = useState(() => initialViewDate(sessions));
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const groups = useMemo(() => groupSessionsByDate(sessions), [sessions]);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const monthTotal = weeks.flat().reduce((sum, day) => sum + (day.inMonth ? (groups.get(day.dateKey)?.length ?? 0) : 0), 0);
  const firstInMonthKey = weeks.flat().find(day => day.inMonth)?.dateKey;
  const focusableKey = (selectedDateKey && weeks.flat().some(day => day.inMonth && day.dateKey === selectedDateKey))
    ? selectedDateKey
    : firstInMonthKey;

  const goTo = (nextYear: number, nextMonth: number) => { setViewDate(new Date(nextYear, nextMonth, 1)); setSelectedDateKey(null); };
  const prevMonth = () => goTo(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  const nextMonth = () => goTo(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
  const goToday = () => { const now = new Date(); goTo(now.getFullYear(), now.getMonth()); };

  const selectedSessions = selectedDateKey ? (groups.get(selectedDateKey) ?? []) : null;
  const selectedLabel = selectedDateKey
    ? (() => { const [y, m, d] = selectedDateKey.split('-').map(Number); return t.calendarDateLabel(y, m - 1, d); })()
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t.calendarPrevMonth} onClick={prevMonth}
            className="rounded-md border border-border bg-surface w-7 h-7 text-text hover:border-primary cursor-pointer">‹</button>
          <span aria-live="polite" className="text-sm font-medium text-text min-w-[9rem] text-center">{t.calendarMonthLabel(year, month)}</span>
          <button type="button" aria-label={t.calendarNextMonth} onClick={nextMonth}
            className="rounded-md border border-border bg-surface w-7 h-7 text-text hover:border-primary cursor-pointer">›</button>
        </div>
        <button type="button" onClick={goToday}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-muted hover:border-primary hover:text-text cursor-pointer">
          {t.calendarToday}
        </button>
      </div>

      {monthTotal === 0 && <p className="text-text-muted text-sm mb-2">{t.calendarNoSessionsMonth}</p>}

      <div role="grid" aria-label={t.calendarGridLabel} onKeyDown={event => navigateGrid(event, 7)}
        className="grid grid-cols-7 gap-1">
        <div role="row" style={{ display: 'contents' }}>
          {WEEKDAY_ORDER.map(day => (
            <div key={day} role="columnheader" className="text-center text-[11px] font-medium text-text-muted py-1">
              {t.calendarWeekdayShort(day)}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div role="row" key={weekIndex} style={{ display: 'contents' }}>
            {week.map(day => {
              const count = day.inMonth ? (groups.get(day.dateKey)?.length ?? 0) : 0;
              const hasSessions = count > 0;
              const isSelected = selectedDateKey === day.dateKey;
              const isToday = day.dateKey === todayKey;
              const label = day.inMonth
                ? `${t.calendarDateLabel(day.date.getFullYear(), day.date.getMonth(), day.date.getDate())}${hasSessions ? `, ${t.calendarDayHasSessions(count)}` : ''}`
                : '';
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  role="gridcell"
                  disabled={!day.inMonth}
                  aria-selected={isSelected}
                  aria-label={label}
                  tabIndex={day.inMonth && day.dateKey === focusableKey ? 0 : -1}
                  onClick={() => day.inMonth && setSelectedDateKey(day.dateKey)}
                  className={`
                    relative flex flex-col items-center justify-center gap-0.5 rounded-md border text-xs h-11
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
                    ${!day.inMonth ? 'border-transparent text-text-muted/30 cursor-default' :
                      isSelected ? 'border-primary bg-primary/10 text-primary font-medium cursor-pointer' :
                      'border-border bg-surface text-text hover:border-primary cursor-pointer'}
                    ${isToday && day.inMonth && !isSelected ? 'border-primary/60' : ''}
                  `}
                >
                  <span aria-hidden="true">{day.date.getDate()}</span>
                  {hasSessions && (
                    <span aria-hidden="true" className="text-[10px] leading-none rounded-full bg-primary text-on-primary px-1.5 py-0.5 min-w-[1.1rem]">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selectedDateKey === null ? (
        <p className="text-text-muted text-sm mt-3">{t.calendarNoDateSelected}</p>
      ) : (
        <div className="mt-3" data-testid="calendar-day-sessions">
          <h4 className="text-xs font-medium text-text-muted mb-1.5">{selectedLabel}</h4>
          {selectedSessions && selectedSessions.length > 0 ? (
            <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto">
              {selectedSessions.map(s => (
                <li key={s.session_id}>
                  <button type="button" onClick={() => onOpen(s.session_id)}
                    title={s.raw_filename || s.session_id}
                    className="w-full flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-left text-xs text-text hover:border-primary">
                    <span className="truncate">{s.raw_filename || s.instrument}</span>
                    <span className="text-text-muted shrink-0"> · {s.instrument} · {s.num_wells}{t.wells}</span>
                    {activeSessionId === s.session_id && <span className="text-[10px] text-primary font-medium shrink-0">({t.active})</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-muted text-sm">{t.calendarNoSessionsOnDate}</p>
          )}
        </div>
      )}
    </div>
  );
}
