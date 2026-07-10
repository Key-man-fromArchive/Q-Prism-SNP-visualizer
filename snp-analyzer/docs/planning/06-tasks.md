# 06-tasks — 멀티-마커 판정 구현 계획 (Domain-Guarded)

생성: 2026-07-10 · 대상: `Q-Prism-SNP-visualizer/snp-analyzer` · 브랜치: `feat/multi-marker-phase-a`
근거: `docs/multi-marker-ux-decision.md`(§4.5 구현 전 필수 수정), `docs/multi-marker-research-findings.md`, `docs/multi-marker-per-plate-handoff.md`
순서(확정): **정합성 → 백엔드 관통 → 레이아웃 → 프론트**

---

## Interface Contract Validation (ICV)
기존 코드베이스라 화면 명세 YAML 대신 결정 문서를 spec으로 삼아 화면 needs ↔ 백엔드 리소스 검증.

| 화면 needs | 리소스 | 필드/계약 | 상태 |
|---|---|---|---|
| 마커별 판정 결과 | `run_clustering` regions | `RegionResult{assignments,confidences,boundaries,offset,offset_uncertain,low_separation,genotype_counts}` | ✅ P0 |
| 결과 영속(재로드) | `db.save/load_clustering` | `result_json`(regions 포함) | ✅ P0 |
| allele 대조 앵커 | `WellType`+`cluster_auto` | 대조 역할 a1/a2/het, 앵커 구속, 불일치 경고 | ❌ P1-R1 |
| 소규모/저품질 신뢰도 | `cluster_auto` | n<4 conf≠1.0, 상대NTC 가드 | ❌ P1-R2 |
| 마커 정의 영속(웰↔마커·색·ploidy·타입) | marker_regions store | `GET/POST/PUT/DELETE /api/data/{sid}/markers` | ❌ P2-R3 |
| 마커별 배경차감 | normalize 파이프라인 | region subset 배경 재계산(소규모 가드) | ❌ P2-R4 |
| 마커별 통계/QC/export/ASG | statistics/qc/export/asg_result | region 관통 | ❌ P2-R5 |
| 사용자/팀 레이아웃 | `/api/layouts` | `saved_layouts(owner,scope,name,snapshot_json)` | ❌ P3-R6 |
| 플레이트 설정 화면 | S1 | grid 선택→마커→배정, 마커CRUD+색, 웰타입, 회색 미지정 | ❌ P4-S1 |
| 분석 화면 | S2 | 마커 선택기, **드래그+영속 경계선**, 마커별 통계 | ❌ P4-S2 |
| 레이아웃 라이브러리 화면 | S3 | 내/팀 레이아웃, 저장/불러오기, CSV/JSON, 적용시 확인 | ❌ P4-S3 |

**커버리지**: 화면 needs 9개 중 2개(P0) 충족, 7개 태스크화. 불일치 없음(모든 needs에 대응 리소스 정의됨).

병렬 규칙: Resource 태스크는 서로 의존 없으면 병렬. Screen은 해당 Resource 완료 후. Verification은 관련 태스크 완료 후. 모든 P1+ 태스크 **TDD(RED→GREEN→REFACTOR)**.

---

## P0 — 완료 (기록용)
- **P0-R0-T1** ✅ A1 저장버그: `db.save_clustering` result_json + migration 3 (`90b3067`). 라운드트립 테스트.
- **P0-R0-T2** ✅ region 분기: `MarkerRegion`/`RegionResult`, `run_clustering` regions 분기, flat 병합, 겹침 400, unified.ploidy 불변 (`ce03bd3`). 실파일 §4 검증, 194 tests.

---

## P1 — 판정 정합성 (조용한 오판정 차단) 🔴 최우선

### P1-R1: allele 대조 앵커 (C1 + C5)
현재 `cluster_auto`는 대조를 GMM에서 제외·자기라벨만 → 목업 "판정 기준점"이 계산에 0 기여. **앵커화 필수.**

- **P1-R1-T1** — 대조 역할 신설(입력 타입 ≠ 결과 라벨)
  - 파일: `app/models.py`(`WellType` 또는 신규 `ControlRole`), `app/processing/genotype_vocab.py`(CONTROL_TYPES)
  - RED: a1/a2/het 대조 타입을 welltype로 지정 → 클러스터 결과에 역할이 보존되는지 실패 테스트
  - GREEN: `ALLELE1_CONTROL`/`ALLELE2_CONTROL`/`HET_CONTROL`(dosage 지정 가능) 추가. **C5: ploidy>2에선 het 대신 dosage n/p 지정**(단일 het 금지), diploid만 het.
  - 수용: 대조 타입이 genotype 라벨과 분리되어 저장·전송됨.
