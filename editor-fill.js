/* Fills a template on the editor canvas with what the user wrote in Create Event (create-event.html, steps 1 and 3).

   RevampFill.fromHandoff(draft, logo) -> ctx      the hand-off payload (buildEditorPayload) as fill input:
       ctx.content   { event: {name, slug, date, location, logo}, hero: {...}, stats: {...}, … }  — step-3 data by
                     library id (the ids of create-event.html's LIBRARY), plus the event itself from step 1
       ctx.names     library id -> the section's name in Create Event (for telling the user what was left out)
       ctx.excluded  library ids of the template's sections the user switched off
   RevampFill.apply(canvas, ctx) -> { filled, hidden, skipped }      section names, for the editor to report

   What goes where is data, in template.json → content.map — one entry per template section that takes content:
     { "from": "<library id | event>", "section": "<template section id>", "fill": [ rules ] }
   A section whose library id the user switched off is hidden (not deleted, so it can be shown again); one the draft
   doesn't have at all keeps the template's own sample content, as does any list the user left empty.

   Rules (selectors are relative to the section, or to the card inside a list):
     { "text": sel, "value": tpl, "empty": "keep" | "remove" | "remove:<closest sel>" }
         sets the element's text; icons and other elements without text inside it stay. With an empty value the
         text is cleared, unless "empty" says to keep the template's text or remove the element (or an ancestor).
     { "attr": sel, "name": attr, "value": tpl, "empty": "keep" }
     { "replace": sel, "value": tpl, "empty": "keep" }      the element itself becomes that text (e.g. a logo image in a heading)
     { "paragraphs": sel, "value": tpl }       one paragraph per line of the value: the matched <p>s are reused,
                                               the last one copied for more, extras removed
     { "list": sel, "items": path, "require": tpl, "fill": [ rules ] }
         one card per item: the template's cards are reused in order and copied (cycling through them, so icons vary)
         when there are more items, extras removed. "require" drops items for which it comes out empty.
     { "drop": sel, "unless": tpl }             removes the elements when the value is empty

   Values (tpl) are text with {…} slots: {hero.tagline}, {t} (a field of the current list item), {.} (the item
   itself), {#} / {##} (its position: 1 / 01), alternatives {hero.title|event.name|'Untitled'}, and for dates a
   style — {event.date} "27th November, 2026", {event.date:day} "27 November, 2026". */
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- the event date, in the way ET's sites print it ---------- */
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function localDate(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');       // "2026-11-27" or "2026-11-27T09:30" — read as local, not UTC
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function formatDate(d, style) {
    if (!d) return '';
    var day = function (x) { return style === 'day' ? String(x.getDate()) : ordinal(x.getDate()); };
    switch (d.mode) {
      case 'none': return '';
      case 'tbd': return d.note || 'Date to be announced';
      case 'month':
        var mm = /^(\d{4})-(\d{2})/.exec(d.month || '');
        return mm ? MONTHS[+mm[2] - 1] + ' ' + mm[1] : '';
      case 'quarter': return d.year ? d.quarter + ' ' + d.year : '';
      default:
        var s = localDate(d.start), e = localDate(d.end);
        if (!s) return '';
        if (!e || e.getTime() === s.getTime()) return day(s) + ' ' + MONTHS[s.getMonth()] + ', ' + s.getFullYear();
        if (s.getFullYear() !== e.getFullYear()) {
          return day(s) + ' ' + MONTHS[s.getMonth()] + ', ' + s.getFullYear() + ' – ' + day(e) + ' ' + MONTHS[e.getMonth()] + ', ' + e.getFullYear();
        }
        if (s.getMonth() !== e.getMonth()) return day(s) + ' ' + MONTHS[s.getMonth()] + ' – ' + day(e) + ' ' + MONTHS[e.getMonth()] + ', ' + e.getFullYear();
        return day(s) + ' – ' + day(e) + ' ' + MONTHS[e.getMonth()] + ', ' + e.getFullYear();
    }
  }

  /* ---------- the hand-off, as fill input ---------- */
  function fromHandoff(draft, logo) {
    var ev = draft.event || {};
    var content = {
      event: {
        name: ev.name || '',
        slug: ev.slug || '',
        date: ev.date || null,
        // a category without a venue (e.g. virtual) prints none; one whose venue isn't decided yet says so
        location: ev.location || (ev.hasVenue ? 'Venue to be announced' : ''),
        logo: logo || ''
      }
    };
    var names = {};
    (draft.sections || []).forEach(function (s) {
      if (!s.libId || content[s.libId] || !s.data) return;
      content[s.libId] = s.data;
      names[s.libId] = s.name || s.libId;
    });
    return { content: content, names: names, excluded: draft.excluded || [] };
  }

  /* ---------- values ---------- */
  function lookup(path, content, item) {
    if (item && path === '.') return item.data;
    if (item && path === '#') return String(item.index + 1);
    if (item && path === '##') return (item.index < 9 ? '0' : '') + (item.index + 1);
    var parts = path.split('.');
    var from = item && item.data && typeof item.data === 'object' && parts[0] in item.data ? item.data : content;
    for (var i = 0; i < parts.length && from != null; i++) from = from[parts[i]];
    return from;
  }
  function resolve(tpl, content, item) {
    if (tpl == null) return '';
    return String(tpl).replace(/\{([^{}]+)\}/g, function (m, expr) {
      var alts = expr.split('|');
      for (var i = 0; i < alts.length; i++) {
        var a = alts[i].trim();
        if (/^'.*'$/.test(a)) return a.slice(1, -1);
        var style = '', colon = a.indexOf(':');
        if (colon > 0) { style = a.slice(colon + 1); a = a.slice(0, colon); }
        var v = lookup(a, content, item);
        if (v && typeof v === 'object' && 'mode' in v) v = formatDate(v, style);
        if (v != null && typeof v !== 'object' && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    }).trim();
  }

  /* ---------- the page ---------- */
  function hasText(n) {
    return n.nodeType === 3 ? /\S/.test(n.nodeValue) : n.nodeType === 1 && (n.tagName === 'BR' || /\S/.test(n.textContent));
  }
  /* the element's words become value; icons (<i>, <svg>, <img>, empty spans) stay where they are, and the first run of
     text keeps its surrounding spaces, so "<i class='bi-calendar3'></i> 27th November" stays spaced the same */
  function setText(el, value) {
    var doc = el.ownerDocument;
    var runs = Array.prototype.filter.call(el.childNodes, hasText);
    if (!runs.length) { el.appendChild(doc.createTextNode(value)); return; }
    var first = runs[0];
    if (first.nodeType === 3) {
      var m = /^(\s*)[\s\S]*?(\s*)$/.exec(first.nodeValue);
      first.nodeValue = m[1] + value + m[2];
    } else {
      el.replaceChild(doc.createTextNode(value), first);
    }
    runs.slice(1).forEach(function (n) { n.remove(); });
  }
  function all(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function run(rules, root, content, item) {
    (rules || []).forEach(function (r) {
      if (r.list) return fillList(r, root, content);
      if (r.paragraphs) return fillParagraphs(r, root, content, item);
      if (r.drop) { if (!resolve(r.unless, content, item)) all(root, r.drop).forEach(function (el) { el.remove(); }); return; }
      var v = resolve(r.value, content, item);
      if (r.replace) {
        all(root, r.replace).forEach(function (el) { if (v !== '' || r.empty !== 'keep') el.replaceWith(el.ownerDocument.createTextNode(v)); });
        return;
      }
      if (r.attr) {
        all(root, r.attr).forEach(function (el) { if (v !== '' || r.empty !== 'keep') el.setAttribute(r.name, v); });
        return;
      }
      if (r.text) {
        all(root, r.text).forEach(function (el) {
          if (v === '' && r.empty === 'keep') return;
          if (v === '' && r.empty && r.empty.indexOf('remove') === 0) {
            var up = r.empty.slice(7);
            ((up && el.closest(up)) || el).remove();
            return;
          }
          setText(el, v);
        });
      }
    });
  }

  function fillParagraphs(r, root, content, item) {
    var parts = resolve(r.value, content, item).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var ps = all(root, r.paragraphs);
    if (!parts.length || !ps.length) return;              // nothing written: the template's copy stays
    var last = ps[ps.length - 1];
    parts.forEach(function (text, i) {
      var p = ps[i];
      if (!p) { p = last.cloneNode(true); last.after(p); ps.push(p); }
      setText(p, text);
      last = p;
    });
    ps.slice(parts.length).forEach(function (p) { p.remove(); });
  }

  function fillList(r, root, content) {
    var items = lookup(r.items, content);
    if (!Array.isArray(items)) return;
    if (r.require) items = items.filter(function (it, i) { return resolve(r.require, content, { data: it, index: i }) !== ''; });
    var found = all(root, r.list);
    if (!items.length || !found.length) return;           // an empty list keeps the template's sample cards
    var parent = found[0].parentNode;
    var cards = found.filter(function (n) { return n.parentNode === parent; });
    var models = cards.map(function (n) { return n.cloneNode(true); });
    var last = cards[cards.length - 1];
    items.forEach(function (it, i) {
      var card = cards[i];
      if (!card) { card = models[i % models.length].cloneNode(true); last.after(card); }
      run(r.fill, card, content, { data: it, index: i });
      last = card;
    });
    cards.slice(items.length).forEach(function (n) { n.remove(); });
  }

  function apply(canvas, ctx) {
    var spec = (canvas.template.content || {}).map || [];
    var report = { filled: [], hidden: [], skipped: [] };
    var used = { event: 1, nav: 1, footer: 1 };             // nav and footer are the shared, locked header/footer
    var names = {};
    canvas.template.sections.forEach(function (s) { names[s.id] = s.name; });
    spec.forEach(function (m) {
      used[m.from] = 1;
      var sec = canvas.doc.querySelector('[data-rv-section="' + m.section + '"]');
      if (!sec) return;
      var name = sec.getAttribute('data-sec-name') || names[m.section] || m.section;
      if (m.from !== 'event' && ctx.excluded.indexOf(m.from) !== -1) {
        sec.classList.add('is-hidden-sec');                 // as the editor's own Hide does
        sec.style.display = 'none';
        if (report.hidden.indexOf(name) === -1) report.hidden.push(name);
        return;
      }
      if (!(m.from in ctx.content)) return;
      run(m.fill, sec, ctx.content, null);
      canvas.retag(sec);
      if (m.from !== 'event' && report.filled.indexOf(name) === -1) report.filled.push(name);
    });
    Object.keys(ctx.names).forEach(function (id) { if (!used[id]) report.skipped.push(ctx.names[id]); });
    return report;
  }

  window.RevampFill = { fromHandoff: fromHandoff, apply: apply, formatDate: formatDate };
})();
