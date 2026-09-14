# P27 — 산점도 축 잠금(`lockAspect`) 기본값을 끔

Contract: qprism-ux-followup-20260907-v1 계열, feedback 2026-09-11. 브랜치
`fix/scatter-lock-default` (main `e6a2c90` = v1.1.1에서 분기), 워크트리
`worktree/fix-lock`.

## 신고

사용자 피드백 `4a83029e`. 결과 화면, 세션 `f9509d7ac5eb`, CFX Opus **(raw)**,
94웰·17사이클, 사이클 10, 뷰포트 1920×911, 한국어.

> NTC 기준으로 플롯을 만들면 이렇게 그려집니다. 축 높이가 너무 낮아요.
> 2800-6000정도의 Y축 같은데 여백이 너무 많습니다. 세로로 길어야하는데도요.

해당 세션 실측(사이클 10): X(FAM) 6,180~17,365 (폭 11,185), Y(allele2)
2,718~5,466 (폭 2,748), ROX는 `NULL`(참조 채널 없음, 원시 척도). X가 Y보다
약 4배 넓다.

## 원인

`snp-analyzer/frontend/src/stores/settings-store.ts`의 `lockAspect: true`가
기본값이었다. `snp-analyzer/frontend/src/lib/scatter-axes.ts:107`
(`axisRangeLayout`)는 그게 켜지면 y축에
`{ scaleanchor: 'x', scaleratio: 1, constrain: 'domain' }`를 건다. X가 Y보다
몇 배 넓은 원시 RFU 플레이트에서는, 같은 배율로 y를 x에 고정하면 y가
캔버스 높이의 일부만 차지하고 나머지는 빈 여백이 된다 — 신고 스크린샷에서
점들이 아래쪽 1/3에 몰려 있던 것과 일치.

`lockAspect`가 켜져 있던 이유(`settings-store.ts`의 필드 주석)는 방사형
경계선(genotype boundary ray)이 비율(각도)로 정의되어, 배율이 같아야 각도가
정직하게 보이기 때문이다. 그러나 그 선은
`linesActive = showManualTypes && showBoundaryLines`일 때만 그려지고,
신고된 화면에서는 꺼져 있었다. 즉 대부분의 화면에서는 이득 없이
손해만 보는 기본값이었다.

## 제품 소유자 결정

`lockAspect` 기본값을 `false`로 바꾼다. 산점도 툴바의 자물쇠 버튼
(`data-testid="axis-lock-aspect"`)은 그대로 남겨, 방사형 경계선의 정직한
각도가 필요한 사람은 직접 켤 수 있다.

## 기존 저장값 문제와 처리 방법

`settings-store.ts`는 `persist` 미들웨어로 브라우저 `localStorage`
(`name: 'snp-analyzer-settings'`)에 저장된다. 기본값만 바꾸면 이미 그
설정을 저장한 사용자(신고자 포함)는 저장된 `lockAspect: true`가 zustand의
`merge`(기본은 `{ ...currentState, ...persistedState }`)로 새 기본값 위에
덮어써져, 여전히 납작하게 보인다.

### 선택한 방법 — `version` + `migrate` + 누락-버전 보정

`persist` 옵션에 `version: SETTINGS_STORE_VERSION`(현재 `1`)과 `migrate`를
추가했다:

```ts
migrate: (persistedState, version) => {
  const state = { ...(persistedState as Partial<SettingsState>) };
  if (version < 1) {
    // v0 -> v1: see SETTINGS_STORE_VERSION above.
    state.lockAspect = false;
  }
  return state as SettingsState;
},
```

주의할 점 하나: zustand의 persist는 저장된 페이로드에 `version` 키가
**아예 없으면** (`typeof deserializedStorageValue.version === "number"`
검사가 실패해) migrate를 호출하지 않고 그냥 병합해버린다. 이 저장소가
버저닝을 도입한 적이 없으므로, 신고자를 포함한 기존 사용자의 실제
페이로드는 `version` 키가 아예 없는 경우다. 이를 위해 `storage`를
`coerceMissingVersion()`로 감싸, `version`이 숫자가 아닌 페이로드를 읽을
때 `version: 0`을 채워 넣은 뒤 zustand에 넘기도록 했다 — 그래야 진짜
레거시 페이로드가 `migrate`의 `version < 1` 분기를 탄다.

### 버전 번호 체계

`SETTINGS_STORE_VERSION`의 주석에 명시: **기본값의 의미가 바뀌어 이미
저장된 값이 사용자 의도를 잘못 대표하게 될 때만** 올린다. 새 필드
추가는 해당 없음(레거시 페이로드는 `merge`가 새 필드의 기본값을 그대로
채운다 — `settings-store.test.ts`의 "legacy payload" 테스트가 이를 검증).
이 저장소의 다른 "리팩토링이 아니라 동작 변경에서만 올린다" 버전
카운터인 `CLUSTERING_ALGORITHM_VERSION`(`app/processing/clustering.py`,
현재 `"c5"`)과 같은 규칙을 따른다고 주석에 명시했다.

