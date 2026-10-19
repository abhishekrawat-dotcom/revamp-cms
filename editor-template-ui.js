/* Template-mode editor UI (custom_editor.html?template=<id>).

   custom_editor.html's own selection/toolbar/Design-panel code works directly on a same-document demo
   site and has no concept of an iframe. RevampCanvas (editor-canvas.js) mounts a real template into an
   iframe instead, so this file owns everything that's genuinely different in template mode: selection +
   a trimmed floating toolbar (text/button/image — the core actions only; typography/border/schedule/AI
   popovers stay demo-only for now), section tools (duplicate/hide/delete, add from the template's own
   library, repeat-item add/remove, accordion open-to-edit), persistence + undo/redo via RevampStore +
   canvas.snapshot()/restore(), device switching, preview and publish.

   window.RevampTemplateUI = { open(frameEl, where, host) }
     where: { eventId, templateId } as the address bar has them. The event decides which site opens: it is
            fetched first, and the template in the address only counts when the event has none of its own.
            With no event id the template opens as a preview: nothing is saved and there is no Publish.
     host:  { escHtml, showToast, showNotice, clearNotice, openDialog } — the page's own feedback helpers
            (custom_editor.html) — and onEvent(event), called once the event is known to exist;
            genericCss() — the CSS of the editor's generic section designs; pickSection(afterEl) — opens the
            section picker; onSectionsChanged() — called whenever the list of sections, or which one is
            selected, may have changed.
     Resolves true once the site is on the canvas, false when a lasting message is shown in its place.
   Sections, for the page's side panels (every change is one undo step):
     listSections() -> [{ el, key, type, name, hidden, pinned, canMoveUp, canMoveDown, bound, current }] in page order
     librarySections() -> [{ id, name, snippet, onPage }] the site's own sections that can be added again
     selectSection(el), moveSection(el, toIndex), setHidden(el, hide), duplicateSection(el), deleteSection(el)
     (asks first), renameSection(el, name), insertSection({ libraryId } | { name, html }, afterEl)
     addBlock(kind) adds a heading / text / button / image / divider / spacer where the selection is.
   Design, for the page's Design panel and style toolbar (every change is one undo step):
     getDesign(key), setDesign(key, value) -> false (and says why) when the site has nothing for that setting
     to act on; designOptions() -> { swatches, fonts: [{ label, stack }], unsupported: { key: reason } };
     checkImageUrl(url) -> Promise<{ url } | { error }> for a picture given by its address.
     selectedStyle() -> { fontFamily, fontSize, fontWeight, color } of the selected text or button, or null;
     styleSelected({ fontFamily, fontSize, fontWeight, color }) restyles that one element.
     host.onDesignChange() is called whenever the design shown by those may have changed, and
     host.onSelectionChange({ kind, canStyle } | null) whenever another element, or none, is selected.
   flush() records an edit that is still pending (text being typed, a slider still moving).
   leave(url) is how the page is left for another one: what is pending is recorded first.
   handoffFor(eventId) is the Create Event hand-off waiting in this browser, when it belongs to that event.
   Also: hasAiProvenance(), aiProvenanceSections(), setAiMarkers(show) — custom_editor.html's AI-provenance
   badge toggle and publish-review gate read/drive these; see "AI-provenance badges" below. */
