# Q-Prism 다중 파일 작업공간 디자인 시스템

## 1. 원칙

- 기존 Q-Prism의 색상 token, Tailwind utility, 공유 UI primitive를 재사용한다.
- 드로어는 분석 화면 위의 보조 작업 표면이다. 현재 plot/plate를 불필요하게 unmount하지 않는다.
- 파일 상태는 색상만이 아니라 icon, 짧은 label, 보조 설명으로 전달한다.
- `닫기`와 `삭제`를 언어·위치·icon 모두에서 구분한다. 드로어에는 삭제가 없다.
- 긴 실험 파일명과 영문/한글 혼합을 기본 사례로 취급한다.

## 2. 기존 token

새 hard-coded 색상을 추가하지 않고 `frontend/src/index.css`의 token을 사용한다.

| 용도 | Light | Dark | Token |
| --- | --- | --- | --- |
| 앱 배경 | `#f5f7fa` | `#0f1117` | `bg-bg` |
| drawer/card | `#ffffff` | `#1a1d27` | `bg-surface` |
| 경계 | `#e0e4e8` | `#2d3040` | `border-border` |
| 본문 | `#1a1a2e` | `#e4e4e7` | `text-text` |
| 보조 | `#6b7280` | `#9ca3af` | `text-text-muted` |
| 활성/진행 | `#2563eb` | `#3b82f6` | `primary` |
| 성공 | `#10b981` | `#34d399` | `success` |
| 경고 | `#f59e0b` | `#fbbf24` | `warning` |
| 실패 | `#ef4444` | `#ef4444` | `danger` |

radius는 `sm 4px`, `md 8px`, `lg 12px`를 유지한다. focus는 공유 Button과 같이 primary 2px ring을 쓴다.

## 3. 타이포그래피와 간격

- 시스템 글꼴 stack을 유지한다.
- drawer 제목: 16px/600
- section 제목: 12px/600, 보조색, 필요 시 uppercase 대신 자연어 사용
- 파일명: 14px/500, 한 줄 ellipsis, `title`만이 아니라 접근 가능한 전체 이름 제공
- metadata/status: 12px/400
- 오류 detail: 12px/400, 한 줄 ellipsis와 전체 내용을 제공하는 title
- spacing scale: 4, 8, 12, 16, 24, 32px

파일 행 최소 높이는 56px, interactive target은 최소 40×40px를 목표로 한다.

## 4. 레이아웃

### Desktop ≥ 1024px

- drawer 폭: 전체 폭을 사용할 수 있으며 최대 720px
- 화면 오른쪽에 fixed, 전체 viewport 높이
- 반투명 backdrop을 사용하되 현재 분석 내용을 식별할 수 있게 한다.
- header 56px, footer action 필요 시 sticky

### Tablet 768–1023px

- 폭: 화면 폭에 맞추되 최대 720px
- 긴 queue는 drawer 내부만 scroll한다.

### Mobile < 768px

- 100vw drawer
- drop-only 안내에 의존하지 않고 파일/폴더 선택 버튼을 우선 제공한다.
- section header와 queue actions가 겹치지 않도록 행 action은 overflow menu로 축약할 수 있다.

## 5. 핵심 컴포넌트

### FileWorkspaceDrawer trigger

- 헤더 우측 secondary/ghost button
- folder/file icon, `파일`, 이번 작업 수 badge
- `aria-haspopup="dialog"`, `aria-expanded` 제공

### FileWorkspaceDrawer panel

- 제목 `파일 작업공간`, 닫기 IconButton
- 상단 compact drop zone
- `업로드 중`, `이번 작업`, `최근 파일` section
- 하단 `프로젝트에서 관리` 링크
- focus trap, Escape, trigger focus restore

### Drop area

- dashed border, surface/bg 변화, Upload icon
- 기본 문구 `여기에 파일 또는 폴더 놓기`
- `파일 선택`, `폴더 선택` secondary button
- drag active에서 border-primary와 짧은 안내
- count/size limit를 caption으로 표시

### Queue row

