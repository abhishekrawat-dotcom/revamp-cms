/* "Edit with AI" on a site's preview (/preview/<id>; added by functions/lib/api.js publishTransform with
   opts.editButton — never on a published page, never on a saved version opened for review, never in the
   editor's own live view). It changes nothing here: the site's one copy is the editor's, so the button only
   takes the person there, in "Edit with AI" mode, at the section they were looking at:
     /custom_editor.html?event=<id>&template=<template id>&mode=ai&section=<data-rv-key>
   The preview the editor's own Preview button opened still knows that editor tab (window.opener). Then that
   tab is switched to "Edit with AI" at the section and this one closes, so the event is never open in two
   editors at once (the two would overwrite each other's work). Otherwise this tab becomes the editor.

   It sits with the theme switcher (rv-theme-switcher.js) in one column at the bottom right, in the same dark
   box style; the switcher can still be closed on its own. Event and template come from the page's
   <script id="rv-site-config">. */
(function () {
  'use strict';
  var cfgEl = document.getElementById('rv-site-config'), cfg = null;
  try { cfg = JSON.parse(cfgEl ? cfgEl.textContent : 'null'); } catch (e) { cfg = null; }
  if (!cfg || cfg.mode !== 'preview' || !cfg.eventId) return;
  if (document.documentElement.getAttribute('data-rv-editor-mode')) return;       // inside the editor itself
  if (document.querySelector('[data-rv-preview-edit]')) return;

  /* the section the person is looking at: the one across the upper third of the window */
  function sectionInView() {
    var line = window.innerHeight * 0.33, best = null;
    Array.prototype.some.call(document.querySelectorAll('[data-rv-section]'), function (sec) {
      if (sec.parentElement && sec.parentElement.closest('[data-rv-section]')) return false;
      var r = sec.getBoundingClientRect();
      if (r.height < 2) return false;
      if (!best && r.bottom > 0) best = sec;
      if (r.top <= line && r.bottom > line) { best = sec; return true; }
      return false;
    });
    return best ? (best.getAttribute('data-rv-key') || best.getAttribute('data-rv-section') || '') : '';
  }

  function editorUrl(section) {
    var q = 'event=' + encodeURIComponent(cfg.eventId) + (cfg.templateId ? '&template=' + encodeURIComponent(cfg.templateId) : '') + '&mode=ai';
    return '/custom_editor.html?' + q + (section ? '&section=' + encodeURIComponent(section) : '');
  }

  /* the editor tab that opened this preview, when it is this event's */
  function openerEditor() {
    try {
      var o = window.opener;
      if (!o || o.closed || o.location.origin !== location.origin || o.location.pathname !== '/custom_editor.html') return null;
      var mode = o.RevampEditorMode;
      return mode && typeof mode.openAt === 'function' && mode.eventId() === cfg.eventId ? mode : null;
    } catch (e) { return null; }       // another origin, or a closed tab
  }

  var dock = document.createElement('div');
  dock.setAttribute('data-rv-preview-dock', '');
  dock.style.cssText = 'position:fixed;right:16px;bottom:44px;z-index:2147483001;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:min(320px,calc(100vw - 32px))';

  var link = document.createElement('a');
  link.setAttribute('data-rv-preview-edit', '');
  link.href = editorUrl('');
  link.title = 'Open the editor in “Edit with AI” mode at this section';
  link.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">' +
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>' +
    '<span>Edit with AI</span>';
  link.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:14px;background:#191b1f;color:#ffffff;' +
    'box-shadow:0 12px 32px rgba(0,0,0,.35);font:700 13px/1.3 Inter,Arial,sans-serif;text-decoration:none;border:1px solid rgba(255,255,255,.18);cursor:pointer';
  var note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.style.cssText = 'display:none;padding:10px 12px;border-radius:12px;background:#191b1f;color:#ffffff;font:500 12.5px/1.4 Inter,Arial,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.35)';

  // the address follows the section in view, so a middle click or "open in new tab" lands there too
  function refresh() { link.href = editorUrl(sectionInView()); }
  link.addEventListener('mouseenter', refresh);
  link.addEventListener('focus', refresh);
  link.addEventListener('click', function (e) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { refresh(); return; }     // a new tab: the browser's choice
    e.preventDefault();
    var section = sectionInView(), editor = openerEditor();
    if (editor && editor.openAt(section)) {
      try { window.opener.focus(); } catch (err) { /* the browser decides */ }
      window.close();
      // still here: this tab may not be closed by script — say where the change went
      setTimeout(function () {
        note.textContent = 'Your editor tab is now in “Edit with AI” mode at this section. Switch back to it to carry on.';
        note.style.display = 'block';
      }, 300);
      return;
    }
    location.href = editorUrl(section);
  });

  function mount() {
    var switcher = document.querySelector('[data-rv-theme-switcher]');
    if (switcher) {
      // one column: the theme box keeps its own close button and look, without its own fixed place
      switcher.style.position = 'static';
      switcher.style.right = switcher.style.bottom = 'auto';
      switcher.style.maxWidth = '100%';
      dock.appendChild(switcher);
    }
    dock.appendChild(note);
    dock.appendChild(link);
    document.body.appendChild(dock);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
