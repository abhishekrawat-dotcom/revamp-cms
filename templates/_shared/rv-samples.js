/* The samples of a real template's design: one rule, read by the check before publishing and by the site editor.

   WHAT A SAMPLE IS (TPL-051, NU-023, NU-034, NEW-3, NEW-4). A real template's section files show, until an event's own
   are entered, what another event had there: its quotes, people, figures and copy, the design's own notes of what to
   write (all marked data-rv-sample, the notes data-rv-sample="instruction"), and the banner's picture behind its words
   (img[data-rv-media="bg-image"]: the stage of the event the design was made for, "#ET MAKING"). Each is known on a
   page by what it shows, never by a mark on the page, so a section ETB2B AI rewrote is read the same way:
     - a quote: the words of a <p>, <blockquote> or <q> of a marked element (outside the caption that names the person),
       WORDS_MIN characters or more;
     - a photo: a picture in a <figure> of a marked element (never an icon the design repeats on every card, which the
       owner's own cards keep), and the banner's picture: by its address;
     - and a marked element with no such quote: by all of its words together (a figure with its label, a role, a
       heading), on an element of the same tag and first class, and never on a card the wizard or the event's records
       built (data-rv-item with a value). Each part of it the editor edits on its own and that is a phrase of its own
       (PART_WORDS words and PART_CHARS characters or more) is known on its own too: rewriting one line of a two-line
       heading leaves the other on the page (NU-034).
   Never a person's role or company alone, nor a name alone: the owner's own cards share those.

   WHO READS IT
     functions/lib/site-checks.js samplesOf / sampleHits: the check before publishing, on HTML read as tokens;
     editor-template-ui.js settleSamples: the site editor, on the page itself — what it outlines in amber, counts and
     brings into view with "Show next" is exactly what the check lists, and nothing else (NEW-3).

   A tree is read through an adapter, one for tokens and one for the page:
     A.kids(n)        the nodes in n (elements and text), in order; n may be the root (a document, a fragment)
     A.isEl(n)        an element          A.isText(n)  a text node          A.text(n)   a text node's words, decoded
     A.tag(n)         an element's tag, in lower case
     A.attr(n, name)  an attribute's value, decoded ('' when it has no value), null when it has none
     A.classes(n)     its classes, in order
     A.unseen(n)      (optional) true for an element no visitor reads; unseen(n, A) when it is not given
   -> the same answers on both sides:
     learn(root, A, into)          what the design's section(s) under root mark as samples -> { texts, srcs, wholes,
                                   instructions } (added to `into` when given). wholes: [{ tag, cls, text, parts? }].
                                   The banner's picture is one of srcs.
     find(root, samples, A, hit)   every sample still shown under root, in page order: hit({ node, at, kind, text, src,
                                   picture, banner, instruction }) — node: the element that shows it (for a part, the
                                   part itself), at: the marked element it was read as (the unit), kind: 'whole' |
                                   'part' | 'quote' | 'photo' | 'banner'
     unseen(n, A), wordsOf(n, A), labelOf(n, A), partsOf(n, A) -> [{ node, text }], isPhrase(text), clean(s)
     BANNER_SAY                    what the check and the editor say of the banner's picture
   No DOM, no network: functions/lib/site-checks.test.js and template-samples.test.js run it in node. ES5. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevampSamples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORDS_MIN = 30;
  var PART_WORDS = 5, PART_CHARS = 25;
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  /* nothing a visitor reads as the page's words */
  var SKIP = { head: 1, script: 1, style: 1, template: 1, noscript: 1, title: 1, textarea: 1, svg: 1, select: 1, iframe: 1, object: 1 };
  /* the marks of something not shown on a live page (rv-live.css, the editor's own, a hidden attribute) */
  var HIDDEN_MARKS = ['hidden', 'data-rv-empty', 'data-rv-hidden-empty', 'data-rv-bind-empty', 'data-rv-nav-empty', 'data-rv-editor',
    'data-rv-empty-state', 'data-rv-preview-ribbon', 'data-rv-removed'];
  var SHOWN_AT_SOME_WIDTH = /^(?:sm|md|lg|xl|2xl):(?:block|flex|grid|inline|inline-block|inline-flex|table|contents|flow-root)$/;
  var QUOTE = /^(?:p|blockquote|q)$/;
  var BANNER_SAY = 'The banner still shows the design’s sample picture, from another event — replace it';

  function clean(s) { return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim(); }
  function isPhrase(text) { return text.length >= PART_CHARS && text.split(/\s+/).length >= PART_WORDS; }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function kidsOf(n, A) { return A.kids(n) || []; }

  /* an element a visitor never reads: not shown, or no words of the page */
  function unseen(n, A) {
    var tag = A.tag(n);
    if (SKIP[tag]) return true;
    for (var i = 0; i < HIDDEN_MARKS.length; i++) if (A.attr(n, HIDDEN_MARKS[i]) !== null) return true;
    if (/(?:^|;)\s*display\s*:\s*none\b/i.test(A.attr(n, 'style') || '')) return true;
    var cls = A.classes(n);
    if (cls.indexOf('is-hidden-sec') !== -1) return true;
    /* Tailwind's "hidden" (an imported page) hides it everywhere unless another class shows it at some width */
    if (cls.indexOf('hidden') !== -1 && !cls.some(function (c) { return SHOWN_AT_SOME_WIDTH.test(c); })) return true;
    return A.attr(n, 'id') === 'revamp-register-modal';     // the old library footer's own pop-up, shut
  }
  function hiddenOf(A) { return A.unseen ? function (n) { return A.unseen(n); } : function (n) { return unseen(n, A); }; }

  /* the words of an element as a visitor reads them (text only: never a label or an alt) */
  function wordsOf(n, A) {
    var parts = [], off = hiddenOf(A);
    (function walk(x) {
      each(kidsOf(x, A), function (k) {
        if (A.isText(k)) parts.push(A.text(k));
        else if (A.isEl(k) && !off(k)) walk(k);
      });
    })(n);
    return clean(parts.join(' '));
  }
  /* its words, else its label, else a picture's alt */
  function labelOf(n, A) {
    var text = wordsOf(n, A);
    if (text) return text;
    text = clean(A.attr(n, 'aria-label') || A.attr(n, 'title') || '');
    if (text) return text;
    var alt = '';
    (function walk(x) {
      each(kidsOf(x, A), function (k) {
        if (alt || !A.isEl(k)) return;
        if (A.tag(k) === 'img') { alt = clean(A.attr(k, 'alt') || ''); if (alt) return; }
        walk(k);
      });
    })(n);
    return alt;
  }
  /* whether an element has words directly in it (not only inside the elements it holds) */
  function ownText(n, A) {
    var kids = kidsOf(n, A);
    for (var i = 0; i < kids.length; i++) if (A.isText(kids[i]) && /\S/.test(A.text(kids[i]))) return true;
    return false;
  }
  /* the parts of an element the editor edits one at a time: each outermost element with words of its own (an element
     with words of its own is one part, itself) -> [{ node, text }] */
  function partsOf(n, A) {
    var off = hiddenOf(A);
    if (ownText(n, A)) { var all = wordsOf(n, A); return all ? [{ node: n, text: all }] : []; }
    var out = [];
    (function walk(x) {
      each(kidsOf(x, A), function (k) {
        if (!A.isEl(k) || VOID[A.tag(k)] || off(k)) return;
        if (ownText(k, A)) { var w = wordsOf(k, A); if (w) out.push({ node: k, text: w }); return; }
        walk(k);
      });
    })(n);
    return out;
  }
  function builtFromData(n, A) { return !!String(A.attr(n, 'data-rv-item') || '').trim(); }
  function srcOf(n, A) { return String(A.attr(n, 'src') || '').trim(); }
  function isBanner(n, A) { return A.tag(n) === 'img' && A.attr(n, 'data-rv-media') === 'bg-image'; }
  function fileOf(src) { return src.replace(/[?#].*$/, '').split('/').pop(); }

  /* ---------- what a design marks ---------- */
  function learnUnit(unit, A, out) {
    var note = String(A.attr(unit, 'data-rv-sample') || '').trim().toLowerCase() === 'instruction';
    var quoted = false;
    (function walk(x, inFigure, isUnit) {
      var tag = A.tag(x);
      if (tag === 'figcaption' || tag === 'cite') return;
      if (tag === 'figure') inFigure = true;
      if (QUOTE.test(tag)) {
        var words = labelOf(x, A);
        if (words.length >= WORDS_MIN) {
          quoted = true;
          if (out.texts.indexOf(words) === -1) out.texts.push(words);
          if (note && out.instructions.indexOf(words) === -1) out.instructions.push(words);
        }
        return;
      }
      /* a photo (in a <figure>, as a quote card's person), never an icon the design repeats on every card */
      if (tag === 'img' && (isUnit || inFigure)) { var src = srcOf(x, A); if (src && out.srcs.indexOf(src) === -1) out.srcs.push(src); }
      each(kidsOf(x, A), function (k) { if (A.isEl(k)) walk(k, inFigure, false); });
    })(unit, false, true);
    /* one with words of its own (a quote, a card's copy) is known by them; the rest by all their words */
    var whole = quoted ? '' : wordsOf(unit, A), cls = A.classes(unit)[0] || '', tag = A.tag(unit);
    if (whole && !out.wholes.some(function (w) { return w.tag === tag && w.cls === cls && w.text === whole; })) {
      var entry = { tag: tag, cls: cls, text: whole }, parts = partsOf(unit, A).map(function (p) { return p.text; });
      if (parts.length >= 2 && parts.some(isPhrase)) entry.parts = parts.filter(isPhrase);
      out.wholes.push(entry);
      if (note && out.instructions.indexOf(whole) === -1) out.instructions.push(whole);
    }
  }
  function learn(rootNode, A, into) {
    var out = into || { texts: [], srcs: [], wholes: [], instructions: [] };
    if (!out.instructions) out.instructions = [];
    (function walk(x) {
      each(kidsOf(x, A), function (k) {
        if (!A.isEl(k)) return;
        if (A.attr(k, 'data-rv-sample') !== null) { learnUnit(k, A, out); return; }
        /* the banner's own picture: the event's banner takes its place (template.json's hero rule keeps it while
           there is none), so while it shows, the page shows the stage of the event the design was made for */
        if (isBanner(k, A)) { var src = srcOf(k, A); if (src && out.srcs.indexOf(src) === -1) out.srcs.push(src); return; }
        walk(k);
      });
    })(rootNode);
    return out;
  }

  /* ---------- what is still on a page ---------- */
  function find(rootNode, samples, A, hit) {
    var wholes = (samples && samples.wholes) || [], texts = (samples && samples.texts) || [], srcs = (samples && samples.srcs) || [];
    var notes = (samples && samples.instructions) || [];
    if (!texts.length && !srcs.length && !wholes.length) return;
    var byTag = {}, off = hiddenOf(A);
    wholes.forEach(function (w) { (byTag[w.tag] || (byTag[w.tag] = [])).push(w); });
    function words(node, at, kind, text) {
      hit({ node: node, at: at, kind: kind, text: text, src: '', picture: false, banner: false, instruction: notes.indexOf(text) !== -1 });
    }
    function visit(n) {
      if (!A.isEl(n) || off(n)) return;
      var tag = A.tag(n);
      /* a marked element, all of its words still as the template had them: one, and nothing inside it again */
      if (byTag[tag] && !builtFromData(n, A)) {
        var cls = A.classes(n);
        var like = byTag[tag].filter(function (w) { return !w.cls || cls.indexOf(w.cls) !== -1; });
        if (like.length) {
          var whole = wordsOf(n, A);
          if (whole && like.some(function (w) { return w.text === whole; })) { words(n, n, 'whole', whole); return; }
          /* part of it rewritten: a part still as the template wrote it is still another event's (NU-034) */
          var known = [];
          like.forEach(function (w) { (w.parts || []).forEach(function (p) { known.push(p); }); });
          var left = known.length ? partsOf(n, A).filter(function (p) { return known.indexOf(p.text) !== -1; }) : [];
          if (left.length) { left.forEach(function (p) { words(p.node, n, 'part', p.text); }); return; }
        }
      }
      /* a quote, read whole as learn() reads it */
      if (QUOTE.test(tag)) {
        var said = labelOf(n, A);
        if (said.length >= WORDS_MIN && texts.indexOf(said) !== -1) { words(n, n, 'quote', said); return; }
      } else if (tag === 'img') {
        var src = srcOf(n, A);
        if (src && srcs.indexOf(src) !== -1) {
          var banner = isBanner(n, A);
          hit({ node: n, at: n, kind: banner ? 'banner' : 'photo', text: fileOf(src), src: src, picture: true, banner: banner, instruction: false });
        }
      }
      each(kidsOf(n, A), visit);
    }
    if (A.isEl(rootNode)) visit(rootNode); else each(kidsOf(rootNode, A), visit);
  }

  return {
    WORDS_MIN: WORDS_MIN, PART_WORDS: PART_WORDS, PART_CHARS: PART_CHARS, VOID: VOID, SKIP: SKIP, HIDDEN_MARKS: HIDDEN_MARKS,
    SHOWN_AT_SOME_WIDTH: SHOWN_AT_SOME_WIDTH, BANNER_SAY: BANNER_SAY,
    clean: clean, isPhrase: isPhrase, unseen: unseen, wordsOf: wordsOf, labelOf: labelOf, ownText: ownText, partsOf: partsOf,
    learn: learn, find: find
  };
});
