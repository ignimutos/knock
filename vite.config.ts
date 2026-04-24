import { defineConfig } from 'vite'
import { fresh } from '@fresh/plugin-vite'

export default defineConfig({
  plugins: [
    fresh({
      serverEntry: './web/main.ts',
      clientEntry: './web/client.ts',
      routeDir: './web/routes',
      islandsDir: './web/islands',
    }),
  ],
  server: {
    watch: {
      ignored: ['**/*.tmp.*', '**/*.timestamp-*.mjs', '**/*.db-wal', '**/*.db-shm'],
    },
  },
})
