/* node functions/lib/forms.test.js — exits 1 on the first failure it lists. No network, no Firebase.
   Registration forms (lib/forms.js): what may be stored as a form, the event's original form, what a
   visitor's page is told, how answers are checked (the shared vectors in fixtures/forms/), one response per
   email, CSV cells, the AI chat's form changes and its schema, and the gates around them (settings, access). */
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./forms');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function fld(id, type, label, required, extra) { return Object.assign({ id: id, type: type, label: label, required: !!required, placeholder: '', help: '' }, extra || {}); }
var NAME = fld('name', 'text', 'Full name', true), EMAIL = fld('email', 'email', 'Email', true);
function form(fields, extra) {
  return Object.assign({ name: 'Test form', title: '', intro: '', purpose: 'custom', fields: [NAME, EMAIL].concat(fields || []),
    submitLabel: 'Send', successMessage: 'Thanks.', countsAsRegistration: false, needsApproval: false, open: true, duplicates: 'reject', template: 'blank' }, extra || {});
}
function refused(input, label, wantField, opts) {
  var r = F.cleanFormInput(input, opts || { creating: true });
  ok(!!r.error, label + ' is refused', JSON.stringify(r).slice(0, 300));
  if (wantField != null) ok(r.field === wantField, label + ': the error names "' + wantField + '"', r.field + ' — ' + r.error);
  return r;
}

