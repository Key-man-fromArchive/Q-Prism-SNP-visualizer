# 멀티-마커 UX 결정안 (경쟁사 조사 + codex/fable 심층 리뷰 종합)

작성일: 2026-07-10 · 상태: **UX 방향 확정, 구현 대기**
선행: `multi-marker-research-findings.md`(데이터/제약), `multi-marker-per-plate-handoff.md`(코드 진입점)
리뷰어: codex(gpt-5.5, high — 구현비용/정합성), fable(연구자 워크플로우/UX)

---

## 0. 합의 결론 (codex ∩ fable)
**3단계 마법사(강제 게이트) 폐기.** 대신 **2-surface 워크스페이스**: `Plate(setup)` 탭 + `Analysis` 탭이 항상 공존, 자유 왕복. 이것이 CFX Maestro/QuantStudio 사용자의 실제 멘탈모델(설정과 분석이 공존, 수십 번 오감)과 일치한다. 게이트로 만들면 이전 도구보다 **더 번거롭게** 느껴져 핵심 가치(자동 NTC, 마커별 독립 판정)를 깎아먹는다.

```
Upload ──▶ [ Workspace ]
              ├─ Plate 탭   (웰 배정 + ploidy + well type; 플레이트 맵)
              └─ Analysis 탭 (마커 선택기 + 산점도/결과/통계)
```
- 업로드 시: 현행처럼 **전체를 단일 마커로 자동 분석** → 바로 Analysis에 결과 표시(단일마커 사용자 마찰 0).
- "마커 정의/플레이트 편집" 상시 노출 → Plate 탭 이동. 편집 시 **영향받은 마커만 재실행** 후 복귀.
- 레이아웃 저장/불러오기는 Plate 탭 툴바. 업로드 시 "이전 레이아웃 적용?" 선제 제안.

## 1. 8개 열린 질문 — 확정 답
| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| Q1 | Plate Setup 필수 게이트? | **비차단(opt-in)**. 업로드 시 전체=단일마커 자동 분석, "마커로 분할?" 배너로 유도 | 단일마커가 다수 경로. 파일이 멀티마커 여부를 못 알려주므로 기본은 현행 유지 |
| Q2 | 마법사 vs 탭 | **탭(자유 이동)** | 재분석·레이아웃 편집이 고빈도 반복 작업. QuantStudio도 Setup/Analysis 탭 |
| Q3 | 레이아웃 형식 | **CSV(사용자용, Excel/QuantStudio 호환) + JSON(내부 리치, 서버 영속)**. UI 기본 버튼=CSV | CSV=상호운용, JSON=boundaries/threshold까지 정확 재현 |
| Q4 | NTC/컨트롤 범위 | **마커별(항상)**. 파일 자동감지 NTC는 그 웰을 소유한 마커에 귀속 | 데이터상 마커별 극단값. 전역 NTC는 나머지 마커 클러스터 오염 |
| Q5 | 배경차감 | **마커별 재계산** | assay마다 baseline 다름. 전역이면 방금 고친 self-baseline 아티팩트 재발 |
| Q6 | 미지정 웰 | **경고+제외, 차단 안 함**. 상태 = 배정됨/NTC·컨트롤/제외. 미지정 = 제외+카운트 배지 | 차단은 게이트의 다른 이름. 빈/실패 웰은 일상적 |
| Q7 | 레이아웃 적용 범위 | **2단계 분리**: `Layout`(웰배정+ploidy+type+sample, 물리설계) 기본 / `분석설정`(boundaries/threshold, 데이터특화)은 **명시적 opt-in 체크박스** | 저장된 threshold를 새 데이터에 무단 적용 = 조용한 오판정 |
| Q8 | 마커 다수(8+) | **개수별 컴포넌트 스왑**: ≤3 드롭다운/세그먼트, 4+ **좌측 마커 카드 사이드바**(이름·ploidy·n·genotype 요약·경고 아이콘) | 드롭다운은 상태를 숨김. 사이드바는 상황 인지 + 확장성 |

