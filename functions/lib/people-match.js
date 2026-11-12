/* One speaker, or one sponsor, across every ET portal and EventSphere's own events (the owner, 11 Nov 2026: "22000 can
   not be actual speaker count, remove duplicate by matching the name and company name and keep the latest only", and
   "remove the portal barrier and count the speaker one only either he speaks on ETAuto, ETCIO, ETHR, ETCISO").

   ET's records hold a person once per portal and once per way their company was typed, so 21,943 rows were about
   18,250 people. A SPEAKER is one person when the name is the same (case, accents, punctuation and a title such as
   Dr or Shri aside) and the company is the same, compared as people write companies:
     - the legal endings and filler go: Pvt, Private, Ltd, Limited, LLP, Inc, Corp(oration), Co(mpany), PLC, GmbH,
       "The", "&"/"and", and a closing "India" ("Sandoz India" is Sandoz);
     - only what comes before a comma or a " - " is the company ("Usha Martin University, Ranchi, Jharkhand");
     - one may continue the other ("ETAuto" / "ETAuto & ETManufacturing", "Google Cloud" / "Google Cloud India");
     - spaces aside ("Home First" / "HomeFirst"), and a plural aside ("Foods" / "Food");
     - a short form: given in brackets ("National Stock Exchange of India (NSE)"), or the initials ("DMRC" / "Delhi
       Metro Rail Corporation", "STPI" / "Software Technology Parks of India").
   A row with no company (ET's older records wrote it in the designation: "CTO, Vodafone Idea Limited") goes to the
   person whose company its designation names; when nothing says, to the only person of that name if there is one.
   A person who changed company (Salesforce, then ServiceNow), and two people who share a name, stay apart: a name
   alone never makes one person. The team joins them by hand (lib/people.js merge).

   A SPONSOR is one when its name is the same, compared the same way — and a closing word that only says what kind
   of company it is aside ("SailPoint Technologies", "Zoho Solutions") — except that one name continuing another is
   not enough ("Google" and "Google Cloud" stay two) and initials are not either ("HP" is not Hindustan Petroleum):
   only a short form the name itself gives in brackets.

   The newest row is the person's: its name, designation, company and photo (blanks filled from older rows).

     nameKey(name)                -> the comparison form of a person's name ('' when it has none)
     companyForm(text)            -> the comparison form of a company: { t: [token], raw, a0, alias }
     sameCompany(a, b)            -> boolean (forms)
     groupPeople(rows)            -> [[row]] rows of ONE nameKey grouped into people, each newest first, the people in
                                     the order of their newest row. row: { company, designation, at } (at: a date
                                     'YYYY-MM-DD' or a year 'YYYY'; '' when unknown)
     peopleOf(rows, o)            -> [[row]] any rows, grouped by name, then into people (o.trust: linkTrust's, so a
                                     LinkedIn that is surely theirs makes one person of two companies)
     sponsorKey(name)             -> the comparison form of a sponsor's name
     sponsorsOf(rows)             -> [[row]] rows ({ name, at }) grouped into sponsors, each newest first
     newestFirst(a, b)            -> a sort for rows by at
     slugify(text)                -> 'naven-singh' ('' when nothing is left) */
'use strict';

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function normal(s) { return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim(); }

/* titles before a name, as ET's teams type them ("Dr.", "Shri", "Lt Gen", "Prof. Dr.") */
var TITLE = /^(?:dr|mr|mrs|ms|miss|mx|prof|professor|shri|sri|smt|kumari|capt|captain|col|colonel|lt|gen|general|maj|major|brig|adm|admiral|cmde|hon|honble|justice|adv|advocate|er|ca|cs|cma|sir|dame)\s+/;
function nameKey(name) {
  var n = normal(name), before;
  if (!n) return '';
  for (var i = 0; i < 4; i++) {
    before = n;
    n = n.replace(TITLE, '');
    if (n === before) break;
  }
  return n || normal(name);
}