/* ---------- vocabulary ---------- */
ok(eq(F.FIELD_TYPES, ['text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'select', 'radio', 'multiselect', 'checkbox', 'country']), 'the twelve field types, in order');
ok(F.FIELD_TYPES.every(function (t) { return typeof F.FIELD_TYPE_LABELS[t] === 'string' && F.FIELD_TYPE_LABELS[t]; }), 'every type has a builder label');
ok(F.EMAIL_RE.source === require('./http').EMAIL_RE.source, 'the email rule is lib/http.js EMAIL_RE, verbatim');
ok(F.COUNTRIES[0] === 'India' && F.COUNTRIES.length >= 245 && F.COUNTRIES.lastIndexOf('India') === 0, 'countries: India first, once, ~249 of them', F.COUNTRIES.length);
ok(F.COUNTRIES.slice(1).every(function (c, i, a) { return i === 0 || a[i - 1].localeCompare(c, 'en') < 0; }), 'countries after India are A–Z without repeats');
ok(F.COUNTRIES.every(function (c) { return c.length <= 120; }), 'every country fits an option');

/* ---------- templates and presets ---------- */
var tplIds = F.FORM_TEMPLATES.map(function (t) { return t.id; });
ok(eq(tplIds, ['register', 'interest', 'partner', 'vip', 'speaker', 'blank']), 'the six templates', tplIds.join());
F.FORM_TEMPLATES.forEach(function (t) {
  var r = F.cleanFormInput(t.form, { creating: true });
  ok(!r.error, 'template "' + t.id + '" is a valid form', r.error);
  ok(t.form.fields[0].id === 'name' && t.form.fields[1].id === 'email', 'template "' + t.id + '" starts with name and email');
  ok(t.form.title === t.form.name && t.form.intro === '' && t.form.open === true && t.form.duplicates === 'reject', 'template "' + t.id + '": title = name, no intro, open, one per email');
  ok(typeof t.description === 'string' && t.description.indexOf(t.name) === 0, 'template "' + t.id + '" has a one-line description', t.description);
});
var T = F.TEMPLATE_BY_ID;
ok(T.register.form.countsAsRegistration && !T.register.form.needsApproval, 'Register now counts, no approval');
ok(!T.interest.form.countsAsRegistration && !T.partner.form.countsAsRegistration, 'Express interest and Join as partner do not count');
ok(T.vip.form.countsAsRegistration && T.vip.form.needsApproval, 'VIP delegates counts and needs approval');
ok(!T.speaker.form.countsAsRegistration && T.speaker.form.needsApproval, 'Speaker application needs approval, does not count');
ok(eq(T.vip.form.fields.map(function (f) { return f.id; }), ['name', 'email', 'phone', 'company', 'designation', 'linkedin', 'why_attend']), 'VIP fields as the spec example');
ok(T.vip.form.fields[1].label === 'Work email' && T.vip.form.submitLabel === 'Request an invitation', 'VIP: work email, its own button');
ok(eq(T.partner.form.fields[5].options, ['Presenting partner', 'Associate partner', 'Exhibitor', 'Knowledge partner', 'Other']) && T.partner.form.fields[5].required, 'Join as partner: the partnership choice');
ok(eq(T.blank.form.fields.map(function (f) { return f.id; }), ['name', 'email']) && T.blank.form.submitLabel === 'Submit', 'Custom form: name and email only');
ok(T.speaker.form.fields.filter(function (f) { return f.id === 'linkedin'; })[0].required === true, 'Speaker application: LinkedIn required');
F.FIELD_PRESETS.forEach(function (p) {
  var f = clone(p.field);
  if (!f.label) f.label = 'Question';
  if (f.id && F.MAPPED_FIELDS.indexOf(f.id) === -1 && f.id !== 'linkedin' && f.id !== 'website' && f.id !== 'message' && f.id !== 'country') ok(false, 'preset id ' + f.id);
  var r = F.cleanFormInput(form([f]), { creating: true });
  ok(!r.error, 'preset "' + p.presetId + '" adds a valid field', r.error);
});
ok(F.FIELD_PRESETS.filter(function (p) { return /^blank-/.test(p.presetId); }).length === F.FIELD_TYPES.length, 'one blank preset of each type');

/* ---------- ids ---------- */
ok(F.slugify('VIP delegates') === 'vip-delegates' && F.slugify('Join as partner') === 'join-as-partner', 'form ids from names');
ok(F.slugify('Why would you like to attend?', '_') === 'why_would_you_like_to_attend', 'field ids from labels');
ok(F.slugify('Café & Bar') === 'cafe-and-bar' && F.slugify('2026 Expo') === 'form-2026-expo' && F.slugify('') === 'form' && F.slugify('?!', '_') === 'field', 'accents, &, a leading digit, nothing');
ok(F.FORM_ID_RE.test(F.slugify(new Array(60).join('long name '))) && F.slugify(new Array(60).join('long name ')).length <= 40, 'at most 40 characters, still a valid id');
ok(F.uniqueId('vip-delegates', ['vip-delegates']) === 'vip-delegates-2' && F.uniqueId('vip-delegates', ['vip-delegates', 'vip-delegates-2']) === 'vip-delegates-3', 'collisions: -2, -3');
ok(F.uniqueId('phone', ['phone'], '_') === 'phone_2', 'a field collision: _2');
var longId = new Array(41).join('a');
ok(F.uniqueId(longId, [longId]).length === 40 && /-2$/.test(F.uniqueId(longId, [longId])), 'a suffixed id stays within 40');

/* ---------- cleanFormInput: accepted ---------- */
var good = F.cleanFormInput(form([fld('', 'select', 'Meal choice', false, { options: [' Veg ', 'Non-veg'] }), fld('', 'text', 'Phone', false)]), { creating: true });
ok(!good.error, 'a valid custom form', good.error);
ok(good.value && good.value.fields[2].id === 'meal_choice' && eq(good.value.fields[2].options, ['Veg', 'Non-veg']), 'an id from the label; options trimmed', good.value && JSON.stringify(good.value.fields[2]));
ok(good.value && good.value.fields[3].id === 'phone_2', 'a text field labelled "Phone" is not the phone column', good.value && good.value.fields[3].id);
var stripped = F.cleanFormInput(form([fld('city', 'text', 'City', false, { options: ['x'] })]), { creating: true });
ok(!stripped.error && !('options' in stripped.value.fields[2]), 'options are dropped from a type without them');
var withServer = F.cleanFormInput(Object.assign(form(), { rev: 3, createdAt: 'x', updatedAt: 'y', order: 2, submissions: 4, pending: 1 }), { creating: false, formId: 'test' });
ok(!withServer.error && !('rev' in withServer.value) && !('order' in withServer.value), 'the server\'s own keys sent back are ignored, never stored');
ok(F.cleanFormInput(Object.assign(form(), { id: 'my-form' }), { creating: true }).value.id === 'my-form', 'an id is a suggestion on create');
ok(!F.cleanFormInput(Object.assign(form(), { id: 'test' }), { creating: false, formId: 'test' }).error, 'the same id on update is fine');
var defaults = F.cleanFormInput({ name: 'Bare', fields: [NAME, EMAIL], submitLabel: 'Go', successMessage: 'Done' }, { creating: true });
ok(!defaults.error && defaults.value.purpose === 'custom' && defaults.value.open === true && defaults.value.duplicates === 'reject' && defaults.value.countsAsRegistration === false && defaults.value.template === 'blank', 'defaults for what a script leaves out', JSON.stringify(defaults));
ok(F.cleanFormInput(form([], { intro: 'Line one\r\nLine two' }), { creating: true }).value.intro === 'Line one\nLine two', 'the intro keeps its lines');

/* ---------- cleanFormInput: refused ---------- */
refused(Object.assign(form(), { colour: 'red' }), 'an unknown form key', 'colour');
refused(form([fld('x', 'text', 'X', false, { colour: 'red' })]), 'an unknown field key', 'fields.2.colour');
refused(Object.assign(form(), { id: 'Bad Id' }), 'a bad form id', 'id');
refused(Object.assign(form(), { id: '1abc' }), 'a form id starting with a digit', 'id');
refused(Object.assign(form(), { id: 'other' }), 'changing the id on update', 'id', { creating: false, formId: 'test' });
refused(form([fld('Bad-Id', 'text', 'X', false)]), 'a bad field id', 'fields.2.id');
refused({ name: 'X', fields: [EMAIL, fld('', 'text', 'Other', false)], submitLabel: 'Go', successMessage: 'Done' }, 'a form without the name field', 'fields');
refused({ name: 'X', fields: [NAME, fld('other', 'text', 'Other', false)], submitLabel: 'Go', successMessage: 'Done' }, 'a form without the email field', 'fields');
refused({ name: 'X', fields: [fld('name', 'text', 'Name', false), EMAIL], submitLabel: 'Go', successMessage: 'Done' }, 'an optional name', 'fields.0.required');
refused({ name: 'X', fields: [NAME, fld('email', 'email', 'Email', false)], submitLabel: 'Go', successMessage: 'Done' }, 'an optional email', 'fields.1.required');
refused({ name: 'X', fields: [fld('name', 'textarea', 'Name', true), EMAIL], submitLabel: 'Go', successMessage: 'Done' }, 'name as another type', 'fields.0.type');
refused({ name: 'X', fields: [NAME, fld('email', 'text', 'Email', true)], submitLabel: 'Go', successMessage: 'Done' }, 'email as another type', 'fields.1.type');
refused(form([fld('phone', 'text', 'Phone', false)]), 'the phone column as text', 'fields.2.type');
refused(form([fld('company', 'select', 'Company', false, { options: ['A'] })]), 'the company column as a dropdown', 'fields.2.type');
refused(form([fld('', 'select', 'Choose', false)]), 'a dropdown without options', 'fields.2.options');
refused(form([fld('', 'radio', 'Choose', false, { options: [] })]), 'single choice with an empty list', 'fields.2.options');
refused(form([fld('', 'multiselect', 'Choose', false, { options: ['a', ''] })]), 'an empty option', 'fields.2.options.1');
refused(form([fld('', 'select', 'Choose', false, { options: ['a', 'a'] })]), 'a repeated option', 'fields.2.options.1');
refused(form([fld('', 'select', 'Choose', false, { options: [new Array(122).join('x')] })]), 'an option over 120 characters', 'fields.2.options.0');
var many = []; for (var i = 0; i < 101; i++) many.push('Option ' + i);
refused(form([fld('', 'select', 'Choose', false, { options: many })]), '101 options', 'fields.2.options');
ok(!F.cleanFormInput(form([fld('', 'select', 'Choose', false, { options: many.slice(0, 100) })]), { creating: true }).error, '100 options are fine');
var forty = []; for (i = 0; i < 38; i++) forty.push(fld('', 'text', 'Question ' + i, false));
ok(!F.cleanFormInput(form(forty), { creating: true }).error, '40 fields are fine');
refused(form(forty.concat([fld('', 'text', 'One more', false)])), '41 fields', 'fields');
refused(form([fld('a', 'text', 'A', false), fld('a', 'text', 'B', false)]), 'two fields with one id', 'fields.3.id');
refused(form([fld('', 'text', '   ', false)]), 'a field without a label', 'fields.2.label');
refused(form([fld('', 'stars', 'Rate us', false)]), 'an unknown field type', 'fields.2.type');
refused(form([fld('', 'text', 'Q', false, { placeholder: new Array(122).join('p') })]), 'a placeholder over 120', 'fields.2.placeholder');
refused(form([fld('', 'text', 'Q', false, { help: new Array(302).join('h') })]), 'help over 300', 'fields.2.help');
refused(form([], { name: '' }), 'a form without a name', 'name');
refused(form([], { name: new Array(82).join('n') }), 'a name over 80', 'name');
refused(form([], { title: new Array(122).join('t') }), 'a title over 120', 'title');
refused(form([], { intro: new Array(602).join('i') }), 'an intro over 600', 'intro');
refused(form([], { submitLabel: '' }), 'no submit label', 'submitLabel');
refused(form([], { submitLabel: new Array(42).join('s') }), 'a submit label over 40', 'submitLabel');
refused(form([], { successMessage: '' }), 'no success message', 'successMessage');
refused(form([], { purpose: 'party' }), 'an unknown purpose', 'purpose');
refused(form([], { duplicates: 'sometimes' }), 'an unknown duplicates rule', 'duplicates');
refused(form([], { open: 'yes' }), 'a switch that is not on or off', 'open');
refused(form([], { template: 'gala' }), 'an unknown template', 'template');
refused('not a form', 'a form that is not an object', '');

/* ---------- the event's original form ---------- */
var EV = { createdAt: '2026-01-02T03:04:05.000Z', createdBy: 'a@b.in' };
var legacy = F.legacyDefaultForm(EV);
ok(legacy.id === 'register' && legacy.name === 'Register now' && legacy.countsAsRegistration && !legacy.needsApproval && legacy.open && legacy.order === 0 && legacy.rev === 0, 'the original form: register, counts, open', JSON.stringify(legacy).slice(0, 200));
ok(eq(legacy.fields.map(function (f) { return f.id + ':' + f.type + ':' + f.required; }), ['name:text:true', 'email:email:true', 'phone:phone:false', 'company:text:false', 'designation:text:false']), 'by default: phone, company, designation optional; city not asked', JSON.stringify(legacy.fields.map(function (f) { return f.id; })));
ok(legacy.fields[2].label === 'Phone number' && legacy.fields[2].type === 'phone', 'the legacy "tel" field becomes a phone field with its label');
ok(legacy.updatedAt === EV.createdAt && legacy.createdAt === EV.createdAt, 'its version token is the event\'s creation time');
ok(legacy.successMessage === F.DEFAULT_SUCCESS && legacy.duplicates === 'reject', 'the default success message and one per email');
ok(!F.cleanFormInput(legacy, { creating: false, formId: 'register' }).error, 'the original form is itself a valid form');
var custom = F.legacyDefaultForm({ createdAt: 'x', settings: { registration: { duplicates: 'allow', successMessage: 'See you!', fields: { phone: { show: true, required: true }, company: false, city: { show: true } } } } });
ok(eq(custom.fields.map(function (f) { return f.id + ':' + f.required; }), ['name:true', 'email:true', 'phone:true', 'designation:false', 'city:false']), 'an organiser\'s own settings: phone required, no company, city asked', JSON.stringify(custom.fields));
ok(custom.successMessage === 'See you!' && custom.duplicates === 'allow', 'their success message and duplicates rule');
ok(F.legacyRegistration({ settings: { registration: { capacity: 0 } } }).capacity === null && F.legacyRegistration({ settings: { registration: { capacity: 50.7 } } }).capacity === 50, 'capacity: none, or a whole number');
ok(F.resolveDefaultFormId({ settings: { registration: { defaultFormId: 'vip' } } }, [{ id: 'register' }, { id: 'vip' }]) === 'vip', 'the default form as set');
ok(F.resolveDefaultFormId({ settings: { registration: { defaultFormId: 'gone' } } }, [{ id: 'a' }, { id: 'b' }]) === 'a', 'a default that no longer exists: the first form');
ok(F.resolveDefaultFormId({}, [{ id: 'x' }, { id: 'register' }]) === 'register', 'no default set: register');

/* ---------- what a visitor's page is told ---------- */
var vip = Object.assign({ id: 'vip-delegates', order: 3, rev: 4, createdAt: 'c', createdBy: 'who@x', updatedAt: 'u', updatedBy: 'who@x' },
  clone(T.vip.form), { fields: clone(T.vip.form.fields).concat([fld('country', 'country', 'Country', false)]) });
var pub = F.publicForm(vip, { settings: {} });
var pubText = JSON.stringify(pub);
['successMessage', 'needsApproval', 'duplicates', 'order', 'template', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'who@x'].forEach(function (k) {
  ok(pubText.indexOf(k) === -1, 'the public form leaks no "' + k + '"');
});
ok(pub.counts === true && pub.open === true && pub.rev === 4 && pub.submitLabel === 'Request an invitation', 'counts, open, rev, the button');
ok(eq(pub.fields[pub.fields.length - 1].options, F.COUNTRIES), 'a country field is sent with the country list');
ok(F.publicForm(vip, { settings: { registration: { open: false } } }).open === false, 'registration closed: every form is closed');
ok(F.publicForm(Object.assign({}, vip, { open: false }), {}).open === false, 'a form that takes no responses is closed');
var payload = F.publicFormsPayload('ev-1', { settings: { registration: { capacity: 2, defaultFormId: 'vip-delegates' } }, counters: { audienceV: 2, confirmed: 2 } }, [legacy, vip]);
ok(payload.v === 1 && payload.eventId === 'ev-1' && payload.open === true && payload.defaultFormId === 'vip-delegates' && payload.waitlist === true && payload.forms.length === 2, 'the payload: version, event, default form, full', JSON.stringify(payload).slice(0, 200));
ok(F.publicFormsPayload('e', { settings: { registration: { capacity: 3 } }, counters: { audienceV: 2, confirmed: 2 } }, [legacy]).waitlist === false, 'places left: no waitlist');
ok(F.publicFormsPayload('e', { settings: { registration: { capacity: 1 } }, counters: { confirmed: 5 } }, [legacy]).waitlist === false, 'totals not kept yet: no waitlist claimed');

/* ---------- answers: the shared vectors ---------- */
var V = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'validation-vectors.json'), 'utf8'));
ok(V.vectors.length >= 40, 'at least 40 validation vectors', V.vectors.length);
var typesCovered = {};
V.vectors.forEach(function (v, n) {
  var f = V.fields[v.field], answers = {};
  typesCovered[f.type] = true;
  answers[f.id] = v.value;
  var r = F.validateAnswers({ fields: [f] }, { answers: answers });
  var label = 'vector ' + (n + 1) + ' (' + v.field + ' ' + JSON.stringify(v.value).slice(0, 40) + ')';
  if (v.expect.error) {
    ok(r.errors[f.id] === v.expect.error, label + ': "' + v.expect.error + '"', JSON.stringify(r.errors));
  } else {
    ok(!Object.keys(r.errors).length, label + ': no error', JSON.stringify(r.errors));
    var got = F.MAPPED_FIELDS.indexOf(f.id) !== -1 ? r.reg[f.id] : r.answers[f.id];
    if (v.expect.omitted) ok(!(f.id in r.answers), label + ': nothing stored', JSON.stringify(r.answers));
    else ok(eq(got, v.expect.value), label + ': ' + JSON.stringify(v.expect.value).slice(0, 60), JSON.stringify(got));
  }
});
ok(F.FIELD_TYPES.every(function (t) { return typesCovered[t]; }), 'the vectors cover every field type');

