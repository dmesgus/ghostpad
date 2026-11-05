import { build } from 'esbuild';

await build({
  entryPoints: ['web/src/super-fill.tsx'],
  outfile: 'web/super-fill.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2018',
  tsconfig: 'tsconfig.ui.json',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
});
