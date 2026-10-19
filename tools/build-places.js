/* Builds the data behind a form's Mobile and Location fields, from public sources, into the repository:

     functions/lib/data/places.json        the places a Location field suggests ("Noida, Uttar Pradesh, India"):
                                           every Indian city and town in GeoNames (population 1,000 or more),
                                           and every city in the world of 15,000 people or more (or a capital),
                                           with its state / province and country. Read by functions/lib/places.js.
     functions/lib/phone.js                the block between PHONE_DATA:BEGIN and PHONE_DATA:END: every country's
     templates/_shared/rv-forms.js         name, dialling code and how many digits its numbers have (the same
                                           table in both files: the page and the server check a number alike)
     templates/_shared/rv-forms.js         the block between TZ_DATA:BEGIN and TZ_DATA:END: which country each
                                           time zone is in (how a visitor's page guesses their country code)

   node tools/build-places.js <geonames dir> [--tz <zoneinfo dir>]

   <geonames dir> holds, from https://download.geonames.org/export/dump/ (CC BY 4.0, credited in NOTICE):
     cities1000.zip, cities15000.zip, admin1CodesASCII.txt, countryInfo.txt
   Download them with (behind the office proxy):
     for f in cities1000.zip cities15000.zip admin1CodesASCII.txt countryInfo.txt; do
       curl -sS --fail --cacert ~/.revamp-cms-qa/zscaler.pem -o "$DIR/$f" https://download.geonames.org/export/dump/$f; done
   --tz: the IANA time zone database as installed (zone.tab and tzdata.zi), /usr/share/zoneinfo by default.

   Re-run it when GeoNames is refreshed or a country's numbering changes (edit PHONE_LENGTHS below); then run
   node functions/lib/intl.test.js, and bump FORMS_RUNTIME_V in functions/lib/forms.js (rv-forms.js changed). */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const JSZip = require('jszip');

const SRC = process.argv[2];
const tzAt = process.argv.indexOf('--tz');
const TZ_DIR = tzAt !== -1 ? process.argv[tzAt + 1] : '/usr/share/zoneinfo';
if (!SRC || !fs.existsSync(SRC)) {
  console.error('Usage: node tools/build-places.js <geonames dir> [--tz <zoneinfo dir>]');
  process.exit(2);
}

/* ---------- countries: GeoNames' names, a few made the way people write them ---------- */
const NAME_FIX = {
  AX: 'Åland Islands', BL: 'Saint Barthélemy', BQ: 'Caribbean Netherlands', CC: 'Cocos (Keeling) Islands',
  CD: 'Congo (DRC)', CG: 'Congo', CI: 'Côte d’Ivoire', CW: 'Curaçao', MF: 'Saint Martin', NL: 'Netherlands',
  PN: 'Pitcairn Islands', PS: 'Palestine', RE: 'Réunion', ST: 'São Tomé and Príncipe', TL: 'Timor-Leste',
  TR: 'Türkiye', VA: 'Vatican City', XK: 'Kosovo'
};
/* places nobody lives in, and codes that are no longer countries */
const NO_COUNTRY = { AQ: 1, BV: 1, GS: 1, HM: 1, TF: 1, UM: 1, CS: 1, AN: 1 };
/* the dialling code where GeoNames has none or one that is not in use */
const DIAL_FIX = { XK: '383', VA: '39', PN: '64', SX: '1' };

/* How many digits a country's own numbers have (the national significant number: no 0 in front of it, no
   country code), min-max, and what they start with when that is fixed. Mobile and fixed lines both, so a
   "Phone" field may hold either; India is mobile only (the default form asks for a mobile number, and every
   Indian mobile number is 10 digits starting 6-9). From the ITU's national numbering plans; a country not
   listed takes 5-12. */
