import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-third-party',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@atd/') ? undefined : { path: args.path, external: true },
        )
      },
    },
  ],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