/* the name as written, without its titles ("Dr. Kiran Bedi" -> "Kiran Bedi"): what another record calls them */
var TITLE_WORD = /^(?:dr|mr|mrs|ms|miss|mx|prof|professor|shri|sri|smt|kumari|capt|captain|col|colonel|lt|gen|general|maj|major|brig|adm|admiral|cmde|hon|honble|justice|adv|advocate|er|ca|cs|cma|sir|dame)\.?\s+/i;
function withoutTitle(name) {
  var n = str(name).replace(/\s+/g, ' ').trim(), before;
  for (var i = 0; i < 4; i++) { before = n; n = n.replace(TITLE_WORD, ''); if (n === before) break; }
  return n || str(name).trim();
}
var DROP = { pvt: 1, private: 1, ltd: 1, limited: 1, llp: 1, llc: 1, inc: 1, incorporated: 1, corp: 1, corporation: 1, plc: 1, co: 1,
  company: 1, gmbh: 1, the: 1, and: 1, pte: 1 };
var SMALL = { of: 1, and: 1, the: 1, for: 1, in: 1, at: 1 };
function stem(w) { return w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w; }
function tokensOf(text) {
  var t = normal(text).split(' ').filter(function (w) { return w && !DROP[w]; });
  /* a closing "India" is where the company is ("Sandoz India"), unless it is the name ("Government of India") */
  while (t.length > 1 && t[t.length - 1] === 'india' && !SMALL[t[t.length - 2]]) t.pop();
  return t.map(stem);
}
/* a sponsor's closing words that say what kind of company it is ("SailPoint Technologies" is SailPoint) */
var KIND_WORDS = { technologies: 1, technology: 1, tech: 1, solutions: 1, solution: 1, systems: 1, system: 1, software: 1, services: 1, service: 1,
  group: 1, global: 1, international: 1, enterprises: 1, enterprise: 1, consulting: 1, labs: 1, networks: 1, network: 1, digital: 1 };
