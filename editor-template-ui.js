/* Template-mode editor UI (custom_editor.html?template=<id>).

   custom_editor.html's own selection/toolbar/Design-panel code works directly on a same-document demo
   site and has no concept of an iframe. RevampCanvas (editor-canvas.js) mounts a real template into an
   iframe instead, so this file owns everything that's genuinely different in template mode: selection +
   a trimmed floating toolbar (text/button/image — the core actions only; typography/border/schedule/AI
   popovers stay demo-only for now), section tools (duplicate/hide/delete, add from the template's own
   library, repeat-item add/remove, accordion open-to-edit), persistence + undo/redo via RevampStore +
   canvas.snapshot()/restore(), device switching, preview and publish.

   window.RevampTemplateUI = { boot(frameEl, templateId, host) }
     host: { escHtml, showToast, EV, editorEventId } — only showToast/escHtml are used here.
   Also: hasAiProvenance(), aiProvenanceSections(), setAiMarkers(show) — custom_editor.html's AI-provenance
   badge toggle and publish-review gate read/drive these; see "AI-provenance badges" below. */
(function () {
  'use strict';

  var canvas = null, host = null, templateId = null, eventId = null, storeKey = null, sourceDraftId = null;
  var frame = null;
  /* Bump this whenever a fix changes what "correctly filled" means for a generated template's local
     snapshot (e.g. the templates/_shared/template-loader.js tagSection() fix: every data-rv-section attr
     was silently never added for any library-section-based template, so RevampFill.apply() was a no-op on
     every Generate-from-Brief event, EVER — including the very first fill, which still got saved as a
     "successfully seeded" (real sourceDraftId recorded) local snapshot). resolveInitialContent()'s
     authoritative-draftId check alone can't catch that case: the draftId genuinely matches, the snapshot
     really was seeded from the real draft, the FILL that ran against it was just broken at the time. A
     locally-cached snapshot only skips re-fetching the server's draft when its own recorded fillVersion
     also matches this constant; anything older (or never set, i.e. every snapshot that predates this
     version-stamp existing at all) is treated the same as "never successfully seeded", forcing one real
     re-fetch-and-refill — same self-healing idea as the sourceDraftId check, one layer more precise. */
  var FILL_LOGIC_VERSION = 2;
  var undoStack = [], undoPtr = -1, commitTimer = null;
  var selectedEl = null, activeSectionEl = null, editingEl = null;
  var selToolbar = null, secToolbar = null;

  function showToast(msg) { if (host && host.showToast) host.showToast(msg); }
  function escHtml(s) { return host && host.escHtml ? host.escHtml(s) : String(s == null ? '' : s); }

  /* ---------- key derivation ----------
     site:<event>:<template> — ONE stable identity per real event (its own slug, the only identifier that
     exists now that every event is real; the old numeric 1-8 RevampCore.EVENTS scheme this briefly keyed
     off is gone). A fresh creation (`?from=create&slug=<slug>`) and a later plain reopen (`?event=<slug>`)
     now resolve to the EXACT SAME storeKey — that identity used to differ (creation used `new-<slug>`,
     reopen used the bare param), which meant NO reopen link anywhere in the app could ever actually find
     a creation session's saved snapshot (confirmed by tracing every `custom_editor.html?event=` link in
     the repo — none of them ever passed `new-<slug>`). `slug` wins over `event` when both are present
     (every creation redirect sends `slug`; `event` is what older/other reopen links use).

     B1 (separate problem, still needs solving without reintroducing this one): a plain `from=create`
     wizard visit is meant to be stable across repeat opens of the SAME event — that's what lets someone
     leave and come back to keep editing. Generate-from-Brief's redirect additionally carries `&draft=
     <draftId>` (the Firestore doc /api/generate-content just wrote); running it a SECOND time for the
     same slug must NOT silently restore run #1's old snapshot. Previously this was "solved" by baking
     draftId into the KEY ITSELF — which fixed run #2 but left run #1's snapshot permanently orphaned at
     an unreachable key, and reintroduced the exact bug this comment opens with for any later reopen.
     resolveInitialContent() below now does this the other way: the key stays this one stable identity
     always, and a saved snapshot is only treated as stale (fresh draft wins) when this visit is a NEW
     Generate-from-Brief run — fromCreate, carries a draftId, and that draftId doesn't match whichever
     run last actually wrote this canonical key (tracked via sourceDraftId, see seedSnapshot/persist). */
  function resolveKey(tplId) {
    var qs = new URLSearchParams(location.search);
    var id = qs.get('slug') || qs.get('event') || '1';
    return { eventId: id, storeKey: 'site:' + id + ':' + tplId };
  }

  /* ---------- boot ---------- */
  function boot(frameEl, tplId, hostApi) {
    host = hostApi; templateId = tplId; frame = frameEl;
    var k = resolveKey(tplId); eventId = k.eventId; storeKey = k.storeKey;

    /* a section order chosen in Create Event (create-event.html's S.sectionOrder — see
       autoPersonalizeDesign()/requestAiDesign()) has to be known BEFORE mount(), since reordering is baked
       into the iframe's DOM at load time, not something RevampFill.apply() can do to an already-mounted
       canvas afterward. Reading the handoff draft here (rather than only later, in resolveInitialContent())
       means it's read twice on a fresh "from=create" open — cheap (one localStorage.getItem), and simpler
       than threading it through as a boot() parameter. */
    var earlyDraft = new URLSearchParams(location.search).get('from') === 'create' ? readHandoffDraft() : null;

    return RevampCanvas.mount(frame, templateId, { sectionOrder: earlyDraft && earlyDraft.sectionOrder }).then(function (c) {
      canvas = c;
      return resolveInitialContent();
    }).then(function () {
      // real Content-tab data (speakers/partners/faq/contacts/glimpses) overlaid on top of whatever base
      // content resolveInitialContent() just settled on — see applySubcollectionOverlay()'s own comment.
      return applySubcollectionOverlay();
    }).then(function () {
      buildToolbars();
      wireCanvasEvents();
      wireGlobalKeys();
      wireDesignBridge();
      wireChatPanel();
      updateHistoryButtons();
      showTopbar();
      /* Publish/Preview start disabled (see the <button disabled> markup in custom_editor.html) and are
         only enabled here, once mount() + resolveInitialContent()'s AI-content fill have BOTH genuinely
         finished — real, confirmed bug this closes: RevampCanvas.mount() renders the template's raw,
         UNFILLED library markup first, fill is a separate async step straight after, and neither button
         was ever gated on either one completing. A user who clicked Publish in that window (exactly
         "clicked Publish as soon as the site was created") captured and published the unfilled template
         itself — "Event name goes here", "Card title" placeholders — not the real generated content,
         which was sitting correctly in Firestore the whole time. Left disabled on the .catch() below: if
         loading genuinely failed, there is nothing real to publish/preview either. */
      document.getElementById('btn-publish').disabled = false;
      document.getElementById('btn-preview').disabled = false;
    }).catch(function (err) {
      showToast("Couldn't load this template");
      if (window.console) console.error(err);
    });
  }

  function showTopbar() {
    var nameEl = document.getElementById('ed-event-name');
    var metaEl = document.getElementById('ed-event-meta');
    var qs = new URLSearchParams(location.search);
    var fromCreate = qs.get('from') === 'create';
    var draft = fromCreate ? readHandoffDraft() : null;
    var ev = draft && draft.event;
    if (nameEl) nameEl.textContent = (ev ? ev.name : canvas.template.name || canvas.template.title) + (ev && ev.slug ? ' | etoneworld.com/' + ev.slug : '');
    if (metaEl) metaEl.textContent = [ev && ev.dateLabel, ev && ev.location, canvas.template.name, 'Draft'].filter(Boolean).join('  |  ');
    document.title = (ev ? ev.name : canvas.template.name) + ' — Site Editor';
  }

  function readHandoffDraft() {
    try { return JSON.parse(localStorage.getItem('revamp.editor.handoff.v1') || 'null'); } catch (e) { return null; }
  }

  /* Applies a handoff draft (the revamp.editor.handoff.v1 shape — from localStorage on a fresh fromCreate
     visit, or from GET /api/draft's own `handoff` field on a stateless reopen, see resolveInitialContent())
     to the just-mounted canvas and seeds it as this device's first local snapshot. `draftId` is whichever
     run actually produced this content — the URL's own `?draft=` on a fresh run, or the server's own
     `draftId` field when fetched fresh from Firestore — recorded so a LATER fromCreate regeneration in this
     same browser can still tell "stale" apart from "already current" (see resolveKey()'s own B1 comment). */
  function applyHandoffDraft(draft, draftIdForThisDraft) {
    /* create-event.html keys each draft's logo under its own per-session slot (S.logoSessionId, handed off
       as draft.event.logoKey) — deliberately NOT a fallback to the single fixed 'create:logo' key: that was
       a real, confirmed bug (whichever event's logo was uploaded most recently in this browser silently
       became every OTHER event's logo too, since every draft read and wrote that exact same global slot
       regardless of which event it actually belonged to), and GET /api/draft's own handoff shape
       (libraryToHandoffDraft() in functions/lib/api.js) never sets logoKey at all — a Generate-from-Brief
       event's uploaded logo only ever lived in the creating browser's own IndexedDB, never persisted
       server-side, so there is no real logo to recover on a stateless reopen (a different browser, or this
       one after local state is gone) either way. Falling back to the shared key here would silently show
       this browser's most recently cached OTHER event's logo instead — worse than no logo at all. Missing
       logoKey now correctly means "nothing to show", not "guess" — note this must stay a no-op Promise
       rather than RevampStore.get(undefined): IndexedDB's own get() throws synchronously on an invalid
       key, which would reject this whole chain and fail the entire editor load over a missing logo. */
    var logoKey = draft.event && draft.event.logoKey;
    return (logoKey ? RevampStore.get(logoKey) : Promise.resolve(undefined)).then(function (logoRec) {
      var ctx = RevampFill.fromHandoff(draft, logoRec && logoRec.dataUrl);
      var report = RevampFill.apply(canvas, ctx);
      renderAiProvenanceBadges();
      if (report.skipped.length) showToast('Not shown on this template: ' + report.skipped.join(', '));
      /* a design chosen in Create Event's "Let AI design it" (create-event.html's S.aiDesign) rides along
         in the hand-off payload — apply it before the first snapshot so it survives into the undo stack,
         reload and publish, instead of silently reverting to the template's static default. */
      if (draft.aiDesign) applyAiDesignToCanvas(canvas, draft.aiDesign);
      sourceDraftId = draftIdForThisDraft;
      return seedSnapshot(draft);
    });
  }

  /* Real, confirmed bug this closes: a Generate-from-Brief event's AI-written content only ever reached
     the editor via the ?from=create handoff in THIS browser's own localStorage — written once, right after
     generation, in the same tab. Any later, stateless reopen (a different device, a different browser, this
     same browser after the handoff/local snapshot is gone) had no local snapshot and fromCreate was false,
     so it fell straight to seedSnapshot(null) — the template's raw, UNFILLED library markup ("Event name
     goes here", the 1x1 grey logo placeholder) — even though the real generated content was sitting
     correctly in Firestore the whole time. Worse, seedSnapshot(null) then PERMANENTLY saves that blank
     render as this device's own local snapshot, so every later open on that device keeps finding it and
     never checks again. GET /api/draft?eventId=<id> already exists for exactly this (same endpoint
     preview-draft.html — a dev-only bridge — already uses, returning the exact revamp.editor.handoff.v1
     shape) — a plain reopen now tries it before giving up, same as the fromCreate path, just sourced from
     the server instead of localStorage. A 404 (not a Generate-from-Brief event / nothing ever generated)
     correctly falls through to the real blank-template case, unchanged. */
  function fetchServerDraft() {
    return fetch('/api/draft?eventId=' + encodeURIComponent(eventId))
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) { return res.ok ? res.body : null; })
      .catch(function () { return null; });
  }

  function resolveInitialContent() {
    return RevampStore.get(storeKey).then(function (saved) {
      var qs = new URLSearchParams(location.search);
      var fromCreate = qs.get('from') === 'create';
      var draftId = qs.get('draft') || null;

      // B1: see resolveKey()'s own comment. Only a NEW Generate-from-Brief run for this same event
      // (fromCreate, carries a draftId that doesn't match whoever last actually saved this key) treats
      // an existing snapshot as stale — a plain wizard open (fromCreate, no draftId ever) or a plain
      // reopen (not fromCreate) always finds exactly what was last saved here, same as before.
      var isStale = !!(saved && saved.snapshot && fromCreate && draftId && saved.sourceDraftId !== draftId);
      // See FILL_LOGIC_VERSION's own comment: a snapshot seeded under an older fill-logic version can have
      // the exactly-right sourceDraftId and still be wrong, because what ran against it to fill it was
      // broken at the time. Gates every "trust this outright, no need to re-fetch" decision below for a
      // gen-<id> template; the true last-resort fallbacks (server unreachable/empty) deliberately skip this
      // gate further down — showing a possibly-stale local copy there is still better than nothing.
      var isCurrentVersion = !/^gen-/.test(templateId || '') || (saved && saved.fillVersion === FILL_LOGIC_VERSION);

      function restoreLocal() {
        sourceDraftId = saved.sourceDraftId || null;
        canvas.restore(saved.snapshot);
        undoStack = [saved.snapshot]; undoPtr = 0;
      }

      /* A gen-<id> (Generate-from-Brief) template's local snapshot is NOT unconditionally trusted on a
         plain reopen, the way every other template's is — the server's own latest draftId (GET /api/draft)
         is checked first and is authoritative. This isn't just the "never seeded at all" case (an earlier,
         narrower version of this fix only caught that, via sourceDraftId being unset): a device can also
         have a local snapshot that WAS seeded, with a real sourceDraftId recorded, from an earlier, lower-
         quality or outright broken version of the generation/fill pipeline predating later fixes — looking
         "seeded" is not the same as being correct. Comparing against the server's real current draftId
         catches both: a local copy is only trusted outright when it matches a draft that genuinely exists
         server-side right now. A real local edit is still safe either way — it only changes section
         content, never sourceDraftId itself (see persist()'s own comment), so an edited-but-still-current
         draft keeps matching and is never silently discarded. */
      if (fromCreate) {
        if (saved && saved.snapshot && !isStale && isCurrentVersion) { restoreLocal(); return; }
        var draft = readHandoffDraft();
        if (draft && draft.sections && draft.sections.length) return applyHandoffDraft(draft, draftId);
        if (saved && saved.snapshot) { restoreLocal(); return; }
        return seedSnapshot(null);
      }

      if (!/^gen-/.test(templateId || '')) {
        if (saved && saved.snapshot) { restoreLocal(); return; }
        return seedSnapshot(null);
      }

      return fetchServerDraft().then(function (res) {
        var serverDraftId = res && res.draftId;
        if (saved && saved.snapshot && serverDraftId && saved.sourceDraftId === serverDraftId && isCurrentVersion) { restoreLocal(); return; }
        if (res && res.handoff && res.handoff.sections && res.handoff.sections.length) {
          return applyHandoffDraft(res.handoff, serverDraftId || null);
        }
        // Nothing current on the server — fall back to whatever's cached locally rather than re-seeding
        // blank, so a real edit (or a draft the server fetch itself just failed to reach) isn't discarded.
        if (saved && saved.snapshot) { restoreLocal(); return; }
        return seedSnapshot(null);
      });
    });
  }

  /* ---------- real Content-tab data (speakers/partners/faq/contacts/glimpses) ----------
     edit-event.html's Content tab writes real, persistent per-event Firestore subcollections
     (functions/lib/api.js's RESOURCES — speakers, partners, faqs, contacts, gallery, + their
     speaker-groups/partner-tiers side tables) that, until now, nothing ever read back into a mounted
     template: editing a speaker there had zero effect on what this editor (or a publish) showed, because
     the content.map-driven sections above are wired only to the one-time wizard/Generate-from-Brief
     hand-off snapshot (resolveInitialContent()/applyHandoffDraft() above), never to the real subcollections.

     SUBCOLLECTION_SOURCES is the explicit `from` -> resource bridge — content.map's own `from` strings
     don't all match the subcollection's resource name (e.g. "faq" vs "faqs"), so this can't be derived
     automatically. One entry per `from` a REAL ported template actually maps to one of these resources
     today (confirmed by reading every template.json under templates/ and its own content.map):
       speakers -> speakers            {n,r,c,photo} items   (cx-leaders-forum, making-ai-work)
       faq      -> faqs                {t,d} items           (cx-leaders-forum, retail-leadership-summit, tech500)
       partners -> partners+partner-tiers  {t, logos:[{n}]} tiers  (retail-leadership-summit)
       contact  -> contacts            {t, people:[{n,e,p}]} blocks (cx-leaders-forum, making-ai-work,
                                        retail-leadership-summit, tech500 — same shape editor-fill.js's
                                        own fromHandoff() already special-cases for the OLDER per-category
                                        hand-off shape)
       glimpses -> gallery             {url} items — "glimpses" is create-event.html's own library id for
                                        this (shape:'gallery', GENERATION_EXCLUDED_LIBRARIES — real photos,
                                        never AI-written); the subcollection's own `caption` field has no
                                        content.map consumer anywhere yet, so it's read but not used.
     Deliberately NOT covered: sessions/agenda. No ported template's content.map has a `from` for it at all
     (grepped every template.json under templates/ — none exists), so there is no existing fill-rule SHAPE to
     translate into; inventing one here would mean designing that convention from scratch, which is a
     bigger, separate decision than bridging an existing one. Left for a future task once a template
     actually wires an agenda section into content.map.

     translate() turns GET /api/event/<resource>'s raw items (the real subcollection field names) into the
     exact shape that `from`'s own content.map fill rules already expect — same values RevampFill.apply()
     already knows how to render, just sourced for real instead of from the one-time hand-off. Returns null
     for "nothing real yet" (so the caller never confuses an empty subcollection with real-but-empty
     content — see fetchSubcollectionOverlay()'s own comment on why that distinction matters). Lists come
     back from the server already sorted by their own `order` field (subcollectionRoutes()'s list handler),
     including speakers/partners' own flat, cross-group display order (edit-event.html's persistSpeakerOrder/
     the partner equivalent re-numbers `order` across the whole flat list, not per-group) — so no extra
     client-side sort is needed for the plain lists; translatePartners still groups by tier explicitly,
     since that structure (tiers -> logos) doesn't exist on the flat `partners` list itself. */
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  function translateSpeakers(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (p) { return { n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '' }; }) };
  }
  function translateFaqs(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (f) { return { t: f.question || '', d: f.answer || '' }; }) };
  }
  function translateGallery(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (g) { return { url: g.imageUrl || '' }; }) };
  }
  function translateContacts(items) {
    if (!items || !items.length) return null;
    // one row per contact (label + one person) — several rows can share the same label (several people
    // under one "purpose"), same shape editor-fill.js's own fromHandoff() already builds for the older
    // per-category hand-off (one block per label, each with a people[] list).
    var blocks = [], byLabel = {};
    items.forEach(function (c) {
      var label = c.label || '';
      if (!byLabel[label]) { byLabel[label] = { t: label, people: [] }; blocks.push(byLabel[label]); }
      byLabel[label].people.push({ n: c.name || '', e: c.email || '', p: c.phone || '' });
    });
    return blocks.length ? { blocks: blocks } : null;
  }
  function translatePartners(partners, tiers) {
    if (!partners || !partners.length) return null;
    var slots = {}, ordered = [];
    (tiers || []).slice().sort(byOrder).forEach(function (t) {
      var slot = { t: t.name || '', logos: [] };
      slots[t.id] = slot;
      ordered.push(slot);
    });
    // a partner with no tier (or no tiers set up at all) still needs to show somewhere — real data from
    // the Content tab is never silently dropped just because Tiers haven't been configured.
    var fallback = { t: '', logos: [] };
    partners.slice().sort(byOrder).forEach(function (p) {
      (slots[p.tierId] || fallback).logos.push({ n: p.name || '' });
    });
    if (fallback.logos.length) ordered.push(fallback);
    var tiersOut = ordered.filter(function (t) { return t.logos.length; });
    return tiersOut.length ? { tiers: tiersOut } : null;
  }

  var SUBCOLLECTION_SOURCES = {
    speakers: { resources: ['speakers'], translate: translateSpeakers },
    faq: { resources: ['faqs'], translate: translateFaqs },
    partners: { resources: ['partners', 'partner-tiers'], translate: translatePartners },
    contact: { resources: ['contacts'], translate: translateContacts },
    glimpses: { resources: ['gallery'], translate: translateGallery }
  };

  /* ---------- generic data-rv-repeat-template convention (AI-bespoke `gen-` sections) ----------
     The content.map-driven mechanism just above exists for PORTED templates (real templates/<id>/
     template.json files with their own fill rules). The new AI-designed `gen-` pipeline (functions/lib/
     api.js having Gemini write bespoke per-section HTML+CSS instead of filling a fixed component
     library) has an EMPTY content.map — nothing for the `from` scan above to find — so it needs its own,
     independent detection: Gemini is instructed to emit a fixed, simple DOM convention instead of a
     content.map entry. A section with dynamic data has exactly one `[data-rv-repeat-template="<kind>"]`
     element (the template for ONE repeated item), with descendants inside it carrying
     `data-rv-field="<fieldName>"` using a small fixed per-kind vocabulary (see applyGenericRepeat()'s own
     comment). This block translates the same real subcollection rows the mechanism above reads into the
     SIMPLE FLAT list shape that convention needs, and fills the DOM directly (no RevampFill.apply() —
     that function only knows about content.map rules, which these templates don't have).

     Named *Flat and kept entirely separate from translateSpeakers/translateFaqs/translateGallery/
     translatePartners/translateContacts above even where the shape ends up nearly identical (speakers/
     faq/glimpses) — those existing ones are documented as serving ONLY the content.map mechanism;
     sharing them here would be an accidental coupling waiting to break either path if the other is
     edited for its own reasons later. Same "confirmed empty -> null, don't override" discipline as the
     existing translators: null tells the caller to leave Gemini's own placeholder example item alone
     rather than wiping it. */
  function translateSpeakersFlat(items) {
    if (!items || !items.length) return null;
    return items.map(function (p) { return { n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '' }; });
  }
  function translateFaqsFlat(items) {
    if (!items || !items.length) return null;
    return items.map(function (f) { return { t: f.question || '', d: f.answer || '' }; });
  }
  function translateGalleryFlat(items) {
    if (!items || !items.length) return null;
    return items.map(function (g) { return { imageUrl: g.imageUrl || '', caption: g.caption || '' }; });
  }
  function translateContactsFlat(items) {
    if (!items || !items.length) return null;
    return items.map(function (c) { return { label: c.label || '', name: c.name || '', email: c.email || '', phone: c.phone || '' }; });
  }
  // Flat convention has no tier grouping (unlike translatePartners above) — one item per partner,
  // tierId is simply dropped; order still follows the same flat display `order` field.
  function translatePartnersFlat(partners) {
    if (!partners || !partners.length) return null;
    return partners.slice().sort(byOrder).map(function (p) { return { name: p.name || '', url: p.url || '', logo: p.logoUrl || '' }; });
  }

  var GENERIC_REPEAT_SOURCES = {
    speakers: { resources: ['speakers'], translate: translateSpeakersFlat },
    faq: { resources: ['faqs'], translate: translateFaqsFlat },
    partners: { resources: ['partners'], translate: translatePartnersFlat },
    contact: { resources: ['contacts'], translate: translateContactsFlat },
    glimpses: { resources: ['gallery'], translate: translateGalleryFlat }
  };

  // Distinct `kind` values actually present in the mounted canvas, restricted to the 5 known kinds
  // (anything else is ignored defensively — not this convention's business).
  function findRepeatKindsInDom(canvas) {
    if (!canvas || !canvas.doc) return [];
    var found = [];
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-repeat-template]'), function (el) {
      var kind = el.getAttribute('data-rv-repeat-template');
      if (GENERIC_REPEAT_SOURCES[kind] && found.indexOf(kind) === -1) found.push(kind);
    });
    return found;
  }

  /* Fixed per-kind field vocabulary (byte-for-byte contract with the backend task's Gemini prompt —
     do not rename):
       speakers: n (name), r (role), c (company), photo (image)
       faq:      t (question), d (answer)
       partners: name, url (href on an <a>, else text), logo (image)
       contact:  label, name, email, phone
       glimpses: imageUrl (image), caption
     Missing/falsy values leave the clone's existing placeholder content alone rather than blanking it —
     same never-wipe-to-empty discipline used elsewhere in this file (see translate() comment above). */
  function setGenericRepeatField(fieldEl, field, value, kind) {
    if (!value) return;
    var isImage = field === 'photo' || field === 'logo' || field === 'imageUrl';
    if (isImage) {
      if (fieldEl.tagName === 'IMG') fieldEl.src = value;
      else fieldEl.style.backgroundImage = 'url(' + value + ')';
      return;
    }
    if (kind === 'partners' && field === 'url') {
      if (fieldEl.tagName === 'A') fieldEl.href = value;
      else fieldEl.textContent = value;
      return;
    }
    if ('value' in fieldEl) fieldEl.value = value;
    else fieldEl.textContent = value;
  }

  function fillGenericRepeatClone(clone, item, kind) {
    var fields = clone.hasAttribute('data-rv-field') ? [clone] : [];
    fields = fields.concat(Array.prototype.slice.call(clone.querySelectorAll('[data-rv-field]')));
    fields.forEach(function (fieldEl) {
      var field = fieldEl.getAttribute('data-rv-field');
      setGenericRepeatField(fieldEl, field, item[field], kind);
    });
  }

  /* items null/empty -> do nothing, leave Gemini's own markup exactly as written (no template element to
     clone from means nothing to do either way). Otherwise: clone the single `[data-rv-repeat-template=
     "<kind>"]` element once per item, fill its data-rv-field descendants, insert each clone right after
     the previous one (so document order follows `items`' own order, starting right after the original),
     then drop the original template node once every clone is in — leaving only real, filled items.
     data-rv-repeat-template/data-rv-field are left on the clones: harmless, unrendered markers, not worth
     stripping. */
  function applyGenericRepeat(canvas, kind, items) {
    if (!items || !items.length) return;
    if (!canvas || !canvas.doc) return;
    var tpl = canvas.doc.querySelector('[data-rv-repeat-template="' + kind + '"]');
    if (!tpl || !tpl.parentNode) return;
    var ref = tpl;
    items.forEach(function (item) {
      var clone = tpl.cloneNode(true);
      fillGenericRepeatClone(clone, item, kind);
      ref.parentNode.insertBefore(clone, ref.nextSibling);
      ref = clone;
    });
    tpl.parentNode.removeChild(tpl);
  }

  /* Mirrors fetchSubcollectionOverlay() below, one layer over: detection is findRepeatKindsInDom()
     (scans the mounted DOM for data-rv-repeat-template) instead of a content.map `from` scan, and
     translation goes through GENERIC_REPEAT_SOURCES (the *Flat translators) instead of
     SUBCOLLECTION_SOURCES. A ported template never has data-rv-repeat-template elements, so this
     resolves null for it with zero extra fetches; a `gen-` template's empty content.map means the OTHER
     function's `from` scan finds nothing for it — the two detection paths are complementary, never
     competing for the same template. Same "couldn't fetch" vs "confirmed empty" null handling as
     fetchSubcollectionOverlay(). */
  function fetchGenericRepeatOverlay() {
    if (!canvas || !eventId || eventId === '1') return Promise.resolve(null);
    var kinds = findRepeatKindsInDom(canvas);
    if (!kinds.length) return Promise.resolve(null);
    var resourceNames = [];
    kinds.forEach(function (kind) {
      GENERIC_REPEAT_SOURCES[kind].resources.forEach(function (r) { if (resourceNames.indexOf(r) === -1) resourceNames.push(r); });
    });
    return Promise.all(resourceNames.map(function (r) {
      return RevampCore.fetchSub(r, eventId).catch(function () { return null; });
    })).then(function (results) {
      var byResource = {};
      resourceNames.forEach(function (name, i) { byResource[name] = results[i]; });
      var overlay = {};
      kinds.forEach(function (kind) {
        var cfg = GENERIC_REPEAT_SOURCES[kind];
        var inputs = cfg.resources.map(function (r) { return byResource[r]; });
        if (inputs.indexOf(null) !== -1) return;   // a needed fetch failed — leave this kind untouched
        var items = cfg.translate.apply(null, inputs);
        if (items) overlay[kind] = items;
      });
      return Object.keys(overlay).length ? overlay : null;
    });
  }

  /* Fetches whichever of the resources above this MOUNTED template's own content.map actually uses (never
     more — a template with no speaker/partner/faq/contact/glimpses section makes zero extra calls) and
     builds the merged content object, or resolves null when there's nothing real to overlay (no matching
     content.map entry at all, no real event context, or every matching resource came back empty/failed).

     Real subcollection rows are AUTHORITATIVE for their own `from` when they exist: a user who adds
     structured data via the Content tab almost certainly wants that to be what the page shows, not a
     stale wizard/Generate-from-Brief snapshot from whenever the draft was first generated — overriding,
     not merging field-by-field, is the one unambiguous reading of "the real data now wins". An EMPTY
     subcollection (nobody has touched the Content tab yet, or a resource's own fetch genuinely failed —
     not signed in, offline, etc.) must NOT override anything — scrubbing a real event's existing
     wizard-snapshot speakers down to nothing just because the Content tab is still empty would be a real
     regression, not an improvement. translate() returning null is exactly that "leave it alone" signal;
     a failed fetch (rejected promise, caught below as null in byResource — not the same null as an empty
     array) is treated the same way for the same reason: "couldn't tell" must never look like "confirmed
     empty". */
  function fetchSubcollectionOverlay() {
    if (!canvas || !eventId || eventId === '1') return Promise.resolve(null);
    var spec = (canvas.template.content || {}).map || [];
    var froms = Object.keys(SUBCOLLECTION_SOURCES).filter(function (from) {
      return spec.some(function (m) { return m.from === from; });
    });
    if (!froms.length) return Promise.resolve(null);
    var resourceNames = [];
    froms.forEach(function (from) {
      SUBCOLLECTION_SOURCES[from].resources.forEach(function (r) { if (resourceNames.indexOf(r) === -1) resourceNames.push(r); });
    });
    return Promise.all(resourceNames.map(function (r) {
      return RevampCore.fetchSub(r, eventId).catch(function () { return null; });   // null: couldn't fetch, not "empty"
    })).then(function (results) {
      var byResource = {};
      resourceNames.forEach(function (name, i) { byResource[name] = results[i]; });
      var content = {};
      froms.forEach(function (from) {
        var cfg = SUBCOLLECTION_SOURCES[from];
        var inputs = cfg.resources.map(function (r) { return byResource[r]; });
        if (inputs.indexOf(null) !== -1) return;   // a needed fetch failed — leave this `from` untouched
        var value = cfg.translate.apply(null, inputs);
        if (value) content[from] = value;
      });
      return Object.keys(content).length ? content : null;
    });
  }

  /* Runs once per boot(), right after resolveInitialContent() has settled the canvas into whatever base
     state it was going to have (a restored local snapshot, a freshly-applied hand-off, or the template's
     own blank sample content) — see boot()'s own call site. Scoped deliberately to "the editor just
     (re)opened", not live sync: a Content-tab edit shows up the NEXT time this page loads, not instantly in
     an already-open tab elsewhere (see the task's own point on this). Reuses RevampFill.apply() completely
     unchanged — ctx.content here only ever has the few `from` keys fetchSubcollectionOverlay() actually
     resolved, so every OTHER content.map entry's `if (!(m.from in ctx.content)) return;` guard skips it,
     leaving the rest of the canvas exactly as resolveInitialContent() left it. ctx.excluded is deliberately
     [] (never hides/shows a section — that's the user's own Hide toggle's business, not this overlay's),
     and ctx.generatedFromBrief is false (no AI-provenance badge should ever appear just because this ran). */
  function applySubcollectionOverlay() {
    // Both detection paths run together — content.map `from` (ported templates) and the DOM
    // data-rv-repeat-template convention (AI-bespoke `gen-` templates) — and contribute additively to
    // one merged apply pass; see fetchGenericRepeatOverlay()'s own comment on why they never compete.
    return Promise.all([fetchSubcollectionOverlay(), fetchGenericRepeatOverlay()]).then(function (results) {
      var content = results[0], repeatOverlay = results[1];
      var changed = false;
      if (content) {
        var report = RevampFill.apply(canvas, { content: content, names: {}, excluded: [], generatedFromBrief: false, aiSkippedLibraries: [] });
        if (report.filled.length) changed = true;
      }
      if (repeatOverlay) {
        Object.keys(repeatOverlay).forEach(function (kind) {
          applyGenericRepeat(canvas, kind, repeatOverlay[kind]);
          changed = true;
        });
      }
      if (!changed) return;
      // bakes the overlay into THIS session's baseline, same as any other edit — so Ctrl+Z doesn't revert
      // past it, and it rides along in the snapshot persist() already saves for every other reason.
      var snap = canvas.snapshot(undoStack[undoPtr]);
      undoStack[undoPtr] = snap;
      return persist(snap);
    }).catch(function (err) {
      // Never blocks the editor loading over this — same fail-soft posture as every other RevampCore
      // admin call in this app (not signed in yet, offline, a transient 500, …): the canvas still has
      // whatever resolveInitialContent() already gave it, which is strictly better than failing to load.
      if (window.console) console.warn('[RevampTemplateUI] Could not load real Content-tab data:', err);
    });
  }

  /* ---------- applying a Create Event AI design (kept in sync with create-event.html's own copy) ----------
     canvas.design.set('headingFont'/'bodyFont', …) only ever writes a CSS variable — it never loads the font
     file itself, so a family not already linked in the template's own <head> would silently fall back. */
  function ensureFontsLoaded(canvas, families) {
    var head = canvas.doc.head;
    (families || []).filter(Boolean).forEach(function (family) {
      var already = Array.prototype.some.call(head.querySelectorAll('link[rel="stylesheet"]'), function (l) {
        return (l.href || '').indexOf(encodeURIComponent(family).replace(/%20/g, '+')) !== -1;
      });
      if (already) return;
      var link = canvas.doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':wght@300;400;500;600;700;800&display=swap';
      head.appendChild(link);
    });
  }
  function applyAiDesignToCanvas(canvas, design) {
    if (!canvas || !design) return;
    ensureFontsLoaded(canvas, [design.headingFont, design.bodyFont]);
    Object.keys(design).forEach(function (key) {
      var isFont = key === 'headingFont' || key === 'bodyFont';
      canvas.design.set(key, isFont ? ('"' + design[key] + '", sans-serif') : design[key]);
    });
  }

  /* ---------- AI-provenance badges (Generate-from-Brief review gate) ----------
     editor-fill.js's apply() is the source of truth: it stamps data-ai-generated="true" (a content.map
     entry that actually ran and wrote real content) or data-ai-skipped="true" (no content.map entry
     targets that section at all) on the section itself, and only for an actual Generate-from-Brief draft.
     This renders the always-visible corner pill each attribute gets — plain markup inside the section, so
     it rides along in canvas.snapshot()'s saved outerHTML like everything else, no re-render needed on a
     later reload/restore. Visibility itself is pure CSS (editor-canvas.css, gated on html.show-ai-markers),
     so clearing the badge on edit (clearAiGenerated below) is just removing the attribute — the pill
     disappears on its own, one-way, with nothing to undo back on short of an actual Ctrl+Z to a prior
     snapshot (the same as undoing any other change). */
  var AI_SPARK_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  var AI_INFO_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>';

  function renderAiProvenanceBadges() {
    if (!canvas) return;
    // data-ed="none" (editor-canvas.js's walk()) is the template-authoring escape hatch for "never make this
    // editable" — the same one templates/README.md documents for template markup. Badges aren't template
    // markup, but they hit the exact same problem: canvas.restore() re-walks every section it rebuilds from a
    // snapshot string (every reload of an already-generated draft, and any undo/redo touching that section),
    // and by then these badges are already baked into the saved markup. Without data-ed="none", walk() would
    // tag the sparkle <svg>'s real <path>s data-editable="image" and the label <span> data-editable="text" on
    // every such rebuild — making the badge clickable/replaceable, and letting a click-out of its own text
    // fire exitEdit() -> clearAiGenerated(), silently stripping the real marker off a section nobody touched.
    // data-ed="none" makes walk() return before it ever calls descend() on the span, so neither it nor its
    // children are visited — and since it's a plain attribute on the span itself, it rides along in every
    // snapshot string same as the badge's own markup, so the skip holds on every future re-walk too, not just
    // the first mount.
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-ai-generated]'), function (sec) {
      if (sec.querySelector(':scope > .ai-prov-badge')) return;
      var span = canvas.doc.createElement('span');
      span.className = 'ai-prov-badge';
      span.setAttribute('data-ed', 'none');
      span.innerHTML = AI_SPARK_SVG + '<span>AI-generated</span>';
      sec.insertBefore(span, sec.firstChild);
    });
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-ai-skipped]'), function (sec) {
      if (sec.querySelector(':scope > .ai-skip-badge')) return;
      var span = canvas.doc.createElement('span');
      span.className = 'ai-skip-badge';
      span.setAttribute('data-ed', 'none');
      span.innerHTML = AI_INFO_SVG + '<span>Not generated — add manually</span>';
      sec.insertBefore(span, sec.firstChild);
    });
    // A2 — hero banner image/video: editor-fill.js stamps data-ai-media-skipped directly on the template's
    // own ported <img>/<video> elements it named via content.map's aiSkipMedia (image/video generation is
    // explicitly out of scope this pass — see editor-fill.js's header comment). Those elements can't host a
    // child badge themselves (an <img>/<video> can't contain child markup), so this is one badge per
    // SECTION, appended into the nearest [data-rv-section] ancestor instead — bottom-left (see
    // editor-canvas.css), so it never collides with that same section's own top-left .ai-prov-badge for its
    // (genuinely AI-written) text. Skipped when the section is already data-ai-skipped in full: that
    // section's one .ai-skip-badge already says "not generated" for everything in it, media included.
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-ai-media-skipped]'), function (el) {
      var sec = el.closest('[data-rv-section]');
      if (!sec || sec.hasAttribute('data-ai-skipped')) return;
      if (sec.querySelector(':scope > .ai-media-skip-badge')) return;
      var span = canvas.doc.createElement('span');
      span.className = 'ai-media-skip-badge';
      span.setAttribute('data-ed', 'none');
      span.innerHTML = AI_INFO_SVG + '<span>Template photo/video — replace manually</span>';
      sec.appendChild(span);
    });
  }

  /* whether this draft has any AI-provenance attribute currently mounted — gates both the topbar's
     show/hide-markers toggle (custom_editor.html) and whether a publish click shows the review gate at all,
     so neither ever appears for a normal hand-filled wizard draft. */
  function hasAiProvenance() {
    return !!(canvas && canvas.doc.querySelector('[data-ai-generated], [data-ai-skipped]'));
  }

  /* fresh, live read of the current DOM — never cached — for the publish-review gate's own body
     (custom_editor.html): one row per section currently carrying either attribute, by its own real name. */
  function aiProvenanceSections() {
    if (!canvas) return { generated: [], skipped: [] };
    function list(attr) {
      return Array.prototype.map.call(canvas.doc.querySelectorAll('[' + attr + ']'), function (sec) {
        var id = sec.getAttribute('data-rv-section');
        return { id: id, name: sec.getAttribute('data-sec-name') || id };
      });
    }
    return { generated: list('data-ai-generated'), skipped: list('data-ai-skipped') };
  }

  /* the topbar toggle's actual effect — a class on the iframe document's own <html>, since the badges
     (and editor-canvas.css's visibility rule for them) live inside it, not in custom_editor.html itself. */
  function setAiMarkers(show) {
    if (canvas) canvas.doc.documentElement.classList.toggle('show-ai-markers', !!show);
  }

  /* C1 — "cleared once a human edits that section": called at each of this file's own actual content-edit
     commit points below (never from the generic commit()/design bridges, which change layout/theme rather
     than a specific section's own written content) with whatever element is in scope there. One-way: once
     removed, nothing in this file ever sets it back. */
  function clearAiGenerated(el) {
    var sec = el && el.nodeType === 1 ? el.closest('[data-ai-generated]') : null;
    if (sec) sec.removeAttribute('data-ai-generated');
  }

  function seedSnapshot(draft) {
    var snap = canvas.snapshot();
    undoStack = [snap]; undoPtr = 0;
    return RevampStore.put(storeKey, { eventId: eventId, templateId: templateId, savedAt: Date.now(), snapshot: snap, handoff: draft, event: draft && draft.event, sourceDraftId: sourceDraftId, fillVersion: FILL_LOGIC_VERSION });
  }

  /* ---------- save / undo ---------- */
  function persist(snap) {
    // sourceDraftId/fillVersion ride along on every later edit too, not just the first save — otherwise the
    // very next commit() after seedSnapshot() would overwrite it with a record that has neither, and a
    // second Generate-from-Brief run later in the SAME browser would no longer be able to tell this apart
    // from a never-regenerated draft (see resolveInitialContent()'s staleness check), and a real manual
    // edit made just after a correct seed would look exactly like an old, pre-fix snapshot again.
    return RevampStore.put(storeKey, { eventId: eventId, templateId: templateId, savedAt: Date.now(), snapshot: snap, sourceDraftId: sourceDraftId, fillVersion: FILL_LOGIC_VERSION });
  }

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      var snap = canvas.snapshot(undoStack[undoPtr]);
      if (canvas.sameSnapshot(snap, undoStack[undoPtr])) return;
      undoStack = undoStack.slice(0, undoPtr + 1).concat([snap]);
      undoPtr = undoStack.length - 1;
      updateHistoryButtons();
      persist(snap);
    }, 400);
  }

  function undo() {
    if (undoPtr <= 0) return;
    deselect();
    undoPtr--; canvas.restore(undoStack[undoPtr]);
    updateHistoryButtons(); persist(undoStack[undoPtr]);
  }

  function redo() {
    if (undoPtr >= undoStack.length - 1) return;
    deselect();
    undoPtr++; canvas.restore(undoStack[undoPtr]);
    updateHistoryButtons(); persist(undoStack[undoPtr]);
  }

  function updateHistoryButtons() {
    var u = document.getElementById('btn-tpl-undo'), r = document.getElementById('btn-tpl-redo');
    if (u) u.disabled = undoPtr <= 0;
    if (r) r.disabled = undoPtr >= undoStack.length - 1;
  }

  /* ---------- selection + floating toolbar ---------- */
  function buildToolbars() {
    selToolbar = document.createElement('div');
    selToolbar.id = 'tpl-sel-toolbar';
    selToolbar.className = 'tpl-sel-toolbar';
    selToolbar.hidden = true;
    frame.appendChild(selToolbar);

    secToolbar = document.createElement('div');
    secToolbar.id = 'tpl-sec-toolbar';
    secToolbar.className = 'tpl-sec-toolbar';
    secToolbar.hidden = true;
    frame.appendChild(secToolbar);

    selToolbar.addEventListener('mousedown', function (e) { if (!e.target.closest('select, input')) e.preventDefault(); });
    selToolbar.addEventListener('click', onToolbarClick);
    secToolbar.addEventListener('click', onSecToolbarClick);
    document.addEventListener('mousedown', function (e) {
      if (frame.contains(e.target)) return;   // clicks inside the canvas/toolbars are handled on their own listeners
      deselect();
    });
  }

  function deselect() {
    if (editingEl) exitEdit(editingEl);
    if (selectedEl) selectedEl.classList.remove('ed-selected');
    selectedEl = null;
    selToolbar.hidden = true;
    if (activeSectionEl) activeSectionEl.classList.remove('sec-active');
    activeSectionEl = null;
    secToolbar.hidden = true;
  }

  function selectSectionOnly(sec) {
    if (selectedEl) { selectedEl.classList.remove('ed-selected'); selectedEl = null; selToolbar.hidden = true; }
    if (activeSectionEl) activeSectionEl.classList.remove('sec-active');
    activeSectionEl = sec; sec.classList.add('sec-active');
    buildSecToolbar(sec);
    positionSecToolbar(sec);
  }

  function selectElement(el) {
    if (editingEl && editingEl !== el) exitEdit(editingEl);
    if (selectedEl) selectedEl.classList.remove('ed-selected');
    selectedEl = el; el.classList.add('ed-selected');
    var sec = el.closest('[data-rv-section]');
    if (sec) selectSectionOnly(sec);
    buildToolbar(el);
    positionToolbar(el);
  }

  var TEXT_FORMAT_ACTIONS = { bold: 1, italic: 1, underline: 1, strikethrough: 1 };

  function buildToolbar(el) {
    var type = el.getAttribute('data-editable');
    var html = '';
    if (type === 'text') {
      html +=
        '<button class="icon-only" data-action="bold" title="Bold"><b>B</b></button>' +
        '<button class="icon-only" data-action="italic" title="Italic"><i>I</i></button>' +
        '<button class="icon-only" data-action="underline" title="Underline"><u>U</u></button>' +
        '<button class="icon-only" data-action="strikethrough" title="Strikethrough"><s>S</s></button>' +
        '<span class="tpl-tb-sep"></span>' +
        '<button class="icon-only" data-action="align-left" title="Align left">&#8676;</button>' +
        '<button class="icon-only" data-action="align-center" title="Align center">&#8596;</button>' +
        '<button class="icon-only" data-action="align-right" title="Align right">&#8677;</button>' +
        '<span class="tpl-tb-sep"></span>' +
        '<button data-action="link" title="Link">Link</button>';
    } else if (type === 'button') {
      html += '<button data-action="link" title="Link">Link</button>';
    } else if (type === 'image') {
      html += '<button data-action="replace-image" title="Replace image">Replace image</button>' +
        '<button data-action="alt-text" title="Alt text">Alt text</button>';
    }
    html += '<span class="tpl-tb-sep"></span>' +
      '<button class="icon-only" data-action="duplicate" title="Duplicate">&#10697;</button>' +
      '<button class="icon-only danger" data-action="delete" title="Delete">&#10005;</button>' +
      '<button class="icon-only" data-action="deselect" title="Close">&#10060;</button>';
    selToolbar.innerHTML = html;
    selToolbar.hidden = false;
  }

  function positionToolbar(el) {
    var r = canvas.screenRect(el);
    var fr = frame.getBoundingClientRect();
    selToolbar.style.visibility = 'hidden'; selToolbar.hidden = false;
    var tbH = selToolbar.offsetHeight || 36, tbW = selToolbar.offsetWidth || 0;
    var top = (r.top - fr.top) - tbH - 8;
    if (top < 4) top = (r.bottom - fr.top) + 8;
    var left = Math.max(6, Math.min((r.left - fr.left), fr.width - tbW - 6));
    selToolbar.style.top = top + 'px';
    selToolbar.style.left = left + 'px';
    selToolbar.style.visibility = '';
  }

  function onToolbarClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || !selectedEl) return;
    var action = btn.getAttribute('data-action');
    if (TEXT_FORMAT_ACTIONS[action]) {
      canvas.doc.execCommand(action === 'strikethrough' ? 'strikeThrough' : action);
      clearAiGenerated(selectedEl);
      commit();
    } else if (action === 'align-left' || action === 'align-center' || action === 'align-right') {
      selectedEl.style.textAlign = action.slice(6);
      clearAiGenerated(selectedEl);
      commit();
    } else if (action === 'link') {
      var url = prompt('Link URL', selectedEl.getAttribute('data-href') || 'https://');
      if (url) { selectedEl.setAttribute('data-href', url); showToast('Link set to ' + url); clearAiGenerated(selectedEl); commit(); }
    } else if (action === 'replace-image') {
      var picUrl = prompt('Image URL', canvas.pictureOf(selectedEl) || 'https://');
      if (picUrl) { canvas.setPicture(selectedEl, picUrl); clearAiGenerated(selectedEl); commit(); }
    } else if (action === 'alt-text') {
      var alt = prompt('Alt text', selectedEl.getAttribute('alt') || selectedEl.getAttribute('data-alt') || '');
      if (alt !== null) { if (selectedEl.tagName === 'IMG') selectedEl.setAttribute('alt', alt); else selectedEl.setAttribute('data-alt', alt); clearAiGenerated(selectedEl); commit(); }
    } else if (action === 'duplicate') {
      var clone = selectedEl.cloneNode(true);
      clone.classList.remove('ed-selected');
      selectedEl.after(clone);
      canvas.retag(clone);
      clearAiGenerated(selectedEl);
      commit();
      selectElement(clone);
    } else if (action === 'delete') {
      var toRemove = selectedEl;
      clearAiGenerated(toRemove);    // closest() needs it still attached — before remove(), not after
      deselect();
      toRemove.remove();
      commit();
    } else if (action === 'deselect') {
      deselect();
    }
  }

  // dirty-check for exitEdit below: only text/button elements ever go through enterEdit/exitEdit (the
  // other data-editable call sites — image/link/etc — clear the badge themselves right at their own commit
  // point, see onToolbarClick above), and .textContent is what's actually typed into those via
  // contenteditable, matching the granularity sectionTextNodes()/applyTextEdit() already rely on elsewhere
  // in this file. Captured on enterEdit, read and cleared on exitEdit so a later edit session on a
  // DIFFERENT element never compares against this one's stale value.
  var editingBeforeText = null;

  function enterEdit(el) {
    if (editingEl) exitEdit(editingEl);
    el.setAttribute('contenteditable', 'true');
    editingEl = el;
    editingBeforeText = el.textContent;
    el.focus();
  }

  function exitEdit(el) {
    el.removeAttribute('contenteditable');
    editingEl = null;
    var changed = editingBeforeText !== null && el.textContent !== editingBeforeText;
    editingBeforeText = null;
    if (changed) clearAiGenerated(el);
    commit();
  }

  /* ---------- section toolbar (duplicate/hide/delete/add-from-library) ---------- */
  function buildSecToolbar(sec) {
    var hidden = sec.classList.contains('is-hidden-sec');
    secToolbar.innerHTML =
      '<button data-action="add-from-library" title="Add section below">+ Section</button>' +
      '<button data-action="duplicate-section" title="Duplicate section">Duplicate</button>' +
      '<button data-action="toggle-hide" title="Hide/show section">' + (hidden ? 'Show' : 'Hide') + '</button>' +
      '<button class="danger" data-action="delete-section" title="Delete section">Delete</button>';
    secToolbar.hidden = false;
  }

  function positionSecToolbar(sec) {
    var r = canvas.screenRect(sec);
    var fr = frame.getBoundingClientRect();
    secToolbar.style.top = Math.max(4, r.top - fr.top - (secToolbar.offsetHeight || 32) - 4) + 'px';
    secToolbar.style.left = Math.max(6, r.left - fr.left) + 'px';
  }

  function onSecToolbarClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || !activeSectionEl) return;
    var action = btn.getAttribute('data-action');
    if (action === 'duplicate-section') {
      var copy = canvas.duplicateSection(activeSectionEl, (activeSectionEl.getAttribute('data-sec-name') || 'Section') + ' copy');
      commit();
      selectSectionOnly(copy);
    } else if (action === 'toggle-hide') {
      var hide = !activeSectionEl.classList.contains('is-hidden-sec');
      activeSectionEl.classList.toggle('is-hidden-sec', hide);
      activeSectionEl.style.display = hide ? 'none' : '';
      buildSecToolbar(activeSectionEl);
      commit();
    } else if (action === 'delete-section') {
      var sec = activeSectionEl;
      deselect();
      canvas.removeSection(sec);
      commit();
    } else if (action === 'add-from-library') {
      openLibraryPicker(activeSectionEl);
    }
  }

  function openLibraryPicker(afterSec) {
    var items = canvas.library();
    if (!items.length) { showToast('No sections available'); return; }
    var names = items.map(function (it, i) { return (i + 1) + '. ' + it.name; }).join('\n');
    var pick = prompt('Add a section from this template — enter a number:\n' + names, '1');
    if (pick === null) return;   // Cancel — no feedback needed, the user chose not to add anything
    var idx = parseInt(pick, 10) - 1;
    if (isNaN(idx) || !items[idx]) { showToast('"' + pick + '" isn’t one of the numbers above — nothing was added.'); return; }
    var el = canvas.createLibrarySection(items[idx].id);
    afterSec.after(el);
    canvas.adopt(el);
    commit();
    selectSectionOnly(el);
  }

  /* ---------- repeat items (template.json -> sections[].repeat) ---------- */
  function repeatConfigFor(sec) {
    var id = sec.getAttribute('data-rv-section');
    var s = canvas.template.sections.filter(function (x) { return x.id === id; })[0];
    return s && s.repeat;
  }

  function addRepeatItem(sec) {
    var cfg = repeatConfigFor(sec);
    if (!cfg) return false;
    var items = sec.querySelectorAll(cfg.item);
    if (!items.length) return false;
    var last = items[items.length - 1];
    var clone = last.cloneNode(true);
    last.after(clone);
    canvas.retag(clone);
    clearAiGenerated(sec);
    commit();
    return true;
  }

  function removeRepeatItem(sec, item) {
    var cfg = repeatConfigFor(sec);
    if (!cfg) return false;
    var items = sec.querySelectorAll(cfg.item);
    if (items.length <= 1) { showToast('At least one item is required'); return false; }
    item.remove();
    clearAiGenerated(sec);
    commit();
    return true;
  }

  /* ---------- canvas (iframe document) event wiring ---------- */
  function wireCanvasEvents() {
    canvas.doc.addEventListener('click', function (e) {
      if (canvas.openItem(e.target)) return;
      var editable = e.target.closest('[data-editable]');
      if (editable) {
        selectElement(editable);
        /* text/button content starts typing immediately on the one click that selected it — no separate
           double-click step. An image has no in-place "edit" (its toolbar is Replace/Alt text), so a click
           there only selects, same as before. */
        var type = editable.getAttribute('data-editable');
        if ((type === 'text' || type === 'button') && editingEl !== editable) enterEdit(editable);
        return;
      }
      var sec = e.target.closest('[data-rv-section]');
      if (sec) { selectSectionOnly(sec); return; }
      deselect();
    });
    canvas.doc.addEventListener('blur', function (e) {
      if (e.target === editingEl) exitEdit(e.target);
    }, true);
    if (canvas.onResize === null) canvas.onResize = function () {
      if (selectedEl) positionToolbar(selectedEl);
      if (activeSectionEl) positionSecToolbar(activeSectionEl);
    };
  }

  function wireGlobalKeys() {
    function handler(e) {
      if (e.key === 'Escape') { deselect(); return; }
      var mod = e.ctrlKey || e.metaKey;
      if (!mod || editingEl) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    }
    document.addEventListener('keydown', handler);
    canvas.win.addEventListener('keydown', handler);
  }

  /* ---------- design bridge (theme color only for this pass; full Design panel is a fast-follow) ---------- */
  function wireDesignBridge() {
    var container = document.getElementById('theme-swatches');
    if (!container) return;
    container.addEventListener('click', function (e) {
      var sw = e.target.closest('.swatch[data-theme-color]');
      if (!sw) return;
      canvas.design.set('themeColor', sw.getAttribute('data-theme-color'));
      commit();
    });
  }

  /* ---------- generic design-field bridge for the rest of the Design panel ----------
     custom_editor.html's own controls (heading font, corner roundness, …) used to reach straight into the
     demo site's DOM (frame.querySelectorAll(...)) — a no-op in template mode, since the real site lives
     inside RevampCanvas's iframe, not in `frame` itself. This is the template-mode equivalent those controls
     call instead (see TEMPLATE_MODE branches in custom_editor.html). `value` for a font field is a full CSS
     stack (e.g. "'Fraunces', serif") already, same as headingFont/bodyFont expect — unlike the AI flows'
     applyAiDesignToCanvas, which wraps a bare family name, this takes the stack as-is. */
  function setDesign(key, value) {
    if (!canvas) return;
    if (key === 'headingFont' || key === 'bodyFont') {
      var family = (value || '').split(',')[0].replace(/["']/g, '').trim();
      ensureFontsLoaded(canvas, [family]);
    }
    canvas.design.set(key, value);
    commit();
  }

  /* ---------- "Ask AI to edit" chat panel ---------- */
  /* kept in sync with tools/serve.js's DESIGN_FIELDS (same canvas.design vocabulary as the design-swatches
     bridge above and create-event.html's "Let AI design it") */
  var CHAT_DESIGN_KEYS = ['themeColor', 'textColor', 'bgColor', 'headingColor', 'headingFont', 'bodyFont',
    'divider', 'animation', 'headingCase', 'headingAlign', 'headingWeight', 'bodyWeight', 'bodySize', 'headingSize', 'sectionSpacing', 'bgOpacity'];

  function currentDesignContext() {
    var out = {};
    CHAT_DESIGN_KEYS.forEach(function (k) { try { out[k] = canvas.design.get(k); } catch (e) {} });
    return out;
  }
  /* each real section's own current text, verbatim and at TEXT-NODE granularity — one entry per actual DOM
     text node, matching exactly what applyTextEdit() below searches. A data-editable element's .textContent
     can span several text nodes (e.g. a heading plus a nested kicker <span>), so offering that combined
     string as context would let the model propose a `find` that is verbatim-correct on the page but matches
     no single node when applying it — this walks the same granularity apply uses, so every string offered
     here is guaranteed findable. */
  function sectionTextNodes(sec) {
    var out = [];
    Array.prototype.forEach.call(sec.querySelectorAll('[data-editable="text"]'), function (el) {
      var walker = canvas.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var t = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      }
    });
    return out;
  }
  function sectionsContext() {
    return canvas.sections().map(function (sec) {
      var id = sec.getAttribute('data-rv-section');
      var texts = sectionTextNodes(sec).slice(0, 14).map(function (t) { return t.slice(0, 200); });
      return { id: id, name: sec.getAttribute('data-sec-name') || id, texts: texts };
    });
  }

  function chatThread() { return document.getElementById('chat-thread'); }
  function appendChatNode(node) {
    var thread = chatThread();
    if (!thread) return null;
    thread.appendChild(node);
    thread.scrollTop = thread.scrollHeight;
    return node;
  }
  /* a real messaging layout, not a flat list of divs: each turn gets an avatar + sender label + bubble, user
     turns right-aligned, AI turns left-aligned — the same visual grammar as any chat app. Returns the BUBBLE
     element (not the outer turn wrapper), since callers like the rotating "Thinking…" status update its text. */
  function appendChatTurn(role, text, extraBubbleClass) {
    var isUser = role === 'user';
    var turn = document.createElement('div');
    turn.className = 'chat-turn ' + (isUser ? 'user' : 'ai');
    var avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = isUser ? 'Y' : 'AI';
    var body = document.createElement('div');
    body.className = 'chat-turn-body';
    var sender = document.createElement('span');
    sender.className = 'chat-sender';
    sender.textContent = isUser ? 'You' : 'AI editor';
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg' + (extraBubbleClass ? ' ' + extraBubbleClass : '');
    bubble.textContent = text;
    body.appendChild(sender);
    body.appendChild(bubble);
    turn.appendChild(avatar);
    turn.appendChild(body);
    appendChatNode(turn);
    return bubble;
  }
  function appendChatMsg(role, text) {
    var parts = role.split(' ');   // 'ai' | 'user' | 'ai error'
    return appendChatTurn(parts[0], text, parts[1]);
  }

  /* applies one proposed text edit: finds the first text node (within this section's own data-editable
     elements) whose value contains `find`, and replaces just that substring in place — mutating one text
     node, never innerHTML, so any nested markup (a heading's kicker <span>, etc.) survives untouched.
     `find` was matched against sectionTextNodes()'s WHITESPACE-COLLAPSED reading of each node (so the model
     sees clean text to quote back), so matching here tolerates the same collapsing against the node's raw,
     un-collapsed value — a plain indexOf would otherwise miss on a real newline/indentation inside the node. */
  function findToRegex(find) {
    return new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  }
  function applyTextEdit(edit) {
    var sec = canvas.doc.querySelector('[data-rv-section="' + edit.sectionId + '"]');
    if (!sec || !edit.find) return false;
    var re = findToRegex(edit.find);
    var editable = sec.querySelectorAll('[data-editable="text"]');
    for (var i = 0; i < editable.length; i++) {
      var walker = canvas.doc.createTreeWalker(editable[i], NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (re.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(re, edit.replace);
          return true;
        }
      }
    }
    return false;
  }

  function renderProposal(result, histEntry) {
    /* same turn/avatar wrapper as a plain message (appendChatTurn), but the bubble itself is the richer
       proposal card instead of a plain text balloon — keeps it visually part of the same conversation rather
       than a floating, disconnected panel. */
    var turn = document.createElement('div');
    turn.className = 'chat-turn ai';
    var avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = 'AI';
    var body = document.createElement('div');
    body.className = 'chat-turn-body';
    var sender = document.createElement('span');
    sender.className = 'chat-sender';
    sender.textContent = 'AI editor';
    var card = document.createElement('div');
    card.className = 'chat-proposal';
    body.appendChild(sender);
    body.appendChild(card);
    turn.appendChild(avatar);
    turn.appendChild(body);
    var items = [];
    Object.keys(result.design || {}).forEach(function (k) { items.push(escHtml(k) + ' &rarr; ' + escHtml(String(result.design[k]))); });
    (result.textEdits || []).forEach(function (t) { items.push(escHtml(t.sectionId) + ': &ldquo;' + escHtml(t.find) + '&rdquo; &rarr; &ldquo;' + escHtml(t.replace) + '&rdquo;'); });
    /* The model's own prose `summary` is NOT trustworthy as a promise of what Apply will do — even with an
       explicit prompt instruction not to, it can still describe a change (e.g. "enabled rise animations")
       that never actually made it into design/textEdits. The bullet list below, built directly from that
       real structured data, is the only part that's guaranteed accurate — label the two differently rather
       than let a user assume the prose sentence is authoritative. The `skipped` list (fields the model tried
       but failed validation on, e.g. a colour word instead of hex) is a narrower, explicit subset of this
       same risk that the server can actually detect, so it gets its own, more specific note. */
    var skippedNote = (result.skipped && result.skipped.length)
      ? '<span class="cp-skipped">Couldn’t apply: ' + escHtml(result.skipped.join(', ')) + '.</span>' : '';
    var nothingToApply = !items.length;
    card.innerHTML =
      '<span class="cp-summary">' + escHtml(result.summary) + '</span>' +
      '<span class="cp-will-change">This will actually change:</span>' +
      (items.length ? '<ul>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'
        : '<span class="cp-skipped">Nothing — the instruction didn’t produce a usable change.</span>') +
      skippedNote +
      '<div class="cp-actions">' +
        '<button class="btn btn-primary btn-sm" type="button" data-cp="apply"' + (nothingToApply ? ' disabled title="Nothing valid came back for this instruction"' : '') + '>Apply</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-cp="discard">Discard</button>' +
      '</div>';
    appendChatNode(turn);
    card.querySelector('[data-cp="discard"]').addEventListener('click', function () {
      turn.remove();
      appendChatMsg('ai', 'Discarded — nothing on the site changed.');
      if (histEntry) histEntry.text = 'Proposed: ' + result.summary + ' (discarded, not applied)';
    });
    card.querySelector('[data-cp="apply"]').addEventListener('click', function () {
      if (result.design && Object.keys(result.design).length) applyAiDesignToCanvas(canvas, result.design);
      var appliedText = 0;
      (result.textEdits || []).forEach(function (t) {
        if (applyTextEdit(t)) {
          appliedText++;
          clearAiGenerated(canvas.doc.querySelector('[data-rv-section="' + t.sectionId + '"]'));
        }
      });
      if (canvas.retag) canvas.sections().forEach(function (sec) { canvas.retag(sec); });
      commit();
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      card.style.opacity = '.6';
      var skipped = (result.textEdits || []).length - appliedText;
      appendChatMsg('ai', 'Applied.' + (skipped > 0 ? ' (' + skipped + ' text change' + (skipped === 1 ? '' : 's') + ' skipped — that text wasn’t found, maybe already changed.)' : ''));
      if (histEntry) histEntry.text = 'Proposed and applied: ' + result.summary + (Object.keys(result.design || {}).length ? ' (design: ' + JSON.stringify(result.design) + ')' : '') + (appliedText ? ' (' + appliedText + ' text edit' + (appliedText === 1 ? '' : 's') + ' applied)' : '');
    });
  }

  /* A real back-and-forth, not a one-shot command box: chatHistory carries prior turns (what was asked, what
     the AI said, and — once known — whether it was applied or discarded) so a follow-up like "make it a bit
     darker instead" is understood against what was just proposed, and a plain question gets an actual answer
     instead of being forced through the edit-proposal pipeline. Capped so the prompt doesn't grow without
     bound over a long session. */
  var chatHistory = [];
  var CHAT_HISTORY_MAX = 16;
  function pushHistory(role, text) {
    chatHistory.push({ role: role, text: text });
    if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX);
  }

  var CHAT_THINKING_LINES = ['Thinking…', 'Reading the page…', 'Working it out…', 'Almost there…'];
  var chatTurnCount = 0;

  function wireChatPanel() {
    var input = document.getElementById('chat-input'), send = document.getElementById('chat-send');
    if (!input || !send) return;
    /* A single edit instruction looks identical whether or not real conversation memory exists behind it —
       that only becomes visible on a follow-up ("now make it darker instead"). Say so up front, so this
       reads as an actual chat from the first message, not a repaint of the old one-shot prompt box. */
    if (chatHistory.length === 0) {
      appendChatMsg('ai', 'Hi — describe a change (colour, fonts, text…) or ask a question about this page. I’ll remember what we discuss, so you can follow up with things like "make it a bit darker instead" and I’ll know what "it" means.');
    }
    function go() {
      var instruction = input.value.trim();
      if (!instruction) return;
      input.value = '';
      send.disabled = true;
      appendChatMsg('user', instruction);
      var thinking = appendChatMsg('ai', CHAT_THINKING_LINES[0]);
      var lineIdx = 0;
      var thinkingTimer = setInterval(function () {
        lineIdx = (lineIdx + 1) % CHAT_THINKING_LINES.length;
        if (thinking) thinking.textContent = CHAT_THINKING_LINES[lineIdx];
      }, 2200);
      fetch('/api/chat-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction, history: chatHistory, design: currentDesignContext(), sections: sectionsContext() })
      })
        .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
        .then(function (r) {
          clearInterval(thinkingTimer);
          if (thinking) thinking.remove();
          send.disabled = false;
          if (!r.ok || !r.body || r.body.error) {
            appendChatMsg('ai error', (r.body && r.body.error) || 'That edit request failed.');
            return;
          }
          pushHistory('user', instruction);
          chatTurnCount++;
          if (r.body.kind === 'reply' || (!Object.keys(r.body.design || {}).length && !(r.body.textEdits || []).length)) {
            appendChatMsg('ai', r.body.summary);
            pushHistory('assistant', r.body.summary);
          } else {
            var histEntry = { role: 'assistant', text: 'Proposed: ' + r.body.summary + ' (awaiting your Apply/Discard)' };
            chatHistory.push(histEntry);
            if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX);
            renderProposal(r.body, histEntry);
            /* shown once, after the very first edit, so a user who only ever tries one instruction still
               discovers the thing that makes this an actual chat rather than a prompt box */
            if (chatTurnCount === 1) appendChatMsg('ai', 'You can also ask me to adjust this before deciding — e.g. "make it a bit darker instead" — and I’ll understand you mean this change.');
          }
        })
        .catch(function (err) {
          if (thinking) thinking.remove();
          send.disabled = false;
          appendChatMsg('ai error', 'Could not reach the AI edit service: ' + err.message);
        });
    }
    send.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  }

  /* ---------- device / preview / publish ---------- */
  function setDevice(name) {
    canvas.setDevice(name);
    setTimeout(function () {
      if (selectedEl) positionToolbar(selectedEl);
      if (activeSectionEl) positionSecToolbar(activeSectionEl);
    }, 50);
  }

  /* Real preview: stages canvas.serialize()'s output to a real, stable, reloadable URL (POST /api/event/
     stage — the same mechanism Publish uses, a separate Storage folder, never marks the event published)
     instead of the old window.open('', '_blank') + document.write(), which opened a blank about:blank tab
     with no real URL at all — reloading it just erased the content, and it could never be reloaded to pick
     up a later edit. A NAMED window target (not '_blank') means clicking Preview again reuses the SAME tab
     rather than piling up new ones, so "make a change, click Preview again" naturally lands back on a tab
     the user may already have open. The tab is opened SYNCHRONOUSLY, in the same click handler, with a
     "Loading…" placeholder — opening it only after the stage() fetch resolves would lose the user-gesture
     context most browsers require to allow a new tab at all. */
  function openPreview() {
    deselect();
    if (!eventId || eventId === '1') {
      // no real event context (e.g. a raw template-gallery preview) — nothing to stage server-side;
      // fall back to the old one-off snapshot rather than fail outright.
      var win0 = window.open('', '_blank');
      if (!win0) { showToast('Allow pop-ups to open the preview in a new tab.'); return; }
      win0.document.open(); win0.document.write(canvas.serialize()); win0.document.close();
      return;
    }
    var win = window.open('', 'revamp-staging-' + eventId);
    if (!win) { showToast('Allow pop-ups to open the preview in a new tab.'); return; }
    win.document.open();
    win.document.write('<!doctype html><title>Loading preview…</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#666">Loading preview…</body>');
    win.document.close();
    RevampCore.stageEvent(eventId, canvas.serialize()).then(function (result) {
      win.location.href = result.stagingUrl;
    }).catch(function (err) {
      win.document.open();
      win.document.write('<!doctype html><title>Preview failed</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#a23b36">Could not load the preview — ' + escHtml(err && err.message ? err.message : 'please try again.') + '</body>');
      win.document.close();
    });
  }

  /* Real publish: sends canvas.serialize()'s own output (the exact same string the Preview button already
     opens in a new tab) to POST /api/event/publish, which stores it in Firebase Storage, public, and marks
     the event published — see functions/lib/api.js's handleEventPublish. Before this, Publish was purely
     cosmetic (a setTimeout + a modal literally titled "Saved — not yet published") — nothing the user
     edited ever left their own browser's IndexedDB, so there was genuinely nothing to serve from a real
     URL even if one existed. `eventId` here is this session's resolved event identity (resolveKey()) — the
     real slug for any genuine event; still falls back to '1' for a template opened with no event context
     at all (e.g. a raw template-gallery preview), which is never publishable, so that case fails clearly
     rather than silently publishing to a meaningless key. */
  function publish() {
    if (!eventId || eventId === '1') {
      showToast('Nothing to publish — this page isn’t attached to a real event.');
      return;
    }
    showToast('Publishing…');
    var html = canvas.serialize();
    RevampCore.publishEvent(eventId, html).then(function (result) {
      var draft = readHandoffDraft();
      var ev = draft && draft.event;
      var pubName = ev ? ev.name : canvas.template.name;
      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML =
        '<div class="modal"><div class="modal-body">' +
        '<div class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg></div>' +
        '<h3>Published</h3>' +
        '<p>' + escHtml(pubName) + '’s latest changes are now live at:</p>' +
        '<span class="url">' + escHtml(result.publishedUrl) + '</span>' +
        '</div><div class="modal-foot">' +
        '<button class="btn btn-secondary" id="publish-close">Keep editing</button>' +
        '<a class="btn btn-primary" id="publish-view" href="' + escHtml(result.publishedUrl) + '" target="_blank" rel="noopener">View live page</a>' +
        '</div></div>';
      document.body.appendChild(scrim);
      scrim.querySelector('#publish-close').addEventListener('click', function () { scrim.remove(); });
      scrim.addEventListener('click', function (e) { if (e.target === scrim) scrim.remove(); });
    }).catch(function (err) {
      showToast('Could not publish — ' + (err && err.message ? err.message : 'please try again.'));
    });
  }

  window.RevampTemplateUI = {
    boot: boot, setDevice: setDevice, openPreview: openPreview, publish: publish, undo: undo, redo: redo,
    addRepeatItem: addRepeatItem, removeRepeatItem: removeRepeatItem, setDesign: setDesign,
    hasAiProvenance: hasAiProvenance, aiProvenanceSections: aiProvenanceSections, setAiMarkers: setAiMarkers
  };
})();
