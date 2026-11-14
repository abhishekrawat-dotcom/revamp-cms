/* node tools/award-logo-from-previous.js --event cio-awards --dry   -> reads only: says what it found and would write
   node tools/award-logo-from-previous.js --event cio-awards         -> does it, and puts it live

   CIO Awards (cio-awards) is one of the four dummy events: an imported site published on 9 Oct 2026, the way sites
   were then — one live page (events/cio-awards/published/index.html, what /e/cio-awards serves) and no saved site or
   versions. Its banner opens with the award's name set in type ("The Economic Times Awards for / Enterprise Tech
   Excellence / — 2027 —"), where ETB2B's own award sites lead with the award's logo lock-up: the 2026 edition's own
   microsite has this very banner, with the typed title commented out and its logo picture (class "bnr-logo") in its
   place. The owner asked on 14 Nov 2026 for the dummy events to get logos, by the logo rules: the previous edition's
   transparent lock-up with ONLY the year changed, in the same form ("2026" -> "2027"), never boxed, redrawn or put on
   a plate; only real facts, confirmed from ETB2B's own API.

   For one event it does, in order:
     1. the previous edition, from ETB2B's public award listing on the event's portal (et-events.js, /v1/award-listing;
        an award row's id is its microsite's): the edition of the same award (the address without its year:
        enterprise-tech-award2025 -> enterprise-tech-award) held the year before this one;
     2. that edition's logo: its own microsite read, and its logo found there as the product finds a previous
        edition's (logo-unit.js findLogoCandidates; the first that is a picture of a lock-up, as previousEditionUnit
        picks it). It must be a picture with a see-through ground (a lock-up on a plate of its own is refused);
     3. the lock-up examined exactly as the product examines a previous edition's unit (lib/api.js examineUnit, with
        the context previousEditionUnit gives it): the year it shows read and moved to this edition's in the same
        form, kept only when a second reading finds the new year there and the old one gone; a sponsor's or another
        mark cropped out; nothing else changed. Up to four reading calls and one picture call (Gemini), in a real run
        only. Refused — nothing written, and the reason said — when it could not be read, still shows the old year,
        keeps a mark that could not be cropped out, the new year could not be checked, or it is drawn for a dark
        ground (the banner is light). The result is stored as the product stores a hero's unit (storeLogoUnit: a
        public picture, events/<id>/generated/<stamp>-logo-unit.<ext>);
     4. the banner: the typed title is replaced by the lock-up, in the same place, as on ETB2B's own site; the <h1>
        stays, its words kept for search engines and screen readers but not shown (class sr-only, the page's own).
        The picture carries the product's mark for a hero's logo unit (img.rv-lu-img);
     5. the edition number, if and only if ETB2B's API confirms it: the previous edition's microsite says which
        edition it was (template_settings.edition_txt, "3rd Edition"), the award listing holds exactly that many
        editions of the award up to it and none between it and this one — then this one is the next ("4th
        Edition"), and the banner's line and the words naming this edition ("third edition — … 2027") say so;
     6. the page written as tools/refresh-dummy-dates.js writes this event's: a copy of the page before beside it
        (published/before-logo-2026-11-14.html, never overwritten once there), the new page, and a line in the
        event's history saying it was put live on the owner's instruction.
   A second run finds the logo in the banner and the edition right, and does nothing (no model call).

   NEVER TOUCHED: anything but that one page and the one stored picture — the event's record, its logo field, its
   Basics. An event with saved versions is refused (its site is the editor's), as is any hero not as expected.

   node tools/award-logo-from-previous.js --event <id> [--dry]
     --dry   reads only: makes NO model call and writes nothing. It reads the event and its live page, asks ETB2B's
             public API (read-only), fetches the previous edition's site and logo (public), and prints the logo it
             found, the edition facts with the API addresses, the banner element it would replace and the new markup.
   Env: tools/.env.local (this checkout's, else the main checkout's when run from a worktree), never printed; loaded
   only when this file is run, never when a test requires it. */
