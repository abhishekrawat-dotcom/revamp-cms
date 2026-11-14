/* node tools/award-logo-from-previous.js --event cio-awards [--dry]
     -> reads only (the default): says what it found and what the two steps below would do; no model call, nothing
        written
   node tools/award-logo-from-previous.js --event cio-awards --examine [--out <folder>] [--again]
     -> STEP 1: the previous edition's logo examined (its year moved, by Gemini), the result checked and stored where
        no page shows it yet, and a preview written to look at; no page and no history line written
   node tools/award-logo-from-previous.js --event cio-awards --apply --unit events/cio-awards/generated/<stamp>-logo-unit.png
     -> STEP 2, once someone has looked at that picture: exactly that stored picture put in the banner (no model call),
        the edition corrected where ETB2B's API confirms it, the page before kept, a line in the event's history

   CIO Awards (cio-awards) is one of the four dummy events: an imported site published on 9 Oct 2026, the way sites
   were then — one live page (events/cio-awards/published/index.html, what /e/cio-awards serves) and no saved site or
   versions. Its banner opens with the award's name set in type ("The Economic Times Awards for / Enterprise Tech
   Excellence / — 2027 —"), where ETB2B's own award sites lead with the award's logo lock-up: the 2026 edition's own
   microsite has this very banner, with the typed title commented out and its logo picture (class "bnr-logo") in its
   place. The owner asked on 14 Nov 2026 for the dummy events to get logos, by the logo rules: the previous edition's
   transparent lock-up with ONLY the year changed, in the same form ("2026" -> "2027"), never boxed, redrawn or put on
   a plate; only real facts, confirmed from ETB2B's own API.

   WHY TWO STEPS. Whether a year moved in a picture sits in its lettering can only be judged by eye: the checks below
   confirm that the picture reads the new year, that nothing but one year-sized place in it changed and that the new
   digits were redrawn in the logo's own lettering, not that they look like it. In the product a moved year carries
   the note "Check how it sits…", and publishing waits until a person answers it (lib/api.js publishVersion's
   logoGate). This page has no such gate, so the tool stops between making the picture and putting it live: --examine
   stores it (a public picture no page names) and writes a preview; --apply puts in exactly the picture it is told,
   and nothing else, after it has been looked at.

   What it does, in order:
     1. the previous edition, from ETB2B's public award listing on the event's portal (et-events.js, /v1/award-listing;
        an award row's id is its microsite's): the edition of the same award (the address without its year:
        enterprise-tech-award2025 -> enterprise-tech-award) held the year before this one;
     2. that edition's logo: its own microsite read, and its logo found there as the product finds a previous
        edition's (logo-unit.js findLogoCandidates; the first that is a picture of a lock-up, as previousEditionUnit
        picks it). It must be a PNG with a see-through ground (a lock-up on a plate of its own is refused), so that
        what the examination makes of it can be compared with it pixel for pixel;
     3. (--examine) the lock-up examined exactly as the product examines a previous edition's unit (lib/api.js
        examineUnit, with the context previousEditionUnit gives it, except that the award's name is given without its
        year, so that the reading which confirms the new year is not told it). Kept only when ALL of these hold:
          - the year was moved to this edition's, in the same form, and a second reading found the new year there and
            the old one gone;
          - it was REDRAWN IN THE LOGO'S OWN LETTERING (Gemini's picture call, of which only the new year's shape is
            used). The product's fallback, the year set in the Google font closest to it, is refused: a font's digits
            do not match this lock-up's thin, high-contrast serif ones (DM Serif Display's 7 stood far heavier than the
            "202" beside it, Playfair Display's dropped below their foot);
          - nothing was cropped out of it: it is still a PNG of the previous edition's size, and every pixel outside
            one place no larger than a year (a quarter of its width, under half its height) is the previous edition's
            own; it has its see-through ground and was not drawn for a dark ground (the banner is light).
        The examination makes at most four reading calls and one picture call (Gemini; a reading that runs out of
        time is asked again). The redraw is tried once per run, on the first reading: a run that is refused may
        succeed when run again — each run is a new try. Refused: nothing stored, nothing written, and why is said.
        Kept: stored as the product stores a hero's unit (storeLogoUnit: events/<id>/generated/<stamp>-logo-unit.png,
        public, named by no page), and a preview written to --out (by default a new folder in the system's temporary
        folder): compare.html (the two years side by side, at their size and enlarged, what changed and where, and the
        command for step 2) and page-after.html (the live page with it in the banner, its scripts left out so that
        opening it counts no visit and sends no form). An examined picture already stored is never examined again
        without --again: --examine then writes the preview of the newest one instead, with no model call;
     4. (--apply) the picture named with --unit: it must be one --examine stored for this event, and is checked again
        exactly as in 3 (a PNG of the previous edition's size, see-through, changed in one year-sized place only) and
        must be served to the public as stored. The event is read again (still live, no saved versions, no uploaded
        logo) and its live page as it is now. The banner's typed title is replaced by the lock-up, in the same place,
        as on ETB2B's own site; the <h1> stays, its words kept for search engines and screen readers but not shown
        (class sr-only, the page's own). The picture carries the product's mark for a hero's logo unit (img.rv-lu-img);
     5. the edition number, if and only if ETB2B's API confirms it: the previous edition's microsite says which
        edition it was (template_settings.edition_txt, "3rd Edition"), the award listing holds exactly that many
        editions of the award up to it and none between it and this one — then this one is the next ("4th
        Edition"), and the banner's line and the words naming this edition ("third edition — … 2027") say so;
     6. the page written as tools/refresh-dummy-dates.js writes this event's: a copy of the page before beside it
        (published/before-logo-2026-11-14.html, never overwritten once there), the new page, and a line in the
        event's history saying it was put live on the owner's instruction.
   A run after that finds the logo in the banner and the edition right, and does nothing (no model call).

   NEVER TOUCHED: anything but that one page and the stored picture — the event's record, its logo field, its Basics.
   Refused: an event with saved versions (its site is the editor's), one whose Basics hold a logo the owner uploaded
   (an uploaded logo comes before the previous edition's, as the product orders them: api-generate.js buildLogoUnit;
   which one the banner shows is the owner's to say), and any banner not as expected.

   ON A 2x SCREEN the 745 px artwork, shown 720 px wide, is drawn at about twice its size and looks soft beside the
   page's typed lettering, exactly as ETB2B's own 2026 site shows the same file at its natural size. The rule is the
   previous edition's own artwork, so it is used as it is and never enlarged here; a sharper one needs a 2x PNG or an
   SVG of the lock-up from the ETCIO team.

   Env: tools/.env.local (this checkout's, else the main checkout's when run from a worktree), never printed; loaded
   only when this file is run with a command it understands, never when a test requires it. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const lib = path.join(ROOT, 'functions', 'lib');
const logoUnit = require(path.join(lib, 'logo-unit.js'));
const etEvents = require(path.join(lib, 'et-events.js'));
const etPrevious = require(path.join(lib, 'et-previous.js'));
const etAwards = require(path.join(lib, 'et-awards.js'));
const pngLite = require(path.join(lib, 'png-lite.js'));

const ACTOR = 'platform';
const DAY = '14 Nov 2026';
const BACKUP_NAME = 'before-logo-2026-11-14.html';
const HTML_TYPE = 'text/html; charset=utf-8';
const LOGO_TRIES = 3;                    // as previousEditionUnit (api-generate.js LOGO_UNIT_TRIES)
const LOGO_MAX_BYTES = 3 * 1024 * 1024;  // as api.js LOGO_UNIT_MAX_BYTES
const LOGO_MAX_PIXELS = 2500000;         // as api.js LOGO_UNIT_DECODE_PIXELS: compared pixel for pixel
const PAGE_MAX_BYTES = 2 * 1024 * 1024;  // as api-generate.js SOURCE_PAGE_MAX_BYTES
const MAX_READS = 4, MAX_PICTURE_CALLS = 1;
const SHOWN_MAX = 720;                   // the widest the lock-up is shown (CSS px): the banner's column
/* what may differ from the previous edition's picture: one place no larger than a year (its share of the picture) */
const YEAR_AREA = { width: 0.25, height: 0.45 };
/* how examineUnit says a year was redrawn in a previous edition's own lettering (api.js moved(), redrawYearInPng);
   any other way it was moved — set in the closest font, set in a drawing's text — is refused */
