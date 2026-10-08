/** The browser could not read the picked file (locked by another program,
 *  a cloud/network placeholder, or changed after it was picked). Nothing was
 *  sent, so the server cannot have saved anything. */
export class UnreadableFileError extends Error {
  constructor() {
    super('The selected file could not be read');
    this.name = 'UnreadableFileError';
  }
}

/** Read the whole file before sending it. A read failure used to surface only
 *  as a rejected fetch, which reads as "outcome unknown -- may already be
 *  saved"; reading first turns it into a definite, explainable failure, and
 *  the upload then sends the bytes that were actually read. */
export async function readableCopy(file: File): Promise<File> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new UnreadableFileError();
  }
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}
