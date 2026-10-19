// node functions/lib/rv-forms.test.js — the forms runtime of a published page (templates/_shared/rv-forms.js):
// its answer rules and messages (multi-form spec §1.2, which the server's functions/lib/forms.js follows too),
// that it stays quiet when told to, and that it never writes data into the page as HTML.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var FILE = path.join(__dirname, '../../templates/_shared/rv-forms.js');
var SRC = fs.readFileSync(FILE, 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* the file in a bare browser-like global: no DOM is touched when RV_FORMS_NO_AUTO is set */
function load(win) {
  var touched = [];
  var documentStub = new Proxy({}, { get: function (t, k) { touched.push(String(k)); return undefined; } });
  win = win || { RV_FORMS_NO_AUTO: true };
  win.document = documentStub;
  var ctx = vm.createContext({ window: win, console: console });
  vm.runInContext(SRC, ctx, { filename: 'rv-forms.js' });
  return { RF: win.RevampForms, touched: touched, win: win };
}
var loaded = load();
var RF = loaded.RF;
check('RevampForms is defined, version 1', RF && RF.version === 1);
['render', 'validate', 'ensureStyles', 'open', 'definitions', 'cleanValue'].forEach(function (k) {
  check('RevampForms.' + k + ' is a function', RF && typeof RF[k] === 'function');
});
check('with RV_FORMS_NO_AUTO nothing on the page is touched at load', loaded.touched.filter(function (k) { return k !== 'documentElement'; }).length === 0, loaded.touched.join());
check('definitions() is null when nothing started', RF.definitions() === null);
check('open() refuses when the runtime did not start', RF.open('register', null) === false);
check('a second copy of the file does not run again', (function () {
  var w = { RV_FORMS_NO_AUTO: true, __rvForms: true };
  load(w);
  return !w.RevampForms;
})());

/* ---------- validation vectors: { field, value, expect: { value } | { error } } ---------- */
function F(id, type, label, required, extra) {
  var f = { id: id, type: type, label: label, required: !!required };
  if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
  return f;
}
var NAME = F('name', 'text', 'Full name', true);
var EMAIL = F('email', 'email', 'Work email', true);
var PHONE = F('phone', 'phone', 'Mobile number', true);
var PHONE_OPT = F('phone', 'phone', 'Mobile number', false);
var COMPANY = F('company', 'text', 'Company', true);
var CITY = F('city', 'text', 'City', false);
var NOTE = F('note', 'text', 'Note', false);
var MSG = F('message', 'textarea', 'Anything you would like us to know?', true);
var SEATS = F('seats', 'number', 'Seats', true);
var SEATS_OPT = F('seats', 'number', 'Seats', false);
var LI = F('linkedin', 'url', 'LinkedIn profile', true);
var DOB = F('dob', 'date', 'Date of birth', true);
var PARTNER = F('partnership', 'select', 'Partnership interest', true, { options: ['Presenting partner', 'Associate partner', 'Exhibitor'] });
var MEAL = F('meal', 'radio', 'Meal', true, { options: ['Veg', 'Non-veg'] });
var TOPICS = F('topics', 'multiselect', 'Topics', true, { options: ['AI', 'Cloud', 'Security'] });
var TOPICS_OPT = F('topics', 'multiselect', 'Topics', false, { options: ['AI', 'Cloud', 'Security'] });
var CONSENT = F('consent', 'checkbox', 'I agree to the terms', true);
var NEWS = F('news', 'checkbox', 'Send me news', false);
var COUNTRY = F('country', 'country', 'Country', true, { options: ['India', 'Afghanistan', 'United Kingdom'] });
var ALT_EMAIL = F('assistant_email', 'email', 'Assistant email', true);
var FIRST = F('first_name', 'text', 'First name', true);
var LAST = F('last_name', 'text', 'Last name', true);
var LOCATION = F('location', 'location', 'Location', true);
var EMAIL_BAD = 'Please enter a valid email address, like name@company.com.';
var IN_BAD = 'Please enter a valid phone number for India: 10 digits after +91, starting with 6, 7, 8 or 9.';

var long201 = new Array(202).join('a');
var VECTORS = [
  // required and empty, with the special wordings
  { field: NAME, value: '', expect: { error: 'Please enter your name.' } },
  { field: NAME, value: '   ', expect: { error: 'Please enter your name.' } },
  { field: NAME, value: undefined, expect: { error: 'Please enter your name.' } },
  { field: EMAIL, value: '', expect: { error: 'Please enter your email address.' } },
  { field: COMPANY, value: '', expect: { error: 'Please fill in Company.' } },
  { field: MSG, value: ' \n ', expect: { error: 'Please fill in Anything you would like us to know?.' } },
  { field: PARTNER, value: '', expect: { error: 'Please choose Partnership interest.' } },
  { field: MEAL, value: '', expect: { error: 'Please choose Meal.' } },
  { field: COUNTRY, value: '', expect: { error: 'Please choose Country.' } },
  { field: TOPICS, value: [], expect: { error: 'Please choose at least one option for Topics.' } },
  { field: CONSENT, value: false, expect: { error: 'Please tick I agree to the terms to continue.' } },
  { field: ALT_EMAIL, value: '', expect: { error: 'Please fill in Assistant email.' } },
  // text: trimming, inner spacing, the mapped maxima
  { field: NAME, value: '  Asha   Rao ', expect: { value: 'Asha Rao' } },
  { field: NAME, value: 'Asha\tRao\n', expect: { value: 'Asha Rao' } },
  { field: NOTE, value: long201, expect: { value: long201.slice(0, 200) } },
  { field: NAME, value: long201, expect: { value: long201.slice(0, 120) } },
  { field: CITY, value: long201, expect: { value: long201.slice(0, 80) } },
  { field: CITY, value: '', expect: { value: undefined } },
  // textarea keeps its lines
  { field: MSG, value: ' line one\r\nline two ', expect: { value: 'line one\nline two' } },
  // email: casing, shape
  { field: EMAIL, value: '  Asha.Rao@Example.COM ', expect: { value: 'asha.rao@example.com' } },
  { field: EMAIL, value: 'asha@example', expect: { error: EMAIL_BAD } },
  { field: EMAIL, value: 'asha rao@example.com', expect: { error: EMAIL_BAD } },
  { field: EMAIL, value: 'asha@example.c', expect: { error: EMAIL_BAD } },
  { field: EMAIL, value: 'asha..rao@example.com', expect: { error: EMAIL_BAD } },
  { field: EMAIL, value: 'asha@exa_mple.com', expect: { error: EMAIL_BAD } },
  { field: EMAIL, value: 'first.last+tag@sub.example.co.in', expect: { value: 'first.last+tag@sub.example.co.in' } },
  { field: ALT_EMAIL, value: 'not-an-email', expect: { error: EMAIL_BAD } },
  // phone: { country, number } from the picker, checked for that country; text from an older page
  { field: PHONE, value: { country: 'IN', number: '98765 43210' }, expect: { value: '+919876543210' } },
  { field: PHONE, value: { country: 'IN', number: '09876543210' }, expect: { value: '+919876543210' } },
  { field: PHONE, value: { country: 'IN', number: '4876543210' }, expect: { error: IN_BAD } },
  { field: PHONE, value: { country: 'US', number: '212-555-0123' }, expect: { value: '+12125550123' } },
  { field: PHONE, value: { country: 'GB', number: '07911 123456' }, expect: { value: '+447911123456' } },
  { field: PHONE, value: { country: 'AE', number: '050 123 4567' }, expect: { value: '+971501234567' } },
  { field: PHONE, value: { country: 'SG', number: '8123 4567' }, expect: { value: '+6581234567' } },
  { field: PHONE, value: { country: 'SG', number: '8123 456' }, expect: { error: 'Please enter a valid phone number for Singapore: 8 digits after +65.' } },
  { field: PHONE, value: { country: 'IN', number: '+1 212 555 0123' }, expect: { value: '+12125550123' } },
  { field: PHONE, value: { country: 'IN', number: '' }, expect: { error: 'Please fill in Mobile number.' } },
  { field: PHONE, value: '123456', expect: { error: 'Please enter a valid phone number, with its country code.' } },
  { field: PHONE, value: '1234567', expect: { value: '1234567' } },
  { field: PHONE, value: '+91 98765 43210', expect: { value: '+919876543210' } },
  { field: PHONE, value: '123456789012345', expect: { value: '123456789012345' } },
  { field: PHONE, value: '1234567890123456', expect: { error: 'Please enter a valid phone number, with its country code.' } },
  { field: PHONE, value: '98765-abc-43', expect: { error: 'Please enter a valid phone number, with its country code.' } },
  // first and last names
  { field: FIRST, value: '', expect: { error: 'Please enter your first name.' } },
  { field: LAST, value: ' ', expect: { error: 'Please enter your last name.' } },
  { field: FIRST, value: long201, expect: { value: long201.slice(0, 60) } },
  // location: the text as chosen or typed (the server marks whether it is one of its places)
  { field: LOCATION, value: '', expect: { error: 'Please fill in Location.' } },
  { field: LOCATION, value: ' Noida,  Uttar Pradesh, India ', expect: { value: 'Noida, Uttar Pradesh, India' } },
  { field: PHONE, value: '', expect: { error: 'Please fill in Mobile number.' } },
  { field: PHONE_OPT, value: '', expect: { value: undefined } },
  // number
  { field: SEATS, value: '1e3', expect: { value: 1000 } },
  { field: SEATS, value: ' 42 ', expect: { value: 42 } },
  { field: SEATS, value: 7, expect: { value: 7 } },
  { field: SEATS, value: '-3.5', expect: { value: -3.5 } },
  { field: SEATS, value: 'abc', expect: { error: 'Please enter a number for Seats.' } },
  { field: SEATS, value: '1e13', expect: { error: 'Please enter a number for Seats.' } },
  { field: SEATS, value: '', expect: { error: 'Please fill in Seats.' } },
  { field: SEATS_OPT, value: '', expect: { value: undefined } },
  // url
  { field: LI, value: 'linkedin.com/in/asha', expect: { value: 'https://linkedin.com/in/asha' } },
  { field: LI, value: 'https://www.linkedin.com/in/asha', expect: { value: 'https://www.linkedin.com/in/asha' } },
  { field: LI, value: 'http://example.org', expect: { value: 'http://example.org' } },
  { field: LI, value: 'asha', expect: { error: 'Please enter a web address for LinkedIn profile, like https://example.com.' } },
  { field: LI, value: 'ftp://example.org', expect: { error: 'Please enter a web address for LinkedIn profile, like https://example.com.' } },
  { field: LI, value: '', expect: { error: 'Please fill in LinkedIn profile.' } },
  // date
  { field: DOB, value: '2026-02-28', expect: { value: '2026-02-28' } },
  { field: DOB, value: '2024-02-29', expect: { value: '2024-02-29' } },
  { field: DOB, value: '2026-02-30', expect: { error: 'Please enter a valid date for Date of birth.' } },
  { field: DOB, value: '1899-12-31', expect: { error: 'Please enter a valid date for Date of birth.' } },
  { field: DOB, value: '2101-01-01', expect: { error: 'Please enter a valid date for Date of birth.' } },
  { field: DOB, value: '19/10/2026', expect: { error: 'Please enter a valid date for Date of birth.' } },
  // select, radio, country
  { field: PARTNER, value: 'Exhibitor', expect: { value: 'Exhibitor' } },
  { field: PARTNER, value: 'Title sponsor', expect: { error: 'Please choose one of the options for Partnership interest.' } },
  { field: MEAL, value: 'Veg', expect: { value: 'Veg' } },
  { field: MEAL, value: 'Vegan', expect: { error: 'Please choose one of the options for Meal.' } },
  { field: COUNTRY, value: 'India', expect: { value: 'India' } },
  { field: COUNTRY, value: 'Atlantis', expect: { error: 'Please choose one of the options for Country.' } },
  // multiselect: de-duplicated, order kept, every item in the list
  { field: TOPICS, value: ['Cloud', 'AI', 'Cloud'], expect: { value: ['Cloud', 'AI'] } },
  { field: TOPICS, value: 'Security', expect: { value: ['Security'] } },
  { field: TOPICS, value: ['AI', 'Blockchain'], expect: { error: 'Please choose one of the options for Topics.' } },
  { field: TOPICS_OPT, value: [], expect: { value: undefined } },
  // checkbox
  { field: CONSENT, value: true, expect: { value: true } },
  { field: NEWS, value: false, expect: { value: false } },
  { field: NEWS, value: true, expect: { value: true } }
];
check('at least 40 validation vectors', VECTORS.length >= 40, String(VECTORS.length));
VECTORS.forEach(function (v, i) {
  var got = RF.cleanValue(v.field, v.value);
  var name = 'vector ' + i + ' ' + v.field.type + ' ' + JSON.stringify(v.value === undefined ? null : v.value);
  if (v.expect.error) {
    check(name + ' → error', got.error === v.expect.error, JSON.stringify(got));
    var vals = {}; vals[v.field.id] = v.value;
    var errs = RF.validate({ fields: [v.field] }, vals);
    check(name + ' → validate() says the same', errs[v.field.id] === v.expect.error, JSON.stringify(errs));
  } else {
    check(name + ' → value', !got.error && JSON.stringify(got.value) === JSON.stringify(v.expect.value), JSON.stringify(got));
    var vals2 = {}; vals2[v.field.id] = v.value;
    check(name + ' → validate() has no error', Object.keys(RF.validate({ fields: [v.field] }, vals2)).length === 0);
  }
});

/* validate(): every field, keyed by id, in field order; a draft's empty label still reads */
var form = { id: 'vip-delegates', fields: [NAME, EMAIL, PHONE, LI, CONSENT] };
var errs = RF.validate(form, { name: '', email: 'x', phone: '1234567', linkedin: 'linkedin.com/in/a', consent: false });
check('validate: only the bad fields, in field order', JSON.stringify(Object.keys(errs)) === JSON.stringify(['name', 'email', 'consent']), JSON.stringify(errs));
check('validate: an empty values object: every required field', Object.keys(RF.validate(form, {})).length === 5);
check('validate: tolerates a form without fields', JSON.stringify(RF.validate({}, {})) === '{}' && JSON.stringify(RF.validate(null, null)) === '{}');
check('a field without a label reads "this field"', RF.cleanValue({ id: 'x', type: 'text', label: '', required: true }, '').error === 'Please fill in this field.');
check('a select without options takes nothing', RF.cleanValue({ id: 'x', type: 'select', label: 'Pick', required: true, options: [] }, 'A').error === 'Please choose one of the options for Pick.');
check('a draft country field without the list is not refused here', RF.cleanValue({ id: 'c', type: 'country', label: 'Country', required: true }, 'India').value === 'India');

/* ---------- no data ever written as HTML ---------- */
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
var htmlWrites = code.match(/\.(innerHTML|outerHTML)\s*[+]?=(?!=)\s*[^;]*/g) || [];
check('no innerHTML / outerHTML assignment except clearing to \'\'', htmlWrites.every(function (m) { return /=\s*''\s*$/.test(m) || /=\s*""\s*$/.test(m); }), htmlWrites.join(' | '));
check('no insertAdjacentHTML', !/insertAdjacentHTML/.test(code));
check('no document.write', !/document\.write/.test(code));
check('no eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(code));

/* ---------- ES5 only (browser code of this product) ---------- */
check('no arrow functions', !/=>/.test(code));
check('no let / const', !/(^|[\s;(])(let|const)\s/.test(code));
check('no template literals', code.indexOf('`') === -1);
check('no class syntax', !/(^|\s)class\s+[A-Z]/.test(code));

/* ---------- the exact visitor-facing strings of the spec ---------- */
[
  'Form preview — visitors fill this in on the published page',
  'This form is not taking responses at the moment.',
  'This event is full. If you register now, you will join the waitlist.',
  'Sending…',
  'We could not send your details. Please check your connection and try again.',
  'Submitting is turned off in the editor. Open Preview to test this form.',
  'Loading the form…',
  'This form could not be loaded. Please check your connection and try again.',
  'This form is not available right now.',
  'Fill in again',
  'Untitled field',
  'no longer exists. Choose another form in the editor.'
].forEach(function (s) { check('says "' + s + '"', SRC.indexOf(s) !== -1); });
check('the email pattern is functions/lib/forms.js\'s, verbatim', SRC.indexOf(String(require('./forms.js').EMAIL_RE)) !== -1);
check('the honeypot is named "website"', /name = 'website'/.test(SRC));
check('posts to /api/register', SRC.indexOf("'/api/register'") !== -1);
check('fetches /api/public/forms', SRC.indexOf("'/api/public/forms?eventId='") !== -1);

/* ---------- cross-check with the server (functions/lib/forms.js): zero mismatch both ways ----------
   The page and the server must say the same thing about the same answer, so a server error reads like the
   page's own. Part A's shared vectors go through this runtime, and this file's vectors go through the server. */
var SERVER = require('./forms.js');
var SHARED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'validation-vectors.json'), 'utf8'));
function withCountries(f) {
  if (f.type !== 'country') return f;
  var c = {}; Object.keys(f).forEach(function (k) { c[k] = f[k]; });
  c.options = SERVER.COUNTRIES.slice();
  return c;
}
function emptyish(v) { return v === undefined || v === ''; }
SHARED.vectors.forEach(function (v, n) {
  var f = withCountries(SHARED.fields[v.field]);
  var got = RF.cleanValue(f, v.value);
  var name = 'shared vector ' + (n + 1) + ' (' + v.field + ' ' + JSON.stringify(v.value === undefined ? null : v.value).slice(0, 40) + ')';
  if (v.expect.error) check(name + ': runtime says the server\'s message', got.error === v.expect.error, JSON.stringify(got));
  else if (v.expect.omitted) check(name + ': runtime stores nothing', !got.error && emptyish(got.value), JSON.stringify(got));
  else check(name + ': runtime cleans it the same', !got.error && (JSON.stringify(got.value) === JSON.stringify(v.expect.value) || (emptyish(got.value) && emptyish(v.expect.value))), JSON.stringify(got));
});
VECTORS.forEach(function (v, i) {
  var f = withCountries(v.field), answers = {};
  answers[f.id] = v.value;
  var r = SERVER.validateAnswers({ fields: [f] }, { answers: answers });
  var name = 'runtime vector ' + i + ' on the server (' + f.type + ' ' + JSON.stringify(v.value === undefined ? null : v.value).slice(0, 40) + ')';
  if (v.expect.error) { check(name + ': same message', r.errors[f.id] === v.expect.error, JSON.stringify(r.errors)); return; }
  check(name + ': no error', !Object.keys(r.errors).length, JSON.stringify(r.errors));
  var stored = SERVER.MAPPED_FIELDS.indexOf(f.id) !== -1 ? r.reg[SERVER.MAPPED_KEY[f.id] || f.id] : r.answers[f.id];
  check(name + ': same cleaned value', JSON.stringify(stored) === JSON.stringify(v.expect.value) || (emptyish(stored) && emptyish(v.expect.value)), JSON.stringify(stored));
});