(function () {
  'use strict';

  var canvas = null, host = null, templateId = null, eventId = null, storeKey = null, sourceDraftId = null;
  var frame = null;
  var urlTemplateId = '', currentEvent = null, pageWired = false;
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
  var typingTimer = null, typingPtr = -1;     // the undo step the text being typed is recorded in (-1: none yet)
  var selectedEl = null, activeSectionEl = null, editingEl = null;
  var selToolbar = null, secToolbar = null, selWatch = null;
  var mountOpts = null, remounting = false, deviceName = 'desktop', aiMarkersOn = false;

  function showToast(msg, opts) { return host && host.showToast ? host.showToast(msg, opts) : null; }
  function showNotice(id, opts) { if (host && host.showNotice) host.showNotice(id, opts); }
  function escHtml(s) { return host && host.escHtml ? host.escHtml(s) : String(s == null ? '' : s); }
  function sectionsChanged() { if (chatFocusRedraw) chatFocusRedraw(); if (host && host.onSectionsChanged) host.onSectionsChanged(); }
  function designChanged() { if (host && host.onDesignChange) host.onDesignChange(); }
  // what canvas.restore() and createGenericSection() build the generic sections' CSS from
  function restoreOpts() { return { siteCss: host && host.genericCss ? host.genericCss() : '' }; }

  /* ---------- opening ----------
     The local copy is kept under site:<event id>:<template id> — the same key whichever link opened the
     editor (a creation redirect carries ?slug=, every other link ?event=).

     A second Generate-from-Brief run for the same event carries a new &draft=<id>; resolveInitialContent()
     compares it with the run that last wrote the local copy (sourceDraftId) and lets the new draft win. */
  var HANDOFF_KEY = 'revamp.editor.handoff.v1';
  var LISTING_URL = 'Event_Listing.html';
  function eventUrl() { return 'edit-event.html?event=' + encodeURIComponent(eventId); }
  function fromCreate() { return new URLSearchParams(location.search).get('from') === 'create'; }

  function open(frameEl, where, hostApi) {
    host = hostApi; frame = frameEl;
    eventId = (where && where.eventId) || '';
    urlTemplateId = (where && where.templateId) || '';
    return start();
  }

  function start() {
    clearLoadError();
    if (!eventId) { currentEvent = null; return boot(urlTemplateId); }
    return RevampCore.fetchEvent(eventId).then(function (ev) {
      currentEvent = ev;
      renderTopbar();
      if (host.onEvent) host.onEvent(ev);
      var tplId = (ev.site && ev.site.templateId) || ev.templateId || urlTemplateId;
      if (!tplId) { showLoadError(noSiteError()); return false; }
      if (tplId !== urlTemplateId) {
        // the address names another site than the event's own (an old or hand-edited link, or none at all)
        var url = new URL(location.href);
        url.searchParams.set('template', tplId);
        location.replace(url.href);
        return new Promise(function () {});
      }
      return boot(tplId);
    }, function (err) {
      if (window.console) console.error(err);
      renderTopbar();
      showLoadError(eventLoadError(err));
      return false;
    });
  }

  function boot(tplId) {
    templateId = tplId;
    storeKey = eventId ? 'site:' + eventId + ':' + tplId : null;      // a template preview keeps nothing

    /* a section order chosen in Create Event has to be known before mount(): the order is part of the page
       the iframe loads, not something RevampFill.apply() can change afterwards */
    var earlyDraft = fromCreate() ? readHandoffDraft() : null;

    mountOpts = { sectionOrder: earlyDraft && earlyDraft.sectionOrder };
    return RevampCanvas.mount(frame, templateId, mountOpts).then(function (c) {
      canvas = c;
      return resolveInitialContent();
    }).then(function () {
      // real Content-tab data (speakers/partners/faq/contacts/glimpses) overlaid on top of whatever base
      // content resolveInitialContent() just settled on — see applySubcollectionOverlay()'s own comment.
      return applySubcollectionOverlay();
    }).then(function () {
      if (!pageWired) {
        buildToolbars();
        wireGlobalKeys();
        wireLeaving();
        wireChatPanel();
        pageWired = true;
      }
      wireCanvasEvents();
      /* a page saved before its look last changed carries the ET logo in the right version from now on —
         checked again once the page has laid out (the nav's row is measured) */
      var putRight = syncEtLogos();
      if (calmHeadings()) putRight = true;
      if (putRight) commit();
      [400, 1500].forEach(function (ms) { setTimeout(function () { if (canvas && !remounting && syncEtLogos()) commit(); }, ms); });
      /* opened from the preview's "Apply in editor": that theme */
      var askedTheme = new URLSearchParams(location.search).get('theme');
      var ti = themesInfo();
      if (askedTheme && ti && ti.current !== askedTheme) setTimeout(function () { applyTheme(askedTheme); }, 600);
      updateHistoryButtons();
      renderTopbar();
      sectionsChanged();
      designChanged();
      /* Preview and Publish stay disabled until the site is mounted AND filled: pressed any earlier they
         would capture the template's own placeholder text. With no event there is nothing to publish to. */
      document.getElementById('btn-publish').hidden = !eventId;
      document.getElementById('btn-publish').disabled = !eventId;
      document.getElementById('btn-preview').disabled = false;
      loadSiteInfo();
      logoUnitNotice();
      return true;
    }).catch(function (err) {
      if (window.console) console.error(err);
      if (canvas) { canvas.destroy(); canvas = null; }
      showLoadError(siteLoadError(err));
      return false;
    });
  }

  /* ---------- when the site cannot be opened ----------
     A lasting panel where the canvas would be, saying what happened in the owner's words and offering what can
     be done about it. Nothing is mounted behind it, so Preview and Publish stay disabled and the tools that act
     on a site are put away. */
  function showLoadError(spec) {
    clearLoadError();
    document.getElementById('btn-publish').disabled = true;
    document.getElementById('btn-preview').disabled = true;
    document.body.classList.add('ed-load-failed');
    var panel = document.createElement('div');
    panel.className = 'tpl-load-error';
    panel.setAttribute('role', 'alert');
    var h = document.createElement('h2'); h.textContent = spec.title; panel.appendChild(h);
    if (spec.text) { var p = document.createElement('p'); p.textContent = spec.text; panel.appendChild(p); }
    var acts = document.createElement('div');
    acts.className = 'tpl-load-error-acts';
    (spec.actions || []).forEach(function (a, i) {
      var el = document.createElement(a.href ? 'a' : 'button');
      el.className = 'btn ' + (i === 0 ? 'btn-primary' : 'btn-secondary');
      el.textContent = a.label;
      if (a.href) el.href = a.href; else { el.type = 'button'; el.addEventListener('click', a.onClick); }
      acts.appendChild(el);
    });
    if (acts.firstChild) panel.appendChild(acts);
    frame.appendChild(panel);
  }
  function clearLoadError() {
    var panel = frame && frame.querySelector('.tpl-load-error');
    if (panel) panel.remove();
    document.body.classList.remove('ed-load-failed');
  }

  var RETRY = { label: 'Try again', onClick: function () { start(); } };
  function backToEvent() { return { label: 'Back to the event', href: eventUrl() }; }
  var BACK_TO_EVENTS = { label: 'Back to events', href: LISTING_URL };
  var SIGNING_IN = { title: 'Signing you in again…', text: 'Your sign-in has expired. This page will carry on once you are signed in.' };

  // the loader's own errors carry the status only as the start of their message ("404 <address>")
  function statusOf(err) {
    if (err && typeof err.status === 'number') return err.status;
    var m = /^(\d{3})\b/.exec((err && err.message) || '');
    return m ? +m[1] : 0;
  }

  function eventLoadError(err) {
    var status = statusOf(err);
    if (status === 401) return SIGNING_IN;
    if (status === 404) {
      return { title: 'We could not find this event', text: 'It may have been deleted, or the link may be out of date.', actions: [BACK_TO_EVENTS] };
    }
    return { title: 'Could not load this event', text: 'Check your connection and try again. Nothing has been changed.', actions: [RETRY, BACK_TO_EVENTS] };
  }

  function noSiteError() {
    var draft = fromCreate() ? readHandoffDraft() : null;
    if (draft && draft.template && !draft.template.site) {
      return {
        title: 'This design is not available yet',
        text: 'Your event is saved, but the design you picked cannot be opened in the site editor yet.',
        actions: [backToEvent(), BACK_TO_EVENTS]
      };
    }
    return {
      title: 'This event does not have a site yet',
      text: 'No design has been chosen for it, so there is nothing to edit here.',
      actions: [backToEvent(), BACK_TO_EVENTS]
    };
  }

  function siteLoadError(err) {
    var status = statusOf(err);
    var back = eventId ? backToEvent() : BACK_TO_EVENTS;
    if (status === 401) return SIGNING_IN;
    if (status === 404) {
      return {
        title: eventId ? 'This event’s site could not be found' : 'This design could not be found',
        text: /^gen-/.test(templateId || '') ? 'The design that was generated for this event is no longer available.'
          : /^imported-/.test(templateId || '') ? 'The design that was imported for this event is no longer available.'
          : 'The design it was built with is not available.',
        actions: [back]
      };
    }
    return {
      title: 'Could not load the site',
      text: err && err.code === 'timeout' ? 'The page took too long to load. Check your connection and try again.'
        : 'Check your connection and try again. Your work has not been changed.',
      actions: [RETRY, back]
    };
  }

  /* ---------- top bar ----------
     Says which event this is, from the event itself — the same on every way into the editor. */
  function renderTopbar() {
    var nameEl = document.getElementById('ed-event-name');
    var metaEl = document.getElementById('ed-event-meta');
    var ev = currentEvent;
    var name = '', meta = '';
    if (ev) {
      name = ev.name || 'Untitled event';
      meta = [ev.published ? 'Published' : 'Not published', ev.start ? RevampCore.fmtDT(ev.start) : '', ev.venue].filter(Boolean).join(' · ');
    } else if (!eventId && canvas) {
      name = canvas.template.name || canvas.template.title || templateId;
      meta = 'Template preview';
    }
    if (nameEl) { nameEl.textContent = name || '\u00a0'; nameEl.title = name; }
    if (metaEl) metaEl.textContent = meta;
    document.title = (name ? name + ' - ' : '') + 'Site editor';
  }

  /* The hand-off is one slot in this browser holding the newest Create Event result, whichever event that
     was. It is only ever this event's when its own slug says so (and, for a generated draft, when it is the
     run the address names). */
  function handoffFor(forEventId) {
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch (e) { return null; }
    if (!draft || !forEventId) return null;
    if (!draft.event || draft.event.slug !== forEventId) {
      if (window.console) console.warn('[RevampTemplateUI] Ignored a Create Event hand-off that belongs to another event:', draft.event && draft.event.slug);
      return null;
    }
    var urlDraft = new URLSearchParams(location.search).get('draft');
    if (urlDraft && draft.draftId && draft.draftId !== urlDraft) {
      if (window.console) console.warn('[RevampTemplateUI] Ignored a Create Event hand-off from another run of this event:', draft.draftId);
      return null;
    }
    return draft;
  }
  function readHandoffDraft() { return handoffFor(eventId); }
  // once the filled site is kept, the hand-off has done its job: Back or a link from history must not fill again
  function forgetHandoff() {
    if (!readHandoffDraft()) return;
    try { localStorage.removeItem(HANDOFF_KEY); } catch (e) { /* storage is blocked: nothing to remove */ }
  }

  /* Applies a handoff draft (the revamp.editor.handoff.v1 shape — from localStorage on a fresh fromCreate
     visit, or from GET /api/draft's own `handoff` field on a stateless reopen, see resolveInitialContent())
     to the just-mounted canvas and seeds it as this device's first local snapshot. `draftId` is whichever
     run actually produced this content — the URL's own `?draft=` on a fresh run, or the server's own
     `draftId` field when fetched fresh from Firestore — recorded so a LATER fromCreate regeneration in this
     same browser can still tell "stale" apart from "already current" (see resolveInitialContent()). */
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
       logoKey now correctly means "nothing to show", not "guess". */
    var logoKey = draft.event && draft.event.logoKey;
    return localGet(logoKey).then(function (logoRec) {
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
    }).then(function (kept) {
      if (kept) forgetHandoff();
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
     never checks again. GET /api/draft?eventId=<id> already exists for exactly this (it returns the exact
     revamp.editor.handoff.v1 shape) — a plain reopen now tries it before giving up, same as the fromCreate
     path, just sourced from the server instead of localStorage. A 404 (not a Generate-from-Brief event / nothing ever generated)
     correctly falls through to the real blank-template case, unchanged. */
  function fetchServerDraft() {
    return fetch('/api/draft?eventId=' + encodeURIComponent(eventId))
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) { return res.ok ? res.body : null; })
      .catch(function () { return null; });
  }

  /* Has the site been generated again since this browser's copy was made? The copy records which generation
     it was made from (sourceDraftId): a different one on the server is a newer run, and it wins — edits made
     on the current generation keep matching it and are never thrown away. A copy too old to record its
     generation is judged by time instead: replaced only by a run made after its last save. (Not by time
     alone: every opening re-saves the copy, so an old copy opened once after a regeneration would look
     newer than it.) */
  function newerOnServer(res, saved) {
    if (!res.draftId || res.draftId === saved.sourceDraftId) return false;
    if (saved.sourceDraftId) return true;
    var made = Date.parse(res.generatedAt || '');
    return !isNaN(made) && made > (+saved.savedAt || 0);
  }
  /* the newer version: from its hand-off when it has one, else exactly as the canvas mounted it from the server */
  function takeServerVersion(res) {
    if (res.handoff && res.handoff.sections && res.handoff.sections.length) return applyHandoffDraft(res.handoff, res.draftId);
    sourceDraftId = res.draftId;
    return seedSnapshot(null);
  }

  /* A copy that never recorded its generation, kept because it is newer than the server's current one, is
     from now on taken as that generation's — so the next regeneration is recognised by its id. */
  function adoptGeneration(res, saved) {
    if (!saved.sourceDraftId && res && res.draftId) sourceDraftId = res.draftId;
  }

  function resolveInitialContent() {
    return localGet(storeKey).then(function (saved) {
      var arriving = fromCreate();
      var draftId = new URLSearchParams(location.search).get('draft') || null;

      // Only a NEW Generate-from-Brief run for this same event (arriving from Create Event with a draftId
      // that doesn't match whoever last actually saved this key) treats an existing snapshot as stale — a
      // plain wizard open (no draftId ever) or a plain reopen always finds exactly what was last saved here.
      var isStale = !!(saved && saved.snapshot && arriving && draftId && saved.sourceDraftId !== draftId);
      // See FILL_LOGIC_VERSION's own comment: a snapshot seeded under an older fill-logic version can have
      // the exactly-right sourceDraftId and still be wrong, because what ran against it to fill it was
      // broken at the time. Gates every "trust this outright, no need to re-fetch" decision below for a
      // gen-<id> template; the true last-resort fallbacks (server unreachable/empty) deliberately skip this
      // gate further down — showing a possibly-stale local copy there is still better than nothing.
      var isCurrentVersion = !/^gen-/.test(templateId || '') || (saved && saved.fillVersion === FILL_LOGIC_VERSION);

      function restoreLocal() {
        sourceDraftId = saved.sourceDraftId || null;
        canvas.restore(saved.snapshot, restoreOpts());
        // read back rather than reused: restore() repairs what older saves got wrong, and the first undo step
        // must be the page as it stands, or opening the editor would itself count as a change
        undoStack = [canvas.snapshot(saved.snapshot)]; undoPtr = 0;
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
      if (arriving && /^gen-/.test(templateId || '') && saved && saved.snapshot) {
        /* An address from Create Event names the version that was made then. This browser's hand-off of a
           newer run wins; failing that the server decides: a version generated after this copy was last saved
           (on another device, or by regenerating the site) replaces it, and so does any current version when
           this copy was filled by older fill logic. Otherwise this browser's copy, with its edits, stands. */
        var handed = isStale ? readHandoffDraft() : null;
        if (handed && handed.sections && handed.sections.length) return applyHandoffDraft(handed, draftId);
        return fetchServerDraft().then(function (res) {
          if (res && res.draftId && (newerOnServer(res, saved) || !isCurrentVersion)) return takeServerVersion(res);
          restoreLocal();
          adoptGeneration(res, saved);
        });
      }
      if (arriving) {
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
        /* the site was made again after this browser's copy was taken: the page just mounted from the server is
           the new one, and it is what the editor shows */
        if (saved && saved.snapshot && res && newerOnServer(res, saved)) return takeServerVersion(res);
        if (saved && saved.snapshot) { restoreLocal(); adoptGeneration(res, saved); return; }
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
  function translateSpeakersFlat(items, sessions, days) {
    if (!items || !items.length) return null;
    var talks = speakerSessionsOf(sessions, days);
    return items.map(function (p) {
      var li = /^https:\/\/[^\s"'<>\\]+$/i.test(String(p.li || '').trim()) ? String(p.li).trim() : '';
      return { n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '', bio: String(p.bio || '').trim(), li: li,
        profile: { name: String(p.name || '').trim(), bio: String(p.bio || '').trim(), li: li, sessions: talks[p.id] || [] } };
    });
  }
  /* each speaker's sessions (Content › Agenda), as the pop-up lists them: { when: "26 November 2026 · 9:30 AM – 10:15 AM", title } */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dayLabelOf(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((d && d.date) || ''));
    return m && +m[2] >= 1 && +m[2] <= 12 ? +m[3] + ' ' + MONTH_NAMES[+m[2] - 1] + ' ' + m[1] : String((d && d.name) || '').trim();
  }
  function speakerSessionsOf(sessions, days) {
    var dayById = {}, dayAt = {}, out = {};
    (days || []).slice().sort(byOrder).forEach(function (d, i) { dayById[d.id] = dayLabelOf(d); dayAt[d.id] = i; });
    (sessions || []).slice().sort(function (a, b) {
      var da = a.groupId in dayAt ? dayAt[a.groupId] : 999, db = b.groupId in dayAt ? dayAt[b.groupId] : 999;
      return (da - db) || String(a.start || '').localeCompare(String(b.start || '')) || byOrder(a, b);
    }).forEach(function (s) {
      var title = String(s.title || '').trim();
      if (!title) return;
      var time = [clockLabel(s.start), clockLabel(s.end)].filter(Boolean).join(' – ');
      var when = [dayById[s.groupId] || '', time].filter(Boolean).join(' · ');
      (s.speakerIds || []).forEach(function (id) {
        var list = out[id] || (out[id] = []);
        if (list.length < 6) list.push({ when: when, title: title });
      });
    });
    return out;
  }
  /* A speaker's profile, for the pop-up a visitor opens from the card on the published page (templates/_shared/
     rv-popups.js): their text, LinkedIn and sessions, in a <template data-rv-profile> inside the card — never
     drawn on the page, rewritten from the records on every open. Never the speaker's e-mail or phone. */
  function setSpeakerProfile(card, profile) {
    Array.prototype.forEach.call(card.querySelectorAll('template[data-rv-profile]'), function (t) { t.remove(); });
    if (!profile || !(profile.bio || profile.li || (profile.sessions && profile.sessions.length))) return;
    var d = card.ownerDocument, tpl = d.createElement('template');
    tpl.setAttribute('data-rv-profile', '');
    function add(parent, tag, attr, text) {
      var n = d.createElement(tag);
      n.setAttribute(attr, '');
      if (text != null) n.textContent = text;
      parent.appendChild(n);
      return n;
    }
    // whose profile it is: a card copied and renamed on the page does not open this speaker's under its new name
    if (profile.name) add(tpl.content, 'span', 'data-rv-profile-for', profile.name).setAttribute('hidden', '');
    if (profile.bio) add(tpl.content, 'p', 'data-rv-profile-bio', profile.bio);
    if (profile.li) {
      var a = add(tpl.content, 'a', 'data-rv-profile-li', 'LinkedIn');
      a.setAttribute('href', profile.li); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
    }
    if (profile.sessions && profile.sessions.length) {
      add(tpl.content, 'p', 'data-rv-profile-sessions-title', profile.sessions.length > 1 ? 'Sessions' : 'Session');
      var ul = add(tpl.content, 'ul', 'data-rv-profile-sessions');
      profile.sessions.forEach(function (s) {
        var li = add(ul, 'li', 'data-rv-profile-session');
        if (s.when) add(li, 'span', 'data-rv-profile-when', s.when);
        add(li, 'span', 'data-rv-profile-title', s.title);
      });
    }
    card.appendChild(tpl);
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

  /* agenda: in day order, then by start time; time as "9:30 AM – 10:15 AM"; speakers by name */
  function clockLabel(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m || +m[1] > 23) return String(v || '').trim();
    return ((+m[1] % 12) || 12) + ':' + m[2] + (+m[1] < 12 ? ' AM' : ' PM');
  }
  function translateSessionsFlat(sessions, days, speakers) {
    if (!sessions || !sessions.length) return null;
    var dayAt = {}, nameOf = {};
    (days || []).slice().sort(byOrder).forEach(function (d, i) { dayAt[d.id] = i; });
    (speakers || []).forEach(function (s) { nameOf[s.id] = s.name || ''; });
    return sessions.slice().sort(function (a, b) {
      var da = a.groupId in dayAt ? dayAt[a.groupId] : 999, db = b.groupId in dayAt ? dayAt[b.groupId] : 999;
      return (da - db) || String(a.start || '').localeCompare(String(b.start || '')) || byOrder(a, b);
    }).map(function (s) {
      var time = [clockLabel(s.start), clockLabel(s.end)].filter(Boolean).join(' – ');
      return { title: s.title || '', time: time, desc: s.desc || '', room: s.room || '',
        speakers: (s.speakerIds || []).map(function (id) { return nameOf[id]; }).filter(Boolean).join(', ') };
    });
  }

  var GENERIC_REPEAT_SOURCES = {
    sessions: { resources: ['sessions', 'agenda-groups', 'speakers'], translate: translateSessionsFlat },
    speakers: { resources: ['speakers', 'sessions', 'agenda-groups'], translate: translateSpeakersFlat },
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
       speakers: n (name), r (role), c (company), photo (image); also bio, li (href on an <a>) — and every
                 card gets the speaker's profile for the visitor's pop-up (setSpeakerProfile above)
       faq:      t (question), d (answer)
       partners: name, url (href on an <a>, else text), logo (image)
       contact:  label, name, email, phone
       glimpses: imageUrl (image), caption
     Missing/falsy values leave the clone's existing placeholder content alone rather than blanking it —
     same never-wipe-to-empty discipline used elsewhere in this file (see translate() comment above). */
  function setGenericRepeatField(fieldEl, field, value, kind, refill) {
    var isImage = field === 'photo' || field === 'logo' || field === 'imageUrl';
    if (!value) {
      /* A model that was itself drawn from a record (refill) still holds that record's values: what this
         record does not have is cleared, or it would show another partner's logo or link. The first fill,
         from the design's own placeholder item, leaves the placeholder where the record has nothing. */
      if (!refill) return;
      if (isImage) { if (fieldEl.tagName === 'IMG') fieldEl.removeAttribute('src'); else fieldEl.style.backgroundImage = ''; }
      else if (((kind === 'partners' && field === 'url') || (kind === 'speakers' && field === 'li')) && fieldEl.tagName === 'A') fieldEl.removeAttribute('href');
      else if (!fieldEl.querySelector('[data-rv-field]')) fieldEl.textContent = '';
      return;
    }
    if (isImage) {
      if (fieldEl.tagName === 'IMG') fieldEl.src = value;
      else fieldEl.style.backgroundImage = 'url(' + value + ')';
      return;
    }
    if ((kind === 'partners' && field === 'url') || (kind === 'speakers' && field === 'li')) {
      if (fieldEl.tagName === 'A') fieldEl.href = value;
      else fieldEl.textContent = value;
      return;
    }
    if ('value' in fieldEl) fieldEl.value = value;
    else fieldEl.textContent = value;
  }

  function fillGenericRepeatClone(clone, item, kind, refill) {
    var fields = clone.hasAttribute('data-rv-field') ? [clone] : [];
    fields = fields.concat(Array.prototype.slice.call(clone.querySelectorAll('[data-rv-field]')));
    fields.forEach(function (fieldEl) {
      var field = fieldEl.getAttribute('data-rv-field');
      setGenericRepeatField(fieldEl, field, item[field], kind, refill);
    });
    if (kind === 'speakers') setSpeakerProfile(clone, item.profile);
    clone.setAttribute('data-rv-filled', '');
  }

  /* items null/empty -> do nothing, leave Gemini's own markup exactly as written (no template element to
     clone from means nothing to do either way). Otherwise: clone the single `[data-rv-repeat-template=
     "<kind>"]` element once per item, fill its data-rv-field descendants, insert each clone right after
     the previous one (so document order follows `items`' own order, starting right after the original),
     then drop the original template node once every clone is in — leaving only real, filled items.
     data-rv-repeat-template/data-rv-field are left on the clones: harmless, unrendered markers, not worth
     stripping. */
  /* Every item of the kind standing in a list is what an earlier load drew (a saved page comes back with
     them): they are all replaced by one item per record, so a list never grows from one load to the next.
     The first of them is the model the new items are cloned from. */
  /* A list of a kind the event has NO records of still holds the designer's sample item ("Partner Name").
     That is not this event's content, so the place is marked data-rv-empty: the published and previewed page
     hide it (templates/_shared/rv-live.css), together with the links to it in the top bar; in the editor it
     stays, under a notice that says why visitors do not see it and where to add the records. The section is
     what is marked when the list is what it is about (nothing else in it but a heading and a line or two);
     otherwise only the list. Records arriving later undo all of it (markFilled). */
  var EMPTY_NOTES = {
    partners: 'No partners yet: add them in Content › Partners.', speakers: 'No speakers yet: add them in Content › Speakers.',
    sessions: 'No agenda yet: add sessions in Content › Agenda.', faq: 'No FAQs yet: add them in Content › FAQs.',
    contact: 'No contacts yet: add them in Content › Contacts.', glimpses: 'No pictures yet: add them in Content › Gallery.'
  };
  function emptyPlaceOf(listParent) {
    var sec = listParent.closest('[data-rv-section]');
    if (!sec) return listParent;
    var words = (sec.innerText || sec.textContent || '').replace(/\s+/g, ' ').trim().length;
    var listWords = (listParent.innerText || listParent.textContent || '').replace(/\s+/g, ' ').trim().length;
    return words - listWords <= 600 ? sec : listParent;
  }
  function markEmpty(doc, kind) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-repeat-template="' + kind + '"]'), function (el) {
      var parent = el.parentNode;
      if (!parent || parent.querySelector(':scope > [data-rv-empty-state]')) return;
      var place = emptyPlaceOf(parent);
      place.setAttribute('data-rv-empty', kind);
      var note = doc.createElement('div');
      note.setAttribute('data-rv-empty-state', kind);
      note.setAttribute('data-rv-editor', '');
      note.setAttribute('data-ed', 'none');
      note.setAttribute('style', 'margin:12px 0;padding:10px 14px;border:1px dashed rgba(128,128,128,.6);border-radius:8px;font:500 13px/1.5 Inter,Arial,sans-serif;color:inherit;opacity:.85');
      note.textContent = (EMPTY_NOTES[kind] || 'Nothing to show yet.') + ' Until then visitors do not see ' + (place === parent ? 'this list' : 'this section') + '.';
      parent.insertBefore(note, parent.firstChild);
      if (place !== parent && place.id) {
        Array.prototype.forEach.call(doc.querySelectorAll('a[href="#' + place.id + '"]'), function (a) {
          /* the menu's links only: a button elsewhere ("Join as partner") still stands for something real */
          if (a.closest('[data-rv-section="nav"], [data-rv-section="footer"]')) a.setAttribute('data-rv-nav-empty', '');
        });
      }
    });
  }
  function markFilled(doc, kind) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-empty="' + kind + '"]'), function (place) {
      place.removeAttribute('data-rv-empty');
      if (place.id) Array.prototype.forEach.call(doc.querySelectorAll('a[href="#' + place.id + '"][data-rv-nav-empty]'), function (a) { a.removeAttribute('data-rv-nav-empty'); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-empty-state="' + kind + '"]'), function (n) { n.remove(); });
  }

  function applyGenericRepeat(canvas, kind, items) {
    if (!canvas || !canvas.doc || !items) return;
    if (!items.length) { markEmpty(canvas.doc, kind); return; }
    markFilled(canvas.doc, kind);
    var lists = [];
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-repeat-template="' + kind + '"]'), function (el) {
      if (!el.parentNode) return;
      var list = lists.filter(function (l) { return l.parent === el.parentNode; })[0];
      if (list) list.standing.push(el); else lists.push({ parent: el.parentNode, standing: [el] });
    });
    lists.forEach(function (list) {
      var tpl = list.standing[0], refill = tpl.hasAttribute('data-rv-filled');
      var before = list.standing[list.standing.length - 1].nextSibling;
      var drawn = items.map(function (item) {
        var clone = tpl.cloneNode(true);
        clone.classList.remove('ed-selected', 'sec-active');
        fillGenericRepeatClone(clone, item, kind, refill);
        return clone;
      });
      list.standing.forEach(function (el) { el.remove(); });
      drawn.forEach(function (clone) { list.parent.insertBefore(clone, before); });
    });
  }

  /* ---------- sections the event's records bring with them ----------
     What is entered in Content (speakers, agenda, partners, gallery, FAQs, contacts) shows on the site
     without anyone designing a section for it: when the event has records of a kind and nothing on the page
     shows that kind, a section for it is added when the editor opens — before the page's closing sections,
     in the order below. It is an ordinary section from then on (moved, hidden, restyled, redesigned), drawn
     in the site's own colours and fonts, and its items are the records (the same data-rv-repeat-template
     convention an AI-designed section uses, so the live page keeps it current). A section the owner
     deletes leaves a marker behind and is not added again.
     Not on an imported site: that page is one captured block with its own way of showing these. */
  var AUTO_KINDS = ['speakers', 'sessions', 'partners', 'glimpses', 'faq', 'contact'];
  var AUTO_SECTIONS = {
    speakers: { name: 'Speakers', title: 'Speakers', resource: 'speakers',
      item: '<article class="rva-card" data-rv-repeat-template="speakers"><img class="rva-photo" data-rv-field="photo" alt=""><h3 class="rva-name" data-rv-field="n">Speaker name</h3><p class="rva-line" data-rv-field="r">Designation</p><p class="rva-line rva-strong" data-rv-field="c">Company</p></article>',
      css: '.rva-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:28px}.rva-card{text-align:center}.rva-photo{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:14px;background:var(--rv-surface,#eef0f3);display:block;margin:0 0 14px}.rva-name{font-size:20px;line-height:1.25;margin:0 0 4px}.rva-line{font-size:15px;line-height:1.45;margin:0;opacity:.8}.rva-strong{font-weight:600;opacity:1}' },
    sessions: { name: 'Agenda', title: 'Agenda', resource: 'sessions',
      item: '<article class="rva-row" data-rv-repeat-template="sessions"><div class="rva-time" data-rv-field="time">Time</div><div class="rva-what"><h3 class="rva-name" data-rv-field="title">Session title</h3><p class="rva-line" data-rv-field="desc">What this session covers.</p><p class="rva-line rva-strong" data-rv-field="speakers">Speakers</p><p class="rva-line" data-rv-field="room">Room</p></div></article>',
      css: '.rva-list{display:flex;flex-direction:column}.rva-row{display:grid;grid-template-columns:190px 1fr;gap:24px;padding:22px 0;border-top:1px solid rgba(128,128,128,.3)}.rva-row:last-child{border-bottom:1px solid rgba(128,128,128,.3)}.rva-time{font-size:16px;font-weight:700;letter-spacing:.04em;color:var(--theme-color,#186bf9)}.rva-name{font-size:21px;line-height:1.25;margin:0 0 6px}.rva-line{font-size:16px;line-height:1.55;margin:0 0 4px;opacity:.82}.rva-strong{font-weight:600;opacity:1}@media (max-width:720px){.rva-row{grid-template-columns:1fr;gap:6px}}' },
    partners: { name: 'Partners', title: 'Our Partners', resource: 'partners',
      item: '<div class="rva-logo" data-rv-repeat-template="partners"><a class="rva-logo-link" data-rv-field="url"><img data-rv-field="logo" alt=""><span class="rva-line" data-rv-field="name">Partner name</span></a></div>',
      css: '.rva-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:22px}.rva-logo{background:#fff;border:1px solid rgba(128,128,128,.28);border-radius:12px;padding:22px 18px}.rva-logo-link{display:flex;flex-direction:column;align-items:center;gap:12px;text-decoration:none;color:#16181d}.rva-logo img{width:100%;height:76px;object-fit:contain}.rva-line{font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0;text-align:center}' },
    glimpses: { name: 'Gallery', title: 'Glimpses', resource: 'gallery',
      item: '<figure class="rva-shot" data-rv-repeat-template="glimpses"><img data-rv-field="imageUrl" alt=""><figcaption class="rva-line" data-rv-field="caption">Caption</figcaption></figure>',
      css: '.rva-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}.rva-shot{margin:0}.rva-shot img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;display:block;background:var(--rv-surface,#eef0f3)}.rva-line{font-size:14px;line-height:1.45;margin:8px 0 0;opacity:.8}' },
    faq: { name: 'FAQs', title: 'Frequently Asked Questions', resource: 'faqs',
      item: '<div class="rva-qa" data-rv-repeat-template="faq"><h3 class="rva-name" data-rv-field="t">Question goes here</h3><p class="rva-line" data-rv-field="d">Answer goes here.</p></div>',
      css: '.rva-list{display:flex;flex-direction:column;max-width:860px}.rva-qa{padding:22px 0;border-top:1px solid rgba(128,128,128,.3)}.rva-qa:last-child{border-bottom:1px solid rgba(128,128,128,.3)}.rva-name{font-size:20px;line-height:1.3;margin:0 0 8px}.rva-line{font-size:17px;line-height:1.65;margin:0;opacity:.85}' },
    contact: { name: 'Contact', title: 'Contact Us', resource: 'contacts',
      item: '<div class="rva-contact" data-rv-repeat-template="contact"><p class="rva-label" data-rv-field="label">For queries</p><h3 class="rva-name" data-rv-field="name">Contact name</h3><p class="rva-line" data-rv-field="email">name@example.com</p><p class="rva-line" data-rv-field="phone">+00 00000 00000</p></div>',
      css: '.rva-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px}.rva-contact{background:var(--rv-surface,#f5f6f8);border-radius:12px;padding:24px}.rva-label{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--theme-color,#186bf9);margin:0 0 8px}.rva-name{font-size:20px;line-height:1.25;margin:0 0 8px}.rva-line{font-size:16px;line-height:1.5;margin:0}' }
  };
  /* what a section picked from the gallery of designs is called -> the kind of record it is for */
  function kindForName(name) {
    var n = String(name || '').toLowerCase();
    if (/speaker/.test(n)) return 'speakers';
    if (/agenda|session|schedule/.test(n)) return 'sessions';
    if (/sponsor|partner/.test(n)) return 'partners';
    if (/glimpse|gallery/.test(n)) return 'glimpses';
    if (/faq|question/.test(n)) return 'faq';
    if (/contact/.test(n)) return 'contact';
    return '';
  }
  var CONTENT_MAP_KIND = { speakers: ['speakers'], sessions: ['agenda', 'sessions'], partners: ['partners'], glimpses: ['glimpses'], faq: ['faq'], contact: ['contact'] };
  /* whether the page already shows the kind somewhere — or the owner took its section away on purpose */
  function kindPlaced(kind) {
    var doc = canvas.doc;
    if (doc.querySelector('[data-rv-repeat-template="' + kind + '"], [data-rv-auto="' + kind + '"], template[data-rv-auto-off="' + kind + '"]')) return true;
    var map = ((canvas.template.content || {}).map) || [];
    return map.some(function (m) {
      return CONTENT_MAP_KIND[kind].indexOf(m.from) !== -1 && !!doc.querySelector('[data-rv-section="' + String(m.section || '').replace(/["\\]/g, '\\$&') + '"]');
    });
  }
  function createAutoSection(kind) {
    var spec = AUTO_SECTIONS[kind], doc = canvas.doc, type = 'auto-' + kind;
    var scope = '[data-rv-auto="' + kind + '"]';
    /* every rule is tied to this section, so the class names mean nothing anywhere else on the page */
    var rules = '.rva-wrap{max-width:1200px;margin:0 auto}.rva-title{font-family:var(--heading-font-family,inherit);font-size:clamp(28px,3vw,38px);line-height:1.1;margin:0 0 36px}.rva-name{font-family:var(--heading-font-family,inherit)}' + spec.css;
    var css = scope + '{padding:clamp(56px,8vw,112px) 24px;background:var(--rv-bg,transparent);color:var(--rv-text,inherit);font-family:var(--body-font-family,inherit)}' +
      rules.replace(/(^|[{}])\s*([^{}@]+)\{/g, function (all, lead, sel) {
        return lead + sel.split(',').map(function (x) { return scope + ' ' + x.trim(); }).join(',') + '{';
      });
    var el = doc.createElement('section');
    el.setAttribute('data-rv-section', type);
    el.setAttribute('data-rv-auto', kind);
    el.setAttribute('data-sec-name', spec.name);
    if (!doc.getElementById(kind)) el.id = kind;
    el.innerHTML = '<div class="rva-wrap"><h2 class="rva-title">' + spec.title + '</h2><div class="rva-list">' + spec.item + '</div></div><style data-rv-auto-css>' + css + '</style>';
    return el;
  }
  function addAutoSection(kind, afterSec) {
    var el = createAutoSection(kind);
    canvas.insertSection(el, afterSec || null);
    canvas.retag(el);
    return el;
  }
  /* resolves the kinds a section was added for (none, most of the time) */
  function ensureAutoSections() {
    if (!canvas || !eventId || /^imported-/.test(canvas.template.id || '')) return Promise.resolve([]);
    var wanted = AUTO_KINDS.filter(function (kind) { return !kindPlaced(kind); });
    if (!wanted.length) return Promise.resolve([]);
    return Promise.all(wanted.map(function (kind) {
      return RevampCore.fetchSub(AUTO_SECTIONS[kind].resource, eventId).then(function (rows) { return rows && rows.length ? kind : ''; }, function () { return ''; });
    })).then(function (found) {
      var added = [];
      // each goes after the one before it, so they come in AUTO_KINDS order
      var after = null;
      found.filter(Boolean).forEach(function (kind) {
        if (kindPlaced(kind)) return;
        after = addAutoSection(kind, after);
        added.push(kind);
      });
      return added;
    });
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
    if (!canvas || !eventId) return Promise.resolve(null);
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
        if (inputs[0] == null) return;   // the kind's own records could not be fetched — leave it untouched
        /* confirmed empty (the fetch worked and there are none): the list's sample item is not this event's */
        if (Array.isArray(inputs[0]) && !inputs[0].length) { overlay[kind] = []; return; }
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
    if (!canvas || !eventId) return Promise.resolve(null);
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
    return ensureAutoSections().then(function (added) { return drawRecords(added.length > 0); });
  }
  /* The previous edition's speakers (built by the server, functions/lib/prev-sections.js) carry each speaker's
     profile — their sessions at that edition, LinkedIn, text — for the visitor's pop-up. A page saved before
     they did keeps its cards as they were; the profiles are added to them here from the server's current build
     of the section, card by card by the speaker's name: nothing else of a card changes, a card the owner renamed
     or added gets none, and a section that already has them is not asked about again. Resolves true when the
     page changed; never rejects. */
  function refreshPreviousProfiles() {
    var doc = canvas && canvas.doc, id = canvas && canvas.template && canvas.template.id;
    var sec = doc && /^gen-/.test(String(id || '')) ? doc.querySelector('[data-rv-section="previous-speakers"]') : null;
    if (!sec || sec.hasAttribute('data-rv-profiles') || sec.querySelector('[data-rv-profiles]') || !sec.querySelector('.pe-spk-card') || sec.querySelector('template[data-rv-profile]')) return Promise.resolve(false);
    function key(n) { return String((n && n.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    return fetch('/api/generated-section?eventId=' + encodeURIComponent(String(id).slice(4)) + '&id=previous-speakers')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        var built = res && typeof res.html === 'string' ? res.html : '';
        if (!/<template data-rv-profile>/.test(built)) return false;
        // parsed inert: a <template>'s content never runs or loads anything
        var holder = doc.createElement('template');
        holder.innerHTML = built;
        var byName = {};
        Array.prototype.forEach.call(holder.content.querySelectorAll('.pe-spk-card'), function (c) {
          var k = key(c.querySelector('.pe-spk-name'));
          if (k && !byName[k]) byName[k] = c;
        });
        var added = 0;
        Array.prototype.forEach.call(sec.querySelectorAll('.pe-spk-card'), function (card) {
          var from = byName[key(card.querySelector('.pe-spk-name'))];
          var tpl = from && from.querySelector('template[data-rv-profile]');
          if (!tpl || card.querySelector('template[data-rv-profile]')) return;
          added++;
          // the parts the pop-up reads the card's own text from, by the class they share with the new build
          ['group', 'name', 'role', 'co'].forEach(function (part) {
            var mark = from.querySelector('[data-rv-profile-' + part + ']'), cls = mark && mark.classList[0];
            var own = cls && card.querySelector('.' + cls);
            if (own) own.setAttribute('data-rv-profile-' + part, '');
          });
          card.appendChild(doc.importNode(tpl, true));
        });
        // nothing matched (every card renamed, say): the page is left exactly as it was, and asked about again next time
        if (!added) return false;
        sec.setAttribute('data-rv-profiles', '');
        if (typeof canvas.retag === 'function') { try { canvas.retag(sec); } catch (e) { /* the editor's own tagging */ } }
        return true;
      })
      .then(null, function () { return false; });
  }

  function drawRecords(sectionsAdded) {
    // Both detection paths run together — content.map `from` (ported templates) and the DOM
    // data-rv-repeat-template convention (AI-bespoke `gen-` templates) — and contribute additively to
    // one merged apply pass; see fetchGenericRepeatOverlay()'s own comment on why they never compete.
    return Promise.all([fetchSubcollectionOverlay(), fetchGenericRepeatOverlay(), refreshPreviousProfiles()]).then(function (results) {
      var content = results[0], repeatOverlay = results[1];
      var changed = !!sectionsAdded || results[2] === true;
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

  /* ---------- fonts on offer ----------
     A font is set as a CSS stack: the family, then the kind of font the browser falls back to while the family
     loads or when it cannot be had. The canvas loads the family's stylesheet itself (editor-canvas.js). */
  var FONT_KINDS = { 'Inter': 'sans-serif', 'Manrope': 'sans-serif', 'Poppins': 'sans-serif', 'Montserrat': 'sans-serif',
    'Fraunces': 'serif', 'Playfair Display': 'serif', 'Lora': 'serif', 'Noticia Text': 'serif', 'Merriweather': 'serif',
    'IBM Plex Mono': 'monospace' };
  var SHARED_FONTS = ['Inter', 'Manrope', 'Poppins', 'Fraunces', 'Playfair Display', 'Lora', 'Noticia Text', 'IBM Plex Mono'];
  function firstFamily(stack) { return String(stack || '').split(',')[0].replace(/['"]/g, '').trim(); }
  function fontStack(family) {
    var kind = FONT_KINDS[family] ||
      (/mono|code/i.test(family) ? 'monospace' : /sans/i.test(family) ? 'sans-serif' : /serif|slab|display|garamond|baskerville|bodoni|caslon|georgia|times/i.test(family) ? 'serif' : 'sans-serif');
    return '"' + family.replace(/["\\]/g, '') + '", ' + kind;
  }
  /* the template's own fonts (template.json -> editorFonts, with the stacks its CSS expects) and then the shared ones */
  function fontChoices() {
    var own = (canvas && canvas.template.editorFonts) || {}, list = [], seen = {};
    Object.keys(own).forEach(function (label) {
      list.push({ label: label, stack: own[label] });
      seen[label.toLowerCase()] = seen[firstFamily(own[label]).toLowerCase()] = 1;
    });
    SHARED_FONTS.forEach(function (family) {
      if (!seen[family.toLowerCase()]) list.push({ label: family, stack: fontStack(family) });
    });
    return list;
  }
  /* the stack for a family named on its own (by the AI assistant, or read back from the page) */
  function stackFor(family) {
    family = firstFamily(family);
    var known = fontChoices().filter(function (f) { return f.label.toLowerCase() === family.toLowerCase() || firstFamily(f.stack).toLowerCase() === family.toLowerCase(); })[0];
    return known ? known.stack : fontStack(family);
  }

  /* ---------- applying a design proposed by the AI (Create Event's "Let AI design it", the chat panel) ----------
     Returns the settings that were left out because this site has nothing for them to act on. */
  function applyAiDesignToCanvas(canvas, design) {
    var skipped = [];
    if (!canvas || !design) return skipped;
    Object.keys(design).forEach(function (key) {
      var isFont = key === 'headingFont' || key === 'bodyFont';
      if (!canvas.design.supports(key) || !canvas.design.set(key, isFont ? stackFor(design[key]) : design[key])) skipped.push(key);
    });
    syncEtLogos();
    return skipped;
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
        var id = sec.getAttribute('data-rv-key') || sec.getAttribute('data-rv-section');
        return { id: id, name: sec.getAttribute('data-sec-name') || id };
      });
    }
    return { generated: list('data-ai-generated'), skipped: list('data-ai-skipped') };
  }

  /* the topbar toggle's actual effect — a class on the iframe document's own <html>, since the badges
     (and editor-canvas.css's visibility rule for them) live inside it, not in custom_editor.html itself. */
  function setAiMarkers(show) {
    aiMarkersOn = !!show;
    if (canvas) canvas.doc.documentElement.classList.toggle('show-ai-markers', aiMarkersOn);
  }

  /* C1 — "cleared once a human edits that section": called at each of this file's own actual content-edit
     commit points below (never from the generic commit() or the site-wide design settings, which change layout/theme rather
     than a specific section's own written content) with whatever element is in scope there. One-way: once
     removed, nothing in this file ever sets it back. */
  function clearAiGenerated(el) {
    var sec = el && el.nodeType === 1 ? el.closest('[data-ai-generated]') : null;
    if (sec) sec.removeAttribute('data-ai-generated');
  }

  // resolves true when the page as first opened is kept in this browser
  function seedSnapshot(draft) {
    var snap = canvas.snapshot();
    undoStack = [snap]; undoPtr = 0;
    return localPut(storeKey, { eventId: eventId, templateId: templateId, savedAt: Date.now(), snapshot: snap, handoff: draft, event: draft && draft.event, sourceDraftId: sourceDraftId, fillVersion: FILL_LOGIC_VERSION });
  }

  /* ---------- save / undo ----------
     Every committed change is one undo step and is written to this browser's copy at once, not after a delay:
     whatever is waiting for a timer when the page is left is lost. Three ways in:
       commitNow()     a finished action (toolbar, section tools, an applied AI proposal, leaving a text)
       commitTyping()  text being typed: the first one of an edit session adds a step, the later ones replace it,
                       so one stretch of typing is one undo step however long it took
       commit()        a control that fires continuously (a slider): one step once it has been still for a moment
     flush() records whatever is still pending; everything that reads or leaves the page calls it first. */
  function persist(snap) {
    // sourceDraftId/fillVersion ride along on every later edit too, not just the first save — otherwise the
    // very next commit after seedSnapshot() would overwrite it with a record that has neither, and a
    // second Generate-from-Brief run later in the SAME browser would no longer be able to tell this apart
    // from a never-regenerated draft (see resolveInitialContent()'s staleness check), and a real manual
    // edit made just after a correct seed would look exactly like an old, pre-fix snapshot again.
    return localPut(storeKey, { eventId: eventId, templateId: templateId, savedAt: Date.now(), snapshot: snap, sourceDraftId: sourceDraftId, fillVersion: FILL_LOGIC_VERSION });
  }

  /* This browser's copy (RevampStore) through two calls that never reject: a browser that gives the page no
     storage (some private modes, blocked site data) must still open and edit the site. It is told once. */
  var localStoreOk = true;
  function markLocalStoreUnavailable(err) {
    if (window.console) console.warn('[RevampTemplateUI] This browser gave the editor no local storage:', err);
    if (!localStoreOk) return;
    localStoreOk = false;
    showNotice('local-store', {
      kind: 'warn', dismissible: true,
      text: 'This browser cannot keep a copy of your work. Your changes will be lost when you close this tab.'
    });
  }
  // a key that is not set (a template preview, a draft without a logo) is simply "nothing kept"
  function localGet(key) {
    if (!key) return Promise.resolve(undefined);
    return RevampStore.get(key).catch(function (err) { markLocalStoreUnavailable(err); return undefined; });
  }
  function localPut(key, value) {
    if (!key) return Promise.resolve(false);
    return RevampStore.put(key, value).then(function () { return true; }, function (err) { markLocalStoreUnavailable(err); return false; });
  }
  function saveLocal(snap) { persist(snap); }


  function record(typing) {
    clearTimeout(commitTimer); commitTimer = null;
    if (!canvas || remounting) return false;
    var replacing = typing && typingPtr === undoPtr && undoPtr > 0;
    if (!typing) typingPtr = -1;
    var snap = canvas.snapshot(undoStack[undoPtr]);
    if (canvas.sameSnapshot(snap, undoStack[undoPtr])) return false;
    if (replacing && canvas.sameSnapshot(snap, undoStack[undoPtr - 1])) {
      // typed back to what it was before this edit session: no step left to undo
      undoStack = undoStack.slice(0, undoPtr);
      undoPtr--; typingPtr = -1;
    } else if (replacing) {
      undoStack[undoPtr] = snap;
    } else {
      undoStack = undoStack.slice(0, undoPtr + 1).concat([snap]);
      undoPtr = undoStack.length - 1;
      typingPtr = typing ? undoPtr : -1;
    }
    dismissUndoToast();
    updateHistoryButtons();
    saveLocal(undoStack[undoPtr]);
    scheduleServerSave();
    repositionToolbars();
    sectionsChanged();
    designChanged();
    return true;
  }
  function commitNow() { return record(false); }
  function commitTyping() { return record(true); }

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitNow, 400);
  }

  function flush() {
    if (!canvas || remounting) return;
    clearTimeout(typingTimer); typingTimer = null;
    if (editingEl) commitTyping();
    else if (commitTimer) commitNow();
  }

  function step(by) {
    if (!canvas || remounting) return;
    deselect();       // leaves any text being edited, which records it
    flush();          // either may just have added the newest step, so the pointer is read after them
    var ptr = undoPtr + by;
    if (ptr < 0 || ptr >= undoStack.length) return;
    typingPtr = -1;
    dismissUndoToast();
    undoPtr = ptr;
    canvas.restore(undoStack[undoPtr], restoreOpts());
    updateHistoryButtons();
    saveLocal(undoStack[undoPtr]);
    scheduleServerSave();
    repositionToolbars();
    sectionsChanged();
    designChanged();
  }
  function undo() { step(-1); }
  function redo() { step(1); }

  function updateHistoryButtons() {
    var u = document.getElementById('btn-tpl-undo'), r = document.getElementById('btn-tpl-redo');
    if (u) u.disabled = undoPtr <= 0;
    if (r) r.disabled = undoPtr >= undoStack.length - 1;
    syncAiUndo();
  }

  /* "Deleted — Undo": the button undoes the newest step, so the toast goes as soon as that step is no longer
     the deletion it talks about. */
  var undoToast = null;
  function dismissUndoToast() {
    if (undoToast) { undoToast.dismiss(); undoToast = null; }
  }
  function offerUndo(msg) {
    var t = showToast(msg, { action: { label: 'Undo', onClick: function () { undoToast = null; undo(); } } });
    undoToast = t || null;
  }

  /* ---------- selection + floating toolbars ---------- */
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

    linkPop = document.createElement('div');
    linkPop.id = 'tpl-link-pop';
    linkPop.className = 'tpl-pop';
    linkPop.hidden = true;
    frame.appendChild(linkPop);
    wireLinkPop();

    selToolbar.addEventListener('mousedown', function (e) { if (!e.target.closest('select, input')) e.preventDefault(); });
    selToolbar.addEventListener('click', onToolbarClick);
    secToolbar.addEventListener('click', onSecToolbarClick);
    document.addEventListener('mousedown', function (e) {
      if (frame.contains(e.target)) return;   // clicks inside the canvas/toolbars are handled on their own listeners
      // a side panel that acts on what is selected (Add elements) is marked so that using it keeps the selection
      if (e.target.nodeType === 1 && e.target.closest('[data-keep-selection]')) return;
      deselect();
    });
  }

  /* taking a marker class off must not leave class="" behind: the page would then differ from what was saved
     although nothing was changed */
  function unmark(el, cls) {
    el.classList.remove(cls);
    if (!el.getAttribute('class')) el.removeAttribute('class');
  }

  /* the chat's "Selected" chip follows the selection (wireChatPanel sets it) */
  var chatFocusRedraw = null;
  function selectionChanged() {
    if (chatFocusRedraw) chatFocusRedraw();
    if (!host || !host.onSelectionChange) return;
    var kind = selectedEl ? selectedEl.getAttribute('data-editable') : '';
    host.onSelectionChange(selectedEl ? { kind: kind, canStyle: !!styleTarget() } : null);
  }

  function clearElementSelection() {
    closeLinkPop();
    var had = selectedEl;
    if (selectedEl) unmark(selectedEl, 'ed-selected');
    markCurrentItem(null);
    selectedEl = null;
    if (selWatch) selWatch.disconnect();
    selToolbar.hidden = true;
    if (had) selectionChanged();
  }

  function clearActiveSection() {
    var had = activeSectionEl;
    if (activeSectionEl) unmark(activeSectionEl, 'sec-active');
    activeSectionEl = null;
    secToolbar.hidden = true;
    if (had) sectionsChanged();
  }

  function setActiveSection(sec) {
    var had = activeSectionEl;
    if (activeSectionEl && activeSectionEl !== sec) unmark(activeSectionEl, 'sec-active');
    activeSectionEl = sec; sec.classList.add('sec-active');
    buildSecToolbar(sec);
    if (had !== sec) sectionsChanged();
  }

  function deselect() {
    if (editingEl) exitEdit(editingEl);
    clearElementSelection();
    clearActiveSection();
  }

  function selectSectionOnly(sec) {
    if (editingEl) exitEdit(editingEl);
    clearElementSelection();
    setActiveSection(sec);
    positionToolbars();
  }

  function selectElement(el) {
    if (editingEl && editingEl !== el) exitEdit(editingEl);
    if (selectedEl !== el) clearElementSelection();
    var sec = el.closest('[data-rv-section]');
    if (sec) setActiveSection(sec); else clearActiveSection();
    selectedEl = el; el.classList.add('ed-selected');
    markCurrentItem(repeatItemOf(el));
    buildToolbar(el);
    // the element grows and shrinks as its text is typed; the pill follows it
    if (canvas.win.ResizeObserver) {
      if (selWatch) selWatch.disconnect();
      selWatch = new canvas.win.ResizeObserver(repositionToolbars);
      selWatch.observe(el);
    }
    positionToolbars();
    selectionChanged();
  }

  var TEXT_FORMAT_ACTIONS = { bold: 1, italic: 1, underline: 1, strikethrough: 1 };

  /* Where a Link on this element is kept: the element when it is a link itself, else the link around it. A text
     with no link gets one around the words selected in it. Nothing can be linked inside a <button>, which may
     not contain a link, and a button-like box that is not a link is first turned into one (linkHost). */
  function anchorOf(el) {
    var a = el.closest('a');
    var sec = el.closest('[data-rv-section]');
    return a && sec && sec.contains(a) ? a : null;
  }
  function canLink(el) {
    var type = el.getAttribute('data-editable');
    if (anchorOf(el)) return true;
    if (el.closest('button')) return false;
    return type === 'text' || type === 'button';
  }

  function buildToolbar(el) {
    var type = el.getAttribute('data-editable');
    var link = canLink(el) ? '<button data-action="link" title="Where this leads when clicked">Link</button>' : '';
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
        (link ? '<span class="tpl-tb-sep"></span>' + link : '');
    } else if (type === 'button') {
      html += link;
    } else if (type === 'image') {
      html += '<button data-action="replace-image" title="Replace image">Replace image</button>' +
        '<button data-action="alt-text" title="Alt text">Alt text</button>' + link;
    }
    var item = repeatItemOf(el);
    if (item) {
      var around = groupOf(el.closest('[data-rv-section]'), item), at = around.indexOf(item);
      html += (html ? '<span class="tpl-tb-sep"></span>' : '') +
        '<button data-action="item-add" title="Add another item like this one, right after it">+ Add item</button>' +
        '<button class="icon-only" data-action="item-earlier" title="Move this item earlier"' + (at <= 0 ? ' disabled' : '') + '>&#8592;</button>' +
        '<button class="icon-only" data-action="item-later" title="Move this item later"' + (at === around.length - 1 ? ' disabled' : '') + '>&#8594;</button>' +
        '<button data-action="item-remove" title="Remove this item">Remove item</button>';
    }
    html += (html ? '<span class="tpl-tb-sep"></span>' : '') +
      '<button class="icon-only" data-action="duplicate" title="Duplicate">&#10697;</button>' +
      '<button class="icon-only danger" data-action="delete" title="Delete" aria-label="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>' +
      '<button class="icon-only" data-action="deselect" title="Close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
    selToolbar.innerHTML = html;
  }

  /* ---------- where the two pills sit ----------
     Both are positioned in #frame's own coordinates from the selection's place on screen (canvas.screenRect
     allows for the canvas being scaled), and are placed again whenever that place can have changed: the canvas
     scrolls, the text grows, the frame is resized, the device changes, an undo step is put back.
       element pill   above the element, below it when there is no room above; gone while the element is out of view
       section pill   inside the section's top-right corner, staying at the top of the canvas while a tall section
                      scrolls past; gone while the section is out of view; moved out of the element pill's way */
  var positionFrame = 0;
  function repositionToolbars() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(function () { positionFrame = 0; positionToolbars(); });
  }

  function overlaps(a, b) {
    return a && b && a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  }
  function place(node, box) {
    node.style.left = Math.round(box.left) + 'px';
    node.style.top = Math.round(box.top) + 'px';
  }

  function positionToolbars() {
    if (!canvas || remounting || !selToolbar) return;
    var fr = frame.getBoundingClientRect();
    var selBox = null, elBox = null;

    if (selectedEl && selectedEl.isConnected && canvas.inView(selectedEl)) {
      var r = canvas.screenRect(selectedEl);
      elBox = { left: r.left - fr.left, top: r.top - fr.top, width: r.width, height: r.height };
      selToolbar.hidden = false;
      var w = selToolbar.offsetWidth, h = selToolbar.offsetHeight;
      var top = r.top - fr.top - h - 8;
      if (top < 4) top = r.bottom - fr.top + 8;
      // taller than the canvas, so no room on either side: the bottom edge of the canvas is the least in the way
      if (top + h > fr.height - 4) top = fr.height - h - 4;
      selBox = { left: Math.max(6, Math.min(r.left - fr.left, fr.width - w - 6)), top: top, width: w, height: h };
      place(selToolbar, selBox);
      if (!linkPop.hidden) positionLinkPop(selBox, fr);
    } else {
      selToolbar.hidden = true;
      if (!selectedEl || !selectedEl.isConnected) closeLinkPop();
      else linkPop.style.visibility = linkPop.hidden ? '' : 'hidden';      // scrolled away with its element
    }

    if (!activeSectionEl || !activeSectionEl.isConnected) { secToolbar.hidden = true; return; }
    var s = canvas.screenRect(activeSectionEl);
    if (s.bottom <= fr.top || s.top >= fr.bottom) { secToolbar.hidden = true; return; }
    secToolbar.hidden = false;
    var sw = secToolbar.offsetWidth, sh = secToolbar.offsetHeight;
    var secTop = Math.max(s.top - fr.top, 0) + 8;
    secTop = Math.max(4, Math.min(secTop, s.bottom - fr.top - sh - 8));
    // a hidden section is only a slim bar: the pill sits level with it rather than above it
    if (activeSectionEl.classList.contains('is-hidden-sec')) secTop = Math.max(4, Math.min(s.top - fr.top + (s.height - sh) / 2, fr.height - sh - 4));
    var rightEdge = Math.min(s.right - fr.left, fr.width), leftEdge = Math.max(s.left - fr.left, 0);
    var spots = [];
    // a phone-width canvas leaves the frame empty beside it: the pill goes there, off the page altogether
    if (fr.width - rightEdge >= sw + 16) spots.push({ left: rightEdge + 8, top: secTop });
    spots.push({ left: Math.max(6, rightEdge - sw - 8), top: secTop });
    spots.push({ left: Math.max(6, leftEdge + 8), top: secTop });
    if (selBox) {
      spots.push({ left: Math.max(6, rightEdge - sw - 8), top: selBox.top - sh - 6 });
      spots.push({ left: Math.max(6, rightEdge - sw - 8), top: selBox.top + selBox.height + 6 });
    }
    var inFrame = spots.filter(function (b) { return b.top >= 4 && b.top + sh <= fr.height - 4; });
    if (inFrame.length) spots = inFrame;
    spots.forEach(function (b) { b.width = sw; b.height = sh; });
    // first choice: clear of the element and of its pill; failing that, clear of the pill
    var best = spots.filter(function (b) { return !overlaps(b, selBox) && !overlaps(b, elBox); })[0] ||
      spots.filter(function (b) { return !overlaps(b, selBox); })[0] || spots[0];
    place(secToolbar, best);
  }

  function onToolbarClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || !selectedEl) return;
    var action = btn.getAttribute('data-action');
    if (action !== 'link') closeLinkPop();
    if (TEXT_FORMAT_ACTIONS[action]) {
      /* Words the owner has selected take the format. With no words selected — the text was only clicked, or
         only the caret is in it — the whole text does; the caret is then left at its end, so that typing on
         does not replace the text. */
      var sel = canvas.win.getSelection();
      var words = editingEl === selectedEl && sel.rangeCount && !sel.isCollapsed && selectedEl.contains(sel.anchorNode);
      if (!words) {
        if (editingEl !== selectedEl) enterEdit(selectedEl);
        var all = canvas.doc.createRange();
        all.selectNodeContents(selectedEl);
        sel.removeAllRanges(); sel.addRange(all);
      }
      // the real templates' CSS reset gives <i> the font of the text around it, so italics are written as a style
      if (action === 'italic') canvas.doc.execCommand('styleWithCSS', false, true);
      canvas.doc.execCommand(action === 'strikethrough' ? 'strikeThrough' : action);
      if (action === 'italic') canvas.doc.execCommand('styleWithCSS', false, false);
      if (!words) sel.collapseToEnd();
      clearAiGenerated(selectedEl);
      commitNow();
    } else if (action === 'align-left' || action === 'align-center' || action === 'align-right') {
      selectedEl.style.textAlign = action.slice(6);
      clearAiGenerated(selectedEl);
      commitNow();
    } else if (action === 'link') {
      if (linkPop.hidden) openLinkPop(); else closeLinkPop();
    } else if (action === 'replace-image') {
      var picEl = selectedEl;
      openPictureDialog('Replace image', canvas.pictureOf(picEl), function (url) {
        if (!picEl.isConnected) return;
        /* a logo unit the owner has replaced no longer needs the note about the one it replaced */
        var unit = picEl.closest ? picEl.closest('[data-rv-logo-note]') : null;
        if (unit) {
          unit.removeAttribute('data-rv-logo-note');
          var shownNote = document.querySelector('#ed-notices [data-notice="logo-unit"]');
          if (shownNote) shownNote.remove();
        }
        canvas.setPicture(picEl, url); clearAiGenerated(picEl); commitNow(); repositionToolbars();
      });
    } else if (action === 'alt-text') {
      var alt = prompt('Alt text', selectedEl.getAttribute('alt') || selectedEl.getAttribute('data-alt') || '');
      if (alt !== null) { if (selectedEl.tagName === 'IMG') selectedEl.setAttribute('alt', alt); else selectedEl.setAttribute('data-alt', alt); clearAiGenerated(selectedEl); commitNow(); }
    } else if (action === 'duplicate') {
      if (editingEl) exitEdit(editingEl);
      var clone = selectedEl.cloneNode(true);
      clone.classList.remove('ed-selected');
      if (!clone.getAttribute('class')) clone.removeAttribute('class');
      selectedEl.after(clone);
      canvas.adoptElement(clone);
      canvas.retag(clone);
      clearAiGenerated(selectedEl);
      commitNow();
      selectElement(clone);
    } else if (action === 'delete') {
      deleteElement(selectedEl);
    } else if (action === 'deselect') {
      deselect();
    } else if (action.indexOf('item-') === 0) {
      onItemAction(action.slice(5), selectedEl);
    }
  }

  /* ---------- a section designed again by the AI ----------
     The section as it stands (the owner's edits included) goes to POST /api/redesign-section with what the
     owner asked for; the answer takes its place as ONE undo step. Nothing changes until the answer is there
     and usable, and one request runs at a time — each is a paid call. */
  var redesigning = false;
  function sectionOutline(sec) {
    if (!sec) return '';
    var h = sec.querySelector('h1, h2, h3');
    return (sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-section') || '') + (h ? ' ("' + h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) + '")' : '');
  }
  function openRedesignDialog(sec) {
    if (!isLive(sec) || redesigning) return;
    if (editingEl) exitEdit(editingEl);
    var name = sec.getAttribute('data-sec-name') || 'this section';
    var handle = host.openDialog({
      title: 'Redesign “' + name + '” with AI',
      bodyHtml:
        '<p style="margin:0 0 10px;font-size:13px;opacity:.8;">The AI gives this section a new layout and keeps its content. You can undo it.</p>' +
        '<textarea id="rv-redesign-ask" rows="3" maxlength="600" style="width:100%;resize:vertical;" placeholder="Optional — say what you want, e.g. “make it a timeline”, “put the picture on the right and make it bigger”, “more premium, less text”"></textarea>' +
        '<p id="rv-redesign-error" role="alert" style="margin:8px 0 0;font-size:12px;color:var(--crit,#c0392b);" hidden></p>',
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        { label: 'Redesign', kind: 'primary', onClick: function () { run(); return false; } }
      ]
    });
    var ask = document.getElementById('rv-redesign-ask'), problem = document.getElementById('rv-redesign-error');
    if (!ask) return;
    ask.focus();
    function button() { return Array.prototype.filter.call(document.querySelectorAll('.ed-dialog .btn'), function (b) { return /Redesign|Designing/.test(b.textContent); })[0]; }
    function run() {
      if (redesigning) return;
      if (!isLive(sec)) { if (handle && handle.close) handle.close(); return; }
      problem.hidden = true;
      redesigning = true;
      var b = button();
      if (b) { b.disabled = true; b.textContent = 'Designing… (about a minute)'; }
      ask.disabled = true;
      var secs = canvas.sections(), at = secs.indexOf(sec);
      var copy = sec.cloneNode(true);
      Array.prototype.forEach.call(copy.querySelectorAll('.ed-selected, .sec-active'), function (n) { n.classList.remove('ed-selected', 'sec-active'); });
      copy.classList.remove('ed-selected', 'sec-active');
      /* The records drawn into the section (partners, speakers…) are not the design: one item of each list
         goes to the AI, as the model it was, without the record's picture — a logo kept inline is hundreds
         of kilobytes. The records are drawn into the new design again once it is on the page. */
      var keptLists = [];
      Array.prototype.forEach.call(copy.querySelectorAll('[data-rv-repeat-template]'), function (item) {
        if (!item.parentNode) return;
        if (keptLists.indexOf(item.parentNode) !== -1) { item.remove(); return; }
        keptLists.push(item.parentNode);
        item.removeAttribute('data-rv-filled');
        Array.prototype.forEach.call(item.querySelectorAll('img[data-rv-field]'), function (img) { img.removeAttribute('src'); });
        Array.prototype.forEach.call(item.querySelectorAll('[data-rv-field][style*="background-image"]'), function (el) { el.style.backgroundImage = ''; });
      });
      RevampAuth.authedFetch('/api/redesign-section', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: eventId, sectionId: sec.getAttribute('data-rv-section'), html: copy.outerHTML, css: canvas.sectionCss(sec),
          instruction: ask.value.trim(), above: sectionOutline(secs[at - 1]), below: sectionOutline(secs[at + 1])
        })
      }).then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) { /* an error page from in front of the API */ }
          return { ok: res.ok, status: res.status, body: body };
        });
      }).then(null, function () { return null; }).then(function (r) {
        redesigning = false;
        var open = document.contains(ask);
        function fail(text) {
          if (!open) { host.showToast(text, { kind: 'error' }); return; }
          ask.disabled = false;
          var again = button();
          if (again) { again.disabled = false; again.textContent = 'Redesign'; }
          problem.textContent = text; problem.hidden = false;
        }
        if (!r) return fail('Could not reach the AI. The section is unchanged — check your connection and try again.');
        if (!r.ok || !r.body || r.body.error || !r.body.html) return fail((r.body && r.body.error) || 'The AI could not redesign this section (error ' + r.status + '). It is unchanged — try again.');
        if (!isLive(sec)) return fail('The section was removed while the AI was working, so there was nothing to replace.');
        deselect();
        flush();                        // what was pending stays its own undo step
        var fresh = canvas.replaceSection(sec, r.body.html, r.body.css);
        if (!fresh) return fail('The AI did not return a usable section. It is unchanged — try again.');
        fresh.setAttribute('data-ai-generated', 'true');       // written by the AI: asked about before publishing
        commitNow();
        if (keptLists.length) applySubcollectionOverlay();     // the event's records, drawn into the new design
        if (open && handle && handle.close) handle.close();
        selectSectionOnly(fresh);
        canvas.scrollToSection(fresh);
        offerUndo('“' + name + '” redesigned' + (r.body.summary ? ': ' + r.body.summary : '.'));
      });
    }
  }

  /* ---------- developer zone ----------
     One section's own HTML, CSS and JS, for what the editor's controls do not reach. Apply puts the three back
     on the page as ONE undo step.
       HTML   the section as it is on the page, without the editor's marks. The event's records drawn into a
              list (speakers, partners…) are shown as the one model item they are drawn from, and are drawn
              again after Apply. It must stay ONE element.
       CSS    on an AI-designed site, the section's own stylesheet (its rules begin with
              [data-rv-section="<id>"]). On a site built from a template, whose CSS belongs to the template,
              the rules written here are added to the section and win over the template's where they meet.
       JS     runs on the published and previewed site, once, with `section` as this section's element
              (et-runtime.js). It never runs inside the editor. */
  var DEV_MARKS = ['data-editable', 'contenteditable', 'data-text-original', 'data-rv-cur-item', 'data-rv-open', 'data-rv-aria', 'data-rv-key', 'data-sec-name', 'data-ai-generated', 'data-ai-skipped', 'data-rv-filled'];
  function devSource(sec) {
    var copy = sec.cloneNode(true);
    [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*'))).forEach(function (n) {
      DEV_MARKS.forEach(function (a) { n.removeAttribute(a); });
      n.classList.remove('ed-selected', 'sec-active', 'rv-in');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    var lists = [];
    Array.prototype.forEach.call(copy.querySelectorAll('[data-rv-repeat-template]'), function (item) {
      if (!item.parentNode) return;
      if (lists.indexOf(item.parentNode) !== -1) { item.remove(); return; }
      lists.push(item.parentNode);
      Array.prototype.forEach.call(item.querySelectorAll('img[data-rv-field]'), function (img) { img.removeAttribute('src'); });
    });
    var custom = copy.querySelector('style[data-rv-custom-css]'), holder = copy.querySelector('script[data-rv-js]');
    var js = holder ? holder.textContent : '', customCss = custom ? custom.textContent : '';
    if (custom) custom.remove();
    if (holder) holder.remove();
    var own = canvas.keepsOwnCss && canvas.sectionCss(sec);
    return { html: copy.outerHTML, css: own ? canvas.sectionCss(sec) : customCss, cssIsOwn: !!own, js: js, records: lists.length > 0 };
  }
  /* Line breaks and indents at block-level tags only: space between inline things (a word and a link, a label
     and its icon) is part of the text and is left exactly as it is. */
  var BLOCK_TAGS = /^(section|div|article|header|footer|main|nav|aside|figure|figcaption|ul|ol|li|dl|dt|dd|p|h[1-6]|table|thead|tbody|tr|td|th|form|blockquote|details|summary|style|script|template|picture|video)$/i;
  function prettyHtml(html) {
    var out = '', open = [];                    // open[i]: whether block i has had a block inside it
    function indent() { return new Array(open.length + 1).join('  '); }
    String(html).replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|[^<]+|</g, function (piece, name) {
      if (!name || !BLOCK_TAGS.test(name)) { out += piece; return ''; }
      if (piece.charAt(1) === '/') {
        var hadBlock = open.pop();
        // a block holding only words keeps its end tag on the words' line: no stray space joins the text
        if (hadBlock) out = out.replace(/[ \t]+$/, '') + (/\n$/.test(out) ? '' : '\n') + indent();
        out += piece;
      } else {
        if (open.length) open[open.length - 1] = true;
        out = out.replace(/[ \t]+$/, '');
        out += (out && !/\n$/.test(out) ? '\n' : '') + indent() + piece;
        if (!/\/>$/.test(piece)) open.push(false);
      }
      return '';
    });
    return out.trim();
  }
  function prettyCss(css) {
    // already laid out by hand (more lines than rules): left as written
    if ((css.match(/\n/g) || []).length > (css.match(/\{/g) || []).length) return css;
    return String(css).replace(/\s*\{\s*/g, ' {\n  ').replace(/;\s*/g, ';\n  ').replace(/\s*\}\s*/g, '\n}\n').replace(/\n  \n/g, '\n').trim();
  }

  /* The code editor is loaded the first time the developer zone opens, one file after another (each needs
     the one before it), and resolves window.CodeMirror — or null when a file could not be loaded. */
  var codeEditorLoading = null;
  function loadCodeEditor() {
    if (window.CodeMirror && window.CodeMirror.__rvReady) return Promise.resolve(window.CodeMirror);
    if (codeEditorLoading) return codeEditorLoading;
    var base = 'assets/codemirror/';
    ['codemirror.min.css', 'addon-dialog-dialog.min.css'].forEach(function (f) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + f; document.head.appendChild(l);
    });
    var files = ['codemirror.min.js', 'mode-xml-xml.min.js', 'mode-css-css.min.js', 'mode-javascript-javascript.min.js', 'mode-htmlmixed-htmlmixed.min.js',
      'addon-fold-xml-fold.min.js', 'addon-edit-closetag.min.js', 'addon-edit-closebrackets.min.js', 'addon-edit-matchbrackets.min.js', 'addon-edit-matchtags.min.js',
      'addon-dialog-dialog.min.js', 'addon-search-searchcursor.min.js', 'addon-search-search.min.js', 'addon-selection-active-line.min.js'];
    codeEditorLoading = files.reduce(function (chain, f) {
      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          var sc = document.createElement('script'); sc.src = base + f; sc.onload = resolve; sc.onerror = function () { reject(new Error(f)); };
          document.head.appendChild(sc);
        });
      });
    }, Promise.resolve()).then(function () { window.CodeMirror.__rvReady = true; return window.CodeMirror; }, function () { codeEditorLoading = null; return null; });
    return codeEditorLoading;
  }

  function openDevZone(startSec) {
    if (!canvas || remounting) return;
    if (editingEl) exitEdit(editingEl);
    var secs = canvas.sections();
    if (!secs.length) return;
    var sec = isLive(startSec) ? startSec : (isLive(activeSectionEl) ? activeSectionEl : secs[0]);
    var old = document.getElementById('rv-dev-zone');
    if (old) old.remove();
    var scrim = document.createElement('div');
    scrim.className = 'scrim'; scrim.id = 'rv-dev-zone';
    scrim.innerHTML =
      '<div class="modal dev-zone" role="dialog" aria-modal="true" aria-labelledby="rv-dev-title">' +
        '<div class="dev-head"><h3 id="rv-dev-title">Developer zone</h3>' +
          '<label class="dev-pick">Section <select id="rv-dev-section"></select></label>' +
          '<button class="icon-btn" id="rv-dev-close" title="Close" aria-label="Close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>' +
        '<div class="dev-tabs" role="tablist"><button data-dev-tab="html" class="active">HTML</button><button data-dev-tab="css">CSS</button><button data-dev-tab="js">JS</button>' +
          '<label class="dev-wrap"><input type="checkbox" id="rv-dev-wrap" checked> Word wrap</label><span class="dev-keys">Find: Ctrl/⌘ + F</span>' +
          '<span class="dev-note" id="rv-dev-note"></span></div>' +
        '<div class="dev-body"><textarea id="rv-dev-html" spellcheck="false" wrap="soft"></textarea><textarea id="rv-dev-css" spellcheck="false" wrap="soft" hidden></textarea><textarea id="rv-dev-js" spellcheck="false" wrap="soft" hidden></textarea></div>' +
        '<div class="dev-foot"><span class="dev-error" id="rv-dev-error" role="alert" hidden></span><button class="btn btn-secondary" id="rv-dev-cancel">Close</button><button class="btn btn-primary" id="rv-dev-apply">Apply to the page</button></div>' +
      '</div>';
    document.body.appendChild(scrim);
    function $(id) { return document.getElementById(id); }
    var pick = $('rv-dev-section'), boxes = { html: $('rv-dev-html'), css: $('rv-dev-css'), js: $('rv-dev-js') };
    var note = $('rv-dev-note'), problem = $('rv-dev-error');
    var tab = 'html', src = null, loaded = null;
    /* The three boxes become code editors (CodeMirror, kept with the app under assets/codemirror): syntax
       colours, line numbers, word wrap, the matching tag and bracket shown, tags and brackets closed as
       they are typed, find and replace. Until it has loaded — or if it cannot — they are plain text boxes
       and everything else works the same. */
    var editors = {};
    var MODES = { html: 'htmlmixed', css: 'css', js: 'javascript' };
    function val(k) { return editors[k] ? editors[k].getValue() : boxes[k].value; }
    function setVal(k, v) { if (editors[k]) { editors[k].setValue(v); editors[k].clearHistory(); } else boxes[k].value = v; }
    loadCodeEditor().then(function (CM) {
      if (!CM || !document.contains(scrim)) return;
      var wrap = $('rv-dev-wrap').checked;
      Object.keys(boxes).forEach(function (k) {
        var was = boxes[k].hidden;
        boxes[k].hidden = false;
        editors[k] = CM.fromTextArea(boxes[k], {
          mode: MODES[k], theme: 'rvdark', lineNumbers: true, lineWrapping: wrap, tabSize: 2, indentUnit: 2, indentWithTabs: false,
          autoCloseTags: k === 'html', autoCloseBrackets: true, matchBrackets: true, matchTags: k === 'html' ? { bothTags: true } : false,
          styleActiveLine: true,
          extraKeys: { Tab: function (cm) { if (cm.somethingSelected()) cm.indentSelection('add'); else cm.replaceSelection('  ', 'end'); }, 'Shift-Tab': 'indentLess' }
        });
        editors[k].getWrapperElement().hidden = was;
      });
      if (editors[tab]) { editors[tab].refresh(); editors[tab].focus(); }
    });
    $('rv-dev-wrap').addEventListener('change', function () {
      var on = this.checked;
      Object.keys(boxes).forEach(function (k) {
        if (editors[k]) editors[k].setOption('lineWrapping', on);
        else { boxes[k].setAttribute('wrap', on ? 'soft' : 'off'); boxes[k].style.whiteSpace = on ? 'pre-wrap' : 'pre'; }
      });
    });
    var NOTES = {
      html: function () { return 'One root element.' + (src.records ? ' Lists of the event’s records show the one item they are drawn from; the records come back after Apply.' : ''); },
      css: function () { return src.cssIsOwn ? 'This section’s own stylesheet. Keep each rule starting with [data-rv-section="' + sec.getAttribute('data-rv-section') + '"].' : 'Added to this section, on top of the template’s CSS. Start rules with [data-rv-section="' + sec.getAttribute('data-rv-section') + '"] to keep them to it.'; },
      js: function () { return 'Runs on the preview and the published site, not in the editor. `section` is this section’s element.'; }
    };
    function show(name) {
      tab = name;
      Object.keys(boxes).forEach(function (k) {
        if (editors[k]) editors[k].getWrapperElement().hidden = k !== name; else boxes[k].hidden = k !== name;
      });
      Array.prototype.forEach.call(scrim.querySelectorAll('[data-dev-tab]'), function (b) { b.classList.toggle('active', b.getAttribute('data-dev-tab') === name); });
      note.textContent = NOTES[name]();
      if (editors[name]) { editors[name].refresh(); editors[name].focus(); } else boxes[name].focus();
    }
    function load(target) {
      sec = target;
      src = devSource(sec);
      setVal('html', prettyHtml(src.html));
      setVal('css', prettyCss(src.css));
      setVal('js', src.js);
      loaded = { html: val('html'), css: val('css'), js: val('js') };
      problem.hidden = true;
      show(tab);
    }
    function dirty() { return loaded && (val('html') !== loaded.html || val('css') !== loaded.css || val('js') !== loaded.js); }
    function close() { scrim.remove(); document.removeEventListener('keydown', onKey, true); }
    function askClose() { if (!dirty() || window.confirm('Close without applying your changes?')) close(); }
    function onKey(e) {
      // Escape first closes the editor's own find box
      if (e.key === 'Escape') { if (scrim.querySelector('.CodeMirror-dialog')) return; e.stopPropagation(); askClose(); }
      // Tab types two spaces in a code box instead of leaving it
      if (e.key === 'Tab' && !e.shiftKey && e.target && e.target.tagName === 'TEXTAREA' && scrim.contains(e.target)) {
        e.preventDefault();
        var t = e.target, at = t.selectionStart;
        t.value = t.value.slice(0, at) + '  ' + t.value.slice(t.selectionEnd);
        t.selectionStart = t.selectionEnd = at + 2;
      }
    }
    document.addEventListener('keydown', onKey, true);
    secs.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = (s.getAttribute('data-sec-name') || s.getAttribute('data-rv-section')) + (s.classList.contains('is-hidden-sec') ? ' (hidden)' : '');
      pick.appendChild(o);
    });
    pick.value = String(secs.indexOf(sec));
    pick.addEventListener('change', function () {
      if (dirty() && !window.confirm('Switch section without applying your changes?')) { pick.value = String(secs.indexOf(sec)); return; }
      load(secs[+pick.value]);
    });
    Array.prototype.forEach.call(scrim.querySelectorAll('[data-dev-tab]'), function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-dev-tab')); }); });
    $('rv-dev-close').addEventListener('click', askClose);
    $('rv-dev-cancel').addEventListener('click', askClose);
    $('rv-dev-apply').addEventListener('click', function () {
      problem.hidden = true;
      function fail(text, where) { problem.textContent = text; problem.hidden = false; if (where) show(where); }
      if (!isLive(sec)) return fail('This section is no longer on the page. Pick another one.');
      var t = document.createElement('template');
      t.innerHTML = val('html').trim();
      var roots = t.content.children;
      if (roots.length !== 1) return fail(roots.length ? 'The HTML must be ONE element: everything of the section inside a single root tag (now ' + roots.length + ').' : 'The HTML is empty. A section needs one root element.', 'html');
      if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(roots[0].tagName)) return fail('The root of a section must be an ordinary element such as <section> or <div>.', 'html');
      var root = roots[0], css = val('css').trim(), js = val('js').trim();
      if (js) { try { new Function('section', js); } catch (err) { return fail('The JS has a syntax error: ' + err.message, 'js'); } }
      Array.prototype.forEach.call(root.querySelectorAll('style[data-rv-custom-css], script[data-rv-js]'), function (n) { n.remove(); });
      if (!src.cssIsOwn && css) {
        var st = document.createElement('style');
        st.setAttribute('data-rv-custom-css', '');
        st.textContent = css;
        root.appendChild(st);
      }
      if (js) {
        var holder = document.createElement('script');
        holder.setAttribute('type', 'text/plain');
        holder.setAttribute('data-rv-js', '');
        holder.textContent = js;
        root.appendChild(holder);
      }
      deselect();
      flush();                          // what was pending stays its own undo step
      var name = sec.getAttribute('data-sec-name') || 'section';
      var fresh = canvas.replaceSection(sec, root.outerHTML, src.cssIsOwn ? css : null);
      if (!fresh) return fail('The HTML could not be put on the page. Check that it is one well-formed element.', 'html');
      commitNow();
      secs[secs.indexOf(sec)] = fresh;
      close();
      selectSectionOnly(fresh);
      canvas.scrollToSection(fresh);
      offerUndo('“' + name + '” updated from the developer zone.');
      if (fresh.querySelector('[data-rv-repeat-template]')) drawRecords(false);     // the event's records, drawn again
    });
    load(sec);
  }

  /* ---------- choosing a picture ----------
     For a picture on the page and for a section's background: a file from the computer (stored with the event,
     RevampCore.uploadImage) or the web address of a picture that is already online. The picture is only set
     once it is known to load. apply(url) does the setting. */
  function openPictureDialog(title, current, apply) {
    var canUpload = !!(eventId && window.RevampCore && RevampCore.uploadImage);
    var handle = host.openDialog({
      title: title,
      bodyHtml:
        (canUpload
          ? '<button type="button" class="btn btn-secondary" id="rv-pic-upload">Upload from your computer</button>' +
            '<input type="file" id="rv-pic-file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>' +
            '<p style="margin:10px 0 6px;font-size:12px;opacity:.7;">PNG, JPG, WebP, GIF or SVG, up to 8 MB — or paste the web address of a picture</p>'
          : '<p style="margin:0 0 6px;font-size:12px;opacity:.7;">Paste the web address of a picture</p>') +
        '<input type="text" id="rv-pic-url" placeholder="https://example.org/picture.jpg" autocomplete="off" spellcheck="false" style="width:100%;">' +
        '<p id="rv-pic-error" role="alert" style="margin:8px 0 0;font-size:12px;color:var(--crit,#c0392b);" hidden></p>',
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        { label: 'Use this picture', kind: 'primary', onClick: function () { useAddress(); return false; } }
      ]
    });
    var urlBox = document.getElementById('rv-pic-url'), problem = document.getElementById('rv-pic-error');
    var fileBox = document.getElementById('rv-pic-file'), uploadBtn = document.getElementById('rv-pic-upload');
    if (!urlBox) return;
    urlBox.value = /^https?:/i.test(current || '') ? current : '';
    var busy = false;
    function fail(text) { problem.textContent = text; problem.hidden = false; }
    function done(url) { if (handle && handle.close) handle.close(); apply(url); host.showToast('Picture updated'); }
    function useAddress() {
      if (busy) return;
      problem.hidden = true;
      busy = true;
      checkImageUrl(urlBox.value).then(function (res) {
        busy = false;
        if (!document.contains(urlBox)) return;                 // closed meanwhile
        if (res.error) { fail(res.error); urlBox.focus(); return; }
        done(res.url);
      });
    }
    urlBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useAddress(); } });
    urlBox.addEventListener('input', function () { problem.hidden = true; });
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () { if (!busy) fileBox.click(); });
      fileBox.addEventListener('change', function () {
        var file = fileBox.files && fileBox.files[0];
        fileBox.value = '';
        if (!file || busy) return;
        problem.hidden = true;
        busy = true; uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
        RevampCore.uploadImage(eventId, 'media', file).then(function (up) {
          busy = false;
          if (!document.contains(urlBox)) return;
          done(up.url);
        }, function (err) {
          busy = false;
          if (!document.contains(urlBox)) return;
          uploadBtn.disabled = false; uploadBtn.textContent = 'Upload from your computer';
          fail((err && err.message) || 'The picture could not be uploaded. Please try again.');
        });
      });
    }
  }

  var KIND_NAMES = { text: 'Text', button: 'Button', image: 'Picture', block: 'Block' };

  /* An element that is the label of a repeated item (a card's title, a tile's picture — template.json →
     sections[].repeat) stands for the whole item: deleting only the label would leave an empty card behind. */
  function repeatItemLabelled(el) {
    var item = repeatItemOf(el);
    if (!item) return null;
    if (item === el) return item;
    var cfg = repeatConfigFor(el.closest('[data-rv-section]'));
    return cfg.label && item.querySelector(cfg.label) === el ? item : null;
  }

  function deleteElement(el) {
    var sec = el.closest('[data-rv-section]');
    var item = repeatItemLabelled(el);
    var what = item ? 'Item' : (KIND_NAMES[el.getAttribute('data-editable')] || 'Element');
    deselect();
    if (item) {
      if (!removeRepeatItem(sec, item)) return;
    } else {
      clearAiGenerated(el);    // closest() needs it still attached — before remove(), not after
      el.remove();
      commitNow();
    }
    offerUndo(what + ' deleted.');
  }

  /* ---------- Link pop-over ----------
     Edits the real href of the link the selected element is or sits in (anchorOf); for a text without one it
     wraps the words selected in it. The text selection is taken when the pop-over opens: typing in the
     pop-over's own fields moves focus out of the canvas, which ends the edit there. */
  var linkPop = null, linkCtx = null;

  function sectionChoices() {
    return canvas.sections().filter(function (sec) { return !sec.classList.contains('is-hidden-sec'); }).map(function (sec) {
      return { sec: sec, name: sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-section') };
    });
  }

  function describeLink(a) {
    if (!a) return 'No link yet.';
    var href = (a.getAttribute('href') || '').trim();
    if (a.hasAttribute('data-register-cta')) return 'Opens the registration form.';
    if (!href || href === '#') return 'No link yet.';
    if (href.charAt(0) === '#') {
      var target = canvas.doc.getElementById(href.slice(1));
      var sec = target && target.closest('[data-rv-section]');
      return sec ? 'Goes to the section "' + (sec.getAttribute('data-sec-name') || href.slice(1)) + '".' : 'Goes to ' + href + ' on this page.';
    }
    if (/^mailto:/i.test(href)) return 'Starts an email to ' + href.slice(7).split('?')[0] + '.';
    if (/^tel:/i.test(href)) return 'Calls ' + href.slice(4) + '.';
    return 'Opens ' + href;
  }

  /* What a link may point to: a web address, an email address, a phone number, a place on this page or a path
     on this site. Anything else that names a scheme (javascript:, data:, file: …) is refused. */
  var LINK_HELP = 'A link can go to a web address (https://…), an email address, a phone number or a section of this page.';
  function normaliseLink(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return { error: 'Enter a web address.' };
    if (/[\s\u0000-\u001f<>"]/.test(v)) return { error: 'A web address cannot contain spaces or quotes.' };
    if (/^https?:\/\//i.test(v)) {
      try { new URL(v); } catch (e) { return { error: 'That is not a complete web address. Try something like https://example.org/tickets.' }; }
      return { href: v };
    }
    if (/^(mailto|tel):./i.test(v)) return { href: v };
    if (v.charAt(0) === '#') return v.length > 1 ? { href: v } : { error: LINK_HELP };
    if (/^\/\//.test(v)) return normaliseLink('https:' + v);
    if (v.charAt(0) === '/') return { href: v };
    if (/^[^@\/:]+@[^@\/:]+\.[a-z]{2,}$/i.test(v)) return { href: 'mailto:' + v };
    // a name with a dot before any ":" is a bare domain (example.org, example.org:8080/x), not a scheme
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([\/?#].*)?$/i.test(v)) return normaliseLink('https://' + v);
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return { error: 'That kind of link is not allowed. ' + LINK_HELP };
    return { error: 'That does not look like a web address. Try something like https://example.org/tickets.' };
  }

  function linkKindOf(a) {
    var href = a ? (a.getAttribute('href') || '').trim() : '';
    if (a && a.hasAttribute('data-register-cta')) return 'register';
    if (/^mailto:/i.test(href)) return 'email';
    if (href.length > 1 && href.charAt(0) === '#' && canvas.doc.getElementById(href.slice(1))) return 'section';
    return 'web';
  }

  function openLinkPop() {
    var el = selectedEl;
    var anchor = anchorOf(el);
    var range = null;
    if (!anchor && el.getAttribute('data-editable') === 'text') {
      var sel = canvas.win.getSelection();
      if (sel.rangeCount && !sel.isCollapsed && el.contains(sel.getRangeAt(0).commonAncestorContainer)) range = sel.getRangeAt(0).cloneRange();
      if (!range) { showToast('Select the words to link first, then press Link.'); return; }
    }
    linkCtx = { el: el, anchor: anchor, range: range, sections: sectionChoices() };
    var href = anchor ? (anchor.getAttribute('href') || '').trim() : '';
    var kind = linkKindOf(anchor);
    var hasLink = !!(anchor && (href || anchor.hasAttribute('data-register-cta')));
    linkPop.innerHTML =
      '<h4>Link</h4>' +
      '<span class="tpl-pop-now">' + escHtml(range ? 'Links the selected words.' : describeLink(anchor)) + '</span>' +
      '<label>Goes to<select data-link="kind">' +
        '<option value="web">A web address</option>' +
        '<option value="section">A section on this page</option>' +
        '<option value="email">An email address</option>' +
        '<option value="register">The registration form</option>' +
      '</select></label>' +
      '<label data-link-row="web">Web address<input type="text" data-link="web" placeholder="https://example.org/tickets" autocomplete="off" spellcheck="false"></label>' +
      '<label data-link-row="section">Section<select data-link="section">' +
        linkCtx.sections.map(function (c, i) { return '<option value="' + i + '">' + escHtml(c.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label data-link-row="email">Email address<input type="text" data-link="email" placeholder="name@example.org" autocomplete="off" spellcheck="false"></label>' +
      '<span class="tpl-pop-now" data-link-row="register">Visitors who click it get the registration form.</span>' +
      '<label class="tpl-pop-check" data-link-row="web"><input type="checkbox" data-link="newtab"> Open in a new tab</label>' +
      '<span class="tpl-pop-error" data-link="error" role="alert" hidden></span>' +
      '<div class="tpl-pop-acts">' +
        (hasLink ? '<button type="button" class="danger" data-link="remove">Remove link</button>' : '') +
        '<span class="grow"></span>' +
        '<button type="button" data-link="cancel">Cancel</button>' +
        '<button type="button" class="primary" data-link="apply">Apply</button>' +
      '</div>';
    var f = linkField;
    f('kind').value = kind;
    if (kind === 'web') f('web').value = href === '#' ? '' : href;
    if (kind === 'email') f('email').value = href.slice(7).split('?')[0];
    if (kind === 'section') {
      var target = canvas.doc.getElementById(href.slice(1));
      linkCtx.sections.forEach(function (c, i) { if (target && c.sec.contains(target)) f('section').value = String(i); });
    }
    f('newtab').checked = !!(anchor && anchor.getAttribute('target') === '_blank');
    syncLinkRows();
    linkPop.hidden = false;
    linkPop.style.visibility = '';
    positionToolbars();
    var first = kind === 'web' ? f('web') : kind === 'email' ? f('email') : f('kind');
    first.focus();
    if (first.select) first.select();
  }

  function linkField(name) { return linkPop.querySelector('[data-link="' + name + '"]'); }

  function syncLinkRows() {
    var kind = linkField('kind').value;
    Array.prototype.forEach.call(linkPop.querySelectorAll('[data-link-row]'), function (row) {
      row.hidden = row.getAttribute('data-link-row') !== kind;
    });
    linkError('');
  }

  function linkError(msg) {
    var box = linkField('error');
    if (!box) return;
    box.textContent = msg;
    box.hidden = !msg;
  }

  function closeLinkPop() {
    if (!linkPop || linkPop.hidden) return;
    linkPop.hidden = true;
    linkPop.innerHTML = '';
    linkCtx = null;
  }

  function positionLinkPop(selBox, fr) {
    linkPop.style.visibility = '';
    var w = linkPop.offsetWidth, h = linkPop.offsetHeight;
    var top = selBox.top + selBox.height + 6;
    if (top + h > fr.height - 4) top = Math.max(4, selBox.top - h - 6);
    place(linkPop, { left: Math.max(6, Math.min(selBox.left, fr.width - w - 6)), top: top });
  }

  function wireLinkPop() {
    linkPop.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-link') === 'kind') { syncLinkRows(); positionToolbars(); }
    });
    linkPop.addEventListener('input', function () { linkError(''); });
    linkPop.addEventListener('click', function (e) {
      var which = e.target.getAttribute('data-link');
      if (which === 'cancel') closeLinkPop();
      else if (which === 'apply') applyLink();
      else if (which === 'remove') removeLink();
    });
    linkPop.addEventListener('keydown', function (e) {
      e.stopPropagation();        // Escape here closes the pop-over only; the selection stays
      if (e.key === 'Escape') closeLinkPop();
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); applyLink(); }
    });
  }

  /* the destination the form describes: { href, register, newTab } or { error } */
  function readLinkForm() {
    var kind = linkField('kind').value;
    if (kind === 'register') return { href: '#register', register: true };
    if (kind === 'section') {
      var choice = linkCtx.sections[+linkField('section').value];
      if (!choice || !choice.sec.isConnected) return { error: 'That section is no longer on the page. Choose another.' };
      return { href: '#' + canvas.anchorFor(choice.sec) };
    }
    if (kind === 'email') {
      var mail = linkField('email').value.trim().replace(/^mailto:/i, '');
      if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(mail)) return { error: 'Enter an email address, like name@example.org.' };
      return { href: 'mailto:' + mail };
    }
    var res = normaliseLink(linkField('web').value);
    if (res.error) return res;
    return { href: res.href, newTab: linkField('newtab').checked && /^https?:/i.test(res.href) };
  }

  function writeLink(a, dest) {
    a.setAttribute('href', dest.href);
    if (dest.register) a.setAttribute('data-register-cta', ''); else a.removeAttribute('data-register-cta');
    if (dest.newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    else {
      a.removeAttribute('target');
      if (a.getAttribute('rel') === 'noopener') a.removeAttribute('rel');
    }
  }

  /* a button-like box that is not a link (the editor's own generic sections use a <span>) becomes one, keeping
     its classes, styles and content */
  function linkHost(el) {
    var a = canvas.doc.createElement('a');
    Array.prototype.forEach.call(el.attributes, function (at) { a.setAttribute(at.name, at.value); });
    while (el.firstChild) a.appendChild(el.firstChild);
    el.replaceWith(a);
    return a;
  }

  function unwrap(node) {
    while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
    node.remove();
  }

  function applyLink() {
    if (!linkCtx || !linkCtx.el.isConnected) { closeLinkPop(); return; }
    var dest = readLinkForm();
    if (dest.error) { linkError(dest.error); return; }
    var el = linkCtx.el, anchor = linkCtx.anchor, range = linkCtx.range;
    var reselect = el;
    if (anchor) {
      writeLink(anchor, dest);
    } else if (range) {
      var before = Array.prototype.slice.call(el.querySelectorAll('a'));
      // the browser only wraps a selection in a link inside an editable, focused element
      el.setAttribute('contenteditable', 'true');
      el.focus({ preventScroll: true });
      var sel = canvas.win.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      canvas.doc.execCommand('createLink', false, dest.href);
      sel.removeAllRanges();
      el.removeAttribute('contenteditable');
      var made = Array.prototype.filter.call(el.querySelectorAll('a'), function (a) { return before.indexOf(a) === -1; });
      if (!made.length) { linkError('Could not link those words. Select them again and retry.'); return; }
      // a selection that ran across an existing link leaves one link inside another, which is not valid
      Array.prototype.forEach.call(el.querySelectorAll('a a'), unwrap);
      made.filter(function (a) { return a.isConnected; }).forEach(function (a) { writeLink(a, dest); });
      canvas.retag(el);
    } else {
      reselect = linkHost(el);
      writeLink(reselect, dest);
    }
    clearAiGenerated(reselect);
    closeLinkPop();
    commitNow();
    if (reselect !== selectedEl) selectElement(reselect); else { buildToolbar(reselect); positionToolbars(); }
    showToast(dest.register ? 'It now opens the registration form.' : 'Link set to ' + dest.href);
  }

  function removeLink() {
    if (!linkCtx || !linkCtx.anchor || !linkCtx.anchor.isConnected) { closeLinkPop(); return; }
    var a = linkCtx.anchor;
    var holder = a.parentElement && a.parentElement.closest('[data-editable="text"]');
    clearAiGenerated(a);
    closeLinkPop();
    if (holder) {
      // a link inside a paragraph: the words stay, the link goes
      deselect();
      unwrap(a);
      holder.normalize();
      commitNow();
      selectElement(holder);
    } else {
      a.removeAttribute('href');
      a.removeAttribute('data-register-cta');
      a.removeAttribute('target');
      if (a.getAttribute('rel') === 'noopener') a.removeAttribute('rel');
      commitNow();
      buildToolbar(selectedEl);
      positionToolbars();
    }
    showToast('Link removed.');
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
    el.focus({ preventScroll: true });
  }

  function exitEdit(el) {
    el.removeAttribute('contenteditable');
    editingEl = null;
    var sel = canvas.win.getSelection();
    if (sel.rangeCount && el.contains(sel.anchorNode)) sel.removeAllRanges();
    clearTimeout(typingTimer); typingTimer = null;
    var changed = editingBeforeText !== null && el.textContent !== editingBeforeText;
    editingBeforeText = null;
    if (changed) clearAiGenerated(el);
    commitTyping();
    typingPtr = -1;       // the next text edited starts its own undo step
  }

  /* typed text is recorded while the caret is still in the element — waiting for it to leave loses whatever
     was typed last when the page is closed or reloaded */
  function onCanvasInput() {
    repositionToolbars();
    if (!editingEl) return;
    if (editingBeforeText !== null && editingEl.textContent !== editingBeforeText) clearAiGenerated(editingEl);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () { typingTimer = null; commitTyping(); }, 600);
  }

  /* ---------- section toolbar (move / add / duplicate / hide / delete) ---------- */
  function buildSecToolbar(sec) {
    var hidden = sec.classList.contains('is-hidden-sec');
    var html =
      '<button class="icon-only" data-action="move-up" title="Move this section up"' + (moveTarget(sec, -1) === undefined ? ' disabled' : '') + '>&#8593;</button>' +
      '<button class="icon-only" data-action="move-down" title="Move this section down"' + (moveTarget(sec, 1) === undefined ? ' disabled' : '') + '>&#8595;</button>' +
      '<span class="tpl-tb-sep"></span>';
    if (hidden) {
      html += '<button data-action="toggle-hide" title="Show this section on the site again">Show</button>';
    } else {
      html += '<button data-action="add-section" title="Add a section below this one">+ Section</button>' +
        (repeatItems(sec).length ? '<button data-action="add-item" title="Add another item to this section">+ Item</button>' : '') +
        (canvas.canRedesign(sec) ? '<button data-action="redesign-section" title="Have the AI design this section again, keeping its content">&#10024; Redesign with AI</button>' : '') +
        (canvas.backgroundHost(sec) ? '<button data-action="section-background" title="Change the picture behind this section">Background picture</button>' : '') +
        '<button data-action="duplicate-section" title="Duplicate section">Duplicate</button>' +
        '<button data-action="toggle-hide" title="Keep this section but leave it off the site">Hide</button>';
    }
    html += '<button class="icon-only" data-action="dev-section" title="Developer zone: this section’s HTML, CSS and JS" aria-label="Developer zone">&lt;/&gt;</button>';
    html += '<button class="danger" data-action="delete-section" title="Delete section">Delete</button>';
    secToolbar.innerHTML = html;
  }

  function isLive(sec) { return !!(canvas && !remounting && sec && sec.isConnected && sec.ownerDocument === canvas.doc); }

  function setSectionHidden(sec, hide) {
    if (editingEl) exitEdit(editingEl);
    if (hide && selectedEl && sec.contains(selectedEl)) clearElementSelection();
    canvas.setHidden(sec, hide);
    commitNow();
    if (activeSectionEl === sec) { buildSecToolbar(sec); positionToolbars(); }
  }

  /* where one step up or down takes a section: the section it lands in front of (null: the end of the page), or
     undefined when it cannot go that way — it is first or last, it is pinned, or a pinned section is in the way */
  function moveTarget(sec, dir) {
    var secs = canvas.sections(), i = secs.indexOf(sec);
    if (i === -1 || (dir < 0 && i === 0)) return undefined;
    var before = dir < 0 ? secs[i - 1] : (secs[i + 2] || null);
    return canvas.canMoveSection(sec, before) ? before : undefined;
  }

  function moveSectionBefore(sec, before) {
    if (editingEl) exitEdit(editingEl);
    if (!canvas.moveSection(sec, before)) return false;
    commitNow();
    if (activeSectionEl === sec) buildSecToolbar(sec);
    canvas.scrollToSection(sec);
    positionToolbars();
    return true;
  }

  function duplicateSection(sec) {
    if (!isLive(sec)) return null;
    if (editingEl) exitEdit(editingEl);
    var copy = canvas.duplicateSection(sec, (sec.getAttribute('data-sec-name') || 'Section') + ' copy');
    commitNow();
    selectSectionOnly(copy);
    canvas.scrollToSection(copy);
    return copy;
  }

  function onSecToolbarClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || !activeSectionEl) return;
    var action = btn.getAttribute('data-action'), sec = activeSectionEl;
    if (action === 'duplicate-section') {
      duplicateSection(sec);
    } else if (action === 'toggle-hide') {
      setSectionHidden(sec, !sec.classList.contains('is-hidden-sec'));
    } else if (action === 'delete-section') {
      confirmDeleteSection(sec);
    } else if (action === 'add-section') {
      host.pickSection(sec);
    } else if (action === 'add-item') {
      selectNewItem(addRepeatItem(sec));
    } else if (action === 'dev-section') {
      openDevZone(sec);
    } else if (action === 'redesign-section') {
      openRedesignDialog(sec);
    } else if (action === 'section-background') {
      var bgEl = canvas.backgroundHost(sec);
      if (bgEl) openPictureDialog('Background picture', canvas.backgroundOf(bgEl), function (url) {
        if (!bgEl.isConnected) return;
        canvas.setBackgroundPicture(bgEl, url); commitNow();
      });
    } else if (action === 'move-up' || action === 'move-down') {
      var before = moveTarget(sec, action === 'move-up' ? -1 : 1);
      if (before !== undefined) moveSectionBefore(sec, before);
    }
  }

  function confirmDeleteSection(sec) {
    var name = sec.getAttribute('data-sec-name') || 'this section';
    var actions = [
      { label: 'Cancel', kind: 'secondary', autofocus: true },
      { label: 'Delete', kind: 'danger', onClick: function () {
        if (!sec.isConnected) return;
        deselect();
        var autoKind = sec.getAttribute('data-rv-auto');
        canvas.removeSection(sec);
        if (autoKind && !canvas.doc.querySelector('[data-rv-auto="' + autoKind + '"]')) {
          // taken away on purpose: the records of this kind do not bring the section back (ensureAutoSections)
          var off = canvas.doc.createElement('template');
          off.setAttribute('data-rv-auto-off', autoKind);
          canvas.contentRoot().appendChild(off);
        }
        commitNow();
        offerUndo('"' + name + '" deleted.');
      } }
    ];
    if (!sec.classList.contains('is-hidden-sec')) {
      actions.unshift({ label: 'Hide instead', kind: 'ghost', aside: true, onClick: function () {
        if (!sec.isConnected) return;
        setSectionHidden(sec, true);
        offerUndo('"' + name + '" is hidden. It is not shown on the site.');
      } });
    }
    host.openDialog({
      title: 'Delete "' + name + '"?',
      bodyHtml: '<p>Its text and pictures are removed from the site. You can undo this until you leave the editor.</p>',
      actions: actions
    });
  }

  /* ---------- sections, for the page's side panels ----------
     The Layers panel, the section picker and the Add panel in custom_editor.html work on the site through these;
     each one goes the same way as its button on the section pill. */
  function boundSource(type, html) {
    var map = (canvas.template.content || {}).map || [];
    if (map.some(function (m) { return m.section === type && SUBCOLLECTION_SOURCES[m.from]; })) return true;
    var m = /data-rv-repeat-template="([^"]+)"/.exec(html || '');
    return !!(m && GENERIC_REPEAT_SOURCES[m[1]]);
  }

  function listSections() {
    if (!canvas || remounting) return [];
    return canvas.sections().map(function (sec) {
      var type = sec.getAttribute('data-rv-section');
      var marker = sec.querySelector('[data-rv-repeat-template]');
      return {
        el: sec, key: sec.getAttribute('data-rv-key'), type: type,
        name: sec.getAttribute('data-sec-name') || type,
        hidden: sec.classList.contains('is-hidden-sec'),
        pinned: !!canvas.pinned(sec),
        canMoveUp: moveTarget(sec, -1) !== undefined, canMoveDown: moveTarget(sec, 1) !== undefined,
        bound: boundSource(type, marker ? marker.outerHTML : ''),      // fed from the event's Content tabs
        current: sec === activeSectionEl
      };
    });
  }

  /* The site's own sections that can be put on the page again. An imported page is one section holding the whole
     design, which is not something to add twice. A section fed from the Content tabs that is already on the page
     is marked onPage: a second one could only show the same records again. */
  function librarySections() {
    if (!canvas || remounting || /^imported-/.test(templateId || '')) return [];
    var onPage = {};
    canvas.sections().forEach(function (sec) { onPage[sec.getAttribute('data-rv-section')] = 1; });
    return canvas.library().map(function (it) {
      return { id: it.id, name: it.name, snippet: it.snippet, onPage: !!onPage[it.id] && boundSource(it.id, it.html) };
    });
  }

  function selectSection(sec) {
    if (!isLive(sec)) return;
    selectSectionOnly(sec);
    canvas.scrollToSection(sec);
  }

  // toIndex: the place the section should have in listSections() once it has moved
  function moveSection(sec, toIndex) {
    if (!isLive(sec)) return false;
    var others = canvas.sections().filter(function (s) { return s !== sec; });
    return moveSectionBefore(sec, others[toIndex] || null);
  }

  function setHidden(sec, hide) {
    if (!isLive(sec) || sec.classList.contains('is-hidden-sec') === !!hide) return;
    setSectionHidden(sec, !!hide);
  }

  function deleteSection(sec) { if (isLive(sec)) confirmDeleteSection(sec); }

  function renameSection(sec, name) {
    name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!isLive(sec) || !name || name === sec.getAttribute('data-sec-name')) return false;
    sec.setAttribute('data-sec-name', name);
    commitNow();
    return true;
  }

  /* spec: { libraryId } — one of the site's own sections — or { name, html } — one of the editor's generic
     designs. Goes after afterEl, else after the active section, else at the end of the page. */
  function insertSection(spec, afterEl) {
    if (!canvas || remounting || !spec) return null;
    if (editingEl) exitEdit(editingEl);
    var el, name;
    if (spec.libraryId) {
      var item = canvas.library().filter(function (it) { return it.id === spec.libraryId; })[0];
      if (!item) { showToast('That section is not part of this site’s design, so it could not be added.', { kind: 'error' }); return null; }
      el = canvas.createLibrarySection(item.id);
      name = item.name;
    } else {
      /* A design for something the event keeps records of (speakers, agenda, partners…) is added as the
         section that shows those records, unless the page has one already: a sample with invented people
         in it would stay blank of the event's own. */
      var recordKind = /^imported-/.test(canvas.template.id || '') ? '' : kindForName(spec.name);
      if (recordKind && !canvas.doc.querySelector('[data-rv-repeat-template="' + recordKind + '"], [data-rv-auto="' + recordKind + '"]')) {
        Array.prototype.forEach.call(canvas.doc.querySelectorAll('template[data-rv-auto-off="' + recordKind + '"]'), function (t) { t.remove(); });
        el = createAutoSection(recordKind);
        name = AUTO_SECTIONS[recordKind].name;
        canvas.insertSection(el, isLive(afterEl) ? afterEl : activeSectionEl);
        canvas.retag(el);
        commitNow();
        selectSectionOnly(el);
        canvas.scrollToSection(el);
        showToast('Added "' + name + '". It shows what is entered under Content.');
        drawRecords(false);
        return el;
      }
      el = canvas.createGenericSection(spec.name, spec.html, restoreOpts().siteCss);
      name = spec.name;
    }
    canvas.insertSection(el, isLive(afterEl) ? afterEl : activeSectionEl);
    commitNow();
    selectSectionOnly(el);
    canvas.scrollToSection(el);
    showToast('Added "' + name + '".');
    return el;
  }

  /* ---------- Add elements (heading / text / button / image / divider / spacer) ----------
     A block is a plain element of the page with the editor's marker and a neutral class; its CSS is the canvas's
     (ensureBlockStyle). It goes right after the selected element, or at the end of the active section's content
     when only a section is selected. */
  var BLOCKS = {
    heading: { tag: 'h3', cls: 'rv-block-heading', kind: 'text', text: 'New heading', name: 'heading' },
    text: { tag: 'p', cls: 'rv-block-text', kind: 'text', text: 'Write your text here.', name: 'text' },
    button: { tag: 'a', cls: 'rv-block-button', kind: 'button', text: 'Button', name: 'button' },
    image: { tag: 'img', cls: 'rv-block-image', kind: 'image', name: 'image' },
    divider: { tag: 'hr', cls: 'rv-block-divider', kind: 'block', name: 'divider' },
    spacer: { tag: 'div', cls: 'rv-block-spacer', kind: 'block', name: 'spacer' }
  };

  /* the element a new block follows: the selected one — as a whole, when it sits inside another editable element
     or inside a link or button */
  function blockAnchor(sec) {
    if (!selectedEl || !selectedEl.isConnected || !sec.contains(selectedEl) || selectedEl === sec) return null;
    var at = selectedEl, up;
    while ((up = at.parentElement && at.parentElement.closest('[data-editable], a, button, summary')) && up !== sec && sec.contains(up)) at = up;
    return at;
  }
  // where a section's content sits: inside the wrappers that hold nothing else (container > row > column …)
  function contentBox(sec) {
    var box = sec;
    for (;;) {
      var kids = Array.prototype.filter.call(box.children, function (c) { return c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT' && !/^ai-.*-badge$/.test(c.className); });
      if (kids.length !== 1 || kids[0].hasAttribute('data-editable') || !/^(DIV|SECTION|ARTICLE|MAIN)$/.test(kids[0].tagName)) return box;
      box = kids[0];
    }
  }

  function addBlock(kind) {
    var spec = BLOCKS[kind];
    if (!canvas || remounting || !spec) return null;
    var sec = activeSectionEl;
    if (!sec || !sec.isConnected) { showToast('Click a section first, then choose what to add to it.'); return null; }
    if (sec.classList.contains('is-hidden-sec')) { showToast('This section is hidden. Show it first, then add to it.'); return null; }
    var src = '';
    if (kind === 'image') {
      src = (prompt('Image URL', 'https://') || '').trim();
      if (!src || src === 'https://') return null;
      if (!/^https?:\/\/[^\s"<>]+$/i.test(src)) { showToast('That is not a picture’s web address. It should start with https://', { kind: 'error' }); return null; }
    }
    if (editingEl) exitEdit(editingEl);
    var node = canvas.doc.createElement(spec.tag);
    node.className = spec.cls;
    node.setAttribute('data-editable', spec.kind);
    if (spec.text) node.textContent = spec.text;
    if (kind === 'button') node.setAttribute('href', '#');
    if (kind === 'image') { node.setAttribute('src', src); node.setAttribute('alt', ''); }
    var anchor = blockAnchor(sec);
    if (anchor) anchor.after(node); else contentBox(sec).appendChild(node);
    canvas.ensureBlockStyle();
    clearAiGenerated(node);
    commitNow();
    selectElement(node);
    node.scrollIntoView({ block: 'nearest' });
    repositionToolbars();
    showToast('Added ' + (/^[aeiou]/.test(spec.name) ? 'an ' : 'a ') + spec.name + '.');
    return node;
  }

  /* ---------- repeat items (template.json -> sections[].repeat) ----------
     repeat: { item, label } — the selector of one repeated item (a card, a tile, a question) inside the section,
     and of the element in it that names it. The item selectors of some templates start from an id inside the
     section ("#stats-4 .stats-box > section"); a copy of the section has that id renamed, and inside one section
     the id says nothing the rest of the selector does not, so it is read as "any element". */
  function repeatConfigFor(sec) {
    var id = sec.getAttribute('data-rv-section');
    var s = canvas.template.sections.filter(function (x) { return x.id === id; })[0];
    return s && s.repeat;
  }
  function itemSelector(cfg) {
    return cfg.item.replace(/(^|[\s>+~,])#[\w-]+(?=$|[\s>+~,])/g, '$1*');
  }
  function repeatItems(sec) {
    var cfg = sec && repeatConfigFor(sec);
    return cfg && cfg.item ? Array.prototype.slice.call(sec.querySelectorAll(itemSelector(cfg))) : [];
  }
  function repeatItemOf(el) {
    var sec = el.closest('[data-rv-section]'), cfg = sec && repeatConfigFor(sec);
    if (!cfg || !cfg.item) return looseItemOf(el);
    var item = el.closest(itemSelector(cfg));
    return item && item !== sec && sec.contains(item) ? item : null;
  }

  /* A design that names no repeated items (an AI-designed or imported site) still has them: the slides of a
     carousel, the cards of a grid, the points of a list. Such an item is what the selection is in when that
     has brothers built the same way (same tag, same classes) — the slide itself inside a carousel. Items
     that show the event's records (speakers, partners…) are not these: they are managed in Content. */
  var EDITOR_CLASSES = /(^|\s)(ed-selected|sec-active|rv-in|rv-shown)(?=\s|$)/g;
  function builtLike(n) { return n.tagName + '|' + (n.getAttribute('class') || '').replace(EDITOR_CLASSES, ' ').replace(/\s+/g, ' ').trim(); }
  function brothers(n) {
    var like = builtLike(n);
    return Array.prototype.filter.call(n.parentNode.children, function (c) { return builtLike(c) === like; });
  }
  function looseItemOf(el) {
    var sec = el.closest('[data-rv-section]');
    if (!sec || el.closest('[data-rv-repeat-template], [data-rv-bound], [data-rv-auto], header, nav')) return null;
    var slide = el.closest('[data-rv-carousel-track] > *');
    if (slide && sec.contains(slide)) return slide;
    for (var n = el; n && n !== sec && n.parentElement; n = n.parentElement) {
      if (/^(SPAN|A|B|I|EM|STRONG|SMALL|IMG|BR|svg|path)$/i.test(n.tagName)) continue;
      if (canvas.win.getComputedStyle(n).display === 'inline') continue;
      if (brothers(n).length >= 2 && (n.hasAttribute('data-editable') || n.querySelector('[data-editable]'))) return n;
    }
    return null;
  }
  /* the items an item stands among, in order */
  function groupOf(sec, item) {
    var cfg = repeatConfigFor(sec);
    if (cfg && cfg.item) return repeatItems(sec);
    if (!item || !item.parentNode) return [];
    return item.parentNode.hasAttribute('data-rv-carousel-track') ? Array.prototype.slice.call(item.parentNode.children) : brothers(item);
  }

  // the item the selection is in carries an editor-only mark, so it can be outlined (editor-canvas.css)
  var currentItem = null;
  function markCurrentItem(item) {
    if (currentItem && currentItem !== item) currentItem.removeAttribute('data-rv-cur-item');
    currentItem = item || null;
    if (currentItem) currentItem.setAttribute('data-rv-cur-item', '');
  }

  /* A copy of `item` right after it; without one, of the section's last item. Returns the new item. */
  function addRepeatItem(sec, item) {
    var items = item ? groupOf(sec, item) : repeatItems(sec);
    if (!items.length) return null;
    var from = item && items.indexOf(item) !== -1 ? item : items[items.length - 1];
    var clone = canvas.copyOf(from);
    from.after(clone);
    canvas.adoptElement(clone);
    canvas.retag(clone);
    clearAiGenerated(sec);
    commitNow();
    return clone;
  }

  function removeRepeatItem(sec, item) {
    var items = groupOf(sec, item);
    if (items.indexOf(item) === -1) return false;
    if (items.length <= 1) { showToast('At least one item is required'); return false; }
    item.remove();
    clearAiGenerated(sec);
    commitNow();
    return true;
  }

  function moveRepeatItem(sec, item, dir) {
    var items = groupOf(sec, item), i = items.indexOf(item), other = items[i + dir];
    if (i === -1 || !other) return false;
    if (dir < 0) other.parentNode.insertBefore(item, other); else other.after(item);
    clearAiGenerated(sec);
    commitNow();
    return true;
  }

  // the new item's own label is what the owner will want to type over
  function selectNewItem(item) {
    if (!item) return;
    var cfg = repeatConfigFor(item.closest('[data-rv-section]')) || {};
    var label = cfg.label && (item.matches(cfg.label) ? item : item.querySelector(cfg.label));
    var pick = label && label.hasAttribute('data-editable') ? label
      : item.hasAttribute('data-editable') ? item : item.querySelector('[data-editable]');
    if (!pick) return;
    selectElement(pick);
    pick.scrollIntoView({ block: 'nearest' });
    repositionToolbars();
  }

  function onItemAction(what, el) {
    var sec = el.closest('[data-rv-section]'), item = repeatItemOf(el);
    if (!item) return;
    if (editingEl) exitEdit(editingEl);
    if (what === 'add') {
      selectNewItem(addRepeatItem(sec, item));
    } else if (what === 'remove') {
      deselect();
      if (removeRepeatItem(sec, item)) offerUndo('Item removed.');
    } else if (what === 'earlier' || what === 'later') {
      if (!moveRepeatItem(sec, item, what === 'earlier' ? -1 : 1)) return;
      buildToolbar(el);
      el.scrollIntoView({ block: 'nearest' });
      positionToolbars();
    }
  }

  /* ---------- canvas (iframe document) event wiring ----------
     Runs again for every canvas the editor mounts (see recoverCanvas). The click listener is in the capture
     phase and ends the event there: a click on the canvas selects and edits, it never also runs the site's own
     click scripts (an accordion's script would open the item for good — the editor opens items itself, see
     canvas.openItem) or follows a link. Placing the caret in a text is done on mousedown, so typing is not
     affected. */
  function wireCanvasEvents() {
    canvas.doc.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      // a click with no mouse behind it is the browser "pressing" a <button> or link for Space / Enter typed
      // into its label (an FAQ question is a <button>): that is typing, not picking something else
      if (editingEl && e.detail === 0) return;
      var target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      if (!target) return;
      if (canvas.openItem(target)) { repositionToolbars(); return; }
      var editable = target.closest('[data-editable]');
      if (editable) {
        selectElement(editable);
        /* text/button content starts typing immediately on the one click that selected it — no separate
           double-click step. An image has no in-place "edit" (its toolbar is Replace/Alt text), so a click
           there only selects, same as before. */
        var type = editable.getAttribute('data-editable');
        if ((type === 'text' || type === 'button') && editingEl !== editable) enterEdit(editable);
        return;
      }
      var sec = target.closest('[data-rv-section]');
      if (sec) { selectSectionOnly(sec); return; }
      deselect();
    }, true);
    // a link or a picture dragged out of the canvas would be dropped somewhere as a link to follow
    canvas.doc.addEventListener('dragstart', function (e) {
      var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      if (t && t.closest('a, img')) e.preventDefault();
    }, true);
    // Enter / Space on a focused link or button would activate it; inside a text being edited they are typing
    canvas.doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      if (!t || t.closest('[contenteditable="true"]')) return;
      if (t.closest('a, button, summary, [role="button"]')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    canvas.doc.addEventListener('blur', function (e) {
      if (e.target === editingEl) exitEdit(e.target);
    }, true);
    canvas.doc.addEventListener('input', onCanvasInput, true);
    canvas.win.addEventListener('scroll', repositionToolbars, { passive: true });
    canvas.win.addEventListener('keydown', onGlobalKey);
    if (canvas.onResize === null) canvas.onResize = repositionToolbars;
    canvas.onNavigate = recoverCanvas;
  }

  /* The canvas has loaded some other document (a script on the page set location; links and forms are already
     stopped by RevampCanvas). That iframe is no longer the site, so it is replaced by a fresh mount of the
     template with the last recorded state put back. */
  function recoverCanvas() {
    if (remounting) return;
    remounting = true;
    clearTimeout(commitTimer); commitTimer = null;
    clearTimeout(typingTimer); typingTimer = null;
    editingEl = null; editingBeforeText = null; typingPtr = -1;
    selectedEl = null; activeSectionEl = null; currentItem = null;
    if (selWatch) selWatch.disconnect();
    closeLinkPop();
    selToolbar.hidden = true; secToolbar.hidden = true;
    selectionChanged();
    canvas.destroy();
    RevampCanvas.mount(frame, templateId, mountOpts).then(function (c) {
      canvas = c;
      canvas.restore(undoStack[undoPtr], restoreOpts());
      canvas.setDevice(deviceName);
      setAiMarkers(aiMarkersOn);
      wireCanvasEvents();
      remounting = false;
      sectionsChanged();
      designChanged();
      showNotice('canvas-restored', { kind: 'info', dismissible: true, text: 'The page tried to open a link. Your work is restored.' });
    }).catch(function (err) {
      if (window.console) console.error(err);
      showNotice('canvas-restored', {
        kind: 'error',
        text: 'The page left the editor and could not be put back. Reload to carry on from your last change.',
        actions: [{ label: 'Reload', onClick: function () { location.reload(); } }]
      });
    });
  }

  function onGlobalKey(e) {
    if (e.key === 'Escape') { deselect(); return; }
    var mod = e.ctrlKey || e.metaKey;
    if (!mod || editingEl) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
  }
  function wireGlobalKeys() {
    document.addEventListener('keydown', onGlobalKey);
  }

  /* Leaving by any road — a link, the back button, reload, closing the tab, switching away on a phone —
     records what is still pending first. */
  function wireLeaving() {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  }

  /* ---------- design: the Design panel and the style toolbar (custom_editor.html) ----------
     Both read and write the site's design through these, never the page around the canvas. A setting the site
     has nothing for (a theme colour on a design whose colours are fixed, corners where there are no buttons or
     cards) is refused with the reason, so nothing reports a change that did not happen. */
  var NOTHING_TO_CHANGE = {
    themeColor: 'This design uses fixed colors, so there is no site-wide theme color to change. Select a text and use “Selected text” to change its color.',
    textColor: 'This design sets the color of each text itself. Select a text and use “Selected text” to change its color.',
    bodyFont: 'This design sets the font of each text itself. Select a text and use “Selected text” to change its font.',
    sectionSpacing: 'This design sets the space between its sections itself, so this setting has nothing to change.',
    radius: 'This design has no buttons or cards for the corner setting to round.',
    bgColor: 'This design gives each section its own fixed background, so there is no page background to change. Ask in Chat to recolor a section.',
    bgImage: 'Each section of this design has its own background. To change a section’s picture, select the section and use “Background picture”.',
    bgOpacity: 'Each section of this design has its own background, so there is no page picture to fade.',
    reveals: 'This design has no scroll effects to switch off.'
  };
  var DESIGN_KEYS = ['themeColor', 'textColor', 'bgColor', 'bgImage', 'bgOpacity', 'bodyFont', 'bodySize', 'bodyWeight',
    'sectionSpacing', 'divider', 'animation', 'headingFont', 'headingSize', 'headingWeight', 'headingColor',
    'headingCase', 'headingAlign', 'radius', 'motion', 'reveals'];
  function unsupportedReason(key) {
    if (!canvas) return 'The site has not finished loading.';
    if (canvas.design.supports(key)) return '';
    return NOTHING_TO_CHANGE[key] || (/^heading/.test(key) ? 'This page has no headings for this setting to change.' : 'This setting has nothing to change on this design.');
  }

  function getDesign(key) {
    if (!canvas) return '';
    return key === 'headingColorShown' ? canvas.design.headingColorShown() : canvas.design.get(key);
  }

  function designOptions() {
    var unsupported = {};
    if (!canvas) return { swatches: [], fonts: [], unsupported: unsupported };
    DESIGN_KEYS.forEach(function (key) { var why = unsupportedReason(key); if (why) unsupported[key] = why; });
    return { swatches: canvas.design.swatches(), fonts: fontChoices(), unsupported: unsupported };
  }

  /* A font is given as its whole CSS stack (designOptions().fonts[].stack). Controls that fire continuously
     (a slider, a colour being dragged) make one undo step once they have been still for a moment. */
  /* The Economic Times Business Verticals logo in the nav and the footer (data-rv-et-logo) is the version for
     the colour it stands on: the one drawn for a dark background on a dark bar, else the one for a light
     one. Kept in step whenever the look changes, so a site switched to dark gets the light-ink logo. */
  var ET_LOGO_FILES = { dark: '/templates/_shared/img/et-business-verticals-on-dark.svg', light: '/templates/_shared/img/et-business-verticals-on-light.svg' };
  function groundOf(el) {
    var w = canvas.win;
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = w.getComputedStyle(e).backgroundColor, m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c || '');
      if (m && (m[4] == null || +m[4] > 0.5)) return [+m[1], +m[2], +m[3]];
    }
    return [255, 255, 255];
  }
  function syncEtLogos() {
    if (!canvas || !canvas.doc) return false;
    var changed = false;
    /* An AI-designed site built before the bars carried the ET logo has the event's own logo there: it
       becomes the ET logo, in the same place (a white chip it sat on goes with it). Only the nav and the
       footer, and only on a generated site — a ported template keeps its own header. */
    if (/^gen-/.test(String(templateId || ''))) {
      Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-section="nav"] img[data-rv-logo], [data-rv-section="footer"] img[data-rv-logo]'), function (img) {
        var inFooter = !!img.closest('[data-rv-section="footer"]');
        img.removeAttribute('data-rv-logo');
        img.setAttribute('data-rv-et-logo', '');
        img.setAttribute('alt', 'The Economic Times Business Verticals');
        img.style.height = inFooter ? '24px' : '28px'; img.style.width = 'auto'; img.style.maxWidth = '100%';
        /* the plate the event's logo sat on (a white chip, set inline or by the page's CSS on the picture or
           the one or two boxes around it) is not wanted under the ET logo */
        for (var k = 0, holder = img; k < 3 && holder && !holder.hasAttribute('data-rv-section'); k++, holder = holder.parentElement) {
          var c = canvas.win.getComputedStyle(holder).backgroundColor, m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c || '');
          if (m && (m[4] == null || +m[4] > 0.5) && (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.85) {
            ['background', 'box-shadow', 'border'].forEach(function (prop) { holder.style.setProperty(prop, 'none', 'important'); });
            holder.style.setProperty('padding', '0', 'important');
          }
        }
        changed = true;
      });
    }
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('img[data-rv-et-logo]'), function (img) {
      var g = groundOf(img), lum = (0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]) / 255;
      /* the ET event bar's logo (functions/lib/et-nav.js) names its own two versions — the event's portal's
         wordmark, or this one — and has its own size */
      var own = img.getAttribute(lum < 0.45 ? 'data-rv-on-dark' : 'data-rv-on-light');
      var want = own || ET_LOGO_FILES[lum < 0.45 ? 'dark' : 'light'];
      if (img.getAttribute('src') !== want) { img.setAttribute('src', want); changed = true; }
      if (own) return;
      /* one size: 28 px tall in the nav, 24 px in the footer (the logo is wide; any taller crowds the bar) */
      var h = img.closest('[data-rv-section="footer"]') ? '24px' : '28px';
      if (img.style.height !== h) { img.style.height = h; img.style.width = 'auto'; changed = true; }
    });
    /* The portal's wordmark in ET's common footer (functions/lib/et-footer.js) names its two inks: the one for
       the colour behind it is shown. A picture the owner put in its place is left alone. */
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('img[data-rv-portal-logo]'), function (img) {
      var onLight = img.getAttribute('data-rv-on-light'), onDark = img.getAttribute('data-rv-on-dark'), src = img.getAttribute('src');
      if (!onLight || !onDark || (src !== onLight && src !== onDark)) return;
      var g = groundOf(img), want = (0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]) / 255 < 0.45 ? onDark : onLight;
      if (src !== want) { img.setAttribute('src', want); changed = true; }
    });
    if (/^gen-/.test(String(templateId || '')) && trimNav()) changed = true;
    if (oneRowNav()) changed = true;
    return changed;
  }

  /* The nav is one row: the ET logo on the left, the links and the button on the right. A bar laid out with
     the logo on a row of its own above the links is put on one row — the box holding both becomes a row,
     the logo keeps its size and the links take the rest, scrolling sideways when there is no room. */
  /* At most five section links in the nav besides its button (the same rule a new site is built with,
     functions/lib/gen-design.js capNavLinks): the gallery, FAQs, "about" and who-should-attend entries go
     first. Only the entries: the sections stay on the page. */
  var NAV_DROP = [/glimps|gallery|photo/i, /faq/i, /about/i, /who|audience/i, /partner|sponsor/i, /why|join/i];
  /* The ET event bar (functions/lib/et-nav.js, data-rv-etnav) is left as it is by both: it carries a link to
     every section, the live page puts the ones that do not fit under "More", and its two rows are its design. */
  function isEtNav(nav) { return !!(nav && (nav.hasAttribute('data-rv-etnav') || nav.querySelector('[data-rv-etnav]'))); }
  function trimNav() {
    var nav = canvas.doc.querySelector('[data-rv-section="nav"]');
    if (!nav || isEtNav(nav)) return false;
    var links = Array.prototype.filter.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
      var href = a.getAttribute('href').slice(1), text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      return href && href !== 'hero' && href !== 'top' && !a.querySelector('img') && !a.hasAttribute('data-register-cta') &&
        !/\b(btn|button|cta)\b/i.test(a.className || '') && !/^(register|book|request|apply|nominate|buy)/i.test(text);
    });
    var drop = [];
    for (var r = 0; r < NAV_DROP.length && links.length - drop.length > 5; r++) {
      links.forEach(function (a) { if (links.length - drop.length > 5 && drop.indexOf(a) === -1 && NAV_DROP[r].test(a.getAttribute('href') + ' ' + a.textContent)) drop.push(a); });
    }
    while (links.length - drop.length > 5) drop.push(links.filter(function (a) { return drop.indexOf(a) === -1; }).pop());
    drop.forEach(function (a) { var li = a.parentElement && a.parentElement.tagName === 'LI' && a.parentElement.children.length === 1 ? a.parentElement : a; li.remove(); });
    return drop.length > 0;
  }

  function oneRowNav() {
    var nav = canvas.doc.querySelector('[data-rv-section="nav"]');
    var img = nav && !isEtNav(nav) && nav.querySelector('img[data-rv-et-logo]');
    if (!img) return false;
    var logo = img.closest('a') || img;
    var links = Array.prototype.filter.call(nav.querySelectorAll('a, button'), function (a) { return !a.contains(img) && a.offsetWidth > 0; });
    if (!links.length) return false;
    /* a link or the button never breaks inside itself */
    var fixed = false;
    links.forEach(function (a) { if (canvas.win.getComputedStyle(a).whiteSpace !== 'nowrap') { a.style.whiteSpace = 'nowrap'; fixed = true; } });
    var lr = logo.getBoundingClientRect(), first = links[0].getBoundingClientRect();
    if (first.top < lr.bottom - 4) return fixed;                       // already beside it
    /* the nearest box holding the logo and the links */
    var box = logo.parentElement;
    while (box && box !== nav && !links.every(function (a) { return box.contains(a); })) box = box.parentElement;
    if (!box) return false;
    var kids = Array.prototype.filter.call(box.children, function (c) { return c.contains(logo) || links.some(function (a) { return c.contains(a); }); });
    box.style.display = 'flex'; box.style.flexDirection = 'row'; box.style.flexWrap = 'nowrap';
    box.style.alignItems = 'center'; box.style.justifyContent = 'space-between'; box.style.gap = '24px';
    kids.forEach(function (c) {
      if (c.contains(logo)) { c.style.flex = '0 0 auto'; c.style.margin = '0'; }
      else {
        c.style.flex = '1 1 auto'; c.style.minWidth = '0'; c.style.margin = '0'; c.style.overflowX = 'auto';
        if (canvas.win.getComputedStyle(c).display === 'flex') {
          c.style.justifyContent = 'flex-end'; c.style.flexWrap = 'nowrap';
          if (parseFloat(canvas.win.getComputedStyle(c).columnGap) > 18) c.style.gap = '18px';
        }
      }
    });
    return true;
  }

  /* An AI-designed site saved before its section headings were calmed keeps their old sizes in the page it
     saved: they are brought to the site's type scale (templates/_shared/rv-type.js — the same rule the server
     applies to a section when it is made and when it is served), in every section but the hero, which keeps
     its own type. Stat numerals, eyebrows and body text are left as they are. -> true when anything changed */
  function calmHeadings() {
    if (!canvas || !canvas.doc || !window.RevampType || !/^gen-/.test(String(templateId || ''))) return false;
    var headings = {}, changed = false;
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('h1[class], h2[class], h3[class], h4[class], h5[class], h6[class]'), function (h) {
      var level = +h.tagName.charAt(1);
      Array.prototype.forEach.call(h.classList, function (c) { if (!headings[c] || level < headings[c]) headings[c] = level; });
    });
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('style[data-rv-style]'), function (st) {
      if (st.getAttribute('data-rv-style') === 'hero') return;
      var css = window.RevampType.capHeadingSizes(st.textContent, headings);
      if (css !== st.textContent) { st.textContent = css; changed = true; }
    });
    return changed;
  }

  /* ---------- themes (an AI-designed site; templates/_shared/rv-theme.js) ----------
     The site's themes come with its template (the original design, its opposite mode, a third format). Applying
     one: the colours a section wrote as fixed values become the page's variables (the hero keeps its own tone),
     the theme's variables go on <body>, the ET logo takes the version for its ground — one undoable step — and
     the choice is kept for the site, so it opens in it next time. */
  function themesInfo() {
    var list = canvas && canvas.template && canvas.template.themes;
    if (!list || !list.length || !window.RevampTheme) return null;
    return { themes: list, current: canvas.doc.body.getAttribute('data-rv-theme') || canvas.template.themeId || 'original' };
  }
  function applyTheme(id, quiet) {
    var info = themesInfo();
    if (!info || remounting) return false;
    var t = info.themes.filter(function (x) { return x.id === id; })[0];
    if (!t) return false;
    var o = info.themes[0].colours;
    var base = { mode: info.themes[0].mode, themeColor: o.theme, accentColor: o.accent, backgroundColor: o.bg, surfaceColor: o.surface, textColor: o.text, mutedColor: o.muted };
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('style[data-rv-style]'), function (st) {
      if (st.getAttribute('data-rv-style') === 'hero') return;
      var css = window.RevampTheme.themableCss(st.textContent, base);
      if (css !== st.textContent) st.textContent = css;
    });
    window.RevampTheme.apply(canvas.doc, t);
    syncEtLogos();
    commit();
    designChanged();
    if (eventId && window.RevampAuth) {
      RevampAuth.authedFetch('/api/event/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: eventId, themeId: id }) }).catch(function () {});
    }
    if (!quiet) showToast('“' + t.label + '” applied to the whole site. Save to keep it, and publish to put it live.');
    return true;
  }

  function setDesign(key, value) {
    if (!canvas || remounting) return false;
    var why = unsupportedReason(key);
    if (why) { showToast(why, { kind: 'error' }); return false; }
    if (!canvas.design.set(key, value)) {
      // tried, and nothing on the page looked different: the control is put away with the reason
      designChanged();
      showToast(unsupportedReason(key), { kind: 'error' });
      return false;
    }
    syncEtLogos();
    commit();
    designChanged();
    return true;
  }

  /* A picture given by its address is only used once it has been seen to load. Embedded pictures (data:) are
     refused: they would be saved inside the page. */
  function checkImageUrl(raw) {
    var url = String(raw == null ? '' : raw).trim();
    if (/^data:/i.test(url)) return Promise.resolve({ error: 'Paste the web address of a picture that is already online (https://…), not the picture itself.' });
    if (/^\/\//.test(url)) url = 'https:' + url;
    if (!/^https?:\/\/\S+$/i.test(url)) return Promise.resolve({ error: 'Enter the web address of a picture, starting with https://' });
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      function finish(result) { if (done) return; done = true; clearTimeout(timer); resolve(result); }
      var timer = setTimeout(function () { finish({ error: 'That image could not be loaded. Check the address and try again.' }); }, 15000);
      img.onload = function () { finish(img.naturalWidth ? { url: url } : { error: 'That image could not be loaded. Check the address and try again.' }); };
      img.onerror = function () { finish({ error: 'That image could not be loaded. Check the address and try again.' }); };
      img.src = url;
    });
  }

  /* ---------- the look of one text ----------
     For what the site-wide settings do not reach: one text or button gets its own font, size, weight or colour,
     as inline styles marked important so they hold against the site-wide heading rules. */
  function styleTarget() {
    if (!canvas || !selectedEl || !selectedEl.isConnected) return null;
    var kind = selectedEl.getAttribute('data-editable');
    return kind === 'text' || kind === 'button' ? selectedEl : null;
  }
  function hexOf(color) {
    var m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color || '');
    return m ? '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('') : '';
  }
  function selectedStyle() {
    var el = styleTarget();
    if (!el) return null;
    var cs = canvas.win.getComputedStyle(el);
    return { fontFamily: firstFamily(cs.fontFamily), fontSize: Math.round(parseFloat(cs.fontSize)) || 16, fontWeight: cs.fontWeight, color: hexOf(cs.color) };
  }
  function styleSelected(props) {
    var el = styleTarget();
    if (!el || remounting) { showToast('Select a text on the page first.'); return false; }
    props = props || {};
    function put(name, value) { el.style.setProperty(name, value, 'important'); }
    if (props.fontFamily) put('font-family', stackFor(props.fontFamily));
    if (props.fontSize) put('font-size', parseInt(props.fontSize, 10) + 'px');
    if (props.fontWeight) put('font-weight', String(props.fontWeight));
    if (props.color) put('color', props.color);
    if (props.fontFamily) canvas.design.syncFonts();
    clearAiGenerated(el);
    commit();
    repositionToolbars();
    return true;
  }

  /* ---------- "Ask AI to edit" chat panel ---------- */
  /* kept in sync with tools/serve.js's DESIGN_FIELDS (same canvas.design vocabulary as the Design panel
     and create-event.html's "Let AI design it") */
  var CHAT_DESIGN_KEYS = ['themeColor', 'textColor', 'bgColor', 'headingColor', 'headingFont', 'bodyFont',
    'divider', 'animation', 'headingCase', 'headingAlign', 'headingWeight', 'bodyWeight', 'bodySize', 'headingSize', 'sectionSpacing', 'bgOpacity'];

  /* What the owner is asked to approve is written in the words the Design panel and the style toolbar use,
     never in the setting's internal name. */
  var CHAT_DESIGN_LABELS = {
    themeColor: 'Theme color', textColor: 'Text color', bgColor: 'Background color', headingColor: 'Heading color',
    headingFont: 'Heading font', bodyFont: 'Body font', headingCase: 'Heading text case', headingAlign: 'Heading alignment',
    headingWeight: 'Heading font weight', bodyWeight: 'Body font weight', bodySize: 'Body text size', headingSize: 'Heading size',
    sectionSpacing: 'Space between sections', divider: 'Line between sections', animation: 'Section animation',
    bgOpacity: 'Background opacity'
  };
  var CHAT_DESIGN_CHOICES = {
    headingCase: { none: 'Headings as typed', uppercase: 'Headings in capitals', lowercase: 'Headings in lower case', capitalize: 'Headings with each word capitalized' },
    headingAlign: { left: 'Headings aligned left', center: 'Headings centered', right: 'Headings aligned right', justify: 'Headings justified' },
    divider: { none: 'No line between sections', line: 'A solid line between sections', dashed: 'A dashed line between sections', thick: 'A thick line between sections' },
    animation: { none: 'No section animation', fade: 'Sections fade in', rise: 'Sections rise in', pulse: 'Sections pulse' }
  };
  var CHAT_DESIGN_UNITS = { bodySize: ' px', headingSize: ' px', sectionSpacing: ' px', bgOpacity: '%' };
  function designLabel(key) {
    if (CHAT_DESIGN_LABELS[key]) return CHAT_DESIGN_LABELS[key];
    var words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  function designChangeHtml(key, value) {
    var v = String(value);
    if (/Color$/.test(key)) {
      var chip = /^#[0-9a-f]{3,8}$/i.test(v) ? ' <span class="cp-chip" style="background:' + v + '"></span>' : '';
      return escHtml(designLabel(key)) + chip + ' ' + escHtml(v);
    }
    var choices = CHAT_DESIGN_CHOICES[key];
    if (choices && choices[v]) return escHtml(choices[v]);
    return escHtml(designLabel(key) + ': ' + v + (CHAT_DESIGN_UNITS[key] || ''));
  }
  // the server names a value it refused as: themeColor ("navy")
  function skippedLabel(text) {
    return String(text).replace(/^([A-Za-z]+)(?= \(")/, function (key) { return CHAT_DESIGN_KEYS.indexOf(key) !== -1 ? designLabel(key) : key; });
  }
  function sectionLabel(key) {
    var sec = canvas.sectionByKey(key);
    return (sec && sec.getAttribute('data-sec-name')) || designLabel(key);
  }

  function currentDesignContext() {
    var out = {};
    CHAT_DESIGN_KEYS.forEach(function (k) { try { out[k] = canvas.design.get(k); } catch (e) {} });
    return out;
  }

  /* Only text a visitor can see is offered to the AI and changed by it. Templates keep some text out of sight
     on purpose (a heading for search engines beside a headline that is a picture): an edit landing there would
     be reported as done while the page looks the same. The answer of a closed accordion item counts as seen —
     a visitor opens it. */
  function isShown(el) {
    var box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && canvas.win.getComputedStyle(el).visibility !== 'hidden';
  }
  function isVisibleText(node) {
    var el = node.parentElement, sec = el && el.closest('[data-rv-section]');
    if (!sec || sec.classList.contains('is-hidden-sec')) return false;
    if (canvas.win.getComputedStyle(el).visibility === 'hidden') return false;
    var range = canvas.doc.createRange();
    range.selectNodeContents(node);
    if (range.getClientRects().length) return true;
    var item = canvas.itemAround(el);
    return !!item && item !== el && isShown(item);
  }
  /* A section's text, one entry per DOM text node, as visibleTextNodes() finds it. An editable element's
     textContent can span several text nodes (a heading with a kicker <span>), and an edit replaces inside
     one node — so every string offered to the AI is one applyTextEdit() can find again. Button labels come
     separately: a label inside a text is already part of that text. */
  function visibleTextNodes(sec, selector) {
    var out = [], seen = [];
    Array.prototype.forEach.call(sec.querySelectorAll(selector), function (el) {
      var walker = canvas.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (seen.indexOf(node) !== -1 || !/\S/.test(node.nodeValue) || !isVisibleText(node)) continue;
        seen.push(node);
        out.push(node);
      }
    });
    return out;
  }
  function readable(node) { return node.nodeValue.replace(/\s+/g, ' ').trim(); }
  function sectionTextNodes(sec) {
    return visibleTextNodes(sec, '[data-editable="text"]').map(readable);
  }
  function sectionButtonLabels(sec) {
    return visibleTextNodes(sec, '[data-editable="button"]').filter(function (node) {
      return !node.parentElement.closest('[data-editable="text"]');
    }).map(readable);
  }
  /* true when what a visitor reads as the section's headline is a picture: the first heading shown holds an
     image and no text, or no heading is shown at all while the section keeps one out of sight beside a picture */
  function hasImageHeadline(sec) {
    var headings = Array.prototype.slice.call(sec.querySelectorAll('h1, h2, h3'));
    var first = headings.filter(isShown)[0];
    if (first) return !/\S/.test(first.textContent) && !!first.querySelector('img, svg');
    return headings.some(function (h) { return /\S/.test(h.textContent); }) &&
      Array.prototype.some.call(sec.querySelectorAll('[data-editable="image"]'), isShown);
  }
  /* What the AI is shown of the page: each section's texts. A page can hold more than fits (an imported site
     is one section of several hundred texts), so the texts that share a word or a number with what was
     asked go first and the rest fill what room is left — an instruction about "2026" must be shown every
     text with 2026 in it, wherever on the page it is. */
  var CHAT_TEXTS_BUDGET = 60000;      // characters, over the whole page
  function sectionsContext(instruction, focusId) {
    var words = String(instruction || '').toLowerCase().match(/[a-z0-9][a-z0-9'’&.-]{2,}/g) || [];
    var asked = function (t) { var low = t.toLowerCase(); return words.some(function (w) { return low.indexOf(w) !== -1; }); };
    var secs = canvas.sections();
    var share = Math.max(1500, Math.floor(CHAT_TEXTS_BUDGET / Math.max(1, secs.length)));
    return secs.map(function (sec) {
      // the key, not the type: an edit must reach the one section it was proposed for, copies included
      var id = sec.getAttribute('data-rv-key');
      var short = function (t) { return t.slice(0, 200); };
      var all = sectionTextNodes(sec).map(short).filter(function (t, i, list) { return list.indexOf(t) === i; });
      var room = id && id === focusId ? Math.max(share, 8000) : share, texts = [];   // the selected section in full
      all.filter(asked).concat(all.filter(function (t) { return !asked(t); })).forEach(function (t) {
        if (room <= 0) return;
        texts.push(t);
        room -= t.length + 4;
      });
      // back in page order, which is how the section reads
      texts.sort(function (a, b) { return all.indexOf(a) - all.indexOf(b); });
      var out = { id: id, name: sec.getAttribute('data-sec-name') || id, texts: texts };
      if (sec.classList.contains('is-hidden-sec')) out.hidden = true;
      var buttons = sectionButtonLabels(sec).slice(0, 8).map(short);
      if (buttons.length) out.buttons = buttons;
      if (hasImageHeadline(sec)) out.imageHeadline = true;
      return out;
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
     turns right-aligned, AI turns left-aligned — the same visual grammar as any chat app. `bubble` is the
     element shown as the message: a plain balloon, or a proposal card. */
  function appendChatBubble(role, bubble) {
    var isUser = role === 'user';
    var turn = document.createElement('div');
    turn.className = 'chat-turn ' + (isUser ? 'user' : 'ai');
    var avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    if (isUser) avatar.textContent = 'Y';
    else avatar.innerHTML = '<svg viewBox="0 0 64 64" width="20" height="20" aria-hidden="true"><defs><linearGradient id="rvbc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6f5"/></linearGradient></defs><line x1="32" y1="9" x2="32" y2="16" stroke="#8fa0c2" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="7" r="3.6" fill="#ED1C24"/><rect x="7" y="27" width="6" height="12" rx="3" fill="#b9c5de"/><rect x="51" y="27" width="6" height="12" rx="3" fill="#b9c5de"/><rect x="12" y="16" width="40" height="32" rx="13" fill="url(#rvbc)" stroke="#c3cee3" stroke-width="1.5"/><rect x="18" y="23" width="28" height="18" rx="9" fill="#1c2540"/><circle cx="26" cy="32" r="3.6" fill="#5fe3ff"/><circle cx="38" cy="32" r="3.6" fill="#5fe3ff"/><circle cx="27" cy="31" r="1.1" fill="#fff"/><circle cx="39" cy="31" r="1.1" fill="#fff"/><path d="M22 50h20a6 6 0 0 1 6 6v3H16v-3a6 6 0 0 1 6-6z" fill="url(#rvbc)" stroke="#c3cee3" stroke-width="1.5"/><circle cx="32" cy="55" r="2.2" fill="#ED1C24"/></svg>';
    var body = document.createElement('div');
    body.className = 'chat-turn-body';
    var sender = document.createElement('span');
    sender.className = 'chat-sender';
    sender.textContent = isUser ? 'You' : 'ETB2B AI';
    body.appendChild(sender);
    body.appendChild(bubble);
    turn.appendChild(avatar);
    turn.appendChild(body);
    appendChatNode(turn);
    return bubble;
  }
  // returns the bubble, not the turn around it: the "Thinking…" status rewrites its text
  function appendChatMsg(role, text) {
    var parts = role.split(' ');   // 'ai' | 'user' | 'ai error'
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg' + (parts[1] ? ' ' + parts[1] : '');
    bubble.textContent = text;
    return appendChatBubble(parts[0], bubble);
  }

  /* One proposed text edit: the first visible text node of the section (in its texts and button labels) that
     contains `find`. Only that substring of that one node is replaced — as text, never as markup — so nested
     markup (a heading's kicker <span>) is untouched. `find` was read from the whitespace-collapsed text the
     AI was shown, so it is matched with the same tolerance against the node's raw value. */
  function findToRegex(find) {
    return new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  }
  /* every text of the section that holds the words to change: "change 2026 to 2027" means all of them */
  function locateTextEdit(edit) {
    var sec = edit && canvas.sectionByKey(edit.sectionId);
    if (!sec || !edit.find || edit.find === edit.replace) return null;
    var re = findToRegex(edit.find);
    var nodes = visibleTextNodes(sec, '[data-editable="text"], [data-editable="button"]').filter(function (n) { return re.test(n.nodeValue); });
    return nodes.length ? { node: nodes[0], nodes: nodes, re: re } : null;
  }
  // returns the first element whose text changed, or null when the text is no longer there
  function applyTextEdit(edit) {
    var at = locateTextEdit(edit);
    if (!at) return null;
    var replacement = String(edit.replace == null ? '' : edit.replace);
    var all = new RegExp(at.re.source, 'g');
    at.nodes.forEach(function (node) { node.nodeValue = node.nodeValue.replace(all, function () { return replacement; }); });
    return at.node.parentElement;
  }

  /* The chat's own way back from an applied change. It undoes the newest step, so it is withdrawn as soon
     as that step is no longer the AI's change (updateHistoryButtons runs after every recorded step and
     every undo / redo). */
  var aiUndo = null;
  function syncAiUndo() {
    if (!aiUndo || aiUndo.ptr === undoPtr) return;
    aiUndo.button.disabled = true;
    aiUndo.button.title = 'The site has changed since. Use Undo in the top bar to step back.';
    aiUndo = null;
  }
  function offerAiUndo(bubble, histEntry, summary) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-sm chat-undo';
    button.textContent = 'Undo this change';
    bubble.appendChild(button);
    var mine = aiUndo = { ptr: undoPtr, button: button };
    button.addEventListener('click', function () {
      deselect();
      flush();                          // anything still pending becomes its own step, and withdraws this offer
      if (aiUndo !== mine) return;
      aiUndo = null;
      undo();
      bubble.textContent = 'Undone — the site is back to how it was.';
      if (histEntry) histEntry.text = 'Proposed: ' + summary + ' (applied, then undone)';
    });
  }

  /* Proposals still waiting for Apply / Discard. Only the newest can be applied: an older card applied after
     a newer one would put its own values back over it without saying so. */
  var openProposals = [];
  function closeProposals(except) {
    openProposals.slice().forEach(function (p) { if (p !== except) p.supersede(); });
  }

  function renderProposal(result, histEntry, attached) {
    attached = attached || [];
    /* the pictures an entry names by number, as { n, url } for the request that reworks its section */
    function picturesFor(entry) {
      return (entry.pictures || []).map(function (n) { return attached[n - 1] ? { n: n, url: attached[n - 1] } : null; }).filter(Boolean);
    }
    var design = {}, notes = [];
    Object.keys(result.design || {}).forEach(function (k) {
      if (canvas.design.supports(k)) design[k] = result.design[k];
      else notes.push(escHtml(designLabel(k) + ' — ' + unsupportedReason(k)));
    });
    var textEdits = [];
    (result.textEdits || []).forEach(function (t) {
      if (locateTextEdit(t)) textEdits.push(t);
      else notes.push(escHtml(sectionLabel(t.sectionId)) + ' — &ldquo;' + escHtml(t.find) + '&rdquo; is not a text visitors can see in this section');
    });
    (result.skipped || []).forEach(function (s) { notes.push(escHtml(skippedLabel(s))); });

    /* what goes beyond a setting or a wording: sections reworked, hidden, removed, moved or added */
    var known = function (id) { return !!(id && canvas.sectionByKey(id)); };
    var edits = (result.sectionEdits || []).filter(function (e) { return e && known(e.sectionId) && e.instruction; });
    var ops = (result.sectionOps || []).filter(function (o) { return o && known(o.sectionId); });
    var additions = (result.newSections || []).filter(function (n) { return n && n.instruction; });
    var OP_WORDS = { hide: 'hide', show: 'show again', remove: 'remove', move: 'move' };
    var items = Object.keys(design).map(function (k) { return designChangeHtml(k, design[k]); })
      .concat(textEdits.map(function (t) {
        var where = escHtml(sectionLabel(t.sectionId)) + ' — ';
        return t.replace ? where + 'change &ldquo;' + escHtml(t.find) + '&rdquo; to &ldquo;' + escHtml(t.replace) + '&rdquo;'
          : where + 'remove &ldquo;' + escHtml(t.find) + '&rdquo;';
      }))
      .concat(ops.map(function (o) {
        return escHtml(sectionLabel(o.sectionId)) + ' — ' + OP_WORDS[o.op] + ' this section' +
          (o.op === 'move' ? (o.beforeSectionId && known(o.beforeSectionId) ? ' to just before ' + escHtml(sectionLabel(o.beforeSectionId)) : ' to the end of the page') : '');
      }))
      .concat(edits.map(function (e) { return escHtml(sectionLabel(e.sectionId)) + ' — rework: ' + escHtml(e.instruction) + (picturesFor(e).length ? ' <em>(uses attached picture ' + picturesFor(e).map(function (x) { return x.n; }).join(', ') + ')</em>' : ''); }))
      .concat(additions.map(function (n) { return 'New section &ldquo;' + escHtml(n.name) + '&rdquo;' + (n.afterSectionId && known(n.afterSectionId) ? ' after ' + escHtml(sectionLabel(n.afterSectionId)) : '') + ' — ' + escHtml(n.instruction); }));
    var cannot = (Array.isArray(result.unsupported) ? result.unsupported : []).map(function (u) { return String(u).trim(); }).filter(Boolean);
    var usable = items.length > 0;

    /* The model's own sentence is not a promise of what Apply will do: it can describe a change that never
       made it into the structured answer. The list is built from what will really be applied, and anything
       that came back unusable is said beside it. With nothing usable the sentence is shown as the AI's
       words, not as a statement of fact. */
    var card = document.createElement('div');
    card.className = 'chat-proposal';
    card.innerHTML =
      (usable ? '<span class="cp-summary">' + escHtml(result.summary) + '</span>' : '') +
      '<span class="cp-will-change">What will change</span>' +
      (usable ? '<ul>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>'
        : '<span class="cp-skipped">Nothing — this request did not produce a change that can be applied.</span>') +
      (notes.length ? '<span class="cp-skipped">Couldn’t apply:</span><ul class="cp-skipped">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>' : '') +
      (cannot.length ? '<span class="cp-note">I can’t do this here: ' + escHtml(cannot.join('; ')) +
        '. Speakers, agenda, sponsors, FAQs and contacts are managed in the event’s Content tabs.</span>' : '') +
      (usable ? '' : '<span class="cp-note">The AI answered: &ldquo;' + escHtml(result.summary) + '&rdquo;</span>' +
        '<span class="cp-note">The site is unchanged. Ask again in other words, or make the change yourself on the page or in Design.</span>') +
      '<div class="cp-actions">' +
        '<button class="btn btn-primary btn-sm" type="button" data-cp="apply"' + (usable ? '' : ' disabled title="There is nothing to apply"') + '>Apply</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-cp="discard">Discard</button>' +
      '</div>' +
      '<span class="cp-note cp-state" hidden></span>';
    var turn = appendChatBubble('ai', card).closest('.chat-turn');
    if (histEntry && !usable) histEntry.text = 'Proposed: ' + result.summary + ' (nothing in it could be applied; the site is unchanged)';

    var me = {
      supersede: function () {
        close('Replaced by a newer suggestion — not applied.');
        if (histEntry) histEntry.text = 'Proposed: ' + result.summary + ' (superseded, not applied)';
      }
    };
    function close(state) {
      var at = openProposals.indexOf(me);
      if (at !== -1) openProposals.splice(at, 1);
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      card.classList.add('is-closed');
      var line = card.querySelector('.cp-state');
      if (state) { line.textContent = state; line.hidden = false; }
    }
    closeProposals(me);
    if (usable) openProposals.push(me);

    card.querySelector('[data-cp="discard"]').addEventListener('click', function () {
      close('');
      turn.remove();
      appendChatMsg('ai', 'Discarded — nothing on the site changed.');
      if (histEntry) histEntry.text = 'Proposed: ' + result.summary + ' (discarded, not applied)';
    });
    card.querySelector('[data-cp="apply"]').addEventListener('click', function () {
      if (!canvas || remounting || openProposals.indexOf(me) === -1 || aiWorking) return;
      deselect();
      flush();                          // what was pending stays its own undo step
      closeProposals(me);
      var leftOut = applyAiDesignToCanvas(canvas, design);
      var changedEls = [];
      textEdits.forEach(function (t) {
        var el = applyTextEdit(t);
        if (!el) return;
        changedEls.push(el);
        clearAiGenerated(el);
      });
      var said = [], done = [];
      /* whole sections: hidden, shown, removed, moved */
      ops.forEach(function (o) {
        var sec = canvas.sectionByKey(o.sectionId);
        if (!isLive(sec)) return;
        var label = '“' + sectionLabel(o.sectionId) + '”';
        if (o.op === 'hide' || o.op === 'show') { canvas.setHidden(sec, o.op === 'hide'); done.push(label + (o.op === 'hide' ? ' hidden' : ' shown')); }
        else if (o.op === 'remove') { canvas.removeSection(sec); done.push(label + ' removed'); }
        else if (o.op === 'move') {
          var before = o.beforeSectionId ? canvas.sectionByKey(o.beforeSectionId) : null;
          if (canvas.moveSection(sec, before || null)) done.push(label + ' moved');
          else said.push(label + ' could not be moved there — the page’s first and last sections keep their places.');
        }
      });
      if (canvas.retag) canvas.sections().forEach(function (sec) { canvas.retag(sec); });

      /* sections reworked or written by the AI: one request each, one after another, then ONE undo step */
      var jobs = edits.map(function (e) { return { edit: e }; }).concat(additions.map(function (n) { return { add: n }; }));
      var state = card.querySelector('.cp-state');
      function step(i) {
        if (i >= jobs.length) return Promise.resolve();
        var job = jobs[i], sec, label;
        if (job.edit) { sec = canvas.sectionByKey(job.edit.sectionId); label = sectionLabel(job.edit.sectionId); }
        else {
          sec = addBlankSection(job.add.name, job.add.afterSectionId ? canvas.sectionByKey(job.add.afterSectionId) : null);
          label = job.add.name;
        }
        if (!isLive(sec)) { said.push('“' + label + '” is no longer on the page, so it was left out.'); return step(i + 1); }
        state.textContent = 'Working on “' + label + '” (' + (i + 1) + ' of ' + jobs.length + ') — about half a minute each…';
        state.hidden = false;
        return requestSectionCode(sec, job.edit ? 'edit' : 'create', (job.edit || job.add).instruction, picturesFor(job.edit || job.add)).then(function (code) {
          if (!isLive(sec)) throw new Error('the section was removed meanwhile');
          var fresh = applySectionCode(sec, code);
          if (!fresh) throw new Error('the AI’s answer was not a usable section');
          changedEls.push(fresh);
          done.push('“' + label + '” ' + (job.edit ? 'reworked' : 'added'));
        }).then(null, function (err) {
          if (job.add && isLive(sec)) canvas.removeSection(sec);       // an empty shell is not left behind
          said.push('“' + label + '” was not ' + (job.edit ? 'changed' : 'added') + ': ' + ((err && err.message) || 'the AI could not do it') + '.');
        }).then(function () { return step(i + 1); });
      }
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      aiWorking = jobs.length > 0;
      step(0).then(function () {
        aiWorking = false;
        var redraw = changedEls.some(function (el) { return el.querySelector && el.querySelector('[data-rv-repeat-template]'); });
        var changed = commitNow();
        close('');
        // a setting this site has nothing for is said, not counted as applied
        if (leftOut.length) {
          said.push('Not changed: ' + leftOut.map(function (k) { return designLabel(k) + ' — ' + (unsupportedReason(k) || 'nothing on the page changed for it.'); }).join(' '));
        }
        var appliedDesign = {};
        Object.keys(design).forEach(function (k) { if (leftOut.indexOf(k) === -1) appliedDesign[k] = design[k]; });

        if (!changed) {
          designChanged();                // a setting that was tried and did nothing is put away in the Design panel
          appendChatMsg('ai', ['Nothing could be applied — the site is unchanged.'].concat(said).join(' '));
          if (histEntry) histEntry.text = 'Proposed: ' + result.summary + ' (nothing could be applied; the site is unchanged)';
          return;
        }
        var first = changedEls.filter(function (el) { return el && el.isConnected; })[0];
        if (first) {
          // the first change is brought into view; inside an accordion item, the whole item, opened
          var around = canvas.itemAround(first) || first;
          canvas.openItem(first);
          canvas.scrollToSection(isShown(around) ? around : first.closest('[data-rv-section]'));
        }
        var bubble = appendChatMsg('ai', ['Applied.'].concat(done.length ? [done.join('; ') + '.'] : []).concat(said).join(' '));
        if (histEntry) {
          histEntry.text = 'Proposed and applied: ' + result.summary +
            (Object.keys(appliedDesign).length ? ' (design: ' + JSON.stringify(appliedDesign) + ')' : '') +
            (done.length ? ' (' + done.join('; ') + ')' : '') + (said.length ? ' (not done: ' + said.join(' ') + ')' : '');
        }
        offerAiUndo(bubble, histEntry, result.summary);
        chatThread().scrollTop = chatThread().scrollHeight;
        if (redraw) drawRecords(false);         // the event's records, drawn into what was rewritten
      });
    });
    return usable;
  }

  /* ---------- a section's code, asked of the AI ----------
     requestSectionCode: the section as it stands (devSource: no editor marks, records as their one model
     item) goes to POST /api/redesign-section with what is wanted — mode "edit" (change this, keep the rest),
     "create" (write a new one) or "redesign" — and the answer is { html, css, summary }.
     applySectionCode puts an answer on the page: on a site whose section CSS is its own the section's
     stylesheet is replaced; elsewhere the CSS is added inside the section. The caller records the undo step. */
  var aiWorking = false;
  function requestSectionCode(sec, mode, instruction, addPictures) {
    var secs = canvas.sections(), at = secs.indexOf(sec), src = devSource(sec);
    return RevampAuth.authedFetch('/api/redesign-section', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: eventId, sectionId: sec.getAttribute('data-rv-section'), mode: mode, instruction: instruction,
        html: src.html, css: src.css, generated: /^gen-/.test(canvas.template.id || ''), addPictures: addPictures || [],
        above: sectionOutline(secs[at - 1]), below: sectionOutline(secs[at + 1])
      })
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { /* an error page from in front of the API */ }
        if (!res.ok || !body || body.error || !body.html) throw new Error((body && body.error) || 'the AI could not answer (error ' + res.status + ')');
        body.js = src.js;
        body.cssIsOwn = src.cssIsOwn;
        return body;
      });
    });
  }
  function applySectionCode(sec, code) {
    var t = document.createElement('template');
    t.innerHTML = String(code.html || '').trim();
    var root = t.content.firstElementChild;
    if (!root || /^(SCRIPT|STYLE|TEMPLATE)$/.test(root.tagName)) return null;
    Array.prototype.forEach.call(root.querySelectorAll('style[data-rv-custom-css], script[data-rv-js]'), function (n) { n.remove(); });
    if (!code.cssIsOwn && code.css) {
      var st = document.createElement('style');
      st.setAttribute('data-rv-custom-css', '');
      st.textContent = code.css;
      root.appendChild(st);
    }
    if (code.js) {
      var holder = document.createElement('script');
      holder.setAttribute('type', 'text/plain');
      holder.setAttribute('data-rv-js', '');
      holder.textContent = code.js;
      root.appendChild(holder);
    }
    var fresh = canvas.replaceSection(sec, root.outerHTML, code.cssIsOwn ? code.css : null);
    if (fresh) fresh.setAttribute('data-ai-generated', 'true');      // written by the AI: asked about before publishing
    return fresh;
  }
  /* an empty section of its own type, for the AI to write into */
  function addBlankSection(name, afterSec) {
    var doc = canvas.doc, base = String(name || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'section';
    var type = base, n = 2;
    while (doc.querySelector('[data-rv-section="' + type + '"]') || doc.getElementById(type)) type = base + '-' + (n++);
    var el = doc.createElement('section');
    el.setAttribute('data-rv-section', type);
    el.setAttribute('data-sec-name', name || 'New section');
    el.id = type;
    canvas.insertSection(el, isLive(afterSec) ? afterSec : null);
    return el;
  }

  /* A real back-and-forth, not a one-shot command box: chatHistory carries prior turns (what was asked, what
     the AI said, and — once known — whether it was applied or discarded) so a follow-up like "make it a bit
     darker instead" is understood against what was just proposed, and a plain question gets an actual answer
     instead of being forced through the edit-proposal pipeline. Capped so the prompt doesn't grow without
     bound over a long session. Entries are objects a proposal card goes on updating as its fate is decided. */
  var chatHistory = [];
  var CHAT_HISTORY_MAX = 16;
  function pushHistory(role, text) {
    var entry = { role: role, text: text };
    chatHistory.push(entry);
    if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX);
    return entry;
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
      appendChatMsg('ai', 'Hi, I’m ETB2B AI. Ask for any change to this site — wording, colours and fonts, a section’s layout or content, adding, moving, hiding or removing sections — or ask a question about the page. I show you what will change first; nothing happens until you press Apply. I’ll remember what we discuss, so you can follow up with things like "make it a bit darker instead" and I’ll know what "it" means.');
    }
    /* What the owner has selected on the page goes with the message, so "make this shorter" needs no
       section named: a chip above the box says what it is ("Selected: Why attend · “Six reasons…”"), and
       its × sends without it until something else is selected. */
    var focusBar = document.createElement('div'), focusOff = '';
    focusBar.className = 'chat-focus'; focusBar.hidden = true;
    var composeEl = input.closest('.chat-compose');
    var trayEl = document.getElementById('chat-attached');
    if (composeEl && composeEl.parentNode) composeEl.parentNode.insertBefore(focusBar, trayEl && trayEl.parentNode === composeEl.parentNode ? trayEl : composeEl);
    function liveSection() { return activeSectionEl && activeSectionEl.isConnected && activeSectionEl.getAttribute('data-rv-key') ? activeSectionEl : null; }
    function focusNow() {
      var sec = liveSection();
      if (!sec) return null;
      var f = { sectionId: sec.getAttribute('data-rv-key'), name: sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-key') };
      if (selectedEl && selectedEl.isConnected && sec.contains(selectedEl)) {
        var text = String(selectedEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        var kind = selectedEl.getAttribute('data-editable') || selectedEl.tagName.toLowerCase();
        if (text || kind === 'image') f.element = { kind: kind, text: text };
      }
      return f;
    }
    function focusKey(f) { return f ? f.sectionId + '|' + (f.element ? f.element.kind + ':' + f.element.text : '') : ''; }
    function chatFocus() { var f = focusNow(); return f && focusKey(f) !== focusOff ? f : null; }
    function drawFocus() {
      var f = focusNow();
      if (f && focusOff && focusKey(f) !== focusOff) focusOff = '';          // something else was selected
      var on = f && focusKey(f) !== focusOff;
      focusBar.hidden = !on;
      focusBar.textContent = '';
      if (!on) return;
      var ico = document.createElement('span'); ico.className = 'chat-focus-ico'; ico.setAttribute('aria-hidden', 'true');
      ico.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>';
      var label = document.createElement('span'); label.className = 'chat-focus-text';
      label.appendChild(document.createTextNode('Selected: '));
      var b = document.createElement('b'); b.textContent = f.name; label.appendChild(b);
      if (f.element) label.appendChild(document.createTextNode(f.element.text ? ' · “' + (f.element.text.length > 48 ? f.element.text.slice(0, 47) + '…' : f.element.text) + '”' : ' · picture'));
      label.title = 'ETB2B AI will take your message to be about this, unless you name another part of the page';
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'chat-focus-rm'; rm.textContent = '×';
      rm.title = 'Send without it'; rm.setAttribute('aria-label', 'Send without the selected section');
      rm.addEventListener('click', function () { focusOff = focusKey(focusNow()); drawFocus(); input.focus(); });
      focusBar.appendChild(ico); focusBar.appendChild(label); focusBar.appendChild(rm);
    }
    chatFocusRedraw = drawFocus;
    drawFocus();

    /* Pictures for the AI to place: chosen with the paper-clip (or dropped on the message box), stored with
       the event at once (RevampCore.uploadImage), shown as numbered thumbnails above the box and sent with
       the next message. The AI is told how many there are and refers to them by number. */
    var attachBtn = document.getElementById('chat-attach'), fileBox = document.getElementById('chat-file'), tray = document.getElementById('chat-attached');
    var attachments = [], uploading = 0, MAX_ATTACHED = 6;
    function drawTray() {
      if (!tray) return;
      tray.textContent = '';
      attachments.forEach(function (a, i) {
        var chip = document.createElement('span');
        chip.className = 'chat-chip';
        var img = document.createElement('img'); img.src = a.url; img.alt = a.name || '';
        var num = document.createElement('b'); num.textContent = String(i + 1);
        var rm = document.createElement('button'); rm.type = 'button'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove picture ' + (i + 1)); rm.textContent = '×';
        rm.addEventListener('click', function () { attachments.splice(i, 1); drawTray(); });
        chip.appendChild(img); chip.appendChild(num); chip.appendChild(rm);
        tray.appendChild(chip);
      });
      for (var k = 0; k < uploading; k++) { var wait = document.createElement('span'); wait.className = 'chat-chip is-loading'; wait.textContent = 'Uploading…'; tray.appendChild(wait); }
      tray.hidden = !attachments.length && !uploading;
    }
    function attach(files) {
      if (!eventId || !window.RevampCore || !RevampCore.uploadImage) { appendChatMsg('ai error', 'Pictures can be attached once the site belongs to an event.'); return; }
      Array.prototype.slice.call(files || []).forEach(function (file) {
        if (attachments.length + uploading >= MAX_ATTACHED) { showToast('Up to ' + MAX_ATTACHED + ' pictures per message.', { kind: 'error' }); return; }
        uploading++; drawTray();
        RevampCore.uploadImage(eventId, 'media', file).then(function (up) {
          uploading--; attachments.push({ url: up.url, name: file.name }); drawTray();
        }, function (err) {
          uploading--; drawTray();
          appendChatMsg('ai error', (err && err.message) || 'That picture could not be uploaded. Please try again.');
        });
      });
    }
    if (attachBtn && fileBox) {
      attachBtn.addEventListener('click', function () { fileBox.click(); });
      fileBox.addEventListener('change', function () { attach(fileBox.files); fileBox.value = ''; });
      input.addEventListener('paste', function (e) {
        var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
        if (files.length) { e.preventDefault(); attach(files); }
      });
      input.addEventListener('dragover', function (e) { e.preventDefault(); });
      input.addEventListener('drop', function (e) {
        var files = Array.prototype.filter.call((e.dataTransfer && e.dataTransfer.files) || [], function (f) { return /^image\//.test(f.type); });
        if (files.length) { e.preventDefault(); attach(files); }
      });
    }

    // one request at a time: each is a paid call, and Enter must not start a second while one is running
    var busy = false;
    function go() {
      if (busy || !canvas || remounting) return;
      var instruction = input.value.trim();
      if (uploading) { showToast('A picture is still uploading — one moment.'); return; }
      if (!instruction && attachments.length) { showToast('Say what the picture is for — e.g. “use this as the hero background”.'); input.focus(); return; }
      if (!instruction) return;
      busy = true;
      send.disabled = true;
      input.value = '';
      var sent = attachments.map(function (a) { return a.url; });
      attachments = []; drawTray();
      var focus = chatFocus();
      var mine = appendChatMsg('user', instruction);
      if (focus && mine) {
        var tag = document.createElement('div');
        tag.className = 'chat-msg-focus';
        tag.textContent = '↳ ' + focus.name + (focus.element && focus.element.text ? ' · “' + (focus.element.text.length > 40 ? focus.element.text.slice(0, 39) + '…' : focus.element.text) + '”' : '');
        mine.insertBefore(tag, mine.firstChild);
      }
      if (sent.length && mine) {
        var strip = document.createElement('div');
        strip.className = 'chat-sent-pics';
        sent.forEach(function (u) { var im = document.createElement('img'); im.src = u; im.alt = 'Attached picture'; strip.appendChild(im); });
        mine.appendChild(strip);
      }
      var thinking = appendChatMsg('ai', CHAT_THINKING_LINES[0]);
      var lineIdx = 0;
      var thinkingTimer = setInterval(function () {
        lineIdx = (lineIdx + 1) % CHAT_THINKING_LINES.length;
        thinking.textContent = CHAT_THINKING_LINES[lineIdx];
      }, 2200);
      function settle() {
        clearInterval(thinkingTimer);
        var turn = thinking.closest('.chat-turn');
        if (turn) turn.remove();
        busy = false;
        send.disabled = false;
      }
      // the request was not answered: the instruction goes back into the box, in front of anything typed since
      function failed(message) {
        settle();
        appendChatMsg('ai error', message);
        var typed = input.value.trim();
        input.value = instruction + (typed ? '\n' + typed : '');
        // the pictures go back with the words they were sent with
        if (sent.length) { attachments = sent.map(function (u) { return { url: u, name: '' }; }).concat(attachments).slice(0, MAX_ATTACHED); drawTray(); }
      }
      fetch('/api/chat-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventId || '', instruction: instruction, history: chatHistory, design: currentDesignContext(), sections: sectionsContext(instruction, focus && focus.sectionId), focus: focus || undefined, attachmentCount: sent.length, attachments: sent })
      })
        .then(function (res) {
          return res.text().then(function (text) {
            var body = null;
            try { body = JSON.parse(text); } catch (e) { /* not JSON: an error page from in front of the API */ }
            return { ok: res.ok, status: res.status, body: body };
          });
        })
        .then(null, function () { return null; })       // no answer at all
        .then(function (r) {
          if (!r) {
            failed('Could not reach ETB2B AI. Nothing on the site changed — check your connection and try again.');
            return;
          }
          if (!r.ok || !r.body || r.body.error) {
            failed((r.body && r.body.error) || 'ETB2B AI could not answer (error ' + r.status + '). Nothing on the site changed — try again.');
            return;
          }
          settle();
          pushHistory('user', instruction + (sent.length ? ' [' + sent.length + ' picture' + (sent.length === 1 ? '' : 's') + ' attached]' : ''));
          chatTurnCount++;
          if (r.body.kind === 'reply') {
            appendChatMsg('ai', r.body.summary);
            pushHistory('assistant', r.body.summary);
            return;
          }
          var usable = renderProposal(r.body, pushHistory('assistant', 'Proposed: ' + r.body.summary + ' (awaiting your Apply/Discard)'), sent);
          /* shown once, after the very first edit, so a user who only ever tries one instruction still
             discovers the thing that makes this an actual chat rather than a prompt box */
          if (usable && chatTurnCount === 1) appendChatMsg('ai', 'You can also ask me to adjust this before deciding — e.g. "make it a bit darker instead" — and I’ll understand you mean this change.');
        });
    }
    send.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  }

  /* What the generator had to say about the logo unit it took from the previous edition (a year it could
     not change, a sponsor's mark drawn into it): shown once the site is open, until the owner dismisses it
     or replaces the picture. The note travels on the unit itself and is removed from a published page. */
  function logoUnitNotice() {
    if (!canvas || !canvas.doc) return;
    var unit = canvas.doc.querySelector('[data-rv-logo-note]');
    if (!unit) return;
    showNotice('logo-unit', {
      kind: 'warn', dismissible: true, text: 'Logo unit: ' + unit.getAttribute('data-rv-logo-note'),
      /* checked and fine: the note comes off the unit, so it is not shown again the next time the site opens */
      actions: [{ label: 'Looks right', onClick: function () {
        Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-logo-note]'), function (el) { el.removeAttribute('data-rv-logo-note'); });
        commitNow();
        var shown = document.querySelector('#ed-notices [data-notice="logo-unit"]');
        if (shown) shown.remove();
      } }]
    });
  }

  /* ---------- device / preview / publish ---------- */
  function setDevice(name) {
    deviceName = name;
    if (!canvas) return;
    canvas.setDevice(name);
    repositionToolbars();
    setTimeout(repositionToolbars, 120);      // again once the page has settled into its new width
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
    if (!canvas) return;
    deselect();
    flush();
    if (!eventId) {
      // a template preview belongs to no event, so there is nowhere to stage it: the page is opened as it is
      // from this tab's memory, with the editor's address as the base its relative links resolve against
      var page = canvas.serialize().replace(/<head([^>]*)>/i, function (m) { return m + '<base href="' + escHtml(location.href) + '">'; });
      var blobUrl = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
      if (!window.open(blobUrl, '_blank')) showToast('Allow pop-ups to open the preview in a new tab.');
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
      return;
    }
    var win = window.open('', 'revamp-staging-' + eventId);
    if (!win) { showToast('Allow pop-ups to open the preview in a new tab.'); return; }
    win.document.open();
    win.document.write('<!doctype html><title>Loading preview…</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#666">Loading preview…</body>');
    win.document.close();
    /* the page as it is in this editor, saved or not: this person's own preview. Staging changes on Save. */
    RevampCore.previewDraft(eventId, canvas.serialize()).then(function (result) {
      win.location.href = result.stagingUrl;
    }).catch(function (err) {
      win.document.open();
      win.document.write('<!doctype html><title>Preview failed</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#a23b36">Could not load the preview — ' + escHtml(err && err.message ? err.message : 'please try again.') + '</body>');
      win.document.close();
    });
  }

  /* ---------- save to staging / publish changes ----------
     The editor keeps every change in this browser as it is made. Nothing reaches the server until Save: that
     stores the site as a new version, puts it on the staging address and records what changed, by whom.
     Publish changes sends everything saved since what is live for approval; approving it is what makes it
     live (see "SAVE -> STAGING -> APPROVAL -> LIVE" in functions/lib/api.js). */
  var siteInfo = null;          // { savedVersion, publishedVersion, published, pending, required } from the server
  var savedMark = null;         // { version, hash } — what this browser last saved, to tell "unsaved" from "saved"
  var saving = false, stateTimer = null;

  function markKey() { return 'rv-site-saved:' + eventId; }
  function readMark() { try { return JSON.parse(localStorage.getItem(markKey()) || 'null'); } catch (e) { return null; } }
  function writeMark(mark) { savedMark = mark; try { localStorage.setItem(markKey(), JSON.stringify(mark)); } catch (e) { /* kept in memory */ } }
  function snapHash(snap) {
    var text = JSON.stringify(snap || null), h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return text.length + ':' + h;
  }
  function isDirty() {
    if (!savedMark || !siteInfo || !siteInfo.savedVersion) return true;
    return savedMark.hash !== snapHash(undoStack[undoPtr]);
  }

  function loadSiteInfo() {
    if (!eventId) return Promise.resolve();
    savedMark = readMark();
    return RevampCore.fetchApproval(eventId).then(function (a) {
      siteInfo = {
        savedVersion: a.savedVersion || 0, published: !!a.published, publishedVersion: a.publishedVersion || 0,
        pending: a.request && a.request.status === 'pending' ? a.request : null, required: a.required !== false
      };
    }, function () { siteInfo = siteInfo || { savedVersion: 0, published: false, publishedVersion: 0, pending: null, required: true }; })
      .then(renderSiteState);
  }
  function reviewHref(id) { return '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(id); }

  /* the chip beside Save: where this site stands, and the way to it */
  function renderSiteState() {
    var chip = document.getElementById('site-state'), save = document.getElementById('btn-save'), pub = document.getElementById('btn-publish');
    if (!chip || !save) return;
    chip.hidden = save.hidden = !eventId || !canvas;
    if (!eventId || !canvas || !siteInfo) return;
    var dirty = isDirty(), v = siteInfo.savedVersion, kind = 'plain', text, href = '', title = '';
    if (!v) { kind = 'warn'; text = 'Not saved yet'; title = 'Save puts this site on the staging address.'; }
    else if (dirty) { kind = 'warn'; text = 'Unsaved changes'; title = 'Staging still shows version ' + v + '. Save to update it.'; href = '/preview/' + eventId + '?staged=1'; }
    else if (siteInfo.pending && siteInfo.pending.toVersion === v) { kind = 'wait'; text = 'v' + v + ' · waiting for approval'; href = reviewHref(siteInfo.pending.id); title = 'Sent for approval by ' + siteInfo.pending.requestedBy + '. Open the review page.'; }
    else if (siteInfo.published && siteInfo.publishedVersion === v) { kind = 'ok'; text = 'v' + v + ' · live'; href = '/e/' + eventId; title = 'This version is the live site.'; }
    else { text = 'v' + v + ' · saved to staging'; href = '/preview/' + eventId + '?staged=1'; title = 'Open the staging site.'; }
    chip.className = 'site-state ' + kind;
    chip.textContent = text; chip.title = title;
    if (href) { chip.href = href; chip.target = '_blank'; chip.rel = 'noopener'; } else { chip.removeAttribute('href'); }
    save.disabled = saving || !dirty;
    save.textContent = saving ? 'Saving…' : 'Save';
    if (pub) pub.textContent = siteInfo.required ? 'Publish changes' : 'Publish';
  }
  /* The site lives in this browser's copy until Save; a change only moves the chip to "Unsaved changes". */
  function scheduleServerSave() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(renderSiteState, 250);
  }

  function modal(html, cls) {
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = '<div class="modal ' + (cls || '') + '">' + html + '</div>';
    document.body.appendChild(scrim);
    scrim.addEventListener('click', function (e) { if (e.target === scrim || (e.target.closest && e.target.closest('[data-close]'))) scrim.remove(); });
    return scrim;
  }
  function when(iso) { var d = new Date(iso || ''); return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  /* -> a promise of the save's answer; rejects when it was not saved (the reason has been shown) */
  function saveToStaging(opts) {
    opts = opts || {};
    if (!canvas || !eventId) return Promise.reject(new Error('no site'));
    if (saving) return Promise.reject(new Error('busy'));
    deselect();
    flush();
    var snap = undoStack[undoPtr], hash = snapHash(snap), html = canvas.serialize();
    saving = true; renderSiteState();
    function send(force) {
      return RevampCore.saveSite(eventId, {
        templateId: templateId, baseVersion: force ? 0 : ((savedMark && savedMark.version) || 0), snapshot: snap, html: html, force: force
      });
    }
    function conflict(err) {
      if (!err || err.status !== 409 || err.code !== 'site-conflict') throw err;
      var cur = err.current || {};
      /* never saved from this browser, and nobody else has either: nothing can be overwritten */
      if (!cur.version) return send(true);
      /* this browser has never saved this site but the same person may have, elsewhere; either way they are told */
      return new Promise(function (resolve, reject) {
        var m = modal(
          '<div class="modal-body"><h3>Save over version ' + cur.version + '?</h3>' +
          '<p>Staging holds version ' + cur.version + (cur.updatedBy ? ', saved by ' + escHtml(cur.updatedBy) : '') + (cur.updatedAt ? ' on ' + escHtml(when(cur.updatedAt)) : '') +
          '. Saving puts what is in this editor on staging as version ' + (cur.version + 1) + '. Version ' + cur.version + ' is kept in the history.</p></div>' +
          '<div class="modal-foot"><button class="btn btn-secondary" data-close id="sv-no">Cancel</button><button class="btn btn-primary" id="sv-yes">Save as version ' + (cur.version + 1) + '</button></div>');
        var done = false;
        m.querySelector('#sv-yes').addEventListener('click', function () { done = true; m.remove(); send(true).then(resolve, reject); });
        m.addEventListener('click', function () { setTimeout(function () { if (!done && !m.isConnected) { done = true; reject(Object.assign(new Error('cancelled'), { cancelled: true })); } }, 0); });
      });
    }
    return send(false).then(null, conflict).then(function (out) {
      saving = false;
      writeMark({ version: out.version, hash: hash });
      siteInfo = siteInfo || { required: true };
      siteInfo.savedVersion = out.version;
      renderSiteState();
      if (!opts.quiet) {
        showToast('Saved to staging as version ' + out.version + (out.summary ? ' — ' + out.summary : ''), {
          action: { label: 'Open staging', onClick: function () { window.open('/preview/' + eventId + '?staged=1', 'revamp-staging-' + eventId); } }
        });
      }
      return out;
    }, function (err) {
      saving = false; renderSiteState();
      if (!(err && err.cancelled)) showToast('Could not save — ' + (err && err.message ? err.message : 'please try again.'), { kind: 'error' });
      throw err;
    });
  }

  function showPublished(result) {
    var pubName = (currentEvent && currentEvent.name) || 'Untitled event';
    if (currentEvent) { currentEvent.published = true; renderTopbar(); }
    var m = modal(
      '<div class="modal-body">' +
      '<div class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg></div>' +
      '<h3>Published</h3><p>' + escHtml(pubName) + '’s latest changes are now live at:</p>' +
      '<span class="url">' + escHtml(result.publishedUrl) + '</span></div>' +
      '<div class="modal-foot"><button class="btn btn-secondary" data-close>Keep editing</button>' +
      '<a class="btn btn-primary" href="' + escHtml(result.publishedUrl) + '" target="_blank" rel="noopener">View live page</a></div>');
    return m;
  }

  /* Publish changes: saves what is unsaved, then asks for approval of everything saved since what is live.
     Where approval has been switched off (Review page → Who approves), it publishes at once instead. */
  function publish() {
    if (!canvas || !eventId || saving) return;
    deselect();
    flush();
    var ready = isDirty() ? saveToStaging({ quiet: true }) : Promise.resolve();
    ready.then(function () {
      if (siteInfo && siteInfo.required === false) {
        showToast('Publishing…');
        return RevampCore.publishEvent(eventId).then(function (result) {
          siteInfo.published = true; siteInfo.publishedVersion = result.publishedVersion; renderSiteState();
          showPublished(result);
        });
      }
      if (siteInfo && siteInfo.published && siteInfo.publishedVersion === siteInfo.savedVersion) {
        showToast('Version ' + siteInfo.savedVersion + ' is already live: there is nothing new to publish.');
        return;
      }
      askApproval();
    }).catch(function (err) {
      if (err && (err.cancelled || err.message === 'busy')) return;
      if (err && err.status) showToast('Could not publish — ' + err.message, { kind: 'error' });
    });
  }

  function askApproval() {
    var pending = siteInfo && siteInfo.pending, v = siteInfo.savedVersion;
    var m = modal(
      '<div class="modal-body"><h3>Send for approval</h3>' +
      '<p>Version ' + v + ' is on staging. It goes live once it is approved' + (siteInfo.published ? '; until then the live site stays on version ' + siteInfo.publishedVersion : '') + '. ' +
      'The approver sees every change saved since ' + (siteInfo.published ? 'the live version' : 'the start') + ', and who made it.</p>' +
      (pending ? '<p class="apv-note">A request by ' + escHtml(pending.requestedBy) + ' is already waiting (version ' + pending.toVersion + '). Sending updates it to version ' + v + '.</p>' : '') +
      '<textarea id="apv-msg" rows="3" maxlength="1000" placeholder="Note for the approver (optional): what changed and why"></textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="apv-send">Send for approval</button></div>', 'apv-modal');
    var send = m.querySelector('#apv-send');
    send.addEventListener('click', function () {
      send.disabled = true; send.textContent = 'Sending…';
      RevampCore.requestApproval(eventId, m.querySelector('#apv-msg').value).then(function (r) {
        m.remove();
        siteInfo.pending = { id: r.id, toVersion: r.toVersion, requestedBy: (pending && pending.requestedBy) || 'you' };
        renderSiteState();
        var link = r.reviewUrl || (location.origin + r.reviewPath);
        var d = modal(
          '<div class="modal-body"><div class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg></div>' +
          '<h3>' + (r.updated ? 'Request updated' : 'Sent for approval') + '</h3>' +
          '<p>Version ' + r.toVersion + ' — ' + escHtml(r.summary || 'changes') + '. Share this link with the approver: it lists what changed, who changed it, and shows the live site beside the new one.</p>' +
          '<span class="url" id="apv-link">' + escHtml(link) + '</span></div>' +
          '<div class="modal-foot"><button class="btn btn-secondary" id="apv-copy">Copy link</button>' +
          '<a class="btn btn-primary" href="' + escHtml(r.reviewPath) + '" target="_blank" rel="noopener">Open review page</a></div>', 'apv-modal');
        d.querySelector('#apv-copy').addEventListener('click', function () {
          var btn = this;
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { btn.textContent = 'Copied'; }, function () {
            var range = document.createRange(); range.selectNodeContents(d.querySelector('#apv-link'));
            var sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); btn.textContent = 'Select and copy';
          });
        });
      }, function (err) {
        send.disabled = false; send.textContent = 'Send for approval';
        showToast('Could not send for approval — ' + (err && err.message ? err.message : 'please try again.'), { kind: 'error' });
      });
    });
  }

  /* Every way out of the editor that this page starts itself (the event rail, Back to events) comes through
     here, so what is still pending is recorded before the page goes. */
  function leave(url) {
    flush();
    location.href = url;
  }

  window.RevampTemplateUI = {
    openDevZone: openDevZone,
    open: open, leave: leave, handoffFor: handoffFor,
    setDevice: setDevice, openPreview: openPreview, publish: publish, save: saveToStaging, siteState: function () { return { info: siteInfo, dirty: isDirty() }; }, undo: undo, redo: redo, flush: flush,
    addRepeatItem: addRepeatItem, removeRepeatItem: removeRepeatItem,
    getDesign: getDesign, setDesign: setDesign, designOptions: designOptions, checkImageUrl: checkImageUrl, themesInfo: themesInfo, applyTheme: applyTheme,
    selectedStyle: selectedStyle, styleSelected: styleSelected,
    listSections: listSections, librarySections: librarySections, selectSection: selectSection, moveSection: moveSection,
    setHidden: setHidden, duplicateSection: duplicateSection, deleteSection: deleteSection, renameSection: renameSection,
    insertSection: insertSection, addBlock: addBlock,
    hasAiProvenance: hasAiProvenance, aiProvenanceSections: aiProvenanceSections, setAiMarkers: setAiMarkers
  };
})();
