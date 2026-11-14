/* node tools/refresh-dummy-dates.js            -> says what it would change on each event, writes nothing
   node tools/refresh-dummy-dates.js --apply    -> makes those changes and puts them live

   The four dummy events (Agentic Summit 2027, the National Data Center Symposium, Cyber Premier League, CIO Awards)
   were given late-2027 dates in Basics on 10 Nov 2026 by a script, which did not redraw their sites: their live pages
   still say "Date to be announced" (the three AI-designed sites) or carry 2026's dates in their own text (CIO Awards,
   an imported site, whose words are its own and are never drawn from Basics). The owner asked on 14 Nov 2026 for
   them to be put right and live.

   For each event, exactly what the product does when Content or Basics change (lib/api.js stageContent): the saved
   site is changed, kept as a new version with its change record ("Content: …") and put on the staging address;
   then that version is published (lib/api.js publishVersion, as tools/republish-current.js does), with a line in
   the event's history saying it was put live on the owner's instruction.
     - The three AI-designed sites: their name, date and place are drawn from Basics (site-records.js, the server's
       copy of the editor's drawing); any "Date to be announced" left outside what that draws (the footer's band,
       a section's own date line) gets the same words the site was built with (gen-design.js dateLabel; the top
       bar's short form, rv-draw.js).
     - CIO Awards: each of 2026's dates moves to the same day in 2027 (the awards night to 26 November 2027, the
       date in Basics), "Enterprise Tech Excellence 2026" and the banner's year become 2027, and the timeline's
       "Open now" / "Closing soon" become "Upcoming" (nominations for 2027 are not open). "© 2026" stays (it is
       this year's copyright) and so does the awards' own id.
   CIO Awards was published on 9 Oct 2026 the way sites were then: one live page and no saved site or versions
   (published, no publishedVersion). Its live page itself (events/cio-awards/published/index.html, what /e/ serves
   for such an event: lib/api.js livePageOf) is changed, after a copy of it is kept beside it
   (published/before-2026-11-14.html), with the same line in its history.
   Refused, and left as they are: an event that is not live, one whose saved site holds work newer than the live
   version (that would go live with it), one with a request waiting for approval, and one where a change would not
   leave the page as it should be (the dry run says which and why).

   Credentials: the main checkout's tools/.env.local (FIREBASE_* as for tools/serve.js), never printed. */
'use strict';
const fs = require('fs');
const path = require('path');

const ACTOR = 'platform';
const NOTE_DRAW = 'the dates set in Basics drawn into the site (they were set by a script on 10 Nov 2026, which did not redraw it)';
const NOTE_CIO = '2026\'s dates moved to 2027, as in Basics';

/* the three AI-designed sites */
const DRAW = ['agentic-summit-2027', 'national-data-center-symposium', 'cyber-premier-league'];
/* CIO Awards' own words: [from, to, how many times at least] */
const CIO = 'cio-awards';
const CIO_SWAPS = [
  ['15 August 2026', '15 August 2027'],
  ['30 October 2026', '30 October 2027'],
  ['31 October 2026', '31 October 2027'],
  ['17 November 2026', '17 November 2027'],
  ['27 November 2026', '26 November 2027'],
  ['Enterprise Tech Excellence 2026', 'Enterprise Tech Excellence 2027'],
  ['>Open now<', '>Upcoming<'],
  ['>Closing soon<', '>Upcoming<']
];
/* the banner's big year: a span holding only "2026" */
const CIO_YEAR = /(<span\b[^>]*>)\s*2026\s*(<\/span>)/g;
const TBA = /Date to be announced/g;

