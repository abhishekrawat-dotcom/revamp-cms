/* The top bar of an AI-designed site, built by the server the way ET's own event microsites draw theirs (the
   brandequity.economictimes.indiatimes.com/brand-world-summit-south2025 header, measured in a browser) —
   never written by a model, so every site has the same careful bar.

     build(o)              -> { html, css }
       o: { name, sub: { date, place }, portal (a slug of et-events PORTALS, or ''), mode: 'light'|'dark',
            themeColor, links: [{ id, label }], cta: { label, href, register } | null,
            tabs: [{ label, href, active }] (only when the event really has them) }
     linksOf(sections)     -> [{ id, label }]   sections: [{ id, name, kind }] in page order (nav, hero and
                                                footer are left out)
     portalOf(candidates)  -> 'brandequity' | ''   candidates: portal slugs or ET microsite addresses
     logoOf(portal, mode)  -> { src, onLight, onDark, alt, href, height, width }
     shortDate(start, end) -> '5 Dec 2025' | '5–7 Dec 2026' | ''
     placeOf(event)        -> 'Taj Wellington Mews, Chennai'
     forEvent(event, o)    -> { html, css }  the bar for an event document (name, start, end, dateLabel, venue,
                              city, location, designPlan), o: { sections: [{ id, name, kind }] in page order,
                              portals: [slug | address], cta }

   Two states, as on ET's pages:
     at the top   a full-width bar: menu button, the portal's logo, a divider, the event's name over its date
                  and place, the event's tabs when it has any, the main action at the right; below it a calm
                  row of section links.
     scrolled     (rv-etnav--float on the bar, set by templates/_shared/et-runtime.js) a rounded bar floating at the top
                  centre: the name over "date · place", a divider, the section links that fit, "More" with
                  the rest. The link of the section being read is marked.
   On a phone the top state is the menu button, the logo and the action over the name, and the floating one a
   compact bar across the top; the menu button opens every link in a panel (et-runtime.js).
   In the editor the bar stays in its top state and in the page's flow; every word in it is plain text in the
   section, edited like any other. Every colour and font is one of the page's variables, so themes reach it.
   The portal's logo is the wordmark for the ground it stands on (templates/_shared/img/portals: <slug>.png
   for a light ground, <slug>-light.png for a dark one); the editor and the preview's theme switcher swap it
   with the ground (data-rv-on-light / data-rv-on-dark). An event of no known portal carries The Economic
   Times Business Verticals logo. */

var fs = require('fs');
var path = require('path');
var etEvents = require('./et-events');
var etPrevious = require('./et-previous');
var rvTheme = require('../../templates/_shared/rv-theme.js');