```text
[상태 아이콘] filename-or-CFX-bundle        [재시도]
             12.4 MB · CFX Opus
             업로드 중 / 오류 상세
```

- queue row는 session을 직접 열지 않는다. 성공 session은 별도의 이번 작업 목록에서 연다.
- error row에만 독립 재시도 button을 표시한다.
- MVP는 숫자 progress bar 대신 현재 단계 label과 spinner를 사용한다.

### SessionRow: 이번 작업

- active: primary border/background, `현재 열림` label
- inactive: 기본 border/surface와 `열기` action
- close: X icon과 `작업 목록에서 닫기` accessible name
- filename 아래 instrument, wells/cycles를 표시

### SessionRow: 최근 파일

- 파일명, instrument, wells×cycles
- click 시 이번 작업에 추가하고 연다.
- 현재 작업에 이미 있으면 recent section에서 중복 렌더하지 않는다.

### ImportMappingWizard

- preview/mapping 항목 중 첫 번째 항목에 기존 wizard를 한 번만 표시
- channel-role mapping 제출 후 session을 만들고 성공 단계로 전환
- 닫기 또는 오류 후 해당 항목에서 재시도 가능

## 6. 상태 표현

| 상태 | icon 예 | 색상 | label | 허용 동작 |
| --- | --- | --- | --- | --- |
| queued | Clock | muted | 대기 | 상태 확인 |
| packaging | Package | info | XML 묶는 중 | 상태 확인 |
| uploading | Upload | info | 업로드 중 | 상태 확인 |
| mapping | Sliders | warning | 매핑 필요 | wizard 사용 |
| success | CircleCheck | success | 업로드 완료 | 이번 작업에서 열기 |
| error | AlertCircle | danger | 실패 | 재시도, 상세 |

queue의 `success`가 분석 판정의 생물학적 품질을 뜻하지 않도록 label을 `업로드 완료`로 명확히 한다.

## 7. 동작과 motion

- 단계 변경은 즉시 반영하고 실제 byte 진행률처럼 보이는 인위적 percentage를 만들지 않는다.
- 새 항목은 선택 순서대로 기존 queue 뒤에 추가한다.
- 파일 open 성공 전 기존 분석을 흐리거나 제거하지 않는다. 성공 후 대상 화면으로 원자 전환한다.

## 8. 접근성

- drawer에는 접근 가능한 제목을 제공한다.
- 항목 status 변화는 `aria-live="polite"`로 단계 변경/완료/실패만 알린다.
- keyboard 순서: 닫기 → drop actions → queue → 이번 작업 → 최근 파일 → 프로젝트 링크.
- 목록 navigation에 임의 arrow-key pattern을 강요하지 않고 기본 Tab/Enter/Space를 지원한다.
- 파일명 tooltip만 정보의 유일한 출처로 쓰지 않는다.
- contrast WCAG AA, axe critical/serious 0건을 수용 기준으로 한다.

## 9. 콘텐츠 규칙

- `닫기`: `작업 목록에서 닫기`로 설명하고 `서버의 파일과 분석 결과는 유지됩니다`를 보조 안내에 제공한다.
- `삭제`: drawer에서 사용하지 않는다.
- 오류: `무엇이 실패했는지 + 사용자가 할 수 있는 것` 순서로 쓴다.
- 파일명은 그대로 표시하며 번역하지 않는다.
- 기술 형식명(CSV, XML, CFX, ROX)은 동일하게 유지한다.
- 새 문구는 KO/EN locale key로만 관리한다.

## 10. 화면 상태별 검수

- empty, 1개, 10개, 20개, 긴 파일명, 같은 prefix 파일명
- queue와 recent 둘 다 긴 경우 독립 section 이해 가능 여부
- light/dark, KO/EN, 200% zoom
- 320px 폭에서 action 접근 가능
- keyboard only와 screen reader status
- reduced motion에서 기능 손실 없음

## 11. 비목표

- 기존 전체 애플리케이션 visual redesign
- 새로운 icon library 도입; 기존 Lucide React 사용
- plot color/판정 color 변경
- drag로 작업 목록 순서 변경
- drawer 안에서 프로젝트 편집/영구 삭제
