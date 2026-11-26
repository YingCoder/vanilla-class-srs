import { defineConfig } from 'vitest/config'
import path from 'path'

const sharedAlias = (suffix: string) => ({
  find: `@vanilla-srs/shared${suffix}`,
  replacement: path.resolve(__dirname, `../shared${suffix}`),
})

export default defineConfig({
  test: {
    environment: 'node',
    // VM workers retain Vitest state on Windows hosts with Unicode project paths.
    pool: 'vmThreads',
    experimental: { fsModuleCache: true },
    exclude: ['**/node_modules/**', 'dist/**'],
  },
  plugins: [{
    name: 'shared-source',
    resolve: { extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'] },
    enforce: 'pre',
    resolveId(id, importer) {
      const match = id.match(/^@vanilla-srs\/shared(\/.*)?$/)
      if (!match) return
      void importer
      const suffix = match[1] === '/world-content' ? '/worldContent.ts'
        : match[1] === '/fsrs' ? '/fsrs/index.ts'
        : match[1] === '/vocab' ? '/vocab/index.ts'
        : match[1] ? `${match[1]}.ts` : '/index.ts'
      return path.resolve(__dirname, `../shared${suffix}`)
    },
  }],
  resolve: {
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    alias: [
      { find: '@vanilla-srs/shared/world-content', replacement: path.resolve(__dirname, '../shared/worldContent.ts') },
      sharedAlias('/world.ts'), sharedAlias('/gamification.ts'), sharedAlias('/ebbinghaus.ts'),
      sharedAlias('/stage4.ts'), sharedAlias('/fsrs/index.ts'), sharedAlias('/vocab/index.ts'), sharedAlias('/word-camp.ts'),
      sharedAlias(''),
    ],
  },
})
