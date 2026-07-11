// @TASK Marker (assay) CATALOG frontend -- reusable assay registry
// @SPEC docs/genotyping-scientific-validity.md; app/routers/marker_catalog.py
// @TEST e2e/marker-catalog-shot.spec.ts (screenshot-only)
//
// Top-level, session-free tab (mirrors ReferencesTab.tsx's sessionFree
// pattern) for CRUD over the current user's marker-catalog assays: a
// durable, plate-independent registry entry (name/target/chemistry) plus
// calibration/validation evidence, from which the derived `dosage_trust`
// badge (validated=green / putative=amber) is shown.
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import {
  listMarkerCatalog,
  createMarkerCatalogEntry,
  updateMarkerCatalogEntry,
  deleteMarkerCatalogEntry,
  copyMarkerCatalogEntry,
} from "@/lib/api";
import type {
  MarkerCatalogEntry,
  MarkerCatalogCreateRequest,
  MarkerValidation,
} from "@/types/api";
import { computeDosageTrust } from "@/lib/marker-catalog";
import { MARKER_PALETTE } from "@/lib/constants";

const PLOIDY_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
const VALIDATION_STATUSES: MarkerValidation["status"][] = ["none", "provisional", "validated"];

type Draft = {
  name: string;
  targetGene: string;
  snpId: string;
  allele1Base: string;
  allele2Base: string;
  chemistry: string;
  defaultPloidy: number;
  color: string;
  expectedDosageClasses: string; // free-text; parsed on save
  interpretationNotes: string;
  asgTargetId: string;
  controlsPresent: boolean;
  amplificationVerified: boolean;
  calibrationNotes: string;
  validationStatus: MarkerValidation["status"];
  groundTruthMethod: string;
  nCompared: string;
  concordance: string;
  validationNotes: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    targetGene: "",
    snpId: "",
    allele1Base: "",
    allele2Base: "",
    chemistry: "",
    defaultPloidy: 2,
    color: MARKER_PALETTE[0],
    expectedDosageClasses: "",
    interpretationNotes: "",
    asgTargetId: "",
    controlsPresent: false,
    amplificationVerified: false,
    calibrationNotes: "",
    validationStatus: "none",
    groundTruthMethod: "",
    nCompared: "0",
    concordance: "",
    validationNotes: "",
  };
}

function draftFromEntry(e: MarkerCatalogEntry): Draft {
  return {
    name: e.name,
    targetGene: e.target_gene ?? "",
    snpId: e.snp_id ?? "",
    allele1Base: e.allele1_base ?? "",
    allele2Base: e.allele2_base ?? "",
    chemistry: e.chemistry ?? "",
    defaultPloidy: e.default_ploidy,
    color: e.color ?? MARKER_PALETTE[0],
    expectedDosageClasses:
      e.expected_dosage_classes !== null && e.expected_dosage_classes !== undefined
        ? String(e.expected_dosage_classes)
        : "",
    interpretationNotes: e.interpretation_notes,
    asgTargetId: e.asg_target_id ?? "",
    controlsPresent: e.calibration.controls_present,
    amplificationVerified: e.calibration.amplification_verified,
    calibrationNotes: e.calibration.notes,
    validationStatus: e.validation.status,
    groundTruthMethod: e.validation.ground_truth_method ?? "",
    nCompared: String(e.validation.n_compared),
    concordance: e.validation.concordance !== null ? String(e.validation.concordance) : "",
    validationNotes: e.validation.notes,
  };
}

/** Builds the create/update request body, preserving the source entry's
 * fields the form doesn't expose (defined_ratio_points, verified_at) so
 * editing this form never silently discards them. */
function requestFromDraft(
  draft: Draft,
  base?: MarkerCatalogEntry
): MarkerCatalogCreateRequest {
  return {
    name: draft.name.trim(),
    target_gene: draft.targetGene.trim() || null,
    snp_id: draft.snpId.trim() || null,
    allele1_base: draft.allele1Base.trim() || null,
    allele2_base: draft.allele2Base.trim() || null,
    chemistry: draft.chemistry.trim() || null,
    default_ploidy: draft.defaultPloidy,
    color: draft.color,
    expected_dosage_classes: draft.expectedDosageClasses.trim()
      ? Number(draft.expectedDosageClasses)
      : null,
    interpretation_notes: draft.interpretationNotes,
    asg_target_id: draft.asgTargetId.trim() || null,
    calibration: {
      controls_present: draft.controlsPresent,
      amplification_verified: draft.amplificationVerified,
      defined_ratio_points: base?.calibration.defined_ratio_points ?? [],
      notes: draft.calibrationNotes,
      verified_at: base?.calibration.verified_at ?? null,
    },
    validation: {
      status: draft.validationStatus,
      ground_truth_method: draft.groundTruthMethod.trim() || null,
      n_compared: draft.nCompared.trim() ? Number(draft.nCompared) : 0,
      concordance: draft.concordance.trim() ? Number(draft.concordance) : null,
      notes: draft.validationNotes,
    },
  };
}