const REDRAWN = ' over the previous edition\'s artwork, redrawn in its own lettering';
const API = etEvents.API;

/* What this tool knows of each event it may change: the event's portal on ETB2B, the award's address there without
   its year (enterprise-tech-award2024, enterprise-tech-award2025, enterprise-tech-award: one award, three editions, as
   ETB2B's award listing gives them), and the words its banner's title must read (with this edition's year) — any
   other banner is left alone. */
const EVENTS = {
  'cio-awards': { portal: 'cio', series: 'enterprise-tech-award', title: /^The Economic Times Awards for Enterprise Tech Excellence (20\d\d)$/ }
};

/* ---------- the command ---------- */
const USAGE = 'Usage: node tools/award-logo-from-previous.js --event <event id> [--dry]                  reads only (the default)\n' +
  '       node tools/award-logo-from-previous.js --event <event id> --examine [--out <folder>] [--again]\n' +
  '       node tools/award-logo-from-previous.js --event <event id> --apply [--unit events/<event id>/generated/<stamp>-logo-unit.png]';
/* -> { id, mode: 'dry' | 'examine' | 'apply', unit, out, again } | { usage: what is wrong } */
function parseArgs(argv) {
  const takes = { '--event': 'id', '--unit': 'unit', '--out': 'out' }, flags = ['--dry', '--examine', '--apply', '--again'];
  const a = { id: '', mode: 'dry', unit: '', out: '', again: false }, modes = [], seen = {};
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i];
    if (!takes[w] && flags.indexOf(w) === -1) return { usage: 'not understood: ' + w };
    if (seen[w]) return { usage: w + ' is given twice' };
    seen[w] = true;
    if (takes[w]) {
      const v = argv[i + 1];
      if (v == null || /^--/.test(v)) return { usage: w + ' needs a value' };
      a[takes[w]] = v; i++;
    } else if (w === '--again') a.again = true;
    else modes.push(w);
  }
  if (modes.length > 1) return { usage: 'one of --dry, --examine and --apply, not ' + modes.join(' and ') };
  if (modes.length) a.mode = modes[0].slice(2);
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(a.id)) return { usage: a.id ? 'not an event id: ' + a.id : '--event <event id> is needed' };
  if (a.unit && a.mode !== 'apply') return { usage: '--unit goes with --apply' };
  if ((a.out || a.again) && a.mode !== 'examine') return { usage: (a.out ? '--out' : '--again') + ' goes with --examine' };
  return a;
}