- **P1-R1-T2** — cluster_auto가 앵커로 구속
  - 파일: `app/processing/clustering.py::cluster_auto`
  - RED: a1 대조(r≈0.95)가 있는 region에서 offset_uncertain이 해소되고 dosage 매핑이 앵커에 정렬되는지 실패 테스트
  - GREEN: 대조를 fit에서 제외하되 **(a) dosage-매핑/offset 결정에 앵커 사용**(어느 극단에 가까운지로 offset 확정) 또는 성분 평균 시드. 
  - 수용: 실파일 qSwet5.3에 a1/a2 대조 추가 시 offset 확정(offset_uncertain=False).
- **P1-R1-T3** — 앵커-피팅 불일치 경고
  - RED: a1 대조 ratio가 최근접 샘플 클러스터에서 N pooled-SD 초과 시 경고 플래그 실패 테스트
  - GREEN: `RegionResult`에 `anchor_conflict: bool`(+사유) 추가, 경고 반환. 조용히 샘플 fit이 이기지 않도록.
  - 수용: 대조가 클러스터와 어긋나면 flag=True.

### P1-R2: 소규모/저품질 정합성 가드 (C3 + C4 + C6)
- **P1-R2-T1** — 소규모 region 과신 제거 (C3)
  - 파일: `app/processing/clustering.py::cluster_auto`(n<4 fallback)
  - RED: 2–3웰 region이 confidence=1.0을 반환하지 않음(또는 `n_too_small` 상태) 실패 테스트
  - GREEN: n<4 fallback은 conf를 낮추고 `low_n`/미검증 표식. offset=0 blind 가정 명시 경고.
- **P1-R2-T2** — 상대 NTC 오라벨 가드 (C4)
  - 파일: `cluster_auto`(ntc_mask) + region 결과
  - RED: 좁은 dynamic-range 마커에서 사용자가 "샘플"로 지정한 웰이 하위20%라고 NTC 자동라벨되면 경고
  - GREEN: 자동 NTC가 사용자 "샘플" 타이핑과 겹치면 그 웰은 NTC 강제 안 함 + 경고 플래그.
- **P1-R2-T3** — No-Amp/제외 웰 타입 (C6)
  - 파일: `app/models.py::WellType`(이미 `OMIT` 존재 — 재사용 검토), 프론트 노출은 P4
  - RED: ratio 0.0/1.0 실패 웰을 No-Amp로 지정 시 클러스터에서 제외되는지
  - GREEN: `OMIT` 재사용 또는 `NO_AMP` 추가, cluster 입력서 제외(현 omitted 경로 활용).

**P1-V** — 실파일 회귀: qSwet5.3/qTotal11.1 §4 기대값 유지 + 대조 추가 시 offset 확정. 전체 suite 무회귀.

---

## P2 — region 관통 + 마커 정의 영속

### P2-R3: 마커 정의 영속 (marker_regions store)
클러스터 요청의 regions는 매번 넘어오지만 **마커 정의(웰↔마커·색·ploidy·well_type·sample_id)**는 세션에 영속돼야 재로드/재분석 가능.
- **P2-R3-T1** — 저장소 + 스키마
  - 파일: `app/db.py`(migration 4, `marker_regions` 또는 `sessions.metadata_json.marker_regions`), `app/models.py`
  - RED: 마커 정의 저장→로드 라운드트립 실패 테스트
  - GREEN: `MarkerRegion`에 `color` 추가. 세션별 저장/로드.
- **P2-R3-T2** — 엔드포인트
  - 파일: `app/routers/clustering.py`
  - `GET/POST/PUT/DELETE /api/data/{sid}/markers`. 겹침 검증 재사용(400). well-group `/groups`와 분리(first-class, A3).

### P2-R4: 마커별 배경차감 (C7)
- **P2-R4-T1** — region subset 배경 재계산 + 소규모 가드
  - 파일: `app/processing/normalize.py`, `run_clustering`
  - RED: 마커별 채널 배경이 그 마커 웰에서 계산되되, **소규모 region이 near-zero 배경(self-baseline 재발)**을 만들지 않는지 실패 테스트
  - GREEN: region wells≥임계면 재계산, 미만이면 플레이트 전역 배경 fallback + 경고. 커밋 416fd4c 방식 존중.

### P2-R5: 통계/QC/export/ASG region 관통 (A2)
- **P2-R5-T1** — 통계/QC: `app/routers/statistics.py`, `qc.py` region별 counts/통계. RED/GREEN.
- **P2-R5-T2** — export: `app/routers/export.py` (CSV/XLSX/PDF) 마커별 섹션 + 마커 컬럼. RED/GREEN.
- **P2-R5-T3** — ASG: `app/asg_result.py::build_result_snapshot` 마커 배열(schema_version 3 후보). **plate-level `unified.ploidy` 조용한 회귀 제거**(A2 위험).

**P2-V** — 재로드 후 마커 정의·결과 보존. export/통계가 마커별로 정확. plate-level 회귀 0.

---

## P3 — 사용자/팀 레이아웃 라이브러리 (A4 + L1~L4)

