/* Internal pages of a site: one document, several addresses (templates/_shared/rv-pages.js).

   A site is ONE document. Besides its home page it may have internal pages, each with its own address, all
   sharing the top bar, the theme and the footer. The contract (functions/lib/site-pages.js applies the same
   rules on the server, from this very file):

     The page list   <meta name="rv-pages" content='[{"slug":"award-categories","title":"Award Categories"},…]'>
                     in <head> (or <script type="application/json" id="rv-pages">[…]</script>). A slug is
                     [a-z0-9-]{1,40}, "home" excepted; a title is plain text. An entry may carry a
                     "description" (plain text) for that page's search and sharing tags. No list, or an empty
                     one: a one-page site, and nothing here does anything at all.
     Which page a    a section root (data-rv-section) carrying data-rv-page="<slug>" is on that page only;
     section is on   data-rv-page="*" is on every page (the top bar, the footer — whoever builds the site sets
                     it); data-rv-page="home", or no data-rv-page at all, is the home page only (the hero).
                     Without a mark, the top bar and the footer are still recognised and shown everywhere:
                     [data-rv-section="nav" | "header" | "footer"], ET's bar and footer ([data-rv-etnav],
                     [data-rv-et-footer]) and a <nav>/<header>/<footer> section root. Anything that is not a
                     section (a pop-up, the preview ribbon) is never hidden.
     The page shown  <html data-rv-current-page="<slug>"> (the server writes it for /e/<id>/<slug> and
                     /preview/<id>/<slug>); no attribute (or "home") is the home page. The hiding is a CSS
                     rule keyed on that attribute (css() below; the server writes it into <head> as
                     <style id="rv-pages-css">), so the right page shows with no script and no flash.
     Page links      anything with data-rv-page-link="<slug>" (or "home"). Its href is set to the page's
                     address where the site is being viewed: /e/<id>/<slug> live, /preview/<id>/<slug> on a
                     preview (keeping ?draft=1 / ?staged=1 / ?version=N), and the one that is the page shown
                     gets aria-current="page". A click on one changes page in place (the address changes too,
                     back/forward work) and the window goes back to the top. A "#section" link to a section of
                     another page goes to that page first.

   On a published or previewed page this runs by itself (publishTransform puts it in the page's runtime block
   when the page has a page list). In the editor (<html data-rv-editing>) it does nothing by itself: the
   editor calls RevampPages.show(canvasDocument, slug, { links: false }) to change which page the canvas shows.

   window.RevampPages (and module.exports under node) =
     { SLUG_RE, cleanPages(list), parsePages(text), readPages(doc), css(pages), titleFor(page, siteTitle),
       pageOfElement(el), shownOn(el, slug), currentOf(doc), pageFromPath(pathname, pages),
       baseOf(pathname, pages), hrefFor(slug, location, pages), show(doc, slug, opts), init(win) }
   Browser code: ES5 only. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.RevampPages = api;
    api.init(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SLUG_RE = /^[a-z0-9-]{1,40}$/;
  var HOME = 'home';
  var MAX_PAGES = 50;
  var STYLE_ID = 'rv-pages-css';
  /* section roots that are on every page even when nobody marked them */
  var ALWAYS = ['[data-rv-section="nav"]', '[data-rv-section="header"]', '[data-rv-section="footer"]', '[data-rv-etnav]', '[data-rv-et-footer]', 'nav', 'header', 'footer'];

  function plainText(v, max) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }

  /* the page list as given -> [{ slug, title, description? }]: only valid slugs, each once, at most MAX_PAGES */
  function cleanPages(list) {
    var out = [], seen = {};
    if (!list || typeof list.length !== 'number') return out;
    for (var i = 0; i < list.length && out.length < MAX_PAGES; i++) {
      var p = list[i];
      if (!p || typeof p !== 'object') continue;
      var slug = typeof p.slug === 'string' ? p.slug.trim() : '';
      if (!SLUG_RE.test(slug) || slug === HOME || seen[slug]) continue;
      seen[slug] = 1;
      var title = plainText(p.title, 120) || slug.replace(/-+/g, ' ').trim().replace(/^./, function (c) { return c.toUpperCase(); }) || slug;
      var page = { slug: slug, title: title };
      var description = plainText(p.description, 300);
      if (description) page.description = description;
      out.push(page);
    }
    return out;
  }

  function parsePages(text) {
    if (typeof text !== 'string' || !text.trim()) return [];
    try { return cleanPages(JSON.parse(text)); } catch (e) { return []; }
  }

  function readPages(doc) {
    if (!doc || !doc.querySelector) return [];
    var meta = doc.querySelector('meta[name="rv-pages"]');
    if (meta) return parsePages(meta.getAttribute('content'));
    var script = doc.querySelector('script#rv-pages');
    return script ? parsePages(script.textContent) : [];
  }

  function q(s) { return '"' + String(s).replace(/["\\]/g, '\\$&') + '"'; }

  /* The rule that shows one page and hides the others' sections. Keyed on <html data-rv-current-page>, so it
     is the same text whichever page is shown; an empty list gives "" (a one-page site gets no rule at all). */
  function css(pages) {
    pages = cleanPages(pages);
    if (!pages.length) return '';
    var unmarked = '[data-rv-section]:not([data-rv-page])' + ALWAYS.map(function (s) { return ':not(' + s + ')'; }).join('');
    var paged = '[data-rv-page]:not([data-rv-page="*"])';
    var sel = [
      /* home: every section that belongs to another page */
      'html:not([data-rv-current-page]) ' + paged + ':not([data-rv-page="home"])',
      'html[data-rv-current-page="home"] ' + paged + ':not([data-rv-page="home"])',
      /* an internal page: the home page's sections, marked or not */
      'html[data-rv-current-page]:not([data-rv-current-page="home"]) ' + unmarked
    ];
    pages.forEach(function (p) {
      sel.push('html[data-rv-current-page=' + q(p.slug) + '] ' + paged + ':not([data-rv-page=' + q(p.slug) + '])');
    });
    return sel.join(',\n') + '{display:none!important}\n';
  }

  /* "Award Categories | ET Awards 2026": the document title of an internal page */
  function titleFor(page, siteTitle) {
    siteTitle = String(siteTitle == null ? '' : siteTitle).trim();
    if (!page) return siteTitle;
    return siteTitle && siteTitle !== page.title ? page.title + ' | ' + siteTitle : page.title;
  }

  function matchesAny(el, list) {
    for (var i = 0; i < list.length; i++) { try { if (el.matches(list[i])) return true; } catch (e) { /* old browser */ } }
    return false;
  }

  /* which page an element is on: a slug, "home", or "*" (every page) */
  function pageOfElement(el) {
    if (!el || !el.closest) return '*';
    var marked = el.closest('[data-rv-page]');
    if (marked) {
      var v = marked.getAttribute('data-rv-page');
      return v === '*' ? '*' : (v === HOME || SLUG_RE.test(v) ? v : HOME);
    }
    var sec = el.closest('[data-rv-section]');
    if (!sec) return '*';
    /* the outermost section decides (a section inside the top bar is the top bar's) */
    for (var up = sec.parentElement && sec.parentElement.closest('[data-rv-section]'); up; up = up.parentElement && up.parentElement.closest('[data-rv-section]')) sec = up;
    return matchesAny(sec, ALWAYS) ? '*' : HOME;
  }

  function shownOn(el, slug) {
    var p = pageOfElement(el);
    return p === '*' || p === (slug || HOME);
  }

  function currentOf(doc) {
    var v = doc && doc.documentElement ? doc.documentElement.getAttribute('data-rv-current-page') : null;
    return v && SLUG_RE.test(v) ? v : HOME;
  }

  function has(pages, slug) {
    for (var i = 0; i < pages.length; i++) if (pages[i].slug === slug) return pages[i];
    return null;
  }

  /* /e/<id>/<slug>, /preview/<id>/<slug>/ -> slug; anything else (the home page, another kind of address) -> "home" */
  var ADDRESS = /^(.*?\/(?:e|preview)\/[^\/]+)(?:\/([^\/]*))?\/?$/;
  function pageFromPath(pathname, pages) {
    var m = ADDRESS.exec(String(pathname || ''));
    var last = m ? (m[2] || '') : String(pathname || '').replace(/\/+$/, '').split('/').pop();
    try { last = decodeURIComponent(last); } catch (e) { /* taken as written */ }
    return last && has(cleanPages(pages), last) ? last : HOME;
  }
  /* the home page's address, from wherever the site is being viewed: "/e/<id>", "/preview/<id>" */
  function baseOf(pathname, pages) {
    pathname = String(pathname || '');
    var m = ADDRESS.exec(pathname);
    if (m) return m[1];
    var parts = pathname.replace(/\/+$/, '').split('/');
    if (parts.length > 1 && has(cleanPages(pages), parts[parts.length - 1])) parts.pop();
    return parts.join('/');
  }
  /* what a preview's address carries on to its other pages */
  function keptQuery(search) {
    var keep = [];
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (/^(draft|staged|version)=/.test(kv)) keep.push(kv);
    });
    return keep.length ? '?' + keep.join('&') : '';
  }
  /* loc: { pathname, search } (window.location) */
  function hrefFor(slug, loc, pages) {
    loc = loc || {};
    var base = baseOf(loc.pathname, pages), preview = /\/preview\/[^\/]+$/.test(base);
    var query = preview ? keptQuery(loc.search) : '';
    if (!slug || slug === HOME) return (base || '/') + query;
    return base + '/' + encodeURIComponent(slug) + query;
  }

  function ensureCss(doc, pages, editorOnly) {
    var text = css(pages), st = doc.getElementById(STYLE_ID);
    if (st) { if (st.textContent !== text) st.textContent = text; return st; }
    st = doc.createElement('style');
    st.id = STYLE_ID;
    /* the editor's copy is never saved (editor-canvas.js serialize() drops data-rv-editor); a page's own one is the
       runtime's (publishTransform writes it afresh) */
    st.setAttribute(editorOnly ? 'data-rv-editor' : 'data-rv-runtime', '');
    st.textContent = text;
    (doc.head || doc.documentElement).appendChild(st);
    return st;
  }

  /* Shows one page of the document. opts: { pages (read from doc when absent), links: false (the editor: page
     links keep the href they were saved with), location (for the links' addresses; the document's own),
     editor: true (the rule is the editor's own, never saved) }. Returns the slug shown ("home" for an unknown one). */
  function show(doc, slug, opts) {
    opts = opts || {};
    var pages = opts.pages ? cleanPages(opts.pages) : readPages(doc);
    if (!pages.length) return HOME;
    var target = slug && slug !== HOME && has(pages, slug) ? slug : HOME;
    ensureCss(doc, pages, !!opts.editor);
    var html = doc.documentElement;
    if (target === HOME) html.removeAttribute('data-rv-current-page');
    else html.setAttribute('data-rv-current-page', target);
    if (opts.links !== false) markLinks(doc, target, pages, opts.location || (doc.defaultView && doc.defaultView.location));
    return target;
  }

  function markLinks(doc, current, pages, loc) {
    var links = doc.querySelectorAll('[data-rv-page-link]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i], to = String(a.getAttribute('data-rv-page-link') || '').trim() || HOME;
      if (to !== HOME && !has(pages, to)) continue;            // a link to a page the site does not have: left alone
      if (a.tagName === 'A' && loc) a.setAttribute('href', hrefFor(to, loc, pages));
      if (to === current) a.setAttribute('aria-current', 'page');
      else if (a.getAttribute('aria-current') === 'page') a.removeAttribute('aria-current');
    }
  }

  /* ---------- a visitor's page (published or previewed) ---------- */
  function init(win) {
    if (!win || !win.document || win.__rvPages) return;
    var doc = win.document, html = doc.documentElement;
    if (html.hasAttribute('data-rv-editing')) return;           // the editor's canvas: the editor drives it
    var pages = readPages(doc);
    if (!pages.length) return;                                    // a one-page site: nothing to do
    win.__rvPages = true;
    var live = html.getAttribute('data-rv-editor-mode') !== 'ai'; // the editor's live view never changes address
    /* the server says which page this is; a copy of the page it did not serve goes by its address */
    var start = html.hasAttribute('data-rv-current-page') || !live ? currentOf(doc) : pageFromPath(win.location && win.location.pathname, pages);
    var current = show(doc, start, { pages: pages });
    var siteTitle = doc.title;
    var opening = has(pages, current);
    if (opening && siteTitle.indexOf(opening.title + ' | ') === 0) siteTitle = siteTitle.slice(opening.title.length + 3);
    else if (opening && siteTitle === opening.title) siteTitle = '';

    function go(slug, hash, push) {
      var shown = show(doc, slug, { pages: pages });
      doc.title = titleFor(has(pages, shown), siteTitle) || doc.title;
      /* for whoever shows this page (the editor's live view follows it on its canvas) */
      try { doc.dispatchEvent(new win.CustomEvent('rv:pagechange', { detail: { page: shown } })); } catch (e) { /* an old browser: nobody listens */ }
      if (push && live && win.history && win.history.pushState) {
        try { win.history.pushState({ rvPage: shown }, '', hrefFor(shown, win.location, pages) + (hash || '')); } catch (e) { /* an address of its own it cannot have */ }
      }
      if (!hash) {
        try { win.scrollTo(0, 0); } catch (e) { /* nothing to scroll */ }
        var first = null, secs = doc.querySelectorAll('[data-rv-section]');
        for (var i = 0; i < secs.length && !first; i++) if (pageOfElement(secs[i]) === shown) first = secs[i];
        var heading = first && first.querySelector('h1, h2');
        if (heading && heading.focus) {
          if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
          try { heading.focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
        }
      }
      return shown;
    }

    function plainClick(e) {
      return !(e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
    }
    /* capture: before et-runtime.js's own "#section" handling, which can then find the section shown */
    doc.addEventListener('click', function (e) {
      if (!plainClick(e)) return;
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      if (!t || !t.closest) return;
      var link = t.closest('[data-rv-page-link]');
      if (link) {
        var to = String(link.getAttribute('data-rv-page-link') || '').trim() || HOME;
        if (to !== HOME && !has(pages, to)) return;
        if (link.getAttribute('target') && link.getAttribute('target') !== '_self') return;
        if (!live) { e.preventDefault(); go(to, '', false); return; }
        if (!(win.history && win.history.pushState)) return;     // the address itself: the server shows that page
        e.preventDefault();
        if (to !== currentOf(doc)) go(to, '', true);
        else { try { win.scrollTo(0, 0); } catch (err) { /* nothing to scroll */ } }
        return;
      }
      /* "#speakers" on an internal page, the speakers being on the home page: that page first */
      var a = t.closest('a[href^="#"]');
      if (!a || a.getAttribute('href').length < 2) return;
      var id = a.getAttribute('href').slice(1);
      try { id = decodeURIComponent(id); } catch (err) { /* as written */ }
      var target = doc.getElementById(id);
      if (!target) { try { target = doc.querySelector('[data-rv-section=' + q(id) + ']'); } catch (err) { target = null; } }
      if (!target) return;
      var on = pageOfElement(target), now = currentOf(doc);
      if (on === '*' || on === now) return;
      go(on, '#' + encodeURIComponent(id).replace(/%2D/gi, '-'), true);
      /* et-runtime.js scrolls to it now that it shows; without it, the browser's own jump does */
    }, true);

    win.addEventListener('popstate', function () {
      var slug = pageFromPath(win.location.pathname, pages);
      if (slug !== currentOf(doc)) go(slug, win.location.hash, false);
    });
  }

  return {
    SLUG_RE: SLUG_RE, HOME: HOME, STYLE_ID: STYLE_ID, ALWAYS: ALWAYS.slice(),
    cleanPages: cleanPages, parsePages: parsePages, readPages: readPages, css: css, titleFor: titleFor,
    pageOfElement: pageOfElement, shownOn: shownOn, currentOf: currentOf, pageFromPath: pageFromPath,
    baseOf: baseOf, hrefFor: hrefFor, show: show, init: init
  };
});