'use strict';
const fs = require('fs');
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
const PAGE_MAX_BYTES = 2 * 1024 * 1024;  // as api-generate.js SOURCE_PAGE_MAX_BYTES
const MAX_READS = 4, MAX_PICTURE_CALLS = 1;
const API = etEvents.API;

/* What this tool knows of each event it may change: the event's portal on ETB2B, the award's address there without
   its year (enterprise-tech-award2024, enterprise-tech-award2025, enterprise-tech-award: one award, three editions, as
   ETB2B's award listing gives them), and the words its banner's title must read (with this edition's year) — any
   other banner is left alone. */
const EVENTS = {
  'cio-awards': { portal: 'cio', series: 'enterprise-tech-award', title: /^The Economic Times Awards for Enterprise Tech Excellence (20\d\d)$/ }
};

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
  const shown = Math.min(w || 720, 720);
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

/* ---------- the previous edition's logo ---------- */
/* see-through ground, as a share of the picture: a PNG decoded; an SVG has one by nature; anything else none */
function clearShare(bytes, info) {
  if (info.type === 'svg') return 1;
  if (info.type !== 'png') return 0;
  const img = pngLite.decode(bytes);
  if (!img) return 0;
  const d = img.data, n = img.width * img.height;
  let clear = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 24) clear++;
  return clear / n;
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
        const clear = clearShare(pic.bytes, pic.info);
        /* a lock-up on a plate of its own would stand in the banner as a box: never */
        if (clear < 0.2) { refusals.push(c.url + ' has no see-through ground (' + Math.round(clear * 100) + '% clear): it would stand in the banner as a box'); return pick(i + 1); }
        return { picture: pic, candidate: c, clear: clear, hints: hints, candidates: candidates };
      }, function (err) { refusals.push(c.url + ' could not be downloaded (' + (err && err.message) + ')'); return pick(i + 1); });
    }
    return pick(0);
  }, function (err) { return { why: 'the previous edition\'s own site (' + prev.link + ') could not be read (' + (err && err.message) + ')' }; });
}

