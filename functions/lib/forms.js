// An event's registration FORMS: what a form is, what may be stored as one, what a visitor's browser is
// told about it, and how a visitor's answers are checked. Pure: no Firestore, no request — lib/api-forms.js
// (the admin routes and the public definitions), lib/api-audience.js (POST /api/register, Reporting) and
// lib/api.js (publishing, the AI chat) build on it, and functions/lib/forms.test.js tests it in-process.
//
// THE SHAPE (spec "Multi-form registration", section 1 — shared with the page runtime and the builders):
//   events/<eventId>/forms/<formId>
//     { id, name, title, intro, purpose, fields: [Field], submitLabel, successMessage,
//       countsAsRegistration, needsApproval, open, duplicates, order, template, rev,
//       createdAt, createdBy, updatedAt, updatedBy }
//   Field { id, type, label, required, placeholder, help, options?, maxWords?, requiredWhen? }
//     options       select / radio / multiselect only
//     maxWords      Long text (textarea) only: at most this many words (10–1000); the page counts them as the
//                   visitor types, and the answer may then be longer than the usual 2,000 characters
//                   (textareaMax). Absent: no word limit.
//     requiredWhen  { field, equals }: the field is required only when the answer to an earlier single-choice
//                   (select / radio) field `field` is the option `equals` — e.g. a nominee's designation, asked
//                   of an individual and optional for an organisation. Only on a field that is not required
//                   otherwise; never on the email.
//
//   A form id is /^[a-z][a-z0-9-]{0,39}$/ and never changes. "register" is the form an event's original
//   single registration form becomes (legacyDefaultForm). A field id is /^[a-z][a-z0-9_]{0,39}$/ and never
//   changes either; nine of them (MAPPED_FIELDS) are the registration's own columns rather than an answer.
//
// THE STANDARD QUESTIONS. Every new form — a custom one, every template, the default "Register now", one the
//   AI makes — starts with seven, in this order, all required (defaultFields): Official email, First name,
//   Last name, Mobile (a country code picker and the number, kept as +919876543210 — lib/phone.js), Company,
//   Designation, Location (city, state and country, suggested as it is typed — lib/places.js). An organiser
//   may make any of them optional, remove it, relabel it or give it a placeholder — except the email: every
//   form asks for one, always required (it is how "one response per email" tells responses apart), though
//   it too can be relabelled and moved. A form saved before first and last names (one "name" field, "Full
//   name") keeps working as it is, everywhere.
//   A registration's name is its "name" answer on such a form, and "First Last" on a form with the two: every
//   reader of a registration (Reporting, the export, the totals, the activity log) finds it in `name`.
//
// THE CONSENT BOX. Every form — whatever an organiser does to it — ends with one locked item, { id: 'consent',
//   type: 'consent', label: 'Consent', required: true } (consentField): ET's consent sentence with a tick box
//   (CONSENT_TEXT; its links are the event's portal's own privacy, cookie and terms pages — consentFor). It
//   cannot be removed, moved, made optional or reworded in a builder: whatever a builder sends in its place is
//   dropped and the item is put back at the end (withConsent). A visitor must tick it (POST /api/register
//   sends consent: true), and the registration records what they agreed to: consent { given, at, version,
//   text } (consentRecord). It is not one of the "fields" a form may have (FIELD_TYPES): no form gets a second.
//
// The validation messages below are part of the contract: the page runtime (templates/_shared/rv-forms.js)
// says exactly the same sentences, so an answer the server refuses reads the same as one the browser did.
'use strict';
var crypto = require('crypto');

/* ---------- the vocabulary ---------- */

var phone = require('./phone');
var places = require('./places');
var etFooter = require('./et-footer');
var etEvents = require('./et-events');
var etPrevious = require('./et-previous');

var FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'select', 'radio', 'multiselect', 'checkbox', 'country', 'location'];
var FIELD_TYPE_LABELS = {
  consent: 'Consent (always required)',
  text: 'Short text', textarea: 'Long text', email: 'Email', phone: 'Mobile (with country code)', number: 'Number', url: 'Web address',
  date: 'Date', select: 'Dropdown', radio: 'Single choice', multiselect: 'Multiple choice', checkbox: 'Tick box (yes/no)',
  country: 'Country', location: 'Location (city, state, country)'
};
var OPTION_TYPES = ['select', 'radio', 'multiselect'];
var PURPOSES = ['register', 'interest', 'partner', 'vip', 'speaker', 'nomination', 'custom'];
/* a registration's own columns: their values are stored as reg[MAPPED_KEY[id] || id], every other answer
   under answers.<id> */
var MAPPED_FIELDS = ['name', 'first_name', 'last_name', 'email', 'phone', 'company', 'designation', 'city', 'location', 'consent'];
var MAPPED_TYPES = { name: 'text', first_name: 'text', last_name: 'text', email: 'email', phone: 'phone', company: 'text',
  designation: 'text', city: 'text', location: 'location', consent: 'consent' };
var MAPPED_KEY = { first_name: 'firstName', last_name: 'lastName' };
var MAPPED_MAX = { name: 120, first_name: 60, last_name: 60, company: 120, designation: 120, city: 80 };
var LOCATION_MAX = 200;
var LOCKED_FIELDS = ['email'];

var FORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
var FIELD_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
var DEFAULT_FORM_ID = 'register';

var LIMITS = { maxForms: 20, maxFields: 40, maxOptions: 300 };   // 300: an award's Category list (Trendies 2026 has 114 sub-categories)
/* a Long text field's word limit (Field.maxWords), and the characters such an answer may have */
var WORDS = { min: 10, max: 1000 };
var TEXTAREA_MAX = 2000, TEXTAREA_MAX_WORDS_CAP = 8000;
var MIN_FIELDS = 1;
var MAX_ANSWERS_BYTES = 16 * 1024;
var TEXT = { name: 80, title: 120, intro: 600, submitLabel: 40, successMessage: 600, label: 200, placeholder: 120, help: 300, option: 120 };

/* bumped whenever templates/_shared/rv-forms.js changes, so a browser holding the old copy (static files are
   cached for five minutes, under an unhashed name) asks for the new one */
var FORMS_RUNTIME_V = 4;

/* An email address as a form takes it: name@domain.tld — the name of the letters, digits and signs an address
   may have, no two dots in a row and none at either end; the domain of labels of letters, digits and hyphens,
   ending in a real top-level domain (2–24 letters, or xn--… for one in another script). Stricter than lib/
   http.js's rule for the console, on purpose: an address a visitor mistypes is refused while they can still
   fix it. templates/_shared/rv-forms.js has the same expression, verbatim (forms.test.js checks). */
