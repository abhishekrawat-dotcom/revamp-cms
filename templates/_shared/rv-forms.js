/* RevampForms — the forms of a published or previewed site: a "Register now", "Express interest", "VIP
   delegates"… form opened in a pop-up from a button, or drawn in place inside the page.

   Loaded by the page's runtime block (functions/lib/api.js publishTransform, after rv-popups.js), so only on
   /preview/…, the editor's live view and the live page. Plain ES5 in one IIFE, no dependencies. Everything it
   builds is made with createElement / textContent (never HTML from data) and is never saved with the page:
   pages are only ever saved from the editor's canvas, where this file does nothing.

   ---------------------------------------------------------------------------------------------------------
   Markers in the page (written by the editor and the AI; see the multi-form spec §1.5)
   ---------------------------------------------------------------------------------------------------------
     a[data-rv-form="<formId>"]           a click opens that form in a pop-up (href "#rv-form-<formId>")
     a[data-register-cta]                 without data-rv-form: opens the event's default form (href "#register");
                                          with it, the form named there wins
     div.rv-block-form[data-rv-form-embed="<formId>"]
                                          the form drawn in place. data-rv-form-title="hide" leaves out its title
                                          (the section around it has a heading); its [data-rv-form-fallback]
                                          paragraph is the no-JavaScript text, hidden once the form is drawn
     #register, #rv-form-<formId>         in the address: that form is opened on arrival and on hashchange —
                                          unless an element with that id exists (a plain jump), or the form is
                                          drawn on the page (it is scrolled to and its first field focused)
     html[data-rv-modal]                  set while a pop-up is open (shared with rv-popups.js and et-runtime.js)

   ---------------------------------------------------------------------------------------------------------
   Where the forms come from
   ---------------------------------------------------------------------------------------------------------
     <script id="rv-forms" type="application/json"> written at publish / preview (the public definition,
     spec §1.4), and GET /api/public/forms?eventId= — always on a live page (so a form edited after the site
     was published shows its new fields within the server's 30 s cache), elsewhere only when the block is
     missing. A form whose rev changed is drawn again where the visitor has not started typing.

   ---------------------------------------------------------------------------------------------------------
   Modes
   ---------------------------------------------------------------------------------------------------------
     html[data-rv-editing] / data-rv-editor-mode="manual"   the editor's canvas: nothing at all happens
     data-rv-editor-mode="ai"   the editor's live view: forms open and are drawn, but a submit only checks the
                                answers and says that sending is turned off there; nothing is sent
     #rv-site-config mode "preview"   a submit is sent with preview:true (checked, not stored)
     #rv-site-config mode "live"      a real submit to POST /api/register

   ---------------------------------------------------------------------------------------------------------
   API: window.RevampForms (version 1)
   ---------------------------------------------------------------------------------------------------------
     render(form, host, opts) -> { el, values(), setErrors({id: msg}), destroy() }
         form  a public form (spec §1.4 forms[i]) or a builder draft
         opts  { mode: 'live'|'preview'|'ai-view'|'editor-preview', showTitle (default true), eventId,
                 waitlist, onDone(result) }
         'editor-preview' draws the same form with every control disabled and out of the tab order, no
         listeners and no honeypot, under the line "Form preview — visitors fill this in on the published page".
     validate(form, values) -> { fieldId: message }     the server's rules and its exact messages (spec §1.2)
     cleanValue(field, value) -> { value } | { error }  one answer as the server would store it (used by tests)
     ensureStyles(doc, opts)    <style data-rv-forms-style> once in doc.head; opts.editor also marks it
                                data-rv-editor so the editor never saves it
     open(formId, opener) -> bool      the pop-up (pages where this file runs on its own only)
     definitions() -> the public forms payload, or null while there is none
   The editor and the console set window.RV_FORMS_NO_AUTO = true before loading this file and use render and
   validate only. */