/* ---------- answers: a whole form ---------- */
var reg = F.validateAnswers(vip, { answers: { name: ' Asha Rao ', email: 'ASHA@ex.in', phone: '+91 98765 43210', company: 'Acme', designation: 'CIO',
  linkedin: 'linkedin.com/in/asha', why_attend: '', stranger: 'dropped', country: 'India' }, utm: { source: 'li', medium: 'social' }, source: 'Website' });
ok(!Object.keys(reg.errors).length, 'a complete VIP request is accepted', JSON.stringify(reg.errors));
ok(reg.reg.name === 'Asha Rao' && reg.reg.email === 'asha@ex.in' && reg.reg.company === 'Acme' && reg.reg.city === '', 'the columns: mapped fields, cleaned; a column the form does not ask is empty');
ok(eq(reg.answers, { linkedin: 'https://linkedin.com/in/asha', country: 'India' }), 'answers: only the other fields that were answered; unknown keys dropped', JSON.stringify(reg.answers));
ok(eq(reg.answerLabels, { linkedin: 'LinkedIn profile', country: 'Country' }), 'each answer\'s label at the time');
ok(reg.reg.source === 'website' && reg.reg.utm.source === 'li' && reg.reg.utm.campaign === '', 'source and utm');
var bad = F.validateAnswers(vip, { answers: { email: 'nope', phone: '1' } });
ok(eq(Object.keys(bad.errors), ['name', 'email', 'phone', 'company', 'designation']), 'errors in the form\'s field order', Object.keys(bad.errors).join());
var first = F.firstFieldError(vip, bad.errors);
ok(first.message === 'Please enter your name.' && first.fields === bad.errors, 'the first error is the 400\'s message, with every field\'s');
ok(F.firstFieldError(vip, {}) === null, 'no errors: nothing');
var legacyBody = F.validateAnswers(legacy, { name: 'Ravi', email: 'ravi@x.in', phone: '9876543210', company: 'X', city: 'Pune' });
ok(!Object.keys(legacyBody.errors).length && legacyBody.reg.phone === '9876543210' && legacyBody.reg.city === '', 'a page from before forms: top-level keys are its answers; a field the form does not ask is not kept', JSON.stringify(legacyBody));
var big = F.validateAnswers(form([fld('a', 'textarea', 'A', false), fld('b', 'textarea', 'B', false), fld('c', 'textarea', 'C', false), fld('d', 'textarea', 'D', false),
  fld('e', 'textarea', 'E', false), fld('f', 'textarea', 'F', false), fld('g', 'textarea', 'G', false), fld('h', 'textarea', 'H', false), fld('i', 'textarea', 'I', false)]),
  { answers: { name: 'N', email: 'n@x.in', a: new Array(2001).join('é'), b: new Array(2001).join('é'), c: new Array(2001).join('é'), d: new Array(2001).join('é'),
    e: new Array(2001).join('é'), f: new Array(2001).join('é'), g: new Array(2001).join('é'), h: new Array(2001).join('é'), i: new Array(2001).join('é') } });
