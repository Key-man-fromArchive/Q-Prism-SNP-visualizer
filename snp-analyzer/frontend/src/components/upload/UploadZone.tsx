import { useCallback, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { uploadFile as apiUpload } from "@/lib/api";
import JSZip from "jszip";

export function UploadZone() {
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

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadState("uploading");
      setUploadProgress(30);
      setUploadError(null);
      setStatusMessage("Uploading...");

      try {
        setUploadProgress(70);
        const info = await apiUpload(file);
        setUploadProgress(100);
        setStatusMessage(
          `Parsed: ${info.instrument} | ${info.num_wells} wells | ${info.num_cycles} cycles`,
        );
        setUploadState("success");

        // Brief delay before transitioning to analysis view (matching legacy)
        setTimeout(() => {
          setSession(info.session_id, info);
        }, 500);
      } catch (err) {
        setUploadState("error");
        const msg = err instanceof Error ? err.message : "Upload failed";
        setUploadError(msg);
        setStatusMessage(`Error: ${msg}`);
      }
    },
    [setSession, setUploadState, setUploadProgress, setUploadError],
  );

  const handleMultipleFiles = useCallback(
    async (files: File[]) => {
      const xmlFiles = files.filter((f) =>
        f.name.toLowerCase().endsWith(".xml"),
      );

      // If no XML files but exactly 1 other file, use single upload
      if (xmlFiles.length === 0) {
        const nonXml = files.filter(
          (f) => !f.name.toLowerCase().endsWith(".xml"),
        );
        if (nonXml.length === 1) {
          await handleUpload(nonXml[0]);
          return;
        }
        setUploadState("error");
        setUploadError("No .xml files found");
        setStatusMessage("Error: No .xml files found");
        return;
      }

      setUploadState("packaging");
      setUploadProgress(10);
      setStatusMessage(
        `Packaging ${xmlFiles.length} XML file${xmlFiles.length > 1 ? "s" : ""}...`,
      );

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

        setUploadProgress(40);
        setStatusMessage("Uploading...");
        await handleUpload(zipFile);
      } catch (err) {
        setUploadState("error");
        const msg = err instanceof Error ? err.message : "Packaging failed";
        setUploadError(msg);
        setStatusMessage(`Error: ${msg}`);
      }
    },
    [handleUpload, setUploadState, setUploadProgress, setUploadError],
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
          await handleUpload(file);
        }
      }
    },
    [handleUpload, handleMultipleFiles],
  );

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const files = Array.from(e.target.files);
      const xmlFiles = files.filter((f) =>
        f.name.toLowerCase().endsWith(".xml"),
      );

      if (xmlFiles.length > 0 || files.length > 1) {
        await handleMultipleFiles(files);
      } else if (files.length === 1) {
        await handleUpload(files[0]);
      }
      e.target.value = "";
    },
    [handleUpload, handleMultipleFiles],
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

  return (
    <div id="upload-zone" className="max-w-[500px] mx-auto mt-20">
      <div
        id="drop-area"
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-12 text-center bg-surface transition-colors cursor-pointer ${
          dragover ? "border-primary bg-blue-50" : "border-border"
        }`}
      >
        <div className="text-5xl mb-3">&#128196;</div>
        <p className="text-text-muted mb-2">
          Drag & drop your raw fluorescence file here
        </p>
        <p className="text-text-muted text-[13px]">
          QuantStudio (.eds, .xls) | CFX Opus (.xlsx, .zip, or drag XML
          files/folder)
        </p>
        <div className="flex gap-2 justify-center mt-3">
          <button
            id="browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="px-6 py-2 bg-primary text-white rounded-lg text-sm cursor-pointer border-none hover:bg-primary-hover transition-colors"
          >
            Browse Files
          </button>
          <button
            id="browse-folder-btn"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            className="px-6 py-2 bg-surface text-primary border border-primary rounded-lg text-sm cursor-pointer hover:bg-blue-50 transition-colors"
          >
            Browse Folder
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
