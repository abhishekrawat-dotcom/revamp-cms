/* The check before Publish: what is good to put right before a site goes live, in plain words, each with a link to
   the place to put it right (owner decision #11, part 3.2; ~/.revamp-cms-qa/ai-learning/SPEC.md "Check before
   Publish").

   WHY: the site check (lib/api.js siteCheckOf, lib/site-checks.js) holds back what must never go live — template
   text, another event's samples, a picture storage does not have, last year's logo — and the approver reads it on
   the review page. What a visitor would still trip over was said nowhere: a link to another site that leads
   nowhere, a partner's logo that does not load, a section left with only its heading, the banner still giving last
   month's date after the event moved, a "Register" button whose form was switched off. This adds those to the same
   list, so the person publishing sees them in the publish window and the approver on the review page.

   ADVISORY, ALWAYS: every item here is 'warn' (or 'info'): it never holds a version back, never stops Publish,
   sending for approval or Approve. What blocks today blocks exactly as before (siteCheckGate never asks for these).
   Deterministic: no AI is asked anything.

     check(html, ctx) -> Promise<{ items, pending }>
       ctx: { kit (api.js TOKEN_KIT), eventId, event (the event's data), inspect (site-checks.js inspect of the page,
              when the caller has it), forms (the public forms payload, or null when
              it could not be read: then forms are not checked; or a Promise of it, so other sites are asked
              while it is read), pages ([{ slug }] the site's internal pages),
              version (the site's version: outside answers are remembered per version), waitMs (how long to wait for
              other sites to answer; what is still unknown is counted in pending and said so),
              fetch, fetchOptions, fileExists (tests) }
       items: the site check's shape: [{ code, level, advisory: true, title, lines, hint, fix: [Fix] }]
     editorFix(eventId, event, key, name) -> Fix   the site editor, at that section (custom_editor.html ?section=)
     consoleFix(eventId, route, label)    -> Fix   the event console at that tab (edit-event.html #route)
     sectionFixes(eventId, event, places) -> [Fix] one per section the findings stand in (at most FIXES_MAX)
       Fix: { where: 'editor' | 'console', key | route, label, href } — the publish window shows the section in the
       editor it is open in, or goes to the console's tab; the review page opens it in a new tab.
   Node 20, CommonJS. Tests: site-advisory.test.js (the network stubbed). */
'use strict';

var fs = require('fs');
var path = require('path');
var siteChecks = require('./site-checks');
var linkCheck = require('./link-check');
var etNav = require('./et-nav');

var ROOT = path.join(__dirname, '..', '..');
var FIXES_MAX = 4, LINES_MAX = 12;

/* ---------- the places to put it right ---------- */
function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }
function templateOf(event) { return (event && (event.templateId || (event.site && event.site.templateId))) || ''; }
function editorFix(eventId, event, key, name) {
  var tpl = templateOf(event);
  return {
    where: 'editor', key: String(key || ''),
    label: key && name ? '“' + name + '” in the site editor' : 'The site editor',
    href: '/custom_editor.html?event=' + enc(eventId) + (tpl ? '&template=' + enc(tpl) : '') + (key ? '&section=' + enc(key) : '')
  };
}
function consoleFix(eventId, route, label) {
  return { where: 'console', route: route, label: label, href: '/edit-event.html?event=' + enc(eventId) + '#' + route };
}
/* places: [{ key, section }] -> one fix per section, in the order found */
function sectionFixes(eventId, event, places) {
  var out = [], seen = {};
  (places || []).forEach(function (p) {
    var k = String((p && p.key) || '');
    if (seen[k] || out.length >= FIXES_MAX) return;
    seen[k] = 1;
    out.push(editorFix(eventId, event, k, p.section));
  });
  return out.length ? out : [editorFix(eventId, event, '', '')];
}

