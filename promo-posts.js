/* Promotions — the social posts studio (marketing.html, "Social posts" tab).

   window.RevampPromoPosts = { mount(rootEl, ctx) }      ctx = { eventId, kit, toast(msg, opts) }

   Every post is the event website's own world: its hero picture under a veil in the site's tones, its logo unit,
   its heading and body fonts, its colours and corners, and its real content (speakers, partners, sessions,
   numbers…) from the Kit (promo-kit.js). A post type the event has no data for is shown as unavailable, with
   the reason and where to add the data; nothing is ever filled in with sample people, numbers or quotes.

   How a post is drawn: postHtml() writes the post at its real pixel size (1080 × 1350 and so on) and finish()
   then fits it — a long name steps its font size down within limits, wraps, and only then ends in "…"; a grid
   of people or logos shrinks its pictures until it fits its zone. On screen the post is only scaled (CSS
   transform), so the PNG is made from the very same DOM at full size (RevampPromo.toPng).

   Pictures always go through RevampPromo.image() first (a same-origin blob: URL), or the PNG export would be
   refused by the browser: our Storage bucket and ET's image host send no CORS headers.

   A post's settings — what is saved, and what a saved post reopens with:
     { type, format, background: 'picture'|'theme'|'site', picks: { speaker, speakers[], partner, partners[],
       session }, texts: { key: what the owner typed }, caption, network }
   texts only holds what the owner changed; everything else is worked out from the Kit each time it is drawn. */
