# P33 — 산점도 선택 시의 반투명(Plotly `DESELECTDIM`) 제거

Contract: feedback 2026-09-11 계열. 워크트리 `worktree/ux-followup-integration`
(main `27098ec` = v1.3.0에서 작업). 브랜치 `fix/scatter-selection-fade`.

## 신고

사용자 피드백 `2b97998036c44c16` (bug, 2026-09-15 02:05 접수). 결과 화면,
세션 `5f7a1551e6bb`, CFX Opus (raw), 94웰·17사이클, 사이클 16, 1920×911, 한국어.
첨부 스크린샷 1장(`feedback-shots/2b979980-4f5a0b.png`).

> 임계값 편집으로 스크롤을 옮겼는데. 산포도 스폿들이 전부 반투명처리됨
>
> 이렇게 반투명 처리되는게 상당히 불편합니다. 플롯 더블클릭하면 반투명처리가
> 해제되거나, 아예 반투명을 없애고 선택한걸 진하게 처리하는게 더 낫습니다.
> 반투명은 별로 안좋은 선택같아요.

## 원인

우리 코드는 `unselected.marker.opacity`를 한 번도 설정하지 않았고, 그래서
Plotly의 기본값이 그대로 적용됐다 — `plotly.js-dist-min@3.3.1` 번들 안의
`DESELECTDIM: .2`. 박스 선택이 한 번 일어나면 Plotly는 **모든 트레이스**에
`selectedpoints`를 붙이고(그 박스 안에 점이 하나도 없는 트레이스는 빈 배열),
선택되지 않은 점을 전부 20% 불투명도로 그린다. 신고 스크린샷에서 NTC(E12)만
진하고 나머지 세 유전형 클러스터가 통째로 흐렸던 것이 이 "빈 배열" 경우다.

빠져나올 방법이 없던 이유가 임계값 편집과 맞물린 부분이다.

- `ScatterPlot.tsx` — `dragmode: editing ? "zoom" : "select"`. 임계값 편집 중에는
  dragmode가 `zoom`이라 Plotly의 더블클릭이 **축만 초기화**하고 선택을 지우지
  않는다. `plotly_deselect`도 발생하지 않는다.
- `layout.uirevision`은 축 모드·정규화·오프셋으로만 구성되므로, NTC 코너를 끌어
  재분석해도 값이 그대로여서 Plotly가 선택 상태를 계속 보존한다.

선택 표시는 원래부터 투명도에 의존하지 않았다: 선택된 웰은 마커 크기
`MARKER_SIZE_SELECTED`(12 vs 8)와 테두리 3px(기본 1.5px), 그리고 8개 이하일 때
웰 번호 라벨로 구분된다. 즉 흐림은 정보를 더하지 않고 플레이트만 가렸다.

## 구현

사용자가 제시한 두 안(① 더블클릭으로 해제 ② 흐림을 없애고 선택을 진하게) 중
**②를 기본으로 채택하고 ①도 함께** 넣었다. 흐림 자체가 사라지므로 ①은 더 이상
복구 수단이 아니지만, "선택을 비운다"는 제스처가 select 모드에만 있던 것은 그
자체로 결함이다.

1. **모든 트레이스에 `selected`/`unselected` 마커 불투명도 1** — `ScatterPlot.tsx`는
   `OPAQUE_IN_BOTH_SELECTION_STATES` 상수를 유전형 트레이스와 NTC 임계값 핸들
   트레이스에 스프레드하고, `MarkerScatterPlot.tsx`도 같은 값을 넣는다.
2. **`dropSelectionOutline()`** — Plotly가 들고 있는 선택 흔적을 지운다:
   트레이스별 `selectedpoints`(실제로 흐림을 만드는 쪽)는
   `Plotly.restyle(gd, { selectedpoints: null })`로, 영속 선택 사각형이 있는
   빌드/설정에서는 `layout.selections`를 `Plotly.relayout(gd, { selections: [] })`로.
   **지울 것이 있을 때만** 호출한다. 스토어의 선택 웰은 건드리지 않는다.
