// node functions/lib/sparse-overview.test.js — an overview with too little in it to fill its layout gets a picture
// made from what it says (api.js sparseOverviewText / fillSparseOverview; the owner, 28 Oct 2026: Digiplus Awards
// 2027's overview was one short line in half its width). This checks which written overviews count as sparse.
'use strict';
const hooks = require('./api.js')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var PLAN = { sections: [{ id: 'overview', kind: 'custom', image: '', imageUrl: '' }, { id: 'why-enter', kind: 'custom' }] };
function answer(html, css) { return [{ parsed: { sections: [{ id: 'overview', html: html, css: css || '.ov{padding:80px 0;display:grid;grid-template-columns:1fr 1fr;gap:40px}' }, { id: 'why-enter', html: '<section>x</section>', css: '.w{}' }] } }]; }
var SHORT = '<section class="ov"><p class="ov-eyebrow">Overview</p><h2>Honouring the Digital Work That Truly Moved Brands</h2><blockquote>Credible, jury-judged recognition for the year\'s standout digital marketing.</blockquote>' +
  '<p>The Digiplus Awards 2027 from ETBrandEquity celebrate the work that truly moved brands and audiences.</p><p>The shortlisted work comes together in Mumbai.</p></section>';

var t = hooks.sparseOverviewText(answer(SHORT), PLAN);
check('Digiplus\'s overview (a short quote, two short paragraphs, no picture) is sparse; its words are what the picture is made from', t.length > 100 && t.length < hooks.SPARSE_OVERVIEW_CHARS && /Credible, jury-judged recognition/.test(t), t);
check('one with a picture of its own is not', hooks.sparseOverviewText(answer(SHORT.replace('</section>', '<img src="rvimg://x" alt=""></section>')), PLAN) === '' &&
  hooks.sparseOverviewText(answer(SHORT, '.ov{background:url("rvimg://x") center/cover}'), PLAN) === '');
var LONG = '<section class="ov"><h2>Overview</h2>' + Array(12).join('<p>The awards recognise the campaigns, content, media and technology that moved brands and audiences across India this year.</p>') + '</section>';
check('one with enough words to fill its layout is not', hooks.sparseOverviewText(answer(LONG), PLAN) === '');
check('one the plan already gave a picture is not', hooks.sparseOverviewText(answer(SHORT), { sections: [{ id: 'overview', imageUrl: 'https://x/y.png' }] }) === '' &&
  hooks.sparseOverviewText(answer(SHORT), { sections: [{ id: 'overview', photos: ['https://x/a.jpg'] }] }) === '');
check('no overview planned or written: nothing to do', hooks.sparseOverviewText(answer(SHORT), { sections: [{ id: 'why-enter' }] }) === '' &&
  hooks.sparseOverviewText([{ parsed: { sections: [] } }], PLAN) === '');

if (failed) { console.error('sparse-overview: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('sparse-overview: all ' + passed + ' checks passed');
