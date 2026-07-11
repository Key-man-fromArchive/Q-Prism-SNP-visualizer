// @TASK References Tab Component
// @SPEC Scientific / literature basis for the polyploid genotyping method
// @TEST none yet (E2E to be added; data-testid="references-tab" reserved for it)

type ReferenceEntry = {
  citation: string;
  doi: string;
  groundsKo: string;
  groundsEn: string;
};

type ReferenceGroup = {
  id: string;
  titleKo: string;
  titleEn: string;
  descKo: string;
  descEn: string;
  entries: ReferenceEntry[];
};

const GROUPS: ReferenceGroup[] = [
  {
    id: 'ratio-mixture',
    titleKo: 'A. 비율-혼합모델 기반 Dosage 유전형 판별 (방법의 토대)',
    titleEn: 'A. Ratio-mixture dosage genotyping (foundational methods)',
    descKo: '이 도구가 채택한 이대립(bi-allelic) 마커의 대립유전자 비율(allelic ratio) 기반 혼합모델 계보의 핵심 문헌입니다.',
    descEn: 'The core literature behind the allelic-ratio mixture-model lineage this tool builds on for bi-allelic marker dosage calling.',
    entries: [
      {
        citation:
          'Voorrips RE, Gort G, Vosman B. "Genotype calling in tetraploid species from bi-allelic marker data using mixture models." BMC Bioinformatics 12:172 (2011).',
        doi: '10.1186/1471-2105-12-172',
        groundsKo:
          '대립유전자 비율 Y/(X+Y)에 대한 혼합모델, arcsine-sqrt 분산안정화, 0..P dosage class 개념(fitTetra)의 토대.',
        groundsEn:
          'Mixture model on the allele-ratio Y/(X+Y), arcsine-sqrt variance stabilization, dosage classes 0..P (fitTetra).',
      },
      {
        citation:
          'Zych K, Gort G, Maliepaard CA, Jansen RC, Voorrips RE. "FitTetra 2.0 – improved genotype calling for tetraploids with multiple population and parental data support." BMC Bioinformatics 20:148 (2019).',
        doi: '10.1186/s12859-019-2703-y',
        groundsKo:
          '임의 배수성(any-ploidy)으로의 일반화, 집단/분리비 제약 혼합비율, 마커 품질 게이트 개념(fitTetra 2.0)의 토대.',
        groundsEn:
          'Any-ploidy generalization, population/segregation-constrained mixing proportions, marker quality gates.',
      },
      {
        citation:
          'Serang O, Mollinari M, Garcia AAF. "Efficient exact maximum a posteriori computation for Bayesian SNP genotyping in polyploids." PLoS ONE 7(2):e30906 (2012).',
        doi: '10.1371/journal.pone.0030906',
        groundsKo:
          '베이지안 폴리플로이드 dosage 유전형 판별 및 배수성 추정(SuperMASSA) 개념의 토대.',
        groundsEn: 'Bayesian polyploid dosage genotyping / ploidy inference (SuperMASSA).',
      },
      {
        citation:
          'Gerard D, Ferrão LFV, Garcia AAF, Stephens M. "Genotyping Polyploids from Messy Sequencing Data." Genetics 210(3):789–807 (2018).',
        doi: '10.1534/genetics.118.301468',
        groundsKo:
          '대립유전자 편향(allele bias)과 과분산(overdispersion)을 명시적으로 모델링하는 접근(updog)의 토대.',
        groundsEn: 'Explicit modeling of allele bias & overdispersion (updog).',
      },
    ],
  },
  {
    id: 'intensity-clustering',
    titleKo: 'B. 형광 강도 → Dosage 클러스터링 및 보정',
    titleEn: 'B. Intensity → dosage clustering & calibration',
    descKo: '형광 강도 신호를 dosage class로 클러스터링하고 알려진 분리비로 보정하는 접근의 문헌입니다.',
    descEn: 'Literature on clustering fluorescence-intensity signals into dosage classes, calibrated against known segregation.',
    entries: [
      {
        citation:
          'Schmitz Carley CA, Coombs JJ, Douches DS, et al. "Automated tetraploid genotype calling by hierarchical clustering." Theoretical and Applied Genetics 130:663–675 (2017). (PMID 28070610)',
        doi: '10.1007/s00122-016-2845-5',
        groundsKo:
          '형광 강도를 dosage class로 계층적 클러스터링하고 F1 분리비로 보정하는 접근(ClusterCall)의 토대.',
        groundsEn:
          'Clustering fluorescence intensities into dosage classes, calibrated by F1 segregation (ClusterCall).',
      },
    ],
  },
  {
    id: 'endpoint-precedent',
    titleKo: 'C. 가장 가까운 선례 — 엔드포인트/KASP 폴리플로이드 Dosage',
    titleEn: 'C. Closest precedent — endpoint/KASP polyploid dosage',
    descKo: '이 도구와 동일하게 엔드포인트 경쟁적 PCR 형광비로부터 폴리플로이드 dosage를 판별한 가장 가까운 선행 연구입니다.',
    descEn: 'The closest prior work assigning polyploid dosage from endpoint competitive-PCR fluorescence ratios, as this tool does.',
    entries: [
      {
        citation:
          'Cuenca J, Aleza P, Navarro L, Ollitrault P. "Assignment of SNP allelic configuration in polyploids using competitive allele-specific PCR: application to citrus triploid progeny." Annals of Botany 111(4):731–742 (2013).',
        doi: '10.1093/aob/mct032',
        groundsKo:
          '엔드포인트 경쟁적 PCR 형광비 y/(x+y)로부터 폴리플로이드 대립유전자 dosage를 판별하고, 기지(known) dosage 대조군으로 보정하는 접근 — 이 도구의 대립유전자 대조군 앵커링 방식과 가장 가까운 선례.',
        groundsEn:
          'Polyploid allele dosage from endpoint competitive-PCR fluorescence ratio y/(x+y), with known-dosage calibration controls (this tool’s allele-control anchoring).',
      },
    ],
  },
];