function DosageTrustBadge({ trust }: { trust: "putative" | "validated" }) {
  const { t } = useI18n();
  const isValidated = trust === "validated";
  return (
    <span
      data-testid="catalog-dosage-trust-badge"
      data-trust={trust}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border ${
        isValidated
          ? "bg-green-100 border-green-400 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
          : "bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300"
      }`}
    >
      {isValidated ? t.mcatDosageTrustValidated : t.mcatDosageTrustPutative}
    </span>
  );
}

export function MarkerCatalogTab() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<MarkerCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const editingEntry = useMemo(
    () => (typeof editing === "string" ? entries.find((e) => e.id === editing) ?? null : null),
    [editing, entries]
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await listMarkerCatalog();
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openNew() {
    setDraft(emptyDraft());
    setEditing("new");
  }

  function openEdit(entry: MarkerCatalogEntry) {
    setDraft(draftFromEntry(entry));
    setEditing(entry.id);
  }

  function closeForm() {
    setEditing(null);
  }

  async function handleSave() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = requestFromDraft(draft, editingEntry ?? undefined);
      if (editing === "new") {
        await createMarkerCatalogEntry(body);
      } else if (typeof editing === "string") {
        await updateMarkerCatalogEntry(editing, body);
      }
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(t.mcatSaveError(err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: MarkerCatalogEntry) {
    if (!window.confirm(t.mcatDeleteConfirm(entry.name))) return;
    setError(null);
    try {
      await deleteMarkerCatalogEntry(entry.id);
      if (editing === entry.id) setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopy(entry: MarkerCatalogEntry) {
    setError(null);
    try {
      await copyMarkerCatalogEntry(entry.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const previewTrust = computeDosageTrust(draft.validationStatus, draft.amplificationVerified);

  return (
    <div className="p-6" data-testid="marker-catalog-tab">
      <div className="panel mb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-semibold text-text">{t.mcatTitle}</h2>
            <p className="text-sm text-text-muted mt-1 max-w-xl">{t.mcatSubtitle}</p>
          </div>
          <button
            type="button"
            data-testid="catalog-add-button"
            onClick={openNew}
            className="flex-none px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-white cursor-pointer"
          >
            {t.mcatAddButton}
          </button>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-md text-sm text-danger bg-danger/10">{error}</div>
        )}
      </div>

      {editing && (
        <div className="panel mb-4" data-testid="catalog-form">
          <h3 className="text-sm font-semibold text-text mb-3">
            {editing === "new" ? t.mcatFormTitleNew : t.mcatFormTitleEdit}
          </h3>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatNameLabel}
              <input
                data-testid="catalog-name-input"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={t.mcatNamePlaceholder}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatTargetGeneLabel}
              <input
                type="text"
                value={draft.targetGene}
                onChange={(e) => setDraft((d) => ({ ...d, targetGene: e.target.value }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatSnpIdLabel}
              <input
                type="text"
                value={draft.snpId}
                onChange={(e) => setDraft((d) => ({ ...d, snpId: e.target.value }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatChemistryLabel}
              <input
                type="text"
                value={draft.chemistry}
                onChange={(e) => setDraft((d) => ({ ...d, chemistry: e.target.value }))}
                placeholder={t.mcatChemistryPlaceholder}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatAllele1Label}
              <input
                type="text"
                maxLength={8}
                value={draft.allele1Base}
                onChange={(e) => setDraft((d) => ({ ...d, allele1Base: e.target.value }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatAllele2Label}
              <input
                type="text"
                maxLength={8}
                value={draft.allele2Base}
                onChange={(e) => setDraft((d) => ({ ...d, allele2Base: e.target.value }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatPloidyLabel}
              <select
                data-testid="catalog-ploidy-select"
                value={String(draft.defaultPloidy)}
                onChange={(e) => setDraft((d) => ({ ...d, defaultPloidy: Number(e.target.value) }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              >
                {PLOIDY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t.wsMarkerPloidyUnit(p)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatExpectedDosageClassesLabel}
              <input
                type="number"
                min={1}
                value={draft.expectedDosageClasses}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, expectedDosageClasses: e.target.value }))
                }
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
              {t.mcatAsgTargetIdLabel}
              <input
                type="text"
                value={draft.asgTargetId}
                onChange={(e) => setDraft((d) => ({ ...d, asgTargetId: e.target.value }))}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
              />
            </label>
          </div>

          <div className="mt-2">
            <p className="text-xs font-bold text-text-muted mb-1.5">{t.mcatColorLabel}</p>
            <div className="flex flex-wrap gap-1.5">
              {MARKER_PALETTE.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`catalog-color-swatch-${i}`}
                  aria-pressed={draft.color === c}
                  aria-label={t.mcatColorLabel}
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  style={{
                    background: c,
                    outline: draft.color === c ? "2px solid var(--color-text)" : "none",
                    outlineOffset: "1px",
                  }}
                  className="w-[22px] h-[22px] rounded-md border-2 border-transparent cursor-pointer"
                />
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted mt-3">
            {t.mcatInterpretationNotesLabel}
            <textarea
              value={draft.interpretationNotes}
              onChange={(e) => setDraft((d) => ({ ...d, interpretationNotes: e.target.value }))}
              rows={2}
              className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal resize-y"
            />
          </label>

          {/* Calibration evidence */}
          <div className="mt-4 pt-3 border-t border-border">
            <h4 className="text-xs font-bold text-text-muted mb-2">{t.mcatCalibrationTitle}</h4>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  data-testid="catalog-controls-present-checkbox"
                  type="checkbox"
                  checked={draft.controlsPresent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, controlsPresent: e.target.checked }))
                  }
                  className="accent-primary"
                />
                {t.mcatControlsPresentLabel}
              </label>
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  data-testid="catalog-amplification-verified-checkbox"
                  type="checkbox"
                  checked={draft.amplificationVerified}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, amplificationVerified: e.target.checked }))
                  }
                  className="accent-primary"
                />
                {t.mcatAmplificationVerifiedLabel}
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted mt-2">
              {t.mcatCalibrationNotesLabel}
              <textarea
                value={draft.calibrationNotes}
                onChange={(e) => setDraft((d) => ({ ...d, calibrationNotes: e.target.value }))}
                rows={2}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal resize-y"
              />
            </label>
          </div>

          {/* Ground-truth validation */}
          <div className="mt-4 pt-3 border-t border-border">
            <h4 className="text-xs font-bold text-text-muted mb-2">{t.mcatValidationTitle}</h4>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
                {t.mcatValidationStatusLabel}
                <select
                  data-testid="catalog-validation-status-select"
                  value={draft.validationStatus}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      validationStatus: e.target.value as MarkerValidation["status"],
                    }))
                  }
                  className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
                >
                  {VALIDATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s === "none"
                        ? t.mcatValidationStatusNone
                        : s === "provisional"
                          ? t.mcatValidationStatusProvisional
                          : t.mcatValidationStatusValidated}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
                {t.mcatGroundTruthMethodLabel}
                <input
                  type="text"
                  value={draft.groundTruthMethod}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, groundTruthMethod: e.target.value }))
                  }
                  placeholder={t.mcatGroundTruthMethodPlaceholder}
                  className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
                {t.mcatNComparedLabel}
                <input
                  type="number"
                  min={0}
                  value={draft.nCompared}
                  onChange={(e) => setDraft((d) => ({ ...d, nCompared: e.target.value }))}
                  className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
                {t.mcatConcordanceLabel}
                <input
                  data-testid="catalog-concordance-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.concordance}
                  onChange={(e) => setDraft((d) => ({ ...d, concordance: e.target.value }))}
                  className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted mt-2">
              {t.mcatValidationNotesLabel}
              <textarea
                value={draft.validationNotes}
                onChange={(e) => setDraft((d) => ({ ...d, validationNotes: e.target.value }))}
                rows={2}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text font-normal resize-y"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs font-semibold text-text-muted">{t.mcatDosageTrustLabel}:</span>
            <DosageTrustBadge trust={previewTrust} />
          </div>

          <div className="flex gap-2 mt-4">
            <button
              type="button"
              data-testid="catalog-form-save"
              disabled={saving || !draft.name.trim()}
              onClick={handleSave}
              className="px-4 py-1.5 rounded-md text-sm font-semibold bg-primary text-white disabled:opacity-40 cursor-pointer"
            >
              {t.save}
            </button>
            <button
              type="button"
              data-testid="catalog-form-cancel"
              onClick={closeForm}
              className="px-4 py-1.5 rounded-md text-sm font-medium bg-bg text-text-muted cursor-pointer"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        {loading ? (
          <p className="text-sm text-text-muted py-6 text-center">{t.loading}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">{t.mcatEmpty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                data-testid="catalog-entry-row"
                className="flex items-center gap-3 border border-border bg-bg rounded-md p-3"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm flex-none"
                  style={{ background: entry.color ?? MARKER_PALETTE[0] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-text truncate">{entry.name}</span>
                    <span className="text-xs font-bold text-primary bg-surface rounded px-1.5 py-0.5">
                      {t.wsMarkerPloidyUnit(entry.default_ploidy)}
                    </span>
                    <DosageTrustBadge trust={entry.dosage_trust} />
                  </div>
                  <div className="mt-1 text-xs text-text-muted truncate">
                    {[entry.target_gene, entry.snp_id, entry.chemistry].filter(Boolean).join(" · ") ||
                      "—"}
                  </div>
                </div>
                <div className="flex-none flex gap-2">
                  <button
                    type="button"
                    data-testid="catalog-edit-button"
                    onClick={() => openEdit(entry)}
                    className="text-primary hover:text-primary/80 text-xs font-medium cursor-pointer"
                  >
                    {t.mcatEditButton}
                  </button>
                  <button
                    type="button"
                    data-testid="catalog-copy-button"
                    onClick={() => handleCopy(entry)}
                    className="text-text-muted hover:text-text text-xs font-medium cursor-pointer"
                  >
                    {t.mcatCopyButton}
                  </button>
                  <button
                    type="button"
                    data-testid="catalog-delete-button"
                    onClick={() => handleDelete(entry)}
                    className="text-danger hover:text-danger/80 text-xs font-medium cursor-pointer"
                  >
                    {t.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
