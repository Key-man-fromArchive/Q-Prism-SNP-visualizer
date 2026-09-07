import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { previewImportFile, loadExample as apiLoadExample } from "@/lib/api";
import { runUploadJobs } from '@/lib/upload-jobs';
import { validUploadResponse } from '@/lib/upload-response';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { UploadJobSummary } from './UploadJobSummary';
import { RecentSessions } from './RecentSessions';
import { runtimeAssetPath } from "@/lib/runtime-paths";
import { runXmlUpload } from '@/lib/xml-upload';
import { useI18n } from "@/hooks/use-i18n";
import { ArrowRight, BookOpen, ChevronDown, ChevronUp, CircleHelp, Download, Upload } from "lucide-react";
import { ImportMappingWizard } from "@/components/upload/ImportMappingWizard";
import type { ImportPreview, ImportPreviewResponse, ValidationIssue } from "@/types/api";

const RAW_EXTENSIONS = [".eds", ".xls", ".xlsx", ".pcrd", ".zip"];
const MAPPED_IMPORT_EXTENSIONS = [".csv", ".tsv", ".txt"];
const STANDARD_IMPORT_EXTENSIONS = [".rdml", ".rdm"];
const PREVIEW_IMPORT_EXTENSIONS = [...MAPPED_IMPORT_EXTENSIONS, ...STANDARD_IMPORT_EXTENSIONS];
const ACCEPTED_EXTENSIONS = [
  ...RAW_EXTENSIONS,
  ".xml",
  ...PREVIEW_IMPORT_EXTENSIONS,
].join(",");

const TEMPLATE_LINKS = [
  {
    href: "/templates/qprism-rdes-amplification-template.tsv",
    labelKey: "templateRdes",
    helpKey: "templateRdesHelp",
  },
  {
    href: "/templates/qprism-generic-long-template.csv",
    labelKey: "templateGenericLong",
    helpKey: "templateGenericLongHelp",
  },
  {
    href: "/templates/qprism-generic-wide-template.csv",
    labelKey: "templateGenericWide",
    helpKey: "templateGenericWideHelp",
  },
] as const;

type UploadZoneProps = {
  onGoToProject?: () => void;
};

function tooltipId(open: boolean, id: string) {
  return open ? id : undefined;
}

