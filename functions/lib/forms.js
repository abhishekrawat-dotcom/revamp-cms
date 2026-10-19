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
//   Field { id, type, label, required, placeholder, help, options? }   options: select / radio / multiselect only
//
//   A form id is /^[a-z][a-z0-9-]{0,39}$/ and never changes. "register" is the form an event's original
//   single registration form becomes (legacyDefaultForm). A field id is /^[a-z][a-z0-9_]{0,39}$/ and never
//   changes either; six of them (MAPPED_FIELDS) are the registration's own columns rather than an answer.
//   Every form asks for a name and an email address: those two fields can be relabelled and moved, never
//   removed, made optional or given another type.
//
// The validation messages below are part of the contract: the page runtime (templates/_shared/rv-forms.js)
// says exactly the same sentences, so an answer the server refuses reads the same as one the browser did.
'use strict';
var crypto = require('crypto');

/* ---------- the vocabulary ---------- */

var FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'select', 'radio', 'multiselect', 'checkbox', 'country'];
var FIELD_TYPE_LABELS = {
  text: 'Short text', textarea: 'Long text', email: 'Email', phone: 'Phone', number: 'Number', url: 'Web address',
  date: 'Date', select: 'Dropdown', radio: 'Single choice', multiselect: 'Multiple choice', checkbox: 'Tick box (yes/no)',
  country: 'Country'
};
var OPTION_TYPES = ['select', 'radio', 'multiselect'];
var PURPOSES = ['register', 'interest', 'partner', 'vip', 'speaker', 'custom'];
/* a registration's own columns: their values are stored as reg.<id>, every other answer under answers.<id> */
var MAPPED_FIELDS = ['name', 'email', 'phone', 'company', 'designation', 'city'];
var MAPPED_TYPES = { name: 'text', email: 'email', phone: 'phone', company: 'text', designation: 'text', city: 'text' };
var MAPPED_MAX = { name: 120, company: 120, designation: 120, city: 80 };
var LOCKED_FIELDS = ['name', 'email'];

var FORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
var FIELD_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
var DEFAULT_FORM_ID = 'register';

var LIMITS = { maxForms: 20, maxFields: 40, maxOptions: 100 };
var MIN_FIELDS = 2;
var MAX_ANSWERS_BYTES = 16 * 1024;
var TEXT = { name: 80, title: 120, intro: 600, submitLabel: 40, successMessage: 600, label: 200, placeholder: 120, help: 300, option: 120 };

/* bumped whenever templates/_shared/rv-forms.js changes, so a browser holding the old copy (static files are
   cached for five minutes, under an unhashed name) asks for the new one */
var FORMS_RUNTIME_V = 1;

/* lib/http.js EMAIL_RE, copied verbatim (this module stays free of anything that touches Firebase);
   forms.test.js checks the two are the same */
var EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;.]{2,}$/;
var URL_RE = /^https?:\/\/[^\s<>"]+\.[^\s<>"]+/i;
var SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

var DEFAULT_SUCCESS = 'You are registered. We look forward to seeing you there.';
var WAITLIST_MESSAGE = 'This event is full, so you have been added to the waitlist. We will be in touch if a place opens up.';
var PREVIEW_NOTE = ' (Preview — this test registration was not saved.)';

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
function isPhone(v) { return /^\+?[\d\s().-]{7,24}$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15; }
function isEmail(v) { return typeof v === 'string' && v.length <= 200 && EMAIL_RE.test(v); }
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
/* base, else base-2, base-3 … (base_2 … for a field), never longer than 40 characters */
function uniqueId(base, taken, sep) {
  sep = sep === '_' ? '_' : '-';
  var t = Array.isArray(taken) ? taken : Object.keys(taken || {});
  if (t.indexOf(base) === -1) return base;
  for (var n = 2; n < 1000; n++) {
    var suffix = sep + n, cand = trimId(base.slice(0, 40 - suffix.length), sep) + suffix;
    if (t.indexOf(cand) === -1) return cand;
  }
  return trimId(base.slice(0, 30), sep) + sep + crypto.randomBytes(4).toString('hex');
}

/* ---------- templates and presets (the single source both builders are sent) ---------- */

