/**
 * Accepted formats for the licence repository, and a light structural check so a renamed file is
 * rejected. Licences and certificates arrive as scans or exports, so this is a narrower list than
 * the submission attachments: a document is something you read, not data you process.
 */
export const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const;

/** Join a list the way a person writes one: "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/** JPEG starts FF D8 FF; PNG starts with its 8-byte signature. */
function isImage(ext: string, buffer: Buffer): boolean {
  if (ext === '.png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  }
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

/** Validate an uploaded document. Returns a plain-language error, or null when it is acceptable. */
export function validateDocument(fileName: string, buffer: Buffer): string | null {
  const ext = extensionOf(fileName);
  if (!ext) return 'The file needs a recognisable extension, for example .pdf.';
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Documents must be a ${orList(ALLOWED_EXTENSIONS)} file.`;
  }
  if (buffer.length === 0) return 'The file is empty.';
  if (ext === '.pdf') {
    return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
      ? null
      : 'This does not look like a valid PDF.';
  }
  return isImage(ext, buffer) ? null : 'This does not look like a valid image.';
}
