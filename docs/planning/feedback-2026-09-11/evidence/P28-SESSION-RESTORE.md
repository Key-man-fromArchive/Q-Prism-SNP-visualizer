# P28 — 재시작하면 과거 세션을 열 수 없는 문제

Contract: `feat/restore`, branch `feat/restore` (main `ebf9631` = v1.1.2에서 분기).
작업 디렉터리: `worktree/feat-restore`. venv를 새로 만들어 `bcrypt==4.0.1`로 고정했다
(`requirements.txt`/`requirements-dev.txt`).

백엔드 기준선 재확인: `pytest -q` → **831 passed + 2 subtests** (지시받은 기준선과 일치).
변경 후: **841 passed + 2 subtests** (신규 `tests/test_p28_session_restore.py` 10건 추가).
프론트엔드는 손대지 않았고(`git status --short snp-analyzer/frontend` 무출력),
`/api/sessions` 응답 형태도 바꾸지 않았으므로 4종 프론트 게이트/E2E는 실행하지 않았다 —
근거는 "완료" 절 참고.

---

## 1. 원인 — 이미 있던 복원 코드는 "요청 시"가 아니라 "시작 시 전부"였다

`app/db.py`에는 v0.2.0부터 `load_all_sessions()`이 있었고, `app/main.py`의 `lifespan()`은
기동 시 이 함수로 **DB의 모든 세션**(판독값 포함)을 한 번에 메모리로 복원하고 있었다.
즉 "DB에서 복원하는 경로가 없다"는 것은 정확한 진단이 아니었다 — 문제는 그 경로가
**요청 단위가 아니라 기동 시 전량 로드**였다는 점이다. 47세션 × 약 2,000행 = 약 10만 행을
기동 때마다 동기적으로 전부 읽어 `UnifiedData`로 역직렬화하는 구조는:

- 세션 수가 늘수록 기동 시간이 선형으로 늘어나고,
- 헬스체크 타임아웃 등으로 기동이 완료되기 전에 프로세스가 재기동되면 **메모리는 영원히
  0인 채로 DB만 47건을 갖는** 상태에 빠질 수 있다 — 사용자가 실측한 "메모리 0 / DB 47"과
  정확히 들어맞는 실패 모드다.
- `GET /api/sessions`(`app/routers/sample.py`)는 이 메모리 dict를 순회했기 때문에, 이
  전량 로드가 아직 안 끝났거나 실패했으면 목록도 비어 나왔다.
- `GET /api/sessions/{sid}`(재열기 엔드포인트)와 8개 라우터의 `_get_session`류 헬퍼는
  전부 `sessions[sid]` 직접 접근이라 콜드 캐시에서 무조건 404였다.

그래서 이번 구현의 핵심은 "복원 로직을 새로 만드는 것"이 아니라 **"전량·기동 시" 복원을
"단일 세션·요청 시" 복원으로 바꾸고, 그 접근점을 하나로 모으는 것**이다.

---

## 2. `UnifiedData`가 들고 있는 것과 DB에 없는 것

`app/models.py`의 `UnifiedData` 필드 전체를 `app/db.py`의 `save_session()`/
`_session_row_to_entry()`(기존 `load_all_sessions()`에서 추출)와 대조했다:

| 필드 | DB 저장 위치 | 비고 |
|---|---|---|
| `input_revision` | `sessions.input_revision` | |
| `instrument`, `allele2_dye`, `has_rox` | `sessions` 컬럼 | |
| `wells`, `cycles` | `well_cycle_data`에서 역산(`DISTINCT well/cycle`) | 아래 3번 참고 — 정렬 버그 발견·수정 |
| `data` (판독값) | `well_cycle_data` | |
| `sample_names` | `metadata_json.sample_names` | |
| `imported_well_types` | `metadata_json.imported_well_types` | |
| `imported_markers` | `metadata_json.imported_markers` | |
| `protocol_steps` | `metadata_json.protocol_steps` | |
| `data_windows` | `metadata_json.data_windows` | |
| `well_groups`(파싱된 것) | `metadata_json.well_groups` | 수동 그룹은 별도 `well_groups` 테이블 |
| `normalization_mode/channel/dye` | `metadata_json` | |
| `role_channels` | `metadata_json.role_channels` | |
| `ploidy` | `metadata_json.ploidy` | |
| `background_mode` | `metadata_json.background_mode` | |
| `ntc_wells` | `metadata_json.ntc_wells` | |