## 2. codex/fable 상충 지점 → 채택
- **Q1 강도**: codex="필수 리뷰 게이트 + 원클릭 단일마커 진행", fable="완전 비차단, 바로 Analysis 착지". → **fable 채택**(비차단). 파일이 멀티마커 여부를 못 알려주니 자동 단일마커가 무해한 기본값이고, 배너로 분할 유도.
- **Q6 미지정 웰**: codex="진짜 미지정은 분석 차단", fable="차단 말고 경고+제외". → **fable 채택하되 codex의 명시적 상태 도입**: 미지정 = "제외(경고)"로 취급, 절대 차단 안 함.

## 3. 반드시 반영할 추가 사항 (리뷰에서 발굴)
**아키텍처 (codex — 중요)**
- 마커를 임의 well-group에 필드만 붙이지 말고 **first-class `marker_region`** 개념으로. well-group은 selection/persistence 프리미티브만 재활용. (그냥 모든 그룹에 ploidy/boundaries 추가하면 모호성·마이그레이션 부채)
- **최고 비용은 setup 화면이 아니라 분석/리포트 정합성**: 결과 스키마 단일→마커-인덱스, export/PDF, 마커별 클러스터 캐시, 구세션 하위호환, 단일 target_id ASG 계약.
- UI 용어: "well-group" 노출 금지 → **Assay / Target(Marker)**. Well type = Unknown/NTC/Positive Control/No Amp.
- **"All" 풀링 클러스터링 기본값 금지**(마커 혼합은 생물학적 무의미). 기본=첫 유효 마커 또는 비풀링 "Plate Overview".

**UX 디테일 (fable — 데일리 시간이 쓰이는 곳)**
- **Paint 모드**: 마커 선택 후 웰 클릭/드래그로 "칠하기" — 비정형 그룹의 최대 생산성 win. (select→모달보다 빠름)
- **선택 에르고노믹스**: 열/행 헤더 클릭 + shift-범위 + ctrl-추가/제거 + 드래그 사각형 + 전체선택. 키보드(화살표 이동, Enter 배정, Esc 해제).
- **ploidy가 최고위험 필드인데 묻혀있음** → 마커별 눈에 띄는 선택기, 기대 클러스터 수 표시(6배체→최대 7 dosage), 관측≠기대 시 경고.
- **"이전 실행 레이아웃 적용"**: 업로드 시 플레이트 크기+웰 패턴 매칭해 선제 제안 — 레이아웃 기능의 진짜 payoff.
- **열 기반 분할 템플릿 제안**: "열 기준 2마커로 분할?" 원클릭 시작점(가장 흔한 물리 배치).
- 마커별 **수동 boundary 드래그를 탭 전환/재실행 간 보존**(잃으면 치명적).
- 마커별 상태 배지(분석됨/경고/미지정), 마커 이름 충돌·빈 이름 인라인 검증, 한 웰=한 마커 강제(이동 시 토스트).

## 3.5 목업 반복에서 확정된 추가 요구사항 (사용자)
인터랙티브 목업(`docs/mockups/multimarker-mockup.html`) 검토 중 사용자가 확정:
- **마커는 0개로 시작 · 직접 추가**: 프리셋/자동 마커 금지. 사용자가 이름을 직접 입력해 생성.
- **마커 색상 직접 선택**: 팔레트에서 마커별 색 지정, 언제든 변경. 웰 색 = 그 마커 색(테마와 무관한 고정값).
- **미지정/비활성 웰 = 회색**: 배정되면 마커 색으로 "켜짐", 해제하면 회색으로 "꺼짐". 웰 클릭 = 선택 토글.
- **주 동선 = 웰 선택 → 마커 선택 → 배정(Apply)** (Paint 모드 아님).
- **웰별 샘플 타입 지정**: `샘플 / NTC / Allele 1 대조 / Allele 2 대조 / 이형접합 대조`. allele 대조 = 클러스터 앵커(판정 기준점). NTC는 파일에서 자동 인식 후 편집 가능.
- **사용자 계정별 레이아웃 라이브러리**(신규): 저장/불러오기/삭제가 **`user_id` 스코프**. 파일(CSV/JSON) 교환과 별개로, 서버에 사용자별 저장 레이아웃 목록. → 백엔드 `saved_layouts(user_id, name, snapshot)` 저장소 신설.
- UI 전체 **한글**.