/* Was the year moved cleanly? -> '' when so, else why not (for the owner and the operator) */
function judge(ex, years) {
  if (!ex || !ex.picture) return 'it could not be examined';
  if (ex.unread) return 'it could not be read, so its year could not be checked or moved';
  if (ex.stuck) return 'it still shows ' + ex.stuck + ': its year could not be moved to ' + (logoUnit.yearAs(ex.stuck, years.to) || years.to) + ' cleanly';
  if (ex.extrasLeft) return 'it carries a mark that is not the award\'s own and could not be cropped out cleanly';
  const notes = (ex.notes || []).join(' ');
  const m = /The year in the logo unit was changed from ([^\s:;,]+) to ([^\s:;,]+)/.exec(notes);
  if (!m) return 'its year was not moved (' + (ex.seen ? 'the reading named the edition\'s year as "' + ex.seen + '"' : 'the reading found no year in it') + ')';
  const to = logoUnit.shownYear(m[2]);
  if (!to || to.full !== years.to) return 'its year was moved to ' + m[2] + ', not ' + years.to;
  if (/could not be checked by a second reading/.test(notes)) return 'its new year could not be checked by a second reading';
  if (ex.tone === 'for-dark') return 'it is drawn for a dark ground (light lettering) and the banner is light';
  const why = logoUnit.plausibleUnit(ex.picture.info);
  if (why) return 'what is left of it is not a logo unit (' + why + ')';
  if (clearShare(ex.picture.bytes, ex.picture.info) < 0.2) return 'what is left of it has no see-through ground';
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
    if (e.deletedAt) return stop('deleted — left alone');
    if (e.published !== true) return stop('not live — left alone');
    if (+e.publishedVersion || (e.site && +e.site.version)) return stop('it has saved versions: its site is the editor\'s, not this tool\'s — left alone');
    if (e.portal && e.portal !== cfg.portal) return stop('its portal is ' + e.portal + ', not ' + cfg.portal + ' — left alone');
    P.year = yearOf(e.start) || '';
    if (!P.year) return stop('Basics hold no date: this edition\'s year is not known');
    P.lines.push('live since ' + (e.publishedAt || '?') + ' as one page (published before sites had versions); this edition: ' + P.year + ' (Basics: ' + String(e.start).slice(0, 10) + ')');
    return hooks.readObject(fb, hooks.publishedObjectPath(id)).then(function (page) {
      if (page == null) return stop('its live page was not found');
      P.page = page;
      const title = findTitle(page, cfg.title);
      if (!title) return stop('the banner\'s title was not found on its live page — left alone');
      if (!title.done && title.year !== P.year) return stop('the banner\'s title says ' + title.year + ', not ' + P.year + ' (run tools/refresh-dummy-dates.js first) — left alone');
      P.title = title;
      P.name = title.done ? '' : title.text;
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
            Math.round(info.width) + ' × ' + Math.round(info.height) + ', ' + Math.round(logo.clear * 100) + '% see-through' + (logo.picture.stacked ? ', stacked with other marks (to be cut down)' : ''));
          if (P.years.to !== P.year) return stop('the year it must carry would be ' + (P.years.to || 'unknown') + ', not ' + P.year);
          if (!P.years.from) return stop('the previous edition\'s site does not say its year, so the year its logo shows cannot be checked');
          P.lines.push('year: the previous edition\'s ' + P.years.from + ' to be moved to ' + P.years.to + ', in the same form (read from the picture in a real run)');
        }
        /* the change, with the picture still to be made: its address as it will be stored */
        const stand = { url: 'https://storage.googleapis.com/' + (fb.bucket && fb.bucket.name || 'BUCKET') + '/events/' + id + '/generated/YYYYMMDDHHMMSS-logo-unit.' + (logo ? (logo.picture.info.type === 'jpeg' ? 'jpg' : logo.picture.info.type) : 'png'),
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

/* ---------- the real run ---------- */
/* -> Promise<{ ok, line }> */
function apply(fb, deps, P) {
  const hooks = deps.hooks, id = P.id;
  if (!P.ok) return Promise.resolve({ ok: false, line: 'nothing done — ' + P.why });
  const livePath = hooks.publishedObjectPath(id), keep = livePath.replace(/index\.html$/, BACKUP_NAME);
  const stamp = (deps.now ? deps.now() : new Date()).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  let unit = null;
  const made = !P.needsLogo ? Promise.resolve(null) : Promise.resolve().then(function () {
    const ctx = { years: P.years, origin: 'previous-edition', eventName: P.name, deadlineAt: Date.now() + 240000 };
    return deps.examine(fb, id, { bytes: P.logo.picture.bytes, info: P.logo.picture.info }, ctx);
  }).then(function (ex) {
    const why = judge(ex, P.years);
    if (why) { const err = new Error('the previous edition\'s logo was not used: ' + why + '. Nothing written.'); err.refused = true; throw err; }
    return hooks.storeLogoUnit(fb, id, stamp, ex.picture).then(function (stored) {
      unit = { url: stored.url, storagePath: stored.storagePath, width: ex.picture.info.width, height: ex.picture.info.height, from: P.logo.candidate.url, notes: ex.notes || [] };
      return unit;
    });
  });
  return made.then(function () {
    /* the page as it is now (it may have changed since the plan), changed as planned */
    return hooks.readObject(fb, livePath);
  }).then(function (before) {
    if (before == null) throw new Error('its live page was not found');
    const c = changePage(before, planChange(P, unit || {}));
    if (!c.ok) throw new Error(c.why + '. Nothing written' + (unit ? ' (the examined logo is stored at ' + unit.storagePath + ', unused)' : '') + '.');
    if (!c.changed) return { ok: true, line: 'nothing to change on its live page' };
    return hooks.readObject(fb, keep).then(function (kept) {
      /* the copy of the page before is made once: a later run never writes over it */
      return kept != null ? 'kept as it was' : hooks.saveObject(fb, keep, before, HTML_TYPE).then(function () { return 'made'; });
    }).then(function (backup) {
      return hooks.saveObject(fb, livePath, c.html, HTML_TYPE).then(function () {
        if (typeof hooks.forgetCachedPage === 'function') hooks.forgetCachedPage(id);
        const did = [];
        if (unit) did.push('the previous edition\'s logo, its year moved to ' + P.year + ', put in the banner in place of the title set in type');
        if (c.edition && (c.edition.banner || c.edition.words)) did.push('"' + c.edition.from + ' Edition" corrected to "' + c.edition.to + ' Edition" (ETB2B\'s API)');
        /* the history keeps 300 characters of a line (activity.js): this one stays under that */
        return deps.logActivity(fb, id, ACTOR, 'published', 'its live page — ' + did.join('; ') + '; put live on the owner\'s instruction (' + DAY + '); page before kept as published/' + BACKUP_NAME, {})
          .then(function () {
            return { ok: true, unit: unit, edition: c.edition, line: 'its live page changed at /e/' + id + (unit ? '; logo stored at ' + unit.storagePath : '') +
              (c.edition && (c.edition.banner || c.edition.words) ? '; edition ' + c.edition.from + ' -> ' + c.edition.to + ' (banner ' + c.edition.banner + ', words ' + c.edition.words + ')' : '') +
              '; the page before ' + (backup === 'made' ? 'is kept as ' : 'was already kept as ') + keep };
          });
      });
    });
  }).then(null, function (err) { return { ok: false, refused: !!(err && err.refused), line: (err && err.refused ? 'REFUSED — ' : 'FAILED — ') + (err && err.message) }; });
}

function printPlan(P, dry) {
  console.log((dry ? 'DRY RUN — no model call, nothing written.\n' : '') + P.id + (P.data && P.data.name ? ' — ' + P.data.name : ''));
  P.lines.forEach(function (l) { console.log('  ' + l); });
  if (!P.ok) { console.log('  nothing to do — ' + P.why); return; }
  const c = P.change;
  if (P.needsLogo) {
    console.log('  banner element replaced (the <h1> title set in type):\n    ' + c.before);
    console.log('  new markup (the stored picture\'s address is known once it is stored):\n    ' + c.after);
  }
  if (c.edition) console.log('  edition: "' + c.edition.from + ' Edition" -> "' + c.edition.to + ' Edition" in the banner: ' + c.edition.banner + '; "' + ORDINAL_WORDS[P.facts.from] + ' edition — … ' + P.year + '" -> "' + ORDINAL_WORDS[P.facts.to] + ' edition — …": ' + c.edition.words);
}

function main() {
  function arg(name) { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : ''; }
  const ID = arg('event'), DRY = process.argv.indexOf('--dry') !== -1;
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(ID)) { console.error('Usage: node tools/award-logo-from-previous.js --event <event id> [--dry]'); process.exit(2); }
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
  return plan(fb, deps, ID).then(function (P) {
    printPlan(P, DRY);
    if (DRY) {
      console.log('\nDRY RUN: nothing written.' + (P.ok ? ' A real run would make at most ' + (P.needsLogo ? MAX_READS + ' reading calls and ' + MAX_PICTURE_CALLS + ' picture call (Gemini) to move the year, store the result under events/' + ID + '/generated/, ' : '') +
        'keep the page before as events/' + ID + '/published/' + BACKUP_NAME + ' (if not kept already), write the new page and a line in the event\'s history.' : ''));
      return P.ok || /^nothing to do/.test(P.why) ? 0 : 1;
    }
    if (!P.ok) return /^nothing to do/.test(P.why) ? 0 : 1;
    return apply(fb, deps, P).then(function (r) {
      console.log('\n' + ID + ': ' + r.line);
      if (r.unit && r.unit.notes.length) console.log('  examination: ' + r.unit.notes.join(' '));
      return r.ok ? 0 : 1;
    });
  }).then(function (code) { process.exit(code); });
}

module.exports = { plan: plan, apply: apply, printPlan: printPlan, changePage: changePage, findTitle: findTitle, judge: judge, editionNumber: editionNumber, ordinal: ordinal, previousEdition: previousEdition, editionFacts: editionFacts, previousLogo: previousLogo, EVENTS: EVENTS, BACKUP_NAME: BACKUP_NAME };
if (require.main === module) main().catch(function (err) { console.error('FAILED: ' + (err && err.stack || err)); process.exit(1); });
