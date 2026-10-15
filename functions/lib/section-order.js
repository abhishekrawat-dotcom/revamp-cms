/* Where the sections of an AI-designed site stand. One rule the model is not left to remember: this edition's
   sponsors come straight after the hero banner, ahead of the overview. Every other section keeps the order the
   plan gave it, and the "Previous Edition Sponsors" section (prev-sections.js) stays with the other previous-
   edition sections. A site with no sponsors section keeps its order as it is.

     sponsorsId(list)                 -> the id of this edition's sponsors section in a list of sections
                                         ({ id, kind, prebuilt? }), or ''
     sponsorsFirst(planSections)      -> designPlan.sections (no nav/hero/footer) with that section first
     sponsorsAfterHero(sections, plan)-> a page's sections (nav, hero, …, footer) with it right after the hero;
                                         plan: designPlan.sections, which names the section when it is given
     orderNavLinks(navHtml, ids)      -> the top bar's links to sections of the page, in the order of ids
                                         (the page's section ids, top to bottom)

   All return new arrays / strings and never drop or add a section. */

/* a sponsors / partners list under its usual names: "sponsors", "our-partners", "sponsors-and-partners", … */
var SPONSORS_ID = /^(our-|event-|summit-|this-year-s-|this-years-)?(sponsors?|partners?)(-(and|&)-(sponsors?|partners?))?$/;
/* sections about the past, or asking to become one, are not this edition's list */
var NOT_SPONSORS = /^(previous|past|prior|last)-|become|partner-with|sponsor-with|sponsorship|opportunit|enquir|join/;

function isPast(s) { return !!(s && (s.prebuilt || NOT_SPONSORS.test(String(s.id || '')))); }

function sponsorsId(list) {
  list = Array.isArray(list) ? list.filter(function (s) { return s && s.id; }) : [];
  /* the section of kind "partners" (the twelve standard sections give Sponsors that kind), else one named so */
  var byKind = list.filter(function (s) { return s.kind === 'partners' && !isPast(s); })[0];
  if (byKind) return String(byKind.id);
  var byName = list.filter(function (s) { return !isPast(s) && SPONSORS_ID.test(String(s.id)); })[0];
  return byName ? String(byName.id) : '';
}

function sponsorsFirst(planSections) {
  var list = Array.isArray(planSections) ? planSections.slice() : [];
  var id = sponsorsId(list);
  if (!id) return list;
  var at = list.map(function (s) { return s && s.id; }).indexOf(id);
  if (at <= 0) return list;
  var moved = list.splice(at, 1)[0];
  list.unshift(moved);
  return list;
}

function sponsorsAfterHero(sections, planSections) {
  var list = Array.isArray(sections) ? sections.slice() : [];
  var ids = list.map(function (s) { return s && s.id; });
  var id = sponsorsId(planSections);
  if (!id || ids.indexOf(id) === -1) id = sponsorsId(list.filter(function (s) { return s && ['nav', 'hero', 'footer'].indexOf(s.id) === -1; }));
  var at = ids.indexOf(id);
  if (!id || at === -1) return list;
  /* after the hero; with no hero, after the top bar; with neither, first */
  var after = ids.indexOf('hero') !== -1 ? ids.indexOf('hero') : ids.indexOf('nav');
  if (at === after + 1) return list;
  var moved = list.splice(at, 1)[0];
  after = list.map(function (s) { return s && s.id; }).indexOf(after === -1 ? '' : ids[after]);
  list.splice(after + 1, 0, moved);
  return list;
}

/* ---------- the top bar's links, in page order ----------
   A link is a <li> holding one <a href="#id"> (or a bare <a href="#id">). Links standing next to each other
   (nothing but white space between them) form one row — the bar's list, or a separate mobile menu — and each
   row is put in order on its own: the links to sections of the page take the places such links had, sorted by
   where their section stands; anything else in the row (a link elsewhere, a button) stays where it is. */
var ITEM = /<li\b[^>]*>\s*<a\b[^>]*>[\s\S]*?<\/a>\s*<\/li>|<a\b[^>]*>[\s\S]*?<\/a>/gi;
function hrefId(item) {
  var a = /<a\b([^>]*)>/i.exec(item);
  var m = a && /\shref\s*=\s*["']#([^"']+)["']/i.exec(' ' + a[1]);
  return m ? m[1] : null;
}
/* a call to action in the bar (as genDesign's capNavLinks tells them) stays where it is */
function isButton(item) {
  var a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(item) || ['', '', ''];
  var text = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(btn|button|cta)\b|data-register-cta/i.test(a[1]) || /^(register|book|request|apply|nominate|buy)/i.test(text);
}
function orderNavLinks(html, ids) {
  html = String(html || '');
  ids = Array.isArray(ids) ? ids : [];
  var items = [], m;
  ITEM.lastIndex = 0;
  while ((m = ITEM.exec(html))) items.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  if (items.length < 2) return html;
  var rows = [], row = [items[0]];
  for (var i = 1; i < items.length; i++) {
    if (/^\s*$/.test(html.slice(items[i - 1].end, items[i].start))) row.push(items[i]);
    else { rows.push(row); row = [items[i]]; }
  }
  rows.push(row);
  var out = html;
  /* from the end, so the positions found above stay true */
  rows.slice().reverse().forEach(function (r) {
    var movable = r.filter(function (it) {
      var id = hrefId(it.text);
      return id && id !== 'hero' && id !== 'top' && ids.indexOf(id) !== -1 && !/data-rv-(et-)?logo/i.test(it.text) && !isButton(it.text);
    });
    if (movable.length < 2) return;
    var sorted = movable.slice().sort(function (a, b) {
      return ids.indexOf(hrefId(a.text)) - ids.indexOf(hrefId(b.text)) || a.start - b.start;
    });
    var k = 0;
    var text = r.map(function (it, j) {
      var piece = movable.indexOf(it) !== -1 ? sorted[k++].text : it.text;
      var gap = j < r.length - 1 ? html.slice(it.end, r[j + 1].start) : '';
      return piece + gap;
    }).join('');
    out = out.slice(0, r[0].start) + text + out.slice(r[r.length - 1].end);
  });
  return out;
}

module.exports = { sponsorsId: sponsorsId, sponsorsFirst: sponsorsFirst, sponsorsAfterHero: sponsorsAfterHero, orderNavLinks: orderNavLinks };
