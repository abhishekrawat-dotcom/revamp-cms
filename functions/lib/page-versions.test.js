/* Every CMS page names its own stylesheets and scripts by content hash as it is sent (lib/delivery.js
   versionPageAssets, called by server.js), so a release never pairs a new page with a stylesheet or script the browser
   kept from before (owner, 9 Nov: the console's new bar showed unstyled right after a release). Plain node. */
'use strict';
var fs = require('fs'), path = require('path');
var D = require('./delivery'), access = require('./access');
var ROOT = path.join(__dirname, '..', '..');
var fails = 0, n = 0;
function check(name, ok, info){ n++; if (!ok){ fails++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 400) : '')); } }
var H = function (p) { return D.assetVersion(p); };

/* 1. what is stamped and what is left alone */
var html = [
  '<link rel="stylesheet" href="edit-event.css">',
  '<link rel="stylesheet" href="edit-event.css?v=bar3">',
  '<link rel="icon" href="assets/favicon.svg">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
  '<!-- <script src="auth.js"></script> -->',
  '<script src="auth.js"></script>',
  '<script src="/templates/_shared/rv-pages.js" defer></script>',
  '<script>var s = \'<script src="auth.js"><\\/script>\'; var t = "<link rel=\\"stylesheet\\" href=\\"edit-event.css\\">";</script>',
  '<script src="no-such-file.js"></script>',
  '<script src="auth.js?x=1"></script>',
  '<script src="//cdn.example.com/x.js"></script>',
  '<script type="application/json">{"src":"auth.js"}</script>'
].join('\n');
var out = D.versionPageAssets(html, '/edit-event.html').split('\n');
check('1 a stylesheet of ours is named by its hash', out[0] === '<link rel="stylesheet" href="edit-event.css?v=' + H('/edit-event.css') + '">' && H('/edit-event.css').length === 10, out[0]);
check('1 a hand-made ?v= is replaced by the hash', out[1] === out[0], out[1]);
check('1 an icon, another host\'s stylesheet and a comment are left alone', out[2] === '<link rel="icon" href="assets/favicon.svg">' &&
  out[3] === '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' && out[4] === '<!-- <script src="auth.js"></script> -->', out.slice(2, 5));
check('1 a script of ours, relative or from the root, keeps its other attributes', out[5] === '<script src="auth.js?v=' + H('/auth.js') + '"></script>' &&
  out[6] === '<script src="/templates/_shared/rv-pages.js?v=' + H('/templates/_shared/rv-pages.js') + '" defer></script>', out.slice(5, 7));
check('1 what an inline script says is left exactly as it is', out[7] === html.split('\n')[7], out[7]);
check('1 a file we do not have, another query, another host and a data block are left alone',
  out[8] === '<script src="no-such-file.js"></script>' && out[9] === '<script src="auth.js?x=1"></script>' &&
  out[10] === '<script src="//cdn.example.com/x.js"></script>' && out[11] === '<script type="application/json">{"src":"auth.js"}</script>', out.slice(8));
check('1 a page in a folder resolves its relative files from that folder',
  D.versionPageAssets('<script src="mailer-studio.js"></script>', '/promo-studio/x.html') === '<script src="mailer-studio.js?v=' + H('/promo-studio/mailer-studio.js') + '"></script>' && H('/promo-studio/mailer-studio.js') !== '');

/* 2. every page the server sends: only ?v= is added, and every one of our own stylesheets and scripts gets one */
var pages = [];
(function walk(dir){
  fs.readdirSync(path.join(ROOT, dir)).forEach(function (f) {
    var rel = dir ? dir + '/' + f : f;
    if (/^(node_modules|functions|tools|\.)/.test(rel)) return;
    var st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (rel.split('/').length < 3) walk(rel); return; }
    if (/\.html$/.test(f) && access.isServableFile(rel)) pages.push(rel);
  });
})('');
check('2 the CMS pages are found', pages.length >= 15 && pages.indexOf('edit-event.html') !== -1 && pages.indexOf('custom_editor.html') !== -1, pages.length);
var missed = [], changed = [], stamped = 0;
pages.forEach(function (rel) {
  var src = fs.readFileSync(path.join(ROOT, rel), 'utf8'), res = D.versionPageAssets(src, '/' + rel);
  if (res.replace(/(\.(?:css|js))\?v=[0-9a-f]{10}(?=["'])/g, '$1') !== src.replace(/(\.(?:css|js))\?v=[A-Za-z0-9._-]*(?=["'])/g, function (all, ext) {
    return all; })) changed.push(rel);
  var tags = res.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1');
  (tags.match(/<script\b[^>]*\bsrc="[^"]+"|<link\b[^>]*rel="stylesheet"[^>]*>/gi) || []).forEach(function (t) {
    var ref = (/(?:src|href)="([^"]+)"/.exec(t) || [])[1] || '';
    if (/^(https?:)?\/\//.test(ref) || !/\.(css|js)(\?|$)/.test(ref)) return;
    var bare = ref.replace(/\?.*$/, ''), abs = bare.charAt(0) === '/' ? bare : path.posix.normalize(path.posix.dirname('/' + rel) + '/' + bare);
    if (!D.assetVersion(abs)) return;
    if (ref === bare + '?v=' + D.assetVersion(abs)) stamped++; else missed.push(rel + ': ' + ref);
  });
});
check('2 on every page only ?v= is added, nothing else changes', changed.length === 0, changed);
check('2 on every page each of our own stylesheets and scripts is named by its hash', missed.length === 0 && stamped > 100, { missed: missed.slice(0, 8), stamped: stamped });
check('2 no page carries a hand-made version mark any more', pages.every(function (rel) { return !/\.(css|js)\?v=[a-z]/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')); }));

/* 3. server.js stamps every page it sends, keys its compressed copy by what it sends, and keeps a current hash a year */
var SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check('3 server.js stamps each .html it sends', /const \{ assetVersion, versionPageAssets \} = require\('\.\/functions\/lib\/delivery'\);/.test(SERVER) &&
  /if \(ext === '\.html'\)\{\s*const text = versionPageAssets\(buf\.toString\('utf8'\), url\);/.test(SERVER) &&
  /key \+= '\|' \+ require\('crypto'\)\.createHash\('sha1'\)\.update\(body\)/.test(SERVER));
check('3 a current hash is kept a year, anything else 5 minutes, a page never',
  /if \(versioned\) return 'public, max-age=31536000, immutable';/.test(SERVER) && /const versioned = !!v && ext !== '\.html' && v\[1\] === assetVersion\(url\);/.test(SERVER) &&
  /if \(ext === '\.html'\) return 'no-store';/.test(SERVER));

console.log(fails ? 'page-versions: ' + fails + ' of ' + n + ' checks FAILED' : 'page-versions: all ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