ok(big.tooLong === true && !Object.keys(big.errors).length, 'answers over 16 KB are too long');
ok(F.validateAnswers(form(), { answers: { name: 'N', email: 'n@x.in' } }).tooLong === false, 'a small answer is not');

/* ---------- one response per email; status ---------- */
var crypto = require('crypto');
ok(F.regDocId('register', 'a@b.in') === 'em-' + crypto.createHash('sha256').update('a@b.in').digest('hex').slice(0, 40), 'the form "register" keeps the original ids (em-)');
ok(F.regDocId('vip-delegates', 'a@b.in') === 'fm-' + crypto.createHash('sha256').update('vip-delegates\na@b.in').digest('hex').slice(0, 40), 'every other form: fm- of form and email');
ok(F.regDocId('vip-delegates', 'a@b.in') === F.regDocId('vip-delegates', 'a@b.in') && F.regDocId('vip-delegates', 'a@b.in') !== F.regDocId('interest', 'a@b.in'), 'stable, and per form');
ok(/^[A-Za-z0-9_-]{43}$/.test(F.regDocId('x', 'y')), 'a valid document id');
ok(F.statusLabel({ status: 'confirmed' }) === 'Confirmed' && F.statusLabel({ status: 'confirmed', counts: false }) === 'Received' &&
   F.statusLabel({ status: 'confirmed', counts: false, decidedAt: 'x' }) === 'Approved' && F.statusLabel({ status: 'pending' }) === 'Awaiting approval' &&
   F.statusLabel({ status: 'rejected' }) === 'Declined' && F.statusLabel({ status: 'waitlist' }) === 'Waitlist' && F.statusLabel({ status: 'cancelled' }) === 'Cancelled', 'the status labels');

