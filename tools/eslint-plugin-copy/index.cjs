/**
 * Typographic rules for user-facing copy (FRONTEND_STANDARDS §10), enforced rather than documented.
 *
 * §10 already banned em-dash-stacked prose. It was written down, agreed, and then broken anyway —
 * by the very pass that wrote it. A rule a person has to remember is a rule that decays; this one
 * fails the build instead.
 *
 * It reads string literals, template chunks, and JSX text. Comments are untouched: they are for
 * the next engineer, not for the Authority, and an em-dash there costs nothing.
 */

const EM_DASH_MESSAGE =
  'Em-dash in user-facing copy. Use two sentences, a comma, or a colon. For a separator between values use joinMeta() (FRONTEND_STANDARDS §10).';

/** Rules that apply to a plain string or to JSX text. */
const TEXT_RULES = [
  {
    // An em-dash *between* characters is prose rhythm or a separator. A lone `—` is the "no value"
    // glyph a table cell shows, which is a legitimate typographic convention and stays.
    pattern: /\S\s*—|—\s*\S/u,
    message: EM_DASH_MESSAGE,
  },
  {
    pattern: /–/u,
    message: 'En-dash in user-facing copy. Write "to" for ranges (FRONTEND_STANDARDS §10).',
  },
  {
    pattern: /→|←|⇒/u,
    message:
      'Arrow glyph in user-facing copy. Write the word ("to", "changed to"), or use a lucide icon (FRONTEND_STANDARDS §10).',
  },
  {
    pattern: /[“”„]/u,
    message:
      'Curly quotation marks in user-facing copy. A chip or a label carries its own framing (FRONTEND_STANDARDS §10).',
  },
  {
    pattern: /’/u,
    message:
      "Curly apostrophe. Use a plain ' in string literals and &apos; in JSX text (FRONTEND_STANDARDS §10).",
  },
  {
    pattern: /·/u,
    message:
      'Separator dot typed inline. Compose the parts with joinMeta() so the separator stays canonical (FRONTEND_STANDARDS §10).',
  },
];

/**
 * Inside a template literal the same glyph hides from the neighbour test, because
 * `` `${a} — ${b}` `` splits into chunks and the middle one is just " — " with nothing either
 * side of it. A bare em-dash placeholder is always written as a plain string, never as a
 * template, so within a template any em-dash is a separator or prose — both banned.
 */
const TEMPLATE_RULES = [{ pattern: /—/u, message: EM_DASH_MESSAGE }, ...TEXT_RULES.slice(1)];

/**
 * Files whose strings no user reads: the rule's own source, and test files, where an em-dash in a
 * `describe()` title is a note to an engineer like any other comment.
 */
const EXEMPT =
  /[\\/]eslint-plugin-copy[\\/]|\.(test|spec)\.[jt]sx?$|[\\/]__tests__[\\/]|[\\/]format\.ts$/u;

function check(context, node, text, rules) {
  if (typeof text !== 'string' || text.trim() === '') return;
  for (const { pattern, message } of rules) {
    if (pattern.test(text)) {
      context.report({ node, message });
      return;
    }
  }
}

module.exports = {
  rules: {
    'no-machine-glyphs': {
      meta: {
        type: 'problem',
        docs: { description: 'Ban typographic glyphs that read as machine-written copy.' },
        schema: [],
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        if (EXEMPT.test(filename)) return {};
        return {
          Literal(node) {
            check(context, node, node.value, TEXT_RULES);
          },
          TemplateElement(node) {
            check(context, node, node.value.raw, TEMPLATE_RULES);
          },
          JSXText(node) {
            check(context, node, node.value, TEXT_RULES);
          },
        };
      },
    },
  },
};
