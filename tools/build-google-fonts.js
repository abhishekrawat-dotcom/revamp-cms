/* node tools/build-google-fonts.js — writes functions/lib/data/google-fonts.json from Google Fonts' own catalogue
   (https://fonts.google.com/metadata/fonts): every family a generated site may set its type in, and the upright
   weights each one has. Families Google marks as not open source are left out (its own Noto families are
   marked a brand's but are open source, OFL, and stay).
   Run again when Google adds families; nothing else reads the network for it. */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'functions', 'lib', 'data', 'google-fonts.json');
const CATEGORY = { 'Sans Serif': 's', Serif: 'r', Display: 'd', Handwriting: 'h', Monospace: 'm' };

fetch('https://fonts.google.com/metadata/fonts').then(function (r) {
  if (r.status !== 200) throw new Error('Google Fonts answered ' + r.status);
  return r.text();
}).then(function (text) {
  const list = JSON.parse(text.replace(/^\)\]\}'\s*/, '')).familyMetadataList || [];
  const families = {};
  list.forEach(function (f) {
    if (!f || !f.family || f.isOpenSource === false) return;
    const weights = Object.keys(f.fonts || {}).filter(function (k) { return /^\d{3}$/.test(k); }).map(Number).sort(function (a, b) { return a - b; });
    if (!weights.length) return;
    families[f.family] = [CATEGORY[f.category] || 's'].concat(weights);
  });
  const names = Object.keys(families);
  if (names.length < 1000) throw new Error('only ' + names.length + ' families — not written');
  const out = { source: 'https://fonts.google.com/metadata/fonts', built: new Date().toISOString().slice(0, 10),
    note: 'family -> [category (s sans, r serif, d display, h handwriting, m mono), ...upright weights]', families: families };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(names.length + ' families written to ' + path.relative(process.cwd(), OUT));
}).catch(function (err) { console.error(err.message); process.exit(1); });
