/* Where the sections of an AI-designed site stand. One rule the model is not left to remember: the sponsors
   come straight after the hero banner, ahead of the overview — this edition's sponsors section, and directly
   under it the "Previous Edition Sponsors" section (prev-sections.js). Every other section keeps the order the
   plan gave it. A site with neither keeps its order as it is.

   Why both: this edition's sponsors section is hidden until the ops team adds partner records (data-rv-empty),
   which on a new site is most of its life — the previous edition's logos are then the only sponsors a visitor
   sees, and the owner's "sponsors on top after the header banner" means them (brand-world-summit-2026).
   WITH_PREVIOUS = false keeps "Previous Edition Sponsors" with the other previous-edition sections instead.

     sponsorsId(list)                 -> the id of this edition's sponsors section in a list of sections
                                         ({ id, kind, prebuilt? }), or ''
     previousSponsorsId(list)         -> the id of the previous edition's sponsors section, or ''
     sponsorsFirst(planSections)      -> designPlan.sections (no nav/hero/footer) with the sponsors first
     sponsorsAfterHero(sections, plan)-> a page's sections (nav, hero, …, footer) with them right after the hero;
                                         plan: designPlan.sections, which names the sections when it is given
     orderNavLinks(navHtml, ids)      -> the top bar's links to sections of the page, in the order of ids
                                         (the page's section ids, top to bottom)

   All return new arrays / strings and never drop or add a section. */

var WITH_PREVIOUS = true;

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

/* the previous edition's sponsors: prebuilt "sponsors" in a plan, its fixed id on a stored page */
function previousSponsorsId(list) {
  list = Array.isArray(list) ? list.filter(function (s) { return s && s.id; }) : [];
  var hit = list.filter(function (s) { return s.prebuilt === 'sponsors'; })[0] || list.filter(function (s) { return s.id === 'previous-sponsors'; })[0];
  return hit ? String(hit.id) : '';
}

/* the ids that open the page, in order: this edition's sponsors, then the previous edition's */
function groupIds(list, named) {
  var have = (list || []).map(function (s) { return s && s.id; });
  var cur = named && named.cur && have.indexOf(named.cur) !== -1 ? named.cur : sponsorsId(list);
  var prev = WITH_PREVIOUS ? (named && named.prev && have.indexOf(named.prev) !== -1 ? named.prev : previousSponsorsId(list)) : '';
  return [cur, prev].filter(function (id, i, a) { return id && a.indexOf(id) === i; });
}

/* list with the sections named by group taken out and put back as one run at index `at` (counted in the list
   as it stands without them) */
function placeRun(list, group, at) {
  var run = group.map(function (id) { return list.filter(function (s) { return s && s.id === id; })[0]; });
  var rest = list.filter(function (s) { return run.indexOf(s) === -1; });
  return rest.slice(0, at).concat(run, rest.slice(at));
}

function sponsorsFirst(planSections) {
  var list = Array.isArray(planSections) ? planSections.slice() : [];
  var group = groupIds(list);
  if (!group.length) return list;
  return placeRun(list, group, 0);
}

function sponsorsAfterHero(sections, planSections) {
  var list = Array.isArray(sections) ? sections.slice() : [];
  var body = list.filter(function (s) { return s && ['nav', 'hero', 'footer'].indexOf(s.id) === -1; });
  /* the plan names them when it is given (a stored page carries no prebuilt flag); else they are found here */
  var group = groupIds(body, { cur: sponsorsId(planSections), prev: previousSponsorsId(planSections) });
  if (!group.length) return list;
  var rest = list.filter(function (s) { return !s || group.indexOf(s.id) === -1; });
  var ids = rest.map(function (s) { return s && s.id; });
  /* after the hero; with no hero, after the top bar; with neither, first */
  var after = ids.indexOf('hero') !== -1 ? ids.indexOf('hero') : ids.indexOf('nav');
  return placeRun(list, group, after + 1);
}

/* ---------- the top bar's links, in page order ----------
   A link is a <li> holding one <a href="#id"> (or a bare <a href="#id">). Links standing next to each other
   (nothing but white space between them) form one row — the bar's list, or a separate mobile menu — and each
   row is put in order on its own: the links to sections of the page take the places such links had, sorted by
   where their section stands; anything else in the row (a link elsewhere, a button) stays where it is. */
var ITEM = /<li\b[^>]*>\s*<a\b[^>]*>(?:(?!<\/?(?:a|li|ul|ol)\b)[\s\S])*<\/a>\s*<\/li>|<a\b[^>]*>(?:(?!<\/?a\b)[\s\S])*<\/a>/gi;
function hrefId(item) {
  var a = /<a\b([^>]*)>/i.exec(item);
  var m = a && /\shref\s*=\s*["']#([^"']+)["']/i.exec(' ' + a[1]);
  return m ? m[1] : null;
}
/* a call to action in the bar (as genDesign's capNavLinks tells them) stays where it is */
function isButton(item) {
  var a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(item) || ['', '', ''];
  var text = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(btn|button|cta)\b|data-register-cta|data-rv-form/i.test(a[1]) || /^(register|book|request|apply|nominate|buy)/i.test(text);
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

module.exports = { sponsorsId: sponsorsId, previousSponsorsId: previousSponsorsId, sponsorsFirst: sponsorsFirst, sponsorsAfterHero: sponsorsAfterHero, orderNavLinks: orderNavLinks };
