/* library-suggest.js — the speaker and sponsor library under a name field (window.RevampLibrary).

   A person types a speaker's or a sponsor's name; matches from the library (functions/lib/et-library.js: ET's own
   records of its past events, kept in EventSphere's database, and EventSphere's own events) appear under the field,
   each with its photo or logo, its designation and company (or tier) and where it is from; picking one hands it to
   the form, which fills the rest in (the owner, 11 Nov 2026: "I just put the speaker name and all the details can be
   autofilled"). Nothing is saved here: the form saves as it always does.

     RevampLibrary.attach(input, { kind: 'speakers' | 'sponsors', eventId, search(kind, q, eventId) -> Promise<{ items }>,
                                    onPick(item) })   -> { close() }
   The field becomes a combobox (WAI-ARIA 1.2): ArrowDown / ArrowUp move through the list, Enter picks, Escape closes,
   and a click outside closes it. Results come 250 ms after the last key, two letters at least; an answer that comes
   back after a newer one was asked for is dropped. ES5. */
(function (root) {
  'use strict';
  var doc = root.document;
  var seq = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* a picture's address the page may show: https, a path on this host, or a small inline picture kept in a record */
  function picOk(u) { return typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/i.test(u)); }
  function initials(name) { return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); }

  function attach(input, o) {
    if (!input || !o || typeof o.search !== 'function') return { close: function () {} };
    var kind = o.kind === 'sponsors' ? 'sponsors' : 'speakers';
    var id = (input.id || 'lib') + '-lib';
    var box = doc.getElementById(id);
    if (!box) {
      box = doc.createElement('div');
      box.id = id;
      box.className = 'lib-sugg';
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', kind === 'sponsors' ? 'Sponsors in the library' : 'Speakers in the library');
      box.hidden = true;
      input.parentNode.insertBefore(box, input.nextSibling);
    }
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    var items = [], active = -1, timer = null, mine = 0;

    function close() {
      box.hidden = true; box.innerHTML = ''; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function mark() {
      Array.prototype.forEach.call(box.querySelectorAll('[role="option"]'), function (el, i) {
        el.setAttribute('aria-selected', i === active ? 'true' : 'false');
        if (i === active && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browser */ } }
      });
      if (active >= 0) input.setAttribute('aria-activedescendant', id + '-' + active); else input.removeAttribute('aria-activedescendant');
    }
    function show(list, q) {
      items = list || [];
      active = -1;
      if (!items.length) {
        box.innerHTML = '<div class="lib-none">No match in the library for “' + esc(q) + '”. Type the details yourself.</div>';
        box.hidden = false;
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      box.innerHTML = items.map(function (it, i) {
        var pic = kind === 'sponsors' ? it.logo : it.photo;
        var thumb = picOk(pic) ? '<img src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer">' : '<span class="lib-ini">' + esc(initials(it.name)) + '</span>';
        var line = kind === 'sponsors' ? [it.tier].filter(Boolean).join('') : [it.designation, it.company].filter(Boolean).join(', ');
        var from = (it.from || []).map(function (f) { return f.label; }).filter(Boolean);
        return '<div class="lib-opt" role="option" id="' + id + '-' + i + '" aria-selected="false" data-i="' + i + '">' +
          '<span class="lib-pic' + (kind === 'sponsors' ? ' logo' : '') + '">' + thumb + '</span>' +
          '<span class="lib-txt"><b>' + esc(it.name) + '</b>' + (line ? '<span>' + esc(line) + '</span>' : '') +
          (from.length ? '<em>' + esc(from[0]) + (from.length > 1 ? ' and ' + (from.length - 1) + ' more' : '') + '</em>' : '') + '</span></div>';
      }).join('') + '<div class="lib-foot">From ETB2B’s past events and EventSphere’s own. Check it is the same ' + (kind === 'sponsors' ? 'company' : 'person') + '.</div>';
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      /* on a phone the list opens below what the dialog shows: it is brought into view, the field with it */
      if (box.scrollIntoView) { try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { /* an old browser */ } }
      Array.prototype.forEach.call(box.querySelectorAll('[data-i]'), function (el) {
        /* mousedown, so the field does not lose the pick to its own blur first */
        el.addEventListener('mousedown', function (e) { e.preventDefault(); pick(+el.getAttribute('data-i')); });
      });
    }
    function pick(i) {
      var it = items[i];
      close();
      if (it && typeof o.onPick === 'function') o.onPick(it);
    }
    function ask() {
      var q = String(input.value || '').trim();
      if (q.replace(/\s+/g, '').length < 2) { close(); return; }
      var n = ++mine;
      seq++;
      o.search(kind, q, o.eventId).then(function (r) {
        if (n !== mine || doc.activeElement !== input) return;
        show(r && r.items, q);
      }, function () { if (n === mine) close(); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(ask, 250); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden || !items.length) { if (e.key === 'Escape' && !box.hidden) { close(); e.stopPropagation(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = active <= 0 ? items.length - 1 : active - 1; mark(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    return { close: close };
  }

  root.RevampLibrary = { attach: attach, _picOk: picOk };
})(window);
