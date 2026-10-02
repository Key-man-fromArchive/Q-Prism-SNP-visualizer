# P7 — 무증폭 판정 · 장비명 · 결과 화면 정리 (후속)

사용자 요청(2026-10-02): 범례가 산점도를 줄임, '지노타입 판정'을 플레이트 뷰 쪽으로, 5–12열 무증폭 고려, 화면 캡처로 레이아웃 정리, 장비명 노출 → "쓰레쉬홀드도 잡아주고 설정도 할 수 있게. 진행합시다. ui리뷰는 코덱스랑 같이 기획하고 캡쳐하면서 진행. 쓸모없는 정보·텍스트가 너무 많다. Expert mode 활용" → "QuantStudio, CFX Duet, CFX Opus 등도 다 출력돼야죠."

## 무증폭 판정 (P7-A)
- 웰·채널별 ΔRn = 분석 사이클(dye/ROX) − Pre-read(dye/ROX). 채널 자동 기준 = 비율(기본 1/3) × 플레이트 전체 그 채널 양의 ΔRn 90퍼센타일. 두 채널 모두 기준 미만 → 무증폭: 군집화 제외, 판정 정규값 `Undetermined`(ASG 계약 유지), 화면·출력 "증폭 없음/No amplification".
- 실제 파일(Post-read): 무증폭 64웰 = SNP Assay 2–5(5–12열) 전체, QPrism1·SNP Assay 1 무증폭 0, QPrism1 판정 불변(동형 8·동형 8). 기준 FAM ≥ 0.96 · VIC ≥ 0.10. Amplification 첫 읽기에서도 같은 64웰(FAM ≥ 0.53 · VIC ≥ 0.07).
- 설정: 기본 화면은 기준 요약 한 줄, 전문가 모드에서 `조정` → 켜기/끄기·비율·채널별 수동 기준값, 세션별 저장.

## 장비명 (P7-B, P7-B2) — 실제 파일 확인
| 파일 | 표시 | 소프트웨어 |
|---|---|---|
| StepOnePlus .eds | Applied Biosystems StepOnePlus | StepOne™ Software v2.3 |
| CFX Duet .pcrd | Bio-Rad CFX Duet | CFX Maestro 5.3.022.1030 |
| CFX Opus .pcrd | Bio-Rad CFX Opus 96 | CFX Maestro 5.3.022.1030 |
| QuantStudio 384 .eds | Applied Biosystems QuantStudio 3/5 | QuantStudio 3 and 5 Software 1.5.3 |
| CFX xlsx/xml 내보내기 | Bio-Rad CFX (모델 기록 없음, 추측 안 함) | Run Information의 CFX Maestro 버전 |
| QuantStudio/StepOne .xls | 파일의 Instrument Type 값 | 기록 없음 |
변경 전에는 CFX Duet을 "CFX Opus"로, QuantStudio .xls를 "QuantStudio 3"으로 하드코딩 표시했다.

## 결과 화면 (P7-F1·F2·F3, C1–C6) — Codex 리뷰 2회 + 캡처 3회
- 전문가 모드(헤더 토글, 저장, 기본 꺼짐): 임계값 편집·정규화·축 모드·그룹·선택 웰만·증폭곡선·추천 사이클·QC 새로고침·고급 설정·기술 안내·전체 격자·증폭 곡선 오버레이·클래스 배지는 전문가 모드에서만.
- 오른쪽 열: 지노타입 판정 → 플레이트 뷰 → 증폭 기준 → 웰 상세. 범례는 플롯 위 한 줄(도구막대는 hover 시만). 헤더 한 줄 + 사용자 메뉴, 상태는 한 개 요약(`검토 필요 · NTC 없음`).
- 산점도 높이는 실제 남은 세로 공간으로(3:4 유지): 1440×1000 전문가 모드 실측 `#scatter-plot` bottom 1055 → 998.
- 버그 수정: 전체 격자 96웰에 선택 마커 이름이 붙던 문제, 편집 패널이 재분석 때 접히던 문제, 무증폭 설정이 새로고침 후 초기화되던 문제.
- Codex 1차(30항목)·2차(15항목, 판정 "크게 개선, 마지막 손질 필요") 지적을 반영. 사이클 구간 버튼은 사용자가 요구한 읽기별 보기 때문에 기본 화면에 유지(한 줄 압축).

## 검증 (`stepone/p7` 7a69804)
| 항목 | 결과 |
|---|---|
| BE-ALL | 1277 passed, 3 skipped(실제 샘플 경로 환경변수 없는 실행 — 오케스트레이터가 별도 실행해 통과), 2 subtests |
| ruff | 34(기준선) |
| `tsc -b` / lint / build | 통과 |
| FE-ALL | 177 files / 1195 tests |
| ROOT-E2E | 150 passed, 5 failed = 기존 `26-asg-compatibility`(기준선 55a7452에서도 실패) |
| 캡처 | before 9장, after 9장 ×3회(저장소 밖) |
