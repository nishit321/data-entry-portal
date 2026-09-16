import { inflateSync } from 'zlib';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  FieldType,
  PublicAggregation,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(45000);
const OTP = '123456';

/**
 * The public open-data endpoints (Q4, Phase 2).
 *
 * The rules under test are the ones that would matter in a complaint from an operator: nothing is
 * public unless NCA put it on the list, no response ever names an operator, and an aggregate over
 * too few operators is withheld rather than published.
 */
describe('Public portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-pub-admin@nca.test';
  const opEmail = 'e2e-pub-op@x.test';
  const emails = [adminEmail, opEmail];
  const licences = [0, 1, 2, 3].map((i) => `E2E/PUB/${i}`);
  const tplName = 'E2E Public Template';
  // Field keys are globally unique in these assertions, so they carry the suite's own prefix.
  const openKey = 'e2e_pub_subscribers';
  const thinKey = 'e2e_pub_thin';
  const revenueKey = 'e2e_pub_revenue';
  const textKey = 'e2e_pub_notes';

  let adminToken: string;
  let opToken: string;
  const created: string[] = [];

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const v = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return v.body.accessToken as string;
  }

  async function cleanup() {
    await prisma.publicIndicator.deleteMany({
      where: { fieldKey: { in: [openKey, thinKey, revenueKey, textKey] } },
    });
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.enforcementCase.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: licences } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });

    const entities = [];
    for (let i = 0; i < 4; i++) {
      entities.push(
        await prisma.entity.create({
          data: {
            name: `Pub Op ${i}`,
            type: EntityType.MNO,
            status: EntityStatus.ACTIVE,
            licenceNumber: licences[i],
          },
        }),
      );
    }
    const op = await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entities[0].id,
      },
    });

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: {
            key: 'public',
            title: 'Public section',
            order: 1,
            fields: {
              create: [
                {
                  key: openKey,
                  label: 'Subscribers',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  unit: 'subscribers',
                },
                // Reported by one operator only, so an aggregate would name that operator.
                { key: thinKey, label: 'Thin metric', order: 2, dataType: FieldType.INTEGER },
                // The levy basis: commercially sensitive, and refused outright.
                {
                  key: revenueKey,
                  label: 'Annual revenue',
                  order: 3,
                  dataType: FieldType.MONETARY,
                  isLevyBasis: true,
                },
                { key: textKey, label: 'Notes', order: 4, dataType: FieldType.TEXT },
              ],
            },
          },
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    const fields = tpl.sections[0].fields;
    const fieldId = (key: string) => fields.find((f) => f.key === key)!.id;

    const closed = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2025 Q2 public',
        periodStart: new Date('2025-04-01'),
        periodEnd: new Date('2025-06-30'),
        dueDate: new Date('2025-07-15'),
        status: 'CLOSED',
      },
    });

    // Four approved returns on a closed period: 100, 200, 300, 400 subscribers.
    const subscribers = [100, 200, 300, 400];
    let ref = 940000;
    for (let i = 0; i < 4; i++) {
      await prisma.submission.create({
        data: {
          entityId: entities[i].id,
          periodId: closed.id,
          templateId: tpl.id,
          createdById: op.id,
          status: SubmissionStatus.APPROVED,
          isLate: false,
          submittedAt: new Date('2025-07-10'),
          referenceNumber: `NCA/SUB/2025/${++ref}`,
          values: {
            create: [
              { fieldId: fieldId(openKey), valueText: String(subscribers[i]) },
              { fieldId: fieldId(textKey), valueText: 'Nothing to add.' },
              // Only the first operator reports the thin metric.
              ...(i === 0 ? [{ fieldId: fieldId(thinKey), valueText: '999' }] : []),
            ],
          },
        },
      });
    }

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface PublicIndicatorRow {
    label: string;
    unit: string | null;
    aggregation: string;
    points: { label: string; value: number | null; contributors: number; withheld: boolean }[];
  }

  /** Only this suite's indicators; another suite may have published its own. */
  const ourIndicators = (body: { indicators: PublicIndicatorRow[] }, label: string) =>
    body.indicators.find((i) => i.label === label);

  const addIndicator = async (body: Record<string, unknown>, expected = 201) => {
    const res = await request(server)
      .post('/api/v1/public-indicators')
      .set(auth(adminToken))
      .send(body)
      .expect(expected);
    if (expected === 201) created.push(res.body.id);
    return res;
  };

  describe('what the public can reach without an account', () => {
    it('serves the overview with no token', async () => {
      const res = await request(server).get('/api/v1/public/overview').expect(200);
      expect(res.body.licensedOperators).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(res.body.byType)).toBe(true);
    });

    it('serves the complaint summary with no token, and names nobody', async () => {
      const res = await request(server).get('/api/v1/public/complaints-summary').expect(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body.byStatus).toHaveProperty('resolved');
      // Nothing identifying: no reference numbers, no subjects, no operator names.
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('NCA/CMP');
      expect(json).not.toContain('complainant');
      expect(json).not.toContain('Pub Op');
    });

    it('publishes nothing until NCA has put something on the list', async () => {
      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(res.body, 'People connected')).toBeUndefined();
    });
  });

  describe('the allowlist', () => {
    it('lets only an administrator change it (403)', async () => {
      await request(server)
        .post('/api/v1/public-indicators')
        .set(auth(opToken))
        .send({ fieldKey: openKey, label: 'People connected' })
        .expect(403);
    });

    it('is not readable by an operator at all (403)', async () => {
      await request(server).get('/api/v1/public-indicators').set(auth(opToken)).expect(403);
    });

    it('refuses a question that is not on any published questionnaire (400)', async () => {
      await addIndicator({ fieldKey: 'no_such_question', label: 'Nothing' }, 400);
    });

    it('refuses a text question (400)', async () => {
      await addIndicator({ fieldKey: textKey, label: 'Notes' }, 400);
    });

    it('refuses the revenue the levy is assessed on (400)', async () => {
      const res = await addIndicator({ fieldKey: revenueKey, label: 'Revenue' }, 400);
      expect(JSON.stringify(res.body)).toContain('commercially sensitive');
    });

    it('offers the questions that could be published, minus the levy basis', async () => {
      const res = await request(server)
        .get('/api/v1/public-indicators/available')
        .set(auth(adminToken))
        .expect(200);
      const keys = res.body.fields.map((f: { fieldKey: string }) => f.fieldKey);
      expect(keys).toContain(openKey);
      expect(keys).not.toContain(revenueKey);
      expect(keys).not.toContain(textKey);
    });
  });

  describe('publishing a figure', () => {
    it('adds a figure to the list without publishing it', async () => {
      const res = await addIndicator({
        fieldKey: openKey,
        aggregation: PublicAggregation.SUM,
        label: 'People connected',
        unit: 'subscribers',
        description: 'Total mobile subscriptions across licensed operators.',
      });
      expect(res.body.isPublished).toBe(false);

      // Adding and publishing are two separate decisions, so the public page has not changed.
      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(pub.body, 'People connected')).toBeUndefined();
    });

    it('publishes it once an administrator switches it on', async () => {
      await request(server)
        .patch(`/api/v1/public-indicators/${created[0]}`)
        .set(auth(adminToken))
        .send({ isPublished: true })
        .expect(200);

      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      const indicator = ourIndicators(res.body, 'People connected')!;
      expect(indicator.unit).toBe('subscribers');

      const point = indicator.points.find((p) => p.label === '2025 Q2 public')!;
      expect(point.contributors).toBe(4);
      expect(point.withheld).toBe(false);
      expect(point.value).toBe(1000); // 100 + 200 + 300 + 400
    });

    it('never names an operator in the public response', async () => {
      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('Pub Op');
      expect(json).not.toContain('E2E/PUB');
      expect(json).not.toContain('entityId');
    });

    it('withholds a figure too few operators reported', async () => {
      const res = await addIndicator({
        fieldKey: thinKey,
        label: 'Thin public metric',
        isPublished: true,
      });
      expect(res.body.isPublished).toBe(true);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      const indicator = ourIndicators(pub.body, 'Thin public metric')!;
      const point = indicator.points.find((p) => p.label === '2025 Q2 public')!;
      expect(point.contributors).toBe(1);
      expect(point.withheld).toBe(true);
      expect(point.value).toBeNull();
      // The one operator's actual figure must not be recoverable from the response.
      expect(JSON.stringify(pub.body)).not.toContain('999');
    });

    it('averages rather than totals when the schedule says so', async () => {
      const res = await addIndicator({
        fieldKey: openKey,
        aggregation: PublicAggregation.AVERAGE,
        label: 'Average operator size',
        isPublished: true,
      });
      expect(res.body.aggregation).toBe(PublicAggregation.AVERAGE);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      const point = ourIndicators(pub.body, 'Average operator size')!.points.find(
        (p) => p.label === '2025 Q2 public',
      )!;
      expect(point.value).toBe(250); // (100 + 200 + 300 + 400) / 4
    });

    it('refuses the same question twice with the same calculation (400)', async () => {
      await addIndicator(
        { fieldKey: openKey, aggregation: PublicAggregation.SUM, label: 'Duplicate' },
        400,
      );
    });

    it('takes a figure off the public site when it is removed', async () => {
      await request(server)
        .delete(`/api/v1/public-indicators/${created[0]}`)
        .set(auth(adminToken))
        .expect(200);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(pub.body, 'People connected')).toBeUndefined();
    });
  });

  describe('filtering, search and download (NCA, 15 September 2026)', () => {
    /*
     * "Public Portal: Implement filtering and search capabilities; enable export to PDF, Excel,
     *  and other formats."
     *
     * Two of these tests are about the feature working. The rest are about the thing that could go
     * wrong with it, which is not a filter returning the wrong rows: it is a download returning
     * what the page refused to show. The threshold is the portal's only real protection for an
     * operator's figures, and an export that queried for itself would sit outside it.
     *
     * Publishes its own two figures rather than leaning on the block above: one that four
     * operators reported and one that only a single operator did. Both have to be in the same
     * file for any of this to mean anything, since what is being measured is that a download
     * treats them differently.
     */
    const PERIOD_DUE = '2025-07-15';
    const PUBLISHED = 'Download sector total';
    const WITHHELD = 'Download thin figure';

    beforeAll(async () => {
      await addIndicator({
        fieldKey: openKey,
        aggregation: PublicAggregation.COUNT,
        label: PUBLISHED,
        unit: 'operators',
        description: 'How many operators reported subscriber numbers.',
        isPublished: true,
      });
      // Reported by one operator, whose figure is 999. It must be withheld everywhere.
      await addIndicator({
        fieldKey: thinKey,
        aggregation: PublicAggregation.AVERAGE,
        label: WITHHELD,
        isPublished: true,
      });
    });

    const fetch = (path: string, query: Record<string, string | number> = {}) =>
      request(server).get(path).query(query);

    const download = async (path: string, query: Record<string, string> = {}) => {
      const res = await fetch(path, query).responseType('blob').expect(200);
      return { body: res.body as Buffer, headers: res.headers };
    };

    /** Every row of a sheet, as strings. Rows rather than a flat list, so a cell can be named. */
    async function readSheet(buffer: Buffer, sheetName: string): Promise<string[][]> {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const sheet = wb.getWorksheet(sheetName);
      const rows: string[][] = [];
      sheet?.eachRow((row) => {
        const cells: string[] = [];
        // `eachCell` skips empty cells, and an empty cell is exactly what one of these tests is
        // looking for, so the row is read by index instead.
        for (let i = 1; i <= (sheet.columnCount || 0); i += 1) {
          cells.push(String(row.getCell(i).value ?? ''));
        }
        rows.push(cells);
      });
      return rows;
    }

    /** The row a figure is on, found by its label in the first column. */
    const rowFor = (rows: string[][], label: string) => rows.find((r) => r[0] === label);

    /**
     * The text inside a PDF.
     *
     * pdfkit compresses its content streams, so searching the raw bytes for a figure would find
     * nothing whatever the document said — a test that passes because it cannot read the file is
     * worse than no test, and this one exists specifically to prove a number is absent. So the
     * FlateDecode streams are inflated and the text operators read back out of them.
     */
    function pdfText(buffer: Buffer): string {
      let content = '';
      let at = 0;
      for (;;) {
        const start = buffer.indexOf('stream', at);
        if (start === -1) break;
        const end = buffer.indexOf('endstream', start);
        if (end === -1) break;
        // Skip the newline that follows the `stream` keyword.
        let from = start + 'stream'.length;
        if (buffer[from] === 0x0d) from += 1;
        if (buffer[from] === 0x0a) from += 1;
        try {
          content += inflateSync(buffer.subarray(from, end)).toString('latin1');
        } catch {
          // Not a deflate stream (an embedded font, say). Nothing to read here.
        }
        at = end + 1;
      }

      /*
       * pdfkit writes each run as a hex string inside a kerning array: `[<48656c6c6f> 20 <21>] TJ`.
       * Decoding every `<...>` group and joining them gives the words back, with the kerning
       * numbers between runs dropped. Good enough to ask whether a figure appears in the document,
       * which is the only question these tests put to it.
       */
      return (content.match(/<([0-9A-Fa-f]+)>/g) ?? [])
        .map((run) => Buffer.from(run.slice(1, -1), 'hex').toString('latin1'))
        .join('');
    }

    it('offers the closed periods a reader may filter between, and names nobody', async () => {
      const res = await fetch('/api/v1/public/periods').expect(200);
      const ours = (res.body as { label: string; dueDate: string }[]).find(
        (p) => p.label === '2025 Q2 public',
      );
      expect(ours).toBeDefined();
      expect(ours!.dueDate.slice(0, 10)).toBe(PERIOD_DUE);
      // A period is a label and a date. Anything about who filed against it belongs elsewhere.
      expect(JSON.stringify(res.body)).not.toContain('Pub Op');
    });

    it('searches what a figure is called', async () => {
      const hit = await fetch('/api/v1/public/indicators', { search: 'sector total' }).expect(200);
      expect(ourIndicators(hit.body, PUBLISHED)).toBeDefined();
      expect(ourIndicators(hit.body, WITHHELD)).toBeUndefined();

      const miss = await fetch('/api/v1/public/indicators', {
        search: 'nothing is called this',
      }).expect(200);
      expect(miss.body.indicators).toHaveLength(0);
    });

    it('searches what a figure means, not only its name', async () => {
      // The description carries the plain-language explanation, and it is what a reader who does
      // not know the Authority's vocabulary will type words from.
      const res = await fetch('/api/v1/public/indicators', { search: 'subscriber' }).expect(200);
      expect(ourIndicators(res.body, PUBLISHED)).toBeDefined();
    });

    it('narrows to one figure when the reader picks one', async () => {
      const all = await fetch('/api/v1/public/indicators').expect(200);
      const one = (all.body.indicators as { id: string; label: string }[]).find(
        (i) => i.label === PUBLISHED,
      )!;

      const res = await fetch('/api/v1/public/indicators', { indicatorId: one.id }).expect(200);
      expect(res.body.indicators).toHaveLength(1);
      expect(res.body.indicators[0].label).toBe(PUBLISHED);
    });

    it('covers only the periods inside the range asked for', async () => {
      const inside = await fetch('/api/v1/public/indicators', {
        from: '2025-01-01',
        to: '2025-12-31',
      }).expect(200);
      expect(
        (inside.body.periods as { label: string }[]).some((p) => p.label === '2025 Q2 public'),
      ).toBe(true);

      // The other direction, which is the half that proves the filter is applied at all: a range
      // the period falls outside of must not carry it.
      const outside = await fetch('/api/v1/public/indicators', {
        from: '2030-01-01',
        to: '2030-12-31',
      }).expect(200);
      expect(
        (outside.body.periods as { label: string }[]).some((p) => p.label === '2025 Q2 public'),
      ).toBe(false);
    });

    it('refuses a filter nobody declared', async () => {
      // The one that would matter: narrowing the figures to a single operator would hand back that
      // operator's return as a sector total, with the threshold none the wiser.
      await fetch('/api/v1/public/indicators', { entityId: 'anything' }).expect(400);
      await fetch('/api/v1/public/indicators', { from: 'not-a-date' }).expect(400);
    });

    it('downloads a workbook that says which figures were withheld', async () => {
      /*
       * The assertion is on the cell, not on the file.
       *
       * An earlier version of this test searched the whole sheet for the word "Withheld" and for
       * the withheld operator's figure. Both passed no matter what the export did: the word is in
       * the closing note anyway, and a withheld point arrives from the portal with its value
       * already null, so the figure was never there to leak. Breaking the export on purpose left
       * the test green, which is how it was caught.
       *
       * What can actually go wrong is quieter than a leak, and this is it: the period reads as
       * blank, a reader takes blank for nought, and a figure the Authority withheld gets quoted as
       * zero. So the cell has to say the word.
       */
      const { body, headers } = await download('/api/v1/public/indicators.xlsx');
      expect(headers['content-disposition']).toContain('sector-figures');
      // A real .xlsx is a zip.
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK');

      const rows = await readSheet(body, 'Sector figures');
      const header = rows.find((r) => r[0] === 'Figure')!;
      const column = header.indexOf('2025 Q2 public');
      expect(column).toBeGreaterThan(0);

      // The figure four operators reported carries a number, so this is not reading a blank sheet.
      const published = rowFor(rows, PUBLISHED)!;
      expect(Number(published[column])).toBe(4);

      // The one only a single operator reported says so, in a word, in the cell.
      const withheld = rowFor(rows, WITHHELD)!;
      expect(withheld[column]).toBe('Withheld');

      // And the file explains itself, because a spreadsheet outlives the page it came from.
      expect(rows.flat().join(' ')).toContain('Withheld is not zero');
    });

    it('says how many operators each figure rests on, without saying which', async () => {
      const { body } = await download('/api/v1/public/indicators.xlsx');
      const rows = await readSheet(body, 'Coverage');
      const header = rows.find((r) => r[0] === 'Figure')!;
      const column = header.indexOf('2025 Q2 public');

      // The count is published on purpose, for the withheld figure too: it is how a reader tells a
      // sector figure from a partial one, and it is what explains why a period says "Withheld".
      expect(Number(rowFor(rows, WITHHELD)![column])).toBe(1);
      expect(Number(rowFor(rows, PUBLISHED)![column])).toBe(4);
      // A count is not a list. No operator is named anywhere in the file.
      expect(rows.flat().join(' ')).not.toContain('Pub Op');
    });

    it('downloads a PDF that withholds the same figure', async () => {
      const { body, headers } = await download('/api/v1/public/indicators.pdf');
      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(headers['content-type']).toContain('application/pdf');

      const text = pdfText(body);
      // The extractor has to work, or every assertion under it is vacuous.
      expect(text).toContain(PUBLISHED);

      /*
       * The word has to be on the withheld figure's own row, not merely somewhere in the document
       * — the closing note mentions it too, so a document-wide search proves nothing.
       *
       * pdfkit writes a row's cells in order with nothing between them, so the label runs straight
       * into its first cell in the extracted text. There is one period in this fixture, so the
       * label followed immediately by the word is the row reading "Withheld".
       */
      expect(text).toContain(`${WITHHELD}Withheld`);
    });

    it('carries the filters into the file, so a download says what it is a view of', async () => {
      const { body } = await download('/api/v1/public/indicators.xlsx', {
        search: 'sector total',
        from: '2025-01-01',
      });
      const rows = await readSheet(body, 'Sector figures');
      const joined = rows.flat().join(' ');

      // Filtered the same way the screen was, and says so. A spreadsheet that looks like the whole
      // sector but holds one filtered view of it is how a partial figure gets quoted as a total.
      expect(joined).toContain('sector total');
      expect(joined).toContain('2025-01-01');
      expect(rowFor(rows, PUBLISHED)).toBeDefined();
      expect(rowFor(rows, WITHHELD)).toBeUndefined();
    });
  });
});
