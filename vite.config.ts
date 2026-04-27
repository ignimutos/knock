import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    outDir: '.web-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: './web/client.tsx',
      output: {
        entryFileNames: 'assets/client.js',
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    watch: {
      ignored: [
        '**/runtime/**',
        '**/*.tmp.*',
        '**/*.timestamp-*.mjs',
        '**/*.db-wal',
        '**/*.db-shm',
      ],
    },
  },
})
