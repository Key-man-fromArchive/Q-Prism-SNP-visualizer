# P16-ASG-ORDER — ASG launch 테스트의 순서 의존성 제거

- Contract: `qprism-ux-followup-20260907-v1` 계열 후속 (`feedback/p16-followup`)
- Worktree: `worktree/feedback-p16` / 브랜치 `feedback/p16-followup` (main `e308521`에서 분기)
- 대상: `tests/26-asg-compatibility.spec.ts:271` (`exchanges an ASG launch once, restores URL state, and removes the launch token`)

## 1. 의존하던 상태 — 계측 결과

가설(브라우저 쿠키/세션스토리지 잔존)을 먼저 배제했다. Playwright의 기본 `page` fixture는
테스트마다 새 `BrowserContext`를 만들고(`playwright.config.ts`에 `storageState` 공유 없음),
`mountedProxy`(파일 단위 `beforeAll`로 기동되는 리버스 프록시)는 요청을 모드 헤더만으로
분기하는 순수 함수라 자체 상태를 갖지 않는다. 따라서 순서 의존은 **테스트/프록시가 아니라
그 뒤에 있는 실제 백엔드**에서 발생한다는 것을 계측으로 확인했다.

### 1-1. 재현 조건

| 실행 방식 | 신선한 DB (직전 실행 없음) | `:218`(실 로그인) 테스트를 먼저 돌린 뒤 |
| --- | --- | --- |
| `:271` 단독 3회 | 3/3 통과 | **3/3 결정론적 실패** |

`:203`(자산 확인), `:243`(거부), `:316`(저장 거부)을 먼저 실행해도 `:271`은 영향받지 않음 —
**`:218` 한 테스트만**이 이후 `:271`의 결과를 바꾼다는 것을 개별 격리 실행으로 확인했다.

### 1-2. `page.on('response')` / `page.evaluate` 계측으로 확인한 실제 원인

`:271`은 `/api/auth/config`와 `/api/auth/asg-launch`만 헤더 기반으로 합성 응답을 받고
(`syntheticAuthResponse`), 그 두 엔드포인트가 매번 **200 + `set-cookie:
snp_auth=synthetic-auth-cookie`**를 반환하는 것까지는 순서와 무관하게 항상 동일했다
(디버그 로그로 확인: `[DEBUG RES] 200 ... /api/auth/config set-cookie=...`,
`[DEBUG RES] 200 ... /api/auth/asg-launch set-cookie=...`, 쿠키는 브라우저에 정상 저장됨).

문제는 그 다음이다. `tab=project` 복원으로 project 탭이 마운트되며 실제 백엔드로
`/api/sessions`, `/api/projects`를 호출하는데, 이 쿠키(`synthetic-auth-cookie`)는
**실제 백엔드가 발급한 적 없는 값**이라 `app/auth.py:266`의
`get_current_user`가 항상 `401 Invalid or expired token`으로 거부한다 — 이는 DB 상태와
무관하게 결정론적이다(계측 로그의 `[PROXY RES] /api/sessions 401`, `/api/projects 401`).

그런데 `src/lib/api.ts:160`:
```ts
function responseError(res: Response, payload: unknown): ApiError {
  if (res.status === 401) useAuthStore.getState().clearAuth();
  ...
}
```
`apiFetch`를 쓰는 **어떤** 엔드포인트든 401을 받으면 전역적으로 `clearAuth()`를 호출해
로그인 상태를 지운다. 즉 `/api/sessions`/`/api/projects`의 401(원래 이 테스트의 검증
대상과 무관한 부수 호출)이 방금 성공시킨 ASG 로그인 자체를 되돌려 "세션이
만료되었거나 로그인이 필요합니다" 화면으로 되돌린다.

