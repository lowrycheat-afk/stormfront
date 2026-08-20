import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  plugins: [
    electron({
      main: {
        entry: 'electron/main.ts'
      },
      preload: {
        input: 'electron/preload.ts'
      }
    })
  ]
})