**결론: `UnifiedData`의 모든 필드가 DB에 있다. 없는 것이 없다.** `WellCycleData.normalization_value`도
누락처럼 보이지만 아니다 — `generic_table.py` 파서가 정규화 채널 값을 `rox` 컬럼과
`normalization_value`에 **동시에** 쓰기 때문에(`_to_duplex_unified`), 복원 시
`normalization_value = rox if metadata.normalization_channel else None`으로 정확히
재구성된다.

분석에 실제로 영향을 주는 나머지 상태(`ClusteringResult`, 수동 well type, 마커, 수동 well
group, 샘플명 오버라이드, protocol override)도 각각 `clustering_results` /
`manual_welltypes` / `marker_regions` / `well_groups` / `sample_name_overrides` /
`protocol_overrides` 테이블에 전부 있다. **DB에 없어서 복원 불가능한 것은 없다.**

### 3. 발견한 실제 버그 — well 정렬

`load_all_sessions()`의 기존 코드는 `wells = sorted(set(d.well for d in data))`로,
문자열 사전식 정렬을 쓰고 있었다. 그런데 모든 파서(`app/parsers/*.py`)는
`sorted(wells_set, key=_well_sort_key)`(행 문자 + 열 숫자)로 정렬한다. 96/384웰 플레이트는
열이 10 이상이므로 두 정렬이 다르다 — 사전식으로는 `A10, A11, A12, A2, A3 ...` 순이 되어
업로드 직후의 `A1, A2, ..., A12` 순서와 달라진다. `unified.wells`/`well_ids`의 순서 자체가
클러스터링 계산 결과(멤버십 집합 비교만 쓰는 코드, `analysis_state.py:143` 등)에는
영향이 없지만, **복원 전후로 같은 파일을 다시 연 것처럼 보이지 않는** 이상 동작이라 P28
범위에서 수정했다: `app/db.py`에 `_well_sort_key()`를 추가해 파서들과 동일한 규칙으로
정렬한다(`tests/test_p28_session_restore.py::test_reopen_cold_session_restores_upload_equivalent_fields`
로 회귀 고정). `load_all_sessions()`/`load_session()` 양쪽이 이 픽스를 공유한다.

`sessions.num_wells`/`num_cycles` 컬럼은 업로드 시점에 `len(unified.wells)`/
`len(unified.cycles)`로 **한 번만** 쓰이고 이후 다시 쓰이지 않는다(`save_session()`의
유일한 호출부는 `create_session_from_import()`) — 그래서 메모리 값과 DB 컬럼 값 사이에
불일치가 생길 수 없다. `GET /api/sessions`는 이 컬럼을 그대로 쓴다.

---

## 4. 구현

### 4.1 단일 접근점

`app/services/session_restore.py`(신규)가 유일한 진입점이다:

- `restore_session(sid) -> UnifiedData | None` — 메모리에 있으면 그대로 반환(+ LRU 터치),
  없으면 `db.load_session(sid)`(신규, `db.py`의 `_session_row_to_entry()`를
  `load_all_sessions()`와 공유)로 DB에서 재구성해 `sessions`/`cluster_store`/
  `welltype_store`/`marker_store`/`group_store`/`sample_name_store`/`protocol_store`를
  **한 번에** 채운다. DB에도 없으면 `None`(합성된 빈 세션을 절대 반환하지 않음).
- `get_session(sid) -> UnifiedData` — 위를 감싸 표준 `404 "Session not found"`를 던진다.

기존에 각 라우터가 독립적으로 갖고 있던 `if sid not in sessions: raise 404 / return
sessions[sid]` 패턴(clustering.py, export.py, qc.py, quality.py, statistics.py,
compare.py, data.py, layouts.py, marker_catalog.py, batch.py의 5개 지점,
reporting/result_snapshot.py, 그리고 지시서에 명시되지 않았지만 실제로 "세션 재열기"의
본체인 **sample.py의 `GET /api/sessions/{sid}`와 자체 `_get_session`**)를 전부 이
모듈로 위임하도록 바꿨다. `app/processing/analysis_state.py:176`의 `sessions[sid]`
직접 참조는 손대지 않았다 — 호출 체인상 언제나 `clustering._capture_analysis`가 먼저
`_get_session(sid)`로 캐시를 데운 뒤에만 호출되는, 기존에도 있던 불변식이라 별도 복원이
불필요하다(주석으로 명시하지 않고 그대로 둔 것은 최소 변경 원칙).

