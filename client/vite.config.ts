import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sharedRoot = path.resolve(__dirname, '../shared')
// The shared package's CJS dist build may also leave stale .js copies beside
// source files in local monorepo installs. Vite resolves those first.
for (const dir of [sharedRoot, path.join(sharedRoot, 'fsrs'), path.join(sharedRoot, 'vocab')]) {
  if (!fs.existsSync(dir)) continue
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.js')) fs.rmSync(path.join(dir, entry), { force: true })
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vanilla-srs/shared/world': path.resolve(__dirname, '../shared/world.ts'),
      '@vanilla-srs/shared/world-content': path.resolve(__dirname, '../shared/worldContent.ts'),
      '@vanilla-srs/shared/world/ebbinghaus': path.resolve(__dirname, '../shared/ebbinghaus.ts'),
      '@vanilla-srs/shared/fsrs': path.resolve(__dirname, '../shared/fsrs/index.ts'),
      '@vanilla-srs/shared/ebbinghaus': path.resolve(__dirname, '../shared/ebbinghaus.ts'),
      '@vanilla-srs/shared/gamification': path.resolve(__dirname, '../shared/gamification.ts'),
      '@vanilla-srs/shared/vocab': path.resolve(__dirname, '../shared/vocab/index.ts'),
      '@vanilla-srs/shared/word-camp': path.resolve(__dirname, '../shared/word-camp.ts'),
      '@vanilla-srs/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
