// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Node modules that touch the network or spawn processes (constitution §2.1, §5). */
const IO_MODULES = ['dgram', 'net', 'dns', 'child_process'].flatMap((m) => [m, `node:${m}`]);

const ioRestriction = {
  paths: IO_MODULES.map((name) => ({
    name,
    message:
      'Network/process modules are only allowed in apps/server/src/adapters (constitution §2.1).',
  })),
};

/**
 * Layer boundaries (plan §3). Patterns match the import string, so relative imports such as
 * `../adapters/udp-packet-sender` are caught without a resolver.
 * @param {string[]} layers
 * @param {string} from
 */
const layerPatterns = (layers, from) =>
  layers.map((layer) => ({
    group: [`**/${layer}`, `**/${layer}/**`],
    message: `${from} must not import from ${layer}/ (plan §3 boundaries).`,
  }));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.dev-data/**',
      'installer/**',
      '**/fixtures/lint/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', 'scripts/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  // Server: no network/process modules outside adapters.
  {
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/adapters/**'],
    rules: { 'no-restricted-imports': ['error', ioRestriction] },
  },
  {
    files: ['apps/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...ioRestriction,
          patterns: [
            ...layerPatterns(['application', 'adapters', 'db', 'http'], 'domain'),
            {
              group: ['node:*'],
              message: 'domain/ is pure: no Node built-ins (constitution §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { ...ioRestriction, patterns: layerPatterns(['adapters', 'db', 'http'], 'application') },
      ],
    },
  },
  {
    files: ['apps/server/src/http/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { ...ioRestriction, patterns: layerPatterns(['adapters', 'db'], 'http') },
      ],
    },
  },
  {
    files: ['apps/server/src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { ...ioRestriction, patterns: layerPatterns(['adapters', 'http'], 'db') },
      ],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...ioRestriction,
          patterns: [
            { group: ['node:*'], message: 'shared/ runs in the browser too: no Node built-ins.' },
          ],
        },
      ],
    },
  },
  // Web: React hooks rules and the ban on dangerouslySetInnerHTML (ADR-016, ADR-024).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (ADR-016).',
        },
      ],
    },
  },
  // Tests may use console and looser typing on mocks.
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
