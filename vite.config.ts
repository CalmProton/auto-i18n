import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: 'client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/translate': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/github': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
