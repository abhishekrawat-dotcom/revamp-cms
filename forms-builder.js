/* ===========================================================================
   Revamp CMS — the registration forms builder (ES5, no dependencies besides RevampCore)

   ONE component for both places an organiser manages an event's forms:
     - the event console, Settings › Registration forms (edit-event.html)   layout 'wide'
     - the site editor's Forms panel (custom_editor.html, editor-forms.js)  layout 'compact'
   Both read and write the same forms (events/<id>/forms) through RevampCore, so a form made in one place is
   in the other as soon as that one reloads. Nothing about forms is kept in the browser: the templates, the
   field types, the quick-pick fields, the country list and the limits all come from GET /api/event/forms.

   window.RevampFormsBuilder.mount(container, {
     eventId, core: RevampCore, layout: 'wide' | 'compact',
     usage:  function (formId) -> { buttons, embeds } | null   where the editor's page uses the form (editor only)
     actions: [{ id, label }]                                    extra row actions (editor: Place on page, Show on page)
     onAction: function (actionId, form)
     onDraft:  function (previewForm)    every edit of the open form (debounced), for the editor's canvas previews
     onChange: function (payload)        after every successful save / create / delete / default / order: the
                                         fresh GET /api/event/forms answer
     beforeDelete: function (form, usage) -> Promise|undefined   the editor unlinks the page's buttons and
                                         embeds first (one undo step); the delete is then forced
     toast: function (msg)
   }) -> { reload(), openForm(formId), getForms(), defaultFormId(), isDirty(), save(), discard(), destroy() }

   A form being edited is a draft until "Save form": it is never saved field by field. Leaving it with
   changes asks first (isDirty/save/discard are what the console's own "leave this view?" question uses).

   The preview is the real form runtime (templates/_shared/rv-forms.js, RevampForms.render in its
   'editor-preview' mode: nothing can be typed or sent). Without that file the preview is a plain list.
   =========================================================================== */
