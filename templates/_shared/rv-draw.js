/* What a saved site shows of the event itself, drawn into it by the site editor when it opens a site
   (editor-template-ui.js) and by the server whenever the site is saved or something in Content or Basics changes
   (functions/lib/site-records.js, on the same page parsed into a small DOM: functions/lib/mini-dom.js). One copy of
   these rules, so the editor, the staged copy, the preview and the live page always agree.

   Basics (the event's own name, date and place) — every element marked data-rv-bind="event.name | event.date |
   event.venue | event.city | event.description" shows that detail of the event as Basics hold it now:
     factOf(event, key, style, cityApart) -> the words ('' when Basics have none)
       event.date   the start and end when there is a start ("exact"), in the element's style
                    (data-rv-bind-style): ''      "27th November, 2026"   ET's own sites (a real template's banner)
                                          'day'   "27 November, 2026"     (tech500's second line of the date)
                                          'long'  "27 November 2026"      an AI-designed site's banner
                                          'short' "27 Nov 2026"           an AI-designed site's top bar
                    a range in the same style ("27th – 29th November, 2026"); without a start, the words Create Event
                    or Basics keep for a date that is not fixed yet (dateLabel: "March 2027", "Q2 2027", "Date to be
                    announced") — never a date nobody gave
       event.venue  the venue and the city ("Grand Hyatt, Mumbai"; the city once when the venue names it; only the
                    venue when the page shows the city on its own line, event.city)
     drawFacts(doc, event, opts) -> { written, sections: [element whose markup changed] }
       opts.fill       RevampFill (editor-fill.js): its showSlot
       opts.binds      a real template's template.json -> content.bind ([{ section, sel, bind, style }]): the
                       elements of a page saved before its section files carried the attribute
       opts.generated  true for an AI-designed site: its banner's date and place (gen-design.js heroHtml) and its top
                       bar's date and place (et-nav.js) are marked on a page built before they carried the attribute;
                       the top bar's name only when it reads as Basics' name now (a shortened name is the owner's)
       opts.hint       true (the editor): an element with nothing to show says where to add it ("Add the date in
                       Basics", data-rv-bind-hint, editor-only); 'keep' (the server): a hint already there stays
       An element with nothing to show is marked data-rv-bind-empty: the published and previewed page hide it
       (rv-live.css). One the owner rewrote by hand in the editor carries data-rv-unbound instead and keeps their words.

   A real template's record lists — the lists of its template.json content.map fed by Content (speakers, FAQs,
   sponsors, contacts, gallery), drawn through the template's own rules (editor-fill.js) in data mode: one card per
   record, the template's neutral model kept aside in <template data-rv-pristine>, no card at all for none:
     MAP_SOURCES[kind]        the console resources (GET /api/event/<resource>) a kind is made from, its own first
     mapContent(rows)         -> { kind: what the content.map rules read } for the kinds whose records were read
                              (rows: { resource: [record] }, as site-records.js and the editor have them); value.waiting:
                              how many speakers or sponsors are in Content but not on the site (Invited, Tentative)
     drawMapLists(doc, map, content, opts) -> { filled: [kind], emptied: [kind], placed: [kind], sections: [element] }
       opts.fill    RevampFill        opts.avatar   the neutral picture of a speaker without a photo
       opts.notice(place, list, kind, waiting)    the editor's: says, in the place, why visitors do not see it
       A section with no record to show is marked data-rv-empty="<kind>" (the live page hides it, and the menu's link
       to it: data-rv-nav-empty), as an AI-designed site's empty list is (site-records.js); records arriving take the
       marks away. placed: the kinds this page has a list for.

   A plain script, ES5: window.RevampDraw in a browser (after rv-records.js), module.exports in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rv-records.js'));
  else root.RevampDraw = factory(root.RevampRecords);
})(typeof self !== 'undefined' ? self : this, function (RR) {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var HINTS = {
    'event.name': 'Add the event name in Basics',
    'event.date': 'Add the date in Basics',
    'event.venue': 'Add the venue in Basics',
    'event.city': 'Add the city in Basics',
    'event.description': 'Add a description in Basics'
  };

  function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function attrSel(v) { return String(v).replace(/["\\]/g, '\\$&'); }

  /* ---------- the event's date and place, as Basics hold them ---------- */
  /* "2026-11-27" or "2026-11-27T09:30": the calendar date that was typed, never moved by a time zone */
  function ymd(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function sameDay(a, b) { return a.y === b.y && a.m === b.m && a.d === b.d; }
  function before(a, b) { return a.y !== b.y ? a.y < b.y : a.m !== b.m ? a.m < b.m : a.d < b.d; }
  /* ET's own sites (editor-fill.js formatDate, the banner of a real template): "27th November, 2026"; 'day' without
     the ordinal */
  function etDate(a, b, plain) {
    var day = function (x) { return plain ? String(x.d) : ordinal(x.d); };
    if (!b || sameDay(a, b)) return day(a) + ' ' + MONTHS[a.m] + ', ' + a.y;
    if (a.y !== b.y) return day(a) + ' ' + MONTHS[a.m] + ', ' + a.y + ' – ' + day(b) + ' ' + MONTHS[b.m] + ', ' + b.y;
    if (a.m !== b.m) return day(a) + ' ' + MONTHS[a.m] + ' – ' + day(b) + ' ' + MONTHS[b.m] + ', ' + b.y;
    return day(a) + ' – ' + day(b) + ' ' + MONTHS[b.m] + ', ' + b.y;
  }
  /* an AI-designed site's banner (functions/lib/gen-design.js dateLabel): "18 February 2027", "18–19 February 2027" */
  function longDate(a, b) {
    if (!b || sameDay(a, b)) return a.d + ' ' + MONTHS[a.m] + ' ' + a.y;
    if (b.y === a.y && b.m === a.m) return a.d + '–' + b.d + ' ' + MONTHS[a.m] + ' ' + a.y;
    return a.d + ' ' + MONTHS[a.m] + (b.y === a.y ? '' : ' ' + a.y) + ' – ' + b.d + ' ' + MONTHS[b.m] + ' ' + b.y;
  }
  /* an AI-designed site's top bar (functions/lib/et-nav.js shortDate): "5 Dec 2025", "5–7 Dec 2026" */
  function shortDate(a, b) {
    var one = function (p, year) { return p.d + ' ' + SHORT_MONTHS[p.m] + (year ? ' ' + p.y : ''); };
    if (!b || sameDay(a, b) || before(b, a)) return one(a, true);
    if (b.y === a.y && b.m === a.m) return a.d + '–' + b.d + ' ' + SHORT_MONTHS[a.m] + ' ' + a.y;
    if (b.y === a.y) return one(a, false) + ' – ' + one(b, true);
    return one(a, true) + ' – ' + one(b, true);
  }
  /* a date that is not fixed yet: the words kept for it, else the ones its parts make (as Create Event writes them) */
  function looseDate(ev) {
    var label = str(ev.dateLabel);
    if (label) return label;
    var p = ev.datePartial && typeof ev.datePartial === 'object' ? ev.datePartial : {}, m;
    if (ev.dateMode === 'month') return (m = /^(\d{4})-(\d{2})$/.exec(String(p.month || ''))) && +m[2] >= 1 && +m[2] <= 12 ? MONTHS[+m[2] - 1] + ' ' + m[1] : '';
    if (ev.dateMode === 'quarter') return /^Q[1-4]$/.test(String(p.quarter || '')) && /^\d{4}$/.test(String(p.year || '')) ? p.quarter + ' ' + p.year : '';
    if (ev.dateMode === 'tbd') return str(p.note) || 'Date to be announced';
    return '';
  }
  function dateText(ev, style) {
    ev = ev || {};
    var a = ymd(ev.start), b = ymd(ev.end);
    if (!a) return looseDate(ev);
    if (style === 'long') return longDate(a, b);
    if (style === 'short') return shortDate(a, b);
    return etDate(a, b, style === 'day');
  }
  function placeText(ev, cityApart) {
    ev = ev || {};
    var venue = str(ev.venue), city = str(ev.city);
    if (cityApart) return venue;
    if (venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) !== -1) return venue;
    return [venue, city].filter(Boolean).join(', ');
  }
  /* -> the words, '' when Basics have none, null for a key that is not one of the event's details */
  function factOf(ev, key, style, cityApart) {
    ev = ev || {};
    switch (key) {
      case 'event.name': return str(ev.name);
      case 'event.date': return dateText(ev, style || '');
      case 'event.venue': return placeText(ev, cityApart);
      case 'event.city': return str(ev.city);
      case 'event.description': return String(ev.description == null ? '' : ev.description).trim();
      default: return null;
    }
  }

  /* ---------- writing one detail ---------- */
  function hasText(n) {
    return n.nodeType === 3 ? /\S/.test(n.nodeValue) : n.nodeType === 1 && (n.tagName === 'BR' || /\S/.test(n.textContent));
  }
  /* the element's words become value; icons and other elements without words stay where they are. Words held in one
     plain child (an AI-designed banner's <span>) are written in it, so the markup stays as it was; the spacing the
     words had after an icon is kept, also while there are none. */
  function setWords(el, value) {
    var doc = el.ownerDocument;
    var runs = Array.prototype.filter.call(el.childNodes, hasText);
    if (!runs.length) {
      if (value === '') return;
      var tail = el.lastChild;
      if (tail && tail.nodeType === 3) tail.nodeValue = /^\s*/.exec(tail.nodeValue)[0] + value;
      else el.appendChild(doc.createTextNode(value));
      return;
    }
    var first = runs[0];
    if (first.nodeType === 3) {
      var m = /^(\s*)[\s\S]*?(\s*)$/.exec(first.nodeValue);
      first.nodeValue = value === '' ? m[1] : m[1] + value + m[2];
    } else if (first.tagName !== 'BR' && !first.firstElementChild) {
      first.textContent = value;
    } else {
      el.replaceChild(doc.createTextNode(value), first);
    }
    runs.slice(1).forEach(function (n) { n.parentNode.removeChild(n); });
  }
  function addHint(el, key) {
    var hint = el.ownerDocument.createElement('span');
    hint.setAttribute('data-rv-editor', '');
    hint.setAttribute('data-rv-bind-hint', '');
    hint.setAttribute('data-ed', 'none');
    hint.setAttribute('style', 'opacity:.55;font-style:italic');
    hint.textContent = HINTS[key] || 'Add it in Basics';
    el.appendChild(hint);
  }

  /* an element follows a detail of the event from now on (one the owner rewrote by hand does not) */
  function mark(el, key, style) {
    if (el.hasAttribute('data-rv-unbound')) return;
    if (el.hasAttribute('data-rv-bind')) {
      if (style && el.getAttribute('data-rv-bind') === key && !el.hasAttribute('data-rv-bind-style')) el.setAttribute('data-rv-bind-style', style);
      return;
    }
    el.setAttribute('data-rv-bind', key);
    if (style) el.setAttribute('data-rv-bind-style', style);
  }
  function markBinds(doc, binds) {
    (Array.isArray(binds) ? binds : []).forEach(function (b) {
      if (!b || !b.bind || !b.sel || !HINTS[b.bind]) return;          // event.logo is the logo's own business
      var roots = b.section ? qsa(doc, '[data-rv-section="' + attrSel(b.section) + '"]') : [doc];
      roots.forEach(function (root) {
        var found;
        // one selector that cannot be read must not cost the page its other details
        try { found = b.sel === ':self' ? [root] : qsa(root, b.sel); } catch (e) { found = []; }
        found.forEach(function (el) { if (el.nodeType === 1) mark(el, b.bind, b.style || ''); });
      });
    });
  }
  /* an AI-designed site built before its banner and top bar carried the marks */
  function markGenerated(doc, ev) {
    qsa(doc, '[data-rv-section="hero"] .hero-facts > .hero-fact').forEach(function (el) {
      if (el.querySelector('svg rect')) mark(el, 'event.date', 'long');
      else if (el.querySelector('svg circle')) mark(el, 'event.venue', '');
    });
    qsa(doc, '[data-rv-section="nav"] .rv-etnav-date').forEach(function (el) { mark(el, 'event.date', 'short'); });
    qsa(doc, '[data-rv-section="nav"] .rv-etnav-place').forEach(function (el) { mark(el, 'event.venue', ''); });
    var name = factOf(ev, 'event.name');
    qsa(doc, '[data-rv-section="nav"] .rv-etnav-name').forEach(function (el) {
      if (name && str(el.textContent) === name) mark(el, 'event.name', '');
    });
  }

  function watcher() {
    var watched = [], before = [];
    return {
      watch: function (el) {
        var root = (el.closest && el.closest('[data-rv-section]')) || el;
        if (watched.indexOf(root) === -1) { watched.push(root); before.push(root.outerHTML); }
      },
      changed: function () { return watched.filter(function (root, i) { return root.outerHTML !== before[i]; }); }
    };
  }

  function drawFacts(doc, ev, opts) {
    opts = opts || {};
    var report = { written: 0, sections: [] };
    if (!doc || !ev || typeof ev !== 'object') return report;
    var w = watcher();
    var fill = opts.fill;
    qsa(doc, '[data-rv-section="hero"], [data-rv-section="nav"]').forEach(w.watch);
    (Array.isArray(opts.binds) ? opts.binds : []).forEach(function (b) {
      if (b && b.section) qsa(doc, '[data-rv-section="' + attrSel(b.section) + '"]').forEach(w.watch);
    });
    markBinds(doc, opts.binds);
    if (opts.generated) markGenerated(doc, ev);
    var cityApart = !!doc.querySelector('[data-rv-bind="event.city"]');
    qsa(doc, '[data-rv-bind]').forEach(function (el) {
      var key = el.getAttribute('data-rv-bind'), value = factOf(ev, key, el.getAttribute('data-rv-bind-style') || '', cityApart);
      // a page's details are in its sections (what the server writes back is a section)
      if (value == null || !el.closest('[data-rv-section]')) return;
      w.watch(el);
      var hints = qsa(el, '[data-rv-bind-hint]');
      hints.forEach(function (n) { n.parentNode.removeChild(n); });
      report.written++;
      if (value !== '') {
        el.removeAttribute('data-rv-bind-empty');
        if (fill) fill.showSlot(el);
        setWords(el, value);
        return;
      }
      setWords(el, '');
      el.setAttribute('data-rv-bind-empty', '1');
      // shown in the editor with what to do about it; the published page hides it (rv-live.css)
      if (fill) fill.showSlot(el);
      if (opts.hint === true || (opts.hint === 'keep' && hints.length)) addHint(el, key);
    });
    report.sections = w.changed();
    if (typeof opts.retag === 'function') report.sections.forEach(function (sec) { try { opts.retag(sec); } catch (e) { /* the editor's own tagging */ } });
    return report;
  }

  /* ---------- a real template's record lists (template.json content.map) ---------- */
  var MAP_SOURCES = {
    speakers: ['speakers'],
    faq: ['faqs'],
    partners: ['partners', 'partner-tiers'],
    contact: ['contacts'],
    glimpses: ['gallery']
  };
  function idOf(r) { return r && r.id != null ? String(r.id) : ''; }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }
  /* in the words the four templates' list rules read; only the speakers and sponsors on the site (rv-records.js
     isOnSite) */
  var mapTranslate = {
    speakers: function (items) {
      return { items: RR.onSite('speakers', items || []).map(function (p) { return { id: idOf(p), n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '' }; }) };
    },
    faq: function (items) {
      return { items: (items || []).map(function (f) { return { id: idOf(f), t: f.question || '', d: f.answer || '' }; }) };
    },
    /* the caption too: the glimpses' rules print it ({caption}) */
    glimpses: function (items) {
      return { items: (items || []).map(function (g) { return { id: idOf(g), url: g.imageUrl || '', caption: g.caption || '' }; }) };
    },
    /* one block per label, in the order the labels first come, each with its people */
    contact: function (items) {
      var blocks = [], byLabel = {};
      (items || []).forEach(function (c) {
        var label = c.label || '';
        if (!byLabel[label]) { byLabel[label] = { t: label, people: [] }; blocks.push(byLabel[label]); }
        byLabel[label].people.push({ id: idOf(c), n: c.name || '', e: c.email || '', p: c.phone || '' });
      });
      return { blocks: blocks };
    },
    /* by tier, in the tiers' order; a sponsor with no tier (or no tiers set up at all) under a tier with no name,
       last — a sponsor in Content is never left out for want of a tier */
    partners: function (partners, tiers) {
      var slots = {}, ordered = [], fallback = { t: '', logos: [] };
      (tiers || []).slice().sort(byOrder).forEach(function (t) { var slot = { t: t.name || '', logos: [] }; slots[t.id] = slot; ordered.push(slot); });
      RR.onSite('partners', partners || []).slice().sort(byOrder).forEach(function (p) {
        (slots[p.tierId] || fallback).logos.push({ id: idOf(p), n: p.name || '', logo: p.logoUrl || '', url: p.url || '' });
      });
      if (fallback.logos.length) ordered.push(fallback);
      return { tiers: ordered.filter(function (t) { return t.logos.length; }) };
    }
  };
  function mapContent(rows) {
    var out = {};
    rows = rows || {};
    Object.keys(MAP_SOURCES).forEach(function (kind) {
      var own = rows[MAP_SOURCES[kind][0]];
      if (!Array.isArray(own)) return;                         // not read: left as it is
      var lists = MAP_SOURCES[kind].map(function (r) { return Array.isArray(rows[r]) ? rows[r] : []; });
      var value = mapTranslate[kind].apply(null, lists);
      value.waiting = own.length - RR.onSite(kind, own).length;
      out[kind] = value;
    });
    return out;
  }
  /* the entries of a content.map that list records: { from, kind, section, rules, emptyScope } */
  function mapEntries(map) {
    return (Array.isArray(map) ? map : []).filter(function (m) { return m && MAP_SOURCES[m.from] && m.section; }).map(function (m) {
      return { from: m.from, kind: m.from, section: m.section, emptyScope: m.emptyScope || '',
        rules: (m.fill || []).filter(function (r) { return r && r.list; }) };
    }).filter(function (m) { return m.rules.length; });
  }

  /* the menu's links to a section (in the top bar or the footer) go with it, and come back with it */
  function navLinks(doc, place, hide) {
    [place.getAttribute('id'), place.getAttribute('data-rv-section')].filter(function (id, i, a) { return id && a.indexOf(id) === i; }).forEach(function (id) {
      qsa(doc, 'a[href="#' + attrSel(id) + '"]').forEach(function (a) {
        if (a.hasAttribute('data-register-cta') || a.hasAttribute('data-rv-form') || !a.closest('[data-rv-section="nav"], [data-rv-section="footer"]')) return;
        if (hide) a.setAttribute('data-rv-nav-empty', ''); else a.removeAttribute('data-rv-nav-empty');
      });
    });
  }

  function drawMapLists(doc, map, content, opts) {
    opts = opts || {};
    var report = { filled: [], emptied: [], placed: [], sections: [] };
    if (!doc || !opts.fill || !content) return report;
    var w = watcher();
    function add(list, kind) { if (list.indexOf(kind) === -1) list.push(kind); }
    mapEntries(map).forEach(function (m) {
      var secs = qsa(doc, '[data-rv-section="' + attrSel(m.section) + '"]');
      if (!secs.length) return;
      add(report.placed, m.kind);
      if (!(m.kind in content)) return;
      secs.forEach(w.watch);
      qsa(doc, '[data-rv-section="nav"], [data-rv-section="footer"]').forEach(w.watch);
      var input = {};
      input[m.from] = content[m.kind];
      opts.fill.fill(doc, [{ from: m.from, section: m.section, fill: m.rules }], input, { data: true, avatar: opts.avatar || '' });
      var key = m.rules[0].key || m.rules[0].list;
      secs.forEach(function (sec) {
        var place = (m.emptyScope && (sec.matches(m.emptyScope) ? sec : sec.querySelector(m.emptyScope))) || sec;
        if (qsa(sec, '[data-rv-item="' + attrSel(m.from) + '"]').length) {
          if (place.getAttribute('data-rv-empty') === m.kind) { place.removeAttribute('data-rv-empty'); navLinks(doc, place, false); }
          qsa(sec, '[data-rv-empty-state="' + attrSel(m.kind) + '"]').forEach(function (n) { n.parentNode.removeChild(n); });
          add(report.filled, m.kind);
          return;
        }
        place.setAttribute('data-rv-empty', m.kind);
        if (place === sec) navLinks(doc, place, true);
        if (typeof opts.notice === 'function') {
          var list = sec.querySelector('[data-rv-list="' + attrSel(key) + '"]') || place;
          opts.notice(place, list, m.kind, +content[m.kind].waiting || 0);
        }
        add(report.emptied, m.kind);
      });
    });
    report.sections = w.changed();
    if (typeof opts.retag === 'function') report.sections.forEach(function (sec) { try { opts.retag(sec); } catch (e) { /* the editor's own tagging */ } });
    return report;
  }

  return {
    HINTS: HINTS, MAP_SOURCES: MAP_SOURCES,
    dateText: dateText, placeText: placeText, factOf: factOf, setWords: setWords,
    drawFacts: drawFacts, mapContent: mapContent, mapEntries: mapEntries, mapTranslate: mapTranslate, drawMapLists: drawMapLists
  };
});
