/* Builds one complete HTML document from a template folder (templates/<id>/template.json + its section files),
   or, for a generated template (id = 'gen-' + eventId), from the backend's template.json plus the shared
   section library at templates/_library/sections/ — see load()'s own comment below for that branch.

   RevampTemplates.build(id)        -> Promise<string>                the document
   RevampTemplates.load(id, opts)   -> Promise<{ template, html }>    the document plus template.json
     opts.editing    true when the editor opens it: <html data-rv-editing data-rv-editor-mode="manual">
                     (et-runtime.js holds motion back)
     opts.headExtra  extra markup for <head> (the editor's canvas stylesheet)
     opts.title      the page's <title> (the event's name); the template's short name without it
     opts.eventId    the event the page belongs to: <body data-rv-event-id>, which the live-site script falls back on

   A load that fails rejects with an Error whose message is a sentence fit to show and which carries
     status      the HTTP status; 0 when nothing answered
     code        "template-not-found" (404) | "sign-in" (401, 403, or sent to the sign-in page) | "offline" | "server"
     part        what could not be fetched: "template" | "section:<id>" | "header" | "footer"
     templateId  the id load() was called with
     url         the address that failed

   The same document is what templates/preview.html shows, what the editor loads into its iframe canvas, and what
   export will write out, so all three stay identical. Page structure mirrors the live ET microsite:
     body#… > .blur_bg + #container > [header] #content.full-width … .col-md-12.no-padding > sections  [footer]
   A header or footer is there only when template.json names one ("header" / "footer": a file in this folder).
   <body> carries data-rv-template-id. Each section's root element gets data-rv-section="<section id>" (the handle
   et-runtime.js and the editor use) and, when it has no id of its own, id="<section id>" — see sectionIds();
   its CSS follows it in <style data-rv-style>, and its script (if any) runs after all sections in
   <script data-rv-script>, as ET's inline scripts do. A section's script is its own sections/<id>/script.js
   ("script": true), behaviour shared between templates from _shared/widgets/<name>/script.js
   ("widget": "<name>"), or both, the shared one first.

   fetch() is blocked on file:// — serve the repo over http (node tools/serve.js). */
