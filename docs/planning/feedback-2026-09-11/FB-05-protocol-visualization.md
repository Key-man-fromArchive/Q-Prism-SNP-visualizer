# FB-05 — PCR 프로토콜 시각화 + 판독 채널 표시

- **피드백 ID**: `18b3fcc92f4f442c` · 카테고리 `feature` · 상태 `open`
- **제출**: 2026-09-11 14:26:49 / page_key `protocol`
- **원문**: "프로토콜을 시각화하면 좋겠습니다. 그리고 어떤 채널을 읽었는지도 보면 좋겠죠"
- **스크린샷**: `feedback-shots/18b3fcc9-a692e7.png`
- **복잡도**: Complex (**백엔드 모델 확장 포함**)

## 1. 관찰된 현상

프로토콜 탭은 **편집 가능한 표 하나**가 전부다. 스크린샷에서 보이는 것:

| 단계 | 라벨 | 온도 | 시간 | 사이클 |
|---|---|---|---|---|
| 1 Pre-read | Pre-Read | 30 | 60 | 1 |
| 2 Initial Denaturation | Initial Denaturation | 94 | 300 | 1 |
| 3 Amplification 1 (Touchdown) ×10 | Denaturation | 94 | 20 | 10 |
| 4 | Annealing (TD -0.6/cyc) | 61 | 60 | 10 |
| → GOTO: ↩ Repeat Steps 3-4 × 10 cycles | | | | |
| 5 Amplification 2 ×15 | Denaturation | 94 | 15 | 15 |
| … | | | | |

문제:
- **열 순환 프로파일의 형태**(온도-시간 곡선, 터치다운 하강, 반복 구간)가 숫자로만 존재한다.
- **어느 단계에서 형광을 읽었는지**가 라벨 옆 카메라 이모지 📷 하나로만 암시된다.
- **어떤 채널(FAM/HEX/ROX 등)을 읽었는지**는 이 탭에 전혀 없다.
- 컨테이너가 `max-w-[800px]`로 고정되어 1920px 화면에서 우측 60%가 빈 공간이다.

## 2. 근본 원인 (코드 근거)

### (a) 판독 정보가 파싱 단계에서 버려진다 — **핵심 발견**

`app/parsers/pcrd_raw.py` `_parse_protocol()`:

```python
if elem.tag == "TemperatureStep":
    temp = float(elem.get("temperatureStepTemp", "0"))
    hold = int(elem.get("temperatureStepHoldTime", "0"))
    has_read = elem.find("PlateReadOption") is not None       # ← 판독 여부를 읽는다
    inc = elem.find("IncrementOption")                        # ← 터치다운 증분을 읽는다
```

그러나 최종 생성부는:

```python
steps.append(ProtocolStep(
    step=step_num, temperature=temp, duration_sec=hold,
    cycles=total_cycles, label=label, phase=phase, goto_label=goto_label,
))
```

**`has_read`도 `inc`도 `ProtocolStep`에 담기지 않는다.**

`app/parsers/eds_raw.py`도 동일하다. `CollectionFlag == "1"`을 읽지만 결과는 `label = "Data Collection"`이라는
**문자열로만** 남는다.

`app/models.py`:
```python
class ProtocolStep(BaseModel):
    step: int
    temperature: float
    duration_sec: int
    cycles: int = 1
    label: str = ""
    phase: str = ""
    goto_label: str = ""
```
→ 판독 플래그, 온도 증분, 판독 채널을 담을 필드가 **아예 없다.**

### (b) 프론트가 라벨 문자열로 판독 여부를 추측한다

`frontend/src/components/protocol/ProtocolTab.tsx`:

```tsx
function isReadingStep(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes('data collection') || lower.includes('pre-read') || lower.includes('post-read');
}
```

라벨은 **사용자가 자유 편집할 수 있는 텍스트 입력**이다(`handleStepChange(stepIndex, 'label', …)`).
사용자가 라벨을 "어닐링·판독"으로 바꾸면 카메라 아이콘이 사라진다.
**표시가 데이터가 아니라 문자열 휴리스틱에 의존한다.**

### (c) 채널 정보는 런 단위로만 존재한다

채널은 임포트 시 `channel_roles` / `channel_labels`로 역할(FAM=WT, HEX=MT1, ROX=normalization)에 매핑된다
(`app/parsers/generic_table.py`, `app/role_labels.py`, 프론트 `lib/channel-labels.ts`).
`pcrd_raw.py`의 `_parse_plate_reads(root, channel_map, assigned_wells)`에서 `channel_map`은 **런 전체의 채널→인덱스** 맵이며,
**단계별 채널 목록은 유지되지 않는다.**

## 3. 해결 방향

### 3-1. `ProtocolStep` 모델 확장 (백엔드, 우선순위: 최상)

```python
class ProtocolStep(BaseModel):
    step: int
    temperature: float
    duration_sec: int
    cycles: int = 1
    label: str = ""
    phase: str = ""
    goto_label: str = ""
    # ↓ 추가 (전부 기본값 있음 → 기존 저장 데이터와 호환)
    plate_read: bool = False                                      # 이 단계에서 형광을 판독했는가
    temp_increment: float | None = None                           # 사이클당 온도 증분 (터치다운, 음수 가능)
    read_channels: list[str] = Field(default_factory=list)        # 단계별 판독 채널 (알 수 없으면 빈 리스트)
```

