/* Fills a template on the editor canvas with what the user wrote in Create Event (create-event.html, steps 1 and 3).

   RevampFill.fromHandoff(draft, logo) -> ctx      the hand-off payload (buildEditorPayload) as fill input:
       ctx.content   { event: {name, slug, date, dateLabel, location, logo}, hero: {..., bannerUrl}, stats: {...}, … }
                     — step-3 data by library id (the ids of create-event.html's LIBRARY), plus the event itself
                     from step 1. event.logo is the `logo` argument (a data URL, older callers) or the hand-off's
                     event.logoUrl; hero.bannerUrl is hero.bannerUrl, hero.banner.url or an imported PSD's
                     composite image, whichever the hand-off carries; event.dateLabel is the hand-off's
                     ready-made date line when it has no structured event.date (which each slot prints in its
                     own style). A hand-off without speakers / FAQs / partners / contacts / gallery is valid:
                     those lists come from the event's records (rv-data.js).
       ctx.names     library id -> the section's name in Create Event (for telling the user what was left out)
       ctx.excluded  library ids of the template's sections the user switched off
       ctx.excludedSections   the same, by template section id (works for a section with no content.map entry too)
       ctx.generatedFromBrief   true only for a "Generate from a brief" result (create-event.html's
                     startGenerateFromBrief stamps this on the hand-off) — never a normal hand-filled wizard
                     draft. Gates the AI-provenance stamping below: a plain draft gets neither attribute.
   RevampFill.fill(doc, map, content, opts) -> { filled, hidden, sections }
       The rule engine itself: needs only a document, so it runs on the editor canvas, in the wizard's preview and
       on a published page alike. map = template.json → content.map; content = ctx.content. Every element
       carrying data-rv-section="<entry.section>" is filled, so two copies of a section show the same content.
       Running it again with the same content changes nothing; running it with different content leaves no
       trace of the earlier one.
       opts.only              run only the entries whose "from" is listed
       opts.excluded          library ids to hide            opts.excludedSections   template section ids to hide
                              (a section this hid — marked data-rv-excluded — and that is no longer listed
                              is shown again; one the owner hid in the editor is never touched)
       opts.names             section id -> name, for the report (data-sec-name on the section wins)
       opts.retag(sectionEl)  called for each section whose markup was (re)written
       opts.each(sectionEl, entry)   called after an entry ran on a section
       opts.data              true when the content is the event's records (rv-data.js): intro slots are not
                              run, "empty":"keep" is ignored — a field with no value is cleared and hidden, a
                              link loses its href, a picture is hidden (a speaker's becomes opts.avatar) — and a
                              list with no items shows no cards at all
       opts.avatar            the address of the neutral picture for a speaker without a photo (data mode)
       report.filled / hidden are section names, report.sections the section elements that were filled.
   RevampFill.apply(canvas, ctx) -> { filled, hidden, skipped, sections }      fill() on a mounted canvas; skipped
       names the Create Event sections this template has no place for.
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
   this section that are the template's OWN ported image and can never actually be replaced by this
   generation pipeline (image generation is explicitly out of scope — text content only; see A2). Gets
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

   Nothing a rule does destroys the place it writes to, because the same page is filled again and again (every
   keystroke in the wizard's preview, every visit to a live page). An element with nothing to show is hidden —
   the hidden attribute, display:none and data-rv-hidden-empty (holding the inline display it had, or "1") — and
   comes back as soon as there is a value.

   Rules (selectors are relative to the section, or to the card inside a list; ":self" is that element itself):
     { "text": sel, "value": tpl, "empty": "keep" | "remove" | "remove:<closest sel>", "skip": sel, "bind": key }
         sets the element's text; icons and other elements without text inside it stay. With an empty value the
         text is cleared, unless "empty" says to keep the template's text or to take the element (or that
         ancestor of it) off the page — hidden, as above.
         "skip": child elements that keep their own text (a heading's <span> kicker, when the heading changes)
         "bind": "event.name" | "event.date" | "event.venue" — the element goes on following that detail of
         the event (data-rv-bind, rv-data.js) when what was written is that detail itself; when it is the
         owner's own wording instead (a banner headline that is not the event's name), the element is marked
         data-rv-unbound and keeps it.
         A value of several lines is shown on several lines.
     { "bullets": sel, "items": path }     a <ul> of the item texts as the last thing inside sel (none when the list is empty)
     { "video": sel, "value": tpl, "side": tpl, "wrap": "<classes>" }
         a YouTube / Vimeo / video-file link as a 16:9 player in a <div class=wrap> at the end of sel (the start
         when side is "left") — e.g. the empty column of a two-column row; none when there is no link
     { "bgvideo": sel, "value": tpl, "poster": sel }
         a link to a video file (.mp4, .webm, .ogg, .mov) as the silent, looping background video inside sel,
         with the picture "poster" matches as its still; no video when the value is anything else. Only the
         address is written (data-src): the banner's own script decides when — and on a phone, whether — it
         is fetched.
     { "attr": sel, "name": attr, "value": tpl, "empty": "keep", "if": tpl }
         with an empty value (every slot in tpl came out empty, so "mailto:{e}" counts) the attribute is taken
         off, unless "empty":"keep" leaves the template's own value (put back if an earlier fill of the open
         page had replaced it); alt is set to "" rather than removed. With "if", the value counts as empty
         whenever that comes out empty: { …, "name": "target", "value": "_blank", "if": "{url}" }
     { "replace": sel, "value": tpl, "empty": "keep" }      the element itself becomes that text (e.g. a logo image in a heading)
     { "paragraphs": sel, "value": tpl }       one paragraph per line of the value: the matched <p>s are reused,
                                               the last one copied for more, extras removed
     { "list": sel, "items": path, "require": tpl, "empty": "hide", "key": name, "fill": [ rules ] }
         one card per item. The first time a list is filled, its cards (those sharing the first card's parent)
         are put away untouched in <template data-rv-pristine="<key>"> at the end of the section, and their
         parent is marked data-rv-list="<key>" (key: "key", else the selector). From then on every fill builds
         the cards from those models — cycling through them, so icons vary — and marks each
         data-rv-item="<from>" (plus data-rv-id when the item has an id); a card that would come out exactly as
         it already is, is left in place. "require" drops items for which it comes out empty. With no items:
         no cards when the rule says "empty":"hide" (or opts.data), otherwise the models as they are, as sample
         content. One list per parent element.
     { "drop": sel, "unless": tpl }             hides the elements when the value is empty (shown again otherwise;
                                                two drop rules on one element: either can hide it)
     { "show": sel, "if": tpl }  /  { "show": sel, "unless": tpl }
         shows the elements when the value is not empty (if) or is empty (unless), hides them otherwise — their
         content is left alone

   Values (tpl) are text with {…} slots: {hero.tagline}, {t} (a field of the current list item), {.} (the item
   itself), {#} / {##} (its position: 1 / 01), alternatives {hero.title|event.name|'Untitled'}, parts joined
   only where they have a value {r+c:', '} ("CEO, Acme" / "CEO" / "Acme"; {a+b} joins with a space), and for dates
   a style — {event.date} "27th November, 2026", {event.date:day} "27 November, 2026". */
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
  function isAddress(v) { return /^(https?:\/\/|data:image\/|blob:|\/)/i.test(String(v || '').trim()); }

  function fromHandoff(draft, logo) {
    var ev = draft.event || {};
    var content = {
      event: {
        name: ev.name || '',
        slug: ev.slug || '',
        date: ev.date || null,
        // a category without a venue (e.g. virtual) prints none; one whose venue isn't decided yet says so
        location: ev.location || (ev.hasVenue ? 'Venue to be announced' : ''),
        // a date picked in the wizard is printed by each slot in its own style (event.date); a hand-off that
        // carries only a ready-made line prints that line
        dateLabel: ev.date && ev.date.mode ? '' : (ev.dateLabel || ''),
        // event.logo in a wizard hand-off is the uploaded file's name, not somewhere a picture can be loaded from
        logo: logo || ev.logoUrl || (isAddress(ev.logo) ? ev.logo : '')
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
      // the banner picture, wherever this hand-off keeps it: an uploaded image's address, or an imported PSD's composite
      if (s.libId === 'hero') d.bannerUrl = d.bannerUrl || (d.banner && d.banner.url) || (d.psdBanner && d.psdBanner.compositeImageData) || '';
      content[s.libId] = d;
      names[s.libId] = s.name || s.libId;
    });
    return {
      content: content, names: names, excluded: draft.excluded || [], excludedSections: draft.excludedSections || [],
      generatedFromBrief: !!draft.generatedFromBrief,
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
  function valueOf(path, style, content, item) {
    var v = lookup(path, content, item);
    if (v && typeof v === 'object' && 'mode' in v) v = formatDate(v, style);
    return v != null && typeof v !== 'object' ? String(v).trim() : '';
  }
  /* info (optional) is told how many slots the text has and how many of them had a value: "mailto:{e}" with no
     e-mail is text, but it is not a value */
  function resolve(tpl, content, item, info) {
    if (tpl == null) return '';
    return String(tpl).replace(/\{([^{}]+)\}/g, function (m, expr) {
      if (info) info.slots = (info.slots || 0) + 1;
      var alts = expr.match(/(?:'[^']*'|[^|'])+/g) || [];       // split on "|", but not inside a quoted separator
      for (var i = 0; i < alts.length; i++) {
        var a = alts[i].trim(), v;
        if (/^'.*'$/.test(a)) { if (info) info.filled = (info.filled || 0) + 1; return a.slice(1, -1); }
        var style = '', colon = a.indexOf(':');
        if (colon > 0) { style = a.slice(colon + 1); a = a.slice(0, colon); }
        if (a.indexOf('+') !== -1) {
          var sep = /^\s*'.*'\s*$/.test(style) ? style.trim().slice(1, -1) : ' ';
          v = a.split('+').map(function (p) { return valueOf(p.trim(), '', content, item); }).filter(Boolean).join(sep);
        } else {
          v = valueOf(a, style, content, item);
        }
        if (v !== '') { if (info) info.filled = (info.filled || 0) + 1; return v; }
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
    if (!runs.length) {
      if (value === '') return;
      // an element emptied earlier keeps the spacing its text had after an icon: write into that node again
      var tail = el.lastChild;
      if (tail && tail.nodeType === 3) tail.nodeValue = /^\s*/.exec(tail.nodeValue)[0] + value;
      else el.appendChild(doc.createTextNode(value));
      return;
    }
    var first = runs[0];
    if (first.nodeType === 3) {
      var m = /^(\s*)[\s\S]*?(\s*)$/.exec(first.nodeValue);
      first.nodeValue = m[1] + value + m[2];
    } else {
      el.replaceChild(doc.createTextNode(value), first);
    }
    runs.slice(1).forEach(function (n) { n.remove(); });
  }
  function all(root, sel) { return sel === ':self' ? [root] : Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* an element with nothing to show leaves the page without leaving the document, so the next fill finds it */
  function hideSlot(el) {
    if (!el.hasAttribute('data-rv-hidden-empty')) {
      var was = el.style.display;
      el.setAttribute('data-rv-hidden-empty', was && was !== 'none' ? was : '1');
    }
    el.setAttribute('hidden', '');
    el.style.display = 'none';
  }
  function showSlot(el) {
    if (!el.hasAttribute('data-rv-hidden-empty')) return;
    var was = el.getAttribute('data-rv-hidden-empty');
    el.removeAttribute('data-rv-hidden-empty');
    el.removeAttribute('hidden');
    el.style.display = was === '1' ? '' : was;
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  /* "empty":"keep" on an attribute means the template's own value, not whatever an earlier fill wrote: a logo
     that was uploaded and then taken away gives the place back to the template's. The template's value is
     remembered for as long as the page stays open — never in the page itself, so nothing of it is saved. */
  var ownValues = typeof WeakMap === 'function' ? new WeakMap() : null;
  function rememberOwn(el, name) {
    if (!ownValues) return;
    var own = ownValues.get(el);
    if (!own) { own = {}; ownValues.set(el, own); }
    if (!(name in own)) own[name] = el.getAttribute(name);
  }
  function restoreOwn(el, name) {
    var own = ownValues && ownValues.get(el);
    if (!own || !(name in own)) return;
    if (own[name] == null) el.removeAttribute(name); else el.setAttribute(name, own[name]);
    delete own[name];
  }

  /* The details of the event a page can follow by itself (rv-data.js, data-rv-bind), as fill input names them.
     An element a rule wrote one of them into goes on following it; one that got the owner's own wording is
     marked as theirs, exactly as when they rewrite it by hand in the editor. */
  var BOUND = { 'event.name': '{event.name}', 'event.date': '{event.dateLabel|event.date}', 'event.venue': '{event.location}' };
  function follow(el, key, on) {
    if (on) { el.removeAttribute('data-rv-unbound'); el.setAttribute('data-rv-bind', key); return; }
    el.removeAttribute('data-rv-bind');
    el.removeAttribute('data-rv-bind-empty');
    el.setAttribute('data-rv-unbound', key);
  }

  /* env: { data, kind, avatar, dropped } — see fill() */
  function run(rules, root, content, item, env) {
    env = env || {};
    if (!env.dropped) env.dropped = [];
    (rules || []).forEach(function (r) {
      if (r.list) return fillList(r, root, content, item, env);
      if (r.paragraphs) return fillParagraphs(r, root, content, item);
      if (r.bullets) return fillBullets(r, root, content, item);
      if (r.video) return fillVideo(r, root, content);
      if (r.bgvideo) return fillBgVideo(r, root, content);
      if (r.media) return fillMedia(r, root, content);
      if (r.drop) {
        var dropIt = !resolve(r.unless, content, item);
        all(root, r.drop).forEach(function (el) {
          if (dropIt) { hideSlot(el); env.dropped.push(el); }
          else if (env.dropped.indexOf(el) === -1) showSlot(el);     // another drop rule of this run may have hidden it
        });
        return;
      }
      if (r.show) {
        var on = 'if' in r ? resolve(r['if'], content, item) !== '' : resolve(r.unless, content, item) === '';
        all(root, r.show).forEach(on ? showSlot : hideSlot);
        return;
      }
      var info = {};
      var v = resolve(r.value, content, item, info);
      var keep = r.empty === 'keep' && !env.data;
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
        if (info.slots && !info.filled) v = '';
        if ('if' in r && resolve(r['if'], content, item) === '') v = '';
        if (/^(href|src)$/i.test(r.name) && /^\s*(javascript|vbscript):/i.test(v)) v = '';
        all(root, r.attr).forEach(function (el) {
          if (v !== '') {
            if (r.empty === 'keep') rememberOwn(el, r.name);
            showSlot(el);
            el.setAttribute(r.name, v);
            return;
          }
          if (keep) { restoreOwn(el, r.name); return; }
          if (env.data && r.name === 'src' && el.tagName === 'IMG') {
            // a record without a picture never shows the template's sample one, nor the previous record's
            if (env.kind === 'speakers' && env.avatar) { showSlot(el); el.setAttribute('src', env.avatar); }
            else { el.removeAttribute('src'); hideSlot(el); }
            return;
          }
          if (r.name === 'alt') el.setAttribute('alt', ''); else el.removeAttribute(r.name);
        });
        return;
      }
      if (r.text) {
        // "remove" / "remove:<closest sel>": what leaves the page when there is no value — the element or that ancestor
        var removal = r.empty && r.empty.indexOf('remove') === 0 ? r.empty.slice(7) : null;
        var follows = r.bind && BOUND[r.bind] ? v === resolve(BOUND[r.bind], content, item) : null;
        all(root, r.text).forEach(function (el) {
          if (follows != null) follow(el, r.bind, follows);
          var target = (removal && el.closest(removal)) || el;
          if (v === '') {
            if (keep) return;
            setText(el, '', r.skip);
            if (removal != null || env.data) hideSlot(target);
            return;
          }
          showSlot(el);
          if (target !== el) showSlot(target);
          setText(el, v, r.skip);
          // an answer or a description typed on several lines keeps its lines
          if (v.indexOf('\n') !== -1) el.style.whiteSpace = 'pre-line';
          else if (el.style.whiteSpace === 'pre-line') { el.style.whiteSpace = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); }
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

  /* The places a rule adds its own box to (.rv-bullets / .rv-video / .rv-media), with the box an earlier fill put
     there taken out — so there is never more than one, and none once the value is gone. A wrap class can equal
     the host's own selector (making-ai-work's "ovr-img"), so a box is never mistaken for a host. */
  function hostsWithout(root, sel, added) {
    var isAdded = function (n) { return added.some(function (c) { return n.classList.contains(c); }); };
    return all(root, sel).filter(function (host) { return !isAdded(host); }).map(function (host) {
      Array.prototype.filter.call(host.children, isAdded).forEach(function (n) { n.remove(); });
      return host;
    });
  }

  function fillBullets(r, root, content, item) {
    var items = lookup(r.items, content, item);
    items = Array.isArray(items) ? items.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    var hosts = hostsWithout(root, r.bullets, ['rv-bullets']);
    if (!items.length) return;
    hosts.forEach(function (host) {
      var doc = host.ownerDocument, ul = doc.createElement('ul');
      ul.className = 'rv-bullets';
      ul.setAttribute('style', 'list-style:disc;padding-left:1.25em;margin:14px 0 0;display:flex;flex-direction:column;gap:6px;font-size:var(--para-font-size,16px);line-height:1.55');
      items.forEach(function (t) { var li = doc.createElement('li'); li.textContent = t; ul.appendChild(li); });
      host.appendChild(ul);
    });
  }

  function fillVideo(r, root, content) {
    var v = videoInfo(resolve(r.value, content));
    var hosts = hostsWithout(root, r.video, ['rv-video', 'rv-media']);
    if (!v) return;
    var left = (r.sideValue || resolve(r.side, content)) === 'left';
    hosts.forEach(function (host) {
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

  /* The banner's background video. Written without a src: a video that starts downloading with the page
     costs a phone visitor megabytes for something they are never shown (et-banner/script.js loads it). */
  function fillBgVideo(r, root, content) {
    var v = videoInfo(resolve(r.value, content));
    var url = v && v.kind === 'file' ? v.embed : '';
    var still = r.poster && root.querySelector(r.poster);
    var poster = (still && still.getAttribute('src')) || '';
    all(root, r.bgvideo).forEach(function (host) {
      var had = host.querySelector('video[data-rv-video]');
      if (!url) { if (had) had.remove(); return; }
      if (!had || had.getAttribute('data-src') !== url) {
        host.textContent = '';
        had = host.ownerDocument.createElement('video');
        ['muted', 'loop', 'playsinline', 'data-rv-video'].forEach(function (a) { had.setAttribute(a, ''); });
        had.setAttribute('preload', 'none');
        had.setAttribute('data-src', url);
        host.appendChild(had);
      }
      if (poster) had.setAttribute('poster', poster); else had.removeAttribute('poster');
    });
  }

  /* the section's image or video, in a new <div class=wrap> beside the text (see fillVideo) */
  function fillMedia(r, root, content) {
    var m = lookup(r.media, content);
    if (m && String(m.url || '').trim() && m.kind !== 'image') {
      return fillVideo({ video: r.sel, value: m.url, sideValue: m.side || 'right', wrap: r.wrap }, root, content);
    }
    var hosts = hostsWithout(root, r.sel, ['rv-video', 'rv-media']);
    if (!m || !String(m.url || '').trim()) return;
    hosts.forEach(function (host) {
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

  /* ---------- lists ----------
     The models of a list are kept in an inert <template data-rv-pristine="<key>"> — the last child of the list's
     section (right after the list's parent on a page without sections) — and the parent that holds the cards is
     marked data-rv-list="<key>". The models are not kept beside the cards: a sibling, even an inert one, would
     stop the last card from being :last-child, which the designs use to size their grids. And they are not
     hidden cards: those would load their sample pictures, be found by the section's own script and count as
     content of the page. */
  var TRANSIENT_MARKS = ['contenteditable', 'data-text-original', 'data-rv-item', 'data-rv-id'];

  function isItem(n) { return n.hasAttribute('data-rv-item'); }
  function childrenOf(el, test) { return Array.prototype.filter.call(el.children, test); }

  /* a card as the template wrote it: without what an edit in progress, or an earlier fill of a page saved
     before models were kept, left on it. The editor's data-editable marks stay — its tagging treats a card
     that has them and one that doesn't differently, and every copy should be tagged the same way. */
  function asModel(card) {
    var model = card.cloneNode(true);
    [model].concat(all(model, '*')).forEach(function (n) {
      TRANSIENT_MARKS.forEach(function (a) { n.removeAttribute(a); });
      n.classList.remove('ed-selected', 'sec-active');
      if (!n.getAttribute('class')) n.removeAttribute('class');
      showSlot(n);
    });
    return model;
  }

  function pristineOf(parent, key) {
    var sec = parent.closest('[data-rv-section]');
    var pool = sec ? childrenOf(sec, function (n) { return n.tagName === 'TEMPLATE'; }) : [parent.nextElementSibling];
    return pool.filter(function (t) { return t && t.tagName === 'TEMPLATE' && t.getAttribute('data-rv-pristine') === key; })[0] || null;
  }

  /* the cards (all children of parent) become the list's kept models and leave the page; from now on every
     fill draws its cards from the models */
  function keepModels(parent, key, cards) {
    var doc = parent.ownerDocument, sec = parent.closest('[data-rv-section]');
    var pristine = doc.createElement('template');
    pristine.setAttribute('data-rv-pristine', key);
    cards.forEach(function (card) { pristine.content.appendChild(asModel(card)); });
    // where the cards go when the list has other things in it too: after this many of them
    var others = childrenOf(parent, function (n) { return cards.indexOf(n) === -1; });
    if (others.length) parent.setAttribute('data-rv-list-at', String(Array.prototype.indexOf.call(parent.children, cards[0])));
    parent.setAttribute('data-rv-list', key);
    cards.forEach(function (card) { card.remove(); });
    if (sec) sec.appendChild(pristine); else parent.after(pristine);
    return pristine;
  }

  function sameParent(found, r, root) {
    if (!found.length) return found;
    var parent = found[0].parentNode;
    var cards = found.filter(function (n) { return n.parentNode === parent; });
    if (cards.length !== found.length && window.console) {
      var sec = root.closest('[data-rv-section]');
      console.warn('[RevampFill] list "' + r.list + '"' + (sec ? ' in section "' + sec.getAttribute('data-rv-section') + '"' : '') +
        ' has cards in more than one parent; only the first group is filled.');
    }
    return cards;
  }

  function buildCards(r, models, items, content, env, doc) {
    if (items.length) {
      return items.map(function (it, i) {
        var card = doc.importNode(models[i % models.length], true);
        run(r.fill, card, content, { data: it, index: i }, { data: env.data, kind: env.kind, avatar: env.avatar, building: true });
        card.setAttribute('data-rv-item', env.kind || '');
        if (it && typeof it === 'object' && it.id != null && it.id !== '') card.setAttribute('data-rv-id', String(it.id));
        return card;
      });
    }
    if (r.empty === 'hide' || env.data) return [];
    // nothing written yet: the template's own cards stand in, as sample content
    return models.map(function (model) {
      var card = doc.importNode(model, true);
      card.setAttribute('data-rv-item', '');
      return card;
    });
  }

  function fillList(r, root, content, item, env) {
    var items = lookup(r.items, content, item);       // inside a card: that card's own list (e.g. a contact category's people)
    if (!Array.isArray(items)) return;
    if (r.require) items = items.filter(function (it, i) { return resolve(r.require, content, { data: it, index: i }) !== ''; });
    var doc = root.ownerDocument, cards, parent;

    if (env.building) {
      /* a list inside a card that is itself being built from a model (a contact category's people): the card
         is fresh, so its own cards are the models, used here and now */
      cards = sameParent(all(root, r.list), r, root);
      if (!cards.length || (!items.length && r.empty !== 'hide' && !env.data)) return;
      parent = cards[0].parentNode;
      var after = cards[cards.length - 1].nextSibling;
      var built = buildCards(r, cards.map(asModel), items, content, env, doc);
      cards.forEach(function (card) { card.remove(); });
      built.forEach(function (card) { parent.insertBefore(card, after); });
      return;
    }

    var key = r.key || r.list;
    parent = [root].concat(all(root, '[data-rv-list]')).filter(function (p) { return p.getAttribute('data-rv-list') === key; })[0];
    var pristine = parent && pristineOf(parent, key);
    if (!pristine) {
      // first fill of this list — or its models were lost, and the cards on the page are the best there is
      cards = parent ? childrenOf(parent, isItem) : [];
      if (!cards.length) cards = sameParent(all(root, r.list), r, root);
      if (!cards.length) return;
      parent = cards[0].parentNode;
      var other = parent.getAttribute('data-rv-list');
      if (other && other !== key) {
        if (window.console) console.warn('[RevampFill] list "' + r.list + '" shares its parent with list "' + other + '"; it is left as it is.');
        return;
      }
      pristine = keepModels(parent, key, cards);
    }
    var models = Array.prototype.slice.call(pristine.content.children);
    if (!models.length) return;

    var drawn = childrenOf(parent, isItem);
    var others = childrenOf(parent, function (n) { return !isItem(n); });
    var at = parent.hasAttribute('data-rv-list-at') ? +parent.getAttribute('data-rv-list-at') : others.length;
    var before = drawn.length ? drawn[drawn.length - 1].nextSibling : (others[at] || null);
    cards = buildCards(r, models, items, content, env, doc);
    /* A card that comes out exactly as the one already in its place is left alone: its pictures don't load
       again, an item the visitor opened stays open, and re-filling an unchanged page changes nothing. */
    cards.forEach(function (card, i) {
      var html = card.outerHTML, had = drawn[i];
      if (had && (had.__rvDrawn || had.outerHTML) === html) return;
      card.__rvDrawn = html;
      if (had) parent.replaceChild(card, had); else parent.insertBefore(card, before);
    });
    drawn.slice(cards.length).forEach(function (old) { old.remove(); });
  }

  /* ---------- a whole page ---------- */
  function sectionsOf(doc, id) {
    return all(doc, '[data-rv-section="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
  }

  function fill(doc, map, content, opts) {
    opts = opts || {};
    map = map || [];
    content = content || {};
    var report = { filled: [], hidden: [], sections: [] };
    var names = opts.names || {};
    var nameOf = function (sec, id) { return sec.getAttribute('data-sec-name') || names[id] || id; };
    var entries = map.filter(function (m) { return !opts.only || opts.only.indexOf(m.from) !== -1; });

    /* Sections switched off in Create Event: hidden as the editor's own Hide does — the is-hidden-sec class,
       which the editor's canvas shows as a slim bar and leaves out of the published page — and shown again when
       switched back on. A document nothing styles that class in gets display:none as well. */
    var off = {};
    if (opts.excluded || opts.excludedSections) {
      var root = doc.documentElement || doc;
      var styled = !!(root.hasAttribute && root.hasAttribute('data-rv-editing'));
      (opts.excludedSections || []).forEach(function (id) { off[id] = 1; });
      entries.forEach(function (m) { if (m.from !== 'event' && (opts.excluded || []).indexOf(m.from) !== -1) off[m.section] = 1; });
      all(doc, '[data-rv-section]').forEach(function (sec) {
        var id = sec.getAttribute('data-rv-section');
        if (off[id]) {
          if (!sec.classList.contains('is-hidden-sec')) sec.setAttribute('data-rv-excluded', '1');
          sec.classList.add('is-hidden-sec');
          if (!styled) sec.style.display = 'none';
          var name = nameOf(sec, id);
          if (report.hidden.indexOf(name) === -1) report.hidden.push(name);
        } else if (sec.hasAttribute('data-rv-excluded')) {
          sec.removeAttribute('data-rv-excluded');
          sec.classList.remove('is-hidden-sec');
          if (!sec.getAttribute('class')) sec.removeAttribute('class');
          if (sec.style.display === 'none') { sec.style.display = ''; if (!sec.getAttribute('style')) sec.removeAttribute('style'); }
        }
      });
    }

    entries.forEach(function (m) {
      if (off[m.section] || !(m.from in content)) return;
      sectionsOf(doc, m.section).forEach(function (sec) {
        var rules = (m.fill || []).concat(m.intro && !opts.data ? introRules(m.from, m.intro) : []);
        run(rules, sec, content, null, { data: !!opts.data, kind: m.from, avatar: opts.avatar || '' });
        if (opts.retag) opts.retag(sec);
        var name = nameOf(sec, m.section);
        if (m.from !== 'event' && report.filled.indexOf(name) === -1) report.filled.push(name);
        if (report.sections.indexOf(sec) === -1) report.sections.push(sec);
        if (opts.each) opts.each(sec, m);
      });
    });
    return report;
  }

  function apply(canvas, ctx) {
    var spec = (canvas.template.content || {}).map || [];
    var used = { event: 1, nav: 1, footer: 1 };             // nav and footer are the shared, locked header/footer
    var names = {};
    canvas.template.sections.forEach(function (s) { names[s.id] = s.name; });
    // AI provenance (custom_editor.html's badges + publish gate): every template section id content.map
    // actually targets, whether or not it ends up genuinely filled below (e.g. making-ai-work's
    // "glimpses_event", mapped only for the show/hide toggle, "fill":[]) — anything NOT in here has no
    // content.map entry at all, i.e. a section the template deliberately leaves for a human (see the
    // mappedSections.forEach below).
    var mappedSections = {};
    spec.forEach(function (m) { mappedSections[m.section] = 1; used[m.from] = 1; });
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
    var report = fill(canvas.doc, spec, ctx.content, {
      excluded: ctx.excluded || [],
      excludedSections: ctx.excludedSections || [],
      names: names,
      retag: canvas.retag,
      each: function (sec, m) {
        // Generate-from-Brief only (ctx.generatedFromBrief) — never a normal hand-filled wizard draft. 'event'
        // is excluded: that's the human-typed step-1 name/date/venue, not the AI's to claim.
        if (ctx.generatedFromBrief && m.from !== 'event') sec.setAttribute('data-ai-generated', 'true');
        // A2 (hero banner image): generating a real replacement image is out of scope this pass
        // (text content only) — the hero's own content.map.fill rule for its background image
        // ("img.banner-bg-image") only ever fires from a banner the user supplied (hero.bannerUrl, a
        // completely separate Create Event feature); the generation pipeline never produces that field, so
        // the rule is permanently dead for a Generate-from-Brief draft, and the template's own picture would
        // otherwise sit there indistinguishable from the genuinely AI-written heading/tagline right
        // next to it inside the same data-ai-generated section. Rather than invent image generation
        // (explicitly out of scope) or leave this silently wrong, a template can name its own "this is the
        // template's own media, not the AI's" elements via a selector on the map entry itself (aiSkipMedia —
        // see templates/making-ai-work and tech500's template.json), and those get their own narrower
        // data-ai-media-skipped marker — a smaller, second signal layered onto an otherwise data-ai-generated
        // section, rather than forcing the whole hero into one all-or-nothing state it doesn't deserve.
        if (ctx.generatedFromBrief && m.aiSkipMedia) {
          all(sec, m.aiSkipMedia).forEach(function (el) { el.setAttribute('data-ai-media-skipped', 'true'); });
        }
      }
    });
    report.skipped = [];
    Object.keys(ctx.names).forEach(function (id) { if (!used[id]) report.skipped.push(ctx.names[id]); });
    // A template section with NO content.map entry at all: the template's own ported markup/copy stays
    // exactly as it was, untouched by either the wizard or the AI (templates/README.md's "sections left
    // out, and the editor says which") — flagged only for a Generate-from-Brief draft.
    if (ctx.generatedFromBrief) {
      canvas.template.sections.forEach(function (s) {
        // genuinely mapped (and NOT one of the deliberate exclusions above) means it was either already
        // stamped data-ai-generated in the each() above, or legitimately had nothing to write for
        // some other reason (e.g. a show/hide-only toggle entry) — either way, leave it alone here.
        if (mappedSections[s.id] && !excludedSections[s.id]) return;
        var sec = canvas.doc.querySelector('[data-rv-section="' + s.id + '"]');
        // an AI-designed site's sections arrive marked as the model's writing (template-loader.js): never "not generated"
        if (sec && !sec.hasAttribute('data-ai-generated')) sec.setAttribute('data-ai-skipped', 'true');
      });
    }
    return report;
  }

  window.RevampFill = {
    fromHandoff: fromHandoff, apply: apply, fill: fill, run: run, introRules: introRules, resolve: resolve,
    setText: setText, hideSlot: hideSlot, showSlot: showSlot, formatDate: formatDate, videoInfo: videoInfo
  };
})();