### P3-R6: /api/layouts
- **P3-R6-T1** — 저장소(owner+scope)
  - 파일: `app/db.py`(migration 5, `saved_layouts(id, owner, scope, name, snapshot_json, created_at, updated_at)`)
  - **L1: scope = user | team**(랩 프로토콜이므로 팀 공유 지원 + "내 것으로 복사"). owner는 `CurrentUser`(요청 바디 아님).
  - RED: 저장→목록→로드 라운드트립 + 타 사용자 스코프 격리.
- **P3-R6-T2** — CRUD 엔드포인트
  - `GET/POST /api/layouts`, `GET/PUT/DELETE /api/layouts/{id}`. snapshot `schema_version` 포함(§codex 스냅샷 형태).
- **P3-R6-T3** — 적용 안전 (L2/L3/L4)
  - **L2**: 다른 파일 적용 시 ploidy 무단 승계 금지 → ploidy 재확인 요구 응답.
  - **L3**: "이전 실행" 매칭은 크기만이 아니라 마커명/웰점유 패턴 → 후보 반환, blind apply 금지.
  - **L4**: 적용 시 sample_id/well_type carryover 정책(리셋 여부) 명시.
- **P3-R6-T4** — CSV/JSON import/export
  - CSV(웰,마커,ploidy,타입,샘플 — QuantStudio 호환) / JSON(리치: boundaries/offset, **D7 opt-in**). import 파서 + 검증(96/384 불일치, 중복 웰, 대소문자).

**P3-V** — 팀/유저 스코프 격리. 다른 플레이트 적용 시 ploidy 재확인. CSV↔JSON 라운드트립.

---

## P4 — 프론트엔드 (React)

### P4-S1: 플레이트 설정 탭
- **P4-S1-T1** — 워크스페이스 셸: `플레이트 설정`/`분석` 2-surface 탭(마법사 아님). 파일: `frontend/src/components/analysis/*`, 라우팅/스토어.
- **P4-S1-T2** — 96/384 그리드: 웰 클릭=선택 토글(색 켜짐/꺼짐), 열/행 헤더 토글, shift-범위, **드래그 사각형**(결정문서 이탈 수정), 키보드.
- **P4-S1-T3** — 마커 관리: 0개 시작, 이름 직접 입력, **색상 팔레트 선택**, ploidy. 선택→마커→배정 흐름. 회색 미지정 웰.
- **P4-S1-T4** — 웰 타입: 샘플/NTC/Allele1·2 대조/(ploidy>2: dosage 대조)/No-Amp. C5/C6 반영.
- **P4-S1-T5** — 경고+제외 배너(미지정 웰), 한 웰=한 마커, 이름충돌 인라인 검증.
- **P4-S1-V** — 백엔드 `/markers` 연결점 검증.

### P4-S2: 분석 탭
- **P4-S2-T1** — 마커 선택기: ≤3 드롭다운/세그먼트, 4+ 좌측 카드 사이드바(상태 배지).
- **P4-S2-T2** — 마커별 산점도: `ScatterPlot.tsx` region 필터 + 마커 색.
- **P4-S2-T3** — **드래그 가능·영속 경계선**(결정문서 이탈 수정 — 현재 고정): 방사 boundary 드래그 → region별 저장, 탭 전환/재실행 간 보존.
- **P4-S2-T4** — ploidy 부각 + 기대 클러스터수 vs 관측 경고. 마커별 통계/counts/결과표.
- **P4-S2-V** — `run_clustering` regions 연결점 검증.

### P4-S3: 레이아웃 라이브러리 UI
- **P4-S3-T1** — 내/팀 레이아웃 목록, 저장/불러오기/삭제.
- **P4-S3-T2** — CSV/JSON import/export, "이전 실행 적용"(패턴 매칭 + 확인, ploidy 재확인).
- **P4-S3-V** — `/api/layouts` 연결점 검증.

---

## P5 — (후속) ASG 교차서비스 계약
- **P5-R7** — asg-saas_v2 동반: `context.markers[]` 수신, schema_version 3 마커 배열 계약. 별도 세션/조율 필요.

---

## 의존성 요약
```
P0(완료) ─▶ P1(정합성) ─▶ P2(관통+영속) ─▶ P3(레이아웃) ─▶ P4(프론트) ─▶ P5(ASG)
             │                                                  ▲
             └─ P1-R1/R2 병렬 가능              P4-S1◀P2-R3, P4-S2◀P1+P0, P4-S3◀P3-R6
```
- P1-R1(앵커)과 P1-R2(가드)는 병렬.
- P2-R3(마커영속)·P2-R4(배경)·P2-R5(관통)는 상호 독립 → 병렬.
- 프론트 각 화면은 대응 리소스 완료 후.

## 검증 게이트
각 Phase 끝 `pytest -q` 무회귀 + 실파일(`qtotal11.1, qswet5.3_repeat2.pcrd`) §4 기대값 유지. PCRD 키는 시크릿 파일에서 주입(테스트는 합성 데이터, 실검증은 로컬 키).