export function UploadZone({ onGoToProject }: UploadZoneProps) {
  const { t } = useI18n();
  const operation = useOwnedOperation();
  const previewTicket = useRef<ReturnType<typeof operation.begin> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragover, setDragover] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewIssues, setImportPreviewIssues] = useState<ValidationIssue[]>([]);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);
  const [activeTemplateTooltip, setActiveTemplateTooltip] = useState<string | null>(null);

  const {
    uploadState,
    uploadProgress,
    setSession,
    setUploadState,
    setUploadProgress,
    setUploadError,
  } = useSessionStore();

  const clearImportState = useCallback(() => {
    setImportFile(null);
    setImportPreview(null);
    setImportPreviewIssues([]);
    setPreviewingImport(false);
  }, []);

  const handleImportPreview = useCallback(
    async (file: File) => {
      const ticket = operation.begin();
      previewTicket.current = ticket;
      setImportFile(file);
      setImportPreview(null);
      setImportPreviewIssues([]);
      setPreviewingImport(true);
      setUploadState("uploading");
      setUploadProgress(35);
      setUploadError(null);
      setStatusMessage(t.imwPreviewingFile(file.name));

      try {
        const response = await previewImportFile(file);
        if (!operation.current(ticket)) return;
        setUploadProgress(100);
        if (isImportValidationResponse(response)) {
          setImportPreviewIssues(response.issues);
          setUploadState("error");
          setUploadError(response.issues.map((issue) => issue.message).join("; "));
          setStatusMessage(t.imwPreviewNeedsAttention);
          return;
        }
        setImportPreview(response);
        setUploadState("success");
        setStatusMessage(t.imwPreviewReady(response.filename || file.name));
      } catch {
        if (!operation.current(ticket)) return;
        const msg = t.uploadFailed;
        setUploadState("error");
        setUploadError(msg);
        setStatusMessage(t.imwGenericError(msg));
      } finally {
        if (operation.current(ticket)) setPreviewingImport(false);
      }
    },
    [t, setUploadState, setUploadProgress, setUploadError, operation],
  );

  /** Upload a single file and go to Analysis tab */
  const handleSingleUpload = useCallback(
    async (file: File) => {
      clearImportState();
      const ticket = operation.begin();
      setUploadState("uploading");
      setUploadProgress(30);
      setUploadError(null);
      setStatusMessage(t.uploading);

      let formatFailure = false;
      const info = await runUploadJobs([file], () => { formatFailure = true; });
      if (!operation.current(ticket)) return;
      if (formatFailure && isSpreadsheetImportFallbackFile(file)) {
        await handleImportPreview(file);
        return;
      }
      setUploadProgress(100);
      setUploadState(info ? 'success' : 'error');
      setStatusMessage(info ? t.parsed(info.instrument, info.num_wells, info.num_cycles) : t.jobFinished);
      if (info) setSession(info.session_id, info, 'fresh');
    },
    [
      t,
      setSession,
      setUploadState,
      setUploadProgress,
      setUploadError,
      clearImportState,
      handleImportPreview,
      operation,
    ],
  );

  /** Upload multiple files as separate sessions, then go to Project tab */
  const handleBatchUpload = useCallback(
    async (files: File[]) => {
      clearImportState();
      const ticket = operation.begin();
      setUploadState("uploading");
      setUploadProgress(0);
      setUploadError(null);

      await runUploadJobs(files);
      if (!operation.current(ticket)) return;
      setUploadProgress(100);
      setStatusMessage(t.jobFinished);
      setUploadState('idle');
    },
    [t, setUploadState, setUploadProgress, setUploadError, clearImportState, operation],
  );

  /** Handle multiple files: XML → zip as one, raw files → batch upload */
  const handleMultipleFiles = useCallback(
    async (files: File[]) => {
      const ticket = operation.begin();
      const lowerName = (f: File) => f.name.toLowerCase();
      const previewImportFiles = files.filter((f) =>
        PREVIEW_IMPORT_EXTENSIONS.some((ext) => lowerName(f).endsWith(ext)),
      );
      if (previewImportFiles.length > 0) {
        if (files.length > 1) {
          setUploadState("error");
          setUploadError(t.imwOneFileError);
          setStatusMessage(t.imwOneFileStatus);
          return;
        }
        await handleImportPreview(previewImportFiles[0]);
        return;
      }

      const xmlFiles = files.filter((f) => lowerName(f).endsWith(".xml"));
      const rawFiles = files.filter((f) =>
        RAW_EXTENSIONS.some((ext) => lowerName(f).endsWith(ext)),
      );

      if (xmlFiles.length > 0) {
        setUploadState("packaging");
        setUploadProgress(10);
        setStatusMessage(t.packagingXML(xmlFiles.length));

        const info = await runXmlUpload(xmlFiles);
        if (!operation.current(ticket)) return;
        if (rawFiles.length === 0) {
          setUploadState(info ? 'success' : 'error');
          setStatusMessage(t.jobFinished);
          if (info) setSession(info.session_id, info, 'fresh');
          return;
        }
      }

      if (rawFiles.length === 0) {
        setUploadState("error");
        setUploadError(t.noSupportedFiles);
        setStatusMessage(`Error: ${t.noSupportedFilesDetail}`);
        return;
      }

      // Mixed/XML or multiple raw results remain in the explicit-navigation summary.
      if (isSingleRawUpload(rawFiles, xmlFiles)) {
        await handleSingleUpload(rawFiles[0]);
      } else {
        await handleBatchUpload(rawFiles);
      }
    },
    [
      t,
      handleSingleUpload,
      handleBatchUpload,
      handleImportPreview,
      operation,
      setUploadState,
      setUploadProgress,
      setUploadError,
      setSession,
    ],
  );

  const handleDirectory = useCallback(async (entries: FileSystemEntry[], ticket: ReturnType<typeof operation.begin>) => {
    try {
      const files = await readDroppedEntries(entries, () => operation.current(ticket));
      if (operation.current(ticket)) await handleMultipleFiles(files);
    } catch {
      if (!operation.current(ticket)) return;
      setUploadState('error');
      setUploadError(t.packagingFailed);
      setStatusMessage(t.packagingFailed);
    }
  }, [operation, handleMultipleFiles, setUploadState, setUploadError, t]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      const ticket = operation.begin();
      e.preventDefault();
      setDragover(false);

      const items = e.dataTransfer.items;
      if (!items || !items.length) return;

      // Check for directories
      const entries = droppedEntries(items);

      if (entries.length > 0 && entries.some((ent) => ent.isDirectory)) {
        await handleDirectory(entries, ticket);
      } else if (e.dataTransfer.files.length > 1) {
        await handleMultipleFiles(Array.from(e.dataTransfer.files));
      } else if (e.dataTransfer.files.length === 1) {
        const file = e.dataTransfer.files[0];
        if (isPreviewImportFile(file)) {
          await handleImportPreview(file);
        } else if (file.name.toLowerCase().endsWith(".xml")) {
          await handleMultipleFiles([file]);
        } else {
          await handleSingleUpload(file);
        }
      }
    },
    [handleSingleUpload, handleMultipleFiles, handleImportPreview, handleDirectory, operation],
  );

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const files = Array.from(e.target.files);

      if (files.length > 1) {
        await handleMultipleFiles(files);
      } else if (files.length === 1) {
        const file = files[0];
        if (isPreviewImportFile(file)) {
          await handleImportPreview(file);
        } else if (file.name.toLowerCase().endsWith(".xml")) {
          await handleMultipleFiles([file]);
        } else {
          await handleSingleUpload(file);
        }
      }
      e.target.value = "";
    },
    [handleSingleUpload, handleMultipleFiles, handleImportPreview],
  );

  const onFolderChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        await handleMultipleFiles(Array.from(e.target.files));
      }
      e.target.value = "";
    },
    [handleMultipleFiles],
  );

  const [showGuide, setShowGuide] = useState(true);

  // Load a synthetic example dataset (2x–8x) — a quick way to see genotyping at
  // each ploidy without a real file. Opens it like a successful upload.
  const handleLoadExample = useCallback(
    async (ploidy: number) => {
      const ticket = operation.begin();
      setUploadState("uploading");
      setStatusMessage(t.exampleLoading(ploidy));
      try {
        const info = await apiLoadExample(ploidy);
        if (!operation.current(ticket)) return;
        if (!validUploadResponse(info)) throw new Error('Invalid example response');
        setUploadState("success");
        setStatusMessage(t.parsed(info.instrument, info.num_wells, info.num_cycles));
        setSession(info.session_id, info, 'fresh');
      } catch {
        if (!operation.current(ticket)) return;
        setUploadState("error");
        setStatusMessage(t.errLoadExample);
      }
    },
    [setSession, setUploadState, t, operation],
  );

  return (
    <div id="upload-zone" className="max-w-[700px] mx-auto mt-4">
      <UploadJobSummary onCheckSessions={onGoToProject} />
      <div
        id="drop-area"
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center bg-surface transition-colors cursor-pointer ${
          dragover ? "border-primary bg-primary/10" : "border-border"
        }`}
      >
        <div className="flex justify-center mb-2">
          <Upload size={40} className="text-text-muted" aria-hidden="true" />
        </div>
        <p className="text-text-muted mb-1">
          {t.dragDrop}
        </p>
        <p className="text-text-muted text-[13px]">
          {t.fileFormats}
        </p>
        <p className="text-text-muted text-[11px] mt-1">
          {t.batchHint}
        </p>
        <div className="flex gap-2 justify-center mt-2">
          <button
            id="browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="px-6 py-2 bg-primary text-white rounded-lg text-sm cursor-pointer border-none hover:bg-primary-hover transition-colors"
          >
            {t.browseFiles}
          </button>
          <button
            id="browse-folder-btn"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            className="px-6 py-2 bg-surface text-primary border border-primary rounded-lg text-sm cursor-pointer hover:bg-primary/10 transition-colors"
          >
            {t.browseFolder}
          </button>
          {/* Load a synthetic example dataset at a chosen ploidy (2x–8x) */}
          <select
            id="example-select"
            aria-label={t.exampleLoad}
            defaultValue=""
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const p = Number(e.target.value);
              e.currentTarget.selectedIndex = 0; // reset to placeholder
              if (p) handleLoadExample(p);
            }}
            title={t.exampleHint}
            className="px-3 py-2 bg-surface text-text border border-border rounded-lg text-sm cursor-pointer"
          >
            <option value="" disabled>
              {t.exampleLoad}
            </option>
            {[2, 3, 4, 5, 6, 7, 8].map((p) => (
              <option key={p} value={p}>
                {p === 2 ? t.ploidyDiploid : `${p}x`}
              </option>
            ))}
          </select>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          id="file-input"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          hidden
          onChange={onFileChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          id="folder-input"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          hidden
          onChange={onFolderChange}
        />
      </div>

      <RecentSessions />

      <div className="mt-4 border border-border rounded-lg bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold">{t.importTemplatesTitle}</h3>
              <button
                type="button"
                className="relative inline-flex h-5 w-5 items-center justify-center rounded-full text-text-muted hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t.importTemplatesHelpLabel}
                aria-expanded={showTemplateHelp}
                aria-describedby={tooltipId(showTemplateHelp, 'template-help-tooltip')}
                aria-controls={tooltipId(showTemplateHelp, 'template-help-tooltip')}
                onClick={() => setShowTemplateHelp(true)}
                onMouseEnter={() => setShowTemplateHelp(true)}
                onMouseLeave={() => setShowTemplateHelp(false)}
                onFocus={() => setShowTemplateHelp(true)}
                onBlur={() => setShowTemplateHelp(false)}
                onKeyDown={event => { if (event.key === 'Escape') setShowTemplateHelp(false); }}
              >
                <CircleHelp size={15} />
                {showTemplateHelp && (
                  <span id="template-help-tooltip" role="tooltip" className="template-tooltip pointer-events-none fixed bottom-4 left-4 z-50 rounded-md border border-border bg-surface px-3 py-2 text-left text-[12px] font-normal leading-snug text-text shadow-lg">
                    {t.importTemplatesHelp}
                  </span>
                )}
              </button>
            </div>
            <p className="text-[12px] text-text-muted">
              {t.importTemplatesDescription}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_LINKS.map((template) => (
              <span
                key={template.href}
                className="relative inline-flex"
                onMouseEnter={() => setActiveTemplateTooltip(template.labelKey)}
                onMouseLeave={() => setActiveTemplateTooltip(null)}
                onFocus={() => setActiveTemplateTooltip(template.labelKey)}
                onBlur={() => setActiveTemplateTooltip(null)}
                onKeyDown={event => { if (event.key === 'Escape') setActiveTemplateTooltip(null); }}
              >
                <a
                  href={runtimeAssetPath(template.href)}
                  download
                  aria-describedby={activeTemplateTooltip === template.labelKey ? `${template.labelKey}-tooltip` : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12px] hover:bg-bg focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <Download size={14} />
                  {t[template.labelKey]}
                </a>
                {activeTemplateTooltip === template.labelKey && (
                  <span
                    id={`${template.labelKey}-tooltip`}
                    role="tooltip"
                    className="template-tooltip pointer-events-none fixed bottom-4 left-4 z-50 rounded-md border border-border bg-surface px-3 py-2 text-left text-[12px] leading-snug text-text shadow-lg"
                  >
                    {t[template.helpKey]}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {uploadState !== "idle" && (
        <div id="upload-progress" className="mt-4">
          <div role="progressbar" aria-label={t.uploading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} className="h-1 bg-border rounded-sm overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p
            id="upload-status"
            role="status"
            aria-live="polite"
            className={`text-[13px] text-center mt-2 ${
              uploadState === "error" ? "text-danger" : "text-text-muted"
            }`}
          >
            {statusMessage}
          </p>
        </div>
      )}

      {importFile && importPreview && (
        <ImportMappingWizard
          file={importFile}
          preview={importPreview}
          previewIssues={importPreviewIssues}
          previewing={previewingImport}
          onPreviewAgain={() => handleImportPreview(importFile)}
          onCancel={() => {
            operation.begin();
            previewTicket.current = null;
            clearImportState();
            setUploadState("idle");
            setUploadProgress(0);
            setUploadError(null);
            setStatusMessage(null);
          }}
          onImported={(info) => {
            const ticket = previewTicket.current;
            if (!ticket || !operation.current(ticket)) return;
            if (!validUploadResponse(info)) {
              setUploadState('error');
              setStatusMessage(t.recoveryUnknown);
              return;
            }
            setUploadProgress(100);
            setUploadState("success");
            setStatusMessage(t.parsed(info.instrument, info.num_wells, info.num_cycles));
            setSession(info.session_id, info, 'fresh');
          }}
        />
      )}

      {importFile && !importPreview && importPreviewIssues.length > 0 && (
        <div className="mt-4 rounded-md border border-danger bg-danger/10 p-4 text-sm text-danger">
          <p className="font-medium">{t.imwPreviewFailedFor(importFile.name)}</p>
          <ul className="mt-2 list-disc list-inside space-y-1">
            {importPreviewIssues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => handleImportPreview(importFile)}
              className="px-3 py-2 border border-danger rounded-md text-[12px]"
            >
              {t.retryPreview}
            </button>
            <button
              type="button"
              onClick={clearImportState}
              className="px-3 py-2 border border-border rounded-md text-[12px] text-text"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {onGoToProject && (
        <div className="mt-6 text-center">
          <button
            onClick={onGoToProject}
            className="text-sm text-text-muted hover:text-primary transition-colors"
          >
            {t.goToProjects}
          </button>
        </div>
      )}

      {/* Quick Start Guide */}
      <div className="mt-5 border border-border rounded-lg bg-surface overflow-hidden">
        <button
          onClick={() => setShowGuide((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-bg transition-colors"
        >
          <span className="font-semibold flex items-center gap-2">
            <BookOpen size={16} aria-hidden="true" />
            {t.guideTitle}
          </span>
          <span className="text-xs text-text-muted">
            {showGuide ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </span>
        </button>

        {showGuide && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            {/* 4-step workflow */}
            <div data-testid="quick-start-steps" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {([
                { icon: "1", title: t.guideStep1Title, desc: t.guideStep1Desc },
                { icon: "2", title: t.guideStep2Title, desc: t.guideStep2Desc },
                { icon: "3", title: t.guideStep3Title, desc: t.guideStep3Desc },
                { icon: "4", title: t.guideStep4Title, desc: t.guideStep4Desc },
              ] as const).map((step, i) => (
                <div
                  key={step.icon}
                  className="relative min-w-0 break-words text-center p-3 rounded-lg bg-bg"
                >
                  {i < 3 && (
                    <span className="hidden xl:block absolute right-[-10px] top-1/2 -translate-y-1/2 text-text-muted z-10">
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  )}
                  <div className="w-6 h-6 mx-auto mb-1.5 rounded-full bg-primary text-white flex items-center justify-center text-[11px] font-bold">
                    {step.icon}
                  </div>
                  <p className="text-[13px] font-medium mb-0.5">{step.title}</p>
                  <p className="text-[10px] text-text-muted leading-snug">{step.desc}</p>
                </div>
              ))}
            </div>

            {/* Supported Formats + Tips side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 break-words">
              <div>
                <h4 className="text-[12px] font-semibold mb-1.5">{t.guideSupportedFormats}</h4>
                <div className="space-y-1.5 text-[11px]">
                  <div className="p-2 rounded bg-bg">
                    <span className="font-medium">{t.guideQS}</span>
                    <span className="text-text-muted block">{t.guideQSFormats}</span>
                  </div>
                  <div className="p-2 rounded bg-bg">
                    <span className="font-medium">{t.guideCFX}</span>
                    <span className="text-text-muted block">{t.guideCFXFormats}</span>
                  </div>
                  <div className="p-2 rounded bg-bg">
                    <span className="font-medium">{t.guideImports}</span>
                    <span className="text-text-muted block">{t.guideImportFormats}</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-[12px] font-semibold mb-1.5">{t.guideTips}</h4>
                <ul className="text-[11px] text-text-muted space-y-1 list-disc list-inside">
                  <li>{t.guideTip1}</li>
                  <li>{t.guideTip2}</li>
                  <li>{t.guideTip3}</li>
                  <li>{t.guideTip4}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function isPreviewImportFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return PREVIEW_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isSpreadsheetImportFallbackFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function isSingleRawUpload(raw: readonly File[], xml: readonly File[]): boolean {
  return raw.length === 1 && xml.length === 0;
}

function droppedEntries(items: DataTransferItemList): FileSystemEntry[] {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}

function isImportValidationResponse(response: ImportPreviewResponse): response is Extract<ImportPreviewResponse, { status: "validation_failed" }> {
  return "status" in response && response.status === "validation_failed";
}

/** Recursively read files from dropped folder entries */
async function readDroppedEntries(
  entries: FileSystemEntry[],
  current: () => boolean,
): Promise<File[]> {
  const files: File[] = [];

  async function readEntry(entry: FileSystemEntry) {
    if (!current()) return;
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise<void>((resolve, reject) => {
        fileEntry.file((f) => {
          if (current()) files.push(f);
          resolve();
        }, reject);
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const childEntries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        (function readBatch() {
          reader.readEntries((batch) => {
            if (!current() || batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            readBatch();
          }, reject);
        })();
      });
      for (const child of childEntries) {
        await readEntry(child);
      }
    }
  }

  for (const entry of entries) {
    await readEntry(entry);
  }
  return files;
}
