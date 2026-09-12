# P3-S0-V — 정보구조 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p3-ia` @ `3445878`
- 기준선: main `2f07669` (P2 통합 후)
- 판정: **PASS**

## 1. 태스크 커밋

| 태스크 | 커밋 | 내용 |
| --- | --- | --- |
| P3-S1-T1 | `e13c349` | 최상위 탭 재편(plate/rawdata/results), `WorkspaceTabs` 제거, `surface` 파생화 |
| P3-S2-T1 | `d582850` | 구 URL 의미 보존 매핑 + canonical rewrite, `sessionQueries` 매핑, quality-navigation 계약 |
| (정정) | `4e1ef0c` | P1-S0-V 오진 정정 문서 |
| P3-E2E | `2252b81` | 루트 E2E 7개 스펙 갱신 |
| P3-E2E-regressions | `3445878` | P3가 만든 회귀 2건 수정 |

## 2. 게이트 결과

| 검증 | 기준선 (`2f07669`) | 현재 (`3445878`) | 판정 |
| --- | --- | --- | --- |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 104 files / 705 tests | **104 files / 723 tests / 0 failed** | PASS (+18) |
| FE `npm run build` | 성공 | 성공 | PASS |
| BE-ALL | 810 passed | 백엔드 미변경 | PASS |
| **루트 E2E** | **112 passed / 24 failed** | **132 passed / 4 failed** | **PASS (+20 통과, −20 실패)** |

## 3. E2E 기준선을 이제야 제대로 측정했다 — P0의 구멍

P0-T0.1의 회귀 기준선은 단위 테스트·린트·빌드만 담았고 **E2E를 포함하지 않았다.**
이번에 main(`2f07669`)에 대해 전체 루트 E2E를 실행한 결과:

```
main 기준선:  112 passed / 24 failed  (11.2분)
P3 브랜치:    132 passed /  4 failed  ( 7.6분)
```

**main의 E2E는 24건이 깨진 상태였다.** 개발 루프에서 E2E를 돌리지 않으므로 아무도 모르고 있었다.
이 구멍이 P1에서의 오진(`evidence/P1-S0-V-correction.md`)을 낳았다.

산술적으로 정확히 맞는다: `24 − 20(낡은 24-responsive 헤더 테스트 수정) + 2(P3 신규 회귀) = 6` →
회귀 2건 수정 후 **4**. P3는 회귀를 피한 것을 넘어 **기존에 깨져 있던 20건을 함께 고쳤다.**

> **이후 Phase 지침**: E2E 기준선은 **main 112 passed / 24 failed**가 아니라,
> P3 통합 후의 **132 passed / 4 failed**다. P4 이후는 이 값과 비교한다.

## 4. 남은 4건의 실패 — P3 회귀가 아님 (측정으로 확인)

| 스펙 | 기준선 | P3 |
| --- | --- | --- |
| `06-import-mapping.spec.ts:10` | 실패 | 실패 |
| `17-manual-group-and-plate-drag.spec.ts:55` | 실패 | 실패 |
| `17-manual-group-and-plate-drag.spec.ts:135` | 실패 | 실패 |
| `test-windows.spec.ts:109` | 실패 | 실패 |

main 상태(P2 worktree, 별도 백엔드 포트 8122)에서 같은 4건을 직접 실행해 **동일하게 실패함을 확인**했다.
같은 실행에서 `22-error-recovery.spec.ts:33`은 **통과**했으므로, P3 브랜치에서의 실패는 진짜 회귀였고 `3445878`로 해소됐다.

### 부분 원인 규명

- **`06-import-mapping`**: `getByText('Import mapping')` 등 **영어 문자열을 단언**하는데
  앱 기본 언어는 한국어다(`language-store.ts:14` `language: 'ko'`). 이 스펙은 언어를 시딩하지 않는다.
  `24-responsive`가 언어를 시딩해 통과하는 것과 대조된다. → **낡은 테스트**로 판단된다.
- **`17-manual-group` ×2, `test-windows`**: `.plate-well` 셀렉터는 소스에 여전히 존재하므로(3곳)
  죽은 셀렉터 문제는 아니다. **원인을 규명하지 못했다.**

> **과대주장 금지**: 이 4건이 "문제가 아니다"라고 말하지 않는다.
> 확인한 것은 **P3의 회귀가 아니라는 것**뿐이다. 낡은 테스트인지, 환경 민감성인지, 실제 제품 결함인지는
> 별도 조사가 필요하며 이번 계약 범위 밖이다. **기존 E2E 부채로 사용자에게 보고한다.**

## 5. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| 상위 탭 순서 `플레이트 설정 → Raw data → 결과 → …` | PASS |
| 플레이트 설정이 **1회 클릭**으로 도달 | PASS — `WorkspaceTabs` 제거, 최상위 탭화 |
| en/ko 라벨 번역 + 타입 체크 | PASS |
| 키보드 내비게이션(roving `tabIndex`, `aria-selected`, `role="tablist"`) | PASS |
| `TabNavigation.keyboard.test.tsx` 리터럴 갱신 | PASS |
| 구 URL(`?tab=analysis&surface=plate`) 의미 보존 매핑 + canonical rewrite | PASS |
| `sessionQueries` 구 쿼리 매핑 | PASS |
| 미지 탭 id 폴백 회귀 없음 | PASS |
| 품질 → 웰 복귀가 새 탭 구조에서 동작 | PASS |
| 피드백 `page_key`가 새 탭 id 기록 | PASS |
| 구 셀렉터 잔존 0 | PASS — `grep`이 빈 결과 |

## 6. 탭 재편이 드러낸 잠복 버그 4건

탭 ID를 바꾸지 않았다면 계속 숨어 있었을 것들이다. 모두 `tab === 'analysis'` 정확 일치 비교에 의존하고 있었다.

| 파일 | 증상 (수정 전) |
| --- | --- |
| `lib/quality-navigation.ts` | 은퇴한 `tab: 'analysis'` 리터럴을 URL에 기록 → `parseNavigation`이 거부 → **품질 대상에서 뒤로가기가 조용히 깨짐**. 왕복 회귀 테스트 추가됨 |
| `lib/keyboard-authority.ts` | 새 탭에서 **키보드 단축키가 동작하지 않음** |
| `hooks/use-quality-focus.ts` | 새 탭에서 **자동 포커스 스크롤 안 됨** |
| `hooks/use-current-analysis-request.ts` | 새 탭에서 **분석 요청 등록 안 됨** |

기존 테스트는 전부 레거시 값만 실행해서 어느 것도 잡지 못했다. 신규 커버리지가 추가됐다.

## 7. 피드백 `page_key` 신·구 매핑 (데이터 해석 주의)

지금 처리 중인 7건의 피드백은 구 값으로 저장되어 있다. 앞으로 제출되는 피드백은 새 값을 기록한다.

| 구 `page_key` | 신 `page_key` |
| --- | --- |
| `analysis` (+ surface `plate`) | `plate` |
| `analysis` (+ surface `analysis`) | `results` |
| `protocol` | `rawdata` |

관리자 화면에서 과거 항목을 볼 때 구 값이 그대로 보인다. 상세는 `evidence/P3-S2-T1.md`.

## 8. 정리

임시 uvicorn(8120~8123), 임시 DB, 임시 probe 스펙, 임시 worktree, `test-results/`·`playwright-report/` 모두 제거.
**포트 8002(프로덕션 컨테이너)와 운영 DB는 전 과정에서 사용하지 않았다.**
