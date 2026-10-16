// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/',
      '.astro/',
      '.cache/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      'worker/dist/',
      'coverage/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] } },
    rules: {
      // TypeScript (vue-tsc) checks undefined identifiers, including type namespaces.
      'no-undef': 'off',
      // Component names follow the design brief (e.g. Omnibox).
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Formatting is Prettier's job.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
  {
    // Only the GBIF client may know GBIF URLs.
    files: ['src/**/*.{ts,vue,astro}'],
    ignores: ['src/lib/gbif/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/api\\.gbif\\.org/]',
          message: 'Use the client in src/lib/gbif instead of GBIF URLs.',
        },
      ],
    },
  },
);
