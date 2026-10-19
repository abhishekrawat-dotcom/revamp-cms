/* The "Previous Edition …" sections of a generated site, built by the server from a previous edition's real
   records (et-previous.js) — never written by a model, so no name, photo or logo is ever made up.

     plan(previous)            -> [{ id, name, kind: 'custom', prebuilt: 'speakers'|'sponsors'|'agenda'|'glimpses', purpose, layout, image: '' }]
                                  one per list the edition has
     build(kind, previous, o)  -> { html, css }   o: { edition: 'Agentic AI Summit 2026' }

   Every colour and font is one of the page's variables (--rv-bg, --rv-surface, --rv-text, --rv-muted,
   --theme-color, --heading-font-family, --body-font-family, --rv-radius), so the sections take the site's
   theme and follow it when the theme changes. Motion uses the page runtime (templates/_shared/et-runtime.js):
   data-rv-carousel="auto" rows that step by themselves and pause when pointed at, and data-rv-reveal blocks
   that ease in on scroll; neither moves for visitors who asked for no motion, nor while editing.
   On a phone (640px and under) the rows' card and photo widths are set by templates/_shared/gen-base.css (its
   "Phones" rules name the pe-… classes), so that sections already saved follow them too; the carousel's buttons
   go under the row there (et-runtime.js). */

/* the section heading's size: the generated site's own type scale (templates/_shared/rv-type.js) */
var SECTION_HEADING = require('../../templates/_shared/rv-type.js').SECTION_HEADING.replace(/,\s+/g, ',');

var LABELS = { speakers: 'Previous Edition Speakers', sponsors: 'Previous Edition Sponsors', agenda: 'Previous Edition Agenda', glimpses: 'Previous Edition Glimpses' };
var IDS = { speakers: 'previous-speakers', sponsors: 'previous-sponsors', agenda: 'previous-agenda', glimpses: 'previous-glimpses' };
var ORDER = ['speakers', 'agenda', 'sponsors', 'glimpses'];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function httpsUrl(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function has(previous, kind) { return !!(previous && Array.isArray(previous[kind]) && previous[kind].length); }

function plan(previous) {
  return ORDER.filter(function (k) { return has(previous, k); }).map(function (k) {
    return {
      id: IDS[k], name: LABELS[k], kind: 'custom', prebuilt: k, image: '',
      purpose: LABELS[k] + ' — the real ' + (k === 'glimpses' ? 'photos' : k) + ' of the previous edition' + (previous.name ? ', ' + previous.name : '') + ', from ET’s own records. Built by the server.',
      layout: k === 'agenda' ? 'the sessions by day, time beside title' : 'an auto-advancing carousel'
    };
  });
}

/* the shared head of every such section: an eyebrow with the edition, the heading, a rule */
function head(cls, kind, edition) {
  return '<div class="' + cls + '-head" data-rv-reveal>' +
    (edition ? '<p class="' + cls + '-eyebrow">' + esc(edition) + '</p>' : '') +
    '<h2 class="' + cls + '-title">' + esc(LABELS[kind]) + '</h2></div>';
}
var BASE_CSS = function (c) {
  return '.' + c + '{background:var(--rv-bg);color:var(--rv-text);padding:clamp(64px,8vw,112px) 0;font-family:var(--body-font-family)}' +
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding:0 24px}' +
    '.' + c + '-head{text-align:center;margin:0 0 40px}' +
    '.' + c + '-eyebrow{margin:0 0 10px;font-size:0.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--theme-color)}' +
    '.' + c + '-title{margin:0;font-family:var(--heading-font-family);font-size:' + SECTION_HEADING + ';line-height:1.15;color:var(--rv-text)}';
};

