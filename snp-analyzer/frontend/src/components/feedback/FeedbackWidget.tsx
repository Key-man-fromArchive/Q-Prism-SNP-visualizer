// @TASK feat/user-feedback — floating feedback entry point, on every screen.
// @SPEC Two surfaces in one dialog: file a report, and read the answers to the
//       ones already filed. Reproduction context is collected automatically
//       (lib/feedback-context.ts) because operators describe symptoms, not
//       environments.
// @TEST components/feedback/FeedbackWidget.test.tsx, tests/19-feedback.spec.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, MessageSquarePlus, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  listMyFeedback,
  submitFeedback,
  uploadFeedbackAttachment,
} from "@/lib/api";
import { buildFeedbackContext } from "@/lib/feedback-context";
import {
  FEEDBACK_CATEGORIES,
  feedbackCategoryLabel,
  feedbackStatusClasses,
  feedbackStatusLabel,
  formatFeedbackTimestamp,
} from "@/lib/feedback-labels";
import { Button, IconButton, Modal, StatusState } from "@/components/shared/ui";
import { FeedbackThread, FeedbackThreadSummary } from "@/components/feedback/FeedbackThread";
import type { FeedbackCategory, FeedbackItem } from "@/types/api";

/** Mirrors app/routers/feedback.py — validated client-side too so an
 *  oversized paste fails instantly instead of after a 2 MB round trip. */
const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type WidgetSurface = "new" | "mine";

type PendingScreenshot = {
  /** Attachment id returned by the server; claimed on submit. */
  id: string;
  name: string;
  /** Local object URL — preview without fetching the bytes back. */
  previewUrl: string;
};

export type FeedbackWidgetProps = {
  /** The tab the reporter is on, recorded as the report's page_key. This app
   *  is a tab-based SPA with no routes to read it from. */
  pageKey: string;
};

