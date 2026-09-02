/**
 * Frontend ESLint config (React + TypeScript + Vite).
 * Formatting is owned by Prettier (see root .prettierrc.json); ESLint owns correctness.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-refresh', 'jsx-a11y', 'copy'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/strict',
    'prettier',
  ],
  settings: { react: { version: 'detect' } },
  env: { browser: true, es2020: true },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'vite.config.ts'],
  rules: {
    // Standards: no explicit any (CODING_STANDARDS §3).
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Enforce the rules-of-hooks and exhaustive deps (server state via TanStack Query).
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // Copy that reads as machine-written fails the build, not review (FRONTEND_STANDARDS §10).
    'copy/no-machine-glyphs': 'error',

    // --- Accessibility (FRONTEND_STANDARDS §6) ---------------------------------------------
    // `jsx-a11y/strict` is the baseline. The three rules below are narrowed rather than switched
    // off, because each one misreads a pattern the ARIA authoring practices actually prescribe,
    // and a rule that cries wolf is a rule people learn to disable in bulk.

    // A `ul` of `li` is the markup the listbox and menu patterns are written in. The rule treats
    // any interactive role on a list as a mistake; here it is the specification.
    'jsx-a11y/no-noninteractive-element-to-interactive-role': [
      'error',
      {
        ul: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
        li: ['menuitem', 'option', 'row', 'tab', 'treeitem'],
        table: ['grid'],
        td: ['gridcell'],
      },
    ],

    // Composite widgets — a tablist, a menu, a calendar grid — are not themselves tabbable. They
    // hold one tab stop and move it between their children with the arrow keys, which is what the
    // pattern asks for and what these components do.
    'jsx-a11y/interactive-supports-focus': [
      'error',
      { tabbable: ['button', 'checkbox', 'link', 'searchbox', 'spinbutton', 'switch', 'textbox'] },
    ],
  },
};
