# 다중 웰 증폭곡선 보기 — 기획 (2026-10-04, rev 2)

상태: 기획 rev 3 — 사용자 승인(2026-10-04): Q1 둘 다, Q2 **채널 색 기본**, Q3 로그 스케일 v1 포함. 구현 진행.
리뷰 기록: `REVIEW.md` (같은 폴더).

## 1. 요청

> "여러 웰을 선택했을 때, 한 번에 여러 웰의 증폭곡선이 보이는 기능도 추가합시다."

## 2. 현황 조사 (리뷰에서 코드 대조 완료)

| 항목 | 현재 동작 | 근거 |
|---|---|---|
| 결과 화면 "증폭곡선" 보기 | **웰 1개만** 표시(FAM/Allele2 2개 선). 2개 이상 선택하면 "웰을 클릭하세요" 안내만 나옴 | `AmplificationCurvePanel.tsx:84,133,235-239` |
| 곡선 요청 effect | 의존성에 `currentCycle` 포함 → **사이클을 움직이거나 재생할 때마다 재요청·재그리기** (기존 결함) | `AmplificationCurvePanel.tsx:216` |
| 선택 상태 | `selectedWells`(배열), `selectedWell`(1개일 때만 값) | `selection-store.ts:38-66` |
| 웰 상세 패널 | 1개 웰 기준, 같은 안내문 키 `clickWellToSee` 공유 | `WellDetailPanel.tsx:40,81,104-112` |
| 전체 웰 오버레이 | 전문가 모드·플레이트 전체·선택 무관 | `AmplificationOverlay.tsx`, `FluorescenceDataCard.tsx` |
| 백엔드 | `GET /amplification?wells=…` 다중 웰 지원. 단, 웰마다 전체 포인트를 선형 탐색(O(웰×포인트)), `normalized`/`effective_type` 미포함 | `app/routers/data.py:214-251` |
| 콜 규칙 | `displayedCall()` + `showManualTypes`/`showAutoCluster` 설정 게이트. 데이터는 `useDataStore.plateWells`/`scatterPoints` | `chart-semantics.ts:126`, `PlateView.tsx:157-172`, `data-store.ts:132-145` |
| 마커 화면 콜 | `selectedRegion.assignments`(마커 웰만), 웰별 allele 이름 `wellAlleleLabels` | `MultiMarkerAnalysisPanel.tsx:236,252-257,268` |

## 3. 사용 시나리오

1. 산포도에서 한 클러스터를 박스 선택 → 곡선 보기 → 그 클러스터가 같은 모양으로 증폭했는지 확인.
2. 경계 부근 애매한 웰 몇 개를 Ctrl+클릭 → **어느 선이 어느 웰인지 구분하며** 비교 → 우클릭으로 콜 지정.
3. NTC/양성대조 웰을 골라 바닥선·늦은 증폭 확인.

## 4. 설계 (rev 2)

### D1. 위치
- 결과 화면의 기존 "증폭곡선" 보기를 확장. 단일 마커 화면·마커 화면 모두. 모든 사용자에게 노출.
- 선택 1개: 지금과 동일한 2선 표시(회귀 없음).
- 웰 목록 = `selectedWells.length ? selectedWells : selectedWell ? [selectedWell] : []` (기존 테스트 호환).

### D2. 채널·색 (사용자 결정 반영)
- **채널**: `둘 다`(기본) / FAM / Allele2. 채널은 **선 모양**으로 구분: FAM 실선, Allele2 점선.
- **색 기준** (2개 이상 선택 시):
  - `채널`: FAM 파랑/Allele2 빨강(단일 웰과 같은 색). **항상 기본값**(사용자 결정 Q2).
  - `콜`: 유전형 색(`wellInfo()`), 범례는 allele 이름. 콜 데이터가 없으면 비활성.
  - `웰`: 웰마다 다른 색(정성 팔레트). **선택 ≤ 12개일 때만 활성**, 이때 범례는 웰 ID.
