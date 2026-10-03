# P8 — 마커 선택 가로 칩 바 (후속)

사용자 피드백(2026-10-03): "세로목록은 산포도 차트 크기를 줄이게 되는 거 같아" → 제안 승인 "네 전부 다 한방에 합시다"(칩 바 + push + 운영 배포).

- 결과 화면 왼쪽 세로 마커 목록(StepOne)과 단일 드롭다운(QuantStudio)을 모든 장비 공통의 **산점도 위 가로 칩 바**로 교체: 색 점 + 이름 + 상태(● 판정, ○ 전부 무증폭, · 분석 전), 넘치면 `더보기 ▾`, `role=tablist`·←/→·Home/End.
- 왼쪽 열 제거로 산점도 카드가 그 폭을 사용. 1440×1000 전문가 모드 실측 `#scatter-plot` bottom 998, `.detail-panel` 954.

## 검증 (`stepone/p8`)
| 항목 | 결과 |
|---|---|
| `tsc -b` / lint / build | 통과 |
| FE-ALL | 178 files / 1200 tests |
| ROOT-E2E | 149 passed, 6 failed = 기존 `26-asg-compatibility` 5 + `25-secondary-flows` "390 ko dark" 1(단독 재실행 2회 모두 통과 — 전체 실행 중 간헐 실패로 기록) |
| BE | Python 변경 없음(P7 결과 1277 passed 유지) |
| 캡처 | StepOnePlus 1440·1920·전문가, CFX Duet·Opus, QuantStudio 384(저장소 밖) |
