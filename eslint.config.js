// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Local rule: every exported function (or arrow-function constant) and class needs a `/** ... *\/` docblock. */
/** @type {import('eslint').Rule.RuleModule} */
const requireExportDocs = {
  meta: {
    type: /** @type {const} */ ('suggestion'),
    schema: [],
    messages: { missing: 'Exported {{kind}} "{{name}}" needs a docblock.' },
  },
  create(context) {
    const { sourceCode } = context;
    /** @param {any} node */
    const isFunction = (node) => /^(ArrowFunctionExpression|FunctionExpression)$/.test(node?.type ?? '');
    /** @param {any} exportNode */
    function check(exportNode) {
      const declaration = exportNode.declaration;
      let name;
      let kind;
      if (declaration?.type === 'FunctionDeclaration') [name, kind] = [declaration.id?.name, 'function'];
      else if (declaration?.type === 'ClassDeclaration') [name, kind] = [declaration.id?.name, 'class'];
      else if (declaration?.type === 'VariableDeclaration' && isFunction(declaration.declarations[0]?.init)) {
        [name, kind] = [declaration.declarations[0].id.name, 'function'];
      }
      if (!kind) return;
      const comments = sourceCode.getCommentsBefore(exportNode);
      const last = comments.at(-1);
      if (last?.type === 'Block' && last.value.startsWith('*')) return;
      context.report({ node: exportNode, messageId: 'missing', data: { kind, name } });
    }
    return { ExportNamedDeclaration: check, ExportDefaultDeclaration: check };
  },
};

export default defineConfig(
  {
    ignores: ['dist/', '.astro/', '.cache/', 'node_modules/', 'playwright-report/', 'test-results/', 'coverage/'],
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
    // Readability rules for source code (tests are exempt from the length limits).
    files: ['src/**/*.{ts,vue,astro}', 'scripts/**/*.ts', 'integrations/**/*.ts'],
    rules: {
      'id-length': ['error', { min: 2, properties: 'never' }],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack', 'xxx'], location: 'anywhere' }],
    },
  },
  {
    files: ['src/**/*.{ts,vue}', 'integrations/**/*.ts'],
    plugins: { local: { rules: { 'require-export-docs': requireExportDocs } } },
    rules: { 'local/require-export-docs': 'error' },
  },
  {
    // Tests follow the naming rules too (no length limits on test bodies).
    files: ['tests/**/*.ts', '*.config.ts', 'scripts/**/*.ts'],
    rules: { 'id-length': ['error', { min: 2, properties: 'never' }], 'no-debugger': 'error' },
  },
  {
    // A composable declares its state and wires it up; the work itself lives in helpers under the 40-line limit.
    files: ['src/composables/use*.ts'],
    rules: { 'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Command-line scripts report progress on stdout.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
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
