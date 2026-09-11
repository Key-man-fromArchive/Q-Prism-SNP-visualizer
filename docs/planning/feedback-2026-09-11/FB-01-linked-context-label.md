# FB-01 — 상단 `ad_hoc 1` 노출 제거

- **피드백 ID**: `35424285daff410a` · 카테고리 `bug` · 상태 `open`
- **제출**: service@invirustech.com / 2026-09-11 14:20:03 / page_key `analysis`
- **원문**: "상단에 ad_hoc1 이런게 노출됨 — 뭘까요? 필요없는거면 숨기거나 수정합시다."
- **스크린샷**: `feedback-shots/35424285-1e7ab8.png`
- **복잡도**: Simple (단일 컴포넌트, 원인 명확)

## 1. 관찰된 현상

헤더 제목 `ASG-PCR SNP 판별 분석기` 바로 오른쪽 테두리 상자 안에
`ad_hoc` `1` `Ad hoc SNP Analyze` 세 조각이 나란히 표시된다.
사용자에게는 의미 없는 문자열이며, 제품 이름 옆이라 **부제처럼 읽힌다.**

## 2. 근본 원인 (코드 근거)

`snp-analyzer/frontend/src/components/layout/Header.tsx:22-37`

```tsx
function LinkedIdentity({ context }: { context: LinkedASGContext }) {
  return <>
    <span>{context.target_type}</span><span className="text-text">{context.target_id}</span>
    {typeof context.context.tag_alias === 'string' && <span className="badge">{context.context.tag_alias}</span>}
    {typeof context.context.marker_id === 'string' && <span>{context.context.marker_id}</span>}
  </>;
}
```

`target_type`/`target_id`는 ASG 플랫폼의 **내부 연동 식별자**다.
- 생성 경로: `app/routers/auth_router.py:110,194` → `app/asg_client.py:33,116` → `app/asg_session.py:13,47`
- 프론트 타입: `frontend/src/types/auth.ts` `LinkedASGContext.target_type: string`

**즉, 버그가 아니라 원시 식별자를 번역 없이 그대로 렌더링한 설계 결함이다.**

### 2-1. 화면에 보인 세 조각의 실제 출처 (리뷰에서 정정됨)

`snp-analyzer/tests/test_asg_launch_auth.py:85-91`의 ad_hoc 런치 픽스처:

```python
target=ASGLaunchContext(
    target_type="ad_hoc",
    target_id="78",
    context={"marker_id": "Ad hoc SNP Analyze", "tag_alias": ""},
),
```

→ 스크린샷의 `ad_hoc` `1` `Ad hoc SNP Analyze`는 각각
**`target_type`(원시) · `target_id`(원시) · `marker_id`(사람이 읽는 라벨)** 이다.

> **정정**: 초안은 `ad_hoc`을 "연동 대상이 없다는 뜻"으로 해석해 배지 전체를 숨기자고 제안했다.
> 이는 **틀렸다.** ad_hoc 컨텍스트도 `marker_id`에 사람이 읽을 이름을 담고 있으며, 이는 표시 가치가 있다.
> 버려야 할 것은 **앞의 두 조각(원시 식별자)** 뿐이다.

### 2-2. 두 번째 렌더 경로 (초안 누락)

`Header.tsx:35`의 좁은 화면용 `<summary>`도 원시값을 노출한다:

```tsx
<summary aria-label={t.asgContext} className="cursor-pointer">ASG · {context.target_type}</summary>
```

→ **두 경로를 모두 고쳐야 한다.** 데스크톱 경로만 고치면 xl 미만에서 그대로 남는다.

## 3. 해결 방향

### 3-1. 채택안 — 사람이 읽는 라벨만 표시, 원시 식별자는 화면에서 제거

1. `LinkedIdentity`가 `target_type`/`target_id`를 **렌더링하지 않는다.**
2. 표시 우선순위: `context.tag_alias`(비어 있지 않을 때) → `context.marker_id` → i18n 매핑된 `target_type` 라벨.
3. 셋 다 없으면 블록을 렌더링하지 않는다.
4. `<summary>` 축약형도 `ASG · <사람이 읽는 라벨>`로 통일한다.
5. 원시 식별자는 **기본 툴팁에 넣지 않는다.** 진단이 필요하면 관리자 화면 또는 개발자 콘솔 경로로 분리한다.
   (툴팁에 남기면 "노출 제거"가 아니라 "노출 위치 변경"에 그친다 — 리뷰 지적 반영)