const PHONE_LENGTHS = {
  AD: '6-9', AE: '8-9', AF: '9', AL: '8-9', AM: '8', AO: '9', AR: '10-11', AT: '7-13', AU: '9', AW: '7', AX: '5-12',
  AZ: '9', BA: '8-9', BD: '10', BE: '8-9', BF: '8', BG: '8-9', BH: '8', BI: '8', BJ: '8-10', BN: '7', BO: '8',
  BR: '10-11', BT: '7-8', BW: '7-8', BY: '9-10', BZ: '7', CD: '9', CF: '8', CG: '9', CH: '9', CI: '10', CK: '5',
  CL: '9', CM: '9', CN: '9-11', CO: '10', CR: '8', CU: '8', CV: '7', CW: '7-8', CY: '8', CZ: '9', DE: '6-13',
  DJ: '8', DK: '8', DZ: '8-9', EC: '8-9', EE: '7-8', EG: '9-10', ER: '7', ES: '9', ET: '9', FI: '5-12', FJ: '7',
  FK: '5', FM: '7', FO: '6', FR: '9', GA: '7-8', GB: '9-10', GE: '9', GF: '9', GG: '10', GH: '9', GI: '8', GL: '6',
  GM: '7', GN: '8-9', GP: '9', GQ: '9', GR: '10', GT: '8', GW: '7-9', GY: '7', HK: '8', HN: '8', HR: '8-9', HT: '8',
  HU: '8-9', ID: '9-12', IE: '7-9', IL: '8-9', IM: '10', IN: '10', IQ: '8-10', IR: '10', IS: '7', IT: '6-11',
  JE: '10', JO: '8-9', JP: '9-10', KE: '9', KG: '9', KH: '8-9', KI: '5-8', KM: '7', KP: '8-10', KR: '8-10',
  KW: '8', KZ: '10', LA: '8-10', LB: '7-8', LI: '7-9', LK: '9', LR: '7-9', LS: '8', LT: '8', LU: '6-11', LV: '8',
  LY: '9', MA: '9', MC: '8-9', MD: '8', ME: '8', MG: '9', MH: '7', MK: '8', ML: '8', MM: '7-10', MN: '8', MO: '8',
  MQ: '9', MR: '8', MT: '8', MU: '7-8', MV: '7', MW: '7-9', MX: '10', MY: '9-10', MZ: '8-9', NA: '8-9', NC: '6',
  NE: '8', NF: '6', NG: '8-10', NI: '8', NL: '9', NO: '8', NP: '8-10', NR: '7', NU: '4-7', NZ: '8-10', OM: '8',
  PA: '7-8', PE: '8-9', PF: '8', PG: '7-8', PH: '8-10', PK: '9-10', PL: '9', PM: '6', PS: '8-9', PT: '9', PW: '7',
  PY: '9', QA: '8', RE: '9', RO: '9', RS: '8-9', RU: '10', RW: '9', SA: '8-9', SB: '5-7', SC: '7', SD: '9',
  SE: '7-10', SG: '8', SH: '4-5', SI: '8', SJ: '8', SK: '9', SL: '8', SM: '6-10', SN: '9', SO: '7-9', SR: '6-7',
  SS: '9', ST: '7', SV: '8', SX: '10', SY: '8-9', SZ: '8', TD: '8', TG: '8', TH: '8-9', TJ: '9', TK: '4-7',
  TL: '7-8', TM: '8', TN: '8', TO: '5-7', TR: '10', TV: '5-7', TW: '8-9', TZ: '9', UA: '9', UG: '9', UY: '8',
  UZ: '9', VA: '6-11', VE: '10', VN: '9-10', VU: '5-7', WF: '6', WS: '5-7', XK: '8-9', YE: '7-9', YT: '9',
  ZA: '9', ZM: '9', ZW: '7-9'
};
/* what a national number must start with (a regular-expression fragment, matched at its start) */
const PHONE_LEAD = { IN: '[6-9]', US: '[2-9]', CA: '[2-9]', KZ: '[67]', RU: '[3489]' };

function readText(name) { return fs.readFileSync(path.join(SRC, name), 'utf8'); }
function rowsOf(text) { return text.split('\n').filter(function (l) { return l && l.charAt(0) !== '#'; }).map(function (l) { return l.split('\t'); }); }

