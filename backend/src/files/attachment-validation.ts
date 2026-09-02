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
    case '.jpg':
    case '.jpeg':
      return null; // image extension is enough for a supporting document
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
