import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  // Vitest reuses this config so the JSX transform and the Tailwind plugin are identical to
  // the dev/build pipeline. Tests are colocated (*.test.js / *.test.jsx next to the source).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // The suite must not need a live backend: every HTTP call goes through api.js and is
    // mocked. `clearMocks` keeps a spy's call count from leaking between cases.
    clearMocks: true,
    restoreMocks: true,
  },
})