function speakers(p, edition) {
  var c = 'pe-spk';
  var cards = p.speakers.map(function (s) {
    var photo = httpsUrl(s.photo);
    var initials = s.name.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
    return '<article class="' + c + '-card">' +
      '<div class="' + c + '-ph">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(s.name) + '" loading="lazy">' : '<span>' + esc(initials) + '</span>') + '</div>' +
      (s.group ? '<p class="' + c + '-group">' + esc(s.group) + '</p>' : '') +
      '<h3 class="' + c + '-name">' + esc(s.name) + '</h3>' +
      (s.designation ? '<p class="' + c + '-role">' + esc(s.designation) + '</p>' : '') +
      (s.company ? '<p class="' + c + '-co">' + esc(s.company) + '</p>' : '') + '</article>';
  }).join('');
  var html = '<section class="' + c + '"><div class="' + c + '-in">' + head(c, 'speakers', edition) +
    '<div class="' + c + '-row" data-rv-carousel="auto"><div class="' + c + '-track" data-rv-carousel-track>' + cards + '</div></div></div></section>';
  var css = BASE_CSS(c) +
    '.' + c + '-row{position:relative}.' + c + '-track{gap:24px;padding:4px 2px 12px}' +
    '.' + c + '-card{width:236px;background:var(--rv-surface);border-radius:var(--rv-radius,12px);padding:16px 16px 20px;transition:transform .3s ease,box-shadow .3s ease}' +
    '.' + c + '-card:hover{transform:translateY(-4px);box-shadow:0 14px 30px rgba(0,0,0,.18)}' +
    '.' + c + '-ph{aspect-ratio:1/1;border-radius:calc(var(--rv-radius,12px) * .8);overflow:hidden;background:var(--rv-bg);display:grid;place-items:center;margin:0 0 14px}' +
    '.' + c + '-ph img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}' +
    '.' + c + '-ph span{font-family:var(--heading-font-family);font-size:2.4rem;font-weight:700;color:var(--theme-color)}' +
    '.' + c + '-group{margin:0 0 6px;font-size:0.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--theme-color)}' +
    '.' + c + '-name{margin:0;font-family:var(--heading-font-family);font-size:1.15rem;line-height:1.3;color:var(--rv-text)}' +
    '.' + c + '-role{margin:6px 0 0;font-size:0.9rem;line-height:1.45;color:var(--rv-muted)}' +
    '.' + c + '-co{margin:4px 0 0;font-size:0.9rem;line-height:1.45;font-weight:600;color:var(--rv-text)}' +
    '@media (max-width:820px){.' + c + '-card{width:200px}}';
  return { html: html, css: css };
}

