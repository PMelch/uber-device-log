import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import { flowStyleFiles } from './scripts/style-scope.mjs';

export default defineConfig(
  {
    files: flowStyleFiles,
    extends: [js.configs.recommended, tseslint.configs.recommended, vue.configs['flat/essential']],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // TypeScript owns global/name resolution, including browser and worker APIs.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      eqeqeq: ['error', 'smart'],
      'vue/no-v-html': 'error',
    },
  },
  {
    files: ['shared/flow-blueprints.ts'],
    // This boundary inspects unknown YAML incrementally before narrowing.
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