var EMAIL_RE = /^[A-Za-z0-9!#$%&'*+\/=?^_\x60{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_\x60{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,24}|xn--[A-Za-z0-9-]{1,59})$/;
var EMAIL_MESSAGE = 'Please enter a valid email address, like name@company.com.';
var URL_RE = /^https?:\/\/[^\s<>"]+\.[^\s<>"]+/i;
var SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

var DEFAULT_SUCCESS = 'You are registered. We look forward to seeing you there.';
var WAITLIST_MESSAGE = 'This event is full, so you have been added to the waitlist. We will be in touch if a place opens up.';
var PREVIEW_NOTE = ' (Preview — this test registration was not saved.)';

/* ---------- the consent box every form ends with ---------- */

var CONSENT_ID = 'consent', CONSENT_TYPE = 'consent';
/* ET's consent sentence, as the owner wrote it (the tick box's required mark is drawn by the page, not part of
   the text). Each link's label appears in it exactly once: a page makes that part of the sentence the link. */
var CONSENT_TEXT = 'I understand that the information I provide may be shared with partners and I agree to receive communications ' +
  'from them and Economic Times Business Verticals. I also agree to the Privacy Policy, Cookie Policy and T&C';
var CONSENT_MESSAGE = 'Please tick the box to agree before you submit.';
/* the portal whose pages the links are when the event's own is not known: ETCIO's, the ones the owner gave */
var CONSENT_FALLBACK_PORTAL = 'cio';
/* [label, page, always .php]: every portal's cookie policy is cookie_policy.php, the newer ones' too (their
   cookie_policy without it is a 404; checked on 21 Oct 2026) */
var CONSENT_PAGES = [['Privacy Policy', 'privacy_policy', false], ['Cookie Policy', 'cookie_policy', true], ['T&C', 'terms_conditions', false]];

/* The consent box for an event of `portal` (an ET portal's slug, e.g. 'hr'; '' or an unknown one: ETCIO's)
   -> { text, links: [{ label, href }], version, portal }. The pages are the portal's own: the older portals
   keep ".php" on the privacy and terms pages, the newer ones do not (lib/et-footer.js has which is which and
   the few on another host). version: a short hash of the text and the links, so a registration says which wording it agreed to. */
function consentFor(portal) {
  /* a portal ET lists that the footer's table does not have yet: its pages where the older portals keep them */
  var slug = etFooter.isKnown(portal) || etEvents.isPortal(portal) ? portal : CONSENT_FALLBACK_PORTAL;
  var d = etFooter.isKnown(slug) ? etFooter.DATA[slug] : {};
  var home = 'https://' + (d.host || slug + '.economictimes.indiatimes.com'), ext = d.clean ? '' : '.php';
  var links = CONSENT_PAGES.map(function (p) { return { label: p[0], href: home + '/' + p[1] + (p[2] ? '.php' : ext) }; });
  var version = crypto.createHash('sha256').update(CONSENT_TEXT + '\n' + links.map(function (l) { return l.label + ' ' + l.href; }).join('\n'))
    .digest('hex').slice(0, 12);
  return { text: CONSENT_TEXT, links: links, version: version, portal: slug };
}
/* The ET portal an event belongs to, from its sources (events/<id>/sources): the one its previous edition (or
   this edition's own page) was read from — the same rule as the site's ET footer (lib/api.js sitePortal, which
   forms.test.js checks this against). '' when none says. */
function portalOfSources(sourceDocs) {
  var own = (sourceDocs || []).filter(function (v) { return v && (v.type === 'previousEdition' || v.type === 'currentEdition'); });
  own.sort(function (a, b) { return (a.type === b.type ? 0 : a.type === 'previousEdition' ? -1 : 1) || (b.previous ? 1 : 0) - (a.previous ? 1 : 0); });
  for (var i = 0; i < own.length; i++) {
    var v = own[i], url = (v.previous && v.previous.url) || v.url;
    var portal = v.previous && etEvents.isPortal(v.previous.portal) ? v.previous.portal : etPrevious.portalOf(url);
    if (etEvents.isPortal(portal)) return portal;
  }
  return '';
}
/* What a registration keeps of the consent its visitor gave: the wording as shown, with its links named. */
function consentRecord(consent, atIso) {
  var c = isObj(consent) ? consent : consentFor('');
  var links = (Array.isArray(c.links) ? c.links : []).map(function (l) { return l.label + ': ' + l.href; }).join('; ');
  return { given: true, at: atIso, version: String(c.version || ''), text: String(c.text || CONSENT_TEXT) + (links ? ' (' + links + ')' : '') };
}

/* ---------- countries: India first, then A–Z ---------- */
var COUNTRIES = ['India'].concat([
  'Afghanistan', 'Åland Islands', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica',
  'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia',
  'Bonaire, Sint Eustatius and Saba', 'Bosnia and Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil',
  'British Indian Ocean Territory', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon',
  'Canada', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Christmas Island',
  'Cocos (Keeling) Islands', 'Colombia', 'Comoros', 'Congo', 'Congo (Democratic Republic)', 'Cook Islands', 'Costa Rica',
  'Côte d\'Ivoire', 'Croatia', 'Cuba', 'Curaçao', 'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini',
  'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Polynesia',
  'French Southern Territories', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland',
  'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti',
  'Heard Island and McDonald Islands', 'Holy See', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'Indonesia', 'Iran',
  'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya',
  'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein',
  'Lithuania', 'Luxembourg', 'Macao', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldova', 'Monaco',
  'Mongolia', 'Montenegro', 'Montserrat', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
  'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'North Korea',
  'North Macedonia', 'Northern Mariana Islands', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Pitcairn', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar',
  'Réunion', 'Romania', 'Russia', 'Rwanda', 'Saint Barthélemy', 'Saint Helena, Ascension and Tristan da Cunha',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin (French part)', 'Saint Pierre and Miquelon',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten (Dutch part)', 'Slovakia', 'Slovenia', 'Solomon Islands',
  'Somalia', 'South Africa', 'South Georgia and the South Sandwich Islands', 'South Korea', 'South Sudan', 'Spain',
  'Sri Lanka', 'Sudan', 'Suriname', 'Svalbard and Jan Mayen', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Türkiye',
  'Turkmenistan', 'Turks and Caicos Islands', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'United States Minor Outlying Islands', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam',
  'Virgin Islands (British)', 'Virgin Islands (U.S.)', 'Wallis and Futuna', 'Western Sahara', 'Yemen', 'Zambia', 'Zimbabwe'
].sort(function (a, b) { return a.localeCompare(b, 'en'); }));

/* ---------- small text helpers (the same rules lib/api-audience.js uses for what people type) ---------- */

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
/* one line: control characters out, runs of white space to one space; anything that is not text is nothing */
function line(v, max) {
  if (typeof v === 'number' && isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
}
/* text that may run over several lines */
function multiline(v, max) {
  if (typeof v === 'number' && isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max || 4000);
}
function isEmail(v) { return typeof v === 'string' && v.length <= 200 && v.indexOf('@') <= 64 && EMAIL_RE.test(v); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function isoOf(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return ''; } }
  return '';
}

/* ---------- ids ---------- */

/* An id from a name or a label: lower case, accents dropped, words joined by sep ('-' for a form, '_' for a
   field), starting with a letter, at most 40 characters. */
function slugify(text, sep) {
  sep = sep === '_' ? '_' : '-';
  var s = String(text == null ? '' : text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, sep);
  s = s.split(sep).filter(Boolean).join(sep);
  if (!/^[a-z]/.test(s)) s = (sep === '_' ? 'field' : 'form') + (s ? sep + s : '');
  return trimId(s.slice(0, 40), sep);
}
function trimId(s, sep) { while (s.length && s.charAt(s.length - 1) === sep) s = s.slice(0, -1); return s; }
/* An id that is also the name of something every plain object already has ("constructor"): looked up in an
   object built as a map ({}[id]) it finds that instead of nothing, so per-form totals, error maps and the
   AI's references would silently go wrong. No form or field is given one. */
function isReservedId(id) { return typeof id === 'string' && id in Object.prototype; }
/* base, else base-2, base-3 … (base_2 … for a field), never longer than 40 characters, never a reserved id */
function uniqueId(base, taken, sep) {
  sep = sep === '_' ? '_' : '-';
  var t = Array.isArray(taken) ? taken : Object.keys(taken || {});
  if (t.indexOf(base) === -1 && !isReservedId(base)) return base;
  for (var n = 2; n < 1000; n++) {
    var suffix = sep + n, cand = trimId(base.slice(0, 40 - suffix.length), sep) + suffix;
    if (t.indexOf(cand) === -1 && !isReservedId(cand)) return cand;
  }
  return trimId(base.slice(0, 30), sep) + sep + crypto.randomBytes(4).toString('hex');
}

/* ---------- templates and presets (the single source both builders are sent) ---------- */

function F(id, type, label, required, extra) {
  return Object.assign({ id: id, type: type, label: label, required: !!required, placeholder: '', help: '' }, extra || {});
}
/* The seven questions every new form starts with, in this order, all required: the email first (ET's own
   forms ask for it first, as "Official email"). */
var DEFAULT_FIELD_IDS = ['email', 'first_name', 'last_name', 'phone', 'company', 'designation', 'location'];
/* the order they had until 21 Oct 2026: a "Register now" still in it and never edited is moved on by
   tools/migrate-forms.js (isUntouchedDefault) */
var OLD_DEFAULT_FIELD_IDS = ['first_name', 'last_name', 'email', 'phone', 'company', 'designation', 'location'];
var DEFAULT_EMAIL_LABEL = 'Official email';
function defaultFields(emailLabel) {
  return [
    F('email', 'email', emailLabel || DEFAULT_EMAIL_LABEL, true),
    F('first_name', 'text', 'First name', true),
    F('last_name', 'text', 'Last name', true),
    F('phone', 'phone', 'Mobile number', true),
    F('company', 'text', 'Company', true),
    F('designation', 'text', 'Designation', true),
    F('location', 'location', 'Location', true, { placeholder: 'Start typing your city' })
  ];
}
/* the locked consent box (THE CONSENT BOX above) */
function consentField() { return F(CONSENT_ID, CONSENT_TYPE, 'Consent', true); }
function isConsentField(f) { return !!f && (f.id === CONSENT_ID || f.type === CONSENT_TYPE); }
/* a form's fields with the consent box last: whatever stood in its place (moved, relabelled, made optional, or
   missing — a form stored before it existed) is dropped and the locked item put back at the end */
function withConsent(fields) {
  return (Array.isArray(fields) ? fields : []).filter(function (f) { return !isConsentField(f); }).concat([consentField()]);
}
function templateForm(t) {
  return {
    name: t.name, title: t.name, intro: '', purpose: t.purpose,
    fields: withConsent(defaultFields(t.emailLabel).concat(t.fields)),
    submitLabel: t.submitLabel, successMessage: t.successMessage,
    countsAsRegistration: t.counts, needsApproval: t.approval, open: true, duplicates: 'reject', template: t.id
  };
}
var TEMPLATE_SOURCE = [
  { id: 'register', name: 'Register now', purpose: 'register', counts: true, approval: false,
    description: 'Counts as a registration',
    fields: [],
    submitLabel: 'Register', successMessage: DEFAULT_SUCCESS },
  { id: 'interest', name: 'Express interest', purpose: 'interest', counts: false, approval: false,
    description: 'An enquiry: does not count as a registration',
    fields: [F('message', 'textarea', 'Anything you would like us to know?', false)],
    submitLabel: 'Express interest', successMessage: 'Thank you for your interest. The organisers will be in touch.' },
  { id: 'partner', name: 'Join as partner', purpose: 'partner', counts: false, approval: false,
    description: 'A partnership enquiry: does not count as a registration',
    fields: [F('partnership', 'select', 'Partnership interest', true, { options: ['Presenting partner', 'Associate partner', 'Exhibitor', 'Knowledge partner', 'Other'] }),
      F('message', 'textarea', 'Tell us about your goals', false)],
    submitLabel: 'Send enquiry', successMessage: 'Thank you. The partnerships team will get back to you.' },
  { id: 'vip', name: 'VIP delegates', purpose: 'vip', counts: true, approval: true,
    description: 'Needs approval, counts as a registration',
    fields: [F('linkedin', 'url', 'LinkedIn profile', false, { placeholder: 'https://www.linkedin.com/in/…' }),
      F('why_attend', 'textarea', 'Why would you like to attend?', false)],
    submitLabel: 'Request an invitation', successMessage: 'Thank you. The organisers will review your request.' },
  { id: 'speaker', name: 'Speaker application', purpose: 'speaker', counts: false, approval: true,
    description: 'Needs approval, does not count as a registration',
    fields: [F('linkedin', 'url', 'LinkedIn profile', true, { placeholder: 'https://www.linkedin.com/in/…' }),
      F('topic', 'text', 'Proposed topic', true), F('abstract', 'textarea', 'Short abstract', true)],
    submitLabel: 'Apply to speak', successMessage: 'Thank you for applying. The programme team will review your application.' },
  { id: 'blank', name: 'Custom form', purpose: 'custom', counts: false, approval: false,
    description: 'Starts with the standard questions (email, name, mobile, company, designation, location); add your own',
    fields: [], submitLabel: 'Submit', successMessage: 'Thank you. Your response has been received.' }
];
/* [{ id, name, description, purpose, countsAsRegistration, needsApproval, form: FormInput (no id) }] */
var FORM_TEMPLATES = TEMPLATE_SOURCE.map(function (t) {
  return { id: t.id, name: t.name, description: t.name + ': ' + t.description.charAt(0).toLowerCase() + t.description.slice(1),
    purpose: t.purpose, countsAsRegistration: t.counts, needsApproval: t.approval, form: templateForm(t) };
});
var TEMPLATE_BY_ID = {};
FORM_TEMPLATES.forEach(function (t) { TEMPLATE_BY_ID[t.id] = t; });
var TEMPLATE_IDS = FORM_TEMPLATES.map(function (t) { return t.id; });
/* templates a form may be stored as but no builder offers: an award's nomination form is made from its
   categories (awardNominationForm, lib/api-forms.js createAwardForms), never picked from a list */
var NOMINATION_TEMPLATE = 'nomination';
var STORED_TEMPLATE_IDS = TEMPLATE_IDS.concat([NOMINATION_TEMPLATE]);

/* The builder's "Add field" quick picks: { presetId, label, field }. A preset's id is a suggestion: when the
   form already has a field with that id, the builder sends the new one without an id and is given one. */
var FIELD_PRESETS = [
  { presetId: 'first_name', label: 'First name', field: F('first_name', 'text', 'First name', false) },
  { presetId: 'last_name', label: 'Last name', field: F('last_name', 'text', 'Last name', false) },
  { presetId: 'phone', label: 'Mobile (with country code)', field: F('phone', 'phone', 'Mobile number', false) },
  { presetId: 'company', label: 'Company', field: F('company', 'text', 'Company', false) },
  { presetId: 'designation', label: 'Designation', field: F('designation', 'text', 'Designation', false) },
  { presetId: 'location', label: 'Location (city, state, country)', field: F('location', 'location', 'Location', false, { placeholder: 'Start typing your city' }) },
  { presetId: 'city', label: 'City', field: F('city', 'text', 'City', false) },
  { presetId: 'country', label: 'Country', field: F('country', 'country', 'Country', false) },
  { presetId: 'linkedin', label: 'LinkedIn profile', field: F('linkedin', 'url', 'LinkedIn profile', false, { placeholder: 'https://www.linkedin.com/in/…' }) },
  { presetId: 'website', label: 'Website', field: F('website', 'url', 'Website', false) },
  { presetId: 'message', label: 'Message', field: F('message', 'textarea', 'Message', false) }
].concat(FIELD_TYPES.map(function (type) {
  var extra = OPTION_TYPES.indexOf(type) !== -1 ? { options: ['Option 1', 'Option 2'] } : null;
  return { presetId: 'blank-' + type, label: FIELD_TYPE_LABELS[type], field: F('', type, '', false, extra) };
}));

/* ---------- what may be stored as a form ---------- */

var FORM_KEYS = ['id', 'name', 'title', 'intro', 'purpose', 'fields', 'submitLabel', 'successMessage', 'countsAsRegistration',
  'needsApproval', 'open', 'duplicates', 'template'];
/* what the server itself keeps on a form, and a builder may send back as it was given: ignored, never refused */
var SERVER_KEYS = ['rev', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'order', 'submissions', 'pending'];
var FIELD_KEYS = ['id', 'type', 'label', 'required', 'placeholder', 'help', 'options', 'maxWords', 'requiredWhen'];
var CONDITION_TYPES = ['select', 'radio'];

function fail(error, field) { return { error: error, field: field || '' }; }
function tooLong(what, max) { return what + ' is too long (the limit is ' + max + ' characters).'; }
function textIn(input, key, max, required, what, multi) {
  var v = input[key];
  if (v == null) v = '';
  if (typeof v !== 'string') return { error: fail(what + ' must be text.', key) };
  var clean = multi ? multiline(v, 100000) : line(v, 100000);
  if (required && !clean) return { error: fail(what + ' is required.', key) };
  if (clean.length > max) return { error: fail(tooLong(what, max), key) };
  return { value: clean };
}
function boolIn(input, key, dflt, what) {
  if (!has(input, key) || input[key] == null) return { value: dflt };
  if (typeof input[key] !== 'boolean') return { error: fail('"' + what + '" must be on or off.', key) };
  return { value: input[key] };
}

/* Options of a select / radio / multiselect field: 1–300 different, non-empty lines of at most 120 characters. */
function cleanOptions(v, where, label) {
  if (!Array.isArray(v) || !v.length) return { error: fail('“' + label + '” needs at least one option to choose from.', where) };
  if (v.length > LIMITS.maxOptions) return { error: fail('“' + label + '” can have at most ' + LIMITS.maxOptions + ' options.', where) };
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') return { error: fail('Option ' + (i + 1) + ' of “' + label + '” must be text.', where + '.' + i) };
    var o = line(v[i], 100000);
    if (!o) return { error: fail('Option ' + (i + 1) + ' of “' + label + '” is empty.', where + '.' + i) };
    if (o.length > TEXT.option) return { error: fail(tooLong('Option ' + (i + 1) + ' of “' + label + '”', TEXT.option), where + '.' + i) };
    if (out.indexOf(o) !== -1) return { error: fail('“' + label + '” lists the option “' + o + '” twice.', where + '.' + i) };
    out.push(o);
  }
  return { value: out };
}