function count(s, re) { return (String(s).match(re) || []).length; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* the words the three sites show where "Date to be announced" is left: the top bar's short form, else the long */
function drawLeft(html, data) {
  const genDesign = require('../functions/lib/gen-design');
  const RD = require('../templates/_shared/rv-draw.js');
  const ev = { start: data.start, end: data.end };
  const long = genDesign.dateLabel(data.start, data.end), short = RD.dateText(ev, 'short');
  if (!long || !short) return { html: html, left: count(html, TBA), why: 'Basics hold no date to draw' };
  let out = html.replace(/(<span\b[^>]*class="[^"]*\brv-etnav-date\b[^"]*"[^>]*>)\s*Date to be announced/g, '$1' + short);
  out = out.replace(TBA, long);
  return { html: out, left: count(out, TBA), long: long, short: short };
}

/* -> { html, changed, report } for one event's saved page (no writing) */
function changeOf(id, page, data) {
  if (DRAW.indexOf(id) !== -1) {
    const siteRecords = require('../functions/lib/site-records');
    const templateId = (data.site && data.site.templateId) || data.templateId || null;
    const before = count(page, TBA);
    const drawn = siteRecords.renderRecords(page, {}, { templateId: templateId, event: data });
    const rest = drawLeft(drawn.html, data);
    const report = { before: before, drawnFromBasics: before - count(drawn.html, TBA), wordsWritten: before - rest.left - (before - count(drawn.html, TBA)),
      left: rest.left, dates: rest.long ? rest.long + ' (top bar: ' + rest.short + ')' : null, why: rest.why || '' };
    if (rest.left) report.why = report.why || '"Date to be announced" would be left ' + rest.left + ' time(s)';
    return { html: rest.html, changed: rest.html !== page, report: report, ok: !rest.left && before > 0 };
  }
  if (id === CIO) {
    let html = page;
    const report = { swaps: [], left2026: [] };
    let missing = 0;
    CIO_SWAPS.forEach(function (s) {
      const n = count(html, new RegExp(escRe(s[0]), 'g'));
      if (!n) missing++;
      report.swaps.push(s[0].replace(/[<>]/g, '') + ' -> ' + s[1].replace(/[<>]/g, '') + ': ' + n);
      html = html.split(s[0]).join(s[1]);
    });
    const years = count(html, CIO_YEAR);
    report.swaps.push('the banner\'s year 2026 -> 2027: ' + years);
    html = html.replace(CIO_YEAR, '$12027$2');
    /* what still says 2026 in the words a visitor reads (the copyright line is meant to) */
    const text = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
    (text.match(/.{0,40}\b2026\b.{0,30}/g) || []).forEach(function (m) { if (!/©\s*2026/.test(m)) report.left2026.push(m.replace(/\s+/g, ' ').trim()); });
    const ok = missing === 0 && years > 0 && !report.left2026.length;
    if (!ok) report.why = (missing ? missing + ' of the expected words were not found; ' : '') + (years ? '' : 'the banner\'s year was not found; ') +
      (report.left2026.length ? report.left2026.length + ' place(s) would still say 2026' : '');
    return { html: html, changed: html !== page, report: report, ok: ok };
  }
  return { html: page, changed: false, report: { why: 'not one of the dummy events' }, ok: false };
}

/* -> Promise<[{ id, line, ok, report }]>, writing nothing */
function plan(fb, hooks) {
  return Promise.all(DRAW.concat([CIO]).map(function (id) {
    return fb.db.collection('events').doc(id).get().then(function (snap) {
      if (!snap.exists) return { id: id, ok: false, line: 'no such event' };
      const e = snap.data(), live = +e.publishedVersion || 0, saved = (e.site && +e.site.version) || 0;
      if (e.deletedAt) return { id: id, ok: false, line: 'deleted — left alone' };
      if (e.published === true && !live && id === CIO) {
        /* published before sites had versions: its live page is the one object */
        return hooks.readObject(fb, hooks.publishedObjectPath(id)).then(function (page) {
          if (page == null) return { id: id, ok: false, line: 'published before sites had versions, but its live page was not found — left alone' };
          const c = changeOf(id, page, e);
          return { id: id, ok: c.ok && c.changed, legacy: true, data: e,
            line: 'live since ' + (e.publishedAt || '?') + ' as one page (published before sites had versions)' + (c.ok ? '' : ' — left alone: ' + (c.report.why || 'nothing to change')), report: c.report };
        });
      }
      if (e.published !== true || !live) return { id: id, ok: false, line: 'not live (published: ' + e.published + ', live version: ' + (e.publishedVersion || 'none') + ') — left alone' };
      if (saved !== live) return { id: id, ok: false, line: 'its saved site (version ' + saved + ') is not the live one (version ' + live + '): publishing would put that work live too — left alone' };
      if (e.approval && e.approval.id) return { id: id, ok: false, line: 'a request is waiting for approval — left alone' };
      return hooks.readObject(fb, hooks.sitePath(id, 'page.html')).then(function (page) {
        if (page == null) return { id: id, ok: false, line: 'its saved site was not found — left alone' };
        const c = changeOf(id, page, e);
        return { id: id, ok: c.ok && c.changed, line: 'live version ' + live + (c.ok ? '' : ' — left alone: ' + (c.report.why || 'nothing to change')), report: c.report, data: e };
      });
    });
  }));
}

/* -> Promise<[{ id, line }]> */
function apply(fb, hooks, logActivity, origin, plans) {
  const decoded = { email: ACTOR, uid: ACTOR };
  const req = { headers: { host: origin.replace(/^https:\/\//, ''), 'x-forwarded-proto': 'https' }, socket: {} };
  return plans.reduce(function (chain, p) {
    return chain.then(function (done) {
      if (!p.ok) return done.concat([{ id: p.id, line: 'skipped — ' + p.line }]);
      const note = p.id === CIO ? NOTE_CIO : NOTE_DRAW;
      if (p.legacy) {
        const HTML = 'text/html; charset=utf-8', livePath = hooks.publishedObjectPath(p.id), keep = livePath.replace(/index\.html$/, 'before-2026-11-14.html');
        return hooks.readObject(fb, livePath).then(function (before) {
          if (before == null) throw new Error('its live page was not found');
          const c = changeOf(p.id, before, p.data || {});
          if (!c.ok || !c.changed) return done.concat([{ id: p.id, line: 'nothing to change on its live page' }]);
          return hooks.saveObject(fb, keep, before, HTML).then(function () { return hooks.saveObject(fb, livePath, c.html, HTML); }).then(function () {
            if (typeof hooks.forgetCachedPage === 'function') hooks.forgetCachedPage(p.id);
            return logActivity(fb, p.id, ACTOR, 'published', 'its live page — ' + note + '; put live on the owner\'s instruction (14 Nov 2026); the page before is kept as ' + keep, {});
          }).then(function () { return done.concat([{ id: p.id, line: 'its live page changed at /e/' + p.id + ' (the page before is kept as ' + keep + ')' }]); });
        }).then(null, function (err) { return done.concat([{ id: p.id, line: 'FAILED — ' + (err && err.message) }]); });
      }
      return hooks.stageContent(fb, p.id, decoded, { transform: function (page, data) { return changeOf(p.id, page, data); }, note: note }).then(function (st) {
        if (!st || !st.staged) return done.concat([{ id: p.id, line: 'nothing to change on the saved site — not published' }]);
        return hooks.publishVersion(fb, req, p.id, st.version, ACTOR, origin).then(function (out) {
          return logActivity(fb, p.id, ACTOR, 'published', 'version ' + st.version + ' — ' + note + '; put live on the owner\'s instruction (14 Nov 2026)', { version: st.version })
            .then(function () { return done.concat([{ id: p.id, line: 'version ' + st.version + ' saved and live at ' + out.publishedPath }]); });
        });
      }).then(null, function (err) { return done.concat([{ id: p.id, line: 'FAILED — ' + (err && err.message) }]); });
    });
  }, Promise.resolve([]));
}

function printPlan(p) {
  console.log(p.id + ': ' + p.line);
  const r = p.report || {};
  if (r.dates) console.log('    "Date to be announced" ' + r.before + ' time(s) -> ' + r.dates + '; ' + r.left + ' left');
  (r.swaps || []).forEach(function (s) { console.log('    ' + s); });
  (r.left2026 || []).forEach(function (s) { console.log('    still 2026: ' + s); });
}

function main() {
  (function loadLocalEnv() {
    const file = path.join(__dirname, '.env.local');
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, 'utf8').split('\n').forEach(function (line) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  })();
  const APPLY = process.argv.indexOf('--apply') !== -1;
  const { getFirebase } = require('../functions/lib/firebase');
  const api = require('../functions/lib/api');
  const { logActivity } = require('../functions/lib/activity');
  const ORIGIN = require('../functions/lib/public-base').HOSTED_ORIGIN;
  const fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  return plan(fb, api._testHooks).then(function (plans) {
    plans.forEach(printPlan);
    if (!APPLY) { console.log('\nDRY RUN: nothing written. Run again with --apply to make these changes and put them live.'); return 0; }
    return apply(fb, api._testHooks, logActivity, ORIGIN, plans).then(function (done) {
      console.log('');
      done.forEach(function (d) { console.log(d.id + ': ' + d.line); });
      return done.some(function (d) { return /^FAILED/.test(d.line); }) ? 1 : 0;
    });
  }).then(function (code) { process.exit(code); });
}

module.exports = { plan: plan, apply: apply, changeOf: changeOf, DRAW: DRAW, CIO: CIO };
if (require.main === module) main().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