/* ---------- words ---------- */
const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
function ordinal(n) { const t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')); }
/* "3rd Edition", "Third Edition" -> 3; anything else -> 0 */
function editionNumber(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  let m = /^(\d{1,2}) ?(st|nd|rd|th) edition$/i.exec(s);
  if (m && ordinal(+m[1]).toLowerCase() === (m[1] + m[2]).toLowerCase()) return +m[1];
  m = /^([a-z]+) edition$/i.exec(s);
  const at = m ? ORDINAL_WORDS.indexOf(m[1].toLowerCase()) : -1;
  return at > 0 ? at : 0;
}
function decode(s) {
  return String(s).replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;|&rsquo;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function textOf(html) { return decode(String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escText(s).replace(/"/g, '&quot;'); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* between two words of a phrase: whatever the page has there (a space, a non-breaking one, React's empty markers) */
const SEP = '(?:\\s|&nbsp;|&#160;|&#xa0;|<!--[^>]*?-->)+';
const DASH = '(?:—|–|-|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;)';
function count(s, re) { return (String(s).match(re) || []).length; }
function stampOf(deps) { return (deps.now ? deps.now() : new Date()).toISOString().replace(/[^0-9]/g, '').slice(0, 14); }
function publicUrlOf(fb, storagePath) { return 'https://storage.googleapis.com/' + ((fb.bucket && fb.bucket.name) || 'BUCKET') + '/' + storagePath; }

/* ---------- the banner ---------- */
/* -> { at, end, open, inner, text, year, done } for the banner's title (the <h1> whose words are the award's name
   with a year), or null. done: it already shows the lock-up (this tool's mark). */
function findTitle(page, titleRe) {
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = re.exec(page))) {
    const open = m[0].slice(0, m[0].indexOf('>') + 1), inner = m[1], text = textOf(inner);
    const done = /\sdata-rv-award-logo\b/.test(open) || /\sdata-rv-award-logo\b/.test(inner);
    const t = titleRe.exec(text);
    if (t || done) return { at: m.index, end: m.index + m[0].length, open: open, inner: inner, text: text, year: t ? t[1] : '', done: done };
  }
  return null;
}
/* the banner's own box: the <section> around the title (its edition line is looked for there and nowhere else) */
function heroBox(page, title) {
  const start = page.lastIndexOf('<section', title.at), end = page.indexOf('</section>', title.end);
  return start === -1 || end === -1 ? null : { start: start, end: end + '</section>'.length };
}
/* the new title: the same <h1> (its classes, its fade-in), its words kept but not shown, the lock-up in their place.
   The picture is shown at its own size at most (720 px), and as wide as the column on a phone; never on a plate or
   framed. Its class rv-lu-img is the product's mark for the picture of a hero's logo unit (gen-design.js
   logoUnitImageHtml), by which the rest of the product (site-a11y.js shareCandidates, Settings › URL & SEO) knows
   it; an imported page has no style for it, so it changes nothing of how the page looks. */
function titleWithLogo(title, unit, name) {
  const open = title.open.replace(/>$/, ' data-rv-award-logo-title>');
  const w = Math.round(+unit.width) || 0, h = Math.round(+unit.height) || 0;
  const shown = Math.min(w || SHOWN_MAX, SHOWN_MAX);
  return open + '<span class="sr-only">' + escText(name) + '</span>' +
    '<img class="rv-lu-img" src="' + escAttr(unit.url) + '" alt=""' + (w && h ? ' width="' + w + '" height="' + h + '"' : '') + ' decoding="async" data-rv-award-logo="' + escAttr(unit.from || 'previous-edition') + '"' +
    ' style="display:block;width:' + shown + 'px;max-width:100%;height:auto;margin:0 auto">' + '</h1>';
}

/* -> { ok, why, html, before, after, edition: { banner, words, from, to } } — the page with the lock-up in its banner
   and, when edition is given ({ from: 3, to: 4 }), the edition corrected. Writes nothing. */
function changePage(page, o) {
  const cfg = o.cfg, title = findTitle(page, cfg.title);
  if (!title) return { ok: false, why: 'the banner\'s title ("' + String(cfg.title.source).replace(/^\^|\$$/g, '') + '") was not found on the page' };
  const out = { ok: true, why: '', html: page, before: page.slice(title.at, title.end), after: '', logo: 'already in the banner', edition: null };
  let html = page;
  if (!title.done) {
    if (title.year !== o.year) return { ok: false, why: 'the banner\'s title says ' + title.year + ', not this edition\'s year ' + o.year };
    if (count(page, /<h1\b/gi) !== 1) return { ok: false, why: 'the page has ' + count(page, /<h1\b/gi) + ' <h1> headings, where one was expected' };
    out.after = titleWithLogo(title, o.unit, title.text);
    html = html.slice(0, title.at) + out.after + html.slice(title.end);
    out.logo = 'put in';
  }
  if (o.edition) {
    const ed = o.edition, t2 = findTitle(html, cfg.title), box = t2 && heroBox(html, t2);
    if (!box) return { ok: false, why: 'the banner\'s box around its title was not found' };
    const from = ordinal(ed.from), to = ordinal(ed.to);
    let hero = html.slice(box.start, box.end), banner = 0;
    hero = hero.replace(new RegExp('(>' + '(?:\\s|&nbsp;|&#160;)*)' + from + '(' + SEP + 'Edition\\b)', 'gi'), function (all, a, b) { banner++; return a + to + b; });
    const has = new RegExp('>(?:\\s|&nbsp;|&#160;)*' + to + SEP + 'Edition\\b', 'i').test(hero);
    /* the words naming this edition, with its year, anywhere on the page: "third edition — The Economic Times … 2027" */
    const name = String(o.awardWords || '').split(' ').filter(Boolean);
    let words = 0, head = html.slice(0, box.start), tail = html.slice(box.end);
    if (name.length && ORDINAL_WORDS[ed.from] && ORDINAL_WORDS[ed.to]) {
      const re = new RegExp('\\b(' + ORDINAL_WORDS[ed.from] + ')(' + SEP + 'edition' + SEP + DASH + SEP + name.map(escRe).join(SEP) + ')(?![0-9])', 'gi');
      const next = ORDINAL_WORDS[ed.to];
      const to2 = function (all, word, rest) {
        words++;
        return (word.charAt(0) === word.charAt(0).toUpperCase() ? next.charAt(0).toUpperCase() + next.slice(1) : next) + rest;
      };
      head = head.replace(re, to2); tail = tail.replace(re, to2);
    }
    html = head + hero + tail;
    out.edition = { from: from, to: to, banner: banner, words: words, already: !banner && has };
    if (!banner && !has) return { ok: false, why: 'the banner says neither "' + from + ' Edition" nor "' + to + ' Edition": its edition line is not as expected' };
  }
  out.html = html;
  out.changed = html !== page;
  return out;
}

/* ---------- ETB2B's API: the previous edition and the edition facts ---------- */
function yearOf(stamp) { const m = /^(20\d\d)-/.exec(String(stamp || '')); return m ? m[1] : ''; }
function seriesOf(link) { return etPrevious.seriesOf(etPrevious.slugOf(link)); }
/* -> Promise<{ prev, editions: [award rows of the series, oldest first], listingUrl } | { why }> */
function previousEdition(deps, portal, year, series0) {
  const listingUrl = API + '/v1/award-listing?page=1 (portal: ' + portal + ')';
  return etEvents.fetchAwards(portal, deps.fetchJson).then(function (rows) {
    const before = rows.filter(function (r) { return yearOf(r.start) === String(+year - 1) && (!series0 || seriesOf(r.link) === series0); });
    if (!before.length) return { why: 'ETB2B\'s award listing on ' + portal + ' has no award held in ' + (+year - 1), listingUrl: listingUrl };
    /* the edition before this one: of an award whose earlier editions are listed too (the address without its year) */
    if (before.length > 1) return { why: 'ETB2B\'s award listing on ' + portal + ' has ' + before.length + ' awards held in ' + (+year - 1) + ' — which is this one\'s previous edition is not certain', listingUrl: listingUrl };
    const prev = before[0], series = seriesOf(prev.link);
    if (!series) return { why: 'the previous edition has no address on ETB2B', listingUrl: listingUrl };
    const editions = rows.filter(function (r) { return seriesOf(r.link) === series && yearOf(r.start); })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    return { prev: prev, series: series, editions: editions, listingUrl: listingUrl };
  }, function (err) { return { why: 'ETB2B\'s award listing could not be read (' + (err && err.message) + ')', listingUrl: listingUrl }; });
}
/* -> Promise<{ confirmed, from, to, why, detailsUrl, editionTxt, lines }> */
function editionFacts(deps, portal, found, year) {
  const prev = found.prev, detailsUrl = API + '/v1/microsite/details?digital_month_id=' + prev.id + ' (portal: ' + portal + ')';
  return Promise.resolve().then(function () {
    return deps.fetchJson(API + '/v1/microsite/details?digital_month_id=' + encodeURIComponent(prev.id), { portal: portal, accept: 'application/json' });
  }).then(function (j) {
    const d = j && j.status !== false && j.data && typeof j.data === 'object' ? j.data : null;
    const facts = { confirmed: false, from: 0, to: 0, why: '', detailsUrl: detailsUrl, editionTxt: '' };
    facts.lines = found.editions.map(function (e) { return yearOf(e.start) + ': ' + e.title + ' (award ' + e.awardId + ', microsite ' + e.id + ')'; });
    if (!d) { facts.why = 'the previous edition\'s microsite details could not be read'; return facts; }
    /* the microsite must be this award's: its own award id and the listing's must agree (et-awards.js readAward) */
    if (String(d.award_id || '') !== String(prev.awardId) || (d.portal && String(d.portal).toLowerCase() !== portal)) {
      facts.why = 'the microsite details name award ' + d.award_id + ' on ' + d.portal + ', the listing award ' + prev.awardId + ' on ' + portal; return facts;
    }
    facts.editionTxt = etAwards.editionOf(d.template_settings);
    const n = editionNumber(facts.editionTxt);
    const upTo = found.editions.filter(function (e) { return yearOf(e.start) <= yearOf(prev.start); }).length;
    const between = found.editions.filter(function (e) { return e.start > prev.start && yearOf(e.start) < String(year); }).length;
    if (!n) { facts.why = 'the previous edition\'s microsite does not say which edition it was (edition_txt "' + facts.editionTxt + '")'; return facts; }
    if (n !== upTo) { facts.why = 'its microsite says "' + facts.editionTxt + '" but the listing holds ' + upTo + ' edition(s) up to it'; return facts; }
    if (between) { facts.why = 'the listing holds ' + between + ' edition(s) between it and this one'; return facts; }
    facts.confirmed = true; facts.from = n; facts.to = n + 1;
    return facts;
  }, function (err) { return { confirmed: false, why: 'the previous edition\'s microsite details could not be read (' + (err && err.message) + ')', detailsUrl: detailsUrl, lines: [] }; });
}

/* ---------- the previous edition's logo, and what may become of it ---------- */
/* see-through ground, as a share of a decoded picture */
function clearOf(img) {
  const d = img.data, n = img.width * img.height;
  let clear = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 24) clear++;
  return n ? clear / n : 0;
}
/* see-through ground, as a share of the picture: a PNG decoded; anything else none (only a PNG is used here) */
function clearShare(bytes, info) {
  if (info.type !== 'png' || info.width * info.height > LOGO_MAX_PIXELS) return 0;
  const img = pngLite.decode(bytes);
  return img ? clearOf(img) : 0;
}
/* Where two pictures of one size differ, pixel for pixel (a pixel see-through in both is the same, whatever colour it
   carries). -> { x, y, width, height, pixels } | null when not one pixel differs */
function changedBox(a, b) {
  const W = a.width, H = a.height, p = a.data, q = b.data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (p[o + 3] === 0 && q[o + 3] === 0) continue;
      if (p[o] === q[o] && p[o + 1] === q[o + 1] && p[o + 2] === q[o + 2] && p[o + 3] === q[o + 3]) continue;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, pixels: n } : null;
}
function boxText(b) { return 'x ' + b.x + '–' + (b.x + b.width - 1) + ', y ' + b.y + '–' + (b.y + b.height - 1) + ' (' + b.width + ' × ' + b.height + ' px)'; }
/* "a PNG", "an SVG": a kind of picture as it is said */
function aKind(type) { const t = String(type || ''); return t ? ({ svg: 'an SVG', avif: 'an AVIF', webp: 'a WebP' }[t] || 'a ' + t.toUpperCase()) : 'not a picture that can be read'; }
/* Is this picture the previous edition's own artwork with one year-sized place changed, and nothing else?
   -> { why: '' when so, else why not; box: where it differs } */
function pictureCheck(source, pic) {
  const si = source.info, pi = (pic && pic.info) || {};
  if (pi.type !== 'png' || si.type !== 'png') return { why: 'it is ' + aKind(pi.type) + ', not the previous edition\'s PNG with its year redrawn in it' };
  if (+pi.width !== +si.width || +pi.height !== +si.height) {
    return { why: 'it is ' + pi.width + ' × ' + pi.height + ', where the previous edition\'s is ' + si.width + ' × ' + si.height + ': part of it was cut away or it was reframed, and only its year may change' };
  }
  if (pi.width * pi.height > LOGO_MAX_PIXELS) return { why: 'it is too large to be compared with the previous edition\'s pixel for pixel' };
  const a = pngLite.decode(source.bytes), b = pngLite.decode(pic.bytes);
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { why: 'it could not be compared with the previous edition\'s pixel for pixel' };
  const box = changedBox(a, b);
  if (!box) return { why: 'not one pixel of it differs from the previous edition\'s: its year was not moved', box: null };
  if (box.width > a.width * YEAR_AREA.width || box.height > a.height * YEAR_AREA.height) {
    return { why: 'more than its year changed: it differs from the previous edition\'s over ' + boxText(box) + ', more than a year takes in a ' + a.width + ' × ' + a.height + ' lock-up', box: box };
  }
  const why = logoUnit.plausibleUnit(pi);
  if (why) return { why: 'it is not a logo unit (' + why + ')', box: box };
  if (clearOf(b) < 0.2) return { why: 'it has no see-through ground', box: box };
  return { why: '', box: box };
}

/* -> Promise<{ picture: { bytes, info, stacked }, candidate, clear, hints, candidates } | { why }> */
function previousLogo(deps, hooks, prev) {
  return Promise.resolve().then(function () { return deps.fetchText(prev.link); }).then(function (html) {
    if (!html) return { why: 'the previous edition\'s own site (' + prev.link + ') could not be read' };
    const candidates = logoUnit.findLogoCandidates(html, prev.link, prev.title).slice(0, LOGO_TRIES);
    const hints = logoUnit.editionHints(html, prev.link);
    if (!candidates.length) return { why: 'the previous edition\'s own site (' + prev.link + ') names no logo', hints: hints };
    const refusals = [];
    function pick(i) {
      if (i >= candidates.length) return Promise.resolve({ why: 'its logo could not be used: ' + refusals.join('; '), candidates: candidates, hints: hints });
      const c = candidates[i];
      if (c.kind !== 'img' || !/^https:\/\//i.test(String(c.url || ''))) { refusals.push((c.url || c.kind) + ' is not a picture of its own'); return pick(i + 1); }
      return Promise.resolve().then(function () { return deps.fetchBytes(c.url); }).then(function (bytes) {
        if (!bytes || !bytes.length) { refusals.push(c.url + ' could not be downloaded'); return pick(i + 1); }
        const pic = hooks.usableLogoPicture(bytes);
        if (!pic || pic.refused) { refusals.push(c.url + ' — ' + ((pic && pic.refused) || 'not a picture')); return pick(i + 1); }
        /* what the examination makes of it is compared with it pixel for pixel: a PNG, small enough to decode */
        if (pic.info.type !== 'png') { refusals.push(c.url + ' is ' + aKind(pic.info.type) + ', and only a PNG can be checked pixel for pixel here'); return pick(i + 1); }
        if (pic.info.width * pic.info.height > LOGO_MAX_PIXELS || !pngLite.decode(pic.bytes)) { refusals.push(c.url + ' could not be decoded to be checked pixel for pixel'); return pick(i + 1); }
        const clear = clearShare(pic.bytes, pic.info);
        /* a lock-up on a plate of its own would stand in the banner as a box: never */
        if (clear < 0.2) { refusals.push(c.url + ' has no see-through ground (' + Math.round(clear * 100) + '% clear): it would stand in the banner as a box'); return pick(i + 1); }
        return { picture: pic, candidate: c, clear: clear, hints: hints, candidates: candidates };
      }, function (err) { refusals.push(c.url + ' could not be downloaded (' + (err && err.message) + ')'); return pick(i + 1); });
    }
    return pick(0);
  }, function (err) { return { why: 'the previous edition\'s own site (' + prev.link + ') could not be read (' + (err && err.message) + ')' }; });
}

/* Was the year moved cleanly, and only the year? source: the previous edition's picture as fetched.
   -> '' when so, else why not (for the owner and the operator) */
function judge(ex, years, source) {
  if (!ex || !ex.picture) return 'it could not be examined';
  if (ex.unread) return 'it could not be read, so its year could not be checked or moved';
  if (ex.stuck) return 'it still shows ' + ex.stuck + ': its year could not be moved to ' + (logoUnit.yearAs(ex.stuck, years.to) || years.to) + ' cleanly';
  if (ex.extrasLeft) return 'it carries a mark that is not the award\'s own and could not be cropped out cleanly';
  const notes = (ex.notes || []).join(' ');
  /* nothing may be cut out of it, whatever a reading took for a mark of somebody else's */
  if (/was cropped out/.test(notes)) {
    const cut = /“([^”]*)”[^“]*?was cropped out/.exec(notes);
    return 'part of it was cropped out' + (cut ? ' (“' + cut[1] + '”, which a reading took for a mark that is not the award\'s own)' : '') + ': only its year may change';
  }
  const m = /The year in the logo unit was changed from ([^\s:;,]+) to ([^\s:;,]+)([^;]*)/.exec(notes);
  if (!m) return 'its year was not moved (' + (ex.seen ? 'the reading named the edition\'s year as "' + ex.seen + '"' : 'the reading found no year in it') + ')';
  const to = logoUnit.shownYear(m[2]);
  if (!to || to.full !== years.to) return 'its year was moved to ' + m[2] + ', not ' + years.to;
  /* only a year redrawn in the lock-up's own lettering: a year set in a font never matches its own digits */
  if (m[3] !== REDRAWN) {
    return 'its new year was not redrawn in the logo\'s own lettering but ' + (/closest/.test(m[3]) ? 'set in the font closest to it' : 'set another way') +
      ' ("' + m[3].replace(/^[\s:,]+/, '') + '"), which does not match the logo\'s own digits';
  }
  if (/could not be checked by a second reading/.test(notes)) return 'its new year could not be checked by a second reading';
  if (ex.tone === 'for-dark') return 'it is drawn for a dark ground (light lettering) and the banner is light';
  return pictureCheck(source, ex.picture).why;
}

/* ---------- the event ---------- */
/* -> '' when this tool may change the event's live page, else why not */
function eventWhy(e, cfg) {
  if (e.deletedAt) return 'deleted — left alone';
  if (e.published !== true) return 'not live — left alone';
  if (+e.publishedVersion || (e.site && +e.site.version)) return 'it has saved versions: its site is the editor\'s, not this tool\'s — left alone';
  if (e.portal && e.portal !== cfg.portal) return 'its portal is ' + e.portal + ', not ' + cfg.portal + ' — left alone';
  const uploaded = String(e.logoUrl || '').trim();
  if (/^https:\/\//i.test(uploaded)) {
    return 'its Basics hold a logo the owner uploaded (' + uploaded + '), and an uploaded logo comes before the previous edition\'s (as the product orders them: lib/api-generate.js buildLogoUnit) — left alone: which logo the banner shows is the owner\'s to say';
  }
  return '';
}

/* ---------- the plan (reads only) ---------- */
/* -> Promise<PLAN>: { id, ok, why, lines: [..], page, year, cfg, logo, facts, change, … } */
function plan(fb, deps, id) {
  const hooks = deps.hooks, cfg = EVENTS[id];
  const P = { id: id, ok: false, why: '', lines: [], cfg: cfg };
  function stop(why) { P.why = why; return P; }
  if (!cfg) return Promise.resolve(stop('this tool knows the banner of ' + Object.keys(EVENTS).join(', ') + ' only'));
  return fb.db.collection('events').doc(id).get().then(function (snap) {
    if (!snap.exists) return stop('no such event');
    const e = snap.data();
    P.data = e;
    const why = eventWhy(e, cfg);
    if (why) return stop(why);
    P.year = yearOf(e.start) || '';
    if (!P.year) return stop('Basics hold no date: this edition\'s year is not known');
    P.lines.push('live since ' + (e.publishedAt || '?') + ' as one page (published before sites had versions); this edition: ' + P.year + ' (Basics: ' + String(e.start).slice(0, 10) + ')');
    P.lines.push('uploaded logo in Basics: none' + (String(e.logoUrl || '').trim() ? ' (the logo field holds "' + String(e.logoUrl).trim().slice(0, 80) + '", not an uploaded picture\'s address)' : ''));
    return hooks.readObject(fb, hooks.publishedObjectPath(id)).then(function (page) {
      if (page == null) return stop('its live page was not found');
      P.page = page;
      const title = findTitle(page, cfg.title);
      if (!title) return stop('the banner\'s title was not found on its live page — left alone');
      if (!title.done && title.year !== P.year) return stop('the banner\'s title says ' + title.year + ', not ' + P.year + ' (run tools/refresh-dummy-dates.js first) — left alone');
      P.title = title;
      P.name = title.done ? '' : title.text;
      /* the award's name as the examination is given it: without this edition's year, so that the reading which
         confirms the new year in the picture is not told it */
      P.nameNoYear = P.name.replace(/\s*\b20\d\d$/, '').trim();
      return previousEdition(deps, cfg.portal, P.year, cfg.series).then(function (found) {
        P.listingUrl = found.listingUrl;
        if (found.why) return stop(found.why);
        P.prev = found.prev; P.editions = found.editions;
        P.lines.push('previous edition: ' + found.prev.title + ' — award ' + found.prev.awardId + ', microsite ' + found.prev.id + ', held ' + String(found.prev.start).slice(0, 10) + ' — ' + found.prev.link);
        P.lines.push('  from ETB2B\'s award listing: ' + found.listingUrl);
        return editionFacts(deps, cfg.portal, found, P.year).then(function (facts) {
          P.facts = facts;
          (facts.lines || []).forEach(function (l) { P.lines.push('  listed: ' + l); });
          P.lines.push('  its microsite: ' + facts.detailsUrl + ' — edition_txt "' + (facts.editionTxt || '') + '"');
          P.lines.push(facts.confirmed ? 'edition: confirmed — ' + P.prev.title + ' was the ' + ordinal(facts.from) + ' edition, so ' + P.year + ' is the ' + ordinal(facts.to)
            : 'edition: NOT confirmed (' + facts.why + ') — the page\'s edition is left as it is');
          if (title.done) { P.lines.push('logo: already in the banner'); return null; }
          return previousLogo(deps, hooks, found.prev);
        });
      }).then(function (logo) {
        if (P.why) return P;
        if (logo && logo.why) return stop(logo.why);
        if (logo) {
          const info = logo.picture.info;
          P.logo = logo;
          P.years = logoUnit.editionYears({ eventName: P.name, start: P.data.start, briefTexts: [], hints: logo.hints || {}, pageUrl: P.prev.link });
          P.lines.push('logo: ' + logo.candidate.url + ' (class "' + (logo.candidate.cls || '') + '", score ' + logo.candidate.score + ') — ' + String(info.type).toUpperCase() + ' ' +
            Math.round(info.width) + ' × ' + Math.round(info.height) + ', ' + Math.round(logo.clear * 100) + '% see-through');
          if (P.years.to !== P.year) return stop('the year it must carry would be ' + (P.years.to || 'unknown') + ', not ' + P.year);
          if (!P.years.from) return stop('the previous edition\'s site does not say its year, so the year its logo shows cannot be checked');
          P.lines.push('year: the previous edition\'s ' + P.years.from + ' to be moved to ' + P.years.to + ' in the same form, redrawn in the logo\'s own lettering (--examine; a year set in a font is refused)');
        }
        /* the change, with the picture still to be made: its address as it will be stored */
        const stand = { url: publicUrlOf(fb, 'events/' + id + '/generated/YYYYMMDDHHMMSS-logo-unit.png'),
          width: logo ? logo.picture.info.width : 0, height: logo ? logo.picture.info.height : 0, from: logo ? logo.candidate.url : '' };
        const change = changePage(P.page, planChange(P, stand));
        if (!change.ok) return stop(change.why);
        P.change = change;
        P.needsLogo = !P.title.done;
        P.needsEdition = !!(change.edition && (change.edition.banner || change.edition.words));
        if (!P.needsLogo && !P.needsEdition) return stop('nothing to do: the logo is in the banner' + (P.facts && P.facts.confirmed ? ' and the edition is right' : ''));
        P.ok = true;
        return P;
      });
    });
  });
}
function planChange(P, unit) {
  const edition = P.facts && P.facts.confirmed ? { from: P.facts.from, to: P.facts.to } : null;
  /* the award's name for this edition as the page writes it: the title's words */
  const words = (P.title && P.title.text) || '';
  return { cfg: P.cfg, year: P.year, unit: unit, edition: edition, awardWords: words };
}

/* ---------- step 1: --examine ---------- */
/* the pictures an earlier --examine stored for the event, newest first -> Promise<{ paths, why }> */
function storedExaminations(fb, id) {
  const prefix = 'events/' + id + '/generated/';
  return Promise.resolve().then(function () {
    if (!fb.bucket || typeof fb.bucket.getFiles !== 'function') return { paths: [], why: 'the storage cannot be listed' };
    return fb.bucket.getFiles({ prefix: prefix }).then(function (r) {
      const paths = ((r && r[0]) || []).map(function (f) { return String(f && f.name || ''); })
        .filter(function (n) { return n.indexOf(prefix) === 0 && /^\d{14}-logo-unit\.png$/.test(n.slice(prefix.length)); }).sort().reverse();
      return { paths: paths, why: '' };
    });
  }).then(null, function (err) { return { paths: [], why: 'the storage could not be listed (' + (err && err.message) + ')' }; });
}
function readBytes(fb, objectPath) {
  return fb.bucket.file(objectPath).download().then(function (r) { return r[0]; }, function (err) {
    if (err && (err.code === 404 || err.code === '404')) return null;
    throw err;
  });
}
/* Of those (the newest few), the ones that are still the previous edition's artwork with only one year-sized place
   changed, which step 2 may put live as they are; any other picture of that name is said and never used.
   -> Promise<{ usable: [{ path, picture, box }], unusable: [{ path, why }], why }> */
function earlierExaminations(fb, P) {
  return storedExaminations(fb, P.id).then(function (listed) {
    const out = { usable: [], unusable: [], why: listed.why };
    if (!P.logo) return out;
    return listed.paths.slice(0, 5).reduce(function (chain, p) {
      return chain.then(function () { return readBytes(fb, p); }).then(function (bytes) {
        const pic = bytes && bytes.length ? { bytes: bytes, info: logoUnit.imageInfo(bytes) } : null;
        const check = pic ? pictureCheck(P.logo.picture, pic) : { why: 'it could not be read back' };
        if (check.why) out.unusable.push({ path: p, why: check.why }); else out.usable.push({ path: p, picture: pic, box: check.box });
      }, function (err) { out.unusable.push({ path: p, why: 'it could not be read back (' + (err && err.message) + ')' }); });
    }, Promise.resolve()).then(function () { return out; });
  });
}
function defaultOut(id, stamp) { return path.join(os.tmpdir(), 'award-logo-' + id + '-' + stamp); }
function applyCommand(id, storagePath) { return 'node tools/award-logo-from-previous.js --event ' + id + ' --apply --unit ' + storagePath; }

/* -> Promise<{ ok, refused, reused, line, unit: { url, storagePath, width, height, box }, notes, files, previewWhy }>
   Writes no page and no history line: the picture is stored where no page names it, and the preview in opts.out. */
function examine(fb, deps, P, opts) {
  const hooks = deps.hooks, id = P.id, o = opts || {};
  if (!P.ok) return Promise.resolve({ ok: false, line: 'nothing examined — ' + P.why });
  if (!P.needsLogo) return Promise.resolve({ ok: false, line: 'nothing to examine: the banner already shows the logo' + (P.needsEdition ? ' (--apply alone corrects the edition)' : '') });
  const stamp = stampOf(deps), out = o.out || defaultOut(id, stamp);
  function withPreview(r, picture) {
    try { r.files = writePreview(out, P, { picture: picture, unit: r.unit, notes: r.notes, reused: !!r.reused }); }
    catch (err) { r.files = []; r.previewWhy = 'the preview could not be written to ' + out + ' (' + (err && err.message) + ')'; }
    return r;
  }
  return earlierExaminations(fb, P).then(function (earlier) {
    /* an examined picture already stored is looked at again before another is made: no model call */
    if (earlier.usable.length && !o.again) {
      const e = earlier.usable[0], p = e.path;
      const unit = { url: publicUrlOf(fb, p), storagePath: p, width: e.picture.info.width, height: e.picture.info.height, box: e.box };
      return withPreview({ ok: true, reused: true, unit: unit, notes: [], unusable: earlier.unusable,
        line: 'NOT EXAMINED AGAIN — an earlier --examine stored ' + p + (earlier.usable.length > 1 ? ' (and ' + (earlier.usable.length - 1) + ' older)' : '') + '; its preview is written again, with no model call. To examine the logo anew instead (a new try), add --again.' }, e.picture);
    }
    const ctx = { years: P.years, origin: 'previous-edition', eventName: P.nameNoYear, deadlineAt: Date.now() + 240000 };
    return Promise.resolve().then(function () {
      return deps.examine(fb, id, { bytes: P.logo.picture.bytes, info: P.logo.picture.info }, ctx);
    }).then(function (ex) {
      const why = judge(ex, P.years, P.logo.picture);
      if (why) { const err = new Error('the previous edition\'s logo was not used: ' + why + '. Nothing stored, nothing written.'); err.refused = true; err.notes = (ex && ex.notes) || []; throw err; }
      const check = pictureCheck(P.logo.picture, ex.picture);
      return hooks.storeLogoUnit(fb, id, stamp, ex.picture).then(function (stored) {
        const unit = { url: stored.url, storagePath: stored.storagePath, width: ex.picture.info.width, height: ex.picture.info.height, box: check.box };
        return withPreview({ ok: true, unit: unit, notes: ex.notes || [], unusable: earlier.unusable,
          line: 'examined — its year moved ' + P.years.from + ' -> ' + P.years.to + ', redrawn in the logo\'s own lettering and found by a second reading; stored where no page shows it: ' + stored.storagePath }, ex.picture);
      });
    }).then(null, function (err) {
      return { ok: false, refused: !!(err && err.refused), notes: (err && err.notes) || [], unusable: earlier.unusable, line: (err && err.refused ? 'REFUSED — ' : 'FAILED — ') + (err && err.message) };
    });
  });
}

/* ---------- the preview (a folder of the operator's; nothing in it is published) ---------- */
function clampBox(b, W, H) {
  const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
  return { x: x, y: y, width: Math.max(1, Math.min(W, Math.round(b.x + b.width)) - x), height: Math.max(1, Math.min(H, Math.round(b.y + b.height)) - y) };
}
/* a part of a picture, enlarged k times (less on a narrow screen): the picture is moved inside a window of the part's
   shape, placed in shares of the window so that it keeps to the part at any width */
function zoomHtml(src, W, H, crop, k, label) {
  function pct(v) { return (v * 100).toFixed(4) + '%'; }
  return '<figure class="zoom" style="width:' + crop.width * k + 'px"><div class="win" style="aspect-ratio:' + crop.width + ' / ' + crop.height + '"><img src="' + src + '" alt="' + escAttr(label) + '" style="left:' + pct(-crop.x / crop.width) + ';top:' + pct(-crop.y / crop.height) +
    ';width:' + pct(W / crop.width) + ';height:' + pct(H / crop.height) + '"></div><figcaption>' + escText(label) + '</figcaption></figure>';
}
/* the live page with the picture in its banner, to open from a folder: its pictures and styles from the live address,
   its scripts left out (opening it counts no visit and sends no form) */
function pageAfterHtml(P, src) {
  const W = P.logo.picture.info.width, H = P.logo.picture.info.height;
  const c = changePage(P.page, planChange(P, { url: src, width: W, height: H, from: P.logo.candidate.url }));
  if (!c.ok) return '';
  let html = c.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const canon = /<link\b[^>]*\brel="canonical"[^>]*\bhref="(https:\/\/[^"\/]+)\//i.exec(P.page);
  if (canon) html = html.replace(/<head\b[^>]*>/i, function (h) { return h + '<base href="' + escAttr(canon[1]) + '/">'; });
  return html;
}
function compareHtml(P, o, before, after) {
  const W = P.logo.picture.info.width, H = P.logo.picture.info.height, box = o.unit.box, name = (P.data && P.data.name) || P.id;
  const from = P.years.from, to = P.years.to;
  /* the changed place, widened to take in the lettering beside it, enlarged up to 4 times */
  const crop = box ? clampBox({ x: box.x - box.width, y: box.y - box.height * 0.8, width: box.width * 3, height: box.height * 1.8 }, W, H) : { x: 0, y: 0, width: W, height: H };
  const k = Math.max(1, Math.min(4, Math.floor(1200 / crop.width)));
  const notes = (o.notes || []).length ? o.notes.map(function (n) { return '<li>' + escText(n) + '</li>'; }).join('') : '<li>' + (o.reused ? 'This picture was stored by an earlier --examine; its notes were printed by that run.' : 'none') + '</li>';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Logo check — ' + escText(name) + ' ' + escText(to) + '</title>\n<style>\n' +
    ':root{color-scheme:light;--ink:#1d1d1f;--muted:#55555c;--ground:#f4f1eb;--card:#fffdf9;--line:#e1dacd;--accent:#b0102a}\n' +
    '*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}\n' +
    'main{max-width:1320px;margin:0 auto;padding:24px 16px 56px}h1{font-size:22px;line-height:1.3;margin:0 0 6px}p{margin:0 0 10px}\n' +
    '.lead{color:var(--muted);max-width:70ch}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0;overflow-x:auto}\n' +
    '.card h2{font-size:15px;margin:0 0 10px}.card h2 small{font-weight:400;color:var(--muted);overflow-wrap:anywhere}.logo{display:block;width:' + W + 'px;max-width:100%;height:auto}\n' +
    '.pair{display:flex;flex-wrap:wrap;gap:16px}.zoom{margin:0;max-width:100%}.win{position:relative;overflow:hidden;width:100%;border:1px dashed #c4baa9;background:var(--ground)}\n' +
    '.win img{position:absolute;max-width:none}figcaption{font-size:13px;color:var(--muted);margin-top:4px}\n' +
    'code,pre{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}pre{white-space:pre-wrap;word-break:break-all;background:#f3efe7;border:1px solid var(--line);border-radius:8px;padding:10px;margin:0 0 10px}\n' +
    'ul{margin:0 0 10px;padding-left:20px}.warn{border-color:#e7b9c0}.warn h2{color:var(--accent)}\n' +
    '</style></head><body><main>\n' +
    '<h1>' + escText(name) + ': look at the ' + escText(to) + ' before it goes live</h1>\n' +
    '<p class="lead">The ' + escText(from) + ' edition\'s own logo with only its year moved, by ETB2B EventSphere\'s examination. Nothing is live yet: the banner changes only when the command at the bottom is run.</p>\n' +
    '<section class="card"><h2>' + escText(from) + ' <small>— the previous edition\'s, as on ETB2B\'s own site: ' + escText(P.logo.candidate.url) + '</small></h2><img class="logo" src="' + before + '" alt="The ' + escAttr(from) + ' logo" width="' + W + '" height="' + H + '"></section>\n' +
    '<section class="card"><h2>' + escText(to) + ' <small>— stored at ' + escText(o.unit.storagePath) + ', shown on no page yet</small></h2><img class="logo" src="' + after + '" alt="The ' + escAttr(to) + ' logo" width="' + W + '" height="' + H + '"></section>\n' +
    '<section class="card"><h2>The year and the lettering round it, ' + k + ' times as large</h2><div class="pair">' +
    zoomHtml(before, W, H, crop, k, from + ' (previous edition)') + zoomHtml(after, W, H, crop, k, to + ' (examined)') + '</div></section>\n' +
    '<section class="card"><h2>What to check</h2><ul><li>The new digits are drawn like the ones beside them and like the words above: the same thin, high-contrast serif lettering, the same weight, height, width and foot.</li>' +
    '<li>Nothing else changed: the words, the two rules and the spacing.</li></ul>' +
    '<p>Changed: ' + (box ? 'only ' + escText(boxText(box)) + ' of the ' + W + ' × ' + H + ' picture (' + box.pixels + ' pixels); every other pixel is the ' + escText(from) + ' artwork\'s.' : 'nothing') + '</p>' +
    '<p>The examination said:</p><ul>' + notes + '</ul></section>\n' +
    '<section class="card"><h2>When it looks right, put exactly this picture live (no model call)</h2><pre>' + escText(applyCommand(P.id, o.unit.storagePath)) + '</pre>' +
    '<p>If it does not, examine again — a new try, at most ' + MAX_READS + ' reading calls and ' + MAX_PICTURE_CALLS + ' picture call:</p><pre>' + escText('node tools/award-logo-from-previous.js --event ' + P.id + ' --examine --again') + '</pre>' +
    '<p>This picture goes on no page unless it is named in that command. The banner with it: <a href="page-after.html">page-after.html</a>.</p></section>\n' +
    '<section class="card warn"><h2>On a 2× screen</h2><p>The banner shows the lock-up up to ' + SHOWN_MAX + ' px wide. A 2× screen draws this ' + W + ' px artwork at about twice its size, so it looks soft beside the page\'s typed lettering, as on ETB2B\'s own ' + escText(from) + ' site. It is the previous edition\'s own artwork, so it is used as it is and never enlarged here; a sharper one needs a 2× PNG or an SVG of the lock-up from the ETCIO team.</p></section>\n' +
    '</main></body></html>\n';
}
/* -> [paths written] */
function writePreview(dir, P, o) {
  fs.mkdirSync(dir, { recursive: true });
  const before = 'data:image/png;base64,' + P.logo.picture.bytes.toString('base64'), after = 'data:image/png;base64,' + o.picture.bytes.toString('base64');
  const files = [
    ['compare.html', compareHtml(P, o, before, after)],
    ['page-after.html', pageAfterHtml(P, after)],
    ['logo-' + P.years.from + '.png', P.logo.picture.bytes],
    ['logo-' + P.years.to + '.png', o.picture.bytes]
  ].filter(function (f) { return f[1] && f[1].length; });
  return files.map(function (f) { const p = path.join(dir, f[0]); fs.writeFileSync(p, f[1]); return p; });
}

