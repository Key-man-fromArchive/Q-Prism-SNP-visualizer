# P6 — 산점도 축 방향 통일 (후속)

사용자 결정(2026-10-02): "둘다 지금 화면 방향으로 하자. 물론 옵션에서 변경 가능하게 해야지."

- 기본 방향: 화면·출력 모두 x=FAM, y=VIC/HEX (`orientation=fam_x`). 이전에는 출력 그림만 x=VIC였다.
- 옵션: 산점도 컨트롤의 아이콘 버튼 "축 바꾸기"(`aria-pressed`, 설정 저장) → `allele2_x`(StepOne 방향). 점·판정 경계선·NTC 모서리·선택 영역·축 제목·hover가 함께 바뀌고, 내보내기(PDF·PPTX·PNG zip·XLSX)가 같은 방향을 쿼리 `orientation`으로 받는다(잘못된 값 400).

| 태스크 | 결과 |
|---|---|
| P6-FE | DONE — 설정·토글·축 변환·export 전달, E2E 31 신규 |
| P6-BE | DONE — 출력 기본 x=FAM, `orientation` 파싱·전달 |
| P6-C1 | DONE — 글자 라벨 버튼이 컨트롤을 한 줄 늘려 `24-responsive` result-first가 7px 넘침 → 아이콘 전용 |

## 검증 (`stepone/p6`)
| 항목 | 결과 |
|---|---|
| BE-ALL | 1201 passed, 2 subtests; ruff 34(기준선) |
| `tsc -b` / lint / build | 통과 |
| FE-ALL | 162 files / 1135 tests |
| E2E 24·26·27·29·30·31 | 36 passed |
| 실제 파일 출력 | 10종 PASS, 그림 기본 x=FAM (WT)·y=VIC (MT) |
| 화면 | ko 기본·축 바꾸기 상태 캡처(저장소 밖), 바꾼 상태 NTC 마름모 좌표 (0.125, 0.47) 확인 |