이 401은 **두 방식 모두에서 항상 발생**하지만(신선한 DB에서도 `[PROXY RES]
/api/sessions 401`이 찍힘), `expect(header).toBeVisible()`는 Playwright가 짧은 간격으로
폴링하며 한 번이라도 조건을 만족하면 즉시 통과 처리한다 — `clearAuth()`가 그 폴링 창보다
늦게 도착하면 테스트는 우연히 통과하고, 앞선 `:218` 테스트가 프로세스/네트워크를 예열해
`/api/sessions`·`/api/projects` 응답이 상대적으로 빨리 오면 `clearAuth()`가 헤더 확인보다
먼저 끝나 항상 실패한다. 즉 **"테스트 순서 의존"으로 보였던 현상의 실체는, 이 테스트가
로그인 후 실제로 발생하는 부수 API 호출(세션/프로젝트 목록)을 함께 목킹하지 않아 생긴
경합(레이스)**이며, 그 경합의 승패 확률이 앞선 테스트가 만든 타이밍(프로세스 예열)과
상관관계를 가졌던 것이다.

이 인과관계를 확인하려고 `tests/26-asg-compatibility.spec.ts`에 임시로 진단 로그
(`page.on('response')`, `page.context().cookies()` 덤프)를 추가해 실행한 뒤, 검증이 끝나고
**원본으로 되돌렸다**(`git checkout -- tests/26-asg-compatibility.spec.ts`로 확인;
최종 diff에는 진단 코드가 남아있지 않음).

`x-p5-auth-mode`, `sessionStorage`의 `__asg_launch_token`,
`window.__ASG_LAUNCH_TOKEN__`, `:243`이 만드는 별도 컨텍스트(`asgContext`)의 close는
모두 배제했다 — 각각 새 `BrowserContext`/새 페이지이므로 `:271`의 컨텍스트와 격리되어
있고, 계측 로그에서도 `:271` 실행 시작 시점의 쿠키/세션스토리지는 항상 비어 있었다
(`[DEBUG COOKIES AFTER GOTO] []`, `launchStorage: null`, `fallback: null`).

## 2. 자족화 — 적용한 수정

`tests/26-asg-compatibility.spec.ts`의 `:271` 테스트에 `page.route()`로
`/api/sessions`(빈 배열), `/api/projects`(`{ projects: [] }`)를 목킹하는 두 줄을
`page.goto()` 이전에 추가했다. ASG 성공 교환은 합성 응답으로 완전히 대체되는데
프로젝트 탭 복원이 유발하는 후속 조회만 실제 백엔드로 새 나가던 비대칭을 없애,
테스트가 검증하려는 것(런치 교환 1회, URL 복원, 토큰 제거)과 무관한 실제 백엔드
상태에 더 이상 의존하지 않는다. 이것은 프로덕션에서 실제 ASG 런치가 성공하면
백엔드가 발급한 **진짜** 쿠키로 이 두 호출이 200을 받는 상황과 더 가깝게 만드는
수정이라, 검증을 느슨하게 하지 않았다 — 오히려 이전에는 테스트 자체의 불완전한
목킹이 만든 인위적 401이 실제 동작을 왜곡하고 있었다.

기존 단언(`launchPosts === 1`, URL 복원, `assertLaunchSecretConsumed`, 콘솔/네트워크/
아티팩트에 토큰 미노출)은 전혀 건드리지 않았다.

앱 코드(`src/lib/api.ts`의 전역 401→로그아웃 부수효과)는 실제로 존재하는 별도 이슈로
보이지만, 이번 작업 지시 범위(테스트 자족화, 사전 승인 없는 앱 코드 수정 금지)를 넘어서므로
수정하지 않았다. 프로덕션에서 실제 ASG 발급 쿠키는 유효하므로 이 부수효과가 실사용
경로에서 즉시 문제를 일으키는지는 별도 확인이 필요하다는 점만 기록해 둔다.

## 3. 파일 내 다른 테스트 점검

`:203`, `:218`, `:243`, `:316` 네 테스트 모두 **동일한 DB를 이어서 사용한 상태에서**
단독 실행 3회씩 전부 통과했다(§4 표). `:271`과 달리 이들은 실제 로그인(`loginAtMount`)을
쓰거나(`:218`, `:316`) 인증 실패 경로만 검증해(`:203` 부분, `:243`) 백엔드가 인식하는
쿠키만 사용하므로 같은 문제가 없다. 추가 수정은 불필요하다고 판단했다.

## 4. 검증 결과

