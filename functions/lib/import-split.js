/* An imported page (Lovable), cut into the sections it is made of.

   The capture of such a page is one long piece of markup. Kept as ONE section, nothing in the editor that
   works on a section (move, hide, delete, Redesign, the AI's rework, the developer zone) can be used on a
   part of it, and the whole page is too large to hand to the AI. So the page is cut where its author cut it:

     <body>
       <div id="root">                 \
         <div class="min-h-screen …">   } wrappers with one child each: the FRAME, kept once around the page
           <div aria-hidden …>          - things with nothing to read in them (an intro curtain, a progress
                                          bar): DECOR, kept in the frame
           <header>                     \
           <section id="about">          } the blocks: one SECTION each
           <main> <section>… </main>     - a <main> (or a plain <div>) that only holds sections is opened up,
           <footer>                     /  and each of its sections carries a copy of it as its own wrapper

   splitImportedPage(bodyHtml) -> null when the page cannot be cut into at least two sections (the import then
   stays one section, as before), else
     { frameOpen, frameClose, decor, sections: [ { id, name, html } ] }
   frameOpen + decor + <the sections, each exactly one root element> + frameClose is the page again.
   No network, no Firebase: see import-split.test.js. */

const { parseDocument } = require('htmlparser2');
const render = require('dom-serializer').default;
const domutils = require('domutils');

var MAX_SECTIONS = 40;
var MEDIA = /^(img|svg|video|picture|canvas|iframe)$/;
var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;

function elements(node) { return (node.children || []).filter(function (c) { return c.type === 'tag'; }); }
/* the text of a node, with a space where the markup breaks a line (a <br>, the end of a block) */
function textOf(node) {
  var out = [];
  (function walk(n) {
    if (n.type === 'text') { out.push(n.data || ''); return; }
    if (n.type !== 'tag' && n.type !== 'root') return;
    if (n.name === 'br') out.push(' ');
    (n.children || []).forEach(walk);
    if (n.name && !/^(a|b|i|em|strong|small|sup|sub|u)$/.test(n.name)) out.push(' ');
  })(node);
  return out.join('').replace(/\s+/g, ' ').trim();
}
function hasMedia(node) { return !!domutils.findOne(function (e) { return MEDIA.test(e.name); }, [node], true); }
function hasContent(node) { return !!textOf(node) || hasMedia(node); }
/* nothing in it to read or look at, and marked as not for readers: a curtain, a progress bar, a glow */
function isDecor(el) { return el.attribs && el.attribs['aria-hidden'] === 'true' && !textOf(el) && !hasMedia(el); }
/* not a section by itself: nothing to read in it — an empty spacer or divider, or a picture marked as
   decoration (a strip above the footer). It stays where it is, riding with the block next to it. */
function ridesAlong(el) { return !textOf(el) && (!hasMedia(el) || (el.attribs && el.attribs['aria-hidden'] === 'true')); }
/* text that is the element's own, not inside a child element */
function ownText(el) {
  return (el.children || []).some(function (c) { return c.type === 'text' && /\S/.test(c.data || ''); });
}

function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function openTag(el, extra) {
  var out = '<' + el.name;
  Object.keys(el.attribs || {}).forEach(function (k) { out += ' ' + k + '="' + escAttr(el.attribs[k]) + '"'; });
  return out + (extra || '') + '>';
}
function html(nodes) { return render(nodes, { decodeEntities: false, encodeEntities: false, selfClosingTags: false }); }

/* a wrapper that only holds the page's sections: opened up, so that each of them is a section of its own */
function holdsSections(el) {
  if (el.name !== 'main' && el.name !== 'div') return false;
  if (ownText(el)) return false;
  var kids = elements(el).filter(function (k) { return !isDecor(k); });
  if (el.name === 'main') return kids.length >= 2;
  if (kids.length < 3) return false;
  var blocks = kids.filter(function (k) { return /^(section|article|header|footer|div)$/.test(k.name) && hasContent(k); });
  var named = kids.filter(function (k) { return k.name === 'section' || k.name === 'article' || (k.attribs && k.attribs.id); });
  return blocks.length >= kids.length * 0.6 && named.length >= 2;
}