const countries = {};          // cc -> { name, dial, lead, min, max, pop }
rowsOf(readText('countryInfo.txt')).forEach(function (r) {
  const cc = r[0];
  if (NO_COUNTRY[cc] || !/^[A-Z]{2}$/.test(cc)) return;
  let name = NAME_FIX[cc] || r[4].trim(), phone = String(r[12] || '').trim(), dial = '', lead = '';
  /* "+1-876" (a North American country), "+44-1481" (a Crown dependency), "+1-809 and 1-829" */
  const nanp = /^\+?1-(\d{3})(?: and 1-(\d{3}))?$/.exec(phone);
  if (nanp) { dial = '1'; lead = nanp[2] ? nanp[1] + '|' + nanp[2] : nanp[1]; if (cc === 'DO') lead += '|849'; }
  else if (/^\+?(\d+)-\d+$/.test(phone)) dial = /^\+?(\d+)-/.exec(phone)[1];
  else if (/^\d+$/.test(phone)) dial = phone;
  if (DIAL_FIX[cc]) dial = DIAL_FIX[cc];
  if (cc === 'SX') lead = '721';
  if (!dial) return;
  if (PHONE_LEAD[cc]) lead = PHONE_LEAD[cc];
  const len = String(PHONE_LENGTHS[cc] || (dial === '1' ? '10' : '5-12')).split('-');
  countries[cc] = { name: name, dial: dial, lead: lead, min: +len[0], max: +(len[1] || len[0]), pop: +r[7] || 0 };
});

/* The phone table, one country per line: CC|Name|dial|min|max|lead. India first, then A–Z by name. */
const order = Object.keys(countries).sort(function (a, b) {
  if (a === 'IN') return -1;
  if (b === 'IN') return 1;
  return countries[a].name.localeCompare(countries[b].name, 'en');
});
const phoneLines = order.map(function (cc) {
  const c = countries[cc];
  if (/[|;]/.test(c.name)) throw new Error('A country name holds a separator: ' + c.name);
  return cc + '|' + c.name + '|' + c.dial + '|' + c.min + '|' + c.max + '|' + c.lead;
});
const PHONE_DATA = phoneLines.join(';');

/* ---------- time zones -> countries ---------- */
const tzCountry = {};
fs.readFileSync(path.join(TZ_DIR, 'zone.tab'), 'utf8').split('\n').forEach(function (l) {
  if (!l || l.charAt(0) === '#') return;
  const r = l.split('\t');
  if (countries[r[0]] && r[2]) tzCountry[r[2]] = r[0];
});
/* the older names browsers still report (Chrome says "Asia/Calcutta"): each is its zone's country */
fs.readFileSync(path.join(TZ_DIR, 'tzdata.zi'), 'utf8').split('\n').forEach(function (l) {
  const m = /^L (\S+) (\S+)$/.exec(l);
  if (m && !tzCountry[m[2]] && tzCountry[m[1]]) tzCountry[m[2]] = tzCountry[m[1]];
});
const byCc = {};
Object.keys(tzCountry).sort().forEach(function (z) { (byCc[tzCountry[z]] = byCc[tzCountry[z]] || []).push(z); });
const TZ_DATA = Object.keys(byCc).sort().map(function (cc) { return cc + ':' + byCc[cc].join(' '); }).join(';');

/* ---------- places ---------- */
const admin1 = {};
rowsOf(readText('admin1CodesASCII.txt')).forEach(function (r) { admin1[r[0]] = r[1]; });

const SKIP_FEATURE = { PPLH: 1, PPLQ: 1, PPLW: 1, PPLCH: 1 };
/* where GeoNames writes a place's name with transliteration marks ("Aurangābād") that people there do not
   type: its plain ASCII name ("Aurangabad") */
const ASCII_NAMES = { IN: 1, PK: 1, BD: 1, NP: 1, LK: 1, BT: 1, MV: 1 };
const ALT_RE = /^[A-Z\u00C0-\u00DE][a-z\u00DF-\u00FF\u0100-\u017F]+(?:[ -][A-Za-z\u00C0-\u017F]?[a-z\u00DF-\u00FF\u0100-\u017F]+)*$/;
function altsOf(r, pop) {
  if (pop < 300000) return [];
  const own = r[1].toLowerCase(), out = [];
  String(r[3] || '').split(',').forEach(function (a) {
    a = a.trim();
    if (!ALT_RE.test(a) || a.length < 4 || a.length > 40 || a.toLowerCase() === own) return;
    if (out.some(function (x) { return x.toLowerCase() === a.toLowerCase(); })) return;
    if (out.length < 30) out.push(a);
  });
  return out;
}

