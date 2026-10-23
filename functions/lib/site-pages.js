/* Internal pages of a site, on the server: /e/<id>/<slug> and /preview/<id>/<slug>.

   A site is ONE document; besides its home page it may have internal pages, each with its own address, sharing
   the top bar, theme and footer. The contract is written out at the top of templates/_shared/rv-pages.js (the
   page's own runtime), and this file takes its rules from there — the slug rule, the cleaning of the page list,
   the CSS that shows one page, the title of a page — so the server and the browser cannot disagree.

     readPages(html, kit)            -> [{ slug, title, description? }] — the page list of a document (its
                                        <meta name="rv-pages"> in <head>, else <script id="rv-pages">); [] for a
                                        one-page site
     selectPage(html, slug, kit)     -> { html, found, page, pages } — the document as the address of one of its
                                        pages serves it: <html data-rv-current-page="<slug>">, its <title> and
                                        og:/twitter: title "<page title> | <site title>", its description (when
                                        the page has its own), its canonical link and og:url with "/<slug>" on the
                                        end. found is false when the document has no such page (the caller
                                        answers 404). slug '' or null: the home page — the document unchanged.
     setPageLinks(html, base, kit)   -> html — every <a data-rv-page-link="<slug>|home"> to a page the document
                                        has gets href="<base>/<slug>" (home: "<base>"), so a page works with no
                                        script; rv-pages.js then adjusts it to where it is viewed (?draft=1 …)
     pagesMeta(pages)                -> '<meta name="rv-pages" content="…">' — for whoever builds a site
     pagesCss(pages)                 -> the CSS that shows one page and hides the others (rv-pages.js css())
     cleanPages(list), SLUG_RE       -> as rv-pages.js

   kit: the HTML tokenizer of lib/api.js (TOKEN_KIT: tokenizeHtml, attrOf, attrValue, setAttr, writeTag). It
   changes only the tags it means to and writes every other byte back as it was. */
'use strict';
var RP = require('../../templates/_shared/rv-pages.js');

function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, function (m, e) {
    var k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'nbsp') return ' ';
    var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch (err) { return m; }
  });
}
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* where <html>, <head> … </head> and <body> are among the tokens */
function layout(tokens) {
  var at = { html: -1, headOpen: -1, headClose: -1, body: -1 };
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'open' && t.name === 'html' && at.html === -1) at.html = i;
    if (t.t === 'open' && t.name === 'head' && at.headOpen === -1 && at.body === -1) at.headOpen = i;
    if (t.t === 'close' && t.name === 'head' && at.headClose === -1 && at.headOpen !== -1 && at.body === -1) at.headClose = i;
    if (t.t === 'open' && t.name === 'body' && at.body === -1) { at.body = i; break; }
  }
  /* the part of the page that is its head: up to </head>, else up to <body>, else everything */
  at.headEnd = at.headClose !== -1 ? at.headClose : at.body !== -1 ? at.body : tokens.length;
  return at;
}

function pagesFromTokens(html, tokens, kit) {
  var at = layout(tokens), script = -1;
  for (var i = 0; i < at.headEnd; i++) {
    var t = tokens[i];
    if (t.t !== 'open') continue;
    if (t.name === 'meta' && String(kit.attrValue(t, 'name') || '').toLowerCase() === 'rv-pages') {
      return RP.parsePages(decodeEntities(kit.attrValue(t, 'content') || ''));
    }
    if (t.name === 'script' && kit.attrValue(t, 'id') === 'rv-pages' && script === -1) script = i;
  }
  if (script === -1) {
    /* the script form may also sit in <body> */
    for (var j = at.headEnd; j < tokens.length; j++) {
      var b = tokens[j];
      if (b.t === 'open' && b.name === 'script' && kit.attrValue(b, 'id') === 'rv-pages') { script = j; break; }
    }
  }
  if (script !== -1 && tokens[script + 1] && tokens[script + 1].t === 'raw') {
    return RP.parsePages(html.slice(tokens[script + 1].s, tokens[script + 1].e));
  }
  return [];
}

function readPages(html, kit) {
  html = String(html == null ? '' : html);
  if (html.indexOf('rv-pages') === -1) return [];                // the common case, a one-page site: no tokenizing
  return pagesFromTokens(html, kit.tokenizeHtml(html), kit);
}

/* "https://host/e/abc/" + "awards" -> "https://host/e/abc/awards" */
function withSlug(url, slug) {
  var base = String(url).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return base ? base + '/' + slug : '';
}

