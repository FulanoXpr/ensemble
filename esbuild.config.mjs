import { context } from 'esbuild'

const isWatch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: !isWatch,
}

const ctx = await context({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
})

if (isWatch) {
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
