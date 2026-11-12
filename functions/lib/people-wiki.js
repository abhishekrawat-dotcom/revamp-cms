/* Wikipedia for a speaker's or a sponsor's page, for the well-known ones (the owner, 11 Nov 2026: "Wikipedia for
   well-known people", with my condition the owner chose with it: only when the employer matches, with a credit line).

   Read from Wikidata (who an entry is, whom it works for, its website) and Wikipedia (the summary and its picture),
   both public and free to reuse with attribution: the text is CC BY-SA 4.0, a picture's licence is on its Commons page.
   Asked with a client name of our own (Wikimedia asks every client for one); nothing of the person's is sent but the
   name searched for.

   WHO IT IS — never a name alone (two people share a name; Wikipedia has one of them):
     a speaker  an entry for a human (P31 = Q5) whose label or alias is the person's name, AND whose employer (P108)
                is one of the companies the person spoke for, or whose one-line description names one of them
     a sponsor  an entry whose official website (P856) is the sponsor's website (the same domain), or whose label
                is the sponsor's name and whose description names it as a company
   Anything else is a candidate the team may confirm by hand ("It is them"), never shown on its own.

     find(subject, o) -> Promise<{ candidates: [CANDIDATE], match: CANDIDATE | null }>
        subject   { kind, name, companies: [string], website }
        o         { fetchJson(url) -> Promise<json|null> }   (lib/safe-fetch through the caller)
     CANDIDATE = { qid, label, description, title (English Wikipedia), match: bool, why, employers: [string] }
     summary(title, o) -> Promise<WIKI | null>
     WIKI = { qid, title, url, extract, image, imagePage, matchedOn, by: 'match' | email }   what a page shows
     clean(wiki) -> WIKI | null   (what may be stored and shown: https only, text only, lengths capped) */
'use strict';
var PM = require('./people-match');

