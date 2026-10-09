"""Request-size and sign-in checks that run before an upload body is read.

FastAPI parses a multipart form before it resolves dependencies, so by the time
a handler's own size check runs the whole body has already been received and
spooled to disk. ``UploadBoundaryMiddleware`` is a plain ASGI middleware that
looks at the request head instead:

* no usable sign-in cookie -> 401, body never read;
* declared ``Content-Length`` over the endpoint's limit -> 413, body never read;
* no ``Content-Length`` (chunked) -> the body is counted as the handler pulls it
  and the request is refused with 413 as soon as the limit is passed.

The module also holds the shared helper that keeps parsing off the event loop
and limits how many files are parsed at the same time.
"""
from __future__ import annotations

import json
import threading
from typing import Any, Callable

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import MAX_UPLOAD_SIZE_BYTES

# Room for multipart boundaries and part headers on top of the file itself.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024

# Endpoints that accept a file body. Values name the limit that applies.
UPLOAD_ENDPOINTS: dict[str, str] = {
    "/api/upload": "upload",
    "/api/import/preview": "upload",
    "/api/feedback/attachments": "feedback_attachment",
}
GUARDED_METHODS = frozenset({"POST", "PUT", "PATCH"})

NOT_AUTHENTICATED_DETAIL = "Not authenticated"
TOO_LARGE_DETAIL = "File is too large"
BUSY_DETAIL = "The server is busy, try again shortly"
UNREADABLE_FILE_DETAIL = "The file could not be read."


def body_limit_for(kind: str) -> int:
    """Largest request body (file plus multipart framing) accepted for ``kind``."""
    if kind == "feedback_attachment":
        from app.routers.feedback import MAX_ATTACHMENT_BYTES

        return MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES
    return MAX_UPLOAD_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES


class RequestBodyTooLarge(HTTPException):
    """Raised from the wrapped ``receive`` once the body passes its limit.

    It is an ``HTTPException`` because FastAPI turns any other error raised
    while it reads a form body into a generic 400; this way the request is
    answered 413 through the normal exception handling. The middleware also
    answers 413 itself if the exception reaches it before a response started.
    """

    def __init__(self) -> None:
        super().__init__(status_code=413, detail=TOO_LARGE_DETAIL)


def _json_response(status_code: int, detail: str) -> tuple[Message, Message]:
    body = json.dumps({"detail": detail}).encode("utf-8")
    start = {
        "type": "http.response.start",
        "status": status_code,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    }
    return start, {"type": "http.response.body", "body": body}


def _cookie_value(headers: list[tuple[bytes, bytes]], name: str) -> str | None:
    from http.cookies import SimpleCookie

    for key, value in headers:
        if key.lower() != b"cookie":
            continue
        jar: SimpleCookie = SimpleCookie()
        try:
            jar.load(value.decode("latin-1"))
        except Exception:
            continue
        if name in jar:
            return jar[name].value
    return None


def _declared_length(headers: list[tuple[bytes, bytes]]) -> int | None:
    for key, value in headers:
        if key.lower() == b"content-length":
            try:
                return int(value.strip())
            except ValueError:
                return None
    return None


def _route_path(scope: Scope) -> str:
    path = scope.get("path", "")
    root_path = scope.get("root_path", "")
    if root_path and path.startswith(root_path + "/"):
        path = path[len(root_path):]
    return path


def _is_signed_in(scope: Scope) -> bool:
    from app.auth import COOKIE_NAME, decode_token, get_current_user

    app = scope.get("app")
    overrides = getattr(app, "dependency_overrides", None) or {}
    if get_current_user in overrides:
        # The sign-in dependency is replaced (test harness); defer to it.
        return True
    token = _cookie_value(scope.get("headers", []), COOKIE_NAME)
    if not token:
        return False
    return decode_token(token) is not None


class UploadBoundaryMiddleware:
    """Pure ASGI middleware: refuse unsigned or oversized uploads before reading them."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in GUARDED_METHODS:
            await self.app(scope, receive, send)
            return
        kind = UPLOAD_ENDPOINTS.get(_route_path(scope))
        if kind is None:
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        if not _is_signed_in(scope):
            await self._refuse(send, 401, NOT_AUTHENTICATED_DETAIL)
            return

        limit = body_limit_for(kind)
        declared = _declared_length(headers)
        if declared is not None and declared > limit:
            await self._refuse(send, 413, TOO_LARGE_DETAIL)
            return

        received = 0
        response_started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise RequestBodyTooLarge()
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except RequestBodyTooLarge:
            if response_started:
                raise
            await self._refuse(send, 413, TOO_LARGE_DETAIL)

    @staticmethod
    async def _refuse(send: Send, status_code: int, detail: str) -> None:
        start, body = _json_response(status_code, detail)
        await send(start)
        await send(body)


# ---------------------------------------------------------------------------
# Parsing off the event loop, a few at a time
# ---------------------------------------------------------------------------

MAX_CONCURRENT_PARSES = 2
PARSE_SLOT_WAIT_SECONDS = 30.0
_parse_slots = threading.BoundedSemaphore(MAX_CONCURRENT_PARSES)


def _run_in_parse_slot(func: Callable[..., Any], args: tuple, kwargs: dict) -> Any:
    if not _parse_slots.acquire(timeout=PARSE_SLOT_WAIT_SECONDS):
        raise HTTPException(status_code=503, detail=BUSY_DETAIL)
    try:
        return func(*args, **kwargs)
    finally:
        _parse_slots.release()


async def run_parse_limited(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run blocking ``func`` in a worker thread, at most two at a time.

    Waits up to ``PARSE_SLOT_WAIT_SECONDS`` for a free slot, then answers 503.
    """
    return await run_in_threadpool(_run_in_parse_slot, func, args, kwargs)
