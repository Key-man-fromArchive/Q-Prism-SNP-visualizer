# P29-CALENDAR — 과거 작업 내역을 달력으로 보는 화면

Contract: qprism-ux-followup-20260907-v1 계열, feedback 2026-09-11. 브랜치
`feat/calendar` (main `ebf9631` = v1.1.2에서 분기), 워크트리
`worktree/feat-calendar`.

## 사용자 요청

> 이전작업내역을 달력형태로 볼 수 있으면 좋겠습니다

## 배치 결정과 근거

기존 `snp-analyzer/frontend/src/components/upload/RecentSessions.tsx`를 먼저
읽었다. 이건 업로드 화면에 떠 있는 "최근 세션" 퀵 액세스로, `useRecentSessions(5)`
로 최신 5개만 보여주고 파일 업로드 전 맥락에서 쓰인다. 반면
`snp-analyzer/frontend/src/components/batch/BatchTab.tsx`("프로젝트" 탭,
`sessionFree: true`)는 이미 `useRecentSessions(null, onLoadSession)`로 **전체**
세션 목록을 불러와 표(정렬/일괄삭제/프로젝트 배정/삭제/열기)로 보여주고 있었다.

**결정**: 새 화면이나 새 탭을 만들지 않고, `프로젝트` 탭의 기존 "세션" 패널에
`표 / 달력` 토글을 추가해 같은 `sessions` 목록·같은 열기 경로(`recovery.open`)
위에 달력이라는 또 다른 렌즈를 얹었다. `RecentSessions`는 그대로 둔다 — 업로드
직후 "방금 그 파일 다시 열기" 같은 짧은 목록이라는 별개 역할이 있고, 사용자
요청은 "과거 작업 내역을 보는" 것이지 업로드 화면 퀵 액세스를 바꿔 달라는 게
아니었다. 기존 세션 목록 기능(표)은 제거하지 않았다 — `표` 버튼으로 여전히
기본값이며 그대로 동작한다.

월 단위 달력을 선택했다: 신고에 적힌 실제 분포(두 달에 47건, 하루 최대 9건,
대부분의 날은 0건)가 월 단위에서 이미 "빈 칸이 대부분"이라 주 단위로 쪼갤
필요가 없었고, 월 이동(‹ ›, 오늘)만으로 다른 달을 확인할 수 있게 했다.

## 구현

- `src/lib/session-calendar.ts` — 순수 로직만: UTC 파싱(`parseUploadedAtUtc`),
  로컬 날짜 키(`localDateKey`), 날짜별 그룹핑(`groupSessionsByDate`), 월 그리드
  생성(`monthGrid`, 월요일 시작, 7칸씩 꽉 채움). 달력 라이브러리를 추가하지
  않았다 — 이 모듈이 이 기능에 필요한 날짜 연산의 전부다.
- `src/components/batch/SessionCalendar.tsx` — 프레젠테이션 컴포넌트.
  `sessions: SessionListItem[]`, `onOpen: (sessionId) => void`,
  `activeSessionId?`만 받는다. 백엔드 호출도 상태도 갖지 않는다 — 목록 로딩,
  에러, 열기 실행은 전부 `BatchTab`이 이미 갖고 있던 `useRecentSessions` 훅과
  `SessionRecoveryFeedback`이 그대로 담당한다.
- `src/lib/tab-keyboard.ts`에 `navigateGrid(event, cols)` 추가 — 기존
  `navigateTabs`와 같은 스타일의 화살표 키 로빙 포커스. 탭과 달리 화살표는
  포커스만 옮기고 활성화하지 않는다(네이티브 날짜 선택기 관례와 동일; Enter/
  Space는 `<button>`이 원래 하던 대로 동작).
- `src/components/batch/BatchTab.tsx` — "세션" 패널 헤더에 `표 / 달력` 토글
  (`role="group"`, `aria-pressed`)을 추가하고, `sessions.length > 0`일 때
  `sessionView`에 따라 기존 `<table>` 또는 `<SessionCalendar>`를 렌더링한다.
  `sessions.length === 0`이면 기존 `SessionEmptyState`로 그대로 떨어진다 — 보기
  모드와 무관하게 빈 상태는 하나로 유지.
- 로케일: `src/locales/{ko,en}.ts`에 `sessionView*`, `calendar*` 15개 키 추가.
  요일/월 이름은 `Intl`이 아니라 로케일 파일 안의 명시적 함수(예:
  `calendarWeekdayShort(day)`, `calendarMonthLabel(year, month)`)로 뒀다 —
  ICU 버전차 없이 결정적이고, 이 레포의 다른 함수형 번역 키(`nSessions`,
  `deleteSessionConfirm` 등)와 같은 패턴이다.

