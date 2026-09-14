"""The one place this application's version is written down.

A deployed instance has to be able to say what it is: the analyzer runs
from an image built out of a git URL, so "which build is this?" cannot be
answered from the outside. ``GET /api/version`` reports this, and the page
footer shows it, so an operator reporting a problem and the engineer reading
the report are talking about the same build.

Bump ``__version__`` in the release commit that the tag points at, so the tag
and what the running app says can never disagree.
"""
from __future__ import annotations

import os

__version__ = "1.2.1"

# Optional build provenance, supplied by the image build (never guessed at
# runtime: an empty value is honest, a fabricated commit is not).
BUILD_SHA = (os.environ.get("APP_BUILD_SHA") or "").strip()[:12]
BUILD_TIME = (os.environ.get("APP_BUILD_TIME") or "").strip()