var WD = 'https://www.wikidata.org/w/api.php';
var WP = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
var UA = 'ETB2B-EventSphere/1.0 (speaker and sponsor pages; https://revamp-cms--revamp-cms.us-east4.hosted.app)';
var HUMAN = 'Q5';
var MAX = { candidates: 7, extract: 1200, employers: 20 };

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function q(params) { return Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&'); }
function idsOf(claims, prop) {
  return ((claims && claims[prop]) || []).map(function (c) { var v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value; return v && v.id ? v.id : null; }).filter(Boolean);
}
function stringsOf(claims, prop) {
  return ((claims && claims[prop]) || []).map(function (c) { var v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value; return typeof v === 'string' ? v : null; }).filter(Boolean);
}
function domainOf(u) { try { return new URL(/^https?:\/\//i.test(str(u)) ? str(u) : 'https://' + str(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } }
function sameName(a, b) { var x = PM.nameKey(a), y = PM.nameKey(b); return !!x && x === y; }
/* a company named among the words of a description ("Indian banker, CEO of HDFC Bank") */
function describes(description, company) {
  var f = PM.companyForm(company);
  if (!f.t.length || f.t.join('').length < 3) return false;
  var hay = ' ' + PM.companyForm(description).t.join(' ') + ' ';
  var full = ' ' + PM.normal(description).split(' ').join(' ') + ' ';
  return hay.indexOf(' ' + f.t.join(' ') + ' ') !== -1 || full.indexOf(' ' + PM.normal(company) + ' ') !== -1;
}

function find(subject, o) {
  var fetchJson = o.fetchJson, kind = subject.kind === 'sponsors' ? 'sponsors' : 'speakers';
  var name = kind === 'speakers' ? PM.withoutTitle(subject.name) : str(subject.name).trim();
  if (!name) return Promise.resolve({ candidates: [], match: null });
  var search = WD + '?' + q({ action: 'wbsearchentities', search: name.slice(0, 120), language: 'en', uselang: 'en', type: 'item', limit: MAX.candidates, format: 'json', origin: '*' });
  return fetchJson(search, { 'user-agent': UA }).then(function (j) {
    var hits = (j && Array.isArray(j.search) ? j.search : []).filter(function (h) {
      return h && /^Q\d+$/.test(str(h.id)) && (sameName(h.label, name) || sameName(h.match && h.match.text, name) || (kind === 'sponsors' && PM.sponsorKey(h.label) === PM.sponsorKey(name)));
    }).slice(0, MAX.candidates);
    if (!hits.length) return { candidates: [], match: null };
    var url = WD + '?' + q({ action: 'wbgetentities', ids: hits.map(function (h) { return h.id; }).join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'en', sitefilter: 'enwiki', format: 'json', origin: '*' });
    return fetchJson(url, { 'user-agent': UA }).then(function (ents) {
      var all = (ents && ents.entities) || {};
      var employerIds = [];
      hits.forEach(function (h) { idsOf((all[h.id] || {}).claims, 'P108').slice(0, MAX.employers).forEach(function (id) { if (employerIds.indexOf(id) === -1) employerIds.push(id); }); });
      var labels = employerIds.length ? fetchJson(WD + '?' + q({ action: 'wbgetentities', ids: employerIds.slice(0, 50).join('|'), props: 'labels', languages: 'en', format: 'json', origin: '*' }), { 'user-agent': UA })
        .then(function (r) { var out = {}; Object.keys((r && r.entities) || {}).forEach(function (id) { var l = r.entities[id].labels && r.entities[id].labels.en; if (l) out[id] = l.value; }); return out; }) : Promise.resolve({});
      return labels.then(function (empName) {
        var candidates = hits.map(function (h) {
          var e = all[h.id] || {}, claims = e.claims || {};
          var label = (e.labels && e.labels.en && e.labels.en.value) || str(h.label);
          var description = (e.descriptions && e.descriptions.en && e.descriptions.en.value) || str(h.description);
          var title = e.sitelinks && e.sitelinks.enwiki ? str(e.sitelinks.enwiki.title) : '';
          var c = { qid: h.id, label: label, description: description, title: title, match: false, why: '', employers: [] };
          if (kind === 'speakers') {
            var human = idsOf(claims, 'P31').indexOf(HUMAN) !== -1;
            c.employers = idsOf(claims, 'P108').map(function (id) { return empName[id]; }).filter(Boolean);
            if (!human) { c.why = 'not a person'; return c; }
            var companies = (subject.companies || []).filter(Boolean);
            var byEmployer = null, byDescription = null;
            companies.forEach(function (co) {
              var f = PM.companyForm(co);
              if (!byEmployer) c.employers.forEach(function (emp) { if (!byEmployer && PM.sameCompany(PM.companyForm(emp), f)) byEmployer = emp; });
              if (!byDescription && describes(description, co)) byDescription = co;
            });
            if (byEmployer) { c.match = true; c.why = 'employer: ' + byEmployer; }
            else if (byDescription) { c.match = true; c.why = 'described as at ' + byDescription; }
            else c.why = c.employers.length ? 'Wikidata names other employers (' + c.employers.slice(0, 3).join(', ') + ')' : 'Wikidata names no employer of theirs';
          } else {
            var sites = stringsOf(claims, 'P856').map(domainOf).filter(Boolean), mine = domainOf(subject.website);
            if (mine && sites.indexOf(mine) !== -1) { c.match = true; c.why = 'website: ' + mine; }
            else c.why = sites.length ? 'another website (' + sites[0] + ')' : 'no website to compare';
          }
          return c;
        });
        /* one match, and only one: two entries that both fit cannot tell which is them */
        var matched = candidates.filter(function (c) { return c.match && c.title; });
        return { candidates: candidates, match: matched.length === 1 ? matched[0] : null };
      });
    });
  });
}

function summary(title, o) {
  title = str(title).trim();
  if (!title) return Promise.resolve(null);
  return o.fetchJson(WP + encodeURIComponent(title.replace(/ /g, '_')), { 'user-agent': UA }).then(function (j) {
    if (!j || j.type === 'disambiguation' || !str(j.extract).trim()) return null;
    var img = (j.originalimage && j.originalimage.source) || (j.thumbnail && j.thumbnail.source) || '';
    var file = /\/([^\/]+\.(?:jpe?g|png|webp|gif|svg))(?:\/|$)/i.exec(str(img));
    return {
      title: str(j.title), url: str(j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
      extract: str(j.extract), image: (j.thumbnail && j.thumbnail.source) || '', imagePage: file ? 'https://commons.wikimedia.org/wiki/File:' + file[1] : ''
    };
  });
}

/* an article titled with their own name (a disambiguation in brackets aside: "Naven Singh (banker)"); a sponsor's
   with its own name, a kind word or two aside */
function aboutThem(kind, title, name) {
  var t = str(title).replace(/\s*\([^)]*\)\s*$/, '');
  if (kind === 'sponsors') return PM.sponsorKey(t) === PM.sponsorKey(name) || PM.sameCompany(PM.companyForm(t), PM.companyForm(name), true);
  return sameName(t, PM.withoutTitle(name)) || sameName(t, name);
}
function httpsOnly(u, host) {
  u = str(u).trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return '';
  try { var h = new URL(u).hostname; return host.test(h) ? u.slice(0, 600) : ''; } catch (e) { return ''; }
}
function clean(w) {
  if (!w || typeof w !== 'object') return null;
  var out = {
    qid: /^Q\d{1,12}$/.test(str(w.qid)) ? str(w.qid) : '',
    title: str(w.title).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200),
    url: httpsOnly(w.url, /(^|\.)wikipedia\.org$/i),
    extract: str(w.extract).replace(/\s+/g, ' ').trim().slice(0, MAX.extract),
    image: httpsOnly(w.image, /(^|\.)wikimedia\.org$/i),
    imagePage: httpsOnly(w.imagePage, /(^|\.)wikimedia\.org$/i),
    matchedOn: str(w.matchedOn).slice(0, 160),
    by: str(w.by).slice(0, 200),
    at: str(w.at).slice(0, 40)
  };
  if (!out.url || !out.extract) return null;
  if (!out.imagePage) out.image = '';
  return out;
}

module.exports = { find: find, summary: summary, clean: clean, aboutThem: aboutThem, UA: UA, _test: { describes: describes, domainOf: domainOf, sameName: sameName } };