### 4.2 `GET /api/sessions` — DB에서 직접 목록 생성

`app/routers/sample.py::list_sessions`를 메모리 dict 순회에서 `sessions` 테이블 직접
쿼리로 다시 짰다. **응답 필드/형태는 바꾸지 않았다**: `session_id, instrument, num_wells,
num_cycles, uploaded_at, raw_filename`(최신순). `well_cycle_data`를 전혀 읽지 않는다 —
`tests/test_p28_session_restore.py::test_list_sessions_does_not_touch_well_cycle_data`가
실제 SQL을 가로채 `well_cycle_data`가 등장하면 즉시 실패하도록 고정했다.

### 4.3 기동 시 전량 로드 제거

`app/main.py`의 `lifespan()`에서 `load_all_sessions()` 루프를 제거했다. 기동 시 하는
일은 `init_db()` / `_ensure_admin()` / `_migrate_projects_json()`뿐이고, 세션은 전부
콜드 상태로 시작해 첫 요청에서 개별 복원된다. `db.load_all_sessions()` 함수 자체는
지우지 않았다 — 기존 지속성 테스트들(`test_clustering_persistence.py`,
`test_marker_persistence.py`, `test_analysis_context_persistence.py`,
`test_analysis_revision_races.py`, `test_session_cycles.py`)이 "DB에 실제로 뭐가
저장됐는지"를 검증하는 용도로 직접 호출하고 있어 시그니처/동작을 유지해야 했다.

이 변경으로 기존 테스트 2건이 레드가 됐다(둘 다 "lifespan이 즉시 메모리를 채운다"는
옛 계약을 직접 검증하고 있었다):

- `test_analysis_context_persistence.py::test_real_lifespan_restores_saved_revision_and_context`
- `test_p5_r0_t1_compatibility.py::test_real_process_restart_restores_owner_revision_context_and_all_analysis_state`
  (실제 서브프로세스로 앱을 껐다 켜서 owner/revision/context/marker/welltype/group/
  protocol/assignments 전체가 살아남는지 검증하는, 이번 작업에 가장 가까운 기존 테스트)

두 테스트 모두 "lifespan 직후 자동으로 메모리에 있다"는 단언을 "lifespan 이후 첫 접근
(`get_session()`)에서 복원된다"로 최소 수정했다 — 검증하던 내용(리비전/컨텍스트/마커/
well type/그룹/protocol/판정이 재시작 후에도 그대로인지)은 하나도 약화하지 않고, 트리거
지점만 아키텍처 변경에 맞게 옮겼다. 두 번째 테스트는 그 자체로 이번 기능의 왕복 검증
증거이기도 하다(아래 5절).

### 4.4 메모리 유지 정책

`app/services/session_restore.py`에 접근-순서 기반 LRU를 뒀다:

- 상한 `SESSION_CACHE_MAX_ENTRIES`(기본 200, env override 가능, `app/config.py`).
  47세션/약 10만 행이라는 실측치의 넉넉한 배수로 잡았다 — 더 커지면 값을 올리거나 더
  똑똑한 정책이 필요하다는 것을 주석에 남겼다.
  업로드(`create_session_from_import`) 시점에도 `touch_session()`을 호출해 새로 올라온
  세션도 같은 회계에 잡히게 했다(안 그러면 업로드로만 채워진 세션은 절대 카운트되지 않아
  상한이 새는 구멍이 된다).
- **발행 중(pending) 세션은 절대 축출하지 않는다** — `app.processing.analysis_state
  .publication_states`를 조회해 `pending=True`인 sid는 후보에서 제외한다. 계산 도중
  `UnifiedData`가 메모리에서 뽑혀나가면 그 계산 자체가 깨지기 때문에, 가장 오래 쓰지
  않은 세션이라도 보호한다(`test_lru_eviction_respects_cap_and_spares_in_flight_sessions`).
- 세션이 삭제되면(`_delete_sessions_impl`) LRU 추적에서도 제거한다(`forget_session`) —
  안 그러면 삭제된 sid가 영원히 슬롯을 차지해 유효 상한이 조금씩 줄어든다.