function slug(text) {
  return String(text || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
}
function headingOf(el) {
  var h = domutils.findOne(function (e) { return /^h[1-4]$/.test(e.name) && !!textOf(e); }, [el], true);
  return h ? textOf(h) : '';
}
function titleCase(id) { return id.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

function splitImportedPage(bodyHtml) {
  var doc;
  try { doc = parseDocument(String(bodyHtml || ''), { decodeEntities: false }); } catch (e) { return null; }

  /* ---- the frame: down through every wrapper that has one child ---- */
  var chain = [], decor = [], cur = doc;
  for (var depth = 0; depth < 12; depth++) {
    var kids = elements(cur);
    var real = kids.filter(function (k) { return !isDecor(k); });
    if (real.length !== 1) break;
    var only = real[0];
    /* a <section>, a <header>, a <footer> is a block of the page, not a wrapper around the page */
    if (!/^(div|main|body|span)$/.test(only.name)) break;
    /* a single child that is itself the content (a lone <section> of text) is not a wrapper to go through */
    if (elements(only).filter(function (k) { return !isDecor(k); }).length < 2 && !holdsSections(only)) {
      if (elements(only).length !== 1) break;
    }
    kids.forEach(function (k) { if (k !== only) decor.push(k); });
    chain.push(only);
    cur = only;
  }
  if (!chain.length && elements(cur).length < 2) return null;

  /* ---- the blocks ----
     A block that only holds the page's sections — directly, or behind wrappers of one child each
     (<main><div class="theme"> the sections </div></main>) — is opened up: each section inside it becomes a
     block, carrying copies of the wrappers it was in. */
  var blocks = [];
  function holderIn(el) {
    var wraps = [], at = el;
    for (var i = 0; i < 5; i++) {
      if (holdsSections(at)) return { holder: at, wraps: wraps.concat([at]) };
      if (!/^(main|div)$/.test(at.name) || ownText(at)) return null;
      var real = elements(at).filter(function (k) { return !isDecor(k); });
      if (real.length !== 1) return null;
      wraps.push(at);
      at = real[0];
    }
    return null;
  }
  /* Decor that stood among a holder's sections (a backdrop laid behind them) is placed by that holder, so it
     stays inside a copy of it: it leads the next section taken from the holder. Decor of the frame itself
     stays in the frame. */
  var lead = [];
  function take(el, wraps, depth) {
    if (isDecor(el)) { if (wraps.length) lead.push(el); else decor.push(el); return; }
    if (el.attribs && el.attribs.id === 'lovable-badge') return;          // the site builder's own badge
    var found = depth < 3 ? holderIn(el) : null;
    if (!found) { blocks.push({ el: el, wraps: wraps, lead: lead }); lead = []; return; }
    elements(found.holder).forEach(function (inner) { take(inner, wraps.concat(found.wraps), depth + 1); });
  }
  elements(cur).forEach(function (el) { take(el, [], 0); });

  /* a block with nothing in it (a spacer, a divider) rides with the block after it — or before, at the end */
  var merged = [];
  var carry = [];
  blocks.forEach(function (b) {
    if (ridesAlong(b.el)) { carry.push(b); if (b.lead && b.lead.length) { carry.unshift.apply(carry, b.lead.map(function (d) { return { el: d }; })); b.lead = []; } return; }
    b.before = carry; carry = [];
    merged.push(b);
  });
  if (carry.length && merged.length) merged[merged.length - 1].after = carry;
  /* a page is cut between its blocks — boxes that hold things — never between a heading and its paragraph */
  var boxes = merged.filter(function (b) { return /^(section|article|header|footer|nav|main|aside|div|form|figure)$/.test(b.el.name); });
  if (merged.length < 2 || boxes.length < merged.length * 0.75) return null;
  if (merged.length > MAX_SECTIONS) {
    // the tail of a very long page stays together in the last section
    var tail = merged.splice(MAX_SECTIONS - 1);
    var last = tail.shift();
    last.after = (last.after || []).concat(tail.reduce(function (all, t) { return all.concat(t.before || [], [t], t.after || []); }, []));
    merged.push(last);
  }

  /* ---- ids and names ---- */
  var used = { imported: true }, heroGiven = false;
  var sections = merged.map(function (b, i) {
    var el = b.el, heading = headingOf(el);
    var id = slug(el.attribs && el.attribs.id);
    if (!id || id === 'top' || id === 'root') {
      if (el.name === 'header' || el.name === 'nav') id = 'nav';
      else if (el.name === 'footer') id = 'footer';
      else if (!heroGiven && i <= 2 && domutils.findOne(function (e) { return e.name === 'h1'; }, [el], true)) id = 'hero';
      else id = slug(heading) || 'section-' + (i + 1);
    }
    if (id === 'hero') heroGiven = true;
    var base = id, n = 2;
    while (used[id]) id = base + '-' + (n++);
    used[id] = true;
    var name = id === 'nav' ? 'Top bar' : id === 'hero' ? 'Hero' : id === 'footer' ? 'Footer' : (heading ? heading.slice(0, 48) : titleCase(id));

    var nodes = (b.lead || []).concat((b.before || []).map(function (x) { return x.el; }), [el], (b.after || []).map(function (x) { return x.el; }));
    var inner = html(nodes);
    var out = inner;
    if (b.wraps.length) {
      // the opened-up wrappers, as plain boxes around this one section (et-runtime.js keeps them from adding height)
      b.wraps.slice().reverse().forEach(function (w) {
        var cls = w.attribs && w.attribs['class'];
        out = '<div' + (cls ? ' class="' + escAttr(cls) + '"' : '') + ' data-rv-wrap>' + out + '</div>';
      });
    } else if (nodes.length > 1) out = '<div data-rv-wrap>' + inner + '</div>';
    return { id: id, name: name, html: out };
  });

  return {
    frameOpen: '<div class="rv-imported">' + chain.map(function (el) { return openTag(el); }).join(''),
    frameClose: chain.slice().reverse().map(function (el) { return VOID.test(el.name) ? '' : '</' + el.name + '>'; }).join('') + '</div>',
    decor: html(decor),
    sections: sections
  };
}

module.exports = { splitImportedPage };
