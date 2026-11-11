/* A speaker's or a sponsor's page (lib/people.js gives the PERSON; the owner, 11 Nov 2026: "a dedicated page for each
   speakers which will show the journey of that speaker with ET … Same for the sponsor"). One page, in ETB2B's own
   look, whatever event the visitor came from; "Back to <event>" when they came from one.

     render(person, o) -> the whole HTML page. o = { base: 'https://…' (the public address, for the canonical link and
                          the share card), back: { name, href } | null, today: 'YYYY-MM-DD' }

   What it shows, top to bottom: the ETB2B mark (and the way back); the person — photo, name, designation and company
   (the company's logo beside it), LinkedIn / X; how much they have done with ET (events, sessions, since when, on
   which portals); About (the team's text, else ET's); the team's own sections; the journey — what is coming first,
   then each year, newest first: the event (a link to its page), when and on which portal, the company they came
   from when it is not today's, and the sessions they spoke in; the team's links. A sponsor's page has the logo, the
   website, and the tier at each event instead of sessions.

   Everything is set as text (escaped), a link is kept only on http(s), a picture only on https or an uploaded file
   (data:image). No script: the page works, and is read by search engines, as it is sent. Light only, so the ETB2B
   mark (black lettering, the red ET square) is shown as it is drawn. */