var IMG_DIR = path.join(__dirname, '..', '..', 'templates', '_shared', 'img');
var ET_BV = {
  onLight: { src: '/templates/_shared/img/et-business-verticals-on-light.svg', width: 365, height: 35 },
  onDark: { src: '/templates/_shared/img/et-business-verticals-on-dark.svg', width: 401, height: 39 }
};
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
/* an address the bar may link to: a place on the page or an https page — never javascript:, data: or http: */
function safeHref(h) { h = clean(h); return /^#[A-Za-z][\w-]*$/.test(h) || /^https:\/\/[^\s"'<>]+$/i.test(h) ? h : ''; }

/* ---------- the portal and its logo ---------- */

function portalOf(candidates) {
  var list = Array.isArray(candidates) ? candidates : [candidates];
  for (var i = 0; i < list.length; i++) {
    var c = String(list[i] || '').trim();
    var slug = /^https?:\/\//i.test(c) ? etPrevious.portalOf(c) : c.toLowerCase();
    if (slug && etEvents.isPortal(slug)) return slug;
  }
  return '';
}

/* a PNG's own width and height, from its header (null when the file is not there or is not a PNG) */
var sizeCache = {};
function pngSize(file) {
  if (Object.prototype.hasOwnProperty.call(sizeCache, file)) return sizeCache[file];
  var out = null;
  try {
    var fd = fs.openSync(file, 'r'), b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    fs.closeSync(fd);
    if (b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') out = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch (e) { out = null; }
  sizeCache[file] = out;
  return out;
}

/* The logo is set to a height that makes it about as wide as ET's own (190 px for ET BrandEquity at 20 px):
   a long one-line wordmark stays 20 px tall, a two-line one (ETHRWorld over "From The Economic Times") is
   given up to 32 px so that its lettering can be read. */
function heightFor(w, h) { return Math.max(20, Math.min(32, Math.round(190 / (w / h)))); }

function logoOf(portal, mode) {
  var dark = mode === 'dark';
  var slug = etEvents.isPortal(portal) ? portal : '';
  var onLight = slug && pngSize(path.join(IMG_DIR, 'portals', slug + '.png'));
  if (onLight) {
    var onDark = pngSize(path.join(IMG_DIR, 'portals', slug + '-light.png'));
    var lightSrc = '/templates/_shared/img/portals/' + slug + '.png';
    /* a portal with no light-ink wordmark stands on a dark ground as The Economic Times Business Verticals */
    var darkSrc = onDark ? '/templates/_shared/img/portals/' + slug + '-light.png' : ET_BV.onDark.src;
    var size = dark ? (onDark || ET_BV.onDark) : onLight;
    return {
      src: dark ? darkSrc : lightSrc, onLight: lightSrc, onDark: darkSrc, alt: etEvents.PORTALS[slug],
      href: 'https://' + slug + '.economictimes.indiatimes.com/', width: size.width, height: size.height,
      px: heightFor(onLight.width, onLight.height)
    };
  }
  var bv = dark ? ET_BV.onDark : ET_BV.onLight;
  return {
    src: bv.src, onLight: ET_BV.onLight.src, onDark: ET_BV.onDark.src, alt: 'The Economic Times Business Verticals',
    href: '#hero', width: bv.width, height: bv.height, px: heightFor(ET_BV.onLight.width, ET_BV.onLight.height)
  };
}

/* ---------- the event's facts ---------- */

function partsOf(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function shortDate(start, end) {
  var a = partsOf(start), b = partsOf(end);
  if (!a) return '';
  var one = function (p, year) { return p.d + ' ' + MONTHS[p.m - 1] + (year ? ' ' + p.y : ''); };
  if (!b || (b.y === a.y && b.m === a.m && b.d === a.d) || b.y < a.y || (b.y === a.y && (b.m < a.m || (b.m === a.m && b.d < a.d)))) return one(a, true);
  if (b.y === a.y && b.m === a.m) return a.d + '–' + b.d + ' ' + MONTHS[a.m - 1] + ' ' + a.y;
  if (b.y === a.y) return one(a, false) + ' – ' + one(b, true);
  return one(a, true) + ' – ' + one(b, true);
}
function placeOf(event) {
  event = event || {};
  var venue = clean(event.venue), city = clean(event.city);
  if (venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) !== -1) city = '';
  return [venue, city].filter(Boolean).join(', ') || clean(event.location);
}

/* ---------- the section links ---------- */

/* the words a visitor reads in the bar: the section's own name, shortened where it is long by nature */
function labelOf(s) {
  var name = clean(s.name) || String(s.id || '').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  var m = /^previous edition\s+(.+)$/i.exec(name);
  if (m) name = 'Past ' + m[1];
  return name.slice(0, 40);
}
function linksOf(sections) {
  var seen = {};
  return (sections || []).filter(function (s) {
    var id = String((s && s.id) || '');
    /* an award's moving band of category names is part of its hero, not a place to go to */
    if (!id || /^(nav|hero|footer|award-band)$/.test(id) || seen[id] || !/^[A-Za-z][\w-]*$/.test(id)) return false;
    seen[id] = 1;
    return true;
  }).map(function (s) { return { id: s.id, label: labelOf(s) }; });
}

/* ---------- the bar ---------- */

var BURGER = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 4.5h16M2 10h10M2 15.5h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/* the call to action's ground and words: the page's --rv-theme-fill and --rv-on-theme (set with the theme, rv-theme.js
   derivedVars: words that read at 4.5:1 — white on the brand colour, or on a shade of it a little deeper where white
   nearly reads, dark words on a light brand colour), with this colour's own reading ink as the fallback */
function textOn(hex) { return 'var(--rv-on-theme,' + rvTheme.inkOn(hex) + ')'; }
var CTA_FILL = 'var(--rv-theme-fill,var(--theme-color))';

function build(o) {
  o = o || {};
  var c = 'rv-etnav';
  var logo = logoOf(o.portal, o.mode);
  var name = clean(o.name) || 'Event';
  var sub = o.sub || {};
  var date = clean(sub.date), place = clean(sub.place);
  var links = (o.links || []).filter(function (l) { return l && l.id && clean(l.label); });
  /* a tab may be one of the site's own pages (t.page: its slug — site-pages, data-rv-page-link): its address is
     set where the page is viewed (rv-pages.js); the slug stands until then */
  var tabs = (o.tabs || []).map(function (t) { return t && t.page && /^[a-z0-9-]{1,40}$/.test(t.page) ? Object.assign({}, t, { href: t.href || t.page }) : t; })
    .filter(function (t) { return t && clean(t.label) && (t.page ? /^[a-z0-9-]{1,40}$/.test(t.page) : safeHref(t.href)); });
  var cta = o.cta && clean(o.cta.label) ? o.cta : null;

  var html = '<header class="' + c + '" id="nav" data-rv-etnav>' +
    '<div class="' + c + '-bar">' +
      '<button type="button" class="' + c + '-burger" aria-label="Menu" aria-expanded="false" data-rv-etnav-burger>' + BURGER + '</button>' +
      '<a class="' + c + '-logo" href="' + esc(logo.href) + '"' + (/^https:/.test(logo.href) ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<img data-rv-et-logo data-rv-on-light="' + esc(logo.onLight) + '" data-rv-on-dark="' + esc(logo.onDark) + '" src="' + esc(logo.src) + '" alt="' + esc(logo.alt) + '" width="' + logo.width + '" height="' + logo.height + '" style="--rv-logo-h:' + logo.px + 'px"></a>' +
      '<div class="' + c + '-event">' +
        '<a class="' + c + '-name" href="#hero">' + esc(name) + '</a>' +
        (date || place ? '<p class="' + c + '-sub">' + (date ? '<span class="' + c + '-date">' + esc(date) + '</span>' : '') + (place ? '<span class="' + c + '-place">' + esc(place) + '</span>' : '') + '</p>' : '') +
      '</div>' +
      (tabs.length ? '<ul class="' + c + '-tabs">' + tabs.map(function (t) {
        var href = t.page ? t.page : safeHref(t.href);
        return '<li><a class="' + c + '-tab' + (t.active ? ' is-current' : '') + '"' + (t.page ? ' data-rv-page-link="' + esc(t.page) + '"' : '') + ' href="' + esc(href) + '"' + (t.active ? ' aria-current="page"' : '') + '>' + esc(clean(t.label)) + '</a></li>';
      }).join('') + '</ul>' : '') +
      (links.length ? '<nav class="' + c + '-links" aria-label="Sections"><ul class="' + c + '-list">' + links.map(function (l) {
        return '<li><a href="#' + esc(l.id) + '">' + esc(clean(l.label)) + '</a></li>';
      }).join('') + '</ul></nav>' : '') +
      (cta ? '<a class="' + c + '-cta"' + require('./gen-design').ctaAttrs(cta) + ' href="' + esc(safeHref(cta.href) || '#hero') + '">' + esc(clean(cta.label)) + '</a>' : '') +
    '</div></header>';

  var line = 'color-mix(in srgb,var(--rv-text) 14%,transparent)';
  var soft = 'color-mix(in srgb,var(--rv-text) 72%,transparent)';
  var css = [
    /* the top state: in the page's flow, never over the banner */
    '.' + c + '{position:relative;z-index:60;font-family:var(--body-font-family);color:var(--rv-text);min-height:var(--rv-etnav-h,auto)}',
    '.' + c + '-bar{display:grid;grid-template-columns:auto auto minmax(0,max-content) auto minmax(0,1fr) auto;grid-template-areas:"burger logo event tabs gap cta" "links links links links links links";align-items:center;column-gap:16px;padding:10px 24px 0;background:var(--rv-bg);border-bottom:1px solid ' + line + '}',
    '.' + c + '-burger{grid-area:burger;display:grid;place-items:center;width:36px;height:36px;margin:0 -8px 0 -6px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rv-text);cursor:pointer}',
    '.' + c + '-burger:hover{background:color-mix(in srgb,var(--rv-text) 8%,transparent)}',
    '.' + c + '-logo{grid-area:logo;display:block;line-height:0;text-decoration:none}',
    '.' + c + '-logo img{display:block;height:var(--rv-logo-h,20px);width:auto;max-width:200px;object-fit:contain}',
    '.' + c + '-event{grid-area:event;min-width:0;padding:0 0 0 16px;border-left:1px solid ' + line + '}',
    '.' + c + '-name{display:block;font-size:15px;font-weight:600;line-height:1.3;color:var(--rv-text);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.' + c + '-sub{margin:2px 0 0;font-size:14px;font-weight:500;line-height:1.3;color:var(--rv-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.' + c + '-date + .' + c + '-place::before{content:"\\00B7";margin:0 7px}',
    '.' + c + '-tabs{grid-area:tabs;display:flex;gap:24px;margin:0;padding:0 0 0 16px;list-style:none;border-left:1px solid ' + line + '}',
    '.' + c + '-tab{position:relative;display:block;padding:4px 0 6px;font-size:15px;font-weight:600;line-height:1.2;color:' + soft + ';text-decoration:none;white-space:nowrap}',
    '.' + c + '-tab.is-current{color:var(--rv-text)}',
    '.' + c + '-tab.is-current::after{content:"";position:absolute;left:50%;bottom:0;width:22px;height:2px;margin-left:-11px;border-radius:2px;background:currentColor}',
    '.' + c + '-cta{grid-area:cta;justify-self:end;display:inline-block;padding:9px 20px;border-radius:999px;background:' + CTA_FILL + ';color:' + textOn(o.themeColor) + ';font-size:14px;font-weight:600;line-height:1.2;text-decoration:none;white-space:nowrap;transition:transform .2s ease,box-shadow .2s ease}',
    '.' + c + '-cta:hover{transform:translateY(-1px);box-shadow:0 6px 16px color-mix(in srgb,var(--theme-color) 35%,transparent)}',
    /* the row of section links; on the live page the ones that do not fit go under "More" */
    '.' + c + '-links{grid-area:links;min-width:0;margin:10px -24px 0;padding:6px 12px;border-top:1px solid ' + line + ';display:flex;align-items:center}',
    /* without the page's script (in the editor) every link is on view, to be edited */
    '.' + c + '-list{display:flex;flex-wrap:wrap;min-width:0;margin:0;padding:0;list-style:none}',
    '.' + c + '-bar.rv-etnav--live .' + c + '-list{flex-wrap:nowrap;overflow:hidden}',
    '.' + c + '-list > li{flex:0 0 auto}',
    '.' + c + '-list a,.' + c + '-more-btn{position:relative;display:block;padding:5px 12px;border-radius:6px;font-size:14px;font-weight:500;line-height:1.45;color:' + soft + ';text-decoration:none;white-space:nowrap;transition:color .2s ease,background-color .2s ease}',
    '.' + c + '-list a:hover,.' + c + '-more-btn:hover{color:var(--rv-text);background:color-mix(in srgb,var(--rv-text) 7%,transparent)}',
    '.' + c + '-list a.is-active,.' + c + '-more-list a.is-active,.' + c + '-more-btn.is-active{color:var(--rv-text);font-weight:600}',
    '.' + c + '-list a.is-active::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:2px;border-radius:2px;background:var(--theme-color)}',
    '.' + c + ' .is-over{display:none}',
    /* "More" (made on the live page by et-runtime.js) */
    '.' + c + '-more{position:relative;flex:0 0 auto}',
    '.' + c + '-more-btn{display:flex;align-items:center;gap:6px;border:0;background:transparent;font-family:inherit;cursor:pointer}',
    '.' + c + '-more-btn svg{transition:transform .2s ease}',
    '.' + c + '-more-btn[aria-expanded="true"] svg{transform:rotate(180deg)}',
    '.' + c + '-more-list{position:absolute;top:calc(100% + 8px);right:0;z-index:2;min-width:220px;max-height:min(70vh,420px);overflow:auto;margin:0;padding:8px;list-style:none;background:var(--rv-bg);border:1px solid ' + line + ';border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.16)}',
    '.' + c + '-more-list[hidden]{display:none}',
    '.' + c + '-more-list a{display:block;padding:9px 12px;border-radius:8px;font-size:14px;font-weight:500;line-height:1.35;color:' + soft + ';text-decoration:none;white-space:nowrap}',
    '.' + c + '-more-list a:hover{color:var(--rv-text);background:color-mix(in srgb,var(--rv-text) 7%,transparent)}',
    /* the scrolled state: a rounded bar floating at the top centre */
    '.' + c + '-bar.rv-etnav--float{position:fixed;top:12px;left:0;right:0;width:max-content;max-width:calc(100% - 32px);margin:0 auto;display:flex;align-items:center;padding:6px 8px 6px 24px;border:1px solid ' + line + ';border-radius:999px;background:var(--rv-bg);box-shadow:0 2px 20px rgba(0,0,0,.12);animation:rv-etnav-in .32s cubic-bezier(.2,.7,.2,1)}',
    '.' + c + '-bar.rv-etnav--float .' + c + '-burger,.' + c + '-bar.rv-etnav--float .' + c + '-logo,.' + c + '-bar.rv-etnav--float .' + c + '-tabs,.' + c + '-bar.rv-etnav--float .' + c + '-cta{display:none}',
    '.' + c + '-bar.rv-etnav--float .' + c + '-event{flex:0 0 auto;padding:0 24px 0 0;border-left:0;max-width:340px}',
    '.' + c + '-bar.rv-etnav--float .' + c + '-links{flex:0 1 auto;margin:0;padding:0 0 0 12px;border-top:0;border-left:1px solid ' + line + '}',
    '.' + c + '-bar.rv-etnav--float .' + c + '-list a,.' + c + '-bar.rv-etnav--float .' + c + '-more-btn{font-weight:600;padding:8px 12px}',
    '@keyframes rv-etnav-in{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}',
    /* the menu panel (made on the live page by et-runtime.js) */
    '.' + c + '-scrim{position:fixed;inset:0;z-index:1;background:rgba(0,0,0,.45);animation:rv-etnav-fade .2s ease}',
    '.' + c + '-drawer{position:fixed;top:0;bottom:0;left:0;z-index:2;width:min(360px,88vw);display:flex;flex-direction:column;gap:4px;padding:16px 16px 24px;overflow:auto;background:var(--rv-bg);color:var(--rv-text);box-shadow:0 0 40px rgba(0,0,0,.25);animation:rv-etnav-slide .28s cubic-bezier(.2,.7,.2,1)}',
    '.' + c + '-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px;padding:0 0 12px;border-bottom:1px solid ' + line + '}',
    '.' + c + '-drawer-head img{display:block;height:var(--rv-logo-h,20px);width:auto;max-width:200px}',
    '.' + c + '-close{display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rv-text);font-size:26px;line-height:1;cursor:pointer}',
    '.' + c + '-close:hover{background:color-mix(in srgb,var(--rv-text) 8%,transparent)}',
    '.' + c + '-drawer a.' + c + '-drawer-link{display:block;padding:12px 10px;border-radius:8px;font-size:16px;font-weight:500;line-height:1.35;color:var(--rv-text);text-decoration:none}',
    '.' + c + '-drawer a.' + c + '-drawer-link:hover,.' + c + '-drawer a.' + c + '-drawer-link.is-active{background:color-mix(in srgb,var(--rv-text) 7%,transparent)}',
    '.' + c + '-drawer a.' + c + '-drawer-link.is-active{font-weight:600}',
    '.' + c + '-drawer .' + c + '-cta{display:block;margin:12px 0 0;text-align:center;padding:12px 20px;font-size:15px}',
    '@keyframes rv-etnav-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes rv-etnav-slide{from{transform:translateX(-100%)}to{transform:none}}',
    /* a phone: the menu button, the logo and the action over the name; the links are in the menu */
    '@media (max-width:860px){' +
      '.' + c + '-bar{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"burger logo cta" "event event event";column-gap:12px;padding:8px 16px 0}' +
      '.' + c + '-logo img{height:calc(var(--rv-logo-h,20px) * .85);max-width:min(170px,100%)}' +
      '.' + c + '-event{margin:8px -16px 0;padding:8px 16px 10px;border-left:0;border-top:1px solid ' + line + '}' +
      '.' + c + '-tabs,.' + c + '-links{display:none}' +
      '.' + c + '-cta{padding:8px 14px}' +
      '.' + c + '-bar.rv-etnav--float{top:0;width:auto;max-width:none;padding:8px 8px 8px 16px;border-width:0 0 1px;border-radius:0}' +
      '.' + c + '-bar.rv-etnav--float .' + c + '-burger{display:grid;order:2;flex:0 0 auto;margin:0 0 0 8px}' +
      '.' + c + '-bar.rv-etnav--float .' + c + '-event{flex:1 1 auto;margin:0;padding:0;border-top:0;max-width:none}' +
      '.' + c + '-bar.rv-etnav--float .' + c + '-links{display:none}' +
    '}',
    '@media (prefers-reduced-motion:reduce){.' + c + '-bar.rv-etnav--float,.' + c + '-drawer,.' + c + '-scrim{animation:none}}'
  ].join('\n');
  return { html: html, css: css };
}

/* ---------- the bar for an event ---------- */

function forEvent(event, o) {
  event = event || {};
  o = o || {};
  var design = (event.designPlan && event.designPlan.design) || {};
  var date = shortDate(event.start, event.end) || clean(event.dateLabel || event.date);
  return build({
    name: event.name, sub: { date: date, place: placeOf(event) }, portal: portalOf(o.portals || []),
    mode: design.mode === 'dark' ? 'dark' : 'light', themeColor: design.themeColor,
    links: linksOf(o.sections || []), cta: o.cta || null, tabs: o.tabs || []
  });
}

/* Where an event's portal is read from, best first: ET's own record of its previous edition (et-previous.js
   keeps the portal it was asked with), then the addresses of the pages its site was modelled on.
   sources: the event's sources documents ({ type, url, previous }). */
function portalCandidates(designPlan, sources) {
  designPlan = designPlan || {};
  var own = (sources || []).filter(function (s) { return s && (s.type === 'previousEdition' || s.type === 'currentEdition'); });
  var out = [];
  own.forEach(function (s) { if (s.previous && s.previous.portal) out.push(s.previous.portal); });
  var ref = designPlan.reference;
  if (ref && (ref.type === 'previousEdition' || ref.type === 'currentEdition')) out.push(ref.url);
  if (designPlan.design && designPlan.design.logoUnitFrom) out.push(designPlan.design.logoUnitFrom);
  own.forEach(function (s) { out.push(s.url); });
  return out;
}

/* The main action at the right of the bar: the owner's (owner-brief.js), as the hero's first button has it —
   registration goes to the contact section (or the footer), partnership to the partners section. */
function ctaFor(designPlan, owner) {
  var planned = (designPlan && designPlan.sections) || [];
  function firstOf(kind) { return planned.filter(function (x) { return x.kind === kind; })[0]; }
  var contact = firstOf('contact'), partners = firstOf('partners');
  return require('./owner-brief').buttons(owner || (designPlan && designPlan.owner), { register: contact ? contact.id : 'footer', partner: partners ? partners.id : '' }).primary;
}

/* The nav section as a generated site stores it ({ id: 'nav', kind: 'nav', html, css } in generatedSections),
   its stylesheet confined to the section as every generated section's is.
     event      the event document (name, start, end, dateLabel, venue, city, location, designPlan)
     o.order    the page's section ids in order (nav, hero and footer are skipped)
     o.sources  the event's sources documents     o.owner  the brief's owner points when the plan has none
     o.cta      the main button, when the page sets it     o.tabs  more links, as forEvent takes them */
function sectionFor(event, o) {
  o = o || {};
  var plan = (event && event.designPlan) || {};
  var planned = plan.sections || [];
  var sections = (o.order || planned.map(function (s) { return s.id; })).map(function (id) {
    return planned.filter(function (p) { return p.id === id; })[0] || { id: id };
  });
  /* o.cta: the main button as the page builds it (an award's lifecycle button) — else worked out here */
  var built = forEvent(event, { sections: sections, portals: portalCandidates(plan, o.sources), cta: o.cta || ctaFor(plan, o.owner), tabs: o.tabs });
  var markup = require('./gen-markup');
  var css = require('./gen-design').clampFontSizes(markup.scopeSectionCss(built.css, 'nav', markup.sectionRootInfo(built.html)));
  return { id: 'nav', kind: 'nav', html: built.html, css: css };
}

module.exports = { build, forEvent, sectionFor, portalCandidates, ctaFor, linksOf, portalOf, logoOf, shortDate, placeOf, labelOf };