- 범례 항목에 웰 수 표기: 예) `WT/WT (12)`. 범례 클릭으로 그룹 숨김.
- 콜 없는 웰(마커 밖·미지정)은 `미지정` 회색 그룹.

### D3. 렌더링 (하이브리드)
- **선택 ≤ 24개**: 웰×채널마다 trace. 호버한 웰의 두 선을 굵게, 나머지는 흐리게(웰 강조).
- **선택 > 24개**: (채널 × 색 그룹)당 trace 1개로 묶고 웰 사이를 `null`로 끊음. 웰 강조 없음.
- 두 경우 모두 `mode: 'lines+markers'` + 투명 마커로 호버 판정 범위 확보. 호버: `웰 · 콜 · 채널 · 사이클 · 값`.
- 순수 함수 `lib/amplification-traces.ts`에서 trace 생성. T1에서 SVG 묶음 vs `scattergl`(코드베이스에 이미 사용 중) 384웰 벤치마크 후 확정.
- 측정 기준: 응답 수신~`Plotly.react` 완료 ≤ 1초(384웰, 실제 파일, 개발 PC).

### D4. 데이터 요청
- 웰 목록을 정렬·중복 제거해 키로 사용: `[sessionId, wells, useRox, backgroundMode]`.
- **`currentCycle`을 fetch 의존성에서 제거**: 응답은 ref에 보관하고, 사이클 점선은 `Plotly.relayout`으로만 갱신(단일 웰에도 적용되는 기존 결함 수정).
- `AbortController`로 이전 요청 취소. 디바운스 150ms는 2개 이상 → 다른 2개 이상 변경 때만(0↔1 전환은 즉시).
- 백엔드 소폭 수정: `/amplification`에서 포인트를 웰별 dict로 한 번 묶은 뒤 조회(`/amplification/all`과 같은 방식). 응답 형식 불변.
- 응답에 없는 웰은 "N개 웰은 곡선 데이터 없음" 한 줄로 표시.

### D5. 콜 출처 (공용화)
- 공용 함수 `callForWell(well, ctx)`로 추출: 단일 마커는 `displayedCall()` + `showManualTypes`/`showAutoCluster`, 마커 화면은 `selectedRegion.assignments` + `wellAlleleLabels`. PlateView와 곡선이 같은 함수를 사용.
- `AmplificationCurvePanel` 선택 props: `callOf?`, `alleleLabelsOf?`, `ploidyOverride?`.

### D6. 상태·접근성·기타
- 새 i18n 키 `curveSelectWells` ("웰을 선택하면 증폭곡선이 표시됩니다 (여러 개 선택 가능)"). 기존 `clickWellToSee`는 WellDetailPanel용으로 유지.
- 헤더 "선택된 웰 N개". 200개 초과 시 "선이 많이 겹칩니다" 안내.
- WellDetailPanel: 2개 이상 선택 시 "웰 N개 선택됨 — 곡선 보기에서 비교" 안내(안내문만, 기능 변경 없음).
- 스크린리더용 요약(`aria-live="polite"`): "웰 12개, 곡선 없음 2개, 콜별 개수".
- 색맹 대응: 채널을 선 모양으로도 구분, `wellInfo()` 팔레트의 제2색각 구분 점검(문제 시 보고만, 팔레트 변경은 별건).
- 엔드포인트 전용 런: 기존 안내문·read-label 눈금 공유. 다크 모드: `plotlyColors()`.
- **Y축 스케일 토글 `선형`(기본) / `로그`** (단일·다중 모두): `yaxis.type='log'`, 0 이하 값은 로그 모드에서 `null` 처리하고 "0 이하 값 N개 숨김" 표시. 사이클 점선 유지.
- 처리 상태 표시(`normalized`)는 단일 웰과 동일하게 기존 `referenceBasisUnknown` 문구 유지(범위 밖).