(function (global) {
  'use strict';

  var sharedBase = new URL('./', document.currentScript.src);
  var templatesBase = new URL('../', sharedBase);

  function failure(message, status, code, url) {
    var err = new Error(message);
    err.status = status;
    err.code = code;
    err.url = url;
    return err;
  }

  function apiError(body) {
    try { var j = JSON.parse(body); return j && typeof j.error === 'string' ? j.error : ''; } catch (e) { return ''; }
  }

  /* Resolves with the body as text. Calls to this site's own /api/ go through RevampAuth.authedFetch where the
     page has it (the editor, the wizard); templates/preview.html has no auth.js and relies on the session cookie.
     authedFetch sends the user to the sign-in page itself when the session is over — its error is passed on. */
  function get(url) {
    var u = new URL(url, location.href);
    var api = u.origin === location.origin && /^\/api\//.test(u.pathname);
    var authed = api && global.RevampAuth && typeof global.RevampAuth.authedFetch === 'function';
    var opts = { cache: 'no-cache' };
    if (api) opts.headers = { Accept: 'application/json' };
    return (authed ? global.RevampAuth.authedFetch(u.href, opts) : fetch(u.href, opts)).then(function (res) {
      return res.text().then(function (body) {
        // a signed-out request for a file is answered with the sign-in page, not with the file
        if (res.redirected && new URL(res.url).pathname !== u.pathname) throw failure('Please sign in again.', 401, 'sign-in', u.href);
        if (res.ok) return body;
        var signIn = res.status === 401 || res.status === 403;
        throw failure(
          apiError(body) || (res.status === 404 ? 'This site could not be found.' : signIn ? 'Please sign in again.' : 'The site could not be loaded - try again.'),
          res.status, res.status === 404 ? 'template-not-found' : signIn ? 'sign-in' : 'server', u.href);
      });
    }, function (err) {
      if (err && err.status === 401) throw failure(err.message, 401, 'sign-in', u.href);
      if (err && err.status === 0) throw failure(err.message, 0, 'offline', u.href);
      throw failure('The server could not be reached. Check your connection and try again.', 0, 'offline', u.href);
    });
  }

  /* An answer that should be JSON and is not (a proxy's error page, half a file) is a failed load, not a
     "Unexpected token" for the user to read. */
  function json(url) {
    return get(url).then(function (body) {
      try { return JSON.parse(body); } catch (e) { throw failure('The site could not be loaded - try again.', 200, 'server', new URL(url, location.href).href); }
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function styleAttr(map) {
    return Object.keys(map || {}).map(function (k) { return k + ':' + map[k]; }).join(';');
  }

  /* The opening tag of a section file's root element. A library section opens with a documentation comment and an
     imported page with its inlined <style data-rv-imported-css> blocks: both are stepped over, so that the
     attributes land on the element the section's content hangs from. m[1] ends with the tag name, m[2] is the
     tag's own attributes. */
  var ROOT_TAG = /^((?:\s*<!--[\s\S]*?-->|\s*<style[^>]*>[\s\S]*?<\/style>)*\s*<[a-zA-Z][^\s>\/]*)((?:[^>"']|"[^"]*"|'[^']*')*)/i;
  var ID_ATTR = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

  function rootHasId(html) {
    var m = ROOT_TAG.exec(html);
    ID_ATTR.lastIndex = 0;
    return !m || ID_ATTR.test(m[2]);
  }

  function tagSection(html, id, attrs) {
    return html.replace(ROOT_TAG, function (all, open, rest) {
      return open + ' data-rv-section="' + esc(id) + '"' + (attrs || '') + rest;
    });
  }

  /* A section file names a picture of the shared layer from the site root ("/templates/_shared/img/…"). In the
     document it becomes a full address, like the stylesheets in <head>, so a page finds it wherever it is
     stored and publishing treats it as it treats them. */
  function sharedAssets(html) {
    return html.replace(/(\s(?:src|href)\s*=\s*["'])\/templates\/_shared\//g, function (all, lead) { return lead + sharedBase.href; });
  }

  function stripLeadingComments(html) {
    return html.replace(/^(?:\s*<!--[\s\S]*?-->)+\s*/, '');
  }

  /* Every id the selectors of a stylesheet name. A "#" inside a declaration (a colour, url(#x)) is followed by
     "}" before the next "{", a "#" inside a selector is not. */
  function cssIds(css, into) {
    css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/#(-?[_a-zA-Z][\w-]*)(?=[^{}]*\{)/g, function (all, name) { into[name] = 1; return all; });
  }

  /* Which sections can be given id="<section id>" so that a plain "#<section id>" link reaches them.
     Only a root without an id is a candidate (the ported templates' roots keep ET's own ids, which their CSS is
     written against). An id is not given where it would change the page: when the page's shared stylesheets
     style that id (ET's bundle has #nav, #footer { display: none }, #speakers, #agenda …), when the page frame
     uses it (#container, #content, the body's id) or when an element in some section already has it. Those
     sections are still reached by their data-rv-section — et-runtime.js resolves "#<section id>" either way.
     Resolves with { "<section id>": 1 } for the sections that get one. */
  function sectionIds(t, htmls, sheets) {
    var wanting = t.sections.filter(function (s, i) { return !rootHasId(htmls[i]) && /^[A-Za-z][\w-]*$/.test(s.id); });
    if (!wanting.length) return Promise.resolve({});
    return Promise.all(sheets.map(get)).then(function (texts) {
      var taken = { container: 1, content: 1 };
      if (t.body && t.body.id) taken[t.body.id] = 1;
      texts.forEach(function (css) { cssIds(css, taken); });
      htmls.forEach(function (html) {
        var m;
        ID_ATTR.lastIndex = 0;
        while ((m = ID_ATTR.exec(html))) taken[m[1] || m[2] || m[3]] = 1;
      });
      var give = {};
      wanting.forEach(function (s) { if (!taken[s.id]) { give[s.id] = 1; taken[s.id] = 1; } });
      return give;
    }, function () { return {}; });       // the stylesheets could not be read: no id is safer than a wrong one
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
    // says which part of the site a failed fetch was for
    function part(name, job) {
      return job.catch(function (err) {
        if (!err.part) err.part = name;
        err.templateId = id;
        throw err;
      });
    }
    var tplJson = generated
      ? json('/api/generated-template?eventId=' + encodeURIComponent(id.slice(4)))
      : imported
        ? json('/api/imported-template?eventId=' + encodeURIComponent(id.slice(9)))
        : json(new URL('template.json', base));
    return part('template', tplJson).then(function (t) {
      if (opts.sectionOrder) t.sections = reorderSections(t.sections, opts.sectionOrder);
      var shared = function (p) { return new URL(p, sharedBase).href; };
      var chrome = function (name, file) { return file ? part(name, get(shared(file)).then(stripLeadingComments)) : Promise.resolve(''); };
      var jobs = [chrome('header', t.header), chrome('footer', t.footer)];
      var frameJob = null, frame = { frameOpen: '', frameClose: '' };
      t.sections.forEach(function (s) {
        var sectionPart = function (job) { return part('section:' + s.id, job); };
        if (imported && t.frame) {
          /* An import cut into sections: one request brings them all, with the page's own frame — the
             wrappers the sections stood in, and the page's CSS — which goes around the whole content. */
          if (!frameJob) frameJob = json('/api/imported-section?eventId=' + encodeURIComponent(id.slice(9)) + '&all=1');
          jobs.push(sectionPart(frameJob.then(function (r) { return String((r.sections || {})[s.id] || '<div></div>'); })), Promise.resolve(''), Promise.resolve(''));
          return;
        }
        if (imported) {
          // the page as HTML, or as JSON { html }
          jobs.push(sectionPart(get('/api/imported-section?eventId=' + encodeURIComponent(id.slice(9))).then(function (body) {
            if (!/^\s*\{/.test(body)) return body;
            try { return String(JSON.parse(body).html || ''); } catch (e) { return body; }
          })), Promise.resolve(''), Promise.resolve(''));
          return;
        }
        if (generated) {
          /* The AI-bespoke-section pipeline (functions/lib/api.js's new "Gemini writes each section"
             path, not the old fixed-library-of-components one) stores each section's real html/css in
             Firestore, served per-section via /api/generated-section — same id.slice(4) eventId pattern
             /api/generated-template already uses just above. One fetch per section; script.js never
             exists for a generated section under this pipeline, so that slot is always ''. Still pushes
             exactly 3 job slots (html, css, script) so the parts[2 + i*3 / 3 + i*3 / 4 + i*3] indexing in
             the assembly code below stays correct regardless of which branch filled them. */
          var sectionJob = sectionPart(json('/api/generated-section?eventId=' + encodeURIComponent(id.slice(4)) + '&id=' + encodeURIComponent(s.id)));
          jobs.push(sectionJob.then(function (r) { return String(r.html || ''); }), sectionJob.then(function (r) { return String(r.css || ''); }), Promise.resolve(''));
          return;
        }
        var dir = new URL('sections/' + s.id + '/', base);
        var code = [];
        if (s.widget) code.push(sectionPart(get(shared('widgets/' + encodeURIComponent(s.widget) + '/script.js'))));
        if (s.script) code.push(sectionPart(get(new URL('script.js', dir))));
        jobs.push(sectionPart(get(new URL('index.html', dir)).then(sharedAssets)), sectionPart(get(new URL('style.css', dir))),
          Promise.all(code).then(function (texts) { return texts.join('\n'); }));
      });

      function assemble(parts, ids) {
        var header = parts[0], footer = parts[1];
        var sectionsHtml = '', scripts = '';
        /* An AI-designed site opened for editing: every section is the model's writing until its owner has
           read it. The mark is saved with the page and comes off as each section is edited or approved, so
           it is given here, on the first build, and nowhere else. */
        var written = generated && opts.editing ? ' data-ai-generated="true"' : '';
        t.sections.forEach(function (s, i) {
          var html = parts[2 + i * 3], css = parts[3 + i * 3], js = parts[4 + i * 3];
          sectionsHtml += tagSection(html, s.id, (ids[s.id] ? ' id="' + esc(s.id) + '"' : '') + written) +
            '<style data-rv-style="' + esc(s.id) + '">\n' + css + '</style>\n';
          if (js) scripts += '<script data-rv-script="' + esc(s.id) + '">\n' + js + '</script>\n';
        });

        var head = [
          '<meta charset="utf-8">',
          // same as ET's: minimum-scale=1 stops phones zooming out to fit the few sections that run wider than the screen
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1, user-scalable=0">',
          '<title>' + esc(opts.title || t.name || '') + '</title>'
        ];
        (t.shared || []).forEach(function (p) { head.push('<link rel="stylesheet" href="' + esc(shared(p)) + '">'); });
        (t.fonts || []).forEach(function (href) { head.push('<link rel="stylesheet" href="' + esc(href) + '">'); });
        if (t.theme) head.push('<link rel="stylesheet" href="' + esc(new URL(t.theme, base).href) + '">');
        if (opts.headExtra) head = head.concat(opts.headExtra);
        head.push('<script src="' + esc(shared('et-runtime.js')) + '"></script>');

        var b = t.body || {}, eventId = opts.eventId || b.eventId;
        // data-rv-editor-mode="manual": the editor's canvas ("Edit myself"); see et-runtime.js, "Which editor mode"
        var html = '<!DOCTYPE html>\n<html lang="en"' + (opts.editing ? ' data-rv-editing data-rv-editor-mode="manual"' : '') + '>\n<head>\n' + head.join('\n') + '\n</head>\n' +
          '<body' + (b.id ? ' id="' + esc(b.id) + '"' : '') +
          ' data-rv-template-id="' + esc(id) + '"' +
          (eventId ? ' data-rv-event-id="' + esc(eventId) + '"' : '') +
          ' class="' + esc(b.class || '') + '" style="' + esc(styleAttr(b.style)) + '">\n' +
          frame.frameOpen + '<div class="blur_bg"></div><div id="container">\n' + header +
          '<div id="content" class="full-width"><div class="main-body"><div class="wrapper pd0 schemas"></div>' +
          '<div class="container-fluid"><div class="row"><div class="col-md-12 no-padding">\n' +
          sectionsHtml +
          '</div></div></div></div></div>\n' + footer + '</div>\n' + frame.frameClose +
          scripts + '</body>\n</html>\n';
        return { template: t, html: html };
      }

      return Promise.all(jobs.concat(frameJob ? [frameJob.then(function (r) { frame = r; })] : [])).then(function (parts) {
        var sheets = (t.shared || []).map(shared);
        if (t.theme) sheets.push(new URL(t.theme, base).href);
        return sectionIds(t, t.sections.map(function (s, i) { return parts[2 + i * 3]; }), sheets).then(function (ids) {
          return assemble(parts, ids);
        });
      });
    });
  }

  global.RevampTemplates = {
    load: load,
    build: function (id) { return load(id).then(function (r) { return r.html; }); }
  };
})(window);