### "사용자가 직접 켠 값은 유지된다" 보장

`migrate`는 **저장된 페이로드의 버전이 현재 버전보다 낮을 때만** 개입한다.
사용자가 자물쇠 버튼을 눌러 `lockAspect: true`로 설정하면, 그 즉시
`setItem`이 **현재 버전 번호(`1`)**로 다시 저장한다. 다음 로드에서
저장된 버전(`1`)과 현재 버전(`1`)이 같으므로 `migrate`가 아예 호출되지
않고 `true`가 그대로 유지된다. 아래 GREEN 테스트
`does not re-force lockAspect false for a payload already at the current version`가
이를 검증한다.

### 다른 저장 설정은 손대지 않음

`migrate`는 `{ ...(persistedState as Partial<SettingsState>) }`로 시작해
`lockAspect` 한 필드만 덮어쓴다. 축 범위(`xMin`/`xMax`/...), 종횡비
(`scatterAspect`), 색 기준(`ntcThreshold` 등) 등 다른 저장값은 그대로
통과한다 — `migration leaves unrelated persisted settings untouched`
테스트가 검증.

## TDD

### RED (구현 전)

```
FAIL  src/stores/settings-store.test.ts > defaults lockAspect to false for a brand-new user
  AssertionError: expected true to be false
FAIL  src/stores/settings-store.test.ts > migrates a pre-fix stored payload (lockAspect: true, no version) to lockAspect: false
  AssertionError: expected true to be false

 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
```

### GREEN (구현 후) — 새로 추가한 4개 테스트

- `defaults lockAspect to false for a brand-new user`
- `migrates a pre-fix stored payload (lockAspect: true, no version) to lockAspect: false`
- `migration leaves unrelated persisted settings untouched`
- `does not re-force lockAspect false for a payload already at the current version`

```
 Test Files  2 passed (2)
      Tests  24 passed (24)   # settings-store.test.ts + scatter-axes.test.ts
```

`scatter-axes.test.ts`의 기존 테스트(`lockAspect: false`일 때
`scaleanchor`를 걸지 않음, `lockAspect: true`일 때 건다)는 수정 없이
그대로 통과 — `axisRangeLayout` 자체 로직은 건드리지 않았다.

## 변경 파일

- `snp-analyzer/frontend/src/stores/settings-store.ts` — 기본값, 버전
  상수, `migrate`, `coerceMissingVersion` 스토리지 래퍼, 필드 주석.
- `snp-analyzer/frontend/src/stores/settings-store.test.ts` — 4개 신규
  테스트.

`snp-analyzer/frontend/src/lib/scatter-axes.ts`는 수정하지 않았다 —
`lockAspect`를 boolean으로 받아 그대로 반영하는 로직은 이미 올바르게
동작했다; 문제는 그 값의 **기본값과 영속성**이었다.

## 검증 4종

