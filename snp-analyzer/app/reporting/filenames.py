"""Safe download file names and RFC 5987 Content-Disposition headers."""
import re
from urllib.parse import quote

DEFAULT_NAME = "download"
MAX_LENGTH = 150
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_RESERVED = re.compile(r'[:*?"<>|]')


def _truncate(name: str, max_length: int) -> str:
    """Cap at ``max_length`` UTF-8 bytes, keeping a short extension intact."""
    if len(name.encode("utf-8")) <= max_length:
        return name
    stem, dot, ext = name.rpartition(".")
    if not dot or not stem or len(ext) > 10:
        stem, ext = name, ""
    else:
        ext = "." + ext
    budget = max_length - len(ext.encode("utf-8"))
    stem = stem.encode("utf-8")[:budget].decode("utf-8", errors="ignore")
    return (stem.rstrip(". ") or DEFAULT_NAME) + ext


def safe_filename(name: str, max_length: int = MAX_LENGTH) -> str:
    """Reduce untrusted text to a single, portable file name component."""
    cleaned = _CONTROL.sub("", name or "")
    cleaned = re.split(r"[/\\]", cleaned)[-1]
    cleaned = _RESERVED.sub("_", cleaned).strip(". ")
    return _truncate(cleaned, max_length) if cleaned else DEFAULT_NAME


def unique_filename(name: str, used: set[str], max_length: int = MAX_LENGTH) -> str:
    """Safe name not yet in ``used`` (added on return); duplicates get ``(n)``."""
    safe = safe_filename(name, max_length)
    stem, dot, ext = safe.rpartition(".")
    if not dot or not stem:
        stem, ext = safe, ""
    else:
        ext = "." + ext
    candidate, number = safe, 1
    while candidate.casefold() in {u.casefold() for u in used}:
        number += 1
        suffix = f" ({number}){ext}"
        candidate = _truncate(stem, max_length - len(suffix.encode("utf-8"))) + suffix
    used.add(candidate)
    return candidate


def content_disposition(name: str, disposition: str = "attachment") -> str:
    """Header value with an ASCII fallback and an RFC 5987 ``filename*``."""
    safe = safe_filename(name)
    fallback = safe.encode("ascii", errors="replace").decode("ascii").replace("?", "_")
    return (f'{disposition}; filename="{fallback}"; '
            f"filename*=UTF-8''{quote(safe, safe='')}")
