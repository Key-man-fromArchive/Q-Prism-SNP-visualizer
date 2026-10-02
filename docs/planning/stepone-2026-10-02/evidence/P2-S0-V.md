# P2-S0-V — 출력 게이트

| 태스크 | 커밋 | 턴 / 비용 |
|---|---|---|
| P2-E1 | fee986b | 49 / $0.83 |
| P2-E2 | aaacf63 | 52 / $0.76 |
| P2-F | 523c086 | 51 / $1.10 |
| P2-G | 324c6fc | 52 / $0.87 |
| P2-H1 | 34f7fee | 102 / $1.36 |
| P2-H2 | 7296326 | 80 / $0.90 |
| P2-C3 | 6484fab | 16 / $0.19 |
| P2-C4 | e879172 | 21 / $0.17 |
| P2-C2 | 443541e | PARTIAL(제목·파일명 완료, 웰 라벨 겹침은 의도적으로 생략) |
| P2-C1 | 3b70072 | PARTIAL(검증 규칙만, 연결은 P2-C3) |

레인 병합 순서 E → F → G → H, 이어서 게이트 보정 C1 → C2 → C4 → C3. 병합 전 소유표 대조: E/F/G 범위 안. H 레인은 Write Scope에 없던 **새 파일 3개**(`AlleleNames.aux.test.tsx`, `AlleleNames.tables.test.tsx`, `call-text.ts`)를 만들었다 — 다른 레인과 겹치지 않는 신규 파일이라 허용. P2-C2는 제목 통일을 위해 `snapshot_pptx.py`도 수정(P2-F 종료 후, 충돌 없음) — 허용.
P2-C3 1회차는 전체 테스트를 백그라운드로 돌린 뒤 커밋 없이 종료 → 같은 worktree에서 이어서 재시도(예산 1.5배) → DONE.

## 검증 (전 보정 병합 후)

| 항목 | 결과 |
|---|---|
| BE-ALL (`QPRISM_STEPONE_EDS` 설정) | 1173 passed, 2 subtests (P1 게이트 1069 → +104) |
| ruff | 변경 .py 통과, 전체 34건(기준선 동일) |
| FE-ALL | 150 files / 1072 tests |
| tsc / lint / build | 통과 |
| 레인 병합 직후 | E 23, F 26, G 19 passed |
| DEP-AUDIT | 신규 의존성 발견 없음. 기존 PyJWT 2.13.0 13건 그대로(SEC-PYJWT-1) |

## 실제 파일 출력 검사 (오케스트레이터, 저장소 밖)

업로드 → 6마커 영역으로 사이클 7(Post-read) 분석 → 출력 10종 PASS:
- PDF 전체/QPrism1, PPTX 전체(10장: 표지·마커 6·플레이트·결과표 2)/QPrism1(4장), PNG zip 전체(6개, 마커 이름 파일)/QPrism1(1개), CSV·XLSX(`Allele Call`·`Cycle Label` 열), 잘못된 `marker_ids` 400.
- 단일 마커 파일명: `snp_report_QPrism1_cycle7.pdf/.pptx`, `snp_scatter_png_QPrism1_cycle7.zip` (RFC 5987 `filename*`).
- QPrism1 판정: `Allele 1 Homo → WT/WT` 8웰, `Allele 2 Homo → MT/MT` 8웰. 그림 제목 `QPrism1 · Post-read`, 축 `FAM · WT (ROX-normalized)`/`VIC · MT`, 범례 `WT/WT (n=8)` 그림 밖, 웰 라벨, 한글 폰트 정상(눈으로 확인).

## 리뷰
- 코드 리뷰 GATE: PASS. Medium: 출력별 그림 옵션 중복(→ C3 통합, 네 출력 같은 옵션 테스트), 알 수 없는 marker id는 캡처 뒤 400(결정적, 허용), PPTX 라우트 이벤트 루프 차단(→ C3), PPTX `Allele Call` 칸 넘침(→ C3), 프론트 연결 미완: `AnalysisTab`의 `WellTypePopup`(마커 없는 단일 흐름이라 이름 없음 — 해당 없음), `ProtocolTab`의 `FluorescenceDataCard`, **Batch 이름 열은 프로젝트 요약 API가 `allele_labels`를 내려주지 않아 비활성 → 후속 과제(FOLLOWUP-BATCH-LABELS)**. Low: 판정 수 표 10개 상한 표시·라벨 길이 통일(→ C3), 미지정 웰 aria(→ C4).
- 보안 리뷰 SECURITY GATE: PASS. Medium: PPTX 라우트 비동기 차단(→ C3). Low: PPTX 총량 상한 없음, zip 상한 검사 시점, Windows 예약 파일명.

## 남은 일 (이 계약 안)
- 웰 라벨 겹침 비켜 놓기 생략(P2-C2, 회귀 위험) — 기록만.
- 마커 E2E·출력 E2E는 P3-J/P3-S0-V.

## AC
- [x] 기존 출력 테스트 회귀 0 · [x] 세 출력 그림이 같은 렌더 경로(C3 이후 네 출력 공통 옵션) · [x] 미해결 중요 리뷰 0
