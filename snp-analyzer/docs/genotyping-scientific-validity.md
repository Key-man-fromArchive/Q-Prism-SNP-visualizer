# 학술 검증: 멀티마커 polyploid dosage 판정의 이론적 타당성

작성: 2026-07-11 · 방법: 문헌 조사(fitPoly/fitTetra, ClusterCall, Cuenca 2013) + 고급 3모델 도메인 리뷰(opus·fable·gpt5.6)
대상: `app/processing/clustering.py::cluster_auto`

## 결론 (세 모델 만장일치)
- **방어 가능(진짜 유효)**: r=FAM/(FAM+HEX) 축 위 **상대 클러스터링** + **이배체 대립판별(AA/AB/BB)**. 엔드포인트 대립판별 화학의 정당한 용도. 이건 계속 주장해도 됨.
- **과잉주장(학술적으로 부적절)**: **무보정 단일 플레이트에서 절대 polyploid dosage(0..P, "AAAAAB")**. fable 표현: "등가증폭 가정(r=d/P)을 데이터에서 도로 뽑아내 genotype 문자열로 재명명한 것." Cuenca 2013(우리 최근접 선례)이 명시적으로 "상대 증폭 안정성 사전검증 없이는 germplasm 절대 dosage 부적용"이라 경고.

## 하중을 지는 결함 (3모델 공통)
1. **fitPoly의 HWE/분리비 prior 상실** — fitPoly 신뢰도의 핵심. mixing proportion을 HWE(패널)/F1 분리비(가계)로 제약해 겹친 dosage peak를 분해함. 우리는 free weights. 우리의 monotonic d/P snap은 **제약이 아니라 순환적 사후 재명명**(측정하려는 것을 가정함).
2. **BIC over K=1..P+1 @ n≈16 = 비식별**. 6배체 K=7 → 13 파라미터를 16점으로 적합(성분당 ~2웰) = 교과서적 과적합. BIC 정합성은 점근(n→∞)이고 mixture는 약식별. **물리적 해상 한계 ~3-4 클래스**(6배체 이상적 간격 0.167 vs 엔드포인트 노이즈). qSwet가 3클래스만 나온 게 이 증거이자 위장.
3. **등가증폭(r≈d/P) 미검증 + 극단-앵커의 한계**. 극단 앵커(dosage 0/P)는 **단일-템플릿 반응**을 보정하는데, 정보가 있는 중간 dosage는 **경쟁적 이중-템플릿**(다른 kinetics). 2점은 **직선만** 고정(offset/gain), 내부 **곡률/비선형(dosage 구분이 실제 일어나는 곳)은 구조적으로 못 봄**. Cuenca는 중간 정의비율 혼합(9:1,5:1)을 씀.
4. **품질 게이트 부재** — fitPoly는 near-monomorphic(peak.threshold)·저call(call.threshold 0.6) 마커를 **거부**. 우리는 qTotal11.1의 단일클래스를 그냥 보고.
5. **C3 소규모 신뢰도 = 거짓/유해 안심** — 과소제약 mixture의 posterior는 미보정. 16점 적합의 0.9는 확률이 아님.
6. **매직상수는 n=1 과적합** — 전부 target 에러율/측정 노이즈에 안 묶임. **5.5 SD vs 3.0 SD 두 "분리" 상수 모순**이 냄새. CALL_MIN 0.9는 공기에서 뽑은 값(fitPoly 0.6은 경험적 튜닝).
7. **정답 대비 검증 0** — 실 플레이트 1개, 직교 검증(sequencing/KASP) 없음 → **측정된 에러율이 없음**. 측정한 적 없는 correctness는 주장 불가.

## 건전한 것 (유지)
ratio 축 · arcsine-sqrt(분산안정, fitTetra와 동일) · **tied variance**(σ→0 붕괴 방지, 가장 하중 지는 좋은 선택) · 상대 NTC 개념(scale-invariant).

## 실효 개선 (correctness 효과 순위, 3모델 수렴)
**MUST (없으면 dosage 주장 신뢰 불가)**:
1. **내부 calibration 표준** — 각 d/P의 정의비율 DNA 혼합(Cuenca) 또는 알려진 분리 집단, **assay마다**. 선형성 확립·검정의 유일한 길. 최대 효과.
2. **직교 ground-truth 검증**(sequencing/KASP 패널) → 실제 에러율 측정.
3. **개체군/분리 prior 복원**(HWE/F1) 또는 유전적 실현가능성 필터.
4. **fitPoly 마커 거부 게이트**(peak/call).
5. **정보량 기반 K 상한**(클래스당 ~8-10 없으면 낮은 해상도로 우아하게 강등).

**NICE(위 이후)**: SD 휴리스틱을 penalized-likelihood + target 에러율로 대체; 식별성 인지 신뢰도(bootstrap); arcsine/tied는 이미 OK.

## UI 정직성 (3모델 수렴 — 실행 필요)
**무보정 단일 플레이트에서 절대 dosage를 확정 truth로 제시 금지.**
- 기본 출력 = 상대 클러스터 + 순위 + (이배체) AA/AB/BB 판별.
- 절대 polyploid dosage 라벨은 **calibration 대조 통과 + 검증** 뒤에만; 아니면 `offset_uncertain`/"절대 dosage 미검증"으로 표기.
- 저-n·near-monomorphic 마커 명시 플래그. hedge 쪽으로.

## 가장 불편한 진실 (fable)
"이 dosage 판정 중 단 하나도 정답 확인된 적 없고, 고배수성 n≈16에선 인쇄 중인 클래스를 원리적으로 분해할 수도 없다. 'AAAAAB'는 어떤 실험도 확인한 적 없는 거짓 정밀도다. 내부 일관성을 correctness로 착각한 것."

## 출처
fitPoly/fitTetra: cran fitPoly refman; BMC Bioinformatics 2019(FitTetra 2.0). ClusterCall: PMID 28070610. Cuenca 2013(citrus KASP polyploid dosage + calibration 대조 + 증폭안정성 caveat): PMC3605964. 관련: [[multi-marker-process-learnings]].
