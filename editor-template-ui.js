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
     (asks first), renameSection(el, name), insertSection({ libraryId } | { name, html, plain }, afterEl)
     addBlock(kind, opts) adds a heading / text / button / image / divider / spacer / form where the selection is
     (a form: opts.formId, else the owner picks one; opts.section to add to another section than the selected one).
   Forms (editor-forms.js has the event's forms): formsChanged(), onFormsChange(fn), unlinkForm(formId),
     placeFormSection(formId, afterEl), revealElement(el).
   Design, for the page's Design panel and style toolbar (every change is one undo step):
     getDesign(key), setDesign(key, value) -> false (and says why) when the site has nothing for that setting
     to act on; designOptions() -> { swatches, fonts: [{ label, stack }], unsupported: { key: reason } };
     checkImageUrl(url) -> Promise<{ url } | { error }> for a picture given by its address.
     selectedStyle() -> { fontFamily, fontSize, fontWeight, color } of the selected text or button, or null;
     styleSelected({ fontFamily, fontSize, fontWeight, color }) restyles that one element.
     host.onDesignChange() is called whenever the design shown by those may have changed, and
     host.onSelectionChange({ kind, canStyle } | null) whenever another element, or none, is selected;
     host.styleSelection(button) opens the selected text's own font, size, weight and color under the "Aa" of its
     toolbar (UX-075).
   Internal pages (templates/_shared/rv-pages.js): a site whose page carries <meta name="rv-pages"> has a page
   switcher in the top bar; the canvas shows one page at a time (the top bar and footer on every page), the
   section list, moves and the section picker work on the page shown, and a section added there is on that page.
   pages() -> [{ slug, title }], currentPage() -> slug | "home", showPage(slug). Saving keeps one document.
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
  /* the page itself changed (a new undo step, an undo / redo, a canvas put back): editor-ai-mode.js redraws
     its live view from it — see onChange() */
  var changeListeners = [];
  function pageChanged() {
    drawFormPreviews(true);
    // the AI pills are the editor's drawing too: a section put back by Undo gets its pill again (UX-104)
    if (aiMarkersOn) renderAiProvenanceBadges();
    drawHeroVideo();
    changeListeners.forEach(function (fn) { try { fn(); } catch (err) { if (window.console) console.error(err); } });
  }
  /* An embedded form shows a preview of its fields on the canvas (editor-forms.js). A page put back from an undo
     step, or a block just added, has none yet: missingOnly draws only those. The preview is never part of a
     snapshot (editor-canvas.js nodeHtml), so drawing it changes nothing that is recorded. */
  function drawFormPreviews(missingOnly) {
    if (!canvas || remounting || !window.RevampEditorForms) return;
    try { RevampEditorForms.drawPreviews(canvas.doc, missingOnly ? { missingOnly: true } : null); } catch (err) { if (window.console) console.error(err); }
  }
  /* The event's banner video (Design › Banner video, hero-video-ui.js): its still picture with a "Video
     background" badge on the canvas's banner. Like a form's preview it is the editor's own (data-rv-editor, never
     saved, never in a snapshot), so drawing it again after every change records nothing; nothing plays while
     editing. heroVideoChanged(hv) is called by the Design panel after each save: the canvas and the "Edit with
     AI" live view (which asks the server, where the video is put on the page) show it at once. */
  var heroVideo = null;
  function drawHeroVideo() {
    if (!canvas || remounting || !window.RevampHeroVideoUI) return;
    try { RevampHeroVideoUI.drawCanvas(canvas.doc, heroVideo); } catch (err) { if (window.console) console.error(err); }
  }
  function heroVideoChanged(hv) {
    heroVideo = hv || null;
    drawHeroVideo();
    changeListeners.forEach(function (fn) { try { fn(); } catch (err) { if (window.console) console.error(err); } });
  }
  /* the event's forms changed (made, edited, deleted — in the Forms panel or by the AI): the live view of
     "Edit with AI" draws the page again with them (editor-ai-mode.js) */
  var formsListeners = [];
  function formsChanged() {
    drawFormPreviews(false);
    formsListeners.forEach(function (fn) { try { fn(); } catch (err) { if (window.console) console.error(err); } });
  }
  function formsApi() { return window.RevampEditorForms || null; }
  function formName(id) { var f = formsApi() && formsApi().get(id); return f ? f.name : ''; }
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
    setOpening('Loading the event…');
    if (!eventId) { currentEvent = null; return boot(urlTemplateId); }
    prefetchApproval();
    return RevampCore.fetchEvent(eventId).then(function (ev) {
      currentEvent = ev;
      heroVideo = ev.heroVideo || null;
      renderTopbar();
      if (host.onEvent) host.onEvent(ev);
      var tplId = (ev.site && ev.site.templateId) || ev.templateId || urlTemplateId;
      if (!tplId) { showLoadError(noSiteError()); return false; }
      if (tplId !== urlTemplateId) {
        /* the address names another site than the event's own, or none (the event rail's Design link carries only
           the event, so the console is not loaded first just to look it up — UX-077): the address is put right in
           place and the site opens at once, without loading this page, and the event, a second time */
        try {
          var url = new URL(location.href);
          url.searchParams.set('template', tplId);
          history.replaceState(history.state, '', url.href);
        } catch (e) { /* the address stays as it was; the event's own site opens either way */ }
        urlTemplateId = tplId;
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
    setOpening('Loading the site…');
    return RevampCanvas.mount(frame, templateId, mountOpts).then(function (c) {
      canvas = c;
      setOpening('Opening the latest version…');
      return resolveInitialContent();
    }).then(function () {
      noteOpening();
      // real Content-tab data (speakers/partners/faq/contacts/glimpses) overlaid on top of whatever base
      // content resolveInitialContent() just settled on — see applySubcollectionOverlay()'s own comment.
      setOpening('Adding your Content-tab records…');
      var seen = recordsSeen(), was = undoStack[undoPtr];
      return applySubcollectionOverlay().then(function () {
        // named only when a visitor would see it: a page the records left as its saved version has nothing to name (drawRecords)
        if (canvas && was && !canvas.sameSnapshot(undoStack[undoPtr], was) && !(savedMark && savedMark.hash === snapHash(undoStack[undoPtr]))) noteAuto(recordsNamed(seen));
      });
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
      /* what the editor puts right by itself (the ET logo's version, heading sizes) is part of the page as it opened,
         named in the chip and saved apart from the person's changes (bakeAuto, UX-076); never while ETB2B AI is
         applying a change, when the page holds half of it */
      var putRight = [];
      if (syncEtLogos()) putRight.push('the ET logo and menu');
      if (calmHeadings()) putRight.push('heading sizes');
      if (putRight.length) bakeAuto(putRight);
      [400, 1500].forEach(function (ms) { setTimeout(function () { if (canvas && !remounting && !aiWorking && syncEtLogos()) bakeAuto(['the ET logo and menu']); }, ms); });
      /* opened from the preview's "Apply in editor": that theme */
      var askedTheme = new URLSearchParams(location.search).get('theme');
      var ti = themesInfo();
      if (askedTheme && ti && ti.current !== askedTheme) setTimeout(function () { applyTheme(askedTheme); }, 600);
      /* the section edges this site is kept in, shown on the canvas; or the ones the preview's "Apply in editor" asked for */
      var askedEdges = new URLSearchParams(location.search).get('edges');
      showSectionEdges(savedSectionEdges());
      if ((askedEdges === 'smooth' || askedEdges === 'sharp') && sectionEdgesInfo() && askedEdges !== savedSectionEdges()) {
        setTimeout(function () { applySectionEdges(askedEdges); }, 700);
      }
      updateHistoryButtons();
      renderTopbar();
      sectionsChanged();
      designChanged();
      drawFormPreviews(false);
      drawHeroVideo();
      /* Preview and Publish stay disabled until the site is mounted AND filled: pressed any earlier they
         would capture the template's own placeholder text. With no event there is nothing to publish to. */
      document.getElementById('btn-publish').hidden = !eventId;
      document.getElementById('btn-publish').disabled = !eventId;
      document.getElementById('btn-preview').disabled = false;
      settleAuto();
      loadSiteInfo().then(saveFirstVersion);
      ownerLogoOffer();
      logoUnitNotice();
      setOpening(null);
      focusAskedSection();
      /* ETB2B AI's hero picture, last: the event's records are part of the first step by now (drawRecords bakes
         them into it), so the picture's own step, and its Undo, hold the picture alone */
      if (pendingAiHero) { var heroDraft = pendingAiHero; pendingAiHero = null; applyAiHero(heroDraft); }
      return true;
    }).catch(function (err) {
      if (window.console) console.error(err);
      if (canvas) { canvas.destroy(); canvas = null; }
      showLoadError(siteLoadError(err));
      return false;
    });
  }

  /* Opened from the event console at one of the site's sections (edit-event.html editorAt: "Open “Previous Edition
     Speakers” in the site editor", UX-067): that section, selected and scrolled into view once the page has laid out.
     ?section= names its key (data-rv-key) or its id; one the page does not have opens the editor as usual. */
  function focusAskedSection() {
    var asked = new URLSearchParams(location.search).get('section');
    if (!asked || !canvas) return;
    var sec = canvas.sections().filter(function (el) {
      return el.getAttribute('data-rv-key') === asked || el.getAttribute('data-rv-section') === asked;
    })[0];
    if (sec) setTimeout(function () { if (isLive(sec)) selectSection(sec); }, 400);
  }
  /* ---------- while the site opens (UX-077) ----------
     Until the site is on the canvas, filled with the event's own content, the canvas says so — the event's name
     and the step under way (#stage-loading in custom_editor.html) — and the editor's tools wait, marked unavailable
     (the page's own handlers check data-opening). step: the line under way; null once it is over either way (the
     site is open, or a lasting message stands in its place). */
  function setOpening(step) {
    var on = step !== null && step !== undefined;
    var root = document.querySelector('.ed'), main = document.querySelector('.ed-main'), box = document.getElementById('stage-loading');
    if (root) { if (on) root.setAttribute('data-opening', ''); else root.removeAttribute('data-opening'); }
    if (main) { if (on) main.setAttribute('aria-busy', 'true'); else main.removeAttribute('aria-busy'); }
    Array.prototype.forEach.call(document.querySelectorAll('.ed-rail button'), function (b) {
      if (on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    });
    if (!box) return;
    box.hidden = !on;
    if (!on) return;
    var title = document.getElementById('stage-loading-title'), line = document.getElementById('stage-loading-step');
    var name = currentEvent && currentEvent.name;
    if (title) title.textContent = name ? 'Opening ' + name + '…' : eventId ? 'Opening the site…' : 'Opening the design…';
    if (line) line.textContent = step;
  }
  /* Who approves, which version is live and what waits for approval (GET /api/event/approval): asked as the editor
     opens, beside the event and the site, not after everything else — the Save button and the state chip beside it
     come with the site (UX-077). loadSiteInfo() takes the answer. (Publish asks again, fresh, in publish-flow.js.) */
  var approvalAsk = null;
  function prefetchApproval() {
    approvalAsk = eventId && window.RevampCore && RevampCore.fetchApproval ? RevampCore.fetchApproval(eventId) : null;
    // answered before loadSiteInfo() is there to take it: a refusal is not left unhandled meanwhile
    if (approvalAsk) approvalAsk.then(null, function () {});
  }

  /* ---------- when the site cannot be opened ----------
     A lasting panel where the canvas would be, saying what happened in the owner's words and offering what can
     be done about it. Nothing is mounted behind it, so Preview and Publish stay disabled and the tools that act
     on a site are put away. */
  function showLoadError(spec) {
    clearLoadError();
    setOpening(null);
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
    // cut short in a narrow top bar: the whole line is in its tooltip (UX-078)
    if (metaEl) { metaEl.textContent = meta; metaEl.title = meta; }
    document.title = (name ? name + ' - ' : '') + 'Site editor';
    // the canvas's "Opening \u2026" names the event as soon as it is known
    var opening = document.getElementById('stage-loading-title');
    if (opening && name && ev && document.querySelector('.ed[data-opening]')) opening.textContent = 'Opening ' + name + '\u2026';
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
      pendingAiHero = draft;      // put in at the end of boot(), as a step of its own
      /* what Create Event handed over for a gallery design is saved as the site's first version once the page is
         ready (saveFirstVersion): the person's content is then on the server, for every computer and colleague, as
         Create Event's "Saving your event" screen says (an imported design, handed over with no sections, is marked in
         resolveFromBrowser). A generated site ("gen-") is not: its page is made on the server, and Create Event's
         brief path never shows that screen. */
      if (fromCreate() && !/^gen-/.test(templateId || '')) firstSaveDue = true;
    });
  }
  var pendingAiHero = null;
  var firstSaveDue = false;
  /* The first save of a site Create Event has just filled. Create Event says it saves the event; until this, the
     page it filled lived in this browser only, and any other browser opened the design's empty sample. Only for a
     site never saved before (another saved version is never replaced from here), and quietly: the chip beside Save
     then says "v1 · saved to staging". When it cannot be saved, the person is told it is in this browser only. */
  var FIRST_SAVE_DELAY_MS = 1700;   // after the page's own touch-ups as it opens (the ET logo in its right version, at 400 and 1500 ms)
  function saveFirstVersion() {
    if (!firstSaveDue || !canvas || !eventId) return;
    firstSaveDue = false;
    setTimeout(function () {
      if (!canvas || !eventId) return;
      // never over a version saved already: the server's answer, and the event's own record of its site
      var everSaved = (siteInfo && siteInfo.savedVersion) || (currentEvent && currentEvent.site && +currentEvent.site.version);
      if (!siteInfo || everSaved) return;
      saveToStaging({ quiet: true }).then(null, function (err) {
        if (err && err.cancelled) return;
        showNotice('first-save', { kind: 'warn', dismissible: true,
          text: 'Your page could not be saved to the server yet, so it is only in this browser. Press Save to keep it for every computer.' });
      });
    }, FIRST_SAVE_DELAY_MS);
  }

  /* ETB2B AI's hero picture from the event's own record (events/<id>.aiHero, functions/lib/ai-hero.js), for an editor
     that opens with no copy of the site in this browser and no hand-off: the person changed browser (or cleared it)
     before saving, and the hand-off's picture lived only in the other browser's copy (QA follow-up 2). It is put in
     exactly as the hand-off puts it (applyAiHero: one step of its own, which Undo takes back to the design's own
     picture). Only while no site has ever been saved: a saved site is what the person chose, picture or not.
     A picture that did not pass its check (status 'held') was never stored: the person is told so, in the server's
     words ("No hero picture was made: …"), as the hand-off tells them.
     -> { aiHero: { url, subject } }, { aiHero: { note } } or null */
  function aiHeroFromEvent() {
    var ev = currentEvent, h = ev && ev.aiHero;
    if (!eventId || !h || typeof h !== 'object') return null;
    if (ev.site && +ev.site.version > 0) return null;
    if (h.status === 'held' && typeof h.why === 'string' && h.why.indexOf('No hero picture was made') === 0) {
      return { aiHero: { note: h.why.slice(0, 300) + ' The design\u2019s own picture is in place: you can change it here, or ask ETB2B AI for a new one.' } };
    }
    if (h.status !== 'made' || typeof h.url !== 'string' || !h.url) return null;
    return { aiHero: { url: h.url, subject: typeof h.subject === 'string' ? h.subject : '' } };
  }

  /* ETB2B AI's hero picture, for an event it started on the events dashboard: made on the server once Create Event
     had created the event (functions/lib/ai-hero.js), and brought here by the hand-off (draft.aiHero). It goes in
     AFTER the first undo step (at the end of boot(), once the records' overlay is in that step too), as a step of
     its own, so Undo (the toast's, or the top bar's) brings the design's own picture back. Only this event's own stored picture is ever put in. A hand-off that says why no picture was
     made gets that note, said plainly. -> true when the picture was put in */
  function applyAiHero(draft) {
    var a = draft && draft.aiHero;
    if (!a || typeof a !== 'object' || !canvas) return false;
    if (typeof a.note === 'string' && a.note) { showToast(a.note.slice(0, 400)); return false; }
    var url = typeof a.url === 'string' ? a.url : '';
    var own = 'https://storage.googleapis.com/';
    if (url.indexOf(own) !== 0 || url.indexOf('/events/' + eventId + '/generated/') === -1 || /[\s"'<>()]/.test(url)) return false;
    var els = heroPictureEls();
    if (!els.length) { showToast('ETB2B AI made a hero picture, but this design has no place for one.'); return false; }
    els.forEach(function (el) { canvas.setPicture(el, url); });
    if (!commitNow()) return false;
    var subject = typeof a.subject === 'string' ? a.subject.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    offerUndo('ETB2B AI made this hero picture' + (subject ? ': ' + subject : '') + '. Undo puts the design\u2019s own picture back.');
    return true;
  }
  /* The hero's picture on this design: what its content.map hero rule fills with the event's banner
     ({hero.bannerUrl}, or a generated site's {hero.psdBanner.compositeImageData}), in every copy of the section. */
  function heroPictureEls() {
    var map = (canvas.template && canvas.template.content && canvas.template.content.map) || [], out = [];
    map.forEach(function (m) {
      if (!m || m.from !== 'hero' || !m.section) return;
      (m.fill || []).forEach(function (r) {
        if (!r || typeof r.attr !== 'string' || r.name !== 'src' || !/\{hero\.(?:bannerUrl|psdBanner\.compositeImageData)\}/.test(String(r.value || ''))) return;
        Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-section="' + m.section + '"]'), function (sec) {
          var found = r.attr === ':self' ? [sec] : sec.querySelectorAll(r.attr);
          Array.prototype.forEach.call(found, function (el) { if (out.indexOf(el) === -1) out.push(el); });
        });
      });
    });
    return out;
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
  var draftFetch = null;         // asked once per opening: the server-first check and the rules below share it
  function fetchServerDraft() {
    if (draftFetch) return draftFetch;
    draftFetch = fetch('/api/draft?eventId=' + encodeURIComponent(eventId))
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) { return res.ok ? res.body : null; })
      .catch(function () { return null; });
    return draftFetch;
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

  /* ---------- which copy opens ----------
     The site saved on the server (GET /api/event/site) is the truth: every browser and every colleague opens the
     latest saved version. This browser's copy is a cache and a buffer for work not saved yet; it is opened instead
     only while it holds changes of the person's own made on that same version, and when it holds changes made on
     an older one the person is asked (workSafety.openPlan). A new Create Event result, a site that has never been
     saved, or a saved site that cannot be read, goes by this browser's copy as before (resolveFromBrowser). */
  function fetchSavedSite() {
    if (!eventId) return Promise.resolve(null);
    // the event says when its site has never been saved: nothing to ask for (a save made since is asked about on Save)
    if (currentEvent && !(currentEvent.site && +currentEvent.site.version)) return Promise.resolve(null);
    return RevampCore.fetchSite(eventId).then(function (site) { return site || null; }, function (err) {
      if (window.console) console.warn('[RevampTemplateUI] The saved site could not be read; this browser\'s copy is shown:', err);
      return undefined;
    });
  }
  function resolveInitialContent() {
    draftFetch = null;
    return Promise.all([localGet(storeKey), fetchSavedSite()]).then(function (got) {
      var saved = got[0], site = got[1];
      savedMark = readMark();
      if (site === undefined) {
        showNotice('saved-site', { kind: 'warn', dismissible: true,
          text: 'The version saved on the server could not be checked, so this browser\'s copy is shown. Reload to check again before you save.' });
      }
      var created = (site && site.eventCreatedAt) || (currentEvent && currentEvent.createdAt) || null;
      // a copy this browser kept for an earlier event at the same address is not this event's
      if (saved && saved.eventCreatedAt && created && saved.eventCreatedAt !== created) saved = undefined;
      var newRun = isNewRun(saved);
      var gen = /^gen-/.test(templateId || '');
      var generation = gen && site && site.snapshot && !newRun ? fetchServerDraft() : Promise.resolve(null);
      return generation.then(function (res) {
        var generationNewer = !!(res && res.draftId && site && Date.parse(res.generatedAt || '') > Date.parse(site.updatedAt || ''));
        var plan = workSafety.openPlan({ site: site, templateId: templateId, local: saved, mark: savedMark, hash: snapHash, newRun: newRun, generationNewer: generationNewer });
        baseVersion = plan.baseVersion;
        if (plan.take === 'server') return takeSavedSite(site, saved, res, plan.why);
        if (plan.take === 'ask') return askAboutOlderCopy(saved, site, res, plan);
        return resolveFromBrowser(saved);
      });
    });
  }
  /* this open puts a Create Event result on the page: a new run for this event, or the hand-off of its first one */
  function isNewRun(saved) {
    if (!fromCreate()) return false;
    var draftId = new URLSearchParams(location.search).get('draft') || null;
    if (saved && saved.snapshot) return !!(draftId && saved.sourceDraftId !== draftId);
    var handed = readHandoffDraft();
    return !!(handed && handed.sections && handed.sections.length);
  }
  /* The saved version on the canvas, as the first step: nothing is unsaved. why 'newer': this browser had an older
     copy, so the person is told which version opened. */
  function takeSavedSite(site, saved, res, why) {
    canvas.restore(site.snapshot, restoreOpts());
    // read back, as restoreLocal does: the first step is the page as it stands, so opening is not a change
    undoStack = [canvas.snapshot(site.snapshot)]; undoPtr = 0;
    // the generation it was saved after, so a later regeneration is still told apart (resolveFromBrowser)
    sourceDraftId = (res && res.draftId) || (saved && saved.sourceDraftId) || sourceDraftId;
    onSavedVersion(site.version);
    if (why === 'newer') showToast('Opened version ' + site.version + (site.updatedBy ? ', saved by ' + site.updatedBy : '') + (site.updatedAt ? ' on ' + when(site.updatedAt) : '') + '.');
  }
  /* This browser holds changes made on an older version than the one saved: the person chooses. The page behind
     the question is this browser's copy; "Open version N" puts the saved one on top of it as a step, so Undo brings
     the copy back while the editor stays open. */
  function askAboutOlderCopy(saved, site, res, plan) {
    canvas.restore(saved.snapshot, restoreOpts());
    var mine = canvas.snapshot(saved.snapshot);
    undoStack = [mine]; undoPtr = 0;
    sourceDraftId = saved.sourceDraftId || null;
    localEdited = true;
    var words = workSafety.olderCopyWords({ base: plan.baseVersion, localAt: saved.savedAt ? when(new Date(+saved.savedAt).toISOString()) : '',
      version: site.version, by: site.updatedBy || '', at: site.updatedAt ? when(site.updatedAt) : '' });
    return ask({ title: words.title, text: words.text, more: words.more, modal: true, actions: [
      { key: 'keep', label: words.keep, kind: 'secondary' },
      { key: 'open', label: words.open, kind: 'primary', autofocus: true }
    ] }).then(function (answer) {
      if (answer !== 'open') return;          // kept: Save asks before it replaces the newer version (baseVersion)
      canvas.restore(site.snapshot, restoreOpts());
      undoStack = [mine, canvas.snapshot(site.snapshot)]; undoPtr = 1;
      sourceDraftId = (res && res.draftId) || sourceDraftId;
      onSavedVersion(site.version);
      showToast('Opened version ' + site.version + '. Undo brings back this browser\'s changes.');
    });
  }

  function resolveFromBrowser(saved) {
    return Promise.resolve().then(function () {
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
        // a copy from before this was kept may hold anything of the person's own
        localEdited = saved.edited !== false;
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
        /* An imported design is one finished page, so Create Event hands it over with no sections: the page as it
           mounts is the person's page. It is still saved as the site's first version (saveFirstVersion), as the
           "Saving your event" screen promises, so it opens the same on any computer. Only when this browser has this
           event's own hand-off, which shows the event was just made here; without one (another browser) nothing is saved. */
        if (draft && /^imported-/.test(templateId || '')) {
          return seedSnapshot(null).then(function (kept) {
            if (kept) forgetHandoff();
            pendingAiHero = draft;
            firstSaveDue = true;
          });
        }
        /* a hand-off with no sections may still bring ETB2B AI's hero picture: put in at the end of the boot, as above.
           With no hand-off in this browser at all, the event's own record brings it (aiHeroFromEvent) */
        return seedSnapshot(null).then(function () { pendingAiHero = draft || aiHeroFromEvent(); });
      }

      if (!/^gen-/.test(templateId || '')) {
        if (saved && saved.snapshot) { restoreLocal(); return; }
        /* no copy of the site in this browser: ETB2B AI's hero picture, when the event has one and no site was ever
           saved, goes in as the hand-off puts it (aiHeroFromEvent) */
        return seedSnapshot(null).then(function () { pendingAiHero = aiHeroFromEvent(); });
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
  /* every card drawn from a record carries the record's id (RevampFill writes it as data-rv-id): the editor knows
     the card is managed in Content, and the approval page can name the record that was added, changed or removed */
  function recId(r) { return r && r.id != null ? String(r.id) : ''; }

  function translateSpeakers(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (p) { return { id: recId(p), n: p.name || '', r: p.desig || '', c: p.comp || '', photo: p.photoUrl || '' }; }) };
  }
  function translateFaqs(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (f) { return { id: recId(f), t: f.question || '', d: f.answer || '' }; }) };
  }
  /* the caption too: the glimpses' fill rules print it ({caption}), and a glimpse that came with one keeps it */
  function translateGallery(items) {
    if (!items || !items.length) return null;
    return { items: items.map(function (g) { return { id: recId(g), url: g.imageUrl || '', caption: g.caption || '' }; }) };
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
      byLabel[label].people.push({ id: recId(c), n: c.name || '', e: c.email || '', p: c.phone || '' });
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
    // each sponsor's logo and link as well as its name: the partners' fill rules show the logo ({logo}) and link it
    // ({url}), and drawing the Content's sponsors without them put names where their logos had been
    partners.slice().sort(byOrder).forEach(function (p) {
      (slots[p.tierId] || fallback).logos.push({ id: recId(p), n: p.name || '', logo: p.logoUrl || '', url: p.url || '' });
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
     rather than wiping it. The rules themselves are templates/_shared/rv-records.js (RevampRecords), the
     same ones the server draws a saved site's lists with when Content changes (functions/lib/site-records.js),
     so a record looks the same whichever of the two drew it. */
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
  var GENERIC_REPEAT_SOURCES = {};
  RevampRecords.KINDS.forEach(function (kind) {
    GENERIC_REPEAT_SOURCES[kind] = { resources: RevampRecords.SOURCES[kind], translate: RevampRecords.translate[kind] };
  });

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
     A value the record does not have is never the design's sample: see the comments below. */
  function setGenericRepeatField(fieldEl, field, value, kind) {
    var isImage = field === 'photo' || field === 'logo' || field === 'imageUrl';
    var isLink = (kind === 'partners' && field === 'url') || (kind === 'speakers' && field === 'li');
    if (!value) {
      /* A picture or link the record does not have is taken away, whether the model is the design's sample item or
         a card drawn from an earlier record: either way it is not this record's (a sample person's photo, another
         partner's logo, a "#" link, the last speaker's LinkedIn on a hidden link). The server draws the same way
         (functions/lib/site-records.js), so drawing the same records again changes nothing. */
      if (isLink && fieldEl.tagName === 'A') fieldEl.removeAttribute('href');
      if (isImage) {
        if (fieldEl.tagName === 'IMG') fieldEl.removeAttribute('src'); else fieldEl.style.backgroundImage = '';
        return;
      }
      /* A record's text field that has nothing is cleared and hidden: the design's sample words ("Session
         description goes here", "Speaker names") are never the event's, and visitors would read them (the
         owner, 23 Oct 2026). */
      if (!fieldEl.querySelector('[data-rv-field]')) {
        fieldEl.textContent = ''; fieldEl.setAttribute('hidden', '');
        /* its line goes too when all that is left in it is a label ("Speakers" over nothing) */
        var line = labelOnlyLine(fieldEl);
        if (line) { line.setAttribute('hidden', ''); line.setAttribute('data-rv-empty-line', ''); }
      }
      return;
    }
    if (isImage) {
      if (fieldEl.tagName === 'IMG') fieldEl.src = value;
      else fieldEl.style.backgroundImage = 'url(' + value + ')';
      return;
    }
    if (isLink) {
      if (fieldEl.tagName === 'A') fieldEl.href = value;
      else fieldEl.textContent = value;
      return;
    }
    fieldEl.removeAttribute('hidden');
    var hiddenLine = fieldEl.parentElement && fieldEl.parentElement.closest('[data-rv-empty-line]');
    if (hiddenLine) { hiddenLine.removeAttribute('hidden'); hiddenLine.removeAttribute('data-rv-empty-line'); }
    if ('value' in fieldEl) fieldEl.value = value;
    else fieldEl.textContent = value;
  }
  /* The element holding an empty field when it holds nothing else of a record's — no other field, no picture —
     and no more words than a label: that line shows only "Speakers" or "Room" over nothing. -> it, or null */
  function labelOnlyLine(fieldEl) {
    var line = fieldEl.parentElement;
    if (!line || line.hasAttribute('data-rv-repeat-template') || line.hasAttribute('data-rv-item') || line.hasAttribute('data-rv-section')) return null;
    if (line.querySelector('[data-rv-field]:not([hidden]), img, picture, svg, video, a[href], button')) return null;
    var words = (line.textContent || '').replace(/\s+/g, ' ').trim();
    return words.length <= 30 ? line : null;
  }

  function fillGenericRepeatClone(clone, item, kind) {
    var fields = clone.hasAttribute('data-rv-field') ? [clone] : [];
    fields = fields.concat(Array.prototype.slice.call(clone.querySelectorAll('[data-rv-field]')));
    fields.forEach(function (fieldEl) {
      var field = fieldEl.getAttribute('data-rv-field');
      setGenericRepeatField(fieldEl, field, item[field], kind);
    });
    if (kind === 'speakers') setSpeakerProfile(clone, item.profile);
    if (kind === 'sessions') {
      clone.setAttribute('data-rv-day', item.dayKey || '');
      if (item.dayName) clone.setAttribute('data-rv-day-name', item.dayName); else clone.removeAttribute('data-rv-day-name');
      if (item.dayDate) clone.setAttribute('data-rv-day-date', item.dayDate); else clone.removeAttribute('data-rv-day-date');
    }
    clone.setAttribute('data-rv-filled', '');
    /* the record it shows, so the approval page names a record that was added, changed or removed (page-diff.js) */
    if (item.id) clone.setAttribute('data-rv-id', item.id); else clone.removeAttribute('data-rv-id');
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
  /* The notice says it in the owner's words, at a size that reads on the scaled-down canvas (16px there is about
     13px on screen), with the place to add them as a link: a click on it opens that Content tab in a new tab, a
     click anywhere else on the notice selects it and the toolbar says the same (recordOf). */
  function fillEmptyNote(note, kind, whole) {
    var tab = RevampRecords.TABS[kind];
    note.textContent = (tab ? 'No ' + tab.many + ' yet' : 'Nothing to show yet') + ': visitors do not see this ' + (whole ? 'section' : 'list') + ' until there are some. ';
    if (!tab) return;
    var link = note.ownerDocument.createElement('span');
    link.setAttribute('data-rv-content-link', '');
    link.textContent = 'Add ' + tab.many + ' in ' + tab.label + ' ↗';
    note.appendChild(link);
  }
  function emptyPlaceOf(listParent) {
    var sec = listParent.closest('[data-rv-section]');
    if (!sec) return listParent;
    var words = (sec.innerText || sec.textContent || '').replace(/\s+/g, ' ').trim().length;
    var listWords = (listParent.innerText || listParent.textContent || '').replace(/\s+/g, ' ').trim().length;
    return words - listWords <= 600 ? sec : listParent;
  }
  function markEmpty(doc, kind) {
    /* a button that opens a form (Register, or any other form) is never hidden with an empty section (pages
       saved before this rule may carry the mark) */
    Array.prototype.forEach.call(doc.querySelectorAll('a[data-register-cta][data-rv-nav-empty], a[data-rv-form][data-rv-nav-empty]'), function (a) { a.removeAttribute('data-rv-nav-empty'); });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-repeat-template="' + kind + '"]'), function (el) {
      var parent = el.parentNode;
      if (!parent || parent.querySelector(':scope > [data-rv-empty-state]')) return;
      var place = emptyPlaceOf(parent);
      // a section with a form in it, or a button that opens one, is never hidden as empty: only the empty list is
      if (place !== parent && holdsForm(place)) place = parent;
      place.setAttribute('data-rv-empty', kind);
      var note = doc.createElement('div');
      note.setAttribute('data-rv-empty-state', kind);
      note.setAttribute('data-rv-editor', '');
      note.setAttribute('data-ed', 'none');
      note.setAttribute('style', 'margin:12px 0;padding:12px 16px;border:1px dashed rgba(128,128,128,.6);border-radius:8px;font:500 16px/1.5 Inter,Arial,sans-serif;color:inherit;opacity:.9;cursor:pointer');
      fillEmptyNote(note, kind, place !== parent);
      parent.insertBefore(note, parent.firstChild);
      /* marked as a whole now: a mark the list itself had from an earlier rule is not needed */
      if (place !== parent && parent.getAttribute('data-rv-empty') === kind) parent.removeAttribute('data-rv-empty');
      if (place !== parent && place.id) {
        Array.prototype.forEach.call(doc.querySelectorAll('a[href="#' + place.id + '"]'), function (a) {
          /* the menu's links only: a button elsewhere ("Join as partner") still stands for something real, and
             a Register button opens the registration form wherever its address points */
          if (!a.hasAttribute('data-register-cta') && !a.hasAttribute('data-rv-form') && a.closest('[data-rv-section="nav"], [data-rv-section="footer"]')) a.setAttribute('data-rv-nav-empty', '');
        });
      }
    });
  }
  /* A section holding a form — one drawn in place, or a button that opens one — is never hidden as empty; the
     page's own runtime and the server decide the same way (et-runtime.js emptySections, functions/lib/
     site-records.js holdsForm). A Register button holds it only when it is the page's only way to register: under
     an empty agenda it is one of many, and the section goes with its empty list instead of showing a heading, day
     chips and a button over nothing (UX-147). A form or a button can arrive after the section was marked as a
     whole (the Forms panel, the link pop-over, the AI): before every recorded step the mark moves from such a
     section to its empty list, so the page that is saved, previewed and published shows the button and the form. */
  var FORM_HOLDERS = 'a[data-rv-form], a[data-register-cta], [data-rv-form-embed]';
  function holdsForm(el) {
    return Array.prototype.some.call(el.querySelectorAll(FORM_HOLDERS), function (n) {
      if (n.closest('[data-rv-editor]')) return false;
      if (!n.hasAttribute('data-register-cta')) return true;
      return !Array.prototype.some.call(el.ownerDocument.querySelectorAll('a[data-register-cta]'), function (o) {
        return !el.contains(o) && !o.closest('[data-rv-editor], [data-rv-empty], .is-hidden-sec');
      });
    });
  }
  function keepFormSectionsShown(doc) {
    /* a link that now opens a form (it may have been a menu link to an empty section) is never hidden */
    Array.prototype.forEach.call(doc.querySelectorAll('a[data-rv-form][data-rv-nav-empty], a[data-register-cta][data-rv-nav-empty]'), function (a) { a.removeAttribute('data-rv-nav-empty'); });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-section][data-rv-empty]'), function (sec) {
      if (!holdsForm(sec)) return;
      var kind = sec.getAttribute('data-rv-empty');
      sec.removeAttribute('data-rv-empty');
      Array.prototype.forEach.call(sec.querySelectorAll('[data-rv-repeat-template="' + kind + '"]'), function (el) {
        var parent = el.parentNode;
        if (!parent || parent === sec || parent.nodeType !== 1) return;
        parent.setAttribute('data-rv-empty', kind);
        var note = parent.querySelector(':scope > [data-rv-empty-state]');
        if (note) fillEmptyNote(note, kind, false);
      });
      // the menu's links to the section come back with it
      if (sec.id) Array.prototype.forEach.call(doc.querySelectorAll('a[href="#' + sec.id + '"][data-rv-nav-empty]'), function (a) { a.removeAttribute('data-rv-nav-empty'); });
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
      var tpl = list.standing[0];
      var before = list.standing[list.standing.length - 1].nextSibling;
      var drawn = items.map(function (item) {
        var clone = tpl.cloneNode(true);
        clone.classList.remove('ed-selected', 'sec-active');
        fillGenericRepeatClone(clone, item, kind);
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

  /* The event's records (Content) drawn into the page as it stands, and nothing else: the undo history is not
     touched. -> Promise<true when anything was drawn>; rejected when the records could not be read or drawn.
     drawRecords is this and then the page's baseline; a change in progress uses it on its own (the check that a
     records section reworked around a new picture kept its records, in runAiTurn), since baking the baseline in
     the middle of a change would make its Undo step lose what came before it. */
  function fillRecords(sectionsAdded) {
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
      return changed;
    });
  }
  function drawRecords(sectionsAdded) {
    /* whether the page stands as the version it was saved as (Save has nothing to do), and what a visitor sees on it */
    var asSaved = !!(canvas && savedMark && savedMark.hash && savedMark.hash === snapHash(undoStack[undoPtr]));
    var seen = asSaved ? pageSeen(canvas.doc && canvas.doc.body) : '';
    return fillRecords(sectionsAdded).then(function (changed) {
      if (!changed) return;
      // bakes the overlay into THIS session's baseline, same as any other edit — so Ctrl+Z doesn't revert
      // past it, and it rides along in the snapshot persist() already saves for every other reason.
      var snap = canvas.snapshot(undoStack[undoPtr]);
      undoStack[undoPtr] = snap;
      /* Records drawn again that show what the page showed (on a page saved before records carried their ids, only
         those ids are new) leave it the saved version: no "Updated automatically" for what nobody would see, Save
         has nothing to do, and leaving asks nothing (UX-076). What a visitor would see is an update, told as one. */
      if (asSaved && pageSeen(canvas.doc && canvas.doc.body) === seen) writeMark({ version: savedMark.version, hash: snapHash(snap) });
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

  /* data-rv-ai-mark (UX-104): a pill drawn now is the editor's drawing, like an embedded form's preview — never part of
     a snapshot (editor-canvas.js nodeHtml) nor of the saved page — so drawing the pills when the switch is turned on,
     or again after an undo, records nothing and makes nothing "unsaved". An AI-designed site has always had the marks
     and never the pills (they were drawn only for a brief's draft): the switch now shows them there too. Pills saved
     inside a page before this (a brief's draft) stay as they were. */
  function renderAiProvenanceBadges() {
    if (!canvas || !canvas.doc) return;
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
      span.setAttribute('data-rv-ai-mark', '');
      span.innerHTML = AI_SPARK_SVG + '<span>AI-generated</span>';
      sec.insertBefore(span, sec.firstChild);
    });
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-ai-skipped]'), function (sec) {
      if (sec.querySelector(':scope > .ai-skip-badge')) return;
      var span = canvas.doc.createElement('span');
      span.className = 'ai-skip-badge';
      span.setAttribute('data-ed', 'none');
      span.setAttribute('data-rv-ai-mark', '');
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
      span.setAttribute('data-rv-ai-mark', '');
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
      /* a hidden section does not go live, so nobody is asked to check it */
      return Array.prototype.filter.call(canvas.doc.querySelectorAll('[' + attr + ']'), function (sec) {
        return !sec.classList.contains('is-hidden-sec');
      }).map(function (sec) {
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
    // the switch on and nothing to see was the finding (UX-104): the pills are drawn where they are missing
    if (aiMarkersOn) renderAiProvenanceBadges();
  }

  /* "Check what the AI wrote" (custom_editor.html): the sections ticked lose their mark, so the next Publish asks only
     about what nobody has checked yet, in any browser (UX-104). It is the person's own step: Publish saves it, as part
     of their save, or as a version of its own ("no visible change", in their name) when nothing else was unsaved, so
     the approver sees who checked them. (Kept as an automatic update instead, it was dropped whenever the page came
     out a byte different from the staged one — the server keeps an editor state only beside its own page — and the
     sections were asked about again, and still counted as unchecked by the console.) -> how many were marked */
  function markAiChecked(ids) {
    if (!canvas || remounting || aiWorking) return 0;
    var want = {}, n = 0;
    (ids || []).forEach(function (id) { if (id) want[id] = 1; });
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-ai-generated]'), function (sec) {
      var id = sec.getAttribute('data-rv-key') || sec.getAttribute('data-rv-section');
      if (!want[id]) return;
      sec.removeAttribute('data-ai-generated');
      n++;
    });
    if (n) commitNow();
    return n;
  }
  /* "Show" beside a section in that list: the dialog closes and the section is selected, in view */
  function showAiSection(id) {
    if (!canvas || !id) return false;
    var sec = Array.prototype.filter.call(canvas.doc.querySelectorAll('[data-rv-section]'), function (el) {
      return (el.getAttribute('data-rv-key') || el.getAttribute('data-rv-section')) === id;
    })[0];
    if (!sec) return false;
    selectSection(sec);
    return true;
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
    // what Create Event handed over is the person's own work, not saved yet; a page as it mounted is not
    localEdited = !!draft;
    var rec = localRecord(snap);
    rec.handoff = draft; rec.event = draft && draft.event;
    return localPut(storeKey, rec);
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
    return localPut(storeKey, localRecord(snap));
  }
  /* This browser's copy also says which saved version it was made on (baseVersion), whether it holds changes of
     the person's own (edited) and which event it belongs to (eventCreatedAt): what decides, when the editor next
     opens, between it and the version saved on the server (workSafety.openPlan). */
  function localRecord(snap) {
    return { eventId: eventId, templateId: templateId, savedAt: Date.now(), snapshot: snap, sourceDraftId: sourceDraftId, fillVersion: FILL_LOGIC_VERSION,
      baseVersion: baseVersion, edited: localEdited, eventCreatedAt: (currentEvent && currentEvent.createdAt) || null };
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


  /* automatic: a step the editor made by itself as the page opened (the ET logo in the right version, headings
     held to the type scale), not a change of the person's own — unless they were typing then */
  function record(typing, automatic) {
    clearTimeout(commitTimer); commitTimer = null;
    if (!canvas || remounting) return false;
    keepFormSectionsShown(canvas.doc);
    settlePlaceholders();
    var replacing = typing && typingPtr === undoPtr && undoPtr > 0;
    if (!typing) typingPtr = -1;
    var snap = canvas.snapshot(undoStack[undoPtr]);
    if (canvas.sameSnapshot(snap, undoStack[undoPtr])) return false;
    if (!automatic || editingEl) localEdited = true;
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
    pageChanged();
    logoUnitNotice();      // hidden, shown, deleted, taken back, rewritten: the notice follows the page
    return true;
  }
  function commitNow() { return record(false); }
  function commitTyping() { return record(true); }
  /* the editor's own update as the page opens; never while ETB2B AI is applying a change (the page holds half of it) */
  function commitAutomatic() { return aiWorking ? false : record(false, true); }

  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(function () { if (!aiWorking) commitNow(); }, 400);
  }

  /* While ETB2B AI is applying a change the page holds half of it: nothing is recorded then (its own one step
     comes when it is done), so flush() waits too. */
  function flush() {
    if (!canvas || remounting || aiWorking) return;
    clearTimeout(typingTimer); typingTimer = null;
    if (editingEl) commitTyping();
    else if (commitTimer) commitNow();
  }

  /* Undo and Redo wait while ETB2B AI is applying a change: a step taken then would undo an edit from before it,
     drop the half of the change already on the page, and leave its card saying it was made (QA, UX-090). */
  function step(by) {
    if (!canvas || remounting) return;
    if (aiWorking) { busyToast(); return; }
    deselect();       // leaves any text being edited, which records it
    flush();          // either may just have added the newest step, so the pointer is read after them
    var ptr = undoPtr + by;
    if (ptr < 0 || ptr >= undoStack.length) return;
    typingPtr = -1;
    dismissUndoToast();
    undoPtr = ptr;
    canvas.restore(undoStack[undoPtr], restoreOpts());
    /* a step back or forward is the person's own page unless it is the one saved, or that page with only what the
       editor updated by itself as it opened (Undo after "Open version N" brings their changes back: the next
       opening must not take them for nothing) */
    localEdited = !savedMark || (savedMark.hash !== snapHash(undoStack[undoPtr]) && !autoOnly());
    updateHistoryButtons();
    saveLocal(undoStack[undoPtr]);
    scheduleServerSave();
    repositionToolbars();
    sectionsChanged();
    designChanged();
    pageChanged();
    logoUnitNotice();      // an answered note can come back with the step, and an open one go
  }
  function undo() { step(-1); }
  function redo() { step(1); }

  function updateHistoryButtons() {
    var u = document.getElementById('btn-tpl-undo'), r = document.getElementById('btn-tpl-redo');
    var busy = aiWorking ? workSafety.busyLine('working') : '';
    [[u, undoPtr <= 0], [r, undoPtr >= undoStack.length - 1]].forEach(function (pair) {
      var b = pair[0];
      if (!b) return;
      if (!b.hasAttribute('data-title')) b.setAttribute('data-title', b.title || '');
      b.disabled = !!busy || pair[1];
      b.title = busy || b.getAttribute('data-title');
    });
  }
  /* said when something that changes the page is tried while ETB2B AI is applying a change: once in a while, not on
     every click */
  var busyToastAt = 0;
  function busyToast() {
    if (Date.now() - busyToastAt < 2500) return;
    busyToastAt = Date.now();
    showToast('One moment — ' + workSafety.busyLine('working').replace(/ — one moment$/, '') + '.');
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

  /* ---------- the event's records on the canvas ----------
     An item a list drew from Content (a speaker, a session, an FAQ…), the design's sample item in a list that has
     none yet, and the notice that says so are not the page's own text: Content draws them again every time the
     site is opened, so a word typed into one would be lost. Clicked, the item is selected whole and the toolbar
     says where it really lives, with a link that opens that Content tab (UX-074). -> null, or
     { el, kind, state: 'record' | 'sample' | 'empty', tab } */
  function recordOf(el) {
    if (!el || el.nodeType !== 1 || !el.closest || !window.RevampRecords) return null;
    var TABS = RevampRecords.TABS;
    var note = el.closest('[data-rv-empty-state]');
    if (note && TABS[note.getAttribute('data-rv-empty-state')]) return { el: note, kind: note.getAttribute('data-rv-empty-state'), state: 'empty', tab: TABS[note.getAttribute('data-rv-empty-state')] };
    var item = el.closest('[data-rv-repeat-template]');
    if (item && TABS[item.getAttribute('data-rv-repeat-template')]) {
      return { el: item, kind: item.getAttribute('data-rv-repeat-template'), state: item.hasAttribute('data-rv-filled') ? 'record' : 'sample', tab: TABS[item.getAttribute('data-rv-repeat-template')] };
    }
    /* a real template's card: drawn from a record when it carries the record's id (or holds cards that do: a
       contact's group, a sponsor tier); a card the wizard wrote is still the owner's text */
    var card = el.closest('[data-rv-item][data-rv-id]') || el.closest('[data-rv-item]');
    if (card && !card.hasAttribute('data-rv-id') && !card.querySelector('[data-rv-item][data-rv-id]')) card = null;
    if (card && TABS[card.getAttribute('data-rv-item')]) return { el: card, kind: card.getAttribute('data-rv-item'), state: 'record', tab: TABS[card.getAttribute('data-rv-item')] };
    return null;
  }
  function contentHref(kind) {
    var tab = window.RevampRecords && RevampRecords.TABS[kind];
    return tab && eventId ? '/edit-event.html?event=' + encodeURIComponent(eventId) + '#' + tab.route : '';
  }
  function recordPill(rec) {
    var t = rec.tab, href = contentHref(rec.kind);
    var hidden = rec.state === 'empty' || !!rec.el.closest('[data-rv-empty]');
    var words = rec.state === 'record' ? 'From ' + t.label : 'No ' + t.many + ' yet' + (hidden ? ' · hidden on the live site' : '');
    return '<span class="tpl-tb-text">' + escHtml(words) + '</span>' +
      (href ? '<a class="tpl-tb-link" href="' + escHtml(href) + '" target="_blank" rel="noopener" title="Opens ' + escHtml(t.label) +
        ' in a new tab. The site’s staged copy shows a change made there at once; this editor shows it the next time it opens.">' +
        (rec.state === 'record' ? 'Edit in Content' : 'Add ' + escHtml(t.many) + ' in Content') + ' ↗</a>' : '');
  }

  function buildToolbar(el) {
    var rec = recordOf(el);
    if (rec) {
      selToolbar.innerHTML = recordPill(rec) + '<span class="tpl-tb-sep"></span>' +
        '<button class="icon-only" data-action="deselect" title="Close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
      return;
    }
    var type = el.getAttribute('data-editable');
    var link = canLink(el) ? '<button data-action="link" title="Where this leads when clicked">Link</button>' : '';
    /* the font, size, weight and color of this one text or button, right where it is selected: the Theme panel's
       settings are the whole site's (UX-075) */
    var look = host && host.styleSelection ? '<button class="tpl-tb-style" data-action="text-style" title="Font, size, weight and color of this ' + (type === 'button' ? 'button' : 'text') + ' only" aria-label="Style this ' + (type === 'button' ? 'button' : 'text') + '" aria-haspopup="dialog"><span aria-hidden="true">Aa</span></button>' : '';
    var html = '';
    if (type === 'text') {
      html +=
        '<button class="icon-only" data-action="bold" title="Bold"><b>B</b></button>' +
        '<button class="icon-only" data-action="italic" title="Italic"><i>I</i></button>' +
        '<button class="icon-only" data-action="underline" title="Underline"><u>U</u></button>' +
        '<button class="icon-only" data-action="strikethrough" title="Strikethrough"><s>S</s></button>' +
        (look ? '<span class="tpl-tb-sep"></span>' + look : '') +
        '<span class="tpl-tb-sep"></span>' +
        '<button class="icon-only" data-action="align-left" title="Align left">&#8676;</button>' +
        '<button class="icon-only" data-action="align-center" title="Align center">&#8596;</button>' +
        '<button class="icon-only" data-action="align-right" title="Align right">&#8677;</button>' +
        (link ? '<span class="tpl-tb-sep"></span>' + link : '');
    } else if (type === 'button') {
      html += look + (look && link ? '<span class="tpl-tb-sep"></span>' : '') + link;
    } else if (type === 'image') {
      html += '<button data-action="replace-image" title="Replace image">Replace image</button>' +
        '<button data-action="alt-text" title="Alt text">Alt text</button>' + link;
    } else if (el.hasAttribute('data-rv-form-embed')) {
      var hidesTitle = el.getAttribute('data-rv-form-title') === 'hide';
      var around = formBlockSiblings(el), pos = around.indexOf(el);
      html += '<button data-action="form-change" title="Show another of this event’s forms here">Change form</button>' +
        '<button data-action="form-edit" title="Edit this form’s fields in the Forms panel">Edit form</button>' +
        '<button data-action="form-title" title="' + (hidesTitle ? 'Show the form’s heading above its fields' : 'Leave out the form’s heading (the section has one)') + '">' + (hidesTitle ? 'Show title' : 'Hide title') + '</button>' +
        '<span class="tpl-tb-sep"></span>' +
        '<button class="icon-only" data-action="form-earlier" title="Move the form up"' + (pos <= 0 ? ' disabled' : '') + ' aria-label="Move the form up">&#8593;</button>' +
        '<button class="icon-only" data-action="form-later" title="Move the form down"' + (pos === around.length - 1 ? ' disabled' : '') + ' aria-label="Move the form down">&#8595;</button>';
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
    positionBusyPills();
    if (!canvas || remounting || !selToolbar) return;
    /* while ETB2B AI is applying a change neither pill shows: their tools would change the page under it (UX-090).
       Anything still selected gets its pills back when the change is on the page (setAiWorking). */
    if (aiWorking) { selToolbar.hidden = true; secToolbar.hidden = true; return; }
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
    // the element's tools wait too while ETB2B AI is applying a change (onSecToolbarClick says why)
    if (aiWorking) { busyToast(); return; }
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
      replacePicture(selectedEl, 'Replace image');
    } else if (action === 'alt-text') {
      askAltText(selectedEl);
    } else if (action === 'text-style') {
      if (host.styleSelection) host.styleSelection(btn, selectedEl.getAttribute('data-editable'));
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
      if (clone.hasAttribute('data-rv-form-embed')) drawFormPreviews(false);
    } else if (action === 'form-change' || action === 'form-edit' || action === 'form-title' || action === 'form-earlier' || action === 'form-later') {
      onFormBlockAction(action.slice(5), selectedEl);
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
      // an embedded form's preview is the editor's drawing, not the section's markup
      Array.prototype.forEach.call(copy.querySelectorAll('[data-rv-form-preview], [data-rv-hv-preview], [data-rv-ai-mark]'), function (n) { n.remove(); });
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
        /* an answer that comes while ETB2B AI is applying a change in the chat waits until that change is on the
           page, so it is a step of its own and not half of the chat's (UX-090) */
        var waited = aiWorking;
        whenAiIdle(function () {
          open = document.contains(ask);
          if (!isLive(sec)) return fail(waited ? 'ETB2B AI changed this section meanwhile, so the redesign was not put over it. Try again.' : 'The section was removed while the AI was working, so there was nothing to replace.');
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
  var DEV_MARKS = ['data-editable', 'contenteditable', 'data-text-original', 'data-rv-cur-item', 'data-rv-open', 'data-rv-aria', 'data-rv-key', 'data-sec-name', 'data-ai-generated', 'data-ai-skipped', 'data-rv-filled', 'data-rv-ai-busy'];
  function devSource(sec) {
    var copy = sec.cloneNode(true);
    // an embedded form's preview is the editor's drawing, not the section's markup
    Array.prototype.forEach.call(copy.querySelectorAll('[data-rv-form-preview], [data-rv-hv-preview], [data-rv-ai-mark]'), function (n) { n.remove(); });
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
    /* Code changed here and not applied is asked about in the editor's own dialog, over this one, with "Keep editing"
       focused and the way that throws it away in red — not the browser's grey box (UX-079). One question at a time:
       the Escape that closes the question is not also taken for another "Close". */
    var asking = false;
    function askUnapplied(title, text, goLabel) {
      if (asking) return Promise.resolve(false);
      asking = true;
      return ask({ title: title, text: text, actions: [
        { key: 'stay', label: 'Keep editing', kind: 'secondary', autofocus: true },
        { key: 'go', label: goLabel, kind: 'danger' }
      ] }).then(function (key) { asking = false; return key === 'go'; });
    }
    function askClose() {
      if (asking) return;
      if (!dirty()) { close(); return; }
      askUnapplied('Close without applying your changes?', 'What you changed in the code here is not on the page yet. Closing now throws it away.', 'Close without applying')
        .then(function (go) { if (go) close(); });
    }
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
      var to = +pick.value;
      if (!dirty()) { load(secs[to]); return; }
      // the picker shows the section being edited until the answer is in
      pick.value = String(secs.indexOf(sec));
      askUnapplied('Switch section without applying your changes?', 'What you changed in this section’s code is not on the page yet. Switching now throws it away.', 'Switch without applying')
        .then(function (go) { if (go && document.contains(scrim)) { pick.value = String(to); load(secs[to]); } });
    });
    Array.prototype.forEach.call(scrim.querySelectorAll('[data-dev-tab]'), function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-dev-tab')); }); });
    $('rv-dev-close').addEventListener('click', askClose);
    $('rv-dev-cancel').addEventListener('click', askClose);
    $('rv-dev-apply').addEventListener('click', function () {
      problem.hidden = true;
      function fail(text, where) { problem.textContent = text; problem.hidden = false; if (where) show(where); }
      // ETB2B AI began applying a change while this was open: the code waits here, to be applied as a step of its own
      if (aiWorking) return fail(workSafety.busyLine('working') + '. Apply again when it is done.');
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
     once it is known to load. apply(url) does the setting; said: what is said once it has (else "Picture updated";
     false: nothing, apply() says it). */
  function openPictureDialog(title, current, apply, said) {
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
    function done(url) {
      /* ETB2B AI began applying a change while this was open: the picture waits here (an upload is kept as its
         address), so it goes on the page as a step of its own once the change is done (UX-090) */
      if (aiWorking) {
        urlBox.value = url;
        if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload from your computer'; }
        fail(workSafety.busyLine('working') + '. Press “Use this picture” again when it is done.');
        return;
      }
      if (handle && handle.close) handle.close();
      /* apply() answers false when the picture could not go where it was meant to (and has said why); said false:
         apply() says it itself (the Theme panel's background picture, with Undo) */
      if (apply(url) !== false && said !== false) host.showToast(said || 'Picture updated');
    }
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

  /* A picture on the page replaced: from its toolbar (Replace image) and from the logo's notice (Replace logo). */
  function replacePicture(picEl, title) {
    if (!picEl || !picEl.isConnected) return;
    openPictureDialog(title, canvas.pictureOf(picEl), function (url) {
      if (!picEl.isConnected) return;
      /* a logo unit whose own picture the owner has replaced no longer needs the note about the one it replaced —
         not so the ET logo beside an event name set in type (rv-lu-et), which the note is not about — and the
         new picture gets its copy for a dark background (darkCopyFor) */
      var unit = picEl.closest ? picEl.closest('[data-rv-logo-unit]') : null;
      var ownPicture = !!unit && picEl.classList.contains('rv-lu-img');
      if (ownPicture) unit.removeAttribute('data-rv-logo-note');
      canvas.setPicture(picEl, url); clearAiGenerated(picEl); commitNow(); repositionToolbars();
      if (ownPicture) { logoUnitNotice(); darkCopyFor(unit); }
    });
  }

  /* A picture's description (its alt text), asked in the editor's own dialog with what it is for, in place of the
     browser's bare "Alt text" box (UX-079). Saved as one undo step; empty marks the picture as decoration. */
  function askAltText(el) {
    if (!el || !el.isConnected || !host || !host.openDialog) return;
    var isImg = el.tagName === 'IMG', was = (isImg ? el.getAttribute('alt') : el.getAttribute('data-alt')) || '';
    var handle = host.openDialog({
      title: 'Describe this picture',
      bodyHtml:
        '<label for="rv-alt-text" style="display:block;margin:0 0 6px;font-size:12px;font-weight:700;">What it shows</label>' +
        '<textarea id="rv-alt-text" rows="3" maxlength="300" style="width:100%;resize:vertical;" placeholder="e.g. The main hall set up for the opening keynote"></textarea>' +
        '<p style="margin:8px 0 0;font-size:12px;opacity:.75;">Read out to people who cannot see the picture, and used by search engines. Leave it empty for a picture that is only decoration.</p>',
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        { label: 'Save', kind: 'primary', onClick: function () { return save(); } }
      ]
    });
    var box = document.getElementById('rv-alt-text');
    if (!box) return;
    box.value = was;
    box.focus();
    box.select();
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      if (save() !== false && handle && handle.close) handle.close();
    });
    // false keeps the dialog open: ETB2B AI is changing the page, and the description waits here until it is done
    function save() {
      var alt = box.value.replace(/\s+/g, ' ').trim();
      if (!el.isConnected || alt === was.replace(/\s+/g, ' ').trim()) return true;
      if (aiWorking) { busyToast(); return false; }
      el.setAttribute(isImg ? 'alt' : 'data-alt', alt);
      clearAiGenerated(el);
      commitNow();
      showToast(alt ? 'Description saved.' : 'Saved as a picture that is only decoration.');
      return true;
    }
  }

  var KIND_NAMES = { text: 'Text', button: 'Button', image: 'Picture', block: 'Block', form: 'Form' };

  /* ---------- an embedded form on the page (div.rv-block-form[data-rv-form-embed]) ----------
     Its toolbar: another form in its place, the form itself in the Forms panel, its heading shown or left out,
     and a move up or down among what stands beside it. Each is one undo step. */
  function formBlockSiblings(el) {
    return el.parentNode ? Array.prototype.filter.call(el.parentNode.children, function (c) {
      return c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT' && !c.hasAttribute('data-rv-editor') && !/^ai-.*-badge$/.test(c.className || '');
    }) : [];
  }
  function onFormBlockAction(what, el) {
    var api = formsApi();
    if (what === 'edit') { if (api) api.openPanel(el.getAttribute('data-rv-form-embed')); return; }
    if (what === 'change') {
      if (!api) return;
      api.pickForm({ title: 'Show another form here', current: el.getAttribute('data-rv-form-embed'), okLabel: 'Show this form' }).then(function (id) {
        if (!id || !el.isConnected || id === el.getAttribute('data-rv-form-embed')) return;
        el.setAttribute('data-rv-form-embed', id);
        clearAiGenerated(el);
        commitNow();
        drawFormPreviews(false);
        if (selectedEl === el) { buildToolbar(el); positionToolbars(); }
        showToast('This block now shows the form “' + (formName(id) || id) + '”.');
      });
      return;
    }
    if (what === 'title') {
      if (el.getAttribute('data-rv-form-title') === 'hide') el.removeAttribute('data-rv-form-title');
      else el.setAttribute('data-rv-form-title', 'hide');
      clearAiGenerated(el);
      commitNow();
      if (formsApi()) formsApi().drawPreviews(canvas.doc, { only: el.getAttribute('data-rv-form-embed') });
      buildToolbar(el); positionToolbars();
      return;
    }
    var around = formBlockSiblings(el), at = around.indexOf(el), other = around[at + (what === 'earlier' ? -1 : 1)];
    if (at === -1 || !other) return;
    if (what === 'earlier') other.parentNode.insertBefore(el, other); else other.after(el);
    clearAiGenerated(el);
    commitNow();
    buildToolbar(el);
    el.scrollIntoView({ block: 'nearest' });
    positionToolbars();
  }

  /* Every place the page uses a form that is being deleted (forms-builder.js asks first): its buttons open the
     default form instead, and its embedded copies are removed. One undo step. -> { buttons, embeds } */
  function unlinkForm(formId) {
    if (!canvas || remounting || !formId) return { buttons: 0, embeds: 0 };
    var api = formsApi(), u = api ? api.uses(formId) : { buttons: [], embeds: [] };
    var buttons = u.buttons.filter(function (a) { return a.getAttribute('data-rv-form') === formId; });
    if (!buttons.length && !u.embeds.length) return { buttons: 0, embeds: 0 };
    if (u.embeds.some(function (e) { return e === selectedEl || e.contains(selectedEl); })) deselect();
    buttons.forEach(function (a) {
      a.removeAttribute('data-rv-form');
      a.setAttribute('data-register-cta', '');
      a.setAttribute('href', '#register');
    });
    u.embeds.forEach(function (e) { e.remove(); });
    commitNow();
    return { buttons: buttons.length, embeds: u.embeds.length };
  }

  /* An embedded-form section (the forms spec, §1.5): a heading, a line and the form, after afterEl. */
  function placeFormSection(formId, afterEl) {
    var api = formsApi();
    if (!api || !canvas || remounting) return null;
    var form = api.get(formId);
    if (!form) { showToast('That form no longer exists. Choose another.', { kind: 'error' }); return null; }
    var heading = form.title || form.name;
    // plain: a form named "Join as partner" is a form, not the section that lists the partners
    var sec = insertSection({ name: heading, html: api.sectionHtml(form, heading, form.intro || 'Fill in your details below.'), plain: true }, afterEl);
    if (sec) drawFormPreviews(false);
    return sec;
  }

  /* an element the Forms panel points at ("Show on page"): selected and brought into view */
  function revealElement(el) {
    if (!canvas || remounting || !el || !el.isConnected || el.ownerDocument !== canvas.doc) return;
    var editable = el.closest('[data-editable]') || el;
    if (editable.closest('.is-hidden-sec')) { showToast('It is in a hidden section. Show that section first to see it.'); }
    if (editable.hasAttribute('data-editable')) selectElement(editable);
    else { var sec = editable.closest('[data-rv-section]'); if (sec) selectSectionOnly(sec); }
    editable.scrollIntoView({ block: 'center' });
    repositionToolbars();
  }

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
    var what = item ? 'Item' : el.hasAttribute('data-rv-form-embed') ? KIND_NAMES.form : (KIND_NAMES[el.getAttribute('data-editable')] || 'Element');
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
    if (a.hasAttribute('data-rv-form')) {
      var named = formName(a.getAttribute('data-rv-form'));
      if (named) return 'Opens the form “' + named + '”.';
      if (formsApi() && formsApi().loaded()) return 'Opens a form that no longer exists — choose another.';
      return 'Opens a form.';
    }
    if (a.hasAttribute('data-register-cta')) {
      var def = formsApi() && formsApi().defaultForm();
      return def ? 'Opens the default form (“' + def.name + '”).' : 'Opens the default form.';
    }
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
    if (a && (a.hasAttribute('data-rv-form') || a.hasAttribute('data-register-cta'))) return 'form';
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
    var hasLink = !!(anchor && (href || anchor.hasAttribute('data-register-cta') || anchor.hasAttribute('data-rv-form')));
    /* the event's forms: the default one (whatever it is at the time a visitor clicks), or one by name */
    var api = formsApi(), forms = api ? api.list() : [], def = api ? api.defaultForm() : null;
    var chosenForm = anchor && anchor.hasAttribute('data-rv-form') ? anchor.getAttribute('data-rv-form') : '__default';
    var shortName = function (s) { s = String(s || ''); return s.length > 44 ? s.slice(0, 43) + '…' : s; };
    var formOptions = '<option value="__default">The default form' + (def ? ' (now: ' + escHtml(shortName(def.name)) + ')' : '') + '</option>' +
      forms.map(function (f) { return '<option value="' + escHtml(f.id) + '">' + escHtml(shortName(f.name)) + '</option>'; }).join('') +
      (chosenForm !== '__default' && !forms.some(function (f) { return f.id === chosenForm; })
        ? '<option value="' + escHtml(chosenForm) + '">' + (api && api.loaded() ? 'A form that no longer exists' : 'The form it opens now') + '</option>' : '');
    linkPop.innerHTML =
      '<h4>Link</h4>' +
      '<span class="tpl-pop-now">' + escHtml(range ? 'Links the selected words.' : describeLink(anchor)) + '</span>' +
      '<label>Goes to<select data-link="kind">' +
        '<option value="web">A web address</option>' +
        '<option value="section">A section on this page</option>' +
        '<option value="email">An email address</option>' +
        '<option value="form">A form</option>' +
      '</select></label>' +
      '<label data-link-row="form">Opens form<select data-link="form">' + formOptions + '</select></label>' +
      '<span class="tpl-pop-now" data-link-row="form">Visitors who click it get this form in a pop-up on the published site. ' +
        '<button type="button" class="tpl-pop-link" data-link="manage-forms">Manage forms…</button></span>' +
      '<label data-link-row="web">Web address<input type="text" data-link="web" placeholder="https://example.org/tickets" autocomplete="off" spellcheck="false"></label>' +
      '<label data-link-row="section">Section<select data-link="section">' +
        linkCtx.sections.map(function (c, i) { return '<option value="' + i + '">' + escHtml(c.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label data-link-row="email">Email address<input type="text" data-link="email" placeholder="name@example.org" autocomplete="off" spellcheck="false"></label>' +
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
    f('form').value = chosenForm;
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
      if (which === 'manage-forms') { closeLinkPop(); if (formsApi()) formsApi().openPanel(); }
      else if (which === 'cancel') closeLinkPop();
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
    if (kind === 'form') {
      var chosen = linkField('form').value;
      if (chosen === '__default' || !chosen) return { href: '#register', register: true, form: null };
      var api = formsApi(), form = api && api.get(chosen);
      if (!form) return { error: api && api.loaded() ? 'That form no longer exists. Choose another.' : 'The forms are still loading. Try again in a moment.' };
      // a form that counts as a registration is a Register button too (the nav keeps it, an empty section never hides it)
      return { href: '#rv-form-' + form.id, register: !!form.countsAsRegistration, form: form.id };
    }
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

  /* dest: { href, register, form, newTab }. form: the form a click opens in a pop-up (data-rv-form); register: a
     Register button (data-register-cta) — on its own, the event's default form. Any other link loses both. */
  function writeLink(a, dest) {
    a.setAttribute('href', dest.href);
    if (dest.form) a.setAttribute('data-rv-form', dest.form); else a.removeAttribute('data-rv-form');
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
    var linkedForm = dest.form ? formName(dest.form) : dest.register ? ((formsApi() && formsApi().defaultForm()) || {}).name : '';
    if (formsApi() && formsApi().panelRedraw) formsApi().panelRedraw();
    showToast(dest.form || dest.register ? (linkedForm ? 'Linked to the form “' + linkedForm + '”.' : 'Linked to the default form.') : 'Link set to ' + dest.href);
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
      a.removeAttribute('data-rv-form');
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

  /* ---------- internal pages (templates/_shared/rv-pages.js) ----------
     One document holds every page; the canvas shows the one picked in the top bar's page switcher. Which page is
     shown is the canvas's <html data-rv-current-page> with the rule that goes with it — the editor's own copy
     (data-rv-editor) — and neither is saved (editor-canvas.js serialize()). A site without a page list has no
     switcher and nothing here changes anything. */
  var currentPage = 'home', pageSwitch = null;
  function pagesLib() { return window.RevampPages || null; }
  function sitePages() { return canvas && !remounting && pagesLib() ? pagesLib().readPages(canvas.doc) : []; }
  // a one-page site: every section is on the page shown
  function onShownPage(sec) {
    if (!pagesLib() || !sitePages().length) return true;
    return pagesLib().shownOn(sec, currentPage);
  }
  // the sections of the page shown, in page order (every section on a one-page site)
  function pageSections() { return canvas.sections().filter(onShownPage); }
  /* quiet: nothing announced (the caller says the sections changed itself) */
  function showPage(slug, quiet) {
    if (!canvas || remounting || !pagesLib()) return currentPage;
    var pages = sitePages();
    if (!pages.length) { currentPage = 'home'; renderPageSwitch(pages); return currentPage; }
    var was = currentPage;
    var next = slug === 'home' || pages.some(function (p) { return p.slug === slug; }) ? slug : 'home';
    if (next !== was) {
      if (editingEl) exitEdit(editingEl);
      if (activeSectionEl && !pagesLib().shownOn(activeSectionEl, next)) deselect();
    }
    currentPage = pagesLib().show(canvas.doc, next, { pages: pages, links: false, editor: true });
    renderPageSwitch(pages);
    if (next !== was) {
      try { canvas.win.scrollTo(0, 0); } catch (e) { /* nothing to scroll */ }
      repositionToolbars();
      if (!quiet) { sectionsChanged(); changeListeners.forEach(function (fn) { try { fn(); } catch (err) { if (window.console) console.error(err); } }); }
    }
    return currentPage;
  }
  function renderPageSwitch(pages) {
    if (!pageSwitch) {
      /* in the tools row, beside the device switch, not in the top bar: there it squeezed the event's name to one
         letter (UX-078). The row's right-hand part never scrolls away and stays in "Edit with AI" too, where the
         live view shows the page picked here. */
      var row = document.querySelector('.ed-rail .rail-fixed');
      if (!row) return;
      pageSwitch = document.createElement('label');
      pageSwitch.className = 'ed-page-switch';
      pageSwitch.hidden = true;
      pageSwitch.innerHTML = '<span class="ed-page-switch-label">Page</span><select id="ed-page-select" aria-label="Page of the site shown"></select>';
      row.insertBefore(pageSwitch, row.firstChild);
      pageSwitch.querySelector('select').addEventListener('change', function (e) { showPage(e.target.value); });
    }
    var select = pageSwitch.querySelector('select');
    pageSwitch.hidden = !pages.length;
    var want = [{ slug: 'home', title: 'Home' }].concat(pages);
    var same = select.options.length === want.length && want.every(function (p, i) { return select.options[i].value === p.slug && select.options[i].textContent === p.title; });
    if (!same) {
      select.innerHTML = '';
      want.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.slug; o.textContent = p.title;
        select.appendChild(o);
      });
    }
    select.value = currentPage;
    // a tight tools row narrows the switch (custom_editor.html .is-snugger) and can cut a long page name: in full on hover
    var shown = want.filter(function (p) { return p.slug === currentPage; })[0];
    select.title = shown ? shown.title : '';
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
        (repeatItems(sec).some(function (it) { return !recordOf(it); }) ? '<button data-action="add-item" title="Add another item to this section">+ Item</button>' : '') +
        (canvas.canRedesign(sec) ? '<button data-action="redesign-section" title="Have the AI design this section again, keeping its content">&#10024; Redesign with AI</button>' : '') +
        (canvas.backgroundHost(sec) ? '<button data-action="section-background" title="Change the picture behind this section">Background picture</button>' : '') +
        '<button data-action="duplicate-section" title="Duplicate section">Duplicate</button>' +
        '<button data-action="toggle-hide" title="Keep this section but leave it off the site">Hide</button>';
    }
    /* the developer zone is not on every section's pill: it is for developers, under the tools row's ⋯ More, where it
       opens on the section selected (UX-080) */
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
    var secs = pageSections(), i = secs.indexOf(sec);
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
    /* while ETB2B AI is applying a change the section's tools wait, like the canvas: a step recorded now would hold
       half of its change, and the section it is rewriting could be hidden or deleted under it (QA, UX-090) */
    if (aiWorking) { busyToast(); return; }
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
      /* asked before ETB2B AI began applying a change (it was still thinking): the dialog stays until it is done */
      { label: 'Delete', kind: 'danger', onClick: function () {
        if (aiWorking) { busyToast(); return false; }
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
        if (aiWorking) { busyToast(); return false; }
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
    return pageSections().map(function (sec) {
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
    // a section of another page (the chat's reference, a link to it): that page first
    if (pagesLib() && sitePages().length && !onShownPage(sec)) {
      var on = pagesLib().pageOfElement(sec);
      if (on !== '*') showPage(on);
    }
    selectSectionOnly(sec);
    canvas.scrollToSection(sec);
  }

  // toIndex: the place the section should have in listSections() once it has moved
  function moveSection(sec, toIndex) {
    if (!isLive(sec)) return false;
    var others = pageSections().filter(function (s) { return s !== sec; });
    /* past the last section of the page shown: in front of whatever followed it (the footer, another page's sections) */
    var before = others[toIndex] || null;
    if (!before && others.length) {
      var all = canvas.sections(), last = all.indexOf(others[others.length - 1]);
      for (var i = last + 1; i < all.length && !before; i++) if (all[i] !== sec) before = all[i];
    }
    return moveSectionBefore(sec, before);
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
      var recordKind = spec.plain || /^imported-/.test(canvas.template.id || '') ? '' : kindForName(spec.name);
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
    // a ready-made design comes with sample words and empty picture boxes, marked until they are replaced
    var samples = spec.libraryId ? 0 : markPlaceholders(el);
    canvas.insertSection(el, isLive(afterEl) ? afterEl : activeSectionEl);
    commitNow();
    selectSectionOnly(el);
    canvas.scrollToSection(el);
    showToast('Added "' + name + '".' + (samples ? ' Its sample text has a dashed amber outline until you write this event’s own over it.' : ''));
    return el;
  }

  /* ---------- placeholders (UX-081) ----------
     What a ready-made design or a new block brings with it ("A clear overview of what awaits", "New heading", an
     empty picture box) is marked with what it said (data-rv-placeholder), outlined on the canvas (editor-canvas.css)
     and listed before publishing. It stops being one as soon as its words differ or the box shows a picture, by any
     road — typed, ETB2B AI, a paste (editorWords.placeholderLeft); the mark then comes off as the change is recorded
     (settlePlaceholders, in record()). The mark never reaches a published page (api.js EDITOR_ONLY_ATTRS).
     -> how many were marked */
  function markPlaceholders(root) {
    var n = 0;
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-editable]')));
    all.forEach(function (el) {
      var kind = el.getAttribute('data-editable');
      if (kind !== 'text' && kind !== 'button' && kind !== 'image') return;
      if (kind === 'image' ? canvas.pictureOf(el) : !/\S/.test(el.textContent)) return;
      el.setAttribute('data-rv-placeholder', kind === 'image' ? '' : el.textContent.replace(/\s+/g, ' ').trim());
      n++;
    });
    return n;
  }
  function settlePlaceholders() {
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-placeholder]'), function (el) {
      if (!editorWords.placeholderLeft(el.getAttribute('data-editable'), el.getAttribute('data-rv-placeholder'), el.textContent, !!canvas.pictureOf(el))) {
        el.removeAttribute('data-rv-placeholder');
      }
    });
  }
  // the ones still on the site: a hidden section is not saved, so it never goes live
  function shownPlaceholders() {
    if (!canvas || remounting || !canvas.doc) return [];
    return Array.prototype.filter.call(canvas.doc.querySelectorAll('[data-rv-placeholder]'), function (el) {
      return !el.closest('.is-hidden-sec') &&
        editorWords.placeholderLeft(el.getAttribute('data-editable'), el.getAttribute('data-rv-placeholder'), el.textContent, !!canvas.pictureOf(el));
    });
  }
  /* the first one brought into view and selected — on its own page, in the manual editor (as revealLogoUnit) */
  function showPlaceholders() {
    var first = shownPlaceholders()[0];
    if (!first) return;
    function go() {
      if (!first.isConnected) return;
      var sec = first.closest('[data-rv-section]');
      if (sec && pagesLib() && sitePages().length && !onShownPage(sec)) {
        var on = pagesLib().pageOfElement(sec);
        if (on !== '*') showPage(on);
      }
      revealElement(first);
    }
    var aiMode = window.RevampEditorMode;
    if (aiMode && aiMode.mode && aiMode.mode() === 'ai') { aiMode.setMode('manual'); setTimeout(go, 120); } else go();
  }
  /* Before publishing: true when some are left — the person is asked, and go() runs only on "… anyway". */
  function placeholderGate(go) {
    if (!canvas || remounting) return false;
    flush();
    settlePlaceholders();
    var left = shownPlaceholders();
    if (!left.length) return false;
    var pictures = left.filter(function (el) { return el.getAttribute('data-editable') === 'image'; }).length;
    var sample = (left.filter(function (el) { return el.getAttribute('data-editable') !== 'image'; })[0] || {}).textContent || '';
    var pub = document.getElementById('btn-publish');
    var words = editorWords.placeholderAsk(left.length - pictures, pictures, sample, pub ? pub.textContent : '');
    ask({ title: words.title, text: words.text, actions: [
      { key: 'anyway', label: words.anyway, kind: 'secondary', aside: true },
      { key: 'show', label: words.show, kind: 'primary', autofocus: true }
    ] }).then(function (key) {
      if (key === 'show') showPlaceholders();
      else if (key === 'anyway' && typeof go === 'function') go();
    });
    return true;
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
    spacer: { tag: 'div', cls: 'rv-block-spacer', kind: 'block', name: 'spacer' },
    form: { tag: 'div', cls: 'rv-block-form', kind: 'block', name: 'form' }
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

  /* opts (a form only): { formId } the form to embed — without it the owner is asked which; { section } the
     section to add it to when it is not the one selected (the Forms panel's Place on page) */
  function addBlock(kind, opts) {
    opts = opts || {};
    var spec = BLOCKS[kind];
    if (!canvas || remounting || !spec) return null;
    var sec = opts.section && isLive(opts.section) ? opts.section : activeSectionEl;
    if (!sec || !sec.isConnected) { showToast('Click a section first, then choose what to add to it.'); return null; }
    if (sec.classList.contains('is-hidden-sec')) { showToast('This section is hidden. Show it first, then add to it.'); return null; }
    if (kind === 'form') {
      var api = formsApi();
      if (!api) return null;
      if (!opts.formId) {
        api.pickForm({ title: 'Add a form to this section', okLabel: 'Add this form' }).then(function (id) {
          if (id && isLive(sec)) addBlock('form', { formId: id, section: sec });
        });
        return null;
      }
      if (editingEl) exitEdit(editingEl);
      var embed = api.makeEmbed(canvas.doc, opts.formId, !!opts.hideTitle);
      var at = sec === activeSectionEl ? blockAnchor(sec) : null;
      if (at) at.after(embed); else contentBox(sec).appendChild(embed);
      clearAiGenerated(embed);
      commitNow();
      selectElement(embed);
      embed.scrollIntoView({ block: 'nearest' });
      repositionToolbars();
      if (api.panelRedraw) api.panelRedraw();
      showToast('Added the form “' + (formName(opts.formId) || opts.formId) + '”. Visitors fill it in right here on the page.');
      return embed;
    }
    /* a picture is chosen first, in the same dialog as Replace image — from the computer or by its web address —
       and goes where the selection was when Image was pressed (UX-079) */
    if (kind === 'image' && !opts.src) {
      var at0 = sec === activeSectionEl ? blockAnchor(sec) : null;
      openPictureDialog('Add a picture', '', function (url) {
        if (!isLive(sec) || sec.classList.contains('is-hidden-sec')) { showToast('The section you were adding to is no longer on the page, so the picture was not added.', { kind: 'error' }); return false; }
        return !!addBlock('image', { src: url, section: sec, after: at0 && at0.isConnected && sec.contains(at0) ? at0 : null });
      }, 'Added a picture.');
      return null;
    }
    var src = kind === 'image' ? opts.src : '';
    if (editingEl) exitEdit(editingEl);
    var node = canvas.doc.createElement(spec.tag);
    node.className = spec.cls;
    node.setAttribute('data-editable', spec.kind);
    if (spec.text) node.textContent = spec.text;
    if (kind === 'button') node.setAttribute('href', '#');
    if (kind === 'image') { node.setAttribute('src', src); node.setAttribute('alt', ''); }
    var anchor = opts.after !== undefined ? opts.after : blockAnchor(sec);
    if (anchor) anchor.after(node); else contentBox(sec).appendChild(node);
    canvas.ensureBlockStyle();
    // "New heading", "Write your text here." and "Button" are placeholders until they are written over
    markPlaceholders(node);
    clearAiGenerated(node);
    commitNow();
    selectElement(node);
    node.scrollIntoView({ block: 'nearest' });
    repositionToolbars();
    // a picture says so itself as the dialog closes (openPictureDialog)
    if (kind !== 'image') showToast('Added ' + (/^[aeiou]/.test(spec.name) ? 'an ' : 'a ') + spec.name + '.');
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
    // the section's "+ Item" copies the owner's own items, never one drawn from Content
    var items = item ? groupOf(sec, item) : repeatItems(sec).filter(function (it) { return !recordOf(it); });
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
      // while ETB2B AI is applying a change the page waits: an edit now would be mixed into its one undo step
      if (aiWorking) { busyToast(); return; }
      // a click with no mouse behind it is the browser "pressing" a <button> or link for Space / Enter typed
      // into its label (an FAQ question is a <button>): that is typing, not picking something else
      if (editingEl && e.detail === 0) return;
      var target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      if (!target) return;
      if (canvas.openItem(target)) { repositionToolbars(); return; }
      /* the event's records: selected whole, and the toolbar says where they are edited (recordOf) */
      var rec = recordOf(target);
      if (rec) {
        var href = target.closest('[data-rv-content-link]') ? contentHref(rec.kind) : '';
        if (href) window.open(href, '_blank', 'noopener');
        if (editingEl) exitEdit(editingEl);
        selectElement(rec.el);
        return;
      }
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
    // a canvas mounted afresh (opening, recovering) shows the page that was shown
    showPage(currentPage, true);
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
      pageChanged();
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
     records what is still pending first. Closing or reloading the tab with work only this browser has, a save on
     its way, or ETB2B AI still busy is asked by the browser (it shows its own words); leave() asks for the ways out
     that this page starts. While ETB2B AI is applying a change nothing is recorded: the page holds half of it. */
  function wireLeaving() {
    window.addEventListener('pagehide', function () {
      if (aiWorking) { stopAiTurn(true); return; }
      flush();
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && !aiWorking) flush(); });
    window.addEventListener('beforeunload', function (e) {
      if (leavingNow || !eventId || !canvas) return;
      if (!aiWorking) flush();            // words still being typed count
      if (aiState === 'ready' && !saving && !hasUnsavedWork()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /* ---------- design: the Design panel and the style toolbar (custom_editor.html) ----------
     Both read and write the site's design through these, never the page around the canvas. A setting the site
     has nothing for (a theme colour on a design whose colours are fixed, corners where there are no buttons or
     cards) is refused with the reason, so nothing reports a change that did not happen. */
  var NOTHING_TO_CHANGE = {
    themeColor: 'This design uses fixed colors, so there is no site-wide theme color to change. Click a text on the page and use Aa on its toolbar to change its color.',
    textColor: 'This design sets the color of each text itself. Click a text on the page and use Aa on its toolbar to change its color.',
    bodyFont: 'This design sets the font of each text itself. Click a text on the page and use Aa on its toolbar to change its font.',
    sectionSpacing: 'This design sets the space between its sections itself, so this setting has nothing to change.',
    radius: 'This design has no buttons or cards for the corner setting to round.',
    bgColor: 'This design gives each section its own fixed background, so there is no page background to change. Ask ETB2B AI to recolor a section.',
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
      return href && href !== 'hero' && href !== 'top' && !a.querySelector('img') && !a.hasAttribute('data-register-cta') && !a.hasAttribute('data-rv-form') &&
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

  /* ---------- section edges (every site but an imported one) ----------
     'sharp' or 'smooth': where one section's colour meets the next. Kept with the site's theme
     (designPlan.design.sectionEdges, POST /api/event/section-edges) and written onto the page as
     <html data-rv-edges> when it is previewed and published; the canvas shows it the same way. It is not part
     of the page the editor saves (editor-canvas.js serialize leaves the attribute out). */
  var sectionEdgesSaving = null;
  /* smooth unless the owner chose sharp (functions/lib/api.js sectionEdgesOf) */
  function savedSectionEdges() {
    var d = currentEvent && currentEvent.designPlan && currentEvent.designPlan.design;
    return d && d.sectionEdges === 'sharp' ? 'sharp' : 'smooth';
  }
  function sectionEdgesInfo() {
    if (!canvas || !canvas.doc || !eventId) return null;
    if (/^(imported|import)-/.test(String(templateId || '')) || /^import-/.test(String(eventId || ''))) return null;
    return { current: canvas.doc.documentElement.getAttribute('data-rv-edges') === 'smooth' ? 'smooth' : 'sharp', saved: savedSectionEdges(), saving: !!sectionEdgesSaving };
  }
  function showSectionEdges(value) {
    if (!sectionEdgesInfo()) return;
    canvas.doc.documentElement.setAttribute('data-rv-edges', value === 'smooth' ? 'smooth' : 'sharp');
    try {
      var ev;
      try { ev = new canvas.win.CustomEvent('rv:themechange', { detail: { edges: value } }); }
      catch (e) { ev = canvas.doc.createEvent('CustomEvent'); ev.initCustomEvent('rv:themechange', false, false, { edges: value }); }
      canvas.doc.dispatchEvent(ev);
    } catch (e) { /* the canvas went away meanwhile */ }
  }
  /* shows the choice on the canvas at once and saves it for the site; -> Promise<boolean saved> */
  function applySectionEdges(value, quiet) {
    var info = sectionEdgesInfo();
    if (!info || remounting || (value !== 'sharp' && value !== 'smooth')) return Promise.resolve(false);
    var before = info.current;
    showSectionEdges(value);
    designChanged();
    if (!window.RevampAuth) return Promise.resolve(false);
    var req = sectionEdgesSaving = RevampAuth.authedFetch('/api/event/section-edges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: eventId, sectionEdges: value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.error || 'The section edges could not be saved.'); return b; }); })
      .then(function () {
        if (currentEvent) {
          currentEvent.designPlan = currentEvent.designPlan || {};
          currentEvent.designPlan.design = currentEvent.designPlan.design || {};
          currentEvent.designPlan.design.sectionEdges = value;
        }
        if (!quiet) showToast(value === 'smooth'
          ? 'Smooth section edges saved: where the colour changes, one section fades into the next. Open Preview to see it (the editor keeps showing sharp edges); publish to put it live.'
          : 'Sharp section edges saved: each section ends in a straight line. Publish to put it live.');
        return true;
      }, function (err) {
        showSectionEdges(before);
        showToast((err && err.message) || 'The section edges could not be saved. Please try again.', { kind: 'error' });
        return false;
      })
      .then(function (saved) { if (sectionEdgesSaving === req) sectionEdgesSaving = null; designChanged(); return saved; });
    designChanged();
    return req;
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
    if (!canvas || !selectedEl || !selectedEl.isConnected || recordOf(selectedEl)) return null;
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
    var P = aiPictures(), help = P ? aiPictureHelpers() : null;
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
      /* for a new picture (RevampAiPicture.describe): what the section is (the banner, the navigation, the footer,
         Content's own records), which of its pictures can be replaced and whether it has a background to take
         one — so the AI asks instead of guessing, and the server checks the same facts. A section that cannot be
         read is sent without them: the message is never held back for it. */
      if (P) {
        try {
          var pic = plainPictureInfo(P.describe(sec, help));
          Object.keys(pic).forEach(function (k) { out[k] = pic[k]; });
        } catch (err) { if (window.console) console.warn('[ETB2B AI] the pictures of a section could not be read:', err); }
      }
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
  /* returns the first element whose text changed, or null when the text is no longer there. log: each text's words
     before and after go in it ({ sectionId, before, after, aiMarked }), so this change can later be taken back on its
     own (undoByInverse) */
  function applyTextEdit(edit, log) {
    var at = locateTextEdit(edit);
    if (!at) return null;
    var replacement = String(edit.replace == null ? '' : edit.replace);
    var all = new RegExp(at.re.source, 'g');
    var sec = canvas.sectionByKey(edit.sectionId);
    var aiMarked = !!(sec && sec.hasAttribute('data-ai-generated'));
    at.nodes.forEach(function (node) {
      var was = node.nodeValue;
      node.nodeValue = was.replace(all, function () { return replacement; });
      if (log && node.nodeValue !== was) log.push({ sectionId: edit.sectionId, before: was, after: node.nodeValue, aiMarked: aiMarked });
    });
    return at.node.parentElement;
  }

  /* ---------- ETB2B AI's changes, and taking them back ----------
     What the AI answers with is applied at once (runAiTurn): there is nothing to accept (the owner, 28 Oct 2026).
     Each applied change keeps the page as it was just before it — a checkpoint, kept in this browser too, so it
     outlives a reload — and the forms it made. Undo on its message:
       - while the change is still the newest step on the page: one step back, as the top bar's Undo does;
       - after later edits: the page goes back to the checkpoint as a step of its own (the top bar's Undo brings it
         back), once the owner has confirmed that what was done after it goes too;
     and the forms it made are deleted (kept when the saved site uses one, and the owner told). The server is told,
     so the conversation and the event's History say it was undone. */
  var aiTurns = [];                 // { turnId, order, before, ptr, formIds, pageChanged, status, button, result }
  var aiTurnOrder = 0;
  var AI_CHECKPOINTS_KEPT = 15;
  function checkpointKey(turnId) { return eventId && turnId ? 'rv.aiTurn.' + eventId + '.' + turnId : ''; }
  function keepCheckpoint(t) {
    var key = checkpointKey(t.turnId);
    if (!key || !t.before) return;
    localPut(key, { before: t.before, after: t.after, formIds: t.formIds, pageChanged: t.pageChanged, inverse: t.inverse || null, at: Date.now() });
    /* only the newest few are kept in this browser */
    var kept = aiTurns.filter(function (x) { return x.turnId && x.before; });
    kept.slice(0, Math.max(0, kept.length - AI_CHECKPOINTS_KEPT)).forEach(function (x) {
      x.before = null;
      if (window.RevampStore && RevampStore.remove) RevampStore.remove(checkpointKey(x.turnId)).catch(function () {});
      if (x.button && x.status !== 'undone') { x.button.disabled = true; x.button.title = 'This change is too long ago to undo from the chat. Use Undo in the top bar.'; }
    });
  }
  /* -> a promise that settles either way. keepalive: sent as the page goes (the tab is closing) */
  function reportTurn(turnId, status, done, notDone, keepalive) {
    if (!eventId || !turnId || !window.RevampAuth) return Promise.resolve();
    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: eventId, turnId: turnId, status: status, done: done || [], notDone: notDone || [] }) };
    if (keepalive) opts.keepalive = true;
    return Promise.resolve(RevampAuth.authedFetch('/api/chat/turn', opts)).then(function () {}, function () {});
  }
  function markUndone(t, note) {
    t.status = 'undone';
    if (t.button) { t.button.disabled = true; t.button.textContent = 'Undone'; }
    if (t.card) { t.card.status('undone'); t.card.note(note || 'The page is back to how it was before this change.'); }
    syncCardSaves(isDirty());
  }
  /* Takes back a change of settings and wording only (t.inverse), leaving everything done since: each text the change
     reworded gets its old words back where it still reads as the change left it, and the settings go back to how they
     were, if nothing has changed them since. -> null when it cannot be done so (the settings were changed since),
     else { left: [texts changed again since, left as they are] } */
  function undoByInverse(t) {
    var inv = t.inverse, cur = canvas.snapshot(undoStack[undoPtr]);
    if (!inv || !t.before || !t.after) return null;
    var designBack = inv.design && inv.design.length;
    if (designBack && (cur.html !== t.after.html || cur.body !== t.after.body || cur.design !== t.after.design)) return null;
    var left = [];
    /* every text of the section, shown or not: an answer in a closed accordion item is still the one it changed */
    function textsOf(sec) {
      var out = [];
      Array.prototype.forEach.call(sec.querySelectorAll('[data-editable="text"], [data-editable="button"]'), function (el) {
        var walker = canvas.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
        while ((n = walker.nextNode())) if (out.indexOf(n) === -1) out.push(n);
      });
      return out;
    }
    (inv.text || []).slice().reverse().forEach(function (c) {
      var sec = canvas.sectionByKey(c.sectionId);
      var node = sec ? textsOf(sec).filter(function (n) { return n.nodeValue === c.after; })[0] : null;
      if (!node) { left.push(c); return; }
      node.nodeValue = c.before;
      if (c.aiMarked) sec.setAttribute('data-ai-generated', 'true');
    });
    if (designBack) {
      var back = canvas.snapshot(undoStack[undoPtr]);
      back.html = t.before.html; back.body = t.before.body; back.design = t.before.design;
      canvas.restore(back, restoreOpts());
      syncEtLogos();             // the ET logo in the version the old look needs
    }
    if (left.length === (inv.text || []).length && !designBack) return { left: left, nothing: true };
    commitNow();
    return { left: left };
  }
  /* -> Promise<boolean undone>; t.undoWhy says why not: 'busy' (ETB2B AI is applying a change), 'gone' (its
     checkpoint is not in this browser), 'kept' (the person kept their later edits), 'changed' (what it changed has
     been changed again since) */
  function undoAiTurn(t, quiet) {
    if (!t || t.status === 'undone' || !canvas || remounting) return Promise.resolve(false);
    t.undoWhy = '';
    if (aiWorking) { t.undoWhy = 'busy'; showToast('One moment — ETB2B AI is still applying a change.'); return Promise.resolve(false); }
    deselect();
    flush();
    var later = aiTurns.filter(function (x) { return x.order > t.order && x.status !== 'undone' && x.status !== 'failed' && x.pageChanged; });
    var newest = t.pageChanged && t.ptr === undoPtr && !later.length;
    /* the page exactly as this change left it (after a reload, say): nothing done since would be lost, so no question */
    var untouched = !newest && !later.length && t.after && canvas.sameSnapshot && canvas.sameSnapshot(canvas.snapshot(), t.after);
    var note = '';
    if (t.pageChanged && !newest && !untouched) {
      // said by the caller: the card already reads it, and "undo that" answers with it
      if (!t.before) { t.undoWhy = 'gone'; return Promise.resolve(false); }
      /* settings and wording only: taken back on their own, so the person's later edits stay (QA, UX-092) */
      var alone = later.length ? null : undoByInverse(t);
      if (alone && alone.nothing) {
        t.undoWhy = 'changed';
        if (t.card) t.card.note('Nothing to take back: the words this change wrote have been changed again since.');
        return Promise.resolve(false);
      }
      if (alone) {
        note = 'Undone — the page is back to how it was before this change; your later edits stay.' +
          (alone.left.length ? ' ' + alone.left.length + (alone.left.length === 1 ? ' text it changed was' : ' texts it changed were') + ' edited again since, so ' + (alone.left.length === 1 ? 'it was' : 'they were') + ' left as you have ' + (alone.left.length === 1 ? 'it' : 'them') + '.' : '');
        return Promise.resolve(finishUndo(t, [t], note));
      }
      if (!quiet) {
        var own = Math.max(0, undoPtr - t.ptr - later.length);
        var q = workSafety.undoQuestion(later.length, own);
        return ask({ title: q.title, text: q.text, actions: [
          { key: 'keep', label: 'Keep my edits', kind: 'secondary', autofocus: true },
          { key: 'undo', label: 'Undo all of it', kind: 'danger' }
        ] }).then(function (answer) {
          if (answer !== 'undo') { t.undoWhy = 'kept'; return false; }
          if (!canvas || remounting || aiWorking) return false;
          canvas.restore(t.before, restoreOpts()); commitNow();
          return finishUndo(t, [t].concat(later), '');
        });
      }
    }
    if (t.pageChanged) {
      if (newest) undo();
      else { canvas.restore(t.before, restoreOpts()); commitNow(); }
    }
    return Promise.resolve(finishUndo(t, [t].concat(newest ? [] : later), note));
  }
  /* the change (and what went with it) marked undone, the server told, and the forms it made deleted */
  function finishUndo(t, gone, note) {
    gone.forEach(function (x) { markUndone(x, x === t ? note : ''); reportTurn(x.turnId, 'undone'); });
    var forms = [].concat.apply([], gone.map(function (x) { return x.formIds || []; }));
    if (!forms.length || !formsApi()) return true;
    return formsApi().deleteCreated(forms).then(function (results) {
      var said = ['Undone — the page is back to how it was before this change.'];
      results.forEach(function (r) {
        if (!r.kept) said.push('The form “' + r.name + '” was deleted.');
        else if (r.inUse) said.push('The form “' + r.name + '” was kept because the saved site uses it.');
        else said.push('The form “' + r.name + '” could not be deleted (' + (r.error || 'please try again') + '); delete it in the Forms panel.');
      });
      markUndone(t, said.join(' '));
      formsChanged();
      return true;
    });
  }
  /* the newest change of the AI that is still on the page */
  function lastAiTurn() {
    var live = aiTurns.filter(function (x) { return (x.status === 'applied' || x.status === 'partly') && (x.pageChanged || (x.formIds || []).length); });
    return live[live.length - 1] || null;
  }

  /* ---------- the AI's forms on the page (ctaLinks, formEmbeds of POST /api/chat-edit) ---------- */
  /* the button of a section whose label is `text` (as the AI was shown it: whitespace collapsed, any case) */
  function buttonByLabel(sec, text) {
    if (!sec) return null;
    var want = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!want) return null;
    var hit = visibleTextNodes(sec, '[data-editable="button"]').filter(function (node) {
      return !node.parentElement.closest('[data-editable="text"]') && readable(node).toLowerCase() === want;
    })[0];
    return hit ? hit.parentElement.closest('[data-editable="button"]') : null;
  }
  /* the words of a button replaced, keeping its markup (an icon beside the words stays) */
  function setButtonWords(el, text) {
    var walker = canvas.doc.createTreeWalker(el, 4), node, first = null;
    while ((node = walker.nextNode())) {
      if (!/\S/.test(node.nodeValue)) continue;
      if (!first) { first = node; node.nodeValue = text; } else node.nodeValue = '';
    }
    if (!first) el.appendChild(canvas.doc.createTextNode(text));
  }
  /* A new button in a section, made like the section's main one (its Register button, else its first button)
     and placed right after it; a section with no button gets the Add panel's plain button. */
  function newButtonIn(sec, text) {
    var primary = sec.querySelector('a[data-register-cta]') ||
      Array.prototype.filter.call(sec.querySelectorAll('a.btn, a.button, a[class*="btn"], a.hero-btn'), isShown)[0] || null;
    if (primary && !primary.closest('[data-rv-form-preview]')) {
      var copy = canvas.copyOf(primary);
      copy.removeAttribute('id');
      Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
      setButtonWords(copy, text);
      primary.after(copy);
      primary.after(canvas.doc.createTextNode(' '));
      canvas.adoptElement(copy);
      canvas.retag(copy);
      return copy;
    }
    var a = canvas.doc.createElement('a');
    a.className = 'rv-block-button';
    a.setAttribute('data-editable', 'button');
    a.textContent = text;
    contentBox(sec).appendChild(a);
    canvas.ensureBlockStyle();
    return a;
  }
  /* ids: the AI's refs -> the ids of the forms just made. Fills changedEls / done / said like the rest of Apply. */
  function applyFormOps(ids, ctaLinks, formEmbeds, changedEls, done, said) {
    var api = formsApi();
    if (!api) return;
    var idOf = function (ref) { return ids[ref] || ref; };
    ctaLinks.forEach(function (c) {
      var sec = canvas.sectionByKey(c.sectionId), form = api.get(idOf(c.form)), label = sectionLabel(c.sectionId);
      if (!isLive(sec) || !form) { said.push('A button in “' + label + '” was not linked: ' + (form ? 'the section is no longer on the page.' : 'its form does not exist.')); return; }
      var dest = { href: '#rv-form-' + form.id, register: !!form.countsAsRegistration, form: form.id };
      if (c.buttonText) {
        var el = buttonByLabel(sec, c.buttonText);
        if (!el) { said.push('“' + c.buttonText + '” in “' + label + '” is no longer on the page, so it was not linked.'); return; }
        var a = anchorOf(el) || (el.tagName === 'A' ? el : linkHost(el));
        writeLink(a, dest);
        clearAiGenerated(a);
        changedEls.push(a);
        done.push('“' + c.buttonText + '” in “' + label + '” opens “' + form.name + '”');
      } else {
        var text = String(c.newButtonLabel).replace(/\s+/g, ' ').trim().slice(0, 40);
        var made = newButtonIn(sec, text);
        writeLink(made, dest);
        clearAiGenerated(made);
        changedEls.push(made);
        done.push('new button “' + text + '” in “' + label + '” opens “' + form.name + '”');
      }
    });
    formEmbeds.forEach(function (e) {
      var form = api.get(idOf(e.form));
      if (!form) { said.push('A form was not put on the page: it does not exist.'); return; }
      if (e.sectionId) {
        var sec = canvas.sectionByKey(e.sectionId);
        if (!isLive(sec)) { said.push('“' + form.name + '” was not put on the page: its section is no longer there.'); return; }
        var embed = api.makeEmbed(canvas.doc, form.id, false);
        contentBox(sec).appendChild(embed);
        clearAiGenerated(embed);
        changedEls.push(embed);
        done.push('“' + form.name + '” put in “' + sectionLabel(e.sectionId) + '”');
        return;
      }
      var after = e.afterSectionId ? canvas.sectionByKey(e.afterSectionId) : null;
      var heading = String(e.heading || form.title || form.name).replace(/\s+/g, ' ').trim().slice(0, 80);
      var intro = String(e.intro || form.intro || 'Fill in your details below.').trim().slice(0, 300);
      var secEl = canvas.createGenericSection(heading, api.sectionHtml(form, heading, intro), restoreOpts().siteCss);
      canvas.insertSection(secEl, isLive(after) ? after : null);
      canvas.retag(secEl);
      changedEls.push(secEl);
      done.push('new section “' + heading + '” with the form “' + form.name + '”');
    });
  }

  /* ---------- a new picture, made by ETB2B AI and put in at once ----------
     The owner, 3 Nov 2026: asked for one ("a new hero picture of the Mumbai skyline at dusk", "give the agenda a
     background picture"), ETB2B AI makes ONE picture under the site's picture rules and puts it in straight away;
     Undo brings the old one back, as with every other change it makes (it is placed inside the turn's one undo
     step and checkpoint). The chat's answer only says what will be made and where — newPicture: { n, sectionId,
     placement, slot, apply: 'swap' | 'rework', kind, alt, subject }. The picture itself is made by a second call
     on the same route that sends nothing but the turn's id, so its subject is always the one the server checked
     and kept, never words read from this page. Which element takes it, and what is never touched (the logo unit,
     the ET logo, Content's own photos), is editor-ai-picture.js's (RevampAiPicture), the same code that tells the
     AI what each section holds (sectionsContext). Picture-making is offered to the AI only while that part is
     loaded (canMakePictures), so the AI never answers with a picture this page could not put in. */

  /* aiPictureRules:begin
     The decisions about a new picture that need nothing but what they are given: whether the AI's answer about it
     can be used, when phase 2 is asked again, how a failure is worded, whether a reworked section really shows the
     picture, and when a picture read back with the conversation is offered again. They are kept apart from the
     editor so they can be tested on their own: functions/lib/ai-picture-panel.test.js runs the code between the
     two aiPictureRules marks in node, so nothing in it may use the rest of this file. */
  var aiPictureRules = (function () {
    var WHERE = { hero: 'banner picture', background: 'background', picture: 'picture' };
    var UNUSABLE = 'The new picture — the answer about it could not be used. Ask again';
    /* A section of Content's records reworked to take the new picture (a background it did not have) is kept only
       if each of its records comes out as it was (RevampAiPicture.recordsState); otherwise it is put back and this
       is what the owner is told, the picture waiting in the tray (the lead's decision, 3 Nov 2026, finding B) */
    var RECORDS_CHANGED = 'left as it was — putting the new picture in would have changed what it shows from Content (a name, a role, a photo, a logo or a link)';
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    /* an entry of the change (a section rework) that names the new picture by its number */
    function usesPicture(entry, n) {
      return !!n && !!entry && Array.isArray(entry.pictures) && entry.pictures.indexOf(n) !== -1;
    }
    /* The answer's newPicture, checked against this page before anything is paid for.
       c: { loaded: the part that puts pictures in (RevampAiPicture) is there, eventId, turnId,
            attached: [url] sent with the message, known(sectionId): that section is on the page,
            edits: the change's section reworks }
       -> { ask } to make and put in, or { note } said in its place (nothing is made) */
    function checkAsk(ask, c) {
      var n = parseInt(ask && ask.n, 10), attached = c.attached || [];
      // its number follows the pictures attached to the message (at most 6), and is none of theirs
      var shaped = !!ask && typeof ask === 'object' && n >= 1 && n <= 7 && !attached[n - 1] &&
        typeof ask.placement === 'string' && has(WHERE, ask.placement) && (ask.apply === 'swap' || ask.apply === 'rework');
      if (!c.loaded) return { note: 'The new picture — this editor could not load the part that puts pictures in. Reload the editor and ask again' };
      if (!c.eventId || !c.turnId) return { note: 'The new picture could not be started — ask again' };
      if (!shaped) return { note: UNUSABLE };
      if (!c.known(ask.sectionId)) return { note: 'The new picture — the section it was for is no longer on the page' };
      // a rework puts it in: without one that names it, the picture would be paid for and never placed
      if (ask.apply === 'rework' && !(c.edits || []).some(function (e) { return usesPicture(e, n); })) return { note: UNUSABLE };
      return { ask: {
        n: n, sectionId: ask.sectionId, placement: ask.placement, slot: Math.max(0, parseInt(ask.slot, 10) || 0), apply: ask.apply,
        kind: String(ask.kind || ''), alt: String(ask.alt || '').replace(/\s+/g, ' ').trim().slice(0, 150),
        subject: String(ask.subject || '').replace(/\s+/g, ' ').trim().slice(0, 140)
      } };
    }
    /* Phase 2 again, or not? r: its last answer, { ok, status, body } or null (no answer at all).
       s: { retried, waited (ms since the first ask), waitMs }.
       'retry': no answer, or an error page from in front of the API — asked once more: the server answers a picture
         it already made without making another [C9];
       'wait':  the server is still making it (409) — asked again in a few seconds, which costs nothing, for as long
         as waitMs;
       'stop':  this answer stands. */
    function nextRequest(r, s) {
      if ((!r || (!r.body && r.status >= 500)) && !s.retried) return 'retry';
      if (r && r.status === 409 && s.waited < s.waitMs) return 'wait';
      return 'stop';
    }
    /* Phase 2 asked until its answer stands (nextRequest). once() -> Promise<answer | null>, never rejected;
       wait(ms) -> Promise; now() -> ms. -> Promise<the answer that stands | null> */
    function askUntilAnswered(once, wait, now, waitMs, pollMs) {
      var since = now(), retried = false;
      function ask() {
        return once().then(function (r) {
          var next = nextRequest(r, { retried: retried, waited: now() - since, waitMs: waitMs });
          if (next === 'retry') { retried = true; return ask(); }
          if (next === 'wait') return wait(pollMs).then(ask);
          return r;
        });
      }
      return ask();
    }
    /* phase 2's answer -> { url } of the new picture, or { why } it is not there, in plain words; { url, held: true,
       why } for a picture made but kept off the page (its check found people, words or a logo where its place takes
       none, twice): it goes to the tray, and why is said.
       madeHere(url): the address is one of this event's own generated pictures [C14] */
    var HELD = 'The new picture did not pass its check, so I did not put it on the page.';
    function outcome(r, madeHere) {
      var url = r && r.ok && r.body && typeof r.body.url === 'string' ? r.body.url : '';
      if (url && madeHere(url)) return r.body.held === true ? { url: url, held: true, why: String(r.body.heldWhy || '').replace(/\s+/g, ' ').trim().slice(0, 400) || HELD } : { url: url };
      return { why: url ? 'The picture came back from an address that is not this event’s own, so it was not used. Nothing on your site changed — ask again.'
        : r && r.body && r.body.error ? String(r.body.error)
        : r ? 'The picture could not be made (error ' + r.status + '). Nothing on your site changed — ask again.'
        : 'ETB2B AI could not be reached to make the picture. Nothing on your site changed — check your connection and ask again.' };
    }
    /* A picture that could not be made. The server's sentence says the site did not change, which is true of a
       message that asked only for the picture. itemCount: what the message planned to change, the picture's own item
       included; reworksWithIt: the reworks that only put the picture in (they go with it). When the message changes
       other things too, the sentence says that no picture changed instead. */
    function failedLine(why, itemCount, reworksWithIt) {
      var others = itemCount - 1 - reworksWithIt > 0;
      return others ? String(why).replace(/Nothing on (your|the) (site|page) changed/, 'No picture was changed') : String(why);
    }
    /* Is the picture at url drawn by this markup or CSS (a reworked section, and its own stylesheet)? Only where a
       picture is drawn from counts: an <img>'s or <source>'s src and srcset, a video's poster, an svg <image>'s
       href, a CSS url() (a style="" one too). The address named in an alt text, a link or a data- attribute does
       not show it. Its WebP copies (pictures.storeVariants: "<address>.rv-<hash>.<w>x<h>.w<width>.webp") count as
       it. */
    function shows(text, url) {
      text = String(text || '');
      if (!text || !url) return false;
      var u = escRe(url) + '(?:\\.rv-[0-9a-f]{8}\\.\\d+x\\d+\\.w\\d+\\.webp)?(?:\\?[^"\'\\s)&]*)?';
      var q = '(?:["\']|&quot;|&#39;)';
      return new RegExp('\\s(?:src|poster)\\s*=\\s*' + q + u + q, 'i').test(text) ||
        new RegExp('\\ssrcset\\s*=\\s*' + q + '(?:[^"\']*?[\\s,])?' + u + '(?=[\\s,"\']|&quot;|&#39;)', 'i').test(text) ||
        new RegExp('<image\\b[^>]*\\s(?:xlink:)?href\\s*=\\s*' + q + u + q, 'i').test(text) ||
        new RegExp('url\\(\\s*' + q + '?' + u + q + '?\\s*\\)', 'i').test(text);
    }
    /* A picture ETB2B AI made, read back with the conversation: is "Use this picture" (into the tray) offered under
       it? status: its change's; onPage: whether the page shows it now (null: not known). A change that went through
       ("applied") put it in — one whose picture was not put in always ends "partly" or "failed" — and an undone one
       was taken back on purpose. A "partly" one may have left it out: offered unless the page shows it. Any other
       (not done, closed while it was being made) never put it in. */
    function offerAgain(status, onPage) {
      if (status === 'applied' || status === 'undone') return false;
      if (status === 'partly') return onPage !== true;
      return true;
    }
    return { WHERE: WHERE, RECORDS_CHANGED: RECORDS_CHANGED, usesPicture: usesPicture, checkAsk: checkAsk, nextRequest: nextRequest, askUntilAnswered: askUntilAnswered, outcome: outcome,
      failedLine: failedLine, shows: shows, offerAgain: offerAgain };
  })();
  /* aiPictureRules:end */

  var AI_PICTURE_WHERE = aiPictureRules.WHERE;
  /* how long a picture the server is still making is waited for: the server may make a second one when the first
     fails its check (functions/lib/chat-picture.js, all within its 180 s deadline), then store it */
  var AI_PICTURE_WAIT_MS = 240000;
  var AI_PICTURE_POLL_MS = 5000;
  var offerPicture = null;             // puts a picture in the tray above the message box (wireChatPanel sets it)
  function aiPictures() {
    var P = window.RevampAiPicture;
    return P && typeof P.describe === 'function' && typeof P.slotOf === 'function' && typeof P.target === 'function' &&
      typeof P.place === 'function' && typeof P.unitState === 'function' && typeof P.recordsState === 'function' ? P : null;
  }
  /* the event's banner video is playing on the site (Design › Banner video): a new banner picture would not be seen */
  function heroVideoOn() {
    if (!heroVideo) return false;
    var core = window.RevampHeroVideoCore;
    try { return core && core.clean ? !!core.clean(heroVideo) : heroVideo.enabled !== false; } catch (e) { return false; }
  }
  /* what RevampAiPicture needs to know of this editor (its "h"): the canvas, the event, whether the banner video plays */
  function aiPictureHelpers() {
    return { canvas: canvas, eventId: eventId, videoOn: heroVideoOn() };
  }
  /* Storage's public address of a file kept with this event (events/<id>/…), as RevampCore.uploadImage and the
     server store them. This page does not know the bucket's name, so any bucket name is accepted there. */
  function ownPictureRe(rest) {
    var id = String(eventId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^https://storage\\.googleapis\\.com/[a-z0-9][a-z0-9._-]{1,220}/events/' + id + '/' + rest + '(\\?v=\\d+)?$');
  }
  function isOwnPicture(url) { return !!eventId && ownPictureRe('[^?#\\s"\'()<>\\\\]+').test(String(url || '')); }
  /* a picture ETB2B AI made is used only from this event's own generated pictures: anything else the answer
     carried is not put on the page [C14] */
  function madeHere(url) { return !!eventId && ownPictureRe('generated/[A-Za-z0-9._-]+').test(String(url || '')); }
  /* the 1-based place of a selected picture among its section's pictures as the AI is shown them (describe's
     list), 0 when it is not one of them — so "this picture" means that one, also on the server */
  function pictureSlotOf(sec, el) {
    var P = aiPictures();
    if (!P || !sec || !el) return 0;
    try { return Math.max(0, parseInt(P.slotOf(sec, el, aiPictureHelpers()), 10) || 0); }
    catch (err) { if (window.console) console.warn('[ETB2B AI] the selected picture could not be found among its section\'s pictures:', err); }
    return 0;
  }
  /* What the AI is told of a section's pictures (sectionsContext): only plain values, never an element */
  function plainPictureInfo(d) {
    var out = {};
    if (!d || typeof d !== 'object') return out;
    if (d.role) out.role = String(d.role);
    if (d.video) out.video = true;
    if (d.heroMode) out.heroMode = String(d.heroMode);
    var p = d.pics;
    if (p && typeof p === 'object') {
      out.pics = {
        slots: Math.max(0, parseInt(p.slots, 10) || 0),
        list: (Array.isArray(p.list) ? p.list : []).slice(0, 6).map(function (x) {
          if (x == null || typeof x !== 'object') return String(x == null ? '' : x);
          var o = {};
          Object.keys(x).forEach(function (k) { if (typeof x[k] === 'string' || typeof x[k] === 'number' || typeof x[k] === 'boolean') o[k] = x[k]; });
          return o;
        }),
        background: !!p.background,
        heroTarget: String(p.heroTarget || ''),
        wide: p.wide === true,
        own: (Array.isArray(p.own) ? p.own : []).filter(isOwnPicture).slice(0, 4)
      };
    }
    return out;
  }
  function pause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  /* POST /api/chat-edit { step: 'picture', turnId }: the turn's picture made and stored, or the one already made for
     it. With no answer at all (the connection dropped, or an error page from in front of the API) it is asked once
     more: the server answers a picture it already made without making another [C9]. While the server says it is
     still being made (409), it is asked again every few seconds, which costs nothing.
     -> Promise<{ ok, status, body } | null> — null: no answer */
  function requestPicture(turnId) {
    if (!window.RevampAuth || !RevampAuth.authedFetch) return Promise.resolve(null);
    function once() {
      return RevampAuth.authedFetch('/api/chat-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventId, step: 'picture', turnId: turnId })
      }).then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = JSON.parse(text); } catch (e) { /* not JSON: an error page from in front of the API */ }
          return { ok: res.ok, status: res.status, body: body };
        });
      }).then(null, function () { return null; });
    }
    return aiPictureRules.askUntilAnswered(once, pause, function () { return Date.now(); }, AI_PICTURE_WAIT_MS, AI_PICTURE_POLL_MS);
  }
  /* the picture ETB2B AI made, small, under its message. follow: it arrives while the owner waits for the change,
     so the conversation is kept at its end as it grows (unless the owner has scrolled up to read something) */
  function drawMadePicture(bubble, url, about, follow) {
    if (!bubble || !url) return null;
    var thread = follow ? chatThread() : null;
    var atEnd = function () { return !!thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; };
    var wasAtEnd = atEnd();
    var box = document.createElement('div');
    box.className = 'chat-made-pic';
    var im = document.createElement('img');
    im.alt = about ? 'New picture: ' + about : 'New picture made by ETB2B AI';
    if (wasAtEnd) im.addEventListener('load', function () { thread.scrollTop = thread.scrollHeight; });
    im.src = url;
    box.appendChild(im);
    bubble.appendChild(box);
    if (wasAtEnd) thread.scrollTop = thread.scrollHeight;
    return box;
  }
  /* The elements a picture is put on, as they were, so a placement that has to be taken back is taken back exactly.
     What a placement may change inside an element is kept too: an <svg> icon's drawing, and the <source>s of the
     <picture> around an <img> (they are taken out, or they would be shown instead of the new picture). */
  function keepPictureEls(els) {
    var all = [];
    els.forEach(function (el) {
      if (!el || el.nodeType !== 1) return;
      all.push(el);
      if (el.parentElement && el.parentElement.tagName === 'PICTURE') all.push(el.parentElement);
    });
    return all.filter(function (el, i) { return all.indexOf(el) === i; }).map(function (el) {
      var inner = el.namespaceURI === 'http://www.w3.org/2000/svg' || el.tagName === 'PICTURE';
      return { el: el, attrs: Array.prototype.map.call(el.attributes, function (a) { return [a.name, a.value]; }), inner: inner ? el.innerHTML : null };
    });
  }
  function putPictureElsBack(kept) {
    kept.forEach(function (k) {
      Array.prototype.slice.call(k.el.attributes).forEach(function (a) { k.el.removeAttribute(a.name); });
      k.attrs.forEach(function (a) { k.el.setAttribute(a[0], a[1]); });
      if (k.inner !== null) k.el.innerHTML = k.inner;
    });
  }
  function sameLogoUnit(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }

  /* An AI answer of kind "edit", applied at once (the owner, 28 Oct 2026: no proposal to accept). Its message is the
     AI's own sentence; under it, while it works, what is being done; then what really changed and what could not
     be done, with Undo. The page as it was just before is kept as the change's checkpoint (undoAiTurn). The
     server is told how it went, so the conversation remembers it (and the event's History has it).
     -> Promise that settles when the change is on the page (or could not be made). */
  function plainText(html) { var d = document.createElement('div'); d.innerHTML = html; return String(d.textContent || '').replace(/\s+/g, ' ').trim(); }
  /* sent: { pictureEl } — the picture the owner had selected when the message was sent (a new picture replaces it) */
  function runAiTurn(result, turnId, attached, sent) {
    // a copy: the new picture takes its number in it once made, for the rework that uses it (picturesFor)
    attached = (attached || []).slice();
    sent = sent || {};
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

    /* a new picture to make: checked against this page before anything is paid for */
    var P = aiPictures(), np = null;
    var usesNew = function (e) { return !!np && aiPictureRules.usesPicture(e, np.n); };
    if (result.newPicture) {
      var checked = aiPictureRules.checkAsk(result.newPicture, { loaded: !!P, eventId: eventId, turnId: turnId, attached: attached, known: known, edits: edits });
      if (checked.note) notes.push(checked.note);
      else {
        np = checked.ask;
        np.label = sectionLabel(np.sectionId);     // named now, while the section is there: it may be gone by the time the picture is made
      }
    }
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
      .concat(edits.map(function (e) {
        return escHtml(sectionLabel(e.sectionId)) + ' — rework: ' + escHtml(e.instruction) +
          (picturesFor(e).length ? ' <em>(uses attached picture ' + picturesFor(e).map(function (x) { return x.n; }).join(', ') + ')</em>' : '') +
          (usesNew(e) ? ' <em>(uses the new picture)</em>' : '');
      }))
      .concat(additions.map(function (n) { return 'New section &ldquo;' + escHtml(n.name) + '&rdquo;' + (n.afterSectionId && known(n.afterSectionId) ? ' after ' + escHtml(sectionLabel(n.afterSectionId)) : '') + ' — ' + escHtml(n.instruction); }));

    /* forms: new ones made first, then buttons that open them and forms put in the page (the server checked
       the shapes; what this page can no longer find is said, never silently left out) */
    var fApi = formsApi();
    var newForms = fApi ? (result.newForms || []).filter(function (n) {
      return n && n.ref && n.form && String(n.form.name || '').trim() && Array.isArray(n.form.fields) && n.form.fields.length;
    }) : [];
    var refNames = {};
    newForms.forEach(function (n) { refNames[n.ref] = String(n.form.name).trim(); });
    var nameOfForm = function (ref) { return refNames[ref] || (fApi && formName(ref)) || ''; };
    var ctaLinks = [], formEmbeds = [];
    (fApi ? result.ctaLinks || [] : []).forEach(function (c) {
      if (!c || !known(c.sectionId)) { if (c) notes.push('A button for a form in a section that is no longer on the page'); return; }
      if (!nameOfForm(c.form)) { notes.push(escHtml(sectionLabel(c.sectionId)) + ' — a button for a form that does not exist'); return; }
      if (c.buttonText && !buttonByLabel(canvas.sectionByKey(c.sectionId), c.buttonText)) {
        notes.push(escHtml(sectionLabel(c.sectionId)) + ' — there is no button &ldquo;' + escHtml(c.buttonText) + '&rdquo; to link');
        return;
      }
      if (!c.buttonText && !String(c.newButtonLabel || '').trim()) return;
      ctaLinks.push(c);
    });
    (fApi ? result.formEmbeds || [] : []).forEach(function (e) {
      if (!e) return;
      if (!nameOfForm(e.form)) { notes.push('A form to embed that does not exist'); return; }
      if (e.sectionId && !known(e.sectionId)) { notes.push('The form &ldquo;' + escHtml(nameOfForm(e.form)) + '&rdquo; — the section to put it in is no longer on the page'); return; }
      formEmbeds.push(e);
    });
    if (!fApi && ((result.newForms || []).length || (result.ctaLinks || []).length || (result.formEmbeds || []).length)) {
      notes.push('Forms — this editor could not load the forms part, so forms were left out. Reload the editor and ask again');
    }
    items = items.concat(newForms.map(function (n) {
      var f = n.form, bits = [(f.fields.length) + ' field' + (f.fields.length === 1 ? '' : 's')];
      if (f.needsApproval) bits.push('needs approval');
      if (f.countsAsRegistration) bits.push('counts as a registration');
      return 'New form &ldquo;' + escHtml(f.name) + '&rdquo; — ' + escHtml(bits.join(', '));
    })).concat(ctaLinks.map(function (c) {
      var where = escHtml(sectionLabel(c.sectionId)) + ': ';
      return c.buttonText ? where + '&ldquo;' + escHtml(c.buttonText) + '&rdquo; opens &ldquo;' + escHtml(nameOfForm(c.form)) + '&rdquo;'
        : where + 'new button &ldquo;' + escHtml(String(c.newButtonLabel).trim().slice(0, 40)) + '&rdquo; opens &ldquo;' + escHtml(nameOfForm(c.form)) + '&rdquo;';
    })).concat(formEmbeds.map(function (e) {
      if (e.sectionId) return escHtml(sectionLabel(e.sectionId)) + ': embed the form &ldquo;' + escHtml(nameOfForm(e.form)) + '&rdquo;';
      return 'New section ' + (e.afterSectionId && known(e.afterSectionId) ? 'after &ldquo;' + escHtml(sectionLabel(e.afterSectionId)) + '&rdquo;' : 'before the footer') +
        ' with the form &ldquo;' + escHtml(nameOfForm(e.form)) + '&rdquo;';
    }));
    if (np) items.push('New picture for &ldquo;' + escHtml(np.label) + '&rdquo; (' + AI_PICTURE_WHERE[np.placement] + '): ' + escHtml(np.subject));
    var cannot = (Array.isArray(result.unsupported) ? result.unsupported : []).map(function (u) { return String(u).trim(); }).filter(Boolean);
    var usable = items.length > 0;
    var notDone = notes.map(plainText).concat(cannot.map(function (c) { return 'I can’t do this here: ' + c; }));

    var bubble = appendChatMsg('ai', result.summary);
    var card = taskCard(bubble.parentNode);
    // live: made in this session, so its card offers Save while the page is not saved (drawCardSave)
    var t = { turnId: turnId || '', order: ++aiTurnOrder, before: null, ptr: -1, formIds: [], pageChanged: false, status: 'applying', button: null, card: card, result: result, startedAt: Date.now(), bubble: bubble, live: true };
    /* the change as steps, planned before anything is done — each lit as it runs and as it ends */
    var S = {};
    // the new picture is made first (before forms, before the page changes): every later step may need it
    if (np) {
      S.picMake = card.step('Make a new picture: ' + (np.subject || np.alt || 'as you asked'));
      if (np.apply === 'swap') S.picPlace = card.step('Put it in “' + np.label + '” as its ' + AI_PICTURE_WHERE[np.placement]);
    }
    if (newForms.length) S.forms = card.step(newForms.length === 1 ? 'Create the form “' + refNames[newForms[0].ref] + '”' : 'Create ' + newForms.length + ' forms');
    if (Object.keys(design).length) S.design = card.step('Update the design: ' + Object.keys(design).map(function (k) { return designLabel(k); }).join(', '));
    var textBy = {};
    textEdits.forEach(function (te) { (textBy[te.sectionId] = textBy[te.sectionId] || []).push(te); });
    Object.keys(textBy).forEach(function (sid) { S['text:' + sid] = card.step('Change the wording in “' + sectionLabel(sid) + '”' + (textBy[sid].length > 1 ? ' (' + textBy[sid].length + ' places)' : '')); });
    var OP_STEP = { hide: 'Hide', show: 'Show', remove: 'Remove', move: 'Move' };
    ops.forEach(function (o, i) { S['op' + i] = card.step(OP_STEP[o.op] + ' “' + sectionLabel(o.sectionId) + '”'); });
    var jobSteps = edits.map(function (e) { return card.step('Rework “' + sectionLabel(e.sectionId) + '”' + (usesNew(e) ? ' with the new picture' : '')); })
      .concat(additions.map(function (n) { return card.step('Add the section “' + n.name + '”'); }));
    if (ctaLinks.length || formEmbeds.length) S.formOps = card.step(ctaLinks.length && formEmbeds.length ? 'Link buttons to forms and place forms on the page'
      : ctaLinks.length ? 'Link ' + (ctaLinks.length === 1 ? 'a button' : ctaLinks.length + ' buttons') + ' to ' + (ctaLinks.length === 1 ? 'its form' : 'their forms')
      : 'Place ' + (formEmbeds.length === 1 ? 'the form' : formEmbeds.length + ' forms') + ' on the page');
    notDone.forEach(function (n) { card.step(n, 'fail'); });
    if (!usable) {
      t.status = 'failed';
      card.status('failed');
      card.note('Nothing on the page changed. Ask again in other words, or make the change yourself on the page.');
      reportTurn(t.turnId, 'failed', [], notDone);
      return Promise.resolve(t);
    }
    if (!canvas || remounting) {
      t.status = 'failed';
      card.status('failed');
      card.note('The page was being reloaded, so nothing changed. Ask again in a moment.');
      reportTurn(t.turnId, 'failed', [], ['the page was being reloaded']);
      return Promise.resolve(t);
    }
    aiTurns.push(t);
    deselect();
    flush();                          // what was pending stays its own undo step
    t.before = canvas.snapshot();     // the page as it was just before this change: its checkpoint
    currentAiTurn = t;
    setAiWorking(true);
    card.onProgress = function (n, of) { setChatStatus('working', 'Applying your change — ' + n + ' of ' + of + ' steps done'); };
    card.onProgress(0, card.count());

    /* the new picture first (it takes about half a minute; nothing on the page has changed while it is made), then
       forms: a button or an embed can only point at a form that exists. If one cannot be made, those already made
       are deleted again and nothing on the page changes. */
    var madePic = null;               // { url, placed } once the new picture is made
    var pictureMade = np ? makeNewPicture() : Promise.resolve();
    var formsMade = pictureMade.then(function () {
      if (!newForms.length) return { ids: {}, forms: [] };
      S.forms.set('run');
      return fApi.createForms(newForms).then(function (made) { S.forms.set('done'); return made; });
    });
    return formsMade.then(function (made) {
      if (!canvas || remounting) {
        if ((made.forms || []).length) formsChanged();
        throw new Error('the page was being reloaded' + ((made.forms || []).length ? ' (the forms were created: find them in the Forms panel)' : ''));
      }
      return applyPage(made);
    }).then(null, function (err) {
      if (t.stopped) return t;
      var why = (err && err.message) || 'a form could not be created';
      if (S.forms && S.forms.state !== 'done') S.forms.set('fail', why);
      card.steps().forEach(function (st) { if (st.state === 'wait' || st.state === 'run') st.set('fail', 'not done'); });
      t.status = 'failed';
      card.status('failed');
      // a picture already made is not lost with the rest: it waits in the tray to be placed
      var keptPic = keepMadePicture('The new picture');
      card.note('Nothing on the page changed.' + (keptPic ? ' ' + keptPic : ''));
      reportTurn(t.turnId, 'failed', [], [why]);
      setAiWorking(false);
      return t;
    });

    /* POST /api/chat-edit { step: 'picture' }: resolves either way — a picture that could not be made is a step
       not done, the rest of the change still goes ahead */
    function makeNewPicture() {
      S.picMake.set('run');
      setChatStatus('working', 'Making a new picture — about half a minute…');
      card.note('Making a new picture takes about half a minute.');
      return requestPicture(t.turnId).then(function (r) {
        card.note('');
        var got = aiPictureRules.outcome(r, madeHere);
        /* made, but kept off the page by its check: it waits in the tray, nothing is put in with it, and why is said */
        if (got.url && got.held) {
          madePic = { url: got.url, placed: false, offered: false };
          return pictureHeld(got.why);
        }
        if (got.url) {
          madePic = { url: got.url, placed: false, offered: false };
          attached[np.n - 1] = madePic.url;        // a rework that uses it finds it by its number (picturesFor)
          S.picMake.set('done');
          drawMadePicture(bubble, madePic.url, np.alt || np.subject, true);
          return;
        }
        pictureFailed(got.why);
      }, function (err) {
        card.note('');
        if (window.console) console.error(err);
        pictureFailed('The picture could not be made. Nothing on your site changed — ask again.');
      });
    }
    /* A picture that could not be made: its sentence (aiPictureRules.failedLine words it for a message that changes
       other things too), and the steps that needed the picture are not done. */
    function pictureFailed(why) {
      var line = aiPictureRules.failedLine(why, items.length, edits.filter(usesNew).length);
      S.picMake.set('fail', line);
      notDone.push(line);
      withoutNewPicture('the new picture could not be made');
    }
    /* A picture made but kept off the page by its check (the server's sentence says why): it is not put anywhere, and
       neither is any rework that would have used it; it waits in the tray (keepMadePicture, when the change ends). */
    function pictureHeld(why) {
      S.picMake.set('fail', why);
      notDone.push(why);
      withoutNewPicture('the new picture was kept off the page');
    }
    /* the steps that needed the new picture are not done: its placing, and each rework that would have used it */
    function withoutNewPicture(because) {
      if (S.picPlace) S.picPlace.set('fail', 'not done — ' + because);
      for (var i = edits.length - 1; i >= 0; i--) {
        if (!usesNew(edits[i])) continue;
        jobSteps[i].set('fail', 'not done — ' + because);
        notDone.push('“' + sectionLabel(edits[i].sectionId) + '” was not reworked: ' + because + '.');
        edits.splice(i, 1);
        jobSteps.splice(i, 1);
      }
    }
    /* A picture made and paid for that is not on the page is never lost: it goes in the tray above the message box,
       to be sent with where it goes; when the tray cannot take it, "Use this picture" under this message puts it
       there later. lead: how the sentence names it ('It' or 'The new picture').
       -> the sentence that says where it is; '' when it is on the page or none was made */
    function keepMadePicture(lead) {
      if (!madePic || madePic.placed) return '';
      if (offerPicture && offerPicture(madePic.url, true)) return lead + ' is in the tray above the message box: tell me where it goes.';
      if (!madePic.offered) { madePic.offered = true; drawUsePicture(bubble, madePic.url); }
      return lead + ' is under my message: “Use this picture” puts it in the tray, then tell me where it goes.';
    }
    /* A swap: the picture goes on the element RevampAiPicture.target() chooses — the banner's picture, a section's
       background or one of its pictures — and on nothing else. Never inside the logo unit or the ET logo; and if
       the logo unit reads differently afterwards (its picture, its dark copy, its note), the place is put back as it
       was. A place that is gone (the section removed meanwhile) leaves the picture in the tray: nothing is reworked
       to make up for it, which would be a second paid call nobody asked for. */
    function placeNewPicture(changedEls, done, said) {
      var label = np.label, sec = canvas.sectionByKey(np.sectionId), step = S.picPlace;
      function lost(why) {
        var line = 'I made the picture but could not put it in “' + label + '” — ' + why + '. ' + keepMadePicture('It');
        said.push(line);
        step.set('fail', line);
        madePic.told = true;            // the step says where it is: the card's last line need not say it again
      }
      if (!isLive(sec)) return lost('the section is no longer on the page');
      var help = aiPictureHelpers();
      var focusEl = sent.pictureEl && sent.pictureEl.isConnected && sec.contains(sent.pictureEl) ? sent.pictureEl : null;
      var tg = null;
      try { tg = P.target(sec, np, focusEl, help); } catch (err) { if (window.console) console.error(err); }
      if (!tg || tg.none || !tg.el || tg.el.nodeType !== 1 || !sec.contains(tg.el)) return lost(String((tg && tg.none) || 'it has no place for a picture now'));
      if (tg.el.closest('[data-rv-logo-unit], [data-rv-logo], [data-rv-etnav]')) return lost('that place belongs to the logo');
      var touched = [tg.el];
      Object.keys(tg).forEach(function (k) { if (tg[k] && tg[k].nodeType === 1) touched.push(tg[k]); });
      Array.prototype.forEach.call(sec.querySelectorAll('.hero-veil'), function (v) { touched.push(v); });
      var kept = keepPictureEls(touched), unitBefore = P.unitState(canvas.doc), put = false;
      // place() answers false, having changed nothing, for a place or an address it may not use
      try { put = P.place(tg, madePic.url, np.alt, help) === true; } catch (err) { if (window.console) console.error(err); }
      if (!put) {
        putPictureElsBack(kept);
        return lost('the picture could not be set there');
      }
      if (!sameLogoUnit(unitBefore, P.unitState(canvas.doc))) {
        putPictureElsBack(kept);
        said.push('“' + label + '” was left as it was — the change would have altered the logo unit. ' + keepMadePicture('The new picture'));
        return step.set('fail', 'left as it was — the change would have altered the logo unit');
      }
      madePic.placed = true;
      changedEls.push(tg.el);
      done.push('New picture made and put in “' + label + '” (' + AI_PICTURE_WHERE[np.placement] + ')');
      step.set('done');
    }

    function applyPage(made) {
      var formIds = (made.forms || []).map(function (f) { return f.id; });
      var leftOut = applyAiDesignToCanvas(canvas, design);
      var changedEls = [], done = [], said = [];
      /* each setting as the canvas reads it once set: read again before the change is called made, so a setting that
         did not hold is not reported as done */
      var designSet = {};
      Object.keys(design).forEach(function (k) { if (leftOut.indexOf(k) === -1) designSet[k] = canvas.design.get(k); });
      var textChanges = [];             // { sectionId, before, after } for each text whose words changed
      Object.keys(design).forEach(function (k) { if (leftOut.indexOf(k) === -1) done.push(plainText(designChangeHtml(k, design[k]))); });
      if (S.design) {
        if (leftOut.length === Object.keys(design).length) S.design.set('fail', 'this site has no such setting');
        else S.design.set('done', leftOut.length ? 'not changed: ' + leftOut.map(function (k) { return designLabel(k); }).join(', ') : '');
      }
      Object.keys(textBy).forEach(function (sid) {
        var missed = 0;
        textBy[sid].forEach(function (te) {
          var el = applyTextEdit(te, textChanges);
          if (!el) { missed++; said.push('“' + te.find + '” in “' + sectionLabel(te.sectionId) + '” was no longer there.'); return; }
          changedEls.push(el);
          clearAiGenerated(el);
          done.push(sectionLabel(te.sectionId) + ': ' + (te.replace ? '“' + te.find + '” → “' + te.replace + '”' : '“' + te.find + '” removed'));
        });
        if (missed === textBy[sid].length) S['text:' + sid].set('fail', 'that wording is no longer on the page');
        else S['text:' + sid].set('done', missed ? missed + ' of them no longer on the page' : '');
      });
      /* whole sections: hidden, shown, removed, moved */
      ops.forEach(function (o, i) {
        var sec = canvas.sectionByKey(o.sectionId), step = S['op' + i];
        if (!isLive(sec)) { step.set('fail', 'the section is no longer on the page'); return; }
        var label = '“' + sectionLabel(o.sectionId) + '”';
        if (o.op === 'hide' || o.op === 'show') { canvas.setHidden(sec, o.op === 'hide'); done.push(label + (o.op === 'hide' ? ' hidden' : ' shown')); step.set('done'); }
        else if (o.op === 'remove') { canvas.removeSection(sec); done.push(label + ' removed'); step.set('done'); }
        else if (o.op === 'move') {
          var before = o.beforeSectionId ? canvas.sectionByKey(o.beforeSectionId) : null;
          if (canvas.moveSection(sec, before || null)) { done.push(label + ' moved'); step.set('done'); }
          else { said.push(label + ' could not be moved there — the page’s first and last sections keep their places.'); step.set('fail', 'the first and last sections keep their places'); }
        }
      });
      if (canvas.retag) canvas.sections().forEach(function (sec) { canvas.retag(sec); });
      if (madePic && np.apply === 'swap') placeNewPicture(changedEls, done, said);

      /* sections reworked or written by the AI: asked for side by side (each takes a while), then ONE undo step.
         A new section's empty place is made first, in order, so two after the same section keep their order. */
      var lastAfter = {};
      var jobs = edits.map(function (e) { return { edit: e, sec: canvas.sectionByKey(e.sectionId), label: sectionLabel(e.sectionId) }; })
        .concat(additions.map(function (n) {
          var anchor = lastAfter[n.afterSectionId || ''] || (n.afterSectionId ? canvas.sectionByKey(n.afterSectionId) : null);
          var sec = addBlankSection(n.name, anchor);
          lastAfter[n.afterSectionId || ''] = sec;
          return { add: n, sec: sec, label: n.name };
        }));
      jobs.forEach(function (job, i) { job.step = jobSteps[i]; });
      if (jobs.length) card.note(jobs.length === 1 ? 'Reworking a section takes about half a minute.' : 'The ' + jobs.length + ' sections are being worked on side by side — about half a minute.');
      return Promise.all(jobs.map(function (job) {
        if (!isLive(job.sec)) { said.push('“' + job.label + '” is no longer on the page, so it was left out.'); job.step.set('fail', 'no longer on the page'); return null; }
        job.step.set('run');
        // the rework that puts the new picture in (a background or a picture for a section that has no place for one)
        var withPic = !!job.edit && !!madePic && usesNew(job.edit);
        var asked = requestSectionCode(job.sec, job.edit ? 'edit' : 'create', (job.edit || job.add).instruction, picturesFor(job.edit || job.add));
        /* The section is locked on the canvas while it is rewritten (the request above has already read it), and its
           words are noted: an answer that comes back after they changed is not put over them (QA, UX-092). */
        var wordsBefore = sectionWords(job.sec);
        lockSection(job.sec, true);
        return asked.then(function (code) {
          lockSection(job.sec, false);
          if (!isLive(job.sec)) throw new Error('the section was removed meanwhile');
          if (sectionWords(job.sec) !== wordsBefore) throw new Error('you edited it meanwhile, so it was left as you had it');
          /* the logo unit is never the new picture's to change: a rewrite that leaves it reading differently is
             taken back, section and CSS */
          var unitBefore = withPic ? P.unitState(canvas.doc) : null;
          var oldHtml = withPic ? canvas.copyOf(job.sec).outerHTML : '';
          var oldCss = withPic && code.cssIsOwn && canvas.sectionCss ? canvas.sectionCss(job.sec) : null;
          /* the section's records from Content (a section of records, or one holding Content's items), as they are
             before the rework: '' when it shows none */
          var recordsBefore = withPic ? P.recordsState(job.sec) : '';
          var fresh = applySectionCode(job.sec, code);
          if (!fresh) throw new Error('the AI’s answer was not a usable section');
          function putBack(why) {
            if (isLive(fresh)) canvas.replaceSection(fresh, oldHtml, oldCss);
            if (canvas.retag) canvas.sections().forEach(function (s) { canvas.retag(s); });
            throw new Error(why);
          }
          if (withPic && !sameLogoUnit(unitBefore, P.unitState(canvas.doc))) putBack('left as it was — the change would have altered the logo unit');
          /* A section of records reworked around the new picture is kept only if every record in it comes out as it
             was: its records are drawn into the rewrite first (the AI writes one example item; fillRecords draws them
             without touching the undo history), then read again. Records that could not be drawn count as changed. */
          var recordsKept = !recordsBefore ? Promise.resolve(true) : fillRecords(false).then(null, function () { return false; }).then(function () {
            return isLive(fresh) && P.recordsState(fresh) === recordsBefore;
          });
          return recordsKept.then(function (same) {
            if (!same) putBack(aiPictureRules.RECORDS_CHANGED);
            /* The new picture is put in only if the rewritten section really draws it: the model may leave out the
               picture it was given, and the server does not say so. Then the rework stands (Undo takes it back), the
               card does not claim the picture, and the picture, made and paid for, waits in the tray. */
            var picShown = withPic && aiPictureRules.shows(fresh.outerHTML + '\n' + (code.cssIsOwn && canvas.sectionCss ? canvas.sectionCss(fresh) : ''), madePic.url);
            if (picShown) madePic.placed = true;
            changedEls.push(fresh);
            done.push('“' + job.label + '” ' + (job.edit ? 'reworked' + (picShown ? ' with the new picture' : '') : 'added'));
            var unused = withPic && !picShown ? keepMadePicture('It') : '';
            if (unused) {
              said.push('“' + job.label + '” was reworked, but the new picture was not used in it. ' + unused);
              job.step.set('done', 'the new picture was not used in it. ' + unused);
              madePic.told = true;
            } else job.step.set('done');
          });
        }).then(null, function (err) {
          lockSection(job.sec, false);
          if (job.add && isLive(job.sec)) canvas.removeSection(job.sec);       // an empty shell is not left behind
          var why = (err && err.message) || 'the AI could not do it';
          // the picture was made and paid for: it waits in the tray to be placed
          var kept = withPic ? keepMadePicture('The new picture') : '';
          said.push('“' + job.label + '” was not ' + (job.edit ? 'changed' : 'added') + ': ' + why + '.' + (kept ? ' ' + kept : ''));
          job.step.set('fail', why);
        });
      })).then(function () {
        /* the editor is being left and the change was reported as not finished (stopAiTurn): nothing more is
           recorded or reported — the requests cut off by leaving would otherwise say "Failed to fetch" over it */
        if (t.stopped) return t;
        card.note('');
        // buttons that open a form, and forms put in the page: after the sections are written, in the same step
        if (ctaLinks.length || formEmbeds.length) {
          var doneBefore = done.length, saidBefore = said.length;
          applyFormOps(made.ids || {}, ctaLinks, formEmbeds, changedEls, done, said);
          if (done.length > doneBefore) S.formOps.set('done', said.length > saidBefore ? said.slice(saidBefore).join(' ') : '');
          else S.formOps.set('fail', said.slice(saidBefore).join(' ') || 'not done');
        }
        /* a setting that does not read as it was set (the page changed under the change) is not reported as made */
        var slipped = Object.keys(designSet).filter(function (k) { return canvas.design.get(k) !== designSet[k]; });
        if (slipped.length) {
          slipped.forEach(function (k) {
            var line = plainText(designChangeHtml(k, design[k])), at = done.indexOf(line);
            if (at !== -1) done.splice(at, 1);
          });
          said.push('Not kept: ' + slipped.map(designLabel).join(', ') + ' — the page changed while it was being applied.');
          if (S.design) S.design.set(slipped.length === Object.keys(designSet).length ? 'fail' : 'done', 'not kept: ' + slipped.map(designLabel).join(', '));
        }
        var redraw = changedEls.some(function (el) { return el.querySelector && el.querySelector('[data-rv-repeat-template]'); });
        /* An undo step only when something the AI did took effect (each one is in `done`). Otherwise — a picture
           that could not be made, wording no longer on the page — the turn changed nothing, and the editor's own
           marks set while it ran (retag above; restore sets them again after an Undo) are not a change to record:
           recorded, they made such a turn read "partly made" with an Undo that does nothing visible. */
        var changed = done.length ? commitNow() : false;
        if (formIds.length || ctaLinks.length || formEmbeds.length) {
          drawFormPreviews(false);
          if (fApi) fApi.afterAiChange();
          formsChanged();
        }
        if (formIds.length) {
          done.unshift((formIds.length === 1 ? 'Form “' + made.forms[0].name + '” created' : formIds.length + ' forms created: ' + made.forms.map(function (f) { return '“' + f.name + '”'; }).join(', ')) +
            (ctaLinks.length || formEmbeds.length ? '' : ' — not on the page yet: place it from the Forms panel, or ask me to add a button for it'));
        }
        // a setting this site has nothing for is said, not counted as done
        if (leftOut.length) said.push('Not changed: ' + leftOut.map(function (k) { return designLabel(k) + ' — ' + (unsupportedReason(k) || 'nothing on the page changed for it.'); }).join(' '));
        if (!changed) designChanged();
        t.formIds = formIds;
        t.pageChanged = !!changed;
        t.ptr = undoPtr;
        t.after = changed ? canvas.snapshot() : null;        // the page as this change left it
        var notAll = said.concat(notDone);
        t.status = workSafety.turnStatus(done, notAll, changed, formIds.length);
        /* Nothing took effect: the page goes back exactly as it was, so marks the editor set while it ran (retag,
           a section shell) leave nothing behind, and there is no Undo for a change that did not happen. */
        if (t.status === 'failed' && !changed && t.before) { canvas.restore(t.before, restoreOpts()); sectionsChanged(); }
        /* a change of settings and wording only can be undone on its own later, leaving the person's later edits */
        var onlyWords = !ops.length && !jobs.length && !formIds.length && !ctaLinks.length && !formEmbeds.length && !(madePic && madePic.placed);
        t.inverse = changed && onlyWords ? { design: Object.keys(designSet).filter(function (k) { return slipped.indexOf(k) === -1; }), text: textChanges } : null;
        /* A made picture that is not on the page waits in the tray, and the card's last line says so — also when it
           was put back to protect Content's records or the logo unit and nothing else changed (QA follow-up 2, F3:
           the card ended with only "Nothing on the page changed.") — unless a step already says where it is. */
        finishAiCard(t, madePic && !madePic.told ? keepMadePicture('The new picture') : '');
        if (madePic && madePic.placed && t.status !== 'failed') {
          card.note(np.apply === 'swap' ? 'Undo brings the old picture back.' : 'Undo puts “' + np.label + '” back as it was, without the new picture.');
        }
        reportTurn(t.turnId, t.status, done, notAll);
        if (t.status !== 'failed') keepCheckpoint(t); else t.before = null;
        setAiWorking(false);
        var first = changedEls.filter(function (el) { return el && el.isConnected; })[0];
        if (first) {
          // the first change is brought into view; inside an accordion item, the whole item, opened
          var around = canvas.itemAround(first) || first;
          canvas.openItem(first);
          canvas.scrollToSection(isShown(around) ? around : first.closest('[data-rv-section]'));
        }
        /* the event's records, drawn into what was rewritten. The "Edit with AI" live view was drawn at the commit
           above, from the rewrite as the AI sent it back (one model session, no day tabs), so it is told again once
           the records are in — else it shows a one-session agenda until the next change (QA, 3 Nov 2026: "give
           the Agenda a background picture"). */
        if (redraw) drawRecords(false).then(function () { pageChanged(); });
        return t;
      });
    }
  }

  /* ---------- a change as a task: its steps, each waiting, in progress, done or not done ----------
     taskCard(host) -> { step(text, state) -> { state, set(state, why) }, steps(), count(), status(kind), note(text),
     foot, onProgress(n, of) } — kind: run | applied | partly | failed | undone. */
  var TASK_BADGE = { run: 'In progress', applied: 'Done', partly: 'Partly done', failed: 'Not done', undone: 'Undone' };
  var TASK_TITLE = { run: 'Changing your site', applied: 'Change made', partly: 'Change partly made', failed: 'Couldn’t make this change', undone: 'Change undone' };
  function taskCard(host) {
    var el = document.createElement('div');
    el.className = 'ai-task is-run';
    el.setAttribute('role', 'group');
    el.innerHTML = '<div class="ai-task-head"><span class="ai-task-title"></span><span class="ai-task-badge"></span></div>' +
      '<div class="ai-task-bar"><i></i></div><ol class="ai-task-steps"></ol><div class="ai-task-note" hidden></div><div class="ai-task-foot" hidden></div>';
    host.appendChild(el);
    var list = el.querySelector('.ai-task-steps'), bar = el.querySelector('.ai-task-bar i'), note = el.querySelector('.ai-task-note');
    var steps = [];
    var api = { el: el, foot: el.querySelector('.ai-task-foot'), onProgress: null };
    function progress() {
      var n = steps.filter(function (s) { return s.state === 'done' || s.state === 'fail'; }).length;
      bar.style.width = steps.length ? Math.round(100 * n / steps.length) + '%' : '0';
      if (api.onProgress) api.onProgress(n, steps.length);
    }
    api.step = function (text, state) {
      var li = document.createElement('li'), span = document.createElement('span'), why = null;
      span.className = 'ai-step-text';
      span.textContent = text;
      li.appendChild(span);
      list.appendChild(li);
      var st = { state: state || 'wait', text: text };
      st.set = function (s, reason) {
        st.state = s;
        li.className = 'ai-step is-' + s;
        if (reason) {
          if (!why) { why = document.createElement('span'); why.className = 'ai-step-why'; li.appendChild(why); }
          why.textContent = reason;
        }
        progress();
      };
      li.className = 'ai-step is-' + st.state;
      steps.push(st);
      progress();
      var thread = chatThread();
      if (thread) thread.scrollTop = thread.scrollHeight;
      return st;
    };
    api.steps = function () { return steps.slice(); };
    api.count = function () { return steps.length; };
    api.status = function (kind) {
      el.className = 'ai-task is-' + kind;
      el.querySelector('.ai-task-title').textContent = TASK_TITLE[kind] || '';
      el.querySelector('.ai-task-badge').textContent = TASK_BADGE[kind] || '';
    };
    api.note = function (text) { note.textContent = text || ''; note.hidden = !text; };
    api.status('run');
    return api;
  }
  /* how a change ended: its badge, and Undo with how long it took (also for a turn read back from the server).
     kept: where a picture ETB2B AI made and did not put on the page is now ("The new picture is in the tray above
     the message box: tell me where it goes."), said last on the card; '' when there is none. */
  function finishAiCard(t, kept) {
    var card = t.card;
    card.status(t.status === 'applying' ? 'run' : t.status);
    // the AI's own sentence, when it did not happen or only in part, reads as what it set out to do (QA, UX-091)
    if (t.bubble) markPlan(t.bubble, t.status);
    if (t.status === 'failed') { card.note('Nothing on the page changed.' + (kept ? ' ' + kept : '')); return; }
    if (kept) card.note(kept);
    var foot = card.foot;
    foot.textContent = '';
    foot.hidden = false;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary btn-sm chat-undo'; b.textContent = 'Undo';
    b.title = 'Put the page back to how it was before this change';
    b.addEventListener('click', function () { undoAiTurn(t); });
    foot.appendChild(b);
    if (t.startedAt) {
      var took = document.createElement('span'); took.className = 'ai-task-time';
      took.textContent = 'Took ' + Math.max(1, Math.round((Date.now() - t.startedAt) / 1000)) + 's';
      foot.appendChild(took);
    }
    t.button = b;
    if (t.status === 'undone') markUndone(t);
    // made in this session: kept only in this browser until Save, which its card offers (QA, UX-093)
    else if (t.live) drawCardSave(t);
  }
  /* "What I tried: …" / "What I planned: …" before the AI's sentence, greyed */
  function markPlan(bubble, status) {
    var lead = workSafety.planLead(status), had = bubble.querySelector ? bubble.querySelector('.chat-plan-lead') : null;
    if (had) had.remove();
    bubble.classList.toggle('is-plan', !!lead);
    if (!lead) return;
    var b = document.createElement('span'); b.className = 'chat-plan-lead'; b.textContent = lead;
    bubble.insertBefore(b, bubble.firstChild);
  }
  /* a turn read back from the server: its steps as they ended (what changed, what could not be done) */
  function drawAiOutcome(t, done, notDone) {
    var card = t.card;
    done.forEach(function (d) { card.step(d, 'done'); });
    notDone.forEach(function (n) { card.step(n, 'fail'); });
    finishAiCard(t);
  }
  /* ETB2B AI's state, in its header and over its message box: ready, thinking (waiting for its answer) or working
     (applying a change). While it is not ready the box takes no message, and the strip above it says what it is
     doing — it never looks ready while it is busy (the owner, 28 Oct 2026). */
  var aiState = 'ready';             // 'ready' | 'thinking' | 'working', for Save, Publish, Undo, Redo and leaving
  function setChatStatus(state, text) {
    aiState = state === 'thinking' || state === 'working' ? state : 'ready';
    syncBusyControls();
    var panel = document.getElementById('panel-chat'), pill = document.getElementById('chat-status'), strip = document.getElementById('chat-busy');
    var input = document.getElementById('chat-input'), send = document.getElementById('chat-send'), attach = document.getElementById('chat-attach');
    var busy = state !== 'ready';
    if (panel) { panel.classList.toggle('is-busy', busy); panel.setAttribute('data-chat-state', state); }
    if (pill) {
      pill.className = 'chat-status is-' + state;
      var word = pill.querySelector('span');
      if (word) word.textContent = state === 'thinking' ? 'Thinking…' : state === 'working' ? 'Applying changes…' : 'Ready';
    }
    if (strip) {
      strip.hidden = !busy;
      var line = document.getElementById('chat-busy-text');
      if (line) line.textContent = text || (state === 'thinking' ? 'ETB2B AI is reading your request…' : 'ETB2B AI is applying your change…');
    }
    if (input) {
      if (!input.hasAttribute('data-placeholder')) input.setAttribute('data-placeholder', input.placeholder || '');
      input.disabled = busy;
      input.placeholder = busy ? 'Busy with your last request…' : input.getAttribute('data-placeholder');
    }
    if (send) send.disabled = busy;
    if (attach) attach.disabled = busy;
  }
  /* Save, Publish changes, Undo and Redo wait while ETB2B AI is busy, and their titles say why */
  function syncBusyControls() {
    var line = workSafety.busyLine(aiState), pub = document.getElementById('btn-publish');
    if (pub) {
      if (!pub.hasAttribute('data-title')) pub.setAttribute('data-title', pub.title || '');
      pub.disabled = !!line || !eventId || !canvas || remounting;
      pub.title = line || pub.getAttribute('data-title');
    }
    renderSiteState();
    updateHistoryButtons();
  }
  /* while a change is being applied the next message waits: two changes at once would overwrite each other. The
     same flag reaches every control that changes the page or its undo history: Save, Publish changes, Undo, Redo,
     the canvas and the side panels wait until the change is on the page (QA, UX-089 / UX-090). */
  var currentAiTurn = null;         // the change being applied, while there is one
  function setAiWorking(on) {
    aiWorking = !!on;
    if (!on) currentAiTurn = null;
    setChatStatus(on ? 'working' : 'ready');
    if (!on) repositionToolbars();    // the pills that waited (positionToolbars)
    if (!on) afterAiQueue.splice(0).forEach(function (fn) { try { fn(); } catch (err) { if (window.console) console.error(err); } });
  }
  /* what changes the page in its own time (an answer from the server) waits until ETB2B AI's change is on the page,
     so it is a step of its own and not part of the AI's */
  var afterAiQueue = [];
  function whenAiIdle(fn) { if (aiWorking) afterAiQueue.push(fn); else fn(); }

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
    /* The logo unit's note and its copy for a dark background are not the AI's to drop (it is asked to keep them):
       put back on the unit when the rewrite lost them and still shows the same picture */
    var oldUnit = sec.querySelector ? sec.querySelector('[data-rv-logo-unit]') : null;
    var keptNote = oldUnit ? oldUnit.getAttribute('data-rv-logo-note') : null;
    var keptCopy = oldUnit ? oldUnit.querySelector('img.rv-lu-dark') : null;
    var keptMain = oldUnit ? oldUnit.querySelector('img.rv-lu-img:not(.rv-lu-dark)') : null;
    keptCopy = keptCopy ? keptCopy.cloneNode(true) : null;
    var keptSrc = keptMain ? keptMain.getAttribute('src') : null;
    var fresh = canvas.replaceSection(sec, root.outerHTML, code.cssIsOwn ? code.css : null);
    if (fresh) fresh.setAttribute('data-ai-generated', 'true');      // written by the AI: asked about before publishing
    var newUnit = fresh && fresh.querySelector ? fresh.querySelector('[data-rv-logo-unit]') : null;
    if (newUnit) {
      if (keptNote && !newUnit.hasAttribute('data-rv-logo-note')) newUnit.setAttribute('data-rv-logo-note', keptNote);
      var newMain = newUnit.querySelector('img.rv-lu-img:not(.rv-lu-dark)');
      if (keptCopy && newMain && newMain.getAttribute('src') === keptSrc && !newUnit.querySelector('img.rv-lu-dark')) newMain.parentNode.insertBefore(newUnit.ownerDocument.importNode(keptCopy, true), newMain.nextSibling);
    }
    if (oldUnit) logoUnitNotice();
    return fresh;
  }
  /* A section being rewritten by ETB2B AI is locked on the canvas: dimmed, not clickable (editor-canvas.css), with
     "ETB2B AI is rewriting this section…" over it. The mark is the editor's own: never in a snapshot or a saved page
     (editor-canvas.js counts it as transient). */
  var busyPills = [];               // { sec, el } — the caption over each locked section
  function lockSection(sec, on) {
    if (!sec || sec.nodeType !== 1) return;
    if (on) {
      sec.setAttribute('data-rv-ai-busy', '');
      var pill = document.createElement('div');
      pill.className = 'tpl-ai-busy';
      pill.setAttribute('role', 'status');
      pill.textContent = 'ETB2B AI is rewriting this section…';
      frame.appendChild(pill);
      busyPills.push({ sec: sec, el: pill });
    } else {
      sec.removeAttribute('data-rv-ai-busy');
      busyPills = busyPills.filter(function (p) { if (p.sec !== sec) return true; p.el.remove(); return false; });
    }
    positionBusyPills();
  }
  /* each caption at the top of its section, kept inside the canvas as it scrolls */
  function positionBusyPills() {
    if (!busyPills.length) return;
    var fr = frame.getBoundingClientRect();
    busyPills.forEach(function (p) {
      if (!canvas || remounting || !p.sec.isConnected) { p.el.hidden = true; return; }
      var r = canvas.screenRect(p.sec);
      p.el.hidden = r.bottom <= fr.top || r.top >= fr.bottom;
      if (p.el.hidden) return;
      p.el.style.top = Math.max(8, Math.min(r.top - fr.top + 12, r.bottom - fr.top - p.el.offsetHeight - 8)) + 'px';
      p.el.style.left = Math.max(8, r.left - fr.left + (r.width - p.el.offsetWidth) / 2) + 'px';
    });
  }
  /* what a section says (its texts and buttons): an answer for it is not put over words changed since it was asked */
  function sectionWords(sec) {
    if (!sec || !sec.querySelectorAll) return '';
    return Array.prototype.map.call(sec.querySelectorAll('[data-editable="text"], [data-editable="button"]'), function (el) {
      return String(el.textContent || '').replace(/\s+/g, ' ').trim();
    }).join('\u0001');
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

  /* A real back-and-forth, not a one-shot command box. The conversation is kept on the server under the person
     who had it (POST /api/chat-edit stores each turn; GET /api/chat/history reads it back), and the AI's memory is
     that stored conversation with what really happened after each answer — applied, partly, undone. Only an
     editor with no event (a template opened on its own) keeps a short memory of its own here. */
  var localHistory = [];
  function pushLocal(role, text) {
    localHistory.push({ role: role, text: text });
    if (localHistory.length > 16) localHistory.splice(0, localHistory.length - 16);
  }
  /* a sent message's bubble, with what it was about (the section selected) and the pictures sent with it */
  function drawUserTurn(text, focusName, pictureUrls, pictureCount) {
    var mine = appendChatMsg('user', text);
    if (focusName && mine) {
      var tag = document.createElement('div');
      tag.className = 'chat-msg-focus';
      tag.textContent = '↳ ' + focusName;
      mine.insertBefore(tag, mine.firstChild);
    }
    if (mine && pictureUrls && pictureUrls.length) {
      var strip = document.createElement('div');
      strip.className = 'chat-sent-pics';
      pictureUrls.forEach(function (u) { var im = document.createElement('img'); im.src = u; im.alt = 'Attached picture'; strip.appendChild(im); });
      mine.appendChild(strip);
    } else if (mine && pictureCount) {
      var note = document.createElement('div'); note.className = 'chat-msg-focus'; note.textContent = pictureCount + ' picture' + (pictureCount === 1 ? '' : 's') + ' attached';
      mine.appendChild(note);
    }
    return mine;
  }
  /* A turn read back with a picture ETB2B AI made: the picture under its message. One that may not be on the page
     (the editor was closed while it was being made, the change could not be applied, or it was left out of the
     change and went to the tray, which a reload empties) is not lost: "Use this picture" puts it in the tray, to be
     sent with a message that says where it goes (aiPictureRules.offerAgain). */
  function drawHistoryPicture(bubble, h) {
    var pic = h && h.newPicture;
    if (!pic || pic.state !== 'made' || !madeHere(pic.url)) return;
    drawMadePicture(bubble, pic.url, String(pic.subject || '').slice(0, 140));
    // only a "partly" change needs the page read: whether the picture is on it now (null: the page cannot be read)
    var onPage = null;
    if (h.status === 'partly' && canvas && !remounting && canvas.doc && canvas.doc.documentElement) {
      try { onPage = aiPictureRules.shows(canvas.doc.documentElement.outerHTML, pic.url); } catch (e) { onPage = null; }
    }
    if (aiPictureRules.offerAgain(h.status, onPage)) drawUsePicture(bubble, pic.url);
  }
  /* "Use this picture" under a picture ETB2B AI made: puts it in the tray above the message box */
  function drawUsePicture(bubble, url) {
    if (!bubble || !url) return;
    var use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn btn-secondary btn-sm chat-use-pic';
    use.textContent = 'Use this picture';
    use.title = 'Put this picture in the tray above the message box, then say where it goes';
    use.addEventListener('click', function () {
      if (!offerPicture || !offerPicture(url)) return;
      showToast('The picture is in the tray above the message box — say where it goes and send.');
      var box = document.getElementById('chat-input');
      if (box && !box.disabled) box.focus();
    });
    bubble.appendChild(use);
  }
  /* The conversation so far, read back when the editor opens: each turn as it was, with what happened; Undo where
     this browser still keeps the change's checkpoint. -> Promise<number of turns> */
  function loadChatHistory() {
    if (!eventId || !window.RevampAuth) return Promise.resolve(0);
    return RevampAuth.authedFetch('/api/chat/history?eventId=' + encodeURIComponent(eventId)).then(function (res) {
      return res.ok ? res.json() : { turns: [] };
    }).then(function (body) {
      var turns = (body && body.turns) || [];
      if (!turns.length) return 0;
      var head = document.createElement('div'); head.className = 'chat-day'; head.textContent = 'Earlier in this conversation';
      appendChatNode(head);
      return turns.reduce(function (chain, h) {
        return chain.then(function () {
          drawUserTurn(h.question, h.focus, null, h.pictures);
          var bubble = appendChatMsg('ai', h.answer);
          drawHistoryPicture(bubble, h);
          if (h.kind !== 'edit') return;
          var t = { turnId: h.id, order: ++aiTurnOrder, before: null, ptr: -1, formIds: [], pageChanged: h.status !== 'failed', status: h.status, button: null, card: taskCard(bubble.parentNode), bubble: bubble };
          aiTurns.push(t);
          if (h.status === 'applying') { t.card.status('failed'); t.card.note('This change was still being applied when the editor was closed; its result is not known.'); return; }
          drawAiOutcome(t, h.done || [], h.notDone || []);
          if (t.status === 'undone' || t.status === 'failed') return;
          /* Undo needs the checkpoint kept in this browser */
          return localGet(checkpointKey(h.id)).then(function (kept) {
            if (kept && kept.before) { t.before = kept.before; t.after = kept.after || null; t.formIds = kept.formIds || []; t.pageChanged = kept.pageChanged !== false; t.inverse = kept.inverse || null; return; }
            /* the top bar's Undo has nothing from before this session: the card says how to get back instead (QA, UX-093) */
            if (t.button) { t.button.disabled = true; t.button.title = workSafety.UNDO_GONE; }
            t.card.note(workSafety.UNDO_GONE);
          });
        });
      }, Promise.resolve()).then(function () {
        var line = document.createElement('div'); line.className = 'chat-day'; line.textContent = 'Now';
        appendChatNode(line);
        return turns.length;
      });
    }).then(null, function () { return 0; });
  }

  /* ---------- what ETB2B AI sees of the page ----------
     A picture of the page as it looks in the editor goes with each message, so the AI judges the look itself (the
     owner, 28 Oct 2026: "I can't see the page as visitors do" is not what an AI should say). html-to-image draws the
     canvas's own nodes in the canvas's own window (its fonts and styles), one section at a time (a whole page in one
     drawing is too large for a browser to load), and the sections are put one under another:
       - a section selected: that section;
       - a request about the look of the site: every section, top to bottom, in up to four slices;
       - otherwise: the sections in view (at most two).
     Pictures: our Storage and ET's image hosts send no CORS headers, so while it draws, a picture from another host is
     fetched through /api/promo/image as a small copy, signed in — the SEE_PICTURES largest on the page, six at a time;
     the rest stand as boxes marked "picture" (a page of 140 photos took a minute). The fonts are read once (Latin only)
     and kept for the editor's session. A section that cannot be drawn is drawn again without its pictures, else
     stands as a grey block with its name. Never holds a message back for long: with no picture, the AI is told it
     has none. -> Promise<{ what, shots: [dataUrl] }> */
  var SEE_WIDTH = 1000, SEE_SLICES = 4, SEE_SLICE_H = 2400, SEE_PICTURE_W = 480, SEE_PICTURES = 16, SEE_AT_ONCE = 3;
  var SEE_WAIT_MS = { page: 20000, section: 12000, visible: 12000 };
  var LOOK_WORDS = /\b(looks?|design|layout|premium|modern|ugly|beautiful|better|improve|review|check|wrong|messy|clean|spacing|spaced|align\w*|colou?rs?|fonts?|style|visual\w*|see|appear\w*|feel|polish\w*|consistent|balance|hierarchy|whole|overall|attractive|professional|bland|boring|empty|blank|cluttered)\b/i;
  var BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  /* a picture left out of the drawing (past SEE_PICTURES): a hatched grey box marked "picture", so the AI can tell it
     from a page that really has an empty box (it is told so too) */
  var LEFT_OUT = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<defs><pattern id="h" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#cfd3da"/><rect width="6" height="16" fill="#bfc4cd"/></pattern></defs>' +
    '<rect width="400" height="300" fill="url(#h)"/><text x="200" y="160" font-family="Arial" font-size="34" font-weight="700" fill="#5b6170" text-anchor="middle">picture</text></svg>');
  var seeFontCss = null;            // { doc, css: Promise<string> } — the canvas's fonts, read once
  function captureLib(win) {
    if (win.htmlToImage) return Promise.resolve(win.htmlToImage);
    return new Promise(function (resolve) {
      var sc = win.document.createElement('script');
      sc.src = '/assets/vendor/html-to-image.js';
      sc.setAttribute('data-rv-editor', '');                 // the editor's, never saved with the page
      sc.onload = function () { sc.remove(); resolve(win.htmlToImage || null); };
      sc.onerror = function () { sc.remove(); resolve(null); };
      (win.document.head || win.document.documentElement).appendChild(sc);
    });
  }
  /* the canvas's web fonts as one stylesheet, Latin faces only (the rest, every other alphabet, made it 1.8 MB) */
  function fontCssFor(h2i, doc) {
    if (seeFontCss && seeFontCss.doc === doc) return seeFontCss.css;
    var css = h2i.getFontEmbedCSS(doc.body).then(function (all) {
      return String(all || '').split(/(?=@font-face)/).filter(function (block) {
        var range = /unicode-range:\s*([^;}]+)/i.exec(block);
        return !range || /U\+0000-00FF/i.test(range[1]);
      }).join('');
    }, function () { return ''; });
    seeFontCss = { doc: doc, css: css };
    return css;
  }
  function seePage(instruction, focusSec) {
    if (!canvas || !canvas.win || !canvas.doc || !eventId) return Promise.resolve({ what: '', shots: [] });
    var win = canvas.win, doc = canvas.doc;
    var what = focusSec ? 'section' : LOOK_WORDS.test(instruction) ? 'page' : 'visible';
    var token = window.RevampAuth && RevampAuth.getIdToken ? RevampAuth.getIdToken().then(null, function () { return ''; }) : Promise.resolve('');
    var stopped = false;
    return Promise.all([captureLib(win), token]).then(function (got) {
      var h2i = got[0], bearer = got[1];
      if (!h2i) return { what: what, shots: [] };
      /* pictures from other hosts, through our address as small copies: the first SEE_PICTURES, six at a time */
      var realFetch = win.fetch, here = win.location.origin, seen = [], active = 0, waiting = [], leftOut = 0, undrawn = [];
      function slot() { return new Promise(function (go) { if (active < 6) { active++; go(); } else waiting.push(go); }); }
      function free() { active--; var next = waiting.shift(); if (next) { active++; next(); } }
      win.fetch = function (url, init) {
        var u = String((url && url.url) || url || '');
        if (!/^https:\/\//i.test(u) || u.indexOf(here) === 0 || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(u)) return realFetch.apply(win, arguments);
        if (seen.indexOf(u) === -1) seen.push(u);
        if (stopped || !allowed[u]) { leftOut++; return realFetch.call(win, LEFT_OUT); }
        return slot().then(function () {
          return realFetch.call(win, '/api/promo/image?eventId=' + encodeURIComponent(eventId) + '&w=' + SEE_PICTURE_W + '&url=' + encodeURIComponent(u), { headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });
        }).then(function (r) { free(); return r; }, function (err) { free(); throw err; });
      };
      var bg = win.getComputedStyle(doc.body).backgroundColor || '#ffffff';
      function keep(n) {
        if (n.nodeType !== 1) return true;
        if (n.hasAttribute('data-rv-editor') || n.hasAttribute('data-rv-edge') || /^(IFRAME|VIDEO|SCRIPT|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) return false;
        /* a picture with no address yet (a partner's logo still to come): fetching "" brings the editor page back, and the
           drawing fails */
        if (n.tagName === 'IMG' && !String(n.getAttribute('src') || '').trim()) return false;
        return !(n.classList && n.classList.contains('is-hidden-sec'));
      }
      function keepNoPictures(n) { return keep(n) && !(n.nodeType === 1 && n.tagName === 'IMG'); }
      var scale = Math.min(1, SEE_WIDTH / (doc.body.scrollWidth || win.innerWidth || SEE_WIDTH));
      /* one section; drawn again without its pictures when it cannot be drawn with them; else a grey block with its name */
      function drawSection(sec, fonts) {
        var opts = { pixelRatio: scale, backgroundColor: bg, imagePlaceholder: BLANK_GIF, filter: keep, cacheBust: false, fontEmbedCSS: fonts };
        return h2i.toCanvas(sec, opts).then(null, function () {
          return h2i.toCanvas(sec, Object.assign({}, opts, { filter: keepNoPictures })).then(null, function () {
            undrawn.push(sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-section') || 'a section');
            var c = document.createElement('canvas'), g;
            c.width = Math.round((sec.offsetWidth || SEE_WIDTH / scale) * scale); c.height = Math.max(40, Math.round((sec.offsetHeight || 80) * scale));
            g = c.getContext('2d'); g.fillStyle = '#d9dbe1'; g.fillRect(0, 0, c.width, c.height);
            g.fillStyle = '#4a4f5c'; g.font = '16px Arial'; g.fillText('[' + (sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-section') || 'section') + ' — could not be drawn]', 16, Math.min(c.height - 12, 28));
            return c;
          });
        });
      }
      /* the drawings one under another, then cut into slices of at most SEE_SLICES */
      function stackAndSlice(parts) {
        if (!parts.length) return [];
        var w = Math.max.apply(null, parts.map(function (c) { return c.width; }));
        var total = parts.reduce(function (h, c) { return h + c.height; }, 0);
        var n = Math.min(SEE_SLICES, Math.max(1, Math.ceil(total / SEE_SLICE_H))), sliceH = Math.ceil(total / n), out = [];
        for (var i = 0; i < n; i++) {
          var part = document.createElement('canvas'), g, top = i * sliceH, y = 0;
          part.width = w; part.height = Math.min(sliceH, total - top);
          g = part.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, part.width, part.height);
          parts.forEach(function (c) {
            if (y + c.height > top && y < top + part.height) g.drawImage(c, 0, y - top);
            y += c.height;
          });
          out.push(part.toDataURL('image/jpeg', 0.72));
        }
        return out;
      }
      var shown = canvas.sections().filter(function (sec) { return isShown(sec) && sec.offsetHeight > 2; });
      var targets = what === 'section' ? [focusSec] : what === 'page' ? shown : shown.filter(function (sec) { return canvas.inView(sec); }).slice(0, 2);
      /* the pictures drawn for real: the SEE_PICTURES largest on the page (banners and section photos, not the first
         rows of a wall of logos), each by the largest place it fills */
      var area = {};
      function note(u, el) {
        u = String(u || '').replace(/^url\(["']?|["']?\)$/g, '');
        if (!/^https:\/\//i.test(u) || u.indexOf(here) === 0) return;
        var r = el.getBoundingClientRect(), a = Math.max(0, r.width) * Math.max(0, r.height);
        if (!(area[u] >= a)) area[u] = a;
      }
      targets.forEach(function (sec) {
        /* every address a picture may be drawn from: what it shows, its src, and each of its srcset */
        Array.prototype.forEach.call(sec.querySelectorAll('img'), function (img) {
          note(img.currentSrc, img); note(img.getAttribute('src'), img); note(img.src, img);
          String(img.getAttribute('srcset') || '').split(',').forEach(function (c) { note(c.trim().split(/\s+/)[0], img); });
        });
        Array.prototype.forEach.call([sec].concat(Array.prototype.slice.call(sec.querySelectorAll('*'))), function (el) {
          var bgi = win.getComputedStyle(el).backgroundImage;
          if (bgi && bgi !== 'none') (bgi.match(/url\([^)]+\)/g) || []).forEach(function (u) { note(u, el); });
        });
      });
      /* a picture counts once, whichever of its addresses is drawn: its addresses are allowed together */
      var allowed = {}, byPicture = {};
      Object.keys(area).forEach(function (u) { var k = u.replace(/\.rv-[0-9a-f]{8}\.\d+x\d+\.w\d+\.webp$/, ''); (byPicture[k] = byPicture[k] || { a: 0, urls: [] }).urls.push(u); byPicture[k].a = Math.max(byPicture[k].a, area[u]); });
      Object.keys(byPicture).sort(function (a, b) { return byPicture[b].a - byPicture[a].a; }).slice(0, SEE_PICTURES).forEach(function (k) { byPicture[k].urls.forEach(function (u) { allowed[u] = true; }); });
      /* SEE_AT_ONCE sections drawn side by side; each drawing kept in its place in the page */
      var done = [], next = 0;
      function drawnSoFar() { var out = []; for (var i = 0; i < targets.length && done[i]; i++) out.push(done[i]); return out; }
      var work = fontCssFor(h2i, doc).then(function (fonts) {
        function lane() {
          if (stopped || next >= targets.length) return Promise.resolve();
          var i = next++;
          return drawSection(targets[i], fonts).then(function (c) { if (!stopped) done[i] = c; return lane(); });
        }
        var lanes = [];
        for (var k = 0; k < SEE_AT_ONCE; k++) lanes.push(lane());
        return Promise.all(lanes);
      }).then(function () { return true; });
      /* out of time: what is drawn so far goes, and the sections still to draw are named as not drawn */
      var late = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, SEE_WAIT_MS[what] || 12000); });
      return Promise.race([work, late]).then(function (finished) {
        stopped = true;
        win.fetch = realFetch;
        var drawn = drawnSoFar();
        if (!finished) {
          targets.slice(drawn.length).forEach(function (sec) { undrawn.push(sec.getAttribute('data-sec-name') || sec.getAttribute('data-rv-section') || 'a section'); });
          if (window.console) console.warn('[ETB2B AI] the page took too long to draw; ' + drawn.length + ' of ' + targets.length + ' sections go with the message');
        }
        return { what: what, shots: stackAndSlice(drawn).slice(0, SEE_SLICES), leftOut: leftOut, undrawn: undrawn };
      }, function (err) {
        stopped = true;
        win.fetch = realFetch;
        if (window.console) console.warn('[ETB2B AI] the page could not be drawn:', err);
        return { what: what, shots: [] };
      });
    });
  }

  function wireChatPanel() {
    var input = document.getElementById('chat-input'), send = document.getElementById('chat-send');
    if (!input || !send) return;
    /* A single edit instruction looks identical whether or not real conversation memory exists behind it —
       that only becomes visible on a follow-up ("now make it darker instead"). Say so up front, so this
       reads as an actual chat from the first message, not a repaint of the old one-shot prompt box. */
    /* the first open: who it is, how it works, and a few things to ask — a tap sends one */
    var welcome = null;
    function drawWelcome() {
      welcome = document.createElement('div');
      welcome.className = 'chat-welcome';
      welcome.innerHTML = '<h4>Hi, I’m ETB2B AI.</h4><p>Tell me what to change on this site, or ask me anything about it. I make each change straight away, show you every step as I do it, and every change has an Undo. Press Save to keep your changes; nothing goes live until you publish.</p><div class="chat-suggest"></div>';
      ['What can you change on this page?', 'Make the buttons rounder', 'Rewrite the hero tagline to sound more premium', 'Add a short FAQ section before the footer'].forEach(function (q) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = q;
        b.addEventListener('click', function () { if (input.disabled) return; input.value = q; go(); });
        welcome.querySelector('.chat-suggest').appendChild(b);
      });
      appendChatNode(welcome);
    }
    loadChatHistory().then(function (n) { if (!n) drawWelcome(); });
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
    /* a picture ETB2B AI made that could not be put where it was meant to go: in the tray, ready to be sent with the
       next message ("put it in the agenda") — it is already stored with the event, so it is placed like any attached
       picture. quiet: a full tray is not said in a toast (the caller says where the picture is instead).
       -> true when it is in the tray */
    offerPicture = function (url, quiet) {
      if (!url) return false;
      if (attachments.some(function (a) { return a.url === url; })) return true;
      if (attachments.length + uploading >= MAX_ATTACHED) {
        if (!quiet) showToast('The tray above the message box is full: remove a picture from it, then try again.', { kind: 'error' });
        return false;
      }
      attachments.push({ url: url, name: 'New picture made by ETB2B AI' });
      drawTray();
      return true;
    };
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
      if (aiWorking) { showToast('One moment — ETB2B AI is still applying your last change.'); return; }
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
      /* a picture selected on the page is the one a new picture replaces: it is remembered for when the change is
         made (the selection is let go of then), and the AI is told its place among the section's pictures */
      var pictureEl = null;
      if (focus && focus.element && focus.element.kind === 'image' && selectedEl && selectedEl.isConnected) {
        pictureEl = selectedEl;
        var slot = pictureSlotOf(canvas.sectionByKey(focus.sectionId), pictureEl);
        if (slot) focus.slot = slot;
      }
      drawUserTurn(instruction, focus ? focus.name + (focus.element && focus.element.text ? ' · “' + (focus.element.text.length > 40 ? focus.element.text.slice(0, 39) + '…' : focus.element.text) + '”' : '') : '', sent);
      if (welcome && welcome.parentNode) welcome.parentNode.removeChild(welcome);
      var dots = document.createElement('div');
      dots.className = 'chat-typing';
      dots.setAttribute('aria-label', 'ETB2B AI is thinking');
      dots.innerHTML = '<i></i><i></i><i></i>';
      var thinking = appendChatBubble('ai', dots);
      setChatStatus('thinking');
      function settle() {
        var turn = thinking.closest('.chat-turn');
        if (turn) turn.remove();
        busy = false;
        setChatStatus('ready');
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
      /* signed in, as every other request of the editor (the server keeps the turn under the person who sent it) */
      var send$ = window.RevampAuth && RevampAuth.authedFetch ? RevampAuth.authedFetch : fetch;
      /* the page as it looks goes with the message, so the AI sees it (seePage) */
      var focusSec = focus && focus.sectionId ? canvas.sectionByKey(focus.sectionId) : null;
      setChatStatus('thinking', 'ETB2B AI is looking at your page…');
      seePage(instruction, focusSec).then(function (view) {
        setChatStatus('thinking', 'ETB2B AI is reading your request…');
        return send$('/api/chat-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eventId || '', instruction: instruction, history: eventId ? [] : localHistory, design: currentDesignContext(), sections: sectionsContext(instruction, focus && focus.sectionId), focus: focus || undefined, attachmentCount: sent.length, attachments: sent,
          view: view.shots, viewWhat: view.what, viewLeftOut: view.leftOut || 0, viewUndrawn: view.undrawn || [],
          // the event's forms, so "add an Express interest button" reuses a form that exists instead of making another
          forms: formsApi() ? formsApi().list().map(function (f) { return { id: f.id, name: f.name, purpose: f.purpose, fields: (f.fields || []).map(function (x) { return x.label; }) }; }) : [],
          // ETB2B AI may make a new picture only for an editor that can put one in (an older one is never offered it)
          canMakePictures: !!aiPictures() })
        });
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
          var body = r.body;
          if (!eventId) pushLocal('user', instruction + (sent.length ? ' [' + sent.length + ' picture' + (sent.length === 1 ? '' : 's') + ' attached]' : ''));
          if (body.notKept) appendChatMsg('ai error', 'This message could not be saved to your conversation history; the answer below still stands.');
          if (body.kind === 'undo') {
            /* "undo that": the page goes back exactly, at no cost — never a guess at the old look */
            var last = lastAiTurn();
            var reply = appendChatMsg('ai', body.summary);
            if (!last) { reply.textContent = 'There is no change of mine on the page to undo. Undo in the top bar steps back through your own edits.'; return; }
            undoAiTurn(last).then(function (ok) {
              if (ok) return;
              reply.textContent = last.undoWhy === 'gone' ? workSafety.UNDO_GONE.replace('Ask ETB2B AI to change it back', 'Ask me to change it back')
                : last.undoWhy === 'busy' ? 'One moment — I am still applying a change. Ask again when it is done.'
                : last.undoWhy === 'changed' ? 'There is nothing of that change left to take back: its words have been changed again since.'
                : 'I left it as it is.';
            });
            if (!eventId) pushLocal('assistant', body.summary + ' (undone)');
            return;
          }
          if (body.kind === 'reply') {
            appendChatMsg('ai', body.summary);
            if (!eventId) pushLocal('assistant', body.summary);
            return;
          }
          runAiTurn(body, body.turnId, sent, { pictureEl: pictureEl }).then(function (t) {
            if (!eventId) pushLocal('assistant', body.summary + ' (' + (t && t.status) + ')');
          });
        });
    }
    send.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  }

  /* What the generator had to say about the logo unit (a year it could not change, a sponsor's mark drawn into
     it, a banner with no copy of the logo for a dark background): the note travels on the unit itself
     (data-rv-logo-note) and is removed from a published page. It is shown for as long as it is on the page —
     a dismissal would not answer it — and answered only by "Looks right" or a picture of the owner's own (Replace
     image). Nothing goes live while it is open (logoUnitGate; the server refuses too: api.js unansweredLogoNote).
     Shown again whenever the page changes under it (an Undo, an AI edit), and gone when no note is left. A note in
     a hidden section does not count: that section is not saved, so it never goes live. */
  function shownLogoNotes() {
    if (!canvas || !canvas.doc) return [];
    return Array.prototype.filter.call(canvas.doc.querySelectorAll('[data-rv-logo-note]'), function (el) { return !el.closest('.is-hidden-sec'); });
  }
  var logoNoticeShown = '';
  function logoUnitNotice() {
    if (!canvas || !canvas.doc) return;
    var unit = shownLogoNotes()[0];
    var row = document.querySelector('#ed-notices [data-notice="logo-unit"]');
    if (!unit) { logoNoticeShown = ''; if (row && host && host.clearNotice) host.clearNotice('logo-unit'); return; }
    /* one line saying what to check, the generator's whole note behind Details, in plain words; that it must be
       answered before publishing is said by Publish itself (logoUnitGate), not on every view (UX-082) */
    var note = unit.getAttribute('data-rv-logo-note');
    var text = editorWords.logoHeadline(note), details = editorWords.plainLogoNote(note);
    var canReplace = !!unit.querySelector('img.rv-lu-img:not(.rv-lu-dark)');
    var drawn = text + '\n' + details + '\n' + canReplace;
    if (row && drawn === logoNoticeShown) return;           // as it is: not drawn again on every change
    logoNoticeShown = drawn;
    var actions = [
      { label: 'Show me', onClick: revealLogoUnit },
      /* checked and fine: the note comes off the unit, so it is not shown again the next time the site opens */
      { label: 'Looks right', onClick: function () {
        if (aiWorking) { busyToast(); return; }
        Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-logo-note]'), function (el) { el.removeAttribute('data-rv-logo-note'); });
        commitNow();
        logoUnitNotice();
      } }
    ];
    /* this edition's own artwork in its place: the logo brought into view and the picture dialog opened on it. A
       logo set in type (the event's name, where no picture could be used) has no picture to replace. */
    if (canReplace) actions.push({ label: 'Replace logo', onClick: function () {
      if (aiWorking) { busyToast(); return; }
      var u = shownLogoNotes()[0], pic = u && u.querySelector('img.rv-lu-img:not(.rv-lu-dark)');
      if (!pic) return;
      revealLogoUnit();
      replacePicture(pic, 'Replace the logo');
    } });
    showNotice('logo-unit', { kind: 'warn', text: text, details: details, actions: actions });
  }
  /* the unit with the open note (else the hero's unit) brought into view and its picture selected, so the
     toolbar offers Replace image: in the manual editor (not the AI live view), on the home page (the banner's) */
  function revealLogoUnit() {
    var unit = shownLogoNotes()[0] || (canvas && canvas.doc && canvas.doc.querySelector('[data-rv-logo-unit]'));
    if (!unit) return;
    function go() {
      if (!unit.isConnected) return;
      if (currentPage !== 'home' && sitePages().length) showPage('home');
      revealElement(unit.querySelector('img.rv-lu-img:not(.rv-lu-dark)') || unit);
    }
    var aiMode = window.RevampEditorMode;
    if (aiMode && aiMode.mode && aiMode.mode() === 'ai') {
      aiMode.setMode('manual');
      /* once the canvas has been put back and fitted (setMode waits two frames, then scrolls it back) */
      setTimeout(go, 120);
    } else go();
  }
  /* Publishing waits for the logo unit's notice: true when it is open — it is shown again and the unit brought
     into view. The server refuses such a page as well; this says why before anything is asked or saved. */
  function logoUnitGate() {
    if (!canvas || remounting) return false;
    flush();
    /* a copy for a dark background still being made: what is saved now would go without it, or without the word
       that none could be made */
    if (Object.keys(darkPending).length) {
      showToast('The logo\'s copy for a dark background is still being made. Publish again in a moment.', { kind: 'error' });
      return true;
    }
    var open = shownLogoNotes();
    if (!open.length) return false;
    logoUnitNotice();
    revealLogoUnit();
    var pic = open[0].querySelector('img.rv-lu-img:not(.rv-lu-dark)');
    showToast('Answer the logo check before publishing: look at the logo, then press “Looks right”' + (pic ? ' or “Replace logo”' : '') + ' in the notice above the page.', { kind: 'error' });
    return true;
  }
  var DARK_COPY_FAILED = 'In a dark theme the banner stays light, so the logo shows as drawn: its copy for a dark background could not be made just now. Replace the picture again to try once more.';
  /* A picture the owner put into the logo unit of a light banner gets its copy for a dark background
     (POST /api/event/logo-unit-dark), as the unit made with the site has one (canvas.setPicture dropped the old
     copy, which showed the picture that was there). Where none can be made, the owner is told on the unit's
     notice — it is about the logo, and answered like the rest. */
  var darkPending = {};          // the pictures whose copy for a dark background is being made (logoUnitGate waits)
  /* The copy (or the word that none could be made) comes back from the server a moment after the picture went in, and
     the editor puts it beside the picture by itself: it is never the person's own change (UX-076, B05 verify: after
     the owner's logo went in as the editor opened, the copy arriving was taken for an edit of the person's, the chip
     said "Unsaved changes" and an untouched Save made "1 section edited" in their name). commitAutoStep keeps it with
     the editor's automatic updates while nothing of the person's is on the page; after an edit of theirs (their own
     Replace image) it is a step on top of it, saved with it. */
  var DARK_COPY_NAME = 'the logo’s copy for a dark background';
  function darkCopyFor(unit) {
    if (!unit || !eventId || !window.RevampCore || !RevampCore.logoUnitDark) return;
    var hero = unit.closest('.hero-root');
    if (!hero || !hero.classList.contains('hero-on-light') || unit.querySelector('.rv-lu-plate')) return;
    var pic = unit.querySelector('img.rv-lu-img:not(.rv-lu-dark)'), src = pic ? String(pic.getAttribute('src') || '') : '';
    if (!/^https:\/\//i.test(src) || darkPending[src]) return;
    /* where the answer goes: the unit on a light banner that still shows this picture with no copy — found again, as
       an Undo or a remade canvas puts new elements in; none (the picture changed again): the answer is not wanted */
    function target() {
      if (!canvas || remounting || !canvas.doc) return null;
      var units = canvas.doc.querySelectorAll('[data-rv-logo-unit]');
      for (var i = 0; i < units.length; i++) {
        var u = units[i], p = u.querySelector('img.rv-lu-img:not(.rv-lu-dark)'), h = u.closest('.hero-root');
        if (p && p.getAttribute('src') === src && !u.querySelector('img.rv-lu-dark') && h && h.classList.contains('hero-on-light')) return { unit: u, pic: p };
      }
      return null;
    }
    function tell(t, note) {
      var was = t.unit.getAttribute('data-rv-logo-note') || '';
      if (was.indexOf(note) === -1) t.unit.setAttribute('data-rv-logo-note', (was ? was + ' ' : '') + note);
      logoUnitNotice();
    }
    darkPending[src] = true;
    RevampCore.logoUnitDark(eventId, src).then(function (r) { whenAiIdle(function () {
      delete darkPending[src];
      var t = target();
      if (!t) return;
      if (r && r.url) {
        var copy = canvas.doc.createElement('img');
        copy.className = 'rv-lu-img rv-lu-dark';
        copy.setAttribute('src', r.url); copy.setAttribute('alt', ''); copy.setAttribute('aria-hidden', 'true'); copy.setAttribute('decoding', 'async');
        if (t.pic.getAttribute('width') && t.pic.getAttribute('height')) { copy.setAttribute('width', t.pic.getAttribute('width')); copy.setAttribute('height', t.pic.getAttribute('height')); }
        t.pic.parentNode.insertBefore(copy, t.pic.nextSibling);
      } else tell(t, (r && r.note) || DARK_COPY_FAILED);
      commitAutoStep(DARK_COPY_NAME);
    }); }, function () { whenAiIdle(function () {
      delete darkPending[src];
      var t = target();
      if (!t) return;
      tell(t, DARK_COPY_FAILED);
      commitAutoStep(DARK_COPY_NAME);
    }); });
  }
  /* The saved page still has the logo unit's notice open (the server refused it). Where this page has it too, it is
     shown and the logo brought up; where this page has answered it — the saved version came from elsewhere — the page
     is marked unsaved, so Save sends what is shown here. */
  function logoNoteRefused(err) {
    if (shownLogoNotes().length) {
      showToast((err && err.message) || 'Answer the logo unit\'s notice first.', { kind: 'error' });
      logoUnitNotice(); revealLogoUnit();
      return;
    }
    if (savedMark) savedMark = { version: savedMark.version, hash: '' };
    renderSiteState();
    showToast('The saved version still has the logo unit\'s notice, though this page has answered it. Save to replace it with what you see here, then publish.', { kind: 'error' });
  }

  /* The logo the owner uploaded is the hero's logo unit (functions/lib/api.js, buildLogoUnit and
     POST /api/event/logo-unit), once examined: its year brought to this edition's, never redrawn. A site
     opened from a copy made before that — saved, or kept in this browser — can still show the unit it was
     made with. Where the hero still shows that automatic unit (the previous edition's lock-up, or one drawn
     for the event), the owner's logo is put in its place here, as an ordinary change: one Undo step, kept
     only once the owner saves. Where the owner has put a picture of their own there, it is only offered. */
  /* made automatically: a unit the server made (generated/…-logo-unit), or an earlier logo the owner
     uploaded in Basics (logo/…) that was used as uploaded — a picture put in with Replace image is media/… */
  var AUTO_UNIT = /\/events\/[^\/]+\/(generated\/\d+-logo-unit(-on-dark)?\.(png|svg|jpe?g|webp)|logo\/[^\/?#]+)(\?|$)/i;
  /* The previous edition's lock-up made for the design after the site was saved (tools/repair-logo-unit.js:
     ETCIO Annual Conclave 2027 was saved with its name drawn, the 2026 lock-up having been passed over) is
     put in the same way — only where the hero still shows a unit made automatically, never over a picture
     the owner chose. */
  /* as api.js darkCopyOfUnit: the design's copy for a dark background was made of its unit — logoUnitDarkOf says so, or,
     in a design written before that was kept, both files come from the same run (generated/<stamp>-logo-unit…) */
  function darkCopyOfUnit(design) {
    if (!design || !design.logoUnitDarkUrl) return false;
    if (design.logoUnitDarkOf) return design.logoUnitDarkOf === design.logoUnitUrl;
    var run = function (p) { var m = /\/generated\/(\d+)-logo-unit[.-]/.exec(String(p || '')); return m ? m[1] : ''; };
    var a = run(design.logoUnitStoragePath), b = run(design.logoUnitDarkStoragePath);
    return !!a && a === b;
  }
  function ownerLogoOffer() {
    var design = currentEvent && currentEvent.designPlan && currentEvent.designPlan.design;
    var source = design ? String(design.logoUnitSource || '') : '';
    if (!canvas || !canvas.doc || !design || (source !== 'owner' && source !== 'previous-edition') || !/^https:\/\//i.test(String(design.logoUnitUrl || ''))) return;
    var unit = canvas.doc.querySelector('[data-rv-logo-unit]');
    if (!unit) return;
    var img = unit.querySelector('img.rv-lu-img');
    var shown = img ? String(img.getAttribute('src') || '') : '';
    var hero = unit.closest('.hero-root');
    var heroTone = hero ? (hero.classList.contains('hero-on-dark') ? 'dark' : hero.classList.contains('hero-on-light') ? 'light' : '') : '';
    /* the unit's copy for a dark background, when it was made of this unit (darkCopyOfUnit) */
    var darkCopy = /^https:\/\//i.test(String(design.logoUnitDarkUrl || '')) && darkCopyOfUnit(design) ? design.logoUnitDarkUrl : '';
    var drawnFor = /^(dark|light)$/.test(String(design.logoUnitHeroMode || '')) ? design.logoUnitHeroMode : '';
    /* on a dark banner a unit drawn for a light one is shown as its copy, as the site was made (api.js handleGenerateContent) */
    var unitUrl = heroTone === 'dark' && drawnFor === 'light' && darkCopy ? darkCopy : design.logoUnitUrl;
    if (shown === unitUrl || shown === design.logoUnitUrl) return;
    var automatic = img ? AUTO_UNIT.test(shown) : !!unit.querySelector('.rv-lu-name');
    var previous = source === 'previous-edition';
    if (previous && !automatic) return;
    var key = 'rv.ownerLogoOffer:' + eventId + ':' + design.logoUnitUrl;
    /* a logo drawn for the other ground than this hero's would vanish on it: it is only offered, and said so */
    var clash = heroTone && drawnFor && drawnFor !== heroTone && unitUrl === design.logoUnitUrl;
    var before = null, putAt = -1;
    function noticeGone() { var n = document.querySelector('#ed-notices [data-notice="owner-logo"]'); if (n) n.remove(); }
    /* byItself: put in as the page opened (an Undo step, but not the person's own change: commitAutomatic) */
    function putIn(byItself) {
      if (aiWorking) { busyToast(); return; }
      /* an Undo or a reload of the canvas since the offer was made puts new elements in: found again */
      if (!unit.isConnected) unit = canvas && canvas.doc && canvas.doc.querySelector('[data-rv-logo-unit]');
      if (!unit) return;
      var pic = unit.querySelector('img.rv-lu-img');
      if (!pic) {
        /* a unit set in type becomes the picture */
        while (unit.firstChild) unit.removeChild(unit.firstChild);
        pic = canvas.doc.createElement('img');
        pic.className = 'rv-lu-img';
        pic.setAttribute('decoding', 'async');
        unit.appendChild(pic);
        unit.classList.add('rv-lu-pic');
      } else if (pic.parentNode !== unit) {
        unit.replaceChild(pic, pic.parentNode);                   // out of a plate: a logo is never boxed
      }
      canvas.setPicture(pic, unitUrl);
      pic.setAttribute('alt', (currentEvent && currentEvent.name) || pic.getAttribute('alt') || '');
      if (+design.logoUnitWidth > 0 && +design.logoUnitHeight > 0) { pic.setAttribute('width', Math.round(design.logoUnitWidth)); pic.setAttribute('height', Math.round(design.logoUnitHeight)); }
      else { pic.removeAttribute('width'); pic.removeAttribute('height'); }
      /* the note was about the unit that is gone; what there is to check about the new one is its own note, answered
         like any other (logoUnitNotice) */
      if (about) unit.setAttribute('data-rv-logo-note', about); else unit.removeAttribute('data-rv-logo-note');
      /* a light banner keeps the unit's copy for a dark background beside it (canvas.setPicture dropped the old one);
         where the server could not make one its note says so already, else one is asked for */
      var hasCopy = false;
      if (heroTone !== 'dark' && darkCopy && unitUrl === design.logoUnitUrl) {
        var copy = canvas.doc.createElement('img');
        copy.className = 'rv-lu-img rv-lu-dark';
        copy.setAttribute('src', darkCopy); copy.setAttribute('alt', ''); copy.setAttribute('aria-hidden', 'true'); copy.setAttribute('decoding', 'async');
        if (pic.getAttribute('width') && pic.getAttribute('height')) { copy.setAttribute('width', pic.getAttribute('width')); copy.setAttribute('height', pic.getAttribute('height')); }
        pic.parentNode.insertBefore(copy, pic.nextSibling);
        hasCopy = true;
      }
      clearAiGenerated(pic);
      if (byItself) commitAutomatic(); else commitNow();
      putAt = undoPtr;
      logoUnitNotice();
      if (!hasCopy && !/no copy of it for a dark background/.test(about)) darkCopyFor(unit);
    }
    /* Undo on the notice takes back the logo, not whatever was done last: the editor's own Undo when that
       is still the newest step, else the unit as it was put back, as a step of its own */
    function takeBack() {
      if (aiWorking) { busyToast(); return; }
      if (putAt !== -1 && putAt === undoPtr) { undo(); return; }
      var now = canvas && canvas.doc && canvas.doc.querySelector('[data-rv-logo-unit]');
      if (!now || !before) return;
      now.parentNode.replaceChild(before.cloneNode(true), now);
      commitNow();
    }
    var about = String(design.logoUnitNote || '').replace(/\s+/g, ' ').trim();
    /* the owner said no to this logo here (Keep this picture, or Undo): not again for this logo */
    function keepOld() { try { localStorage.setItem(key, '1'); } catch (e) { /* asked again next time */ } }
    try { if (localStorage.getItem(key)) return; } catch (e) { /* storage blocked: asked as if new */ }
    before = unit.cloneNode(true);
    if (automatic && !clash) {
      putIn(true);
      tagAutoStep(previous ? 'the previous edition’s logo in the banner' : 'the event’s logo in the banner');
      /* what there is to check about the logo is on the unit's own notice (logoUnitNotice), to be answered */
      showNotice('owner-logo', {
        kind: 'info', dismissible: true,
        text: (previous ? 'The hero now shows the previous edition\'s logo, in place of the event\'s name drawn for it. '
          : 'The hero now shows the event logo you uploaded, in place of the one made automatically. ') + 'Save to keep it.',
        actions: [{ label: 'Undo', onClick: function () { takeBack(); keepOld(); noticeGone(); } }]
      });
      return;
    }
    if (previous) return;               // drawn for the other ground: left to the owner (Replace image)
    showNotice('owner-logo', {
      kind: 'info', dismissible: true,
      text: 'The event has a new logo. ' + (about ? about + ' ' : '') +
        (clash ? 'It is drawn for a ' + design.logoUnitHeroMode + ' background and this hero is ' + heroTone + ', so it may not show here. ' : '') +
        'Use it in the hero in place of the picture there now?',
      actions: [
        { label: 'Use the new logo', onClick: function () { putIn(); noticeGone(); } },
        { label: 'Keep this picture', onClick: function () { keepOld(); noticeGone(); } }
      ]
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
    var win = window.open('', '_blank');   // always a new tab: a named tab is reused even when it is this one (a tab keeps its name when it navigates)
    if (!win) { showToast('Allow pop-ups to open the preview in a new tab.'); return; }
    win.document.open();
    win.document.write('<!doctype html><title>Loading preview…</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#666">Loading preview…</body>');
    win.document.close();
    /* the page as it is in this editor, saved or not: this person's own preview. Staging changes on Save. */
    var pageShown = currentPage;
    RevampCore.previewDraft(eventId, canvas.serialize()).then(function (result) {
      var url = result.stagingUrl;
      // the page shown in the editor: its own address (/preview/<id>/<slug>?draft=1)
      if (pageShown !== 'home' && typeof url === 'string') url = url.replace(/^([^?#]*?)\/?(?=[?#]|$)/, '$1/' + encodeURIComponent(pageShown));
      win.location.href = url;
    }).catch(function (err) {
      win.document.open();
      win.document.write('<!doctype html><title>Preview failed</title><body style="font:14px/1.5 system-ui,sans-serif;padding:40px;color:#a23b36">Could not load the preview — ' + escHtml(err && err.message ? err.message : 'please try again.') + '</body>');
      win.document.close();
    });
  }

  /* ---------- what the editor changes by itself as it opens (UX-076) ----------
     Opening a site can change it before anybody touches it: the event's records are drawn in (Content), the ET logo
     is brought up to date, section headings are held to the type scale, the owner's new logo goes into the banner.
     Those changes are the starting point, not edits: they are no Undo step (the logo's is, so it can be taken back,
     and it is named like the rest), the chip says "Updated automatically" rather than "Unsaved changes", leaving
     does not ask about them, and Save keeps them as a version of their own, recorded as automatic and in nobody's
     name (PUT /api/event/site, automatic: true), before the person's changes — so the summary of their save, and of
     the approval request, names only what they changed.
     That can be told apart whenever the page opened as a saved version with nothing of the person's own on it: the
     version saved on the server, which every browser opens (workSafety.openPlan takes it and onSavedVersion marks it
     as this browser's), including after "Open version N" over an older copy, or this browser's own last save. A copy
     holding the person's unsaved changes opens as "Unsaved changes", and the updates then go with their save. */
  var autoNames = [];        // what changed by itself since the page opened ("the ET logo and menu", "FAQs from Content")
  var autoPoints = [];       // [{ ptr, hash, html, names }]: an undo step holding them, and the page that is saved for it
  var openedSaved = false;   // the page opened as a saved version, nothing of the person's own on it
  var openPtr = 0;           // the undo step the page opened on (1 after "Open version N" over this browser's older copy)
  var autoReady = false;     // the page has opened: a change made by itself now updates autoPoints at once

  function noteOpening() {
    var mark = savedMark || readMark();
    autoNames = []; autoPoints = []; autoReady = false;
    openPtr = undoPtr;
    openedSaved = !!(mark && mark.hash && undoStack[undoPtr] && mark.hash === snapHash(undoStack[undoPtr]));
  }
  function noteAuto(names) {
    (names || []).forEach(function (n) { if (n && autoNames.indexOf(n) === -1) autoNames.push(n); });
  }
  /* What a visitor reads and sees in root (a page's body, or one record's card): its words, its pictures and links,
     what is hidden or marked empty, the agenda's days and the speakers' pop-up profiles; not what only the editor and
     the records' own bookkeeping carry (the id each record carries since B05, data-rv-filled). Two answers that are
     the same look the same to a visitor: on every site saved before records carried their ids, drawing the records
     at opening adds only those ids, which is no update anybody would see (UX-076, B05 verify). */
  var SEEN_PARTS = 'img, a, [hidden], [style], [data-rv-empty], [data-rv-nav-empty], [data-rv-day], template';
  function pageSeen(root) {
    if (!root || !root.querySelectorAll) return '';
    var parts = [String(root.textContent || '').replace(/\s+/g, ' ').trim()];
    [root].concat(Array.prototype.slice.call(root.querySelectorAll(SEEN_PARTS))).forEach(function (el) {
      function a(name) { return el.getAttribute(name) || ''; }
      var style = a('style');
      var line = el.tagName + (el.hasAttribute('hidden') ? '!' : '') + '|' + a('src') + '|' + a('href') + '|' + a('data-rv-empty') +
        (el.hasAttribute('data-rv-nav-empty') ? '|nav-empty' : '') + '|' + a('data-rv-day') + '|' + a('data-rv-day-name') + '|' + a('data-rv-day-date') +
        '|' + (/url\(/i.test(style) ? style : '');
      // a <template>'s words are not in the page's text, and a speaker's profile, which the visitor's pop-up shows, is one
      if (el.content && el.content.querySelectorAll) {
        line += '|' + String(el.content.textContent || '').replace(/\s+/g, ' ').trim() + '|' +
          Array.prototype.map.call(el.content.querySelectorAll('a[href]'), function (l) { return l.getAttribute('href'); }).join(' ');
      }
      parts.push(line);
    });
    return parts.join('\u0001');
  }
  /* the records each list shows, kind -> what a visitor sees of them: to name the kinds that drawing them changed */
  function recordsSeen() {
    var out = {};
    if (!canvas || !canvas.doc || !window.RevampRecords) return out;
    Array.prototype.forEach.call(canvas.doc.querySelectorAll('[data-rv-repeat-template], [data-rv-item]'), function (el) {
      var kind = el.getAttribute('data-rv-repeat-template') || el.getAttribute('data-rv-item');
      if (!RevampRecords.TABS[kind]) return;
      out[kind] = (out[kind] || '') + '\u0002' + pageSeen(el);
    });
    // the previous edition's speakers' profiles, which the same step adds to a page saved before them (refreshPreviousProfiles)
    out.previous = String(canvas.doc.querySelectorAll('[data-rv-profiles]').length);
    return out;
  }
  function recordsNamed(before) {
    var after = recordsSeen(), names = [];
    RevampRecords.KINDS.forEach(function (kind) {
      if ((before[kind] || '') !== (after[kind] || '')) names.push(RevampRecords.TABS[kind].many + ' from Content');
    });
    if (before.previous !== after.previous) names.push('the previous edition’s speaker profiles');
    return names.length ? names : ['the event’s records from Content'];
  }
  /* a change the editor made by itself: part of the page as it opened while nobody has changed anything yet, a step
     of the editor's own (not the person's: commitAutomatic) once somebody has */
  function bakeAuto(names) {
    if (!canvas || remounting || aiWorking) return;
    if (undoPtr !== openPtr || editingEl) { commitAutoStep(names); return; }
    var snap = canvas.snapshot(undoStack[openPtr]);
    if (canvas.sameSnapshot(snap, undoStack[openPtr])) return;
    undoStack[openPtr] = snap;
    persist(snap);
    noteAuto(names);
    if (autoReady) settleAuto();
    scheduleServerSave();
    sectionsChanged();
    designChanged();
    pageChanged();
  }
  /* once the page has opened, and again when it changes by itself before anybody has touched it: the page these
     changes are saved as, taken while the canvas shows exactly that step */
  function settleAuto() {
    autoReady = true;
    autoPoints = [];
    if (!openedSaved || !autoNames.length || !canvas || undoPtr !== openPtr) return;
    autoPoints.push({ ptr: openPtr, hash: snapHash(undoStack[openPtr]), html: canvas.serialize(), names: autoNames.slice() });
  }
  /* an automatic change that is an Undo step of its own, right after the page opened (ownerLogoOffer) */
  function tagAutoStep(name) {
    if (!openedSaved || !canvas || undoPtr !== openPtr + 1) return;
    autoPoints.push({ ptr: openPtr + 1, hash: snapHash(undoStack[openPtr + 1]), html: canvas.serialize(), names: autoNames.concat([name]) });
  }
  /* A change the editor makes by itself once the page has opened, as an Undo step of its own (the logo's copy for a
     dark background answered by the server after the owner's logo went in, the ET logo checked again once the page has
     laid out): recorded as the editor's (commitAutomatic), and, when the page held nothing of the person's own just
     before — only the opening's updates (the latest automatic step), or exactly the version this browser last saved —
     tagged as one more of those updates, so the chip still says "Updated automatically" and Save keeps them apart
     (UX-076). While the person is typing, or after an edit of theirs, it is only recorded: it goes with their save. */
  function commitAutoStep(names) {
    if (!canvas || remounting || aiWorking) return false;
    var p = editingEl ? null : autoOnly() ? autoPoint() : null;
    var asSaved = !p && !editingEl && !localEdited && !!savedMark && !!savedMark.hash && savedMark.hash === snapHash(undoStack[undoPtr]);
    if (!commitAutomatic()) return false;
    if (!p && !asSaved) return true;
    var told = p ? p.names.slice() : [];
    (Array.isArray(names) ? names : [names]).forEach(function (n) { if (n && told.indexOf(n) === -1) told.push(n); });
    openedSaved = true;               // the page stands on a saved version with nothing of the person's on it
    autoPoints.push({ ptr: undoPtr, hash: snapHash(undoStack[undoPtr]), html: canvas.serialize(), names: told });
    return true;
  }
  /* the latest of those steps that the page still stands on, or null */
  function autoPoint() {
    for (var i = autoPoints.length - 1; i >= 0; i--) {
      var p = autoPoints[i];
      if (p.ptr <= undoPtr && undoStack[p.ptr] && snapHash(undoStack[p.ptr]) === p.hash) return p;
    }
    return null;
  }
  /* nothing but those changes since the page opened */
  function autoOnly() { var p = autoPoint(); return !!p && p.ptr === undoPtr; }

  /* workSafety:begin
     What the editor decides about keeping work, that needs nothing but what it is given: which copy of the site
     opens (this browser's or the one saved on the server), what a save that meets a newer saved version says, what
     is asked before the editor is left, how an ETB2B AI change that ran is reported, and why Save, Publish, Undo
     and Redo wait while ETB2B AI is busy. functions/lib/editor-safety.test.js runs the code between the two
     workSafety marks in node, so nothing in it may use the rest of this file. */
  var workSafety = (function () {
    function isVersion(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v; }

    /* ETB2B AI's state ('ready', 'thinking': waiting for its answer, 'working': applying it) -> why Save,
       Publish changes, Undo and Redo wait, or '' when they need not */
    function busyLine(state) {
      if (state === 'working') return 'ETB2B AI is still changing the page — one moment';
      if (state === 'thinking') return 'ETB2B AI is still working on your request — one moment';
      return '';
    }

    /* Which copy of the site the editor opens. The server's saved version is the truth; this browser's copy wins
       only while it holds changes of the person's own made on that same version.
       o: { site: GET /api/event/site ({ version, snapshot, updatedAt, updatedBy, templateId, eventCreatedAt }),
                null when the site has never been saved, undefined when it could not be read;
            templateId: the site being opened;
            local: this browser's copy ({ snapshot, savedAt, baseVersion, edited, eventCreatedAt }) or nothing;
            mark: what this browser last saved or opened from the server ({ version, hash }) or nothing;
            hash(snapshot): the editor's fingerprint of a snapshot;
            newRun: this open puts a new Create Event result on the page;
            generationNewer: the site was generated again after it was last saved }
       -> { take: 'browser' (the editor's own rules for this browser's copy, the hand-off and the generation)
                | 'server' (the saved version) | 'ask' (this browser holds changes made on an older version),
            baseVersion: the saved version a save from this editor is made on (the server refuses another),
            why } */
    function openPlan(o) {
      var site = o.site, mark = o.mark || null;
      var local = o.local && o.local.snapshot ? o.local : null;
      var localBase = local && isVersion(local.baseVersion) ? local.baseVersion : mark && isVersion(mark.version) ? mark.version : 0;
      if (site === undefined) return { take: 'browser', baseVersion: localBase, why: 'unreadable' };
      if (!site || !site.version) return { take: 'browser', baseVersion: 0, why: 'never-saved' };
      /* a page saved without a snapshot (an editor of the previous release), or for another site: it cannot be
         reopened, and a save from here is still asked about */
      if (!site.snapshot || (site.templateId && o.templateId && site.templateId !== o.templateId)) return { take: 'browser', baseVersion: localBase, why: 'not-reopenable' };
      // a new Create Event result, or a site generated again since its last save, is what the person asked for
      if (o.newRun || o.generationNewer) return { take: 'browser', baseVersion: site.version, why: 'new-run' };
      // a copy made for an earlier event at the same address is not this event's
      if (local && local.eventCreatedAt && site.eventCreatedAt && local.eventCreatedAt !== site.eventCreatedAt) local = null;
      if (!local) return { take: 'server', baseVersion: site.version, why: 'fresh' };
      var localHash = o.hash(local.snapshot);
      if (localHash === o.hash(site.snapshot)) return { take: 'server', baseVersion: site.version, why: 'same' };
      /* nothing of the person's own is waiting in this browser: the copy is what it last saved or opened, or it
         differs only by what the editor updated by itself when it opened */
      if ((mark && mark.hash === localHash) || local.edited === false) {
        return { take: 'server', baseVersion: site.version, why: localBase && localBase < site.version ? 'newer' : 'same' };
      }
      if (localBase === site.version) return { take: 'browser', baseVersion: site.version, why: 'unsaved' };
      return { take: 'ask', baseVersion: localBase, why: 'older-changes' };
    }

    /* The question when this browser holds changes made on an older version than the one saved.
       c: { base: the version they were made on (0: never saved), localAt, version, by, at } (times in words) */
    function olderCopyWords(c) {
      var lead = c.base
        ? 'This browser has changes to this site' + (c.localAt ? ' from ' + c.localAt : '') + ', made on version ' + c.base + ', that were not saved.'
        : 'This browser has its own copy of this site' + (c.localAt ? ' from ' + c.localAt : '') + ', which was never saved.';
      return {
        title: 'A newer version was saved',
        text: lead + ' Since then, version ' + c.version + ' was saved' + (c.by ? ' by ' + c.by : '') + (c.at ? ' on ' + c.at : '') + '.',
        more: 'Open version ' + c.version + ' to work on what was saved: Undo in the top bar brings this browser’s changes back while the editor stays open. ' +
          'Keep my changes opens them instead, and Save then asks before it replaces version ' + c.version + '.',
        open: 'Open version ' + c.version, keep: 'Keep my changes'
      };
    }

    /* What Save says when the server holds a version this editor did not open (PUT /api/event/site answered 409).
       cur: { version, updatedBy }; me: this person, as the server names them; at: when it was saved, in words */
    function conflictWords(cur, me, at) {
      var v = cur.version, on = at ? ' on ' + at : '';
      var mine = !!me && cur.updatedBy === me;
      return {
        title: 'A newer version was saved',
        text: mine
          ? 'You saved version ' + v + on + ' in another tab or browser while this editor was open. Replace it with what is in this editor? Version ' + v + ' is kept in the history.'
          : (cur.updatedBy || 'Someone') + ' saved version ' + v + on + ' while you were editing. Replace it with yours? Theirs is kept in the history.',
        open: 'Open version ' + v + ' instead',
        replace: mine ? 'Replace it' : 'Replace with mine'
      };
    }

    /* What is asked before the editor is left. s: { ai: ETB2B AI's state, saving, dirty }
       -> null (leave at once) | { kind: 'wait' } (a save is on its way: it finishes first) |
          { kind: 'ai' | 'unsaved', title, text } */
    function leaveAsk(s) {
      var rest = s.dirty ? ' Your other changes stay only in this browser until you save.' : '';
      if (s.ai === 'working') return { kind: 'ai', title: 'ETB2B AI is still changing the page', text: 'Leave anyway? This change will be lost.' + rest };
      if (s.ai === 'thinking') return { kind: 'ai', title: 'ETB2B AI is still working on your request', text: 'Leave anyway? The change you asked for will not be made.' + rest };
      if (s.saving) return { kind: 'wait' };
      if (s.dirty) return { kind: 'unsaved', title: 'Leave without saving?', text: 'You have changes that are not saved. They stay only in this browser until you save.' };
      return null;
    }
    /* Whether leaving would leave work behind unsaved (leaveAsk's dirty). s: { dirty: the page is not the saved
       version, savedVersion: 0 when the site was never saved, edited: the page holds something of the person's own
       (an edit, an ETB2B AI change, what Create Event handed over) }. A site never saved is never the saved version,
       but a default page left as it opened is the same page next time: nothing to ask about (QA, B04 verify). */
    function unsavedWork(s) {
      if (!s.dirty) return false;
      return !!s.savedVersion || !!s.edited;
    }
    /* Whether an ETB2B AI change's card says "In this browser only until you Save", with its Save: only while the
       page has unsaved changes and this change is one of them. A change a save has kept is not, whatever is edited
       after it (QA, B04 verify: a saved navy change said it again once Why now was typed in), and a change that
       only made forms is on the server already. c: { status, pageChanged, ptr: the undo step the change made,
       savedPtr: the step the newest save in this session kept, -1 for none } */
    function cardAsksSave(c, dirty) {
      if (!dirty || !c.pageChanged || (c.status !== 'applied' && c.status !== 'partly')) return false;
      return !(c.ptr >= 0 && c.savedPtr >= c.ptr);
    }

    /* How an ETB2B AI change ended. done: what took effect; notDone: what could not be done; changed: the page
       was changed; forms: how many forms it made. 'partly' only when something really happened. */
    function turnStatus(done, notDone, changed, forms) {
      if (!((changed && done.length > 0) || forms > 0)) return 'failed';
      return notDone.length ? 'partly' : 'applied';
    }
    /* the AI's own sentence above a change that did not happen, or happened in part: marked as what it set out to do */
    function planLead(status) {
      return status === 'failed' ? 'What I tried: ' : status === 'partly' ? 'What I planned: ' : '';
    }

    /* Undo of an ETB2B AI change that the page can only lose together with what came after it.
       laterAi: changes ETB2B AI made after it; ownSteps: the person's own edits since -> { title, text } */
    function undoQuestion(laterAi, ownSteps) {
      var gone = [];
      if (laterAi) gone.push(laterAi === 1 ? 'the change ETB2B AI made after it' : 'the ' + laterAi + ' changes ETB2B AI made after it');
      if (ownSteps) gone.push(ownSteps === 1 ? 'the edit you made since' : 'the ' + ownSteps + ' edits you made since');
      return {
        title: 'Undo this change?',
        text: 'The page goes back to how it was before this change' + (gone.length ? ', so ' + gone.join(' and ') + ' will be undone too' : '') +
          '. Undo in the top bar brings it all back.'
      };
    }
    /* said where a change can no longer be undone from the chat (another browser, or too long ago) */
    var UNDO_GONE = 'This change can’t be undone here: it was made in another browser, or too long ago. Ask ETB2B AI to change it back, or change it yourself on the page.';

    return { busyLine: busyLine, openPlan: openPlan, olderCopyWords: olderCopyWords, conflictWords: conflictWords, leaveAsk: leaveAsk,
      unsavedWork: unsavedWork, cardAsksSave: cardAsksSave,
      turnStatus: turnStatus, planLead: planLead, undoQuestion: undoQuestion, UNDO_GONE: UNDO_GONE };
  })();
  /* workSafety:end */

  /* editorWords:begin — what the editor says about the logo's check (UX-082) and about copy that came with a section
     or block the owner added (UX-081), and when such copy still counts as a placeholder. Plain functions of their
     arguments that use nothing of the editor or the page: functions/lib/editor-tools.test.js runs this block as it is.
       logoHeadline(note)  the notice's one line, read from the note the generator wrote on the logo
       plainLogoNote(note) the note itself, for "Details", without the words only the team uses ("logo unit", "lock-up")
       placeholderLeft(kind, original, text, hasPicture)  true while a marked element still shows what it came with
       placeholderAsk(texts, pictures, sample, publishLabel)  the question before publishing while some are left */
  var editorWords = (function () {
    function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

    /* Read from the note's first sentence that says something: a note is several of them, joined (the owner's upload
       first, then the previous edition's logo). The earliest one a rule finds decides the line. */
    var LOGO_LINES = [
      [/The year in (the logo unit|your logo) was changed from (\S+) to (\S+?)(?=[\s;,.]|$)/, function (m) {
        return m[1] === 'your logo' ? 'Check your logo: its year was changed from ' + m[2] + ' to ' + m[3] + '.'
          : 'Check the logo: the year in the previous edition’s logo was changed from ' + m[2] + ' to ' + m[3] + '.';
      }],
      [/Your uploaded logo could not be (used|checked)/, function (m) { return 'Your uploaded logo could not be ' + m[1] + ', so the banner does not show it.'; }],
      [/The previous edition's logo shows (\S+) and could not be updated/, function (m) { return 'Check the logo: the previous edition’s logo shows ' + m[1] + ', so the event’s name is shown instead.'; }],
      [/The previous edition's logo could not be used/, function () { return 'Check the logo: the previous edition’s logo could not be used, so the event’s name is shown instead.'; }],
      [/Your logo shows (\S+), not (\S+?),/, function (m) { return 'Check your logo: it shows ' + m[1] + ', not ' + m[2] + '.'; }],
      [/could not be cropped out cleanly/, function () { return 'Check the logo: it still carries a mark that is not this edition’s own.'; }],
      [/was cropped out of/, function () { return 'Check the logo: part of it was cropped out.'; }],
      [/could not be (read|checked)|too large a file/, function () { return 'Check the logo: it could not be checked for you.'; }],
      [/taller than it is wide/, function () { return 'Check the logo: the previous edition’s logo is used whole.'; }],
      [/for a dark background/, function () { return 'Check the logo: it has no copy for a dark background.'; }],
      [/^Your logo was checked/, function () { return 'Check your logo: it is used exactly as you uploaded it.'; }]
    ];
    function logoHeadline(note) {
      var n = squash(note), best = null;
      if (!n) return '';
      LOGO_LINES.forEach(function (rule) {
        var m = rule[0].exec(n);
        if (m && (!best || m.index < best.m.index)) best = { m: m, say: rule[1] };
      });
      return best ? best.say(best.m) : 'Check the logo at the top of the site.';
    }
    function plainLogoNote(note) {
      return squash(note)
        .replace(/\b(t|T)he logo unit\b/g, '$1he logo').replace(/\blogo unit\b/gi, 'logo')
        .replace(/\block-ups\b/g, 'logos').replace(/\block-up\b/g, 'logo')
        .replace(/\bthe hero\b/g, 'the banner');
    }

    /* A placeholder is marked with what it said when it came (data-rv-placeholder); it stops being one once its
       words are different by any road (typed, ETB2B AI, a paste), or, for a picture box, once it shows a picture.
       Emptied, it is not a placeholder either: nothing of it would go live. */
    function placeholderLeft(kind, original, text, hasPicture) {
      if (kind === 'image') return !hasPicture;
      var now = squash(text);
      return now !== '' && now === squash(original);
    }
    function placeholderAsk(texts, pictures, sample, publishLabel) {
      texts = texts || 0; pictures = pictures || 0;
      var parts = [];
      if (texts) parts.push(texts === 1 ? '1 placeholder text' : texts + ' placeholder texts');
      if (pictures) parts.push(pictures === 1 ? '1 empty picture' : pictures + ' empty pictures');
      var one = texts + pictures === 1;
      sample = squash(sample);
      if (sample.length > 60) sample = sample.slice(0, 57).replace(/\s+\S*$/, '') + '…';
      return {
        title: parts.join(' and ') + (one ? ' is' : ' are') + ' still on the page',
        text: (one ? 'It came' : 'They came') + ' with a section or block you added' + (sample ? ', such as “' + sample + '”' : '') +
          ', and would go live as ' + (one ? 'it is' : 'they are') + '. Write this event’s own words in, or delete what the site does not need. ' +
          (one ? 'It has' : 'They have') + ' a dashed amber outline on the page.',
        show: one ? 'Show it' : 'Show them',
        anyway: squash(publishLabel || 'Publish') + ' anyway'
      };
    }
    return { logoHeadline: logoHeadline, plainLogoNote: plainLogoNote, placeholderLeft: placeholderLeft, placeholderAsk: placeholderAsk };
  })();
  /* editorWords:end */

  /* ---------- save to staging / publish changes ----------
     The editor keeps every change in this browser as it is made. Nothing reaches the server until Save: that
     stores the site as a new version, puts it on the staging address and records what changed, by whom.
     Publish changes sends everything saved since what is live for approval; approving it is what makes it
     live (see "SAVE -> STAGING -> APPROVAL -> LIVE" in functions/lib/api.js). */
  var siteInfo = null;          // { savedVersion, publishedVersion, published, pending, required, me } from the server
  var savedMark = null;         // { version, hash } — what this browser last saved or opened from the server
  var saving = false, stateTimer = null;
  var publishBusy = false;      // Publish is saving and asking where the site stands: its button says so
  var savingNow = null;         // the save on its way, while there is one (leaving waits for it)
  /* The saved version this editor's page is made on (workSafety.openPlan, then each save): the server refuses a
     save made on another one, and the person is asked. */
  var baseVersion = 0;
  /* whether this browser's copy holds changes of the person's own that are not saved (an edit, an ETB2B AI change),
     rather than only what the editor updated by itself as it opened: kept with the copy, read when it next opens */
  var localEdited = false;

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
  /* what leaving asks about: isDirty() is true for a site never saved, which Save needs, but only the person's own
     work there is worth a question (workSafety.unsavedWork) */
  function hasUnsavedWork() {
    // what the editor updated by itself as it opened is nothing of the person's: it makes the same updates next time
    return workSafety.unsavedWork({ dirty: isDirty() && !autoOnly(), savedVersion: siteInfo ? siteInfo.savedVersion : baseVersion, edited: localEdited });
  }

  function loadSiteInfo() {
    if (!eventId) return Promise.resolve();
    // set as the page opened (resolveInitialContent); read here only when that could not
    if (!savedMark) savedMark = readMark();
    /* the answer to the question asked as the editor opened (prefetchApproval) — unless something was saved meanwhile
       (siteInfo is set by a save): that answer may be older than the save, so it is asked again */
    var asked = approvalAsk && !siteInfo ? approvalAsk : RevampCore.fetchApproval(eventId);
    approvalAsk = null;
    return asked.then(function (a) {
      siteInfo = {
        savedVersion: a.savedVersion || 0, published: !!a.published, publishedVersion: a.publishedVersion || 0,
        pending: a.request && a.request.status === 'pending' ? a.request : null, required: a.required !== false,
        me: a.me || '',
        /* the newest request when it is not the one waiting: a rejection is told on the chip and under the top bar
           (UX-103) */
        last: !(a.request && a.request.status === 'pending') && Array.isArray(a.requests) && a.requests[0] ? a.requests[0] : null
      };
      paintDecision(a);
    }, function () { siteInfo = siteInfo || { savedVersion: 0, published: false, publishedVersion: 0, pending: null, required: true, me: '', last: null }; })
      .then(renderSiteState);
  }
  /* what became of the last request for approval, for whoever asked (publish-flow.js decisionNotice): a line under the
     top bar on the next visit, "Priya rejected version 5: “…”", until it is dismissed (UX-103) */
  function paintDecision(a) {
    if (window.RevampPublishFlow) RevampPublishFlow.paintDecision(document.getElementById('pf-decision'), a, { me: a && a.me, eventId: eventId });
  }
  /* siteInfo in fetchApproval's shape, for publish-flow.js's readings */
  function approvalShape() {
    var i = siteInfo || {};
    return { savedVersion: i.savedVersion, published: i.published, publishedVersion: i.publishedVersion, required: i.required !== false,
      request: i.pending ? { status: 'pending', id: i.pending.id, toVersion: i.pending.toVersion } : null };
  }
  function reviewHref(id) { return '/review.html?event=' + encodeURIComponent(eventId) + '&request=' + encodeURIComponent(id); }

  /* the chip beside Save: where this site stands, and the way to it */
  function renderSiteState() {
    var chip = document.getElementById('site-state'), save = document.getElementById('btn-save'), pub = document.getElementById('btn-publish');
    if (!chip || !save) return;
    chip.hidden = save.hidden = !eventId || !canvas;
    if (!eventId || !canvas || !siteInfo) return;
    var dirty = isDirty(), v = siteInfo.savedVersion, kind = 'plain', text, href = '', title = '';
    var pend = siteInfo.pending, last = siteInfo.last, saved = '/preview/' + eventId + '?staged=1';
    /* words a marketer uses: saved, not live yet, waiting for approval, live; the version number only where two have
       to be told apart (UX-112) */
    if (!v) { kind = 'warn'; text = 'Not saved yet'; title = 'Save keeps the site on the server, where your team can see it. Nothing goes live until it is published.'; }
    else if (dirty && autoOnly()) {
      kind = 'plain'; text = 'Updated automatically'; href = saved;
      title = 'Updated automatically when the editor opened: ' + autoPoint().names.join(', ') + '. Nothing of yours is waiting to be saved; Save keeps these updates apart from your own changes.';
    }
    else if (dirty) { kind = 'warn'; text = 'Unsaved changes'; title = 'Your changes are only in this browser. Save keeps them (the saved site still shows version ' + v + ').'; href = saved; }
    else if (pend && pend.toVersion === v) { kind = 'wait'; text = 'Waiting for approval'; href = reviewHref(pend.id); title = 'Version ' + v + ' was sent for approval' + (pend.requestedBy ? ' by ' + pend.requestedBy : '') + '. Open the review page.'; }
    /* saved again after sending: the request still holds the older version, and the newer save is not in it (UX-111) */
    else if (pend && pend.toVersion < v) { kind = 'wait'; text = 'v' + v + ' saved · v' + pend.toVersion + ' waiting'; href = reviewHref(pend.id); title = 'Version ' + v + ' is not in the request yet: Send for approval adds it. Version ' + pend.toVersion + ' is waiting for approval.'; }
    else if (siteInfo.published && siteInfo.publishedVersion === v) { kind = 'ok'; text = 'Live'; href = '/e/' + eventId; title = 'What you see is the live site (version ' + v + '). Open it.'; }
    else if (last && last.status === 'rejected' && last.toVersion === v) { kind = 'bad'; text = 'Changes rejected'; href = reviewHref(last.id); title = 'Rejected' + (last.decidedBy ? ' by ' + last.decidedBy : '') + (last.decisionNote ? ': “' + last.decisionNote + '”' : '') + '. Change what is asked, save and send it again.'; }
    else { text = 'Saved · not live yet'; href = saved; title = 'Version ' + v + ' is saved. Open the saved site; it goes live once it is published.'; }
    chip.className = 'site-state ' + kind;
    chip.textContent = text; chip.title = title;
    if (href) { chip.href = href; chip.target = '_blank'; chip.rel = 'noopener'; } else { chip.removeAttribute('href'); }
    /* while ETB2B AI is busy a save would keep half of its change: Save waits, and says why */
    var busy = workSafety.busyLine(aiState);
    if (!save.hasAttribute('data-title')) save.setAttribute('data-title', save.title || '');
    save.disabled = saving || !dirty || !!busy;
    save.title = busy || save.getAttribute('data-title');
    save.textContent = saving ? 'Saving…' : 'Save';
    /* Publish says what it would do before it is pressed, in the console's words (publish-flow.js, UX-105) */
    if (pub && window.RevampPublishFlow) {
      if (publishBusy) { pub.textContent = 'Checking…'; pub.setAttribute('aria-busy', 'true'); }
      else { pub.removeAttribute('aria-busy'); RevampPublishFlow.paintButton(pub, RevampPublishFlow.buttonState(approvalShape(), { dirty: dirty })); }
    }
    syncCardSaves(dirty);
  }
  /* The site lives in this browser's copy until Save; a change only moves the chip to "Unsaved changes". */
  function scheduleServerSave() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(renderSiteState, 250);
  }

  function when(iso) { var d = new Date(iso || ''); return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

  function cancelled() { return Object.assign(new Error('cancelled'), { cancelled: true }); }
  /* One question in the editor's own dialog (host.openDialog). spec: { title, text, more, modal, actions: [{ key,
     label, kind, aside, autofocus }] } -> Promise<the key of the button pressed, or '' when it was closed> */
  function ask(spec) {
    return new Promise(function (resolve) {
      if (!host || !host.openDialog) { resolve(''); return; }
      var answer = '';
      host.openDialog({
        title: spec.title, modal: !!spec.modal,
        bodyHtml: '<p>' + escHtml(spec.text) + '</p>' + (spec.more ? '<p>' + escHtml(spec.more) + '</p>' : ''),
        actions: spec.actions.map(function (a) {
          return { label: a.label, kind: a.kind, aside: a.aside, autofocus: a.autofocus, onClick: function () { answer = a.key; } };
        }),
        onClose: function () { resolve(answer); }
      });
    });
  }

  /* the editor is from now on on this saved version, with what is on the canvas as that version: Save is
     clean, and the next save is made on it */
  function onSavedVersion(version) {
    baseVersion = version;
    localEdited = false;
    writeMark({ version: version, hash: snapHash(undoStack[undoPtr]) });
    persist(undoStack[undoPtr]);
  }

  /* "Open version N instead": the saved site replaces what is in this editor as a step of its own, so Undo in
     the top bar brings back what was there; the editor is on that version from then on */
  function openSavedVersion() {
    return RevampCore.fetchSite(eventId).then(function (site) {
      if (!site || !site.snapshot || !canvas || remounting) throw new Error('The saved version could not be opened here. Reload the editor to see it.');
      deselect();
      flush();
      canvas.restore(site.snapshot, restoreOpts());
      commitNow();
      onSavedVersion(site.version);
      siteInfo = siteInfo || { required: true };
      siteInfo.savedVersion = site.version;
      renderSiteState();
      showToast('Opened version ' + site.version + '. Undo brings back what you had.');
      // Content's records are drawn as they are today, as on opening
      drawRecords(false);
    }).catch(function (err) {
      showToast('Could not open the saved version — ' + (err && err.message ? err.message : 'please try again.'), { kind: 'error' });
    });
  }

  /* -> a promise of the save's answer; rejects when it was not saved (the reason has been shown) */
  function saveToStaging(opts) {
    opts = opts || {};
    if (!canvas || !eventId) return Promise.reject(new Error('no site'));
    if (saving) return Promise.reject(new Error('busy'));
    /* a save while ETB2B AI is busy would keep half of its change (QA: an empty new section went to staging) */
    var busy = workSafety.busyLine(aiState);
    if (busy) { showToast(busy + '.'); return Promise.reject(cancelled()); }
    deselect();
    flush();
    /* The page and the snapshot sent are one and the same: the page as it stands is recorded first if it differs
       from the newest step, so what is saved is never a page the editor would not reopen. */
    if (!canvas.sameSnapshot(canvas.snapshot(undoStack[undoPtr]), undoStack[undoPtr])) commitNow();
    var snap = undoStack[undoPtr], hash = snapHash(snap), html = canvas.serialize();
    var keptPtr = undoPtr;            // the step this save keeps: the ETB2B AI changes up to it are saved (syncCardSaves)
    var auto = openedSaved && savedMark ? autoPoint() : null;
    saving = true; renderSiteState();
    /* the editor's own updates first, as a version of their own (UX-076); when that cannot be done (a conflict, a
       failure) they go with the person's save, as before */
    function sendAuto() {
      if (!auto) return Promise.resolve(null);
      return RevampCore.saveSite(eventId, {
        templateId: templateId, baseVersion: baseVersion, snapshot: undoStack[auto.ptr], html: auto.html,
        automatic: true, note: 'Updated automatically: ' + auto.names.join(', ')
      }).then(function (out) {
        // the version they are (or the one already showing them): the person's own save is made on it
        writeMark({ version: out.version, hash: auto.hash });
        baseVersion = out.version;
        autoPoints = []; openedSaved = false;
        return out;
      }, function (err) {
        if (window.console) console.warn('[RevampTemplateUI] The automatic updates go with this save:', err);
        return null;
      });
    }
    var autoOut = null;
    function send(force) {
      return RevampCore.saveSite(eventId, { templateId: templateId, baseVersion: force ? 0 : baseVersion, snapshot: snap, html: html, force: force });
    }
    /* The server holds a version this editor was not opened on: someone (or this person, elsewhere) saved in the
       meantime. Only then is the person asked, and they can also open that version instead. */
    function conflict(err) {
      if (!err || err.status !== 409 || err.code !== 'site-conflict') throw err;
      var cur = err.current || {};
      /* nobody has saved this site: nothing can be overwritten */
      if (!cur.version) return send(true);
      var words = workSafety.conflictWords(cur, siteInfo && siteInfo.me, when(cur.updatedAt));
      return ask({ title: words.title, text: words.text, actions: [
        { key: '', label: 'Cancel', kind: 'ghost', aside: true },
        { key: 'open', label: words.open, kind: 'secondary' },
        { key: 'replace', label: words.replace, kind: 'primary', autofocus: true }
      ] }).then(function (answer) {
        if (answer === 'replace') return send(true);
        if (answer === 'open') { saving = false; openSavedVersion(); }
        throw cancelled();
      });
    }
    savingNow = sendAuto().then(function (a) {
      autoOut = a;
      /* nothing but the automatic updates to save */
      if (a && hash === auto.hash) return a;
      return send(false).then(null, conflict);
    }).then(function (out) {
      saving = false; savingNow = null;
      writeMark({ version: out.version, hash: hash });
      baseVersion = out.version;
      // what was saved is this browser's copy; an edit made while the save was on its way is still unsaved
      if (undoStack[undoPtr] === snap) localEdited = false;
      persist(undoStack[undoPtr]);
      siteInfo = siteInfo || { required: true };
      siteInfo.savedVersion = out.version;
      savedPtr = keptPtr;
      renderSiteState();
      if (!opts.quiet) {
        var autoTold = autoOut && !autoOut.unchanged ? 'updated automatically (' + auto.names.join(', ') + ')' : '';
        var text = out === autoOut
          ? (autoOut.unchanged ? 'Nothing new to save: version ' + out.version + ' already has it.' : 'Saved (version ' + out.version + '): ' + autoTold + '.')
          : out.unchanged ? 'Nothing new to save: version ' + out.version + ' already has it.'
            : 'Saved (version ' + out.version + ')' + (out.summary ? ': ' + out.summary : '') + '.' + (autoTold ? ' Also ' + autoTold + ', as version ' + autoOut.version + '.' : '');
        var pend = siteInfo.pending;
        /* the request waiting for approval holds an older version: this save is not in it until it is added (UX-111) */
        if (pend && pend.toVersion < out.version) {
          showToast(text + ' The request waiting for approval still holds version ' + pend.toVersion + '.', {
            action: { label: 'Add this save', onClick: function () { publish(); } }
          });
        } else {
          showToast(text + (siteInfo.published || out.unchanged ? '' : ' Not live yet.'), {
            action: { label: 'Open the saved site', onClick: function () { window.open('/preview/' + eventId + '?staged=1', '_blank'); } }
          });
        }
      }
      return out;
    }, function (err) {
      saving = false; savingNow = null; renderSiteState();
      if (!(err && err.cancelled)) showToast('Could not save — ' + (err && err.message ? err.message : 'please try again.'), { kind: 'error' });
      throw err;
    });
    return savingNow;
  }

  /* Publish: saves what is unsaved, then goes on through the one Publish the console uses too (publish-flow.js,
     RevampCore.openPublishFlow, UX-105): nothing new is said kindly, a request already waiting is shown with its link
     and who approves, a new one is asked for with a note, and where approval has been switched off (Review page ›
     Who approves) it asks once and publishes. The AI-written sections, the logo unit's notice and the sample words
     are asked about before (custom_editor.html). */
  function publish() {
    if (!canvas || !eventId || saving || publishBusy) return;
    // Publish saves first: while ETB2B AI is busy that would send half of its change for approval
    var busy = workSafety.busyLine(aiState);
    if (busy) { showToast(busy + '.'); return; }
    deselect();
    flush();
    if (logoUnitGate()) return;
    publishBusy = true; renderSiteState();
    var ready = isDirty() ? saveToStaging({ quiet: true }) : Promise.resolve();
    ready.then(function () {
      publishBusy = false; renderSiteState();
      if (!RevampCore.openPublishFlow) throw new Error('The publish window could not load. Reload the editor and try again.');
      return RevampCore.openPublishFlow(eventId, {
        from: 'editor', name: currentEvent && currentEvent.name, opener: document.getElementById('btn-publish'),
        busy: function (on) { publishBusy = !!on; renderSiteState(); },
        toast: function (text, o) { showToast(text, o && o.kind === 'error' ? { kind: 'error' } : null); },
        onDone: function (out) {
          if (out.kind === 'published') {
            siteInfo.published = true; siteInfo.publishedVersion = out.result.publishedVersion; siteInfo.pending = null;
            if (currentEvent) { currentEvent.published = true; renderTopbar(); }
          } else if (out.kind === 'sent') {
            var r = out.request;
            siteInfo.pending = { id: r.id, toVersion: r.toVersion, requestedBy: (siteInfo.pending && siteInfo.pending.requestedBy) || siteInfo.me || '' };
          }
          siteInfo.last = null;
          renderSiteState();
          paintDecision(null);
        },
        /* the saved page still has the logo unit's notice open: the dialog goes, and the notice and the logo come up */
        onError: function (err) { if (err && err.code === 'logo-unit-unanswered') { logoNoteRefused(err); return true; } return false; }
      });
    }).catch(function (err) {
      publishBusy = false; renderSiteState();
      if (err && (err.cancelled || err.message === 'busy')) return;
      if (err && err.code === 'logo-unit-unanswered') { logoNoteRefused(err); return; }
      showToast('Could not publish — ' + ((err && err.message) || 'please try again.'), { kind: 'error' });
    });
  }

  /* What Publish would do with what is saved, for custom_editor.html to ask the AI and sample-words questions only
     when there is something to send (UX-104): 'nothing-new' and 'waiting' go straight on, so nobody ticks a list
     to be told there was nothing to publish. Unsaved changes are always something to send. */
  function publishPlan() {
    if (!siteInfo || !window.RevampPublishFlow || isDirty()) return 'send';
    var k = RevampPublishFlow.planOf(approvalShape()).kind;
    return k === 'nothing-new' || k === 'waiting' ? k : 'send';
  }

  /* Every way out of the editor that this page starts itself (the event rail, Back to events) comes through
     here: what is still pending is recorded, and the person is asked before work only this browser has, a save on
     its way or a change ETB2B AI is still making is left behind (workSafety.leaveAsk). Closing or reloading the tab
     is asked by the browser itself (wireLeaving). */
  var leavingNow = false;       // the person chose to go: the browser does not ask again
  function leave(url) {
    flush();
    function go() { leavingNow = true; location.href = url; }
    var q = workSafety.leaveAsk({ ai: aiState, saving: saving, dirty: !!eventId && !!canvas && hasUnsavedWork() });
    if (!q) { go(); return; }
    if (q.kind === 'wait') {
      // the server is finishing the version: this browser records it before the page goes, then asks again if need be
      showToast('Finishing the save first…');
      var again = function () { leave(url); };
      (savingNow || Promise.resolve()).then(again, again);
      return;
    }
    if (q.kind === 'ai') {
      ask({ title: q.title, text: q.text, actions: [
        { key: 'stay', label: 'Stay', kind: 'secondary', autofocus: true },
        { key: 'go', label: 'Leave anyway', kind: 'danger' }
      ] }).then(function (answer) {
        if (answer !== 'go') return;
        // the conversation and the History say the change was not finished, before the page goes
        stopAiTurn(false).then(go, go);
      });
      return;
    }
    ask({ title: q.title, text: q.text, actions: [
      { key: 'stay', label: 'Stay', kind: 'ghost', aside: true },
      { key: 'discard', label: 'Leave without saving', kind: 'secondary' },
      { key: 'save', label: 'Save and leave', kind: 'primary', autofocus: true }
    ] }).then(function (answer) {
      if (answer === 'discard') go();
      // not saved (the reason has been shown, or the person cancelled): the editor stays
      else if (answer === 'save') saveToStaging({ quiet: true }).then(go, function () {});
    });
  }

  /* The editor is left while ETB2B AI is applying a change. The change was never recorded as a step, so it is not
     in this browser's copy: the turn is reported as not finished, which the conversation and the History then say
     (instead of "still being applied"). keepalive: the tab is closing, so the request must outlive the page. */
  var STOPPED_LINE = 'The editor was closed before this change was finished, so it was not kept.';
  function stopAiTurn(keepalive) {
    var t = currentAiTurn;
    if (!aiWorking || !t || t.status !== 'applying') return Promise.resolve();
    t.status = 'failed';
    t.stopped = true;
    // a slow answer does not keep the person on the page
    return Promise.race([reportTurn(t.turnId, 'failed', [], [STOPPED_LINE], keepalive), pause(1500)]);
  }

  /* An ETB2B AI change made in this session stays only in this browser until Save: its card says so, with a Save
     beside Undo, until a save keeps it (renderSiteState keeps them in step; workSafety.cardAsksSave decides). */
  var cardSaves = [];
  var savedPtr = -1;                // the undo step the newest save in this session kept (-1: none yet)
  function drawCardSave(t) {
    if (!eventId || !t.card || !t.card.foot) return;
    var foot = t.card.foot;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-primary btn-sm chat-save'; b.textContent = 'Save';
    b.title = 'Save the site, so the change is kept on the server';
    b.addEventListener('click', function () { saveToStaging().then(null, function () {}); });
    var note = document.createElement('span'); note.className = 'ai-task-local'; note.textContent = 'In this browser only until you Save.';
    foot.insertBefore(b, t.button ? t.button.nextSibling : foot.firstChild);
    foot.appendChild(note);
    cardSaves.push({ t: t, button: b, note: note });
    syncCardSaves(isDirty());
  }
  function syncCardSaves(dirty) {
    cardSaves.forEach(function (c) {
      var show = workSafety.cardAsksSave({ status: c.t.status, pageChanged: c.t.pageChanged, ptr: c.t.ptr, savedPtr: savedPtr }, !!dirty);
      c.button.hidden = c.note.hidden = !show;
      c.button.disabled = saving || !!workSafety.busyLine(aiState);
    });
  }

  /* The side panels change the page through these. While ETB2B AI is applying a change they wait (and say so),
     like the canvas: a step recorded in between would hold half of its change. Selecting waits too (Layers → a
     section's name, Forms → Show on page): it brings up the pills whose tools change the page (QA, UX-090). */
  function whenPageFree(fn) {
    return function () {
      if (aiWorking) { busyToast(); return false; }
      return fn.apply(null, arguments);
    };
  }

  window.RevampTemplateUI = {
    openDevZone: whenPageFree(openDevZone),
    open: open, leave: leave, handoffFor: handoffFor,
    setDevice: setDevice, openPreview: openPreview, publish: publish, save: saveToStaging, siteState: function () { return { info: siteInfo, dirty: isDirty() }; }, undo: undo, redo: redo, flush: flush,
    /* why Save, Publish changes, Undo and Redo wait while ETB2B AI is busy ('' when they need not): the Ctrl/Cmd+S
       shortcuts say it rather than doing nothing */
    busyLine: function () { return workSafety.busyLine(aiState); },
    /* true (and the logo unit's notice brought up) when publishing has to wait for it */
    logoUnitGate: logoUnitGate,
    /* true when copy that came with an added section or block is still on the page: the person is asked, and
       go() runs on "… anyway" (UX-081) */
    placeholderGate: placeholderGate,
    /* "… changed across the whole site — Undo" for a change made from the Theme panel or the "Aa" pop-over: the
       change is recorded first, so Undo takes back that change and nothing older (UX-075) */
    offerUndo: function (msg) { flush(); if (!aiWorking) offerUndo(msg); },
    /* a picture from the computer or by its web address, checked to load first: apply(url), then said is shown
       (the Theme panel's background picture) */
    pickPicture: function (title, current, apply, said) { openPictureDialog(title, current, apply, said); },
    addRepeatItem: whenPageFree(addRepeatItem), removeRepeatItem: whenPageFree(removeRepeatItem),
    getDesign: getDesign, setDesign: whenPageFree(setDesign), designOptions: designOptions, checkImageUrl: checkImageUrl, themesInfo: themesInfo, applyTheme: whenPageFree(applyTheme),
    sectionEdgesInfo: sectionEdgesInfo, applySectionEdges: whenPageFree(applySectionEdges),
    selectedStyle: selectedStyle, styleSelected: whenPageFree(styleSelected),
    listSections: listSections, librarySections: librarySections, selectSection: whenPageFree(selectSection), moveSection: whenPageFree(moveSection),
    pages: function () { return sitePages().map(function (p) { return { slug: p.slug, title: p.title }; }); },
    currentPage: function () { return currentPage; }, showPage: function (slug) { return showPage(slug); },
    setHidden: whenPageFree(setHidden), duplicateSection: whenPageFree(duplicateSection), deleteSection: whenPageFree(deleteSection), renameSection: whenPageFree(renameSection),
    insertSection: whenPageFree(insertSection), addBlock: whenPageFree(addBlock),
    /* forms (editor-forms.js): formsChanged() after the event's forms changed — previews drawn again and the
       live view told (onFormsChange(fn)); unlinkForm(id) before a form is deleted; placeFormSection(id, afterEl);
       revealElement(el) selects and shows a button or embed */
    formsChanged: formsChanged,
    heroVideoChanged: heroVideoChanged,
    onFormsChange: function (fn) { if (typeof fn === 'function') formsListeners.push(fn); },
    /* a form deleted while ETB2B AI is applying a change: the page lets go of it once the change is on the page, as
       a step of its own, and the delete waits for that (forms-builder.js waits for beforeDelete's promise) */
    unlinkForm: function (formId) {
      // said, so the Forms panel does not look stuck while it waits
      if (aiWorking) showToast('The form is deleted once ETB2B AI has finished changing the page.');
      return new Promise(function (done, fail) { whenAiIdle(function () { try { done(unlinkForm(formId)); } catch (err) { fail(err); } }); });
    },
    placeFormSection: whenPageFree(placeFormSection), revealElement: whenPageFree(revealElement),
    hasAiProvenance: hasAiProvenance, aiProvenanceSections: aiProvenanceSections, setAiMarkers: setAiMarkers,
    /* "Check what the AI wrote" (UX-104): markAiChecked(ids) once they are ticked, showAiSection(id) for "Show", and
       publishPlan() so the question is asked only when there is something to send */
    markAiChecked: whenPageFree(markAiChecked), showAiSection: whenPageFree(showAiSection), publishPlan: publishPlan,
    /* for editor-ai-mode.js ("Edit with AI" live view): the mounted canvas (null while there is none),
       onChange(fn) after every change to the page, and leaveEditing() — stops typing in place and lets go of the
       selected element, keeping the selected section (the chat's reference) */
    canvas: function () { return canvas && !remounting ? canvas : null; },
    onChange: function (fn) { if (typeof fn === 'function') changeListeners.push(fn); },
    leaveEditing: function () {
      if (!canvas || remounting) return;
      if (editingEl) exitEdit(editingEl);
      clearElementSelection();
      flush();
    }
  };
})();