### 3-2. i18n 매핑 추가

`locales/en.ts`, `locales/ko.ts`에 동시 추가 (`Translations` 타입이 동기화를 강제한다):

```ts
asgTargetLabel: (targetType: string) => string
```

**매핑해야 할 실제 값 집합**은 ASG 계약에서 확인한다. `target_type`은 enum/Literal이 아니라 순수 `str`이다
(`app/asg_client.py:33`, `app/asg_session.py:13`). 리포지토리에서 **실제로 관측된 값은 셋뿐**이다:

| 값 | 출처 |
|---|---|
| `ad_hoc` | `snp-analyzer/tests/test_asg_launch_auth.py:87` |
| `marker_version` | `snp-analyzer/tests/test_asg_launch_auth.py:56` |
| `design_run_item` | `snp-analyzer/tests/test_asg_result_save.py:105, 209, 302` |

> **주의**: 초안은 `marker` / `design_result` / `order_item`을 매핑 예시로 들었으나 **코드·테스트 어디에도 없는 추정값**이었다(리뷰 지적).
> 매핑 테이블은 위 세 값을 기준으로 설계하고, 그 밖의 값은 ASG 계약 문서로 확정한다.

**작업 전 ASG 측 계약 문서로 전체 열거값을 확정할 것.** 미지의 값은 매핑 실패 시
블록을 숨기거나 중립 문구(`ASG 연동`)로 폴백하고, 원시값을 화면에 흘리지 않는다.

### 3-3. 대안 (비채택)

- *블록 전체 제거*: ASG에서 마커를 열고 들어온 사용자가 "어느 마커를 보고 있는지" 확인할 방법을 잃는다. 회귀.
- *`ad_hoc`만 문자열 필터링*: 다음에 추가될 `target_type`에서 같은 문제가 재발한다.

## 4. 변경 범위

| 파일 | 변경 |
|------|------|
| `frontend/src/components/layout/Header.tsx` | `LinkedIdentity`(:22-28) **및** 축약 `<summary>`(:35) 두 경로 |
| `frontend/src/locales/en.ts` / `ko.ts` | `asgTargetLabel` 키 추가 |
| `frontend/src/components/layout/Header.test.tsx` | 케이스 추가 |

백엔드 변경 없음. API 계약 변경 없음.

## 5. 수용 기준

- [ ] `target_type` / `target_id` 원시값이 **화면 어디에도(툴팁 포함) 나타나지 않는다** — 데스크톱 경로와 xl 미만 `<summary>` 경로 모두.
- [ ] ad_hoc 런치(`marker_id = "Ad hoc SNP Analyze"`)에서 `Ad hoc SNP Analyze`만 표시된다.
- [ ] `tag_alias`가 빈 문자열이면 `marker_id`로 폴백한다 (실제 ad_hoc 픽스처가 이 형태다).
- [ ] 알 수 없는 `target_type`이 와도 크래시하지 않고, 원시값 대신 중립 폴백이 표시되거나 블록이 숨는다.
- [ ] `en`/`ko` 양쪽에서 문구가 번역된다.
- [ ] 비연동(local auth) 모드 렌더링은 변하지 않는다.

## 6. 테스트 계획

- 단위: `Header.test.tsx`에 ad_hoc(`tag_alias=""`, `marker_id` 존재) / `tag_alias` 존재 / 미지 타입 / 컨텍스트 전무 4개 케이스 × 데스크톱·축약 2경로.
- 회귀: `npx tsc --noEmit`, `npm run lint`, `npm test`.
- E2E: ASG 런치 경로 스펙이 있는지 `tests/` 확인 후 라벨 셀렉터 갱신.

## 7. 리스크

- **낮음.** 표시 전용 변경이며 저장/분석 경로에 영향 없음.
- 주의점 1: 루트 `tests/26-asg-compatibility.spec.ts`가 연동 라벨을 단언하면 스펙 수정 필요.
- 주의점 2: 백엔드 응답(`linked_context`)은 변경하지 않는다. 표시 계층만 바꾼다.

## 8. 미결정 사항

- `target_type` 전체 열거값 — ASG 계약 문서 확인 필요 (3-2).

브랜드 결정(D-1~D-4)과는 **독립적으로 즉시 착수 가능**하다.