> `list[str] = []`는 Pydantic v2가 기본값을 복사하므로 실제로 안전하지만,
> 의도를 명확히 하려면 `Field(default_factory=list)`를 쓴다.

**하위 호환성**: 세 필드 모두 기본값이 있으므로
- `app/db.py`의 `ProtocolStep(**s)` 역직렬화가 기존 저장 JSON에서 그대로 동작한다.
- `protocol_overrides` 테이블에 저장된 사용자 편집본도 깨지지 않는다.

**파서 채우기**:
| 파서 | `plate_read` | `temp_increment` | `read_channels` |
|------|--------------|------------------|-----------------|
| `pcrd_raw.py` | `has_read` (`_parse_protocol` 내에서 이미 계산) | `IncrementOption` (이미 읽음) | **채우지 않음** — 단계별 채널 정보 없음 |
| `eds_raw.py` | `CollectionFlag == "1"` | `ext_temp` (이미 읽음) | **채우지 않음** |
| 기타 파서 | 기본값 | 기본값 | 기본값 |

> **정정 (리뷰 반영)**: 초안의 이 표는 pcrd에서 `read_channels`를 "런 전체 채널"로 채운다고 썼는데,
> 바로 아래 본문의 "단계별 구분이 없으면 채우지 않는다"와 **모순**이었다. **본문 규칙이 맞다.**
> 런 전체 채널은 `read_channels`가 아니라 **3-3의 런 채널 요약 카드**로 별도 표시한다.
> 두 정보를 섞으면 "이 단계에서 이 채널들을 읽었다"는 **거짓 단언**이 된다.

> **중요**: 단계별 채널 구분이 원본 파일에 없는 포맷에서는 `read_channels`를 **채우지 않는다**(빈 리스트).
> 프론트는 빈 리스트를 "판독은 했으나 채널 정보 없음"으로 표시하고, 런 단위 채널을 **별도 문구로** 안내한다.
> 추측으로 채우면 과학적으로 잘못된 정보를 단언하게 된다.

### 3-2. 열 순환 프로파일 다이어그램 (프론트, 우선순위: 상)

표 위에 **온도-시간 단계 프로파일**을 그린다.

```
 °C
 94 ┤ ██     ██▁▁▁     ██▁▁     ██
    │ │      │    │    │   │    │
 61 ┤ │   ▁▁▁┘    └▁▁▁▁┘   └▁▁▁▁┘   ← TD -0.6/cyc (하강 표시)
 30 ┤▁┘                              📷 📷      📷
    └────────────────────────────────────────────
      Pre  Initial   Amp1 ×10   Amp2 ×15   Amp3 ×10
      read  Denat    (Touchdown)
```

설계 원칙:
- **가로축은 실제 시간이 아니라 단계 순서**로 한다. Initial Denaturation 300초와 Annealing 5초를 실시간 비례로 그리면
  증폭 구간이 보이지 않는다. 단계 폭은 균등하게 하고 **지속시간은 라벨로** 표기한다.
- 반복 구간은 `phase` 값으로 묶어 **배경 밴드 + `×N` 배지**로 표현한다 (`getPhaseColor()`의 기존 색 체계 재사용).
- 판독 단계에 📷 마커를 **`plate_read` 필드 기준으로** 찍는다 (라벨 휴리스틱 폐기).
- 마커에 채널 칩(`FAM` `HEX` `ROX`)을 붙인다. `read_channels`가 비면 칩을 생략한다.
- 터치다운은 `temp_increment`로 하강 화살표/점선을 표시한다.

**구현 수단 선택**:
| 방식 | 장점 | 단점 |
|------|------|------|
| **인라인 SVG** (권장) | 의존성 0, 다크모드 `currentColor`, 접근성 `<title>`/`<desc>` 제어 용이, 인쇄/PDF 안정 | 직접 좌표 계산 |
| Plotly | 이미 번들에 있음, 줌/호버 무료 | step-chart 표현에 과함, 테마 이원화(`plotly-theme.ts`) 부담, 번들 상호작용 불필요 |

→ **인라인 SVG 채택.** 이 다이어그램은 탐색이 아니라 **요약 그림**이다.

### 3-3. 런 채널 요약 카드

프로토콜 탭 상단에 채널 요약을 둔다. 데이터는 이미 존재한다 (`data-store.channelLabels`, `allele2Dye`).

```
판독 채널   ● FAM → WT   ● HEX → MT1   ● ROX → 정규화 기준
```

역할 색은 `--color-fam` / `--color-allele2` CSS 토큰을 재사용해 산점도와 색을 일치시킨다.

### 3-4. 레이아웃

- `max-w-[800px]` 제한을 해제하고 넓은 화면에서 **다이어그램(상) + 표(하)** 또는 **좌우 2단**으로 배치.
- 표는 **편집 기능을 그대로 유지**한다. 다이어그램은 읽기 전용 요약이며 표의 값 변경에 반응해 다시 그려진다.

