import { describe, expect, it } from 'vitest';

/*
 * The component sources, read through Vite rather than the filesystem.
 *
 * This is a browser project and has no Node types, which is the right shape for it — so the
 * sources come in as strings at build time instead. It also means the set is exactly what Vite
 * would bundle, rather than whatever happens to be sitting in the directory.
 */
const SOURCES = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Could Arabic be added without a rewrite?
 *
 * Q9 says English only for the first release, "built i18n-ready so Arabic can be added without a
 * rework". Most of what that costs is not the words — it is every place the layout has a physical
 * side baked into it. `ml-2` means *left*, and in Arabic it should mean *the side text starts on*.
 * There were 82 of those and one logical utility; each one is a decision somebody would have had
 * to make again, one file at a time, months later.
 *
 * Tailwind's logical utilities render identically in a left-to-right page, so the conversion cost
 * nothing to look at and removed the rework. This keeps it that way: the promise is only worth
 * something if it is still true a year from now, and nobody re-reads a standards document before
 * adding a margin.
 */

/** `ml-2`, `text-left`, `border-l` — the physical half, with what to use instead. */
const PHYSICAL: [RegExp, string][] = [
  [/\bml-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'ms-'],
  [/\bmr-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'me-'],
  [/\bpl-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'ps-'],
  [/\bpr-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'pe-'],
  [/\bleft-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'start-'],
  [/\bright-(?:\d+(?:\.\d+)?|auto|full|px|\[[^\]]+\])\b/, 'end-'],
  [/\btext-left\b/, 'text-start'],
  [/\btext-right\b/, 'text-end'],
  [/\bborder-l\b/, 'border-s'],
  [/\bborder-r\b/, 'border-e'],
  [/\brounded-l\b/, 'rounded-s'],
  [/\brounded-r\b/, 'rounded-e'],
];

/**
 * The places a physical side is the right answer, each with the reason.
 *
 * An allow-list rather than a silent exception: adding to it should take a sentence explaining
 * why the element does not belong to the writing direction.
 */
const ALLOWED: { file: string; because: string }[] = [
  {
    file: 'components/layout/Sidebar.tsx',
    because:
      'The mobile panel slides in with `-translate-x-full`, and a transform does not flip with ' +
      'the writing direction. Converting the offset alone would leave it sliding in from the ' +
      'wrong side in Arabic, so this one needs a real decision about the animation rather than a ' +
      'rename — it is not something to guess at with no Arabic build to look at.',
  },
];

describe('right-to-left readiness', () => {
  const files = Object.entries(SOURCES)
    .filter(([path]) => !path.endsWith('.test.tsx'))
    .map(([path, source]) => ({ path: path.replace(/^\.\.\//, ''), source }));

  it('is reading the real component tree', () => {
    // A check that walked an empty directory would pass for ever and mean nothing.
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.path.endsWith('DataTable.tsx'))).toBe(true);
  });

  it('uses logical properties, so a direction change is a setting and not a sweep', () => {
    const offenders: string[] = [];

    for (const { path, source } of files) {
      if (ALLOWED.some((a) => path.endsWith(a.file))) continue;
      source.split('\n').forEach((line, index) => {
        for (const [pattern, instead] of PHYSICAL) {
          const found = pattern.exec(line);
          if (found) offenders.push(`${path}:${index + 1}  ${found[0]} → use ${instead}`);
        }
      });
    }

    if (offenders.length > 0) {
      throw new Error(
        'These pin a layout to the left or the right, which is the part of adding Arabic that ' +
          'costs real work. Tailwind’s logical utilities look identical in English:\n  ' +
          offenders.join('\n  '),
      );
    }
  });

  it('keeps the list of exceptions short, and each one explained', () => {
    // The allow-list is the escape hatch, so it is the thing most likely to quietly grow.
    expect(ALLOWED.length).toBeLessThanOrEqual(3);
    for (const entry of ALLOWED) {
      expect(entry.because.length).toBeGreaterThan(40);
    }
  });
});
