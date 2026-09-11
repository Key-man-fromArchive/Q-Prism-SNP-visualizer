// @TASK feat/user-feedback — the conversation on one feedback item, shared by
// the reporter's "My feedback" list and the admin triage panel. The backend
// allows exactly these two parties on a thread
// (app/routers/feedback._require_thread_access).

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { addFeedbackComment, feedbackAttachmentUrl } from "@/lib/api";
import {
  formatAttachmentSize,
  formatFeedbackTimestamp,
} from "@/lib/feedback-labels";
import { describeFeedbackContext } from "@/lib/feedback-context";
import { Button } from "@/components/shared/ui";
import type { FeedbackItem } from "@/types/api";

export type FeedbackThreadProps = {
  item: FeedbackItem;
  /** Called with the item id after a comment posts, so the owner can refetch. */
  onCommented?: (feedbackId: string) => void;
  /** Admins write a reply; reporters add detail. Only the wording differs. */
  variant?: "reporter" | "admin";
};

export function FeedbackThread({ item, onCommented, variant = "reporter" }: FeedbackThreadProps) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = variant === "admin";
  const contextSummary = describeFeedbackContext(item.context);

  async function handlePost() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      await addFeedbackComment(item.id, body);
      setDraft("");
      onCommented?.(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errFeedbackComment);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap text-sm text-text">{item.body}</p>

      {contextSummary && (
        <p className="text-xs text-text-muted" data-testid="feedback-context-summary">
          {contextSummary}
        </p>
      )}

      {item.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="feedback-attachments">
          {item.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={feedbackAttachmentUrl(attachment.id)}
              target="_blank"
              rel="noreferrer"
              title={`${attachment.filename} · ${formatAttachmentSize(attachment.size_bytes)}`}
              className="block overflow-hidden rounded-md border border-border hover:border-primary"
            >
              <img
                src={feedbackAttachmentUrl(attachment.id)}
                alt={attachment.filename}
                className="h-20 w-20 object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {/* The internal note is admin-only state; it is returned to the reporter
          too, so it is rendered ONLY on the admin surface. */}
      {isAdmin && item.admin_note && (
        <p className="rounded-md border border-border bg-bg px-3 py-2 text-xs text-text-muted">
          <span className="font-medium">{t.feedbackAdminNote}: </span>
          {item.admin_note}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {item.comments.length === 0 && (
          <p className="text-xs text-text-muted">{t.feedbackCommentsNone}</p>
        )}
        {item.comments.map((comment) => (
          <div
            key={comment.id}
            data-testid="feedback-comment"
            className={`rounded-md border px-3 py-2 text-sm ${
              comment.is_admin
                ? "border-primary/30 bg-primary/5 text-text"
                : "border-border bg-surface text-text"
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
              <span className="font-medium text-text">
                {comment.author_name || comment.author_user_id}
              </span>
              {comment.is_admin && (
                <span className="rounded border border-primary/30 px-1 text-[10px] uppercase text-primary">
                  {t.feedbackCommentStaff}
                </span>
              )}
              <span>{formatFeedbackTimestamp(comment.created_at, language)}</span>
            </div>
            <p className="whitespace-pre-wrap">{comment.body}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={isAdmin ? t.feedbackReplyPlaceholder : t.feedbackCommentPlaceholder}
          aria-label={isAdmin ? t.feedbackReply : t.feedbackCommentSend}
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            loading={posting}
            disabled={!draft.trim()}
            onClick={handlePost}
          >
            {isAdmin ? t.feedbackReplySend : t.feedbackCommentSend}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Compact "3 replies · 2 screenshots" line for a collapsed row. */
export function FeedbackThreadSummary({ item }: { item: FeedbackItem }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-2 text-xs text-text-muted">
      <span>{t.feedbackCommentCount(item.comments.length)}</span>
      {item.attachments.length > 0 && (
        <span className="flex items-center gap-1">
          <Paperclip size={12} aria-hidden="true" />
          {item.attachments.length}
        </span>
      )}
    </span>
  );
}
