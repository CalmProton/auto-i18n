import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: 'client',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client'),
      '@client': path.resolve(__dirname, './client'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/translate': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/github': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