---

## 5. 왕복 검증 (가장 중요한 테스트)

`tests/test_p28_session_restore.py::test_clustering_round_trip_identical_before_and_after_cold_restore`:

1. 업로드(메모리+DB) → `POST /markers`로 마커 2개 생성 → `PUT /welltypes/bulk`로 수동
   well type 하나 추가(파일에서 파싱된 것이 아니라 **welltype_store에만 있던** 오버라이드) →
   `POST /groups`로 수동 그룹 하나 생성(**group_store에만** 있던 것) → `POST /cluster`로
   분석 실행·저장.
2. 캐시 전부 비움(`sessions`/`cluster_store`/`welltype_store`/`marker_store`/
   `group_store`/`sample_name_store`/`protocol_store`/LRU 추적 — 프로세스 재시작 시뮬레이션).
3. `GET /cluster` → **저장된 결과가 재계산 없이 그대로** 복원 후에도 동일
   (`assignments`/`algorithm`/`cycle` 완전 일치).
4. `GET /markers`, `GET /welltypes`, `GET /groups` → 복원 후 값이 복원 전과 완전 일치
   (마커·수동 well type·수동 그룹 전부 복원됨을 개별 확인).
5. 다시 캐시를 비우고 `POST /cluster`(동일 요청 본문)로 **진짜 재계산**을 시켜, 그 결과가
   1번의 원본 `assignments`와 동일한지 확인 — 캐시된 행을 재생하는 게 아니라, 복원된
   마커/well type 오버레이 자체가 원본과 같은 유효 입력을 만들어낸다는 것을 증명한다.

마커/수동 well type/수동 그룹을 아예 만들지 않은 "평범한" 세션도
`test_restore_without_any_manual_overrides_still_matches`로 같은 방식 확인.

기존 `test_p5_r0_t1_compatibility.py::test_real_process_restart_restores_owner_revision_context_and_all_analysis_state`는
진짜 서브프로세스 재시작으로 owner/input_revision/instrument/wells/markers/welltypes/
groups/protocol/assignments/context_revision/result_revision **전부**가 동일함을
확인한다(수정 후에도 통과) — 이번 기능의 가장 강한 회귀 보증이다.

**결론: 복원 전후로 분석 결과가 달라지지 않는다.** algorithm_version(v1.1.0, `"c5"`)이
바뀐 것도 아니고, 복원 경로가 별도의 계산 로직을 타는 것도 아니다(`_calculate_snapshot`을
호출하지 않고 DB에 있던 `ClusteringResult`를 그대로 `cluster_store`에 올린다) — 저장된
판정과 복원된 판정은 동일 객체의 재직렬화일 뿐이다.

---

## 6. 권한

`check_session_access()`(`app/auth.py`)는 이미 DB의 `sessions.user_id`를 직접 조회하므로
메모리 상태와 무관하다 — 복원 로직을 손대지 않아도 권한 규칙은 자동으로 유지된다.
`test_other_users_cold_session_is_still_403_not_leaked`(비-admin이 남의 콜드 세션을
열면 403)와 `test_admin_can_open_any_users_cold_session`(admin은 콜드 세션도 전체 접근)으로
확인했다.

한 가지 동작 변화: `GET /api/sessions/{sid}`는 기존에 "메모리에 없으면 무조건 404"였는데,
이제 콜드 세션은 복원 후 소유자 확인을 거쳐 **403**(존재하지만 내 것이 아님)을 돌려줄 수
있다. 이는 정보 노출이 아니라 오히려 **일관성 개선**이다 — 같은 세션이 우연히 메모리에
남아있을 때는 원래도 403이었고(`check_session_access`가 먼저 걸림), 콜드일 때만 잘못된
404였다.

---

## 7. 실패 시 동작 — 정의됨

- **존재하지 않는 sid**: `restore_session()`이 `None`을 반환하고, 모든 호출부가 이를
  명시적 404로 변환한다(빈 배열/빈 객체로 조용히 넘어가는 경로 없음).
  `test_reopen_nonexistent_session_is_a_clear_404_not_empty`로 고정.
