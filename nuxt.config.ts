import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  compatibilityDate: '2026-04-20',
  ssr: false,
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    // better-sqlite3 is a native addon — keep external from bundlers so it
    // is require()'d at runtime rather than pulled into a chunk.
    externals: {
      external: ['better-sqlite3'],
    },
    rollupConfig: {
      external: ['better-sqlite3'],
    },
  },
})