/* ---------- words ---------- */
function quote(s, max) { s = String(s || ''); max = max || 60; return '“' + (s.length > max ? s.slice(0, max - 1) + '…' : s) + '”'; }
function cap(lines) {
  return lines.length > LINES_MAX ? lines.slice(0, LINES_MAX - 1).concat(['…and ' + (lines.length - LINES_MAX + 1) + ' more']) : lines;
}
/* "example.com/agenda.pdf": the address as a person reads it */
function shortUrl(url) {
  var u;
  try { u = new URL(url); } catch (e) { return String(url).slice(0, 70); }
  var p = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + (u.search ? u.search : '');
  return p.length > 70 ? p.slice(0, 69) + '…' : p;
}
function fileOf(url) {
  var f = String(url).replace(/[?#].*$/, '').split('/').pop() || url;
  try { f = decodeURIComponent(f); } catch (e) { /* as written */ }
  return f;
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* a picture that is one of this product's own files (/templates/…, /assets/…) is there when its file is */
function ownFileExists(urlPath) {
  var p;
  try { p = decodeURIComponent(String(urlPath).replace(/[?#].*$/, '')); } catch (e) { return false; }
  var full = path.normalize(path.join(ROOT, p));
  if (full.indexOf(ROOT + path.sep) !== 0) return false;
  try { return fs.statSync(full).isFile(); } catch (e) { return false; }
}

function check(html, ctx) {
  ctx = ctx || {};
  var kit = ctx.kit, eventId = ctx.eventId, event = ctx.event || {};
  var text = String(html == null ? '' : html), page = siteChecks.read(text, kit);     // one reading for every check below
  var links = siteChecks.outsideLinks(page, kit);
  var pics = siteChecks.pictureRefs(page, kit);
  var outsidePics = pics.filter(function (p) { return p.kind === 'outside'; });
  var key = String(eventId || '') + '@' + String(ctx.version || 0);
  var ask = { key: key, waitMs: ctx.waitMs, fetch: ctx.fetch, fetchOptions: ctx.fetchOptions };
  /* about 40 addresses a check, links and pictures together (link-check.js share) */
  var budget = linkCheck.share(links.length, outsidePics.length, linkCheck.MAX_PER_CHECK);
  return Promise.all([
    linkCheck.check(links, Object.assign({ kind: 'link', max: budget.links }, ask)),
    linkCheck.check(outsidePics, Object.assign({ kind: 'picture', max: budget.pictures }, ask)),
    Promise.resolve(ctx.forms).then(null, function () { return null; })
  ]).then(function (answers) {
    var items = [];
    function push(item) { items.push(Object.assign({ advisory: true }, item)); }
    var byLink = {}, byPic = {};
    answers[0].results.forEach(function (r) { byLink[r.url] = r; });
    answers[1].results.forEach(function (r) { byPic[r.url] = r; });

    /* links that lead nowhere: to another site that is not there, or to a page this site does not have */
    var dead = links.filter(function (l) { return byLink[l.url] && byLink[l.url].state === 'broken'; });
    var nopage = siteChecks.pageLinks(page, kit, ctx.pages || []);
    if (dead.length || nopage.length) {
      push({ code: 'links', level: 'warn',
        title: plural(dead.length + nopage.length, 'link leads nowhere', 'links lead nowhere'),
        lines: cap(dead.map(function (l) { return quote(l.label || shortUrl(l.url), 50) + ' (' + l.section + ') goes to ' + shortUrl(l.url) + ': ' + byLink[l.url].why; })
          .concat(nopage.map(function (l) { return quote(l.label || l.page, 50) + ' (' + l.section + ') goes to a page this site does not have (“' + l.page + '”)'; }))),
        hint: 'Visitors who press them reach nothing. Correct the address, or take the link out, in the site editor, then save.',
        fix: sectionFixes(eventId, event, dead.concat(nopage)) });
    }

    /* pictures from other sites that do not load, and pictures of this product's own files that are not there */
    var badPics = outsidePics.filter(function (p) { return byPic[p.url] && byPic[p.url].state === 'broken'; });
    var exists = typeof ctx.fileExists === 'function' ? ctx.fileExists : ownFileExists;
    var missingOwn = pics.filter(function (p) { return p.kind === 'own' && !exists(p.url); });
    if (badPics.length || missingOwn.length) {
      push({ code: 'outside-pictures', level: 'warn',
        title: plural(badPics.length + missingOwn.length, 'picture does not load', 'pictures do not load'),
        lines: cap(badPics.map(function (p) { return quote(fileOf(p.url)) + ' (' + p.section + ') from ' + shortUrl(p.url).split('/')[0] + ': ' + byPic[p.url].why; })
          .concat(missingOwn.map(function (p) { return quote(fileOf(p.url)) + ' (' + p.section + '): there is no such file'; }))),
        hint: 'Visitors see an empty space or a broken picture there. Replace the picture in the site editor, then save.',
        fix: sectionFixes(eventId, event, badPics.concat(missingOwn)) });
    }

    /* what could not be checked, or not yet, said so: never a silent "all fine" */
    var unknownLinks = links.filter(function (l) { return byLink[l.url] && byLink[l.url].state === 'unknown'; });
    var unknownPics = outsidePics.filter(function (p) { return byPic[p.url] && byPic[p.url].state === 'unknown'; });
    var skipped = answers[0].skipped + answers[1].skipped;
    if (unknownLinks.length || unknownPics.length || skipped) {
      var ul = unknownLinks.map(function (l) { return quote(l.label || shortUrl(l.url), 50) + ' (' + l.section + ') goes to ' + shortUrl(l.url) + ': ' + byLink[l.url].why; })
        .concat(unknownPics.map(function (p) { return 'The picture ' + quote(fileOf(p.url)) + ' (' + p.section + '): ' + byPic[p.url].why; }));
      ul = cap(ul);
      var most = 'at most ' + linkCheck.MAX_PER_CHECK + ' links and pictures from other sites are checked each time, those shown most first.';
      if (answers[0].skipped) ul.push(plural(answers[0].skipped, 'more link was', 'more links were') + ' not checked' + (answers[1].skipped ? '.' : ': ' + most));
      if (answers[1].skipped) ul.push(plural(answers[1].skipped, 'more picture from another site was', 'more pictures from other sites were') + ' not checked: ' + most);
      var nUnknown = unknownLinks.length + unknownPics.length;
      push({ code: 'links-unchecked', level: 'info',
        title: nUnknown ? plural(nUnknown, 'link or picture could not be checked', 'links and pictures could not be checked')
          : answers[0].skipped && answers[1].skipped ? 'Not every link and picture was checked' : answers[0].skipped ? 'Not every link was checked' : 'Not every picture from another site was checked',
        lines: ul, hint: 'Some sites do not answer checks like this one, so they may well work. Open them yourself to be sure.',
        fix: sectionFixes(eventId, event, unknownLinks.concat(unknownPics)) });
    }
    var pending = answers[0].pending + answers[1].pending;
    if (pending) {
      push({ code: 'links-pending', level: 'info', title: 'Still checking ' + plural(pending, 'link or picture', 'links and pictures') + ' on other sites',
        lines: [], hint: 'This list fills in as their sites answer.' });
    }

    /* sections with nothing in them */
    var empty = siteChecks.emptySections(page, kit);
    if (empty.length) {
      push({ code: 'empty-sections', level: 'warn',
        title: empty.length === 1 ? 'A section has nothing in it' : empty.length + ' sections have nothing in them',
        lines: cap(empty.map(function (e) { return quote(e.section, 50) + (e.heading ? ' shows only its heading, ' + quote(e.heading, 50) : ' is empty'); })),
        hint: 'Visitors see a heading with nothing under it. Add what belongs there, or hide the section, in the site editor, then save.',
        fix: sectionFixes(eventId, event, empty) });
    }

    /* dates and the place the page states that are not the event's (Content › Basics) */
    var basics = consoleFix(eventId, 'content/basics', 'Content › Basics');
    var dates = siteChecks.dateFindings(page, kit, event);
    if (dates.length) {
      var when = etNav.shortDate(event.start, event.end);
      push({ code: 'dates', level: 'warn', title: dates.length === 1 ? 'A date on the page is not the event’s' : dates.length + ' dates on the page are not the event’s',
        lines: cap(dates.map(function (d) { return quote(d.text, 50) + ' — ' + d.section; })),
        hint: 'The event is on ' + when + ' (Content › Basics). Correct the page in the site editor, or the date in Basics if that is what is out of date.',
        fix: sectionFixes(eventId, event, dates).slice(0, FIXES_MAX - 1).concat([basics]) });
    }
    var places = siteChecks.venueFindings(page, kit, event);
    if (places.length) {
      push({ code: 'venue', level: 'warn', title: places.length === 1 ? 'A place on the page is not the event’s' : places.length + ' places on the page are not the event’s',
        lines: cap(places.map(function (p) { return quote(p.text, 60) + ' — ' + p.section; })),
        hint: 'The event is at ' + etNav.placeOf(event) + ' (Content › Basics). Correct the page in the site editor, or the venue in Basics if that is what is out of date.',
        fix: sectionFixes(eventId, event, places).slice(0, FIXES_MAX - 1).concat([basics]) });
    }

    /* the event's logo on the banner (owner rule: the hero's logo unit), and the ET logo rule */
    var design = (event.designPlan && event.designPlan.design) || {};
    var ins = ctx.inspect || siteChecks.inspect(text, kit);
    var wantsLogo = !ins.imported && (ins.generated || !!design.logoUnitUrl || !!event.logoUrl);
    var banner = wantsLogo ? siteChecks.bannerLogo(page, kit) : null;
    if (banner && !banner.shown) {
      push({ code: 'logo-unit', level: 'warn', title: 'The banner shows no event logo',
        lines: [], hint: 'The event’s logo belongs on the banner. Put it back in the site editor (select the banner), or upload it in Content › Basics.',
        fix: [editorFix(eventId, event, banner.key || 'hero', 'Banner'), basics] });
    }
    var recoloured = siteChecks.etLogoRecoloured(page, kit);
    if (recoloured.length) {
      push({ code: 'et-logo', level: 'warn', title: 'An ET logo is recoloured',
        lines: cap(recoloured.map(function (r) { return r.section + ': ' + r.how + ' changes its colours'; })),
        hint: 'Only the black or grey lettering of an ET logo may change colour; its red square never does. Use the logo as it is, in the site editor.',
        fix: sectionFixes(eventId, event, recoloured) });
    }

    /* what opens a form that is switched off, or that no longer exists */
    var payload = answers[2];
    if (payload && Array.isArray(payload.forms)) {
      var known = {};
      payload.forms.forEach(function (f) { if (f && f.id) known[f.id] = f; });
      var off = [], seen = {};
      siteChecks.formButtons(page, kit).forEach(function (b) {
        var ids = b.forms.length ? b.forms : [payload.defaultFormId || 'register'];
        var states = ids.map(function (id) { var f = known[id]; return !f ? (payload.forms.length ? 'missing' : 'unknown') : f.open === false ? 'off' : 'on'; });
        /* an award's lifecycle button opens one of its two forms, by the award's dates: only when neither can open */
        if (states.some(function (st) { return st === 'on' || st === 'unknown'; })) return;
        var f = known[ids[0]], what = b.embed ? 'The form shown in the page' : quote(b.label || 'A button', 50);
        var line = what + ' (' + b.section + ') ' + (b.embed ? 'is “' : 'opens “') + (f ? (f.name || f.title || f.id) : ids[0]) + '”, ' +
          (states[0] === 'missing' ? 'a form that no longer exists' : 'which is switched off: visitors read that it is not taking responses');
        if (seen[line]) return;
        seen[line] = 1;
        off.push({ line: line, key: b.key, section: b.section });
      });
      if (off.length) {
        push({ code: 'forms-off', level: 'warn', title: off.length === 1 ? 'A button opens a form that is switched off' : off.length + ' buttons open a form that is switched off',
          lines: cap((payload.open === false ? ['Registration is switched off for the whole event, so every form says it is closed.'] : []).concat(off.map(function (o) { return o.line; }))),
          hint: 'Switch the form on in Settings › Registration forms, or change what the button opens in the site editor.',
          fix: [consoleFix(eventId, 'settings/form', 'Settings › Registration forms')].concat(sectionFixes(eventId, event, off).slice(0, FIXES_MAX - 1)) });
      }
    }
    return { items: items, pending: pending };
  });
}

module.exports = { check: check, editorFix: editorFix, consoleFix: consoleFix, sectionFixes: sectionFixes, ownFileExists: ownFileExists, shortUrl: shortUrl };
