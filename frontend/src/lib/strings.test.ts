import { describe, expect, it } from 'vitest';
import { strings } from './strings';

/*
 * The component sources as Vite sees them. This is a browser project with no Node types, so the
 * files arrive as strings at build time rather than through the filesystem.
 */
const SOURCES = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Is the shared copy still shared?
 *
 * A strings module is easy to add and easy to walk past. The next person writing a dialog types
 * `Cancel` because that is what the button says, and nothing stops them — which is how there came
 * to be twenty-seven of them in the first place, along with eight spellings of the same idea
 * across the filter bars.
 *
 * So this reads the components back and fails when one of these words is written out by hand
 * again. It is the same shape as the audit census on the server: the module is the claim, and this
 * is what makes the claim cost something.
 */

/** Flatten `strings` to the leaf values, with the path that should have been used. */
function leaves(node: unknown, path: string[] = []): { text: string; where: string }[] {
  if (typeof node === 'string') return [{ text: node, where: `strings.${path.join('.')}` }];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
  }
  return [];
}

/** The props that carry words somebody reads. `id`, `htmlFor` and `name` are not copy. */
const COPY_PROPS = ['label', 'placeholder', 'aria-label', 'title', 'hint'];

describe('shared strings', () => {
  const files = Object.entries(SOURCES)
    .filter(([path]) => !path.endsWith('.test.tsx'))
    .map(([path, source]) => ({ path: path.replace(/^\.\.\//, ''), source }));

  it('is reading the real component tree', () => {
    // A check that found no files would pass for ever and mean nothing.
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.path.endsWith('UsersPage.tsx'))).toBe(true);
  });

  it('has no duplicates hiding in it', () => {
    // Two keys with the same words is the drift this module exists to stop, arriving inside the
    // module itself.
    const all = leaves(strings);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { text, where } of all) {
      const first = seen.get(text);
      if (first) clashes.push(`"${text}" is both ${first} and ${where}`);
      else seen.set(text, where);
    }
    expect(clashes).toEqual([]);
  });

  it('is not written out by hand anywhere else', () => {
    const all = leaves(strings);
    const offenders: string[] = [];

    /*
     * Scanned over the whole file rather than line by line.
     *
     * A JSX text node usually sits on its own line, between the opening tag on the line above and
     * the closing tag on the line below — so a per-line search finds no `>` or `<` beside it and
     * quietly passes. This guard did exactly that until it was tested by putting a hard-coded
     * "Cancel" back and watching it stay green.
     */
    for (const { path, source } of files) {
      for (const { text, where } of all) {
        const quoted = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          new RegExp(`\\b(?:${COPY_PROPS.join('|')})="${quoted}"`, 'g'),
          // A JSX text node holding exactly this and nothing else, however it is wrapped.
          new RegExp(`>[\\s\\n]*${quoted}[\\s\\n]*<`, 'g'),
        ];
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) {
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${path}:${line}  "${text}" — use ${where}`);
          }
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        'This copy appears on more than one screen, so it lives in `lib/strings.ts`. Writing it ' +
          'out again is how two halves of the same job end up worded differently:\n  ' +
          offenders.join('\n  '),
      );
    }
  });
});
