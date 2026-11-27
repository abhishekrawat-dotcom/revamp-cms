// The hash of everything the Books build reads (src/, package.json, build.mjs, this file, and the shared book rules
// ../functions/lib/book-rules.js, which the bundle takes in): build.mjs writes it into
// ../books/build.json, and functions/lib/books-build.test.js recomputes it, so committed files that no longer match
// the source (a change made without `npm run build`) fail the release check.
'use strict';
const { createHash } = require('crypto');
const { readFileSync, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');

function sourceHash(root) {
  root = root || __dirname;
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else files.push(p);
    }
  })(join(root, 'src'));
  files.push(join(root, 'package.json'), join(root, 'build.mjs'), join(root, 'source-hash.cjs'), join(root, '..', 'functions', 'lib', 'book-rules.js'));
  const h = createHash('sha256');
  for (const f of files) h.update(relative(root, f).split('\\').join('/') + '\0').update(readFileSync(f)).update('\0');
  return h.digest('hex').slice(0, 32);
}

module.exports = { sourceHash };
