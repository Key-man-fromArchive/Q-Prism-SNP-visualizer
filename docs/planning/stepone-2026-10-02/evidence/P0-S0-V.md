# P0-S0-V — 준비 게이트

## 레인과 병합 (stepone/p0)

| 태스크 | 레인 커밋 | 결과 | 턴 / 비용 |
|---|---|---|---|
| P0-T0.2 합성 .eds 생성기 | 516f3fc | DONE, 자체 테스트 19 | 41 / $0.97 |
| P0-T0.3a 백엔드 계약 | 8fef65d | PARTIAL → P0-C1로 보정 | 66 / $0.86 |
| P0-C1 스키마 버전 단언 보정 | f942bbf | DONE (BE 888 passed) | — |
| P0-T0.3b 프론트 계약 | fa00bb2 | DONE | 51 / $0.48 |
| P0-T0.3c i18n 키 | b0e96de | DONE | 23 / $0.46 |
| P0-C2 리뷰 보정(대립유전자 이름 검증·필터 범위·마커 id 길이) | caa9554 | DONE | — |

- 계약 보정 2건(P0-C1, P0-C2) 발생. 둘 다 같은 contract 레인 브랜치에서 처리, 다른 레인은 영향 없음.
- 소유표 대조: 모든 레인 변경 파일 ⊆ 해당 Write Scope. 공유 파일 변경은 P0-T0.3a/b/c·P0-C1/C2에만 있다.
- 규칙 위반 1건 기록: P0-T0.2 레인이 Write Scope 안 파일 수정에 python heredoc을 1회 사용(결과 영향 없음).

## 검증 (병합 후)

| 항목 | 결과 |
|---|---|
| venv 재설치 | `python-pptx 1.0.2`, `XlsxWriter`, `lxml`, `Pillow` import 성공 |
| BE-ALL | 933 passed, 1 skipped(고객 파일 환경변수 필요 시험), 2 subtests (기준선 855 + 신규 78) |
| ruff (변경 .py) | All checks passed |
| FE-ALL | 140 files / 1022 tests (기준선 139 / 1016 + 계약 테스트) |
| tsc / lint / build | 통과 / 통과 / 통과 |
| DEP-AUDIT | 신규 의존성 5종 발견 없음. **기존 기준선 `PyJWT==2.13.0`에 13건(PYSEC-2026-4140~4152, 수정 2.14.0/2.15.0)** — 계약 범위 밖, 사용자에게 별도 보고 |

## 코드 리뷰 (sonnet, 읽기 전용)

GATE: PASS (Critical·High 0). Medium 3건 중 2건(필터 범위, 이름 검증)은 P0-C2로 즉시 보정. 나머지:
- 프론트 `markerIds`를 아직 받지 않는 PDF/CSV/XLSX 라우트: P2-E1/E2에서 연결(D-10), PPTX·zip 라우트는 P2-F/G.
- Low: 마커 없는 세션의 마커 선택은 400 → P3-I UI에서 숨김. `test_new_routers_are_registered_and_empty`는 P2-F/G가 갱신. 레이아웃 스냅샷에 `allele_labels: None` 키 추가(적용 경로 호환 확인).

## AC
- [x] LANE-MERGE 통과 · [x] 공유 파일 변경이 P0-T0.3a/b/c(+보정)에만 있음 · [x] venv에서 `import pptx, xlsxwriter, lxml` 성공 · [x] DEP-AUDIT 결과 기록
