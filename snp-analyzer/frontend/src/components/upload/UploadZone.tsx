import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { uploadFile as apiUpload } from "@/lib/api";
import JSZip from "jszip";
import { useI18n } from "@/hooks/use-i18n";

const RAW_EXTENSIONS = [".eds", ".xls", ".xlsx", ".pcrd", ".zip"];

type UploadZoneProps = {
  onGoToProject?: () => void;
};

export function UploadZone({ onGoToProject }: UploadZoneProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragover, setDragover] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const {
    uploadState,
    uploadProgress,
    setSession,
    setUploadState,
    setUploadProgress,
    setUploadError,
  } = useSessionStore();

  /** Upload a single file and go to Analysis tab */
  const handleSingleUpload = useCallback(
    async (file: File) => {
      setUploadState("uploading");
      setUploadProgress(30);
      setUploadError(null);
      setStatusMessage(t.uploading);

      try {
        setUploadProgress(70);
        const info = await apiUpload(file);
        setUploadProgress(100);
        setStatusMessage(t.parsed(info.instrument, info.num_wells, info.num_cycles));
        setUploadState("success");

        setTimeout(() => {
          setSession(info.session_id, info);
        }, 500);
      } catch (err) {
        setUploadState("error");
        const msg = err instanceof Error ? err.message : t.uploadFailed;
        setUploadError(msg);
        setStatusMessage(`Error: ${msg}`);
      }
    },
    [t, setSession, setUploadState, setUploadProgress, setUploadError],
  );

  /** Upload multiple files as separate sessions, then go to Project tab */
  const handleBatchUpload = useCallback(
    async (files: File[]) => {
      setUploadState("uploading");
      setUploadProgress(0);
      setUploadError(null);

      let success = 0;
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const pct = Math.round(((i) / files.length) * 100);
        setUploadProgress(pct);
        setStatusMessage(t.uploadingN(i + 1, files.length, file.name));

        try {
          await apiUpload(file);
          success++;
        } catch {
          failed++;
        }
      }

      setUploadProgress(100);
      if (failed === 0) {
        setStatusMessage(t.allUploaded(success));
        setUploadState("success");
      } else {
        setStatusMessage(t.uploadResult(success, failed));
        setUploadState(failed === files.length ? "error" : "success");
        if (failed > 0) setUploadError(t.nFileFailed(failed));
      }

      // Navigate to Project tab to see all sessions
      setTimeout(() => {
        setUploadState("idle");
        setUploadProgress(0);
        onGoToProject?.();
      }, 800);
    },
    [t, setUploadState, setUploadProgress, setUploadError, onGoToProject],
  );

  /** Handle multiple files: XML → zip as one, raw files → batch upload */
  const handleMultipleFiles = useCallback(
    async (files: File[]) => {
      const lowerName = (f: File) => f.name.toLowerCase();
      const xmlFiles = files.filter((f) => lowerName(f).endsWith(".xml"));
      const rawFiles = files.filter((f) =>
        RAW_EXTENSIONS.some((ext) => lowerName(f).endsWith(ext)),
      );

      // Build the list of uploads: each raw file is one upload,
      // all XML files are zipped into one upload
      const uploadItems: File[] = [...rawFiles];

      if (xmlFiles.length > 0) {
        setUploadState("packaging");
        setUploadProgress(10);
        setStatusMessage(t.packagingXML(xmlFiles.length));

        try {
          const zip = new JSZip();
          for (const file of xmlFiles) {
            const data = await file.arrayBuffer();
            zip.file(file.name, data);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          const zipFile = new File([blob], "cfx_xml_export.zip", {
            type: "application/zip",
          });
          uploadItems.push(zipFile);
        } catch (err) {
          setUploadState("error");
          const msg = err instanceof Error ? err.message : t.packagingFailed;
          setUploadError(msg);
          setStatusMessage(`Error: ${msg}`);
          return;
        }
      }

      if (uploadItems.length === 0) {
        setUploadState("error");
        setUploadError(t.noSupportedFiles);
        setStatusMessage(`Error: ${t.noSupportedFilesDetail}`);
        return;
      }

      // Single file → go to Analysis; multiple files → batch to Project tab
      if (uploadItems.length === 1) {
        await handleSingleUpload(uploadItems[0]);
      } else {
        await handleBatchUpload(uploadItems);
      }
    },
    [t, handleSingleUpload, handleBatchUpload, setUploadState, setUploadProgress, setUploadError],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragover(false);

      const items = e.dataTransfer.items;
      if (!items || !items.length) return;

      // Check for directories
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0 && entries.some((ent) => ent.isDirectory)) {
        const files = await readDroppedEntries(entries);
        await handleMultipleFiles(files);
      } else if (e.dataTransfer.files.length > 1) {
        await handleMultipleFiles(Array.from(e.dataTransfer.files));
      } else if (e.dataTransfer.files.length === 1) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith(".xml")) {
          await handleMultipleFiles([file]);
        } else {
          await handleSingleUpload(file);
        }
      }
    },
    [handleSingleUpload, handleMultipleFiles],
  );

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const files = Array.from(e.target.files);

      if (files.length > 1) {
        await handleMultipleFiles(files);
      } else if (files.length === 1) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith(".xml")) {
          await handleMultipleFiles([file]);
        } else {
          await handleSingleUpload(file);
        }
      }
      e.target.value = "";
    },
    [handleSingleUpload, handleMultipleFiles],
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

  return (
    <div id="upload-zone" className="max-w-[700px] mx-auto mt-4">
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
          dragover ? "border-primary bg-blue-50" : "border-border"
        }`}
      >
        <div className="text-4xl mb-2">&#128196;</div>
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
            className="px-6 py-2 bg-surface text-primary border border-primary rounded-lg text-sm cursor-pointer hover:bg-blue-50 transition-colors"
          >
            {t.browseFolder}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          id="file-input"
          accept=".eds,.xls,.xlsx,.pcrd,.zip,.xml"
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

      {uploadState !== "idle" && (
        <div id="upload-progress" className="mt-4">
          <div className="h-1 bg-border rounded-sm overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p
            id="upload-status"
            className={`text-[13px] text-center mt-2 ${
              uploadState === "error" ? "text-danger" : "text-text-muted"
            }`}
          >
            {statusMessage}
          </p>
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
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--bg)] transition-colors"
        >
          <span className="font-semibold flex items-center gap-2">
            <span className="text-base">&#128218;</span>
            {t.guideTitle}
          </span>
          <span className="text-xs text-text-muted">{showGuide ? "▲" : "▼"}</span>
        </button>

        {showGuide && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            {/* 4-step workflow */}
            <div className="grid grid-cols-4 gap-2">
              {([
                { icon: "1", title: t.guideStep1Title, desc: t.guideStep1Desc },
                { icon: "2", title: t.guideStep2Title, desc: t.guideStep2Desc },
                { icon: "3", title: t.guideStep3Title, desc: t.guideStep3Desc },
                { icon: "4", title: t.guideStep4Title, desc: t.guideStep4Desc },
              ] as const).map((step, i) => (
                <div
                  key={step.icon}
                  className="relative text-center p-3 rounded-lg bg-[var(--bg)]"
                >
                  {i < 3 && (
                    <span className="absolute right-[-10px] top-1/2 -translate-y-1/2 text-text-muted text-xs z-10">
                      &#8594;
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <h4 className="text-[12px] font-semibold mb-1.5">{t.guideSupportedFormats}</h4>
                <div className="space-y-1.5 text-[11px]">
                  <div className="p-2 rounded bg-[var(--bg)]">
                    <span className="font-medium">{t.guideQS}</span>
                    <span className="text-text-muted block">{t.guideQSFormats}</span>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg)]">
                    <span className="font-medium">{t.guideCFX}</span>
                    <span className="text-text-muted block">{t.guideCFXFormats}</span>
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

/** Recursively read files from dropped folder entries */
async function readDroppedEntries(
  entries: FileSystemEntry[],
): Promise<File[]> {
  const files: File[] = [];

  async function readEntry(entry: FileSystemEntry) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise<void>((resolve) => {
        fileEntry.file((f) => {
          files.push(f);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const childEntries = await new Promise<FileSystemEntry[]>((resolve) => {
        const all: FileSystemEntry[] = [];
        (function readBatch() {
          reader.readEntries((batch) => {
            if (batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            readBatch();
          });
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
