/* node functions/lib/intl.test.js — a form's Mobile and Location fields on the server: phone numbers by country
   (lib/phone.js), the places a Location field suggests and recognises (lib/places.js and its data), and the
   visitor's country from the hosting's headers (lib/api-forms.js geoCountry). No network, no Firebase. */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./phone');
const PL = require('./places');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---------- the phone table ---------- */
var C = P.COUNTRIES;
ok(C.length >= 240 && C[0].cc === 'IN', 'every country, India first', C.length + ' ' + (C[0] && C[0].cc));
ok(C.every(function (c) { return /^[A-Z]{2}$/.test(c.cc) && c.name && /^\d{1,3}$/.test(c.dial) && c.min >= 3 && c.max <= 14 && c.min <= c.max; }), 'each: an ISO code, a name, a dialling code, a sane length');
ok(C.slice(1).every(function (c, i, a) { return i === 0 || a[i - 1].name.localeCompare(c.name, 'en') <= 0; }), 'the rest A–Z');
var codes = {};
C.forEach(function (c) { codes[c.cc] = (codes[c.cc] || 0) + 1; });
ok(Object.keys(codes).every(function (k) { return codes[k] === 1; }), 'each country once');
ok(P.country('in').dial === '91' && P.country('US').dial === '1' && P.country('GB').dial === '44' && P.country('AE').dial === '971' && P.country('SG').dial === '65', 'dialling codes');
ok(P.country('ZZ') === null && P.country('') === null, 'not a country');

/* ---------- numbers ---------- */
function v(raw, value, country) {
  var r = P.cleanPhone(raw);
  ok(r.value === value && (country === undefined || r.country === country), 'phone ' + JSON.stringify(raw) + ' -> ' + value, JSON.stringify(r));
}
function bad(raw, msg) {
  var r = P.cleanPhone(raw);
  ok(!!r.error && (!msg || r.error === msg), 'phone ' + JSON.stringify(raw) + ' is refused' + (msg ? ': ' + msg : ''), JSON.stringify(r));
}
var IN_MSG = 'Please enter a valid phone number for India: 10 digits after +91, starting with 6, 7, 8 or 9.';
/* India: exactly 10 digits starting 6-9; a 0 or the 91 in front is the same number */
v({ country: 'IN', number: '98765 43210' }, '+919876543210', 'IN');
v({ country: 'IN', number: '6000000000' }, '+916000000000', 'IN');
v({ country: 'IN', number: '0 98765 43210' }, '+919876543210', 'IN');
v({ country: 'IN', number: '91-98765-43210' }, '+919876543210', 'IN');
v({ country: 'IN', number: '+91 (987) 654-3210' }, '+919876543210', 'IN');
bad({ country: 'IN', number: '5876543210' }, IN_MSG);
bad({ country: 'IN', number: '987654321' }, IN_MSG);
bad({ country: 'IN', number: '98765432101' }, IN_MSG);
bad({ country: 'IN', number: '022 2345 6789' }, IN_MSG);
/* United States and Canada share +1: the picked one is kept */
v({ country: 'US', number: '(415) 555-2671' }, '+14155552671', 'US');
v({ country: 'US', number: '1-415-555-2671' }, '+14155552671', 'US');
v({ country: 'CA', number: '604 555 0199' }, '+16045550199', 'CA');
bad({ country: 'US', number: '055 555 2671' }, 'Please enter a valid phone number for United States: 10 digits after +1.');
bad({ country: 'US', number: '415 555 267' });
/* United Kingdom: 9-10 digits after the 0 */
v({ country: 'GB', number: '07911 123456' }, '+447911123456', 'GB');
v({ country: 'GB', number: '020 7946 0958' }, '+442079460958', 'GB');
bad({ country: 'GB', number: '07911 1234567' }, 'Please enter a valid phone number for United Kingdom: 9 to 10 digits after +44.');
/* United Arab Emirates: mobiles 9 digits (05x), landlines 8 */
v({ country: 'AE', number: '050 123 4567' }, '+971501234567', 'AE');
v({ country: 'AE', number: '04 123 4567' }, '+97141234567', 'AE');
bad({ country: 'AE', number: '0501234' });
/* Singapore: 8 digits */
v({ country: 'SG', number: '9123 4567' }, '+6591234567', 'SG');
bad({ country: 'SG', number: '91234 5678' }, 'Please enter a valid phone number for Singapore: 8 digits after +65.');
/* more */
v({ country: 'AU', number: '0412 345 678' }, '+61412345678', 'AU');
v({ country: 'DE', number: '0151 23456789' }, '+4915123456789', 'DE');
v({ country: 'CN', number: '138 0013 8000' }, '+8613800138000', 'CN');
v({ country: 'IT', number: '06 1234 5678' }, '+390612345678', 'IT');
/* a number typed with its country code goes to that country, whatever the picker said */
v({ country: 'IN', number: '+44 7911 123456' }, '+447911123456', 'GB');
v({ country: 'IN', number: '00971 50 123 4567' }, '+971501234567', 'AE');
v({ country: 'IN', number: '+1 876 555 0123' }, '+18765550123', 'JM');
v({ country: 'IN', number: '+1 212 555 0123' }, '+12125550123', 'US');
v({ country: 'CA', number: '+1 212 555 0123' }, '+12125550123', 'CA');
v({ country: 'IN', number: '+7 701 234 5678' }, '+77012345678', 'KZ');
v({ country: 'IN', number: '+7 912 345 6789' }, '+79123456789', 'RU');
bad({ country: 'IN', number: '+999 1234 5678' }, 'Please enter a valid phone number, with its country code.');
bad({ country: 'IN', number: '+91 12345' }, IN_MSG);
/* what is not a number */
bad({ country: 'IN', number: 'nine eight seven' });
bad({ country: 'IN', number: '98765 43210 ext 5' });
bad({ country: 'XX', number: '98765 43210' }, 'Please choose your country code.');
ok(P.cleanPhone({ country: 'IN', number: '' }).empty === true && P.cleanPhone('').empty === true && P.cleanPhone(null).empty === true, 'nothing typed is empty');
/* text from a page that has not loaded the picker: an Indian mobile, a number with its code, or as before */
v('9876543210', '+919876543210', 'IN');
v('+44 20 7946 0958', '+442079460958', 'GB');
var legacy = P.cleanPhone('020 7946 0958');
ok(legacy.value === '020 7946 0958' && legacy.legacy === true && legacy.country === '', 'an older page\'s number without a code: kept as typed', JSON.stringify(legacy));
/* a country whose numbers start one of several ways: the Dominican Republic's 809, 829 and 849 */
v({ country: 'DO', number: '809 555 1234' }, '+18095551234', 'DO');
v({ country: 'DO', number: '829 555 1234' }, '+18295551234', 'DO');
v({ country: 'DO', number: '849 555 1234' }, '+18495551234', 'DO');
bad({ country: 'DO', number: '709 555 1234' });
v({ country: 'PR', number: '939 555 1234' }, '+19395551234', 'PR');
v('+1 829 555 1234', '+18295551234', 'DO');
/* digits typed on a full-width keyboard */
v({ country: 'IN', number: '\uFF19\uFF18\uFF17\uFF16\uFF15 \uFF14\uFF13\uFF12\uFF11\uFF10' }, '+919876543210', 'IN');
v({ country: 'IN', number: '\uFF0B91 98765 43210' }, '+919876543210', 'IN');
bad('12345');

