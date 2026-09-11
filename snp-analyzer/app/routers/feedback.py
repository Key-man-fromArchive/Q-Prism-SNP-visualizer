"""In-app user feedback: operators file it, admins triage it.

Scope mirrors ``app/routers/layouts.py`` and ``app/routers/marker_catalog.py``
-- ``app.auth.TokenData`` carries only ``user_id``/``username``/``role``, so a
feedback item is owned by exactly ONE user. It differs from those two in who
may READ it: a layout is private to its owner, whereas feedback exists to be
answered, so an admin sees every item while a reporter sees only their own.

Admin endpoints depend on ``AdminUser``, which is refused outright in ASG
launch mode (``app.auth.require_admin``). That is intentional: an ASG-launched
session is a guest of the parent product and has no local admin. Submitting,
reading one's own feedback and commenting all keep working there -- only the
triage surface is unavailable.

There is no AI reply-draft endpoint here: this app has no AI provider wired
up, so an admin writes the answer.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app.auth import AdminUser, CurrentUser, TokenData
from app.config import is_asg_launch_mode
from app.models import (
    FeedbackAttachment,
    FeedbackCategory,
    FeedbackComment,
    FeedbackContext,
    FeedbackItem,
    FeedbackListResponse,
    FeedbackStats,
    FeedbackStatus,
)

router = APIRouter()

# An attachment is a screenshot of this app's own UI, so the ceiling is set by
# what a full-screen PNG of a plate view costs, not by what a browser can
# encode. Four of them cover "before / after / the error / the plate".
MAX_ATTACHMENTS_PER_FEEDBACK = 4
MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

# Raster screenshot formats only. SVG is excluded on purpose: it is a document
# that can carry script, and it would be served back from this app's own
# origin to an admin who is, by definition, looking at something a stranger
# uploaded.
ALLOWED_ATTACHMENT_TYPES = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/webp": (b"RIFF",),
}


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class FeedbackSubmit(BaseModel):
    category: FeedbackCategory
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=5000)
    context: FeedbackContext | None = None
    # Ids returned by POST /api/feedback/attachments while the reporter was
    # still typing; claimed onto this item on submit.
    attachment_ids: list[str] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_FEEDBACK)


class FeedbackUpdate(BaseModel):
    """Partial admin update -- only the fields present are applied, so setting
    a status never clears an existing note (mirrors ``MarkerCatalogUpdate``)."""
    status: FeedbackStatus | None = None
    admin_note: str | None = Field(None, max_length=2000)


class FeedbackCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_admin(user: TokenData) -> bool:
    """Effective admin rights, not just the role on the token.

    ASG launch mode has no local administration at all (see
    ``app.auth.require_admin``), so a token that claims admin there is treated
    as an ordinary user here too -- otherwise this module would hand out a
    privilege the rest of the app refuses.
    """
    return user.role == "admin" and not is_asg_launch_mode()


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _get_feedback_or_404(feedback_id: str) -> dict:
    from app.db import get_feedback

    row = get_feedback(feedback_id)
    if row is None:
        raise HTTPException(404, "Feedback not found")
    return row


def _require_thread_access(row: dict, user: TokenData) -> bool:
    """Only the reporter and an admin may join a feedback thread.

    Returns whether the caller is acting as an admin, which the comment row
    records so the reply keeps reading as the staff answer it was.
    """
    is_admin = _is_admin(user)
    if not is_admin and row["owner_user_id"] != user.user_id:
        raise HTTPException(403, "Not allowed to comment on this feedback")
    return is_admin


def _build_items(rows: list[dict]) -> list[FeedbackItem]:
    """Assemble a page of feedback with its comments, attachments and author
    names -- three bulk queries for the whole page, not per row."""
    from app.db import load_feedback_attachments, load_feedback_comments, user_display_names

    ids = [r["id"] for r in rows]
    comments = load_feedback_comments(ids)
    attachments = load_feedback_attachments(ids)
    author_ids = [r["owner_user_id"] for r in rows] + [
        c["author_user_id"] for per_item in comments.values() for c in per_item
    ]
    names = user_display_names(author_ids)

    items: list[FeedbackItem] = []
    for row in rows:
        items.append(
            FeedbackItem(
                id=row["id"],
                owner_user_id=row["owner_user_id"],
                owner_name=names.get(row["owner_user_id"]),
                category=row["category"],
                title=row["title"],
                body=row["body"],
                context=FeedbackContext(**row["context"]) if row["context"] else None,
                status=row["status"],
                admin_note=row["admin_note"],
                comments=[
                    FeedbackComment(
                        id=c["id"],
                        feedback_id=c["feedback_id"],
                        author_user_id=c["author_user_id"],
                        author_name=names.get(c["author_user_id"]),
                        body=c["body"],
                        is_admin=c["is_admin"],
                        created_at=c["created_at"],
                    )
                    for c in comments.get(row["id"], [])
                ],
                attachments=[
                    FeedbackAttachment(**a) for a in attachments.get(row["id"], [])
                ],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
        )
    return items


def _validate_attachment(filename: str, content_type: str | None, content: bytes) -> str:
    """Return the MIME type to store, or raise 400.

    The declared content type is not trusted on its own: it is cross-checked
    against the file's own magic bytes, so a renamed executable or an SVG sent
    as ``image/png`` is rejected before it can be stored and later served back
    from this origin.
    """
    if not content:
        raise HTTPException(400, "Screenshot is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            400,
            f"Screenshot is larger than the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit",
        )
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared not in ALLOWED_ATTACHMENT_TYPES:
        allowed = ", ".join(sorted(ALLOWED_ATTACHMENT_TYPES))
        raise HTTPException(400, f"Screenshot must be one of: {allowed}")
    if not any(content.startswith(sig) for sig in ALLOWED_ATTACHMENT_TYPES[declared]):
        raise HTTPException(400, f"File contents are not a valid {declared} image")
    if declared == "image/webp" and content[8:12] != b"WEBP":
        raise HTTPException(400, "File contents are not a valid image/webp image")
    if not filename or len(filename) > 255:
        raise HTTPException(400, "Screenshot filename is missing or too long")
    return declared


# ---------------------------------------------------------------------------
# Endpoints -- reporter
# ---------------------------------------------------------------------------


@router.post("/api/feedback", response_model=FeedbackItem, status_code=201)
async def submit_feedback(payload: FeedbackSubmit, current_user: CurrentUser) -> FeedbackItem:
    """File a feedback item. Any authenticated user, including in ASG mode."""
    from app.db import claim_feedback_attachments, insert_feedback

    title = payload.title.strip()
    body = payload.body.strip()
    if not title or not body:
        raise HTTPException(400, "Title and description are required")

    feedback_id = _new_id()
    insert_feedback(
        feedback_id,
        current_user.user_id,
        payload.category.value,
        title,
        body,
        payload.context.model_dump(exclude_none=True) if payload.context else None,
    )
    if payload.attachment_ids:
        claim_feedback_attachments(
            feedback_id, payload.attachment_ids, current_user.user_id
        )

    return _build_items([_get_feedback_or_404(feedback_id)])[0]


@router.get("/api/feedback/my", response_model=FeedbackListResponse)
async def list_my_feedback(
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
) -> FeedbackListResponse:
    """The caller's OWN submissions, newest first, with the admin's replies."""
    from app.db import list_feedback

    rows, total = list_feedback(
        owner_user_id=current_user.user_id,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    return FeedbackListResponse(
        items=_build_items(rows), total=total, page=page, per_page=per_page
    )


@router.post("/api/feedback/{feedback_id}/comments", response_model=FeedbackComment, status_code=201)
async def add_feedback_comment(
    feedback_id: str, payload: FeedbackCommentCreate, current_user: CurrentUser
) -> FeedbackComment:
    """Reply on a feedback thread. Reporter or admin only."""
    from app.db import insert_feedback_comment, user_display_names

    row = _get_feedback_or_404(feedback_id)
    is_admin = _require_thread_access(row, current_user)

    body = payload.body.strip()
    if not body:
        raise HTTPException(400, "Comment body is required")

    comment = insert_feedback_comment(
        _new_id(), feedback_id, current_user.user_id, body, is_admin
    )
    names = user_display_names([current_user.user_id])
    return FeedbackComment(
        id=comment["id"],
        feedback_id=comment["feedback_id"],
        author_user_id=comment["author_user_id"],
        author_name=names.get(current_user.user_id, current_user.username),
        body=comment["body"],
        is_admin=comment["is_admin"],
        created_at=comment["created_at"],
    )


# ---------------------------------------------------------------------------
# Endpoints -- screenshots
# ---------------------------------------------------------------------------


@router.post("/api/feedback/attachments", response_model=FeedbackAttachment, status_code=201)
async def upload_feedback_attachment(
    current_user: CurrentUser, file: UploadFile = File(...)
) -> FeedbackAttachment:
    """Store one screenshot and return its id, for POST /api/feedback to claim.

    The upload happens while the report is still being written, so the row
    starts life unattached; abandoned rows are swept by
    ``app.db.cleanup_orphan_feedback_attachments``.
    """
    from app.db import insert_feedback_attachment

    # Read at most one byte past the ceiling: enough to know the file is too
    # big without ever holding an unbounded upload in memory.
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    mime_type = _validate_attachment(file.filename or "", file.content_type, content)
    stored = insert_feedback_attachment(
        _new_id(), current_user.user_id, file.filename or "screenshot", mime_type, content
    )
    return FeedbackAttachment(**stored)


@router.get("/api/feedback/attachments/{attachment_id}")
async def get_feedback_attachment_bytes(attachment_id: str, current_user: CurrentUser) -> Response:
    """Serve a screenshot to the reporter who uploaded it, or to an admin.

    404 rather than 403 for anyone else: whether some other user's screenshot
    exists is not disclosed (mirrors ``layouts._get_owned_layout``).
    """
    from app.db import get_feedback_attachment

    row = get_feedback_attachment(attachment_id)
    if row is None:
        raise HTTPException(404, "Attachment not found")
    if not _is_admin(current_user) and row["owner_user_id"] != current_user.user_id:
        raise HTTPException(404, "Attachment not found")

    return Response(
        content=row["content"],
        media_type=row["mime_type"],
        headers={
            # Inline so the admin panel can render it in an <img>, with the
            # filename kept out of the header entirely -- it is attacker-chosen
            # text and nothing here needs it.
            "Content-Disposition": "inline",
            "Cache-Control": "private, max-age=300",
        },
    )


# ---------------------------------------------------------------------------
# Endpoints -- admin triage
# ---------------------------------------------------------------------------


@router.get("/api/feedback", response_model=FeedbackListResponse)
async def list_feedback_admin(
    current_user: AdminUser,
    status: FeedbackStatus | None = Query(None),
    category: FeedbackCategory | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
) -> FeedbackListResponse:
    """Every user's feedback, newest first, filterable by status/category."""
    from app.db import list_feedback

    rows, total = list_feedback(
        status=status.value if status else None,
        category=category.value if category else None,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    return FeedbackListResponse(
        items=_build_items(rows), total=total, page=page, per_page=per_page
    )


@router.get("/api/feedback/stats", response_model=FeedbackStats)
async def get_feedback_stats(current_user: AdminUser) -> FeedbackStats:
    from app.db import feedback_stats

    return FeedbackStats(**feedback_stats())


@router.patch("/api/feedback/{feedback_id}", response_model=FeedbackItem)
async def update_feedback_admin(
    feedback_id: str, payload: FeedbackUpdate, current_user: AdminUser
) -> FeedbackItem:
    """Move an item through triage and/or record the internal note."""
    from app.db import update_feedback

    _get_feedback_or_404(feedback_id)
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "Nothing to update")

    update_feedback(
        feedback_id,
        status=payload.status.value if payload.status else None,
        admin_note=payload.admin_note if "admin_note" in patch else None,
    )
    return _build_items([_get_feedback_or_404(feedback_id)])[0]

