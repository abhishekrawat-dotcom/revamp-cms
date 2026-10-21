/* node tools/reimport-lovable.js --event <id> [--url <lovable url>] [--html <captured.html>] [--dry]
   node tools/reimport-lovable.js --event <id> --set-template <templateId>          (put a template back)

   Imports an event's Lovable site again, with today's capture (lovable-scraper-service capturePage: every tab's
   content, every FAQ answer, the top bar's scrolled look…), and points the event at the new import. For an event
   created from a Lovable URL whose site has NOT been saved yet: its page is still the import itself, so a new
   import loses nothing. An event with a saved or published site is refused — its page is the owner's work now.
     - the capture runs on this machine's Chrome (puppeteer-core: RV_PUPPETEER / CHROME_PATH, else the usual
       places), the same code the scraper service runs; --html uses a capture made already;
     - the new import gets a new id (events/import-<new id>): the old one stays as it was, so putting the
       event back is one command (printed at the end), and the editor's copy in the owner's browser (kept per
       template) is not mistaken for the new one;
     - the owner's editor preview (site/drafts/…) is left alone: it shows the old page until the owner opens
       the editor again and presses Preview.
   --dry  captures and builds the import in memory, says what it would write, writes nothing.
   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  var file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
})();

const args = process.argv.slice(2);
function arg(name) { var i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1].trim() : ''; }
const DRY = args.indexOf('--dry') !== -1;
const EVENT = arg('--event');
const URL_ARG = arg('--url');
const HTML_ARG = arg('--html');
const SET_TEMPLATE = arg('--set-template');
if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(EVENT) || (SET_TEMPLATE && !/^imported-[a-z0-9][a-z0-9-]{0,59}$/.test(SET_TEMPLATE))) {
  console.error('usage: node tools/reimport-lovable.js --event <id> [--url <lovable url>] [--html <captured.html>] [--dry]\n' +
    '       node tools/reimport-lovable.js --event <id> --set-template imported-<import id>');
  process.exit(2);
}

const { getFirebase } = require('../functions/lib/firebase');
const api = require('../functions/lib/api');
const pictures = require('../functions/lib/pictures');
const H = api._testHooks;

function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', 'puppeteer', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];

async function capture(url) {
  if (HTML_ARG) return fs.readFileSync(HTML_ARG, 'utf8');
  const puppeteer = driver();
  if (!puppeteer || !CHROME) throw new Error('no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER), or pass --html');
  const scraper = require('../lovable-scraper-service/server.js');
  const bad = await scraper.validateUrl(url);
  if (bad) throw new Error(bad);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  try { return await scraper.capturePage(await browser.newPage(), url); } finally { await browser.close(); }
}

function count(html, re) { return (html.replace(/<script\b[\s\S]*?<\/script>/gi, '').match(re) || []).length; }

async function main() {
  const fb = getFirebase();
  if (fb.error) throw new Error('Firebase: ' + fb.error);
  const ref = fb.db.collection('events').doc(EVENT);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('no event "' + EVENT + '"');
  const ev = snap.data();
  const oldTemplate = String(ev.templateId || '');
  if (!/^imported-/.test(oldTemplate)) throw new Error('"' + EVENT + '" was not made from an import (templateId ' + oldTemplate + ')');
  const saved = (ev.site && +ev.site.version) || 0;
  const [pageThere] = await fb.bucket.file('events/' + EVENT + '/site/page.html').exists();
  const published = !!ev.published;
  console.log(EVENT + ': template ' + oldTemplate + ', saved version ' + saved + ', saved page ' + (pageThere ? 'yes' : 'no') + ', published ' + (published ? 'yes' : 'no'));

  if (SET_TEMPLATE) {
    const [doc] = await Promise.all([fb.db.collection('events').doc('import-' + SET_TEMPLATE.slice(9)).get()]);
    if (!doc.exists) throw new Error('no import ' + SET_TEMPLATE);
    console.log((DRY ? 'would set' : 'setting') + ' templateId ' + oldTemplate + ' -> ' + SET_TEMPLATE);
    if (!DRY) await ref.update({ templateId: SET_TEMPLATE, updatedAt: new Date().toISOString() });
    return;
  }

  if (saved || pageThere || published) throw new Error('"' + EVENT + '" has a saved or published site: its page is the owner\'s work, not the import — refusing');
  const oldImport = await fb.db.collection('events').doc('import-' + oldTemplate.slice(9)).get();
  const url = URL_ARG || (oldImport.exists && oldImport.data().sourceUrl) || '';
  if (!/^https?:\/\//.test(url)) throw new Error('no Lovable address: pass --url');
  console.log('capturing ' + url + (HTML_ARG ? ' (from ' + HTML_ARG + ')' : ' on this machine\'s Chrome') + '…');
  const raw = await capture(url);
  console.log('captured ' + raw.length + ' characters: ' + count(raw, /data-rv-tab="/g) + ' tabs, ' + count(raw, /data-rv-tabpanel="/g) + ' tab panels, ' +
    count(raw, /data-rv-scrolled-class=/g) + ' top-bar changes on scroll, ' + count(raw, /aria-expanded=/g) + ' rows that open');

  const newId = 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  let target = fb, store = null;
  if (DRY) {
    store = {};
    target = {
      bucket: { name: fb.bucket.name, file: function (p) { return { save: async function (b) { store[p] = b; }, makePublic: async function () {}, exists: async function () { return [false]; } }; } },
      db: { collection: function () { return { doc: function () { return { set: async function () {} }; } }; } }
    };
    pictures.storeVariants = async function () {};
  }
  const result = await H.importRenderedPage(target, newId, url, raw);
  if (DRY) {
    const doc = JSON.parse(store['events/import-' + newId + '/sections.json'].toString('utf8'));
    console.log('would write events/import-' + newId + '/ (' + Object.keys(store).length + ' files: index.html, section.html, sections.json and pictures) with ' +
      doc.sections.length + ' sections: ' + doc.sections.map(function (s) { return s.id; }).join(', '));
    console.log('would set ' + EVENT + ' templateId ' + oldTemplate + ' -> ' + result.templateId + ' (nothing written)');
    return;
  }
  await ref.update({ templateId: result.templateId, updatedAt: new Date().toISOString() });
  console.log('imported as ' + result.templateId + '; ' + EVENT + ' now uses it (was ' + oldTemplate + ').');
  console.log('to put it back: node tools/reimport-lovable.js --event ' + EVENT + ' --set-template ' + oldTemplate);
  console.log('the owner opens the editor (it builds the page from the new import), then Preview, to refresh /preview/' + EVENT + '?draft=1');
}

main().then(function () { process.exit(0); }, function (err) { console.error('reimport-lovable: ' + (err && err.message)); process.exit(1); });
