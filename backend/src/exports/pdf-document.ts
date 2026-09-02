import PDFDocument from 'pdfkit';
import { AUTHORITY_NAME, generatedAtLabel } from './export-format';

const MARGIN = 50;
const BRAND = '#2E5A88';
const MUTED = '#666666';

export interface PdfTableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

/**
 * A PDF built with pdfkit rather than a headless browser. That is a deployment decision, not a
 * stylistic one: rendering through Chromium would put a ~300 MB binary and a GPU-less sandbox on
 * the Authority's server for what is a table and a header. This produces the same document with a
 * pure-JS dependency that starts instantly.
 */
export function createDocument(title: string, subtitle: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: title } });

  doc.fillColor(BRAND).fontSize(15).font('Helvetica-Bold').text(AUTHORITY_NAME);
  doc.moveDown(0.3);
  doc.fillColor('#111111').fontSize(13).text(title);
  doc.moveDown(0.2);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(subtitle);
  doc.text(`Generated ${generatedAtLabel()}`);
  doc.moveDown(1);

  // A rule under the letterhead, so the header reads as a block rather than as loose lines.
  const y = doc.y;
  doc
    .strokeColor('#DDDDDD')
    .lineWidth(1)
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .stroke();
  doc.moveDown(1);

  return doc;
}

/** A labelled figure block, for the totals that lead a notice. */
export function addSummary(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
  rows.forEach(([label, value]) => {
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(label, { continued: true });
    doc.fillColor('#111111').fontSize(11).font('Helvetica-Bold').text(`   ${value}`);
    doc.moveDown(0.3);
  });
  doc.moveDown(0.7);
}

/** A simple fixed-width table. Rows that run past the page break onto a new one with the header. */
export function addTable(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  rows: string[][],
): void {
  const drawHeader = () => {
    const y = doc.y;
    doc.fillColor(BRAND).fontSize(9).font('Helvetica-Bold');
    let x = MARGIN;
    columns.forEach((c) => {
      doc.text(c.header, x, y, { width: c.width, align: c.align ?? 'left' });
      x += c.width;
    });
    doc.moveDown(0.4);
    const lineY = doc.y;
    doc
      .strokeColor('#DDDDDD')
      .lineWidth(0.5)
      .moveTo(MARGIN, lineY)
      .lineTo(doc.page.width - MARGIN, lineY)
      .stroke();
    doc.moveDown(0.4);
  };

  drawHeader();
  doc.font('Helvetica').fontSize(9).fillColor('#111111');

  rows.forEach((row) => {
    // Leave room for the footer note; start a new page (and repeat the header) when we run out.
    if (doc.y > doc.page.height - MARGIN - 60) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(9).fillColor('#111111');
    }
    const y = doc.y;
    let x = MARGIN;
    columns.forEach((c, i) => {
      doc.text(row[i] ?? '', x, y, { width: c.width, align: c.align ?? 'left' });
      x += c.width;
    });
    doc.moveDown(0.6);
  });
}

/** A closing note; used to say what the document is and is not. */
export function addNote(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(1);
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .font('Helvetica')
    .text(text, MARGIN, doc.y, {
      width: doc.page.width - MARGIN * 2,
    });
}
