/** A downloaded export: the bytes plus the server's chosen filename, when it sent one. */
export type DownloadedFile = { blob: Blob; filename?: string };

function safeName(raw: string): string | undefined {
  // Keep only the last path segment and drop control characters.
  // eslint-disable-next-line no-control-regex
  const name = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  return name || undefined;
}

/** Reads the filename from a Content-Disposition header. RFC 5987 `filename*`
 *  wins over `filename=`; a missing header or undecodable value gives undefined
 *  so the caller keeps its own default name. */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]*)/i.exec(header);
  if (star) {
    try {
      const decoded = safeName(decodeURIComponent(star[2].trim()));
      if (decoded) return decoded;
    } catch {
      // fall through to the plain filename=
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(header);
  if (!plain) return undefined;
  return safeName((plain[1] ?? plain[2] ?? '').trim());
}
