import { AttachmentKind } from '@prisma/client';

/**
 * Accepted file formats per attachment kind, and a lightweight structural sniff so an operator
 * can't just rename a random file to `.kml`. This is deliberately pragmatic (extension + magic
 * bytes / parseability), not a full geospatial-schema validation — enough to reject obviously
 * wrong uploads while a deeper OFDS/KML schema check can be layered on later.
 */

/** Join a list the way a person writes one: "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * How each kind is named to the operator. Derived nouns read wrong ("A other must be…") and leak
 * the enum's shape, so the wording is written out rather than computed from the member name.
 */
const KIND_NOUNS: Record<AttachmentKind, string> = {
  COVERAGE_MAP: 'A coverage map',
  FIBRE_MAP: 'A fibre network map',
  AGENT_REGISTER: 'An agent register',
  OTHER: 'A supporting document',
};

export const ALLOWED_EXTENSIONS: Record<AttachmentKind, readonly string[]> = {
  COVERAGE_MAP: ['.kml', '.kmz'],
  FIBRE_MAP: ['.kml', '.kmz', '.json', '.geojson'],
  AGENT_REGISTER: ['.csv', '.xlsx'],
  OTHER: ['.pdf', '.csv', '.xlsx', '.json', '.png', '.jpg', '.jpeg'],
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
}

function isPng(buffer: Buffer): boolean {
  return buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function looksBinary(buffer: Buffer): boolean {
  // A NUL byte in the first chunk is a strong sign this isn't the text format we expect.
  return buffer.subarray(0, 8000).includes(0x00);
}

/** A quick content check keyed to the file's extension. Returns an error string, or null if OK. */
function sniff(ext: string, buffer: Buffer): string | null {
  const head = buffer.subarray(0, 8000).toString('utf8').toLowerCase();
  switch (ext) {
    case '.kml':
      return head.includes('<kml') ? null : 'This does not look like a valid KML file.';
    case '.kmz':
    case '.xlsx':
      return isZip(buffer) ? null : 'The file appears to be corrupt or in the wrong format.';
    case '.json':
    case '.geojson':
      try {
        JSON.parse(buffer.toString('utf8'));
        return null;
      } catch {
        return 'This file is not valid JSON.';
      }
    case '.pdf':
      return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
        ? null
        : 'This does not look like a valid PDF.';
    case '.csv':
      return looksBinary(buffer) ? 'This does not look like a text CSV file.' : null;
    case '.png':
      return isPng(buffer) ? null : 'This does not look like a PNG image.';
    case '.jpg':
    case '.jpeg':
      return isJpeg(buffer) ? null : 'This does not look like a JPEG image.';
    default:
      return null;
  }
}

/**
 * Validate an uploaded attachment against its declared kind. Returns a plain-language error, or
 * null when the file is acceptable. Size is enforced separately (the service + upload limit).
 */
export function validateAttachment(
  kind: AttachmentKind,
  fileName: string,
  buffer: Buffer,
): string | null {
  const ext = extensionOf(fileName);
  const allowed = ALLOWED_EXTENSIONS[kind];
  if (!ext) return 'The file needs a recognisable extension (for example .kml or .pdf).';
  if (!allowed.includes(ext)) {
    return `${KIND_NOUNS[kind]} must be a ${orList(allowed)} file.`;
  }
  if (buffer.length === 0) return 'The file is empty.';
  return sniff(ext, buffer);
}

/**
 * What a member of the public may attach to a complaint (NCA, 15 September 2026).
 *
 * Narrower than anything an operator sends, on purpose. The evidence behind a complaint is a photo
 * of the fault, a photograph or scan of a bill, or a screenshot of a message — so the list is
 * pictures and PDFs. Spreadsheets, KML and JSON are formats a licensed operator files returns in;
 * accepting them here would widen an unauthenticated route for no one's benefit.
 */
export const COMPLAINT_EVIDENCE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const;

/**
 * The type each accepted extension is served back as.
 *
 * Read from the file's own name rather than from the `Content-Type` the uploader sent, because on
 * a public route that header is just another field the sender fills in. Serving a browser a type
 * an anonymous stranger chose is how a stored file becomes a stored script.
 */
const COMPLAINT_EVIDENCE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Validate a file a citizen attached to a complaint. Returns a plain-language error, or null. */
export function validateComplaintEvidence(fileName: string, buffer: Buffer): string | null {
  const ext = extensionOf(fileName);
  if (!ext) return 'The file needs a recognisable extension, for example .pdf or .jpg.';
  if (
    !COMPLAINT_EVIDENCE_EXTENSIONS.includes(ext as (typeof COMPLAINT_EVIDENCE_EXTENSIONS)[number])
  ) {
    return 'You can attach a photo or a PDF. Other kinds of file are not accepted.';
  }
  if (buffer.length === 0) return 'The file is empty.';
  return sniff(ext, buffer);
}

/** The content type a stored complaint file is served as. Falls back to a type no browser runs. */
export function complaintEvidenceType(fileName: string): string {
  return COMPLAINT_EVIDENCE_TYPES[extensionOf(fileName)] ?? 'application/octet-stream';
}