## 4. 엣지케이스 (구현 시 테스트 대상)
웰 배정 겹침 / 구세션 마커메타 없음 / import 레이아웃 웰이 플레이트에 없음 / 96 vs 384 명명 불일치 / CSV 중복 웰 / 대소문자·공백 마커명 / ploidy 누락·무효 / 파일 NTC와 import 레이아웃 충돌 / 마커 웰 수 부족(클러스터 불가) / 마커에 샘플 없이 NTC만 / 동일 sample id가 여러 마커(정상, 오류 아님) / 레이아웃 편집 후 stale 결과 무효화 / export가 마커별인지 전체인지 명시.
**최대 위험 = 조용한 정합성 실패**: 마커 혼합 풀링 클러스터링, 레이아웃 편집 후 낡은 threshold 적용.

## 4.5 3-에이전트 리뷰 반영 (codex·fable·sonnet, 2026-07-10) — 구현 전 필수 수정
목업+결정문서+실코드를 세 모델이 각기 다른 렌즈로 검토. 아래는 **구현 착수 전 반드시 닫아야 할** 확정 항목.

### 정합성(조용한 오판정) — Phase A 착수 전 설계 확정
- **[C1·최우선] allele 대조 앵커가 현재 무력**: `cluster_auto`가 대조를 GMM에서 제외하고 자기라벨만 부여, `genotype_window`는 비-genotype 라벨을 drop → 목업의 "판정 기준점" 다이아몬드가 계산에 0 기여. **앵커 메커니즘 정의 필수**: (a) `a1/a2/het`를 genotype 라벨과 분리된 **first-class 대조 역할**로 신설(현 WellType에 없음), (b) 앵커가 mixture를 구속(성분 평균 시드/고정) 또는 최소한 `offset_uncertain` 해소에 사용, (c) 앵커 ratio가 피팅된 최근접 샘플 클러스터에서 N SD 이상 벗어나면 **불일치 경고**. 무구속이면 "샘플 피팅이 조용히 이김".
- **[C2] 좁은 마커 과분할**: `_DOSAGE_MERGE_FRAC=0.5` → ploidy6 병합임계 0.083. qTotal11.1 실 spread ≈0.10 > 0.083 → BIC가 노이즈를 인접 dosage 2개로 쪼갤 수 있음. 테스트: 실 ratio(0.69–0.79)로 `cluster_auto`→`k=1` 단언.
- **[C3] 소규모 region 과신**: 4웰 미만 fallback이 `offset=0`·default cut·**confidence=1.0** 반환. 비정형 소규모 마커(2–3웰)가 blind 최고신뢰 판정. → 별도 "n 부족/미검증" 상태, conf 1.0 금지.
- **[C4] 마커별 상대 NTC 오라벨**: `ntc_mask = total < 0.2*median_total`이 사용자 타이핑과 무관하게 하위 20%를 NTC 자동 지정 → 좁은 dynamic-range 마커의 진짜 샘플을 NTC로 오판. UI "NTC 없음"은 라벨 유무만 봄(엉뚱). → 자동 NTC가 사용자 "샘플"과 겹치면 경고.
- **[C5] 6배체 het 대조 = 과학적 오류(fable)**: 6배체엔 단일 het 없음(중간 dosage 5종, ratio 0.5=AAABBB 3/6). → **ploidy>2에선 "이형접합" 대신 dosage-지정 대조(n/p 선택)**, diploid만 het 유지.
- **[C6] No-Amp/제외 웰 타입 신설(fable)**: 실패 웰(ratio 0.0/1.0)이 클러스터 오염. 현재 `sample`로 남아 극단 dosage로 판정됨.
- **[C7] 마커별 배경차감 위치 미정(Q5)**: `normalize_for_cycle`는 플레이트 1회. region별 재계산을 파이프라인 어디에 꽂을지 미정. **소규모 region이 자기 웰로 채널 최소 배경을 잡으면 헤드룸 없어 near-zero → 커밋 416fd4c가 고친 self-baseline 버그 변종 재발.** 소규모 region 가드 필수.