(function () {
  'use strict';
  var P = window.RevampPromo;

  function esc(s) { return P.esc(s); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'post'; }

  /* ============================================================
     FORMATS

     px/pt/pb are the post's outer margins (about 6% of the width). A story keeps its words out of the top and
     bottom bands Instagram and WhatsApp draw their own controls over. k scales the type: a landscape post is
     much shorter, so everything on it is set a little smaller.
     ============================================================ */
  var FORMATS = [
    { id: 'portrait', label: 'Portrait', w: 1080, h: 1350, k: 1, use: 'Instagram, LinkedIn feed', px: 66, pt: 62, pb: 58 },
    { id: 'square', label: 'Square', w: 1080, h: 1080, k: 1, use: 'Instagram, Facebook', px: 64, pt: 56, pb: 52 },
    { id: 'landscape', label: 'Landscape', w: 1200, h: 675, k: 0.8, use: 'LinkedIn, X', px: 62, pt: 40, pb: 36 },
    { id: 'story', label: 'Story', w: 1080, h: 1920, k: 1.06, use: 'Instagram, WhatsApp status', px: 76, pt: 200, pb: 220 }
  ];
  var FMT = {};
  FORMATS.forEach(function (f) { FMT[f.id] = f; });

  /* the logo unit's box in each place it is drawn: [max width, max height] */
  var LOGO_BOX = {
    top: { portrait: [440, 150], square: [400, 124], landscape: [330, 96], story: [520, 176] },
    big: { portrait: [800, 320], square: [700, 250], landscape: [470, 230], story: [880, 380] }
  };

  var BACKGROUNDS = [
    { id: 'picture', label: 'Site picture', note: 'The hero picture' },
    { id: 'theme', label: 'Theme colour', note: '' },
    { id: 'site', label: 'Site background', note: '' }
  ];

  var NETWORKS = [
    { id: 'linkedin', label: 'LinkedIn', max: 3000 },
    { id: 'instagram', label: 'Instagram', max: 2200 },
    { id: 'x', label: 'X', max: 280 }
  ];

  var ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>',
    lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.2h.01"/></svg>',
    info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/></svg>',
    back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
    down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  };

  /* ============================================================
     THE SITE'S LOOK, FOR ONE BACKGROUND

     Every colour is the site's own. What is worked out here is only which of them can be read on which: text
     must reach 7:1 against the background (or the readable one of black and white is used), an accent used as
     text 3:1 (it is only ever large or bold), otherwise the accent falls back to the text colour.
     ============================================================ */
  function hexOk(c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : ''; }
  function rgba(hex, a) {
    var n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function minContrast(c, bgs) { return Math.min.apply(null, bgs.map(function (b) { return P.contrast(c, b); })); }
  function firstReadable(list, bgs, need) {
    for (var i = 0; i < list.length; i++) if (list[i] && minContrast(list[i], bgs) >= need) return list[i];
    return '';
  }
  function pictureOf(kit) {
    var b = kit.brand || {};
    return b.heroImageUrl || (b.pictures && b.pictures[0]) || '';
  }
  function radiusOf(kit) {
    var r = parseFloat(String((kit.brand && kit.brand.radius) || '12'));
    return isNaN(r) ? 12 : Math.max(0, Math.min(r, 40));
  }
  function stackOf(f, fallback) {
    if (f && f.stack) return f.stack;
    if (f && f.family) return '"' + String(f.family).replace(/"/g, '') + '", ' + fallback;
    return fallback;
  }

  function lookFor(kit, background) {
    var b = kit.brand || {}, c = b.colours || {};
    var theme = hexOk(c.theme) || '#186bf9', accent = hexOk(c.accent);
    var siteBg = hexOk(c.background) || (b.mode === 'dark' ? '#0d1017' : '#ffffff');
    var pic = pictureOf(kit);
    if (background === 'picture' && !pic) background = 'site';
    var L = { background: background, pic: background === 'picture' ? pic : '' };

    var bgs;
    if (background === 'theme') {
      L.mode = P.readableOn(theme) === '#ffffff' ? 'dark' : 'light';
      var deep = L.mode === 'dark' ? P.mix(theme, '#000000', 0.4) : P.mix(theme, '#ffffff', 0.28);
      var lift = L.mode === 'dark' ? P.mix(theme, '#ffffff', 0.1) : P.mix(theme, '#000000', 0.05);
      L.base = theme;
      L.fill = 'linear-gradient(160deg, ' + lift + ' 0%, ' + theme + ' 46%, ' + deep + ' 100%)';
      bgs = [theme, deep, lift];
    } else {
      L.base = siteBg;
      L.mode = P.lum(siteBg) < 0.2 ? 'dark' : 'light';
      L.fill = siteBg;
      bgs = [siteBg];
    }
    var dark = L.mode === 'dark';
    L.ink = firstReadable([hexOk(c.text)], bgs, 7) || P.readableOn(L.base);
    L.headInk = firstReadable([hexOk(c.heading), hexOk(c.text)], bgs, 7) || L.ink;
    L.muted = firstReadable([hexOk(c.muted)], bgs, 4.5) || P.mix(L.ink, L.base, 0.3);
    var accs = background === 'theme' ? [accent] : [theme, accent];
    L.acc = firstReadable(accs, bgs, 3) || L.ink;
    L.accInk = P.readableOn(L.acc);
    L.accText = L.acc;
    /* the keyword of a name set in type wears the theme colour, as the site's own lock-up does */
    L.key = firstReadable(background === 'theme' ? [] : [theme], bgs, 3) || L.headInk;
    L.line = rgba(L.ink, dark ? 0.22 : 0.18);
    L.tile = rgba(L.ink, dark ? 0.07 : 0.05);
    L.tileLine = rgba(L.ink, dark ? 0.16 : 0.12);
    L.baseSoft = background === 'theme' ? P.mix(theme, dark ? '#000000' : '#ffffff', 0.2) : siteBg;
    L.glow = rgba(background === 'theme' ? (dark ? '#ffffff' : '#000000') : theme, background === 'theme' ? 0.12 : (dark ? 0.34 : 0.2));

    /* the veil over the site's picture, in the site's own background tone: deep on a dark site, pale on a light one */
    if (L.pic) {
      L.veil = dark
        /* the picture must still be seen — it is what makes the post this event's — while the words keep a
           calm field: firmest where the lock-up and the footer sit, lightest through the middle */
        ? 'linear-gradient(180deg, ' + rgba(siteBg, 0.74) + ' 0%, ' + rgba(siteBg, 0.5) + ' 34%, ' + rgba(siteBg, 0.7) + ' 70%, ' + rgba(siteBg, 0.92) + ' 100%)'
        : 'linear-gradient(180deg, ' + rgba(siteBg, 0.82) + ' 0%, ' + rgba(siteBg, 0.58) + ' 34%, ' + rgba(siteBg, 0.76) + ' 70%, ' + rgba(siteBg, 0.94) + ' 100%)';
    } else if (background === 'site') {
      L.veil = 'radial-gradient(120% 70% at 100% 0%, ' + rgba(theme, dark ? 0.26 : 0.12) + ' 0%, transparent 60%), ' +
               'radial-gradient(90% 60% at 0% 100%, ' + rgba(accent || theme, dark ? 0.16 : 0.08) + ' 0%, transparent 60%)';
    } else {
      L.veil = 'radial-gradient(110% 70% at 100% 0%, ' + rgba(dark ? '#ffffff' : '#000000', 0.1) + ' 0%, transparent 60%)';
    }

    var r = radiusOf(kit);
    L.r = r === 0 ? 0 : Math.min(Math.round(r * 2), 44);
    L.ctaR = r === 0 ? 0 : (r >= 14 ? 999 : Math.round(r * 2));
    L.square = r === 0;
    var f = b.fonts || {};
    L.head = stackOf(f.heading, 'Georgia, serif');
    L.body = stackOf(f.body, 'Arial, sans-serif');

    /* the logo unit is drawn for one tone of background; on the other it would not be read, and it is never put
       on a plate — the event's name is set in type instead */
    var lu = b.logoUnit;
    L.logo = (lu && lu.url && (!lu.tone || lu.tone === L.mode)) ? lu : null;
    return L;
  }

  /* ============================================================
     THE EVENT'S FACTS
     ============================================================ */
  function eventOf(kit) { return kit.event || {}; }
  function contentOf(kit) { return kit.content || {}; }
  function placeOf(kit) {
    var e = eventOf(kit);
    return e.place || [e.venue, e.city].filter(Boolean).join(', ');
  }
  function linkOf(kit) {
    var e = eventOf(kit);
    return e.published ? (e.registerUrl || e.siteUrl || '') : '';
  }
  function speakersOf(kit) { return (contentOf(kit).speakers || []).filter(function (s) { return s && s.name; }); }
  function partnersOf(kit) { return (contentOf(kit).partners || []).filter(function (p) { return p && p.name; }); }
  function sessionsOf(kit) { return (contentOf(kit).sessions || []).filter(function (s) { return s && s.title; }); }
  function listOf(kit, k) { return (contentOf(kit)[k] || []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean); }
  function statsOf(kit) { return (contentOf(kit).stats || []).filter(function (s) { return s && (s.value || s.label); }); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function speakerByName(kit, name) {
    var n = String(name || '').trim().toLowerCase();
    var list = speakersOf(kit);
    for (var i = 0; i < list.length; i++) if (String(list[i].name).trim().toLowerCase() === n) return list[i];
    return null;
  }
  function initials(name) {
    var w = String(name || '').replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
  }
  function tierLabel(tier) {
    var t = String(tier || '').trim();
    if (!t) return 'Partner';
    return /partner|sponsor/i.test(t) ? t : t + ' Partner';
  }
  /* a session's time as it was entered: "10:15 AM – 11:00 AM", from an ISO time or a plain "10:15" */
  function clock(v) {
    var m = /(?:T|^)(\d{1,2}):(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    var h = +m[1], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m[2] + ' ' + ap;
  }
  function sessionWhen(s) {
    var t = [clock(s.start), clock(s.end)].filter(Boolean).join(' – ');
    return [s.day, t].filter(Boolean).join(' · ');
  }
  function sessionSpeakers(kit, s) {
    return (s.speakers || []).map(function (n) {
      return speakerByName(kit, n) || { id: 'n-' + slug(n), name: String(n), designation: '', company: '', photoUrl: '' };
    }).filter(function (p) { return p.name; });
  }
  /* whole days from today to the event's first day, in the viewer's own calendar */
  function daysToGo(kit) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(eventOf(kit).start || ''));
    if (!m) return null;
    var start = new Date(+m[1], +m[2] - 1, +m[3]);
    var now = new Date(); now = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((start - now) / 86400000);
  }
  function firstSentence(t) {
    var s = String(t || '').replace(/\s+/g, ' ').trim();
    var m = /^(.{20,220}?[.!?])(\s|$)/.exec(s);
    return m ? m[1] : (s.length <= 160 ? s : '');
  }
  function editionOf(kit) {
    var e = eventOf(kit).edition;
    if (e == null || e === '') return '';
    if (/^\d+$/.test(String(e))) {
      var n = +e, sfx = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
      return n + sfx + ' Edition';
    }
    return String(e);
  }

  /* ============================================================
     POST TYPES

     need(kit)          '' when the type can be made, else { why, fix: [label, console route] }
     pickDefaults(kit)  the people / partner / session a new post starts with
     instance(kit, cfg) what the post is about, for its name ("Speaker spotlight — Ananya Gupta")
     groups(D)          the text fields of the editor: [{ title, fields: [{ key, label, def, long }] }]
     mid(D)             the post's middle zone; top/foot are shared (see postHtml)
     caption(D, net)    a caption made only from the facts
     ============================================================ */
  function fixLink(eventId, route) { return '/edit-event.html?event=' + encodeURIComponent(eventId) + '#' + route; }

  var TYPES = [
    {
      id: 'announce', label: 'Save the date', blurb: 'The date, the place and the site’s own lock-up.', headline: 'tagline', topLeft: 'edition',
      need: function (kit) {
        return (eventOf(kit).dateLabel || placeOf(kit)) ? '' : { why: 'The event has no date or venue yet.', fix: ['Add them in Content → Basics', 'content/basics'] };
      },
      groups: function (D) {
        return [{ title: 'Words on the post', fields: [
          { key: 'kicker', label: 'Kicker', def: 'Save the date' },
          { key: 'bigDate', label: 'Date', def: eventOf(D.kit).dateLabel || '' },
          { key: 'bigPlace', label: 'Place', def: placeOf(D.kit) },
          { key: 'tagline', label: 'Line under the place', def: firstSentence(eventOf(D.kit).description || contentOf(D.kit).overview), long: true },
          { key: 'edition', label: 'Edition (top left)', def: editionOf(D.kit) }
        ] }];
      },
      foot: function (D) {
        /* the site's address is the QR code in the footer now, not a line of text */
        return { fields: [{ key: 'footNote', label: 'Footer line', def: '' }], left: function () { return D.T('footNote') ? '<span class="pp-wi">' + ICON.web + '<span>' + esc(D.T('footNote')) + '</span></span>' : ''; } };
      },
      mid: function (D) {
        var side = D.fmt.id === 'landscape';
        var words = '<div class="pp-big-t' + (side ? '' : ' pp-c') + '" style="display:flex;flex-direction:column;gap:' + D.u(18) + 'px;width:100%">' +
          (D.T('kicker') ? '<span class="pp-kick">' + esc(D.T('kicker')) + '</span>' : '') +
          (D.T('bigDate') ? '<h2 class="pp-h pp-date pp-fit" ' + D.fit(side ? 74 : 96, 50, 2) + '>' + esc(D.T('bigDate')) + '</h2>' : '') +
          (D.T('bigPlace') ? '<p class="pp-place pp-fit" ' + D.fit(36, 26, 2) + '>' + esc(D.T('bigPlace')) + '</p>' : '') +
          (D.T('tagline') ? '<p class="pp-tagl pp-fit" ' + D.fit(30, 23, 3) + ' style="margin-top:' + D.u(10) + 'px">' + esc(D.T('tagline')) + '</p>' : '') +
        '</div>';
        if (side) {
          return '<div style="display:flex;align-items:center;gap:' + D.u(64) + 'px;width:100%">' +
            '<div style="flex:0 0 auto;max-width:46%">' + logoHtml(D, 'big', 'left') + '</div>' +
            '<span style="flex:0 0 auto;width:1.5px;align-self:stretch;background:var(--pp-line)"></span>' +
            '<div style="flex:1 1 auto;min-width:0">' + words + '</div></div>';
        }
        return '<div class="pp-big" style="gap:' + D.u(D.fmt.id === 'story' ? 90 : 54) + 'px;width:100%">' +
          logoHtml(D, 'big', 'center') + '<span class="pp-rule"></span>' + words + '</div>';
      },
      caption: function (D, net) {
        var e = eventOf(D.kit);
        return lines([
          'Save the date: ' + e.name + (D.T('bigDate') ? ', ' + D.T('bigDate') : '') + (D.T('bigPlace') ? ', ' + D.T('bigPlace') : '') + '.',
          net === 'x' ? '' : firstSentence(e.description || contentOf(D.kit).overview)
        ], D, net);
      }
    },
    {
      /* the kicker and session line are worked out from the speaker, so what the owner types is kept for that speaker
         only: another speaker (the picker, or "Download all speaker spotlights") starts from their own */
      id: 'speaker', label: 'Speaker spotlight', blurb: 'One post for each speaker.', per: 'speaker',
      headline: function (D) { return 'sp:' + this.person(D).id + ':kicker'; },
      need: function (kit) { return speakersOf(kit).length ? '' : { why: 'The event has no speakers yet.', fix: ['Add speakers in Content → Speakers', 'content/speakers'] }; },
      count: function (kit) { return speakersOf(kit).length; },
      pickDefaults: function (kit) { return { speaker: (speakersOf(kit)[0] || {}).id }; },
      person: function (D) { return byId(speakersOf(D.kit), D.cfg.picks.speaker) || speakersOf(D.kit)[0]; },
      instance: function (kit, cfg) { var s = byId(speakersOf(kit), cfg.picks.speaker) || speakersOf(kit)[0]; return s ? s.name : ''; },
      groups: function (D) {
        var s = this.person(D), ses = sessionFor(D.kit, s);
        return [
          { title: 'Words on the post', fields: [
            { key: 'sp:' + s.id + ':kicker', label: 'Kicker', def: (s.group && !/^speakers?$/i.test(s.group)) ? String(s.group).replace(/s$/i, '').replace(/^keynote$/i, 'Keynote speaker') : 'Speaker' },
            { key: 'sp:' + s.id + ':session', label: 'Session line', def: ses ? ses.title : '', long: true }
          ] },
          personGroup(s, 'The speaker')
        ];
      },
      urls: function (D) { var s = this.person(D); return [s && s.photoUrl]; },
      mid: function (D) {
        var s = this.person(D), f = D.fmt.id, kick = D.T('sp:' + s.id + ':kicker'), note = D.T('sp:' + s.id + ':session');
        var side = f === 'square' || f === 'landscape';
        /* the picture is as big as the post allows: when a long name, designation and session line need the room
           (a story keeps its words clear of the bottom band), it shrinks first — down to 62% — and only a tighter
           drawing (see drawInto) sets the words smaller too */
        var size = Math.round({ portrait: 430, square: 380, landscape: 300, story: 600 }[f] * D.fmt.k * D.s);
        var fit = function (max, min, n) { return D.fit(Math.round(max * D.s), Math.round(min * D.s), n); };
        var t = '<div class="pp-st">' +
          (kick ? '<span class="pp-kick">' + esc(kick) + '</span>' : '') +
          '<h2 class="pp-h pp-pname pp-fit" ' + fit(side ? 74 : 86, side ? 42 : 52, side ? 3 : 2) + '>' + esc(D.P(s, 'name')) + '</h2>' +
          (D.P(s, 'designation') ? '<p class="pp-pdes pp-fit" ' + fit(32, 24, 2) + '>' + esc(D.P(s, 'designation')) + '</p>' : '') +
          (D.P(s, 'company') ? '<p class="pp-pco pp-fit" ' + fit(32, 24, 2) + '>' + esc(D.P(s, 'company')) + '</p>' : '') +
          (note ? '<p class="pp-pnote pp-fit" ' + fit(25, 21, side ? 2 : 3) + '><b>Session</b>' + esc(note) + '</p>' : '') +
        '</div>';
        var ph = '<div style="position:relative;flex:0 0 auto;--d:' + size + 'px" data-shrink="--d,' + size + ',' + Math.round(size * 0.62) + '">' +
          '<span class="pp-glow" style="left:-30%;top:-30%;width:160%;height:160%"></span>' +
          photoHtml(D, s, 'var(--d)', true) + '</div>';
        return '<div class="pp-spot' + (side ? ' side' : '') + '">' + ph + t + '</div>';
      },
      caption: function (D, net) {
        var s = this.person(D), e = eventOf(D.kit);
        var who = [D.P(s, 'name'), D.P(s, 'designation'), D.P(s, 'company')].filter(Boolean).join(', ');
        return lines([
          'We are delighted to welcome ' + who + ', as a speaker at ' + e.name + '.',
          D.T('sp:' + s.id + ':session') ? 'Session: ' + D.T('sp:' + s.id + ':session') : ''
        ], D, net);
      }
    },
    {
      id: 'lineup', label: 'Speaker line-up', blurb: 'Several speakers on one post; the layout follows how many.', headline: 'headline',
      need: function (kit) { return speakersOf(kit).length >= 2 ? '' : { why: speakersOf(kit).length ? 'A line-up needs at least two speakers.' : 'The event has no speakers yet.', fix: ['Add speakers in Content → Speakers', 'content/speakers'] }; },
      count: function (kit) { return speakersOf(kit).length; },
      pickDefaults: function (kit) { return { speakers: speakersOf(kit).slice(0, 8).map(function (s) { return s.id; }) }; },
      people: function (D) {
        var all = speakersOf(D.kit), ids = D.cfg.picks.speakers || [];
        var out = all.filter(function (s) { return ids.indexOf(s.id) >= 0; });
        return out.length >= 1 ? out : all.slice(0, 8);
      },
      instance: function (kit, cfg) { return ((cfg.picks.speakers || []).length || Math.min(8, speakersOf(kit).length)) + ' speakers'; },
      groups: function (D) {
        var g = [{ title: 'Words on the post', fields: [
          { key: 'kicker', label: 'Kicker', def: 'Speakers' },
          { key: 'headline', label: 'Headline', def: 'Meet the speakers' }
        ] }];
        this.people(D).forEach(function (s) { g.push(personGroup(s, s.name, true)); });
        return g;
      },
      urls: function (D) { return this.people(D).map(function (s) { return s.photoUrl; }); },
      mid: function (D) {
        var people = this.people(D);
        if (D.fmt.id !== 'landscape') return headHtml(D, 'kicker', 'headline', 2) + peopleGrid(D, people, 'lineup');
        /* a landscape post is short: the heading stands to the left and the people take the full height */
        var left = Math.round(D.iw * 0.28), gap = D.u(48);
        return '<div style="display:flex;align-items:center;gap:' + gap + 'px"><div style="flex:0 0 ' + left + 'px">' + headHtml(D, 'kicker', 'headline', 3).replace('class="pp-head"', 'class="pp-head" style="margin:0"') + '</div>' +
          '<div style="flex:1 1 auto;min-width:0">' + peopleGrid(D, people, 'lineup', D.iw - left - gap) + '</div></div>';
      },
      caption: function (D, net) {
        var e = eventOf(D.kit), ps = this.people(D);
        return lines([
          'Meet the speakers at ' + e.name + ':',
          ps.map(function (s) { return '• ' + [D.P(s, 'name'), D.P(s, 'designation'), D.P(s, 'company')].filter(Boolean).join(', '); }).join('\n')
        ], D, net);
      }
    },
    {
      id: 'partner', label: 'Partner welcome', blurb: 'One post for each partner, with its tier.', per: 'partner', headline: 'kicker',
      need: function (kit) { return partnersOf(kit).length ? '' : { why: 'The event has no partners yet.', fix: ['Add partners in Content → Sponsors', 'content/sponsors'] }; },
      count: function (kit) { return partnersOf(kit).length; },
      pickDefaults: function (kit) { return { partner: (partnersOf(kit)[0] || {}).id }; },
      partner: function (D) { return byId(partnersOf(D.kit), D.cfg.picks.partner) || partnersOf(D.kit)[0]; },
      instance: function (kit, cfg) { var p = byId(partnersOf(kit), cfg.picks.partner) || partnersOf(kit)[0]; return p ? p.name : ''; },
      groups: function (D) {
        var p = this.partner(D);
        return [{ title: 'Words on the post', fields: [
          { key: 'kicker', label: 'Kicker', def: 'Welcoming our' },
          { key: 'pt:' + p.id + ':tier', label: 'Tier', def: tierLabel(p.tier) },
          { key: 'pt:' + p.id + ':name', label: 'Partner name', def: p.name }
        ] }];
      },
      urls: function (D) { var p = this.partner(D); return [p && p.logoUrl]; },
      mid: function (D) {
        var p = this.partner(D), f = D.fmt.id, side = f === 'landscape';
        var card = { portrait: [760, 420], square: [700, 330], landscape: [520, 300], story: [860, 520] }[f];
        var name = D.T('pt:' + p.id + ':name'), tier = D.T('pt:' + p.id + ':tier');
        var words = '<div style="display:flex;flex-direction:column;gap:' + D.u(14) + 'px;' + (side ? '' : 'align-items:center;text-align:center;') + 'width:100%">' +
          (D.T('kicker') ? '<span class="pp-kick">' + esc(D.T('kicker')) + '</span>' : '') +
          (tier ? '<h2 class="pp-h pp-fit" ' + D.fit(side ? 64 : 84, 44, 2) + ' style="width:100%">' + esc(tier) + '</h2>' : '') +
          (side && name ? '<p class="pp-place pp-fit" ' + D.fit(32, 24, 2) + ' style="width:100%;margin-top:' + D.u(10) + 'px">' + esc(name) + '</p>' : '') +
        '</div>';
        var c = partnerCard(D, p, card[0], card[1], name);
        if (side) return '<div style="display:flex;align-items:center;gap:' + D.u(56) + 'px"><div style="flex:1 1 auto;min-width:0">' + words + '</div>' + c + '</div>';
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:' + D.u(f === 'story' ? 70 : 48) + 'px">' + words + c +
          (name ? '<p class="pp-place pp-fit" ' + D.fit(34, 26, 2) + ' style="width:100%;text-align:center">' + esc(name) + '</p>' : '') + '</div>';
      },
      caption: function (D, net) {
        var p = this.partner(D), t = D.T('pt:' + p.id + ':tier');
        return lines(['We are glad to welcome ' + D.T('pt:' + p.id + ':name') + (t ? ' as ' + (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t : '') + ' of ' + eventOf(D.kit).name + '.'], D, net);
      }
    },
    {
      id: 'partners', label: 'Partners wall', blurb: 'Every partner, grouped by tier.', headline: 'headline',
      need: function (kit) { return partnersOf(kit).length >= 2 ? '' : { why: partnersOf(kit).length ? 'A partners wall needs at least two partners.' : 'The event has no partners yet.', fix: ['Add partners in Content → Sponsors', 'content/sponsors'] }; },
      count: function (kit) { return partnersOf(kit).length; },
      pickDefaults: function (kit) { return { partners: partnersOf(kit).map(function (p) { return p.id; }) }; },
      list: function (D) {
        var ids = D.cfg.picks.partners || [];
        var out = partnersOf(D.kit).filter(function (p) { return ids.indexOf(p.id) >= 0; });
        return out.length ? out : partnersOf(D.kit);
      },
      tiers: function (D) {
        var order = [], by = {};
        this.list(D).forEach(function (p) {
          var t = String(p.tier || '').trim() || 'Partners';
          if (!by[t]) { by[t] = []; order.push(t); }
          by[t].push(p);
        });
        return order.map(function (t) { return { tier: t, items: by[t] }; });
      },
      instance: function (kit, cfg) { return ((cfg.picks.partners || []).length || partnersOf(kit).length) + ' partners'; },
      groups: function (D) {
        var f = [{ key: 'kicker', label: 'Kicker', def: '' }, { key: 'headline', label: 'Headline', def: 'Our partners' }];
        this.tiers(D).forEach(function (t) { f.push({ key: 'tier:' + t.tier, label: 'Tier label: ' + t.tier, def: t.tier === 'Partners' ? '' : tierLabel(t.tier) }); });
        return [{ title: 'Words on the post', fields: f }];
      },
      urls: function (D) { return this.list(D).map(function (p) { return p.logoUrl; }); },
      mid: function (D) {
        var tiers = this.tiers(D);
        var gap = D.u(20);
        var body = tiers.map(function (t, i) {
          var mult = tiers.length > 1 && i === 0 ? 1.3 : 1;
          return '<div class="pp-tier">' + (D.T('tier:' + t.tier) ? '<span class="pp-kick">' + esc(D.T('tier:' + t.tier)) + '</span>' : '') +
            '<div class="pp-logos" style="gap:' + gap + 'px">' + t.items.map(function (p) {
              return partnerCard(D, p, 'calc(var(--t) * ' + mult + ')', 'calc(var(--t) * ' + (mult * 0.52) + ')', p.name, true);
            }).join('') + '</div></div>';
        }).join('');
        var start = Math.round({ portrait: 300, square: 270, landscape: 230, story: 380 }[D.fmt.id] * D.fmt.k);
        return headHtml(D, 'kicker', 'headline', 1) + '<div class="pp-tiers' + (D.fmt.id === 'landscape' ? ' flow' : '') + '" data-shrink="--t,' + start + ',' + Math.round(80 * D.fmt.k) + '" style="--t:' + start + 'px">' + body + '</div>';
      },
      caption: function (D, net) {
        var parts = this.tiers(D).map(function (t) {
          var l = D.T('tier:' + t.tier);
          return (l ? l + ': ' : '') + t.items.map(function (p) { return p.name; }).join(', ');
        });
        return lines(['Thank you to the partners of ' + eventOf(D.kit).name + '.', parts.join('\n')], D, net);
      }
    },
    {
      id: 'stats', label: 'Key numbers', blurb: 'The event’s own numbers, big.', headline: 'headline',
      /* the numbers are counted from the event's own speakers, sessions, partners and days */
      need: function (kit) { return statsOf(kit).length ? '' : { why: 'The event has nothing to count yet: no speakers, sessions, partners or dates.', fix: ['Add speakers in Content → Speakers', 'content/speakers'] }; },
      groups: function (D) {
        var f = [{ key: 'kicker', label: 'Kicker', def: '' }, { key: 'headline', label: 'Headline', def: 'In numbers' }];
        statsOf(D.kit).slice(0, 6).forEach(function (s, i) {
          f.push({ key: 'st:' + i + ':value', label: 'Number ' + (i + 1), def: String(s.value || '') });
          f.push({ key: 'st:' + i + ':label', label: 'Label ' + (i + 1), def: String(s.label || '') });
        });
        return [{ title: 'Words on the post', fields: f }];
      },
      mid: function (D) {
        var st = statsOf(D.kit).slice(0, 6), n = st.length, f = D.fmt.id;
        var cols = f === 'landscape' ? Math.min(n, n === 5 || n === 6 ? 3 : 4) : f === 'story' ? (n <= 3 ? 1 : 2) : (n === 1 ? 1 : n === 3 || n >= 5 ? 3 : 2);
        if (f === 'portrait' && n === 3) cols = 1;
        var gap = D.u(22), w = Math.floor((D.iw - gap * (cols - 1)) / cols);
        var tiles = st.map(function (s, i) {
          return '<div class="pp-tile pp-stat" style="width:' + w + 'px;padding:' + D.u(cols === 1 ? 34 : 38) + 'px ' + D.u(36) + 'px">' +
            '<span class="v pp-fit" data-fit-group="v" ' + D.fit(cols === 1 ? 140 : cols === 2 ? 130 : 104, 60, 1) + '>' + esc(D.T('st:' + i + ':value')) + '</span>' +
            '<span class="l pp-fit" data-fit-group="l" ' + D.fit(24, 19, 2) + '>' + esc(D.T('st:' + i + ':label')) + '</span></div>';
        }).join('');
        return headHtml(D, 'kicker', 'headline', 2) + '<div class="pp-tiles" style="gap:' + gap + 'px">' + tiles + '</div>';
      },
      caption: function (D, net) {
        var st = statsOf(D.kit).slice(0, 6).map(function (s, i) { return D.T('st:' + i + ':value') + ' ' + D.T('st:' + i + ':label'); });
        return lines([eventOf(D.kit).name + ' in numbers: ' + st.join(', ') + '.'], D, net);
      }
    },
    listType('audience', 'Who should attend', 'The people this event is for.', 'audience', 'au', 'Who should attend', 'bar',
      { why: 'The event’s brief has no “who should attend” list, and nothing here makes one up.', fix: null },
      function (D, items) { return 'Who should attend ' + eventOf(D.kit).name + ':\n' + items.map(function (t) { return '• ' + t; }).join('\n'); }),
    listType('topics', 'Key topics', 'What the event will discuss.', 'topics', 'tp', 'Key topics', 'num',
      { why: 'The event’s brief has no topics or tracks, and nothing here makes them up.', fix: null },
      function (D, items) { return 'On the agenda at ' + eventOf(D.kit).name + ':\n' + items.map(function (t) { return '• ' + t; }).join('\n'); }),
    {
      id: 'session', label: 'Session spotlight', blurb: 'One post for each session, with its speakers.', per: 'session', headline: 'kicker',
      need: function (kit) { return sessionsOf(kit).length ? '' : { why: 'The event has no agenda yet.', fix: ['Add sessions in Content → Agenda', 'content/agenda'] }; },
      count: function (kit) { return sessionsOf(kit).length; },
      pickDefaults: function (kit) {
        var all = sessionsOf(kit), withPeople = all.filter(function (s) { return (s.speakers || []).length; });
        return { session: ((withPeople[0] || all[0]) || {}).id };
      },
      session: function (D) { return byId(sessionsOf(D.kit), D.cfg.picks.session) || sessionsOf(D.kit)[0]; },
      instance: function (kit, cfg) { var s = byId(sessionsOf(kit), cfg.picks.session) || sessionsOf(kit)[0]; return s ? s.title : ''; },
      groups: function (D) {
        var s = this.session(D), g = [{ title: 'Words on the post', fields: [
          { key: 'kicker', label: 'Kicker', def: 'Session' },
          { key: 's:' + s.id + ':when', label: 'Day and time', def: sessionWhen(s) },
          { key: 's:' + s.id + ':title', label: 'Session title', def: s.title, long: true }
        ] }];
        sessionSpeakers(D.kit, s).slice(0, 6).forEach(function (p) { g.push(personGroup(p, p.name, true)); });
        return g;
      },
      urls: function (D) { return sessionSpeakers(D.kit, this.session(D)).map(function (p) { return p.photoUrl; }); },
      mid: function (D) {
        var s = this.session(D), people = sessionSpeakers(D.kit, s), f = D.fmt.id, when = D.T('s:' + s.id + ':when');
        var head = '<div style="display:flex;flex-direction:column;gap:' + D.u(22) + 'px;margin-bottom:' + D.u(people.length ? 46 : 0) + 'px">' +
          '<div style="display:flex;align-items:center;gap:' + D.u(18) + 'px;flex-wrap:wrap">' +
            (D.T('kicker') ? '<span class="pp-kick">' + esc(D.T('kicker')) + '</span>' : '') +
            (when ? '<span class="pp-chip">' + esc(when) + '</span>' : '') + '</div>' +
          '<h2 class="pp-h pp-stitle pp-fit" ' + D.fit(f === 'landscape' ? 60 : 74, 40, f === 'story' ? 5 : people.length ? 3 : 4) + '>' + esc(D.T('s:' + s.id + ':title')) + '</h2>' +
          '<span class="pp-rule"></span></div>';
        return head + (people.length ? peopleGrid(D, people, 'session') : '');
      },
      caption: function (D, net) {
        var s = this.session(D), ps = sessionSpeakers(D.kit, s);
        return lines([
          (D.T('s:' + s.id + ':when') ? D.T('s:' + s.id + ':when') + ': ' : '') + D.T('s:' + s.id + ':title'),
          ps.length ? 'With ' + ps.map(function (p) { return [D.P(p, 'name'), D.P(p, 'company')].filter(Boolean).join(', '); }).join('; ') + '.' : '',
          'At ' + eventOf(D.kit).name + '.'
        ], D, net);
      }
    },
    {
      id: 'countdown', label: 'Countdown', blurb: 'Days to go, before the event starts.', headline: 'tagline',
      need: function (kit) {
        var d = daysToGo(kit);
        if (d == null) return { why: 'The event has no exact start date yet.', fix: ['Set it in Content → Basics', 'content/basics'] };
        if (d < 1) return { why: d === 0 ? 'The event starts today: there is nothing left to count down.' : 'The event has already started.', fix: null };
        return '';
      },
      groups: function (D) {
        var d = daysToGo(D.kit) || 0;
        return [{ title: 'Words on the post', fields: [
          { key: 'kicker', label: 'Kicker', def: '' },
          { key: 'number', label: 'Number', def: String(d) },
          { key: 'unit', label: 'Under the number', def: d === 1 ? 'Day to go' : 'Days to go' },
          { key: 'tagline', label: 'Line under it', def: '', long: true }
        ] }];
      },
      mid: function (D) {
        var f = D.fmt.id, side = f === 'landscape';
        var num = '<span class="pp-num pp-fit" ' + D.fit(side ? 300 : f === 'story' ? 420 : 340, 150, 1) + ' style="width:100%">' + esc(D.T('number')) + '</span>';
        var words = '<div style="display:flex;flex-direction:column;gap:' + D.u(20) + 'px;' + (side ? '' : 'align-items:center;text-align:center;') + 'width:100%">' +
          (D.T('kicker') ? '<span class="pp-kick">' + esc(D.T('kicker')) + '</span>' : '') +
          (D.T('unit') ? '<h2 class="pp-h pp-fit" ' + D.fit(side ? 60 : 72, 40, 2) + ' style="width:100%;text-transform:uppercase;letter-spacing:.04em">' + esc(D.T('unit')) + '</h2>' : '') +
          (D.T('tagline') ? '<p class="pp-tagl pp-fit" ' + D.fit(30, 23, 3) + '>' + esc(D.T('tagline')) + '</p>' : '') + '</div>';
        if (side) {
          return '<div style="display:flex;align-items:center;gap:' + D.u(60) + 'px"><div style="position:relative;flex:0 0 auto;width:42%;text-align:center">' +
            '<span class="pp-glow" style="left:-10%;top:-40%;width:120%;height:180%"></span>' + num + '</div>' +
            '<div style="flex:1 1 auto;min-width:0">' + words + '</div></div>';
        }
        return '<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:' + D.u(26) + 'px;text-align:center">' +
          '<span class="pp-glow" style="left:10%;top:-18%;width:80%;height:90%"></span>' + num + '<span class="pp-rule"></span>' + words + '</div>';
      },
      caption: function (D, net) {
        var e = eventOf(D.kit);
        return lines([D.T('number') + ' ' + String(D.T('unit') || '').toLowerCase() + ' to ' + e.name + '.'], D, net);
      }
    }
  ];

  /* who should attend and key topics are the same post: a heading and a list */
  function listType(id, label, blurb, key, prefix, headline, mark, missing, cap) {
    return {
      id: id, label: label, blurb: blurb, headline: 'headline',
      need: function (kit) { return listOf(kit, key).length ? '' : missing; },
      items: function (D) {
        return listOf(D.kit, key).slice(0, 8).map(function (t, i) { return D.T(prefix + ':' + i); }).filter(Boolean);
      },
      groups: function (D) {
        var f = [{ key: 'kicker', label: 'Kicker', def: '' }, { key: 'headline', label: 'Headline', def: headline }];
        listOf(D.kit, key).slice(0, 8).forEach(function (t, i) { f.push({ key: prefix + ':' + i, label: 'Line ' + (i + 1), def: t, long: true }); });
        return [{ title: 'Words on the post', fields: f }];
      },
      mid: function (D) {
        var items = this.items(D), n = items.length, f = D.fmt.id;
        var cols = f === 'story' ? 1 : f === 'landscape' ? (n <= 2 ? n : n <= 4 ? 2 : 3) : (n <= 4 ? 1 : 2);
        if (f === 'square' && n >= 4) cols = 2;
        var gap = D.u(18), w = Math.floor((D.iw - gap * (cols - 1)) / cols);
        var big = (cols === 1 ? (n <= 3 ? 42 : 34) : 30) * D.s;
        var rows = items.map(function (t, i) {
          var m = mark === 'num' ? '<span class="ix" style="font-size:' + D.u(big) + 'px">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' : '<span class="ib"></span>';
          return '<div class="pp-tile pp-item" style="width:' + w + 'px;padding:' + D.u(26 * D.s) + 'px ' + D.u(30 * D.s) + 'px">' + m +
            '<span class="tx pp-fit" data-fit-group="i" ' + D.fit(big, 22, 3) + '>' + esc(t) + '</span></div>';
        }).join('');
        return headHtml(D, 'kicker', 'headline', 2) + '<div class="pp-tiles" style="gap:' + gap + 'px">' + rows + '</div>';
      },
      caption: function (D, net) { return lines([cap(D, this.items(D))], D, net); }
    };
  }

  var TYPE = {};
  TYPES.forEach(function (t) { TYPE[t.id] = t; });

  function sessionFor(kit, s) {
    if (!s) return null;
    var list = sessionsOf(kit), n = String(s.name).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if ((list[i].speakers || []).some(function (x) { return String(x).trim().toLowerCase() === n; })) return list[i];
    }
    return null;
  }
  function personGroup(s, title, compact) {
    return { title: title, person: true, fields: [
      { key: 'p:' + s.id + ':name', label: compact ? 'Name' : 'Name', def: s.name },
      { key: 'p:' + s.id + ':designation', label: 'Designation', def: s.designation || '' },
      { key: 'p:' + s.id + ':company', label: 'Company', def: s.company || '' }
    ] };
  }
  function lines(parts, D, net) {
    var e = eventOf(D.kit), link = linkOf(D.kit), tag = D.T('hashtag');
    var when = [D.T('date'), D.T('place')].filter(Boolean).join(' · ');
    var body = parts.filter(Boolean);
    if (net === 'x') {
      var t = body[0] || '';
      var tail = [link, tag].filter(Boolean).join(' ');
      var room = 280 - tail.length - 2;
      if (t.length > room) t = t.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…';
      return [t, tail].filter(Boolean).join('\n\n');
    }
    var out = body.concat([when]);
    if (link && net !== 'instagram') out.push('Register: ' + link);
    if (tag) out.push(tag);
    return out.filter(Boolean).join('\n\n') || e.name || '';
  }

  /* ============================================================
     DRAWING ONE POST

     D — everything a type needs to draw: the kit, the post's settings, the format, the look, and
       D.T(key)        the text for that key: what the owner typed, or the default from the facts
       D.P(person, f)  a person's name / designation / company, the same way
       D.u(px)         a size in post pixels for this format
       D.fit(max, min, lines)   the attribute finish() reads to fit a text
     ============================================================ */
  var PICS = {}, PIC_FAILED = {};

  function want(urls) {
    return Promise.all((urls || []).filter(Boolean).map(function (u) {
      if (has(PICS, u)) return null;
      return P.image(u).then(function (b) { PICS[u] = b; }, function () { PICS[u] = ''; PIC_FAILED[u] = 1; });
    }));
  }
  function pic(u) { return u && PICS[u] ? PICS[u] : ''; }

  function makeD(kit, cfg, fmtId, squeeze) {
    var type = TYPE[cfg.type], fmt = FMT[fmtId || cfg.format] || FMT.portrait;
    var look = lookFor(kit, cfg.background);
    var D = { kit: kit, cfg: cfg, type: type, fmt: fmt, look: look, iw: fmt.w - fmt.px * 2, squeeze: squeeze || 0 };
    /* how much tighter than normal this drawing is (see drawInto) */
    D.s = 1 - 0.08 * Math.min(D.squeeze, 3);
    D.defs = {};
    D.u = function (n) { return Math.round(n * fmt.k); };
    D.fit = function (max, min, lines) { return 'data-fit="' + D.u(max) + ',' + D.u(min) + ',' + (lines || 1) + '"'; };
    D.T = function (key) {
      if (has(cfg.texts || {}, key)) return String(cfg.texts[key]);
      return has(D.defs, key) ? String(D.defs[key] == null ? '' : D.defs[key]) : '';
    };
    D.P = function (s, f) { return D.T('p:' + s.id + ':' + f); };
    groupsOf(D).forEach(function (g) { g.fields.forEach(function (f) { D.defs[f.key] = f.def; }); });
    return D;
  }

  /* every field of a post: the type's own, the footer's, and the event's name when it is set in type */
  function groupsOf(D) {
    var kit = D.kit, type = D.type;
    var g = type.groups.call(type, D).slice();
    var foot = type.foot ? type.foot(D) : null;
    var ff = foot ? foot.fields.slice() : [
      { key: 'date', label: 'Date (footer)', def: eventOf(kit).dateLabel || '' },
      { key: 'place', label: 'Place (footer)', def: placeOf(kit) }
    ];
    if (foot) {
      /* the date and place still feed the caption */
      D.defs.date = eventOf(kit).dateLabel || '';
      D.defs.place = placeOf(kit);
    }
    ff.push({ key: 'cta', label: 'Button', def: 'Register now' });
    /* the site's address as a QR code to scan (only a live site has one) */
    if (linkOf(kit)) ff.push({ key: 'qrLabel', label: 'QR code caption (clear it to leave the QR code out)', def: 'Scan to register' });
    ff.push({ key: 'hashtag', label: 'Hashtag', def: eventOf(kit).hashtag || '' });
    g.push({ title: 'Footer and hashtag', fields: ff });
    if (!D.look.logo || !pic(D.look.logo.url)) {
      var parts = (kit.brand && kit.brand.logoUnitParts) || {};
      var key = parts.keyword || (!parts.before && !parts.after ? eventOf(kit).name : '');
      g.push({ title: 'Event name (set in type: the site has no logo unit for this background)', fields: [
        { key: 'lu:before', label: 'Small line above', def: parts.before || '' },
        { key: 'lu:keyword', label: 'Name, in the theme colour', def: key || '' },
        { key: 'lu:after', label: 'Rest of the name', def: parts.after || '' }
      ] });
    }
    return g;
  }

  function logoHtml(D, where, align) {
    var L = D.look, box = LOGO_BOX[where][D.fmt.id], lu = L.logo;
    var src = lu ? pic(lu.url) : '';
    if (src) {
      var w = +lu.width || 0, h = +lu.height || 0;
      if (!(w > 0 && h > 0)) { w = 2.4; h = 1; }
      var s = Math.min(box[0] / w, box[1] / h);
      var W = Math.round(w * s), H = Math.round(h * s);
      return '<div class="pp-logo"><img src="' + esc(src) + '" alt="" style="width:' + W + 'px;height:' + H + 'px;' +
        (align === 'center' ? 'margin:0 auto;object-position:center' : '') + '"></div>';
    }
    var before = D.T('lu:before'), key = D.T('lu:keyword'), after = D.T('lu:after');
    var big = where === 'big';
    var k = big ? (D.fmt.id === 'landscape' ? 96 : D.fmt.id === 'story' ? 128 : 116) : (D.fmt.id === 'landscape' ? 50 : 54);
    var c = align === 'center';
    return '<div class="pp-lock" style="' + (big ? 'max-width:' + box[0] + 'px;' : '') + (c ? 'align-items:center;text-align:center;margin:0 auto;' : '') + '">' +
      (before ? '<span class="pp-lb" style="font-size:' + D.u(big ? 28 : 21) + 'px">' + esc(before) + '</span>' : '') +
      ((key || after) ? '<span class="pp-lk pp-fit" data-noclamp="1" ' + D.fit(k, big ? 52 : 30, 2) + ' style="width:' + box[0] + 'px">' +
        (key ? '<em>' + esc(key) + '</em>' : '') + (key && after ? ' ' : '') + esc(after) + '</span>' : '') +
    '</div>';
  }

  /* size: pixels, or a CSS length such as 'var(--d)' (a picture that shrinkBoxes() may make smaller) */
  function photoHtml(D, s, size, ring) {
    var src = pic(s.photoUrl);
    var cls = 'pp-ph' + (D.look.square ? ' sq' : '') + (ring ? ' pp-ring' : '');
    var len = typeof size === 'number' ? size + 'px' : size;
    var ini = typeof size === 'number' ? Math.round(size * 0.34) + 'px' : 'calc(' + size + ' * .34)';
    return '<div class="' + cls + '" style="width:' + len + ';height:' + len + '">' +
      (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="pp-ini" style="font-size:' + ini + '">' + esc(initials(D.P(s, 'name') || s.name)) + '</span>') + '</div>';
  }

  function partnerCard(D, p, w, h, name, small) {
    var src = pic(p.logoUrl);
    var W = typeof w === 'number' ? w + 'px' : w, H = typeof h === 'number' ? h + 'px' : h;
    var inner = src
      ? '<img src="' + esc(src) + '" alt="" style="width:' + (small ? '78%' : '72%') + ';height:' + (small ? '66%' : '60%') + '">'
      : '<span class="pp-pn" style="font-size:' + (small ? 'calc(' + H + ' * .2)' : D.u(56) + 'px') + '">' + esc(name || p.name) + '</span>';
    return '<div class="pp-pcard" style="width:' + W + ';height:' + H + ';flex:0 0 auto">' + inner + '</div>';
  }

  function headHtml(D, kickKey, headKey, lines) {
    var k = D.T(kickKey), h = D.T(headKey);
    if (!k && !h) return '';
    var size = Math.round((D.fmt.id === 'landscape' ? 58 : D.fmt.id === 'story' ? 84 : 72) * (D.squeeze ? 0.86 : 1));
    return '<div class="pp-head">' + (k ? '<span class="pp-kick">' + esc(k) + '</span>' : '') +
      (h ? '<h2 class="pp-h pp-fit" ' + D.fit(size, 40, lines) + ' style="font-size:' + D.u(size) + 'px;width:100%">' + esc(h) + '</h2>' : '') +
      '<span class="pp-rule"></span></div>';
  }

  /* How a group of people is laid out, by how many there are and the shape of the post.
     'stack' — picture above the name; 'rows' — picture beside it (many people on a short post).
     cap — the most that fit with every name, designation and company still readable; past it the last
     place says "+N more". */
  function peoplePlan(n, f) {
    var CAP = { portrait: 20, square: 16, landscape: 12, story: 24 }[f];
    var show = Math.min(n, CAP);
    var tier = show <= 4 ? 'a' : show <= 8 ? 'b' : show <= 16 ? 'c' : 'd';
    var p = { cap: CAP, mode: 'stack', cols: 1, tier: tier };
    if (f === 'portrait') p.cols = show <= 3 ? show : show === 4 ? 2 : show <= 6 ? 3 : show <= 9 ? (show === 9 ? 3 : 4) : show <= 16 ? 4 : 5;
    else if (f === 'square') {
      if (show <= 4) p.cols = show;
      else if (show <= 8) p.cols = 4;
      else { p.mode = 'rows'; p.cols = 2; }
    } else if (f === 'landscape') {
      p.cap = 8;
      show = Math.min(n, 8);
      if (show <= 3) p.cols = show;
      else if (show === 4) p.cols = 2;
      else { p.mode = 'rows'; p.cols = 2; }
      p.tier = show <= 3 ? 'a' : show <= 4 ? 'b' : 'c';
    } else {
      p.cols = show <= 2 ? 1 : show <= 6 ? 2 : show <= 12 ? 3 : show <= 16 ? 4 : 2;
      if (show > 16) p.mode = 'rows';
    }
    return p;
  }
  var TIER = { a: [34, 24], b: [29, 21], c: [25, 19], d: [22, 17] };

  function peopleGrid(D, people, use, width) {
    var f = D.fmt.id, n = people.length, iw = width || D.iw;
    var plan = peoplePlan(n, f);
    if (use === 'session') { plan = peoplePlan(Math.min(n, 4), f); plan.cap = 4; if (n > 1 && f !== 'landscape') { plan.mode = 'rows'; plan.cols = n <= 2 ? 1 : 2; } }
    if (D.squeeze >= 4) plan.cap = Math.max(4, Math.ceil(Math.min(plan.cap, n) * (D.squeeze === 4 ? 0.8 : 0.6)));
    var shown = n > plan.cap ? people.slice(0, plan.cap - 1) : people;
    var more = n - shown.length;
    var gapX = D.u((plan.mode === 'rows' ? 30 : 26) * D.s), gapY = D.u((plan.mode === 'rows' ? 22 : 34) * D.s);
    var cellW = Math.floor((iw - gapX * (plan.cols - 1)) / plan.cols);
    var t = TIER[plan.tier], ns = D.u(t[0] * D.s), ds = D.u(t[1] * D.s);
    var rows = plan.mode === 'rows';
    var maxD = rows ? D.u(f === 'story' ? 120 : 104) : Math.min(Math.round(cellW * 0.74), D.u(use === 'session' ? 220 : 300));
    var minD = D.u((rows ? 54 : 70) * D.s);
    var cells = shown.map(function (s) {
      var txt = '<b class="n pp-fit" data-fit-group="n" data-fit="' + ns + ',' + Math.round(ns * 0.68) + ',2" style="font-size:' + ns + 'px">' + esc(D.P(s, 'name')) + '</b>' +
        '<span class="d pp-fit" data-fit-group="d" data-fit="' + ds + ',' + Math.round(ds * 0.86) + ',' + (rows ? 1 : 2) + '" style="font-size:' + ds + 'px">' + esc(D.P(s, 'designation')) + '</span>' +
        '<span class="c pp-fit" data-fit-group="c" data-fit="' + ds + ',' + Math.round(ds * 0.86) + ',' + (rows ? 1 : 2) + '" style="font-size:' + ds + 'px">' + esc(D.P(s, 'company')) + '</span>';
      return '<div class="pp-pc" style="width:' + cellW + 'px">' + photoVar(D, s) + (rows ? '<div class="t">' + txt + '</div>' : txt) + '</div>';
    });
    if (more > 0) {
      cells.push('<div class="pp-pc pp-more" style="width:' + cellW + 'px"><div class="pp-ph' + (D.look.square ? ' sq' : '') + '" style="width:var(--d);height:var(--d)">' +
        '<b style="font-size:calc(var(--d) * .3)">+' + more + '</b></div>' +
        (rows ? '<div class="t"><b class="n" style="font-size:' + ns + 'px">more speakers</b></div>' : '<b class="n" style="font-size:' + ns + 'px">more speakers</b>') + '</div>');
    }
    return '<div class="pp-people' + (rows ? ' rows' : '') + '" data-shrink="--d,' + maxD + ',' + minD + '" style="--d:' + maxD + 'px;column-gap:' + gapX + 'px;row-gap:' + gapY + 'px">' + cells.join('') + '</div>';
  }
  function photoVar(D, s) {
    var src = pic(s.photoUrl);
    return '<div class="pp-ph' + (D.look.square ? ' sq' : '') + '" style="width:var(--d);height:var(--d)">' +
      (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="pp-ini" style="font-size:calc(var(--d) * .34)">' + esc(initials(D.P(s, 'name') || s.name)) + '</span>') + '</div>';
  }

  /* The site's address as a QR code: dark squares on a white tile (a code must be dark on light to scan, on
     any background), with the quiet margin a reader needs, drawn as one SVG path so it stays sharp in the
     PNG. Error correction M: still reads with a scuff or a glare. */
  function qrSvg(url, px) {
    var Q = window.qrcode;
    if (!Q) return '';
    try {
      if (Q.stringToBytesFuncs && Q.stringToBytesFuncs['UTF-8']) Q.stringToBytes = Q.stringToBytesFuncs['UTF-8'];
      var q = Q(0, 'M'); q.addData(url); q.make();
      var n = q.getModuleCount(), quiet = 2, size = n + quiet * 2, d = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code: ' + esc(url) + '">' +
        '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path d="' + d + '" fill="#111111"/></svg>';
    } catch (e) { return ''; }
  }
  function qrHtml(D, url, label) {
    var px = D.u(D.fmt.id === 'story' ? 190 : D.fmt.id === 'landscape' ? 130 : 150);
    var svg = qrSvg(url, px);
    if (!svg) return '';
    return '<div class="pp-qr"><span class="pp-qr-code">' + svg + '</span><span class="pp-qr-t">' + esc(label) + '</span></div>';
  }

  function footHtml(D) {
    var foot = D.type.foot ? D.type.foot(D) : null;
    var left;
    if (foot) left = foot.left();
    else {
      var d = D.T('date'), p = D.T('place');
      left = (d ? '<span class="pp-wi">' + ICON.cal + '<span>' + esc(d) + '</span></span>' : '') +
        (d && p ? '<span class="pp-bar"></span>' : '') +
        (p ? '<span class="pp-wi">' + ICON.pin + '<span>' + esc(p) + '</span></span>' : '');
    }
    var cta = D.T('cta');
    var link = linkOf(D.kit), qrLabel = D.T('qrLabel');
    var qr = link && qrLabel ? qrHtml(D, link, qrLabel) : '';
    if (!left && !cta && !qr) return '';
    var story = D.fmt.id === 'story';
    var right = (cta ? '<span class="pp-cta"' + (story ? ' style="align-self:center"' : '') + '>' + esc(cta) + '</span>' : '') + qr;
    return '<div class="pp-foot"' + (story ? ' style="flex-direction:column;align-items:stretch;gap:' + D.u(30) + 'px;text-align:center"' : '') + '>' +
      '<div class="pp-when" data-fitw="' + D.u(24) + ',' + D.u(18) + '"' + (story ? ' style="justify-content:center"' : '') + '>' + left + '</div>' +
      (qr ? '<div class="pp-foot-r"' + (story ? ' style="justify-content:center"' : '') + '>' + right + '</div>' : right) + '</div>';
  }

  function topHtml(D) {
    var left;
    if (D.type.topLeft === 'edition') left = D.T('edition') ? '<span class="pp-edition">' + esc(D.T('edition')) + '</span>' : '<span></span>';
    else left = logoHtml(D, 'top', 'left');
    var tag = D.T('hashtag');
    return '<div class="pp-top">' + left + (tag ? '<span class="pp-tag">' + esc(tag) + '</span>' : '') + '</div>';
  }

  function postHtml(D) {
    var L = D.look, f = D.fmt;
    var vars = [
      'width:' + f.w + 'px', 'height:' + f.h + 'px', '--k:' + f.k,
      '--pp-base:' + L.base, '--pp-base-soft:' + L.baseSoft, '--pp-ink:' + L.ink, '--pp-head-ink:' + L.headInk, '--pp-muted:' + L.muted,
      '--pp-acc:' + L.acc, '--pp-acc-ink:' + L.accInk, '--pp-acc-text:' + L.accText, '--pp-key:' + L.key,
      '--pp-line:' + L.line, '--pp-tile:' + L.tile, '--pp-tile-line:' + L.tileLine, '--pp-glow:' + L.glow,
      '--pp-head:' + L.head, '--pp-body:' + L.body, '--pp-r:' + L.r + 'px', '--pp-cta-r:' + L.ctaR + 'px'
    ].join(';');
    var bg = L.pic && pic(L.pic) ? '<div class="pp-bg"><img src="' + esc(pic(L.pic)) + '" alt=""></div>' : '';
    return '<div class="pp pp-' + f.id + '" data-type="' + D.type.id + '" style="' + esc(vars) + '">' +
      '<div class="pp-bg" style="background:' + esc(L.fill) + '"></div>' + bg +
      '<div class="pp-veil" style="background:' + esc(L.veil) + '"></div>' +
      '<div class="pp-frame" style="padding:' + f.pt + 'px ' + f.px + 'px ' + f.pb + 'px">' +
        topHtml(D) + '<div class="pp-mid">' + D.type.mid.call(D.type, D) + '</div>' + footHtml(D) +
      '</div></div>';
  }

  /* ============================================================
     FITTING

     Runs on the post in the page, at its real size, once its fonts are in. In order: every text is set as big
     as its limits allow and stepped down until it fits its lines; texts that belong together (the names on a
     line-up) then all take the smallest of their sizes, so they match; a grid of pictures shrinks until the
     middle zone holds it; and only a text that still does not fit at its smallest size ends in "…".
     ============================================================ */
  function lineHeightOf(el) {
    var lh = parseFloat(getComputedStyle(el).lineHeight);
    return isNaN(lh) ? parseFloat(el.style.fontSize || '20') * 1.2 : lh;
  }
  /* half a line of slack: with a line height under 1 the letters themselves stand out of their line, and that
     must not be counted as one more line */
  function tooBig(el, lines) {
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > lineHeightOf(el) * (lines + 0.5);
  }
  function specOf(el) {
    var f = String(el.getAttribute('data-fit')).split(',');
    return { max: +f[0], min: +f[1], lines: +f[2] || 1 };
  }
  function sizeDown(el) {
    var s = specOf(el), size = s.max;
    el.style.fontSize = size + 'px';
    while (size > s.min && tooBig(el, s.lines)) {
      size = Math.max(s.min, size - Math.max(1, Math.round(size * 0.04)));
      el.style.fontSize = size + 'px';
    }
    return size;
  }
  /* the last resort: the words that fit, then "…" (a word longer than the line may break) */
  function clampText(el) {
    var s = specOf(el);
    if (!tooBig(el, s.lines)) return;
    if (el.getAttribute('data-noclamp')) { el.style.overflowWrap = 'anywhere'; return; }
    var full = el.getAttribute('data-full') || el.textContent;
    el.setAttribute('data-full', full);
    el.style.overflowWrap = 'anywhere';
    if (!tooBig(el, s.lines)) return;
    var words = full.split(/\s+/), lo = 0, hi = words.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      el.textContent = words.slice(0, mid).join(' ').replace(/[\s,;:.\-–—&|·]+$/, '') + '…';
      if (tooBig(el, s.lines)) hi = mid - 1; else lo = mid;
    }
    el.textContent = lo ? words.slice(0, lo).join(' ').replace(/[\s,;:.\-–—&|·]+$/, '') + '…' : full.slice(0, 1) + '…';
  }
  function fitTexts(node) {
    var groups = {};
    Array.prototype.forEach.call(node.querySelectorAll('[data-fit]'), function (el) {
      if (el.hasAttribute('data-full')) el.textContent = el.getAttribute('data-full');
      el.style.overflowWrap = '';
      if (!el.textContent.trim()) return;
      var size = sizeDown(el), g = el.getAttribute('data-fit-group');
      if (g) groups[g] = Math.min(has(groups, g) ? groups[g] : 1e9, size);
    });
    Object.keys(groups).forEach(function (g) {
      Array.prototype.forEach.call(node.querySelectorAll('[data-fit-group="' + g + '"]'), function (el) { el.style.fontSize = groups[g] + 'px'; });
    });
  }
  function clampAll(node) {
    Array.prototype.forEach.call(node.querySelectorAll('[data-fit]'), function (el) { if (el.textContent.trim()) clampText(el); });
  }
  function overflowing(el) { return el.scrollHeight > el.clientHeight + 1; }
  function shrinkBoxes(node) {
    var mid = node.querySelector('.pp-mid');
    Array.prototype.forEach.call(node.querySelectorAll('[data-shrink]'), function (box) {
      var a = box.getAttribute('data-shrink').split(','), v = a[0], size = +a[1], min = +a[2];
      box.style.setProperty(v, size + 'px');
      while (size > min && overflowing(mid)) {
        size = Math.max(min, size - Math.max(2, Math.round(size * 0.04)));
        box.style.setProperty(v, size + 'px');
      }
    });
  }
  function fitWidths(node) {
    Array.prototype.forEach.call(node.querySelectorAll('[data-fitw]'), function (el) {
      var a = el.getAttribute('data-fitw').split(','), size = +a[0], min = +a[1];
      var spans = el.querySelectorAll('.pp-wi');
      Array.prototype.forEach.call(spans, function (s) { s.style.flexShrink = '0'; });
      el.style.fontSize = size + 'px';
      while (size > min && el.scrollWidth > el.clientWidth + 1) { size -= 1; el.style.fontSize = size + 'px'; }
      Array.prototype.forEach.call(spans, function (s) { s.style.flexShrink = ''; });
    });
  }
  function finish(node) {
    fitWidths(node);
    fitTexts(node);
    shrinkBoxes(node);
    clampAll(node);
    var mid = node.querySelector('.pp-mid');
    node.setAttribute('data-overflow', mid && overflowing(mid) ? '1' : '0');
    return node;
  }

  /* the post drawn into host (its only child), fitted. The pictures must already be in PICS (want()). */
  /* A post that still does not fit its middle zone (twenty people with long titles on a square) is drawn again,
     tighter each time: smaller type and pictures, then fewer people with "+N more" in the last place. */
  function drawInto(host, kit, cfg, fmtId) {
    for (var sq = 0; sq < 6; sq++) {
      var D = makeD(kit, cfg, fmtId, sq);
      host.innerHTML = postHtml(D);
      finish(host.firstChild);
      if (host.firstChild.getAttribute('data-overflow') !== '1') break;
    }
    return host.firstChild;
  }
  function urlsFor(kit, cfg) {
    var D = makeD(kit, cfg);
    var t = D.type, out = [];
    if (D.look.pic) out.push(D.look.pic);
    if (D.look.logo) out.push(D.look.logo.url);
    if (t.urls) out = out.concat(t.urls.call(t, D));
    return out;
  }
  function picturesReady(node) {
    return Promise.all(Array.prototype.map.call(node.querySelectorAll('img'), function (img) {
      if (img.complete && img.naturalWidth) return null;
      return (img.decode ? img.decode() : Promise.resolve()).catch(function () {});
    }));
  }

  /* ============================================================
     THE STUDIO
     ============================================================ */
  var root, KIT, EVENT_ID, toast;
  var LAST = { format: 'portrait', background: '' };
  var ED = null;           // the post being edited: { cfg, savedId, name, dirty }
  var SAVED = null, SAVED_ERR = '';
  var fontsReady = null;

  function remember() { try { localStorage.setItem('revamp-promo-posts', JSON.stringify(LAST)); } catch (e) {} }
  function recall() {
    try {
      var v = JSON.parse(localStorage.getItem('revamp-promo-posts') || '{}');
      if (v && FMT[v.format]) LAST.format = v.format;
      if (v && /^(picture|theme|site)$/.test(v.background)) LAST.background = v.background;
    } catch (e) {}
  }
  function defaultBackground() {
    if (LAST.background && (LAST.background !== 'picture' || pictureOf(KIT))) return LAST.background;
    return pictureOf(KIT) ? 'picture' : 'site';
  }
  function newCfg(typeId) {
    var t = TYPE[typeId];
    return { type: typeId, format: LAST.format, background: defaultBackground(), picks: t.pickDefaults ? t.pickDefaults(KIT) : {}, texts: {}, caption: null, network: 'linkedin' };
  }
  function typeNeed(t) { return t.need(KIT); }
  function fail(msg, err) {
    if (err) console.error(msg, err);
    toast(msg + (err && err.message ? ' ' + err.message : ''), { kind: 'error' });
  }
  function spin() { return '<span class="spin" aria-hidden="true"></span>'; }

  /* fonts are loaded once; a font that never answers must not hold the studio up for ever */
  function waitFonts() {
    if (!fontsReady) {
      fontsReady = Promise.race([
        P.ensureFonts(KIT).catch(function () {}),
        new Promise(function (r) { setTimeout(r, 6000); })
      ]);
    }
    return fontsReady;
  }

  /* ---------------- gallery ---------------- */
  function showGallery() {
    ED = null;
    window.removeEventListener('beforeunload', onLeave);
    var speakers = speakersOf(KIT).length;
    var fmtOpts = FORMATS.map(function (f) {
      return '<option value="' + f.id + '"' + (f.id === LAST.format ? ' selected' : '') + '>' + f.label + ' · ' + f.w + ' × ' + f.h + '</option>';
    }).join('');
    var cards = TYPES.map(function (t) {
      var need = typeNeed(t);
      var count = t.count ? t.count(KIT) : 0;
      var noun = { speaker: 'speakers', partner: 'partners', session: 'sessions' }[t.per];
      var sub = need ? '' : !t.per ? t.blurb : count === 1 ? 'One post, for the event’s only ' + t.per + '.' : 'One post for each of the ' + count + ' ' + noun + '.';
      var thumb = need
        ? '<div class="ps-thumb ps-thumb-off" style="aspect-ratio:' + FMT[LAST.format].w + '/' + FMT[LAST.format].h + '">' + ICON.lock + '<span class="ps-why">' + esc(need.why) + '</span></div>'
        : '<div class="ps-thumb" data-thumb="' + t.id + '" style="aspect-ratio:' + FMT[LAST.format].w + '/' + FMT[LAST.format].h + '">' + spin() + '</div>';
      if (need) {
        return '<div class="ps-card off" aria-disabled="true">' + thumb + '<div class="ps-card-body"><b>' + esc(t.label) + '</b>' +
          (need.fix ? '<span class="ps-why"><a href="' + esc(fixLink(EVENT_ID, need.fix[1])) + '">' + esc(need.fix[0]) + '</a></span>' : '<span>Not available for this event.</span>') + '</div></div>';
      }
      return '<button type="button" class="ps-card" data-open="' + t.id + '" aria-label="' + esc(t.label + '. ' + sub) + '">' + thumb +
        '<div class="ps-card-body"><b>' + esc(t.label) + '</b><span>' + esc(sub) + '</span></div></button>';
    }).join('');
    root.innerHTML = '<div class="ps">' +
      '<div class="ps-bar"><p class="ps-note">Each post is drawn in this site’s own look — its picture, logo unit, fonts and colours — from its real content. Pick one to change its words and download it.</p>' +
        '<label for="ps-gfmt">Format <select class="inp" id="ps-gfmt">' + fmtOpts + '</select></label>' +
        (speakers && !typeNeed(TYPE.speaker) ? '<button type="button" class="btn btn-secondary" id="ps-batch">' + ICON.down + '<span>Download all speaker spotlights</span></button>' : '') +
      '</div>' +
      '<div class="ps-grid">' + cards + '</div>' +
      '<section class="panel ps-saved" aria-labelledby="ps-saved-h"><div class="panel-head"><h3 id="ps-saved-h">Saved posts</h3><span class="sub">Kept for this event, for everyone who works on it</span></div>' +
        '<div class="panel-body tight" id="ps-saved-body">' + savedHtml() + '</div></section>' +
    '</div>';
    root.querySelector('#ps-gfmt').onchange = function () { LAST.format = this.value; remember(); showGallery(); };
    var batch = root.querySelector('#ps-batch');
    if (batch) batch.onclick = function () { batchSpeakers(batch, { format: LAST.format, background: defaultBackground(), texts: {} }); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-open]'), function (b) {
      b.onclick = function () { openEditor(newCfg(b.getAttribute('data-open')), null, ''); };
    });
    wireSaved();
    drawThumbs();
  }

  /* A post is fitted by measuring it in the page, and shown at the width of its box: neither can be done while
     the studio is hidden behind the Mailers tab (every size reads 0). What would be drawn then is left for
     shown(), which marketing.html calls when the tab comes back. */
  function hiddenNow() { return !root || !root.getClientRects().length; }
  var pendingShow = { thumbs: false, stage: false };

  var thumbToken = 0;
  function drawThumbs() {
    var token = ++thumbToken;
    pendingShow.thumbs = false;
    var boxes = Array.prototype.slice.call(root.querySelectorAll('[data-thumb]:not([data-drawn])'));
    waitFonts().then(function () {
      /* one at a time, in order: the first cards appear first */
      return boxes.reduce(function (chain, box) {
        return chain.then(function () {
          if (token !== thumbToken || !document.body.contains(box)) return null;
          if (hiddenNow()) { pendingShow.thumbs = true; return null; }
          var cfg = newCfg(box.getAttribute('data-thumb'));
          return want(urlsFor(KIT, cfg)).then(function () {
            if (token !== thumbToken) return;
            if (hiddenNow()) { pendingShow.thumbs = true; return; }
            var f = FMT[cfg.format];
            var s = box.clientWidth / f.w;
            box.innerHTML = '<div class="ps-scale" style="transform:scale(' + s + ')"></div>';
            drawInto(box.firstChild, KIT, cfg);
            box.setAttribute('data-drawn', '1');
          }).catch(function (err) {
            console.error('Post preview failed:', err);
            box.innerHTML = '<span class="ps-why">The preview could not be drawn.</span>';
          });
        });
      }, Promise.resolve());
    });
  }
  function rescaleThumbs() {
    if (!root || ED || hiddenNow()) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-thumb] .ps-scale'), function (sc) {
      var f = FMT[LAST.format];
      sc.style.transform = 'scale(' + (sc.parentNode.clientWidth / f.w) + ')';
    });
  }

  /* ---------------- saved posts ---------------- */
  function loadSaved() {
    SAVED_ERR = '';
    return P.list('post').then(function (items) { SAVED = items; }, function (err) {
      console.error('Saved posts did not load:', err);
      SAVED = null; SAVED_ERR = err && err.message ? err.message : 'The saved posts could not be loaded.';
    }).then(repaintSaved);
  }
  function repaintSaved() {
    var b = root && root.querySelector('#ps-saved-body');
    if (b) { b.innerHTML = savedHtml(); wireSaved(); }
  }
  function savedHtml() {
    if (SAVED_ERR) return '<div class="ps-saved-empty">' + esc(SAVED_ERR) + ' <button type="button" class="btn btn-sm btn-secondary" data-saved-retry>Try again</button></div>';
    if (!SAVED) return '<div class="ps-saved-empty">' + spin() + ' Loading saved posts…</div>';
    if (!SAVED.length) return '<div class="ps-saved-empty">Nothing saved yet. Open a post type above, then use Save.</div>';
    return '<ul class="ps-saved-list">' + SAVED.map(function (it) {
      var c = it.config || {}, t = TYPE[c.type], f = FMT[c.format];
      var when = it.updatedAt ? new Date(it.updatedAt) : null;
      return '<li data-sid="' + esc(it.id) + '"><div class="nm"><b>' + esc(it.name || 'Untitled') + '</b><span>' + esc([t ? t.label : 'Unknown type', f ? f.label : '', when && !isNaN(when) ? 'saved ' + when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(' · ')) + '</span></div>' +
        '<button type="button" class="btn btn-sm btn-secondary" data-s-open' + (t ? '' : ' disabled') + '>Open</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-s-rename>Rename</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-s-del>Delete</button></li>';
    }).join('') + '</ul>';
  }
  function savedItem(id) { for (var i = 0; i < (SAVED || []).length; i++) if (SAVED[i].id === id) return SAVED[i]; return null; }
  function wireSaved() {
    var body = root.querySelector('#ps-saved-body');
    if (!body) return;
    var retry = body.querySelector('[data-saved-retry]');
    if (retry) retry.onclick = function () { SAVED = null; SAVED_ERR = ''; body.innerHTML = savedHtml(); loadSaved(); };
    Array.prototype.forEach.call(body.querySelectorAll('li[data-sid]'), function (li) {
      var it = savedItem(li.getAttribute('data-sid'));
      li.querySelector('[data-s-open]').onclick = function () { openSaved(it); };
      li.querySelector('[data-s-rename]').onclick = function () { renameRow(li, it); };
      li.querySelector('[data-s-del]').onclick = function () { deleteRow(li, it); };
    });
  }
  function openSaved(it) {
    var c = clone(it.config || {});
    var t = TYPE[c.type];
    if (!t) { fail('This saved post is of a type the studio no longer makes.'); return; }
    if (typeNeed(t)) { fail('This post cannot be opened: ' + typeNeed(t).why); return; }
    var cfg = newCfg(c.type);
    if (FMT[c.format]) cfg.format = c.format;
    if (/^(picture|theme|site)$/.test(c.background)) cfg.background = c.background;
    cfg.texts = c.texts && typeof c.texts === 'object' ? c.texts : {};
    /* a post saved while the speaker's kicker and session line, and the partner's tier, were not yet kept per
       speaker / partner: they belong to the one it was saved for */
    var own = c.type === 'speaker' && c.picks && c.picks.speaker ? { kicker: 'sp:' + c.picks.speaker + ':kicker', sessionNote: 'sp:' + c.picks.speaker + ':session' }
      : c.type === 'partner' && c.picks && c.picks.partner ? { tierLine: 'pt:' + c.picks.partner + ':tier' } : {};
    Object.keys(own).forEach(function (k) {
      if (has(cfg.texts, k)) { if (!has(cfg.texts, own[k])) cfg.texts[own[k]] = cfg.texts[k]; delete cfg.texts[k]; }
    });
    cfg.caption = typeof c.caption === 'string' ? c.caption : null;
    cfg.network = /^(linkedin|instagram|x)$/.test(c.network) ? c.network : 'linkedin';
    /* what it was about may have been removed from the event since */
    var picks = c.picks || {}, gone = false;
    if (picks.speaker) { if (byId(speakersOf(KIT), picks.speaker)) cfg.picks.speaker = picks.speaker; else gone = true; }
    if (picks.partner) { if (byId(partnersOf(KIT), picks.partner)) cfg.picks.partner = picks.partner; else gone = true; }
    if (picks.session) { if (byId(sessionsOf(KIT), picks.session)) cfg.picks.session = picks.session; else gone = true; }
    if (picks.speakers) { var s = picks.speakers.filter(function (id) { return byId(speakersOf(KIT), id); }); if (s.length < picks.speakers.length) gone = true; if (s.length) cfg.picks.speakers = s; }
    if (picks.partners) { var p = picks.partners.filter(function (id) { return byId(partnersOf(KIT), id); }); if (p.length < picks.partners.length) gone = true; if (p.length) cfg.picks.partners = p; }
    openEditor(cfg, it.id, it.name || '');
    if (gone) toast('Part of what this post showed has since been removed from the event; it shows what is there now.', { kind: 'info' });
  }
  function renameRow(li, it) {
    var nm = li.querySelector('.nm');
    var keep = nm.innerHTML;
    nm.innerHTML = '<input class="inp" maxlength="120" aria-label="New name for this post" value="' + esc(it.name || '') + '">';
    var inp = nm.querySelector('input'), finished = false;
    inp.focus(); inp.select();
    function done(save) {
      if (finished) return;
      finished = true;
      var v = inp.value.trim();
      if (!save || !v || v === it.name) { nm.innerHTML = keep; return; }
      inp.disabled = true;
      P.save('post', { id: it.id, name: v, config: it.config }).then(function () {
        it.name = v; repaintSaved(); toast('Renamed.'); loadSaved();
      }, function (err) { nm.innerHTML = keep; fail('The post was not renamed.', err); });
    }
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    inp.onblur = function () { done(true); };
  }
  function deleteRow(li, it) {
    var acts = Array.prototype.slice.call(li.querySelectorAll('button'));
    acts.forEach(function (b) { b.hidden = true; });
    var ask = document.createElement('span');
    ask.className = 'ps-row';
    ask.innerHTML = '<span class="ps-note">Delete “' + esc(it.name || 'Untitled') + '”?</span><button type="button" class="btn btn-sm btn-secondary" data-no>Keep</button><button type="button" class="btn btn-sm btn-danger" data-yes>Delete</button>';
    li.appendChild(ask);
    ask.querySelector('[data-no]').focus();
    ask.querySelector('[data-no]').onclick = function () { ask.remove(); acts.forEach(function (b) { b.hidden = false; }); };
    ask.querySelector('[data-yes]').onclick = function () {
      this.disabled = true;
      P.remove(it.id).then(function () {
        SAVED = (SAVED || []).filter(function (x) { return x.id !== it.id; });
        repaintSaved();
        toast('Deleted.');
        loadSaved();
      }, function (err) {
        ask.remove(); acts.forEach(function (b) { b.hidden = false; }); fail('The post was not deleted.', err);
      });
    };
  }

  /* ---------------- editor ---------------- */
  function onLeave(e) { if (ED && ED.dirty) { e.preventDefault(); e.returnValue = ''; } }

  function openEditor(cfg, savedId, name) {
    var t = TYPE[cfg.type];
    ED = { cfg: cfg, savedId: savedId, name: name, dirty: false, sugg: null };
    window.addEventListener('beforeunload', onLeave);
    root.innerHTML = '<div class="ps">' +
      '<div class="ps-ed-head">' +
        '<button type="button" class="btn btn-secondary" id="ps-back">' + ICON.back + '<span>All posts</span></button>' +
        '<div class="ps-ed-title"><h3>' + esc(t.label) + '</h3><span id="ps-ed-sub"></span></div>' +
        '<span id="ps-ask"></span>' +
      '</div>' +
      '<div class="ps-ed">' +
        '<div class="ps-stage-wrap"><div class="ps-stage" id="ps-stage"><div class="ps-stage-msg">' + spin() + '</div></div>' +
          '<div class="ps-stage-meta"><b id="ps-size"></b><span id="ps-fmt-use"></span><span class="ps-sp"></span><span id="ps-pic-note"></span></div></div>' +
        '<div class="ps-panel" id="ps-panel"></div>' +
      '</div></div>';
    root.querySelector('#ps-back').onclick = leaveEditor;
    paintPanel();
    redraw(true);
    /* the editor's own heading goes to the top of the window, so the whole preview is in view */
    var head = root.querySelector('.ps-ed-head'), bar = document.querySelector('.topbar');
    window.scrollTo(0, Math.max(0, head.getBoundingClientRect().top + window.pageYOffset - (bar ? bar.offsetHeight : 0) - 12));
    var back = root.querySelector('#ps-back');
    if (back) back.focus({ preventScroll: true });
  }

  function leaveEditor() {
    if (!ED || !ED.dirty) { showGallery(); return; }
    var host = root.querySelector('#ps-ask');
    host.innerHTML = '<span class="ps-ask" role="alert">This post has changes that are not saved. <button type="button" class="btn btn-sm btn-secondary" data-keep>Keep editing</button><button type="button" class="btn btn-sm btn-danger" data-go>Leave without saving</button></span>';
    host.querySelector('[data-keep]').focus();
    host.querySelector('[data-keep]').onclick = function () { host.innerHTML = ''; };
    host.querySelector('[data-go]').onclick = function () { ED.dirty = false; showGallery(); };
  }

  function instanceName(cfg) {
    var t = TYPE[cfg.type], i = t.instance ? t.instance(KIT, cfg) : '';
    return t.label + (i ? ' — ' + i : '') + ' (' + FMT[cfg.format].label + ')';
  }

  function seg(id, items, current, cls) {
    return '<div class="ps-seg ' + (cls || '') + '" role="group" id="' + id + '">' + items.map(function (it) {
      return '<button type="button" data-v="' + it.id + '" aria-pressed="' + (it.id === current) + '"' + (it.disabled ? ' disabled title="' + esc(it.disabled) + '"' : '') + '><b>' + esc(it.label) + '</b>' +
        (it.note ? '<span>' + esc(it.note) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function picksHtml() {
    var cfg = ED.cfg, t = TYPE[cfg.type];
    function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    if (cfg.type === 'speaker') {
      return '<div class="field"><label for="ps-pick">Speaker</label><select class="inp" id="ps-pick">' + speakersOf(KIT).map(function (s) {
        return opt(s.id, s.name + (s.company ? ' — ' + s.company : ''), cfg.picks.speaker);
      }).join('') + '</select></div>';
    }
    if (cfg.type === 'partner') {
      return '<div class="field"><label for="ps-pick">Partner</label><select class="inp" id="ps-pick">' + partnersOf(KIT).map(function (p) {
        return opt(p.id, p.name + (p.tier ? ' — ' + p.tier : ''), cfg.picks.partner);
      }).join('') + '</select></div>';
    }
    if (cfg.type === 'session') {
      return '<div class="field"><label for="ps-pick">Session</label><select class="inp" id="ps-pick">' + sessionsOf(KIT).map(function (s) {
        return opt(s.id, (sessionWhen(s) ? sessionWhen(s) + ' — ' : '') + s.title, cfg.picks.session);
      }).join('') + '</select></div>';
    }
    if (cfg.type === 'lineup' || cfg.type === 'partners') {
      var isP = cfg.type === 'partners';
      var all = isP ? partnersOf(KIT) : speakersOf(KIT), key = isP ? 'partners' : 'speakers';
      var chosen = cfg.picks[key] || [];
      var quick = isP ? '' : '<div class="ps-quick">' + [4, 8, 16].filter(function (n) { return n < all.length; }).map(function (n) {
        return '<button type="button" class="btn btn-sm btn-secondary" data-top="' + n + '">Top ' + n + '</button>';
      }).join('') + '<button type="button" class="btn btn-sm btn-secondary" data-top="' + all.length + '">All ' + all.length + '</button></div>';
      var cap = isP ? 0 : peoplePlan(chosen.length, cfg.format).cap;
      return '<div class="field"><span class="flabel" style="font-size:12px;font-weight:700;margin-bottom:5px">' + (isP ? 'Partners on the post' : 'Speakers on the post') + ' <span class="ps-count" id="ps-pick-n">' + chosen.length + ' of ' + all.length + '</span></span>' +
        quick + '<div class="ps-picks" id="ps-picks" style="margin-top:7px">' + all.map(function (x) {
          return '<label><input type="checkbox" value="' + esc(x.id) + '"' + (chosen.indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + esc(x.name) +
            '<small>' + esc(isP ? (x.tier || '') : [x.designation, x.company].filter(Boolean).join(', ')) + '</small></span></label>';
        }).join('') + '</div>' +
        (!isP && chosen.length > cap ? '<p class="hint">This format shows ' + (cap - 1) + ' of them and “+' + (chosen.length - cap + 1) + ' more speakers”.</p>' : '<p class="hint">In the site’s own order.</p>') + '</div>';
    }
    return '';
  }

  function textFieldsHtml() {
    var D = makeD(KIT, ED.cfg);
    var headKey = typeof D.type.headline === 'function' ? D.type.headline(D) : D.type.headline;
    return groupsOf(D).map(function (g, gi) {
      return '<div class="ps-group"><b>' + esc(g.title) + '</b>' + g.fields.map(function (f, fi) {
        var id = 'ps-f-' + gi + '-' + fi, v = D.T(f.key);
        var ctl = f.long
          ? '<textarea class="inp" id="' + id + '" data-key="' + esc(f.key) + '" rows="2">' + esc(v) + '</textarea>'
          : '<input class="inp" id="' + id + '" data-key="' + esc(f.key) + '" value="' + esc(v) + '"' + (f.key === 'hashtag' ? ' placeholder="#YourEvent"' : '') + '>';
        var ai = f.key === headKey ? '<button type="button" class="btn btn-sm btn-ghost" data-suggest="' + esc(f.key) + '" style="margin-left:auto">Suggest headlines</button>' : '';
        var reset = has(ED.cfg.texts, f.key) && String(ED.cfg.texts[f.key]) !== String(f.def == null ? '' : f.def)
          ? '<button type="button" class="btn btn-sm btn-ghost" data-reset="' + esc(f.key) + '" title="Back to: ' + esc(f.def || '(empty)') + '">Reset</button>' : '';
        return '<div class="field"><label for="' + id + '">' + esc(f.label) + reset + ai + '</label>' + ctl +
          (f.key === headKey ? '<div class="ps-sugg" data-sugg-for="' + esc(f.key) + '"></div>' : '') + '</div>';
      }).join('') + '</div>';
    }).join('');
  }

  function captionText() {
    if (ED.cfg.caption != null) return ED.cfg.caption;
    var D = makeD(KIT, ED.cfg);
    return D.type.caption.call(D.type, D, ED.cfg.network);
  }

  function paintPanel() {
    var cfg = ED.cfg, t = TYPE[cfg.type];
    var pic = pictureOf(KIT);
    var bgs = BACKGROUNDS.map(function (b) {
      return { id: b.id, label: b.label, note: b.id === 'picture' ? (pic ? 'Under a veil' : 'This site has none') : b.id === 'theme' ? 'Solid, in the theme' : 'Plain, like the page', disabled: b.id === 'picture' && !pic ? 'This site has no picture to use.' : '' };
    });
    var net = NETWORKS.filter(function (n) { return n.id === cfg.network; })[0] || NETWORKS[0];
    var cap = captionText();
    var name = ED.name || instanceName(cfg);
    var html =
      '<section class="panel"><div class="panel-head"><h3>Format and background</h3></div><div class="panel-body">' +
        seg('ps-format', FORMATS.map(function (f) { return { id: f.id, label: f.label, note: f.w + ' × ' + f.h }; }), cfg.format) +
        seg('ps-bg', bgs, cfg.background, 'three') +
        (picksHtml() ? '<div class="ps-group" style="border-top:0;padding-top:0">' + picksHtml() + '</div>' : '') +
      '</div></section>' +
      '<section class="panel"><div class="panel-head"><h3>Words</h3><span class="sub">Every change shows at once</span></div><div class="panel-body" id="ps-texts">' + textFieldsHtml() + '</div></section>' +
      '<section class="panel"><div class="panel-head"><h3>Caption</h3></div><div class="panel-body">' +
        seg('ps-net', NETWORKS.map(function (n) { return { id: n.id, label: n.label }; }), cfg.network, 'three') +
        '<div class="field"><label for="ps-caption">Caption for ' + esc(net.label) + ' <span class="ps-count" id="ps-cap-n" style="margin-left:auto"></span></label>' +
          '<textarea class="inp" id="ps-caption" rows="7">' + esc(cap) + '</textarea>' +
          '<p class="hint">Made from the event’s facts. Edit it freely.</p></div>' +
        '<div class="ps-row"><button type="button" class="btn btn-sm btn-secondary" id="ps-cap-ai">Write with AI</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" id="ps-cap-copy">Copy caption</button>' +
          (cfg.caption != null ? '<button type="button" class="btn btn-sm btn-ghost" id="ps-cap-reset">Back to the facts</button>' : '') + '</div>' +
      '</div></section>' +
      '<section class="panel"><div class="panel-head"><h3>Download and save</h3></div><div class="panel-body">' +
        '<div class="ps-actions">' +
          '<button type="button" class="btn btn-primary" id="ps-png">' + ICON.down + '<span>Download PNG</span></button>' +
          '<button type="button" class="btn btn-secondary" id="ps-zip">Download all formats (ZIP)</button>' +
          (cfg.type === 'speaker' && speakersOf(KIT).length > 1 ? '<button type="button" class="btn btn-secondary" id="ps-batch-ed">Download all speaker spotlights (' + speakersOf(KIT).length + ')</button>' : '') +
        '</div>' +
        '<div class="field"><label for="ps-name">Name</label><input class="inp" id="ps-name" maxlength="120" value="' + esc(name) + '"></div>' +
        '<button type="button" class="btn btn-secondary" id="ps-save">' + (ED.savedId ? 'Save changes' : 'Save') + '</button>' +
        '<p class="ps-honest">' + ICON.info + '<span>Posting straight to LinkedIn, Instagram or X is not part of this release. Download the picture, copy the caption, and post them from the event’s own account.</span></p>' +
      '</div></section>';
    var panel = root.querySelector('#ps-panel');
    panel.innerHTML = html;
    wirePanel(panel);
    countCaption();
    var sub = root.querySelector('#ps-ed-sub');
    if (sub) sub.textContent = (t.instance ? t.instance(KIT, cfg) + ' · ' : '') + FMT[cfg.format].label + ' ' + FMT[cfg.format].w + ' × ' + FMT[cfg.format].h;
  }

  function changed(redrawAlso, pics) {
    ED.dirty = true;
    /* a name nobody has typed keeps describing the post */
    var nm = root.querySelector('#ps-name');
    if (nm && !nm.getAttribute('data-typed') && !ED.savedId) nm.value = instanceName(ED.cfg);
    if (redrawAlso) redraw(pics);
  }

  function wirePanel(panel) {
    var cfg = ED.cfg;
    panel.querySelector('#ps-format').onclick = function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      cfg.format = b.getAttribute('data-v'); LAST.format = cfg.format; remember();
      pressed(this, cfg.format);
      var sub = root.querySelector('#ps-ed-sub');
      if (sub) sub.textContent = (TYPE[cfg.type].instance ? TYPE[cfg.type].instance(KIT, cfg) + ' · ' : '') + FMT[cfg.format].label + ' ' + FMT[cfg.format].w + ' × ' + FMT[cfg.format].h;
      if (cfg.type === 'lineup') refreshPicksNote();
      changed(true);
    };
    panel.querySelector('#ps-bg').onclick = function (e) {
      var b = e.target.closest('button[data-v]'); if (!b || b.disabled) return;
      var before = !!(lookFor(KIT, cfg.background).logo);
      cfg.background = b.getAttribute('data-v'); LAST.background = cfg.background; remember();
      pressed(this, cfg.background);
      /* the logo unit may not suit the new background: the name fields come and go with it */
      if (before !== !!(lookFor(KIT, cfg.background).logo)) repaintTexts();
      changed(true, true);
    };
    var pick = panel.querySelector('#ps-pick');
    if (pick) pick.onchange = function () {
      cfg.picks[{ speaker: 'speaker', partner: 'partner', session: 'session' }[cfg.type]] = this.value;
      cfg.caption = null;
      repaintTexts(); refreshCaption();
      changed(true, true);
      var sub = root.querySelector('#ps-ed-sub');
      if (sub) sub.textContent = TYPE[cfg.type].instance(KIT, cfg) + ' · ' + FMT[cfg.format].label + ' ' + FMT[cfg.format].w + ' × ' + FMT[cfg.format].h;
      if (!ED.savedId) { var nm = root.querySelector('#ps-name'); if (nm && !nm.getAttribute('data-typed')) nm.value = instanceName(cfg); }
    };
    var picks = panel.querySelector('#ps-picks');
    if (picks) {
      var key = cfg.type === 'partners' ? 'partners' : 'speakers', all = cfg.type === 'partners' ? partnersOf(KIT) : speakersOf(KIT);
      picks.onchange = function () {
        var ids = Array.prototype.filter.call(picks.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
        if (!ids.length) { toast('Keep at least one on the post.', { kind: 'info' }); this.querySelector('input').checked = true; ids = [all[0].id]; }
        /* always in the site's own order */
        cfg.picks[key] = all.filter(function (x) { return ids.indexOf(x.id) >= 0; }).map(function (x) { return x.id; });
        cfg.caption = null;
        refreshPicksNote(); repaintTexts(); refreshCaption();
        changed(true, true);
      };
      Array.prototype.forEach.call(panel.querySelectorAll('[data-top]'), function (b) {
        b.onclick = function () {
          var n = +b.getAttribute('data-top');
          cfg.picks.speakers = speakersOf(KIT).slice(0, n).map(function (s) { return s.id; });
          Array.prototype.forEach.call(picks.querySelectorAll('input'), function (i) { i.checked = cfg.picks.speakers.indexOf(i.value) >= 0; });
          cfg.caption = null;
          refreshPicksNote(); repaintTexts(); refreshCaption();
          changed(true, true);
        };
      });
    }
    wireTexts(panel.querySelector('#ps-texts'));
    panel.querySelector('#ps-net').onclick = function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      cfg.network = b.getAttribute('data-v');
      pressed(this, cfg.network);
      var lab = panel.querySelector('label[for="ps-caption"]');
      var n = NETWORKS.filter(function (x) { return x.id === cfg.network; })[0];
      if (lab) lab.firstChild.nodeValue = 'Caption for ' + n.label + ' ';
      refreshCaption();
      changed(false);
    };
    var cap = panel.querySelector('#ps-caption');
    cap.oninput = function () { cfg.caption = cap.value; countCaption(); changed(false); showCapReset(); };
    panel.querySelector('#ps-cap-copy').onclick = function () {
      var text = cap.value;
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
        .then(function () { toast('Caption copied.'); }, function () { cap.focus(); cap.select(); toast('Press Ctrl+C (⌘C on a Mac) to copy the selected caption.', { kind: 'info' }); });
    };
    wireCapReset();
    panel.querySelector('#ps-cap-ai').onclick = function () { writeCaption(this); };
    panel.querySelector('#ps-png').onclick = function () { downloadOne(this); };
    panel.querySelector('#ps-zip').onclick = function () { downloadFormats(this); };
    var be = panel.querySelector('#ps-batch-ed');
    if (be) be.onclick = function () { batchSpeakers(be, { format: cfg.format, background: cfg.background, texts: cfg.texts }); };
    var nm = panel.querySelector('#ps-name');
    nm.oninput = function () { nm.setAttribute('data-typed', '1'); ED.name = nm.value; changed(false); };
    panel.querySelector('#ps-save').onclick = function () { savePost(this); };
  }
  function wireCapReset() {
    var r = root.querySelector('#ps-cap-reset');
    if (r) r.onclick = function () { ED.cfg.caption = null; refreshCaption(); r.remove(); changed(false); };
  }
  function showCapReset() {
    if (root.querySelector('#ps-cap-reset')) return;
    var row = root.querySelector('#ps-cap-copy').parentNode;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-sm btn-ghost'; b.id = 'ps-cap-reset'; b.textContent = 'Back to the facts';
    row.appendChild(b);
    wireCapReset();
  }
  function pressed(group, v) {
    Array.prototype.forEach.call(group.querySelectorAll('button[data-v]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  function refreshPicksNote() {
    var cfg = ED.cfg, isP = cfg.type === 'partners';
    var all = isP ? partnersOf(KIT) : speakersOf(KIT), chosen = cfg.picks[isP ? 'partners' : 'speakers'] || [];
    var n = root.querySelector('#ps-pick-n');
    if (n) n.textContent = chosen.length + ' of ' + all.length;
    var hint = root.querySelector('#ps-picks') && root.querySelector('#ps-picks').parentNode.querySelector('.hint');
    if (hint && !isP) {
      var cap = peoplePlan(chosen.length, cfg.format).cap;
      hint.textContent = chosen.length > cap ? 'This format shows ' + (cap - 1) + ' of them and “+' + (chosen.length - cap + 1) + ' more speakers”.' : 'In the site’s own order.';
    }
  }
  function refreshCaption() {
    var cap = root.querySelector('#ps-caption');
    if (cap && ED.cfg.caption == null) cap.value = captionText();
    countCaption();
  }
  function countCaption() {
    var cap = root.querySelector('#ps-caption'), n = root.querySelector('#ps-cap-n');
    if (!cap || !n) return;
    var net = NETWORKS.filter(function (x) { return x.id === ED.cfg.network; })[0];
    n.textContent = cap.value.length + ' / ' + net.max;
    n.className = 'ps-count' + (cap.value.length > net.max ? ' over' : '');
  }
  function repaintTexts() {
    var box = root.querySelector('#ps-texts');
    if (!box) return;
    box.innerHTML = textFieldsHtml();
    wireTexts(box);
  }

  var typeTimer = 0;
  function wireTexts(box) {
    box.oninput = function (e) {
      var el = e.target, key = el.getAttribute && el.getAttribute('data-key');
      if (!key) return;
      ED.cfg.texts[key] = el.value;
      ED.dirty = true;
      if (ED.cfg.caption == null) { clearTimeout(refreshCaption.t); refreshCaption.t = setTimeout(refreshCaption, 250); }
      clearTimeout(typeTimer);
      typeTimer = setTimeout(function () { redraw(false); }, 90);
    };
    box.onclick = function (e) {
      var r = e.target.closest && e.target.closest('[data-reset]');
      if (r) {
        delete ED.cfg.texts[r.getAttribute('data-reset')];
        repaintTexts(); refreshCaption(); changed(true);
        return;
      }
      var s = e.target.closest && e.target.closest('[data-suggest]');
      if (s) suggest(s, s.getAttribute('data-suggest'));
      var o = e.target.closest && e.target.closest('[data-use]');
      if (o) {
        var k = o.parentNode.getAttribute('data-sugg-for');
        ED.cfg.texts[k] = o.getAttribute('data-use');
        repaintTexts(); refreshCaption(); changed(true);
      }
    };
  }

  /* ---------------- the preview ---------------- */
  var drawToken = 0;
  function redraw(loadPictures) {
    if (!ED) return;
    var cfg = ED.cfg, token = ++drawToken;
    var stage = root.querySelector('#ps-stage');
    var ready = loadPictures ? Promise.all([waitFonts(), want(urlsFor(KIT, cfg))]) : Promise.resolve();
    return ready.then(function () {
      if (token !== drawToken || !ED || ED.cfg !== cfg) return;
      if (hiddenNow()) { pendingShow.stage = true; return; }
      pendingShow.stage = false;
      var f = FMT[cfg.format];
      var box = stage.querySelector('.ps-stage-box');
      if (!box) {
        stage.innerHTML = '<div class="ps-stage-box"><div class="ps-scale"></div></div>';
        box = stage.firstChild;
      }
      var sc = box.firstChild;
      drawInto(sc, KIT, cfg);
      fitStage();
      root.querySelector('#ps-size').textContent = f.w + ' × ' + f.h;
      root.querySelector('#ps-fmt-use').textContent = f.label + ' · ' + f.use;
      var urls = urlsFor(KIT, cfg).filter(function (u) { return PIC_FAILED[u]; });
      root.querySelector('#ps-pic-note').textContent = urls.length ? (urls.length === 1 ? 'One picture could not be loaded; its place shows initials or a name.' : urls.length + ' pictures could not be loaded; their places show initials or names.') : '';
    }).catch(function (err) {
      console.error('The post could not be drawn:', err);
      stage.innerHTML = '<div class="ps-stage-msg">The post could not be drawn. ' + esc(err && err.message || '') + '</div>';
    });
  }
  function fitStage() {
    if (!ED || !root || hiddenNow()) return;
    var stage = root.querySelector('#ps-stage'), box = stage && stage.querySelector('.ps-stage-box');
    if (!box) return;
    var f = FMT[ED.cfg.format];
    var aw = stage.clientWidth - 36, ah = stage.clientHeight - 36;
    var s = Math.max(0.05, Math.min(aw / f.w, ah / f.h));
    box.style.width = Math.floor(f.w * s) + 'px';
    box.style.height = Math.floor(f.h * s) + 'px';
    box.firstChild.style.transform = 'scale(' + s + ')';
  }

  /* ---------------- AI ---------------- */
  /* What POST /api/promo/write is told about the post (functions/lib/promo.js reads body.post: its type and the
     words on it, one line each). The facts of the event it reads from the server itself. */
  var AI_KIND = { announce: 'save-the-date', speaker: 'speaker', lineup: 'speakers', partner: 'partner', partners: 'partners',
    stats: 'stats', audience: 'audience', topics: 'topics', session: 'session', countdown: 'countdown' };
  function postOf(D) {
    var post = { type: AI_KIND[D.type.id] || D.type.id }, n = 0;
    groupsOf(D).forEach(function (g, gi) {
      g.fields.forEach(function (f) {
        var v = D.T(f.key);
        if (!v || n >= 28) return;
        var k = (g.person ? 'person' + gi + '-' : '') + String(f.label).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!/^[a-z]/.test(k)) k = 'line-' + k;
        post[k.slice(0, 40)] = v; n++;
      });
    });
    return post;
  }
  function aiError(err) {
    if (err && err.status === 404) return 'Writing with AI is not available yet.';
    if (err && err.status === 429) return err.message || 'The AI has been used too much for now. Try again later.';
    return (err && err.message) || 'The AI did not answer. Try again.';
  }
  function busy(btn, on, label) {
    if (on) { btn.setAttribute('data-label', btn.innerHTML); btn.disabled = true; btn.innerHTML = spin() + '<span>' + esc(label) + '</span>'; }
    else { btn.disabled = false; if (btn.getAttribute('data-label') != null) btn.innerHTML = btn.getAttribute('data-label'); }
  }
  function suggest(btn, key) {
    var D = makeD(KIT, ED.cfg), cfg = ED.cfg;
    busy(btn, true, 'Writing…');
    P.write('headline', { post: postOf(D), current: D.T(key) }).then(function (r) {
      busy(btn, false);
      if (!ED || ED.cfg !== cfg) return;
      var opts = ((r && (r.options || r.headlines)) || (r && r.text ? [r.text] : [])).map(function (x) { return typeof x === 'string' ? x : (x && (x.text || x.headline)) || ''; })
        .map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 6);
      var box = root.querySelector('[data-sugg-for="' + key + '"]');
      if (!box) return;
      if (!opts.length) { box.innerHTML = '<span class="ps-note">No suggestions came back. Try again.</span>'; return; }
      box.innerHTML = opts.map(function (o) { return '<button type="button" data-use="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
      box.firstChild.focus();
    }, function (err) { busy(btn, false); fail(aiError(err)); });
  }
  function writeCaption(btn) {
    var D = makeD(KIT, ED.cfg), cfg = ED.cfg;
    var cap = root.querySelector('#ps-caption'), before = cap.value;
    busy(btn, true, 'Writing…');
    P.write('caption', { post: postOf(D), network: cfg.network, current: before }).then(function (r) {
      busy(btn, false);
      if (!ED || ED.cfg !== cfg) return;
      var text = r && (r.text || (r.options && r.options[0] && (r.options[0].text || r.options[0])));
      if (!text || typeof text !== 'string') { fail('No caption came back. Try again.'); return; }
      cfg.caption = text; cap.value = text; countCaption(); showCapReset(); ED.dirty = true;
      toast('Caption written.', { action: { label: 'Undo', onClick: function () { if (ED && ED.cfg === cfg) { cfg.caption = before; cap.value = before; countCaption(); } } } });
    }, function (err) { busy(btn, false); fail(aiError(err)); });
  }

  /* ---------------- making the pictures ---------------- */
  function fileBase(cfg) {
    var t = TYPE[cfg.type], i = t.instance ? t.instance(KIT, cfg) : '';
    return slug(eventOf(KIT).name || EVENT_ID) + '-' + t.id + (i && t.per ? '-' + slug(i) : '');
  }
  /* one post at its real size, off the screen, made into a PNG.
     PNGs are made one at a time, each in a host of its own that only it removes: a "Download PNG" pressed while
     a ZIP is being made waits its turn, instead of drawing over the post the ZIP is still capturing. The settings
     are copied when the download is asked for, so a change made while it waits does not reach it. */
  var exportChain = Promise.resolve();
  function pngOf(cfg, fmtId) {
    var c = clone(cfg); c.format = fmtId;
    var f = FMT[fmtId];
    var run = exportChain.then(function () {
      var host = document.createElement('div');
      host.className = 'ps-offscreen';
      host.setAttribute('aria-hidden', 'true');
      document.body.appendChild(host);
      return Promise.all([waitFonts(), want(urlsFor(KIT, c))]).then(function () {
        var node = drawInto(host, KIT, c);
        return picturesReady(node).then(function () { return P.toPng(node, f.w, f.h); });
      }).then(function (blob) { host.remove(); return blob; }, function (err) { host.remove(); throw err; });
    });
    exportChain = run.catch(function () {});
    return run;
  }
  function downloadOne(btn) {
    var cfg = ED.cfg;
    busy(btn, true, 'Making the PNG…');
    pngOf(cfg, cfg.format).then(function (blob) {
      busy(btn, false);
      P.download(blob, fileBase(cfg) + '-' + cfg.format + '.png');
      toast('PNG downloaded.');
    }, function (err) { busy(btn, false); fail('The PNG could not be made.', err); });
  }
  function downloadFormats(btn) {
    var cfg = clone(ED.cfg), files = [], i = 0;
    var caption = root.querySelector('#ps-caption').value;
    busy(btn, true, 'Making 1 of ' + FORMATS.length + '…');
    FORMATS.reduce(function (chain, f) {
      return chain.then(function () {
        busy(btn, false); busy(btn, true, 'Making ' + (++i) + ' of ' + FORMATS.length + '…');
        return pngOf(cfg, f.id).then(function (blob) { files.push({ name: fileBase(cfg) + '-' + f.id + '-' + f.w + 'x' + f.h + '.png', blob: blob }); });
      });
    }, Promise.resolve()).then(function () {
      if (caption) files.push({ name: 'caption.txt', text: caption });
      return P.zip(files, fileBase(cfg) + '-all-formats.zip');
    }).then(function () { busy(btn, false); toast('ZIP downloaded: ' + FORMATS.length + ' pictures' + (caption ? ' and the caption' : '') + '.'); },
      function (err) { busy(btn, false); fail('The ZIP could not be made.', err); });
  }
  /* every speaker's spotlight in one format, as a ZIP */
  function batchSpeakers(btn, base) {
    var list = speakersOf(KIT), files = [], i = 0;
    var labelBtn = btn.querySelector('span') ? btn : btn;
    busy(labelBtn, true, 'Making 1 of ' + list.length + '…');
    list.reduce(function (chain, s) {
      return chain.then(function () {
        busy(labelBtn, false); busy(labelBtn, true, 'Making ' + (++i) + ' of ' + list.length + '…');
        var cfg = newCfg('speaker');
        cfg.format = base.format; cfg.background = base.background; cfg.picks.speaker = s.id; cfg.texts = clone(base.texts || {});
        return pngOf(cfg, cfg.format).then(function (blob) {
          files.push({ name: ('0' + i).slice(-2) + '-' + slug(s.name) + '-' + cfg.format + '.png', blob: blob });
        });
      });
    }, Promise.resolve()).then(function () {
      return P.zip(files, slug(eventOf(KIT).name || EVENT_ID) + '-speaker-spotlights-' + base.format + '.zip');
    }).then(function () { busy(labelBtn, false); toast('ZIP downloaded: ' + files.length + ' speaker spotlights.'); },
      function (err) { busy(labelBtn, false); fail('The speaker spotlights could not be made.', err); });
  }

  function savePost(btn) {
    var cfg = ED.cfg;
    var name = (root.querySelector('#ps-name').value || '').trim() || instanceName(cfg);
    var conf = { type: cfg.type, format: cfg.format, background: cfg.background, picks: clone(cfg.picks), texts: clone(cfg.texts), caption: cfg.caption, network: cfg.network };
    busy(btn, true, 'Saving…');
    P.save('post', { id: ED.savedId || undefined, name: name, config: conf }).then(function (r) {
      busy(btn, false);
      if (!ED || ED.cfg !== cfg) return;
      ED.savedId = (r && r.id) || ED.savedId; ED.name = name; ED.dirty = false;
      btn.textContent = 'Save changes';
      toast('Saved as “' + name + '”.');
      SAVED = null; loadSaved();
    }, function (err) { busy(btn, false); fail('The post was not saved.', err); });
  }

  /* ============================================================
     MOUNT
     ============================================================ */
  var resizeWired = false;
  function mount(rootEl, ctx) {
    root = rootEl; KIT = ctx.kit || {}; EVENT_ID = ctx.eventId;
    toast = ctx.toast || function (m) { console.log(m); };
    PICS = {}; PIC_FAILED = {}; fontsReady = null; SAVED = null; SAVED_ERR = '';
    recall();
    root.innerHTML = '<div class="promo-state" role="status">' + spin() + '<b>Drawing this site’s posts…</b></div>';
    if (!resizeWired) {
      resizeWired = true;
      var t = 0;
      window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { fitStage(); rescaleThumbs(); }, 80); });
    }
    waitFonts().then(function () { showGallery(); loadSaved(); });
  }

  /* marketing.html calls this each time the Social posts tab is shown again: what was put off while it was hidden
     is drawn now, at the size it is seen at */
  function shown() {
    if (!root || hiddenNow()) return;
    if (ED) {
      if (pendingShow.stage) redraw(true); else fitStage();
      return;
    }
    if (pendingShow.thumbs || root.querySelector('[data-thumb]:not([data-drawn])')) drawThumbs();
    rescaleThumbs();
  }

  window.RevampPromoPosts = {
    mount: mount,
    shown: shown,
    /* for tests and the mailer studio: the same look a post would use */
    _internal: { FORMATS: FORMATS, TYPES: TYPES, lookFor: lookFor, drawInto: drawInto, want: want, urlsFor: urlsFor, newCfg: function (t) { return newCfg(t); } }
  };
})();