## 시간대 처리

`GET /api/sessions`의 `uploaded_at`은 UTC 벽시계 문자열이며 공백으로 구분된
`"2026-09-14 04:55:29"` 형태다 — 이 형태는 ECMAScript의 스펙 보장 ISO 파싱
대상이 **아니다**. 이 레포가 실제로 쓰는 엔진(V8)에서 직접 확인했다:

```
TZ=Asia/Seoul node -e '
  const d = new Date("2026-09-14 04:55:29");
  console.log(d.toString());   // Mon Sep 14 2026 04:55:29 GMT+0900 (KST)  <- 로컬로 오해
  console.log(d.toISOString()); // 2026-09-13T19:55:29.000Z               <- 실제로는 하루 전 저녁
'
```

즉 아무 보정 없이 그대로 `new Date(...)`에 넘기면, 브라우저는 이 문자열을
**로컬 시각**으로 오해한다. KST 사용자가 보는 화면에서는 "04:55"라는 숫자만
보고 새벽으로 착각하지만, 실제 그 순간은 UTC 04:55 = KST 13:55(같은 날 낮)다.
더 나쁜 실제 사례: UTC 저녁~밤 업로드(KST 새벽)가 브라우저 로컬 파싱에서는
그 "전날 저녁"으로 잘못 표시된다 — 새벽에 올린 파일을 사용자가 다음날 달력
칸에서 찾다가 못 찾는 정확히 그 시나리오.

`session-calendar.ts`의 `parseUploadedAtUtc`는 이를 명시적으로 고정한다:
공백 구분 문자열은 `T`+`Z`를 붙여 UTC로 앵커하고, 순수 날짜(`"2026-09-07"`)는
스펙상 이미 UTC 자정이라 그대로 두며, 이미 `Z`/오프셋이 있는 문자열은 신뢰한다.
그 다음 `localDateKey`가 `Date`의 로컬 getter(`getFullYear`/`getMonth`/
`getDate`)로 브라우저의 실제 로컬 타임존 날짜를 뽑는다 — 이 레포 CI/샌드박스는
`Etc/UTC`라 "로컬 == UTC"로 보이지만, 사용자의 실제 KST 브라우저에서는
`getDate()` 자체가 KST 기준으로 계산되므로 별도 KST 하드코딩 없이 올바르게
동작한다.

**단위 테스트로 KST 새벽 이월을 직접 재현**했다
(`src/lib/session-calendar.test.ts`): `process.env.TZ`를 테스트 안에서
`Asia/Seoul`로 바꾼 뒤(Node/V8은 `Date` getter 호출 시점에 `TZ`를 다시 읽으므로
동적으로 유효하다, 직접 확인함), UTC `"2026-09-13 20:00:00"`이
`localDateKey`로 `"2026-09-14"`(KST 새벽 05:00)가 되는지, 반대로 `TZ=UTC`에서는
그대로 `"2026-09-13"`이 되는지 둘 다 검증한다. 추가로 시각 확인 스크린샷 한
세트도 Playwright 컨텍스트를 `Asia/Seoul`로 명시해 실제 렌더링을 확인했다(아래).

## 열기 실패를 사용자에게 보이는 방법

