import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default defineConfig(
  { ignores: ['out/**', 'dist/**', 'release/**', 'legacy/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/worker/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
