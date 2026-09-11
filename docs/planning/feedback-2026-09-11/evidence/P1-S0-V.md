# P1-S0-V — 표시 계층 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p1-linked-label` @ `539f36b` (P1-S1-T1 `957a6b8` + 후속 `539f36b`)
- 기준선: main `14eee7d` (P0 통합 후)
- 판정: **PASS**

## 1. 게이트 결과

| 검증 | 기준선 | 현재 | 판정 |
| --- | --- | --- | --- |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 102 files / 682 tests / 0 failed | **102 files / 687 tests / 0 failed** | PASS (+5) |
| FE `npm run build` | 성공 | 성공 | PASS |
| BE-ALL | 798 passed | 백엔드 미변경 | PASS |
| BE-LINT (변경분) | — | `.py` 변경 0건 | N/A |

### 변경분 품질 지표

| 지표 | 기준 | 측정 | 판정 |
| --- | --- | --- | --- |
| coverage (Header.tsx, stmts) | ≥70% | **78.91%** | PASS |
| 〃 branch / lines | — | 64.84% / 81.63% | |
| 순환복잡도 | ≤10 | 신규 `resolveLinkedLabel` 통과. `Header` 함수는 **26** | **기존 초과 — 아래 참조** |

`Header` 함수의 복잡도 26은 **기준선과 동일**하다. main의 `Header.tsx`를 그대로 측정해도 26이 나온다.
이번 변경이 추가한 `resolveLinkedLabel`은 분기 2개짜리 순수 함수이며 규칙을 통과한다.
기존 초과는 기준선으로 분리하며 이번 계약에서 리팩터링하지 않는다(범위 밖).

## 2. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| `target_type`/`target_id`가 화면·툴팁 어디에도 없음 | PASS — `Header.tsx`에서 `target_type`은 `t.asgTargetLabel()` 인자로만 쓰이고 그 함수는 매핑/중립 폴백만 반환. `target_id`는 완전히 제거 |
| 데스크톱·축약 **두 경로** 모두 수정 | PASS — `LinkedIdentity`와 `<summary>ASG · {label}</summary>` 모두 라벨만 사용 |
| ad_hoc에서 `Ad hoc SNP Analyze` 표시 | PASS (단위 테스트) |
| `tag_alias`가 빈 문자열이면 `marker_id` 폴백 | PASS (단위 테스트) |
| 미지 `target_type` 크래시 없음·원시값 미노출 | PASS — `?? 'ASG 연동' / 'ASG linked'` |
| en/ko 동시 갱신 | PASS — `Translations` 타입이 강제, tsc 통과 |
| 백엔드 `linked_context` 응답 불변 | PASS — 백엔드 변경 0건 |

## 3. E2E 검증

| 스펙 | 결과 |
| --- | --- |
| `tests/26-asg-compatibility.spec.ts` | **5/5 PASS** — ASG 런치 교환, 마운트 경로, 저장 거부 재시도 등 |
| `tests/24-responsive.spec.ts` | 20 failed — **기준선에서도 동일하게 실패** (아래) |

### 24-responsive 실패는 회귀가 아니다

실패 지점은 `tests/24-responsive.spec.ts:174`:

```js
await expect(page.getByRole('menu', { name: /^(More|더보기)$/ }).getByRole('menuitem')).toHaveCount(2);
```

탭 오버플로 메뉴의 항목 수에 대한 단언이며, 이번 변경(헤더 연동 라벨)과 무관하다.
**P0 상태(=현재 main)로 빌드한 서버에 같은 스펙을 돌려 동일 지점에서 동일하게 실패함을 확인했다.**

원인은 오케스트레이터가 급조한 E2E 환경이 프로젝트의 정식 환경과 다르기 때문이다.
관리자 계정으로 로그인하면 오버플로 메뉴에 참고자료·사용자·피드백 3개가 들어가는데 스펙은 2개를 기대한다.

실패한 테스트의 페이지 스냅샷에서 헤더는 **정상 렌더**되었고, 긴 `tag_alias`가 그대로 표시되며
`ad_hoc` / `target_id` 원시값은 나타나지 않았다 — 즉 이번 변경의 목적은 달성되었다.

> **한계 명시**: 이 계약의 E2E는 `docker compose`(포트 8002) 기반 정식 환경이 아니라
> 격리 uvicorn + 빌드된 static-react(포트 8112/8113)에서 실행했다. 정식 환경과의 차이로
> `24-responsive`는 신뢰할 수 없다. **P3에서 탭 구조를 바꿀 때 이 스펙을 반드시 정식 환경에서 재검증해야 한다.**

### E2E 실행 방법 (P3 재사용)

```bash
cd worktree/<phase>/snp-analyzer
export DB_PATH=/tmp/<phase>-e2e.db SNP_AUTH_MODE=local
export JWT_SECRET_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
export ADMIN_USER=admin ADMIN_PASSWORD='StrongerOperatorPassword123!'   # tests/helpers.ts 기본값
<p0venv>/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port <PORT> &
# 프론트는 npm run build 결과(app/static-react)를 백엔드가 서빙한다
cd worktree/<phase> && E2E_BASE_URL=http://127.0.0.1:<PORT> npx playwright test <spec> --project=chromium --workers=1
```

## 4. 오케스트레이터 지시 오류 정정

작업 위임 시 "`marker`는 코드에 존재하지 않으니 쓰지 말라"고 지시했으나 **틀렸다.**
`tests/26-asg-compatibility.spec.ts:85`와 `tests/24-responsive.spec.ts:128`이 `target_type: 'marker'`를 쓴다.
후속 커밋 `539f36b`으로 매핑에 추가했다.

## 5. D-8 (미해결, 부분 차단)

리포지토리에서 관측된 `target_type`은 **넷**뿐이다:

| 값 | 출처 |
| --- | --- |
| `ad_hoc` | `snp-analyzer/tests/test_asg_launch_auth.py:87` |
| `marker_version` | `snp-analyzer/tests/test_asg_launch_auth.py:56` |
| `design_run_item` | `snp-analyzer/tests/test_asg_result_save.py:105, 209, 302` |
| `marker` | `tests/26-asg-compatibility.spec.ts:85`, `tests/24-responsive.spec.ts:128` |

`target_type`은 enum/Literal이 아닌 순수 `str`(`app/asg_client.py:33`, `app/asg_session.py:13`)이므로
ASG가 다른 값을 보낼 수 있다. **ASG 계약 문서로 전체 열거값을 확정하지 못했다.**
미지 값은 중립 폴백으로 안전하게 처리되므로 차단 사유는 아니다.

## 6. 알려진 간헐적 실패

`CompareTab.test.tsx > handles real stats wire shape with nullable Pearson…`는 이번 Phase의
전체 스위트 실행에서 재현되지 않았다. P0-S0-V의 기록(5회 중 1회, CPU 경합 시)을 유지한다.
