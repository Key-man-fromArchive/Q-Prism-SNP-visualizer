import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, RotateCcw, UploadCloud } from "lucide-react";
import { ApiError, parseImportPreview } from "@/lib/api";
import { useI18n } from "@/hooks/use-i18n";
import type { Translations } from "@/locales/en";
import type {
  AssayModeId,
  ImportPreview,
  ImportRole,
  MappingConfig,
  NormalizationMode,
  UploadResponse,
  ValidationIssue,
  ImportParseResponse,
} from "@/types/api";

type ImportMappingWizardProps = {
  file: File;
  preview: ImportPreview;
  previewIssues: ValidationIssue[];
  previewing: boolean;
  onPreviewAgain: () => Promise<void>;
  onCancel: () => void;
  onImported: (info: UploadResponse) => void;
};

type TableStructure = "long" | "wide";

const ASSAY_MODES: Array<{ value: AssayModeId; label: string; requiredRoles: ImportRole[] }> = [
  { value: "wt_mt", label: "WT / MT", requiredRoles: ["WT", "MT1"] },
  { value: "wt_mt1_mt2", label: "WT / MT1 / MT2", requiredRoles: ["WT", "MT1", "MT2"] },
  { value: "wt_mt1_mt2_mt3", label: "WT / MT1 / MT2 / MT3", requiredRoles: ["WT", "MT1", "MT2", "MT3"] },
];

const UNIQUE_ROLES = new Set<ImportRole>(["WT", "MT1", "MT2", "MT3", "normalization"]);

