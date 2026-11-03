/* ETB2B AI's new pictures in the site editor: where a new picture may go, and putting it there.
   window.RevampAiPicture (ES5; loaded after editor-canvas.js and before editor-template-ui.js).

   The editor's chat can ask the server to make ONE new picture (POST /api/chat-edit, functions/lib/chat-picture.js).
   This file is the editor's half of that: what the AI is told about each section's pictures before it chooses,
   which element a new picture replaces once it arrives, and the swap itself. It says nothing about what the
   picture shows: the server writes the picture's prompt under the site's picture rules.

   WHY ONE FILE FOR BOTH HALVES. What the AI is told (describe) and what is changed when the picture comes back
   (target, place) must agree. If they were worked out in two places, the server could be told a banner takes a
   simple swap while the editor found nothing to swap, and the picture, already paid for, would land nowhere.

   WHAT A NEW PICTURE NEVER REPLACES (isProtected). The logo unit and its copy for a dark background (it is the
   previous edition's picture with the year changed, never redrawn); the ET logos and the nav's event logo; any
   picture with "logo" in its name or class; Content's own pictures — a speaker's headshot, a partner's logo, a
   juror's or winner's photo, a past edition's photo (a made-up picture must never pass for a real person or a
   real past event): the pictures inside Content's record markers, anywhere, and, in a section of records that
   carries no such markers (the previous edition's sections, an award's jury, an imported gallery or "Meet the
   Judges"), every picture there but one ETB2B AI made, since nothing else tells its records apart; any picture
   whose alt, label or caption reads as a person's name ("Dr Kiran Rao", "Anita Desai, CEO, Acme"), in any
   section; embedded forms; drawn icons (<svg>); and what the editor draws for itself (the banner video's still).
   A section of records keeps its other pictures free (its background, a picture ETB2B AI made for it, a
   decoration beside its records): those are not anyone's own, and the owner may ask for a new one there.

   h, the editor's helpers, passed to every call that reads the page:
     h.canvas      the mounted canvas (editor-canvas.js): backgroundHost, backgroundOf, setBackgroundPicture,
                   setPicture and win are used
     h.eventId     the event's id: pics.own lists only this event's own pictures, and place() puts in only a
                   picture stored under this event
     h.videoOn     true when the event's banner video plays (Design › Banner video). Or pass h.heroVideo, the
                   event's heroVideo as stored, and it is worked out the same way the canvas draws it. A video
                   the page itself holds (Create Event's banner video in a real template's .bnr-bg-video) counts
                   whatever these say

   RevampAiPicture.describe(sec, h) -> the fields sectionsContext sends for this section:
       { role: 'hero' | 'nav' | 'footer' | 'records' | '' ('records': it shows real people's, partners' or past
                   events' pictures from Content; those are never slots, and only its free pictures and its
                   background may change),
         video: true when this is the banner and a video plays over it,
         heroMode: 'dark' | 'light' | '' (the banner's own tone, read as its words are drawn, the rule of
                   rv-hero-video-core.js looksAt; '' for other sections or when it is not known),
         pics: { slots: how many pictures a new one may replace,
                 list: up to 6 of them in page order, each { label: its alt text or "picture k", w, h },
                 background: true when the section has a background picture that may be replaced,
                 heroTarget: for the banner, where its picture goes: 'background' | 'fullbleed' | 'veil' | '',
                 wide: true when its background's place (the background's element, else the section itself) is at
                      least WIDE_RATIO times as wide as it is tall: a new background there is made 16:9,
                 own: up to 4 of this event's own Storage pictures shown in it (the server counts people
                      pictures with them; they are never shown to the model) } }
   RevampAiPicture.slotOf(sec, el, h) -> el's 1-based number among those pictures (the chat's focus.slot), else 0
   RevampAiPicture.isProtected(el, sec) -> true when el must never get a made picture
   RevampAiPicture.chooseSlot(list, wanted) -> the index in list of the picture to replace, or -1.
       list: [{ area, protected }] in page order; wanted: a 1-based number counted over the entries that are not
       protected (the numbering of pics.list). Answers wanted when it is one of them, else the only one, else the
       largest when it is at least twice the next, else -1 (the AI should have asked which).
   RevampAiPicture.target(sec, newPicture, focusedEl, h) -> { el, how: 'background' | 'picture' | 'veil', veil,
       heroMode } or { none: why }. newPicture is the server's { placement, slot }; focusedEl is the picture the
       owner had selected, if any. why reads after "I could not put it in “X” — ". Used for a swap only: a
       section that is reworked with the picture goes through the section rewrite instead.
   RevampAiPicture.place(spot, url, alt, h) -> true when the picture was put in; false and nothing changed when the
       spot, the address or the element is not one it may use
   RevampAiPicture.heroVeilCss(mode) -> the veil functions/lib/gen-design.js heroCss lays over a banner picture
   RevampAiPicture.unitState(doc) -> a string that is the same exactly when every logo unit on the page is the same
       (its pictures, its copy for a dark background, its note, its tone and its words): taken before a change and
       compared after, so a change that touched the unit can be put back
   RevampAiPicture.recordsState(sec) -> a string that is the same exactly when the section's records from Content are
       the same (each one's pictures, names, roles and links); '' for a section that shows none. Taken before a
       rework that puts a new background into a section of records and again once its records are drawn, so a
       rework that changed a record is not kept */
