# P2-S0-V — 프로토콜·Raw data 콘텐츠 게이트

- Contract: `qprism-feedback-20260911-v1`
- 담당: orchestrator
- 브랜치: `feedback/p2-rawdata` @ `d1626ae`
- 기준선: main `b89fd68` (P1 통합 후)
- 판정: **PASS**

## 1. 태스크 커밋

| 태스크 | 커밋 | 내용 |
| --- | --- | --- |
| P2-R1-T1 | `841c8fe` | `ProtocolStep`에 `plate_read`/`temp_increment`/`read_channels` 추가, 파서 전달, 프로토콜 응답에 런 채널 메타데이터 |
| (게이트 정밀화) | `1b8abb3` | BE-LINT 포맷 규칙 정밀화 + P0-T0.2 토큰 경로 브라우저 검증 |
| P2-R1-T2 | `e5edefc` | all-amplification 응답에 `normalization_applied` / `background_mode` 에코 |
| P2-S1-T1 | `cfea914` | 열순환 프로파일 SVG 다이어그램 + 판독 채널 카드 |
| P2-S2-T1 | `c4430fe` | 오버레이 id 스코프화, Raw data 마운트, 색 기준 선택기, i18n |
| P2-S2-T1 후속 | `d1626ae` | 에코 부재 시 요청값 단언 제거 (3상태) |

## 2. 게이트 결과

| 검증 | 기준선 | 현재 | 판정 |
| --- | --- | --- | --- |
| BE-ALL | 798 passed + 2 subtests | **810 passed + 2 subtests, 0 failed** | PASS (+12) |
| BE `ruff check` (변경 .py 전부) | — | **All checks passed** | PASS |
| BE `ruff format --check` (신규 .py만) | — | **2 files already formatted** | PASS |
| FE `npx tsc --noEmit` | 0 | 0 | PASS |
| FE `npm run lint` | 0 | 0 | PASS |
| FE `npm run test` | 102 files / 687 tests | **104 files / 705 tests / 0 failed** | PASS (+18) |
| FE `npm run build` | 성공 | 성공 | PASS |

## 3. 오케스트레이터 사전 분석 오류 — 동시 마운트

작업 위임 시 "두 오버레이 마운트 지점은 `AnalysisWorkspace.tsx`의 삼항 분기로 배타적"이라고 전달했다.
**그 문장 자체는 맞지만, 세 번째 마운트를 추가하는 맥락에서는 잘못된 안심이었다.**

`App.tsx:187`:

```tsx
<div id="main-panel-analysis" role="tabpanel" aria-labelledby="tab-analysis"
     className={activeTab === "analysis" ? "" : "hidden"}>
  <AnalysisWorkspace />
```

분석 패널은 **언마운트되지 않고 CSS로만 숨는다.** 따라서 사용자가 Raw data 탭에 있어도 분석 쪽 오버레이가
DOM에 남아 있고, 프로토콜 화면에 오버레이를 추가하면 **실제로 동시 마운트된다.**
구현 담당이 이를 발견해 `idPrefix` prop 기반 스코프화로 해결했다.
(`useId()` 대신 prop을 택한 이유: 기존 `e2e/p4-s2-analysis-tab.spec.ts`의 `#toggle-overlay-btn` 로케이터 보존.)

기획서 `FB-06-rawdata-tab.md` §2에 재정정 블록을 추가했다.

부수 발견: 오버레이 토글 버튼에 `type="button"`이 없어 프로토콜 `<form>` 안에 들어가면
**프로토콜 저장을 제출**하는 문제가 있었다. 담당이 `type="button"`을 추가하고(근본 수정) 폼 밖에 배치했다(이중 방어).

## 4. "에코를 쓰라"는 요구의 회피 경로 차단

`c4430fe` 시점 구현:

```tsx
normalizationApplied={response.normalization_applied ?? useRox}
```

`types/api.ts:641`에서 `normalization_applied?: boolean`이 옵셔널이므로 이 폴백 경로는 실재하며,
**에코가 없을 때 요청값으로 "적용됨"을 단언**한다 — 이 태스크가 없애려던 바로 그 동작이다.
에코가 없는 상황은 곧 "서버가 실제 적용 여부를 알려주지 않는 상황"이고, 그때 아는 것은 요청값뿐이지 결과가 아니다.