### 아키텍처·영속 (codex)
- **[A1] `db.py:save_clustering`이 현재도 boundaries/offset/offset_uncertain/low_separation/ploidy를 저장 시 누락**(기존 결함). 멀티마커는 `regions_json` 또는 리치 결과 테이블 + 구세션 마이그레이션.
- **[A2] 다운스트림 plate-level 조용한 회귀**: `statistics.py:get_statistics`, `export.py`, `asg_result.py:build_result_snapshot`가 `unified.ploidy`·plate counts 사용 → region 관통 필요. 멀티region 요청은 `unified.ploidy`에 `req.ploidy`를 쓰면 안 됨.
- **[A3] marker = first-class region**(well-group에 필드만 붙이지 말 것). `run_clustering`: `req.regions is None`이면 현행 바이트동일, 있으면 region마다 부분집합 `cluster_auto`+`genotype_window`→flat 병합+`RegionResult[]`. 신설 모델 `MarkerRegion{id,name,wells,ploidy,threshold_config?}`, `RegionResult{...,genotype_counts}`.
- **[A4] 저장 레이아웃 = 신규 `/api/layouts`**(GET/POST/GET{id}/PUT/DELETE), 테이블 `saved_layouts(id, owner, scope, name, snapshot_json, ...)`. `/groups` 재사용 금지(그룹=세션 스코프·이름키·plain 배열). 스냅샷은 `schema_version` 포함.
- **[A5] 편집 후 stale 결과 무효화**: `cluster_store[sid]` 단일 캐시 → 마커별 dirty flag/재실행.

### 레이아웃 안전 (codex+fable+sonnet 조정)
- **[L1] 스코프 = user 단독이 아니라 팀/공유**(fable: 레이아웃은 랩 프로토콜). codex 스키마에 `owner`+`scope` 추가, 공유 라이브러리 + "내 것으로 복사".
- **[L2] ploidy 무단 승계 금지**: Q7이 ploidy를 기본 Layout에 포함 → 다른 파일 적용 시 6배체가 조용히 상속(sonnet). **다른 파일 적용 시 ploidy 재확인 강제**("ploidy=최고위험" 원칙).
- **[L3] "이전 실행" 자동제안이 크기만 매칭 → 엉뚱한 패널**. 마커명/웰점유 패턴으로 매칭 + 사용자 확인(blind apply 금지).
- **[L4] 웰 타입 carryover**: 다른 파일/마커 이동 시 sample ID·well type(a1 등) 무단 승계 → 오라벨·잘못된 앵커. 이동 시 타입 리셋 여부 명시.

### 목업이 결정문서에서 이탈 (fable) — 프론트 구현 시
- 산점도 경계선이 **고정·비인터랙티브·비영속**(핵심 폴리플로이드 draggable boundary가 장식으로만) → 실제 드래그+마커별 영속.
- **드래그 사각형 선택 없음**(§3 약속) — 임의 그룹 전제 훼손. + 키보드 네비.
- **D7 분석설정 opt-in 게이트가 UI에 없음** — `loadLayout`이 전부 무단 재적용(최대 위험).
- 열분할 원클릭 템플릿·업로드 시 레이아웃 자동제안 미구현.

### 재검증 필요
- NTC 웰 수 불일치: 핸드오프 marker1=9 vs 파일 선언 12(전역) — raw 데이터로 재확인 후 구현.

## 5. 우선순위
- **Must**: 비차단 setup(Q1), 탭 구조(Q2/§0), 마커별 NTC(Q4)·배경(Q5), 경고+제외(Q6), ploidy 부각+클러스터수 검증, block/paint 선택+키보드, 단일마커 우아한 기본, 마커별 재실행 시 수동 boundary 보존, CSV import/export(Q3), first-class marker_region.
- **Nice**: 개수별 사이드바/드롭다운 스왑(Q8), 리치 JSON+파라미터 opt-in(Q3/Q7), 이전 레이아웃 자동 제안, 열분할 템플릿, "전체 보기" 오버레이.