export function FeedbackWidget({ pageKey }: FeedbackWidgetProps) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState<WidgetSurface>("new");

  return (
    <>
      <IconButton
        aria-label={t.feedbackOpen}
        title={t.feedbackOpen}
        data-testid="feedback-open"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 h-11 w-11 rounded-full border border-border bg-surface shadow-lg print:hidden"
      >
        <MessageSquarePlus size={18} aria-hidden="true" />
      </IconButton>

      {open && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={t.feedbackTitle}
          description={t.feedbackDescription}
          widthClassName="max-w-lg"
        >
          <div role="tablist" aria-label={t.feedbackTitle} className="mb-3 flex gap-1">
            {(["new", "mine"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={surface === id}
                data-testid={`feedback-subtab-${id}`}
                onClick={() => setSurface(id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer ${
                  surface === id
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {id === "new" ? t.feedbackSubtabNew : t.feedbackSubtabMine}
              </button>
            ))}
          </div>

          {surface === "new" ? (
            <FeedbackForm pageKey={pageKey} onSeeMine={() => setSurface("mine")} />
          ) : (
            <MyFeedbackList language={language} />
          )}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Submission form
// ---------------------------------------------------------------------------

function FeedbackForm({ pageKey, onSeeMine }: { pageKey: string; onSeeMine: () => void }) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  // Which sub-surface of the workspace (Plate Setup / Analysis) is open is
  // tracked per session by the session store where that store keeps view
  // state at all; read as optional so a report still carries its page_key
  // where it does not.
  const activeSurface = useSessionStore((s) => {
    const viewStates = (s as { viewStates?: Record<string, { activeSurface?: string }> })
      .viewStates;
    return s.sessionId ? viewStates?.[s.sessionId]?.activeSurface ?? null : null;
  });
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const { language } = useI18n();

  // Object URLs are process-wide; release them when the form goes away so a
  // long session of reporting does not leak every screenshot ever previewed.
  const screenshotsRef = useRef(screenshots);
  screenshotsRef.current = screenshots;
  useEffect(
    () => () => {
      screenshotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
    },
    []
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const room = MAX_SCREENSHOTS - screenshotsRef.current.length;
      if (room <= 0) {
        setError(t.feedbackScreenshotLimit(MAX_SCREENSHOTS));
        return;
      }
      const accepted: File[] = [];
      for (const file of files.slice(0, room)) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          setError(t.feedbackScreenshotWrongType(file.name || "image"));
          continue;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          setError(t.feedbackScreenshotTooLarge(file.name || "image"));
          continue;
        }
        accepted.push(file);
      }
      if (files.length > room) setError(t.feedbackScreenshotLimit(MAX_SCREENSHOTS));
      if (accepted.length === 0) return;

      setUploading(true);
      try {
        for (const file of accepted) {
          const stored = await uploadFeedbackAttachment(file);
          setScreenshots((prev) => [
            ...prev,
            {
              id: stored.id,
              name: stored.filename || file.name,
              previewUrl: URL.createObjectURL(file),
            },
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t.errFeedbackScreenshot);
      } finally {
        setUploading(false);
      }
    },
    [t]
  );

  function removeScreenshot(id: string) {
    setScreenshots((prev) => {
      prev.filter((shot) => shot.id === id).forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
      return prev.filter((shot) => shot.id !== id);
    });
  }

  function imagesFrom(list: FileList | null | undefined, items?: DataTransferItemList): File[] {
    if (list && list.length > 0) return Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!items) return [];
    return Array.from(items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }

  const context = useMemo(
    () =>
      buildFeedbackContext({
        pageKey,
        surface: activeSurface,
        sessionId,
        instrument: sessionInfo?.instrument ?? null,
        numWells: sessionInfo?.num_wells ?? null,
        numCycles: sessionInfo?.num_cycles ?? null,
        ploidy,
        cycle: currentCycle,
        language,
      }),
    [pageKey, activeSurface, sessionId, sessionInfo, ploidy, currentCycle, language]
  );

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      setError(t.feedbackRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback({
        category,
        title: trimmedTitle,
        body: trimmedBody,
        context,
        attachment_ids: screenshots.map((shot) => shot.id),
      });
      screenshotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.previewUrl));
      setScreenshots([]);
      setTitle("");
      setBody("");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errFeedbackSubmit);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="feedback-submitted">
        <p className="text-sm text-text">{t.feedbackSubmitted}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSubmitted(false)}>
            {t.feedbackSubmitAnother}
          </Button>
          <Button size="sm" onClick={onSeeMine}>
            {t.feedbackSubtabMine}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      // Paste anywhere in the form: a screenshot is almost always on the
      // clipboard already (PrtSc / Cmd-Shift-4), never in a file.
      onPaste={(e) => {
        const images = imagesFrom(e.clipboardData?.files, e.clipboardData?.items);
        if (images.length > 0) {
          e.preventDefault();
          void addFiles(images);
        }
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-medium text-text-muted">{t.feedbackCategory}</legend>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              data-testid={`feedback-category-${value}`}
              onClick={() => setCategory(value)}
              className={`rounded-md border px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                category === value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border text-text-muted hover:text-text"
              }`}
            >
              {feedbackCategoryLabel(t, value)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">{t.feedbackTitleLabel}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t.feedbackTitlePlaceholder}
          data-testid="feedback-title"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">{t.feedbackBodyLabel}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder={t.feedbackBodyPlaceholder}
          data-testid="feedback-body"
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-muted">{t.feedbackScreenshots}</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(imagesFrom(e.dataTransfer?.files, e.dataTransfer?.items));
          }}
          data-testid="feedback-dropzone"
          className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-3 text-center ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <p className="text-xs text-text-muted">
            {dragging ? t.feedbackScreenshotDrop : t.feedbackScreenshotHint}
          </p>
          <Button
            size="sm"
            variant="secondary"
            loading={uploading}
            disabled={screenshots.length >= MAX_SCREENSHOTS}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={14} aria-hidden="true" />
            {uploading ? t.feedbackScreenshotUploading : t.feedbackScreenshotAdd}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            hidden
            data-testid="feedback-file-input"
            onChange={(e) => {
              void addFiles(imagesFrom(e.target.files));
              e.target.value = "";
            }}
          />
        </div>

        {screenshots.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="feedback-screenshot-previews">
            {screenshots.map((shot) => (
              <div key={shot.id} className="relative">
                <img
                  src={shot.previewUrl}
                  alt={shot.name}
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <IconButton
                  size="sm"
                  aria-label={`${t.feedbackScreenshotRemove}: ${shot.name}`}
                  onClick={() => removeScreenshot(shot.id)}
                  className="absolute -right-2 -top-2 h-5 w-5 rounded-full border border-border bg-surface"
                >
                  <X size={11} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="rounded-md border border-border bg-bg px-3 py-2">
        <summary className="cursor-pointer text-xs text-text-muted">
          {t.feedbackContextTitle}
        </summary>
        <p className="mt-1 text-xs text-text-muted">{t.feedbackContextHint}</p>
        <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
          {Object.entries(context).map(([key, value]) => (
            <li key={key}>
              <span className="font-medium">{key}</span>: {String(value)}
            </li>
          ))}
        </ul>
      </details>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          loading={submitting}
          disabled={!title.trim() || !body.trim()}
          onClick={handleSubmit}
          data-testid="feedback-submit"
        >
          {submitting ? t.feedbackSubmitting : t.feedbackSubmit}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "My feedback" surface
// ---------------------------------------------------------------------------

function MyFeedbackList({ language }: { language: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listMyFeedback();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errFeedbackLoad);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && items.length === 0) {
    return <StatusState variant="loading" message={t.loading} />;
  }
  if (error) {
    return (
      <StatusState
        variant="error"
        message={t.errFeedbackLoad}
        detail={error}
        action={{ label: t.retry, onClick: () => void refresh() }}
      />
    );
  }
  if (items.length === 0) {
    return <StatusState variant="empty" message={t.feedbackEmptyMine} />;
  }

  return (
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" data-testid="feedback-my-list">
      {items.map((item) => {
        const expanded = expandedId === item.id;
        return (
          <div key={item.id} className="rounded-md border border-border bg-surface">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : item.id)}
              className="flex w-full flex-col gap-1 px-3 py-2 text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${feedbackStatusClasses(item.status)}`}
                >
                  {feedbackStatusLabel(t, item.status)}
                </span>
                <span className="flex-1 truncate text-sm font-medium text-text">{item.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>{feedbackCategoryLabel(t, item.category)}</span>
                <span>{formatFeedbackTimestamp(item.created_at, language)}</span>
                <FeedbackThreadSummary item={item} />
              </div>
            </button>
            {expanded && (
              <div className="border-t border-border px-3 py-2">
                <FeedbackThread item={item} onCommented={() => void refresh()} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