function ReferenceCard({ entry, index }: { entry: ReferenceEntry; index: number }) {
  return (
    <li className="border border-border rounded-md bg-bg p-3.5">
      <div className="flex gap-2.5">
        <span className="text-xs font-semibold text-text-muted mt-0.5 shrink-0">[{index}]</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text leading-relaxed">{entry.citation}</p>
          <a
            href={`https://doi.org/${entry.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 text-xs text-primary hover:text-primary-hover hover:underline"
          >
            doi:{entry.doi}
          </a>
          <div className="mt-2 pt-2 border-t border-border/60">
            <p className="text-xs text-text">
              <span className="font-semibold text-text-muted">이 도구에서의 근거: </span>
              {entry.groundsKo}
            </p>
            <p className="text-xs text-text-muted italic mt-0.5">{entry.groundsEn}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Flat running index (1-based) for each entry across all groups, in display order. */
const ENTRY_INDEX: ReadonlyMap<string, number> = new Map(
  GROUPS.flatMap((group) => group.entries).map((entry, i) => [entry.doi, i + 1])
);

export function ReferencesTab() {
  return (
    <div style={{ padding: '16px 24px', maxWidth: '860px' }} data-testid="references-tab">
      <div className="panel" style={{ borderRadius: '8px', padding: '20px' }}>
        <h3 className="text-lg font-semibold text-text mb-1">참고문헌 / References</h3>
        <p className="text-sm text-text-muted mb-1">
          이 도구의 폴리플로이드(다배체) 유전형 판별 방법은 이대립(bi-allelic) 마커 dosage 판별을 위한
          혼합모델/대립유전자 비율 계보를 따릅니다.
        </p>
        <p className="text-xs text-text-muted mb-5 italic">
          This tool&apos;s polyploid genotyping follows the established mixture-model / allelic-ratio
          lineage for bi-allelic marker dosage calling.
        </p>

        {/* Scope & validation note */}
        <div className="mb-6 rounded-md border border-l-4 border-primary bg-primary/5 p-4">
          <h4 className="text-sm font-semibold text-text mb-1.5">적용 범위 / Validation status</h4>
          <p className="text-sm text-text leading-relaxed">
            이 도구는 상대 클러스터링과 이배체 대립판별(AA/AB/BB)에 견고합니다. 절대 배수성 dosage(예:
            AAAAAB)는 assay별 상대증폭 안정성 검증(정의비율 대조/보정) 없이는 잠정값이며(Cuenca et al.
            2013), 독립 검증(sequencing/KASP 패널)으로 확인이 필요합니다.
          </p>
          <p className="text-xs text-text-muted italic mt-2 leading-relaxed">
            This tool is robust for relative clustering and diploid allele calling (AA/AB/BB). Absolute
            polyploid dosage calls (e.g., AAAAAB) remain provisional without assay-specific validation of
            relative amplification stability (defined-ratio controls/calibration) (Cuenca et al. 2013),
            and require independent confirmation (sequencing/KASP panels).
          </p>
        </div>

        {/* Reference groups */}
        <div className="flex flex-col gap-6">
          {GROUPS.map((group) => (
            <section key={group.id}>
              <h4 className="text-sm font-semibold text-text mb-0.5">{group.titleKo}</h4>
              <p className="text-xs text-text-muted mb-0.5">{group.titleEn}</p>
              <p className="text-xs text-text-muted mb-2.5">{group.descKo}</p>
              <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
                {group.entries.map((entry) => (
                  <ReferenceCard key={entry.doi} entry={entry} index={ENTRY_INDEX.get(entry.doi) ?? 0} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