export function ImportMappingWizard({
  file,
  preview,
  previewIssues,
  previewing,
  onPreviewAgain,
  onCancel,
  onImported,
}: ImportMappingWizardProps) {
  const { t } = useI18n();
  const [structure, setStructure] = useState<TableStructure>(() => inferStructure(preview));
  const [mapping, setMapping] = useState<MappingConfig>(() => buildInitialMapping(preview, inferStructure(preview)));
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const nextStructure = inferStructure(preview);
    setStructure(nextStructure);
    setMapping(buildInitialMapping(preview, nextStructure));
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
  }, [preview]);

  const channels = useMemo(
    () => detectChannels(preview, structure, mapping),
    [preview, structure, mapping],
  );

  const localIssues = useMemo(
    () => buildLocalIssues(mapping, channels, t),
    [mapping, channels],
  );
  const channelKey = channels.join("\u0001");

  const allIssues = [...previewIssues, ...preview.warnings, ...issues, ...localIssues];
  const requiredRoles = ASSAY_MODES.find((mode) => mode.value === mapping.assay_mode)?.requiredRoles ?? [];
  const roleOptions = getRoleOptions(mapping.assay_mode);
  const summary = buildPreviewSummary(preview, mapping, channels, t);

  useEffect(() => {
    setMapping((current) => {
      const channelList = channelKey ? channelKey.split("\u0001") : [];
      const nextRoles = { ...current.channel_roles };
      let changed = false;
      for (const channel of channelList) {
        if (!nextRoles[channel]) {
          nextRoles[channel] = defaultRoleForIndex(channel, channelList.indexOf(channel), current.assay_mode);
          changed = true;
        }
      }
      for (const channel of Object.keys(nextRoles)) {
        if (!channelList.includes(channel)) {
          delete nextRoles[channel];
          changed = true;
        }
      }
      if (!changed) return current;
      return { ...current, channel_roles: nextRoles };
    });
  }, [channelKey]);

  function updateMapping(patch: Partial<MappingConfig>) {
    setMapping((current) => ({ ...current, ...patch }));
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
  }

  function setColumn<K extends keyof MappingConfig>(key: K, value: MappingConfig[K]) {
    updateMapping({ [key]: value } as Partial<MappingConfig>);
  }

  function setAssayMode(assayMode: AssayModeId) {
    setMapping((current) => {
      const channelRoles = { ...current.channel_roles };
      for (const [channel, role] of Object.entries(channelRoles)) {
        if (role === "normalization" && assayMode !== "wt_mt") {
          channelRoles[channel] = "excluded";
        }
      }
      return {
        ...current,
        assay_mode: assayMode,
        normalization_mode: assayMode === "wt_mt" ? current.normalization_mode : "none",
        channel_roles: channelRoles,
      };
    });
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
  }

  function setChannelRole(channel: string, role: ImportRole) {
    setMapping((current) => {
      const channelRoles = { ...current.channel_roles, [channel]: role };
      const hasNormalization = Object.values(channelRoles).includes("normalization");
      return {
        ...current,
        normalization_mode:
          current.assay_mode === "wt_mt" && hasNormalization ? "passive_reference" : "none",
        channel_roles: channelRoles,
      };
    });
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
  }

  function setStructureMode(nextStructure: TableStructure) {
    setStructure(nextStructure);
    setMapping(buildInitialMapping(preview, nextStructure));
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
  }

  async function handleImport() {
    setImporting(true);
    setIssues([]);
    setUnsupported(null);
    setSubmitError(null);
    try {
      const response = await parseImportPreview({
        preview_id: preview.preview_id,
        mapping,
      });

      if (isValidationResponse(response)) {
        setIssues(response.issues);
        return;
      }
      if (isUnsupportedResponse(response)) {
        setUnsupported(response.message);
        return;
      }
      onImported(response);
    } catch (error) {
      const message = error instanceof ApiError || error instanceof Error
        ? error.message
        : "Import failed";
      setSubmitError(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mt-5 panel space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase text-text-muted">{t.imwImportMapping}</p>
          <h3 className="text-lg font-semibold">{preview.filename || file.name}</h3>
          <p className="text-[12px] text-text-muted">
            {preview.parser_id} · {formatBytes(file.size)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPreviewAgain}
            disabled={previewing}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-sm hover:bg-[var(--color-bg)] disabled:opacity-60"
          >
            <RotateCcw size={15} />
            {previewing ? t.imwPreviewing : t.imwRePreview}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 border border-border rounded-md text-sm hover:bg-[var(--color-bg)]"
          >
            {t.cancel}
          </button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryItem label={t.imwWells} value={summary.wells} />
        <SummaryItem label={t.imwCycles} value={summary.cycles} />
        <SummaryItem label={t.imwChannels} value={channels.length ? channels.join(", ") : t.imwNone} />
        <SummaryItem label={t.imwRowsShown} value={`${preview.sample_rows.length}`} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t.imwTableStructure}</span>
          <SegmentedButton
            active={structure === "long"}
            onClick={() => setStructureMode("long")}
          >
            {t.imwLongRfuRows}
          </SegmentedButton>
          <SegmentedButton
            active={structure === "wide"}
            onClick={() => setStructureMode("wide")}
          >
            {t.imwWideRfuColumns}
          </SegmentedButton>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Field label={t.imwTable}>
            <select
              value={preview.candidate_tables[0] ?? ""}
              disabled
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
            >
              {(preview.candidate_tables.length ? preview.candidate_tables : [t.imwDetectedTable]).map((table) => (
                <option key={table} value={table}>{table}</option>
              ))}
            </select>
          </Field>
          <Field label={t.imwDelimiter}>
            <select
              value={mapping.delimiter ?? ""}
              onChange={(event) => setColumn("delimiter", event.target.value || null)}
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
            >
              <option value="">{t.imwAuto}</option>
              <option value=",">{t.imwComma}</option>
              <option value="\t">{t.imwTab}</option>
              <option value=";">{t.imwSemicolon}</option>
            </select>
          </Field>
          <Field label={t.imwDecimal}>
            <select
              value={mapping.decimal_separator ?? "."}
              onChange={(event) => setColumn("decimal_separator", event.target.value)}
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
            >
              <option value=".">{t.imwDot}</option>
              <option value=",">{t.imwComma}</option>
            </select>
          </Field>
          <Field label={t.imwHeaderDataRow}>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                value={mapping.header_row ?? 0}
                onChange={(event) => setColumn("header_row", numberOrNull(event.target.value))}
                className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
                aria-label={t.imwHeaderRow}
              />
              <input
                type="number"
                min={0}
                value={mapping.first_data_row ?? 1}
                onChange={(event) => setColumn("first_data_row", numberOrNull(event.target.value))}
                className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
                aria-label={t.imwFirstDataRow}
              />
            </div>
          </Field>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t.imwColumnMapping}</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <ColumnSelect label={t.imwWell} value={mapping.well_column} headers={preview.inferred_headers} onChange={(value) => setColumn("well_column", value)} />
            <ColumnSelect label={t.imwCycle} value={mapping.cycle_column} headers={preview.inferred_headers} onChange={(value) => setColumn("cycle_column", value)} />
            <ColumnSelect label={t.imwSample} value={mapping.sample_column} headers={preview.inferred_headers} onChange={(value) => setColumn("sample_column", value)} optional />
            <ColumnSelect label={t.imwTarget} value={mapping.target_column} headers={preview.inferred_headers} onChange={(value) => setColumn("target_column", value)} optional />
            {structure === "long" ? (
              <>
                <ColumnSelect label={t.imwDyeChannel} value={mapping.dye_column} headers={preview.inferred_headers} onChange={(value) => setColumn("dye_column", value)} />
                <ColumnSelect label={t.imwRfu} value={mapping.rfu_column} headers={preview.inferred_headers} onChange={(value) => setColumn("rfu_column", value)} />
                <ColumnSelect label={t.imwRole} value={mapping.role_column} headers={preview.inferred_headers} onChange={(value) => setColumn("role_column", value)} optional />
              </>
            ) : (
              <div className="md:col-span-2 space-y-2">
                <p className="text-[12px] text-text-muted">{t.imwRfuChannelColumns}</p>
                {channels.map((channel) => (
                  <ColumnSelect
                    key={channel}
                    label={channel}
                    value={mapping.rfu_columns[channel] ?? channel}
                    headers={preview.inferred_headers}
                    onChange={(value) => {
                      const rfuColumns = { ...mapping.rfu_columns };
                      if (value) rfuColumns[channel] = value;
                      else delete rfuColumns[channel];
                      updateMapping({ rfu_columns: rfuColumns });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t.imwAssayRoleBinding}</h4>
          <div className="flex flex-wrap gap-2">
            {ASSAY_MODES.map((mode) => (
              <SegmentedButton
                key={mode.value}
                active={mapping.assay_mode === mode.value}
                onClick={() => setAssayMode(mode.value)}
              >
                {mode.label}
              </SegmentedButton>
            ))}
          </div>
          <div className="space-y-2">
            {channels.map((channel) => (
              <div key={channel} className="grid grid-cols-[minmax(0,1fr)_150px] gap-2 items-center">
                <span className="truncate text-sm" title={channel}>{channel}</span>
                <select
                  value={mapping.channel_roles[channel] ?? "unknown"}
                  onChange={(event) => setChannelRole(channel, event.target.value as ImportRole)}
                  className="border border-border rounded-md px-2 py-2 text-sm bg-surface"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{roleLabel(role, t)}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <Field label={t.imwNormalization}>
            <select
              value={mapping.normalization_mode}
              disabled={mapping.assay_mode !== "wt_mt"}
              onChange={(event) => setColumn("normalization_mode", event.target.value as NormalizationMode)}
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface disabled:opacity-60"
            >
              <option value="none">{t.imwNone}</option>
              <option value="passive_reference">{t.imwPassiveReference}</option>
            </select>
          </Field>
          <p className="text-[12px] text-text-muted">
            {t.imwRequiredRoles(requiredRoles.join(", "))}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">{t.imwValidationPreview}</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryItem label={t.imwAssayMode} value={modeLabel(mapping.assay_mode)} />
          <SummaryItem label={t.imwNormalization} value={normalizationLabel(mapping.normalization_mode, t)} />
          <SummaryItem label={t.imwRoleBinding} value={roleBindingSummary(mapping.channel_roles, t)} />
        </div>
        {allIssues.length > 0 && (
          <div className="space-y-2">
            {allIssues.map((issue, index) => (
              <IssueRow
                key={`${issue.code}-${issue.row ?? "row"}-${issue.column ?? "col"}-${index}`}
                issue={issue}
                onUseCommaDecimal={
                  issue.code === "decimal_separator_mismatch"
                    ? () => setColumn("decimal_separator", ",")
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {unsupported && (
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{unsupported}</span>
          </div>
        )}
        {submitError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <span>{submitError}</span>
            <button
              type="button"
              onClick={onPreviewAgain}
              className="inline-flex items-center gap-1 rounded-md border border-danger px-2 py-1 text-[12px]"
            >
              <RotateCcw size={13} />
              {t.imwRePreviewSelectedFile}
            </button>
          </div>
        )}
      </section>

      <details className="rounded-md border border-border" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-text">
          {t.imwRawDataTitle(preview.sample_rows.length)}
        </summary>
        <div className="overflow-x-auto border-t border-border">
          <table className="min-w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-border">
                {preview.inferred_headers.map((header) => (
                  <th key={header} className="px-2 py-2 font-semibold">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample_rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-0">
                  {preview.inferred_headers.map((header) => (
                    <td key={header} className="max-w-[180px] truncate px-2 py-2 text-text-muted" title={formatCell(row[header])}>
                      {formatCell(row[header])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || previewing}
          className="inline-flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-hover disabled:opacity-60"
        >
          <UploadCloud size={16} />
          {importing ? t.imwImporting : t.imwImport}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-[12px] text-text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ColumnSelect({
  label,
  value,
  headers,
  onChange,
  optional = false,
}: {
  label: string;
  value: string | null;
  headers: string[];
  onChange: (value: string | null) => void;
  optional?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Field label={`${label}${optional ? ` (${t.imwOptional})` : ""}`}>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full border border-border rounded-md px-2 py-2 text-sm bg-surface"
      >
        <option value="">{t.imwNotMapped}</option>
        {headers.map((header) => (
          <option key={header} value={header}>{header}</option>
        ))}
      </select>
    </Field>
  );
}

function SegmentedButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-white"
          : "border-border bg-surface hover:bg-[var(--color-bg)]"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[11px] uppercase text-text-muted">{label}</p>
      <p className="truncate text-sm font-medium" title={value}>{value}</p>
    </div>
  );
}

function IssueRow({ issue, onUseCommaDecimal }: { issue: ValidationIssue; onUseCommaDecimal?: () => void }) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
      issue.recoverable
        ? "border-warning/30 bg-warning/10 text-text"
        : "border-danger/30 bg-danger/10 text-danger"
    }`}>
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p>{issue.message}</p>
          <p className="text-[11px] opacity-80">
            {[
              issue.code,
              issue.row !== null ? `row ${issue.row}` : null,
              issue.column ? `column ${issue.column}` : null,
              issue.channel_id ? `channel ${issue.channel_id}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      {onUseCommaDecimal && (
        <button
          type="button"
          onClick={onUseCommaDecimal}
          className="rounded-md border border-warning px-2 py-1 text-xs"
        >
          {t.imwUseCommaDecimal}
        </button>
      )}
    </div>
  );
}

function buildInitialMapping(preview: ImportPreview, structure: TableStructure): MappingConfig {
  const suggested = preview.suggested_mapping;
  const wellColumn = suggested?.well_column ?? firstCandidate(preview, "well");
  const cycleColumn = suggested?.cycle_column ?? firstCandidate(preview, "cycle");
  const sampleColumn = suggested?.sample_column ?? firstCandidate(preview, "sample");
  const targetColumn = suggested?.target_column ?? firstCandidate(preview, "target");
  const dyeColumn = suggested?.dye_column ?? firstCandidate(preview, "dye");
  const roleColumn = suggested?.role_column ?? firstCandidate(preview, "role");
  const rfuColumn = suggested?.rfu_column ?? firstCandidate(preview, "rfu");
  const rfuCandidates = preview.column_candidates.rfu ?? [];
  const rfuColumns = structure === "wide"
    ? Object.fromEntries(rfuCandidates.map((column) => [column, column]))
    : {};
  const assayMode = suggested?.assay_mode ?? preview.assay_mode_candidates[0] ?? "wt_mt";
  const base: MappingConfig = {
    assay_mode: assayMode,
    normalization_mode: suggested?.normalization_mode ?? "none",
    channel_roles: suggested?.channel_roles ?? {},
    delimiter: suggested?.delimiter ?? preview.inferred_delimiter,
    decimal_separator: suggested?.decimal_separator ?? preview.decimal_separator ?? ".",
    header_row: suggested?.header_row ?? preview.header_row,
    first_data_row: suggested?.first_data_row ?? preview.first_data_row,
    well_column: wellColumn,
    cycle_column: cycleColumn,
    sample_column: sampleColumn,
    target_column: targetColumn,
    dye_column: structure === "long" ? dyeColumn : null,
    role_column: roleColumn,
    rfu_column: structure === "long" ? rfuColumn : null,
    rfu_columns: suggested?.rfu_columns && Object.keys(suggested.rfu_columns).length > 0
      ? suggested.rfu_columns
      : rfuColumns,
  };

  const channels = detectChannels(preview, structure, base);
  const channelRoles: Record<string, ImportRole> = {};
  channels.forEach((channel, index) => {
    channelRoles[channel] = base.channel_roles[channel]
      ?? roleFromPreview(preview, channel)
      ?? defaultRoleForIndex(channel, index, assayMode);
  });
  const hasNormalization = Object.values(channelRoles).includes("normalization");

  return {
    ...base,
    channel_roles: channelRoles,
    normalization_mode: assayMode === "wt_mt" && hasNormalization ? "passive_reference" : base.normalization_mode,
  };
}

function inferStructure(preview: ImportPreview): TableStructure {
  if (preview.suggested_mapping?.rfu_columns && Object.keys(preview.suggested_mapping.rfu_columns).length > 0) {
    return "wide";
  }
  if (preview.parser_id === "generic-wide") return "wide";
  if (preview.parser_id === "qprism-rdes" || preview.parser_id === "generic-long") return "long";
  const hasDye = (preview.column_candidates.dye ?? []).length > 0;
  const rfuCount = (preview.column_candidates.rfu ?? []).length;
  return hasDye || rfuCount <= 1 ? "long" : "wide";
}

function detectChannels(preview: ImportPreview, structure: TableStructure, mapping: MappingConfig): string[] {
  if (structure === "wide") {
    return unique([...(preview.column_candidates.rfu ?? []), ...Object.keys(mapping.rfu_columns)]);
  }

  const rowChannels = mapping.dye_column
    ? unique(preview.sample_rows.map((row) => stringValue(row[mapping.dye_column ?? ""])).filter(Boolean))
    : [];
  if (rowChannels.length > 0) return rowChannels;

  const candidateChannels = preview.channel_candidates.map((channel) => channel.channel_id).filter(Boolean);
  return unique(candidateChannels);
}

function buildPreviewSummary(preview: ImportPreview, mapping: MappingConfig, channels: string[], t: Translations) {
  const wells = mapping.well_column
    ? unique(preview.sample_rows.map((row) => stringValue(row[mapping.well_column ?? ""])).filter(Boolean))
    : [];
  const cycles = mapping.cycle_column
    ? preview.sample_rows.map((row) => Number(row[mapping.cycle_column ?? ""])).filter((value) => Number.isFinite(value))
    : [];
  const cycleSummary = cycles.length > 0
    ? `${Math.min(...cycles)}-${Math.max(...cycles)}`
    : t.imwNotDetected;
  return {
    wells: wells.length > 0 ? t.imwInPreview(wells.length) : t.imwNotDetected,
    cycles: cycleSummary,
    channels: channels.join(", "),
  };
}

function buildLocalIssues(mapping: MappingConfig, channels: string[], t: Translations): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const roles = Object.entries(mapping.channel_roles)
    .filter(([channel, role]) => channels.includes(channel) && !["excluded", "unknown"].includes(role));
  const boundRoles = new Set(roles.map(([, role]) => role));
  const requiredRoles = ASSAY_MODES.find((mode) => mode.value === mapping.assay_mode)?.requiredRoles ?? [];

  for (const role of requiredRoles) {
    if (!boundRoles.has(role)) {
      issues.push(makeLocalIssue("missing_required_role", `Missing required role binding: ${role}`));
    }
  }

  for (const role of UNIQUE_ROLES) {
    const channelsForRole = roles.filter(([, candidateRole]) => candidateRole === role).map(([channel]) => channel);
    if (channelsForRole.length > 1) {
      issues.push(makeLocalIssue("duplicate_role_binding", `Role ${roleLabel(role, t)} is bound to multiple channels: ${channelsForRole.join(", ")}`));
    }
  }

  if (!mapping.well_column) issues.push(makeLocalIssue("missing_field", "Well column is not mapped."));
  if (!mapping.cycle_column) issues.push(makeLocalIssue("missing_field", "Cycle column is not mapped."));
  if (channels.length === 0) issues.push(makeLocalIssue("missing_field", "No reporter channels were detected."));

  return issues;
}

function makeLocalIssue(code: string, message: string): ValidationIssue {
  return {
    code,
    message,
    recoverable: true,
    row: null,
    column: null,
    channel_id: null,
    context: {},
  };
}

function firstCandidate(preview: ImportPreview, key: string): string | null {
  return preview.column_candidates[key]?.[0] ?? null;
}

function roleFromPreview(preview: ImportPreview, channelId: string): ImportRole | null {
  const channel = preview.channel_candidates.find((candidate) => candidate.channel_id === channelId);
  return channel && channel.role !== "unknown" ? channel.role : null;
}

function defaultRoleForIndex(channel: string, index: number, assayMode: AssayModeId): ImportRole {
  const upper = channel.toUpperCase();
  if (upper.includes("ROX") && assayMode === "wt_mt") return "normalization";
  if (upper.includes("FAM")) return "WT";
  if (upper.includes("VIC") || upper.includes("HEX") || upper.includes("JOE")) return "MT1";
  if (upper.includes("CY5")) return assayMode === "wt_mt" ? "excluded" : "MT2";
  if (index === 0) return "WT";
  if (index === 1) return "MT1";
  if (index === 2 && assayMode === "wt_mt") return "normalization";
  if (index === 2 && assayMode !== "wt_mt") return "MT2";
  if (index === 3 && assayMode === "wt_mt1_mt2_mt3") return "MT3";
  return "excluded";
}

function getRoleOptions(assayMode: AssayModeId): ImportRole[] {
  const roles: ImportRole[] = ["WT", "MT1"];
  if (assayMode !== "wt_mt") roles.push("MT2");
  if (assayMode === "wt_mt1_mt2_mt3") roles.push("MT3");
  if (assayMode === "wt_mt") roles.push("normalization");
  return [...roles, "excluded", "unknown"];
}

function roleLabel(role: ImportRole, t: Translations): string {
  if (role === "normalization") return t.imwRoleNormalization;
  if (role === "excluded") return t.imwRoleExcluded;
  if (role === "unknown") return t.imwRoleUnknown;
  return role;
}

function modeLabel(mode: AssayModeId): string {
  return ASSAY_MODES.find((candidate) => candidate.value === mode)?.label ?? mode;
}


function normalizationLabel(mode: NormalizationMode, t: Translations): string {
  if (mode === "passive_reference") return t.imwNormPassive;
  if (mode === "none") return t.imwNone;
  return mode;
}

function roleBindingSummary(channelRoles: Record<string, ImportRole>, t: Translations): string {
  const bound = Object.entries(channelRoles)
    .filter(([, role]) => role !== "excluded" && role !== "unknown")
    .map(([channel, role]) => `${roleLabel(role, t)}=${channel}`);
  return bound.length > 0 ? bound.join(", ") : t.imwNone;
}

function isValidationResponse(response: ImportParseResponse): response is Extract<ImportParseResponse, { status: "validation_failed" }> {
  return "status" in response && response.status === "validation_failed";
}

function isUnsupportedResponse(response: ImportParseResponse): response is Extract<ImportParseResponse, { status: "unsupported_analysis_mode" }> {
  return "status" in response && response.status === "unsupported_analysis_mode";
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatCell(value: unknown): string {
  const text = stringValue(value);
  return text || "-";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
