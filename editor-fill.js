/* Fills a template on the editor canvas with what the user wrote in Create Event (create-event.html, steps 1 and 3).

   RevampFill.fromHandoff(draft, logo) -> ctx      the hand-off payload (buildEditorPayload) as fill input:
       ctx.content   { event: {name, slug, date, location, logo}, hero: {...}, stats: {...}, … }  — step-3 data by
                     library id (the ids of create-event.html's LIBRARY), plus the event itself from step 1
       ctx.names     library id -> the section's name in Create Event (for telling the user what was left out)
       ctx.excluded  library ids of the template's sections the user switched off
       ctx.generatedFromBrief   true only for a "Generate from a brief" result (create-event.html's
                     startGenerateFromBrief stamps this on the hand-off) — never a normal hand-filled wizard
                     draft. Gates the AI-provenance stamping below: a plain draft gets neither attribute.
   RevampFill.apply(canvas, ctx) -> { filled, hidden, skipped }      section names, for the editor to report
       Also, when ctx.generatedFromBrief: stamps each mounted section with data-ai-generated="true" (its
       content.map entry actually ran and wrote real content) or data-ai-skipped="true" — either because no
       content.map entry targets that template section id at all, OR because its content.map entry's
       `from` is one of ctx.aiSkippedLibraries (speakers/contact/glimpses — a library the generation step
       deliberately never asked to fill, even though the template DOES have a real content.map entry for
       it; see functions/lib/api.js's GENERATION_EXCLUDED_LIBRARIES). custom_editor.html's AI-provenance
       badges and publish-review gate read these two attributes as their source of truth. A section whose
       map entry ran with nothing to write for some OTHER reason (e.g. an empty "fill":[] used only for the
       show/hide toggle) gets neither — it was attempted, just not "genuinely populated".

   What goes where is data, in template.json → content.map — one entry per template section that takes content:
     { "from": "<library id | event>", "section": "<template section id>", "intro": { slots }, "fill": [ rules ],
       "aiSkipMedia": "<selector, relative to the section>" }
   "aiSkipMedia" (optional; Generate-from-Brief only — ignored on a normal hand-filled draft): elements inside
   this section that are the template's OWN ported image/video and can never actually be replaced by this
   generation pipeline (image/video generation is explicitly out of scope — text content only; see A2). Gets
   its own narrower data-ai-media-skipped marker, layered onto a section that's otherwise data-ai-generated
   for its text, instead of forcing the whole section into one all-or-nothing AI/not-AI state.

   Every Create Event section carries the same section text (create-event.html → SECTION TEXT):
     subheading · heading · body · points[] · media { kind: image|video, url, side } · cta { label, url }
   "intro" says where this template's design puts each one — only the slots the design has:
     { "subheading": sel, "heading": sel | { "sel": sel, "skip": sel }, "body": sel (its <p>s),
       "points": sel (a list is added inside), "media": { "sel": sel, "wrap": "<classes>" }, "cta": sel | { "label": sel, "link": sel } }
   It runs after "fill", so fill can set a template's defaults (e.g. "About {event.name}") that the text replaces
   when the user wrote one. Anything a design has no slot for isn't shown by that template.
   A section whose library id the user switched off is hidden (not deleted, so it can be shown again); one the draft
   doesn't have at all keeps the template's own sample content, as does any list the user left empty.

   Rules (selectors are relative to the section, or to the card inside a list):
     { "text": sel, "value": tpl, "empty": "keep" | "remove" | "remove:<closest sel>", "skip": sel }
         sets the element's text; icons and other elements without text inside it stay. With an empty value the
         text is cleared, unless "empty" says to keep the template's text or remove the element (or an ancestor).
         "skip": child elements that keep their own text (a heading's <span> kicker, when the heading changes)
     { "bullets": sel, "items": path }     a <ul> of the item texts appended inside sel (nothing when the list is empty)
     { "video": sel, "value": tpl, "side": tpl, "wrap": "<classes>" }
         a YouTube / Vimeo / video-file link as a 16:9 player in a new <div class=wrap> at the end of sel (the start
         when side is "left") — e.g. the empty column of a two-column row
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
      var d = s.data;
      // drafts from before the universal section text: Overview's video is media now
      if (s.libId === 'contact' && d.blocks) {
        // a category holds people[] (older drafts: one person per category); people with no details, and categories
        // left with nobody, aren't on the site
        d.blocks = d.blocks.map(function (b) { return b.people ? b : { t: b.t, people: [{ n: b.n, e: b.e, p: b.p }] }; })
          .map(function (b) { return { t: b.t, people: b.people.filter(function (p) { return [p.n, p.e, p.p].some(function (x) { return String(x || '').trim(); }); }) }; })
          .filter(function (b) { return b.people.length; });
      }
      if (d.video && !d.media) d.media = { kind: 'video', url: d.video.url || '', side: d.video.side || 'right' };
      content[s.libId] = d;
      names[s.libId] = s.name || s.libId;
    });
    return {
      content: content, names: names, excluded: draft.excluded || [], generatedFromBrief: !!draft.generatedFromBrief,
      // C2/C3: library ids (e.g. speakers/contact/glimpses) the generation step deliberately never wrote
      // content for on THIS draft's template — see functions/lib/api.js's GENERATION_EXCLUDED_LIBRARIES /
      // libraryToHandoffDraft. Only ever non-empty on a generatedFromBrief draft; undefined/absent on a
      // normal hand-filled wizard draft, same as generatedFromBrief itself.
      aiSkippedLibraries: draft.aiSkippedLibraries || []
    };
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
  function setText(el, value, skip) {
    var doc = el.ownerDocument;
    var runs = Array.prototype.filter.call(el.childNodes, function (n) { return hasText(n) && !(skip && n.nodeType === 1 && n.matches(skip)); });
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
      if (r.list) return fillList(r, root, content, item);
      if (r.paragraphs) return fillParagraphs(r, root, content, item);
      if (r.bullets) return fillBullets(r, root, content, item);
      if (r.video) return fillVideo(r, root, content);
      if (r.media) return fillMedia(r, root, content);
      if (r.drop) { if (!resolve(r.unless, content, item)) all(root, r.drop).forEach(function (el) { el.remove(); }); return; }
      var v = resolve(r.value, content, item);
      if (r.replace) {
        /* el.replaceWith(a bare text node) used to make this a one-shot operation: a plain text node matches
           no CSS selector, so once the real content was known (the user had typed something), a LATER
           re-fill (e.g. the preview re-running after every keystroke, or this template mounting before the
           user had typed anything at all) could never find the original element again to update it — the
           replaced text was permanently frozen at whatever it was on the very first fill. Replacing with a
           marked <span> instead keeps it re-targetable, so every later fill call can find and update the
           same spot instead of only ever getting one shot at it. */
        var marker = 'r' + String(r.replace).replace(/[^a-z0-9]+/gi, '-');
        var already = all(root, '[data-rv-replaced="' + marker + '"]');
        if (already.length) {
          already.forEach(function (el) { if (v !== '' || r.empty !== 'keep') el.textContent = v; });
        } else {
          all(root, r.replace).forEach(function (el) {
            if (v === '' && r.empty === 'keep') return;
            var span = el.ownerDocument.createElement('span');
            span.setAttribute('data-rv-replaced', marker);
            span.textContent = v;
            el.replaceWith(span);
          });
        }
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
          setText(el, v, r.skip);
        });
      }
    });
  }

  /* a video link → what to embed */
  function videoInfo(url) {
    url = String(url || '').trim();
    var m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i.exec(url);
    if (m) return { kind: 'youtube', id: m[1], embed: 'https://www.youtube.com/embed/' + m[1], thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' };
    m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(url);
    if (m) return { kind: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] };
    if (/^https?:\/\/\S+\.(mp4|webm|ogg|mov)(\?\S*)?$/i.test(url)) return { kind: 'file', embed: url };
    return null;
  }

  function fillBullets(r, root, content, item) {
    var items = lookup(r.items, content, item);
    items = Array.isArray(items) ? items.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    if (!items.length) return;
    all(root, r.bullets).forEach(function (host) {
      var doc = host.ownerDocument, ul = doc.createElement('ul');
      ul.className = 'rv-bullets';
      ul.setAttribute('style', 'list-style:disc;padding-left:1.25em;margin:14px 0 0;display:flex;flex-direction:column;gap:6px;font-size:var(--para-font-size,16px);line-height:1.55');
      items.forEach(function (t) { var li = doc.createElement('li'); li.textContent = t; ul.appendChild(li); });
      host.appendChild(ul);
    });
  }

  function fillVideo(r, root, content) {
    var v = videoInfo(resolve(r.value, content));
    if (!v) return;
    var left = (r.sideValue || resolve(r.side, content)) === 'left';
    all(root, r.video).forEach(function (host) {
      var doc = host.ownerDocument, box = doc.createElement('div');
      box.className = (r.wrap || '') + ' rv-video';
      var frame = '<div style="position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000">' +
        (v.kind === 'file'
          ? '<video src="' + v.embed.replace(/"/g, '&quot;') + '" controls playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>'
          : '<iframe src="' + v.embed + '" title="Video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>') +
        '</div>';
      box.innerHTML = frame;
      if (left) host.insertBefore(box, host.firstChild); else host.appendChild(box);
    });
  }

  /* the section's image or video, in a new <div class=wrap> beside the text (see fillVideo) */
  function fillMedia(r, root, content) {
    var m = lookup(r.media, content);
    if (!m || !String(m.url || '').trim()) return;
    if (m.kind !== 'image') return fillVideo({ video: r.sel, value: m.url, sideValue: m.side || 'right', wrap: r.wrap }, root, content);
    all(root, r.sel).forEach(function (host) {
      var doc = host.ownerDocument, box = doc.createElement('div'), img = doc.createElement('img');
      box.className = (r.wrap || '') + ' rv-media';
      img.src = m.url; img.alt = '';
      img.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:12px');
      box.appendChild(img);
      if (m.side === 'left') host.insertBefore(box, host.firstChild); else host.appendChild(box);
    });
  }

  /* intro slots → rules (see the header) */
  function introRules(from, slots) {
    var r = [], o = function (x) { return typeof x === 'string' ? { sel: x } : x; };
    ['subheading', 'heading'].forEach(function (k) {
      if (slots[k]) { var a = o(slots[k]); r.push({ text: a.sel, skip: a.skip, value: '{' + from + '.' + k + '}', empty: 'keep' }); }
    });
    if (slots.body) r.push({ paragraphs: o(slots.body).sel, value: '{' + from + '.body}' });
    if (slots.points) r.push({ bullets: o(slots.points).sel, items: from + '.points' });
    if (slots.media) { var m = o(slots.media); r.push({ media: from + '.media', sel: m.sel, wrap: m.wrap }); }
    if (slots.cta) {
      var c = o(slots.cta);
      r.push({ text: c.label || c.sel, value: '{' + from + '.cta.label}', empty: 'keep' });
      r.push({ attr: c.link || c.sel, name: 'href', value: '{' + from + '.cta.url}', empty: 'keep' });
    }
    return r;
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

  function fillList(r, root, content, item) {
    var items = lookup(r.items, content, item);       // inside a card: that card's own list (e.g. a contact category's people)
    if (!Array.isArray(items)) return;
    if (r.require) items = items.filter(function (it, i) { return resolve(r.require, content, { data: it, index: i }) !== ''; });
    var found = all(root, r.list);
    if (!found.length) return;
    if (!items.length) {
      // most lists keep the template's sample cards when the wizard has nothing yet; a rule can opt
      // out with "empty":"hide" when the section should show truly empty rather than stock content.
      // Hidden via display:none, not .remove() — the live preview re-runs apply() on the SAME mounted
      // canvas on every keystroke (no remount), so a removed card had nothing left to re-clone from the
      // moment the user typed a first real item: found/cards would come up empty forever after, even
      // once items.length was genuinely non-zero again. Keeping the node (just hidden) means it's still
      // there to find and unhide below.
      if (r.empty === 'hide') {
        var p = found[0].parentNode;
        found.filter(function (n) { return n.parentNode === p; }).forEach(function (n) {
          n.style.display = 'none';
          n.setAttribute('data-rv-hidden-empty', '1');
        });
      }
      return;
    }
    found.forEach(function (n) {
      if (n.hasAttribute('data-rv-hidden-empty')) { n.style.display = ''; n.removeAttribute('data-rv-hidden-empty'); }
    });
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
    // AI provenance (custom_editor.html's badges + publish gate): every template section id content.map
    // actually targets, whether or not it ends up genuinely filled below (e.g. making-ai-work's
    // "glimpses_event", mapped only for the show/hide toggle, "fill":[]) — anything NOT in here has no
    // content.map entry at all, i.e. a section the template deliberately leaves for a human (see the
    // mappedSections.forEach below).
    var mappedSections = {};
    spec.forEach(function (m) { mappedSections[m.section] = 1; });
    // C2/C3: sections mapped to a library the generation step deliberately excluded (ctx.aiSkippedLibraries
    // — speakers/contact/glimpses, whichever this template actually has). mappedSections alone can't tell
    // these apart from a genuinely-generated section, since both have a real content.map entry — this is
    // the real server-reported list, not a guess re-derived from content.map presence. Only counts when the
    // map entry's own "fill" is non-empty — a real, substantive mapping (speakers/contact have list-fill
    // rules) that was deliberately not invoked. An entry with "fill": [] (e.g. making-ai-work's
    // glimpses_event) was never going to write anything regardless of who's filling it — it's a pure
    // show/hide toggle — so it isn't "excluded from generation", it's just empty; it must NOT land here,
    // or it wrongly earns data-ai-skipped below for a section that was never asked to generate content.
    var excludedSections = {};
    if (ctx.generatedFromBrief && ctx.aiSkippedLibraries && ctx.aiSkippedLibraries.length) {
      spec.forEach(function (m) {
        if (ctx.aiSkippedLibraries.indexOf(m.from) !== -1 && (m.fill || []).length) excludedSections[m.section] = 1;
      });
    }
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
      run((m.fill || []).concat(m.intro ? introRules(m.from, m.intro) : []), sec, ctx.content, null);
      canvas.retag(sec);
      if (m.from !== 'event' && report.filled.indexOf(name) === -1) report.filled.push(name);
      // Generate-from-Brief only (ctx.generatedFromBrief) — never a normal hand-filled wizard draft. 'event'
      // is excluded same as above: that's the human-typed step-1 name/date/venue, not the AI's to claim.
      if (ctx.generatedFromBrief && m.from !== 'event') sec.setAttribute('data-ai-generated', 'true');
      // A2 (hero banner image/video): generating a real replacement image/video is out of scope this pass
      // (text content only) — the hero's own content.map.fill rule for its background image
      // ("img.banner-bg-image") only ever fires from a MANUAL PSD-banner upload (hero.psdBanner, a
      // completely separate Create Event feature); the generation pipeline never produces that field, so
      // the rule is permanently dead for a Generate-from-Brief draft, and the section's own <video> has no
      // content.map coverage at all — it would otherwise just sit there silently showing the ORIGINAL
      // captured event's footage, indistinguishable from the genuinely AI-written heading/tagline right
      // next to it inside the same data-ai-generated section. Rather than invent image/video generation
      // (explicitly out of scope) or leave this silently wrong, a template can name its own "this is the
      // template's own media, not the AI's" elements via a selector on the map entry itself (aiSkipMedia —
      // see templates/making-ai-work and tech500's template.json), and those get their own narrower
      // data-ai-media-skipped marker — a smaller, second signal layered onto an otherwise data-ai-generated
      // section, rather than forcing the whole hero into one all-or-nothing state it doesn't deserve.
      if (ctx.generatedFromBrief && m.aiSkipMedia) {
        all(sec, m.aiSkipMedia).forEach(function (el) { el.setAttribute('data-ai-media-skipped', 'true'); });
      }
    });
    Object.keys(ctx.names).forEach(function (id) { if (!used[id]) report.skipped.push(ctx.names[id]); });
    // A template section with NO content.map entry at all: the template's own ported markup/copy stays
    // exactly as it was, untouched by either the wizard or the AI (templates/README.md's "sections left
    // out, and the editor says which") — flagged only for a Generate-from-Brief draft.
    if (ctx.generatedFromBrief) {
      canvas.template.sections.forEach(function (s) {
        // genuinely mapped (and NOT one of the deliberate exclusions above) means it was either already
        // stamped data-ai-generated in the spec.forEach above, or legitimately had nothing to write for
        // some other reason (e.g. a show/hide-only toggle entry) — either way, leave it alone here.
        if (mappedSections[s.id] && !excludedSections[s.id]) return;
        var sec = canvas.doc.querySelector('[data-rv-section="' + s.id + '"]');
        if (sec) sec.setAttribute('data-ai-skipped', 'true');
      });
    }
    return report;
  }

  window.RevampFill = { fromHandoff: fromHandoff, apply: apply, formatDate: formatDate, videoInfo: videoInfo };
})();
