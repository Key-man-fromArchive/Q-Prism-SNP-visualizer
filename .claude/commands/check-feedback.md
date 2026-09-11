---
name: check-feedback
description: |
  Q-Prism SNP 분석기의 인앱 피드백을 조회·분석·처리한다.
  전역 check-feedback(PostgreSQL/psql 전제)은 이 프로젝트에서 동작하지 않으므로 이 프로젝트 버전을 쓴다.

  Triggers:
  - "피드백 확인", "피드백 체크", "check feedback", "사용자 피드백", "버그 리포트 확인"
version: 1.0.0
updated: 2026-09-11
---

# Check User Feedback — Q-Prism SNP 분석기

> **전역 스킬과 다른 점**: 이 프로젝트는 PostgreSQL이 아니라 **컨테이너 안 SQLite**를 쓰고,
> 컬럼명도 다르다(`owner_user_id`, `display_name`, `author_user_id`). 컨테이너에는
> `psql`도 `sqlite3` CLI도 없고 **Python만** 있으므로 모든 조회는 `docker exec -i ... python -`로 한다.
> (`-i` 없으면 stdin이 안 붙어 아무 출력도 나오지 않는다.)

> **웹 URL을 fetch하지 말 것** — React SPA라서 HTML에는 아무것도 없다. DB를 직접 읽는다.

---

## Step 0: 대상 고르기

| 환경 | 컨테이너 | DB 경로 | 인증 모드 |
|------|----------|---------|-----------|
| **운영** (asgdesigner2.ivttools.com/snp-analyze/) | `asg-saas-v2-snp-analyzer-1` | `/app/data/snp_analyzer.db` | `asg_launch` |
| 로컬 (`snp-analyzer/docker-compose.yml`) | `snp-analyzer` | `/app/data/snp_analyzer.db` | `local` |
| 로컬 (컨테이너 없이) | — | `$DB_PATH` 또는 `snp-analyzer/app/data/snp_analyzer.db` | `local` |

```bash
CT=asg-saas-v2-snp-analyzer-1     # 운영
docker ps --filter "name=snp-analyzer" --format "{{.Names}} | {{.Status}}"
curl -s https://asgdesigner2.ivttools.com/snp-analyze/api/version   # 어떤 빌드인지 먼저 확인
```

운영은 `asg_launch` 모드라 **관리자 처리 탭이 UI에 없다**(`require_admin`이 항상 403).
그래서 읽기도 답변도 이 스킬의 DB 경로로 한다.

---

## Step 1: 열린 피드백 목록

```bash
docker exec -i $CT python - <<'PY'
import sqlite3, json
db = sqlite3.connect('file:/app/data/snp_analyzer.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
rows = db.execute("""
    SELECT f.id, f.category, f.status, f.title, f.created_at,
           f.context_json,
           COALESCE(u.display_name, u.username, f.owner_user_id) AS author,
           (SELECT COUNT(*) FROM user_feedback_comments c WHERE c.feedback_id = f.id) AS comments,
           (SELECT COUNT(*) FROM user_feedback_attachments a WHERE a.feedback_id = f.id) AS shots
    FROM user_feedback f
    LEFT JOIN users u ON u.id = f.owner_user_id
    WHERE f.status IN ('open', 'in_progress')
    ORDER BY f.created_at DESC
""").fetchall()
print(f"열린 피드백: {len(rows)}건")
for r in rows:
    ctx = json.loads(r["context_json"]) if r["context_json"] else {}
    print(f'#{r["id"][:8]} [{r["category"]}/{r["status"]}] {r["title"]} — {r["author"]} {r["created_at"]}')
    print(f'   탭={ctx.get("page_key")} 기기={ctx.get("instrument")} 웰/사이클={ctx.get("num_wells")}/{ctx.get("num_cycles")} 댓글={r["comments"]} 스샷={r["shots"]}')
PY
```

## Step 2: 본문과 컨텍스트 전문

```bash
docker exec -i $CT python - <<'PY'
import sqlite3, json
db = sqlite3.connect('file:/app/data/snp_analyzer.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
for r in db.execute("SELECT * FROM user_feedback WHERE status IN ('open','in_progress') ORDER BY created_at").fetchall():
    ctx = json.loads(r["context_json"]) if r["context_json"] else {}
    print(f'── #{r["id"][:8]} [{r["category"]}] {r["title"]}')
    print(f'   {r["body"]}')
    print(f'   ctx: {json.dumps({k: v for k, v in ctx.items() if k != "user_agent"}, ensure_ascii=False)}')
    if r["admin_note"]:
        print(f'   내부메모: {r["admin_note"]}')
    print()
PY
```

`context_json`이 담는 것: `page_key`(탭 id), `surface`(plate/analysis), `session_id`,
`instrument`, `num_wells`, `num_cycles`, `ploidy`, `cycle`, `language`, `viewport`, `user_agent`.
**샘플명·웰·판정 결과는 일부러 수집하지 않는다**(AGENTS.md 개인 식별자 규칙) — 재현은 런의 형태로만 한다.

## Step 3: 댓글 스레드

```bash
docker exec -i $CT python - <<'PY'
import sqlite3
db = sqlite3.connect('file:/app/data/snp_analyzer.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
for c in db.execute("""
    SELECT c.feedback_id, c.body, c.is_admin, c.created_at,
           COALESCE(u.display_name, u.username, c.author_user_id) AS author
    FROM user_feedback_comments c
    LEFT JOIN users u ON u.id = c.author_user_id
    WHERE c.feedback_id IN (SELECT id FROM user_feedback WHERE status IN ('open','in_progress'))
    ORDER BY c.feedback_id, c.created_at
""").fetchall():
    who = "운영" if c["is_admin"] else "작성자"
    print(f'#{c["feedback_id"][:8]} [{who}] {c["author"]} {c["created_at"]}: {c["body"]}')
PY
```

