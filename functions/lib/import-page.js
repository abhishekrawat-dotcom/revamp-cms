/* What an imported page says of itself, read off the captured document before its <body> is taken (BE-053).

   The import keeps the page's <body> contents. Before this, everything outside them was lost: the page's own name and
   description (so the design was named after its address), the classes and theme on <html> and <body> (class="dark",
   data-theme, a colour scheme), which the page's CSS hangs its look on, and the <style> blocks in its <head> (what a
   component library writes there at run time).

     pageFacts(html, pageUrl) -> { title, description, shareImage, lang }   each '' when the page has none
                                 shareImage is the page's own share picture (og:image / twitter:image), as a full
                                 http(s) address on the original site; it is recorded, not copied
     wrapperOf(html)          -> { open, classes, theme, style }
                                 open: the opening tag of the .rv-imported wrapper the page is kept in, carrying the
                                 classes of <html> and <body>, a data-theme either has, and the colour scheme and
                                 custom properties (--*) of their style attributes — what a theme is made of. Never
                                 what a page's scripts set on <body> for a moment (a menu or a dialog open when it was
                                 captured: overflow-hidden, pointer-events-none…), which would stop the page scrolling
                                 or being clicked here
     headStyles(html)         -> [css]: the text of every <style> before <body>, as it was written (the caller makes it
                                 safe: sanitize.js sanitizeCss, as every stylesheet of an import)
     templateName(record)     -> what an import is called: its page's title, never its address

   No network, no Firebase: see import-ops.test.js. */
'use strict';
const htmlparser2 = require('htmlparser2');
const sanitize = require('./sanitize');

var MAX = { title: 200, description: 500, url: 2000, classes: 40, classLength: 100 };
var NAMELESS = 'Imported design';

/* classes a page's own scripts put on <html> or <body> while something is open, or that pin the page in place: here,
   where those scripts do not run, they would hold the page still for good */
var MOMENTARY = /^(?:[a-z0-9-]+:)*(?:overflow(?:-[xy])?-(?:hidden|clip)|no-?scroll|scroll-?lock(?:ed)?|is-locked|locked|modal-open|menu-open|nav-open|dialog-open|is-loading|loading|preload|pointer-events-none|touch-none|fixed|h-screen|max-h-screen|lenis[\w-]*)$/i;
/* and the names the editor and the site's runtime use for their own marks */
var OURS = /^(?:rv-|ed-|sec-|microsite$|imported-microsite$|show-ai-markers$)/;

function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

/* one pass over the document: the <html> and <body> tags, and what stands before <body> */
function scan(html) {
  var out = { htmlAttrs: null, bodyAttrs: null, title: '', metas: [], headStyles: [] };
  var inBody = false, inTitle = false, titleDone = false, styleDepth = 0, styleText = '';
  try {
    var parser = new htmlparser2.Parser({
      onopentag: function (name, attrs) {
        if (name === 'html') { if (!out.htmlAttrs) out.htmlAttrs = attrs || {}; return; }
        if (name === 'body') { if (!out.bodyAttrs) out.bodyAttrs = attrs || {}; inBody = true; return; }
        if (inBody) return;
        if (name === 'title' && !titleDone) inTitle = true;
        else if (name === 'meta') out.metas.push(attrs || {});
        else if (name === 'style') { if (!styleDepth) styleText = ''; styleDepth++; }
      },
      ontext: function (t) {
        if (inTitle) out.title += t;
        else if (styleDepth) styleText += t;
      },
      onclosetag: function (name) {
        if (name === 'title' && inTitle) { inTitle = false; titleDone = true; }
        else if (name === 'style' && styleDepth) { styleDepth--; if (!styleDepth && !inBody && styleText.trim()) out.headStyles.push(styleText); }
      }
    }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
    parser.write(String(html == null ? '' : html));
    parser.end();
  } catch (e) { /* a document that cannot be read says nothing of itself */ }
  return out;
}

function metaContent(metas, names) {
  for (var i = 0; i < names.length; i++) {
    for (var j = 0; j < metas.length; j++) {
      var m = metas[j], key = String(m.name || m.property || '').toLowerCase();
      if (key === names[i] && clip(m.content, 10)) return m.content;
    }
  }
  return '';
}
function absoluteHttp(raw, base) {
  var v = clip(raw, MAX.url);
  if (!v) return '';
  try {
    var u = new URL(v, base || undefined);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href.slice(0, MAX.url) : '';
  } catch (e) { return ''; }
}

function pageFacts(html, pageUrl) {
  var s = scan(html);
  var lang = clip(s.htmlAttrs && s.htmlAttrs.lang, 20);
  return {
    title: clip(s.title, MAX.title) || clip(metaContent(s.metas, ['og:title', 'twitter:title']), MAX.title),
    description: clip(metaContent(s.metas, ['description', 'og:description', 'twitter:description']), MAX.description),
    shareImage: absoluteHttp(metaContent(s.metas, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']), pageUrl),
    lang: /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang) ? lang : ''
  };
}

function classesOf(attrs) {
  return String((attrs && attrs['class']) || '').split(/\s+/).filter(function (c) {
    return c && c.length <= MAX.classLength && !/["'<>`\\]/.test(c) && !MOMENTARY.test(c) && !OURS.test(c);
  });
}
/* the declarations of a theme in a style attribute: color-scheme and custom properties */
function themeStyle(attrs) {
  var out = [];
  String((attrs && attrs.style) || '').split(';').forEach(function (d) {
    var at = d.indexOf(':');
    if (at === -1) return;
    var prop = d.slice(0, at).trim().toLowerCase(), value = d.slice(at + 1).trim();
    if (!value || (prop !== 'color-scheme' && !/^--[a-z0-9_-]+$/i.test(prop))) return;
    out.push(prop + ': ' + value);
  });
  return out;
}
function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function wrapperOf(html) {
  var s = scan(html);
  var classes = [];
  classesOf(s.htmlAttrs).concat(classesOf(s.bodyAttrs)).forEach(function (c) { if (classes.indexOf(c) === -1 && classes.length < MAX.classes) classes.push(c); });
  var theme = clip((s.htmlAttrs && s.htmlAttrs['data-theme']) || (s.bodyAttrs && s.bodyAttrs['data-theme']), 60);
  if (!/^[\w-]+$/.test(theme)) theme = '';
  /* each declaration as sanitize.js lets it stay in a style attribute (no address a script could run) */
  var style = sanitize.sanitizeStyleAttribute(themeStyle(s.htmlAttrs).concat(themeStyle(s.bodyAttrs)).join('; ')) || '';
  var open = '<div class="' + escAttr(['rv-imported'].concat(classes).join(' ')) + '"' +
    (theme ? ' data-theme="' + escAttr(theme) + '"' : '') + (style ? ' style="' + escAttr(style) + '"' : '') + '>';
  return { open: open, classes: classes, theme: theme, style: style };
}

function headStyles(html) { return scan(html).headStyles; }

function templateName(record) {
  var title = record && record.page && typeof record.page.title === 'string' ? clip(record.page.title, MAX.title) : '';
  return title || NAMELESS;
}

module.exports = { pageFacts, wrapperOf, headStyles, templateName, NAMELESS };