/* A form as a client sent it (create or update) -> { value } ready to store (no id, rev, order or timestamps —
   the route adds those), or { error, field } naming what is wrong. field is a path into the input
   ("name", "fields.3.label", "fields.3.options.1") so a builder can show the message on that control.
   opts: { creating: bool, formId: the form being updated }. On create, `id` is a suggestion (value.id). */
function cleanFormInput(input, opts) {
  opts = opts || {};
  if (!isObj(input)) return fail('The form must be an object.', '');
  var keys = Object.keys(input);
  for (var k = 0; k < keys.length; k++) {
    if (FORM_KEYS.indexOf(keys[k]) === -1 && SERVER_KEYS.indexOf(keys[k]) === -1) return fail('"' + keys[k] + '" is not a form setting.', keys[k]);
  }
  var out = {}, r;
  if (input.id != null && input.id !== '') {
    if (typeof input.id !== 'string' || !FORM_ID_RE.test(input.id)) {
      return fail('A form id is lower-case letters, digits and hyphens, starting with a letter (at most 40).', 'id');
    }
    if (opts.creating && isReservedId(input.id)) return fail('"' + input.id + '" cannot be a form id. Choose another.', 'id');
    if (!opts.creating && opts.formId && input.id !== opts.formId) return fail('A form’s id cannot be changed.', 'id');
    if (opts.creating) out.id = input.id;
  }
  if ((r = textIn(input, 'name', TEXT.name, true, 'The form’s name')).error) return r.error;
  out.name = r.value;
  if ((r = textIn(input, 'title', TEXT.title, false, 'The heading visitors see')).error) return r.error;
  out.title = r.value;
  if ((r = textIn(input, 'intro', TEXT.intro, false, 'The introduction', true)).error) return r.error;
  out.intro = r.value;
  var purpose = input.purpose == null || input.purpose === '' ? 'custom' : input.purpose;
  if (PURPOSES.indexOf(purpose) === -1) return fail('The purpose must be one of: ' + PURPOSES.join(', ') + '.', 'purpose');
  out.purpose = purpose;

  var fr = cleanFields(input.fields);
  if (fr.error) return fr;
  out.fields = fr.value;

  if ((r = textIn(input, 'submitLabel', TEXT.submitLabel, true, 'The submit button’s label')).error) return r.error;
  out.submitLabel = r.value;
  if ((r = textIn(input, 'successMessage', TEXT.successMessage, true, 'The success message', true)).error) return r.error;
  out.successMessage = r.value;
  if ((r = boolIn(input, 'countsAsRegistration', false, 'Counts as a registration')).error) return r.error;
  out.countsAsRegistration = r.value;
  if ((r = boolIn(input, 'needsApproval', false, 'Needs approval')).error) return r.error;
  out.needsApproval = r.value;
  if ((r = boolIn(input, 'open', true, 'Accept responses')).error) return r.error;
  out.open = r.value;
  var dup = input.duplicates == null || input.duplicates === '' ? 'reject' : input.duplicates;
  if (dup !== 'reject' && dup !== 'allow') return fail('"One response per email" must be "reject" or "allow".', 'duplicates');
  out.duplicates = dup;
  var tpl = input.template == null || input.template === '' ? 'blank' : input.template;
  if (STORED_TEMPLATE_IDS.indexOf(tpl) === -1) return fail('"template" must be one of: ' + TEMPLATE_IDS.join(', ') + '.', 'template');
  out.template = tpl;
  return { value: out };
}

/* The consent box a builder sends back (type "consent", wherever it stands and whatever it says) is not the
   organiser's to change: it is dropped here and the locked item put back last. An organiser's own question may
   not take its id. */