/* ---------- step 2: --apply ---------- */
/* The picture --unit names, checked again before it goes live: one --examine stored for this event, the previous
   edition's own artwork with one year-sized place changed, served to the public as stored.
   -> Promise<{ unit } | { why }> */
function storedUnit(fb, deps, P, given) {
  const id = P.id, prefix = publicUrlOf(fb, '');
  let p = String(given || '').trim();
  if (p.indexOf(prefix) === 0) p = p.slice(prefix.length);
  const m = new RegExp('^events/' + escRe(id) + '/generated/(\\d{14})-logo-unit\\.png$').exec(p);
  if (!m) return Promise.resolve({ why: '--unit must name a picture --examine stored for ' + id + ' (events/' + id + '/generated/<14 digits>-logo-unit.png), not "' + given + '"' });
  if (!P.logo) return Promise.resolve({ why: 'the previous edition\'s logo, which the picture is checked against, was not fetched' });
  return readBytes(fb, p).then(function (bytes) {
    if (!bytes || !bytes.length) return { why: 'no picture is stored at ' + p };
    const pic = { bytes: bytes, info: logoUnit.imageInfo(bytes) }, check = pictureCheck(P.logo.picture, pic);
    if (check.why) return { why: 'the picture at ' + p + ' is not the previous edition\'s logo with its year moved: ' + check.why };
    const url = publicUrlOf(fb, p);
    return Promise.resolve().then(function () { return deps.fetchBytes(url); }).then(function (served) {
      if (!served || Buffer.compare(Buffer.from(served), bytes) !== 0) return { why: url + ' does not serve the picture as stored, so the banner would not show it' };
      return { unit: { url: url, storagePath: p, stamp: m[1], width: pic.info.width, height: pic.info.height, from: P.logo.candidate.url, box: check.box } };
    }, function (err) { return { why: url + ' could not be fetched (' + (err && err.message) + '), so it is not known that the banner would show it' }; });
  });
}