function selectPage(html, slug, kit) {
  html = String(html == null ? '' : html);
  /* the home page is the address without a slug; "/home" is no page ("home" is never a slug) */
  if (!slug) return { html: html, found: true, page: null, pages: readPages(html, kit) };
  var tokens = kit.tokenizeHtml(html);
  var pages = pagesFromTokens(html, tokens, kit);
  var page = null;
  pages.forEach(function (p) { if (p.slug === slug) page = p; });
  if (!page) return { html: html, found: false, page: null, pages: pages };

  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  var at = layout(tokens);
  if (at.html !== -1) {
    kit.setAttr(tokens[at.html], 'data-rv-current-page', slug);
    out[at.html] = kit.writeTag(tokens[at.html]);
  } else {
    out[0] = '<html data-rv-current-page="' + escAttr(slug) + '">' + (out[0] || '');
  }

  var siteTitle = '', titleAt = -1;
  for (var i = 0; i < at.headEnd; i++) {
    if (tokens[i].t === 'open' && tokens[i].name === 'title') { titleAt = i; break; }
  }
  if (titleAt !== -1) {
    var raw = tokens[titleAt + 1] && tokens[titleAt + 1].t === 'raw' ? titleAt + 1 : -1;
    siteTitle = raw !== -1 ? decodeEntities(out[raw]).replace(/\s+/g, ' ').trim() : '';
  }
  var title = RP.titleFor(page, siteTitle);
  if (titleAt !== -1) {
    if (tokens[titleAt + 1] && tokens[titleAt + 1].t === 'raw') out[titleAt + 1] = escText(title);
    else out[titleAt] += escText(title);
  }

  var describedAt = false;
  for (var k = 0; k < at.headEnd; k++) {
    var t = tokens[k];
    if (t.t !== 'open' || (t.name !== 'meta' && t.name !== 'link')) continue;
    var key = String(kit.attrValue(t, t.name === 'meta' ? (kit.attrValue(t, 'property') != null ? 'property' : 'name') : 'rel') || '').toLowerCase();
    var attr = null, value = null;
    if (t.name === 'meta' && (key === 'og:title' || key === 'twitter:title')) { attr = 'content'; value = title; }
    else if (t.name === 'meta' && page.description && (key === 'description' || key === 'og:description' || key === 'twitter:description')) { attr = 'content'; value = page.description; if (key === 'description') describedAt = true; }
    else if (t.name === 'meta' && key === 'og:url') { attr = 'content'; value = withSlug(decodeEntities(kit.attrValue(t, 'content') || ''), slug); }
    else if (t.name === 'link' && key.split(/\s+/).indexOf('canonical') !== -1) { attr = 'href'; value = withSlug(decodeEntities(kit.attrValue(t, 'href') || ''), slug); }
    if (!attr || !value) continue;
    kit.setAttr(t, attr, value);
    out[k] = kit.writeTag(t);
  }
  /* no <title> at all, or no description where the page has its own: at the end of the head */
  var add = '';
  if (titleAt === -1 && title) add += '<title>' + escText(title) + '</title>\n';
  if (page.description && !describedAt) add += '<meta name="description" content="' + escAttr(page.description) + '">\n';
  if (add && at.headClose !== -1) out[at.headClose] = add + out[at.headClose];
  return { html: out.join(''), found: true, page: page, pages: pages };
}

function setPageLinks(html, base, kit) {
  html = String(html == null ? '' : html);
  if (html.indexOf('data-rv-page-link') === -1) return html;
  var tokens = kit.tokenizeHtml(html);
  var pages = pagesFromTokens(html, tokens, kit);
  if (!pages.length) return html;
  var known = {};
  pages.forEach(function (p) { known[p.slug] = 1; });
  base = String(base || '').replace(/\/+$/, '');
  var changed = false;
  var out = tokens.map(function (t) {
    var text = html.slice(t.s, t.e);
    if (t.t !== 'open' || t.name !== 'a') return text;
    var to = kit.attrValue(t, 'data-rv-page-link');
    if (to == null) return text;
    to = decodeEntities(to).trim() || RP.HOME;
    if (to !== RP.HOME && !known[to]) return text;
    var href = to === RP.HOME ? (base || '/') : base + '/' + to;
    if (kit.attrValue(t, 'href') === href) return text;
    kit.setAttr(t, 'href', href);
    changed = true;
    return kit.writeTag(t);
  });
  return changed ? out.join('') : html;
}

function pagesMeta(pages) {
  var list = RP.cleanPages(pages);
  return list.length ? '<meta name="rv-pages" content="' + escAttr(JSON.stringify(list)) + '">' : '';
}

module.exports = {
  SLUG_RE: RP.SLUG_RE, HOME: RP.HOME,
  cleanPages: RP.cleanPages, pagesCss: RP.css, titleFor: RP.titleFor,
  readPages: readPages, selectPage: selectPage, setPageLinks: setPageLinks, pagesMeta: pagesMeta,
  _pagesFromTokens: pagesFromTokens
};
