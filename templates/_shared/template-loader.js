/* Builds one complete HTML document from a template folder (templates/<id>/template.json + its section files).

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

  function tagSection(html, id) {
    return html.replace(/^(\s*<[a-zA-Z][^\s>]*)/, '$1 data-rv-section="' + esc(id) + '"');
  }

  function load(id, opts) {
    opts = opts || {};
    var base = new URL(id + '/', templatesBase);
    return get(new URL('template.json', base)).then(JSON.parse).then(function (t) {
      var shared = function (p) { return new URL(p, sharedBase).href; };
      var jobs = [get(shared(t.header || 'header.html')), get(shared(t.footer || 'footer.html'))];
      t.sections.forEach(function (s) {
        var dir = new URL('sections/' + s.id + '/', base);
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
          '<body' + (b.id ? ' id="' + esc(b.id) + '"' : '') + ' class="' + esc(b.class || '') + '" style="' + esc(styleAttr(b.style)) + '">\n' +
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
