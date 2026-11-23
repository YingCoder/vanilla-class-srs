import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'dist/**'],
    alias: {
      '@vanilla-srs/shared/fsrs': path.resolve(__dirname, '../shared/fsrs/index.ts'),
      '@vanilla-srs/shared/word-camp': path.resolve(__dirname, '../shared/word-camp.ts'),
      '@vanilla-srs/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
})
