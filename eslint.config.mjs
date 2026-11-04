import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '**/jest.config.cjs',
      '**/playwright-report/**',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Test files compile under each package's tsconfig.test.json (jest types, test/ root).
    files: ['apps/api/test/**/*.ts', 'packages/ingestion/test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/api/tsconfig.test.json', 'packages/ingestion/tsconfig.test.json'],
      },
    },
  },
  { files: ['**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