후속 `d1626ae`에서 `boolean | undefined`를 그대로 전달하고 **3상태**(적용됨 / 적용 안 됨 / 서버 미보고)로 렌더하도록 바꿨다.
`data-applied="unreported"` 상태와, 에코를 생략한 응답에서 요청값이 `true`여도 "적용됨"으로 표시하지 않는 테스트가 추가됐다.

## 5. 수용 기준 검증

| AC | 결과 |
| --- | --- |
| `.pcrd` 판독 단계의 `plate_read === true` | PASS (파서 테스트) |
| **라벨을 바꿔도 판독 마커 유지** (휴리스틱 제거 증명) | PASS — `isReadingStep(label)` 제거, `step.plate_read` 기준 |
| 터치다운 `temp_increment` 부호 포함 | PASS |
| 채널 정보 없는 포맷에서 `read_channels == []` (추측 없음) | PASS — 파서가 의도적으로 채우지 않음 |
| 구 프로토콜 JSON 역직렬화 | PASS — 오케스트레이터가 `ProtocolStep(**old)` 직접 실행 확인 |
| mutable default 인스턴스 격리 | PASS — `Field(default_factory=list)`, 직접 확인 |
| ASG payload 직렬화 (`asg_result.py:91`) | PASS — `model_dump()` + `json.dumps` 직접 확인 |
| 채널 카드가 **응답 계약**에서 읽음 | PASS — `useProtocolEditor`의 `getProtocol` 응답, data-store 아님 |
| 다이어그램이 Plotly 미사용 인라인 SVG | PASS |
| 두 오버레이 동시 마운트 시 각각 정상 | PASS — `idPrefix` 스코프화 |
| 처리 상태가 응답 에코 기준 | PASS (후속 `d1626ae`) |
| `단색`을 raw로 표기하지 않음 | PASS — Y값은 모든 모드에서 `norm_*` 유지, 문구가 raw를 주장하지 않음 |
| Hide/Show가 ko에서 한국어 | PASS |
| 마커별 오버레이(`ploidyOverride`) 회귀 없음 | PASS |
| 프로토콜 표 편집·저장·취소 유지 | PASS (`ProtocolTab.test.tsx` 14 tests) |

## 6. 요청 중복 실측

담당이 추정이 아니라 측정으로 보고: 마운트만으로는 **0회**, 인스턴스를 펼칠 때마다 **1회**,
둘 다 펼쳤을 때만 **2회**. fetch/render 효과를 분리해 `colorBy`/`channel` 변경은 **재요청 없이** 캐시된 곡선을 다시 그린다.
엔드포인트는 인메모리 세션 조회라 DB를 치지 않는다. 새 캐시 레이어를 만들지 않았다.

## 7. 범위 밖으로 남긴 것

- **Q-1 미해결**: "웰마다 형광값"이 RFU 표인지, 곡선 강조인지, 웰 클릭 상세인지 불명확.
  사용자 확인 없이 추측 구현하지 않았다. 피드백 f127b261 요구 (c)는 **부분 충족**이다
  (Plotly 호버로 웰·사이클·RFU는 보이나 열람 가능한 표는 없음).
- **진짜 raw 보기**: FB-06 §3-3 (3). Y값을 미처리 RFU로 바꾸려면 별도 요청 경로나 백엔드 변경이 필요하며
  별도 승인 대상이다. 탭 이름이 `Raw data`가 되는 P3 시점에 이름과 내용의 일치 문제가 다시 제기된다.
- 탭 개명 자체는 P3(FB-07) 담당.

## 8. D-9 (미해결, 부분)

`ProtocolStep`에 추가한 필드가 `app/asg_result.py:91`의 `model_dump()`를 통해 **외부 ASG 저장 payload**에 실린다.
직렬화는 정상 동작하나, **ASG 수신측이 엄격한 스키마 검증을 하는지 확인하지 못했다.**
대부분의 JSON 소비자는 추가 키를 무시하므로 위험은 낮다고 판단해 차단하지 않았다.
이 계약에서 리포지토리 밖 시스템에 닿는 유일한 변경이다.

## 9. 알려진 간헐적 실패

`CompareTab.test.tsx > handles real stats wire shape with nullable Pearson…` — 이번 Phase의 전체 실행에서 재현되지 않았다.
P0-S0-V의 기록(5회 중 1회, CPU 경합 시)을 유지한다.