3. **도구 전환 시 호출** — 이전 도구가 남긴 선택 흔적이 다음 도구로 따라오지 않는다.
4. **`plotly_doubleclick` 처리** — 더블클릭이 선택을 비운다(스토어 + Plotly).
   단 `linesActive && editing`(경계선 레이가 무장된 상태)에서는 **건너뛴다** —
   그 화면에서 더블클릭은 이미 "레이 삭제/추가"라는 다른 편집 제스처이고
   (`ScatterPlot.tsx`의 경계선 effect), 경계선을 고치다가 웰 선택이 함께
   날아가는 것은 요청되지 않은 부작용이다. `MarkerScatterPlot`에는 그 제스처가
   없어 조건 없이 적용된다.

### 타입 관련 주의 (재발 방지 메모)

`@types/plotly.js@3.0.10`에는 `selected`/`unselected` 속성 선언이 **아예 없다**
(Plotly 본체는 문서화된 정식 속성). 그래서 타입이 붙은 `Data` 리터럴에 직접
쓰면 `TS2353`이 난다. 상수를 만들어 스프레드하는 방식으로 우회했고, 그 이유를
코드 주석에 남겼다.

이 오류는 `npx tsc --noEmit`에서는 **잡히지 않았다** — P27 evidence에 이미 적혀
있는 대로 루트 `tsconfig.json`이 `files: []` 솔루션 구성이라 이 명령은 아무
파일도 검사하지 않는다. 실제 타입 검사는 `npm run build`(`tsc -b`)가 한다.
이번에도 도커 빌드 단계에서 처음 드러났다.

## 변경 파일

- `snp-analyzer/frontend/src/components/analysis/ScatterPlot.tsx`
- `snp-analyzer/frontend/src/components/analysis/MarkerScatterPlot.tsx`
- `snp-analyzer/frontend/src/components/analysis/ScatterPlot.selection-fade.test.tsx` (신규)
- `snp-analyzer/frontend/src/components/analysis/MarkerScatterPlot.selection-fade.test.tsx` (신규)

## TDD

### RED — 구현 전 (두 컴포넌트를 HEAD 상태로 되돌리고 실행)

```
 × keeps every trace opaque in both selection states, so a box selection never fades the plate
 × clears the selection on double-click in threshold-edit mode, where Plotly fires no deselect
 × leaves the double-click to the boundary rays while those are armed
 × drops Plotly's leftover selection when the tool changes, keeping the wells selected
 × leaves Plotly alone when there is no selection to drop

 Tests  5 failed (5)
```

### GREEN — 신규 9개 (ScatterPlot 5 + MarkerScatterPlot 4)

```
 Test Files  2 passed (2)
      Tests  9 passed (9)
```

## 검증

```
cd worktree/ux-followup-integration/snp-analyzer/frontend
npm run lint && npx vitest run && npm run build
```

- `npm run lint`: 0 errors / 0 warnings
- `npx vitest run`: **139 files / 1016 tests / 0 failed** (기준선 137/1007 + 신규 9)
- `npm run build`: 성공 (`tsc -b && vite build`, 기존 청크 크기 경고 외 신규 경고 없음)

## 브라우저 실측 (Playwright, 1920×911, 실제 CFX Opus 업로드)

검증 인스턴스: 이 워크트리 소스로 빌드한 격리 컨테이너(포트 8002, 자체 볼륨
`snp-p33-data`). **운영 DB·운영 컨테이너 미접근.** 업로드 파일은 `03-upload-cfx.spec.ts`가
쓰는 것과 같은
`admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results.xlsx`.

절차: 결과 탭 → `웰 선택` 도구로 **작은 박스** 드래그(Plotly의 data→pixel 매핑으로
실제 점 8개 위에 얹음. 큰 박스는 대부분이 선택돼 흐림이 드러나지 않는다) →
`임계값 편집` 전환 → 플롯 더블클릭. 각 단계에서 `gd._fullData`의
`unselected.marker.opacity`와 `selectedpoints`를 읽었다.

