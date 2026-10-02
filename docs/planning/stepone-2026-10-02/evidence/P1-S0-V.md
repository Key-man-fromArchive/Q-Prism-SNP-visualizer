# P1-S0-V — 핵심 게이트

## 레인 태스크

| 태스크 | 커밋 | 턴 / 비용 |
|---|---|---|
| P1-A1 | 7b94567 | 34 / $0.57 |
| P1-A2 | d4fb85a | 61 / $1.28 |
| P1-A3 | a548237 | 23 / $0.20 |
| P1-B1 | bcae8ee | 52 / $0.66 |
| P1-B2 | 2d0cd4e | 47 / $0.57 |
| P1-C1 | 33d2cf7 | 44 / $0.61 |
| P1-C2 | 561d831 | 25 / $0.35 |
| P1-C3 | 3179890 | 25 / $0.31 |
| P1-C4 | 87466d4 | 34 / $0.32 |
| P1-D1 | 6da43db | 86 / $1.07 |
| P1-D2 | 7766253 | 75 / $1.13 |
| P1-D3 | b47137d | 33 / $0.29 |

레인 병합 순서 A → B → C → D, 이어서 게이트 보정 P1-A3/C4/D3. 병합 전 소유표 대조: 4개 레인 모두 Write Scope 밖 파일 0, 레인 간 겹침 0. locale 키 집합 변화 없음(값만 변경).

## 검증 (보정 병합 후)

| 항목 | 결과 |
|---|---|
| BE-ALL (`QPRISM_STEPONE_EDS` 설정) | 1069 passed, 0 skipped, 2 subtests (P0 게이트 933 → +136) |
| ruff (변경 .py) | All checks passed. 전체 34건은 기준선과 같음 |
| FE-ALL | 147 files / 1058 tests |
| tsc / lint / build | 통과 |
| 레인별 병합 직후 테스트 | A 56, B 30, C 41 passed |

## 실서버 스모크 (오케스트레이터, 실제 고객 파일, 저장소 밖 임시 DB)

13/13 PASS — 로그인, 업로드(StepOnePlus (raw), 96웰·7사이클), 업로드 `suggested_cycle` 2, `read_labels[2]` = Amplification · PCR 36 · 40.0°C, `has_amplification_curve` false, 세션 정보 `suggested_cycle` 2, 마커 6개, QPrism1 `{fam: WT, allele2: MT}`, 기본값 마커 이름 없음, 사이클 2 scatter, 대립유전자 이름 수정 200.

## 리뷰

- 코드 리뷰 GATE: PASS. Medium: 축 라벨 한국어 하드코딩(→ P1-C4로 보정), 표시 함수가 아직 출력 경로에 연결 안 됨(P2 몫, 출력 수준 단언 필요). Low: nan MSE 판별(P1-A3), 캡션 공백·스타일·같은 이름 사전 검사(P1-D3), 중복 마커 이름(P1-A3). 새 함수 일부 radon C 등급(경계).
- 보안 리뷰 SECURITY GATE: PASS. Medium: 이름의 `$`가 matplotlib mathtext로 해석돼 출력 실패(→ P1-C4로 보정, 회귀 테스트 추가). 다운로드 헤더는 P2에서 반드시 `content_disposition()` 사용. Low: `defusedxml` 미사용(ElementTree는 외부 엔티티 미해석, ZIP 상한으로 제한), 프로토콜 숫자 범위, Plotly hover 문자열(HTML 부분집합 정화로 XSS 없음).

## AC
- [x] LANE-MERGE 통과 · [x] 스모크 통과 · [ ] 마커 E2E(17, 21, 28) — Playwright 실행은 P3-S0-V 통합 게이트에서 전체 E2E로 수행(이 게이트에서는 단위·API·실서버 스모크로 대신함) · [x] 미해결 중요 리뷰 0