/* ---------- the Mobile field's table, the visitor's country, the email hint ---------- */
function block(src, tag) {
  var m = new RegExp('/\\* ' + tag + ':BEGIN[^\\n]*\\n([\\s\\S]*?)\\n[ ]*/\\* ' + tag + ':END').exec(src);
  return m ? m[1].split('\n').map(function (l) { return l.trim(); }).join('\n') : null;
}
var PHONE_SRC = fs.readFileSync(path.join(__dirname, 'phone.js'), 'utf8');
check('the page and the server have the same phone table', !!block(SRC, 'PHONE_DATA') && block(SRC, 'PHONE_DATA') === block(PHONE_SRC, 'PHONE_DATA'));
check('the phone table lists 240+ countries, India first', require('./phone.js').COUNTRIES.length >= 240 && require('./phone.js').COUNTRIES[0].cc === 'IN');
['fits', 'nationalOf', 'fromInternational', 'phoneMessage', 'cleanPhone', 'dialRank'].forEach(function (fn) {
  var re = new RegExp('function ' + fn + '\\([^\\n]*}\\n|function ' + fn + '\\([\\s\\S]*?\\n\\s*}\\n');
  var a = re.exec(SRC), b = re.exec(PHONE_SRC);
  var norm = function (m) { return m ? m[0].split('\n').map(function (l) { return l.trim(); }).join('\n').replace(/\bphoneCountry\(/g, 'country(') : ''; };
  check('phone rule ' + fn + '() is the server\'s, the same code', !!a && norm(a) === norm(b), norm(a).slice(0, 80));
});
function winWith(tz, langs) {
  return { Intl: { DateTimeFormat: function () { return { resolvedOptions: function () { return { timeZone: tz }; } }; } }, navigator: { languages: langs || [], language: (langs || [])[0] || '' } };
}
[['Asia/Kolkata', 'IN'], ['Asia/Calcutta', 'IN'], ['America/New_York', 'US'], ['Europe/London', 'GB'], ['Asia/Dubai', 'AE'], ['Asia/Singapore', 'SG'], ['America/Toronto', 'CA'], ['Australia/Sydney', 'AU'], ['Asia/Muscat', 'OM']].forEach(function (t) {
  check('time zone ' + t[0] + ' -> ' + t[1], RF.guessCountry(winWith(t[0], ['en-US'])) === t[1], RF.guessCountry(winWith(t[0], ['en-US'])));
});
check('no time zone: the language region (en-GB -> GB)', RF.guessCountry(winWith('UTC', ['en-GB', 'en'])) === 'GB');
check('zh-Hant-TW -> TW', RF.guessCountry(winWith('Etc/UTC', ['zh-Hant-TW'])) === 'TW');
check('nothing to go on: India', RF.guessCountry(winWith('', ['en'])) === 'IN' && RF.guessCountry({}) === 'IN');
[['asha@gmial.com', 'asha@gmail.com'], ['asha@gmail.con', 'asha@gmail.com'], ['asha@yaho.com', 'asha@yahoo.com'], ['asha@hotmial.com', 'asha@hotmail.com'], ['asha@outlok.com', 'asha@outlook.com'],
  ['asha@rediffmial.com', 'asha@rediffmail.com'], ['asha@gmail.com', ''], ['asha@ymail.com', ''], ['asha@company.co.in', ''], ['asha@tcs.com', ''], ['asha', ''], ['asha@acme.con', 'asha@acme.com']].forEach(function (t) {
  check('email hint for ' + t[0] + ': ' + (t[1] || 'none'), RF.suggestEmail(t[0]) === t[1], RF.suggestEmail(t[0]));
});
var req = ['Mobile number', 'Location'];
check('the visitor-facing words of the new fields', ['Country code', 'Search by country or code', 'No place by that name in our list. You can keep what you typed.',
  'Not one of the suggested places: it will be sent as you typed it.', 'Did you mean '].every(function (s) { return SRC.indexOf(s) !== -1; }) && req.length === 2);
check('suggestions come from /api/public/places', SRC.indexOf("'/api/public/places'") !== -1);

if (failed) { console.error('rv-forms: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('rv-forms: all ' + passed + ' checks passed');
