import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['client/src/**/*.{ts,tsx,vue}'],
      exclude: [
        'client/src/**/*.d.ts',
        'client/src/**/types/**',
        'client/src/main.ts',
        'client/src/vite-env.d.ts',
      ],
    },
    include: ['tests/client/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./tests/client/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './client/src'),
      '@client': resolve(__dirname, './client/src'),
      '@server': resolve(__dirname, './server'),
    },
  },
})
