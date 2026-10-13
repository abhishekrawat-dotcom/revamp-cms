/* RevampData — puts an event's records on its site.

   The console's Content tabs (speakers, agenda, sponsors, gallery, FAQs, contacts) and Basics (name, dates,
   venue, description) are the one place an event's content lives. A site shows them; it keeps no copy of its
   own. This file is the one implementation of "show them": the site editor calls it when it opens a site, and
   the live-site runtime (rv-live.js) calls it on every visit to a published or previewed page.

   A plain script: no build step, nothing from the editor, no RevampCore. It uses window.RevampFill
   (editor-fill.js) only for a real template's content.map and looks it up when called, so the two scripts can be
   loaded in either order; a page without a content.map (AI-designed, imported) does not need editor-fill.js.

   ---------------------------------------------------------------------------------------------------------
   API (version 1)
   ---------------------------------------------------------------------------------------------------------
   RevampData.VERSION   1
   RevampData.KINDS     ["speakers", "faq", "partners", "contact", "glimpses", "sessions"]
   RevampData.TABS      kind -> { tab, route, label, noun }      where the console manages that kind:
                          speakers  { tab: "speakers", route: "content/speakers", label: "Content › Speakers" }
                          faq       { tab: "faq",      route: "content/faq",      label: "Content › FAQ" }
                          partners  { tab: "sponsors", route: "content/sponsors", label: "Content › Sponsors" }
                          contact   { tab: "contact",  route: "content/contact",  label: "Content › Contact" }
                          glimpses  { tab: "gallery",  route: "content/gallery",  label: "Content › Gallery" }
                          sessions  { tab: "agenda",   route: "content/agenda",   label: "Content › Agenda" }
                        route is the console's address fragment: /edit-event.html?event=<id>#<route>.
   RevampData.BASICS    { tab: "basics", route: "content/basics", label: "Content › Basics" }
   RevampData.MARKERS   the attribute names listed under "Markers" below, by short name
   RevampData.AVATAR    the root-relative address of the neutral picture a speaker without a photo gets (it is
                        written into a page as a full address on the page's own host)

   RevampData.fetch(eventId, { fetcher }) -> Promise<siteData>
       The event's site data (GET /api/public/site-data; the shape is in the launch contract, section 5).
       fetcher(eventId) -> Promise<siteData>, when given, is used instead of the request — the editor passes
       RevampCore.fetchSiteData. Rejects with an Error whose message can be shown to a user and whose status is
       the HTTP status (0 when the server could not be reached).

   RevampData.toContent(siteData) -> content
       The same data in the words a content.map uses. Every list is sorted by its records' order, and a kind
       with no records is an EMPTY list, never null:
         event     { name, date: { mode: "range", start, end }, dateLabel, location (venue, or "venue, city"),
                     venue, city, description, logo }
         speakers  { items: [ { id, n, r, c, photo, bio, li, group } ], groups: [ { t, items } ] }
         faq       { items: [ { id, t, d } ] }
         partners  { tiers: [ { t, logos: [ { id, n, name, logo, url } ] } ], items: [ the same, flat, + tier ] }
                   partners without a tier come last, under a tier whose t is "" — never dropped
         contact   { blocks: [ { t, people: [ { id, n, e, p } ] } ], items: [ { id, label, name, email, phone } ] }
                   one block per label, in the order the labels first appear; contacts without a label
                   come first, under a block whose t is "" (after a labelled block they would read as part
                   of it)
         glimpses  { items: [ { id, url, imageUrl, caption } ] }
         sessions  { days: [ { t, date, dateLabel, items } ], items: [ { id, title, time, start, end, desc, room,
                     kind, speakers, day } ] }        time "9:30 AM – 10:15 AM"; speakers = the names, comma-joined;
                   sessions without a day come last, under a day whose t is ""
         agenda    the same object as sessions (a content.map may say "from": "agenda")

   RevampData.apply(doc, { data, contentMap, binds, mode, tabUrl, retag }) -> report
       Shows `data` (a siteData object) on `doc`. Synchronous. Never throws. Applying the same data twice leaves
       the page exactly as applying it once.
         contentMap     a real template's template.json → content.map (an array), or the whole content object
                        ({ map, bind }). Leave it out for an AI-designed or imported page.
         binds          [ { section, sel, bind } ] — elements of a real template that show a single value (see
                        "Single values"); defaults to contentMap.bind
         mode           "editor" (default) or "live" — they differ only in what "nothing to show" looks like
         tabUrl(kind)   editor only: the address of the console tab that manages a kind; the empty-state notice
                        links to it. kind is one of KINDS.
         retag(el)      editor only: called once for every section whose markup changed (canvas.retag)
       report:
         applied   [kind]   kinds whose records are now on the page
         empty     [kind]   kinds the page has a place for, with no records
         unplaced  [kind]   kinds that have records but nowhere on this page shows them
         added     []       sections added to the page for unplaced kinds — none yet (always empty in version 1)
         binds     n        single-value elements written
         sections  [el]     the sections (or, outside a section, the list parents) whose markup changed
         errors    [ { kind, message } ]   a kind that failed leaves the other kinds unaffected
         error     only when nothing was done: { status, code, message } — code "no-data" when data is missing
                   (the page is left exactly as it was)

   RevampData.refresh(doc, { eventId, data, fetcher, contentMap, binds, mode, tabUrl, retag, autoSections })
       -> Promise<report>
       apply() with data it fetches itself (or with `data`, when given). Never rejects. When the data cannot be
       loaded it resolves a report with error: { status, code: "fetch-failed", message } and does not touch the
       page: stale content with a clear message is better than a half-empty site. On success report.data is the
       siteData that was applied. autoSections is accepted and has no effect yet.

   RevampData.managedBy(el) -> null | { kind, tab, route, label, id } | { bind, tab, route, label }
       What the editor needs to know about a clicked element. A rendered record (or the empty-state notice)
       answers with its kind, where it is managed and the record's id ("" for a group heading or the notice);
       a single value answers with what it is bound to; anything else is the owner's own text: null.
   RevampData.detach(el) -> true | false
       The owner rewrote a single value by hand: it stops following Basics (data-rv-bind becomes
       data-rv-unbound), so the manual text wins from now on.
   RevampData.strip(root) -> root
       For a copy of the page that is about to be published: removes the editor-only notices
       ([data-rv-empty-state], [data-rv-bind-hint]) and the editor's marks inside the kept list models.
       Every other marker stays — the live page needs them. Not for the editor's own snapshot: there the
       models keep their marks, so cards built from them are tagged the same on every open.

   ---------------------------------------------------------------------------------------------------------
   How a page says where its records go
   ---------------------------------------------------------------------------------------------------------
   Real templates: template.json → content.map. Of the entries whose "from" is one of KINDS (or "agenda"), the
   list rules are run through RevampFill.fill() in data mode. The section's own text (heading, intro) is the
   owner's and is never touched. An entry may carry "emptyScope": "<selector inside the section>" to say what
   leaves the page when there are no records; the default is the whole section.

   AI-designed and other pages: the DOM convention. One element per list carries
   data-rv-repeat-template="<kind>" — the model of ONE item — and elements inside it (or the model itself) carry
   data-rv-field="<field>":
       speakers   n  r  c  photo           (also bio, li)
       faq        t  d
       partners   name  url  logo
       contact    label  name  email  phone
       glimpses   imageUrl  caption
       sessions   title  time  desc  speakers          (also room)
   A picture field sets src on an <img> (background-image on anything else); url / li / email / phone set the
   href of an <a> (mailto:, tel:) and e-mail and phone its text too; everything else is text. A field with no
   value is emptied and hidden, an <a> loses its href (never href="#"), a picture is hidden — a speaker without a
   photo gets the neutral avatar. A gallery record without a picture is skipped. An unknown field name is left
   alone. Several siblings carrying the same data-rv-repeat-template (pages saved by an earlier editor) are
   collapsed to the first.

   Single values: data-rv-bind="event.name | event.date | event.venue | event.city | event.description".
   event.venue includes the city unless the page binds event.city as well. With no value the element is hidden
   on the live page; in the editor it stays, with a muted hint ("Add the date in Basics").
   data-rv-bind="event.logo" on an <img> is the event's logo (site data event.logoUrl): the picture is shown
   with the event's name as its alt text. A logo that reached the page another way (the Create Event hand-off,
   the editor's Replace image) is left alone while the event has none; one this file put there
   (data-rv-from-data) goes when the event's is removed — the <img> loses its src and is hidden. A real
   template's banner shows its text title in the logo's place whenever the logo is not showing.

   ---------------------------------------------------------------------------------------------------------
   Markers (the attributes this file and editor-fill.js write; a saved or published page keeps all of them
   except the two editor-only notices)
   ---------------------------------------------------------------------------------------------------------
   data-rv-repeat-template, data-rv-field, data-rv-bind       the authoring convention above
   <template data-rv-pristine="<key>">    the untouched model(s) of a list: the last child of the list's section
                                          (right after the list's parent on a page without sections). Inert:
                                          nothing in it renders, loads or is found by a selector. Items are
                                          always rebuilt from it, which is why applying is repeatable. It is
                                          not kept beside the items, so the last item is still :last-child.
                                          key = the kind (DOM convention; "<kind>:2" for a second list of the
                                          kind in one section) or the list rule's selector (content.map).
   data-rv-list="<key>"                   on the element whose children are the list's items
   data-rv-list-at="<n>"                  with it, when that element holds other things too: the items go after
                                          its first n other children
   data-rv-item="<kind>"  data-rv-id="<record id>"     on every rendered item. Not the owner's text: the next
                                          apply overwrites it. In the editor, managedBy() says where to edit it.
                                          The model card in a real template's section file carries
                                          data-rv-item too (no id), so it is managed before the first apply.
   data-rv-bound="<kind>"                 on a section that shows records of that kind
   data-rv-empty="<kind>"                 on a section (or list parent) that has no records to show. Hidden on the
                                          live page; visible in the editor, with the notice below.
                                          (data-rv-empty-display keeps an inline display it had to override.)
   data-rv-nav-empty                      live page only: a link (or its menu entry) to a section that is hidden
                                          because it is empty; hidden with it
   data-rv-empty-state="<kind>"           EDITOR ONLY: the notice "No speakers yet — add them in Content ›
                                          Speakers". Also carries data-rv-editor and data-ed="none".
   data-rv-unbound="<what it was>"        a single value the owner detached
   data-rv-bind-empty                     a single value with nothing to show
   data-rv-bind-hint                      EDITOR ONLY: the hint inside such an element (also data-rv-editor)
   data-rv-from-data                      on the logo <img> while its picture is the one from the event's records
   data-rv-hidden-empty                   an element hidden because it has no value (holds the inline display it
                                          had, or "1") */