(function (global) {
  'use strict';

  var MIN_W = 120, MIN_H = 90;      // smaller than this is an icon, a bullet or a thumbnail, not a section's picture
  var LIST_MAX = 6, OWN_MAX = 4, LABEL_MAX = 44, ALT_MAX = 150;
  var FULLBLEED = 0.5;              // an <img> covering half the banner or more is the banner's picture
  var WIDE_RATIO = 1.3;             // a place this much wider than tall takes a wide (16:9) picture (chat-picture.js)

  /* Never given a made picture, nor anything inside them. data-rv-bound and data-rv-auto are not here: they sit on a
     records section's own root, which may still get a background; its records' pictures are inside the item markers
     here ([data-rv-item], [data-rv-id], [data-rv-repeat-template]), and its other pictures may take a new one. */
  var KEEP = [
    '[data-rv-logo-unit]', '[data-rv-logo]', '[data-rv-etnav]', '[data-rv-et-footer]', '[data-rv-bind]',
    '[data-rv-repeat-template]', '[data-rv-id]', '[data-rv-item]', '[data-rv-form-embed]', '[data-rv-profile]',
    '[data-rv-editor]', '[data-ed="none"]'
  ].join(', ');
  /* A section that shows Content's own pictures of real people, partners or past events: speakers, leaders, jury,
     winners, partners, exhibitors, testimonials, past editions, the gallery. Records without pictures (FAQ, agenda,
     contacts) do not make a section one: their items are kept by KEEP, the rest of the section may change.
     The people words after "previous edition" are there for sections with no record markers at all (an imported
     site's "Meet the Judges", a hand-built "Advisory Board"): their name is all that says they show real people. */
  var RECORDS_WORDS = new RegExp('glimpse|gallery|moments|speaker|partner|sponsor|exhibitor|jury|winner|awardee|nominee|testimonial|\\bleaders\\b|' +
    'previous edition|past edition|last edition|' +
    '\\bjudges?\\b|\\bpanel(?:s|l?ists?)?\\b|\\bkeynotes?\\b|\\bchief guests?\\b|\\bguests? of hono(?:u)?r\\b|\\badvis(?:ory|ors?|ers?)\\b|' +
    '\\bboards?\\b|\\bcouncils?\\b|\\bcommittees?\\b|\\bmentors?\\b|\\bfaculty\\b|\\bhosts?\\b(?! (?:city|venue|country|state|nation))|' +
    '\\bteams?\\b|\\bfounders?\\b|\\bmoderators?\\b|\\bemcees?\\b', 'i');
  /* A picture whose alt text (or label, title or caption) reads as a person's name is a real person's photo, whatever
     its section is called: "Dr Kiran Rao", "Anita Desai, CEO, Acme", "Priya Nair". A name is one to four capitalised
     words, or one or more after an honorific, before any title or company that follows. Words that name places,
     things and events ("Mumbai Skyline", "Smart Factories", "The Grand Hall") are not names. Erring towards a name
     only means ETB2B AI leaves that picture alone and says so; erring the other way would put a made-up picture
     where a real person's photo was. */
  /* (not "Sri": "Sri Lanka" is a place; not "Gen", "Col" or "Hon": "Gen AI", "Gen Next") */
  var HONORIFIC = /^(?:mr|mrs|ms|mx|miss|dr|shri|smt|kumari|prof|professor|sir|dame|justice)\.?$/i;
  var HONORIFIC_IN = /(?:^|[\s(])(?:Mr|Mrs|Ms|Mx|Dr|Shri|Smt|Prof)\.?\s+[A-Z][a-z\u00DF-\u00FF'\u2019-]+/;
  /* a capital, then a small letter (or an apostrophe and a capital: D'Souza); "CMOs" and "IIT" are not names */
  var NAME_WORD = /^[A-Z\u00C0-\u00DE](?:[a-z\u00DF-\u00FF]|['\u2019][A-Z\u00C0-\u00DE])[A-Za-z\u00C0-\u00FF'\u2019-]*[a-z\u00DF-\u00FF]\.?$/;
  var NAME_END = /\s*(?:[,|:;\/()[\]\u2022\u00B7\u2013\u2014]|\s-\s)\s*/;
  var DEED_WORD = /^(?:speaking|speaks|addressing|addresses|delivering|delivers|presenting|presents|receiving|receives|accepting|accepts|moderating|moderates|interviewing|interviewed|honoured|honored|felicitated)$/;
  var TITLE_WORD = /^(?:ceo|cto|cfo|coo|cmo|cio|ciso|chro|cdo|cpo|cxo|md|vp|svp|evp|avp|gm|founder|co-?founder|director|chair(?:man|woman|person)?|president|head|partner|manager|officer|secretary|minister|dean|principal|editor|chief|executive|ambassador|commissioner|ias|ips)\.?,?$/i;
  var NOT_NAME = new RegExp('^(?:the|a|an|of|and|at|in|on|for|with|by|to|from|our|your|my|their|this|that|its|' +
    'hall|room|stage|skyline|city|centre|center|hotel|venue|summit|conference|conclave|forum|expo|exhibition|awards?|events?|' +
    'night|day|days|morning|evening|session|sessions|view|views|building|tower|office|campus|park|garden|lobby|lounge|' +
    'auditorium|convention|complex|bridge|road|street|sea|beach|gate|fort|palace|market|station|airport|lake|river|hills?|' +
    'mountains?|sunset|sunrise|dusk|dawn|photo|image|picture|banner|background|hero|icon|illustration|graphic|logo|group|' +
    'delegates|audience|crowd|people|networking|lunch|dinner|breakfast|coffee|tea|break|welcome|registration|booth|stall|' +
    'agenda|speakers?|sponsors?|partners?|glimpses?|gallery|moments|highlights|edition|ceremony|celebration|trophy|' +
    'india|mumbai|new|delhi|bengaluru|bangalore|chennai|kolkata|hyderabad|pune|gurugram|gurgaon|noida|goa|jaipur|' +
    'ahmedabad|kochi|singapore|dubai|london|world|global|national|international|digital|technology|tech|future|' +
    'innovation|leadership|business|panel|keynote|fireside|chat|discussion|workshop|masterclass|roundtable|team|map|' +
    'location|tickets?|pass|food|music|show|performance|lights?|screen|display|robots?|data|cloud|factory|factories|' +
    'workplace|workspace|home|house|smart|green|energy|retail|store|shop|next|gen|leaders?|stories|story|voices|insights|' +
    'growth|strategy|transformation|experience|customer|brand|marketing|finance|health|healthcare|education|' +
    'manufacturing|auto|mobility|startups?|women|youth|power|impact|vision|mission|journey|edge|labs?|hub|studio|' +
    'zone|arena|plaza|square|mall|court|terrace|deck|floor|wing|block|sector|phase|marine|drive|pavilion|sri|lanka|' +
    'two|three|four|five|indian|grand|ballroom|hyatt|marriott|taj|oberoi|leela|westin|sheraton|hilton|novotel|' +
    'radisson|ritz|sofitel|trident|vivanta|jio|nesco|bkc)$', 'i');
  var RECORDS_MARKS = ['data-rv-repeat-template', 'data-rv-item', 'data-rv-bound', 'data-rv-auto', 'data-rv-list'];
  var NAV_TYPES = /^(nav|navbar|navigation|header|top-?bar)$/;
  var HERO_TYPES = /^(hero|banner)$/;

  /* the veils of functions/lib/gen-design.js heroCss for a banner with a picture: strongest behind the words in the
     middle, lighter towards the edges (ai-picture-client.test.js checks they are the same strings) */
  var VEIL = {
    dark: 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(8,10,16,.8) 0%, rgba(8,10,16,.58) 62%, rgba(8,10,16,.36) 100%)',
    light: 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(255,255,255,.9) 0%, rgba(255,255,255,.66) 62%, rgba(255,255,255,.38) 100%)'
  };
  function heroVeilCss(mode) { return mode === 'dark' ? VEIL.dark : VEIL.light; }

  /* ---------- small DOM helpers (the canvas is a same-origin iframe; nothing here assumes this window's DOM) ---------- */
  function each(list, fn) { for (var i = 0; i < (list ? list.length : 0); i++) fn(list[i], i); }
  function tagOf(el) { return String((el && el.tagName) || '').toUpperCase(); }
  function hasClass(el, c) { return !!(el && el.classList && el.classList.contains(c)); }
  function attr(el, name) { return (el && el.getAttribute && el.getAttribute(name)) || ''; }
  function matches(el, sel) { try { return !!(el && el.matches && el.matches(sel)); } catch (e) { return false; } }
  function connected(el) {
    if (!el) return false;
    if (typeof el.isConnected === 'boolean') return el.isConnected;
    var d = el.ownerDocument;
    return !!(d && d.documentElement && d.documentElement.contains(el));
  }
  // el or one of its ancestors up to and including sec matches sel (the page around the section is not looked at)
  function within(el, sec, sel) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (matches(n, sel)) return true;
      if (n === sec) return false;
    }
    return false;
  }
  function inSvg(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) if (tagOf(n) === 'SVG') return true;
    return false;
  }
  function sectionOf(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('data-rv-section')) return n;
    return null;
  }
  function winOf(el, h) { return (h && h.canvas && h.canvas.win) || (el && el.ownerDocument && el.ownerDocument.defaultView) || null; }
  function boxOf(el) {
    try { var r = el.getBoundingClientRect(); return { w: r.width || 0, h: r.height || 0 }; } catch (e) { return { w: 0, h: 0 }; }
  }
  function visible(el, h) {
    var win = winOf(el, h);
    if (!win || !win.getComputedStyle) return true;
    try {
      var cs = win.getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch (e) { return true; }
  }
  function words(s) {
    return String(s || '').replace(/[^0-9A-Za-z\u00C0-\u024F\u0900-\u097F]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------- what a section is ---------- */
  function typeOf(sec) { return String(attr(sec, 'data-rv-section')).toLowerCase(); }
  function isNavSection(sec) {
    var tag = tagOf(sec);
    return NAV_TYPES.test(typeOf(sec)) || sec.hasAttribute('data-rv-etnav') || attr(sec, 'data-rv-locked') === 'header' ||
      tag === 'NAV' || tag === 'HEADER';
  }
  function isFooterSection(sec) {
    return typeOf(sec) === 'footer' || tagOf(sec) === 'FOOTER' || sec.hasAttribute('data-rv-et-footer');
  }
  function namedHero(sec) {
    return HERO_TYPES.test(typeOf(sec)) || hasClass(sec, 'hero-root') || sec.id === 'hero' || sec.id === 'banner';
  }
  // the first section after the navigation, when it carries the event's logo unit or logo: the banner, whatever its name
  function heroByPlace(sec) {
    var doc = sec.ownerDocument, list = doc ? doc.querySelectorAll('[data-rv-section]') : [], first = null;
    for (var i = 0; i < list.length; i++) if (!isNavSection(list[i])) { first = list[i]; break; }
    return first === sec && !!sec.querySelector('[data-rv-logo-unit], [data-rv-bind="event.logo"]');
  }
  /* ---------- real people's photos ---------- */
  /* every word a name's: capitalised words (and initials) with nothing that names a place or a thing among them.
     A bare "A" or "I" in front is a word ("A corridor"), not an initial. */
  function nameWords(w, honorific) {
    var full = 0, dotted = 0;
    if (!w.length || w.length > 4) return false;
    for (var j = 0; j < w.length; j++) {
      var x = w[j];
      if (/^[A-Z]\.?$/.test(x) && (honorific || j > 0 || /\.$/.test(x) || !/^[AI]$/.test(x))) { if (/\.$/.test(x)) dotted++; continue; }
      if (NOT_NAME.test(x.replace(/[.'\u2019]+$/, ''))) return false;
      if (!NAME_WORD.test(x)) return false;
      full++;
    }
    return honorific ? full >= 1 : full >= 2 || (full === 1 && dotted >= 1);
  }
  function readsAsName(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 160) return false;
    // "Portrait of Dr Kiran Rao": an honorific and a capitalised word, anywhere
    if (HONORIFIC_IN.test(t)) return true;
    /* the name is what comes before a comma, a bar, a bracket or a dash ("Anita Desai, CEO, Acme"), or what
       follows a one-word label ("Keynote: Dr Kiran Rao", "Speaker - Priya Nair") */
    var parts = t.split(NAME_END), heads = [parts[0]];
    if (parts.length > 1 && parts[0].split(' ').length === 1) heads.push(parts[1]);
    for (var k = 0; k < heads.length; k++) {
      var w = String(heads[k] || '').split(' '), honorific = false;
      if (w.length > 1 && HONORIFIC.test(w[0])) { honorific = true; w = w.slice(1); }
      // "Anita Desai CEO Acme", "Priya Nair speaking at the summit": the name stops at the title or the deed
      for (var i = 1; i < w.length; i++) if (TITLE_WORD.test(w[i]) || DEED_WORD.test(w[i])) { w = w.slice(0, i); break; }
      if (nameWords(w, honorific)) return true;
    }
    return false;
  }
  // a picture Oneworld's AI made (the site's or the chat's, all under an event's generated/): never a real person's photo
  var MADE_PICTURE = /^https:\/\/storage\.googleapis\.com\/[^\/?#]+\/events\/[^\/?#]+\/generated\//;
  /* what names a picture: its alt, label or title (an image box's own <img> too), and its <figure>'s caption. A
     picture the AI made keeps its alt as written ("Two Indian CMOs exchanging cards") and is never a real person. */
  function personPicture(el, sec) {
    if (!el || el.nodeType !== 1) return false;
    var texts = [attr(el, 'alt'), attr(el, 'aria-label'), attr(el, 'title')];
    var inner = tagOf(el) !== 'IMG' && el.querySelector ? el.querySelector('img') : null;
    if (MADE_PICTURE.test(attr(inner || el, 'src'))) return false;
    if (inner) texts.push(attr(inner, 'alt'), attr(inner, 'title'));
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (tagOf(n) === 'FIGURE') { var cap = n.querySelector('figcaption'); if (cap) texts.push(cap.textContent); break; }
      if (n === sec) break;
    }
    for (var i = 0; i < texts.length; i++) if (readsAsName(texts[i])) return true;
    return false;
  }
  /* the logos and what the editor draws carry the event's or ET's name, never a person's */
  var NOT_A_PHOTO = '[data-rv-logo-unit], [data-rv-logo], [data-rv-et-logo], [data-rv-etnav], [data-rv-et-footer], [data-rv-editor], [data-ed="none"]';
  /* A section whose pictures are all named people's photos is a people section, whatever it is called ("Our
     voices"): it is records, so the AI offers it a background, never a reworked section built around a made-up
     picture, and the server knows the names in it are real people's. A named photo beside other pictures is kept
     on its own (protectedIn), and the others stay free: one Title Case alt that only looks like a name does not
     lock a whole section. */
  function peopleOnly(sec) {
    var found = sec.querySelectorAll('img, [data-editable="image"], [role="img"]'), seen = [], named = 0, other = 0;
    for (var i = 0; i < found.length; i++) {
      var el = found[i], inside = false;
      for (var k = 0; k < seen.length; k++) if (seen[k].contains(el)) { inside = true; break; }
      if (inside || inSvg(el) || within(el, sec, NOT_A_PHOTO) || (tagOf(el) === 'IMG' && isLogoImg(el))) continue;
      seen.push(el);
      if (personPicture(el, sec)) { named++; continue; }
      // a picture a new one could take the place of: shown, at a useful size, not one kept for other reasons
      var b = boxOf(el);
      if (b.w >= MIN_W && b.h >= MIN_H && visible(el, null) && !within(el, sec, KEEP)) other++;
    }
    return named > 0 && other === 0;
  }
  /* Records by what the section is called, by Content's markers, or by its pictures all being people's photos: an
     imported or hand-built people section has no markers, and its name may not say so. */
  function isRecords(sec) {
    if (/^previous-/.test(typeOf(sec)) || RECORDS_WORDS.test(typeOf(sec).replace(/[-_]+/g, ' ')) || RECORDS_WORDS.test(attr(sec, 'data-sec-name'))) return true;
    for (var i = 0; i < RECORDS_MARKS.length; i++) {
      var name = RECORDS_MARKS[i];
      if (RECORDS_WORDS.test(attr(sec, name))) return true;
      var found = sec.querySelectorAll('[' + name + ']');
      for (var j = 0; j < found.length; j++) if (RECORDS_WORDS.test(attr(found[j], name))) return true;
    }
    return peopleOnly(sec);
  }
  /* The banner is decided before the navigation so a <header> that is the banner stays one; the navigation before
     the banner-by-place rule, since the nav also carries the event's logo. */
  function roleOf(sec) {
    if (!sec) return '';
    if (namedHero(sec)) return 'hero';
    if (isNavSection(sec)) return 'nav';
    if (isFooterSection(sec)) return 'footer';
    if (heroByPlace(sec)) return 'hero';
    if (isRecords(sec)) return 'records';
    return '';
  }
  /* ---------- the banner's tone ---------- */
  // '#rgb', '#rrggbb', 'rgb(…)' and 'rgba(…)' (what a stylesheet and getComputedStyle give), as rv-hero-video-core.js reads them
  function parseColour(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase(), m;
    if ((m = /^#([0-9a-f]{3})$/.exec(s))) s = '#' + m[1].replace(/./g, function (c) { return c + c; });
    if ((m = /^#([0-9a-f]{6})$/.exec(s))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
    if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s))) {
      var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1], g: +m[2], b: +m[3], a: isNaN(a) ? 1 : a };
    }
    return null;
  }
  function lum(c) {
    function ch(v) { v = Math.min(255, Math.max(0, v)) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  // dark words sit on a light banner, light words on a dark one (rv-hero-video-core.js heroTone's threshold)
  function toneOfInk(c) { return c && c.a > 0 ? (lum(c) < 0.5 ? 'light' : 'dark') : ''; }
  /* the colour the banner's own stylesheet (<style data-rv-style="hero">) gives its headline, else the banner itself:
     rv-hero-video-core.js heroTone's first step, read from the canvas instead of from the page's text */
  function sheetInk(sec) {
    var doc = sec.ownerDocument, type = typeOf(sec) || 'hero', sheet = null;
    try { sheet = doc && doc.querySelector('style[data-rv-style="' + type.replace(/["\\]/g, '\\$&') + '"]'); } catch (e) { sheet = null; }
    if (!sheet) return null;
    var found = { tagline: null, root: null }, rule, re = /([^{}]+)\{([^{}]*)\}/g, css = String(sheet.textContent || '');
    while ((rule = re.exec(css))) {
      var decl = /(?:^|;)\s*color\s*:\s*([^;!]+)/i.exec(rule[2]), c = decl && parseColour(decl[1].trim());
      if (!c) continue;
      var sels = rule[1].split(',');
      for (var i = 0; i < sels.length; i++) {
        if (/\.hero-tagline\s*$/.test(sels[i])) { found.tagline = c; break; }
        if (/\.hero-root\s*$/.test(sels[i])) found.root = c;
      }
    }
    return found.tagline || found.root;
  }
  /* The banner's tone is what its words ARE, the rule the editor already keeps for the banner video's overlay
     (rv-hero-video-core.js looksAt / heroTone): an AI edit can restyle the words while the hero-on-* class stays
     (BWS: dark words on a white veil in a hero still classed hero-on-dark), and a veil or a picture of the wrong
     tone would make the words and the logo unit unreadable. In order: the colour the headline is drawn in on the
     canvas, the colour the banner's own stylesheet gives it, the tone its logo unit was drawn for, its hero-on-*
     class. '' when none of them says. */
  function heroModeOf(sec, h) {
    var tagline = sec.querySelector('.hero-tagline'), tone = '';
    if (tagline) {
      var win = winOf(sec, h);
      try { tone = win && win.getComputedStyle ? toneOfInk(parseColour(win.getComputedStyle(tagline).color)) : ''; } catch (e) { tone = ''; }
    }
    if (!tone && (tagline || hasClass(sec, 'hero-root') || sec.querySelector('.hero-root'))) tone = toneOfInk(sheetInk(sec));
    if (tone) return tone;
    var unit = sec.querySelector('.rv-lu-on-dark, .rv-lu-on-light');
    if (unit) return hasClass(unit, 'rv-lu-on-light') ? 'light' : 'dark';
    if (hasClass(sec, 'hero-on-dark') || sec.querySelector('.hero-on-dark')) return 'dark';
    if (hasClass(sec, 'hero-on-light') || sec.querySelector('.hero-on-light')) return 'light';
    return '';
  }

  /* ---------- the banner's video ---------- */
  /* The page's own banner video: the one Create Event gives a real template's banner (editor-fill.js fillBgVideo
     writes <video data-rv-video data-src> into .bnr-bg-video; on the site et-banner/script.js loads it and
     et-platform.css fades it in over the picture on screens 768px and wider), or the served layer of Design ›
     Banner video. A layer with no address in it plays nothing. */
  var VIDEO_LAYER = '.bnr-bg-video, [data-rv-media="bg-video"], [data-rv-hero-video]';
  function pageVideoIn(sec) {
    var vids = sec.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (within(v, sec, '[data-rv-editor]')) continue;                 // the editor's own drawing is counted below
      if (!(within(v, sec, VIDEO_LAYER) || v.hasAttribute('data-rv-video') || v.hasAttribute('data-rv-bg-video'))) continue;
      var src = attr(v, 'data-src') || attr(v, 'data-rv-src') || attr(v, 'src');
      if (!src) { var s = v.querySelector('source[src]'); src = s ? attr(s, 'src') : ''; }
      if (/\S/.test(src)) return true;
    }
    return false;
  }
  function heroVideoOn(sec, h) {
    if (sec.querySelector('[data-rv-hv-preview]')) return true;          // the canvas draws the video's still while it plays
    if (pageVideoIn(sec)) return true;                                   // the page's own (Create Event's banner video)
    if (typeof h.videoOn === 'boolean') return h.videoOn;
    var hv = h.heroVideo;
    if (!hv || typeof hv !== 'object') return false;
    var core = global.RevampHeroVideoCore;
    if (core && core.clean) { try { return !!core.clean(hv); } catch (e) { return false; } }
    return hv.enabled !== false && /^https:\/\//i.test(String(hv.url || ''));
  }

  /* ---------- which pictures ---------- */
  function isPictureEl(el) {
    var tag = tagOf(el);
    return tag === 'IMG' || tag === 'PICTURE' || tag === 'SVG' || attr(el, 'data-editable') === 'image' || inSvg(el);
  }
  function isLogoImg(el) {
    var src = attr(el, 'src');
    if (/\/templates\/_shared\//.test(src)) return true;                 // ET's own logos ship with the templates
    var file = src.split(/[?#]/)[0];
    return /logo/i.test(attr(el, 'class') + ' ' + el.id + ' ' + attr(el, 'alt') + ' ' + file);
  }
  /* Content's item markers: where a section carries them, they say which of its pictures are its records */
  var ITEM_MARKS = '[data-rv-repeat-template], [data-rv-item], [data-rv-id], [data-rv-list]';
  function hasItemMarks(sec) { return !!sec && (matches(sec, ITEM_MARKS) || !!sec.querySelector(ITEM_MARKS)); }
  // the address of what a picture shows: an <img>'s, the <img> in a picture box, else the box's own background
  function shownSrc(el) {
    var img = tagOf(el) === 'IMG' ? el : el.querySelector ? el.querySelector('img') : null;
    if (img) return attr(img, 'src');
    var m = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(String((el.style && el.style.backgroundImage) || ''));
    return m ? m[2] : '';
  }
  /* A picture of a records section that is one of its records. Where Content's item markers are there, its records'
     pictures are inside them (KEEP holds those), and a picture beside them is not anyone's own. A section of
     records without them — the previous edition's (prev-sections.js), an award's jury (award-sections.js), an
     imported gallery or "Meet the Judges" — has nothing that tells a record from a decoration, so each of its
     pictures is taken for a record, except one ETB2B AI made: that is never a real person or a real past event. */
  function recordPicture(el, sec) {
    if (hasItemMarks(sec)) return false;
    return !MADE_PICTURE.test(shownSrc(el));
  }
  function protectedIn(el, sec, role) {
    if (!el || el.nodeType !== 1) return true;
    if (tagOf(el) === 'SVG' || inSvg(el)) return true;                   // an icon keeps its drawing
    if (within(el, sec, KEEP)) return true;
    if (tagOf(el) === 'IMG' && isLogoImg(el)) return true;
    var picture = isPictureEl(el) || attr(el, 'role') === 'img';         // a box drawn as a picture (role="img") counts
    if (role === 'records' && picture && recordPicture(el, sec)) return true;
    // a real person's photo, in any section (the banner and a records section's free places too)
    if (picture && personPicture(el, sec)) return true;
    return false;
  }
  function isProtected(el, sec) {
    sec = sec || sectionOf(el);
    return protectedIn(el, sec, roleOf(sec));
  }
  /* One look at a section. Measuring pictures and finding the background picture read the page's layout, so each is
     done once per call and shared by everything that call works out. */
  function look(sec, h) {
    var c = h.canvas;
    return { sec: sec, h: h, role: roleOf(sec), _pics: null, _raw: undefined,
      raw: function () {                                         // editor-canvas.js backgroundHost, as it is
        if (this._raw === undefined) this._raw = c && c.backgroundHost ? c.backgroundHost(sec) || null : null;
        return this._raw;
      } };
  }
  /* Every picture of the section a visitor sees at a useful size, in page order, each marked protected or not.
     A box marked as an image that holds an <img> is one picture, not two. */
  function candidates(L) {
    if (L._pics) return L._pics;
    var out = [];
    each(L.sec.querySelectorAll('img, [data-editable="image"]'), function (el) {
      for (var i = 0; i < out.length; i++) if (out[i].el.contains(el)) return;
      var b = boxOf(el);
      if (b.w < MIN_W || b.h < MIN_H || !visible(el, L.h)) return;
      out.push({ el: el, w: b.w, h: b.h, area: b.w * b.h, protected: protectedIn(el, L.sec, L.role) });
    });
    L._pics = out;
    return out;
  }
  function usable(list) {
    var out = [];
    each(list, function (c) { if (!c.protected) out.push(c); });
    return out;
  }
  function slotNumber(v) {
    var n = +v;
    return n >= 1 && Math.floor(n) === n ? n : 0;
  }
  function chooseSlot(list, wanted) {
    var free = [];
    each(list || [], function (c, i) { if (c && !c.protected) free.push(i); });
    var n = slotNumber(wanted);
    if (n && n <= free.length) return free[n - 1];
    if (free.length === 1) return free[0];
    if (!free.length) return -1;
    var bySize = free.slice().sort(function (a, b) { return (+list[b].area || 0) - (+list[a].area || 0); });
    return (+list[bySize[0]].area || 0) >= 2 * (+list[bySize[1]].area || 0) ? bySize[0] : -1;
  }
  /* how the AI is shown one picture, so the owner's words ("the one of the hall", "the big one") can name it:
     its alt text in plain words (page text, so the server cleans it again), else "picture k", and its size */
  function entryOf(c, i) {
    var t = words(attr(c.el, 'alt') || attr(c.el, 'aria-label') || attr(c.el, 'title')).slice(0, LABEL_MAX).trim();
    return { label: t || 'picture ' + (i + 1), w: Math.round(c.w), h: Math.round(c.h) };
  }
  function slotOf(sec, el, h) {
    if (!sec || !el) return 0;
    var free = usable(candidates(look(sec, h || {})));
    for (var i = 0; i < free.length; i++) if (free[i].el === el || free[i].el.contains(el)) return i + 1;
    return 0;
  }

  // the element carrying the section's background picture, when it may be replaced
  function hostOf(L) {
    var host = L.raw();
    return host && !protectedIn(host, L.sec, L.role) ? host : null;
  }
  /* the banner's largest <img> covering half of it or more (a kept one too; the editor's own drawing left out) */
  function fullBleed(L) {
    var whole = boxOf(L.sec), area = whole.w * whole.h, best = null;
    if (!area) return null;
    each(candidates(L), function (c) {
      if (tagOf(c.el) !== 'IMG' || c.area < area * FULLBLEED || within(c.el, L.sec, '[data-rv-editor], [data-ed="none"]')) return;
      if (!best || c.area > best.area || (c.area === best.area && best.protected && !c.protected)) best = c;
    });
    return best;
  }
  /* Where the banner's picture is. A full-bleed <img> is painted over its own section's CSS background, so when the
     background sits on the section (or on anything around the <img>) the <img> is what visitors see. When that <img>
     is one never replaced (a named person's photo, a logo, a bound picture), there is no place: a picture put under
     it would be paid for and never seen. A generated banner without a picture still has its veil: the picture goes
     on .hero-root and the veil is laid over it. */
  function heroSpot(L) {
    var sec = L.sec, host = hostOf(L), big = fullBleed(L), full = big ? big.el : null;
    var onTop = !!full && (!host || host === full || host.contains(full));
    if (onTop && big.protected) return { kind: '', el: null };
    if (onTop) return { kind: 'fullbleed', el: full };
    if (host) return { kind: 'background', el: host };
    var root = hasClass(sec, 'hero-root') ? sec : sec.querySelector('.hero-root');
    var veil = root ? root.querySelector('.hero-veil') : null;
    if (root && veil && !protectedIn(root, sec, L.role) && !within(veil, sec, KEEP)) return { kind: 'veil', el: root, veil: veil };
    return { kind: '', el: null };
  }

  /* this event's own pictures in the section, the generated ones first: only those can be people pictures the
     server counts (designPlan's section pictures and the chat's own are all under generated/) */
  function ownPictures(L) {
    var h = L.h, sec = L.sec;
    if (!h.eventId) return [];
    var own = new RegExp('^https://storage\\.googleapis\\.com/[^/?#]+/events/' + escRe(h.eventId) + '/');
    var found = [];
    function add(u) {
      u = String(u || '').trim();
      if (own.test(u) && found.indexOf(u) === -1) found.push(u);
    }
    function fromCss(v) {
      var re = /url\(\s*(["']?)(.*?)\1\s*\)/g, m;
      while ((m = re.exec(String(v || '')))) add(m[2]);
    }
    var host = L.raw();
    if (host && h.canvas.backgroundOf) add(h.canvas.backgroundOf(host));
    each([sec].concat(Array.prototype.slice.call(sec.querySelectorAll('[style]'))), function (el) { if (el.style) fromCss(el.style.backgroundImage); });
    each(sec.querySelectorAll('img'), function (img) { add(attr(img, 'src')); });
    var gen = [], rest = [];
    each(found, function (u) { (/\/generated\//.test(u) ? gen : rest).push(u); });
    return gen.concat(rest).slice(0, OWN_MAX);
  }

  function describe(sec, h) {
    h = h || {};
    var out = { role: roleOf(sec), video: false, heroMode: '', pics: { slots: 0, list: [], background: false, heroTarget: '', wide: false, own: [] } };
    if (!sec || out.role === 'nav' || out.role === 'footer') return out;      // nothing there is offered for a new picture
    var L = look(sec, h), free = usable(candidates(L));
    out.pics.slots = free.length;
    out.pics.list = free.slice(0, LIST_MAX).map(entryOf);
    out.pics.background = !!hostOf(L);
    /* the shape a new background would fill: the background's own element, or the section a rework would put it on */
    var box = boxOf(hostOf(L) || sec);
    out.pics.wide = box.w > 0 && box.h > 0 && box.w >= WIDE_RATIO * box.h;
    if (L.role === 'hero') {
      out.video = heroVideoOn(sec, h);
      out.heroMode = heroModeOf(sec, h);
      out.pics.heroTarget = heroSpot(L).kind;
    }
    out.pics.own = ownPictures(L);
    return out;
  }

  /* ---------- where the picture that came back goes ---------- */
  var KEPT_PICTURE = 'the picture you selected is a logo, a named person\'s photo or one of Content\'s own pictures, which I never replace';
  var RECORDS_ONLY = 'its pictures are Content\'s own (speakers, partners or a past edition)';
  function target(sec, np, focusedEl, h) {
    h = h || {}; np = np || {};
    if (!sec || !connected(sec)) return { none: 'the section is no longer on the page' };
    var L = look(sec, h), role = L.role;
    if (role === 'nav' || role === 'footer') return { none: 'the top bar and the footer take no new pictures' };
    if (role === 'hero') {
      if (heroVideoOn(sec, h)) return { none: 'the banner plays a video, so a new picture there would not be seen' };
      var spot = heroSpot(L), mode = heroModeOf(sec, h);
      if (spot.kind === 'background') return { el: spot.el, how: 'background', heroMode: mode };
      if (spot.kind === 'fullbleed') return { el: spot.el, how: 'picture', heroMode: mode };
      if (spot.kind === 'veil') return { el: spot.el, veil: spot.veil, how: 'veil', heroMode: mode };
      return { none: 'the banner has no place for a picture of this kind' };
    }
    if (np.placement === 'hero') return { none: 'it is not the banner' };
    if (np.placement === 'background') {
      var host = hostOf(L);
      return host ? { el: host, how: 'background' } : { none: 'it has no background picture to replace' };
    }
    if (np.placement !== 'picture') return { none: 'where it should go was not clear' };
    var list = candidates(L), free = usable(list), n = slotNumber(np.slot);
    if (tagOf(focusedEl) === 'PICTURE') focusedEl = focusedEl.querySelector('img') || focusedEl;
    var focused = focusedEl && focusedEl !== sec && connected(focusedEl) && sec.contains(focusedEl) && isPictureEl(focusedEl) ? focusedEl : null;
    function kept(el) {
      for (var i = 0; i < list.length; i++) if (list[i].el === el || list[i].el.contains(el)) return list[i].protected;
      return protectedIn(el, sec, role);
    }
    /* A records section takes a new picture only in a free place, and never while the owner has one of its records
       selected: "replace this photo" with a speaker's headshot selected would otherwise land on the free picture
       beside it. chat-picture.js planAsk refuses both before anything is paid for; this is the same answer here. */
    if (role === 'records') {
      if (!free.length) return { none: RECORDS_ONLY };
      if (focused && kept(focused)) return { none: KEPT_PICTURE };
    }
    // the picture the owner's words named wins over one selected earlier, and the selection over a guess
    if (n && n <= free.length) return { el: list[chooseSlot(list, n)].el, how: 'picture' };
    if (focused) {
      if (kept(focused)) return { none: KEPT_PICTURE };
      for (var i = 0; i < list.length; i++) if (list[i].el === focused || list[i].el.contains(focused)) return { el: list[i].el, how: 'picture' };
      /* smaller than a slot, or out of sight: still the one the owner chose; never another picture in its place */
      var b = boxOf(focused);
      return b.w > 0 && b.h > 0 ? { el: focused, how: 'picture' } : { none: 'the picture you selected is not shown on the page' };
    }
    var pick = chooseSlot(list, 0);
    if (pick < 0) return { none: free.length ? 'it has several pictures and which one was not said' : 'it has no picture to replace' };
    return { el: list[pick].el, how: 'picture' };
  }

  /* a picture address that can sit in a url() and an src as it is: https, and nothing that could end the url()
     early or start markup. The editor checks it is this event's new picture before it gets here; this is the
     last line, so a bad address changes nothing. */
  function usableUrl(url, h) {
    url = String(url || '');
    if (!/^https:\/\/[^\s"'()<>\\]+$/.test(url)) return false;
    if (h.eventId && !new RegExp('^https://storage\\.googleapis\\.com/[^/?#]+/events/' + escRe(h.eventId) + '/').test(url)) return false;
    return true;
  }
  function cleanAlt(alt) {
    return String(alt || '').replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ').replace(/[\u0000-\u001f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX).trim();
  }
  function place(spot, url, alt, h) {
    h = h || {};
    var c = h.canvas;
    if (!spot || !spot.el || !c || !usableUrl(url, h) || !connected(spot.el)) return false;
    var el = spot.el, sec = sectionOf(el), role = roleOf(sec);
    if (spot.how === 'background') {
      // a background belongs to a box, never to a picture or an icon
      if (within(el, sec, KEEP) || isPictureEl(el) || !c.setBackgroundPicture) return false;
      c.setBackgroundPicture(el, url);
      return true;
    }
    if (spot.how === 'picture') {
      if (protectedIn(el, sec, role) || !(tagOf(el) === 'IMG' || attr(el, 'data-editable') === 'image') || !c.setPicture) return false;
      c.setPicture(el, url);
      // a <picture>'s sources would be shown instead of the new src
      var holder = el.parentElement;
      if (tagOf(el) === 'IMG' && tagOf(holder) === 'PICTURE') {
        each(Array.prototype.slice.call(holder.querySelectorAll('source')), function (s) { s.parentNode.removeChild(s); });
      }
      var text = cleanAlt(alt);
      if (tagOf(el) === 'IMG') el.setAttribute('alt', text);
      else if (attr(el, 'role') === 'img') el.setAttribute('aria-label', text);
      return true;
    }
    if (spot.how === 'veil') {
      var veil = spot.veil;
      if (!veil || !el.contains(veil) || protectedIn(el, sec, role) || within(veil, sec, KEEP)) return false;
      el.style.backgroundImage = 'url("' + url + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      veil.style.background = heroVeilCss(spot.heroMode || heroModeOf(sec, h));
      return true;
    }
    return false;
  }

  /* ---------- the logo unit, before and after ---------- */
  function unitState(doc) {
    if (!doc || !doc.querySelectorAll) return '';
    var units = [];
    each(doc.querySelectorAll('[data-rv-logo-unit]'), function (u) {
      var pics = [];
      each(u.querySelectorAll('img'), function (img) { pics.push((hasClass(img, 'rv-lu-dark') ? 'dark=' : '') + attr(img, 'src')); });
      units.push([
        hasClass(u, 'rv-lu-on-dark') ? 'on-dark' : hasClass(u, 'rv-lu-on-light') ? 'on-light' : '',
        u.hasAttribute('data-rv-logo-note') ? 'note=' + attr(u, 'data-rv-logo-note') : '',
        pics.join(' '),
        String(u.textContent || '').replace(/\s+/g, ' ').trim()
      ].join('|'));
    });
    return units.length + ':' + units.join('\n');
  }

  /* ---------- a section's records, before and after a rework ----------
     The lead's decision of 3 Nov 2026 (QA follow-up, finding B): a section of Content's records that has no
     background may get one, but only through a rework of the whole section, and that rework is kept only if every
     record in it comes out unchanged. recordsState is read before the rework and again once the event's records
     are drawn into the new section (an AI rewrite holds a single example item until then); the two must be the
     same string, or the section is put back as it was. What counts as a record's own:
     - an item Content filled in through data-rv-repeat-template: each of its data-rv-field values (the photo's or
       logo's address, the name, the role, the company, the link), by field, so a new card design that shows the
       same values is the same; the design's own words around them are the section's, not the record's;
     - an item drawn by editor-fill.js (data-rv-item, data-rv-id): every picture address, word and link in it;
     - a records section with no item markers at all (the previous edition's speakers, an award's jury, an imported
       "Meet the Judges"), where nothing tells a record from the rest: every picture (but one ETB2B AI made, which is
       the new background), word and link in the section.
     A design's sample item that no record has filled yet is no record. A section that is not records and carries
     no items answers ''. */
  var RECORD_ITEM = '[data-rv-repeat-template], [data-rv-item], [data-rv-id]';
  var NOT_SHOWN = /^(?:SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/;
  function realRecord(el) {
    if (el.hasAttribute('data-rv-repeat-template')) return el.hasAttribute('data-rv-filled');
    return el.hasAttribute('data-rv-id') || attr(el, 'data-rv-item') !== '';
  }
  function urlsIn(v, into) {
    var re = /url\(\s*(["']?)(.*?)\1\s*\)/g, m;
    while ((m = re.exec(String(v || '')))) into.push(m[2]);
  }
  function plainText(el) { return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
  // the pictures, words and links in el, in sorted lists (the editor's own drawing, scripts and styles left out)
  function contentOf(el, keepMade) {
    var pics = [], texts = [], links = [];
    (function walk(n) {
      if (n.nodeType === 3) {
        var t = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (t) texts.push(t);
        return;
      }
      if (n.nodeType !== 1 || NOT_SHOWN.test(tagOf(n)) || matches(n, '[data-rv-editor], [data-ed="none"]')) return;
      if (tagOf(n) === 'IMG' && attr(n, 'src')) pics.push(attr(n, 'src'));
      if (n.style) urlsIn(n.style.backgroundImage, pics);
      if (tagOf(n) === 'A' && n.hasAttribute('href')) links.push(attr(n, 'href'));
      for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
    })(el);
    if (!keepMade) pics = pics.filter(function (u) { return !MADE_PICTURE.test(u); });
    return 'pictures ' + pics.sort().join(' ') + ' | words ' + texts.sort().join(' / ') + ' | links ' + links.sort().join(' ');
  }
  // a filled item's field values, by field: what Content put in it
  function fieldsOf(item) {
    var fields = item.hasAttribute('data-rv-field') ? [item] : [], out = [];
    each(item.querySelectorAll('[data-rv-field]'), function (f) { fields.push(f); });
    each(fields, function (f) {
      var tag = tagOf(f), v, found = [];
      if (tag === 'IMG') v = attr(f, 'src');
      else if (tag === 'A') v = attr(f, 'href') + ' ' + plainText(f);
      else {
        if (f.style) urlsIn(f.style.backgroundImage, found);
        v = found.length ? found.join(' ') : plainText(f);
      }
      out.push(attr(f, 'data-rv-field') + '=' + v);
    });
    return out.sort().join(' | ');
  }
  function recordsState(sec) {
    if (!sec || !sec.querySelectorAll) return '';
    var outer = [], lines = [];
    each(sec.querySelectorAll(RECORD_ITEM), function (el) {
      for (var i = 0; i < outer.length; i++) if (outer[i].contains(el)) return;     // part of a record already counted
      outer.push(el);
    });
    if (outer.length || hasItemMarks(sec)) {
      each(outer, function (el) {
        if (realRecord(el)) lines.push(el.hasAttribute('data-rv-repeat-template') ? 'fields ' + fieldsOf(el) : contentOf(el, true));
      });
      return 'records ' + lines.length + '\n' + lines.join('\n');
    }
    return roleOf(sec) === 'records' ? 'section\n' + contentOf(sec, false) : '';
  }

  global.RevampAiPicture = {
    describe: describe,
    slotOf: slotOf,
    isProtected: isProtected,
    chooseSlot: chooseSlot,
    target: target,
    place: place,
    heroVeilCss: heroVeilCss,
    unitState: unitState,
    recordsState: recordsState
  };
})(window);
