/* Builds one complete HTML document from a template folder (templates/<id>/template.json + its section files),
   or, for a generated template (id = 'gen-' + eventId), from the backend's template.json plus the shared
   section library at templates/_library/sections/ — see load()'s own comment below for that branch.

   RevampTemplates.build(id)        -> Promise<string>                the document
   RevampTemplates.load(id, opts)   -> Promise<{ template, html }>    the document plus template.json
     opts.editing    true when the editor opens it: <html data-rv-editing> (et-runtime.js holds motion back)
     opts.headExtra  extra markup for <head> (the editor's canvas stylesheet)

   The same document is what templates/preview.html shows, what the editor loads into its iframe canvas, and what
   export will write out, so all three stay identical. Page structure mirrors the live ET microsite:
     body#… > .blur_bg + #container > [header] #content.full-width … .col-md-12.no-padding > sections  [footer]
   Each section's root element gets data-rv-section="<section id>" (the handle et-runtime.js and the editor use);
   its CSS follows it in <style data-rv-style>, and its script (if any) runs after all sections in
   <script data-rv-script>, as ET's inline scripts do.

   fetch() is blocked on file:// — serve the repo over http (node tools/serve.js). */
(function (global) {
  'use strict';

  var sharedBase = new URL('./', document.currentScript.src);
  var templatesBase = new URL('../', sharedBase);

  function get(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(res.status + ' ' + url);
      return res.text();
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function styleAttr(map) {
    return Object.keys(map || {}).map(function (k) { return k + ':' + map[k]; }).join(';');
  }

  /* Every templates/_library/sections/<id>/index.html file opens with a leading documentation comment
     (<!-- Generic hero/banner... -->) — real, confirmed bug this closes: the old regex (^\s*<[a-zA-Z]…)
     anchors straight to the start of the string and has no way to look past that comment to the real tag,
     so it silently failed to match at all for every single library section, meaning NO generated template's
     section ever actually got data-rv-section — the one attribute RevampFill.apply()'s own section lookup
     (canvas.doc.querySelector('[data-rv-section="…"]')) depends on. Every content.map rule for every
     Generate-from-Brief event has therefore always hit that lookup's `if (!sec) return;` guard and silently
     done nothing, leaving every generated site showing the library's own raw unfilled placeholder copy
     ("Event name goes here") — not a caching or reopen-timing bug, the fill itself never ran, even on the
     very first load right after generation. Ported templates' own section files have no such leading
     comment, which is why those have always tagged and filled correctly.
     Now skips zero or more leading <!-- ... --> blocks (each own optional surrounding whitespace) before
     matching the real opening tag, so the attribute still lands on that real tag either way.

     Second, related, also-confirmed bug this same fix closes: the Lovable-import pipeline's own
     /api/imported-section response (functions/lib/api.js's handleImportedTemplate/handleImportedSection —
     see that handler's own CSS-inline-vs-linked comment) leads with one or more inlined <style
     data-rv-imported-css="…"> blocks before the real <div class="rv-imported"> content, by design — the
     same "first tag in the string wins" assumption that broke on a leading comment broke here too, just
     tagging a <style> element as the section root instead of the real content div. Confirmed via a real
     import + a real browser: editor-canvas.js's tagEditables()/descend() only ever walks DOWN from
     whatever data-rv-section lands on, so tagging the wrong (empty, childless) <style> element meant ZERO
     elements in the entire real imported page ever got data-editable — nothing was clickable at all, for
     every Lovable import, confirmed on a real captured page (657 real elements, 0 tagged editable).
     Now also skips zero or more leading <style>...</style> blocks, interleaved with comments in any
     order/count, before matching the real tag — covering both known cases with one fix. */
  function tagSection(html, id) {
    return html.replace(/^((?:\s*<!--[\s\S]*?-->|\s*<style[^>]*>[\s\S]*?<\/style>)*\s*<[a-zA-Z][^\s>]*)/i, '$1 data-rv-section="' + esc(id) + '"');
  }

  /* opts.sectionOrder: a full id sequence (e.g. built by create-event.html from the template's own
     layout.pinStart/pinEnd plus Gemini's reordering of what's left) — reordered sections are still fetched
     from the same per-id files, just assembled in this order. An id that isn't one of the template's own
     sections is ignored; a known id the override left out keeps its original relative position, so a
     stale/partial order can never silently drop a section. */
  function reorderSections(sections, order) {
    if (!order || !order.length) return sections;
    var byId = {}; sections.forEach(function (s) { byId[s.id] = s; });
    var placed = {}, out = [];
    order.forEach(function (id) { if (byId[id] && !placed[id]) { out.push(byId[id]); placed[id] = true; } });
    sections.forEach(function (s) { if (!placed[s.id]) out.push(s); });
    return out;
  }

  /* A "generated" template (id === 'gen-' + eventId, from the generative site-building feature) has no
     templates/<id>/ folder on disk: its template.json comes from the backend's /api/generated-template
     endpoint instead of a static file, and its sections resolve against the shared component library
     (templates/_library/sections/<sectionId>/) instead of a per-template sections/ folder. Everything past
     that point — header/footer, shared/fonts/theme head assembly, section HTML assembly, the final document
     build — is identical to a ported template, so this only branches the two things that actually differ.

     An "imported" template (id === 'imported-' + importId, from the Lovable-export import pipeline —
     see functions/lib/api.js's LOVABLE IMPORT PIPELINE block) is the same idea, a third and final branch,
     additive only: its template.json comes from /api/imported-template instead of a static file, and it
     has exactly one section whose real markup comes from /api/imported-section instead of EITHER a
     per-template sections/ folder OR the generated library — that endpoint already returns the section's
     CSS inlined into the same HTML response (see that pipeline's own CSS inline-vs-linked judgment call),
     so the "style.css" slot every other branch fetches over the network is simply never used here. */
  function load(id, opts) {
    opts = opts || {};
    var generated = /^gen-/.test(id);
    var imported = /^imported-/.test(id);
    var base = new URL(id + '/', templatesBase);
    var libraryBase = new URL('_library/sections/', templatesBase);
    var tplJson = generated
      ? get('/api/generated-template?eventId=' + encodeURIComponent(id.slice(4)))
      : imported
        ? get('/api/imported-template?eventId=' + encodeURIComponent(id.slice(9)))
        : get(new URL('template.json', base));
    return tplJson.then(JSON.parse).then(function (t) {
      if (opts.sectionOrder) t.sections = reorderSections(t.sections, opts.sectionOrder);
      var shared = function (p) { return new URL(p, sharedBase).href; };
      var jobs = [get(shared(t.header || 'header.html')), get(shared(t.footer || 'footer.html'))];
      t.sections.forEach(function (s) {
        if (imported) {
          jobs.push(get('/api/imported-section?eventId=' + encodeURIComponent(id.slice(9))), Promise.resolve(''), Promise.resolve(''));
          return;
        }
        var dir = generated ? new URL(s.id + '/', libraryBase) : new URL('sections/' + s.id + '/', base);
        jobs.push(get(new URL('index.html', dir)), get(new URL('style.css', dir)),
          s.script ? get(new URL('script.js', dir)) : Promise.resolve(''));
      });

      return Promise.all(jobs).then(function (parts) {
        var header = parts[0], footer = parts[1];
        var sectionsHtml = '', scripts = '';
        t.sections.forEach(function (s, i) {
          var html = parts[2 + i * 3], css = parts[3 + i * 3], js = parts[4 + i * 3];
          sectionsHtml += tagSection(html, s.id) + '<style data-rv-style="' + esc(s.id) + '">\n' + css + '</style>\n';
          if (js) scripts += '<script data-rv-script="' + esc(s.id) + '">\n' + js + '</script>\n';
        });

        var head = [
          '<meta charset="utf-8">',
          // same as ET's: minimum-scale=1 stops phones zooming out to fit the few sections that run wider than the screen
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1, user-scalable=0">',
          '<title>' + esc(t.title || t.name) + '</title>'
        ];
        (t.shared || []).forEach(function (p) { head.push('<link rel="stylesheet" href="' + esc(shared(p)) + '">'); });
        (t.fonts || []).forEach(function (href) { head.push('<link rel="stylesheet" href="' + esc(href) + '">'); });
        if (t.theme) head.push('<link rel="stylesheet" href="' + esc(new URL(t.theme, base).href) + '">');
        if (opts.headExtra) head = head.concat(opts.headExtra);
        head.push('<script src="' + esc(shared('et-runtime.js')) + '"></script>');

        var b = t.body || {};
        var html = '<!DOCTYPE html>\n<html lang="en"' + (opts.editing ? ' data-rv-editing' : '') + '>\n<head>\n' + head.join('\n') + '\n</head>\n' +
          '<body' + (b.id ? ' id="' + esc(b.id) + '"' : '') +
          (b.eventId ? ' data-rv-event-id="' + esc(b.eventId) + '"' : '') +
          ' class="' + esc(b.class || '') + '" style="' + esc(styleAttr(b.style)) + '">\n' +
          '<div class="blur_bg"></div><div id="container">\n' + header +
          '<div id="content" class="full-width"><div class="main-body"><div class="wrapper pd0 schemas"></div>' +
          '<div class="container-fluid"><div class="row"><div class="col-md-12 no-padding">\n' +
          sectionsHtml +
          '</div></div></div></div></div>\n' + footer + '</div>\n' +
          scripts + '</body>\n</html>\n';
        return { template: t, html: html };
      });
    });
  }

  global.RevampTemplates = {
    load: load,
    build: function (id) { return load(id).then(function (r) { return r.html; }); }
  };
})(window);
