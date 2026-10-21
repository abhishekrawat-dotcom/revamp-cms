/* The site editor's side of registration forms (custom_editor.html). ES5.

   An event has several forms (Register now, Express interest, VIP delegates…), stored with the event
   (events/<id>/forms) and edited with the one builder the console uses too (forms-builder.js). On the page a
   form is reached two ways, both plain markup the editor writes:
     - a button that opens it in a pop-up:  <a data-rv-form="<formId>" href="#rv-form-<formId>">
       (a[data-register-cta] without data-rv-form opens the event's default form)
     - a form embedded in the page:         <div class="rv-block-form" data-rv-form-embed="<formId>">…</div>
   The published and previewed page draw both with templates/_shared/rv-forms.js. In the editor's canvas an
   embedded form shows a preview of its fields that cannot be filled in ([data-rv-form-preview], drawn here,
   never saved, never an undo step — editor-canvas.js nodeHtml / serialize leave it out).

   window.RevampEditorForms
     init(host)          custom_editor.html: { openPanel(), panelBody, isPanelOpen() }
     load()              fetches the event's forms (once at start; again after any change) -> Promise
     list() get(id) defaultFormId() defaultForm()    the forms as last loaded ([] / null before that)
     publicOf(form)      a form as a visitor's page gets it (for RevampForms.render)
     embedHtml(formId, hideTitle)          the saved markup of an embed
     sectionHtml(form, heading, intro)     the inner markup of an embedded-form section
     drawPreviews(doc, {missingOnly})      draws every embed's preview on the canvas
     usage(formId) -> { buttons, embeds }  how the page in the canvas uses a form
     pickForm({ title, current }) -> Promise<formId | null>    a dialog listing the forms
     openPanel(formId)   the Forms panel, at that form when one is named
     placeOnPage(form)   the "Place on page" dialog
     createForms(newForms) -> Promise<{ ids: { ref: formId }, forms: [form] }>   the AI's new forms, made one
                         after another; when one fails, those already made are deleted again and it rejects
     deleteCreated(ids) -> Promise<[{ id, kept, error }]>   the AI's forms taken away again ("Undo this change") */