(function () {
  'use strict';
  if (window.__rvForms) return;
  window.__rvForms = true;

  var VERSION = 1;

  /* ---------- the rules (spec §1.2): the same as the server's, so an error reads the same from both ---------- */
  var EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;.]{2,}$/;          // functions/lib/http.js
  var URL_RE = /^https?:\/\/[^\s<>"]+\.[^\s<>"]+/i;
  var SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;
  var MAPPED_MAX = { name: 120, company: 120, designation: 120, city: 80 };
  var MAXLEN = { text: 200, textarea: 2000, email: 200, phone: 40, number: 40, url: 500, date: 10 };
  var SHORT_TYPES = { text: 1, email: 1, phone: 1, number: 1, url: 1, date: 1, select: 1, country: 1 };
  var AUTOCOMPLETE = { name: 'name', email: 'email', phone: 'tel', company: 'organization', designation: 'organization-title', city: 'address-level2' };
  var MODES = { live: 1, preview: 1, 'ai-view': 1, 'editor-preview': 1 };
  var FORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

  var MSG = {
    preview: 'Form preview — visitors fill this in on the published page',
    closed: 'This form is not taking responses at the moment.',
    waitlist: 'This event is full. If you register now, you will join the waitlist.',
    sending: 'Sending…',
    offline: 'We could not send your details. Please check your connection and try again.',
    aiView: 'Submitting is turned off in the editor. Open Preview to test this form.',
    loading: 'Loading the form…',
    loadFailed: 'This form could not be loaded. Please check your connection and try again.',
    unavailable: 'This form is not available right now.',
    again: 'Fill in again',
    retry: 'Retry',
    close: 'Close',
    choose: 'Choose…',
    untitled: 'Untitled field',
    honeypot: 'Website'
  };

  function str(v) { return v == null ? '' : String(v); }
  /* one line: control characters and runs of space become one space (api-audience.js line()) */
  function line(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  /* several lines (api-audience.js multiline()) */
  function multiline(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  }
  function isPhone(v) {
    var d = v.replace(/\D/g, '');
    return /^\+?[\d\s().\-]{7,24}$/.test(v) && d.length >= 7 && d.length <= 15;
  }
  function labelOf(field) { return line(str(field && field.label), 200) || 'this field'; }
  function optionsOf(field) {
    return Array.isArray(field && field.options) ? field.options.map(function (o) { return str(o); }) : [];
  }
  function maxOf(field) {
    if (MAPPED_MAX[field.id] && field.type === 'text') return MAPPED_MAX[field.id];
    return MAXLEN[field.type] || 200;
  }
  function keyOf(field, i) { return field && field.id ? String(field.id) : 'field_' + (i + 1); }

  function requiredMessage(field) {
    var L = labelOf(field);
    if (field.id === 'name') return 'Please enter your name.';
    if (field.id === 'email') return 'Please enter your email address.';
    switch (field.type) {
      case 'checkbox': return 'Please tick ' + L + ' to continue.';
      case 'select': case 'radio': case 'country': return 'Please choose ' + L + '.';
      case 'multiselect': return 'Please choose at least one option for ' + L + '.';
      default: return 'Please fill in ' + L + '.';
    }
  }
  function notInList(field) { return 'Please choose one of the options for ' + labelOf(field) + '.'; }

  function realDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return false;
    return s >= '1900-01-01' && s <= '2100-12-31';
  }

  /* One answer as the server keeps it: { value } (value undefined when an optional answer is empty) or { error }. */
  function cleanValue(field, raw) {
    field = field || {};
    var req = !!field.required, type = field.type, s, opts;
    function empty() { return req ? { error: requiredMessage(field) } : { value: undefined, empty: true }; }
    switch (type) {
      case 'checkbox': {
        var on = raw === true || raw === 'true' || raw === 'on' || raw === 'yes' || raw === 1;
        if (!on && req) return { error: requiredMessage(field) };
        return { value: on };
      }
      case 'multiselect': {
        var list = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]), seen = {}, items = [];
        list.forEach(function (x) {
          var v = line(typeof x === 'number' ? String(x) : x, 120);
          if (v && !seen.hasOwnProperty(v)) { seen[v] = 1; items.push(v); }
        });
        if (!items.length) return empty();
        opts = optionsOf(field);
        for (var i = 0; i < items.length; i++) if (opts.indexOf(items[i]) === -1) return { error: notInList(field) };
        return { value: items };
      }
      case 'select': case 'radio': case 'country': {
        s = line(raw, 200);
        if (!s) return empty();
        opts = optionsOf(field);
        // a country list lives on the server; a draft without it cannot be checked here
        if (type === 'country' && !opts.length) return { value: s };
        if (opts.indexOf(s) === -1) return { error: notInList(field) };
        return { value: s };
      }
      case 'email':
        s = line(raw, 200).toLowerCase();
        if (!s) return empty();
        if (!EMAIL_RE.test(s)) return { error: 'Please enter a valid email address.' };
        return { value: s };
      case 'phone':
        s = line(raw, 40);
        if (!s) return empty();
        if (!isPhone(s)) return { error: 'Please enter a valid phone number.' };
        return { value: s };
      case 'number': {
        s = typeof raw === 'number' ? (isFinite(raw) ? String(raw) : 'NaN') : line(raw, 40);
        if (!s) return empty();
        var n = Number(s);
        if (!isFinite(n) || Math.abs(n) > 1e12) return { error: 'Please enter a number for ' + labelOf(field) + '.' };
        return { value: n };
      }
      case 'url':
        s = line(raw, 500);
        if (!s) return empty();
        if (!SCHEME_RE.test(s)) s = 'https://' + s;
        if (!URL_RE.test(s)) return { error: 'Please enter a web address for ' + labelOf(field) + ', like https://example.com.' };
        return { value: s };
      case 'date':
        s = line(raw, 40);
        if (!s) return empty();
        if (!realDate(s)) return { error: 'Please enter a valid date for ' + labelOf(field) + '.' };
        return { value: s };
      case 'textarea':
        s = multiline(raw, 2000);
        if (!s) return empty();
        return { value: s };
      default:
        s = line(raw, maxOf({ id: field.id, type: 'text' }));
        if (!s) return empty();
        return { value: s };
    }
  }

  function validate(form, values) {
    var errors = {}, fields = form && Array.isArray(form.fields) ? form.fields : [];
    values = values || {};
    fields.forEach(function (f, i) {
      if (!f) return;
      var k = keyOf(f, i), r = cleanValue(f, values[k]);
      if (r.error) errors[k] = r.error;
    });
    return errors;
  }

  /* ---------- styles: travel with the script, written in the page's variables ---------- */
  var CSS = [
    'html[data-rv-modal],html[data-rv-modal] body{overflow:hidden!important}',
    '.rv-form-vh{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}',
    '.rv-form{--rvf-err:#b4001e;--rvf-line:rgba(127,127,127,.45);--rvf-line:color-mix(in srgb,currentColor 30%,transparent);--rvf-fill:rgba(127,127,127,.08);--rvf-fill:color-mix(in srgb,currentColor 6%,transparent);container:rvform/inline-size;box-sizing:border-box;width:100%;max-width:640px;margin:0;padding:0;background:transparent;color:inherit;font-family:var(--body-font-family,inherit);font-size:1rem;line-height:1.5;text-align:left}',
    '.rv-form.rv-form--on-dark{--rvf-err:#ffa3a3}',
    '.rv-form *,.rv-form *::before,.rv-form *::after{box-sizing:border-box}',
    '.rv-form [hidden],.rv-form-modal [hidden]{display:none!important}',
    '.rv-form .rv-form-title{margin:0 0 8px;font-family:var(--heading-font-family,inherit);font-size:1.5rem;font-weight:700;line-height:1.2;color:inherit;overflow-wrap:anywhere}',
    '.rv-form .rv-form-intro{margin:0 0 4px}',
    '.rv-form .rv-form-intro p{margin:0 0 8px;color:inherit;line-height:1.55;overflow-wrap:anywhere}',
    '.rv-form .rv-form-pvnote{margin:0 0 14px;padding:6px 10px;border:1px dashed var(--rvf-line);border-radius:6px;font-size:.8125rem;font-weight:600;line-height:1.4;color:inherit}',
    '.rv-form .rv-form-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px 20px;margin:16px 0 0;padding:0;border:0}',
    '@media (min-width:720px){@container rvform (min-width:480px){.rv-form .rv-form-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rv-form .rv-form-field--wide{grid-column:1/-1}}}',
    '.rv-form .rv-form-field{min-width:0;margin:0;padding:0;border:0}',
    '.rv-form .rv-form-label,.rv-form .rv-form-legend{display:block;float:none;width:auto;margin:0 0 6px;padding:0;font-size:.9375rem;font-weight:600;line-height:1.35;color:inherit;overflow-wrap:anywhere}',
    '.rv-form .rv-form-req{margin-left:2px;color:inherit}',
    '.rv-form .rv-form-input{display:block;width:100%;min-height:46px;margin:0;padding:10px 12px;font:inherit;font-size:1rem;line-height:1.4;color:inherit;background:var(--rvf-fill);border:1px solid var(--rvf-line);border-radius:calc(var(--rv-radius,10px) * .6);box-shadow:none;-webkit-appearance:none;appearance:none;opacity:1;-webkit-text-fill-color:currentColor}',
    '.rv-form textarea.rv-form-input{min-height:112px;resize:vertical}',
    '.rv-form .rv-form-input::placeholder{color:inherit;opacity:.6}',
    '.rv-form .rv-form-select{position:relative;display:block}',
    '.rv-form .rv-form-select .rv-form-input{padding-right:40px;cursor:pointer}',
    '.rv-form .rv-form-select::after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-70%) rotate(45deg);pointer-events:none}',
    '.rv-form .rv-form-input:focus,.rv-form .rv-form-choice input:focus-visible{outline:2px solid var(--theme-color,#e4002b);outline-offset:2px}',
    '.rv-form .rv-form-input[aria-invalid="true"]{border-color:var(--rvf-err);border-width:2px}',
    '.rv-form .rv-form-choices{display:grid;gap:2px}',
    '.rv-form .rv-form-choice{display:flex;align-items:flex-start;gap:10px;min-height:44px;margin:0;padding:10px 0;font-size:1rem;font-weight:400;line-height:1.4;color:inherit;cursor:pointer}',
    '.rv-form .rv-form-choice input{flex:0 0 auto;width:20px;height:20px;margin:1px 0 0;accent-color:var(--theme-color,#e4002b);cursor:pointer}',
    '.rv-form .rv-form-choice span{min-width:0;overflow-wrap:anywhere}',
    '.rv-form .rv-form-check{font-weight:600}',
    '.rv-form .rv-form-help{margin:6px 0 0;font-size:.875rem;line-height:1.45;color:inherit;opacity:.82;overflow-wrap:anywhere}',
    '.rv-form .rv-form-err{margin:6px 0 0;font-size:.875rem;font-weight:600;line-height:1.4;color:var(--rvf-err);overflow-wrap:anywhere}',
    '.rv-form .rv-form-err:empty{display:none}',
    '.rv-form .rv-form-note,.rv-form .rv-form-alert{margin:18px 0 0;padding:12px 14px;border-radius:calc(var(--rv-radius,10px) * .6);background:var(--rvf-fill);border-left:4px solid var(--theme-color,#e4002b);font-size:.9375rem;line-height:1.5;color:inherit}',
    '.rv-form .rv-form-alert{border-left-color:var(--rvf-err);font-weight:600}',
    '.rv-form .rv-form-alert:empty{display:none}',
    '.rv-form .rv-form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:20px 0 0}',
    '.rv-form .rv-form-submit{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;min-width:44px;margin:0;padding:12px 28px;border:0;border-radius:var(--rv-radius,10px);background:var(--theme-color,#e4002b);color:var(--rv-on-theme,#ffffff);font:inherit;font-size:1rem;font-weight:700;line-height:1.2;text-align:center;cursor:pointer;-webkit-text-fill-color:currentColor;opacity:1}',
    '.rv-form .rv-form-submit:hover{filter:brightness(1.06)}',
    '.rv-form .rv-form-submit:focus-visible,.rv-form .rv-form-link:focus-visible,.rv-form .rv-form-btn2:focus-visible,.rv-form-modal-close:focus-visible{outline:2px solid var(--theme-color,#e4002b);outline-offset:3px}',
    '.rv-form .rv-form-submit[aria-busy="true"],.rv-form .rv-form-submit:disabled{cursor:default;opacity:.72}',
    '.rv-form .rv-form-link{display:inline-flex;align-items:center;min-height:44px;margin:0;padding:8px 0;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    '.rv-form .rv-form-btn2{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:10px 20px;border:1.5px solid currentColor;border-radius:var(--rv-radius,10px);background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}',
    '.rv-form .rv-form-status{display:flex;align-items:center;gap:10px;margin:0;padding:6px 0;font-size:.9375rem;color:inherit}',
    '.rv-form .rv-form-spin{flex:0 0 auto;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:rvf-spin .8s linear infinite}',
    '@keyframes rvf-spin{to{transform:rotate(360deg)}}',
    '.rv-form .rv-form-done{outline:none}',
    '.rv-form .rv-form-done p{margin:0 0 10px;line-height:1.6;color:inherit;overflow-wrap:anywhere}',
    '.rv-form.rv-form--preview{pointer-events:none;user-select:none}',
    '.rv-form.rv-form--preview .rv-form-input,.rv-form.rv-form--preview .rv-form-submit{cursor:default}',
    /* the pop-up: the site's panels and text, over a dimmed page */
    '.rv-form-modal{--rv-keep:1;position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,12,16,.62);opacity:0;transition:opacity .2s ease}',
    '.rv-form-modal.rv-open{opacity:1}',
    '.rv-form-modal-panel{position:relative;box-sizing:border-box;width:560px;width:min(560px,calc(100vw - 32px));max-height:90vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--rv-surface,#ffffff);color:var(--rv-text,#1c1c1c);border-radius:var(--rv-radius,10px);box-shadow:0 30px 80px rgba(0,0,0,.35);font-family:var(--body-font-family,inherit);text-align:left;transform:translateY(12px);transition:transform .25s ease}',
    '.rv-form-modal.rv-open .rv-form-modal-panel{transform:none}',
    '.rv-form-modal-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:12px;padding:20px 16px 10px 24px;background:var(--rv-surface,#ffffff)}',
    '.rv-form-modal-title{flex:1 1 auto;min-width:0;margin:6px 0 0;font-family:var(--heading-font-family,inherit);font-size:1.5rem;font-weight:700;line-height:1.2;color:inherit;overflow-wrap:anywhere}',
    '.rv-form-modal-close{flex:0 0 auto;display:grid;place-items:center;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:rgba(127,127,127,.14);background:color-mix(in srgb,currentColor 9%,transparent);color:inherit;cursor:pointer}',
    '.rv-form-modal-close svg{display:block;width:22px;height:22px}',
    '.rv-form-modal-close:disabled{cursor:default;opacity:.5}',
    '.rv-form-modal-body{padding:4px 24px 28px}',
    '.rv-form-modal-body .rv-form{max-width:none}',
    '@media (max-width:600px){',
    '.rv-form-modal{padding:0;align-items:stretch}',
    '.rv-form-modal-panel{width:100%;max-height:none;height:100vh;height:100dvh;border-radius:0;box-shadow:none;transform:translateY(24px)}',
    '.rv-form-modal-head{padding:12px 12px 10px 20px;box-shadow:0 1px 0 rgba(127,127,127,.25)}',
    '.rv-form-modal-title{font-size:1.25rem;margin-top:9px}',
    '.rv-form-modal-body{padding:16px 20px 32px}',
    '.rv-form-modal-body .rv-form-submit{width:100%}',
    '}',
    '@media (prefers-reduced-motion:reduce){.rv-form-modal,.rv-form-modal-panel{transition:none}.rv-form .rv-form-spin{animation:none;border-right-color:currentColor;opacity:.5}}'
  ].join('\n');

  function ensureStyles(doc, opts) {
    doc = doc || document;
    var head = doc.head || doc.getElementsByTagName('head')[0];
    if (!head) return null;
    var st = doc.querySelector('style[data-rv-forms-style]');
    if (!st) {
      st = doc.createElement('style');
      st.setAttribute('data-rv-forms-style', '');
      st.textContent = CSS;
      head.appendChild(st);
    }
    if (opts && opts.editor) st.setAttribute('data-rv-editor', '');
    return st;
  }

  /* ---------- small DOM helpers (any document) ---------- */
  function mk(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function paragraphs(doc, parent, text) {
    multiline(str(text), 4000).split(/\n+/).forEach(function (t) {
      t = t.trim();
      if (t) parent.appendChild(mk(doc, 'p', null, t));
    });
    return parent;
  }
  function closeIcon(doc) {
    var NS = 'http://www.w3.org/2000/svg', s = doc.createElementNS(NS, 'svg'), p = doc.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    s.appendChild(p);
    return s;
  }
  function focusNode(n) { if (!n) return; try { n.focus({ preventScroll: false }); } catch (e) { try { n.focus(); } catch (e2) { /* not focusable */ } } }
  function reducedMotion(win) { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  /* light text on its ground (a dark section, a dark theme's panel): dark form controls and a lighter red;
     in a section whose text is centred, the form's column is centred too (its own text stays left-aligned) */
  function markTone(root) {
    try {
      var win = root.ownerDocument.defaultView, c = win.getComputedStyle(root).color;
      var host = root.parentElement;
      if (host && win.getComputedStyle(host).textAlign === 'center') { root.style.marginLeft = 'auto'; root.style.marginRight = 'auto'; }
      var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c || '');
      if (!m) return;
      var l = [m[1], m[2], m[3]].map(function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      var lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      if (lum > 0.4) { root.classList.add('rv-form--on-dark'); root.style.colorScheme = 'dark'; }
      else { root.classList.remove('rv-form--on-dark'); root.style.colorScheme = 'light'; }
    } catch (e) { /* computed styles not available: the light defaults stay */ }
  }

  function utmOf(win) {
    var out = { source: '', medium: '', campaign: '' }, q = '';
    try { q = String(win.location.search || ''); } catch (e) { q = ''; }
    q.replace(/^\?/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('='), k = i === -1 ? pair : pair.slice(0, i), v = i === -1 ? '' : pair.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
      if (k === 'utm_source') out.source = v.slice(0, 80);
      else if (k === 'utm_medium') out.medium = v.slice(0, 80);
      else if (k === 'utm_campaign') out.campaign = v.slice(0, 120);
    });
    return out;
  }

  /* ---------- render: one form, drawn into host ---------- */
  var instanceN = 0;

  function render(form, host, opts) {
    form = form || {};
    opts = opts || {};
    var doc = host.ownerDocument || document;
    var win = doc.defaultView || window;
    var mode = MODES[opts.mode] ? opts.mode : 'live';
    var pv = mode === 'editor-preview';
    var showTitle = opts.showTitle !== false;
    var n = ++instanceN, pre = 'rvf-' + n + '-';
    var fields = Array.isArray(form.fields) ? form.fields.filter(function (f) { return f && typeof f === 'object'; }) : [];
    var closed = form.open === false;
    var titleText = line(str(form.title), 200) || line(str(form.name), 200);

    ensureStyles(doc, { editor: pv });
    var root = mk(doc, 'div', 'rv-form' + (pv ? ' rv-form--preview' : ''));
    root.setAttribute('data-rv-form-root', '');
    if (form.id) root.setAttribute('data-rv-form-id', String(form.id));
    host.appendChild(root);
    markTone(root);

    var st = { busy: false, touched: false, destroyed: false, done: false };
    var parts = [];            // { key, field, wrap, err, controls, focus, get, set }
    var formEl = null, submitBtn = null, alertEl = null, noticeEl = null;

    function head() {
      if (showTitle && titleText) {
        var h = mk(doc, 'h3', 'rv-form-title', titleText);
        h.id = pre + 'title';
        root.appendChild(h);
      }
    }
    function intro() {
      if (line(str(form.intro), 10)) root.appendChild(paragraphs(doc, mk(doc, 'div', 'rv-form-intro'), form.intro));
    }

    function labelContent(parent, field) {
      var text = line(str(field.label), 200);
      parent.appendChild(doc.createTextNode(text || (pv ? MSG.untitled : labelOf(field))));
      if (field.required) {
        var star = mk(doc, 'span', 'rv-form-req', '*');
        star.setAttribute('aria-hidden', 'true');
        parent.appendChild(star);
        parent.appendChild(mk(doc, 'span', 'rv-form-vh', ' (required)'));
      }
    }

    function control(el) {
      if (pv) { el.disabled = true; el.setAttribute('tabindex', '-1'); }
      return el;
    }

    function buildField(field, i) {
      var key = keyOf(field, i), type = field.type, id = pre + key.replace(/[^A-Za-z0-9_-]/g, '_');
      var wide = !SHORT_TYPES[type];
      var group = type === 'radio' || type === 'multiselect';
      var wrap = mk(doc, group ? 'fieldset' : 'div', 'rv-form-field rv-form-field--' + (type || 'text') + (wide ? ' rv-form-field--wide' : ''));
      var help = line(str(field.help), 300);
      var helpEl = mk(doc, 'p', 'rv-form-help', help || null);
      helpEl.id = id + '-help';
      if (!help) helpEl.hidden = true;
      var err = mk(doc, 'p', 'rv-form-err');
      err.id = id + '-err';
      if (!pv) err.setAttribute('role', 'alert');
      var described = (help ? helpEl.id + ' ' : '') + err.id;
      var part = { key: key, field: field, wrap: wrap, err: err, controls: [], focus: null };
      var placeholder = line(str(field.placeholder), 120);

      if (group) {
        var legend = mk(doc, 'legend', 'rv-form-legend');
        labelContent(legend, field);
        wrap.appendChild(legend);
        wrap.setAttribute('aria-describedby', described);
        var box = mk(doc, 'div', 'rv-form-choices');
        optionsOf(field).forEach(function (o, j) {
          var lab = mk(doc, 'label', 'rv-form-choice');
          var inp = control(mk(doc, 'input'));
          inp.type = type === 'radio' ? 'radio' : 'checkbox';
          inp.name = key;
          inp.value = o;
          inp.id = id + '-' + j;
          if (type === 'radio' && field.required) inp.required = true;
          lab.appendChild(inp);
          lab.appendChild(mk(doc, 'span', null, o));
          box.appendChild(lab);
          part.controls.push(inp);
        });
        wrap.appendChild(box);
        part.focus = part.controls[0] || null;
        part.get = function () {
          if (type === 'radio') {
            for (var k = 0; k < part.controls.length; k++) if (part.controls[k].checked) return part.controls[k].value;
            return '';
          }
          return part.controls.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        };
        part.set = function (v) {
          var list = Array.isArray(v) ? v.map(str) : [str(v)];
          part.controls.forEach(function (c) { c.checked = list.indexOf(c.value) !== -1; });
        };
      } else if (type === 'checkbox') {
        // one tick box: its own label is the field's label (a fieldset around one box would say it twice)
        var lab2 = mk(doc, 'label', 'rv-form-choice rv-form-check');
        var cb = control(mk(doc, 'input'));
        cb.type = 'checkbox';
        cb.name = key;
        cb.value = 'yes';
        cb.id = id;
        if (field.required) cb.required = true;
        cb.setAttribute('aria-describedby', described);
        lab2.appendChild(cb);
        var span = mk(doc, 'span');
        labelContent(span, field);
        lab2.appendChild(span);
        wrap.appendChild(lab2);
        part.controls.push(cb);
        part.focus = cb;
        part.get = function () { return cb.checked; };
        part.set = function (v) { cb.checked = v === true || v === 'true' || v === 'yes' || v === 'on'; };
      } else {
        var label = mk(doc, 'label', 'rv-form-label');
        label.htmlFor = id;
        labelContent(label, field);
        wrap.appendChild(label);
        var c;
        if (type === 'select' || type === 'country') {
          var holder = mk(doc, 'span', 'rv-form-select');
          c = control(mk(doc, 'select', 'rv-form-input'));
          var first = mk(doc, 'option', null, MSG.choose);
          first.value = '';
          c.appendChild(first);
          optionsOf(field).forEach(function (o) {
            var op = mk(doc, 'option', null, o);
            op.value = o;
            c.appendChild(op);
          });
          holder.appendChild(c);
          wrap.appendChild(holder);
        } else if (type === 'textarea') {
          c = control(mk(doc, 'textarea', 'rv-form-input'));
          c.rows = 4;
          wrap.appendChild(c);
        } else {
          c = control(mk(doc, 'input', 'rv-form-input'));
          var t = { email: 'email', phone: 'tel', url: 'url', date: 'date' }[type] || 'text';
          try { c.type = t; } catch (e) { c.setAttribute('type', t); }
          if (type === 'email') c.setAttribute('inputmode', 'email');
          if (type === 'number') c.setAttribute('inputmode', 'decimal');
          if (type === 'phone') c.setAttribute('inputmode', 'tel');
          if (type === 'date') { c.setAttribute('min', '1900-01-01'); c.setAttribute('max', '2100-12-31'); }
          wrap.appendChild(c);
        }
        c.id = id;
        c.name = key;
        if (type !== 'select' && type !== 'country' && type !== 'date') c.setAttribute('maxlength', String(maxOf(field)));
        if (placeholder && type !== 'select' && type !== 'country' && type !== 'date') c.setAttribute('placeholder', placeholder);
        c.setAttribute('autocomplete', type === 'country' ? 'country-name' : (AUTOCOMPLETE[field.id] || 'off'));
        if (field.required) c.required = true;
        c.setAttribute('aria-describedby', described);
        part.controls.push(c);
        part.focus = c;
        part.get = function () { return c.value; };
        part.set = function (v) { c.value = v == null ? '' : (Array.isArray(v) ? v.join(', ') : String(v)); };
      }
      wrap.appendChild(helpEl);
      wrap.appendChild(err);
      parts.push(part);
      return wrap;
    }

    function partFor(key) { for (var i = 0; i < parts.length; i++) if (parts[i].key === key) return parts[i]; return null; }

    function values() {
      var out = {};
      parts.forEach(function (p) { out[p.key] = p.get(); });
      return out;
    }

    function setErrors(map) {
      map = map || {};
      var loose = [];
      parts.forEach(function (p) {
        var msg = map[p.key] ? str(map[p.key]) : '';
        p.err.textContent = msg;
        p.controls.forEach(function (c) {
          if (msg) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid');
        });
      });
      Object.keys(map).forEach(function (k) { if (map[k] && !partFor(k)) loose.push(str(map[k])); });
      if (alertEl) alertEl.textContent = loose.join(' ');
    }
    function firstInvalid(map) {
      for (var i = 0; i < parts.length; i++) if (map[parts[i].key]) return parts[i];
      return null;
    }
    function formError(msg) {
      if (alertEl) alertEl.textContent = msg || '';
    }

    function setBusy(on) {
      st.busy = on;
      if (!submitBtn) return;
      submitBtn.disabled = on;
      if (on) { submitBtn.setAttribute('aria-busy', 'true'); submitBtn.textContent = MSG.sending; }
      else { submitBtn.removeAttribute('aria-busy'); submitBtn.textContent = line(str(form.submitLabel), 80) || 'Submit'; }
      if (opts.onBusy) { try { opts.onBusy(on); } catch (e) { /* the host's own */ } }
    }

    function showDone(result) {
      st.done = true;
      clear(root);
      var panel = mk(doc, 'div', 'rv-form-done');
      panel.setAttribute('role', 'status');
      panel.setAttribute('tabindex', '-1');
      if (showTitle && titleText) panel.appendChild(mk(doc, 'h3', 'rv-form-title', titleText));
      paragraphs(doc, panel, (result && result.message) || 'Thank you. Your response has been received.');
      var acts = mk(doc, 'div', 'rv-form-actions');
      var again = mk(doc, 'button', 'rv-form-link', MSG.again);
      again.type = 'button';
      again.addEventListener('click', function () {
        st.done = false; st.touched = false;
        build({});
        focusNode(parts[0] && parts[0].focus);
      });
      acts.appendChild(again);
      if (typeof opts.onClose === 'function') {
        var close = mk(doc, 'button', 'rv-form-btn2', MSG.close);
        close.type = 'button';
        close.addEventListener('click', function () { opts.onClose(); });
        acts.appendChild(close);
      }
      panel.appendChild(acts);
      root.appendChild(panel);
      focusNode(panel);
    }

    function send(answers, website) {
      var body = {
        eventId: str(opts.eventId), formId: str(form.id), answers: answers, website: website,
        source: 'website', utm: utmOf(win), ref: str(doc.referrer), preview: mode === 'preview'
      };
      setBusy(true);
      formError('');
      var fetcher = win.fetch || window.fetch;
      var p;
      try {
        p = fetcher.call(win, '/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body)
        });
      } catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        return res.json().then(function (j) { return { status: res.status, ok: res.ok, body: j || {} }; },
          function () { return { status: res.status, ok: false, body: {} }; });
      }).then(function (r) {
        if (st.destroyed) return;
        setBusy(false);
        var b = r.body || {};
        if (r.ok && b.ok) {
          if (opts.onDone) { try { opts.onDone(b); } catch (e) { /* the host's own */ } }
          showDone(b);
          return;
        }
        if (r.status === 400 && b.fields && typeof b.fields === 'object') {
          var unknown = Object.keys(b.fields).filter(function (k) { return !partFor(k); });
          if (unknown.length && typeof opts.onStale === 'function') { opts.onStale(values(), b.fields); return; }
          setErrors(b.fields);
          var bad = firstInvalid(b.fields);
          if (bad) focusNode(bad.focus);
          return;
        }
        if (r.status === 409 && (b.code === 'duplicate' || (b.fields && b.fields.email))) {
          var m = {};
          m[partFor('email') ? 'email' : '_'] = (b.fields && b.fields.email) || b.error || 'This email has already been used for this form.';
          setErrors(m);
          if (partFor('email')) focusNode(partFor('email').focus);
          return;
        }
        if (r.status >= 500 || !r.status) { formError(MSG.offline); return; }
        formError(str(b.error) || MSG.offline);
      }, function () {
        if (st.destroyed) return;
        setBusy(false);
        formError(MSG.offline);
      });
    }

    function onSubmit(e) {
      if (e) e.preventDefault();
      if (pv || st.busy || st.done || st.destroyed) return;
      var vals = values();
      var errs = validate({ fields: fields }, vals);
      setErrors(errs);
      if (noticeEl) noticeEl.hidden = true;
      var bad = firstInvalid(errs);
      if (bad) { focusNode(bad.focus); return; }
      if (mode === 'ai-view') {
        if (noticeEl) { noticeEl.hidden = false; noticeEl.textContent = MSG.aiView; }
        return;
      }
      var answers = {};
      parts.forEach(function (p) { answers[p.key] = vals[p.key]; });
      var hp = formEl && formEl.querySelector('input[name="website"]');
      send(answers, hp ? hp.value : '');
    }

    function build(initial) {
      clear(root);
      parts = [];
      formEl = submitBtn = alertEl = noticeEl = null;
      head();
      intro();
      if (pv) root.appendChild(mk(doc, 'p', 'rv-form-pvnote', MSG.preview));
      if (closed && !pv) { root.appendChild(mk(doc, 'p', 'rv-form-note', MSG.closed)); return; }

      formEl = mk(doc, 'form', 'rv-form-form');
      formEl.setAttribute('novalidate', '');
      if (showTitle && titleText) formEl.setAttribute('aria-labelledby', pre + 'title');
      else if (titleText) formEl.setAttribute('aria-label', titleText);
      var grid = mk(doc, 'div', 'rv-form-grid');
      fields.forEach(function (f, i) { grid.appendChild(buildField(f, i)); });
      formEl.appendChild(grid);

      if (!pv) {
        var hp = mk(doc, 'div');
        hp.setAttribute('aria-hidden', 'true');
        hp.setAttribute('style', 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden');
        var hl = mk(doc, 'label', null, MSG.honeypot);
        var hi = mk(doc, 'input');
        hi.name = 'website';
        hi.type = 'text';
        hi.setAttribute('tabindex', '-1');
        hi.setAttribute('autocomplete', 'off');
        hl.appendChild(hi);
        hp.appendChild(hl);
        formEl.appendChild(hp);
      }
      if (closed && pv) formEl.appendChild(mk(doc, 'p', 'rv-form-note', MSG.closed));
      if (opts.waitlist && form.counts) formEl.appendChild(mk(doc, 'p', 'rv-form-note', MSG.waitlist));
      alertEl = mk(doc, 'p', 'rv-form-alert');
      if (!pv) alertEl.setAttribute('role', 'alert');
      formEl.appendChild(alertEl);
      noticeEl = mk(doc, 'p', 'rv-form-note');
      noticeEl.setAttribute('role', 'status');
      noticeEl.hidden = true;
      formEl.appendChild(noticeEl);

      var acts = mk(doc, 'div', 'rv-form-actions');
      submitBtn = control(mk(doc, 'button', 'rv-form-submit', line(str(form.submitLabel), 80) || 'Submit'));
      submitBtn.type = 'submit';
      acts.appendChild(submitBtn);
      formEl.appendChild(acts);
      root.appendChild(formEl);

      if (initial) parts.forEach(function (p) { if (initial.hasOwnProperty(p.key)) p.set(initial[p.key]); });
      if (pv) return;

      formEl.addEventListener('submit', onSubmit);
      /* the button's own click too: the editor's live view stops a submit button's default action before the
         form hears of it, and there the answers must still be checked */
      submitBtn.addEventListener('click', onSubmit);
      function touch() {
        st.touched = true;
        if (typeof opts.onInput === 'function') { try { opts.onInput(values()); } catch (e) { /* the host's own */ } }
      }
      formEl.addEventListener('input', touch);
      formEl.addEventListener('change', touch);
    }

    build(opts.values || null);

    return {
      el: root,
      values: values,
      setErrors: setErrors,
      destroy: function () {
        st.destroyed = true;
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      /* for the page runtime */
      focusFirst: function () {
        var p = parts[0];
        if (p) focusNode(p.focus);
        return !!p;
      },
      isTouched: function () { return st.touched; },
      isBusy: function () { return st.busy; },
      isDone: function () { return st.done; }
    };
  }

  /* ======================================================================================================
     The page runtime: buttons, pop-up, forms drawn in place, links to #register / #rv-form-<id>
     ====================================================================================================== */
  var doc = window.document, html = doc && doc.documentElement;
  var page = {
    mode: null, eventId: '', payload: null, loading: false, failed: false,
    embeds: [], modal: null, memory: {}, started: false
  };

  function editing() { return !!html && (html.hasAttribute('data-rv-editing') || html.getAttribute('data-rv-editor-mode') === 'manual'); }
  function readJson(id) {
    var el = doc.getElementById(id);
    if (!el) return undefined;
    try { return JSON.parse(el.textContent || ''); } catch (e) { return null; }
  }
  function validPayload(p) { return !!p && typeof p === 'object' && Array.isArray(p.forms); }
  function pageMode() {
    if (editing()) return null;
    if (html.getAttribute('data-rv-editor-mode') === 'ai') return 'ai-view';
    var cfg = readJson('rv-site-config');
    if (cfg && cfg.mode === 'preview') return 'preview';
    if (cfg && cfg.mode === 'live') return 'live';
    return page.eventId ? 'live' : null;
  }
  function defaultFormId() {
    var p = page.payload;
    if (!p) return '';
    if (p.defaultFormId && findForm(p.defaultFormId)) return p.defaultFormId;
    return p.forms[0] ? p.forms[0].id : '';
  }
  function findForm(id) {
    var p = page.payload;
    if (!p || !id) return null;
    for (var i = 0; i < p.forms.length; i++) if (p.forms[i] && p.forms[i].id === id) return p.forms[i];
    return null;
  }
  function revsOf(p) {
    return validPayload(p) ? p.forms.map(function (f) { return f.id + ':' + f.rev + ':' + f.open; }).join('|') + '|' + p.open + '|' + p.waitlist + '|' + p.defaultFormId : '';
  }
  function renderOpts(extra) {
    var o = { mode: page.mode, eventId: page.eventId, waitlist: !!(page.payload && page.payload.waitlist) };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  /* ---------- definitions ---------- */
  var waiters = [];
  function fetchDefinitions() {
    if (page.loading) return new Promise(function (resolve) { waiters.push(resolve); });
    if (!page.eventId || !window.fetch) {
      if (!page.payload && !page.failed) { page.failed = true; refreshAll(); }
      return Promise.resolve(false);
    }
    page.loading = true;
    page.failed = false;
    return window.fetch('/api/public/forms?eventId=' + encodeURIComponent(page.eventId), {
      credentials: 'same-origin', headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (p) {
      if (!validPayload(p)) throw new Error('not a forms payload');
      var changed = revsOf(p) !== revsOf(page.payload);
      page.payload = p;
      return changed;
    }).then(function (changed) {
      page.loading = false;
      if (changed) refreshAll();
      settle(true);
      return true;
    }, function (err) {
      page.loading = false;
      if (window.console && console.warn) console.warn('[rv-forms] the forms could not be loaded:', err && err.message);
      if (!page.payload) { page.failed = true; refreshAll(); }
      settle(false);
      return false;
    });
  }
  function settle(ok) {
    var w = waiters;
    waiters = [];
    w.forEach(function (fn) { fn(ok); });
  }

  /* ---------- forms drawn in place ---------- */
  function statusLine(parent, text, spinner, retry) {
    var box = mk(doc, 'div', 'rv-form');
    box.setAttribute('data-rv-form-root', '');
    var p = mk(doc, 'p', 'rv-form-status');
    p.setAttribute('role', 'status');
    if (spinner) {
      var s = mk(doc, 'span', 'rv-form-spin');
      s.setAttribute('aria-hidden', 'true');
      p.appendChild(s);
    }
    p.appendChild(mk(doc, 'span', null, text));
    box.appendChild(p);
    if (retry) {
      var acts = mk(doc, 'div', 'rv-form-actions');
      var b = mk(doc, 'button', 'rv-form-btn2', MSG.retry);
      b.type = 'button';
      b.addEventListener('click', retry);
      acts.appendChild(b);
      box.appendChild(acts);
    }
    parent.appendChild(box);
    markTone(box);
    return box;
  }
  function retryLoad() {
    page.failed = false;
    refreshAll();
    fetchDefinitions();
  }

  function clearEmbed(e) {
    if (e.ctrl) { e.ctrl.destroy(); e.ctrl = null; }
    if (e.status && e.status.parentNode) e.status.parentNode.removeChild(e.status);
    e.status = null;
  }
  function drawEmbed(e, values, errors) {
    var el = e.el, fallback = el.querySelector('[data-rv-form-fallback]');
    clearEmbed(e);
    el.hidden = false;
    if (e.hidSection) { e.hidSection.hidden = false; e.hidSection = null; }
    if (!page.payload) {
      if (page.failed) {
        if (fallback) fallback.hidden = true;
        e.status = statusLine(el, MSG.loadFailed, false, retryLoad);
      } else if (fallback) {
        fallback.hidden = false;
        fallback.textContent = MSG.loading;
      } else {
        e.status = statusLine(el, MSG.loading, true, null);
      }
      return;
    }
    if (fallback) fallback.hidden = true;
    var form = findForm(e.formId);
    if (!form) {
      if (page.mode === 'live') {
        el.hidden = true;
        /* a section made only to hold this form (its heading, a line and the form) would be left as a heading
           over nothing: it goes too */
        var sec = el.parentElement;
        if (sec && sec.classList && sec.classList.contains('rv-generic') && Array.prototype.every.call(sec.children, function (c) {
          return c === el || /^(H[1-6]|P|STYLE|SCRIPT)$/.test(c.tagName);
        })) { sec.hidden = true; e.hidSection = sec; }
        return;
      }
      e.status = statusLine(el, 'This form (“' + e.formId + '”) no longer exists. Choose another form in the editor.', false, null);
      return;
    }
    e.ctrl = render(form, el, renderOpts({
      showTitle: el.getAttribute('data-rv-form-title') !== 'hide',
      values: values || null,
      onStale: function (vals, fields) { restale(function () { drawEmbed(e, vals, fields); }); }
    }));
    if (errors) e.ctrl.setErrors(errors);
    if (e.focusOnDraw) { e.focusOnDraw = false; e.ctrl.focusFirst(); }
  }
  /* the server named a field this page's copy of the form does not have: the form changed since the page
     was drawn. Fetch it again and draw it anew, keeping what was typed. */
  function restale(redraw) {
    fetchDefinitions().then(function () { redraw(); });
  }
  function startEmbeds() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-form-embed]'), function (el) {
      var id = String(el.getAttribute('data-rv-form-embed') || '').trim();
      var e = { el: el, formId: id, ctrl: null, status: null, focusOnDraw: false };
      page.embeds.push(e);
      drawEmbed(e);
    });
  }
  function inUse(ctrl) { return !!ctrl && (ctrl.isTouched() || ctrl.isBusy() || ctrl.isDone()); }
  function holdsFocus(el) { return !!el && !!doc.activeElement && doc.activeElement !== doc.body && el.contains(doc.activeElement); }
  /* new definitions: every form the visitor has not started on is drawn again (keeping the keyboard where it was) */
  function refreshAll() {
    page.embeds.forEach(function (e) {
      if (inUse(e.ctrl)) return;
      var had = holdsFocus(e.el);
      drawEmbed(e);
      if (had && e.ctrl) e.ctrl.focusFirst();
    });
    var m = page.modal;
    if (m && !inUse(m.ctrl)) {
      var had = holdsFocus(m.layer) || doc.activeElement === doc.body;
      fillModal();
      if (had) { var list = focusables(m.body); focusNode(list[0] || m.close); }
    }
  }
  function embedOf(formId) {
    for (var i = 0; i < page.embeds.length; i++) {
      var e = page.embeds[i];
      if (e.formId === formId && !e.el.hidden && e.el.getClientRects().length) return e;
    }
    return null;
  }

  /* ---------- the pop-up ---------- */
  function focusables(layer) {
    return Array.prototype.filter.call(layer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (n) {
      if (n.getAttribute('tabindex') === '-1') return false;
      if (n.closest('[aria-hidden="true"]')) return false;
      return !n.hidden && n.getClientRects().length > 0;
    });
  }
  function onModalKey(e) {
    var m = page.modal;
    if (!m) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy()) closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    var list = focusables(m.layer);
    if (!list.length) { e.preventDefault(); return; }
    var at = list.indexOf(doc.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && (at === -1 || at === list.length - 1)) { e.preventDefault(); list[0].focus(); }
  }
  function busy() { return !!(page.modal && page.modal.ctrl && page.modal.ctrl.isBusy()); }

  function buildModal(opener, formId, fallbackDefault) {
    ensureStyles(doc);
    var n = ++instanceN;
    var layer = mk(doc, 'div', 'rv-form-modal');
    layer.setAttribute('data-rv-form-root', '');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'rvf-modal-title-' + n);
    var panel = mk(doc, 'div', 'rv-form-modal-panel');
    var head = mk(doc, 'div', 'rv-form-modal-head');
    var title = mk(doc, 'h2', 'rv-form-modal-title');
    title.id = 'rvf-modal-title-' + n;
    var close = mk(doc, 'button', 'rv-form-modal-close');
    close.type = 'button';
    close.setAttribute('aria-label', MSG.close);
    close.appendChild(closeIcon(doc));
    close.addEventListener('click', function () { if (!busy()) closeModal(); });
    head.appendChild(title);
    head.appendChild(close);
    var body = mk(doc, 'div', 'rv-form-modal-body');
    panel.appendChild(head);
    panel.appendChild(body);
    layer.appendChild(panel);
    layer.addEventListener('click', function (e) { if (e.target === layer && !busy()) closeModal(); });
    return { layer: layer, panel: panel, title: title, close: close, body: body, opener: opener, formId: formId, fallbackDefault: !!fallbackDefault, ctrl: null, shownId: '' };
  }

  function fillModal(values, errors) {
    var m = page.modal;
    if (!m) return;
    if (m.ctrl) { m.ctrl.destroy(); m.ctrl = null; }
    clear(m.body);
    if (!page.payload) {
      m.title.textContent = page.failed ? MSG.unavailable : MSG.loading;
      if (page.failed) statusLine(m.body, MSG.loadFailed, false, retryLoad);
      else statusLine(m.body, MSG.loading, true, null);
      return;
    }
    var form = findForm(m.formId);
    if (!form && m.fallbackDefault) form = findForm(defaultFormId());
    if (!form) {
      m.title.textContent = MSG.unavailable;
      var box = mk(doc, 'div', 'rv-form');
      var acts = mk(doc, 'div', 'rv-form-actions');
      var b = mk(doc, 'button', 'rv-form-btn2', MSG.close);
      b.type = 'button';
      b.addEventListener('click', function () { closeModal(); });
      acts.appendChild(b);
      box.appendChild(acts);
      m.body.appendChild(box);
      markTone(box);
      return;
    }
    m.shownId = form.id;
    m.title.textContent = line(str(form.title), 200) || line(str(form.name), 200);
    var keep = values || page.memory[form.id] || null;
    m.ctrl = render(form, m.body, renderOpts({
      showTitle: false,
      values: keep,
      onInput: function (vals) { page.memory[form.id] = vals; },
      onDone: function () { delete page.memory[form.id]; },
      onClose: function () { closeModal(); },
      onBusy: function (on) { m.close.disabled = on; },
      onStale: function (vals, fields) { restale(function () { if (page.modal === m) fillModal(vals, fields); }); }
    }));
    if (errors) m.ctrl.setErrors(errors);
  }

  function openModal(formId, opener, fallbackDefault, fromHash) {
    if (page.modal) closeModal(true);
    /* one pop-up at a time: a speaker's profile or a photo (rv-popups.js) is closed first */
    if (html.hasAttribute('data-rv-modal')) {
      try { if (window.RevampPopups && window.RevampPopups.close) window.RevampPopups.close(); } catch (e) { /* theirs */ }
      if (html.hasAttribute('data-rv-modal')) return false;
    }
    var m = buildModal(opener, formId, fallbackDefault);
    m.fromHash = !!fromHash;
    page.modal = m;
    m.inerted = [];
    Array.prototype.forEach.call(doc.body.children, function (n) {
      if (n === m.layer || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
      var rec = { n: n, inert: n.hasAttribute('inert'), aria: n.getAttribute('aria-hidden') };
      n.setAttribute('inert', '');
      if (!('inert' in n)) n.setAttribute('aria-hidden', 'true');
      m.inerted.push(rec);
    });
    m.pad = doc.body.style.paddingRight;
    var gap = window.innerWidth - html.clientWidth;
    if (gap > 0) doc.body.style.paddingRight = gap + 'px';
    html.setAttribute('data-rv-modal', '');
    doc.body.appendChild(m.layer);
    fillModal();
    doc.addEventListener('keydown', onModalKey, true);
    (window.requestAnimationFrame || setTimeout)(function () { m.layer.classList.add('rv-open'); });
    var first = m.ctrl ? null : m.close;
    if (m.ctrl) {
      var list = focusables(m.body);
      first = list[0] || m.close;
    }
    try { first.focus({ preventScroll: true }); } catch (e) { focusNode(first); }
    return true;
  }

  function closeModal(quick) {
    var m = page.modal;
    if (!m) return;
    page.modal = null;
    doc.removeEventListener('keydown', onModalKey, true);
    if (m.ctrl) { m.ctrl.destroy(); m.ctrl = null; }
    if (m.layer.parentNode) m.layer.parentNode.removeChild(m.layer);
    m.inerted.forEach(function (r) {
      if (!r.inert) r.n.removeAttribute('inert');
      if (r.aria == null) r.n.removeAttribute('aria-hidden'); else r.n.setAttribute('aria-hidden', r.aria);
    });
    doc.body.style.paddingRight = m.pad || '';
    html.removeAttribute('data-rv-modal');
    /* a form opened from the address: the address no longer says so, so the same link opens it again */
    var h = m.fromHash ? hashForm(location.hash) : null;
    if (h) {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* a page without an address of its own */ }
    }
    if (!quick && m.opener && m.opener.isConnected) { try { m.opener.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
  }

  /* A button whose form has since been deleted opens the default form, as the editor turns such buttons when
     a form is deleted there (a form deleted from the event console with "Delete anyway" leaves them as they
     were): a visitor never meets a dead button. */
  function open(formId, opener) {
    if (!page.started || editing()) return false;
    formId = str(formId);
    var fromButton = !!(opener && opener.hasAttribute);
    if (page.payload && !findForm(formId)) {
      return openModal(fromButton ? defaultFormId() : formId, opener, fromButton);
    }
    return openModal(formId, opener, fromButton);
  }

  /* ---------- buttons ---------- */
  var CTA = '[data-rv-form], [data-register-cta]';
  function ctaFor(target) {
    var t = target && (target.nodeType === 1 ? target : target.parentElement);
    if (!t || !t.closest) return null;
    if (t.closest('[data-rv-form-root]')) return null;
    return t.closest(CTA);
  }
  function formIdOf(el) {
    var id = str(el.getAttribute('data-rv-form')).trim();
    if (id) return id;
    return page.payload ? defaultFormId() : '';
  }
  function onClick(e) {
    if (!page.started || editing() || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = ctaFor(e.target);
    if (!el) return;
    e.preventDefault();
    /* a page saved long ago may still hold its own register pop-up (templates/_library footer): only one opens */
    if (doc.getElementById('revamp-register-modal')) e.stopPropagation();
    var id = formIdOf(el);
    if (!id && !page.payload) {
      // the definitions are still on their way: open the default form once they are here
      openModal('', el, true);
      return;
    }
    open(id, el);
  }
  function onKey(e) {
    if (!page.started || editing() || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar')) return;
    var t = e.target;
    if (!t || !t.matches || t.tagName === 'A' || t.tagName === 'BUTTON' || !t.matches(CTA)) return;
    e.preventDefault();
    open(formIdOf(t), t);
  }
  function markButtons() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-form]'), function (el) {
      if (el.tagName === 'A' && el.hasAttribute('href')) return;
      if (el.tagName === 'BUTTON') return;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  }

  /* ---------- #register and #rv-form-<id> ---------- */
  function hashForm(hash) {
    var name = str(hash).replace(/^#/, '');
    try { name = decodeURIComponent(name); } catch (e) { /* taken as written */ }
    if (name === 'register') return { name: name, id: '', isDefault: true };
    var m = /^rv-form-(.+)$/.exec(name);
    if (m && FORM_ID_RE.test(m[1])) return { name: name, id: m[1], isDefault: false };
    return null;
  }
  function onHash() {
    if (!page.started || editing() || page.mode === 'ai-view') return;
    var h = hashForm(location.hash);
    if (!h) return;
    // a part of the page by that name: the browser (or the site's own runtime) goes there
    if (doc.getElementById(h.name)) return;
    try {
      if (window.RevampSections && window.RevampSections.resolveHash && window.RevampSections.resolveHash('#' + h.name)) return;
    } catch (e) { /* theirs */ }
    var go = function () {
      var id = h.isDefault ? defaultFormId() : h.id;
      var e = id ? embedOf(id) : null;
      if (e) {
        e.el.scrollIntoView({ behavior: reducedMotion(window) ? 'auto' : 'smooth', block: 'start' });
        if (e.ctrl) e.ctrl.focusFirst(); else e.focusOnDraw = true;
        try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* as above */ }
        return;
      }
      if (page.modal && (page.modal.formId === id || page.modal.shownId === id)) return;
      openModal(id, null, h.isDefault, true);
    };
    if (page.payload || page.failed) go();
    else {
      // wait for the definitions: the default form, and which forms are drawn in place, are known then
      openModal(h.id, null, h.isDefault, true);
      var m = page.modal;
      fetchDefinitions().then(function () {
        if (!m || page.modal !== m || inUse(m.ctrl)) return;
        // the form turned out to be drawn on the page: go to it there instead
        if (embedOf(h.isDefault ? defaultFormId() : h.id)) { closeModal(true); go(); }
      });
    }
  }

  /* ---------- start ---------- */
  function start() {
    if (page.started || !doc.body) return;
    page.eventId = (function () {
      var cfg = readJson('rv-site-config');
      return str((cfg && cfg.eventId) || doc.body.getAttribute('data-rv-event-id')).trim();
    })();
    page.mode = pageMode();
    if (!page.mode) return;
    page.started = true;
    var inline = readJson('rv-forms');
    page.payload = validPayload(inline) ? inline : null;
    ensureStyles(doc);
    markButtons();
    var needFetch = page.mode === 'live' || !page.payload;
    startEmbeds();
    window.addEventListener('hashchange', onHash);
    if (needFetch) fetchDefinitions();
    onHash();
  }

  if (doc && !window.RV_FORMS_NO_AUTO) {
    /* capture, so this runs before the site's own link handling (et-runtime.js skips a link whose click
       was already dealt with) */
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
  }

  window.RevampForms = {
    version: VERSION,
    render: render,
    validate: validate,
    cleanValue: cleanValue,
    ensureStyles: ensureStyles,
    open: open,
    definitions: function () { return page.payload; }
  };
})();
