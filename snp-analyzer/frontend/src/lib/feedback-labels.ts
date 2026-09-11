// @TASK feat/user-feedback — pure label/format helpers shared by the feedback
// widget and the admin triage panel. Kept in a component-free module so
// react-refresh stays happy (same reason as components/shared/ui/variants.ts).

import type { Translations } from '@/locales/en';
import type { FeedbackCategory, FeedbackStatus } from '@/types/api';

/** Submission order in the widget: most reports are bugs. */
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  'bug',
  'feature',
  'improvement',
  'question',
  'other',
] as const;

/** Triage order in the admin panel: the way an item moves through it. */
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;

export function feedbackCategoryLabel(t: Translations, category: FeedbackCategory | string): string {
  switch (category) {
    case 'bug':
      return t.feedbackCategoryBug;
    case 'feature':
      return t.feedbackCategoryFeature;
    case 'improvement':
      return t.feedbackCategoryImprovement;
    case 'question':
      return t.feedbackCategoryQuestion;
    case 'other':
      return t.feedbackCategoryOther;
    default:
      return category;
  }
}

export function feedbackStatusLabel(t: Translations, status: FeedbackStatus | string): string {
  switch (status) {
    case 'open':
      return t.feedbackStatusOpen;
    case 'in_progress':
      return t.feedbackStatusInProgress;
    case 'resolved':
      return t.feedbackStatusResolved;
    case 'closed':
      return t.feedbackStatusClosed;
    default:
      return status;
  }
}

/** Badge classes per status, using the app's colour tokens so both themes
 *  stay correct (no raw hex). */
export function feedbackStatusClasses(status: FeedbackStatus | string): string {
  switch (status) {
    case 'open':
      return 'bg-primary/10 text-primary border-primary/30';
    case 'in_progress':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'resolved':
      return 'bg-accent/10 text-accent border-accent/30';
    default:
      return 'bg-bg text-text-muted border-border';
  }
}

/**
 * Formats a timestamp written by SQLite's `datetime('now')`.
 *
 * Those values look like "2026-09-11 04:05:06" — UTC, but with no zone
 * marker, which `new Date()` would read as LOCAL time and shift by the
 * operator's offset. The zone is restored before parsing so a report filed
 * five minutes ago does not display as nine hours ago.
 */
export function formatFeedbackTimestamp(
  value: string | null | undefined,
  language?: string
): string {
  if (!value) return '';
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Human file size for a screenshot chip. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