## 5. 범위 밖 (v2 후보, 우선순위 순)
1. 곡선 ↔ 플레이트/산포도 교차 하이라이트
2. 곡선 클릭으로 웰 선택, 그룹 중앙값±범위 표시
3. 곡선 데이터 표/CSV(키보드 대체 수단), PNG 내보내기, Ct 임계선

## 6. 수용 기준
1. 웰 1개 선택: 기존 2선 곡선 그대로(기존 테스트 통과, 안내문 키 변경분만 수정).
2. 웰 3개 선택 → 곡선 보기: 기본 `채널` 색, FAM 실선/Allele2 점선, 헤더 "선택된 웰 3개", 호버 시 해당 웰 강조.
3. `웰` 색 기준: ≤12개에서 웰별 색·웰 ID 범례, 13개 이상에서 비활성.
4. 채널 FAM만 선택 시 FAM 선만.
5. 사이클 슬라이더·재생 시 **곡선 재요청 없음**(네트워크 호출 수로 검증), 점선만 이동.
6. 선택·ROX·배경 설정 변경 중 이전 결과가 새 조건의 것처럼 보이지 않음.
7. 384웰 전체 선택: 렌더 ≤ 1초, 브라우저 멈춤 없음.
8. 마커 화면: 마커 밖 웰은 `미지정` 그룹, 범례는 마커 allele 이름.
9. 라이트/다크 모드, 다중 사이클 없는 런 안내문.
10. 로그 스케일: 단일·다중 모두 전환 가능, 0 이하 값 숨김 개수 표시, 설정은 세션 중 유지.

## 7. 작업 분해
| ID | 내용 | 산출물 |
|---|---|---|
| T0 | `callForWell` 공용 함수 추출, PlateView 적용(동작 불변) + 테스트 | `lib/well-call.ts` |
| T0b | `/amplification` 웰별 dict 그룹화 + 백엔드 테스트(응답 불변) | `app/routers/data.py` |
| T1 | `buildMultiWellTraces`(하이브리드, 색 기준 3종, 선 모양, null 구분, 호버) + 단위 테스트 + 384웰 벤치마크 | `lib/amplification-traces.ts` |
| T2 | `AmplificationCurvePanel` 다중 모드: 웰 목록 파생, fetch/사이클 분리, Abort·디바운스, 컨트롤(채널·색 기준·Y축 선형/로그), 호버 강조, 상태·aria 요약 | 컴포넌트 + 테스트 |
| T3 | 콜 props 연결(마커/단일), WellDetailPanel 안내문 | `MultiMarkerAnalysisPanel.tsx`, `ResultsPlotToggle.tsx`, `WellDetailPanel.tsx` |
| T4 | i18n ko/en | `locales/*.ts` |
| T5 | E2E: 3웰 선택→곡선/호버/색 기준, 사이클 이동 시 재요청 없음, 384웰 성능 | `tests/` 스펙 |
| 게이트 | vitest 전체, lint, `npx tsc -b`, build, 백엔드 pytest, 대상 E2E, 실제 파일 브라우저 확인 | — |

추가 테스트 케이스: 응답에 없는 웰, 시리즈 중간 null, 엔드포인트 전용 런, 마운트 중 ploidy/allele 이름 변경, 요청 중 설정 변경.

## 8. 위험
- 하이브리드 경계(24개)에서 표시 방식이 바뀌는 어색함 → 헤더에 "웰 강조는 24개 이하에서" 툴팁.
- `scattergl` 채택 시 내보내기/다크 모드 일관성 → T1 벤치마크에서 SVG로 충분하면 SVG 유지.
- 긴 GET 쿼리(1536웰 대응 시) → 현재 최대 384웰이라 문제없음, POST 대안은 기록만.

## 9. 사용자 결정 (확정 2026-10-04)
- Q1. 기본 채널: `둘 다`.
- Q2. 기본 색 기준: `채널` (리뷰 권고 `콜`과 다름 — 사용자 결정 우선, `콜`·`웰`은 선택지로 제공).
- Q3. Y축 로그 스케일: v1 포함.