function cleanFields(list) {
  if (!Array.isArray(list)) return fail('"fields" must be a list of fields.', 'fields');
  var own = list.filter(function (f) { return !(isObj(f) && f.type === CONSENT_TYPE); }).length;
  if (own > LIMITS.maxFields) return fail('A form can have at most ' + LIMITS.maxFields + ' fields.', 'fields');
  var fields = [], given = [], at = [], i;
  for (i = 0; i < list.length; i++) {
    var f = list[i], where = 'fields.' + i, n = 'Field ' + (i + 1);
    if (!isObj(f)) return fail(n + ' is not a valid field.', where);
    if (f.type === CONSENT_TYPE) continue;
    if (f.id === CONSENT_ID) return fail('“consent” is the id of the consent box every form ends with. Give this field another id.', where + '.id');
    var fk = Object.keys(f);
    for (var j = 0; j < fk.length; j++) {
      if (FIELD_KEYS.indexOf(fk[j]) === -1) return fail('"fields[' + i + '].' + fk[j] + '" is not a field setting.', where + '.' + fk[j]);
    }
    if (FIELD_TYPES.indexOf(f.type) === -1) return fail(n + ' has no valid type (one of: ' + FIELD_TYPES.join(', ') + ').', where + '.type');
    if (f.label != null && typeof f.label !== 'string') return fail(n + '’s label must be text.', where + '.label');
    var label = line(f.label, 100000);
    if (!label) return fail(n + ' needs a label.', where + '.label');
    if (label.length > TEXT.label) return fail(tooLong(n + '’s label', TEXT.label), where + '.label');
    if (f.required != null && typeof f.required !== 'boolean') return fail('“' + label + '”: "required" must be on or off.', where + '.required');
    var out = { id: '', type: f.type, label: label, required: f.required === true, placeholder: '', help: '' };
    var r = textIn(f, 'placeholder', TEXT.placeholder, false, 'The placeholder of “' + label + '”');
    if (r.error) { r.error.field = where + '.placeholder'; return r.error; }
    out.placeholder = r.value;
    r = textIn(f, 'help', TEXT.help, false, 'The help text of “' + label + '”');
    if (r.error) { r.error.field = where + '.help'; return r.error; }
    out.help = r.value;
    if (OPTION_TYPES.indexOf(f.type) !== -1) {
      var o = cleanOptions(f.options, where + '.options', label);
      if (o.error) return o.error;
      out.options = o.value;
    }
    if (f.maxWords != null && f.maxWords !== '') {
      if (f.type !== 'textarea') return fail('Only a Long text field can have a word limit (“' + label + '”).', where + '.maxWords');
      if (typeof f.maxWords !== 'number' || Math.floor(f.maxWords) !== f.maxWords || f.maxWords < WORDS.min || f.maxWords > WORDS.max) {
        return fail('The word limit of “' + label + '” must be a whole number from ' + WORDS.min + ' to ' + WORDS.max + '.', where + '.maxWords');
      }
      out.maxWords = f.maxWords;
    }
    if (f.requiredWhen != null) {
      var rw = f.requiredWhen;
      if (!isObj(rw) || typeof rw.field !== 'string' || typeof rw.equals !== 'string' || Object.keys(rw).some(function (k) { return k !== 'field' && k !== 'equals'; })) {
        return fail('“' + label + '”: "requiredWhen" must be { field, equals }.', where + '.requiredWhen');
      }
      /* a field required anyway needs no condition: it is dropped */
      if (out.required !== true) out.requiredWhen = { field: rw.field, equals: line(rw.equals, 100000) };
    }
    if (f.id != null && f.id !== '') {
      if (typeof f.id !== 'string' || !FIELD_ID_RE.test(f.id)) {
        return fail('The id of “' + label + '” must be lower-case letters, digits and underscores, starting with a letter (at most 40).', where + '.id');
      }
      if (isReservedId(f.id)) return fail('"' + f.id + '" cannot be a field id. Choose another.', where + '.id');
      if (given.indexOf(f.id) !== -1) return fail('Two fields have the same id ("' + f.id + '").', where + '.id');
      given.push(f.id);
      out.id = f.id;
    }
    fields.push(out);
    at.push(i);
  }
  /* fields sent without an id are given one from their label; a column's id only when the type fits it */
  var taken = given.slice();
  fields.forEach(function (fd) {
    if (fd.id) return;
    var base = slugify(fd.label, '_'), avoid = taken.slice();
    MAPPED_FIELDS.forEach(function (m) { if (MAPPED_TYPES[m] !== fd.type && avoid.indexOf(m) === -1) avoid.push(m); });
    fd.id = uniqueId(base, avoid, '_');
    taken.push(fd.id);
  });
  for (i = 0; i < fields.length; i++) {
    var fd = fields[i], want = MAPPED_TYPES[fd.id];
    if (want && fd.type !== want) {
      if (fd.id === 'email') return fail('The email field is always an Email field.', 'fields.' + at[i] + '.type');
      return fail('“' + fd.label + '” holds the registration’s ' + fd.id.replace(/_/g, ' ') + ', so it must be a ' + FIELD_TYPE_LABELS[want] + ' field.', 'fields.' + at[i] + '.type');
    }
  }
  for (i = 0; i < fields.length; i++) {
    var cond = fields[i].requiredWhen;
    if (!cond) continue;
    var where2 = 'fields.' + at[i] + '.requiredWhen';
    if (LOCKED_FIELDS.indexOf(fields[i].id) !== -1) return fail('The ' + fields[i].id + ' field is always required: it cannot be required only sometimes.', where2);
    var ref = -1;
    for (var r2 = 0; r2 < i; r2++) if (fields[r2].id === cond.field) ref = r2;
    if (ref === -1) return fail('“' + fields[i].label + '” is required only when another question has a certain answer, but that question (“' + cond.field + '”) is not above it in this form.', where2);
    if (CONDITION_TYPES.indexOf(fields[ref].type) === -1) return fail('“' + fields[i].label + '” can depend only on a Dropdown or Single choice question, and “' + fields[ref].label + '” is not one.', where2);
    if ((fields[ref].options || []).indexOf(cond.equals) === -1) return fail('“' + fields[i].label + '” is required when “' + fields[ref].label + '” is “' + cond.equals + '”, which is not one of its options.', where2);
  }
  for (i = 0; i < LOCKED_FIELDS.length; i++) {
    var id = LOCKED_FIELDS[i], x = -1;
    fields.forEach(function (fd, k) { if (fd.id === id) x = k; });
    if (x === -1) return fail('Every form asks for an email address: the "' + id + '" field is missing.', 'fields');
    if (!fields[x].required) return fail('The ' + id + ' field is always required: it is how one response is told from another.', 'fields.' + at[x] + '.required');
  }
  if (fields.length < MIN_FIELDS) return fail('A form needs at least ' + MIN_FIELDS + ' fields.', 'fields');
  return { value: withConsent(fields) };
}

/* ---------- an award's forms (lib/api-forms.js createAwardForms stores them) ----------
   An award site's main button says "Express Interest" before nominations open and "Nominate Now" while they
   are open (templates/_shared/rv-award-cta.js). Each opens one of these two forms. Both are ordinary forms:
   an organiser edits them in either builder like any other, and their responses are in Reporting under the
   form's name. Neither counts as a registration; nominating is free (no fee is taken). */
var NOMINEE_TYPES = ['Individual', 'Organisation'];
var CATEGORY_SEP = ' › ';          // "Master › Sub"
var AWARD_NOMINATION_NAME = 'Nomination';
var AWARD_INTEREST_NAME = 'Express Interest';
var ENTRY_SUMMARY_WORDS = 300;

/* An award's categories as the options of the nomination form's Category field -> { options, skipped }.
   categories: a list of any of
     'Master › Sub' or 'Category'                      as written
     { master|group|parent, name|title|sub }           'Master › Name' ('Name' alone without a master)
     { name|title, subcategories|subs|children: [...] }  one option per sub ('Name › Sub'), the name itself when
                                                       it has none; a sub is text or { name|title }
   Each option is one line of at most 120 characters (longer ones are shortened, ending "…"); the same option
   twice is kept once; after 300 (LIMITS.maxOptions), the rest are left out and counted in `skipped`. */
function awardCategoryOptions(categories) {
  var out = [], skipped = 0;
  function nameOf(v) { return typeof v === 'string' ? line(v, 1000) : isObj(v) ? line(v.name || v.title || v.sub || v.label || '', 1000) : ''; }
  function push(label) {
    label = line(label, 1000);
    if (!label) return;
    if (label.length > TEXT.option) label = label.slice(0, TEXT.option - 1).replace(/\s+\S*$/, '').trim().slice(0, TEXT.option - 1) + '…';
    if (out.indexOf(label) !== -1) return;
    if (out.length >= LIMITS.maxOptions) { skipped++; return; }
    out.push(label);
  }
  (Array.isArray(categories) ? categories : []).forEach(function (c) {
    if (typeof c === 'string') return push(c);
    if (!isObj(c)) return;
    var subs = c.subcategories || c.subs || c.children;
    var master = line(c.master || c.group || c.parent || '', 1000), name = nameOf(c);
    if (Array.isArray(subs) && subs.length) {
      var named = 0;
      subs.forEach(function (sub) { var n = nameOf(sub); if (n) { named++; push((name ? name + CATEGORY_SEP : '') + n); } });
      if (named) return;
    }
    if (name) push(master ? master + CATEGORY_SEP + name : name);
  });
  return { options: out, skipped: skipped };
}

/* The nomination form (FormInput, no id): the award's categories, who is nominated, their organisation, how to
   reach the nominator, the entry itself, and the consent box. Nominee name, designation and organisation are
   the registration's own name / designation / company columns, so Reporting lists nominations like any other
   response; the designation is asked of an individual and optional for an organisation (requiredWhen).
   One person may nominate in several categories: duplicates are allowed. opts: { options (the categories as
   awardCategoryOptions gives them, at least one), title, name } */
function awardNominationForm(opts) {
  opts = opts || {};
  var fields = [
    F('category', 'select', 'Category', true, { options: (opts.options || []).slice() }),
    F('nominee_type', 'radio', 'Nominee type', true, { options: NOMINEE_TYPES.slice() }),
    F('name', 'text', 'Nominee name', true, { help: 'The person or organisation you are nominating.' }),
    F('designation', 'text', 'Nominee designation', false, { help: 'Not needed when the nominee is an organisation.', requiredWhen: { field: 'nominee_type', equals: 'Individual' } }),
    F('company', 'text', 'Organisation', true),
    F('email', 'email', DEFAULT_EMAIL_LABEL, true),
    F('phone', 'phone', 'Mobile number', true),
    F('entry_title', 'text', 'Entry title', true),
    F('entry_summary', 'textarea', 'Entry summary', true, { maxWords: ENTRY_SUMMARY_WORDS, help: 'What the nominee did and the difference it made, in up to ' + ENTRY_SUMMARY_WORDS + ' words.' }),
    F('supporting_link', 'url', 'Supporting link', false, { placeholder: 'https://', help: 'A page, document or video that supports the entry. Optional.' })
  ];
  return {
    name: line(opts.name, TEXT.name) || AWARD_NOMINATION_NAME,
    title: line(opts.title, TEXT.title) || 'Submit a nomination',
    intro: '', purpose: 'nomination', fields: withConsent(fields),
    submitLabel: 'Submit nomination',
    successMessage: 'Thank you. Your nomination has been received, and the awards team will be in touch.',
    countsAsRegistration: false, needsApproval: false, open: true, duplicates: 'allow', template: NOMINATION_TEMPLATE
  };
}
/* The "Express Interest" form (FormInput, no id): the seven standard questions and the consent box. */
function awardInterestForm(opts) {
  opts = opts || {};
  return {
    name: line(opts.name, TEXT.name) || AWARD_INTEREST_NAME,
    title: line(opts.title, TEXT.title) || AWARD_INTEREST_NAME,
    intro: '', purpose: 'interest', fields: withConsent(defaultFields()),
    submitLabel: 'Express interest',
    successMessage: 'Thank you for your interest. We will let you know when nominations open.',
    countsAsRegistration: false, needsApproval: false, open: true, duplicates: 'reject', template: 'interest'
  };
}
/* Which of an event's forms (stored forms, in order) are its award forms -> { nominate, interest } (null when
   it has none): the first form made for nominations, and the first expression-of-interest form. */
