import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is the vite build output; `dist_probe` is the lib-mode bundle used for jsdom
  // smoke tests. Both are gitignored — linting a 2.7 MB bundle produced ~575 no-undef
  // errors on `global`, which made `npm run lint` unusable as a gate.
  globalIgnores(['dist', 'dist_probe']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Best-effort localStorage / logout / tag-parse catches are intentionally empty
      // (audit P1-31). Silently ignoring them is the documented behaviour; a no-op
      // statement would only add noise.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Vitest globals (describe/it/expect/beforeEach/…) exist only inside the colocated
  // test files and the test setup; declaring them repo-wide would let production code
  // reach for them.
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.js', 'src/test/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        suite: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // Test files export helpers, not components — react-refresh has nothing to refresh.
      'react-refresh/only-export-components': 'off',
    },
  },
])