function F(id, type, label, required, extra) {
  return Object.assign({ id: id, type: type, label: label, required: !!required, placeholder: '', help: '' }, extra || {});
}
function templateForm(t) {
  return {
    name: t.name, title: t.name, intro: '', purpose: t.purpose,
    fields: [F('name', 'text', 'Full name', true), F('email', 'email', t.emailLabel || 'Email', true)].concat(t.fields),
    submitLabel: t.submitLabel, successMessage: t.successMessage,
    countsAsRegistration: t.counts, needsApproval: t.approval, open: true, duplicates: 'reject', template: t.id
  };
}
var TEMPLATE_SOURCE = [
  { id: 'register', name: 'Register now', purpose: 'register', counts: true, approval: false,
    description: 'Counts as a registration',
    fields: [F('phone', 'phone', 'Mobile number', true), F('company', 'text', 'Company', true), F('designation', 'text', 'Designation', true), F('city', 'text', 'City', false)],
    submitLabel: 'Register', successMessage: DEFAULT_SUCCESS },
  { id: 'interest', name: 'Express interest', purpose: 'interest', counts: false, approval: false,
    description: 'An enquiry: does not count as a registration',
    fields: [F('phone', 'phone', 'Mobile number', false), F('company', 'text', 'Company', true), F('designation', 'text', 'Designation', true),
      F('message', 'textarea', 'Anything you would like us to know?', false)],
    submitLabel: 'Express interest', successMessage: 'Thank you for your interest. The organisers will be in touch.' },
  { id: 'partner', name: 'Join as partner', purpose: 'partner', counts: false, approval: false,
    description: 'A partnership enquiry: does not count as a registration',
    fields: [F('phone', 'phone', 'Mobile number', true), F('company', 'text', 'Company', true), F('designation', 'text', 'Designation', true),
      F('partnership', 'select', 'Partnership interest', true, { options: ['Presenting partner', 'Associate partner', 'Exhibitor', 'Knowledge partner', 'Other'] }),
      F('message', 'textarea', 'Tell us about your goals', false)],
    submitLabel: 'Send enquiry', successMessage: 'Thank you. The partnerships team will get back to you.' },
  { id: 'vip', name: 'VIP delegates', purpose: 'vip', counts: true, approval: true, emailLabel: 'Work email',
    description: 'Needs approval, counts as a registration',
    fields: [F('phone', 'phone', 'Mobile number', true), F('company', 'text', 'Company', true), F('designation', 'text', 'Designation', true),
      F('linkedin', 'url', 'LinkedIn profile', false, { placeholder: 'https://www.linkedin.com/in/…' }),
      F('why_attend', 'textarea', 'Why would you like to attend?', false)],
    submitLabel: 'Request an invitation', successMessage: 'Thank you. The organisers will review your request.' },
  { id: 'speaker', name: 'Speaker application', purpose: 'speaker', counts: false, approval: true,
    description: 'Needs approval, does not count as a registration',
    fields: [F('phone', 'phone', 'Mobile number', true), F('company', 'text', 'Company', true), F('designation', 'text', 'Designation', true),
      F('linkedin', 'url', 'LinkedIn profile', true, { placeholder: 'https://www.linkedin.com/in/…' }),
      F('topic', 'text', 'Proposed topic', true), F('abstract', 'textarea', 'Short abstract', true)],
    submitLabel: 'Apply to speak', successMessage: 'Thank you for applying. The programme team will review your application.' },
  { id: 'blank', name: 'Custom form', purpose: 'custom', counts: false, approval: false,
    description: 'Start from a name and an email address and add your own questions',
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

/* The builder's "Add field" quick picks: { presetId, label, field }. A preset's id is a suggestion: when the
   form already has a field with that id, the builder sends the new one without an id and is given one. */
var FIELD_PRESETS = [
  { presetId: 'phone', label: 'Phone', field: F('phone', 'phone', 'Mobile number', false) },
  { presetId: 'company', label: 'Company', field: F('company', 'text', 'Company', false) },
  { presetId: 'designation', label: 'Designation', field: F('designation', 'text', 'Designation', false) },
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
var FIELD_KEYS = ['id', 'type', 'label', 'required', 'placeholder', 'help', 'options'];

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

/* Options of a select / radio / multiselect field: 1–100 different, non-empty lines of at most 120 characters. */
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
  if (TEMPLATE_IDS.indexOf(tpl) === -1) return fail('"template" must be one of: ' + TEMPLATE_IDS.join(', ') + '.', 'template');
  out.template = tpl;
  return { value: out };
}

function cleanFields(list) {
  if (!Array.isArray(list)) return fail('"fields" must be a list of fields.', 'fields');
  if (list.length > LIMITS.maxFields) return fail('A form can have at most ' + LIMITS.maxFields + ' fields.', 'fields');
  var fields = [], given = [], i;
  for (i = 0; i < list.length; i++) {
    var f = list[i], where = 'fields.' + i, n = 'Field ' + (i + 1);
    if (!isObj(f)) return fail(n + ' is not a valid field.', where);
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
    if (f.id != null && f.id !== '') {
      if (typeof f.id !== 'string' || !FIELD_ID_RE.test(f.id)) {
        return fail('The id of “' + label + '” must be lower-case letters, digits and underscores, starting with a letter (at most 40).', where + '.id');
      }
      if (given.indexOf(f.id) !== -1) return fail('Two fields have the same id ("' + f.id + '").', where + '.id');
      given.push(f.id);
      out.id = f.id;
    }
    fields.push(out);
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
      if (fd.id === 'name' || fd.id === 'email') return fail('The ' + fd.id + ' field is always a ' + FIELD_TYPE_LABELS[want] + ' field.', 'fields.' + i + '.type');
      return fail('“' + fd.label + '” holds the registration’s ' + fd.id + ', so it must be a ' + FIELD_TYPE_LABELS[want] + ' field.', 'fields.' + i + '.type');
    }
  }
  for (i = 0; i < LOCKED_FIELDS.length; i++) {
    var id = LOCKED_FIELDS[i], at = -1;
    fields.forEach(function (fd, x) { if (fd.id === id) at = x; });
    if (at === -1) return fail('Every form asks for a name and an email address: the "' + id + '" field is missing.', 'fields');
    if (!fields[at].required) return fail('The ' + id + ' field is always required.', 'fields.' + at + '.required');
  }
  if (fields.length < MIN_FIELDS) return fail('A form needs at least ' + MIN_FIELDS + ' fields.', 'fields');
  return { value: fields };
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

/* The form "register", made from the event's original settings: what an event has until a form is saved. */
function legacyDefaultForm(ev) {
  var legacy = legacyRegistration(ev || {});
  var at = isoOf(ev && ev.createdAt) || '', by = (ev && typeof ev.createdBy === 'string' && ev.createdBy) || 'system';
  return {
    id: DEFAULT_FORM_ID, name: 'Register now', title: 'Register now', intro: '', purpose: 'register',
    fields: legacy.fields.map(function (f) {
      return F(f.key, f.type === 'tel' ? 'phone' : f.type, f.label, f.key === 'name' || f.key === 'email' || f.required);
    }),
    submitLabel: 'Register', successMessage: legacy.successMessage,
    countsAsRegistration: true, needsApproval: false, open: true, duplicates: legacy.duplicates,
    order: 0, template: 'register', rev: 0, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by
  };
}

/* A stored form document as every reader sees it: defaults filled in, never a missing list. */
function storedForm(id, d) {
  d = isObj(d) ? d : {};
  var fields = (Array.isArray(d.fields) ? d.fields : []).filter(isObj).map(function (f) {
    var out = { id: String(f.id || ''), type: FIELD_TYPES.indexOf(f.type) !== -1 ? f.type : 'text', label: String(f.label || ''),
      required: f.required === true, placeholder: String(f.placeholder || ''), help: String(f.help || '') };
    if (OPTION_TYPES.indexOf(out.type) !== -1) out.options = (Array.isArray(f.options) ? f.options : []).filter(function (o) { return typeof o === 'string'; });
    return out;
  });
  return {
    id: id, name: String(d.name || id), title: String(d.title || ''), intro: String(d.intro || ''),
    purpose: PURPOSES.indexOf(d.purpose) !== -1 ? d.purpose : 'custom', fields: fields,
    submitLabel: String(d.submitLabel || 'Submit'), successMessage: String(d.successMessage || DEFAULT_SUCCESS),
    countsAsRegistration: d.countsAsRegistration === true, needsApproval: d.needsApproval === true, open: d.open !== false,
    duplicates: d.duplicates === 'allow' ? 'allow' : 'reject', order: Number(d.order) || 0,
    template: TEMPLATE_IDS.indexOf(d.template) !== -1 ? d.template : 'blank', rev: Number(d.rev) || 0,
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

/* One form for a visitor's page: an allow-list, so nothing an organiser keeps for themselves (the success
   message comes back with the registration; approval, duplicates, order and who changed it never leave). */
function publicForm(form, ev) {
  var eventOpen = legacyRegistration(ev || {}).open;
  return {
    id: form.id, name: form.name, title: form.title || '', intro: form.intro || '', purpose: form.purpose,
    fields: form.fields.map(function (f) {
      var out = { id: f.id, type: f.type, label: f.label, required: !!f.required, placeholder: f.placeholder || '', help: f.help || '' };
      if (OPTION_TYPES.indexOf(f.type) !== -1) out.options = (f.options || []).slice();
      if (f.type === 'country') out.options = COUNTRIES.slice();
      return out;
    }),
    submitLabel: form.submitLabel, open: form.open !== false && eventOpen, counts: form.countsAsRegistration === true, rev: form.rev || 0
  };
}
function counterNum(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
/* the confirmed places are all taken: a counted form still takes registrations, onto the waitlist */
function isFull(ev) {
  var legacy = legacyRegistration(ev || {}), c = ev && isObj(ev.counters) ? ev.counters : {};
  return legacy.capacity != null && Number(c.audienceV) >= 1 && counterNum(c.confirmed) >= legacy.capacity;
}
/* GET /api/public/forms, and the #rv-forms block publishing writes into a page */
function publicFormsPayload(eventId, ev, forms) {
  return {
    v: 1, eventId: eventId, open: legacyRegistration(ev || {}).open, defaultFormId: resolveDefaultFormId(ev, forms),
    waitlist: isFull(ev), forms: forms.map(function (f) { return publicForm(f, ev); })
  };
}

/* ---------- a visitor's answers ---------- */

function requiredMessage(f) {
  if (f.id === 'name') return 'Please enter your name.';
  if (f.id === 'email') return 'Please enter your email address.';
  if (f.type === 'checkbox') return 'Please tick ' + f.label + ' to continue.';
  if (f.type === 'select' || f.type === 'radio' || f.type === 'country') return 'Please choose ' + f.label + '.';
  if (f.type === 'multiselect') return 'Please choose at least one option for ' + f.label + '.';
  return 'Please fill in ' + f.label + '.';
}
function optionMessage(f) { return 'Please choose one of the options for ' + f.label + '.'; }
function isRealDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  var y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days && s >= '1900-01-01' && s <= '2100-12-31';
}
function isTicked(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes'; }

/* One field's value -> { value, empty } or { error }. The rules of spec section 1.2. */
function cleanAnswer(f, raw) {
  var s, n;
  switch (f.type) {
    case 'textarea':
      s = multiline(raw, 2000);
      return { value: s, empty: !s };
    case 'email':
      s = line(raw, 200).toLowerCase();
      if (!s) return { value: '', empty: true };
      return isEmail(s) ? { value: s } : { error: 'Please enter a valid email address.' };
    case 'phone':
      s = line(raw, 40);
      if (!s) return { value: '', empty: true };
      return isPhone(s) ? { value: s } : { error: 'Please enter a valid phone number.' };
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
    default:   // text
      s = line(raw, MAPPED_MAX[f.id] || 200);
      return { value: s, empty: !s };
  }
}

/* What a visitor sent for `form` -> { reg, answers, answerLabels, errors, tooLong }.
   body.answers ({ fieldId: value }) is what the forms runtime sends; a request without it (a page from
   before forms) is read from the top-level name / email / phone / company / designation / city.
   reg: the registration's own columns (mapped fields; '' when the form does not ask) plus source and utm;
   answers / answerLabels: every other field that was answered, with its label at the time; errors:
   { fieldId: message } in the form's field order. Keys the form does not have are dropped. */
function validateAnswers(form, body) {
  body = isObj(body) ? body : {};
  var src = isObj(body.answers) ? body.answers : {};
  if (!isObj(body.answers)) MAPPED_FIELDS.forEach(function (k) { if (has(body, k)) src[k] = body[k]; });
  var utm = isObj(body.utm) ? body.utm : {};
  var reg = { name: '', email: '', phone: '', company: '', designation: '', city: '',
    source: line(body.source, 60).toLowerCase() || 'website',
    utm: { source: line(utm.source, 80), medium: line(utm.medium, 80), campaign: line(utm.campaign, 120) } };
  var answers = {}, answerLabels = {}, errors = {};
  (form.fields || []).forEach(function (f) {
    var c = cleanAnswer(f, has(src, f.id) ? src[f.id] : undefined);
    if (c.error) { errors[f.id] = c.error; return; }
    if (c.empty && f.required) { errors[f.id] = requiredMessage(f); return; }
    if (MAPPED_TYPES[f.id]) { reg[f.id] = c.empty ? '' : c.value; return; }
    /* a tick box that was left unticked is an answer ("No"); any other empty answer is left out */
    if (c.empty && f.type !== 'checkbox') return;
    answers[f.id] = c.value;
    answerLabels[f.id] = f.label;
  });
  var big = Buffer.byteLength(JSON.stringify(answers), 'utf8') > MAX_ANSWERS_BYTES;
  return { reg: reg, answers: answers, answerLabels: answerLabels, errors: errors, tooLong: big };
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

/* How many buttons and embedded copies on a page open or show the form `formId`. */
function formUsage(html, formId) {
  if (typeof html !== 'string' || !FORM_ID_RE.test(String(formId || ''))) return 0;
  var re = new RegExp('\\sdata-rv-form(?:-embed)?\\s*=\\s*(?:"' + formId + '"|\'' + formId + '\'|' + formId + '(?=[\\s>/]))', 'gi');
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
/* which of the registration's columns a question the model wrote is, if any */
function aiMappedId(label, type, used) {
  if (type === 'email' && !used.email) return 'email';
  if (type === 'phone' && !used.phone) return 'phone';
  if (type !== 'text') return '';
  var l = label.toLowerCase();
  if (!used.name && /\bname\b/.test(l) && !/compan|organi[sz]ation|business|brand|event|firm|employer|school|college|university/.test(l)) return 'name';
  if (!used.company && /\b(company|organi[sz]ation|employer)\b/.test(l)) return 'company';
  if (!used.designation && /\b(designation|job|title|role|position)\b/.test(l) && !/talk|session|topic|paper|abstract|presentation|book|article/.test(l)) return 'designation';
  if (!used.city && /\bcity\b/.test(l)) return 'city';
  return '';
}

/* One form the model proposed -> { form: FormInput with a proposed id, template, skipped: [sentence] } or
   { error }. It starts from its template; the model's fields replace the template's when it gave at least
   two; questions are matched to the registration's columns; name and email are always there. */
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
    var used = {}, ids = [], fields = [];
    given.slice(0, LIMITS.maxFields).forEach(function (rf) {
      var label = line(rf.label, TEXT.label), type = FIELD_TYPES.indexOf(rf.type) !== -1 ? rf.type : 'text';
      var f = { id: '', type: type, label: label, required: rf.required === true, placeholder: line(rf.placeholder, TEXT.placeholder), help: line(rf.help, TEXT.help) };
      if (OPTION_TYPES.indexOf(type) !== -1) {
        f.options = aiOptions(rf.options);
        if (!f.options.length) { skipped.push('The question “' + label + '” in “' + name + '” was left out: it had no options to choose from.'); return; }
      }
      var mapped = aiMappedId(label, type, used);
      if (mapped) { used[mapped] = true; f.id = mapped; }
      else {
        var avoid = ids.concat(MAPPED_FIELDS);
        f.id = uniqueId(slugify(label, '_'), avoid, '_');
      }
      ids.push(f.id);
      fields.push(f);
    });
    if (!used.email) fields.unshift(F('email', 'email', 'Email', true));
    if (!used.name) fields.unshift(F('name', 'text', 'Full name', true));
    fields.forEach(function (f) { if (f.id === 'name' || f.id === 'email') f.required = true; });
    form.fields = fields;
  }
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
  var taken = existingIds.slice(), refs = {}, made = [];

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
  FIELD_TYPES, FIELD_TYPE_LABELS, OPTION_TYPES, PURPOSES, MAPPED_FIELDS, MAPPED_TYPES, LOCKED_FIELDS, COUNTRIES,
  FORM_TEMPLATES, TEMPLATE_BY_ID, FIELD_PRESETS, LIMITS, FORM_ID_RE, FIELD_ID_RE, DEFAULT_FORM_ID, FORMS_RUNTIME_V, EMAIL_RE,
  DEFAULT_SUCCESS, WAITLIST_MESSAGE, PREVIEW_NOTE, AI_LIMITS,
  slugify, uniqueId, cleanFormInput, legacyRegistration, legacyDefaultForm, storedForm, byOrder, resolveDefaultFormId,
  publicForm, publicFormsPayload, isFull, validateAnswers, cleanAnswer, firstFieldError, regDocId, planStatus, statusLabel,
  formUsage, csvEscape, cleanAiForm, cleanAiFormOps, line, multiline, isoOf
};
