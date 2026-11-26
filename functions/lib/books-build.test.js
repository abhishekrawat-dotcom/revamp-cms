// node functions/lib/books-build.test.js — the Books editor (books-app/, built into books/ by books-app/build.mjs): the
// committed build matches its source (books/build.json's hash), it is a script a browser can run, and the rules Phase 1
// set for the editor's code hold (docs/bookstudio/PLAN.md): it talks only to EventSphere's server, through the page's
// sign-in; nothing of the AI Studio export's Firebase client or open server came along; exports draw each photo's
// full-size copy; no made-up source line is written under an infographic; the sample photos exist with their true sizes.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app'), OUT = path.join(ROOT, 'books');
function read(p) { return fs.readFileSync(p, 'utf8'); }
function walk(dir) { return fs.readdirSync(dir).sort().reduce(function (a, n) { var p = path.join(dir, n); return a.concat(fs.statSync(p).isDirectory() ? walk(p) : [p]); }, []); }

/* ---------- 1 the build ---------- */
var built = JSON.parse(read(path.join(OUT, 'build.json')));
var now = require(path.join(APP, 'source-hash.cjs')).sourceHash(APP);
check('1.1 books/ was built from the source as it is now (run `npm run build` in books-app/ after a change)', built.sourceHash === now, { built: built.sourceHash, source: now });
var js = read(path.join(OUT, 'app.js'));
var parses = (function () { try { new vm.Script(js, { filename: 'books/app.js' }); return true; } catch (e) { return e.message; } })();
check('1.2 books/app.js is one script a browser can run', parses === true, parses);
check('1.3 …and it carries no secret, key or Firebase project of the AI Studio export', !/AIza[0-9A-Za-z_-]{20,}/.test(js) && !/gen-lang-client-/.test(js) && !/GEMINI_API_KEY|ANTHROPIC_API_KEY/.test(js));
check('1.4 books/app.css holds the editor\'s styles', /\.bg-\\\[\#121214\\\]/.test(read(path.join(OUT, 'app.css'))) || /#121214/.test(read(path.join(OUT, 'app.css'))));

/* ---------- 2 the editor's code ---------- */
var files = walk(path.join(APP, 'src')).filter(function (f) { return /\.(ts|tsx)$/.test(f); });
var all = files.map(function (f) { return { f: path.relative(APP, f), s: read(f) }; });
var fb = all.filter(function (x) { return /from ['"]firebase/.test(x.s); }).map(function (x) { return x.f; });
check('2.1 no Firebase client in the editor: sign-in is the page\'s (auth.js)', fb.length === 0, fb);
var direct = all.filter(function (x) { return x.f !== 'src/services/api.ts' && /fetch\(\s*['"`]\/api\//.test(x.s); }).map(function (x) { return x.f; });
check('2.2 every call to the server goes through services/api.ts (the page\'s authedFetch)', direct.length === 0, direct);
var API = read(path.join(APP, 'src', 'services', 'api.ts'));
check('2.3 …which sends it with the sign-in, to /api/books', /window\.RevampAuth/.test(API) && /authedFetch\(BASE \+ path/.test(API) && /const BASE = '\/api\/books';/.test(API));
check('2.4 the AI Studio export\'s endpoints are gone', !all.some(function (x) { return /\/api\/(uploads|storage|fonts\/google|ai\/)/.test(x.s); }));
var EXP = read(path.join(APP, 'src', 'engines', 'exportEngine.ts'));
check('2.5 exports draw an uploaded photo\'s full-size copy', /loadImageElement\(printSourceOf\(el\.image\.src\)\)/.test(EXP) && /\/display\$\/, '\$1\/print'\)/.test(EXP));
check('2.6 no made-up source line under an infographic', !all.some(function (x) { return /Generated in BOOKSTUDIO/.test(x.s); }));
var STORE = read(path.join(APP, 'src', 'services', 'storageService.ts'));
check('2.7 a save names the revision it was based on, one save at a time per book', /apiSend<\{ rev: number \}>\('PUT', '\/book', \{ book: project, baseRev \}\)/.test(STORE) && /if \(running\) return running;/.test(STORE));
var APPX = read(path.join(APP, 'src', 'App.tsx'));
check('2.8 the hidden sample book is never saved, never edited', /if \(proj\.id === PLACEHOLDER_ID\) return;/.test(APPX) && /if \(!current \|\| current\.id === PLACEHOLDER_ID\) return prevList;/.test(APPX));
check('2.9 a refused save offers "Reload the latest" and "Keep mine as a copy"', /Reload the latest/.test(APPX) && /Keep mine as a copy/.test(APPX) && /err\.code === 'stale'/.test(APPX));
check('2.10 an undone change is saved like any other', (APPX.match(/autosaveTimerRef\.current = window\.setTimeout\(\(\) => void persistProjectNow\((previous|restored)\), 1600\);/g) || []).length === 2);
check('2.11 leaving with unsaved changes asks first', /addEventListener\('beforeunload', onLeave\)/.test(APPX));

/* ---------- 3 the sample photos ---------- */
var CUR = read(path.join(APP, 'src', 'data', 'curatedAssets.ts'));
var sharp = null; try { sharp = require('sharp'); } catch (e) { /* sizes checked by name only */ }
var samples = (CUR.match(/'\/books\/samples\/[^']+'/g) || []).map(function (s) { return s.slice(1, -1); });
check('3.1 five sample photos, each served from books/samples/', samples.length === 5 && samples.every(function (s) { return fs.existsSync(path.join(ROOT, s)); }), samples);

(async function () {
  if (sharp) {
    var sizes = {};
    for (var i = 0; i < samples.length; i++) { var m = await sharp(path.join(ROOT, samples[i])).metadata(); sizes[path.basename(samples[i])] = m.width + 'x' + m.height; }
    var wrong = [];
    (CUR.match(/url: EDITORIAL_PHOTOS\.(\w+),\s*widthPx: (\d+),\s*heightPx: (\d+)/g) || []).forEach(function (blk) {
      var mm = /EDITORIAL_PHOTOS\.(\w+),\s*widthPx: (\d+),\s*heightPx: (\d+)/.exec(blk);
      var file = path.basename((new RegExp(mm[1] + ": '([^']+)'").exec(CUR) || [])[1] || '');
      if (sizes[file] !== mm[2] + 'x' + mm[3]) wrong.push(file + ' says ' + mm[2] + 'x' + mm[3] + ', is ' + sizes[file]);
    });
    check('3.2 …with their true pixel sizes (the print check\'s resolution warning depends on them)', wrong.length === 0, wrong);
  }
  process.stdout.write('books-build: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