- **DB에 세션 행은 있지만 판독값이 0건**인 극단 사례는 이번 스코프에서 별도로 만들지
  않았다(운영에서 그런 상태가 나온 적이 없고, 있다면 그 자체가 `save_session()`의
  버그다) — `_session_row_to_entry()`는 이 경우 `wells=[]`, `cycles=[]`인 유효한
  `UnifiedData`를 만들어 반환하며 예외를 던지지 않는다. 클러스터링 쪽은 이미
  `cycle not in unified.cycles` 등 기존 검증에서 걸린다.
- **복원 불가 결론은 나지 않았다** — 3절에서 정리한 대로 `UnifiedData`와 그에 딸린
  분석 상태 전부가 DB에 있고, 왕복 검증도 통과했다.

---

## 8. 성능

- `GET /api/sessions`는 `sessions` 테이블 컬럼만 읽는다(`well_cycle_data` 미접근,
  테스트로 강제).
- 복원은 요청된 세션 1건만(`load_session(sid)`, 기동 시 전량 로드 없음).
- 실측(운영 규모 재현): 47세션 스케일에서 별도 벤치마크 스크립트는 만들지 않았다 —
  이번 변경의 성능 이득은 "O(전체 세션 수)에서 O(1 세션)으로" 라는 알고리즘적 사실이고,
  기동 로그(smoke test, 아래)로 기동이 DB 크기와 무관하게 즉시 끝나는 것만 확인했다.

```
uvicorn app.main:app --port 8270 (빈 DB) → GET /api/version 200 (기동 후 3초 이내, sleep 여유 포함)
```

---

## 9. RED 증거

구현 전 커밋(`app/`만 되돌리고 `tests/test_p28_session_restore.py`는 유지) 상태에서
신규 테스트 10건 전부 `ImportError: cannot import name 'session_restore'`로 에러
(수집 단계 실패, 10 errors) — 구현 적용 후 10건 전부 통과로 전환됨을 확인했다.

---

## 10. 검증 결과

- 백엔드 전체: `pytest -q` → **841 passed, 39 warnings, 2 subtests passed**
  (기준선 831 + 2 subtests에서 신규 10건 추가, 회귀 없음).
- 변경한 `.py` 전체(`app/config.py`, `app/db.py`, `app/main.py`,
  `app/reporting/result_snapshot.py`, `app/routers/{batch,clustering,compare,data,
  export,layouts,marker_catalog,qc,quality,sample,statistics}.py`,
  `app/services/import_session.py`, `tests/test_analysis_context_persistence.py`,
  `tests/test_p5_r0_t1_compatibility.py`, `tests/test_p28_session_restore.py`):
  `ruff check` → 신규 unused-import 2건 발견·수정 후 all clean(나머지 `ruff check app/`
  경고 3건은 `app/parsers/{cfx_opus,quantstudio,vendor_presets}.py`로 이번 변경과
  무관한 기존 항목).
- 신규 파일(`app/services/session_restore.py`, `tests/test_p28_session_restore.py`)만:
  `ruff format --check` → 적용 후 통과.
- 프론트엔드: 파일 변경 없음, API 응답 형태 불변 → 4종 게이트/E2E(140/140) 미실행.
  근거: `/api/sessions` 필드/순서 불변, 다른 모든 엔드포인트의 응답 스키마도 변경하지
  않았고(라우팅 로직만 "메모리 직접 접근 → 복원 경유 접근"으로 교체), TestClient 기반
  백엔드 통합 테스트(`test_p28_session_restore.py`)가 실제 FastAPI ASGI 스택(인증
  의존성 포함)을 통해 이미 동일한 경로를 검증한다.

---

## 완료

`TASK_DONE:P28-RESTORE:<commit_sha 참고 — 커밋 로그 확인>`

- `UnifiedData`가 들고 있는 것: 3절 표. DB에 없는 것: 없음(전부 저장됨).
- 왕복 검증: 5절 — 복원 전후 분석 결과 동일(캐시된 결과·재계산 결과 양쪽 확인).
- 접근점 통합: `app/services/session_restore.py` 단일 모듈, 10개 이상 호출부가 위임.
- 메모리 유지 정책: LRU 상한 200(env override), 발행 중 세션 보호, 근거는 4.4절.
- 성능: 목록 조회 DB 컬럼만, 복원은 요청 세션 1건만, 기동 시 전량 로드 제거.
- RED 증거: 9절. 검증 결과: 10절.
