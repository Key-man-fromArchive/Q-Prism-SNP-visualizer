# P1-S0-V 정정 — 24-responsive 실패의 진짜 원인

- 작성: orchestrator, 2026-09-12 (P3 진행 중 규명)
- 대상: `evidence/P1-S0-V.md` §3 "24-responsive 실패는 회귀가 아니다"

## 무엇을 잘못 적었나

P1 게이트에서 `tests/24-responsive.spec.ts`의 20건 실패를 이렇게 설명했다:

> 원인은 오케스트레이터가 급조한 E2E 환경이 프로젝트의 정식 환경과 다르기 때문이다.
> 관리자 계정으로 로그인하면 오버플로 메뉴에 참고자료·사용자·피드백 3개가 들어가는데 스펙은 2개를 기대한다.

**"환경이 다르기 때문"이라는 결론이 틀렸다.** 관측(admin은 3개, 스펙은 2개 기대)은 정확했지만,
그 차이를 환경 탓으로 돌린 것이 오진이었다. 환경은 정상이었고 **테스트가 낡아 있었다.**

## 진짜 원인

| 시점 | 사건 |
| --- | --- |
| 2026-09-07 `bb7118e` | `24-responsive.spec.ts` 작성. 당시 overflow = `references` + `users`(adminOnly) = **2개**. 단언 `toHaveCount(2)`는 **옳았다** |
| 2026-09-07 `3923909` | 이 스펙의 마지막 수정 |
| 2026-09-11 `38fda85` | "Collect user feedback in the app instead of out of band" — `feedback` 탭을 **세 번째** adminOnly overflow로 추가. **스펙은 갱신되지 않음** |

즉 이 테스트는 **2026-09-11부터 main에서 깨져 있었다.** 피드백 기능이 들어오면서 생긴 회귀를
그 커밋이 잡지 않았고, 이번 계약이 그 위에서 시작한 것이다.

내가 P1에서 "main 상태로 빌드한 서버에서도 동일하게 실패한다"고 확인한 것은 맞다.
다만 그 사실의 의미는 "내 환경이 이상하다"가 아니라 **"main이 이미 깨져 있다"** 였다.
같은 증거에서 반대 결론을 내렸다.

## 어떻게 규명했나

```bash
git log -1 --format="%h %ad %s" --date=short -L 174,174:tests/24-responsive.spec.ts
#   bb7118e 2026-09-07 Build responsive header and viewport-safe review foundation
git show bb7118e:snp-analyzer/frontend/src/components/layout/TabNavigation.tsx | grep "overflow: true"
#   references, users  → 2개 (단언과 일치)
git log --format="%h %ad %s" --date=short -S "id: 'feedback', label: 'Feedback'" -- .../TabNavigation.tsx
#   38fda85 2026-09-11 Collect user feedback in the app instead of out of band
git log --format="%h %ad %s" --date=short -- tests/24-responsive.spec.ts | head -1
#   3923909 2026-09-07  → feedback 탭 추가 이후 갱신 없음
```

## 결과

- P3-S0-V가 이 단언을 새 IA 기준으로 고친다. 새 overflow는 `settings`·`references`·`users`·`feedback` = **4개**.
- 같은 파일 약 171행의 `getByRole('tab')).toHaveCount(10)`도 `WorkspaceTabs` 제거로 **8**이 된다.
- **내 급조 E2E 환경은 이 건에 관한 한 정상이었다.** P1-S0-V가 남긴
  "정식 환경에서 재검증 필요"라는 인계는 여전히 유효하지만, 이유는 환경 불신이 아니라
  **P3가 탭 구조를 바꾸므로 E2E 전반을 다시 돌려야 하기 때문**이다.

## 교훈 (이후 Phase에 적용)

기준선에서도 실패한다는 사실은 "회귀가 아니다"까지만 말해준다.
**"그러므로 문제가 아니다"는 별개의 주장**이며, 기준선 자체가 깨져 있을 가능성을 먼저 배제해야 한다.
P0-T0.1에서 측정한 기준선은 단위 테스트·빌드·린트뿐이었고 **E2E는 기준선에 포함되지 않았다.**
포함했다면 이 낡은 테스트를 P0에서 발견했을 것이다.
