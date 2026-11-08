// Eine ESLint-Konfiguration für das ganze Monorepo (pnpm lint).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const WEB = 'apps/web/**/*.{ts,tsx}';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'prototype/**',
      'docker/**',
      'database/**',
      'docs/**',
      '.local/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Frontend: Regeln von Next.js (React, Hooks, Barrierefreiheit), nur für apps/web.
  // Reine ignores-Einträge bleiben global, alle anderen gelten nur für das Frontend.
  ...nextCoreWebVitals.map((config) =>
    Object.keys(config).length === 1 && config.ignores ? config : { ...config, files: [WEB] },
  ),
  {
    files: [WEB],
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web' }, react: { version: '19.3' } },
  },
);
