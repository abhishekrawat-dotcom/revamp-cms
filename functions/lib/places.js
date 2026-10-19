// Places for a form's Location field: "Noida, Uttar Pradesh, India" — city, state, country.
//
//   search(q, { country, limit }) -> [{ label, city, state, country, countryCode }]   what to suggest for what
//                                     a visitor has typed so far (GET /api/public/places, lib/api-forms.js)
//   lookup(text) -> { label, city, state, country, countryCode } | null              a place the list has,
//                                     whatever its case or accents — how a registration's location is marked
//                                     as one of ours ("verified") or as typed by hand
//
// The data is functions/lib/data/places.json, built by tools/build-places.js from GeoNames (CC BY 4.0, see
// NOTICE): every Indian city and town of 1,000 people or more, and every city in the world of 15,000 or more
// (or a capital) — about 37,000 places, 1.3 MB. It is read once per server instance, the first time it is
// needed (a few tens of milliseconds), and kept: a sorted list of every word a place's name starts at, so a
// search is two binary searches and a short walk, not a scan.
//
// Matching: what was typed is folded (lower case, accents and punctuation dropped: "sao p" finds São Paulo),
// and matches the start of a place's name ("noi" -> Noida), the start of a later word of it ("york" -> New
// York City), or a name it is also known by ("bombay" -> Mumbai). Text after a comma narrows by state or
// country ("aurangabad, bihar"). Results: the larger place first, with places in the visitor's own country
// counted 20 times their size, a match at the start of the name counted more than one on a later word or on a
// name it is also known by (TIER_WEIGHT), and the name typed in full four times — so an Indian visitor typing
// "noi" sees Noida and Greater Noida before the suburbs of Paris, and "san" never brings up Shanghai.
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'places.json');
const HOME_WEIGHT = 20;
/* How much a match counts, by where it is (the "tier" of a word in the index): 0 the start of the place's
   name, 1 the start of a name it is also known by ("bombay" -> Mumbai), 2 the start of a later word of its name
   ("noida" -> Greater Noida), 3 a later word of a name it is also known by. GeoNames' other names are mostly
   the city's name in other languages ("Sangaj" for Shanghai, "New York Van Java" for Jakarta): one counts for
   little, except for a place in the visitor's own country, where it is usually the name people still use
   (Bombay, Bangalore, Gurgaon, Cochin). A name typed in full ("delhi") counts four times. */
const TIER_WEIGHT = [1, 0.01, 0.25, 0.0025];
const HOME_TIER_WEIGHT = [1, 0.5, 0.25, 0.125];
const EXACT_WEIGHT = 4;
const MAX_LIMIT = 8;

let D = null;          // { countries, states, rows, keys: [string], refs: Int32Array (row * 4 + tier), byLabel: Map }

/* "São Paulo" -> "sao paulo", "Côte d’Ivoire" -> "cote divoire" */
function fold(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[đĐ]/g, 'd').replace(/ı/g, 'i')
    .toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function partsOf(row) {
  const city = row[0], state = row[2] >= 0 ? D.states[row[2]] : '', country = D.countries[row[1]] || row[1];
  /* "Delhi, Delhi, India" reads as "Delhi, India"; "Singapore, Singapore" as "Singapore" */
  const shown = [];
  [city, state, country].forEach(function (p) {
    if (p && (!shown.length || fold(shown[shown.length - 1]) !== fold(p))) shown.push(p);
  });
  return { label: shown.join(', '), city: city, state: state, country: country, countryCode: row[1] };
}

function load() {
  if (D) return D;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = [];
  data.rows.forEach(function (row, i) {
    function add(name, alt) {
      const words = fold(name).split(' ').filter(Boolean);
      for (let w = 0; w < words.length; w++) entries.push([words.slice(w).join(' '), i * 4 + (w > 0 ? 2 : 0) + (alt ? 1 : 0)]);
    }
    add(row[0], false);
    if (row[4]) row[4].split('|').forEach(function (a) { add(a, true); });
  });
  entries.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]; });
  D = { countries: data.countries, states: data.states, rows: data.rows, keys: new Array(entries.length), refs: new Int32Array(entries.length), byLabel: null };
  entries.forEach(function (e, j) { D.keys[j] = e[0]; D.refs[j] = e[1]; });
  return D;
}

function lowerBound(keys, q) {
  let lo = 0, hi = keys.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < q) lo = mid + 1; else hi = mid; }
  return lo;
}

/* does every narrowing word typed after a comma start a word of the place's state or country? */
function narrows(row, extra) {
  if (!extra.length) return true;
  const hay = ' ' + fold((row[2] >= 0 ? D.states[row[2]] : '') + ' ' + (D.countries[row[1]] || '') + ' ' + row[1]);
  return extra.every(function (w) { return hay.indexOf(' ' + w) !== -1; });
}

function search(q, opts) {
  opts = opts || {};
  const text = String(q == null ? '' : q).slice(0, 120);
  const comma = text.split(',');
  const head = fold(comma[0]);
  if (!head) return [];
  load();
  const extra = fold(comma.slice(1).join(' ')).split(' ').filter(Boolean);
  const home = /^[A-Z]{2}$/.test(String(opts.country || '')) ? opts.country : '';
  const limit = Math.max(1, Math.min(MAX_LIMIT, +opts.limit || MAX_LIMIT));
  const best = new Map();       // row -> tier
  for (let j = lowerBound(D.keys, head); j < D.keys.length && D.keys[j].lastIndexOf(head, 0) === 0; j++) {
    const ref = D.refs[j], row = ref >> 2, tier = ref & 3;
    const had = best.get(row);
    if (had === undefined || TIER_WEIGHT[tier] > TIER_WEIGHT[had]) best.set(row, tier);
  }
  const found = [];
  best.forEach(function (tier, i) {
    const row = D.rows[i];
    if (!narrows(row, extra)) return;
    const exact = fold(row[0]) === head;
    const mine = row[1] === home;
    found.push({ i: i, score: Math.max(1, row[3] || 0) * (mine ? HOME_WEIGHT : 1) * (mine ? HOME_TIER_WEIGHT : TIER_WEIGHT)[tier] * (exact ? EXACT_WEIGHT : 1) });
  });
  found.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  const out = [], seen = {};
  for (let k = 0; k < found.length && out.length < limit; k++) {
    const p = partsOf(D.rows[found[k].i]);
    if (seen[p.label]) continue;
    seen[p.label] = 1;
    out.push(p);
  }
  return out;
}

function lookup(text) {
  const key = fold(text);
  if (!key) return null;
  load();
  if (!D.byLabel) {
    D.byLabel = new Map();
    D.rows.forEach(function (row, i) {
      const k = fold(partsOf(row).label);
      if (!D.byLabel.has(k)) D.byLabel.set(k, i);    // rows are largest first: a shared label is the larger place
    });
  }
  const i = D.byLabel.get(key);
  return i === undefined ? null : partsOf(D.rows[i]);
}

function stats() { load(); return { places: D.rows.length, keys: D.keys.length, bytes: fs.statSync(FILE).size }; }

module.exports = { search, lookup, fold, stats };