function sponsors(p, edition) {
  var c = 'pe-spn';
  var tiles = p.sponsors.map(function (s) {
    var logo = httpsUrl(s.logo), href = httpsUrl(s.url);
    var img = logo ? '<img src="' + esc(logo) + '" alt="' + esc(s.name || s.tier) + '" loading="lazy">' : '<span>' + esc(s.name) + '</span>';
    return '<div class="' + c + '-tile">' + (s.tier ? '<p class="' + c + '-tier">' + esc(s.tier) + '</p>' : '') +
      '<div class="' + c + '-logo">' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + img + '</a>' : img) + '</div></div>';
  }).join('');
  var html = '<section class="' + c + '"><div class="' + c + '-in">' + head(c, 'sponsors', edition) +
    '<div class="' + c + '-row" data-rv-carousel="auto"><div class="' + c + '-track" data-rv-carousel-track>' + tiles + '</div></div></div></section>';
  var css = BASE_CSS(c) +
    '.' + c + '{background:var(--rv-surface)}.' + c + '-row{position:relative}.' + c + '-track{gap:20px;padding:4px 2px 12px}' +
    '.' + c + '-tile{width:220px;display:flex;flex-direction:column;gap:10px}' +
    '.' + c + '-tier{margin:0;height:2.9em;line-height:1.45;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;text-align:center;font-size:0.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--rv-muted)}' +
    /* logos are drawn for white: they sit on white tiles whatever the theme */
    '.' + c + '-logo{--rv-keep:1;height:120px;background:#ffffff;border-radius:var(--rv-radius,12px);display:grid;place-items:center;padding:18px 22px;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:transform .3s ease}' +
    '.' + c + '-logo:hover{transform:translateY(-3px)}' +
    '.' + c + '-logo a{display:grid;place-items:center;width:100%;height:100%}' +
    '.' + c + '-logo img{max-width:100%;max-height:72px;width:auto;height:auto;object-fit:contain;display:block}' +
    '.' + c + '-logo span{font-weight:700;color:#1b1d22;text-align:center}' +
    '@media (max-width:820px){.' + c + '-tile{width:180px}.' + c + '-logo{height:100px}}';
  return { html: html, css: css };
}

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dayOf(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }
function timeOf(v) {
  var m = /[ T](\d{2}):(\d{2})/.exec(String(v || ''));
  if (!m) return '';
  var h = +m[1];
  return ((h % 12) || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function agenda(p, edition) {
  var c = 'pe-agd', days = [], by = {};
  p.agenda.forEach(function (a) {
    var d = dayOf(a.start) || 'Sessions';
    if (!by[d]) { by[d] = []; days.push(d); }
    by[d].push(a);
  });
  var body = days.map(function (d) {
    return '<div class="' + c + '-day" data-rv-reveal>' + (days.length > 1 || d !== 'Sessions' ? '<h3 class="' + c + '-date">' + esc(d) + '</h3>' : '') +
      by[d].map(function (a) {
        var t = [timeOf(a.start), timeOf(a.end)].filter(Boolean).join(' – ');
        return '<div class="' + c + '-row">' + '<p class="' + c + '-time">' + esc(t) + '</p><div class="' + c + '-what"><h4 class="' + c + '-name">' + esc(a.title) + '</h4>' +
          (a.speakers && a.speakers.length ? '<p class="' + c + '-who">' + esc(a.speakers.join(', ')) + '</p>' : '') + '</div></div>';
      }).join('') + '</div>';
  }).join('');
  var html = '<section class="' + c + '"><div class="' + c + '-in">' + head(c, 'agenda', edition) + '<div class="' + c + '-list">' + body + '</div></div></section>';
  var css = BASE_CSS(c) +
    '.' + c + '-list{max-width:920px;margin:0 auto}.' + c + '-day{margin:0 0 32px}' +
    '.' + c + '-date{margin:0 0 6px;padding:0 0 10px;border-bottom:2px solid var(--theme-color);font-family:var(--heading-font-family);font-size:1.1rem;letter-spacing:.06em;text-transform:uppercase;color:var(--rv-text)}' +
    '.' + c + '-row{display:grid;grid-template-columns:170px 1fr;gap:20px;padding:16px 0;border-bottom:1px solid color-mix(in srgb,var(--rv-text) 14%,transparent)}' +
    '.' + c + '-time{margin:0;font-size:0.95rem;font-weight:700;color:var(--theme-color);white-space:nowrap}' +
    '.' + c + '-name{margin:0;font-family:var(--heading-font-family);font-size:1.125rem;line-height:1.4;color:var(--rv-text)}' +
    '.' + c + '-who{margin:4px 0 0;font-size:0.95rem;line-height:1.5;color:var(--rv-muted)}' +
    '@media (max-width:820px){.' + c + '-row{grid-template-columns:1fr;gap:4px}}';
  return { html: html, css: css };
}

function glimpses(p, edition) {
  var c = 'pe-glm';
  var photos = p.glimpses.map(function (u, i) {
    var src = httpsUrl(u);
    return src ? '<figure class="' + c + '-ph"><img src="' + esc(src) + '" alt="' + esc((edition || 'Previous edition') + ' — photo ' + (i + 1)) + '" loading="lazy"></figure>' : '';
  }).join('');
  var html = '<section class="' + c + '"><div class="' + c + '-in">' + head(c, 'glimpses', edition) +
    '<div class="' + c + '-row" data-rv-carousel="auto"><div class="' + c + '-track" data-rv-carousel-track>' + photos + '</div></div></div></section>';
  var css = BASE_CSS(c) +
    '.' + c + '-row{position:relative}.' + c + '-track{gap:18px;padding:4px 2px 12px}' +
    '.' + c + '-ph{margin:0;width:420px;aspect-ratio:3/2;border-radius:var(--rv-radius,12px);overflow:hidden;background:var(--rv-surface)}' +
    '.' + c + '-ph img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s ease}' +
    '.' + c + '-ph:hover img{transform:scale(1.04)}' +
    '@media (max-width:820px){.' + c + '-ph{width:300px}}';
  return { html: html, css: css };
}

var BUILD = { speakers: speakers, sponsors: sponsors, agenda: agenda, glimpses: glimpses };
function build(kind, previous, o) {
  o = o || {};
  if (!BUILD[kind] || !has(previous, kind)) return null;
  return BUILD[kind](previous, o.edition || previous.name || '');
}

module.exports = { plan, build, LABELS, IDS };