window.RevampEditorForms = (function () {
  'use strict';

  var C = window.RevampCore;
  var qs = new URLSearchParams(location.search);
  var eventId = qs.get('slug') || qs.get('event') || '';
  var state = { forms: null, defaultFormId: '', countries: [], registration: { open: true }, published: false, waitlist: false, consent: null };
  var loading = null, loadError = '';
  var drafts = {};                  // formId -> the form as it stands in the builder, unsaved
  var host = {}, builder = null;
  var FALLBACK_TEXT = 'This form needs JavaScript. Please turn on JavaScript in your browser to fill it in.';

  function UI() { return window.RevampTemplateUI || null; }
  function canvas() { var u = UI(); return u && u.canvas ? u.canvas() : null; }
  function feedback() { return window.RevampEditorFeedback || {}; }
  function toast(msg, opts) { var f = feedback(); if (f.showToast) f.showToast(msg, opts); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  var ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

  /* ---------- the forms ---------- */
  function setPayload(p) {
    p = p || {};
    state.forms = (p.forms || []).slice();
    state.defaultFormId = p.defaultFormId || '';
    state.countries = p.countries || state.countries || [];
    /* the consent box every form ends with: its wording and the event's links (functions/lib/forms.js consentFor) */
    state.consent = p.consent || state.consent;
    state.registration = p.registration || state.registration;
    state.published = !!p.published;
    loadError = '';
    drawPreviews();
    return p;
  }
  function load() {
    if (!eventId || !C || !C.fetchForms) return Promise.resolve(null);
    if (loading) return loading;
    loading = C.fetchForms(eventId).then(function (p) {
      loading = null;
      return setPayload(p);
    }, function (err) {
      loading = null;
      loadError = (err && err.message) || 'The forms could not be loaded.';
      if (window.console) console.warn('[editor-forms] forms not loaded:', loadError);
      drawPreviews();
      return null;
    });
    return loading;
  }
  function list() { return (state.forms || []).slice(); }
  function get(id) { return (state.forms || []).filter(function (f) { return f.id === id; })[0] || null; }
  function defaultFormId() {
    if (state.defaultFormId && get(state.defaultFormId)) return state.defaultFormId;
    return state.forms && state.forms[0] ? state.forms[0].id : (state.defaultFormId || 'register');
  }
  function defaultForm() { return get(defaultFormId()); }

  /* a form as a visitor's page gets it (functions/lib/forms.js publicForm): what RevampForms.render draws */
  function publicOf(f) {
    if (!f) return null;
    var regOpen = !state.registration || state.registration.open !== false;
    return {
      id: f.id, name: f.name, title: f.title || '', intro: f.intro || '', purpose: f.purpose,
      fields: (f.fields || []).map(function (x) {
        var o = { id: x.id, type: x.type, label: x.label, required: !!x.required, placeholder: x.placeholder || '', help: x.help || '' };
        if (x.options) o.options = x.options.slice();
        if (x.type === 'country') o.options = (state.countries || []).slice();
        return o;
      }),
      submitLabel: f.submitLabel || 'Submit', open: f.open !== false && regOpen, counts: !!f.countsAsRegistration, rev: f.rev || 0,
      consent: state.consent || undefined
    };
  }
  /* the questions an organiser set (the locked consent box every form ends with is not one of them) */
  function ownCount(f) { return (f.fields || []).filter(function (x) { return x && x.type !== 'consent'; }).length; }

  /* ---------- markup (the forms spec, §1.5) ---------- */
  function embedHtml(formId, hideTitle) {
    return '<div class="rv-block-form" data-rv-form-embed="' + esc(formId) + '"' + (hideTitle ? ' data-rv-form-title="hide"' : '') + '>' +
      '<p class="rv-form-fallback" data-rv-form-fallback>' + FALLBACK_TEXT + '</p></div>';
  }
  function sectionHtml(form, heading, intro) {
    var h = String(heading || (form && (form.title || form.name)) || 'Register').slice(0, 80);
    var p = String(intro != null && intro !== '' ? intro : (form && form.intro) || 'Fill in your details below.').slice(0, 300);
    return '<h2 data-editable="text">' + esc(h) + '</h2>' +
      '<p data-editable="text">' + esc(p) + '</p>' +
      embedHtml(form ? form.id : '', true);
  }
  /* the embed element itself, built in the canvas document */
  function makeEmbed(doc, formId, hideTitle) {
    var el = doc.createElement('div');
    el.className = 'rv-block-form';
    el.setAttribute('data-rv-form-embed', formId);
    if (hideTitle) el.setAttribute('data-rv-form-title', 'hide');
    el.setAttribute('data-editable', 'block');
    var p = doc.createElement('p');
    p.className = 'rv-form-fallback';
    p.setAttribute('data-rv-form-fallback', '');
    p.textContent = FALLBACK_TEXT;
    el.appendChild(p);
    return el;
  }

  /* ---------- previews on the canvas ---------- */
  function previewBox(doc) {
    var box = doc.createElement('div');
    box.setAttribute('data-rv-form-preview', '');
    box.setAttribute('data-rv-editor', '');
    box.setAttribute('data-ed', 'none');
    return box;
  }
  function note(doc, box, cls, text) {
    var p = doc.createElement('p');
    p.className = cls;
    p.textContent = text;
    box.appendChild(p);
  }
  function plain(doc, box, form) {
    var wrap = doc.createElement('div');
    wrap.className = 'rv-form-plain';
    var b = doc.createElement('b');
    b.textContent = (form.title || form.name) + ' — form preview';
    wrap.appendChild(b);
    var ul = doc.createElement('ul');
    form.fields.forEach(function (f) {
      var li = doc.createElement('li');
      li.textContent = (f.label || 'Untitled field') + ' · ' + f.type + (f.required ? ' · required' : '');
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    box.appendChild(wrap);
  }
  function drawOne(doc, el) {
    Array.prototype.slice.call(el.children).forEach(function (c) { if (c.hasAttribute('data-rv-form-preview')) c.remove(); });
    var id = el.getAttribute('data-rv-form-embed') || '';
    var box = previewBox(doc);
    el.appendChild(box);
    if (state.forms === null) {
      note(doc, box, 'rv-form-missing', !eventId ? 'A form of the event this site belongs to is shown here.'
        : loadError ? 'The forms could not be loaded, so this form cannot be shown here. It still works on the site.' : 'Loading the form…');
      return;
    }
    var form = drafts[id] || publicOf(get(id));
    if (!form) { note(doc, box, 'rv-form-missing', 'This form no longer exists — choose another form'); return; }
    var RF = window.RevampForms;
    if (RF && typeof RF.render === 'function') {
      try {
        RF.render(form, box, { mode: 'editor-preview', showTitle: el.getAttribute('data-rv-form-title') !== 'hide', waitlist: !!state.waitlist });
        return;
      } catch (e) {
        if (window.console) console.error('[editor-forms] preview', e);
        box.textContent = '';
      }
    }
    plain(doc, box, form);
  }
  /* opts.missingOnly: only the embeds that have no preview yet (a page put back from an undo step, a new block) */
  function drawPreviews(doc, opts) {
    var c = canvas();
    doc = doc || (c && c.doc);
    if (!doc || !doc.querySelectorAll) return;
    var embeds = doc.querySelectorAll('[data-rv-form-embed]');
    if (!embeds.length) return;
    if (window.RevampForms && RevampForms.ensureStyles) { try { RevampForms.ensureStyles(doc, { editor: true }); } catch (e) { /* the preview still draws */ } }
    Array.prototype.forEach.call(embeds, function (el) {
      if (opts && opts.missingOnly && el.querySelector(':scope > [data-rv-form-preview]')) return;
      if (opts && opts.only && el.getAttribute('data-rv-form-embed') !== opts.only) return;
      drawOne(doc, el);
    });
  }
  function setDraft(pf) {
    var had = Object.keys(drafts);
    drafts = {};
    if (pf && pf.id && get(pf.id)) drafts[pf.id] = pf;
    had.concat(Object.keys(drafts)).forEach(function (id) { drawPreviews(null, { only: id }); });
  }

  /* ---------- where the page uses a form ---------- */
  function byAttr(doc, attr, value) {
    return Array.prototype.filter.call(doc.querySelectorAll('[' + attr + ']'), function (el) {
      return el.getAttribute(attr) === value && !el.closest('[data-rv-form-preview]');
    });
  }
  function uses(formId) {
    var c = canvas();
    if (!c || !c.doc) return { buttons: [], embeds: [] };
    var buttons = byAttr(c.doc, 'data-rv-form', formId);
    if (formId === defaultFormId()) {
      buttons = buttons.concat(Array.prototype.filter.call(c.doc.querySelectorAll('a[data-register-cta]'), function (a) { return !a.hasAttribute('data-rv-form'); }));
    }
    return { buttons: buttons, embeds: byAttr(c.doc, 'data-rv-form-embed', formId) };
  }
  function usage(formId) {
    if (!canvas()) return null;
    var u = uses(formId);
    return { buttons: u.buttons.length, embeds: u.embeds.length };
  }
  function showOnPage(form) {
    var u = uses(form.id), el = u.embeds[0] || u.buttons[0];
    if (!el) { toast('“' + form.name + '” is not on the page. Use Place on page, or link a button to it.'); return; }
    var ui = UI();
    if (ui && ui.revealElement) ui.revealElement(el);
  }

  /* ---------- dialogs ---------- */
  function dialog(opts) {
    var f = feedback();
    if (!f.openDialog) return null;
    var h = f.openDialog(opts);
    // choosing in the dialog must not let go of what is selected on the page ("inside the selected section")
    if (h && h.el && h.el.parentNode) h.el.parentNode.setAttribute('data-keep-selection', '');
    return h;
  }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* resolves the chosen form's id, '' for "Create a form…" (the Forms panel is opened), null when cancelled */
  function pickForm(opts) {
    opts = opts || {};
    return (state.forms === null ? load() : Promise.resolve()).then(function () {
      return new Promise(function (resolve) {
        var forms = list(), done = false;
        var body = forms.length
          ? '<fieldset class="rvf-pick" style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">' +
            '<legend class="hint" style="margin-bottom:6px">Which form?</legend>' +
            forms.map(function (f, i) {
              var checked = opts.current ? f.id === opts.current : i === 0;
              return '<label style="display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer">' +
                '<input type="radio" name="rvf-pick" value="' + esc(f.id) + '"' + (checked ? ' checked' : '') + ' style="margin-top:3px">' +
                '<span style="min-width:0"><b style="display:block;overflow-wrap:anywhere">' + esc(f.name) + (f.id === defaultFormId() ? ' <span class="hint">(default)</span>' : '') + '</b>' +
                '<span class="hint">' + ownCount(f) + ' fields' + (f.open === false ? ' · not taking responses' : '') + '</span></span></label>';
            }).join('') + '</fieldset>'
          : '<p class="hint">This event has no forms yet.</p>';
        var h = dialog({
          title: opts.title || 'Choose a form',
          bodyHtml: body,
          onClose: function () { if (!done) { done = true; resolve(null); } },
          actions: [
            { label: 'Create a form…', kind: 'ghost', aside: true, onClick: function () { done = true; resolve(''); openPanel(); } },
            { label: 'Cancel', kind: 'secondary' },
            { label: opts.okLabel || 'Use this form', kind: 'primary', autofocus: true, onClick: function () {
              var on = h && h.el.querySelector('input[name="rvf-pick"]:checked');
              if (!on) return false;
              done = true; resolve(on.value);
            } }
          ]
        });
        if (!h) resolve(null);
      });
    });
  }

  function placeOnPage(form) {
    var ui = UI();
    if (!ui || !canvas()) return;
    var secs = ui.listSections().filter(function (s) { return !s.hidden; });
    var current = secs.filter(function (s) { return s.current; })[0] || null;
    var footer = secs.filter(function (s, i) { return s.type === 'footer' || (s.pinned && i === secs.length - 1); })[0];
    var fallback = current || (footer ? secs[secs.indexOf(footer) - 1] : secs[secs.length - 1]) || null;
    var body =
      '<p class="hint" style="margin-bottom:10px">“' + esc(trunc(form.name, 60)) + '” is drawn in the page itself, with the same fields as its pop-up.</p>' +
      '<label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:8px"><input type="radio" name="rvf-place" value="section" checked style="margin-top:3px">' +
        '<span><b>As a new section</b><span class="hint" style="display:block">A heading, a line of text and the form.</span></span></label>' +
      '<label style="display:block;margin:0 0 14px 25px"><span class="hint">Put it</span> <select id="rvf-place-after" style="max-width:100%">' +
        secs.map(function (s) { return '<option value="' + esc(s.key) + '"' + (fallback && s.el === fallback.el ? ' selected' : '') + '>after “' + esc(trunc(s.name, 40)) + '”</option>'; }).join('') +
      '</select></label>' +
      '<label style="display:flex;gap:9px;align-items:flex-start"><input type="radio" name="rvf-place" value="block"' + (current ? '' : ' disabled') + ' style="margin-top:3px">' +
        '<span><b>Inside the selected section</b><span class="hint" style="display:block">' +
        (current ? 'At the end of “' + esc(trunc(current.name, 40)) + '”, or after the element selected in it.' : 'Click a section on the page first, then choose this.') + '</span></span></label>';
    var h = dialog({
      title: 'Place “' + trunc(form.name, 40) + '” on the page',
      bodyHtml: body,
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        { label: 'Place on page', kind: 'primary', autofocus: true, onClick: function () {
          var how = h.el.querySelector('input[name="rvf-place"]:checked');
          if (how && how.value === 'block' && current) {
            ui.addBlock('form', { formId: form.id, section: current.el });
          } else {
            var key = h.el.querySelector('#rvf-place-after').value;
            var after = secs.filter(function (s) { return s.key === key; })[0];
            ui.placeFormSection(form.id, after ? after.el : null);
          }
          // the panel's list says where each form is used: this one is on the page now
          if (builder) builder.redraw();
        } }
      ]
    });
  }

  /* ---------- the Forms panel ---------- */
  function init(h) { host = h || {}; }
  function mountPanel() {
    if (builder || !host.panelBody || !window.RevampFormsBuilder || !eventId) return builder;
    builder = RevampFormsBuilder.mount(host.panelBody, {
      eventId: eventId, core: C, layout: 'compact',
      usage: usage,
      actions: [{ id: 'place', label: 'Place on page' }, { id: 'show', label: 'Show on page' }],
      onAction: function (id, form) { if (id === 'place') placeOnPage(form); else if (id === 'show') showOnPage(form); },
      onDraft: function (pf) { setDraft(pf); },
      onChange: function (payload) {
        setPayload(payload);
        var ui = UI();
        if (ui && ui.formsChanged) ui.formsChanged();
      },
      beforeDelete: function (form) {
        var ui = UI();
        if (ui && ui.unlinkForm) ui.unlinkForm(form.id);
      },
      toast: function (msg) { toast(msg); }
    });
    return builder;
  }
  function openPanel(formId) {
    if (host.openPanel) host.openPanel();
    var b = mountPanel();
    if (!b) return;
    if (formId) b.openForm(formId);
  }
  /* the panel opened again: its list is fetched afresh (a form made in the console since shows up) */
  function panelShown() {
    if (!eventId) {
      // a template opened on its own (no event): there are no forms to manage
      if (host.panelBody && !host.panelBody.firstChild) {
        var p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'Forms belong to an event. Open this site from its event to make forms and put them on the page.';
        host.panelBody.appendChild(p);
      }
      return;
    }
    var fresh = !builder;
    var b = mountPanel();
    if (b && !fresh) b.reload();
  }
  function panelDirty() { return !!(builder && builder.isDirty()); }

  /* Back from another tab (the event console, where a form may just have been made or renamed): the forms are
     fetched again, so "Opens form", the Add panel's Form and the canvas previews offer it at once (the Forms
     panel's builder fetches them again itself). */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !eventId || state.forms === null) return;
    load();
  });

  /* ---------- the AI's forms ---------- */
  function createForms(newForms) {
    var ids = {}, made = [];
    function rollback() {
      return Promise.all(made.map(function (f) {
        return C.deleteForm(eventId, f.id, { force: true }).then(null, function () { return null; });
      }));
    }
    function next(i) {
      if (i >= newForms.length) return Promise.resolve();
      var n = newForms[i], input = {};
      Object.keys(n.form || {}).forEach(function (k) { input[k] = n.form[k]; });
      if (input.id && !ID_RE.test(input.id)) delete input.id;
      if (!input.template && n.template) input.template = n.template;
      return C.createForm(eventId, { form: input }).then(function (res) {
        var f = res && res.form;
        if (!f || !f.id) throw new Error('The server did not send the new form back.');
        ids[n.ref] = f.id;
        made.push(f);
        return next(i + 1);
      }, function (err) {
        var why = String((err && err.message) || 'please try again').replace(/[.\s]+$/, '');
        var e = new Error('The form “' + ((n.form && n.form.name) || n.ref) + '” could not be created: ' + why + '.');
        e.cause = err;
        throw e;
      });
    }
    return next(0).then(function () {
      return load().then(function () { return { ids: ids, forms: made }; });
    }, function (err) {
      return rollback().then(function () { return load(); }).then(function () { throw err; });
    });
  }
  function deleteCreated(ids) {
    var out = [];
    function next(i) {
      if (i >= ids.length) return Promise.resolve();
      var id = ids[i], f = get(id);
      return C.deleteForm(eventId, id, { force: false }).then(function () {
        out.push({ id: id, name: f ? f.name : id, kept: false });
      }, function (err) {
        out.push({ id: id, name: f ? f.name : id, kept: true, inUse: !!(err && err.code === 'form-in-use'), error: (err && err.message) || '' });
      }).then(function () { return next(i + 1); });
    }
    return next(0).then(function () { return load(); }).then(function () {
      if (builder) builder.reload();
      var ui = UI();
      if (ui && ui.formsChanged) ui.formsChanged();
      return out;
    });
  }
  function afterAiChange() {
    if (builder) builder.reload();
    drawPreviews();
  }

  return {
    init: init, load: load, list: list, get: get, defaultFormId: defaultFormId, defaultForm: defaultForm, publicOf: publicOf,
    embedHtml: embedHtml, sectionHtml: sectionHtml, makeEmbed: makeEmbed,
    drawPreviews: drawPreviews, usage: usage, uses: uses, pickForm: pickForm, openPanel: openPanel, placeOnPage: placeOnPage,
    panelShown: panelShown, panelDirty: panelDirty, createForms: createForms, deleteCreated: deleteCreated, afterAiChange: afterAiChange,
    loaded: function () { return state.forms !== null; },
    panelRedraw: function () { if (builder) builder.redraw(); }
  };
})();