function findAwardForms(list) {
  list = Array.isArray(list) ? list : [];
  return {
    nominate: list.filter(function (f) { return f && f.purpose === 'nomination'; })[0] || null,
    interest: list.filter(function (f) { return f && f.purpose === 'interest'; })[0] || null
  };
}
/* A nomination form's Category field given new options -> the new fields, or null when nothing changes (no
   Category select any more, or the same options). Nothing else of the form is touched. */
function withCategoryOptions(form, options) {
  if (!form || !Array.isArray(options) || !options.length) return null;
  var changed = false;
  var fields = (form.fields || []).map(function (f) {
    if (f.id !== 'category' || f.type !== 'select') return f;
    if (JSON.stringify(f.options || []) === JSON.stringify(options)) return f;
    changed = true;
    return Object.assign({}, f, { options: options.slice() });
  });
  return changed ? fields : null;
}

/* ---------- the event's original single form ---------- */

/* event.settings.registration as it was before forms existed, read defensively (it is whatever a PATCH
   stored). Name and email always; phone, company and designation shown but optional, city not shown,
   unless the organiser chose otherwise. Also the event-wide switches every form shares. */
var LEGACY_OPTIONAL = [
  { key: 'phone', label: 'Phone number', type: 'tel', show: true },
  { key: 'company', label: 'Company', type: 'text', show: true },
  { key: 'designation', label: 'Designation', type: 'text', show: true },
  { key: 'city', label: 'City', type: 'text', show: false }
];
function legacyRegistration(ev) {
  var r = ev && isObj(ev.settings) && isObj(ev.settings.registration) ? ev.settings.registration : {};
  var set = isObj(r.fields) ? r.fields : {};
  var fields = [
    { key: 'name', label: 'Full name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true }
  ];
  LEGACY_OPTIONAL.forEach(function (f) {
    var s = set[f.key], show = f.show, required = false;
    if (typeof s === 'boolean') show = s;
    else if (isObj(s)) {
      if (typeof s.show === 'boolean') show = s.show;
      required = s.required === true;
    }
    if (show) fields.push({ key: f.key, label: f.label, type: f.type, required: required });
  });
  var capacity = Number(r.capacity), target = Number(r.target);
  return {
    open: r.open !== false,
    duplicates: r.duplicates === 'allow' ? 'allow' : 'reject',
    capacity: r.capacity != null && isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : null,
    target: r.target != null && isFinite(target) && target > 0 ? Math.floor(target) : null,
    successMessage: multiline(r.successMessage, 600) || DEFAULT_SUCCESS,
    defaultFormId: typeof r.defaultFormId === 'string' && FORM_ID_RE.test(r.defaultFormId) ? r.defaultFormId : '',
    fields: fields
  };
}

/* The questions the event's original single form asked (settings.registration.fields): a name, an email and
   the optional ones the organiser chose. Until the seven standard questions, also what every event's
   "Register now" was made with — how tools/migrate-forms.js tells one nobody has edited (isUntouchedDefault). */
function legacyFields(ev) {
  return legacyRegistration(ev || {}).fields.map(function (f) {
    return F(f.key, f.type === 'tel' ? 'phone' : f.type, f.label, f.key === 'name' || f.key === 'email' || f.required);
  });
}
/* the organiser chose the original single form's questions themselves, before forms existed: those are kept */
function hasLegacyFieldChoice(ev) {
  var r = ev && isObj(ev.settings) && isObj(ev.settings.registration) ? ev.settings.registration : null;
  return !!r && isObj(r.fields) && Object.keys(r.fields).length > 0;
}

/* The form "register": what an event has until a form is saved — the seven standard questions, or, for an
   event whose organiser chose the original single form's questions, those. */
function legacyDefaultForm(ev) {
  var legacy = legacyRegistration(ev || {});
  var at = isoOf(ev && ev.createdAt) || '', by = (ev && typeof ev.createdBy === 'string' && ev.createdBy) || 'system';
  return {
    id: DEFAULT_FORM_ID, name: 'Register now', title: 'Register now', intro: '', purpose: 'register',
    fields: withConsent(hasLegacyFieldChoice(ev) ? legacyFields(ev) : defaultFields()),
    submitLabel: 'Register', successMessage: legacy.successMessage,
    countsAsRegistration: true, needsApproval: false, open: true, duplicates: legacy.duplicates,
    order: 0, template: 'register', rev: 0, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by
  };
}

/* The seven standard questions as they were until 21 Oct 2026: First name, Last name, Email first … */
function oldDefaultFields() {
  var std = defaultFields('Email'), byId = {};
  std.forEach(function (f) { byId[f.id] = f; });
  return OLD_DEFAULT_FIELD_IDS.map(function (id) { return byId[id]; });
}
/* A stored "Register now" made for the event automatically and never edited by anyone since: nobody ever saved
   it (rev 0), or only tools/migrate-forms.js did (updatedBy "migration: …"), and its questions are still
   exactly ones the platform gave it — the original form's (name, email and the optional phone / company /
   designation), or the seven standard questions in their old order. The consent box is left out of the
   comparison (it is the platform's, in every form). tools/migrate-forms.js gives such a form today's standard
   questions; a form an organiser saved keeps its order. */
function isUntouchedDefault(form, ev) {
  if (!form || form.id !== DEFAULT_FORM_ID || hasLegacyFieldChoice(ev)) return false;
  var byMigration = /^migration\b/.test(String(form.updatedBy || ''));
  if (Number(form.rev) !== 0 && !byMigration) return false;
  function sig(list) {
    return JSON.stringify((list || []).filter(function (f) { return !isConsentField(f); })
      .map(function (f) { return [f.id, f.type, f.label, f.required === true, f.placeholder || '', f.help || '']; }));
  }
  var now = sig(form.fields);
  return now === sig(legacyFields(ev)) || now === sig(oldDefaultFields());
}
/* the platform's own questions are already today's: nothing for a migration to do to their order */
function hasCurrentDefaults(form) {
  var ids = (form && form.fields || []).filter(function (f) { return !isConsentField(f); }).map(function (f) { return f.id; });
  return JSON.stringify(ids) === JSON.stringify(DEFAULT_FIELD_IDS);
}

/* What tools/migrate-forms.js does to one stored form document (`data` as stored, under `id`) ->
     { action: 'standard', patch }  an untouched "Register now" (isUntouchedDefault): today's seven standard
                                    questions, then the consent box; its rev moves on and the migration signs it
     { action: 'consent', patch, kept }  any other form not already ending with the consent box: the box stored
                                    last, the form's own questions and their order as they are; only `fields`
                                    is written (not rev or who changed it), so an open builder sees no conflict
     { action: 'none', kept }       nothing to do
   The stored fields are judged as stored, not as storedForm reads them (it adds the box). */
var MIGRATION_SIGNATURE = 'migration: standard questions, email first, consent';
function migrationPlan(id, data, ev, nowIso) {
  data = isObj(data) ? data : {};
  var raw = Array.isArray(data.fields) ? data.fields : [];
  var f = storedForm(id, data);
  if (id === DEFAULT_FORM_ID && isUntouchedDefault(f, ev)) {
    return { action: 'standard', patch: { fields: withConsent(defaultFields()), rev: (Number(data.rev) || 0) + 1, updatedAt: nowIso, updatedBy: MIGRATION_SIGNATURE } };
  }
  var kept = hasCurrentDefaults(f) ? 'already has the standard questions' : f.rev ? 'edited by the organiser, kept' : 'kept (not the original questions)';
  var boxes = raw.filter(function (x) { return isObj(x) && isConsentField(x); }), last = raw[raw.length - 1];
  /* Firestore gives a map's keys back in its own order: compared key by key */
  var box = consentField();
  var isBox = isObj(last) && Object.keys(last).length === Object.keys(box).length && Object.keys(box).every(function (k) { return last[k] === box[k]; });
  if (boxes.length === 1 && isBox) return { action: 'none', kept: kept };
  return { action: 'consent', kept: kept, patch: { fields: withConsent(raw.filter(function (x) { return isObj(x) && !isConsentField(x); })) } };
}

/* A field's word limit and its condition, as stored, onto `out` (a field of the same type): only what is
   well formed, so a reader never has to check again. */
function copyExtras(f, out) {
  var mw = Number(f && f.maxWords);
  if (out.type === 'textarea' && isFinite(mw) && Math.floor(mw) === mw && mw >= WORDS.min && mw <= WORDS.max) out.maxWords = mw;
  var rw = f && f.requiredWhen;
  if (!out.required && isObj(rw) && typeof rw.field === 'string' && rw.field && typeof rw.equals === 'string') out.requiredWhen = { field: rw.field, equals: rw.equals };
  return out;
}

/* A stored form document as every reader sees it: defaults filled in, never a missing list. */
function storedForm(id, d) {
  d = isObj(d) ? d : {};
  /* the consent box is the platform's: put back last whatever was stored (a form saved before it existed has
     none; the migration stores it) */
  var fields = withConsent((Array.isArray(d.fields) ? d.fields : []).filter(isObj).filter(function (f) { return !isConsentField(f); }).map(function (f) {
    var out = { id: String(f.id || ''), type: FIELD_TYPES.indexOf(f.type) !== -1 ? f.type : 'text', label: String(f.label || ''),
      required: f.required === true, placeholder: String(f.placeholder || ''), help: String(f.help || '') };
    if (OPTION_TYPES.indexOf(out.type) !== -1) out.options = (Array.isArray(f.options) ? f.options : []).filter(function (o) { return typeof o === 'string'; });
    copyExtras(f, out);
    return out;
  }));
  return {
    id: id, name: String(d.name || id), title: String(d.title || ''), intro: String(d.intro || ''),
    purpose: PURPOSES.indexOf(d.purpose) !== -1 ? d.purpose : 'custom', fields: fields,
    submitLabel: String(d.submitLabel || 'Submit'), successMessage: String(d.successMessage || DEFAULT_SUCCESS),
    countsAsRegistration: d.countsAsRegistration === true, needsApproval: d.needsApproval === true, open: d.open !== false,
    duplicates: d.duplicates === 'allow' ? 'allow' : 'reject', order: Number(d.order) || 0,
    template: STORED_TEMPLATE_IDS.indexOf(d.template) !== -1 ? d.template : 'blank', rev: Number(d.rev) || 0,
    createdAt: isoOf(d.createdAt), createdBy: String(d.createdBy || ''), updatedAt: isoOf(d.updatedAt), updatedBy: String(d.updatedBy || '')
  };
}
function byOrder(a, b) {
  return (a.order - b.order) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a.id < b.id ? -1 : 1));
}