(function () {
  'use strict';

  /* ---------- rules shared with the server (functions/lib/forms.js) ---------- */
  var MAPPED_TYPES = { name: 'text', first_name: 'text', last_name: 'text', email: 'email', phone: 'phone', company: 'text', designation: 'text', city: 'text', location: 'location', consent: 'consent' };
  var MAPPED_COLUMN = { name: 'Name', first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone', company: 'Company', designation: 'Designation', city: 'City', location: 'Location', consent: 'Consent' };
  /* THE CONSENT BOX: every form ends with it (functions/lib/forms.js: { id: 'consent', type: 'consent' }). It is
     not one of the draft's fields — nothing here can remove, move, reword or loosen it: it is shown locked after
     them, the server puts it back last on every save, and the preview draws it with the event's own wording and
     links (GET /api/event/forms `consent`). */
  var CONSENT_ID = 'consent', CONSENT_TYPE = 'consent';
  var CONSENT_TITLE = 'Consent (always required)';
  var CONSENT_NOTE = 'Every form ends with this box and visitors must tick it to submit. It cannot be removed, moved or changed. Its links are your event\u2019s ET portal\u2019s privacy, cookie and terms pages.';
  function isConsent(f) { return !!f && (f.type === CONSENT_TYPE || f.id === CONSENT_ID); }
  function ownFields(list) { return (list || []).filter(function (f) { return !isConsent(f); }); }
  /* every form asks for an email address, always required: it is how one response is told from another (the
     other standard questions — names, mobile, company, designation, location — can be made optional or removed) */
  var LOCKED = { email: 1 };
  var OPTION_TYPES = { select: 1, radio: 1, multiselect: 1 };
  var TEXT_LIKE = { text: 1, textarea: 1, email: 1, phone: 1, number: 1, url: 1, location: 1 };   // types a placeholder shows on
  var MAX = { name: 80, title: 120, intro: 600, label: 120, placeholder: 120, help: 300, submitLabel: 40, successMessage: 600, option: 120 };
  var DEFAULT_LIMITS = { maxForms: 20, maxFields: 40, maxOptions: 100 };
  var LOCK_NOTE = 'Every form asks for an email address, always required: it is how one response is told from another';
  var LOCK_BADGE = 'Always required';
  /* the words for a form's purpose (the server's PURPOSES); the choices themselves come from its templates */
  var PURPOSE_WORDS = { register: 'Registration', interest: 'Expression of interest', partner: 'Partnership enquiry', vip: 'VIP invitation request', speaker: 'Speaker application', nomination: 'Award nomination', custom: 'Other' };
  /* a Long text field's word limit (the server's forms.WORDS) */
  var WORDS = { min: 10, max: 1000 };
  /* the types a field may depend on (Field.requiredWhen: required only when that answer is a certain option) */
  var CONDITION_TYPES = { select: 1, radio: 1 };

  /* ---------- small pure helpers (exported as RevampFormsBuilder._pure for the unit test) ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function str(v) { return v == null ? '' : String(v); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function moveItem(list, from, to) {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
    var item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    return true;
  }
  /* One option per line, trimmed, empty lines and repeats (against `have` too) dropped, each cut to 120. */
  function parseOptionList(text, have) {
    var seen = {}, out = [];
    (have || []).forEach(function (o) { seen[String(o).toLowerCase()] = 1; });
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var v = line.replace(/\s+/g, ' ').trim().slice(0, MAX.option);
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1;
      out.push(v);
    });
    return out;
  }

  /* What a template answers with, whatever its exact shape ({ id, name, purpose, …form keys } or { id, form }) */
  function templateForm(t) {
    var f = (t && t.form) || t || {};
    return {
      name: str(f.name || t.name), title: str(f.title != null ? f.title : (f.name || t.name)), intro: str(f.intro),
      purpose: str(f.purpose || t.purpose || 'custom'),
      fields: clone(ownFields(f.fields)),
      submitLabel: str(f.submitLabel), successMessage: str(f.successMessage),
      countsAsRegistration: !!f.countsAsRegistration, needsApproval: !!f.needsApproval,
      open: f.open !== false, duplicates: f.duplicates === 'allow' ? 'allow' : 'reject',
      template: str(t.id || f.template || 'blank')
    };
  }
  function templateId(t) { return str(t && (t.id || (t.form && t.form.template))); }
  /* "VIP delegates: needs approval, counts as a registration" */
  function describeTemplate(t) {
    if (t && t.description) return str(t.description);
    var f = templateForm(t), bits = [];
    if (f.needsApproval) bits.push('needs approval');
    bits.push(f.countsAsRegistration ? 'counts as a registration' : 'does not count as a registration');
    var extra = ownFields(f.fields).length;
    if (extra) bits.push(plural(extra, 'field'));
    return f.name + ': ' + bits.join(', ');
  }

  /* A field's condition (Field.requiredWhen), when it still holds: the field it depends on is above it in
     `list`, is a Dropdown or Single choice, and still has that option. Else null — the condition is dropped
     (the question it depended on was deleted, moved below it, retyped or lost that option). */
  function conditionOf(f, list) {
    var rw = f && f.requiredWhen;
    if (!rw || f.required || typeof rw !== 'object') return null;
    var at = -1;
    (list || []).forEach(function (x, j) { if (x === f) at = j; });
    for (var j = 0; j < (at === -1 ? (list || []).length : at); j++) {
      var x = list[j];
      if (x && x.id && x.id === rw.field) {
        if (!CONDITION_TYPES[x.type]) return null;
        return (x.options || []).map(function (o) { return str(o).trim(); }).indexOf(str(rw.equals)) !== -1 ? { field: str(rw.field), equals: str(rw.equals) } : null;
      }
    }
    return null;
  }
  /* a Long text field's word limit as a number, or null when it has none ('' or nothing) */
  function maxWordsOf(f) {
    if (!f || f.type !== 'textarea' || f.maxWords == null || f.maxWords === '') return null;
    var n = Number(f.maxWords);
    return isFinite(n) ? n : NaN;
  }

  /* The form as the server takes it (FormInput): every key it accepts and nothing it refuses. A field that
     has no id yet is sent without one; the server gives it one from its label. */
  function formInput(d) {
    var own = ownFields(d.fields);
    return {
      name: str(d.name).trim(), title: str(d.title).trim(), intro: str(d.intro).replace(/\s+$/, ''),
      purpose: d.purpose || 'custom',
      fields: own.map(function (f) {
        var o = {};
        if (f.id) o.id = f.id;
        o.type = f.type; o.label = str(f.label).trim(); o.required = !!f.required;
        o.placeholder = str(f.placeholder).trim(); o.help = str(f.help).trim();
        if (OPTION_TYPES[f.type]) o.options = (f.options || []).map(function (x) { return str(x).trim(); });
        var mw = maxWordsOf(f);
        if (mw !== null) o.maxWords = mw;
        var cond = conditionOf(f, own);
        if (cond) o.requiredWhen = cond;
        return o;
      }),
      submitLabel: str(d.submitLabel).trim(), successMessage: str(d.successMessage).replace(/\s+$/, ''),
      countsAsRegistration: !!d.countsAsRegistration, needsApproval: !!d.needsApproval,
      open: d.open !== false, duplicates: d.duplicates === 'allow' ? 'allow' : 'reject',
      template: d.template || 'blank'
    };
  }
  function draftOf(form) {
    var d = formInput(form || {});
    d.fields = ownFields(form && form.fields).map(function (f, i) {
      var o = d.fields[i];
      o.label = str(f.label);
      if (OPTION_TYPES[f.type]) o.options = (f.options || []).slice();
      /* kept as stored while it is edited: formInput drops one that no longer holds */
      if (f.requiredWhen && !f.required) o.requiredWhen = { field: str(f.requiredWhen.field), equals: str(f.requiredWhen.equals) };
      return o;
    });
    d.name = str(form && form.name); d.title = str(form && form.title); d.intro = str(form && form.intro);
    d.successMessage = str(form && form.successMessage);
    return d;
  }
  function sameDraft(a, b) { return JSON.stringify(formInput(a)) === JSON.stringify(formInput(b)); }

  /* Everything that would make the server refuse the form, found first, in the order it is on screen.
     -> [{ key, field (index) , option (index), msg }] */
  function nameKey(s) { return str(s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  /* otherNames: the names of the event's other forms (two forms never share a name, as the server says) */
  function validateDraft(d, limits, otherNames) {
    limits = limits || DEFAULT_LIMITS;
    var errs = [];
    if (!str(d.name).trim()) errs.push({ key: 'name', msg: 'Give the form a name.' });
    else if ((otherNames || []).some(function (n) { return nameKey(n) === nameKey(d.name); })) {
      errs.push({ key: 'name', msg: 'Another form of this event is already called “' + str(d.name).trim() + '”. Give this one a different name.' });
    }
    (d.fields || []).forEach(function (f, i) {
      if (!str(f.label).trim()) errs.push({ key: 'label', field: i, msg: 'Give this field a label.' });
      var mw = maxWordsOf(f);
      if (mw !== null && (!(mw >= WORDS.min && mw <= WORDS.max) || Math.floor(mw) !== mw)) {
        errs.push({ key: 'maxWords', field: i, msg: 'A word limit is a whole number from ' + WORDS.min + ' to ' + WORDS.max + ', or leave it empty for none.' });
      }
      if (OPTION_TYPES[f.type]) {
        var opts = f.options || [], seen = {};
        if (!opts.length) errs.push({ key: 'options', field: i, msg: 'Add at least one option.' });
        if (opts.length > limits.maxOptions) errs.push({ key: 'options', field: i, msg: 'A field can have up to ' + limits.maxOptions + ' options.' });
        opts.forEach(function (o, oi) {
          var v = str(o).trim();
          if (!v) errs.push({ key: 'option', field: i, option: oi, msg: 'Fill in this option or remove it.' });
          else if (seen[v.toLowerCase()]) errs.push({ key: 'option', field: i, option: oi, msg: 'Two options say “' + v + '”. Each option must be different.' });
          seen[v.toLowerCase()] = 1;
        });
      }
    });
    if ((d.fields || []).length > limits.maxFields) errs.push({ key: 'fields', msg: 'A form can have up to ' + limits.maxFields + ' fields.' });
    if (!str(d.submitLabel).trim()) errs.push({ key: 'submitLabel', msg: 'Give the submit button a label.' });
    if (!str(d.successMessage).trim()) errs.push({ key: 'successMessage', msg: 'Write what visitors see after they submit.' });
    return errs;
  }

  /* The server names the field it refused: "name", "fields.3.label", "fields[3].options"… -> { key, field } */
  function serverFieldOf(path) {
    var p = str(path).replace(/^form\./, '');
    var m = /^fields?(?:\[(\d+)\]|\.(\d+))(?:\.(\w+))?/.exec(p);
    if (m) return { field: +(m[1] != null ? m[1] : m[2]), key: m[3] || 'label' };
    return p ? { key: p.split('.')[0] } : null;
  }

  /* The form as a visitor's page gets it (§1.4 of the forms spec), for the preview: fields without an id
     yet get one for this drawing only; a country field gets the country list. */
  function previewForm(d, formId, countries, consent) {
    var used = {};
    var fields = ownFields(d.fields).map(function (f, i) {
      var id = f.id || ('new_field_' + (i + 1));
      while (used[id]) id += '_x';
      used[id] = 1;
      var o = { id: id, type: f.type, label: str(f.label).trim(), required: !!f.required, placeholder: str(f.placeholder), help: str(f.help) };
      if (OPTION_TYPES[f.type]) o.options = (f.options || []).map(function (x) { return str(x).trim(); }).filter(Boolean);
      if (f.type === 'country') o.options = (countries || []).slice();
      var mw = maxWordsOf(f);
      if (mw && mw >= WORDS.min && mw <= WORDS.max) o.maxWords = Math.floor(mw);
      var cond = conditionOf(f, ownFields(d.fields));
      if (cond) o.requiredWhen = cond;
      return o;
    });
    /* the locked consent box, last, as visitors see it */
    fields.push({ id: CONSENT_ID, type: CONSENT_TYPE, label: 'Consent', required: true, placeholder: '', help: '' });
    var out = {
      id: formId || 'new-form', name: str(d.name).trim() || 'Untitled form', title: str(d.title).trim(), intro: str(d.intro),
      purpose: d.purpose, fields: fields, submitLabel: str(d.submitLabel).trim() || 'Submit',
      open: d.open !== false, counts: !!d.countsAsRegistration, rev: 0
    };
    if (consent && typeof consent.text === 'string') out.consent = clone(consent);
    return out;
  }
  /* The locked consent row shown after the fields: its sentence with the event's links (an older server that
     sends no wording: the title and the note only). */
  function consentHtml(consent, idBase) {
    var text = '';
    if (consent && typeof consent.text === 'string') {
      text = esc(consent.text);
      (consent.links || []).forEach(function (l) {
        if (!l || !l.label || !/^https:\/\//.test(str(l.href))) return;
        text = text.replace(esc(l.label), '<a href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>');
      });
    }
    return '<div class="fb-consent" role="group" aria-labelledby="' + idBase + '-t" aria-describedby="' + idBase + '-n">' +
      '<div class="fb-consent-h"><span class="fb-consent-t" id="' + idBase + '-t">' + esc(CONSENT_TITLE) + '</span>' +
      '<span class="fb-lock">' + svg(IC.lock, 12) + '<span class="fb-lock-t">Locked</span></span></div>' +
      (text ? '<p class="fb-consent-x"><span class="fb-consent-box" aria-hidden="true"></span><span>' + text + '<span class="fb-consent-req" aria-hidden="true">*</span></span></p>' : '') +
      '<p class="fb-hint" id="' + idBase + '-n">' + esc(CONSENT_NOTE) + '</p></div>';
  }

  /* ---------- icons ---------- */
  function svg(inner, size) {
    return '<svg width="' + (size || 15) + '" height="' + (size || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  var IC = {
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6l-1 14.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 20.2L5 6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    caret: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    more: '<circle cx="5.5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.5" cy="12" r="1.5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>'
  };

  /* ---------- the dialog every question of the builder uses ---------- */
  /* opts: { title, body (text), buttons: [{ label, value, kind: 'primary'|'danger'|'' }] } -> Promise<value|null>
     Escape, the backdrop and Cancel answer null. Focus stays inside; it goes back where it was. */
  function ask(opts) {
    return new Promise(function (resolve) {
      var opener = document.activeElement;
      var scrim = document.createElement('div');
      scrim.className = 'fb-scrim';
      var id = 'fb-dlg-' + (++ask.n);
      scrim.innerHTML = '<div class="fb-dialog" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t" aria-describedby="' + id + '-b">' +
        '<h3 id="' + id + '-t">' + esc(opts.title) + '</h3>' +
        '<div class="fb-dialog-body" id="' + id + '-b">' + String(opts.body || '').split('\n').map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
        '<div class="fb-dialog-acts">' + (opts.buttons || []).map(function (b, i) {
          return '<button type="button" class="fb-btn' + (b.kind ? ' fb-btn-' + b.kind : '') + '" data-i="' + i + '">' + esc(b.label) + '</button>';
        }).join('') + '</div></div>';
      document.body.appendChild(scrim);
      var dlg = scrim.firstChild;
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        scrim.remove();
        if (opener && opener.focus && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
        if (e.key !== 'Tab') return;
        var f = dlg.querySelectorAll('button');
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) done(null); });
      dlg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-i]');
        if (b) done(opts.buttons[+b.getAttribute('data-i')].value);
      });
      var primary = dlg.querySelector('.fb-btn-primary') || dlg.querySelector('button');
      if (primary) primary.focus();
    });
  }
  ask.n = 0;

  /* ======================================================================
     mount
     ====================================================================== */
  function mount(container, o) {
    o = o || {};
    var C = o.core || window.RevampCore;
    var eventId = String(o.eventId || '');
    var compact = o.layout === 'compact';
    var root = document.createElement('div');
    root.className = 'fb ' + (compact ? 'fb-compact' : 'fb-wide');
    container.textContent = '';
    container.appendChild(root);

    var data = null, loadError = null, loading = false, busy = false, destroyed = false;
    var view = 'list';                 // 'list' | 'form'
    var formId = null;                 // the form being edited (null: a new one, not saved yet)
    var base = null, draft = null, isNew = false;
    var expanded = -1;                 // the field whose editor is open
    var errors = [];                   // [{ key, field, option, msg }] shown on the form
    var alertText = '';
    var savedFlash = false;
    var showPreview = !compact;
    var pasteOpen = -1;
    var previewTimer = null, previewCtl = null;
    var menuOpen = null;               // which menu is open: 'tpl' | 'add' | 'row:<id>'
    var uid = ++mount.n;

    function limits() {
      var l = (data && data.limits) || {};
      return { maxForms: +l.maxForms || DEFAULT_LIMITS.maxForms, maxFields: +l.maxFields || DEFAULT_LIMITS.maxFields, maxOptions: +l.maxOptions || DEFAULT_LIMITS.maxOptions };
    }
    function forms() { return (data && data.forms) || []; }
    function defaultId() { return data ? (data.defaultFormId || (forms()[0] && forms()[0].id) || '') : ''; }
    function formById(id) { return forms().filter(function (f) { return f.id === id; })[0] || null; }
    function templates() { return (data && data.templates) || []; }
    function fieldTypes() { return (data && data.fieldTypes) || []; }
    function typeLabel(type) {
      var t = fieldTypes().filter(function (x) { return x.type === type; })[0];
      return t ? t.label : type;
    }
    function purposeChoices() {
      var seen = {}, out = [];
      templates().forEach(function (t) {
        var f = templateForm(t);
        if (!f.purpose || seen[f.purpose]) return;
        seen[f.purpose] = 1;
        out.push({ value: f.purpose, label: PURPOSE_WORDS[f.purpose] || f.name || f.purpose });
      });
      if (draft && draft.purpose && !seen[draft.purpose]) out.push({ value: draft.purpose, label: draft.purpose });
      return out;
    }
    function purposeLabel(p) {
      var c = purposeChoices().filter(function (x) { return x.value === p; })[0];
      return c ? c.label : (PURPOSE_WORDS[p] || p || PURPOSE_WORDS.custom);
    }
    function toast(msg) {
      if (typeof o.toast === 'function') o.toast(msg);
      else if (C && C.toast) C.toast(msg);
    }
    function errText(err, fallback) {
      if (!err) return fallback;
      if (err.status === 0) return 'Could not reach the server. Check your connection and try again.';
      if (err.status === 401) return 'Your sign-in has expired. Sign in again, then try once more.';
      if (err.status >= 500) return fallback + ' Something went wrong on our side. Please try again.';
      return (err.message || fallback);
    }
    /* the names of the event's other forms; a form whose saved name is the one being typed keeps it */
    function otherNames() {
      var keepOwn = base && nameKey(base.name);
      return forms().filter(function (f) { return f.id !== formId; }).map(function (f) { return f.name; })
        .filter(function (n) { return !keepOwn || nameKey(n) !== keepOwn; });
    }
    function dirty() { return view === 'form' && !!draft && (isNew || !sameDraft(draft, base)); }

    /* ---------- loading ---------- */
    /* One request at a time; asked again while one is out (a write just finished), it fetches once more after
       it, so what is drawn is never older than the last write. */
    var inflight = null, queued = null;
    function load() {
      if (inflight) {
        if (!queued) queued = inflight.then(function () { queued = null; return load(); });
        return queued;
      }
      inflight = fetchOnce().then(function () { inflight = null; }, function () { inflight = null; });
      return inflight;
    }
    function fetchOnce() {
      loading = true;
      return C.fetchForms(eventId).then(function (d) {
        loading = false;
        if (destroyed) return;
        data = d || {};
        data.forms = (data.forms || []).slice();
        loadError = null;
        // the form open in the builder follows the server, unless it has changes of its own
        if (view === 'form' && !isNew && formId) {
          var fresh = formById(formId);
          if (!fresh) { alertText = 'This form was deleted somewhere else. Save it to keep it as a new form, or go back to the list.'; isNew = true; formId = null; }
          else if (!dirty() && fresh.updatedAt !== base.updatedAt) { base = clone(fresh); draft = draftOf(fresh); }
          else base.updatedAt = base.updatedAt || fresh.updatedAt;
        }
        render();
      }, function (err) {
        loading = false;
        if (destroyed) return;
        loadError = errText(err, 'The forms could not be loaded.');
        // a list already on screen stays, with the reason it could not be brought up to date
        if (data) alertText = loadError + ' What is shown may be out of date.';
        render();
      });
    }
    function changed() {
      return load().then(function () { if (data && typeof o.onChange === 'function') o.onChange(data); });
    }

    /* ---------- drawing ---------- */
    function render() {
      if (destroyed) return;
      var keep = focusKey();
      var scroller = scrollParent();
      var top = scroller ? scroller.scrollTop : 0;
      if (!data) {
        root.innerHTML = loadError
          ? '<div class="fb-state" role="alert"><p>' + esc(loadError) + '</p><button type="button" class="fb-btn" data-fb-act="retry">Try again</button></div>'
          : '<div class="fb-state"><span class="fb-spin" aria-hidden="true"></span><p>Loading forms…</p></div>';
        return;
      }
      root.innerHTML = view === 'form' ? formHtml() : listHtml();
      if (view === 'form') schedulePreview(true);
      if (scroller) scroller.scrollTop = top;
      restoreFocus(keep);
      placeMenu();
    }
    /* An open menu is placed against the window, under its button (above it when there is no room below),
       so the editor's narrow, scrolling panel never cuts it off. */
    function placeMenu() {
      var menu = root.querySelector('.fb-menu');
      if (!menu) return;
      var btn = menu.parentNode.querySelector('[data-fb-act="menu"]');
      if (!btn) return;
      var r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      var w = menu.offsetWidth, h = menu.offsetHeight;
      var left = menu.classList.contains('fb-menu-right') ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      var top = r.bottom + 4;
      if (top + h > vh - 8 && r.top - h - 4 >= 8) top = r.top - h - 4;
      top = Math.max(8, Math.min(top, vh - h - 8));
      menu.style.left = Math.round(left) + 'px';
      menu.style.top = Math.round(top) + 'px';
    }
    function scrollParent() {
      for (var n = container; n && n !== document.body; n = n.parentElement) {
        var oy = window.getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      }
      return document.scrollingElement || document.documentElement;
    }
    /* Focus that never scrolls the page around the builder: the site editor's whole window would move (its top
       bar out of sight) with a plain focus() or scrollIntoView(). Only the builder's own scrolling box moves, just
       enough to show el (centred when asked). */
    function focusEl(el, center) {
      if (!el) return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      var box = null;
      for (var n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        var oy = window.getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) { box = n; break; }
      }
      if (!box) {
        // the console: the window is the scroller and moving it is fine
        if (center && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        return;
      }
      var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (center) box.scrollTop += (r.top + r.height / 2) - (b.top + b.height / 2);
      else if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
      else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
    }
    function focusKey() {
      var a = document.activeElement;
      if (!a || !root.contains(a)) return null;
      return a.getAttribute('data-fk') || null;
    }
    function restoreFocus(k) {
      if (!k) return;
      var el = root.querySelector('[data-fk="' + k.replace(/"/g, '') + '"]');
      if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }

    /* ---------- the list of forms ---------- */
    function listHtml() {
      var list = forms(), lim = limits(), full = list.length >= lim.maxForms;
      var fullNote = full ? 'An event can have up to ' + lim.maxForms + ' forms. Delete one to add another.' : '';
      var h = '<div class="fb-list-view">';
      // the editor's panel has its own heading ("Forms"); the console's page has "Registration forms" above it
      h += '<div class="fb-head"><div class="fb-head-t">' + (compact
        ? '<p class="fb-sub">The forms visitors fill in on this site. A button opens one in a pop-up, or it sits in the page.</p>'
        : '<h3>Registration forms</h3>') + '</div></div>';
      h += '<div class="fb-create">' +
        '<button type="button" class="fb-btn fb-btn-primary" data-fb-act="create-blank" data-fk="create-blank"' + (full || busy ? ' disabled' : '') + (full ? ' title="' + esc(fullNote) + '"' : '') + '>' + svg(IC.plus, 14) + ' Create custom form</button>' +
        '<span class="fb-menu-wrap"><button type="button" class="fb-btn" data-fb-act="menu" data-menu="tpl" data-fk="menu-tpl" aria-haspopup="true" aria-expanded="' + (menuOpen === 'tpl') + '"' + (full || busy || !templates().length ? ' disabled' : '') + '>From template ' + svg(IC.caret, 13) + '</button>' +
        (menuOpen === 'tpl' ? templateMenuHtml() : '') + '</span>' +
        '</div>';
      if (full) h += '<p class="fb-note">' + esc(fullNote) + '</p>';
      if (alertText) h += '<p class="fb-alert" role="alert">' + esc(alertText) + '</p>';
      if (data.materialized === false) h += '<p class="fb-note">Your registration form was set up from this event’s original settings.</p>';
      if (!list.length) h += '<p class="fb-note">No forms yet. Create one, or start from a template.</p>';
      h += '<ol class="fb-forms" aria-label="Forms, in order">';
      list.forEach(function (f, i) { h += rowHtml(f, i, list.length); });
      h += '</ol></div>';
      return h;
    }
    function templateMenuHtml() {
      return '<div class="fb-menu" role="menu" aria-label="Start from a template">' + templates().filter(function (t) { return templateId(t) !== 'blank'; }).map(function (t) {
        var f = templateForm(t);
        return '<button type="button" role="menuitem" data-fb-act="from-template" data-tpl="' + esc(templateId(t)) + '"><b>' + esc(f.name) + '</b><span>' + esc(describeTemplate(t)) + '</span></button>';
      }).join('') + '</div>';
    }
    function usageLine(f) {
      if (typeof o.usage !== 'function') return '';
      var u = null;
      try { u = o.usage(f.id); } catch (e) { u = null; }
      if (!u) return '';
      if (!u.buttons && !u.embeds) return '<span class="fb-usage is-none">Not on the page</span>';
      var bits = [];
      if (u.buttons) bits.push('Used by ' + plural(u.buttons, 'button'));
      if (u.embeds) bits.push(u.embeds + ' on page');
      return '<span class="fb-usage">' + esc(bits.join(' · ')) + '</span>';
    }
    function rowHtml(f, i, n) {
      var isDefault = f.id === defaultId(), name = esc(f.name);
      var responses = +f.submissions || 0, pending = +f.pending || 0;
      var link = 'audience-registrations.html?event=' + encodeURIComponent(eventId) + '&form=' + encodeURIComponent(f.id);
      var flags = [];
      if (f.countsAsRegistration) flags.push('<span class="fb-flag">Counts as registration</span>');
      if (f.needsApproval) flags.push('<span class="fb-flag">Needs approval</span>');
      if (f.open === false) flags.push('<span class="fb-flag is-closed">Closed</span>');
      var actions = (o.actions || []);
      var full = forms().length >= limits().maxForms;
      /* wide: every action is a button of its own; compact (the editor's narrow panel): Edit and the first
         extra action are, the rest are under "More" */
      function act(cls, a, label, extra, disabledWhy, extraAttrs) {
        return '<button type="button" ' + cls + ' data-fb-act="' + a + '" data-id="' + esc(f.id) + '"' + (extra ? ' data-extra="' + esc(extra) + '"' : '') +
          ' data-fk="' + a + (extra ? '-' + esc(extra) : '') + '-' + esc(f.id) + '"' + (extraAttrs || '') +
          (disabledWhy ? ' disabled title="' + esc(disabledWhy) + '"' : busy ? ' disabled' : '') + '>' + esc(label) + '</button>';
      }
      var dupWhy = full ? 'An event can have up to ' + limits().maxForms + ' forms.' : '';
      var defWhy = isDefault ? 'This is the default form already.' : '';
      var delWhy = isDefault ? 'Make another form the default first.' : '';
      var inline = [], more = [];
      if (compact) {
        more.push(act('role="menuitem"', 'duplicate', 'Duplicate', '', dupWhy));
        more.push(act('role="menuitem"', 'make-default', 'Make default', '', defWhy));
        actions.slice(1).forEach(function (a) { more.push(act('role="menuitem"', 'extra', a.label, a.id, '')); });
        more.push(act('role="menuitem" class="fb-danger"', 'delete', 'Delete', '', ''));
      } else {
        actions.forEach(function (a) { inline.push(act('class="fb-btn fb-btn-sm"', 'extra', a.label, a.id, '')); });
        inline.push(act('class="fb-btn fb-btn-sm"', 'duplicate', 'Duplicate', '', dupWhy, ' aria-label="Duplicate ' + name + '"'));
        inline.push(act('class="fb-btn fb-btn-sm"', 'make-default', 'Make default', '', defWhy, ' aria-label="Make ' + name + ' the default form"'));
        inline.push(act('class="fb-btn fb-btn-sm fb-btn-danger-ghost"', 'delete', 'Delete', '', delWhy, ' aria-label="Delete ' + name + '"'));
      }
      var menuKey = 'row:' + f.id;
      return '<li class="fb-row" data-id="' + esc(f.id) + '">' +
        '<span class="fb-grip" data-fb-grip="form" title="Drag to reorder" aria-hidden="true">' + svg(IC.grip, 16) + '</span>' +
        '<div class="fb-row-main">' +
          '<div class="fb-row-name"><b>' + name + '</b>' + (isDefault ? ' <span class="fb-badge">Default</span>' : '') + '</div>' +
          '<div class="fb-row-meta">' + esc(purposeLabel(f.purpose)) + ' · ' + esc(plural(ownFields(f.fields).length, 'field')) + '</div>' +
          '<div class="fb-row-meta"><a href="' + esc(link) + '" class="fb-link">' + esc(plural(responses, 'response')) + (f.needsApproval || pending ? ' · ' + pending + ' awaiting approval' : '') + '</a></div>' +
          (flags.length ? '<div class="fb-flags">' + flags.join('') + '</div>' : '') +
          usageLine(f) +
        '</div>' +
        '<div class="fb-row-acts">' +
          '<button type="button" class="fb-btn fb-btn-sm" data-fb-act="edit" data-id="' + esc(f.id) + '" data-fk="edit-' + esc(f.id) + '" aria-label="Edit ' + name + '"' + (busy ? ' disabled' : '') + '>Edit</button>' +
          (compact && actions[0] ? act('class="fb-btn fb-btn-sm"', 'extra', actions[0].label, actions[0].id, '') : '') +
          inline.join('') +
          '<button type="button" class="fb-icon" data-fb-act="form-up" data-id="' + esc(f.id) + '" data-fk="up-' + esc(f.id) + '" aria-label="Move ' + name + ' up" title="Move up"' + (i === 0 || busy ? ' disabled' : '') + '>' + svg(IC.up, 14) + '</button>' +
          '<button type="button" class="fb-icon" data-fb-act="form-down" data-id="' + esc(f.id) + '" data-fk="down-' + esc(f.id) + '" aria-label="Move ' + name + ' down" title="Move down"' + (i === n - 1 || busy ? ' disabled' : '') + '>' + svg(IC.down, 14) + '</button>' +
          (compact ? '<span class="fb-menu-wrap"><button type="button" class="fb-icon" data-fb-act="menu" data-menu="' + esc(menuKey) + '" data-fk="menu-' + esc(f.id) + '" aria-haspopup="true" aria-expanded="' + (menuOpen === menuKey) + '" aria-label="More for ' + name + '" title="More"' + (busy ? ' disabled' : '') + '>' + svg(IC.more, 15) + '</button>' +
          (menuOpen === menuKey ? '<div class="fb-menu fb-menu-right" role="menu">' + more.join('') + '</div>' : '') + '</span>' : '') +
        '</div>' +
      '</li>';
    }

    /* ---------- the form being edited ---------- */
    function errFor(key, field, option) {
      for (var i = 0; i < errors.length; i++) {
        var e = errors[i];
        if (e.key === key && (field == null ? e.field == null : e.field === field) && (option == null ? e.option == null : e.option === option)) return e.msg;
      }
      return '';
    }
    function ctlId(name) { return 'fb' + uid + '-' + name; }
    function errHtml(id, msg) { return '<p class="fb-err" id="' + id + '-err"' + (msg ? '' : ' hidden') + '>' + esc(msg) + '</p>'; }
    function textCtl(key, label, value, max, hint, multiline) {
      var id = ctlId(key), msg = errFor(key);
      var describe = [hint ? id + '-hint' : '', msg ? id + '-err' : ''].filter(Boolean).join(' ');
      var attrs = ' id="' + id + '" data-fb-k="' + key + '" data-fk="k-' + key + '" maxlength="' + max + '"' + (describe ? ' aria-describedby="' + describe + '"' : '') + (msg ? ' aria-invalid="true"' : '');
      return '<div class="fb-ctl"><label for="' + id + '">' + esc(label) + '</label>' +
        (multiline ? '<textarea rows="3"' + attrs + '>' + esc(value) + '</textarea>' : '<input type="text"' + attrs + ' value="' + esc(value) + '">') +
        (hint ? '<span class="fb-hint" id="' + id + '-hint">' + esc(hint) + '</span>' : '') + errHtml(id, msg) + '</div>';
    }
    function switchCtl(key, label, on, help) {
      var id = ctlId(key);
      return '<div class="fb-switch-row"><label class="fb-switch" for="' + id + '"><input type="checkbox" role="switch" id="' + id + '" data-fb-k="' + key + '" data-fk="k-' + key + '"' + (on ? ' checked' : '') + (help ? ' aria-describedby="' + id + '-hint"' : '') + '><span class="fb-track" aria-hidden="true"></span><span class="fb-switch-l">' + esc(label) + '</span></label>' +
        (help ? '<span class="fb-hint" id="' + id + '-hint">' + esc(help) + '</span>' : '') + '</div>';
    }

    function formHtml() {
      var d = draft, lim = limits(), isDirty = dirty();
      var title = isNew ? 'New form' : (str(base && base.name) || 'Form');
      var h = '<div class="fb-form-view">';
      h += '<div class="fb-bar">' +
        '<button type="button" class="fb-btn fb-btn-ghost fb-btn-sm" data-fb-act="back" data-fk="back">' + svg(IC.back, 14) + ' All forms</button>' +
        '<span class="fb-bar-t" title="' + esc(title) + '">' + esc(title) + '</span>' +
        '<span class="fb-dirty' + (isDirty ? ' is-on' : '') + '" role="status">' + (isDirty ? (isNew ? 'Not saved yet' : 'Unsaved changes') : (savedFlash ? 'Saved' : '')) + '</span>' +
        '<span class="fb-bar-acts">' +
          (!isNew ? '<button type="button" class="fb-btn fb-btn-sm" data-fb-act="discard" data-fk="discard"' + (isDirty && !busy ? '' : ' disabled') + '>Discard changes</button>' : '') +
          '<button type="button" class="fb-btn fb-btn-primary fb-btn-sm" data-fb-act="save" data-fk="save"' + ((isDirty || isNew) && !busy ? '' : ' disabled') + '>' + (busy ? 'Saving…' : 'Save form') + '</button>' +
        '</span></div>';
      if (alertText) h += '<p class="fb-alert" role="alert">' + esc(alertText) + '</p>';
      h += '<div class="fb-notes">' +
        (data.published ? '<p class="fb-note">Saved changes to this form appear on the published site within a minute. Which buttons open it is published with the site.</p>' : '') +
        (compact ? '<p class="fb-note">A saved form is stored with the event, not with the page, so the editor’s Undo does not change it.</p>' : '') + '</div>';
      if (compact) h += '<button type="button" class="fb-btn fb-btn-sm fb-prev-toggle" data-fb-act="toggle-preview" data-fk="toggle-preview" aria-expanded="' + showPreview + '" aria-controls="' + ctlId('preview') + '">' + (showPreview ? 'Hide preview' : 'Preview') + '</button>';
      h += '<div class="fb-cols' + (showPreview ? ' has-preview' : '') + '"><div class="fb-main">';

      /* about */
      h += '<section class="fb-sec" aria-labelledby="' + ctlId('s1') + '"><h4 id="' + ctlId('s1') + '">About this form</h4>' +
        textCtl('name', 'Name', d.name, MAX.name, 'Shown to you and in ‘Opens form’') +
        '<div class="fb-ctl"><label for="' + ctlId('purpose') + '">Purpose</label><select id="' + ctlId('purpose') + '" data-fb-k="purpose" data-fk="k-purpose">' +
          purposeChoices().map(function (p) { return '<option value="' + esc(p.value) + '"' + (p.value === d.purpose ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') +
        '</select></div>' +
        textCtl('title', 'Heading visitors see', d.title, MAX.title, 'Leave empty to show the name.') +
        textCtl('intro', 'Intro', d.intro, MAX.intro, 'A line or two above the fields.', true) +
        (!isNew && formId ? '<p class="fb-hint">Form id: <code>' + esc(formId) + '</code></p>' : '') +
        '</section>';

      /* fields */
      var nFields = d.fields.length, fullFields = nFields >= lim.maxFields;
      h += '<section class="fb-sec" aria-labelledby="' + ctlId('s2') + '"><h4 id="' + ctlId('s2') + '">Fields <span class="fb-count">' + nFields + ' of up to ' + lim.maxFields + '</span></h4>';
      h += '<ol class="fb-fields" aria-label="Fields, in order">' + d.fields.map(function (f, i) { return fieldHtml(f, i, nFields); }).join('') + '</ol>';
      h += consentHtml(data && data.consent, ctlId('consent'));
      h += '<div class="fb-add"><span class="fb-menu-wrap"><button type="button" class="fb-btn" data-fb-act="menu" data-menu="add" data-fk="menu-add" aria-haspopup="true" aria-expanded="' + (menuOpen === 'add') + '"' + (fullFields ? ' disabled' : '') + '>' + svg(IC.plus, 14) + ' Add field</button>' +
        (menuOpen === 'add' ? addMenuHtml() : '') + '</span>' +
        (fullFields ? '<span class="fb-hint">A form can have up to ' + lim.maxFields + ' fields.</span>' : '') + '</div>' +
        errHtml(ctlId('fields'), errFor('fields'));
      h += '</section>';

      /* after submitting */
      h += '<section class="fb-sec" aria-labelledby="' + ctlId('s3') + '"><h4 id="' + ctlId('s3') + '">Submitting</h4>' +
        textCtl('submitLabel', 'Submit button label', d.submitLabel, MAX.submitLabel) +
        textCtl('successMessage', 'Success message', d.successMessage, MAX.successMessage, 'What visitors read once they have submitted.', true) +
        switchCtl('countsAsRegistration', 'Counts as a registration', d.countsAsRegistration, 'Counts towards registrations and capacity. Turn off for enquiries such as ‘Join as partner’.') +
        switchCtl('needsApproval', 'Needs approval', d.needsApproval, 'Responses wait in Reporting until you approve or decline them.') +
        switchCtl('open', 'Accept responses', d.open !== false, 'Turn off to stop this form taking responses. The site then says it is closed.') +
        switchCtl('oneResponse', 'One response per email', d.duplicates !== 'allow', 'A second response from the same email address to this form is refused.') +
        '</section>';

      if (!isNew) h += '<section class="fb-sec fb-danger-zone"><button type="button" class="fb-btn fb-btn-danger fb-btn-sm" data-fb-act="delete" data-id="' + esc(formId) + '">Delete this form</button></section>';
      h += '</div>';

      /* preview */
      h += '<aside class="fb-preview" id="' + ctlId('preview') + '" aria-label="Preview"' + (showPreview ? '' : ' hidden') + '><h4>Preview</h4><div class="fb-preview-host"></div></aside>';
      h += '</div></div>';
      return h;
    }

    function addMenuHtml() {
      var have = {};
      draft.fields.forEach(function (f) { if (f.id) have[f.id] = 1; });
      var presets = (data.presets || []).filter(function (p) { return p && p.field && p.field.label; });
      return '<div class="fb-menu fb-menu-wide" role="menu" aria-label="Add a field">' +
        (presets.length ? '<span class="fb-menu-h">Quick picks</span>' + presets.map(function (p) {
          var taken = p.field.id && have[p.field.id];
          return '<button type="button" role="menuitem" data-fb-act="add-preset" data-preset="' + esc(p.presetId) + '"' + (taken ? ' disabled title="Already in this form"' : '') + '><b>' + esc(p.label || p.field.label) + '</b><span>' + esc(taken ? 'Already in this form' : typeLabel(p.field.type)) + '</span></button>';
        }).join('') : '') +
        '<span class="fb-menu-h">Blank field of type…</span>' + fieldTypes().map(function (t) {
          return '<button type="button" role="menuitem" data-fb-act="add-type" data-type="' + esc(t.type) + '"><b>' + esc(t.label) + '</b></button>';
        }).join('') + '</div>';
    }

    function fieldHtml(f, i, n) {
      var locked = !!(f.id && LOCKED[f.id]), mapped = !!(f.id && MAPPED_TYPES[f.id]);
      var open = expanded === i, label = str(f.label).trim() || 'Untitled field';
      var fid = ctlId('f' + i), hasErr = errors.some(function (e) { return e.field === i; });
      var h = '<li class="fb-field' + (open ? ' is-open' : '') + (hasErr ? ' has-err' : '') + '" data-i="' + i + '">';
      h += '<div class="fb-frow">' +
        '<span class="fb-grip" data-fb-grip="field" title="Drag to reorder" aria-hidden="true">' + svg(IC.grip, 15) + '</span>' +
        '<button type="button" class="fb-fname" data-fb-act="toggle-field" data-fk="tf-' + i + '" aria-expanded="' + open + '" aria-controls="' + fid + '-ed">' +
          '<span class="fb-fname-l">' + esc(label) + '</span>' +
          '<span class="fb-type">' + esc(typeLabel(f.type)) + '</span>' +
        '</button>' +
        '<label class="fb-req"' + (locked ? ' title="' + LOCK_NOTE + '"' : '') + '><input type="checkbox" data-fb-k="required" data-fk="rq-' + i + '" aria-label="' + esc(label) + ' is required"' + (f.required ? ' checked' : '') + (locked ? ' disabled aria-describedby="' + fid + '-lock"' : '') + '> Required' +
          (locked ? '<span class="fb-lock" id="' + fid + '-lock" title="' + LOCK_NOTE + '">' + svg(IC.lock, 12) + '<span class="fb-lock-t">' + LOCK_BADGE + '</span><span class="fb-sr">: ' + LOCK_NOTE + '</span></span>' : '') + '</label>' +
        '<span class="fb-frow-acts">' +
          '<button type="button" class="fb-icon" data-fb-act="field-up" data-fk="fu-' + i + '" aria-label="Move ' + esc(label) + ' up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>' + svg(IC.up, 13) + '</button>' +
          '<button type="button" class="fb-icon" data-fb-act="field-down" data-fk="fd-' + i + '" aria-label="Move ' + esc(label) + ' down" title="Move down"' + (i === n - 1 ? ' disabled' : '') + '>' + svg(IC.down, 13) + '</button>' +
          (locked ? '<span class="fb-icon-gap" aria-hidden="true"></span>' : '<button type="button" class="fb-icon fb-danger" data-fb-act="field-del" data-fk="fx-' + i + '" aria-label="Delete ' + esc(label) + '" title="Delete">' + svg(IC.trash, 13) + '</button>') +
        '</span></div>';
      if (open) h += fieldEditorHtml(f, i, fid, locked, mapped);
      else if (hasErr) h += '<p class="fb-err">' + esc(errors.filter(function (e) { return e.field === i; })[0].msg) + '</p>';
      return h + '</li>';
    }

    function fieldEditorHtml(f, i, fid, locked, mapped) {
      var labelErr = errFor('label', i), optsErr = errFor('options', i), typeErr = errFor('type', i);
      var h = '<div class="fb-fedit" id="' + fid + '-ed">';
      h += '<div class="fb-ctl"><label for="' + fid + '-label">Label</label><input type="text" id="' + fid + '-label" data-fb-k="label" data-fk="fl-' + i + '" maxlength="' + MAX.label + '" value="' + esc(f.label) + '"' + (labelErr ? ' aria-invalid="true" aria-describedby="' + fid + '-label-err"' : '') + '>' + errHtml(fid + '-label', labelErr) + '</div>';
      var typeNote = locked ? LOCK_NOTE + ', so this field’s type is fixed.' : mapped ? 'Answers go into the ' + MAPPED_COLUMN[f.id] + ' column of Reporting, so this field’s type is fixed.' : '';
      h += '<div class="fb-ctl"><label for="' + fid + '-type">Type</label><select id="' + fid + '-type" data-fb-k="type" data-fk="ft-' + i + '"' + (mapped ? ' disabled aria-describedby="' + fid + '-type-hint"' : '') + '>' +
        fieldTypes().map(function (t) { return '<option value="' + esc(t.type) + '"' + (t.type === f.type ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') +
        (fieldTypes().some(function (t) { return t.type === f.type; }) ? '' : '<option value="' + esc(f.type) + '" selected>' + esc(f.type) + '</option>') +
        '</select>' + (typeNote ? '<span class="fb-hint" id="' + fid + '-type-hint">' + esc(typeNote) + '</span>' : '') + errHtml(fid + '-type', typeErr) + '</div>';
      if (TEXT_LIKE[f.type]) {
        h += '<div class="fb-ctl"><label for="' + fid + '-ph">Placeholder</label><input type="text" id="' + fid + '-ph" data-fb-k="placeholder" data-fk="fp-' + i + '" maxlength="' + MAX.placeholder + '" value="' + esc(f.placeholder) + '"><span class="fb-hint">Light text in the empty box, as an example. Optional.</span></div>';
      }
      h += '<div class="fb-ctl"><label for="' + fid + '-help">Help text</label><input type="text" id="' + fid + '-help" data-fb-k="help" data-fk="fh-' + i + '" maxlength="' + MAX.help + '" value="' + esc(f.help) + '"><span class="fb-hint">Shown under the field. Optional.</span></div>';
      if (f.type === 'textarea') {
        var mwErr = errFor('maxWords', i), mwv = f.maxWords == null ? '' : str(f.maxWords);
        h += '<div class="fb-ctl"><label for="' + fid + '-mw">Word limit</label><input type="number" inputmode="numeric" min="' + WORDS.min + '" max="' + WORDS.max + '" step="1" id="' + fid + '-mw" data-fb-k="maxWords" data-fk="fw-' + i + '" value="' + esc(mwv) + '"' +
          (mwErr ? ' aria-invalid="true" aria-describedby="' + fid + '-mw-err"' : '') + '><span class="fb-hint">Visitors see the words counted as they type, and cannot send more. Leave empty for no limit.</span>' + errHtml(fid + '-mw', mwErr) + '</div>';
      }
      var cond = conditionOf(f, draft ? ownFields(draft.fields) : []);
      if (cond) {
        var on = (draft ? ownFields(draft.fields) : []).filter(function (x) { return x.id === cond.field; })[0];
        h += '<div class="fb-ctl"><label class="fb-req"><input type="checkbox" data-fb-k="requiredWhen" data-fk="fc-' + i + '" checked> Required only when “' + esc(on ? str(on.label).trim() || cond.field : cond.field) + '” is “' + esc(cond.equals) + '”</label>' +
          '<span class="fb-hint">Untick to make it optional for everyone. Ticking “Required” makes it required for everyone.</span></div>';
      }
      if (OPTION_TYPES[f.type]) h += optionsHtml(f, i, fid, optsErr);
      if (f.type === 'country') h += '<p class="fb-hint">Visitors choose from a list of ' + ((data.countries || []).length || 'all') + ' countries, India first.</p>';
      if (f.type === 'phone') h += '<p class="fb-hint">Visitors choose their country code (it starts on the country they are in) and type their number. It is checked for that country (in India: 10 digits, starting 6–9) and kept in international form, like +91 98765 43210.</p>';
      if (f.type === 'location') h += '<p class="fb-hint">As visitors type, cities are suggested as “City, State, Country” (e.g. “Noida, Uttar Pradesh, India”). They can also type a place that is not listed: Reporting marks it as not verified.</p>';
      h += '<details class="fb-adv"><summary>Advanced</summary><p class="fb-hint">Field id: ' + (f.id ? '<code>' + esc(f.id) + '</code> (it never changes, so Reporting keeps each answer under it)' : 'given when you save the form, from its label') + '</p></details>';
      return h + '</div>';
    }

    function optionsHtml(f, i, fid, optsErr) {
      var opts = f.options || [], lim = limits(), full = opts.length >= lim.maxOptions;
      var h = '<fieldset class="fb-opts"><legend>Options</legend><ol class="fb-opt-list">';
      opts.forEach(function (op, oi) {
        var err = errFor('option', i, oi);
        h += '<li class="fb-opt' + (err ? ' has-err' : '') + '" data-oi="' + oi + '">' +
          '<input type="text" data-fb-k="option" data-fk="o-' + i + '-' + oi + '" maxlength="' + MAX.option + '" value="' + esc(op) + '" aria-label="Option ' + (oi + 1) + '"' + (err ? ' aria-invalid="true"' : '') + '>' +
          '<button type="button" class="fb-icon" data-fb-act="opt-up" data-fk="ou-' + i + '-' + oi + '" aria-label="Move option ' + (oi + 1) + ' up"' + (oi === 0 ? ' disabled' : '') + '>' + svg(IC.up, 12) + '</button>' +
          '<button type="button" class="fb-icon" data-fb-act="opt-down" data-fk="od-' + i + '-' + oi + '" aria-label="Move option ' + (oi + 1) + ' down"' + (oi === opts.length - 1 ? ' disabled' : '') + '>' + svg(IC.down, 12) + '</button>' +
          '<button type="button" class="fb-icon fb-danger" data-fb-act="opt-del" data-fk="ox-' + i + '-' + oi + '" aria-label="Remove option ' + (oi + 1) + '">' + svg(IC.x, 12) + '</button>' +
          (err ? '<p class="fb-err">' + esc(err) + '</p>' : '') + '</li>';
      });
      h += '</ol>';
      h += '<div class="fb-opt-acts"><button type="button" class="fb-btn fb-btn-sm" data-fb-act="opt-add" data-fk="oa-' + i + '"' + (full ? ' disabled' : '') + '>' + svg(IC.plus, 12) + ' Add option</button>' +
        '<button type="button" class="fb-btn fb-btn-sm fb-btn-ghost" data-fb-act="opt-paste" data-fk="op-' + i + '" aria-expanded="' + (pasteOpen === i) + '"' + (full ? ' disabled' : '') + '>Paste a list</button></div>';
      if (full) h += '<span class="fb-hint">A field can have up to ' + lim.maxOptions + ' options.</span>';
      if (pasteOpen === i) {
        h += '<div class="fb-paste"><label for="' + fid + '-paste">One option per line</label><textarea id="' + fid + '-paste" rows="5" data-fk="pt-' + i + '"></textarea>' +
          '<div class="fb-opt-acts"><button type="button" class="fb-btn fb-btn-sm fb-btn-primary" data-fb-act="paste-add">Add these</button><button type="button" class="fb-btn fb-btn-sm" data-fb-act="paste-cancel">Cancel</button></div></div>';
      }
      h += errHtml(fid + '-opts', optsErr);
      return h + '</fieldset>';
    }

    /* ---------- the preview ---------- */
    function previewNow() {
      if (view !== 'form' || !draft) return null;
      return previewForm(draft, isNew ? null : formId, data && data.countries, data && data.consent);
    }
    function schedulePreview(now) {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(drawPreview, now ? 0 : 150);
    }
    function drawPreview() {
      if (destroyed || view !== 'form') return;
      var pf = previewNow();
      if (typeof o.onDraft === 'function' && pf) { try { o.onDraft(pf); } catch (e) { if (window.console) console.error(e); } }
      var host = root.querySelector('.fb-preview-host');
      if (!host || !showPreview) return;
      if (previewCtl && previewCtl.destroy) { try { previewCtl.destroy(); } catch (e) { /* already gone */ } }
      previewCtl = null;
      host.textContent = '';
      var RF = window.RevampForms;
      if (RF && typeof RF.render === 'function') {
        try {
          if (RF.ensureStyles) RF.ensureStyles(document, {});
          previewCtl = RF.render(pf, host, { mode: 'editor-preview', showTitle: true });
          return;
        } catch (e) { if (window.console) console.error('[forms-builder] preview', e); host.textContent = ''; }
      }
      host.appendChild(plainPreview(pf));
    }
    /* without the form runtime: what the form asks, as a list */
    function plainPreview(pf) {
      var wrap = document.createElement('div');
      wrap.className = 'fb-plain';
      var t = document.createElement('b');
      t.textContent = pf.title || pf.name;
      wrap.appendChild(t);
      var ul = document.createElement('ul');
      pf.fields.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = (f.label || 'Untitled field') + ' · ' + typeLabel(f.type) + (f.required ? ' · Required' : '');
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      var s = document.createElement('span');
      s.className = 'fb-hint';
      s.textContent = 'Button: ' + pf.submitLabel;
      wrap.appendChild(s);
      return wrap;
    }

    /* ---------- moving between the list and a form ---------- */
    function confirmLeave() {
      if (!dirty()) return Promise.resolve(true);
      return ask({
        title: isNew ? 'Save this new form?' : 'Save your changes to “' + str(base && base.name) + '”?',
        body: isNew ? 'It is not saved yet. If you leave without saving, it is lost.' : 'You have changes to this form that are not saved yet. If you leave without saving, they are lost.',
        buttons: [{ label: 'Keep editing', value: 'stay' }, { label: 'Discard', value: 'drop', kind: 'danger' }, { label: 'Save', value: 'save', kind: 'primary' }]
      }).then(function (v) {
        if (v === 'drop') return true;
        if (v === 'save') return save().then(function () { return true; }, function () { return false; });
        return false;
      });
    }
    function openEditor(f, asNew) {
      view = 'form';
      isNew = !!asNew;
      formId = asNew ? null : f.id;
      base = asNew ? null : clone(f);
      draft = asNew ? f : draftOf(f);
      if (!asNew) draft.template = f.template || draft.template;
      expanded = -1; errors = []; alertText = ''; savedFlash = false; menuOpen = null; pasteOpen = -1;
      render();
      var first = root.querySelector('[data-fk="k-name"]');
      if (first) focusEl(first);
    }
    function toList() {
      view = 'list'; formId = null; base = null; draft = null; isNew = false; errors = []; alertText = ''; menuOpen = null;
      if (previewCtl && previewCtl.destroy) { try { previewCtl.destroy(); } catch (e) { /* gone */ } }
      previewCtl = null;
      clearTimeout(previewTimer);
      // no form is being edited any more: what the host drew from the draft goes back to the saved form
      if (typeof o.onDraft === 'function') { try { o.onDraft(null); } catch (e) { if (window.console) console.error(e); } }
      render();
    }
    function startNew(t) {
      var f = templateForm(t || {});
      if (!t) {
        var blank = templates().filter(function (x) { return templateId(x) === 'blank'; })[0];
        if (blank) f = templateForm(blank);
        else f = { name: '', title: '', intro: '', purpose: 'custom', fields: [], submitLabel: 'Submit', successMessage: 'Thank you. Your response has been received.', countsAsRegistration: false, needsApproval: false, open: true, duplicates: 'reject', template: 'blank' };
        f.name = ''; f.title = '';
      }
      // every form asks for an email address: a template that somehow lacks it gets it back
      if (!f.fields.some(function (x) { return x.id === 'email'; })) f.fields.unshift({ id: 'email', type: 'email', label: 'Email', required: true, placeholder: '', help: '' });
      openEditor(f, true);
    }

    /* ---------- saving ---------- */
    function showErrors(list) {
      errors = list;
      var firstField = list.filter(function (e) { return e.field != null; })[0];
      if (firstField && !list.some(function (e) { return e.field == null; })) expanded = firstField.field;
      else if (firstField && expanded === -1) expanded = firstField.field;
      render();
      var bad = root.querySelector('[aria-invalid="true"]') || root.querySelector('.fb-err:not([hidden])');
      if (bad) {
        focusEl(bad, true);
      }
    }
    function save(ifUpdatedAt) {
      if (view !== 'form' || !draft) return Promise.resolve();
      if (busy) return Promise.reject(new Error('A save is already under way.'));
      var problems = validateDraft(draft, limits(), otherNames());
      if (problems.length) {
        alertText = problems.length === 1 ? 'One thing to put right before saving.' : problems.length + ' things to put right before saving.';
        showErrors(problems);
        return Promise.reject({ invalid: true });
      }
      var input = formInput(draft);
      busy = true; errors = []; alertText = '';
      render();
      var req = isNew ? C.createForm(eventId, { form: input })
        : C.updateForm(eventId, formId, input, ifUpdatedAt || (base && base.updatedAt));
      var wasNew = isNew;
      return req.then(function (res) {
        busy = false;
        var saved = (res && res.form) || null;
        if (!saved) throw new Error('The server did not send the form back.');
        base = clone(saved); formId = saved.id; isNew = false;
        // what was typed while the request was out stays as typed (and still counts as a change)
        if (JSON.stringify(formInput(draft)) === JSON.stringify(input)) {
          var keepExpanded = expanded;
          draft = draftOf(saved); draft.template = saved.template || draft.template;
          expanded = keepExpanded < draft.fields.length ? keepExpanded : -1;
        }
        savedFlash = true;
        toast(wasNew ? 'Form “' + saved.name + '” created.' : 'Form “' + saved.name + '” saved.');
        render();
        return changed();
      }, function (err) {
        busy = false;
        if (err && err.status === 409 && err.code === 'stale') { render(); return staleConflict(err); }
        if (err && err.status === 409 && err.code === 'limit') { alertText = errText(err, 'This form could not be created.'); render(); throw err; }
        var where = err && err.field ? serverFieldOf(err.field) : null;
        alertText = errText(err, wasNew ? 'The form could not be created.' : 'The form could not be saved.');
        if (where) {
          var e = { key: where.key, msg: err.message || 'Check this value.' };
          if (where.field != null) e.field = where.field;
          if (e.key === 'options' || e.key === 'label' || e.key === 'type') showErrors([e]);
          else if (where.field == null) showErrors([e]);
          else showErrors([{ key: 'label', field: where.field, msg: e.msg }]);
        } else render();
        throw err;
      });
    }
    function staleConflict(err) {
      return ask({
        title: 'Someone else changed this form',
        body: 'Someone else changed this form. Reload it to see their version.',
        buttons: [{ label: 'Reload', value: 'reload' }, { label: 'Keep mine', value: 'mine', kind: 'primary' }]
      }).then(function (v) {
        var theirs = err.form || null;
        if (v === 'mine') {
          if (theirs && theirs.updatedAt) return save(theirs.updatedAt);
          return load().then(function () { var f = formById(formId); return save(f && f.updatedAt); });
        }
        if (v === 'reload') {
          var apply = function (f) {
            if (!f) { toList(); return; }
            base = clone(f); draft = draftOf(f); errors = []; alertText = ''; expanded = -1;
            render();
          };
          if (theirs) { apply(theirs); return changed(); }
          return load().then(function () { apply(formById(formId)); });
        }
        throw err;
      });
    }
    function discard() {
      if (view !== 'form') return;
      if (isNew) { toList(); return; }
      draft = draftOf(base); draft.template = base.template || draft.template;
      errors = []; alertText = ''; expanded = -1;
      render();
    }

    /* ---------- list actions ---------- */
    function run(promise, okText, failText) {
      busy = true; alertText = ''; menuOpen = null;
      render();
      return promise.then(function (r) {
        busy = false;
        if (okText) toast(okText);
        return changed().then(function () { return r; });
      }, function (err) {
        busy = false;
        alertText = errText(err, failText);
        render();
        throw err;
      });
    }
    function reorder(ids) {
      var before = forms().slice();
      // shown in the new order at once; put back if the server refuses
      data.forms = ids.map(function (id) { return formById(id); }).filter(Boolean);
      render();
      return run(C.reorderForms(eventId, ids), '', 'The new order could not be saved.').then(null, function () {
        data.forms = before; render();
      });
    }
    function deleteFlow(f) {
      var u = null;
      if (typeof o.usage === 'function') { try { u = o.usage(f.id); } catch (e) { u = null; } }
      var onPage = u && (u.buttons || u.embeds);
      if (f.id === defaultId()) {
        return ask({ title: 'Delete “' + f.name + '”?', body: 'This is the default form: buttons that do not name a form open it. Make another form the default first.', buttons: [{ label: 'OK', value: null, kind: 'primary' }] });
      }
      var body = onPage
        ? (plural(u.buttons || 0, 'button') + ' and ' + plural(u.embeds || 0, 'embedded copy', 'embedded copies') + ' on this page use it. Delete anyway? Those buttons will open the default form instead and the embedded copies will be removed.')
        : 'Responses already sent with it stay in Reporting, under its name. This cannot be undone.';
      return ask({ title: 'Delete “' + f.name + '”?', body: body, buttons: [{ label: 'Cancel', value: null }, { label: 'Delete form', value: 'yes', kind: 'danger' }] })
        .then(function (v) {
          if (v !== 'yes') return;
          var first = onPage && typeof o.beforeDelete === 'function' ? Promise.resolve(o.beforeDelete(f, u)) : Promise.resolve();
          return first.then(function () { return removeForm(f, !!onPage); });
        });
    }
    function removeForm(f, force) {
      busy = true; alertText = ''; menuOpen = null; render();
      return C.deleteForm(eventId, f.id, { force: force }).then(function () {
        busy = false;
        if (view === 'form' && formId === f.id) toList();
        toast('Form “' + f.name + '” deleted.');
        return changed();
      }, function (err) {
        busy = false;
        render();
        if (err && err.status === 409 && err.code === 'form-in-use') {
          var n = Math.max(+err.saved || 0, +err.published || 0);
          return ask({
            title: '“' + f.name + '” is in use',
            body: 'The saved site uses this form in ' + plural(n, 'place') + '. Open the site editor to change those buttons first, or delete anyway: its buttons then open the default form, and where it sits in the page nothing is shown.',
            buttons: [{ label: 'Cancel', value: null }, { label: 'Delete anyway', value: 'force', kind: 'danger' }]
          }).then(function (v) { if (v === 'force') return removeForm(f, true); });
        }
        if (err && err.status === 409 && err.code === 'default-form') {
          return ask({ title: 'Delete “' + f.name + '”?', body: 'Make another form the default first.', buttons: [{ label: 'OK', value: null, kind: 'primary' }] });
        }
        alertText = errText(err, 'The form could not be deleted.');
        render();
      });
    }

    /* ---------- events ---------- */
    function fieldIndexOf(el) { var li = el.closest('.fb-field'); return li ? +li.getAttribute('data-i') : -1; }
    function optIndexOf(el) { var li = el.closest('.fb-opt'); return li ? +li.getAttribute('data-oi') : -1; }
    function afterEdit(structural) {
      if (errors.length) {
        // a mistake that has been put right stops being shown once the form is drawn again
        errors = validateDraft(draft, limits(), otherNames()).filter(function (e) { return errors.some(function (x) { return x.key === e.key && x.field === e.field && x.option === e.option; }); });
        if (!errors.length) alertText = '';
      }
      savedFlash = false;
      if (structural) render();
      else {
        var d = root.querySelector('.fb-dirty');
        if (d) { var on = dirty(); d.className = 'fb-dirty' + (on ? ' is-on' : ''); d.textContent = on ? (isNew ? 'Not saved yet' : 'Unsaved changes') : ''; }
        var sb = root.querySelector('[data-fb-act="save"]'); if (sb) sb.disabled = busy || !(dirty() || isNew);
        var db = root.querySelector('[data-fb-act="discard"]'); if (db) db.disabled = busy || !dirty();
      }
      schedulePreview();
    }

    /* a value marked wrong that is being corrected stops being shown as wrong */
    function clearMark(t) {
      if (t.getAttribute('aria-invalid') !== 'true') return;
      t.removeAttribute('aria-invalid');
      var box = t.closest('.fb-opt') || t.closest('.fb-ctl');
      var msg = box && box.querySelector('.fb-err');
      if (msg) msg.hidden = true;
    }
    function onInput(e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-fb-k');
      if (!k || view !== 'form' || !draft) return;
      clearMark(t);
      var i = fieldIndexOf(t);
      if (k === 'option') {
        draft.fields[i].options[optIndexOf(t)] = t.value;
        return afterEdit(false);
      }
      if (i >= 0) {
        var f = draft.fields[i];
        if (k === 'label') {
          f.label = t.value;
          var l = t.closest('.fb-field').querySelector('.fb-fname-l');
          if (l) l.textContent = t.value.trim() || 'Untitled field';
          // the row's controls are named after the field: they follow the new label
          var shown = t.value.trim() || 'Untitled field', row = t.closest('.fb-field');
          [['[data-fb-k="required"]', shown + ' is required'], ['[data-fb-act="field-up"]', 'Move ' + shown + ' up'],
            ['[data-fb-act="field-down"]', 'Move ' + shown + ' down'], ['[data-fb-act="field-del"]', 'Delete ' + shown]].forEach(function (p) {
            var c = row.querySelector(p[0]);
            if (c) c.setAttribute('aria-label', p[1]);
          });
        } else if (k === 'placeholder' || k === 'help') f[k] = t.value;
        else if (k === 'maxWords') f.maxWords = t.value.trim() === '' ? null : Number(t.value);
        else if (k === 'requiredWhen' && e.type === 'change') { if (!t.checked) delete f.requiredWhen; return afterEdit(true); }
        else if (k === 'required') { f.required = !!t.checked; if (f.required) delete f.requiredWhen; }
        else if (k === 'type' && e.type === 'change') {
          if (MAPPED_TYPES[f.id]) return;
          f.type = t.value;
          if (OPTION_TYPES[f.type]) { if (!f.options || !f.options.length) f.options = ['']; }
          else delete f.options;
          if (f.type !== 'textarea') delete f.maxWords;
          return afterEdit(true);
        }
        return afterEdit(false);
      }
      if (k === 'countsAsRegistration' || k === 'needsApproval' || k === 'open') draft[k] = !!t.checked;
      else if (k === 'oneResponse') draft.duplicates = t.checked ? 'reject' : 'allow';
      else if (k === 'purpose') draft.purpose = t.value;
      else draft[k] = t.value;
      afterEdit(false);
    }

    function addField(field) {
      var lim = limits();
      if (draft.fields.length >= lim.maxFields) return;
      var f = { type: field.type, label: str(field.label), required: !!field.required, placeholder: str(field.placeholder), help: str(field.help) };
      if (field.id) f.id = field.id;
      if (OPTION_TYPES[f.type]) f.options = (field.options && field.options.length ? field.options.slice() : ['']);
      draft.fields.push(f);
      expanded = draft.fields.length - 1;
      menuOpen = null;
      afterEdit(true);
      var input = root.querySelector('[data-fk="fl-' + expanded + '"]');
      if (input) { focusEl(input); if (!f.label) input.select(); }
    }

    function onClick(e) {
      var b = e.target.closest('[data-fb-act]');
      if (!b || !root.contains(b) || b.disabled) {
        if (menuOpen && !e.target.closest('.fb-menu-wrap')) { menuOpen = null; render(); }
        return;
      }
      var act = b.getAttribute('data-fb-act'), id = b.getAttribute('data-id');
      if (act !== 'menu' && menuOpen && !b.closest('.fb-menu')) { menuOpen = null; }
      if (act === 'retry') { loadError = null; render(); load(); return; }
      if (act === 'menu') {
        var m = b.getAttribute('data-menu');
        menuOpen = menuOpen === m ? null : m;
        render();
        var first = menuOpen && root.querySelector('.fb-menu button:not([disabled])');
        if (first) focusEl(first);
        return;
      }
      if (view === 'list') {
        var f = id ? formById(id) : null;
        if (act === 'create-blank') { startNew(null); return; }
        if (act === 'from-template') {
          var t = templates().filter(function (x) { return templateId(x) === b.getAttribute('data-tpl'); })[0];
          menuOpen = null;
          if (t) startNew(t);
          return;
        }
        if (!f && act !== 'from-template') return;
        if (act === 'edit') { openEditor(f, false); return; }
        if (act === 'duplicate') { run(C.createForm(eventId, { duplicateOf: f.id }), 'A copy of “' + f.name + '” was made.', 'The form could not be duplicated.'); return; }
        if (act === 'make-default') { run(C.setDefaultForm(eventId, f.id), '“' + f.name + '” is now the default form.', 'The default form could not be changed.'); return; }
        if (act === 'delete') { menuOpen = null; render(); deleteFlow(f); return; }
        if (act === 'extra') { menuOpen = null; render(); if (typeof o.onAction === 'function') o.onAction(b.getAttribute('data-extra'), f); return; }
        if (act === 'form-up' || act === 'form-down') {
          var ids = forms().map(function (x) { return x.id; }), at = ids.indexOf(f.id);
          if (moveItem(ids, at, at + (act === 'form-up' ? -1 : 1))) reorder(ids);
          return;
        }
        return;
      }
      /* the form view */
      var i = fieldIndexOf(b);
      if (act === 'back') { confirmLeave().then(function (go) { if (go) toList(); }); return; }
      if (act === 'save') { save().then(null, function () { /* shown on the form */ }); return; }
      if (act === 'discard') { discard(); return; }
      if (act === 'delete') { var cur = formById(formId); if (cur) deleteFlow(cur); return; }
      if (act === 'toggle-preview') { showPreview = !showPreview; render(); return; }
      if (act === 'toggle-field') { expanded = expanded === i ? -1 : i; pasteOpen = -1; render(); return; }
      if (act === 'field-up' || act === 'field-down') {
        var to = i + (act === 'field-up' ? -1 : 1);
        if (moveItem(draft.fields, i, to)) {
          if (expanded === i) expanded = to; else if (expanded === to) expanded = i;
          // the focus moves with the field
          var key = (act === 'field-up' ? 'fu-' : 'fd-') + to;
          afterEdit(true);
          var nb = root.querySelector('[data-fk="' + key + '"]');
          if (nb && !nb.disabled) focusEl(nb); else { nb = root.querySelector('[data-fk="tf-' + to + '"]'); if (nb) focusEl(nb); }
        }
        return;
      }
      if (act === 'field-del') {
        var gone = draft.fields[i];
        if (!gone || (gone.id && LOCKED[gone.id])) return;
        draft.fields.splice(i, 1);
        if (expanded === i) expanded = -1; else if (expanded > i) expanded--;
        afterEdit(true);
        toast('Field “' + (str(gone.label).trim() || 'Untitled field') + '” removed.' + (isNew ? '' : ' Discard changes brings it back until you save.'));
        var next = root.querySelector('[data-fk="tf-' + Math.min(i, draft.fields.length - 1) + '"]');
        if (next) focusEl(next);
        return;
      }
      if (act === 'add-preset') {
        var p = (data.presets || []).filter(function (x) { return x.presetId === b.getAttribute('data-preset'); })[0];
        if (p) addField(clone(p.field));
        return;
      }
      if (act === 'add-type') { addField({ type: b.getAttribute('data-type'), label: '', required: false }); return; }
      var opts = i >= 0 ? draft.fields[i].options : null;
      if (act === 'opt-add' && opts) {
        if (opts.length >= limits().maxOptions) return;
        opts.push('');
        afterEdit(true);
        var nIn = root.querySelector('[data-fk="o-' + i + '-' + (opts.length - 1) + '"]');
        if (nIn) focusEl(nIn);
        return;
      }
      if ((act === 'opt-up' || act === 'opt-down') && opts) {
        var oi = optIndexOf(b), oto = oi + (act === 'opt-up' ? -1 : 1);
        if (moveItem(opts, oi, oto)) {
          afterEdit(true);
          var ob = root.querySelector('[data-fk="' + (act === 'opt-up' ? 'ou-' : 'od-') + i + '-' + oto + '"]');
          if (ob && !ob.disabled) focusEl(ob);
        }
        return;
      }
      if (act === 'opt-del' && opts) { opts.splice(optIndexOf(b), 1); afterEdit(true); return; }
      if (act === 'opt-paste') { pasteOpen = pasteOpen === i ? -1 : i; render(); var ta = root.querySelector('[data-fk="pt-' + i + '"]'); if (ta) focusEl(ta); return; }
      if (act === 'paste-cancel') { pasteOpen = -1; render(); return; }
      if (act === 'paste-add') {
        var box = root.querySelector('[data-fk="pt-' + pasteOpen + '"]');
        var target = draft.fields[pasteOpen];
        if (box && target) {
          var kept = (target.options || []).filter(function (x) { return str(x).trim(); });
          var room = limits().maxOptions - kept.length;
          var added = parseOptionList(box.value, kept);
          target.options = kept.concat(added.slice(0, Math.max(0, room)));
          if (added.length > room) toast('Only the first ' + room + ' were added: a field can have up to ' + limits().maxOptions + ' options.');
        }
        pasteOpen = -1;
        afterEdit(true);
      }
    }

    function onKey(e) {
      if (e.key === 'Escape' && menuOpen) {
        e.stopPropagation();
        var m = menuOpen; menuOpen = null; render();
        var btn = root.querySelector('[data-menu="' + m.replace(/"/g, '') + '"]');
        if (btn) focusEl(btn);
        return;
      }
      if (menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        var items = Array.prototype.slice.call(root.querySelectorAll('.fb-menu button:not([disabled])'));
        if (!items.length) return;
        e.preventDefault();
        var at = items.indexOf(document.activeElement);
        focusEl(items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]);
      }
    }

    /* ---------- dragging (the grips); Move up / Move down are the keyboard's way ---------- */
    function onPointerDown(e) {
      var grip = e.target.closest('[data-fb-grip]');
      if (!grip || e.button || busy) return;
      var kind = grip.getAttribute('data-fb-grip');
      var row = grip.closest(kind === 'form' ? '.fb-row' : '.fb-field');
      var list = row && row.parentNode;
      if (!list) return;
      e.preventDefault();
      var rows = Array.prototype.slice.call(list.children);
      var from = rows.indexOf(row), startY = e.clientY, moved = false, to = from;
      var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
      var line = document.createElement('div');
      line.className = 'fb-drop-line';
      list.style.position = 'relative';
      list.appendChild(line);
      row.classList.add('is-dragging');
      /* where it lands: after every other row whose middle is above the pointer */
      function onMove(ev) {
        if (Math.abs(ev.clientY - startY) > 3) moved = true;
        row.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
        var above = -1;
        to = 0;
        for (var k = 0; k < rects.length; k++) {
          if (k === from) continue;
          if (ev.clientY > rects[k].top + rects[k].height / 2) { to++; above = k; }
        }
        var listTop = list.getBoundingClientRect().top;
        var first = from === 0 ? 1 : 0;
        line.style.top = (above === -1 ? (rects[first] ? rects[first].top : rects[from].top) - listTop - 2 : rects[above].bottom - listTop - 1) + 'px';
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        line.remove();
        row.classList.remove('is-dragging');
        row.style.transform = '';
        if (!moved || to === from) return;
        if (kind === 'form') {
          var ids = forms().map(function (x) { return x.id; });
          if (moveItem(ids, from, to)) reorder(ids);
        } else if (moveItem(draft.fields, from, to)) {
          if (expanded === from) expanded = to;
          else if (from < expanded && to >= expanded) expanded--;
          else if (from > expanded && to <= expanded && expanded >= 0) expanded++;
          afterEdit(true);
        }
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-fb-k');
      if (k === 'type' || k === 'required' || k === 'purpose' || e.target.type === 'checkbox') onInput(e);
    });
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onPointerDown);
    function onDocDown(e) {
      if (menuOpen && !(root.contains(e.target) && e.target.closest('.fb-menu-wrap'))) { menuOpen = null; render(); }
    }
    document.addEventListener('mousedown', onDocDown, true);
    // a menu placed against the window would be left behind by a scroll: it closes instead
    function onAnyScroll(e) {
      if (!menuOpen) return;
      var t = e.target;
      if (t && t.nodeType === 1 && t.closest('.fb-menu')) return;
      menuOpen = null;
      render();
    }
    document.addEventListener('scroll', onAnyScroll, true);
    /* back from another tab (the site editor's Forms panel, or the console): what was made or changed there is
       shown; a form open here with changes of its own keeps them (fetchOnce) */
    function onVisible() { if (document.visibilityState === 'visible' && data && !busy) load(); }
    document.addEventListener('visibilitychange', onVisible);

    render();
    load();

    return {
      reload: function () { return load(); },
      openForm: function (id) {
        function go() {
          var f = formById(id);
          if (!f) return false;
          if (view === 'form' && formId === id) return true;
          confirmLeave().then(function (ok) { if (ok) openEditor(f, false); });
          return true;
        }
        if (data) return Promise.resolve(go());
        return load().then(go);
      },
      /* the host's page changed (a form placed on it, a button linked): the list's "Used by …" lines are drawn again */
      redraw: function () { if (data && view === 'list' && !menuOpen) render(); },
      getForms: function () { return forms().slice(); },
      defaultFormId: defaultId,
      isDirty: dirty,
      save: function () { return save(); },
      discard: discard,
      destroy: function () {
        destroyed = true;
        clearTimeout(previewTimer);
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('scroll', onAnyScroll, true);
        document.removeEventListener('visibilitychange', onVisible);
        if (previewCtl && previewCtl.destroy) { try { previewCtl.destroy(); } catch (e) { /* gone */ } }
        root.remove();
      }
    };
  }
  mount.n = 0;

  window.RevampFormsBuilder = {
    mount: mount,
    _pure: {
      formInput: formInput, draftOf: draftOf, sameDraft: sameDraft, validateDraft: validateDraft, parseOptionList: parseOptionList,
      moveItem: moveItem, templateForm: templateForm, describeTemplate: describeTemplate, serverFieldOf: serverFieldOf,
      previewForm: previewForm, MAPPED_TYPES: MAPPED_TYPES, LOCKED: LOCKED, ownFields: ownFields, consentHtml: consentHtml, conditionOf: conditionOf
    }
  };
})();