/* ---------- pages and CSV ---------- */
var page = '<a href="#rv-form-vip" data-rv-form="vip" data-register-cta>VIP</a><a data-rv-form=\'vip\'>x</a><a data-rv-form=vip>y</a>' +
  '<div class="rv-block-form" data-rv-form-embed="vip"></div><a data-rv-form="vip-2">z</a><div data-rv-form-embed="other"></div><p>data-rv-form="vip" in text</p>';
ok(F.formUsage(page, 'vip') === 4, 'usage: three buttons and an embed, in any quoting, not another form, not text', F.formUsage(page, 'vip'));
ok(F.formUsage(page, 'other') === 1 && F.formUsage(page, 'none') === 0 && F.formUsage(null, 'vip') === 0, 'usage of other forms, and of nothing');
ok(F.csvEscape('plain') === '"plain"' && F.csvEscape('say "hi"') === '"say ""hi"""' && F.csvEscape(null) === '""' && F.csvEscape(12) === '"12"', 'CSV: quoted, quotes doubled');
['=1+1', '+91', '-2', '@SUM(A1)', '\tx', '\rx'].forEach(function (v) {
  ok(F.csvEscape(v) === '"\'' + v.replace(/"/g, '""') + '"', 'CSV: "' + JSON.stringify(v) + '" cannot run as a formula');
});
ok(F.csvEscape('a,b\nc') === '"a,b\nc"', 'CSV: commas and new lines stay inside the quotes');

/* ---------- the AI chat ---------- */
var PAYLOAD = {
  sections: [{ id: 'k-hero', name: 'Hero', buttons: ['Register Now', 'Join as Partner'] }, { id: 'k-contact', name: 'Contact', buttons: [] }, { id: 'k-footer', name: 'Footer' }],
  forms: [{ id: 'register', name: 'Register now', purpose: 'register', fields: ['Full name', 'Email'] }]
};
var ops = F.cleanAiFormOps({
  newForms: [
    { ref: 'new-1', template: 'vip', name: 'VIP delegates', fields: [
      { label: 'Your name', type: 'text', required: true }, { label: 'Work email', type: 'email' }, { label: 'Mobile', type: 'phone', required: true },
      { label: 'Organisation', type: 'text' }, { label: 'Job title', type: 'text' }, { label: 'Diet', type: 'select' },
      { label: 'Sessions', type: 'multiselect', options: ['Day 1', 'Day 1', 'Day 2'] }, { label: 'Your name', type: 'text' }] },
    { ref: 'new-2', template: 'interest', name: 'Express interest', fields: [{ label: 'Message', type: 'textarea' }] },
    { ref: 'dup', template: 'register', name: 'register NOW', fields: [] }
  ],
  ctaLinks: [
    { sectionId: 'k-hero', buttonText: ' register now ', form: 'new-1' },
    { sectionId: 'k-hero', buttonText: 'Become a sponsor', form: 'new-2' },
    { sectionId: 'k-hero', newButtonLabel: 'Express interest in exhibiting at this very large summit', form: 'Express interest' },
    { sectionId: 'k-nowhere', newButtonLabel: 'X', form: 'register' },
    { sectionId: 'k-hero', newButtonLabel: 'Y', form: 'new-9' },
    { sectionId: 'k-contact', newButtonLabel: 'Register', form: 'dup' }
  ],
  formEmbeds: [
    { form: 'new-2', sectionId: 'k-contact' },
    { form: 'register', sectionId: '', afterSectionId: 'k-hero', heading: '', intro: '' },
    { form: 'ghost', sectionId: 'k-contact' }
  ]
}, PAYLOAD);
var nf = ops.newForms;
ok(nf.length === 2 && nf[0].ref === 'new-1' && nf[1].ref === 'new-2', 'two new forms; the one named like an existing form is not made again', JSON.stringify(nf.map(function (x) { return x.ref; })));
var vf = nf[0].form;
ok(vf.id === 'vip-delegates' && vf.template === 'vip' && vf.needsApproval && vf.countsAsRegistration, 'the VIP form: its id and its template\'s switches', JSON.stringify(vf).slice(0, 200));
ok(eq(vf.fields.map(function (f) { return f.id; }), ['name', 'email', 'phone', 'company', 'designation', 'sessions', 'your_name']), 'questions mapped to the columns; the dropdown without options left out', JSON.stringify(vf.fields.map(function (f) { return f.id; })));
ok(vf.fields[1].required === true && vf.fields[1].label === 'Work email', 'the email question is always required, its label kept');
ok(eq(vf.fields[5].options, ['Day 1', 'Day 2']), 'options cleaned');
ok(ops.skipped.some(function (s) { return /Diet/.test(s); }), 'the dropped question is reported', ops.skipped.join(' | '));
var ef = nf[1].form;
ok(ef.id === 'express-interest' && eq(ef.fields.map(function (f) { return f.id; }), ['name', 'email', 'phone', 'company', 'designation', 'message']), 'one field given: the template\'s fields are kept', JSON.stringify(ef.fields.map(function (f) { return f.id; })));
ok(!F.cleanFormInput(vf, { creating: true }).error && !F.cleanFormInput(ef, { creating: true }).error, 'every new form is a form the routes accept');
var links = ops.ctaLinks;
ok(links.length === 3, 'three links survive', JSON.stringify(links));
ok(eq(links[0], { sectionId: 'k-hero', buttonText: 'Register Now', newButtonLabel: '', form: 'new-1' }), 'an existing button, matched without case or spaces, by its own label');
ok(links[1].newButtonLabel.length <= 40 && links[1].form === 'new-2' && links[1].buttonText === '', 'a new button: label cut to 40 at a word; a form named by its name resolves to its ref', JSON.stringify(links[1]));
ok(eq(links[2], { sectionId: 'k-contact', buttonText: '', newButtonLabel: 'Register', form: 'register' }), 'a ref of a form that already existed points at that form');
ok(ops.skipped.some(function (s) { return /Become a sponsor/.test(s); }) && ops.skipped.some(function (s) { return /not on the page/.test(s); }) && ops.skipped.some(function (s) { return /does not exist/.test(s); }),
  'a button not in its section, an unknown section and an unknown form are each reported', ops.skipped.join(' | '));
var emb = ops.formEmbeds;
ok(emb.length === 2 && eq(emb[0], { form: 'new-2', sectionId: 'k-contact', afterSectionId: '', heading: '', intro: '' }), 'an embed in a section', JSON.stringify(emb));
ok(emb[1].sectionId === '' && emb[1].afterSectionId === 'k-hero' && emb[1].heading === 'Register now' && emb[1].intro === 'Fill in your details below.', 'a new form section: its heading from the form, a plain intro', JSON.stringify(emb[1]));
var twice = F.cleanAiFormOps({ newForms: [{ ref: 'a', template: 'blank', name: 'Feedback', fields: [] }, { ref: 'b', template: 'blank', name: 'Feedback!', fields: [] }] },
  { sections: [], forms: [{ id: 'feedback', name: 'Old feedback' }] });
ok(twice.newForms[0].form.id === 'feedback-2' && twice.newForms[1].form.id === 'feedback-3', 'proposed ids are unique against the event\'s forms and each other', JSON.stringify(twice.newForms.map(function (x) { return x.form.id; })));
ok(F.cleanAiFormOps({ newForms: [{ ref: 'r', template: 'register', name: 'Sign up', fields: [] }] }, { sections: [], forms: [] }).newForms[0].form.id === 'sign-up', 'never the reserved id "register"');
var capped = F.cleanAiFormOps({ newForms: [1, 2, 3, 4, 5].map(function (n) { return { ref: 'f' + n, template: 'blank', name: 'Form ' + n, fields: [] }; }) }, { sections: [], forms: [] });
ok(capped.newForms.length === 4 && capped.skipped.length === 1, 'at most four new forms at once');
var empty = F.cleanAiFormOps({}, {});
ok(eq(empty, { newForms: [], ctaLinks: [], formEmbeds: [], skipped: [] }), 'nothing asked: three empty lists');

/* the chat's answer schema and prompt (lib/api.js) */
var hooks = require('./api')._testHooks;
var schema = hooks.chatResponseSchema({ sections: [{ id: 'k-hero' }, { id: 'k-contact' }] });
['newForms', 'ctaLinks', 'formEmbeds'].forEach(function (k) {
  ok(schema.required.indexOf(k) !== -1 && schema.properties[k] && schema.properties[k].type === 'ARRAY', 'the chat schema requires "' + k + '"');
});
var nfItem = schema.properties.newForms.items;
ok(eq(nfItem.required, ['ref', 'template', 'name', 'fields']) && eq(nfItem.properties.template.enum, tplIds), 'newForms: required keys, the template ids');
ok(eq(nfItem.properties.fields.items.properties.type.enum, F.FIELD_TYPES) && nfItem.properties.fields.items.properties.required.type === 'BOOLEAN' &&
   nfItem.properties.countsAsRegistration.type === 'BOOLEAN' && nfItem.properties.needsApproval.type === 'BOOLEAN', 'newForms: field types and switches');
ok(eq(schema.properties.ctaLinks.items.properties.sectionId.enum, ['k-hero', 'k-contact']), 'ctaLinks: sections by the page\'s ids');
var prompt = hooks.buildChatPrompt({ instruction: 'add a VIP delegate form', sections: [{ id: 'k-hero', name: 'Hero', texts: ['Hi'], buttons: ['Register Now'] }],
  forms: [{ id: 'register', name: 'Register now', purpose: 'register', fields: ['Full name', 'Email'] }] });
ok(/"buttons": \[\s*"Register Now"\s*\]/.test(prompt), 'the prompt shows each section\'s buttons');
ok(prompt.indexOf('"formId": "register"') !== -1 && prompt.indexOf('"Full name"') !== -1, 'the prompt lists the site\'s forms and their questions');
ok(/`newForms`/.test(prompt) && /`ctaLinks`/.test(prompt) && /`formEmbeds`/.test(prompt), 'the prompt documents the three form tools');
ok(!/add or edit [^.]*registration/i.test(prompt) && /payments, or send confirmation emails or WhatsApp messages/.test(prompt), 'registration is no longer "cannot do"; payment, email and WhatsApp still are');

/* ---------- the gates: settings and access ---------- */
var cs = hooks.cleanSettings;
['fields', 'successMessage', 'duplicates'].forEach(function (k) {
  var body = { registration: {} };
  body.registration[k] = k === 'fields' ? { phone: { show: true } } : 'x';
  var r = cs(body);
  ok(!!r.error && r.field === 'settings.registration.' + k && /now set per form/.test(r.error), 'settings: "' + k + '" is refused, pointing at the forms', JSON.stringify(r));
});
var dr = cs({ registration: { defaultFormId: 'vip' } });
ok(!!dr.error && dr.field === 'settings.registration.defaultFormId' && /forms\/default/.test(dr.error), 'settings: the default form is not set here', JSON.stringify(dr));
var okSettings = cs({ registration: { open: false, capacity: 100, target: null } });
ok(!okSettings.error && eq(okSettings.value.registration, { open: false, capacity: 100, target: null }), 'settings: open, capacity, target are accepted', JSON.stringify(okSettings));
var merged = hooks.mergeSettings({ registration: { open: true, capacity: 5, defaultFormId: 'vip', fields: { city: { show: true } }, successMessage: 'Old' } }, { registration: { open: false } });
ok(eq(merged.registration, { open: false, capacity: 5, defaultFormId: 'vip', fields: { city: { show: true } }, successMessage: 'Old' }), 'a settings PATCH keeps the default form and the original settings', JSON.stringify(merged));
var access = require('./access');
ok(access.isPublic({ method: 'GET', headers: {} }, '/api/public/forms') === true, '/api/public/forms is public');
ok(access.isPublic({ method: 'GET', headers: {} }, '/api/event/forms') === false, '/api/event/forms is not');

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('forms: all ' + checks + ' checks passed');