/* settings.registration.defaultFormId when it names one of the forms, else the first form */
function resolveDefaultFormId(ev, forms) {
  var want = legacyRegistration(ev || {}).defaultFormId || DEFAULT_FORM_ID;
  if (forms.some(function (f) { return f.id === want; })) return want;
  return forms.length ? forms[0].id : DEFAULT_FORM_ID;
}

/* ---------- what a browser is told ---------- */

/* The consent box as a page is told it: { text, links: [{ label, href }], version } */
function publicConsent(consent) {
  var c = isObj(consent) && typeof consent.text === 'string' ? consent : consentFor('');
  return { text: c.text, links: (c.links || []).map(function (l) { return { label: l.label, href: l.href }; }), version: c.version };
}
/* One form for a visitor's page: an allow-list, so nothing an organiser keeps for themselves (the success
   message comes back with the registration; approval, duplicates, order and who changed it never leave).
   Its last field is the consent box ({ id: 'consent', type: 'consent' }), whose wording and links are
   `consent` (consentFor: the event's portal's pages). */
function publicForm(form, ev, consent) {
  var eventOpen = legacyRegistration(ev || {}).open;
  return {
    id: form.id, name: form.name, title: form.title || '', intro: form.intro || '', purpose: form.purpose,
    fields: withConsent(form.fields).map(function (f) {
      var out = { id: f.id, type: f.type, label: f.label, required: !!f.required, placeholder: f.placeholder || '', help: f.help || '' };
      if (OPTION_TYPES.indexOf(f.type) !== -1) out.options = (f.options || []).slice();
      if (f.type === 'country') out.options = COUNTRIES.slice();
      return copyExtras(f, out);
    }),
    submitLabel: form.submitLabel, open: form.open !== false && eventOpen, counts: form.countsAsRegistration === true, rev: form.rev || 0,
    consent: publicConsent(consent)
  };
}
function counterNum(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
/* the confirmed places are all taken: a counted form still takes registrations, onto the waitlist */
function isFull(ev) {
  var legacy = legacyRegistration(ev || {}), c = ev && isObj(ev.counters) ? ev.counters : {};
  return legacy.capacity != null && Number(c.audienceV) >= 1 && counterNum(c.confirmed) >= legacy.capacity;
}
/* GET /api/public/forms, and the #rv-forms block publishing writes into a page. consent: consentFor(the
   event's portal) — the same box on every form of the event, so also said once for the whole page. */
function publicFormsPayload(eventId, ev, forms, consent) {
  return {
    v: 1, eventId: eventId, open: legacyRegistration(ev || {}).open, defaultFormId: resolveDefaultFormId(ev, forms),
    waitlist: isFull(ev), consent: publicConsent(consent), forms: forms.map(function (f) { return publicForm(f, ev, consent); })
  };
}

/* ---------- a visitor's answers ---------- */

function requiredMessage(f) {
  if (isConsentField(f)) return CONSENT_MESSAGE;
  if (f.id === 'name') return 'Please enter your name.';
  if (f.id === 'first_name') return 'Please enter your first name.';
  if (f.id === 'last_name') return 'Please enter your last name.';
  if (f.id === 'email') return 'Please enter your email address.';
  if (f.type === 'checkbox') return 'Please tick ' + f.label + ' to continue.';
  if (f.type === 'select' || f.type === 'radio' || f.type === 'country') return 'Please choose ' + f.label + '.';
  if (f.type === 'multiselect') return 'Please choose at least one option for ' + f.label + '.';
  return 'Please fill in ' + f.label + '.';
}
function optionMessage(f) { return 'Please choose one of the options for ' + f.label + '.'; }
/* words: what is between spaces and line breaks (the page counts them the same way as the visitor types) */
function wordCount(s) { var t = String(s == null ? '' : s).trim(); return t ? t.split(/\s+/).length : 0; }
function wordsMessage(f, n) { return 'Please keep ' + f.label + ' to ' + f.maxWords + ' words or fewer (it has ' + n + ').'; }
/* the characters a Long text answer may have: 2,000, or room for its word limit (12 a word, at most 8,000) */
function textareaMax(f) {
  var mw = f && f.maxWords;
  return mw ? Math.min(TEXTAREA_MAX_WORDS_CAP, Math.max(TEXTAREA_MAX, mw * 12)) : TEXTAREA_MAX;
}
/* a field required only when an earlier single-choice answer is a certain option (Field.requiredWhen): whether
   that is so for these answers (src: { fieldId: raw answer }) */
function conditionMet(f, src) {
  var rw = f && f.requiredWhen;
  if (!rw || !src || !has(src, rw.field)) return false;
  return line(src[rw.field], 1000) === rw.equals;
}
function isRealDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days && s >= '1900-01-01' && s <= '2100-12-31';
}
function isTicked(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes'; }

/* One field's value -> { value, empty } or { error }. The rules of spec section 1.2, and:
     phone     { country: 'IN', number: '98765 43210' } (or text) -> { value: '+919876543210', country: 'IN' }
               (lib/phone.js: checked for that country; text from an older page as before)
     location  the text -> { value, place }: place is the place's parts when it is one of lib/places.js's
               (value is then its own spelling, "Noida, Uttar Pradesh, India"), null when typed by hand */
function cleanAnswer(f, raw) {
  var s, n;
  switch (f.type) {
    case 'textarea':
      s = multiline(raw, textareaMax(f));
      if (s && f.maxWords) {
        n = wordCount(s);
        if (n > f.maxWords) return { error: wordsMessage(f, n) };
      }
      return { value: s, empty: !s };
    case 'email':
      s = line(raw, 200).toLowerCase();
      if (!s) return { value: '', empty: true };
      return isEmail(s) ? { value: s } : { error: EMAIL_MESSAGE };
    case 'phone':
      var p = phone.cleanPhone(raw);
      if (p.error) return { error: p.error };
      if (p.empty) return { value: '', empty: true };
      return { value: p.value, country: p.country };
    case 'location':
      s = line(raw, LOCATION_MAX);
      if (!s) return { value: '', empty: true };
      var place = places.lookup(s);
      return place ? { value: place.label, place: place } : { value: s, place: null };
    case 'number':
      if (typeof raw === 'number') {
        if (!isFinite(raw) || Math.abs(raw) > 1e12) return { error: 'Please enter a number for ' + f.label + '.' };
        return { value: raw };
      }
      if (raw == null || raw === '') return { value: '', empty: true };
      if (typeof raw !== 'string') return { error: 'Please enter a number for ' + f.label + '.' };
      s = raw.trim();
      if (!s) return { value: '', empty: true };
      n = Number(s);
      return isFinite(n) && Math.abs(n) <= 1e12 ? { value: n } : { error: 'Please enter a number for ' + f.label + '.' };
    case 'url':
      s = line(raw, 500);
      if (!s) return { value: '', empty: true };
      if (!SCHEME_RE.test(s)) s = ('https://' + s).slice(0, 500);
      return URL_RE.test(s) ? { value: s } : { error: 'Please enter a web address for ' + f.label + ', like https://example.com.' };
    case 'date':
      s = line(raw, 40);
      if (!s) return { value: '', empty: true };
      return isRealDate(s) ? { value: s } : { error: 'Please enter a valid date for ' + f.label + '.' };
    case 'select':
    case 'radio':
      s = line(raw, 1000);
      if (!s) return { value: '', empty: true };
      return (f.options || []).indexOf(s) !== -1 ? { value: s } : { error: optionMessage(f) };
    case 'country':
      s = line(raw, 1000);
      if (!s) return { value: '', empty: true };
      return COUNTRIES.indexOf(s) !== -1 ? { value: s } : { error: optionMessage(f) };
    case 'multiselect':
      var list = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.trim() ? [raw] : []);
      if (raw != null && raw !== '' && !Array.isArray(raw) && typeof raw !== 'string') return { error: optionMessage(f) };
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var o = line(list[i], 1000);
        if (!o) continue;
        if ((f.options || []).indexOf(o) === -1) return { error: optionMessage(f) };
        if (out.indexOf(o) === -1) out.push(o);
      }
      return { value: out, empty: !out.length };
    case 'checkbox':
      var t = isTicked(raw);
      return { value: t, empty: !t };
    case 'consent':
      /* only a real yes: the page sends true once the box is ticked */
      return { value: raw === true, empty: raw !== true };
    default:   // text
      s = line(raw, MAPPED_MAX[f.id] || 200);
      return { value: s, empty: !s };
  }
}