## Step 4: 스크린샷 꺼내보기

첨부는 `context_json`이 아니라 `user_feedback_attachments`에 **BLOB**으로 들어 있다.

```bash
docker exec -i $CT python - <<'PY'
import pathlib, sqlite3
out = pathlib.Path('/app/data/feedback-shots'); out.mkdir(exist_ok=True)
db = sqlite3.connect('file:/app/data/snp_analyzer.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}
for a in db.execute("SELECT id, feedback_id, mime_type, size_bytes, content FROM user_feedback_attachments WHERE feedback_id IS NOT NULL"):
    name = f'{a["feedback_id"][:8]}-{a["id"][:6]}.{ext.get(a["mime_type"], "bin")}'
    (out / name).write_bytes(a["content"])
    print(f'{name}  {a["size_bytes"]//1024} KB')
PY
mkdir -p feedback-shots
docker cp $CT:/app/data/feedback-shots/. feedback-shots/
```

그 다음 Read 도구로 이미지를 직접 본다 (`feedback-shots/<피드백8자리>-*.png`).
`feedback-shots/`는 .gitignore에 있다 — 사용자 스크린샷을 저장소에 커밋하지 말 것.

## Step 5: 분석과 분류

각 항목을 이렇게 정리한다:

```
### #{id8} [{category}] — {심각도}
- 제출자 / 일시 / 탭·기기·런 형태
- 내용 요약과 스크린샷에서 실제로 보이는 것
- 초기 가설: 어느 파일/컴포넌트인지
- 판정: Simple(단독 처리) / Complex(설계 필요)
```

심각도: `bug` > `improvement` > `feature` > `question` > `other`.
단, **작성자가 운영자(대표/PM)인 경우 feature·improvement라도 우선순위가 올라간다** — 제품 방향 지시에 가깝다.

| 분류 | 조건 | 처리 |
|------|------|------|
| Simple | 단일 컴포넌트, 문구, 명백한 원인 | 바로 수정 → Step 6 |
| Complex | 다중 파일, 레이아웃 재설계, 기획 판단 필요, 원인 불명 | 먼저 계획을 제시하고 승인받는다. 필요하면 `multi-ai-review` 연동 |

## Step 6: 답변과 상태 변경 (쓰기)

운영은 `asg_launch`라 UI로 답변할 수 없으므로 DB에 직접 쓴다. **읽기와 달리 `mode=ro`를 빼야 한다.**

```bash
docker exec -i $CT python - <<'PY'
import sqlite3, uuid
FEEDBACK_ID = "전체 id를 넣는다"          # 8자리 축약 아님
REPLY = "고쳤습니다. 다음 배포에 포함됩니다."
STATUS = "resolved"                      # open | in_progress | resolved | closed

db = sqlite3.connect('/app/data/snp_analyzer.db')
db.execute(
    "INSERT INTO user_feedback_comments (id, feedback_id, author_user_id, body, is_admin) "
    "SELECT ?, ?, owner_user_id, ?, 1 FROM user_feedback WHERE id = ?",
    (uuid.uuid4().hex[:16], FEEDBACK_ID, REPLY, FEEDBACK_ID),
)
db.execute("UPDATE user_feedback SET status = ?, updated_at = datetime('now') WHERE id = ?", (STATUS, FEEDBACK_ID))
db.commit()
print("반영됨:", db.execute("SELECT status FROM user_feedback WHERE id = ?", (FEEDBACK_ID,)).fetchone())
PY
```

> `author_user_id`를 작성자 본인으로 넣는 이유: `asg_launch`에는 로컬 관리자 계정이 없다.
> `is_admin=1`이 "운영 답변"임을 표시하고, 작성자는 위젯의 "내 피드백" 탭에서 바로 읽는다.

## Step 7: 수정 후 배포

코드 수정이 끝나면 main에 머지하고 운영 이미지를 다시 만든다. 빌드 컨텍스트가 GitHub main이라
**푸시가 선행되어야 한다.**

```bash
cd /mnt/docker/asg-saas-v2
SHA=$(git ls-remote https://github.com/Key-man-fromArchive/Q-Prism-SNP-visualizer.git main | cut -f1)
docker compose build --pull \
  --build-arg APP_BUILD_SHA=$SHA \
  --build-arg APP_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) snp-analyzer
docker compose up -d snp-analyzer
curl -s https://asgdesigner2.ivttools.com/snp-analyze/api/version    # 바뀐 빌드인지 확인
```

스키마가 바뀌는 릴리즈라면 재시작 전에 백업부터:

```bash
docker exec -i $CT python -c "
import sqlite3
src = sqlite3.connect('/app/data/snp_analyzer.db')
dst = sqlite3.connect('/app/data/backup-\$(date +%Y%m%d).db')
src.backup(dst)
"
```

---

## 하지 말 것

- 웹 URL fetch (SPA라 빈 HTML만 나온다)
- `psql` / `sqlite3` CLI 사용 (컨테이너에 없다)
- `docker exec` 에서 `-i` 빠뜨리기 (조용히 아무것도 안 나온다)
- 스크린샷을 저장소에 커밋
- 피드백 본문을 근거 없이 "수정 완료"로 닫기 — 검증 명령 출력을 확인한 뒤에만 `resolved`
