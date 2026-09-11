"""In-app user feedback: DB round-trips, migration 7, and the HTTP contract.

Structure and fixtures mirror tests/test_marker_catalog.py. The interesting
cases here are the access boundaries -- a reporter must not read or comment on
someone else's report, a non-admin must not reach the triage surface, and a
screenshot must not be fetchable by whoever guesses its id.
"""
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenData, get_current_user


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 64


# ---------------------------------------------------------------------------
# db.py-level round-trip tests (no HTTP layer)
# ---------------------------------------------------------------------------


@pytest.fixture
def fresh_db(tmp_path):
    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "feedback.sqlite3"
    db.init_db()
    yield db
    if db._conn is not None:
        db._conn.close()
    db._conn = None


def _insert_user(db, user_id: str, username: str, display_name: str | None = None, role: str = "user"):
    conn = db.get_db()
    conn.execute(
        "INSERT INTO users (id, username, hashed_password, display_name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, "x", display_name, role),
    )
    conn.commit()


def _sample_context() -> dict:
    return {
        "page_key": "analysis",
        "surface": "analysis",
        "session_id": "sess-1",
        "instrument": "CFX Opus",
        "num_wells": 96,
        "num_cycles": 40,
        "ploidy": 6,
        "cycle": 40,
        "language": "ko",
        "viewport": "1920x1080",
    }