/* What a visitor sent for `form` -> { reg, answers, answerLabels, errors, tooLong }.
   body.answers ({ fieldId: value }) is what the forms runtime sends; a request without it (a page from
   before forms) is read from the top-level name / email / phone / company / designation / city.
   reg: the registration's own columns (mapped fields; '' when the form does not ask) plus source and utm —
     name           the "name" answer, else "First Last" (so every reader of a registration finds a name)
     firstName, lastName
     phone          E.164 (+919876543210); phoneCountry its country ('IN'), '' for a number from an older page
     location       "Noida, Uttar Pradesh, India" as chosen, or as typed; locationParts { city, state, country,
                    countryCode, verified } — verified: it is one of the places the field suggests
   answers / answerLabels: every other field that was answered, with its label at the time; errors:
   { fieldId: message } in the form's field order. Keys the form does not have are dropped.
   consent: whether the visitor ticked the form's consent box — body.consent === true (also read from
   answers.consent); without it errors.consent is CONSENT_MESSAGE. Every form a reader gets (storedForm,
   legacyDefaultForm) ends with the box, and POST /api/register checks with withConsent besides. The
   registration's consent record is the route's to make (consentRecord: it knows the time and the wording). */
function validateAnswers(form, body) {
  body = isObj(body) ? body : {};
  var src = isObj(body.answers) ? body.answers : {};
  if (!isObj(body.answers)) MAPPED_FIELDS.forEach(function (k) { if (has(body, k)) src[k] = body[k]; });
  var utm = isObj(body.utm) ? body.utm : {};
  var reg = { name: '', firstName: '', lastName: '', email: '', phone: '', phoneCountry: '', company: '', designation: '', city: '',
    location: '', source: line(body.source, 60).toLowerCase() || 'website',
    utm: { source: line(utm.source, 80), medium: line(utm.medium, 80), campaign: line(utm.campaign, 120) } };
  var answers = {}, answerLabels = {}, errors = {}, consent = false;
  (form.fields || []).forEach(function (f) {
    if (isConsentField(f)) {
      consent = body.consent === true || src[CONSENT_ID] === true;
      if (!consent) errors[CONSENT_ID] = CONSENT_MESSAGE;
      return;
    }
    var c = cleanAnswer(f, has(src, f.id) ? src[f.id] : undefined);
    if (c.error) { errors[f.id] = c.error; return; }
    if (c.empty && (f.required || conditionMet(f, src))) { errors[f.id] = requiredMessage(f); return; }
    if (MAPPED_TYPES[f.id]) {
      reg[MAPPED_KEY[f.id] || f.id] = c.empty ? '' : c.value;
      if (f.id === 'phone' && !c.empty) reg.phoneCountry = c.country || '';
      if (f.id === 'location' && !c.empty) {
        var pl = c.place;
        reg.locationParts = { city: pl ? pl.city : '', state: pl ? pl.state : '', country: pl ? pl.country : '',
          countryCode: pl ? pl.countryCode : '', verified: !!pl };
      }
      return;
    }
    /* a tick box that was left unticked is an answer ("No"); any other empty answer is left out */
    if (c.empty && f.type !== 'checkbox') return;
    answers[f.id] = c.value;
    answerLabels[f.id] = f.label;
  });
  /* a form with first and last names (every form since the standard questions) still gives the registration
     its one name */
  if (!reg.name) reg.name = (reg.firstName + ' ' + reg.lastName).trim().slice(0, MAPPED_MAX.name);
  var big = Buffer.byteLength(JSON.stringify(answers), 'utf8') > MAX_ANSWERS_BYTES;
  return { reg: reg, answers: answers, answerLabels: answerLabels, errors: errors, tooLong: big, consent: consent };
}

/* The first problem in field order -> { message, fields } (the 400's error and its per-field map), or null. */
function firstFieldError(form, errors) {
  var keys = Object.keys(errors || {});
  if (!keys.length) return null;
  var fields = (form && form.fields) || [];
  for (var i = 0; i < fields.length; i++) if (errors[fields[i].id]) return { message: errors[fields[i].id], fields: errors };
  return { message: errors[keys[0]], fields: errors };
}

/* One response per email, by the document's own id: the form "register" keeps the id the original single
   form used (so a registration made before forms still counts as that address's one); every other form
   its own. */
function regDocId(formId, email) {
  if (formId === DEFAULT_FORM_ID) return 'em-' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 40);
  return 'fm-' + crypto.createHash('sha256').update(formId + '\n' + email).digest('hex').slice(0, 40);
}

/* The status a new response gets. Only a counted form can put someone on the waitlist. */
function planStatus(o) {
  if (o.needsApproval) return 'pending';
  if (o.counts && o.capacity != null && o.confirmed >= o.capacity) return 'waitlist';
  return 'confirmed';
}

/* How Reporting and the export name a status. */
function statusLabel(doc) {
  var s = doc.status;
  if (s === 'pending') return 'Awaiting approval';
  if (s === 'rejected') return 'Declined';
  if (s === 'waitlist') return 'Waitlist';
  if (s === 'cancelled') return 'Cancelled';
  if (doc.counts === false) return doc.decidedAt ? 'Approved' : 'Received';
  return 'Confirmed';
}

/* ---------- pages ---------- */

/* How many buttons and embedded copies on a page open or show the form `formId` — an award site's lifecycle
   button (templates/_shared/rv-award-cta.js: data-nominate-form / data-interest-form) included. */
function formUsage(html, formId) {
  if (typeof html !== 'string' || !FORM_ID_RE.test(String(formId || ''))) return 0;
  var re = new RegExp('\\sdata-(?:rv-form(?:-embed)?|nominate-form|interest-form)\\s*=\\s*(?:"' + formId + '"|\'' + formId + '\'|' + formId + '(?=[\\s>/]))', 'gi');
  var m = html.match(re);
  return m ? m.length : 0;
}