```
cd worktree/fix-lock/snp-analyzer/frontend
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

- `npx tsc --noEmit`: 0 (주: 이 저장소의 루트 `tsconfig.json`은
  `files: []`인 솔루션 구성이라 이 명령 단독으로는 아무 파일도 검사하지
  않는다. 실질적 타입 검사는 `npm run build`가 실행하는 `tsc -b`가
  `tsconfig.app.json`(`include: ["src"]`, 테스트 파일 포함)을 통해
  수행한다.)
- `npm run lint`: 0 errors, 0 warnings
- `npm run test`: **132 files / 977 tests / 0 failed** (기준선 132/973 +
  이번에 추가한 4개)
- `npm run build`: 성공 (`tsc -b && vite build`, 기존에도 있던 청크 크기
  경고 외 신규 경고 없음)

## 시각 확인 — 원시 RFU(X가 Y보다 넓은 데이터)

정규화된 예제 데이터(값이 0~1.5)로는 이 문제가 드러나지 않아 — 실제
CFX Opus raw 업로드(`03-upload-cfx.spec.ts`가 쓰는 것과 같은 파일,
`.../CFX-opus/... Quantification Amplification Results.xlsx`, X(FAM)
~4,000-6,000 vs Y(HEX raw RFU) ~2,400-3,100, "기준 채널로 나누기"
체크박스를 꺼서 raw 척도로 봄)로 재현했다.

| 스크린샷 | 조건 |
|---|---|
| `P27-LOCK-DEFAULT-after-unlocked-1440x1000-light.png` | 새 기본값(`lockAspect: false`), 1440×1000, 라이트 |
| `P27-LOCK-DEFAULT-after-unlocked-1440x1000-dark.png` | 새 기본값, 1440×1000, 다크 |
| `P27-LOCK-DEFAULT-after-unlocked-1920x911-light.png` | 새 기본값, 신고와 동일한 1920×911 |
| `P27-LOCK-DEFAULT-before-locked-1440x1000-light.png` | 자물쇠 버튼을 **수동으로 켠** 상태 — 이전 기본값과 동일한 코드 경로(`scaleanchor`)를 타므로, 예전 기본값이 만들던 "아래쪽에 몰리고 위/여백이 남는" 모양을 그대로 재현. 자물쇠 기능 자체는 제거되지 않았음을 함께 보여준다. |

수정 전(잠금)/후(기본 해제) 비교: 잠금 스크린샷은 y축 눈금(2400~3100)이
캔버스 상단 절반 정도에만 그려지고 x축 라벨이 아래로 밀려나며, 기본
해제 스크린샷은 같은 y축 눈금이 캔버스 세로 전체를 채운다 — 신고
내용과 일치하는 재현.

세션 하나를 두 상태로만 비교하기 위해, "이전 기본값"은 실제 v0
페이로드를 재생하는 대신 자물쇠 버튼을 수동으로 눌러 만들었다 — 이유:
이 앱은 로드 시 `migrate`가 즉시 실행되므로, `lockAspect: true`를 저장한
브라우저 상태로 새로고침해도 화면에 그리기 전에 이미 `false`로
내려간다(정상 동작, 아래 마이그레이션 검증 참고). 버튼으로 켠
`lockAspect: true`는 코드 경로가 완전히 동일(`axisRangeLayout`의
`scaleanchor` 분기)하므로 시각적으로는 "예전 기본값이 보이던 모습"과
동일하다.

### 마이그레이션 종단 확인 (실제 브라우저, 실제 localStorage)

`localStorage.setItem('snp-analyzer-settings', JSON.stringify({ state: { lockAspect: true } }))`
(버전 키 없음 — 실제 레거시 페이로드 모양)로 저장한 뒤 앱을 새로 로드:

```
최종 state.lockAspect = false
최종 state.version    = 1
```

이 저장소의 단위 테스트가 아니라 실제 Playwright 브라우저 컨텍스트에서
확인한 결과다.

## 뷰포트 예산 실측 (`tests/24-responsive.spec.ts:51`)

해당 테스트가 쓰는 것과 같은 플로우(1440×1000, `#example-select`
옵션 2, 첫 웰 선택)를 별도로 재생해 실측:

```json
"lockAspect": false,
"#scatter-plot":  { "y": 497, "height": 496.5, "bottom": 993.5 },
"#plate-grid":    { "y": 422, "height": 266,   "bottom": 688   },
".detail-panel":  { "y": 721, "height": 102,   "bottom": 823   }
```

세 영역 모두 `y + height ≤ 1000`을 만족 — 단언 문구는 수정하지 않았다.
아울러 이 단언을 포함한 전체 스위트 항목
(`24-responsive.spec.ts:51 result-first 96-well desktop ...`)도 아래
E2E 전체 실행에서 통과.

## E2E — 포트 8260, `E2E_BASE_URL`

루트 `tests/`(140개, `frontend/e2e/`의 52개와는 별개 스위트)를
`worktree/fix-lock/snp-analyzer`에서 새로 만든 격리 venv
(`requirements.txt`가 요구하는 `bcrypt==4.0.1`; 호스트에 전역 설치된
`bcrypt==5.0.0`은 `passlib==1.7.4`의 백엔드 자체 점검에서 즉시 깨짐 —
`requirements-dev.txt`의 기존 주석과 일치)로 기동해 실행했다.

- `DB_PATH` 미지정 → 기본값이 `app/data/snp_analyzer.db`(코드 기준
  이 워크트리 상대 경로)라, 운영 절대경로 `/app/data/snp_analyzer.db`와
  물리적으로 다른 파일 — 운영 DB 미접근.
- `--workers=1`로 실행 — 기본 worker 수(다수)로 실행하면 여러 워커가
  동시에 로그인해 백엔드 로그인 레이트리미터에 걸려(`429 Too Many
  Requests`) 135/140이 무관하게 실패하는 것을 확인(우리 변경과 무관한
  환경 변수). 순차 실행(1 worker)에서는 재현되지 않음.

```
Running 140 tests using 1 worker
...
140 passed (7.6m)
```

**E2E 기준선 140/140 충족.**

## 금지 사항 준수

- main 병합·원격 push·브랜치 변경 없음.
- 자물쇠 버튼(`axis-lock-aspect`) 제거하지 않음 — 토글 테스트(#04)로
  여전히 동작함을 확인.
- `lockAspect` 외 저장 설정을 초기화하지 않음 — 전용 테스트로 확인.
- 운영 DB 미접근 (위 설명).
- `tests/24-responsive.spec.ts:51` 단언 미수정 — 실측으로 여전히 만족함만
  확인.
- 단언 약화·삭제·skip 없음.
- `git add -A` / `git add .` 미사용 — 변경 파일을 이름으로 지정해 커밋.
