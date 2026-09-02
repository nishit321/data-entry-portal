/**
 * Types for the Tailwind config, so the palette can be read from TypeScript.
 *
 * `src/lib/contrast.test.ts` checks colour contrast against the real tokens rather than against a
 * copy of them — a copy drifts, and a contrast check that has drifted is worse than none, because
 * it still reports a pass. Reading the config directly is what makes that possible; this file is
 * only what lets the compiler see its shape.
 */
declare const config: {
  theme?: {
    extend?: {
      colors?: Record<string, Record<string, string> | string>;
    };
  };
};

export default config;