/* -> Promise<{ ok, line, unit, edition, after, warning }> */
function apply(fb, deps, P, opts) {
  const hooks = deps.hooks, id = P.id, given = String((opts && opts.unit) || '').trim();
  if (!P.ok) return Promise.resolve({ ok: false, line: 'nothing done — ' + P.why });
  if (P.needsLogo && !given) return Promise.resolve({ ok: false, line: 'nothing done — the banner does not show the logo yet: run --examine first, look at the picture it stores, then --apply --unit <the storage path it printed>' });
  if (!P.needsLogo && given) return Promise.resolve({ ok: false, line: 'nothing done — the banner already shows a logo, so --unit is not needed' + (P.needsEdition ? ': --apply alone corrects the edition' : '') });
  const livePath = hooks.publishedObjectPath(id), keep = livePath.replace(/index\.html$/, BACKUP_NAME);
  function refused(why) { const err = new Error(why); err.refused = true; return err; }
  let unit = null;
  return (given ? storedUnit(fb, deps, P, given) : Promise.resolve({ unit: null })).then(function (s) {
    if (s.why) throw refused('the picture named was not put live: ' + s.why + '. Nothing written.');
    unit = s.unit;
    /* the event as it is now: it may have changed since the plan */
    return fb.db.collection('events').doc(id).get();
  }).then(function (snap) {
    const why = !snap.exists ? 'the event is gone' : eventWhy(snap.data(), P.cfg);
    if (why) throw refused('the event changed since it was read: ' + why + '. Nothing written.');
    /* the page as it is now (it may have changed since the plan), changed as planned */
    return hooks.readObject(fb, livePath);
  }).then(function (before) {
    if (before == null) throw new Error('its live page was not found');
    const c = changePage(before, planChange(P, unit || {}));
    if (!c.ok) throw refused(c.why + '. Nothing written.');
    if (!c.changed) return { ok: true, line: 'nothing to change on its live page' };
    return hooks.readObject(fb, keep).then(function (kept) {
      /* the copy of the page before is made once: a later run never writes over it */
      return kept != null ? 'kept as it was' : hooks.saveObject(fb, keep, before, HTML_TYPE).then(function () { return 'made'; });
    }).then(function (backup) {
      return hooks.saveObject(fb, livePath, c.html, HTML_TYPE).then(function () {
        if (typeof hooks.forgetCachedPage === 'function') hooks.forgetCachedPage(id);
        const did = [], edited = !!(c.edition && (c.edition.banner || c.edition.words));
        if (unit) did.push('the ' + P.years.from + ' logo, its year moved to ' + P.year + ' (' + unit.storagePath.replace(/^events\/[^\/]+\//, '') + '), in place of the typed title');
        if (edited) did.push('"' + c.edition.from + ' Edition" corrected to "' + c.edition.to + ' Edition" (ETB2B\'s API)');
        /* the history keeps 300 characters of a line (activity.js): this one stays under that */
        return Promise.resolve(deps.logActivity(fb, id, ACTOR, 'published', 'its live page: ' + did.join('; ') + '; put live on the owner\'s instruction (' + DAY + '); page before kept as published/' + BACKUP_NAME, {}))
          .then(function (logged) {
            return { ok: true, unit: unit, edition: c.edition, after: c.after,
              warning: logged === false ? 'the line in its history could not be written (the page is live)' : '',
              line: 'its live page changed at /e/' + id + (unit ? '; the banner shows ' + unit.storagePath : '') +
                (edited ? '; edition ' + c.edition.from + ' -> ' + c.edition.to + ' (banner ' + c.edition.banner + ', words ' + c.edition.words + ')' : '') +
                '; the page before ' + (backup === 'made' ? 'is kept as ' : 'was already kept as ') + keep };
          });
      });
    });
  }).then(null, function (err) { return { ok: false, refused: !!(err && err.refused), line: (err && err.refused ? 'REFUSED — ' : 'FAILED — ') + (err && err.message) }; });
}

/* ---------- what is printed ---------- */
function printPlan(P, mode) {
  const head = { dry: 'DRY RUN — no model call, nothing written.', examine: 'EXAMINE — the year moved and the result stored where no page shows it; no page written.', apply: 'APPLY — no model call: the picture named goes live.' };
  console.log(head[mode] + '\n' + P.id + (P.data && P.data.name ? ' — ' + P.data.name : ''));
  P.lines.forEach(function (l) { console.log('  ' + l); });
  if (!P.ok) { console.log('  ' + (/^nothing to do/.test(P.why) ? '' : 'NOT DONE — ') + P.why); return; }
  const c = P.change;
  if (mode !== 'examine' && P.needsLogo) console.log('  banner element replaced (the <h1> title set in type):\n    ' + c.before);
  if (mode === 'dry' && P.needsLogo) console.log('  new markup (the picture\'s address is known once --examine has stored it):\n    ' + c.after);
  if (c.edition) console.log('  edition: "' + c.edition.from + ' Edition" -> "' + c.edition.to + ' Edition" in the banner: ' + c.edition.banner + '; "' + ORDINAL_WORDS[P.facts.from] + ' edition — … ' + P.year + '" -> "' + ORDINAL_WORDS[P.facts.to] + ' edition — …": ' + c.edition.words);
  if (mode === 'dry' && P.needsLogo) {
    console.log('  on a 2x screen: shown up to ' + SHOWN_MAX + ' px wide, the ' + P.logo.picture.info.width + ' px artwork is drawn at about twice its size and looks soft, as on ETB2B\'s own ' + P.years.from + ' site; it is used as it is, never enlarged (a sharper one needs a 2x PNG or an SVG from the ETCIO team)');
  }
}
function printUnusable(earlier) {
  ((earlier && earlier.unusable) || []).forEach(function (u) { console.log('  not used: ' + u.path + ' — ' + u.why); });
}
function printNext(P, earlier) {
  if (!P.ok) return;
  if (earlier && earlier.usable.length) {
    console.log('\nAlready stored by an earlier --examine, and still the ' + P.years.from + ' artwork with only its year changed (newest first): ' + earlier.usable.map(function (e) { return e.path; }).join(', ') +
      '\n  --examine writes the newest one\'s preview again with no model call; once one has been looked at and is right: --apply --unit <its path>.');
  }
  printUnusable(earlier);
  if (earlier && earlier.why) console.log('  (' + earlier.why + ')');
  if (P.needsLogo) {
    console.log('\nNext, in two runs with a look in between:\n' +
      '  1. node tools/award-logo-from-previous.js --event ' + P.id + ' --examine\n' +
      '     at most ' + MAX_READS + ' reading calls and ' + MAX_PICTURE_CALLS + ' picture call (Gemini); stores the picture where no page shows it and writes a preview to look at; no page written.\n' +
      '     The redraw is tried once per run: a refused run may succeed when run again (each run is a new try).\n' +
      '  2. node tools/award-logo-from-previous.js --event ' + P.id + ' --apply --unit <the storage path step 1 prints>\n' +
      '     no model call; puts exactly that picture in the banner' + (P.needsEdition ? ', corrects the edition' : '') + ', keeps the page before as events/' + P.id + '/published/' + BACKUP_NAME + ' (if not kept already) and writes a line in the event\'s history.');
  } else {
    console.log('\nNext: node tools/award-logo-from-previous.js --event ' + P.id + ' --apply   (no model call; corrects the edition only)');
  }
}
function printExamined(P, r) {
  console.log('\n' + P.id + ': ' + r.line);
  printUnusable(r);
  if (r.notes && r.notes.length) console.log('  the examination said: ' + r.notes.join(' '));
  if (!r.ok) {
    if (r.refused) console.log('  Only a year redrawn in the logo\'s own lettering is used; the redraw is tried once per run, on the first reading. Each --examine is a new try (at most ' + MAX_READS + ' reading calls and ' + MAX_PICTURE_CALLS + ' picture call): running it again may succeed, and may take a few tries.');
    return;
  }
  const u = r.unit;
  console.log('  changed: only ' + boxText(u.box) + ' of the ' + u.width + ' × ' + u.height + ' picture (' + u.box.pixels + ' pixels); every other pixel is the ' + P.years.from + ' artwork\'s');
  console.log('  stored: ' + u.storagePath + '\n    ' + u.url);
  if (r.files && r.files.length) console.log('  LOOK AT IT before it goes live:\n    ' + r.files.join('\n    '));
  if (r.previewWhy) console.log('  ' + r.previewWhy + ' — look at the picture at its address above');
  console.log('  When the ' + P.years.to + ' is drawn like the logo\'s own lettering, put exactly this picture live (no model call):\n    ' + applyCommand(P.id, u.storagePath));
  console.log('  If it is not, examine again (a new try): node tools/award-logo-from-previous.js --event ' + P.id + ' --examine --again');
}
function printApplied(P, r) {
  console.log('\n' + P.id + ': ' + r.line);
  if (r.after) console.log('  new markup:\n    ' + r.after);
  if (r.warning) console.log('  WARNING: ' + r.warning);
  if (r.ok && r.unit) console.log('  The live page shows it within about a minute (the server keeps a page a minute; a browser or the CDN may keep the old one up to ten minutes more).');
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.usage) { console.error(a.usage + '\n' + USAGE); process.exit(2); }
  /* the credentials, once the command is known to be one: this checkout's, else the main checkout's (from a worktree) */
  const envFile = [path.join(ROOT, 'tools', '.env.local'), path.join(ROOT, '..', '..', '..', 'tools', '.env.local')].filter(function (f) { return fs.existsSync(f); })[0];
  if (envFile) {
    fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (l) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  }
  const api = require(path.join(lib, 'api.js'));
  const { safeFetch } = require(path.join(lib, 'safe-fetch.js'));
  const { getFirebase } = require(path.join(lib, 'firebase.js'));
  const { logActivity } = require(path.join(lib, 'activity.js'));
  const hooks = api._testHooks;
  const fb = getFirebase();
  if (fb.error) { console.error('Cannot start: ' + fb.error); process.exit(1); }
  const deps = {
    hooks: hooks, logActivity: logActivity,
    fetchJson: function (u, headers) {
      return safeFetch(u, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, headers: Object.assign({ accept: 'application/json' }, headers || {}) })
        .then(function (r) { return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; });
    },
    /* ETB2B's pages turn away unknown readers on some portals: asked as a desktop browser (et-awards.js CHROME_UA) */
    fetchText: function (u) { return safeFetch(u, { timeoutMs: 20000, maxBytes: PAGE_MAX_BYTES, maxRedirects: 5, userAgent: etAwards.CHROME_UA }).then(function (r) { return r.status === 200 ? r.body.toString('utf8') : ''; }); },
    fetchBytes: function (u) { return safeFetch(u, { timeoutMs: 8000, maxBytes: LOGO_MAX_BYTES }).then(function (r) { return r.status === 200 ? r.body : null; }); },
    examine: function (fbx, id, picture, ctx) { return hooks.examineUnit(fbx, id, picture, ctx); }
  };
  return plan(fb, deps, a.id).then(function (P) {
    printPlan(P, a.mode);
    if (a.mode === 'dry') {
      return (P.ok && P.needsLogo ? earlierExaminations(fb, P) : Promise.resolve(null)).then(function (earlier) {
        printNext(P, earlier);
        console.log('\nDRY RUN: nothing written.');
        return P.ok || /^nothing to do/.test(P.why) ? 0 : 1;
      });
    }
    if (!P.ok) return /^nothing to do/.test(P.why) ? 0 : 1;
    if (a.mode === 'examine') return examine(fb, deps, P, { out: a.out, again: a.again }).then(function (r) { printExamined(P, r); return r.ok ? 0 : 1; });
    return apply(fb, deps, P, { unit: a.unit }).then(function (r) { printApplied(P, r); return r.ok ? 0 : 1; });
  }).then(function (code) { process.exit(code); });
}

module.exports = { parseArgs: parseArgs, plan: plan, examine: examine, apply: apply, printPlan: printPlan, changePage: changePage, findTitle: findTitle, judge: judge,
  pictureCheck: pictureCheck, changedBox: changedBox, storedUnit: storedUnit, storedExaminations: storedExaminations, earlierExaminations: earlierExaminations, eventWhy: eventWhy, writePreview: writePreview,
  printNext: printNext, printExamined: printExamined, printApplied: printApplied,
  editionNumber: editionNumber, ordinal: ordinal, previousEdition: previousEdition, editionFacts: editionFacts, previousLogo: previousLogo,
  EVENTS: EVENTS, BACKUP_NAME: BACKUP_NAME, REDRAWN: REDRAWN, MAX_READS: MAX_READS, MAX_PICTURE_CALLS: MAX_PICTURE_CALLS };
if (require.main === module) main().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
