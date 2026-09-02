/**
 * Backend ESLint config (NestJS + TypeScript).
 * Formatting is owned by Prettier (see root .prettierrc.json); ESLint owns correctness.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'copy'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
  rules: {
    // Copy that reads as machine-written fails the build (FRONTEND_STANDARDS §10 governs both sides).
    'copy/no-machine-glyphs': 'error',
    // Standards: no implicit/explicit any (CODING_STANDARDS §3).
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // No console in committed code — use the Nest Logger.
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};
