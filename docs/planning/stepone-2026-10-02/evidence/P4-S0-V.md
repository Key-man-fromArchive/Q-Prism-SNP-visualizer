# P4-S0-V — 실파일 인수

실제 고객 파일 `261002_QPrism_ASG-PCR.eds`(저장소 밖)를 브라우저 UI로 끝까지 사용. 서버: `stepone/p4` 코드, 백엔드 8302·Vite 8402, 임시 DB. 스크립트·산출물·스크린샷은 저장소 밖(`/tmp/claude-1000/-mnt-docker-Q-Prism-SNP-visualizer/1fb1191d-1a7c-4d72-911f-4e8500383690/scratchpad/p4/shots`)에만 둔다.

## 흐름과 결과

| 단계 | 결과 |
|---|---|
| 로그인 → 업로드 | 헤더 `StepOnePlus (raw) · 96 wells · 7 cycles` |
| 첫 화면 | `Amplification 1/5 · PCR 36 · 40°C` (사이클 2/7) |
| 마커 | 6개 자동(QPrism1, SNP Assay 1–5, 각 16웰), QPrism1 `FAM · WT / VIC · MT`, 나머지 이름 없음 |
| Post-read 분석 | 마커별 결과 6개, QPrism1 scatter 범례 `WT/WT`·`MT/MT` |
| 내보내기(대화상자) | PDF 전체 848 KB, PPTX 전체 678 KB, 보고서 PNG zip 252 KB, PPTX QPrism1만 102 KB |
| 화면 폭 | 390 / 768 / 1280 / 1920 스크린샷 |

## 인수 중 발견·보정 (P4-C1, 57daa56)

- **플레이트 범례 오표기(Medium)**: 96웰 전체 집계에 선택 마커(QPrism1)의 이름을 다른 5개 마커 판정까지 붙여 `WT/WT 16 · WT/MT 48 · MT/MT 32`로 표시 → 각 웰은 자기 마커 이름, 범례는 이름이 모두 같을 때만 이름(섞이면 정규 표기 `Hom-1 · Het · Hom-2`). 재확인 완료.
- **축 라벨 중복(Low)**: `WT (FAM) · WT` → 역할 라벨과 이름이 같으면 덧붙이지 않음(`WT (FAM)`). `MT1 (VIC) · MT`는 서로 달라 유지.

## StepOne 소프트웨어 판정과 비교 (QPrism1, Post-read)

16웰 묶음이 StepOne과 **100% 일치**: StepOne 코드 3(FAM 3.3–4.1, VIC≈−0.1) 8웰 = 앱 `WT/WT`, StepOne 코드 2(FAM 0.4–0.9, VIC≈0.4) 8웰 = 앱 `MT/MT`. StepOne 결과 파일은 숫자 코드만 담고 있어 코드 2가 "Allele 1(MT) 동형"인지 "이형"인지는 파일만으로 확정 불가 — 사용자 확인 필요.

## P4 검증 (`stepone/p4`)

| 항목 | 결과 |
|---|---|
| `tsc -b` / lint / build | 통과 |
| FE-ALL | 152 files / 1092 tests |
| E2E 17·21·24·28·29·30 | 36 passed |
| P4 인수 스크립트 | 1 passed |

P3-S0-V의 전체 E2E(141 passed / 기존 5 failed)·BE-ALL(1173) 이후 P4-C1은 프론트 분석 화면 5개 파일만 바꿨다.

## AC
- [x] 기획서 §5 실파일 항목 · [x] BE-ALL·FE-ALL·ROOT-E2E 통과(기존 실패 분리) · [x] 미해결 중요 리뷰 0 · [ ] 사용자 산출물 확인 — 최종 보고에서 요청
