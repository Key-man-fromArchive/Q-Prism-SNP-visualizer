// @TASK feat/user-feedback — admin triage surface for everything users filed.
// @SPEC Admin-only: the backend gates GET /api/feedback, /stats and PATCH on
//       AdminUser, which is refused outright in ASG launch mode (that session
//       has no local administration). The tab is hidden for non-admins; this
//       panel still handles a 403 rather than showing a broken list.
// @TEST tests/19-feedback.spec.ts

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { getFeedbackStats, listFeedback, updateFeedback } from "@/lib/api";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  feedbackCategoryLabel,
  feedbackStatusClasses,
  feedbackStatusLabel,
  formatFeedbackTimestamp,
} from "@/lib/feedback-labels";
import { Button, Callout, IconButton, StatusState } from "@/components/shared/ui";
import { FeedbackThread, FeedbackThreadSummary } from "@/components/feedback/FeedbackThread";
import type {
  FeedbackCategory,
  FeedbackItem,
  FeedbackStats,
  FeedbackStatus,
} from "@/types/api";

const PER_PAGE = 20;

export function FeedbackAdminPanel() {
  const { t, language } = useI18n();

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "">("");
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, nextStats] = await Promise.all([
        listFeedback({
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
          page,
          per_page: PER_PAGE,
        }),
        getFeedbackStats(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(nextStats);
      setForbidden(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.errFeedbackLoad;
      // 403 here is a mode/role fact, not a failure worth a retry button.
      if (/403|admin/i.test(message)) setForbidden(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, page, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Applies one admin change and folds the server's copy back into the list,
   *  so the row shows what was stored rather than what was typed. */
  async function applyUpdate(
    id: string,
    patch: { status?: FeedbackStatus; admin_note?: string }
  ) {
    setError(null);
    try {
      const updated = await updateFeedback(id, patch);
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setStats(await getFeedbackStats());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errFeedbackUpdate);
      return false;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (forbidden) {
    return (
      <div className="px-6 py-4">
        <Callout tone="info">{t.feedbackAdminOnly}</Callout>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatCard label={t.feedbackStatsTotal} value={stats?.total ?? 0} />
        {FEEDBACK_STATUSES.map((status) => (
          <StatCard
            key={status}
            label={feedbackStatusLabel(t, status)}
            value={stats ? stats[status] : 0}
            highlight={status === "open"}
          />
        ))}
        <IconButton
          aria-label={t.retry}
          title={t.retry}
          onClick={() => void refresh()}
          className="ml-auto"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">{t.feedbackStatusLabel}</span>
          <select
            value={statusFilter}
            data-testid="feedback-filter-status"
            onChange={(e) => {
              setStatusFilter(e.target.value as FeedbackStatus | "");
              setPage(1);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
          >
            <option value="">{t.feedbackFilterAll}</option>
            {FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {feedbackStatusLabel(t, status)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">{t.feedbackCategory}</span>
          <select
            value={categoryFilter}
            data-testid="feedback-filter-category"
            onChange={(e) => {
              setCategoryFilter(e.target.value as FeedbackCategory | "");
              setPage(1);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
          >
            <option value="">{t.feedbackFilterAll}</option>
            {FEEDBACK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {feedbackCategoryLabel(t, category)}
                {stats?.by_category?.[category] ? ` (${stats.by_category[category]})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <Callout tone="danger" actions={<Button size="sm" variant="secondary" onClick={() => void refresh()}>{t.retry}</Button>}>
          {error}
        </Callout>
      )}

      {loading && items.length === 0 ? (
        <StatusState variant="loading" message={t.loading} />
      ) : items.length === 0 ? (
        <StatusState variant="empty" message={t.feedbackEmptyAll} />
      ) : (
        <div className="flex flex-col gap-2" data-testid="feedback-admin-list">
          {items.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              language={language}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onUpdate={applyUpdate}
              onCommented={() => void refresh()}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t.feedbackPrev}
          </Button>
          <span className="text-xs text-text-muted">{t.feedbackPage(page, totalPages)}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t.feedbackNext}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`min-w-[92px] rounded-md border px-3 py-2 ${
        highlight ? "border-primary/30 bg-primary/5" : "border-border bg-surface"
      }`}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-lg font-semibold text-text">{value}</p>
    </div>
  );
}

function FeedbackRow({
  item,
  language,
  expanded,
  onToggle,
  onUpdate,
  onCommented,
}: {
  item: FeedbackItem;
  language: string;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (
    id: string,
    patch: { status?: FeedbackStatus; admin_note?: string }
  ) => Promise<boolean>;
  onCommented: () => void;
}) {
  const { t } = useI18n();
  // null means "no local edit": the textarea shows whatever is stored, so a
  // fresher copy of the row (another admin's edit, a refresh) flows straight
  // through without an effect to re-sync it.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const storedNote = item.admin_note ?? "";
  const note = noteDraft ?? storedNote;

  async function saveNote() {
    setSavingNote(true);
    setNoteSaved(false);
    const ok = await onUpdate(item.id, { admin_note: note });
    setSavingNote(false);
    if (ok) {
      // Hand the field back to the stored value the server just confirmed.
      setNoteDraft(null);
      setNoteSaved(true);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-[200px] flex-1 flex-col gap-1 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] ${feedbackStatusClasses(item.status)}`}
            >
              {feedbackStatusLabel(t, item.status)}
            </span>
            <span className="flex-1 truncate text-sm font-medium text-text">{item.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>{feedbackCategoryLabel(t, item.category)}</span>
            <span>{t.feedbackBy(item.owner_name || item.owner_user_id)}</span>
            <span>{formatFeedbackTimestamp(item.created_at, language)}</span>
            <FeedbackThreadSummary item={item} />
          </div>
        </button>

        <select
          value={item.status}
          aria-label={t.feedbackStatusLabel}
          data-testid={`feedback-status-${item.id}`}
          onChange={(e) => void onUpdate(item.id, { status: e.target.value as FeedbackStatus })}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          {FEEDBACK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {feedbackStatusLabel(t, status)}
            </option>
          ))}
        </select>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <FeedbackThread item={item} variant="admin" onCommented={onCommented} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">{t.feedbackAdminNote}</span>
            <textarea
              value={note}
              onChange={(e) => {
                setNoteDraft(e.target.value);
                setNoteSaved(false);
              }}
              maxLength={2000}
              rows={2}
              placeholder={t.feedbackAdminNotePlaceholder}
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            {noteSaved && <span className="text-xs text-text-muted">{t.feedbackAdminNoteSaved}</span>}
            <Button
              size="sm"
              variant="secondary"
              loading={savingNote}
              disabled={note === storedNote}
              onClick={() => void saveNote()}
            >
              {t.feedbackAdminNoteSave}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