`SessionCalendar`는 세션을 열지 않는다 — `onOpen(sessionId)`만 호출하고,
`BatchTab`은 이걸 표의 "불러오기" 버튼과 똑같은 함수(`recovery.open`, 즉
`useRecentSessions().open`)에 그대로 연결한다. 그 결과 달력에서 연 세션이
실패해도 표에서 실패했을 때와 **동일한 코드 경로**로
`<SessionRecoveryFeedback state={recovery} />`(패널 최상단, 이미 렌더링되어
있음)가 `role="alert"`로 에러를 띄운다 — 새로 만든 게 아니라 기존 배관을
재사용했다. 404를 예로 스크린샷과 통합 테스트로 확인:
`P29-CALENDAR-calendar-open-fail-1440-light-ko.png` /
`-dark-ko.png`(패널 위쪽에 "이 항목이 더 이상 존재하지 않습니다. 목록을
새로고침하세요." + "목록 새로고침 재시도" 링크), 테스트는
`BatchTab.calendar.test.tsx`의 `'surfaces a failed open from the calendar the
same way the table does'`.

지금 이 워크트리에서는 `worktree/feat-restore`의 세션 복원 작업이 아직 병합
전이라 실제로 과거 세션을 클릭해도 서버 메모리에 없어 열리지 않는다 — 이건
정상이고 그쪽에서 해결된다. 위 실패 표시 경로가 바로 그 상황에서 사용자에게
보이는 화면이다.

## 접근성

- 달력은 `role="grid"`(주간 `role="row"`, 날짜 `role="gridcell"`) — 기존
  `PlateView.tsx`/`ResultsTable.tsx`의 같은 패턴을 재사용해 이 레포 안에서
  일관적이다.
- 화살표 키(←→↑↓, Home/End)로 날짜 간 포커스 이동, Enter/Space로 선택 —
  `navigateGrid`(신규, `tab-keyboard.ts`)와 각 날짜 버튼의 롤링 `tabIndex`
  (선택된 날짜 → 없으면 해당 월의 첫 날짜)로 구현. 이번 달 밖의 날짜는
  `disabled`라 포커스/탭 순서에서 제외된다.
- 각 날짜 버튼의 `aria-label`이 "2026년 9월 14일, 2개 세션"처럼 날짜와 세션
  유무·개수를 함께 읽어준다 — 시각적 배지(●2)에 의존하지 않고 스크린 리더로도
  "일정 있음"을 알 수 있다.
- 월 이동 시 헤더 라벨은 `aria-live="polite"`로 감싸 월 전환이 공지된다.
- 색만으로 구분하지 않는다: 세션이 있는 날은 숫자 배지 + `aria-label` 텍스트
  둘 다로 표시된다.
- 색상 대비: 새 UI 전부 이 레포가 이미 라이트/다크 양쪽에서 감사된 CSS
  변수(`--color-primary`, `--color-surface`, `--color-border`, `--color-text`,
  `--color-text-muted`, `--color-on-primary`, `--color-danger` 등,
  `snp-analyzer/frontend/src/index.css`)만 썼다 — 새 색을 추가하지 않았으므로
  기존 감사 범위를 벗어나지 않는다.

## 하루 9건 — 레이아웃

선택한 날짜의 세션 목록은 `max-h-60 overflow-y-auto`인 `<ul>` 안에 렌더링된다
— 그 날의 세션이 1개든 9개든 목록 컨테이너 높이는 고정이고 넘치면 그 안에서만
스크롤된다(패널 전체나 페이지 레이아웃은 항상 그대로). 단위 테스트
(`SessionCalendar.test.tsx`, `'does not break when a day has 9 sessions'`)로
9개 전부 도달 가능한지 확인했고, 스크린샷
(`P29-CALENDAR-calendar-dense-day-1440-light-ko.png`,
`-calendar-dense-day-768-dark-ko.png`)으로 1440/768 양쪽에서 실제 렌더를
확인했다.

## RED 증거

기능 코드가 존재하기 전에 세 테스트 파일을 먼저 작성해 전부 "모듈을 찾을 수
없음"으로 실패하는 것을 확인했다(`npx vitest run ...` → `Failed to resolve
import`):

- `src/lib/session-calendar.test.ts` (12 tests) — `./session-calendar`가 없어
  실패.
- `src/components/batch/SessionCalendar.test.tsx` (8 tests) — `./SessionCalendar`
  가 없어 실패.
- `src/components/batch/BatchTab.calendar.test.tsx` (3 tests) — 이건 기존
  `BatchTab`에 대한 테스트라 모듈 자체는 있었지만, 달력 토글/`SessionCalendar`
  통합이 없어 `'Calendar'` 버튼을 찾지 못해 실패했다(구현 후 통과로 전환).

그 다음 최소 구현 → 전부 GREEN(아래 검증 참고), 이어서 접근성 라벨/포커스
로직을 다듬는 리팩터를 거치며 테스트를 계속 통과 상태로 유지했다.

## 검증 — 4종 전부

```
cd snp-analyzer/frontend
npx tsc --noEmit   # 0 errors
npm run lint        # 0 errors, 0 warnings
npm run test        # 135 files / 1000 tests passed (기준선 132/977 + 신규 3파일/23테스트)
npm run build        # tsc -b (테스트 파일 포함) + vite build, 성공
```

신규/변경 테스트: `session-calendar.test.ts`(12) + `SessionCalendar.test.tsx`
(8) + `BatchTab.calendar.test.tsx`(3) = 23개. 기존 977개는 전부 그대로 통과 —
어떤 기존 단언도 약화·삭제하지 않았다.

## E2E

포트 8271에서 격리 실행: 이 워크트리 전용 Python venv
(`snp-analyzer/venv`, requirements.txt/-dev.txt), 프런트 빌드 산출물
(`npm run build` → `app/static-react`, uvicorn이 같은 포트에서 정적 파일과
API를 함께 서빙 — `docker compose`가 프로덕션에서 하는 것과 같은 배치)을
`DB_PATH`를 스크래치패드 안의 임시 SQLite 파일로 돌린 uvicorn이 서빙했다.
운영 DB(`/app/data/snp_analyzer.db`, 컨테이너 내부 경로)는 접근하지 않았다.

```
E2E_BASE_URL=http://localhost:8271 npx playwright test tests/
```

루트 `tests/`(140개, `frontend/e2e/`의 52개와는 별도 스위트)를 두 번 전체
실행했다: 1회차 138/140(플레이키 2건: `20-keyboard.spec.ts` 384웰 키보드,
`tests/24-responsive.spec.ts`의 384웰 multi-marker 케이스 — 내 변경과 무관한
기존 무거운 384웰 테스트), 2회차 139/140(플레이키 1건, 같은 두 파일 중 하나).
두 실패 지점을 분리해서 `tests/20-keyboard.spec.ts tests/24-responsive.spec.ts`
만 따로 돌리면(2 workers) 25/25 전부 통과 — 전체 스위트를 순차로 오래 돌릴
때만 간헐적으로 타임아웃 나는, 이 두 개의 무거운 384웰 스펙 특유의 기존
플레이키니스임을 확인했다(둘 다 프로젝트/세션/달력 코드를 전혀 건드리지
않는다). `tests/24-responsive.spec.ts`는 격리 실행에서 뷰포트 390/768/1024/
1280/1440 × ko/en × 라이트/다크 조합과 "384-well internal scrolling and
short-height project dialog stay within the viewport" 테스트 전부 통과했다 —
이번에 "세션" 패널 헤더에 추가한 `표/달력` 토글이 그 스펙의 뷰포트 예산에
영향을 주지 않았다는 실측 근거다(해당 스펙의 단언은 수정하지 않았다).

## 시각 확인

목업 데이터(신고에 적힌 실제 분포를 반영: 2026-09-14 2건, -09-11 3건,
-09-08/-09-04 각 1건, -09-01 2건, -08-31 9건, -08-25 1건 — 총 19건, "대부분의
날은 비어 있음"을 재현)를 `/api/sessions`에 라우트 모킹해 라이트/다크 ×
1440/768 × (달력 / 날짜 선택 / 9건 밀집일 / 빈 달 / 열기 실패) 조합을
캡처했다. 대표 스크린샷을 이 폴더에 저장:

- `P29-CALENDAR-calendar-1440-light-ko.png` / `-dark-ko.png` — 기본 달력, 주별
  세션 수 배지.
- `P29-CALENDAR-calendar-768-light-ko.png` / `-dark-ko.png` — 768px에서도
  7열 그리드가 겹치거나 잘리지 않음.
- `P29-CALENDAR-calendar-day-selected-1440-{light,dark}-ko.png` — 세션이 있는
  날짜 선택 시 그날의 세션 목록.
- `P29-CALENDAR-calendar-dense-day-1440-light-ko.png` /
  `-768-dark-ko.png` — 9건 밀집일, 목록이 패널을 밀어내지 않음.
- `P29-CALENDAR-calendar-empty-month-1440-light-ko.png` /
  `-768-light-ko.png` — 세션이 하나도 없는 달(7월)로 이동, 빈 달 안내 문구.
- `P29-CALENDAR-calendar-open-fail-1440-{light,dark}-ko.png` — 존재하지 않는
  세션을 달력에서 열었을 때(404) 표와 동일한 실패 알림이 패널 위쪽에 표시됨.

캡처 스크립트는 `docs/planning/feedback-2026-09-11/evidence/` 밖(세션 스크래치
패드)에 임시로 두고 실행 후 삭제했다 — 저장소에는 포함하지 않았다.

## 유지 확인

- 한국어/영어 로케일 15개 키 모두 추가(`src/locales/{ko,en}.ts`), 새 UI 문자열
  중 하드코딩은 없다.
- 라이트/다크 WCAG AA — 새 색을 추가하지 않고 기존 감사된 토큰만 사용(위 참고).
- 768px 이하 확인(스크린샷 + `24-responsive.spec.ts` 격리 재실행).
- 키보드 접근성 — 화살표 키 그리드 내비게이션 + 롤링 tabIndex(위 "접근성" 참고).
- 새 프레임워크나 달력 라이브러리를 추가하지 않았다(`package.json` 변경 없음).
- 기존 세션 목록(표) 기능은 그대로 남아 있고 기본값이다(`BatchTab.test.tsx`,
  `BatchTab.recovery.test.tsx` 등 기존 테스트 전부 무수정으로 통과).

## 커밋 전 정리

E2E용 임시 백엔드(uvicorn, PID로 직접 종료)와 격리 SQLite DB(`-shm`/`-wal`
포함) 모두 세션 스크래치패드에서 제거했다. 운영 DB는 애초에 건드리지 않았다.