function sponsorTokens(text) {
  var t = normal(mainPart(text)).split(' ').filter(function (w) { return w && !DROP[w]; });
  while (t.length > 1 && t[t.length - 1] === 'india' && !SMALL[t[t.length - 2]]) t.pop();
  while (t.length > 1 && KIND_WORDS[t[t.length - 1]]) t.pop();
  return t.map(stem);
}
/* the part of a company line that is the company: brackets aside, up to a comma or a dash between words */
function mainPart(text) {
  return str(text).replace(/\([^)]*\)/g, ' ').split(/,|\s[-–—|]\s|\|/)[0];
}
function companyForm(text) {
  text = str(text);
  var main = mainPart(text), paren = /\(([^)]{2,24})\)/.exec(text);
  var raw = normal(main).split(' ').filter(Boolean);
  var alias = paren ? tokensOf(paren[1]) : null;
  if (alias && (!alias.length || alias.join('').length < 2 || alias[0] === 'i')) alias = null;
  return { t: tokensOf(main), raw: raw, a0: raw[0] || '', alias: alias };
}
function startsWith(a, b) {
  if (!a.length || a.length > b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function initials(words) {
  return words.filter(function (w) { return w && !SMALL[w]; }).map(function (w) { return w.charAt(0); }).join('');
}
/* a short form (one word of 2–7 letters) that is the other's initials, its legal endings counted or not */
function shortFor(word, f) {
  if (!word || word.length < 2 || word.length > 7 || f.raw.length < 2) return false;
  return word === initials(f.raw) || word === initials(f.t);
}
function sameTokens(a, b, loose) {
  if (!a.length || !b.length) return false;
  if (a.join('') === b.join('')) return true;
  return !!loose && (startsWith(a, b) || startsWith(b, a));
}
function sameCompany(a, b, strict) {
  if (!a || !b || !a.t.length || !b.t.length) return false;
  var loose = !strict;
  if (sameTokens(a.t, b.t, loose)) return true;
  if (a.alias && sameTokens(a.alias, b.t, loose)) return true;
  if (b.alias && sameTokens(a.t, b.alias, loose)) return true;
  if (a.alias && b.alias && sameTokens(a.alias, b.alias, false)) return true;
  if (strict) return false;
  return (a.t.length === 1 && shortFor(a.a0, b)) || (b.t.length === 1 && shortFor(b.a0, a)) ||
    (!!a.alias && a.alias.length === 1 && shortFor(a.alias[0], b)) || (!!b.alias && b.alias.length === 1 && shortFor(b.alias[0], a));
}
/* the company named inside a designation ("CTO, Vodafone Idea Limited" names Vodafone Idea) */
function names(designation, f) {
  if (!f || !f.t.length) return false;
  var hay = ' ' + tokensOf(designation).join(' ') + ' ';
  return hay.indexOf(' ' + f.t.join(' ') + ' ') !== -1;
}

function newestFirst(a, b) {
  var x = str(a.at), y = str(b.at);
  if (x !== y) return x < y ? 1 : -1;
  return (str(b.company) ? 1 : 0) - (str(a.company) ? 1 : 0);
}

function groupPeople(rows, o) {
  var list = (rows || []).slice().sort(newestFirst), groups = [];
  list.forEach(function (r) {
    r._co = r._co || companyForm(r.company);
    if (!r._co.t.length) return;
    var g = null;
    for (var i = 0; i < groups.length && !g; i++) {
      if (groups[i].forms.some(function (f) { return sameCompany(f, r._co); })) g = groups[i];
    }
    if (g) { g.rows.push(r); g.forms.push(r._co); } else groups.push({ rows: [r], forms: [r._co] });
  });
  var unknown = null;
  list.forEach(function (r) {
    if (r._co.t.length) return;
    var hits = groups.filter(function (g) { return g.forms.some(function (f) { return names(r.designation, f); }); });
    if (hits.length === 1) { hits[0].rows.push(r); return; }
    if (groups.length === 1) { groups[0].rows.push(r); return; }
    if (!unknown) { unknown = { rows: [], forms: [] }; groups.push(unknown); }
    unknown.rows.push(r);
  });
  /* two of them with one LinkedIn that is surely theirs are one person, whatever their companies were */
  var join = o && o.trust && o.trust.join;
  if (join && groups.length > 1) {
    var byHandle = {};
    groups.forEach(function (g, i) {
      g.rows.forEach(function (r) {
        var h = linkedinHandle(r.linkedin);
        if (h && join[h] && join[h] === nameKey(r.name)) (byHandle[h] || (byHandle[h] = [])).push(i);
      });
    });
    var parent = groups.map(function (g, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    Object.keys(byHandle).forEach(function (h) { var l = byHandle[h]; for (var i = 1; i < l.length; i++) { var a = find(l[0]), b = find(l[i]); if (a !== b) parent[b] = a; } });
    var merged = {};
    groups.forEach(function (g, i) { var r = find(i); if (!merged[r]) merged[r] = { rows: [], forms: [] }; merged[r].rows = merged[r].rows.concat(g.rows); });
    groups = Object.keys(merged).map(function (k) { return merged[k]; });
  }
  return groups.map(function (g) {
    g.rows.sort(newestFirst);
    g.rows.forEach(function (r) { delete r._co; });
    return g.rows;
  }).sort(function (a, b) { return newestFirst(a[0], b[0]); });
}

function peopleOf(rows, o) {
  var byName = {}, order = [];
  (rows || []).forEach(function (r) {
    var k = nameKey(r.name);
    if (!k) return;
    if (!byName[k]) { byName[k] = []; order.push(k); }
    byName[k].push(r);
  });
  var out = [];
  order.forEach(function (k) { groupPeople(byName[k], o).forEach(function (g) { out.push(g); }); });
  return out;
}

/* ---------- one person by their LinkedIn (the owner, 12 Nov 2026: "we can merge the duplicate speakers like who
   have same name and same linkedin link, if the company or designation is changed then we can show that as their
   journey. but this should be done only if the linkedin link shared is actual") ----------
   LinkedIn itself is never read (its terms forbid reading other people's profiles), so a link is taken as theirs
   only when the records say so:
     - it is a person's profile: linkedin.com/in/<handle> (or /pub/), not a company's page, a search or a post;
     - no one else's records carry it — or, where a link was pasted on several people (one link is on eight people's
       rows in ETB2B's records), it is the one whose name is in the handle;
   and two records of one name are one person by it only when their name is in the handle too ("vinod-bhat-1a2b").
   A link that is someone else's is not shown on a page, nor filled in from the library.
     linkedinHandle(url)   -> 'vinod-bhat-1a2b' | ''
     linkTrust(rows)       -> { show: { handle: nameKey }, join: { handle: nameKey } } over every row there is
     linkOf(row, trust)    -> the row's handle when it may be shown as theirs, else '' */
var NOT_A_HANDLE = { in: 1, me: 1, profile: 1, feed: 1, login: 1, signup: 1, company: 1, school: 1, jobs: 1, posts: 1, pulse: 1 };
function linkedinHandle(url) {
  var m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/([^\/?#\s]+)/i.exec(str(url).trim());
  if (!m) return '';
  var h = m[1];
  try { h = decodeURIComponent(h); } catch (e) { /* as written */ }
  h = h.toLowerCase().replace(/\/+$/, '');
  return h.length >= 3 && h.length <= 100 && !NOT_A_HANDLE[h] && !/[\s<>"']/.test(h) ? h : '';
}
/* their name in a handle: a word of it, three letters or more ("bhat", "vinod") */
function handleNames(handle, name) {
  var flat = handle.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  return nameKey(name).split(' ').some(function (t) { return t.length >= 3 && flat.indexOf(t) !== -1; });
}
function linkTrust(rows) {
  var names = {};
  (rows || []).forEach(function (r) {
    var h = linkedinHandle(r.linkedin), k = nameKey(r.name);
    if (!h || !k) return;
    (names[h] || (names[h] = {}))[k] = r.name;
  });
  var show = {}, join = {}, seen = {};
  Object.keys(names).forEach(function (h) {
    seen[h] = true;
    var keys = Object.keys(names[h]);
    var mine = keys.filter(function (k) { return handleNames(h, names[h][k]); });
    if (keys.length === 1) { show[h] = keys[0]; if (mine.length === 1) join[h] = keys[0]; }
    else if (mine.length === 1) { show[h] = mine[0]; join[h] = mine[0]; }
  });
  return { show: show, join: join, seen: seen };
}
function linkOf(row, trust) {
  var h = linkedinHandle(row && row.linkedin);
  if (!h) return '';
  if (!trust) return h;
  var owner = trust.show[h];
  if (owner !== undefined) return owner === nameKey(row.name) ? h : '';
  /* a link the rows the trust was made of never had (the team typed it on an EventSphere record): theirs; one they
     had on several people, none surely its owner: no one's */
  return !(trust.seen && trust.seen[h]) ? h : '';
}

function sponsorKey(name) { return sponsorTokens(name).join(' '); }
function sponsorsOf(rows) {
  var parent = {}, form = {};
  function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
  function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
  var keyed = [];
  (rows || []).forEach(function (r) {
    var f = companyForm(r.name), k = sponsorTokens(r.name).join('');
    if (!k) return;
    if (!(k in parent)) { parent[k] = k; form[k] = f; }
    keyed.push({ r: r, k: k });
  });
  /* a short form given in brackets ("Tata Consultancy Services (TCS)") joins the sponsor named by it ("TCS") */
  Object.keys(form).forEach(function (k) {
    var a = form[k].alias;
    if (a && a.join('') in parent) join(a.join(''), k);
  });
  var groups = {}, order = [];
  keyed.forEach(function (x) {
    var root = find(x.k);
    if (!groups[root]) { groups[root] = []; order.push(root); }
    groups[root].push(x.r);
  });
  return order.map(function (k) { return groups[k].sort(newestFirst); }).sort(function (a, b) { return newestFirst(a[0], b[0]); });
}

function slugify(text) {
  return str(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72).replace(/-+$/, '');
}

module.exports = {
  nameKey: nameKey, withoutTitle: withoutTitle, companyForm: companyForm, sameCompany: sameCompany, groupPeople: groupPeople, peopleOf: peopleOf,
  sponsorKey: sponsorKey, sponsorsOf: sponsorsOf, newestFirst: newestFirst, slugify: slugify, normal: normal,
  linkedinHandle: linkedinHandle, linkTrust: linkTrust, linkOf: linkOf,
  _test: { tokensOf: tokensOf, mainPart: mainPart, initials: initials, names: names }
};
