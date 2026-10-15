import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { AUTHORITY_NAME } from './export-format';

/**
 * The Authority's name, spelled one way across everything the server produces.
 *
 * It was spelled four ways. Workbooks and PDFs said "National Communication Authority, South
 * Sudan"; the operator's own return workbook had a sixth copy of the string with the same
 * mistake; the emails said "Republic of South Sudan"; and the printed-sheet header on the client
 * said "Communications", with an s the Authority does not have.
 *
 * None of that is visible in a screenshot of the app. It is visible on the documents that leave
 * the building, which is the worst place for it and the least likely to be looked at. So it is
 * checked against the sources, because a wrong word can be looked for even when nobody would
 * notice it on screen.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe("the Authority's name", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: path
      .slice(SRC.length + 1)
      .split(sep)
      .join('/'),
    source: readFileSync(path, 'utf8'),
  }));

  it('is reading the real source tree', () => {
    // A sweep that found no files would pass for ever and mean nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.path === 'exports/export-format.ts')).toBe(true);
  });

  it('is the one its own seal uses', () => {
    expect(AUTHORITY_NAME).toBe('National Communication Authority, Republic of South Sudan');
  });

  it('is not misspelled anywhere on the server', () => {
    const wrong = [
      // The seal reads NATIONAL COMMUNICATION AUTHORITY, singular.
      /National Communications Authority/,
      // And REPUBLIC OF SOUTH SUDAN beneath it.
      /National Communication Authority, South Sudan/,
    ];
    const offenders = files.flatMap(({ path, source }) =>
      wrong.filter((w) => w.test(source)).map((w) => `${path}  ${String(w)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('is written out in one place, not copied into every file that prints it', () => {
    /*
     * The mistake above survived because the name was a string literal in several files. One of
     * them could be corrected and the others go on being wrong, which is exactly what happened.
     * A new copy is how this comes back.
     */
    const copies = files.filter(
      ({ path, source }) =>
        path !== 'exports/export-format.ts' &&
        source.includes("'National Communication Authority,"),
    );
    expect(copies.map((c) => c.path)).toEqual([]);
  });
});