/* ---------- shown to people ---------- */
ok(P.formatPhone('+919876543210') === '+91 98765 43210', 'India: +91 98765 43210', P.formatPhone('+919876543210'));
ok(P.formatPhone('+14155552671') === '+1 415 555 2671', 'NANP: +1 415 555 2671', P.formatPhone('+14155552671'));
ok(P.formatPhone('+447911123456') === '+44 7911 123456', 'UK: +44 7911 123456', P.formatPhone('+447911123456'));
ok(P.formatPhone('+971501234567') === '+971 501 234 567', 'UAE', P.formatPhone('+971501234567'));
ok(P.formatPhone('+6591234567') === '+65 9123 4567', 'Singapore', P.formatPhone('+6591234567'));
ok(P.formatPhone('020 7946 0958') === '020 7946 0958' && P.formatPhone('') === '' && P.formatPhone(null) === '', 'anything else: as it is');

/* ---------- places ---------- */
var data = path.join(__dirname, 'data', 'places.json');
var size = fs.statSync(data).size;
ok(size > 500000 && size < 3 * 1024 * 1024, 'the places file is there and under 3 MB', size);
var st = PL.stats();
ok(st.places > 30000, 'tens of thousands of places', st.places);
function labels(q, cc, n) { return PL.search(q, { country: cc }).slice(0, n || 8).map(function (p) { return p.label; }); }
var noi = PL.search('noi', { country: 'IN' });
ok(noi[0] && noi[0].label === 'Noida, Uttar Pradesh, India' && eq(noi[0], { label: 'Noida, Uttar Pradesh, India', city: 'Noida', state: 'Uttar Pradesh', country: 'India', countryCode: 'IN' }), '"noi" in India: Noida, Uttar Pradesh, India first, with its parts', JSON.stringify(noi[0]));
ok(labels('Noida', 'US')[0] === 'Noida, Uttar Pradesh, India', '"Noida" from anywhere: Noida');
ok(labels('noida', 'IN').indexOf('Greater Noida, Uttar Pradesh, India') !== -1, 'and Greater Noida, by a later word');
ok(labels('new y', 'IN')[0] === 'New York City, New York, United States', '"new y": New York City', labels('new y', 'IN').join(' | '));
ok(labels('sao paulo', '')[0] === 'São Paulo, Brazil' && labels('São Paulo', '')[0] === 'São Paulo, Brazil' && labels('SAO P', '')[0] === 'São Paulo, Brazil', 'accents: "sao paulo", "São Paulo" and "SAO P" find São Paulo', labels('sao paulo', '').join(' | '));
ok(labels('zurich', '')[0] === 'Zürich, Switzerland', '"zurich" finds Zürich', labels('zurich', '').join(' | '));
ok(labels('koln', '')[0].indexOf('Köln') === 0 && labels('cologne', '')[0].indexOf('Köln') === 0, 'Köln as "koln" and as "cologne"');
ok(labels('bombay', 'IN')[0] === 'Mumbai, Maharashtra, India' && labels('bangalore', 'IN')[0] === 'Bengaluru, Karnataka, India' && labels('gurgaon', 'IN')[0] === 'Gurugram, Haryana, India',
  'names a city is also known by: Bombay, Bangalore, Gurgaon', [labels('bombay', 'IN')[0], labels('bangalore', 'IN')[0], labels('gurgaon', 'IN')[0]].join(' | '));
