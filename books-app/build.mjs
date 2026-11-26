// Builds the Books editor (BOOKSTUDIO) into ../books/, the folder EventSphere serves at /books/…:
//   app.js      the React app, one minified file (esbuild)
//   app.css     its styles (Tailwind, from src/index.css and the classes the source uses)
//   build.json  { sourceHash }: the hash of everything the build reads, so a test can tell when the
//               committed files no longer match the source (functions/lib/books-build.test.js)
// Run from this folder: `npm run build` (after `npm install`). Production never runs this: App Hosting
// serves the committed files in ../books/.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const { sourceHash } = createRequire(import.meta.url)('./source-hash.cjs');
const out = join(here, '..', 'books');
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110', 'safari16', 'firefox115', 'edge110'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  outfile: join(out, 'app.js'),
  logLevel: 'warning'
});

execFileSync(join(here, 'node_modules', '.bin', 'tailwindcss'),
  ['-i', join(here, 'src', 'index.css'), '-o', join(out, 'app.css'), '--minify'],
  { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] });

writeFileSync(join(out, 'build.json'), JSON.stringify({ sourceHash: sourceHash(here) }, null, 2) + '\n');
const kb = (f) => Math.round(statSync(join(out, f)).size / 1024) + ' KB';
console.log('books: app.js ' + kb('app.js') + ', app.css ' + kb('app.css'));
