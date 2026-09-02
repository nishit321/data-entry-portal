import { AttachmentKind } from '@prisma/client';
import { validateAttachment } from './attachment-validation';

/** A tiny valid KML document body. */
const KML = Buffer.from(
  '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // "PK.."
const JSON_GEO = Buffer.from('{"type":"FeatureCollection","features":[]}');
const CSV = Buffer.from('agent,region\nJuba Telecom,Central Equatoria\n');

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
