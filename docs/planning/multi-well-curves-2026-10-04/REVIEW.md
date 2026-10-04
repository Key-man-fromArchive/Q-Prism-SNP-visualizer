# PLAN.md 멀티 AI 리뷰 기록 (2026-10-04)

대상: PLAN.md rev 1. 결과를 rev 2에 반영.

## 패널
| 위원 | 역할 | 점수 |
|---|---|---|
| Sonnet #1 | 코드 추적·사실 확인 | 78 |
| Sonnet #2 | 도메인 UX·설계 | 72 |
| Codex exec | 실행 검증 (2회, 12개 체크) | 12/12 PASS |
| Gemini | 프론트엔드 UX | 82 |
| 의장 (Opus) | 종합 | **80 / B** — `(75×2 + 90 + 82) / 4` |

## Codex 사실 확인 (전부 PASS)
1. 곡선 패널이 `selectedWell` 기준 · 2. 2개 이상 선택 시 `selectedWell=null` · 3. `/amplification`이 다중 웰 쿼리 지원 · 4. 안내문 키를 테스트가 참조 · 5. `manual_type`/`auto_cluster` 타입 존재 · 6. `selectedWell` 비테스트 소비자 3곳 · 7. fetch effect가 `currentCycle`에 의존 · 8. 백엔드 웰별 선형 필터 · 9. `displayedCall()` 존재 · 10. PlateView가 `showManualTypes`/`showAutoCluster`로 게이트 · 11. `clickWellToSee`를 WellDetailPanel과 공유 · 12. `scattergl` 사용처 5곳.

## 합의된 변경 (rev 2 반영)
| 심각도 | 지적 | 출처 | 반영 |
|---|---|---|---|
| High | 기본 `채널` 색은 다중 웰에서 웰·콜 구분 불가 → 콜 기본, 채널은 선 모양, ≤12개 `웰` 색 | Sonnet #2, Gemini | D2 |
| High | 묶음 trace는 웰 강조 불가 → ≤24개 웰별 trace + 강조, 초과 시 묶음 | Sonnet #2, Gemini | D3 |
| High | `currentCycle` 의존으로 사이클 이동마다 재요청 | Sonnet #1 (Codex 확인) | D4, 수용 기준 5 |
| High | `selectedWells`만 읽으면 기존 테스트 깨짐 → 폴백 파생 | Sonnet #1 | D1 |
| Medium | 공유 i18n 키 변경 → 새 키 | Sonnet #1 (Codex 확인) | D6 |
| Medium | 백엔드 O(웰×포인트) → dict 그룹화 | Sonnet #1 (Codex 확인) | T0b |
| Medium | 콜 규칙에 설정 게이트 누락, 마커 겹침 시 `wellAlleleLabels` | Sonnet #1 (Codex 확인) | D5, T0 |
| Medium | AbortController, 0↔1 즉시 전환 | Sonnet #2 | D4 |
| Medium | 접근성: aria 요약, 색맹 대응 | Sonnet #2, Gemini | D6 |
| Medium | WellDetailPanel 안내 불일치 | Sonnet #1 | D6, T3 |
| Low | 성능 측정 방법 명시, 추가 테스트 케이스 | Sonnet #1, #2 | §6, §7 |

## 남은 이견
- 로그 Y축: Gemini는 v1 포함, Sonnet #2는 v2 최우선. 의장 권고는 v1 포함(비용 작음) → 사용자 결정 Q3.