**수정 전**

```
박스 선택 직후 : traces unselected=0.2 / selectedpoints = [63점], [빈 배열], (없음)
임계값 편집    : traces unselected=0.2 / 빈 배열이 그대로 남음  ← 화면 전체가 흐린 상태
더블클릭 후    : traces unselected=0.2 / 빈 배열이 그대로 남음  ← 복구 수단 없음
```

**수정 후**

```
박스 선택 직후 : traces unselected=1   / selectedpoints = [63점], [빈 배열], (없음)
임계값 편집    : traces unselected=1   / selectedpoints 전부 해제
더블클릭 후    : traces unselected=1   / selectedpoints 전부 해제
```

### 픽셀 측정

같은 데이터·같은 뷰포트·같은 선택 박스로 찍은 `-editing-` 스크린샷 두 장을
픽셀 단위로 비교(두 빌드의 차이는 이번 수정뿐):

```
차이가 20 이상인 픽셀: 473개, 최대 차이 175
그 픽셀들의 위치    : x 291-331, y 834-867  (선택에서 빠진 '미결정' 클러스터)
그 픽셀들의 평균 밝기: 수정 전 205.5 → 수정 후 69.3
```

즉 화면에서 달라진 곳은 **선택에서 빠진 점들뿐**이고, 그 점들이 옅은 회색에서
원래 색으로 돌아왔다. 선택된 점·축·범례·레이아웃은 1픽셀도 바뀌지 않았다.

### 스크린샷

| 파일 | 상태 |
|---|---|
| `P33-SELECTION-FADE-before-selected-1920x911-light.png` | 수정 전, 박스 선택 직후 |
| `P33-SELECTION-FADE-before-editing-1920x911-light.png` | 수정 전, 임계값 편집 — 선택에서 빠진 클러스터가 흐림 |
| `P33-SELECTION-FADE-before-after-doubleclick-1920x911-light.png` | 수정 전, 더블클릭해도 그대로 |
| `P33-SELECTION-FADE-after-selected-1920x911-light.png` | 수정 후, 박스 선택 직후 |
| `P33-SELECTION-FADE-after-editing-1920x911-light.png` | 수정 후, 임계값 편집 — 전부 불투명 |
| `P33-SELECTION-FADE-after-after-doubleclick-1920x911-light.png` | 수정 후, 더블클릭으로 선택 해제 |

다크 모드 스크린샷은 찍지 않았다 — 이번 변경은 불투명도 한 값이고 색·토큰·레이아웃을
건드리지 않아 테마별로 갈리는 코드 경로가 없다.

## E2E — 루트 스위트 140개

같은 검증 인스턴스(포트 8002)에 대해 루트 `tests/`를 `--workers=1`로 실행
(병렬 실행은 로그인 레이트리미터에 걸린다 — P27 evidence의 같은 메모).

```
Running 140 tests using 1 worker
...
140 passed (7.6m)
```

산점도 상호작용을 직접 건드리는 항목들(`05-interactions`, `17-manual-group-and-plate-drag`의
임계값 편집 드래그, `26-chart-semantics`, `27-scatter-aspect`)도 모두 통과 —
단언을 수정하거나 skip한 항목은 없다.

## 하지 않은 것

- 백엔드 미변경 → `pytest` 미실행(이 저장소의 게이트는 백엔드 계약 변경 시 필수).
- 원격 push 없음, 운영 재배포 없음, 피드백 상태 업데이트 없음 — 운영 이미지는
  GitHub `main`을 빌드 컨텍스트로 쓰므로(`/mnt/docker/asg-saas-v2/docker-compose.yml:210`)
  실제 반영에는 push 결정이 필요하다. 사용자 판단 대기.
- 선택 강조 방식(크기·테두리·라벨)은 그대로 뒀다 — 흐림을 없앤 뒤에도 선택이
  충분히 읽히는지는 위 스크린샷으로 확인.
