// @TASK P29-CALENDAR - Calendar view of past sessions
// @SPEC 사용자 요청 "이전작업내역을 달력형태로 볼 수 있으면 좋겠습니다" (feedback-2026-09-11)
// @TEST src/components/batch/SessionCalendar.test.tsx
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
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
  const activeDays = weeks.flat().filter(day => day.inMonth && groups.has(day.dateKey)).length;
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
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-bg p-3 sm:p-4">
        <div>
          <h3 aria-live="polite" className="text-xl font-semibold tracking-tight text-text">{t.calendarMonthLabel(year, month)}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            {monthTotal > 0 ? <>
              <span className="font-semibold text-text">{t.calendarDayHasSessions(monthTotal)}</span>
              <span>{t.calendarActiveDays(activeDays)}</span>
            </> : t.calendarNoSessionsMonth}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label={t.calendarPrevMonth} onClick={prevMonth}
            className="flex size-9 items-center justify-center rounded-md border border-text-muted bg-surface text-text hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={goToday}
            className="h-9 rounded-md border border-text-muted bg-surface px-3 text-sm font-medium text-text hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer">
            {t.calendarToday}
          </button>
          <button type="button" aria-label={t.calendarNextMonth} onClick={nextMonth}
            className="flex size-9 items-center justify-center rounded-md border border-text-muted bg-surface text-text hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div role="grid" aria-label={t.calendarGridLabel} onKeyDown={event => navigateGrid(event, 7)}
        className="grid grid-cols-7 gap-1.5 sm:gap-2">
        <div role="row" style={{ display: 'contents' }}>
          {WEEKDAY_ORDER.map(day => (
            <div key={day} role="columnheader" className="text-center text-xs font-medium text-text-muted pb-1">
              {t.calendarWeekdayShort(day)}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div role="row" key={weekIndex} style={{ display: 'contents' }}>
            {week.map(day => {
              const count = day.inMonth ? (groups.get(day.dateKey)?.length ?? 0) : 0;
              const hasSessions = count > 0;
              // Fixed thresholds make workload comparable across months.
              const density = count >= 6 ? 3 : count >= 3 ? 2 : 1;
              const densityBackground = count >= 6 ? 'bg-primary/20' : count >= 3 ? 'bg-primary/12' : 'bg-primary/5';
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
                  aria-current={isToday && day.inMonth ? 'date' : undefined}
                  aria-label={label}
                  tabIndex={day.inMonth && day.dateKey === focusableKey ? 0 : -1}
                  onClick={() => day.inMonth && setSelectedDateKey(day.dateKey)}
                  className={`
                    relative flex min-w-0 flex-col items-start justify-between rounded-md border p-1 text-xs h-16 sm:p-2
                    focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                    ${!day.inMonth ? 'border-transparent text-text-muted cursor-default' :
                      hasSessions ? `border-primary ${densityBackground} text-text cursor-pointer` :
                      'border-transparent bg-bg text-text-muted cursor-pointer'}
                    ${isSelected && day.inMonth ? 'ring-2 ring-inset ring-text' : ''}
                    ${day.inMonth ? 'hover:outline hover:outline-1 hover:outline-primary' : ''}
                  `}
                >
                  <span aria-hidden="true" className={`flex size-5 shrink-0 sm:size-6 items-center justify-center rounded-full text-xs sm:text-sm ${isToday && day.inMonth ? 'bg-primary text-on-primary font-bold' : hasSessions ? 'font-semibold' : ''}`}>
                    {day.date.getDate()}
                  </span>
                  {hasSessions && (
                    <span aria-hidden="true" className="flex w-full items-end justify-between gap-1 max-[400px]:flex-col-reverse max-[400px]:items-start">
                      <span className="flex gap-0.5 sm:gap-1">
                        {Array.from({ length: density }, (_, i) => <span key={i} className="h-1 w-1 rounded-full bg-primary sm:w-3" />)}
                      </span>
                      <span className="font-semibold leading-none tabular-nums text-text">{count}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-text-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-primary" />{t.calendarToday}</span>
        <div className="flex flex-wrap items-center gap-3" aria-label={t.calendarDensityLabel}>
          <span>{t.calendarDensityLabel}</span>
          {[t.calendarDensityLow, t.calendarDensityMedium, t.calendarDensityHigh].map((label, index) => (
            <span key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="flex gap-0.5">
                {Array.from({ length: index + 1 }, (_, i) => <span key={i} className="h-1 w-1.5 rounded-full bg-primary" />)}
              </span>
              {label}
            </span>
          ))}
        </div>
      </div>

      {selectedDateKey === null ? (
        <p className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-bg px-3 py-5 text-sm text-text-muted">
          <CalendarDays size={18} aria-hidden="true" className="shrink-0" />{t.calendarNoDateSelected}
        </p>
      ) : (
        <div className="mt-4 border-t border-border pt-4" data-testid="calendar-day-sessions">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-text">{selectedLabel}</h4>
            {selectedSessions && selectedSessions.length > 0 && <span className="text-xs text-text-muted">{t.calendarDayHasSessions(selectedSessions.length)}</span>}
          </div>
          {selectedSessions && selectedSessions.length > 0 ? (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto p-1">
              {selectedSessions.map(s => (
                <li key={s.session_id}>
                  <button type="button" onClick={() => onOpen(s.session_id)}
                    title={s.raw_filename || s.session_id}
                    className="group flex w-full min-w-0 items-center gap-3 rounded-md border border-text-muted bg-surface p-3 text-left text-sm text-text hover:border-primary hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer">
                    <span aria-hidden="true" className="hidden size-10 shrink-0 items-center justify-center rounded-md bg-bg text-primary sm:flex"><FileText size={20} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold group-hover:underline">{s.raw_filename || s.instrument}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        <span>{s.instrument}</span>
                        <span>{s.num_wells} {t.wells}</span>
                        {activeSessionId === s.session_id && <span className="font-semibold text-primary">({t.active})</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                      <span className="hidden sm:inline">{t.calendarOpen}</span><ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-bg px-3 py-5 text-sm text-text-muted">{t.calendarNoSessionsOnDate}</p>
          )}
        </div>
      )}
    </div>
  );
}
