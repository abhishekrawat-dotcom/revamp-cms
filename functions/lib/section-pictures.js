/* What KIND of picture a previous edition's page puts in each of its content sections — read once when the
   page is read (ingest-source), so that a new edition's pictures follow its choices section by section
   instead of every section getting a photograph of people (the owner, 22 Oct 2026: "almost all images have
   human faces only… why are you not referring to the previous edition to check what type of images are placed
   in sections").

     picturesIn(html, pageUrl, o)  -> [{ heading, url, alt }]  the content pictures, each under the section
                                     heading it sits below; at most MAX, at most two a section. Left out: the
                                     page's chrome (header, nav, footer), logos, icons and badges, share
                                     buttons, lazy-load placeholders, and the sections a new site fills from
                                     records instead (speakers, sponsors and partners, agenda, glimpses and
                                     galleries, videos, jury, FAQ, contact). o.skip: addresses to leave out
                                     (the banner, already read as the key visual).
     classify(found, read)         -> Promise<[{ heading, kind, about }]>   one reading of all the pictures
                                     together; read(prompt, schema, images) -> Promise<{ parsed } | { error }>.
                                     kind: 'people' | 'place' | 'subject' | 'graphic' (gen-design IMAGE_KINDS);
                                     a picture that is none of those (a logo, a poster of text) is dropped.
                                     Never rejects: what cannot be read is simply not known.
     KINDS, MAX */
'use strict';

var KINDS = ['people', 'place', 'subject', 'graphic'];
var MAX = 6; // a reading takes at most six pictures (gemini.js MAX_IMAGES)

/* sections a new site builds from real records, or that are the platform's own */
var SKIP_SECTION = /speaker|sponsor|partner|agenda|programme|program\b|schedule|glimps|gallery|photos|video|jury|faq|frequently|contact|testimonial|about et|what'?s happening|trending|latest|related|newsletter|subscribe|follow us/i;
/* not a content picture */
var SKIP_PICTURE = /logo|icon|ico\b|-ico|sprite|avatar|badge|flag|share|social|twitter|whatsapp|linkedin|facebook|telegram|instagram|youtube|placeholder|blank|spacer|pixel|loader|edition-img|qr|arrow|bullet|cal\.svg|404/i;

function text(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '\'').replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[1] != null ? m[1] : m[2]) : '';
}
function absolute(src, pageUrl) {
  var s = String(src || '').trim().replace(/&amp;/g, '&');
  if (!s || /^data:/i.test(s)) return '';
  try { s = new URL(s, pageUrl).href; } catch (e) { return ''; }
  return /^https:\/\//i.test(s) ? s : /^http:\/\//i.test(s) ? 'https://' + s.slice(7) : '';
}