포트 8200, DB `/tmp/p16.db` (정책은 §5 참고). 전부
`E2E_BASE_URL=http://127.0.0.1:8200 npx playwright test --project=chromium --workers=1 ...`.

| 실행 | 결과 |
| --- | --- |
| `:271` 단독 3회 (신선한 DB 직후) | 3/3 통과 |
| `:271` 단독 3회 (`:218` 직후, 이전에는 3/3 결정론적 실패했던 조건) | 3/3 통과 |
| `:203` 단독 3회 | 3/3 통과 |
| `:218` 단독 3회 | 3/3 통과 |
| `:243` 단독 3회 | 3/3 통과 |
| `:271` 단독 3회 (누적 DB 상태에서 재확인) | 3/3 통과 |
| `:316` 단독 3회 | 3/3 통과 |
| 파일 전체(5개) 3회 연속 | 3/3 (매회 5/5 통과) |
| 전체 스위트 1회차 | 137/138 통과 — `26-chart-semantics.spec.ts:68`(`route.fetch: Target page, context or browser has been closed`)에서 1건 실패. 이 파일을 단독으로 2회 재실행하면 모두 5/5 통과하고, 실패 지점은 `:271`이 아니라 완전히 다른 스펙 파일의 teardown 타이밍 이슈다 — 이번 수정과 무관한, 138개 테스트를 순서대로 도는 긴 스위트에서 드물게 나타나는 기존 결함으로 판단했다. 앱 코드/다른 스펙 파일 수정은 이번 작업 범위 밖이라 손대지 않았다. |
| 전체 스위트 2회차 | **138/138 통과** |

작업 중 tests/ 아래에 임시로 복사했던 진단용 `zz-debug-asg.spec.ts`는 검증 후 삭제했다
(`git status --short tests/`로 `26-asg-compatibility.spec.ts` 한 줄만 변경됨을 확인).

## 5. DB 초기화 정책

- 실행 전체를 통틀어 DB(`/tmp/p16.db`)는 **딱 한 번**만 신선하게 초기화했고, 이후
  §4의 모든 단독/파일/전체 스위트 실행은 **그 DB를 계속 이어서** 사용했다.
- 근거: 이 문제의 재현 조건 자체가 "이전 테스트가 실제 백엔드 상태를 남긴 뒤"였다.
  매 실행마다 DB를 새로 만들면 정확히 그 재현 조건을 지워버려 회귀를 놓칠 위험이
  있다. 그래서 의도적으로 **가장 불리한 조건(누적된 실제 로그인 세션이 존재하는
  DB)을 계속 유지**한 채 통과를 확인해, 수정이 타이밍이 아니라 원인을 없앴다는 것을
  입증했다.
- 서버는 `DB_PATH=/tmp/p16.db SNP_AUTH_MODE=local` 조합으로 포트 8200에 단일
  프로세스로 띄웠고, 종료는 `pkill` 대신 `ps`로 확인한 PID를 직접 `kill`했다.
  `/tmp/p16.db`, `-shm`, `-wal`은 서버 종료 후 함께 삭제했다. 프로덕션 DB
  (`/app/data/snp_analyzer.db`)와 포트 8002/8201은 사용하지 않았다.

## 6. 결론

- `:271`의 순서 의존은 셀레늄 프록시나 브라우저 저장소 잔존이 아니라, 테스트 자신의
  불완전한 목킹(ASG 로그인만 흉내내고 그 뒤 이어지는 세션/프로젝트 조회는 실제
  백엔드로 흘려보냄)과 `apiFetch`의 전역 401→로그아웃 부수효과가 만든 **경합
  조건**이었다. `/api/sessions`, `/api/projects`를 목킹해 테스트를 자족적으로 만들자
  경합이 사라졌다.
- 파일 내 다른 4개 테스트는 이미 자족적이다(단독 3회씩 전부 통과).
- 전체 스위트는 138/138 통과(2회차 확인). 1회차의 단일 실패는 다른 스펙 파일의
  기존 teardown 타이밍 이슈로, 이번 변경과 무관하다고 판단해 범위 밖으로 남겼다.