/* One CSV cell: always quoted, quotes doubled, and a value a spreadsheet would run as a formula made text. */
function csvEscape(v) {
  var s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/* ---------- the AI chat's forms ---------- */

var AI_LIMITS = { newForms: 4, ctaLinks: 8, formEmbeds: 3 };
function fold(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
function aiOptions(v) {
  var out = [];
  (Array.isArray(v) ? v : []).forEach(function (o) {
    var s = line(o, TEXT.option);
    if (s && out.indexOf(s) === -1 && out.length < LIMITS.maxOptions) out.push(s);
  });
  return out;
}
/* which of the standard questions a question the model wrote is, if any: one of DEFAULT_FIELD_IDS, 'name'
   for a full name (the first and last names already ask it), or '' */
function aiMappedId(label, type, used) {
  if (type === 'email') return used.email ? '' : 'email';
  if (type === 'phone') return used.phone ? '' : 'phone';
  if (type === 'location') return used.location ? '' : 'location';
  if (type !== 'text') return '';
  var l = label.toLowerCase();
  var notPerson = /compan|organi[sz]ation|business|brand|event|firm|employer|school|college|university|session|talk|project|team/.test(l);
  if (!used.first_name && /\b(first|given|fore)\s*name\b/.test(l)) return 'first_name';
  if (!used.last_name && (/\b(last|family)\s*name\b/.test(l) || /\bsurname\b/.test(l))) return 'last_name';
  if (/\bname\b/.test(l) && !notPerson) return 'name';
  if (!used.company && /\b(company|organi[sz]ation|employer)\b/.test(l)) return 'company';
  if (!used.designation && /\b(designation|job|title|role|position)\b/.test(l) && !/talk|session|topic|paper|abstract|presentation|book|article/.test(l)) return 'designation';
  if (!used.location && /\b(city|location|town|where are you based|based in)\b/.test(l)) return 'location';
  if (!used.phone && /\b(phone|mobile|cell|contact number)\b/.test(l) && !/assistant|office|landline|alternate|secretary/.test(l)) return 'phone';
  return '';
}

/* One form the model proposed -> { form: FormInput with a proposed id, template, skipped: [sentence] } or
   { error }. It starts from its template; the model's fields replace the template's when it gave at least
   two. Either way the form starts with the seven standard questions, in their order and required (the
   model's wording of one is kept), and the model's other questions follow. */
function cleanAiForm(raw, opts) {
  opts = opts || {};
  raw = isObj(raw) ? raw : {};
  var skipped = [];
  var tplId = TEMPLATE_BY_ID[raw.template] ? raw.template : (TEMPLATE_BY_ID[opts.template] ? opts.template : 'blank');
  var base = clone(TEMPLATE_BY_ID[tplId].form);
  var name = line(raw.name, TEXT.name) || base.name;
  var form = {
    name: name, title: line(raw.title, TEXT.title) || name, intro: multiline(raw.intro, TEXT.intro), purpose: base.purpose,
    fields: base.fields, submitLabel: line(raw.submitLabel, TEXT.submitLabel) || base.submitLabel,
    successMessage: multiline(raw.successMessage, TEXT.successMessage) || base.successMessage,
    countsAsRegistration: typeof raw.countsAsRegistration === 'boolean' ? raw.countsAsRegistration : base.countsAsRegistration,
    needsApproval: typeof raw.needsApproval === 'boolean' ? raw.needsApproval : base.needsApproval,
    open: true, duplicates: 'reject', template: tplId
  };
  var given = (Array.isArray(raw.fields) ? raw.fields : []).filter(function (f) { return isObj(f) && line(f.label, TEXT.label); });
  if (given.length >= 2) {
    var used = {}, ids = [], extra = [], std = {};
    base.fields.forEach(function (f) { if (DEFAULT_FIELD_IDS.indexOf(f.id) !== -1) std[f.id] = f; });
    given.slice(0, LIMITS.maxFields).forEach(function (rf) {
      var label = line(rf.label, TEXT.label), type = FIELD_TYPES.indexOf(rf.type) !== -1 ? rf.type : 'text';
      var f = { id: '', type: type, label: label, required: rf.required === true, placeholder: line(rf.placeholder, TEXT.placeholder), help: line(rf.help, TEXT.help) };
      if (OPTION_TYPES.indexOf(type) !== -1) {
        f.options = aiOptions(rf.options);
        if (!f.options.length) { skipped.push('The question “' + label + '” in “' + name + '” was left out: it had no options to choose from.'); return; }
      }
      var mapped = aiMappedId(label, type, used);
      if (mapped === 'name') return;        // a full name: the first and last names ask it
      if (mapped) {
        used[mapped] = true;
        /* a standard question in the model's words; its type and its place are the standard one's */
        std[mapped] = Object.assign({}, std[mapped] || defaultFields().filter(function (d) { return d.id === mapped; })[0], {
          label: label, placeholder: f.placeholder || (std[mapped] && std[mapped].placeholder) || '', help: f.help
        });
        return;
      }
      f.id = uniqueId(slugify(label, '_'), ids.concat(MAPPED_FIELDS), '_');
      ids.push(f.id);
      extra.push(f);
    });
    form.fields = defaultFields().map(function (d) { return std[d.id] || d; }).concat(extra);
  }
  /* the seven standard questions are always asked, and asked of everyone, in a form the AI makes */
  form.fields.forEach(function (f) { if (DEFAULT_FIELD_IDS.indexOf(f.id) !== -1) f.required = true; });
  var c = cleanFormInput(form, { creating: true });
  if (c.error) return { error: c.error, skipped: skipped };
  var value = c.value;
  /* "register" is the event's original form's id, never one the AI proposes */
  value.id = uniqueId(slugify(value.name, '-'), (opts.existingIds || []).concat([DEFAULT_FORM_ID]), '-');
  return { form: value, template: tplId, skipped: skipped };
}

/* The chat answer's three form arrays, checked against the page and the forms the request named.
   -> { newForms: [{ ref, form, template }], ctaLinks: [{ sectionId, buttonText, newButtonLabel, form }],
        formEmbeds: [{ form, sectionId, afterSectionId, heading, intro }], skipped: [sentence] }
   `form` in a link or an embed is an existing form's id or a newForms ref. */
function cleanAiFormOps(parsed, payload) {
  parsed = isObj(parsed) ? parsed : {};
  payload = isObj(payload) ? payload : {};
  var skipped = [];
  var sections = (Array.isArray(payload.sections) ? payload.sections : []).filter(function (s) { return isObj(s) && s.id; });
  var sectionIds = sections.map(function (s) { return String(s.id); });
  var buttonsOf = {};
  sections.forEach(function (s) { buttonsOf[String(s.id)] = (Array.isArray(s.buttons) ? s.buttons : []).map(function (b) { return line(b, 200); }).filter(Boolean); });
  var existing = (Array.isArray(payload.forms) ? payload.forms : []).filter(function (f) { return isObj(f) && FORM_ID_RE.test(String(f.id || '')); })
    .map(function (f) { return { id: f.id, name: line(f.name, TEXT.name) || f.id, title: '' }; });
  var existingIds = existing.map(function (f) { return f.id; });
  var taken = existingIds.slice(), refs = Object.create(null), made = [];

  (Array.isArray(parsed.newForms) ? parsed.newForms : []).forEach(function (n, i) {
    if (!isObj(n)) return;
    var name = line(n.name, TEXT.name);
    if (made.length >= AI_LIMITS.newForms) { skipped.push('Only ' + AI_LIMITS.newForms + ' new forms can be made at once: “' + (name || 'a form') + '” was left out.'); return; }
    var ref = /^[a-z0-9][a-z0-9-]{0,30}$/.test(String(n.ref || '')) ? String(n.ref) : 'new-' + (i + 1);
    while (refs[ref] || existingIds.indexOf(ref) !== -1) ref = ref + '-x';
    /* a form with this name exists already: it is the one meant */
    var same = existing.filter(function (f) { return fold(f.name) === fold(name); })[0];
    if (same) {
      refs[ref] = same.id;
      if (n.ref) refs[String(n.ref)] = same.id;
      skipped.push('The form “' + same.name + '” already exists, so it is used instead of a new one.');
      return;
    }
    var r = cleanAiForm(n, { existingIds: taken });
    skipped.push.apply(skipped, r.skipped || []);
    if (r.error) { skipped.push('The form “' + (name || 'new form') + '” could not be made: ' + r.error.error); return; }
    taken.push(r.form.id);
    refs[ref] = ref;
    if (n.ref && String(n.ref) !== ref) refs[String(n.ref)] = ref;
    made.push({ ref: ref, form: r.form, template: r.template });
  });

  function resolve(x) {
    var s = line(x, 100);
    if (!s) return '';
    if (existingIds.indexOf(s) !== -1) return s;
    if (refs[s]) return refs[s];
    var byName = existing.filter(function (f) { return fold(f.name) === fold(s); })[0];
    if (byName) return byName.id;
    var newByName = made.filter(function (m) { return fold(m.form.name) === fold(s) || m.form.id === s; })[0];
    return newByName ? newByName.ref : '';
  }
  function formName(id) {
    var e = existing.filter(function (f) { return f.id === id; })[0];
    if (e) return e.name;
    var m = made.filter(function (x) { return x.ref === id; })[0];
    return m ? (m.form.title || m.form.name) : id;
  }

  var ctaLinks = [], seenLinks = {};
  (Array.isArray(parsed.ctaLinks) ? parsed.ctaLinks : []).forEach(function (l) {
    if (!isObj(l)) return;
    var sectionId = String(l.sectionId || ''), form = resolve(l.form);
    var text = line(l.buttonText, 200), label = line(l.newButtonLabel, 200);
    var what = text ? '“' + text + '”' : label ? '“' + label + '”' : 'a button';
    if (sectionIds.indexOf(sectionId) === -1) { skipped.push('The button ' + what + ' was left out: its section is not on the page.'); return; }
    if (!form) { skipped.push('The button ' + what + ' was left out: the form it should open does not exist.'); return; }
    var out = { sectionId: sectionId, buttonText: '', newButtonLabel: '', form: form };
    if (text) {
      var hit = buttonsOf[sectionId].filter(function (b) { return fold(b) === fold(text); })[0];
      if (hit) out.buttonText = hit;
      else if (!label) { skipped.push('The button “' + text + '” was not found in that section, so it was not linked to a form.'); return; }
    }
    if (!out.buttonText) {
      if (!label) { skipped.push('A button with no label was left out.'); return; }
      out.newButtonLabel = label.length > 40 ? label.slice(0, 40).replace(/\s+\S*$/, '').trim() || label.slice(0, 40) : label;
    }
    var key = sectionId + '\n' + fold(out.buttonText || out.newButtonLabel);
    if (seenLinks[key]) return;
    if (ctaLinks.length >= AI_LIMITS.ctaLinks) { skipped.push('Only ' + AI_LIMITS.ctaLinks + ' buttons can be linked at once: ' + what + ' was left out.'); return; }
    seenLinks[key] = true;
    ctaLinks.push(out);
  });

  var formEmbeds = [];
  (Array.isArray(parsed.formEmbeds) ? parsed.formEmbeds : []).forEach(function (e) {
    if (!isObj(e)) return;
    var form = resolve(e.form);
    if (!form) { skipped.push('A form to place on the page was left out: that form does not exist.'); return; }
    var sectionId = String(e.sectionId || ''), after = String(e.afterSectionId || '');
    if (sectionId && sectionIds.indexOf(sectionId) === -1) { skipped.push('The form “' + formName(form) + '” was not placed: its section is not on the page.'); return; }
    if (formEmbeds.length >= AI_LIMITS.formEmbeds) { skipped.push('Only ' + AI_LIMITS.formEmbeds + ' forms can be placed at once: “' + formName(form) + '” was left out.'); return; }
    var out = { form: form, sectionId: sectionId, afterSectionId: sectionId ? '' : (sectionIds.indexOf(after) !== -1 ? after : ''), heading: '', intro: '' };
    if (!sectionId) {
      out.heading = line(e.heading, 80) || formName(form).slice(0, 80);
      out.intro = line(e.intro, 300) || 'Fill in your details below.';
    }
    formEmbeds.push(out);
  });

  return { newForms: made, ctaLinks: ctaLinks, formEmbeds: formEmbeds, skipped: skipped };
}

module.exports = {
  FIELD_TYPES, FIELD_TYPE_LABELS, OPTION_TYPES, PURPOSES, MAPPED_FIELDS, MAPPED_TYPES, MAPPED_KEY, LOCKED_FIELDS, COUNTRIES,
  FORM_TEMPLATES, TEMPLATE_BY_ID, FIELD_PRESETS, LIMITS, FORM_ID_RE, FIELD_ID_RE, DEFAULT_FORM_ID, FORMS_RUNTIME_V, EMAIL_RE,
  EMAIL_MESSAGE, DEFAULT_SUCCESS, WAITLIST_MESSAGE, PREVIEW_NOTE, AI_LIMITS, DEFAULT_FIELD_IDS, OLD_DEFAULT_FIELD_IDS, DEFAULT_EMAIL_LABEL,
  CONSENT_ID, CONSENT_TYPE, CONSENT_TEXT, CONSENT_MESSAGE, CONSENT_FALLBACK_PORTAL,
  consentFor, consentField, isConsentField, withConsent, consentRecord, portalOfSources, publicConsent, hasCurrentDefaults, oldDefaultFields,
  defaultFields, legacyFields, isUntouchedDefault, migrationPlan, requiredMessage,
  slugify, uniqueId, isReservedId, cleanFormInput, legacyRegistration, legacyDefaultForm, storedForm, byOrder, resolveDefaultFormId,
  publicForm, publicFormsPayload, isFull, validateAnswers, cleanAnswer, firstFieldError, regDocId, planStatus, statusLabel,
  formUsage, csvEscape, cleanAiForm, cleanAiFormOps, line, multiline, isoOf,
  WORDS, wordCount, textareaMax, conditionMet, STORED_TEMPLATE_IDS, NOMINATION_TEMPLATE, NOMINEE_TYPES, CATEGORY_SEP,
  AWARD_NOMINATION_NAME, AWARD_INTEREST_NAME, ENTRY_SUMMARY_WORDS,
  awardCategoryOptions, awardNominationForm, awardInterestForm, findAwardForms, withCategoryOptions
};
