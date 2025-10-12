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
      include: ['client/**/*.{ts,tsx,vue}'],
      exclude: [
        'client/**/*.d.ts',
        'client/**/types/**',
        'client/main.ts',
        'client/vite-env.d.ts',
      ],
    },
    include: ['tests/client/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./tests/client/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './client'),
      '@client': resolve(__dirname, './client'),
      '@server': resolve(__dirname, './server'),
    },
  },
})