'use strict';

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function link(u) { u = str(u).trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) ? u : ''; }
function picture(u) { u = str(u).trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) || /^data:image\/(?:jpeg|png|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : ''; }
function paras(text) {
  return str(text).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
    .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
}
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* '2025-11-20' -> '20 Nov 2025'; '2025' -> '2025' */
function dayLabel(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d));
  if (!m) return /^\d{4}$/.test(str(d)) ? str(d) : '';
  return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
}
/* a session's time: '2025-11-20T10:30:00' or '2025-11-20 10:30' -> '10:30 am'; '14:00' -> '2:00 pm' */
function timeLabel(t) {
  var m = /(?:^|[T\s])(\d{1,2}):(\d{2})/.exec(str(t));
  if (!m) return '';
  var h = +m[1], mm = m[2];
  if (h > 23) return '';
  if (h === 0 && mm === '00' && /^\d{4}-\d{2}-\d{2}[T\s]00:00/.test(str(t))) return '';
  return ((h % 12) || 12) + ':' + mm + (h < 12 ? ' am' : ' pm');
}
function initials(name) { return str(name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
function cut(text, max) {
  text = str(text).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  var at = text.lastIndexOf(' ', max - 1);
  return text.slice(0, at > max * 0.6 ? at : max - 1).replace(/[\s,;:.-]+$/, '') + '…';
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function jsonLd(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }

var ICON = {
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  out: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
  mic: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>'
};

var CSS = [
  ':root{--red:#c8161d;--red-dark:#a81219;--ink:#16181d;--muted:#5b616b;--line:#e4e6ea;--bg:#f6f7f9;--card:#ffffff;--soft:#fdf1f1}',
  '*{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
  'a{color:var(--red)}a:hover{color:var(--red-dark)}',
  'a:focus-visible{outline:3px solid var(--ink);outline-offset:2px;border-radius:4px}',
  '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.top{background:#fff;border-bottom:1px solid var(--line)}',
  '.top-in{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px}',
  '.mark{flex:0 0 auto}.mark img{display:block;height:30px;width:auto}',
  '.back{display:inline-flex;align-items:center;gap:6px;min-height:44px;min-width:0;flex:0 1 auto;padding:0 14px;border-radius:999px;border:1px solid var(--line);color:var(--ink);font-size:14px;font-weight:600;text-decoration:none;max-width:60vw}',
  '.back svg{flex:0 0 auto}',
  '.back span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.back:hover{border-color:var(--ink);color:var(--ink)}',
  'main{max-width:1040px;margin:0 auto;padding:32px 16px 56px}',
  '.hero{display:grid;grid-template-columns:200px minmax(0,1fr);gap:32px;align-items:start;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px}',
  '.ph{margin:0;width:200px;aspect-ratio:1/1;border-radius:16px;overflow:hidden;background:var(--soft);display:grid;place-items:center}',
  '.ph img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}',
  '.ph span{font-size:56px;font-weight:800;color:var(--red)}',
  '.ph.logo{background:#fff;border:1px solid var(--line);padding:20px}',
  '.ph.logo img{object-fit:contain;object-position:center}',
  '.eyebrow{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--red)}',
  'h1{margin:0;font-size:clamp(28px,4vw,40px);line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere}',
  '.role{margin:10px 0 0;font-size:18px;color:var(--muted)}',
  '.co{display:flex;align-items:center;gap:10px;margin:6px 0 0;font-size:18px;font-weight:700}',
  '.co img{height:34px;max-width:110px;object-fit:contain;background:#fff;border-radius:6px;padding:4px 6px;box-shadow:0 0 0 1px var(--line)}',
  '.acts{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0}',
  '.btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;border:1.5px solid var(--red);color:var(--red);font-weight:700;font-size:15px;text-decoration:none}',
  '.btn:hover{background:var(--red);color:#fff}',
  '.stats{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 0;padding:0;list-style:none}',
  '.stats li{background:var(--soft);border-radius:12px;padding:10px 14px;font-size:14px;color:var(--muted)}',
  '.stats b{display:block;font-size:20px;line-height:1.2;color:var(--ink)}',
  '.grid{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;margin-top:24px}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px 28px}',
  'h2{margin:0 0 14px;font-size:20px;line-height:1.3}',
  '.card p{margin:0 0 12px}.card p:last-child{margin-bottom:0}',
  '.yr{margin:22px 0 10px;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
  '.yr:first-of-type{margin-top:4px}',
  '.ev{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}',
  '.ev>li{position:relative;padding:0 0 18px 22px}',
  '.ev>li:last-child{padding-bottom:4px}',
  '.ev>li:before{content:"";position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid var(--red)}',
  '.ev h3{margin:0;font-size:17px;line-height:1.4;overflow-wrap:anywhere}',
  '.ev h3 a{color:var(--ink);text-decoration:none}',
  '.ev h3 a:hover{color:var(--red);text-decoration:underline;text-underline-offset:3px}',
  '.ev h3 svg{vertical-align:-1px;margin-left:4px;color:var(--muted)}',
  '.meta{margin:2px 0 0;font-size:14px;color:var(--muted)}',
  '.tier{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;background:var(--soft);color:var(--red-dark);font-size:13px;font-weight:700}',
  '.ss{list-style:none;margin:8px 0 0;padding:0}',
  '.ss li{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid var(--line);font-size:15px}',
  '.ss li svg{flex:0 0 auto;color:var(--red);position:relative;top:2px}',
  '.ss time{flex:0 0 auto;font-size:13px;font-weight:700;color:var(--muted);min-width:64px}',
  '.soon{background:var(--soft);border-color:#f3cfd1}',
  '.links{list-style:none;margin:0;padding:0}',
  '.links li{padding:8px 0;border-top:1px solid var(--line)}.links li:first-child{border-top:0}',
  '.links a{font-weight:600;overflow-wrap:anywhere}',
  'footer{max-width:1040px;margin:0 auto;padding:0 16px 40px;font-size:13px;color:var(--muted)}',
  '@media (max-width:720px){',
  '.mark img{height:24px}',
  '.back{max-width:none;padding:0 12px;font-size:13px}',
  '.hero{grid-template-columns:1fr;gap:20px;padding:20px}',
  '.ph{width:160px}',
  '.card{padding:20px}',
  'main{padding-top:20px}',
  '}'
].join('\n');

function head(o) {
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(o.title) + '</title><meta name="description" content="' + esc(o.description) + '">' +
    '<meta name="robots" content="index, follow, max-image-preview:large">' +
    (o.canonical ? '<link rel="canonical" href="' + esc(o.canonical) + '">' : '') +
    '<meta property="og:type" content="' + esc(o.ogType) + '"><meta property="og:title" content="' + esc(o.title) + '"><meta property="og:description" content="' + esc(o.description) + '">' +
    (o.canonical ? '<meta property="og:url" content="' + esc(o.canonical) + '">' : '') +
    (o.image ? '<meta property="og:image" content="' + esc(o.image) + '"><meta name="twitter:image" content="' + esc(o.image) + '">' : '') +
    '<meta property="og:site_name" content="ETB2B Events"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="' + esc(o.title) + '"><meta name="twitter:description" content="' + esc(o.description) + '">' +
    '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&amp;display=swap">' +
    '<style>' + CSS + '</style>' +
    '<script type="application/ld+json">' + jsonLd(o.ld) + '</script></head>';
}
function topBar(back) {
  var b = back && link(back.href) ? '<a class="back" href="' + esc(back.href) + '">' + ICON.back + '<span>Back to ' + esc(back.name) + '</span></a>' : '';
  return '<header class="top"><div class="top-in"><span class="mark"><img src="/assets/et-b2b-logo.svg" width="183" height="30" alt="ETB2B"></span>' + b + '</div></header>';
}
function journeyHtml(person, o) {
  var today = str(o.today);
  var shown = (person.journey || []).filter(function (j) { return !j.hidden && !j.why; });
  if (!shown.length) return '';
  var sponsor = person.kind === 'sponsors';
  function item(j) {
    var href = link(j.link), external = /^https?:/i.test(href);
    var title = href ? '<a href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(j.title) +
      (external ? ICON.out + '<span class="sr"> (opens in a new tab)</span>' : '') + '</a>' : esc(j.title);
    var when = dayLabel(j.date) || '';
    var meta = [when, j.portalName].filter(Boolean).join(' · ');
    if (!sponsor && j.company && person.company && j.company.toLowerCase() !== person.company.toLowerCase()) meta += (meta ? ' · ' : '') + 'as ' + j.company;
    var out = '<li><h3>' + title + '</h3>' + (meta ? '<p class="meta">' + esc(meta) + '</p>' : '');
    if (sponsor && j.tier) out += '<span class="tier">' + esc(j.tier) + '</span>';
    if (!sponsor && j.sessions && j.sessions.length) {
      out += '<ul class="ss" aria-label="Sessions">' + j.sessions.map(function (s) {
        var t = timeLabel(s.start);
        return '<li>' + ICON.mic + (t ? '<time>' + esc(t) + '</time>' : '') + '<span>' + esc(s.title) + '</span></li>';
      }).join('') + '</ul>';
    }
    return out + '</li>';
  }
  var coming = shown.filter(function (j) { return j.upcoming || (j.date && today && j.date > today); });
  var past = shown.filter(function (j) { return coming.indexOf(j) === -1; });
  var html = '';
  if (coming.length) {
    html += '<section class="card soon" aria-labelledby="h-soon"><h2 id="h-soon">' + (sponsor ? 'Partnering next' : 'Speaking next') + '</h2><ul class="ev">' +
      coming.slice().reverse().map(item).join('') + '</ul></section>';
  }
  if (past.length) {
    var years = [], byYear = {};
    past.forEach(function (j) { var y = str(j.year) || 'Earlier'; if (!byYear[y]) { byYear[y] = []; years.push(y); } byYear[y].push(j); });
    html += '<section class="card" aria-labelledby="h-journey"><h2 id="h-journey">' + (sponsor ? 'Partnerships with ET' : 'Journey with ET') + '</h2>' +
      years.map(function (y) { return '<h3 class="yr">' + esc(y) + '</h3><ul class="ev">' + byYear[y].map(item).join('') + '</ul>'; }).join('') + '</section>';
  }
  return html;
}
function extrasHtml(person) {
  var html = '';
  (person.sections || []).forEach(function (s, i) {
    if (!s || !(s.heading || s.text)) return;
    html += '<section class="card"' + (s.heading ? ' aria-labelledby="h-x' + i + '"' : '') + '>' + (s.heading ? '<h2 id="h-x' + i + '">' + esc(s.heading) + '</h2>' : '') + paras(s.text) + '</section>';
  });
  return html;
}
function linksHtml(person) {
  var list = (person.links || []).filter(function (l) { return l && link(l.url) && /^https?:/i.test(l.url); });
  if (!list.length) return '';
  return '<section class="card" aria-labelledby="h-links"><h2 id="h-links">Read and watch</h2><ul class="links">' + list.map(function (l) {
    return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + '</a></li>';
  }).join('') + '</ul></section>';
}

function renderSpeaker(p, o) {
  var base = str(o.base).replace(/\/+$/, ''), canonical = base ? base + '/speakers/' + p.slug : '';
  var role = [p.designation, p.company].filter(Boolean).join(', ');
  var st = p.stats || {};
  var firstEvent = ((p.journey || []).filter(function (j) { return !j.hidden && !j.why; })[0] || {}).title || '';
  var title = p.name + (role ? ', ' + role : '') + ' | ETB2B Events';
  var description = cut(p.about || p.bio || (p.name + (role ? ' (' + role + ')' : '') + (st.events ? ' has spoken at ' + plural(st.events, 'ET event', 'ET events') + (st.since ? ' since ' + st.since : '') + (firstEvent ? ', most recently ' + firstEvent : '') : '') + '.'), 160);
  var photo = picture(p.photo), share = /^https:/.test(photo) ? photo : '';
  var sameAs = [p.linkedin, p.x].filter(function (u) { return /^https:\/\//.test(str(u)); });
  var person = { '@type': 'Person', name: p.name };
  if (p.designation) person.jobTitle = p.designation;
  if (p.company) person.worksFor = { '@type': 'Organization', name: p.company };
  if (share) person.image = share;
  if (sameAs.length) person.sameAs = sameAs;
  if (p.about || p.bio) person.description = cut(p.about || p.bio, 300);
  var ld = { '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: person };
  if (canonical) ld.url = canonical;
  var acts = [];
  if (/^https:\/\//.test(str(p.linkedin))) acts.push('<a class="btn" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + ' on LinkedIn (opens in a new tab)">LinkedIn ' + ICON.out + '</a>');
  if (/^https:\/\//.test(str(p.x))) acts.push('<a class="btn" href="' + esc(p.x) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + ' on X (opens in a new tab)">X ' + ICON.out + '</a>');
  var stats = [];
  if (st.events) stats.push('<li><b>' + st.events + '</b>' + (st.events === 1 ? 'ET event' : 'ET events') + '</li>');
  if (st.sessions) stats.push('<li><b>' + st.sessions + '</b>' + (st.sessions === 1 ? 'session' : 'sessions') + '</li>');
  if (st.since) stats.push('<li><b>' + esc(st.since) + '</b>first with ET</li>');
  if (st.portals && st.portals.length) stats.push('<li><b>' + st.portals.length + '</b>' + esc(st.portals.slice(0, 4).join(' · ') + (st.portals.length > 4 ? ' …' : '')) + '</li>');
  var logo = picture(p.logo);
  var hero = '<section class="hero" aria-labelledby="h-name">' +
    '<figure class="ph">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(p.name) + '" width="200" height="200">' : '<span aria-hidden="true">' + esc(initials(p.name)) + '</span>') + '</figure>' +
    '<div><p class="eyebrow">Speaker</p><h1 id="h-name">' + esc(p.name) + '</h1>' +
    (p.designation ? '<p class="role">' + esc(p.designation) + '</p>' : '') +
    (p.company ? '<p class="co">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') + '<span>' + esc(p.company) + '</span></p>' : '') +
    (acts.length ? '<div class="acts">' + acts.join('') + '</div>' : '') +
    (stats.length ? '<ul class="stats" aria-label="With ET">' + stats.join('') + '</ul>' : '') + '</div></section>';
  var about = p.about || p.bio;
  var body = '<div class="grid">' + (about ? '<section class="card" aria-labelledby="h-about"><h2 id="h-about">About</h2>' + paras(about) + '</section>' : '') +
    extrasHtml(p) + journeyHtml(p, o) + linksHtml(p) + '</div>';
  return head({ title: title, description: description, canonical: canonical, image: share, ogType: 'profile', ld: ld }) +
    '<body>' + topBar(o.back) + '<main>' + hero + body + '</main>' +
    '<footer>ETB2B Events \u00b7 The Economic Times</footer></body></html>\n';
}

function renderSponsor(p, o) {
  var base = str(o.base).replace(/\/+$/, ''), canonical = base ? base + '/sponsors/' + p.slug : '';
  var st = p.stats || {};
  var title = p.name + ' | ETB2B Events partner';
  var description = cut(p.about || (p.name + (st.events ? ' has partnered ' + plural(st.events, 'ET event', 'ET events') + (st.since ? ' since ' + st.since : '') : ' partners ET events') + '.'), 160);
  var logo = picture(p.logo), share = /^https:/.test(logo) ? logo : '';
  var org = { '@type': 'Organization', name: p.name };
  if (/^https?:\/\//.test(str(p.website))) org.url = p.website;
  if (share) org.logo = share;
  if (p.about) org.description = cut(p.about, 300);
  var ld = { '@context': 'https://schema.org', '@type': 'AboutPage', mainEntity: org };
  if (canonical) ld.url = canonical;
  var stats = [];
  if (st.events) stats.push('<li><b>' + st.events + '</b>' + (st.events === 1 ? 'ET event' : 'ET events') + '</li>');
  if (st.since) stats.push('<li><b>' + esc(st.since) + '</b>first with ET</li>');
  if (st.portals && st.portals.length) stats.push('<li><b>' + st.portals.length + '</b>' + esc(st.portals.slice(0, 4).join(' · ') + (st.portals.length > 4 ? ' …' : '')) + '</li>');
  var site = /^https?:\/\//.test(str(p.website)) ? '<div class="acts"><a class="btn" href="' + esc(p.website) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + '\u2019s website (opens in a new tab)">Website ' + ICON.out + '</a></div>' : '';
  var hero = '<section class="hero" aria-labelledby="h-name">' +
    '<figure class="ph logo">' + (logo ? '<img src="' + esc(logo) + '" alt="' + esc(p.name) + ' logo" width="160" height="160">' : '<span aria-hidden="true">' + esc(initials(p.name)) + '</span>') + '</figure>' +
    '<div><p class="eyebrow">Partner</p><h1 id="h-name">' + esc(p.name) + '</h1>' + site +
    (stats.length ? '<ul class="stats" aria-label="With ET">' + stats.join('') + '</ul>' : '') + '</div></section>';
  var body = '<div class="grid">' + (p.about ? '<section class="card" aria-labelledby="h-about"><h2 id="h-about">About</h2>' + paras(p.about) + '</section>' : '') +
    extrasHtml(p) + journeyHtml(p, o) + linksHtml(p) + '</div>';
  return head({ title: title, description: description, canonical: canonical, image: share, ogType: 'website', ld: ld }) +
    '<body>' + topBar(o.back) + '<main>' + hero + body + '</main>' +
    '<footer>ETB2B Events \u00b7 The Economic Times</footer></body></html>\n';
}

function render(person, o) { return person.kind === 'sponsors' ? renderSponsor(person, o || {}) : renderSpeaker(person, o || {}); }

module.exports = { render: render, _test: { dayLabel: dayLabel, timeLabel: timeLabel, cut: cut, paras: paras, picture: picture, link: link } };
