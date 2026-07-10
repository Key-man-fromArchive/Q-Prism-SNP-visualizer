# 조사 연구: 멀티-마커 판정 — 마커→웰 매핑의 출처

작성일: 2026-07-10 · 상태: **조사 완료, 설계 결정 대기**
대상 파일: `/mnt/ivt-ngs-run/asg-designer-database/snpanalyze/qtotal11.1, qswet5.3_repeat2.pcrd`
선행 문서: `multi-marker-per-plate-handoff.md` (요구사항·코드 진입점·Phase A~D)

이 문서는 핸드오프 §6의 **미결정 항목**을 실데이터·코드 조사로 좁힌 결과다.
가장 큰 결정("마커→웰 매핑이 어디서 오는가")을 데이터로 확정한다.

---

## 핵심 결론 (한 줄)
**`.pcrd` 파일도 ASG launch context도 "어느 웰이 어느 마커인지"를 알려주지 않는다.** → 마커→웰 매핑은 **사용자 정의(수동 region)** 가 유일하게 확실한 출처이며, ASG `context` 확장은 향후 자동채움(옵션) 레이어다.

---

## 발견 1 — `.pcrd` 파일에 마커 분리 정보 **없음** (결정적)
복호화된 `plateSetup2` 검사 결과:
- **wellGroup는 단 1개**: `wellGroupName="All Wells"`, 96웰 전체(0–95) 포함. 마커 구분 없음.
- `wellSample` 288개(=96웰 × 3 dyeLayer). 마커 후보 필드 **전부 공백**:
  - `geneName=""` (288/288), `sampleId=""` (288/288), `conditionName=""`, `condition2Name=""`.
- 유일한 웰 구분자는 `wellSampleType`: `wcSample` 252 + `wcNTC` 36 (=12 NTC웰 × 3 dye). → **NTC는 파일에 있으나 마커 그룹은 없다.**

**함의**: 파서가 파일에서 마커를 자동 분할할 방법이 없다. 핸드오프 §6 "파일 기반 자동 매핑" = **불가**로 확정.

## 발견 2 — 데이터는 두 마커가 **실제로 다른 분포** (독립 판정 필요성 입증)
엔드포인트 read(cycle 1), 채널별 배경차감+ROX 정규화 후 `ratio = fam/(fam+allele2)` 컬럼별:

| 마커 | 컬럼 | n | ratio 범위 | median |
|---|---|---|---|---|
| **qSwet5.3** | 1–6 | 48 | 0.145 – 0.875 | 0.676 |
| **qTotal11.1** | 7–12 | 48 | 0.000 – 1.000 | 0.743 |

- Marker1: 넓은 dosage 그라디언트(여러 클러스터, 다배체 판정 대상).
- Marker2: 대부분 0.7–0.8 좁게 뭉침(단일 dosage 경향) + 극단값(0.0/1.0 = NTC/failed).
- **플레이트 전체를 1회 클러스터링하면** Marker2의 좁은 클러스터가 Marker1의 중간 dosage와 겹쳐 **오판정**. → 마커별 독립 클러스터링 필요.

## 발견 3 — ASG launch은 **단일 마커** 계약 (`context`가 확장 지점)
`app/asg_session.py::LinkedASGLaunch`: `target_type`, `target_id`(**단일**), `context: dict[str,Any]`, `scope`, `save_token`.
- `app/routers/asg.py`가 결과 저장 시 `target_type`/`target_id` 단일값 전송(asg_result schema_version 2).
- 즉 현재 계약은 **launch 1회 = target(마커) 1개** 가정. 멀티-마커는 이 가정을 깬다.
- `context` dict가 자유 확장 필드 → 향후 `context.markers = [{name, wells, ploidy}, ...]` 형태로 웰맵을 실을 수 있는 유일한 무손상 경로(asg-saas_v2 동반 변경 필요, schema_version 3 후보).

---

## 설계 결정 (권장)
마커→웰 매핑 출처를 다음 순서로 계층화:

1. **[필수·먼저] 사용자 수동 region 정의** — 기존 well-group 인프라(임의 웰 집합, CRUD, 영속, 프론트 매니저) 확장. 그룹당 `ploidy`/`boundaries`/`offset` 필드 추가. 스탠드얼론·ASG 양쪽 모두 동작, ASG 의존성 0.
2. **[나중·옵션] ASG `context.markers` 자동채움** — asg-saas_v2가 웰맵을 넘기면 region 프리필, 사용자가 조정. schema_version 3 동반.
3. **파일명/파일 휴리스틱** — **기각**. `"qtotal11.1, qswet5.3"` 파일명엔 웰 매핑이 없고, 파일 내부에도 없음(발견 1).

→ 핸드오프 §1 "마커=region=임의 웰 집합" 방향 유지. §6 "well-group 확장 vs 신설 테이블"은 **well-group 확장**으로 좁혀짐(재활용 이점 + 발견 3의 단일계약 회피).

## 남은 미결정 (구현 전 사용자 확인)
- **NTC/컨트롤 범위**: 파일이 NTC 12웰을 선언(전역). region별로 자기 NTC만 쓸지, 전역 NTC를 공유할지. (데이터상 극단값 0.0/1.0이 region별로 섞여 있어 region별 NTC 제외가 더 안전해 보임 — 검증 필요.)
- **배경차감 범위**: 현재 채널 배경 = 플레이트 전역 최소. 마커별 재계산이 더 정확할 수 있음(핸드오프 §4 주의). 실측 비교 권장.
- **혼합 ploidy UI/통계 표기** (마커마다 배수성 다를 때).
- **ASG schema_version 3** 마커 배열 계약 구체안(asg-saas_v2 동반).