ok(labels('aurangabad', 'IN').slice(0, 2).sort().join() === ['Aurangabad, Bihar, India', 'Aurangabad, Maharashtra, India'].sort().join(), 'two Aurangabads, plainly spelt', labels('aurangabad', 'IN').join(' | '));
ok(labels('aurangabad, bih', 'IN')[0] === 'Aurangabad, Bihar, India' && labels('aurangabad, bih', 'IN').length === 1, 'text after a comma narrows by state');
ok(labels('delhi', 'IN')[0] === 'Delhi, India' && labels('delhi', 'IN').indexOf('New Delhi, Delhi, India') !== -1, '"Delhi, Delhi, India" reads "Delhi, India"; New Delhi is there');
ok(labels('singapore', 'SG')[0] === 'Singapore', 'a city-state is one word');
ok(labels('lon', 'GB')[0] === 'London, England, United Kingdom', '"lon" in the UK: London');
ok(labels('lon', 'IN').indexOf('London, England, United Kingdom') !== -1, '"lon" in India: London is still offered');
/* the visitor's own country first among names alike; other languages' names of a city count for little */
var noiL = labels('noi', 'IN', 3);
ok(noiL[0] === 'Noida, Uttar Pradesh, India' && noiL[1] === 'Greater Noida, Uttar Pradesh, India', '"noi" in India: Noida, then Greater Noida (before the suburbs of Paris)', noiL.join(' | '));
ok(labels('san', 'IN').concat(labels('san', 'US')).every(function (l) { return !/Shanghai|Chengdu|Philadelphia/.test(l); }), '"san": never Shanghai ("Sanghaj"), Chengdu or Philadelphia by another language\'s name', labels('san', 'IN').join(' | '));
ok(labels('ban', 'IN', 1)[0] === 'Bengaluru, Karnataka, India' && labels('gurg', 'IN', 1)[0] === 'Gurugram, Haryana, India' && labels('calcutta', 'IN', 1)[0] === 'Kolkata, West Bengal, India', 'an Indian city\'s other name still finds it first in India (Bangalore, Gurgaon, Calcutta)');
ok(labels('new y', 'IN', 1)[0] === 'New York City, New York, United States', '"new y": New York City first');
ok(PL.search('a', { country: 'IN' }).length === 8 && PL.search('pune', { country: 'IN', limit: 3 }).length <= 3, 'at most 8, or fewer when asked');
ok(PL.search('', {}).length === 0 && PL.search('  ,  ', {}).length === 0 && PL.search('qqqxz', {}).length === 0, 'nothing, punctuation, no match: none');
ok(PL.search('<script>', {}).length === 0, 'markup finds nothing');
var t0 = Date.now(); for (var i = 0; i < 200; i++) PL.search(['ma', 'new', 'san', 'ba', 'del'][i % 5], { country: 'IN' });
ok(Date.now() - t0 < 1500, 'searches are quick (200 in under 1.5 s)', (Date.now() - t0) + ' ms');
ok(eq(PL.lookup('noida, uttar pradesh, INDIA'), noi[0]), 'lookup: a listed place, whatever its case');
ok(PL.lookup('Noida') === null && PL.lookup('') === null && PL.lookup('Sector 62, Noida') === null, 'lookup: anything else is not one');
ok(PL.fold('Côte d’Ivoire') === 'cote divoire' && PL.fold('São  Paulo!') === 'sao paulo' && PL.fold('Straße') === 'strasse', 'folding');

/* ---------- the visitor's country from the hosting ---------- */
var geoCountry = require('./api-forms').geoCountry;
ok(geoCountry({ headers: { 'x-client-geo-location': 'IN,Noida' } }) === 'IN', 'X-Client-Geo-Location "IN,Noida" -> IN');
ok(geoCountry({ headers: { 'x-appengine-country': 'gb' } }) === 'GB', 'X-AppEngine-Country -> GB');
ok(geoCountry({ headers: { 'cf-ipcountry': 'AE' } }) === 'AE', 'CF-IPCountry -> AE');
ok(geoCountry({ headers: { 'cf-ipcountry': 'XX' } }) === '' && geoCountry({ headers: { 'cf-ipcountry': 'T1' } }) === '' && geoCountry({ headers: {} }) === '' && geoCountry({}) === '', 'unknown, Tor, nothing: no country');

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('intl: all ' + checks + ' checks passed');
