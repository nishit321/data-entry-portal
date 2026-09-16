import { AttachmentKind } from '@prisma/client';
import {
  complaintEvidenceType,
  validateAttachment,
  validateComplaintEvidence,
} from './attachment-validation';

/** A tiny valid KML document body. */
const KML = Buffer.from(
  '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // "PK.."
const JSON_GEO = Buffer.from('{"type":"FeatureCollection","features":[]}');
const CSV = Buffer.from('agent,region\nJuba Telecom,Central Equatoria\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

describe('validateAttachment', () => {
  it('accepts a well-formed KML as a coverage map', () => {
    expect(validateAttachment(AttachmentKind.COVERAGE_MAP, 'coverage.kml', KML)).toBeNull();
  });

  it('accepts a KMZ (zip) as a coverage map', () => {
    expect(validateAttachment(AttachmentKind.COVERAGE_MAP, 'coverage.kmz', ZIP)).toBeNull();
  });

  it('accepts GeoJSON as a fibre map', () => {
    expect(validateAttachment(AttachmentKind.FIBRE_MAP, 'fibre.geojson', JSON_GEO)).toBeNull();
  });

  it('accepts a CSV as an agent register', () => {
    expect(validateAttachment(AttachmentKind.AGENT_REGISTER, 'agents.csv', CSV)).toBeNull();
  });

  it('accepts a PDF as an other document', () => {
    expect(validateAttachment(AttachmentKind.OTHER, 'note.pdf', PDF)).toBeNull();
  });

  it('rejects a wrong extension for the kind', () => {
    const err = validateAttachment(AttachmentKind.COVERAGE_MAP, 'agents.csv', CSV);
    expect(err).toBe('A coverage map must be a .kml or .kmz file.');
  });

  it('rejects a file with no extension', () => {
    expect(validateAttachment(AttachmentKind.OTHER, 'README', PDF)).toMatch(/extension/);
  });

  it('rejects an empty file', () => {
    expect(validateAttachment(AttachmentKind.OTHER, 'empty.pdf', Buffer.alloc(0))).toMatch(/empty/);
  });

  it('rejects a file renamed to .kml that is not KML', () => {
    const err = validateAttachment(AttachmentKind.COVERAGE_MAP, 'fake.kml', CSV);
    expect(err).toMatch(/KML/);
  });

  it('rejects a .json that is not valid JSON', () => {
    const err = validateAttachment(AttachmentKind.FIBRE_MAP, 'bad.json', Buffer.from('{not json'));
    expect(err).toMatch(/JSON/);
  });

  it('rejects a .pdf without the PDF signature', () => {
    const err = validateAttachment(AttachmentKind.OTHER, 'fake.pdf', Buffer.from('hello world'));
    expect(err).toMatch(/PDF/);
  });

  it('rejects a binary blob posing as CSV', () => {
    const bin = Buffer.from([0x41, 0x00, 0x42, 0x00]);
    const err = validateAttachment(AttachmentKind.AGENT_REGISTER, 'agents.csv', bin);
    expect(err).toMatch(/CSV/);
  });
});

describe('validateComplaintEvidence', () => {
  /*
   * The list a member of the public may send in. Narrower than an operator's, because a complaint
   * is evidenced by a photograph or a document and nothing else, and because this list is what an
   * unauthenticated caller gets to put on the Authority's disk.
   */
  it('accepts a photograph of the problem', () => {
    expect(validateComplaintEvidence('mast.png', PNG)).toBeNull();
    expect(validateComplaintEvidence('bill.jpg', JPEG)).toBeNull();
    expect(validateComplaintEvidence('bill.JPEG', JPEG)).toBeNull();
  });

  it('accepts a PDF', () => {
    expect(validateComplaintEvidence('invoice.pdf', PDF)).toBeNull();
  });

  it('refuses the formats only an operator has a use for', () => {
    // Every one of these is accepted from a licensed operator filing a return. None of them is a
    // thing a citizen attaches to a complaint, and each one is a parser this route need not run.
    expect(validateComplaintEvidence('coverage.kml', KML)).not.toBeNull();
    expect(validateComplaintEvidence('fibre.geojson', JSON_GEO)).not.toBeNull();
    expect(validateComplaintEvidence('agents.csv', CSV)).not.toBeNull();
    expect(validateComplaintEvidence('book.xlsx', ZIP)).not.toBeNull();
  });

  it('refuses a file renamed to look like a picture', () => {
    const page = Buffer.from('<html><script>alert(1)</script></html>');
    expect(validateComplaintEvidence('photo.png', page)).toMatch(/PNG/);
    expect(validateComplaintEvidence('photo.jpg', page)).toMatch(/JPEG/);
  });

  it('refuses an empty file and one with no extension', () => {
    expect(validateComplaintEvidence('photo.png', Buffer.alloc(0))).toMatch(/empty/);
    expect(validateComplaintEvidence('photo', PNG)).toMatch(/extension/);
  });
});

describe('complaintEvidenceType', () => {
  it('reads the served type from the file name', () => {
    expect(complaintEvidenceType('mast.png')).toBe('image/png');
    expect(complaintEvidenceType('bill.JPG')).toBe('image/jpeg');
    expect(complaintEvidenceType('invoice.pdf')).toBe('application/pdf');
  });

  it('falls back to a type no browser will run', () => {
    // Nothing should reach storage with an unrecognised extension, but if one ever does, what it
    // is served as decides whether a stored file is a download or a page.
    expect(complaintEvidenceType('odd.svg')).toBe('application/octet-stream');
    expect(complaintEvidenceType('noextension')).toBe('application/octet-stream');
  });
});
