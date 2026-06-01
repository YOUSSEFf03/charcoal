// @ts-check
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // An unhandled rejection from a floating promise can crash the Node
      // process. Enforce explicit await / .catch() / void at every call site.
      '@typescript-eslint/no-floating-promises': 'error',
      // Warn on explicit `any` so that existing eslint-disable comments in
      // spec files remain purposeful rather than flagged as "unused directives".
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