(function (global) {
  'use strict';

  var VERSION = 1;
  var KINDS = ['speakers', 'faq', 'partners', 'contact', 'glimpses', 'sessions'];
  var TABS = {
    speakers: { tab: 'speakers', route: 'content/speakers', label: 'Content › Speakers', noun: 'speakers' },
    faq: { tab: 'faq', route: 'content/faq', label: 'Content › FAQ', noun: 'FAQs' },
    partners: { tab: 'sponsors', route: 'content/sponsors', label: 'Content › Sponsors', noun: 'sponsors' },
    contact: { tab: 'contact', route: 'content/contact', label: 'Content › Contact', noun: 'contacts' },
    glimpses: { tab: 'gallery', route: 'content/gallery', label: 'Content › Gallery', noun: 'photos' },
    sessions: { tab: 'agenda', route: 'content/agenda', label: 'Content › Agenda', noun: 'sessions' }
  };
  var BASICS = { tab: 'basics', route: 'content/basics', label: 'Content › Basics' };
  var MARKERS = {
    repeat: 'data-rv-repeat-template', field: 'data-rv-field', bind: 'data-rv-bind',
    pristine: 'data-rv-pristine', list: 'data-rv-list', listAt: 'data-rv-list-at', item: 'data-rv-item', id: 'data-rv-id',
    bound: 'data-rv-bound', empty: 'data-rv-empty', emptyDisplay: 'data-rv-empty-display',
    emptyState: 'data-rv-empty-state', unbound: 'data-rv-unbound', bindEmpty: 'data-rv-bind-empty',
    bindHint: 'data-rv-bind-hint', navEmpty: 'data-rv-nav-empty', hiddenEmpty: 'data-rv-hidden-empty',
    fromData: 'data-rv-from-data'
  };
  var BIND_HINTS = {
    'event.name': 'Add the event name in Basics',
    'event.date': 'Add the date in Basics',
    'event.venue': 'Add the venue in Basics',
    'event.city': 'Add the city in Basics',
    'event.description': 'Add a description in Basics'
  };
  /* what each field of the DOM convention is, and which value of a record (as toContent() names it) it shows */
  var FIELDS = {
    speakers: { n: 'text', r: 'text', c: 'text', photo: 'image', bio: 'text', li: 'link' },
    faq: { t: 'text', d: 'text' },
    partners: { name: 'text', url: 'link', logo: 'image' },
    contact: { label: 'text', name: 'text', email: 'email', phone: 'phone' },
    glimpses: { imageUrl: 'image', caption: 'text' },
    sessions: { title: 'text', time: 'text', desc: 'text', speakers: 'text', room: 'text' }
  };
  var ALT = { speakers: 'n', partners: 'name', glimpses: 'caption' };       // the words for a picture of that kind
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var AVATAR = '/templates/_shared/img/rv-avatar.svg';
  try {
    if (document.currentScript && document.currentScript.src) AVATAR = new URL('img/rv-avatar.svg', document.currentScript.src).pathname;
  } catch (e) { /* the default above */ }
  /* Written into a page as a full address on the page's own host, like every other asset the loader links:
     publishing turns that host into a root-relative address, and a page stored elsewhere still finds it. */
  var avatarUrl = AVATAR;
  function avatarFor(doc) {
    try { return new URL(AVATAR, (doc.ownerDocument || doc).baseURI).href; } catch (e) { return AVATAR; }
  }

  function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function list(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function byOrder(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); }
  function sorted(v) {
    // a stable sort: records with the same order keep the order the server sent them in
    return list(v).map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) { return byOrder(a.x, b.x) || a.i - b.i; })
      .map(function (p) { return p.x; });
  }

  /* ---------- addresses that come from records ---------- */
  function safeLink(v) {
    v = str(v);
    if (!v) return '';
    if (/^(https?:)?\/\//i.test(v) || /^(mailto:|tel:)/i.test(v) || v.charAt(0) === '/' || v.charAt(0) === '#') return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';                  // javascript:, data: and the like are never a link
    return /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(v) ? 'https://' + v : v;
  }
  function safeImage(v) {
    v = str(v);
    if (!v) return '';
    if (/^(https?:)?\/\//i.test(v) || /^data:image\//i.test(v) || /^blob:/i.test(v) || v.charAt(0) === '/') return v;
    return /^[a-z][a-z0-9+.-]*:/i.test(v) ? '' : v;
  }

  /* ---------- dates and times, as the sites print them ---------- */
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function ymd(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));           // the calendar date that was typed, never shifted by a time zone
    return m && +m[2] >= 1 && +m[2] <= 12 ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function dayLabel(v) {
    var d = ymd(v);
    return d ? ordinal(d.d) + ' ' + MONTHS[d.m] + ', ' + d.y : str(v);
  }
  /* the server sends dateLabel; this is only for data that came from somewhere else without one */
  function rangeLabel(start, end) {
    var s = ymd(start), e = ymd(end);
    if (!s) return '';
    if (!e || (e.y === s.y && e.m === s.m && e.d === s.d)) return dayLabel(start);
    if (s.y !== e.y) return dayLabel(start) + ' – ' + dayLabel(end);
    if (s.m !== e.m) return ordinal(s.d) + ' ' + MONTHS[s.m] + ' – ' + ordinal(e.d) + ' ' + MONTHS[e.m] + ', ' + e.y;
    return ordinal(s.d) + ' – ' + ordinal(e.d) + ' ' + MONTHS[e.m] + ', ' + e.y;
  }
  function clock(v) {
    v = str(v);
    var m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m || +m[1] > 23) return v;
    return ((+m[1] % 12) || 12) + ':' + m[2] + (+m[1] < 12 ? ' AM' : ' PM');
  }

  /* ---------- site data -> the content.map vocabulary ---------- */
  function grouped(items, groups, idOf, make) {
    var slots = {}, out = [], rest = make(null);
    sorted(groups).forEach(function (g) { var slot = make(g); slots[g.id] = slot; out.push(slot); });
    items.forEach(function (it) { (slots[idOf(it)] || rest).items.push(it); });
    out = out.filter(function (g) { return g.items.length; });
    if (rest.items.length) out.push(rest);
    return out;
  }

  function toContent(data) {
    data = data && typeof data === 'object' ? data : {};
    var ev = data.event && typeof data.event === 'object' ? data.event : {};
    var venue = str(ev.venue), city = str(ev.city);

    var groupName = {};
    list(data.speakerGroups).forEach(function (g) { groupName[g.id] = str(g.name); });
    var speakerName = {};
    var speakers = sorted(data.speakers).map(function (s) {
      speakerName[s.id] = str(s.name);
      return { id: str(s.id), n: str(s.name), r: str(s.desig), c: str(s.comp), photo: safeImage(s.photoUrl), bio: str(s.bio),
        li: safeLink(s.li), group: groupName[s.groupId] || '', groupId: str(s.groupId) };
    });

    var tierName = {};
    list(data.partnerTiers).forEach(function (t) { tierName[t.id] = str(t.name); });
    var partners = sorted(data.partners).map(function (p) {
      var name = str(p.name);
      return { id: str(p.id), n: name, name: name, logo: safeImage(p.logoUrl), url: safeLink(p.url), tier: tierName[p.tierId] || '', tierId: str(p.tierId) };
    });

    var contacts = sorted(data.contacts).map(function (c) {
      return { id: str(c.id), label: str(c.label), name: str(c.name), email: str(c.email), phone: str(c.phone) };
    });
    var blocks = [], byLabel = {};
    contacts.forEach(function (c) {
      if (!byLabel[c.label]) { byLabel[c.label] = { t: c.label, people: [] }; blocks.push(byLabel[c.label]); }
      byLabel[c.label].people.push({ id: c.id, n: c.name, e: c.email, p: c.phone });
    });
    if (byLabel['']) blocks.unshift(blocks.splice(blocks.indexOf(byLabel['']), 1)[0]);

    var dayName = {};
    list(data.agendaGroups).forEach(function (g) { dayName[g.id] = str(g.name); });
    var sessions = sorted(data.sessions).map(function (s) {
      var names = (Array.isArray(s.speakerIds) ? s.speakerIds : []).map(function (id) { return speakerName[id]; }).filter(Boolean);
      return { id: str(s.id), title: str(s.title), start: str(s.start), end: str(s.end),
        time: [clock(s.start), clock(s.end)].filter(Boolean).join(' – '),
        desc: str(s.desc), room: str(s.room), kind: str(s.kind), speakers: names.join(', '), speakerNames: names,
        day: dayName[s.groupId] || '', groupId: str(s.groupId) };
    });
    var sessionsOut = {
      items: sessions,
      days: grouped(sessions, data.agendaGroups, function (s) { return s.groupId; }, function (g) {
        return { t: g ? str(g.name) : '', date: g ? str(g.date) : '', dateLabel: g ? dayLabel(g.date) : '', items: [] };
      })
    };

    return {
      event: {
        name: str(ev.name),
        date: { mode: 'range', start: str(ev.start), end: str(ev.end) },
        dateLabel: str(ev.dateLabel) || rangeLabel(ev.start, ev.end),
        location: venue && city && venue.toLowerCase().indexOf(city.toLowerCase()) === -1 ? venue + ', ' + city : (venue || city),
        venue: venue, city: city, description: str(ev.description), logo: safeImage(ev.logoUrl)
      },
      speakers: {
        items: speakers,
        groups: grouped(speakers, data.speakerGroups, function (s) { return s.groupId; }, function (g) { return { t: g ? str(g.name) : '', items: [] }; })
      },
      faq: { items: sorted(data.faqs).map(function (f) { return { id: str(f.id), t: str(f.question), d: str(f.answer) }; }) },
      partners: {
        items: partners,
        tiers: grouped(partners, data.partnerTiers, function (p) { return p.tierId; }, function (t) { return { t: t ? str(t.name) : '', items: [] }; })
          .map(function (t) { return { t: t.t, logos: t.items }; })
      },
      contact: { blocks: blocks, items: contacts },
      glimpses: {
        items: sorted(data.gallery).map(function (g) { var url = safeImage(g.imageUrl); return { id: str(g.id), url: url, imageUrl: url, caption: str(g.caption) }; })
          .filter(function (g) { return g.url; })
      },
      sessions: sessionsOut,
      agenda: sessionsOut
    };
  }

  /* ---------- loading ---------- */
  function fail(status, message, code) {
    var err = new Error(message);
    err.status = status;
    err.code = code || 'fetch-failed';
    return err;
  }
  function failureText(status) {
    if (!status) return 'Could not reach the server to load this event\'s content. Check your connection and try again.';
    if (status === 401 || status === 403) return 'You need to sign in again to load this event\'s content.';
    if (status === 404) return 'This event\'s content is not available.';
    if (status === 429) return 'Too many requests. Please try again in a minute.';
    return 'The server could not load this event\'s content (error ' + status + '). Please try again in a moment.';
  }
  function fetchData(eventId, opts) {
    opts = opts || {};
    eventId = str(eventId);
    if (!eventId) return Promise.reject(fail(0, 'This page does not say which event it belongs to.', 'no-event'));
    var got;
    if (typeof opts.fetcher === 'function') {
      got = new Promise(function (resolve) { resolve(opts.fetcher(eventId)); }).then(null, function (err) {
        var status = err && typeof err.status === 'number' ? err.status : 0;
        throw fail(status, (err && err.message) || failureText(status));
      });
    } else {
      got = global.fetch('/api/public/site-data?eventId=' + encodeURIComponent(eventId), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          return res.json().then(null, function () { return null; }).then(function (body) {
            if (!res.ok) throw fail(res.status, (body && typeof body.error === 'string' && body.error) || failureText(res.status));
            return body;
          });
        }, function () { throw fail(0, failureText(0)); });
    }
    return got.then(function (data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(502, 'The server sent something that is not this event\'s content. Please try again in a moment.');
      return data;
    });
  }

  /* ---------- writing into the page ---------- */
  function hasText(n) {
    return n.nodeType === 3 ? /\S/.test(n.nodeValue) : n.nodeType === 1 && (n.tagName === 'BR' || /\S/.test(n.textContent));
  }
  /* the same rule as editor-fill.js's setText (a page without a content.map does not load that file): the
     element's words become value, icons and other elements without text stay where they are */
  function setText(el, value) {
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
      first.nodeValue = m[1] + value + m[2];
    } else {
      el.replaceChild(doc.createTextNode(value), first);
    }
    runs.slice(1).forEach(function (n) { n.remove(); });
  }
  function hideSlot(el) {
    if (!el.hasAttribute('data-rv-hidden-empty')) {
      var was = el.style.display;
      el.setAttribute('data-rv-hidden-empty', was && was !== 'none' ? was : '1');
    }
    el.setAttribute('hidden', '');
    el.style.display = 'none';
  }
  function showSlot(el) {
    if (!el.hasAttribute('data-rv-hidden-empty')) return;
    var was = el.getAttribute('data-rv-hidden-empty');
    el.removeAttribute('data-rv-hidden-empty');
    el.removeAttribute('hidden');
    el.style.display = was === '1' ? '' : was;
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  function writeText(el, value) {
    if (value === '') { setText(el, ''); hideSlot(el); return; }
    showSlot(el);
    setText(el, value);
    // an answer or a description typed on several lines keeps its lines
    if (value.indexOf('\n') !== -1) el.style.whiteSpace = 'pre-line';
    else if (el.style.whiteSpace === 'pre-line') { el.style.whiteSpace = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); }
  }

  function setField(el, type, value, kind, record, card) {
    if (type === 'image') {
      var url = safeImage(value) || (kind === 'speakers' ? avatarUrl : '');
      if (el.tagName === 'IMG') {
        el.removeAttribute('srcset');                              // a model's srcset would win over the record's picture
        if (url) { showSlot(el); el.setAttribute('src', url); } else { el.removeAttribute('src'); hideSlot(el); }
        el.setAttribute('alt', str(record[ALT[kind]]));
      } else {
        el.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : 'none';
      }
      return;
    }
    if (type === 'link' && el.tagName === 'A') {
      var href = safeLink(value);
      if (href) el.setAttribute('href', href); else el.removeAttribute('href');
      return;
    }
    if (type === 'email' || type === 'phone') {
      var address = !value ? '' : type === 'email' ? 'mailto:' + value : 'tel:' + value.replace(/[^\d+]/g, '');
      // the field is the link itself, or sits inside one the model wrote (<a href="mailto:…"><span data-rv-field="email">)
      var link = el.tagName === 'A' ? el : el.closest('a');
      if (link && card.contains(link) && (link === el || (!link.hasAttribute('data-rv-field') && /^(mailto:|tel:|#|$)/i.test(link.getAttribute('href') || '')))) {
        if (address) link.setAttribute('href', address); else link.removeAttribute('href');
      }
      if (el.tagName === 'A' && el.querySelector('[data-rv-field]')) return;      // its text is another field's
    }
    writeText(el, type === 'link' ? safeLink(value) : str(value));
  }

  function fillFields(card, record, kind) {
    var fields = FIELDS[kind];
    (card.hasAttribute('data-rv-field') ? [card] : []).concat(qsa(card, '[data-rv-field]')).forEach(function (el) {
      var name = el.getAttribute('data-rv-field');
      if (fields[name]) setField(el, fields[name], str(record[name]), kind, record, card);
    });
  }

  /* ---------- lists of the DOM convention ----------
     Kept the way editor-fill.js keeps a content.map list (see "Markers"): the model in a <template> at the end
     of the section, the parent of the items marked data-rv-list. */
  var TRANSIENT_MARKS = ['contenteditable', 'data-text-original', 'data-rv-item', 'data-rv-id'];

  function isItem(n) { return n.hasAttribute('data-rv-item'); }
  function childrenOf(el, test) { return Array.prototype.filter.call(el.children, test); }
  function isKeyOf(key, kind) { return key === kind || (!!key && key.indexOf(kind + ':') === 0 && /^\d+$/.test(key.slice(kind.length + 1))); }

  function asModel(el) {
    var model = el.cloneNode(true);
    [model].concat(qsa(model, '*')).forEach(function (n) {
      TRANSIENT_MARKS.forEach(function (a) { n.removeAttribute(a); });
      n.classList.remove('ed-selected', 'sec-active');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    return model;
  }

  function pristineOf(parent, key) {
    var sec = parent.closest('[data-rv-section]');
    var pool = sec ? childrenOf(sec, function (n) { return n.tagName === 'TEMPLATE'; }) : [parent.nextElementSibling];
    return pool.filter(function (t) { return t && t.tagName === 'TEMPLATE' && t.getAttribute('data-rv-pristine') === key; })[0] || null;
  }

  function keepModel(parent, kind, model, standing) {
    var doc = parent.ownerDocument, sec = parent.closest('[data-rv-section]');
    var key = kind, n = 2;
    while (sec && pristineOf(parent, key)) key = kind + ':' + (n++);          // a second list of the kind in one section
    var pristine = doc.createElement('template');
    pristine.setAttribute('data-rv-pristine', key);
    pristine.content.appendChild(asModel(model));
    var others = childrenOf(parent, function (c) { return standing.indexOf(c) === -1; });
    if (others.length) parent.setAttribute('data-rv-list-at', String(Array.prototype.indexOf.call(parent.children, standing[0])));
    parent.setAttribute('data-rv-list', key);
    standing.forEach(function (el) { el.remove(); });
    if (sec) sec.appendChild(pristine); else parent.after(pristine);
    return pristine;
  }

  /* Every list of a kind on the page, as [ { parent, pristine } ]. Models still standing in the page are put
     away first: the first of each parent becomes that list's kept model, and the others — the copies an earlier
     editor left behind, each carrying the attribute — are removed with it. */
  function listsOf(doc, kind, watch) {
    var parents = [], standing = [];
    qsa(doc, '[data-rv-repeat-template="' + kind + '"]').forEach(function (el) {
      if (!el.parentNode) return;
      var i = parents.indexOf(el.parentNode);
      if (i === -1) { parents.push(el.parentNode); standing.push([el]); } else standing[i].push(el);
    });
    parents.forEach(function (parent, i) {
      watch(parent);
      var key = parent.getAttribute('data-rv-list');
      if (key && isKeyOf(key, kind) && pristineOf(parent, key)) { standing[i].forEach(function (el) { el.remove(); }); return; }
      keepModel(parent, kind, standing[i][0], standing[i]);
    });
    var lists = [];
    qsa(doc, '[data-rv-list]').forEach(function (parent) {
      var key = parent.getAttribute('data-rv-list');
      if (!isKeyOf(key, kind)) return;
      var pristine = pristineOf(parent, key);
      if (!pristine) {
        // the model was lost (a page that went through something that drops <template>): an item on the page stands in
        var items = childrenOf(parent, isItem);
        if (!items.length) return;
        watch(parent);
        parent.removeAttribute('data-rv-list');
        pristine = keepModel(parent, kind, items[0], items);
      }
      lists.push({ parent: parent, pristine: pristine });
    });
    return lists;
  }

  function drawList(parent, pristine, records, kind) {
    var doc = parent.ownerDocument;
    var model = pristine.content.firstElementChild;
    if (!model) return 0;
    var drawn = childrenOf(parent, isItem);
    var others = childrenOf(parent, function (n) { return !isItem(n); });
    var at = parent.hasAttribute('data-rv-list-at') ? +parent.getAttribute('data-rv-list-at') : others.length;
    var before = drawn.length ? drawn[drawn.length - 1].nextSibling : (others[at] || null);
    var cards = records.map(function (record) {
      var card = doc.importNode(model, true);
      card.removeAttribute('data-rv-repeat-template');
      fillFields(card, record, kind);
      card.setAttribute('data-rv-item', kind);
      if (record.id) card.setAttribute('data-rv-id', record.id);
      return card;
    });
    // a card that comes out exactly as the one in its place stays: no picture reloads, nothing changes
    cards.forEach(function (card, i) {
      var html = card.outerHTML, had = drawn[i];
      if (had && (had.__rvDrawn || had.outerHTML) === html) return;
      card.__rvDrawn = html;
      if (had) parent.replaceChild(card, had); else parent.insertBefore(card, before);
    });
    drawn.slice(cards.length).forEach(function (old) { old.remove(); });
    return cards.length;
  }

  /* ---------- "nothing to show" ---------- */
  function emptyNotice(scope, kind, tabUrl) {
    var tab = TABS[kind], doc = scope.ownerDocument;
    var box = doc.createElement('div');
    box.setAttribute('data-rv-editor', '');
    box.setAttribute('data-rv-empty-state', kind);
    box.setAttribute('data-ed', 'none');
    box.setAttribute('style', 'box-sizing:border-box;width:100%;max-width:560px;margin:16px auto;padding:18px 20px;' +
      'grid-column:1/-1;flex:1 1 100%;list-style:none;border:1px dashed currentColor;border-radius:10px;' +
      'font:500 14px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;letter-spacing:normal;text-transform:none;' +
      'text-align:center;opacity:.75');
    box.appendChild(doc.createTextNode('No ' + tab.noun + ' yet — add them in '));
    var url = '';
    if (typeof tabUrl === 'function') { try { url = str(tabUrl(kind)); } catch (e) { url = ''; } }
    var where = doc.createElement(url ? 'a' : 'strong');
    if (url) {
      where.setAttribute('href', url);
      where.setAttribute('target', '_top');
      where.setAttribute('style', 'color:inherit;text-decoration:underline;font-weight:700');
    }
    where.textContent = tab.label;
    box.appendChild(where);
    box.appendChild(doc.createTextNode('.'));
    return box;
  }

  function hideEmpty(el) {
    if (!el.hasAttribute('data-rv-empty-display')) {
      var was = el.style.getPropertyValue('display');
      if (was && was !== 'none') el.setAttribute('data-rv-empty-display', was + (el.style.getPropertyPriority('display') ? ' !important' : ''));
    }
    el.setAttribute('hidden', '');
    el.style.setProperty('display', 'none', 'important');           // a section's own CSS often sets display
  }
  function unhideEmpty(el) {
    var was = el.getAttribute('data-rv-empty-display');
    el.removeAttribute('data-rv-empty-display');
    el.removeAttribute('hidden');
    if (was) el.style.setProperty('display', was.replace(/\s*!important$/, ''), /!important$/.test(was) ? 'important' : '');
    else el.style.removeProperty('display');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  /* On the live page a link to a section that is not shown leads nowhere, so it goes with the section (and
     with it its menu entry, when the link is all the entry holds) and comes back when the section does. */
  function hideLinksTo(doc, sec, watch) {
    var ids = [sec.id, sec.getAttribute('data-rv-section')].filter(function (id, i, a) { return id && a.indexOf(id) === i; });
    qsa(doc, 'a[href^="#"]').forEach(function (link) {
      if (ids.indexOf(link.getAttribute('href').slice(1)) === -1 || sec.contains(link)) return;
      var entry = link.parentElement;
      var target = entry && entry.tagName === 'LI' && entry.children.length === 1 && !/\S/.test(entry.textContent.replace(link.textContent, '')) ? entry : link;
      watch(target);
      target.setAttribute('data-rv-nav-empty', '1');
      hideSlot(target);
    });
  }

  /* wanted: [ { el, kind } ] — the scopes that have nothing to show. Everything else marked empty is put back. */
  function markEmpties(doc, wanted, mode, tabUrl, watch) {
    qsa(doc, '[data-rv-nav-empty]').forEach(function (n) { watch(n); n.removeAttribute('data-rv-nav-empty'); showSlot(n); });
    qsa(doc, '[data-rv-empty-state]').forEach(function (n) { watch(n); n.remove(); });
    qsa(doc, '[data-rv-empty]').forEach(function (el) {
      if (wanted.some(function (w) { return w.el === el; })) return;
      watch(el);
      el.removeAttribute('data-rv-empty');
      if (el.hasAttribute('hidden') || el.hasAttribute('data-rv-empty-display')) unhideEmpty(el);
    });
    wanted.forEach(function (w) {
      watch(w.el);
      w.el.setAttribute('data-rv-empty', w.kind);
      // a section the owner hid is theirs: it gets no notice and is not shown or hidden again from here
      if (w.el.closest('.is-hidden-sec')) return;
      if (mode === 'live') {
        hideEmpty(w.el);
        if (w.el.hasAttribute('data-rv-section')) hideLinksTo(doc, w.el, watch);
        return;
      }
      if (w.el.hasAttribute('hidden') || w.el.hasAttribute('data-rv-empty-display')) unhideEmpty(w.el);
      w.el.appendChild(emptyNotice(w.el, w.kind, tabUrl));
    });
  }

  /* What leaves the page when a list of an AI-designed page has no records: its whole section, unless the
     section is also something else — it holds records of another kind, a registration button, navigation, a
     footer or one of the event's own details — in which case only the list itself. */
  function emptyScopeOf(parent) {
    var sec = parent.closest('[data-rv-section]');
    if (!sec || sec.matches('header, nav, footer') || parent.closest('header, nav, footer')) return parent;
    if (sec.querySelector('[data-rv-item], [data-register-cta], nav, footer, [data-rv-bind]')) return parent;
    return sec;
  }

  /* ---------- single values ---------- */
  function sectionsOf(doc, id) {
    return qsa(doc, '[data-rv-section="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
  }

  /* The event's logo. Returns 1 when the picture was written or taken away. */
  function setLogo(img, url, name) {
    if (url) {
      showSlot(img);
      img.removeAttribute('srcset');
      img.setAttribute('src', url);
      img.setAttribute('alt', name);
      img.setAttribute('data-rv-from-data', '1');
      return 1;
    }
    if (!img.hasAttribute('data-rv-from-data')) return 0;
    img.removeAttribute('data-rv-from-data');
    img.removeAttribute('src');
    img.setAttribute('alt', '');
    hideSlot(img);
    return 1;
  }

  function applyBinds(doc, data, binds, mode, watch) {
    list(binds).forEach(function (b) {
      if (!b.bind || !b.sel) return;
      (b.section ? sectionsOf(doc, b.section) : [doc]).forEach(function (root) {
        var found;
        // one selector this browser cannot read must not cost the page its other values
        try { found = b.sel === ':self' ? [root] : qsa(root, b.sel); } catch (err) { found = []; }
        found.forEach(function (el) {
          if (el.nodeType !== 1 || el.hasAttribute('data-rv-bind') || el.hasAttribute('data-rv-unbound')) return;
          watch(el);
          el.setAttribute('data-rv-bind', b.bind);
        });
      });
    });

    var ev = data.event && typeof data.event === 'object' ? data.event : {};
    var venue = str(ev.venue), city = str(ev.city);
    var cityShownApart = !!doc.querySelector('[data-rv-bind="event.city"]');
    var values = {
      'event.name': str(ev.name),
      'event.date': str(ev.dateLabel) || rangeLabel(ev.start, ev.end),
      'event.venue': cityShownApart || !city || venue.toLowerCase().indexOf(city.toLowerCase()) !== -1 ? venue : (venue ? venue + ', ' + city : city),
      'event.city': city,
      'event.description': str(ev.description)
    };
    var written = 0;
    qsa(doc, '[data-rv-bind]').forEach(function (el) {
      var key = el.getAttribute('data-rv-bind');
      if (key === 'event.logo') {
        // site data that does not say whether the event has a logo changes nothing
        if (el.tagName !== 'IMG' || !('logoUrl' in ev)) return;
        watch(el);
        written += setLogo(el, safeImage(ev.logoUrl), values['event.name']);
        return;
      }
      if (!(key in values)) return;
      watch(el);
      qsa(el, '[data-rv-bind-hint]').forEach(function (n) { n.remove(); });
      var value = values[key];
      written++;
      if (value !== '') {
        el.removeAttribute('data-rv-bind-empty');
        writeText(el, value);
        return;
      }
      setText(el, '');
      el.setAttribute('data-rv-bind-empty', '1');
      if (mode === 'live') { hideSlot(el); return; }
      showSlot(el);
      var hint = el.ownerDocument.createElement('span');
      hint.setAttribute('data-rv-editor', '');
      hint.setAttribute('data-rv-bind-hint', '');
      hint.setAttribute('data-ed', 'none');
      hint.setAttribute('style', 'opacity:.55;font-style:italic');
      hint.textContent = BIND_HINTS[key];
      el.appendChild(hint);
    });
    return written;
  }

  /* ---------- apply ---------- */
  function newReport() {
    return { applied: [], empty: [], unplaced: [], added: [], binds: 0, sections: [], errors: [] };
  }
  function recordsOf(content, kind) {
    return (content[kind] && content[kind].items) || [];
  }
  function kindOf(from) { return from === 'agenda' ? 'sessions' : from; }
  function listRules(entry) { return (entry.fill || []).filter(function (r) { return r && r.list; }); }

  function apply(doc, opts) {
    opts = opts || {};
    var report = newReport();
    if (!doc || !opts.data || typeof opts.data !== 'object') {
      report.error = { status: 0, code: 'no-data', message: 'There is no event content to show.' };
      return report;
    }
    var mode = opts.mode === 'live' ? 'live' : 'editor';
    avatarUrl = avatarFor(doc);
    var map = opts.contentMap, binds = opts.binds;
    if (map && !Array.isArray(map)) { binds = binds || map.bind; map = map.map; }
    map = list(map);

    var content;
    try { content = toContent(opts.data); } catch (err) {
      report.error = { status: 0, code: 'bad-data', message: 'The event content could not be read.' };
      return report;
    }

    // what each touched section looked like before, so the report names only those that really changed
    var watched = [], before = [];
    function watch(el) {
      var root = (el.closest && el.closest('[data-rv-section]')) || el;
      if (watched.indexOf(root) === -1) { watched.push(root); before.push(root.outerHTML); }
    }

    var empties = [], pending = [];
    KINDS.forEach(function (kind) {
      try {
        var records = recordsOf(content, kind), places = 0, shown = 0;

        // a real template: the list rules of its content.map
        var entries = map.filter(function (m) { return m && kindOf(m.from) === kind && listRules(m).length && sectionsOf(doc, m.section).length; });
        if (entries.length && !global.RevampFill) {
          report.errors.push({ kind: kind, message: 'editor-fill.js is not loaded, so this template\'s ' + TABS[kind].noun + ' could not be shown.' });
          entries = [];
        }
        entries.forEach(function (m) {
          var sections = sectionsOf(doc, m.section);
          sections.forEach(watch);
          global.RevampFill.fill(doc, [{ from: kind, section: m.section, fill: listRules(m) }], content, { data: true, avatar: avatarUrl });
          sections.forEach(function (sec) {
            places++;
            sec.setAttribute('data-rv-bound', kind);
            var n = qsa(sec, '[data-rv-item="' + kind + '"]').length;
            shown += n;
            if (n) return;
            var scope = m.emptyScope ? (sec.matches(m.emptyScope) ? sec : sec.querySelector(m.emptyScope)) : null;
            empties.push({ el: scope || sec, kind: kind });
          });
        });

        // any page: the DOM convention
        listsOf(doc, kind, watch).forEach(function (l) {
          watch(l.parent);
          places++;
          var sec = l.parent.closest('[data-rv-section]');
          if (sec && !sec.hasAttribute('data-rv-bound')) sec.setAttribute('data-rv-bound', kind);
          var n = drawList(l.parent, l.pristine, records, kind);
          shown += n;
          if (!n) pending.push({ parent: l.parent, kind: kind });
        });

        if (shown) report.applied.push(kind);
        else if (records.length) report.unplaced.push(kind);
        else if (places) report.empty.push(kind);
      } catch (err) {
        report.errors.push({ kind: kind, message: String((err && err.message) || err) });
      }
    });

    try {
      // decided once every kind is drawn: a section is only empty when none of its lists has anything
      pending.forEach(function (p) {
        var scope = emptyScopeOf(p.parent);
        if (!empties.some(function (e) { return e.el === scope; })) empties.push({ el: scope, kind: p.kind });
      });
      markEmpties(doc, empties, mode, opts.tabUrl, watch);
    } catch (err) {
      report.errors.push({ kind: '', message: String((err && err.message) || err) });
    }

    try { report.binds = applyBinds(doc, opts.data, binds, mode, watch); } catch (err) {
      report.errors.push({ kind: 'event', message: String((err && err.message) || err) });
    }

    // on a live page the scroll-reveal has already passed over a list that is drawn now: show its items at once
    if (mode === 'live') {
      qsa(doc, '[data-rv-item]').forEach(function (card) {
        if (KINDS.indexOf(card.getAttribute('data-rv-item')) === -1) return;
        [card].concat(qsa(card, '.animated')).forEach(function (n) { if (n.classList.contains('animated')) n.classList.add('go'); });
      });
    }

    watched.forEach(function (root, i) {
      if (!root.isConnected || root.outerHTML === before[i]) return;
      report.sections.push(root);
      if (typeof opts.retag === 'function') { try { opts.retag(root); } catch (err) { /* the editor's own tagging; never the page's problem */ } }
    });
    return report;
  }

  function refresh(doc, opts) {
    opts = opts || {};
    var got = opts.data ? Promise.resolve(opts.data) : fetchData(opts.eventId, opts);
    return got.then(function (data) {
      var settings = {};
      Object.keys(opts).forEach(function (k) { settings[k] = opts[k]; });
      settings.data = data;
      var report = apply(doc, settings);
      report.data = data;
      return report;
    }).then(null, function (err) {
      var report = newReport();
      report.error = { status: (err && err.status) || 0, code: (err && err.code) || 'fetch-failed', message: (err && err.message) || failureText(0) };
      return report;
    });
  }

  /* ---------- for the editor ---------- */
  function managedBy(el) {
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el || !el.closest) return null;
    var tab, notice = el.closest('[data-rv-empty-state]');
    if (notice) {
      tab = TABS[notice.getAttribute('data-rv-empty-state')];
      return tab ? { kind: notice.getAttribute('data-rv-empty-state'), tab: tab.tab, route: tab.route, label: tab.label, id: '' } : null;
    }
    var item = el.closest('[data-rv-item]');
    if (item) {
      var kind = item.getAttribute('data-rv-item');
      tab = TABS[kind];
      // a card the wizard painted before the event had records carries the same marker but is still the owner's text
      if (tab && (item.hasAttribute('data-rv-id') || item.closest('[data-rv-bound="' + kind + '"]'))) {
        return { kind: kind, tab: tab.tab, route: tab.route, label: tab.label, id: item.getAttribute('data-rv-id') || '' };
      }
    }
    var bound = el.closest('[data-rv-bind]');
    if (bound) return { bind: bound.getAttribute('data-rv-bind'), tab: BASICS.tab, route: BASICS.route, label: BASICS.label };
    return null;
  }

  function detach(el) {
    if (el && el.nodeType !== 1) el = el.parentElement;
    var bound = el && el.closest ? el.closest('[data-rv-bind]') : null;
    if (!bound) return false;
    qsa(bound, '[data-rv-bind-hint]').forEach(function (n) { n.remove(); });
    bound.setAttribute('data-rv-unbound', bound.getAttribute('data-rv-bind'));
    bound.removeAttribute('data-rv-bind');
    bound.removeAttribute('data-rv-bind-empty');
    bound.removeAttribute('data-rv-from-data');
    showSlot(bound);
    return true;
  }

  function strip(root) {
    if (!root || !root.querySelectorAll) return root;
    qsa(root, '[data-rv-empty-state], [data-rv-bind-hint]').forEach(function (n) { n.remove(); });
    // the kept models are out of reach of the editor's own clean-up (a selector does not look inside a <template>)
    qsa(root, 'template[data-rv-pristine]').forEach(function (t) {
      qsa(t.content, '[data-editable], [contenteditable], [data-sec-name], [data-text-original]').forEach(function (n) {
        ['data-editable', 'contenteditable', 'data-sec-name', 'data-text-original'].forEach(function (a) { n.removeAttribute(a); });
      });
    });
    return root;
  }

  global.RevampData = {
    VERSION: VERSION, KINDS: KINDS, TABS: TABS, BASICS: BASICS, MARKERS: MARKERS, AVATAR: AVATAR,
    fetch: fetchData, toContent: toContent, apply: apply, refresh: refresh,
    managedBy: managedBy, detach: detach, strip: strip
  };
})(window);