## 4. 변경 범위

| 파일 | 변경 |
|------|------|
| `app/models.py` | `ProtocolStep`에 `plate_read`, `temp_increment`, `read_channels` |
| `app/parsers/pcrd_raw.py` | `_parse_protocol()`에서 `has_read`/`inc` 전달 |
| `app/parsers/eds_raw.py` | `CollectionFlag`/`ext_temp` 전달 |
| `app/db.py` | 역직렬화 확인 (기본값으로 무변경 예상) |
| `app/routers/data.py` | 예제 프로토콜 상수 갱신 |
| `app/asg_result.py` | ASG 저장 payload에 신규 필드가 자동 포함됨 — 상위 스키마 호환 확인 |
| `frontend/src/types/api.ts` | `ProtocolStep` 타입 동기화 |
| `frontend/src/components/protocol/ProtocolThermalProfile.tsx` | **신규** SVG 다이어그램 |
| `frontend/src/components/protocol/ProtocolTab.tsx` | 다이어그램 배치, `isReadingStep` 휴리스틱 제거, 폭 해제 |
| `frontend/src/components/protocol/use-protocol-editor.ts` | 신규 필드 보존(편집 시 유실 금지) |
| `frontend/src/locales/{en,ko}.ts` | 다이어그램/채널 카드 문구 |
| `snp-analyzer/tests/` | 파서 테스트에 신규 필드 단언 |
| `frontend/src/components/protocol/ProtocolTab.test.tsx` | 다이어그램 렌더 테스트 |

## 5. 수용 기준

- [ ] `.pcrd` 임포트 시 판독 단계의 `plate_read === true`가 API 응답에 담긴다.
- [ ] 사용자가 단계 **라벨을 바꿔도** 📷 표시가 유지된다 (휴리스틱 의존 제거 증명).
- [ ] 터치다운 단계에 사이클당 온도 증분이 표시된다.
- [ ] 채널 정보가 없는 포맷에서 **빈 칩/추측 값이 표시되지 않는다.**
- [ ] 프로토콜 편집 → 저장 → 재조회 시 신규 필드가 보존된다.
- [ ] 기존에 저장된 프로토콜(신규 필드 없음)이 오류 없이 로드된다 (`app/db.py:692`, `:753`의 `ProtocolStep(**s)`).
- [ ] **ASG 결과 저장 payload**가 신규 필드를 포함한 채로도 ASG 측에서 거부되지 않는다 (`app/asg_result.py`).
- [ ] 채널 요약 카드가 `data-store` 캐시가 아니라 **프로토콜/세션 응답 계약**의 값을 읽는다 (stale 방지).
- [ ] 다이어그램이 라이트/다크 모두에서 판독 가능하고, 400px 폭에서 가로 스크롤로 처리된다.
- [ ] `pytest` 전체 통과 (파서 스냅샷 포함).

## 6. 테스트 계획

- 백엔드: `tests/`의 PCRD/EDS 파서 테스트에 `plate_read`, `temp_increment` 단언 추가.
- 백엔드: ASG 저장 payload 스키마 호환 테스트 (신규 필드 포함 시 직렬화·전송 정상).
- 백엔드: 기존 저장 프로토콜 JSON(신규 필드 없음) 역직렬화 회귀 테스트.
- 프론트: 다이어그램이 단계 수/판독 마커 수를 정확히 그리는 단위 테스트.
- E2E: 프로토콜 탭 진입 → 다이어그램 존재 → 라벨 편집 → 저장 → 마커 유지.

## 7. 리스크

- **중간.** 모델 확장은 기본값이 있어 안전하지만, **파서 스냅샷 테스트가 있다면 전부 갱신**해야 한다.
- `ProtocolStep`은 ASG 결과 저장 payload에도 실린다(`app/asg_result.py`). 필드 추가가 **외부 시스템 계약**에 닿는다 —
  ASG 측이 엄격한 스키마 검증을 한다면 사전 협의가 필요하다. **이 문서에서 유일하게 리포지토리 밖으로 나가는 변경이다.**
- `use-protocol-editor.ts`가 편집 시 스텝 객체를 재구성한다면 신규 필드가 유실될 수 있다 — `{ ...s, [field]: value }` 스프레드가
  유지되는지 확인 필요 (현재 `ProtocolTab.tsx`의 `handleStepChange`는 스프레드를 쓰므로 안전).
- `handleAddStep`이 만드는 신규 스텝에 신규 필드 기본값을 명시해야 타입 에러가 없다.

## 8. 미결정 사항

- 단계별 채널 구분이 불가능한 포맷에서의 표시 문구 — "런 전체 채널: FAM, HEX, ROX" 수준으로 충분한가.
- ASG 측 `protocol_steps` 스키마 검증 강도 — 필드 추가 사전 협의 필요 여부.
- 가로축을 단계 순서로 고정할지, "실시간 비례 보기" 토글을 제공할지.
- 다이어그램을 PDF/PNG 내보내기(`use-exports.ts`)에 포함할지 — 포함 시 `chart-export-registry.ts` 등록 필요.