async function citiesOf(zipName, file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(SRC, zipName)));
  const text = await zip.file(file).async('string');
  return text.split('\n').filter(Boolean).map(function (l) { return l.split('\t'); });
}

(async function main() {
  const world = await citiesOf('cities15000.zip', 'cities15000.txt');
  const all = await citiesOf('cities1000.zip', 'cities1000.txt');
  const take = world.concat(all.filter(function (r) { return r[8] === 'IN'; }));

  const states = [], stateIx = {}, places = {}, seenId = {};
  take.forEach(function (r) {
    const id = r[0], cc = r[8], fc = r[7], pop = +r[14] || 0;
    if (seenId[id] || SKIP_FEATURE[fc] || !countries[cc]) return;
    /* a part of a city ("Zürich (Kreis 3)", "Dubai Marina") only in India, where people name their area */
    if (fc === 'PPLX' && cc !== 'IN') return;
    seenId[id] = 1;
    const name = String((ASCII_NAMES[cc] && r[2]) || r[1] || '').trim();
    if (!name || /[|;]/.test(name)) return;
    const state = admin1[cc + '.' + r[10]] || '';
    const key = (name + '\n' + state + '\n' + cc).toLowerCase();
    /* one place per label: two villages of one name in one state are one suggestion (the larger) */
    if (places[key] && places[key].pop >= pop) return;
    let si = -1;
    if (state) {
      if (stateIx[state] == null) { stateIx[state] = states.length; states.push(state); }
      si = stateIx[state];
    }
    places[key] = { name: name, si: si, cc: cc, pop: pop, alts: altsOf(r, pop) };
  });
  const rows = Object.keys(places).map(function (k) { return places[k]; })
    .sort(function (a, b) { return b.pop - a.pop || (a.name < b.name ? -1 : 1); })
    .map(function (p) {
      const row = [p.name, p.cc, p.si, p.pop];
      if (p.alts.length) row.push(p.alts.join('|'));
      return row;
    });
  const countryNames = {};
  order.forEach(function (cc) { countryNames[cc] = countries[cc].name; });
  const out = {
    v: 1,
    source: 'GeoNames (https://www.geonames.org), CC BY 4.0: cities15000 and the Indian places of cities1000, admin1CodesASCII, countryInfo',
    built: new Date().toISOString().slice(0, 10),
    countries: countryNames,
    states: states,
    rows: rows
  };
  const dataDir = path.join(ROOT, 'functions', 'lib', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(dataDir, 'places.json'), json);

  /* the generated blocks */
  function replaceBlock(file, tag, value, indent) {
    const p = path.join(ROOT, file), src = fs.readFileSync(p, 'utf8');
    const re = new RegExp('(/\\* ' + tag + ':BEGIN[^\\n]*\\n)[\\s\\S]*?(\\n[ ]*/\\* ' + tag + ':END \\*/)');
    if (!re.test(src)) throw new Error(file + ' has no ' + tag + ' block');
    /* a long string cut into lines of whole entries, so a diff shows which country changed */
    const lines = [];
    let cur = '';
    value.split(';').forEach(function (part) {
      if (cur && (cur.length + part.length) > 110) { lines.push(cur); cur = ''; }
      cur += (cur ? ';' : '') + part;
    });
    if (cur) lines.push(cur);
    const body = indent + 'var ' + tag + ' = [\n' + lines.map(function (l) { return indent + '  ' + JSON.stringify(l); }).join(',\n') + '\n' + indent + "].join(';');";
    fs.writeFileSync(p, src.replace(re, function (m, a, b) { return a + body + b; }));
  }
  replaceBlock('functions/lib/phone.js', 'PHONE_DATA', PHONE_DATA, '');
  replaceBlock('templates/_shared/rv-forms.js', 'PHONE_DATA', PHONE_DATA, '  ');
  replaceBlock('templates/_shared/rv-forms.js', 'TZ_DATA', TZ_DATA, '  ');

  console.log('places.json: ' + rows.length + ' places, ' + states.length + ' states, ' + (json.length / 1048576).toFixed(2) + ' MB');
  console.log('phone table: ' + order.length + ' countries (' + PHONE_DATA.length + ' characters); time zones: ' + Object.keys(tzCountry).length + ' (' + TZ_DATA.length + ' characters)');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