def test_insert_and_get_feedback_roundtrip(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")

    db.insert_feedback("fb-1", "u1", "bug", "Scatter axes flip", "Steps: ...", _sample_context())
    loaded = db.get_feedback("fb-1")

    assert loaded["owner_user_id"] == "u1"
    assert loaded["category"] == "bug"
    assert loaded["title"] == "Scatter axes flip"
    assert loaded["status"] == "open"
    assert loaded["admin_note"] is None
    assert loaded["context"]["instrument"] == "CFX Opus"
    assert loaded["context"]["ploidy"] == 6


def test_get_feedback_missing_returns_none(fresh_db):
    assert fresh_db.get_feedback("does-not-exist") is None


def test_insert_feedback_without_context_stores_null(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "question", "How do I mark NTC?", "body")
    assert db.get_feedback("fb-1")["context"] is None


def test_list_feedback_scopes_to_owner_when_asked(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    _insert_user(db, "u2", "bob")

    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback("fb-2", "u2", "bug", "b", "b")

    mine, total = db.list_feedback(owner_user_id="u1")
    assert [r["id"] for r in mine] == ["fb-1"]
    assert total == 1

    everyone, total_all = db.list_feedback()
    assert {r["id"] for r in everyone} == {"fb-1", "fb-2"}
    assert total_all == 2


def test_list_feedback_filters_by_status_and_category(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback("fb-2", "u1", "feature", "b", "b")
    db.update_feedback("fb-2", status="resolved")

    assert [r["id"] for r in db.list_feedback(status="open")[0]] == ["fb-1"]
    assert [r["id"] for r in db.list_feedback(status="resolved")[0]] == ["fb-2"]
    assert [r["id"] for r in db.list_feedback(category="feature")[0]] == ["fb-2"]
    assert db.list_feedback(status="open", category="feature")[1] == 0


def test_list_feedback_paginates_and_reports_full_total(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    for i in range(5):
        db.insert_feedback(f"fb-{i}", "u1", "bug", f"title {i}", "body")

    page1, total = db.list_feedback(limit=2, offset=0)
    page2, _ = db.list_feedback(limit=2, offset=2)
    page3, _ = db.list_feedback(limit=2, offset=4)

    assert total == 5
    assert len(page1) == 2 and len(page2) == 2 and len(page3) == 1
    ids = [r["id"] for r in page1 + page2 + page3]
    assert len(set(ids)) == 5


def test_update_feedback_is_partial(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")

    db.update_feedback("fb-1", admin_note="reproduced on CFX")
    db.update_feedback("fb-1", status="in_progress")

    loaded = db.get_feedback("fb-1")
    assert loaded["status"] == "in_progress"
    # A status move must not wipe the note written earlier.
    assert loaded["admin_note"] == "reproduced on CFX"

    db.update_feedback("fb-1")  # no-op
    assert db.get_feedback("fb-1")["status"] == "in_progress"


def test_feedback_stats_counts_status_and_category(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback("fb-2", "u1", "bug", "b", "b")
    db.insert_feedback("fb-3", "u1", "feature", "c", "c")
    db.update_feedback("fb-2", status="closed")

    stats = db.feedback_stats()
    assert stats["total"] == 3
    assert stats["open"] == 2
    assert stats["closed"] == 1
    assert stats["in_progress"] == 0
    assert stats["by_category"] == {"bug": 2, "feature": 1}


def test_comments_load_in_order_and_bump_feedback_updated_at(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    _insert_user(db, "admin-1", "root", role="admin")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    conn = db.get_db()
    conn.execute("UPDATE user_feedback SET updated_at = '2000-01-01 00:00:00' WHERE id = 'fb-1'")
    conn.commit()

    db.insert_feedback_comment("c-1", "fb-1", "u1", "any update?", False)
    db.insert_feedback_comment("c-2", "fb-1", "admin-1", "fixed in the next build", True)

    thread = db.load_feedback_comments(["fb-1"])["fb-1"]
    assert [c["id"] for c in thread] == ["c-1", "c-2"]
    assert thread[0]["is_admin"] is False
    assert thread[1]["is_admin"] is True
    assert db.get_feedback("fb-1")["updated_at"] != "2000-01-01 00:00:00"


def test_load_feedback_comments_empty_input(fresh_db):
    assert fresh_db.load_feedback_comments([]) == {}


def test_attachment_claim_only_takes_own_unattached_rows(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    _insert_user(db, "u2", "bob")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback("fb-2", "u2", "bug", "b", "b")

    db.insert_feedback_attachment("att-mine", "u1", "shot.png", "image/png", PNG)
    db.insert_feedback_attachment("att-theirs", "u2", "shot.png", "image/png", PNG)
    db.claim_feedback_attachments("fb-2", ["att-theirs"], "u2")

    claimed = db.claim_feedback_attachments(
        "fb-1", ["att-mine", "att-theirs"], "u1"
    )

    assert [a["id"] for a in claimed] == ["att-mine"]
    # Someone else's screenshot stays on their own report.
    assert db.get_feedback_attachment("att-theirs")["feedback_id"] == "fb-2"


def test_attachment_metadata_listing_excludes_bytes(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback_attachment("att-1", "u1", "shot.png", "image/png", PNG)
    db.claim_feedback_attachments("fb-1", ["att-1"], "u1")

    listed = db.load_feedback_attachments(["fb-1"])["fb-1"][0]
    assert listed == {
        "id": "att-1",
        "filename": "shot.png",
        "mime_type": "image/png",
        "size_bytes": len(PNG),
    }
    # The bytes are reachable only through the single-attachment read.
    assert db.get_feedback_attachment("att-1")["content"] == PNG


def test_orphan_attachment_cleanup_spares_attached_and_recent_rows(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")

    db.insert_feedback_attachment("att-attached", "u1", "a.png", "image/png", PNG)
    db.claim_feedback_attachments("fb-1", ["att-attached"], "u1")
    db.insert_feedback_attachment("att-fresh", "u1", "b.png", "image/png", PNG)
    db.insert_feedback_attachment("att-stale", "u1", "c.png", "image/png", PNG)
    conn = db.get_db()
    conn.execute(
        "UPDATE user_feedback_attachments SET created_at = datetime('now', '-48 hours') "
        "WHERE id = 'att-stale'"
    )
    conn.commit()

    assert db.cleanup_orphan_feedback_attachments(hours=24) == 1
    assert db.get_feedback_attachment("att-stale") is None
    assert db.get_feedback_attachment("att-fresh") is not None
    assert db.get_feedback_attachment("att-attached") is not None


def test_deleting_feedback_cascades_comments_and_attachments(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice")
    db.insert_feedback("fb-1", "u1", "bug", "a", "a")
    db.insert_feedback_comment("c-1", "fb-1", "u1", "note", False)
    db.insert_feedback_attachment("att-1", "u1", "a.png", "image/png", PNG)
    db.claim_feedback_attachments("fb-1", ["att-1"], "u1")

    conn = db.get_db()
    conn.execute("DELETE FROM user_feedback WHERE id = 'fb-1'")
    conn.commit()

    assert db.load_feedback_comments(["fb-1"]) == {}
    assert db.get_feedback_attachment("att-1") is None


def test_user_display_names_falls_back_to_username(fresh_db):
    db = fresh_db
    _insert_user(db, "u1", "alice", display_name="Alice Kim")
    _insert_user(db, "u2", "bob", display_name=None)

    names = db.user_display_names(["u1", "u2", "u1", "", "missing"])
    assert names == {"u1": "Alice Kim", "u2": "bob"}
    assert db.user_display_names([]) == {}


# ---------------------------------------------------------------------------
# Migration 7 (on a simulated v6 DB)
# ---------------------------------------------------------------------------


def test_migration_7_adds_feedback_tables(tmp_path):
    import sqlite3

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "v6.sqlite3"

    schema_sql = (
        db.Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    ).read_text()
    # Build a schema-v6 DB by hand: everything before the feedback section.
    v6_schema, _, _ = schema_sql.partition("-- In-app user feedback")
    v6_schema = v6_schema.rstrip().rstrip("-").rstrip()

    conn = sqlite3.connect(str(db.DB_PATH))
    conn.executescript(v6_schema)
    for v in (1, 2, 3, 4, 5, 6):
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (?)", (v,))
    conn.commit()

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "user_feedback" not in tables
    conn.close()

    db.init_db()
    conn = db.get_db()
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    assert "user_feedback" in tables
    assert "user_feedback_comments" in tables
    assert "user_feedback_attachments" in tables
    assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == 7

    # Migration 7 back-fills nothing.
    assert db.list_feedback() == ([], 0)

    if db._conn is not None:
        db._conn.close()
    db._conn = None


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def feedback_client(tmp_path):
    env = patch.dict(
        os.environ,
        {
            "JWT_SECRET_KEY": "test-secret-that-is-long-enough-for-feedback-tests",
            "ADMIN_PASSWORD": "StrongerOperatorPassword123!",
            "SNP_AUTH_MODE": "local",
        },
        clear=False,
    )
    env.start()

    import app.db as db

    if db._conn is not None:
        db._conn.close()
    db._conn = None
    db.DB_PATH = tmp_path / "test.sqlite3"

    from app.main import app

    state = {"user_id": "user-1", "username": "user1", "role": "user"}

    async def current_user_override():
        return TokenData(
            user_id=state["user_id"], username=state["username"], role=state["role"]
        )

    app.dependency_overrides[get_current_user] = current_user_override

    with TestClient(app) as client:
        _insert_user(db, "user-1", "user1", display_name="User One")
        _insert_user(db, "user-2", "user2", display_name="User Two")
        _insert_user(db, "admin-1", "root", display_name="Administrator", role="admin")
        yield SimpleNamespace(client=client, state=state, db=db)

    app.dependency_overrides.pop(get_current_user, None)
    if db._conn is not None:
        db._conn.close()
    db._conn = None
    env.stop()


def _act_as(feedback_client, user_id: str, username: str, role: str = "user"):
    feedback_client.state.update(user_id=user_id, username=username, role=role)


def _submit(client, **overrides):
    payload = {
        "category": "bug",
        "title": "Scatter axes flip after reload",
        "body": "Open a CFX plate, reload, the axes swap.",
        "context": _sample_context(),
    }
    payload.update(overrides)
    return client.post("/api/feedback", json=payload)


def test_submit_feedback_returns_item_and_shows_in_my_list(feedback_client):
    client = feedback_client.client

    res = _submit(client)
    assert res.status_code == 201
    item = res.json()
    assert item["status"] == "open"
    assert item["category"] == "bug"
    assert item["owner_user_id"] == "user-1"
    assert item["owner_name"] == "User One"
    assert item["context"]["instrument"] == "CFX Opus"
    assert item["comments"] == []
    assert item["attachments"] == []

    mine = client.get("/api/feedback/my").json()
    assert mine["total"] == 1
    assert mine["page"] == 1
    assert mine["items"][0]["id"] == item["id"]


def test_my_list_hides_other_users_feedback(feedback_client):
    client = feedback_client.client
    _submit(client)

    _act_as(feedback_client, "user-2", "user2")
    assert client.get("/api/feedback/my").json() == {
        "items": [],
        "total": 0,
        "page": 1,
        "per_page": 20,
    }


def test_submit_rejects_blank_and_oversized_fields(feedback_client):
    client = feedback_client.client

    # Whitespace-only clears Pydantic's min_length, so the handler is what
    # rejects it -- as bad input (400), not a schema violation.
    assert _submit(client, title="   ", body="   ").status_code == 400
    assert _submit(client, title="", body="body").status_code == 422
    assert _submit(client, title="x" * 201).status_code == 422
    assert _submit(client, body="x" * 5001).status_code == 422
    assert _submit(client, category="not-a-category").status_code == 422


def test_submit_strips_whitespace_around_title_and_body(feedback_client):
    item = _submit(feedback_client.client, title="  padded  ", body="  text  ").json()
    assert item["title"] == "padded"
    assert item["body"] == "text"


def test_submit_without_context_is_allowed(feedback_client):
    res = _submit(feedback_client.client, context=None)
    assert res.status_code == 201
    assert res.json()["context"] is None


def test_non_admin_cannot_reach_triage_surface(feedback_client):
    client = feedback_client.client
    _submit(client)

    assert client.get("/api/feedback").status_code == 403
    assert client.get("/api/feedback/stats").status_code == 403


def test_admin_sees_every_users_feedback_with_filters(feedback_client):
    client = feedback_client.client
    _submit(client, title="from user one")
    _act_as(feedback_client, "user-2", "user2")
    _submit(client, category="feature", title="from user two")

    _act_as(feedback_client, "admin-1", "root", role="admin")
    everyone = client.get("/api/feedback").json()
    assert everyone["total"] == 2
    assert {i["owner_name"] for i in everyone["items"]} == {"User One", "User Two"}

    only_features = client.get("/api/feedback?category=feature").json()
    assert [i["title"] for i in only_features["items"]] == ["from user two"]

    stats = client.get("/api/feedback/stats").json()
    assert stats == {
        "total": 2,
        "open": 2,
        "in_progress": 0,
        "resolved": 0,
        "closed": 0,
        "by_category": {"bug": 1, "feature": 1},
    }


def test_admin_list_rejects_unknown_filter_values(feedback_client):
    _act_as(feedback_client, "admin-1", "root", role="admin")
    assert feedback_client.client.get("/api/feedback?status=nope").status_code == 422


def test_admin_updates_status_and_note_without_clobbering(feedback_client):
    client = feedback_client.client
    feedback_id = _submit(client).json()["id"]

    _act_as(feedback_client, "admin-1", "root", role="admin")
    noted = client.patch(
        f"/api/feedback/{feedback_id}", json={"admin_note": "reproduced"}
    ).json()
    assert noted["admin_note"] == "reproduced"
    assert noted["status"] == "open"

    moved = client.patch(
        f"/api/feedback/{feedback_id}", json={"status": "in_progress"}
    ).json()
    assert moved["status"] == "in_progress"
    assert moved["admin_note"] == "reproduced"

    assert client.patch(f"/api/feedback/{feedback_id}", json={}).status_code == 400
    assert (
        client.patch(f"/api/feedback/{feedback_id}", json={"status": "nope"}).status_code
        == 422
    )
    assert client.patch("/api/feedback/missing", json={"status": "closed"}).status_code == 404


def test_non_admin_cannot_update_feedback_even_their_own(feedback_client):
    client = feedback_client.client
    feedback_id = _submit(client).json()["id"]

    res = client.patch(f"/api/feedback/{feedback_id}", json={"status": "resolved"})
    assert res.status_code == 403
    assert feedback_client.db.get_feedback(feedback_id)["status"] == "open"


def test_reporter_and_admin_can_comment_but_a_stranger_cannot(feedback_client):
    client = feedback_client.client
    feedback_id = _submit(client).json()["id"]

    own = client.post(f"/api/feedback/{feedback_id}/comments", json={"body": "still broken"})
    assert own.status_code == 201
    assert own.json()["is_admin"] is False
    assert own.json()["author_name"] == "User One"

    _act_as(feedback_client, "user-2", "user2")
    assert (
        client.post(f"/api/feedback/{feedback_id}/comments", json={"body": "me too"}).status_code
        == 403
    )

    _act_as(feedback_client, "admin-1", "root", role="admin")
    reply = client.post(
        f"/api/feedback/{feedback_id}/comments", json={"body": "fixed in the next build"}
    )
    assert reply.status_code == 201
    assert reply.json()["is_admin"] is True

    thread = client.get("/api/feedback").json()["items"][0]["comments"]
    assert [c["body"] for c in thread] == ["still broken", "fixed in the next build"]
    assert [c["is_admin"] for c in thread] == [False, True]


def test_comment_validation_and_missing_feedback(feedback_client):
    client = feedback_client.client
    feedback_id = _submit(client).json()["id"]

    assert (
        client.post(f"/api/feedback/{feedback_id}/comments", json={"body": "   "}).status_code
        == 400
    )
    assert (
        client.post(f"/api/feedback/{feedback_id}/comments", json={"body": ""}).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/feedback/{feedback_id}/comments", json={"body": "x" * 2001}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/feedback/missing/comments", json={"body": "hi"}).status_code == 404
    )


@pytest.mark.parametrize(
    "filename,content_type,content",
    [
        ("shot.png", "image/png", PNG),
        ("shot.jpg", "image/jpeg", JPEG),
        ("shot.webp", "image/webp", WEBP),
    ],
)
def test_screenshot_upload_accepts_supported_image_types(
    feedback_client, filename, content_type, content
):
    res = feedback_client.client.post(
        "/api/feedback/attachments",
        files={"file": (filename, content, content_type)},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["mime_type"] == content_type
    assert body["size_bytes"] == len(content)


@pytest.mark.parametrize(
    "filename,content_type,content,reason",
    [
        ("evil.svg", "image/svg+xml", b"<svg onload=alert(1)>", "type not allowed"),
        ("fake.png", "image/png", b"GIF89a" + b"\x00" * 32, "magic bytes mismatch"),
        ("fake.webp", "image/webp", b"RIFF" + b"\x00" * 32, "RIFF but not WEBP"),
        ("empty.png", "image/png", b"", "empty upload"),
    ],
)
def test_screenshot_upload_rejects_bad_payloads(
    feedback_client, filename, content_type, content, reason
):
    res = feedback_client.client.post(
        "/api/feedback/attachments",
        files={"file": (filename, content, content_type)},
    )
    assert res.status_code == 400, reason


def test_screenshot_upload_rejects_oversized_file(feedback_client):
    from app.routers.feedback import MAX_ATTACHMENT_BYTES

    oversized = PNG + b"\x00" * (MAX_ATTACHMENT_BYTES + 1 - len(PNG))
    res = feedback_client.client.post(
        "/api/feedback/attachments",
        files={"file": ("huge.png", oversized, "image/png")},
    )
    assert res.status_code == 400
    assert "MB limit" in res.json()["detail"]


def test_submitted_feedback_carries_only_its_own_screenshots(feedback_client):
    client = feedback_client.client

    mine = client.post(
        "/api/feedback/attachments", files={"file": ("mine.png", PNG, "image/png")}
    ).json()["id"]

    _act_as(feedback_client, "user-2", "user2")
    theirs = client.post(
        "/api/feedback/attachments", files={"file": ("theirs.png", PNG, "image/png")}
    ).json()["id"]

    _act_as(feedback_client, "user-1", "user1")
    item = _submit(client, attachment_ids=[mine, theirs]).json()

    assert [a["id"] for a in item["attachments"]] == [mine]
    assert [a["filename"] for a in item["attachments"]] == ["mine.png"]


def test_submit_rejects_more_than_four_screenshots(feedback_client):
    res = _submit(feedback_client.client, attachment_ids=["a", "b", "c", "d", "e"])
    assert res.status_code == 422


def test_screenshot_is_served_to_its_owner_and_to_an_admin_only(feedback_client):
    client = feedback_client.client
    attachment_id = client.post(
        "/api/feedback/attachments", files={"file": ("shot.png", PNG, "image/png")}
    ).json()["id"]

    owner_view = client.get(f"/api/feedback/attachments/{attachment_id}")
    assert owner_view.status_code == 200
    assert owner_view.headers["content-type"] == "image/png"
    assert owner_view.headers["content-disposition"] == "inline"
    assert owner_view.content == PNG

    _act_as(feedback_client, "user-2", "user2")
    # 404, not 403: another user's screenshot is not even acknowledged.
    assert client.get(f"/api/feedback/attachments/{attachment_id}").status_code == 404

    _act_as(feedback_client, "admin-1", "root", role="admin")
    assert client.get(f"/api/feedback/attachments/{attachment_id}").status_code == 200
    assert client.get("/api/feedback/attachments/missing").status_code == 404


def test_asg_launch_mode_keeps_reporting_but_withholds_triage(feedback_client):
    """ASG-launched sessions have no local admin (app.auth.require_admin), so
    an admin-roled token must not gain triage powers there either."""
    client = feedback_client.client
    feedback_id = _submit(client).json()["id"]

    _act_as(feedback_client, "admin-1", "root", role="admin")
    with patch.dict(os.environ, {"SNP_AUTH_MODE": "asg_launch"}, clear=False):
        assert client.get("/api/feedback").status_code == 403
        assert client.get("/api/feedback/stats").status_code == 403
        assert (
            client.patch(f"/api/feedback/{feedback_id}", json={"status": "closed"}).status_code
            == 403
        )
        # An admin is an ordinary user here, so someone else's thread is closed
        # to them -- but their own reporting still works.
        assert (
            client.post(
                f"/api/feedback/{feedback_id}/comments", json={"body": "hi"}
            ).status_code
            == 403
        )
        assert _submit(client, title="from ASG").status_code == 201
        assert client.get("/api/feedback/my").json()["total"] == 1