/* a picture set just BEFORE its heading, in the same card ("picture left, text right"), is that heading's */
var CARD_SPAN = 1500;
/* a picture inside a link that plays a video is a video's thumbnail */
/* a picture in a sponsors', partners', speakers' or jury's block, whatever its section is headed */
var RECORD_BLOCK = /\s(?:class|id)\s*=\s*["'][^"']*(?:sponsor|partner|logo|client|speaker|jury|winner)[^"']*["'][^<]*>\s*(?:<[^>]*>\s*){0,4}$/i;
var VIDEO_LINK = /<a\b[^>]*(?:video|slikeplayer|youtube|youtu\.be|vimeo|play)[^>]*>(?![\s\S]*<\/a>)[\s\S]*$/i;

function picturesIn(html, pageUrl, o) {
  o = o || {};
  var skip = {};
  (o.skip || []).forEach(function (u) { if (u) skip[String(u).split(/[?#]/)[0]] = 1; });
  var page = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<(header|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, '');
  /* the page's section headings: its h2s, or its h3s on a page that has hardly any h2 */
  var level = (page.match(/<h2\b/gi) || []).length >= 3 ? 'h2' : 'h3';
  /* a smaller heading under it ("Supporting Partners" under "Overview") still marks what follows as skipped */
  var minor = level === 'h2' ? 'h[34]' : 'h4';
  var re = new RegExp('<(' + level + '|' + minor + ')\\b[^>]*>([\\s\\S]*?)</\\1\\s*>|<img\\b[^>]*>|background(?:-image)?\\s*:\\s*url\\(\\s*[\'"]?([^\'")]+)', 'gi');
  var major = new RegExp('^' + level + '$', 'i');
  var tokens = [], m;
  while ((m = re.exec(page))) {
    if (m[1]) tokens.push({ at: m.index, heading: text(m[2]).slice(0, 120), major: major.test(m[1]) });
    else {
      var before = page.slice(Math.max(0, m.index - 600), m.index);
      tokens.push({ at: m.index, tag: m[3] ? '' : m[0], src: m[3] || '', video: VIDEO_LINK.test(before), record: RECORD_BLOCK.test(before) });
    }
  }
  var out = [], seen = {}, perSection = {}, last = '', lastMinor = '';
  tokens.forEach(function (t, i) {
    if (t.heading != null) {
      if (t.major) { last = t.heading; lastMinor = ''; } else lastMinor = t.heading;
      return;
    }
    if (out.length >= MAX || t.video || t.record) return;
    /* still inside a section that is skipped (a sponsor's last logo just before the next heading): skipped */
    if (SKIP_SECTION.test(last) || (lastMinor && SKIP_SECTION.test(lastMinor))) return;
    var next = tokens[i + 1], heading = next && next.heading != null && next.major && next.at - t.at <= CARD_SPAN ? next.heading : last;
    if (!heading || SKIP_SECTION.test(heading)) return;
    var tag = t.tag;
    var src = t.src || attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'data-original') || attr(tag, 'src') ||
      String(attr(tag, 'srcset') || attr(tag, 'data-srcset')).split(/\s+/)[0];
    var url = absolute(src, pageUrl), key = url.split(/[?#]/)[0];
    if (!url || seen[key] || skip[key] || /\.(svg|gif)(?:$|[?#])/i.test(key)) return;
    if (SKIP_PICTURE.test(key.replace(/^https:\/\/[^\/]+/, '')) || SKIP_PICTURE.test(attr(tag, 'class')) || /logo|icon/i.test(attr(tag, 'alt'))) return;
    var w = parseInt(attr(tag, 'width'), 10), h = parseInt(attr(tag, 'height'), 10);
    if ((w && w < 160) || (h && h < 120)) return;
    if ((perSection[heading] || 0) >= 2) return;
    seen[key] = 1; perSection[heading] = (perSection[heading] || 0) + 1;
    out.push({ heading: heading, url: url, alt: text(attr(tag, 'alt')).slice(0, 160) });
  });
  return out;
}

var SCHEMA = {
  type: 'OBJECT',
  properties: {
    pictures: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER', description: 'the picture\'s number, as given' },
          kind: { type: 'STRING', enum: KINDS.concat(['other']), description: 'people: a photograph whose subject is people (an audience, a panel, delegates, a portrait); place: a photograph of a venue, a city, a building or a landscape, people at most incidental; subject: a photograph of things — technology, products, machines, materials, a workplace — people at most incidental; graphic: an illustration, a 3-D render, an abstract or patterned artwork, an infographic-like composition with no real text to read; other: a logo, a poster or card made mostly of text, a screenshot.' },
          about: { type: 'STRING', description: 'one short sentence: what it shows, in general terms (never a person\'s name, never the text in it).' }
        },
        required: ['n', 'kind', 'about']
      }
    }
  },
  required: ['pictures']
};

function prompt(found) {
  return ['These pictures are from the content sections of an event\'s website. For each, say what KIND of picture it is and, in general terms, what it shows. Each is numbered in the order given:']
    .concat(found.map(function (p, i) { return (i + 1) + '. in the section headed "' + p.heading + '"' + (p.alt ? ' (described on the page as "' + p.alt + '")' : ''); }))
    .join('\n');
}

function classify(found, read) {
  var list = (found || []).filter(function (p) { return p && p.image; }).slice(0, MAX);
  if (!list.length || typeof read !== 'function') return Promise.resolve([]);
  return Promise.resolve().then(function () {
    return read(prompt(list), SCHEMA, list.map(function (p) { return p.image; }));
  }).then(function (r) {
    if (!r || r.error || !r.parsed || !Array.isArray(r.parsed.pictures)) return [];
    var out = [];
    r.parsed.pictures.forEach(function (p) {
      var at = list[(parseInt(p && p.n, 10) || 0) - 1];
      if (!at || KINDS.indexOf(p.kind) === -1) return;
      out.push({ heading: at.heading, kind: p.kind, about: text(p.about).slice(0, 200) });
    });
    return out;
  }, function () { return []; });
}

module.exports = { picturesIn: picturesIn, classify: classify, KINDS: KINDS, MAX: MAX, SCHEMA: SCHEMA };
