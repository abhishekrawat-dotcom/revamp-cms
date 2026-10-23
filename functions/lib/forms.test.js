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
ok(eq(F.FIELD_TYPES, ['text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'select', 'radio', 'multiselect', 'checkbox', 'country', 'location']), 'the thirteen field types, in order');
ok(F.FIELD_TYPE_LABELS.phone === 'Mobile (with country code)' && F.FIELD_TYPE_LABELS.location === 'Location (city, state, country)', 'the builder names the Mobile and Location types');
ok(F.FIELD_TYPES.every(function (t) { return typeof F.FIELD_TYPE_LABELS[t] === 'string' && F.FIELD_TYPE_LABELS[t]; }), 'every type has a builder label');
ok(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'rv-forms.js'), 'utf8').indexOf(String(F.EMAIL_RE)) !== -1, 'the page runtime has the server\'s email rule, verbatim');
ok(F.COUNTRIES[0] === 'India' && F.COUNTRIES.length >= 245 && F.COUNTRIES.lastIndexOf('India') === 0, 'countries: India first, once, ~249 of them', F.COUNTRIES.length);
ok(F.COUNTRIES.slice(1).every(function (c, i, a) { return i === 0 || a[i - 1].localeCompare(c, 'en') < 0; }), 'countries after India are A–Z without repeats');
ok(F.COUNTRIES.every(function (c) { return c.length <= 120; }), 'every country fits an option');

/* ---------- templates and presets ---------- */
var tplIds = F.FORM_TEMPLATES.map(function (t) { return t.id; });
ok(eq(tplIds, ['register', 'interest', 'partner', 'vip', 'speaker', 'blank']), 'the six templates', tplIds.join());
F.FORM_TEMPLATES.forEach(function (t) {
  var r = F.cleanFormInput(t.form, { creating: true });
  ok(!r.error, 'template "' + t.id + '" is a valid form', r.error);
  ok(eq(t.form.fields.slice(0, 7).map(function (f) { return f.id + ':' + f.type + ':' + f.required; }), ['email:email:true', 'first_name:text:true', 'last_name:text:true', 'phone:phone:true', 'company:text:true', 'designation:text:true', 'location:location:true']),
    'template "' + t.id + '" starts with the seven standard questions, all required', JSON.stringify(t.form.fields.map(function (f) { return f.id; })));
  var lastF = t.form.fields[t.form.fields.length - 1];
  ok(eq(lastF, { id: 'consent', type: 'consent', label: 'Consent', required: true, placeholder: '', help: '' }), 'template "' + t.id + '" ends with the locked consent box', JSON.stringify(lastF));
  ok(eq(r.value && r.value.fields, t.form.fields), 'template "' + t.id + '" is stored as it is', JSON.stringify(r.value && r.value.fields.map(function (f) { return f.id; })));
  ok(t.form.title === t.form.name && t.form.intro === '' && t.form.open === true && t.form.duplicates === 'reject', 'template "' + t.id + '": title = name, no intro, open, one per email');
  ok(typeof t.description === 'string' && t.description.indexOf(t.name) === 0, 'template "' + t.id + '" has a one-line description', t.description);
});
var T = F.TEMPLATE_BY_ID;
ok(T.register.form.countsAsRegistration && !T.register.form.needsApproval, 'Register now counts, no approval');
ok(!T.interest.form.countsAsRegistration && !T.partner.form.countsAsRegistration, 'Express interest and Join as partner do not count');
ok(T.vip.form.countsAsRegistration && T.vip.form.needsApproval, 'VIP delegates counts and needs approval');
ok(!T.speaker.form.countsAsRegistration && T.speaker.form.needsApproval, 'Speaker application needs approval, does not count');
var STD = ['email', 'first_name', 'last_name', 'phone', 'company', 'designation', 'location'];
ok(eq(T.vip.form.fields.map(function (f) { return f.id; }), STD.concat(['linkedin', 'why_attend', 'consent'])), 'VIP fields: the standard seven, then its own, then the consent box');
ok(T.vip.form.fields[0].label === 'Official email' && T.vip.form.submitLabel === 'Request an invitation', 'VIP: official email, its own button');
ok(F.FORM_TEMPLATES.every(function (t) { return t.form.fields[0].label === 'Official email'; }), 'every template asks for the official email first');
ok(eq(T.partner.form.fields[7].options, ['Presenting partner', 'Associate partner', 'Exhibitor', 'Knowledge partner', 'Other']) && T.partner.form.fields[7].required, 'Join as partner: the partnership choice');
ok(eq(T.blank.form.fields.map(function (f) { return f.id; }), STD.concat(['consent'])) && T.blank.form.submitLabel === 'Submit', 'Custom form: the standard seven and the consent box only');
ok(eq(T.register.form.fields.map(function (f) { return f.id; }), STD.concat(['consent'])), 'Register now: the standard seven and the consent box');
ok(T.register.form.fields[6].placeholder === 'Start typing your city' && T.register.form.fields[3].label === 'Mobile number', 'the standard labels and the location hint');
ok(eq(F.defaultFields().map(function (f) { return f.id; }), STD) && eq(F.DEFAULT_FIELD_IDS, STD), 'defaultFields: the seven, in order');
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
ok(!F.cleanFormInput({ name: 'X', fields: [EMAIL, fld('', 'text', 'Other', false)], submitLabel: 'Go', successMessage: 'Done' }, { creating: true }).error, 'a form without a name question is fine (only the email is locked)');
ok(!F.cleanFormInput({ name: 'X', fields: [EMAIL], submitLabel: 'Go', successMessage: 'Done' }, { creating: true }).error, 'a form of the email alone is fine');
var trimmed = clone(T.register.form); trimmed.fields = trimmed.fields.filter(function (f) { return f.id !== 'phone' && f.id !== 'location'; }); trimmed.fields[1].required = false; trimmed.fields[2].label = 'Surname';
ok(!F.cleanFormInput(trimmed, { creating: true }).error, 'the organiser may remove Mobile and Location, make First name optional, relabel Last name');
refused({ name: 'X', fields: [NAME, fld('other', 'text', 'Other', false)], submitLabel: 'Go', successMessage: 'Done' }, 'a form without the email field', 'fields');
ok(!F.cleanFormInput({ name: 'X', fields: [fld('name', 'text', 'Name', false), EMAIL], submitLabel: 'Go', successMessage: 'Done' }, { creating: true }).error, 'an optional name is fine');
var noEmail = clone(T.register.form); noEmail.fields = noEmail.fields.filter(function (f) { return f.id !== 'email'; });
refused(noEmail, 'the standard form without its email', 'fields');
var optEmail = clone(T.register.form); optEmail.fields[0].required = false;
refused(optEmail, 'the standard form with an optional email', 'fields.0.required');
refused(form([fld('first_name', 'textarea', 'First name', true)]), 'first_name as another type', 'fields.2.type');
refused(form([fld('location', 'text', 'Location', true)]), 'the location column as plain text', 'fields.2.type');
var autoId = F.cleanFormInput(form([fld('', 'location', 'Where are you based?', true), fld('', 'text', 'First name', true)]), { creating: true });
ok(!autoId.error && autoId.value.fields[2].id === 'where_are_you_based' && autoId.value.fields[3].id === 'first_name', 'new fields get ids from their labels; a text "First name" is the first-name column', JSON.stringify(autoId).slice(0, 300));
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
ok(eq(legacy.fields.map(function (f) { return f.id + ':' + f.type + ':' + f.required; }), STD.concat(['consent']).map(function (id) { return id + ':' + F.MAPPED_TYPES[id] + ':true'; })), 'an event that never set its form up: the seven standard questions and the consent box', JSON.stringify(legacy.fields.map(function (f) { return f.id; })));
var oldDefault = F.legacyFields(EV);
ok(eq(oldDefault.map(function (f) { return f.id + ':' + f.type + ':' + f.required; }), ['name:text:true', 'email:email:true', 'phone:phone:false', 'company:text:false', 'designation:text:false']), 'the original form\'s questions: name, email, then phone, company, designation optional; city not asked');
ok(oldDefault[2].label === 'Phone number' && oldDefault[2].type === 'phone', 'the legacy "tel" field becomes a phone field with its label');
/* which stored forms tools/migrate-forms.js gives the seven standard questions */
var untouched = Object.assign({}, legacy, { fields: oldDefault, rev: 0 });
ok(F.isUntouchedDefault(untouched, EV) === true, 'a stored Register now nobody ever saved, with the original questions: untouched');
ok(F.isUntouchedDefault(Object.assign({}, untouched, { rev: 1 }), EV) === false, 'once saved by anyone (rev 1): left alone');
var relabelled = clone(untouched); relabelled.fields[0].label = 'Your name';
ok(F.isUntouchedDefault(relabelled, EV) === false, 'questions that differ: left alone');
ok(F.isUntouchedDefault(Object.assign({}, untouched, { id: 'vip' }), EV) === false, 'another form: left alone');
ok(F.isUntouchedDefault(Object.assign({}, untouched, { fields: F.legacyFields({ settings: { registration: { fields: { city: true } } } }) }), { settings: { registration: { fields: { city: true } } } }) === false, 'an event whose organiser chose the original form\'s questions: left alone');
ok(F.isUntouchedDefault(legacy, EV) === false, 'a form that already has the seven: nothing to do');
ok(legacy.updatedAt === EV.createdAt && legacy.createdAt === EV.createdAt, 'its version token is the event\'s creation time');
ok(legacy.successMessage === F.DEFAULT_SUCCESS && legacy.duplicates === 'reject', 'the default success message and one per email');
ok(!F.cleanFormInput(legacy, { creating: false, formId: 'register' }).error, 'the original form is itself a valid form');
var custom = F.legacyDefaultForm({ createdAt: 'x', settings: { registration: { duplicates: 'allow', successMessage: 'See you!', fields: { phone: { show: true, required: true }, company: false, city: { show: true } } } } });
ok(eq(custom.fields.map(function (f) { return f.id + ':' + f.required; }), ['name:true', 'email:true', 'phone:true', 'designation:false', 'city:false', 'consent:true']), 'an organiser\'s own settings: phone required, no company, city asked (and the consent box)', JSON.stringify(custom.fields));
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
ok(eq(pub.fields.filter(function (f) { return f.id === 'country'; })[0].options, F.COUNTRIES), 'a country field is sent with the country list');
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
    var got = F.MAPPED_FIELDS.indexOf(f.id) !== -1 ? r.reg[F.MAPPED_KEY[f.id] || f.id] : r.answers[f.id];
    if (v.expect.omitted) ok(!(f.id in r.answers), label + ': nothing stored', JSON.stringify(r.answers));
    else ok(eq(got, v.expect.value), label + ': ' + JSON.stringify(v.expect.value).slice(0, 60), JSON.stringify(got));
  }
});
ok(F.FIELD_TYPES.every(function (t) { return typesCovered[t]; }), 'the vectors cover every field type');

/* ---------- answers: a whole form ---------- */
var reg = F.validateAnswers(vip, { answers: { first_name: ' Asha ', last_name: 'Rao', email: 'ASHA@ex.in', phone: { country: 'IN', number: '98765 43210' }, company: 'Acme', designation: 'CIO',
  location: 'noida, UTTAR pradesh, india', linkedin: 'linkedin.com/in/asha', why_attend: '', stranger: 'dropped', country: 'India' }, utm: { source: 'li', medium: 'social' }, source: 'Website', consent: true });
ok(!Object.keys(reg.errors).length, 'a complete VIP request is accepted', JSON.stringify(reg.errors));
ok(reg.reg.name === 'Asha Rao' && reg.reg.firstName === 'Asha' && reg.reg.lastName === 'Rao' && reg.reg.email === 'asha@ex.in' && reg.reg.company === 'Acme' && reg.reg.city === '', 'the columns: first and last name, and the name they make; a column the form does not ask is empty', JSON.stringify(reg.reg));
ok(reg.reg.phone === '+919876543210' && reg.reg.phoneCountry === 'IN', 'the mobile number in E.164, with its country');
ok(reg.reg.location === 'Noida, Uttar Pradesh, India' && eq(reg.reg.locationParts, { city: 'Noida', state: 'Uttar Pradesh', country: 'India', countryCode: 'IN', verified: true }), 'a place from the list: its own spelling and its parts, verified', JSON.stringify(reg.reg.locationParts));
var typedPlace = F.validateAnswers(vip, { answers: { first_name: 'A', last_name: 'B', email: 'a@b.in', phone: { country: 'SG', number: '8123 4567' }, company: 'C', designation: 'D', location: 'Sector 62, near the metro' }, consent: true });
ok(!Object.keys(typedPlace.errors).length && typedPlace.reg.location === 'Sector 62, near the metro' && typedPlace.reg.locationParts.verified === false && typedPlace.reg.locationParts.city === '', 'a place typed by hand: kept as typed, not verified', JSON.stringify(typedPlace.reg));
ok(typedPlace.reg.phone === '+6581234567' && typedPlace.reg.phoneCountry === 'SG', 'a Singapore number');
var oneName = F.validateAnswers(vip, { answers: { first_name: 'Asha', last_name: '', email: 'a@b.in', phone: { country: 'IN', number: '9876543210' }, company: 'C', designation: 'D', location: 'Pune' } });
ok(oneName.errors.last_name === 'Please enter your last name.', 'a required last name');
var optLast = clone(vip); optLast.fields[2].required = false;
var onlyFirst = F.validateAnswers(optLast, { answers: { first_name: 'Asha', email: 'a@b.in', phone: { country: 'IN', number: '9876543210' }, company: 'C', designation: 'D', location: 'Pune' }, consent: true });
ok(!Object.keys(onlyFirst.errors).length && onlyFirst.reg.name === 'Asha' && onlyFirst.reg.lastName === '', 'last name made optional and left empty: the name is the first name', JSON.stringify(onlyFirst.reg));
ok(eq(reg.answers, { linkedin: 'https://linkedin.com/in/asha', country: 'India' }), 'answers: only the other fields that were answered; unknown keys dropped', JSON.stringify(reg.answers));
ok(eq(reg.answerLabels, { linkedin: 'LinkedIn profile', country: 'Country' }), 'each answer\'s label at the time');
ok(reg.reg.source === 'website' && reg.reg.utm.source === 'li' && reg.reg.utm.campaign === '', 'source and utm');
var bad = F.validateAnswers(vip, { answers: { email: 'nope', phone: '1' } });
ok(eq(Object.keys(bad.errors), STD.concat(['consent'])), 'errors in the form\'s field order, the consent box last', Object.keys(bad.errors).join());
var first = F.firstFieldError(vip, bad.errors);
ok(first.message === F.EMAIL_MESSAGE && first.fields === bad.errors, 'the first error is the 400\'s message, with every field\'s', first.message);
/* a form saved before first and last names: one name question, as before */
var oldForm = { fields: F.legacyFields(EV) };
var oldAnswer = F.validateAnswers(oldForm, { answers: { name: ' Ravi  Kumar ', email: 'ravi@x.in', phone: '+91 98765 43210' } });
ok(!Object.keys(oldAnswer.errors).length && oldAnswer.reg.name === 'Ravi Kumar' && oldAnswer.reg.firstName === '' && oldAnswer.reg.phone === '+919876543210', 'an old single-name form: its name answer is the name', JSON.stringify(oldAnswer.reg));
ok(F.validateAnswers(oldForm, { answers: { email: 'ravi@x.in' } }).errors.name === 'Please enter your name.', 'an old form still requires its name');
ok(F.firstFieldError(vip, {}) === null, 'no errors: nothing');
var legacyBody = F.validateAnswers(oldForm, { name: 'Ravi', email: 'ravi@x.in', phone: '9876543210', company: 'X', city: 'Pune' });
ok(!Object.keys(legacyBody.errors).length && legacyBody.reg.name === 'Ravi' && legacyBody.reg.phone === '+919876543210' && legacyBody.reg.city === '', 'a page from before forms: top-level keys are its answers; a field the form does not ask is not kept', JSON.stringify(legacyBody));
var legacyAbroad = F.validateAnswers(oldForm, { name: 'Ravi', email: 'ravi@x.in', phone: '020 7946 0958' });
ok(!Object.keys(legacyAbroad.errors).length && legacyAbroad.reg.phone === '020 7946 0958' && legacyAbroad.reg.phoneCountry === '', 'an older page\'s number without its country code is kept as typed, as before');
var big = F.validateAnswers(form([fld('a', 'textarea', 'A', false), fld('b', 'textarea', 'B', false), fld('c', 'textarea', 'C', false), fld('d', 'textarea', 'D', false),
  fld('e', 'textarea', 'E', false), fld('f', 'textarea', 'F', false), fld('g', 'textarea', 'G', false), fld('h', 'textarea', 'H', false), fld('i', 'textarea', 'I', false)]),
  { answers: { name: 'N', email: 'n@x.in', a: new Array(2001).join('é'), b: new Array(2001).join('é'), c: new Array(2001).join('é'), d: new Array(2001).join('é'),
    e: new Array(2001).join('é'), f: new Array(2001).join('é'), g: new Array(2001).join('é'), h: new Array(2001).join('é'), i: new Array(2001).join('é') } });
ok(big.tooLong === true && !Object.keys(big.errors).length, 'answers over 16 KB are too long');
ok(F.validateAnswers(form(), { answers: { name: 'N', email: 'n@x.in' } }).tooLong === false, 'a small answer is not');

/* ---------- the consent box ---------- */
ok(F.FIELD_TYPES.indexOf('consent') === -1 && F.FIELD_PRESETS.every(function (p) { return p.field.type !== 'consent'; }), 'the consent box is no field type a builder offers');
ok(F.CONSENT_TEXT === 'I understand that the information I provide may be shared with partners and I agree to receive communications from them and Economic Times Business Verticals. I also agree to the Privacy Policy, Cookie Policy and T&C', 'the owner\'s wording, exactly');
var cio = F.consentFor('');
ok(eq(cio.links, [{ label: 'Privacy Policy', href: 'https://cio.economictimes.indiatimes.com/privacy_policy.php' }, { label: 'Cookie Policy', href: 'https://cio.economictimes.indiatimes.com/cookie_policy.php' },
  { label: 'T&C', href: 'https://cio.economictimes.indiatimes.com/terms_conditions.php' }]), 'no portal known: ETCIO\'s pages, as the owner gave them', JSON.stringify(cio.links));
ok(eq(F.consentFor('nonsense'), cio) && eq(F.consentFor(undefined), cio) && eq(F.consentFor('constructor'), cio), 'an unknown portal: ETCIO\'s');
ok(/^[0-9a-f]{12}$/.test(cio.version) && F.consentFor('').version === cio.version, 'a short, stable version');
var hrC = F.consentFor('hr');
ok(hrC.links[0].href === 'https://hr.economictimes.indiatimes.com/privacy_policy.php' && hrC.links[2].href === 'https://hr.economictimes.indiatimes.com/terms_conditions.php' && hrC.version !== cio.version, 'the event\'s own portal\'s pages, and their own version', JSON.stringify(hrC));
var wp = F.consentFor('workplace');
ok(eq(wp.links.map(function (l) { return l.href; }), ['https://workplace.economictimes.indiatimes.com/privacy_policy', 'https://workplace.economictimes.indiatimes.com/cookie_policy.php', 'https://workplace.economictimes.indiatimes.com/terms_conditions']), 'a newer portal: no ".php" on privacy and terms; the cookie policy keeps it', JSON.stringify(wp.links));
ok(F.consentFor('startup').links[0].href === 'https://entrepreneur.economictimes.indiatimes.com/privacy_policy.php', 'a portal on another host');
ok(cio.links.every(function (l) { return cio.text.split(l.label).length === 2; }), 'each link\'s label is in the sentence once');
/* the portal, by the same rule as the site footer */
var srcs = [{ type: 'competitor', url: 'https://hr.economictimes.indiatimes.com/x' }, { type: 'currentEdition', url: 'https://cfo.economictimes.indiatimes.com/annual-2026' },
  { type: 'previousEdition', url: 'https://example.com/old', previous: { portal: 'cio', url: 'https://cio.economictimes.indiatimes.com/annual-2025' } }];
ok(F.portalOfSources(srcs) === 'cio' && F.portalOfSources(srcs.slice(0, 2)) === 'cfo' && F.portalOfSources(srcs.slice(0, 1)) === '' && F.portalOfSources(null) === '', 'the portal: the previous edition\'s, else this edition\'s; never a competitor\'s');
[srcs, srcs.slice(0, 2), srcs.slice(0, 1), [{ type: 'previousEdition', url: 'https://www.economictimes.indiatimes.com/x' }]].forEach(function (list, n) {
  ok(F.portalOfSources(list) === require('./api')._testHooks.sitePortal(list).portal, 'the consent links\' portal is the footer\'s (' + n + ')');
});
/* a builder cannot remove, move, reword or loosen it */
var reg0 = clone(T.register.form);
var moved = clone(reg0); moved.fields.unshift(moved.fields.pop()); moved.fields[0].required = false; moved.fields[0].label = 'Whatever';
var movedR = F.cleanFormInput(moved, { creating: true });
ok(!movedR.error && eq(movedR.value.fields, reg0.fields), 'moved, made optional and relabelled: put back, last and locked', JSON.stringify(movedR).slice(0, 300));
var removed = clone(reg0); removed.fields.pop();
ok(eq(F.cleanFormInput(removed, { creating: true }).value.fields, reg0.fields), 'removed (or an older builder that never had it): put back');
var twiceC = clone(reg0); twiceC.fields.push(F.consentField());
ok(F.cleanFormInput(twiceC, { creating: true }).value.fields.filter(F.isConsentField).length === 1, 'sent twice: kept once');
refused(form([fld('consent', 'checkbox', 'I agree', true)]), 'an organiser\'s own field with the id "consent"', 'fields.2.id');
var auto = F.cleanFormInput(form([fld('', 'checkbox', 'Consent', false)]), { creating: true });
ok(!auto.error && auto.value.fields[2].id === 'consent_2' && auto.value.fields[2].type === 'checkbox', 'an organiser\'s own tick box labelled "Consent" gets another id', JSON.stringify(auto.value && auto.value.fields));
var forty2 = []; for (i = 0; i < 38; i++) forty2.push(fld('', 'text', 'Question ' + i, false));
ok(!F.cleanFormInput(form(forty2.concat([F.consentField()])), { creating: true }).error, 'the consent box does not count towards the 40 fields');
/* a stored form: always ends with it */
var storedOld = F.storedForm('vip', { name: 'VIP', fields: [EMAIL, NAME] });
ok(eq(storedOld.fields.map(function (f) { return f.id + ':' + f.type; }), ['email:email', 'name:text', 'consent:consent']), 'a form stored before the box: read with it, last', JSON.stringify(storedOld.fields));
var storedMid = F.storedForm('vip', { name: 'VIP', fields: [F.consentField(), EMAIL, NAME] });
ok(storedMid.fields[2].id === 'consent' && storedMid.fields.length === 3, 'stored out of place: read last');
/* what a page is told */
var pubC = F.publicForm(storedOld, {}, hrC);
ok(eq(pubC.fields[2], { id: 'consent', type: 'consent', label: 'Consent', required: true, placeholder: '', help: '' }), 'the public form ends with the box', JSON.stringify(pubC.fields[2]));
ok(eq(pubC.consent, { text: hrC.text, links: hrC.links, version: hrC.version }), 'the public form carries its wording, links and version', JSON.stringify(pubC.consent));
ok(eq(F.publicForm(storedOld, {}).consent.links, cio.links), 'no consent given: ETCIO\'s');
var payC = F.publicFormsPayload('e', {}, [storedOld], hrC);
ok(eq(payC.consent, pubC.consent) && eq(payC.forms[0].consent, pubC.consent), 'the payload says it once for the page, and on each form');
/* a visitor's answers */
var answersOk = { answers: { email: 'a@b.in', name: 'A' } };
var noTick = F.validateAnswers(storedOld, answersOk);
ok(noTick.consent === false && noTick.errors.consent === 'Please tick the box to agree before you submit.' && F.firstFieldError(storedOld, noTick.errors).message === 'Please tick the box to agree before you submit.', 'not ticked: the owner\'s sentence, as the 400\'s message', JSON.stringify(noTick.errors));
var yes = F.validateAnswers(storedOld, Object.assign({ consent: true }, answersOk));
ok(yes.consent === true && !Object.keys(yes.errors).length, 'consent: true — accepted', JSON.stringify(yes.errors));
ok(F.validateAnswers(storedOld, { answers: { email: 'a@b.in', name: 'A', consent: true } }).consent === true, 'answers.consent: true — accepted too');
['true', 'on', 1, 'yes', {}].forEach(function (v) {
  ok(!!F.validateAnswers(storedOld, Object.assign({ consent: v }, answersOk)).errors.consent, 'consent ' + JSON.stringify(v) + ' is not a yes');
});
ok(!('consent' in yes.answers) && !('consent' in yes.reg), 'the box is not an answer; the route records it');
var rec = F.consentRecord(hrC, '2026-10-21T08:00:00.000Z');
ok(rec.given === true && rec.at === '2026-10-21T08:00:00.000Z' && rec.version === hrC.version && rec.text.indexOf(F.CONSENT_TEXT) === 0 && rec.text.indexOf('Cookie Policy: https://hr.economictimes.indiatimes.com/cookie_policy.php') !== -1, 'the record: given, when, which wording, the sentence and its links', JSON.stringify(rec));
ok(F.requiredMessage(F.consentField()) === F.CONSENT_MESSAGE, 'its required message');
/* the standard questions' new order: which stored "Register now" a migration moves on */
var oldSeven = F.oldDefaultFields();
ok(eq(oldSeven.map(function (f) { return f.id; }), F.OLD_DEFAULT_FIELD_IDS) && oldSeven[2].label === 'Email', 'the old order: First name, Last name, Email …');
var std0 = Object.assign({}, legacy, { fields: oldSeven, rev: 0 });
ok(F.isUntouchedDefault(std0, EV) === true, 'never saved, the seven in the old order: untouched');
ok(F.isUntouchedDefault(Object.assign({}, std0, { fields: oldSeven.concat([F.consentField()]) }), EV) === true, '… with the consent box too');
ok(F.isUntouchedDefault(Object.assign({}, std0, { rev: 1, updatedBy: 'migration: standard questions' }), EV) === true, 'saved only by the earlier migration: untouched');
ok(F.isUntouchedDefault(Object.assign({}, std0, { rev: 2, updatedBy: 'a@b.in' }), EV) === false, 'saved by an organiser: their order is kept');
var std0b = clone(std0); std0b.fields[3].required = false;
ok(F.isUntouchedDefault(std0b, EV) === false, 'a question changed: kept');
ok(F.hasCurrentDefaults(legacy) && !F.hasCurrentDefaults(std0), 'today\'s order is recognised');

/* tools/migrate-forms.js steps 4 and 5 (forms.migrationPlan) */
var NOW = '2026-10-21T09:00:00.000Z';
var p1 = F.migrationPlan('register', { name: 'Register now', fields: F.oldDefaultFields(), rev: 0 }, EV, NOW);
ok(p1.action === 'standard' && eq(p1.patch.fields.map(function (f) { return f.id; }), STD.concat(['consent'])) && p1.patch.rev === 1 && p1.patch.updatedAt === NOW && /^migration/.test(p1.patch.updatedBy), 'an untouched Register now in the old order: today\'s order and the consent box, rev moved on', JSON.stringify(p1));
var p1b = F.migrationPlan('register', { name: 'Register now', fields: F.oldDefaultFields(), rev: 1, updatedBy: 'migration: standard questions' }, EV, NOW);
ok(p1b.action === 'standard' && p1b.patch.rev === 2, 'one the first migration gave the seven: moved on too');
var p1c = F.migrationPlan('register', { name: 'Register now', fields: F.legacyFields(EV), rev: 0 }, EV, NOW);
ok(p1c.action === 'standard', 'one still with the original questions: today\'s seven too');
ok(F.migrationPlan('register', p1.patch, EV, NOW).action === 'none', 'run again: nothing to do');
var orgFields = [fld('first_name', 'text', 'First name', true), fld('last_name', 'text', 'Last name', true), EMAIL, fld('partnership', 'select', 'Partnership', true, { options: ['A'] })];
var p2 = F.migrationPlan('partner', { name: 'Partner', fields: orgFields, rev: 1, updatedBy: 'a@b.in', updatedAt: 'u' }, EV, NOW);
ok(p2.action === 'consent' && eq(Object.keys(p2.patch), ['fields']) && eq(p2.patch.fields.map(function (f) { return f.id; }), ['first_name', 'last_name', 'email', 'partnership', 'consent']), 'an organiser\'s form: the box appended, their order kept, only the fields written', JSON.stringify(p2));
var p3 = F.migrationPlan('register', { name: 'Register now', fields: F.oldDefaultFields(), rev: 3, updatedBy: 'a@b.in' }, EV, NOW);
ok(p3.action === 'consent' && p3.patch.fields[0].id === 'first_name' && /organiser/.test(p3.kept), 'a Register now the organiser saved: its order kept, the box appended', JSON.stringify(p3));
var firestoreOrder = { help: '', id: 'consent', label: 'Consent', placeholder: '', required: true, type: 'consent' };
ok(F.migrationPlan('partner', { fields: orgFields.concat([firestoreOrder]), rev: 1, updatedBy: 'a@b.in' }, EV, NOW).action === 'none', 'the box already stored (in any key order): nothing to do');
ok(F.migrationPlan('partner', { fields: [F.consentField()].concat(orgFields), rev: 1, updatedBy: 'a@b.in' }, EV, NOW).patch.fields[4].id === 'consent', 'a box stored out of place: moved last');
ok(F.migrationPlan('partner', { fields: orgFields.concat([Object.assign(F.consentField(), { required: false })]), rev: 1 }, EV, NOW).action === 'consent', 'a box stored loosened: put right');

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
var awardPage = '<a data-rv-award-cta data-nominate-form="nomination" data-interest-form=\'express-interest\'>Nominate Now</a><button data-rv-award-cta data-nominate-form=nomination>x</button>';
ok(F.formUsage(awardPage, 'nomination') === 2 && F.formUsage(awardPage, 'express-interest') === 1, 'usage: an award site\'s lifecycle buttons count for the forms they open');
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
ok(eq(vf.fields.map(function (f) { return f.id; }), STD.concat(['sessions', 'consent'])), 'the seven standard questions first; the model\'s full name covered by them; the dropdown without options left out', JSON.stringify(vf.fields.map(function (f) { return f.id; })));
ok(vf.fields[0].required === true && vf.fields[0].label === 'Work email', 'the email question is always required, its label kept');
ok(vf.fields[3].label === 'Mobile' && vf.fields[4].label === 'Organisation' && vf.fields[5].label === 'Job title', 'a standard question in the model\'s words keeps them');
ok(vf.fields.slice(0, 7).every(function (f) { return f.required; }), 'the seven are required in a form the AI makes');
ok(eq(vf.fields[7].options, ['Day 1', 'Day 2']), 'options cleaned');
var named = F.cleanAiForm({ template: 'blank', name: 'Survey', fields: [{ label: 'Given name', type: 'text' }, { label: 'Surname', type: 'text' }, { label: 'City', type: 'text' }, { label: 'Phone', type: 'text' }, { label: 'Favourite session', type: 'text' }] });
ok(!named.error && eq(named.form.fields.map(function (f) { return f.id + ':' + f.type; }), ['email:email', 'first_name:text', 'last_name:text', 'phone:phone', 'company:text', 'designation:text', 'location:location', 'favourite_session:text', 'consent:consent']),
  'given name, surname, city and a phone typed as text are the standard questions (as a Location, a Mobile); the rest follow', JSON.stringify(named.form && named.form.fields.map(function (f) { return f.id + ':' + f.type; })));
ok(ops.skipped.some(function (s) { return /Diet/.test(s); }), 'the dropped question is reported', ops.skipped.join(' | '));
var ef = nf[1].form;
ok(ef.id === 'express-interest' && eq(ef.fields.map(function (f) { return f.id; }), STD.concat(['message', 'consent'])), 'one field given: the template\'s fields are kept', JSON.stringify(ef.fields.map(function (f) { return f.id; })));
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
ok(/seven standard questions/.test(prompt) && /Official email \(email\), First name \(text\), Last name \(text\), Mobile number \(phone/.test(prompt), 'the prompt asks for the seven standard questions first, the email first');
ok(/never add a consent, terms or privacy question/.test(prompt), 'the prompt says the consent box is the platform\'s');
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
/* ---------- ids an object already has ("constructor") are never given out ---------- */
ok(F.isReservedId('constructor') && !F.isReservedId('register') && !F.isReservedId('vip-delegates'), 'reserved ids: "constructor" only among valid ids');
ok(F.uniqueId('constructor', [], '-') === 'constructor-2', 'uniqueId skips "constructor" for a form', F.uniqueId('constructor', [], '-'));
ok(F.uniqueId('constructor', ['constructor_2'], '_') === 'constructor_3', 'uniqueId skips "constructor" for a field', F.uniqueId('constructor', ['constructor_2'], '_'));
var ctorForm = F.cleanFormInput(form([fld('', 'text', 'Constructor')], { name: 'Constructor' }), { creating: true });
ok(!ctorForm.error && ctorForm.value.fields[2].id === 'constructor_2', 'a field labelled "Constructor" gets "constructor_2"', JSON.stringify(ctorForm).slice(0, 300));
refused(form([fld('constructor', 'text', 'Builder')]), 'a field id "constructor"', 'fields.2.id');
refused(Object.assign(form(), { id: 'constructor' }), 'a form id "constructor"', 'id');
var ctorAi = F.cleanAiFormOps({ newForms: [{ ref: 'constructor', name: 'Constructor', template: 'blank', fields: [] }],
  ctaLinks: [{ sectionId: 'hero', buttonText: '', newButtonLabel: 'Go', form: 'toString' }] }, { sections: [{ id: 'hero', buttons: [] }], forms: [] });
ok(ctorAi.newForms.length === 1 && ctorAi.newForms[0].form.id === 'constructor-2', 'an AI form named "Constructor" gets "constructor-2"', JSON.stringify(ctorAi.newForms.map(function (m) { return m.form.id; })));
ok(ctorAi.ctaLinks.length === 0, 'an AI link to "toString" (inherited, not a form) is left out', JSON.stringify(ctorAi.ctaLinks));

var access = require('./access');
ok(access.isPublic({ method: 'GET', headers: {} }, '/api/public/forms') === true, '/api/public/forms is public');
ok(access.isPublic({ method: 'GET', headers: {} }, '/api/public/places') === true, '/api/public/places is public');
ok(F.FORMS_RUNTIME_V >= 2, 'the runtime version was bumped for the Mobile and Location fields');
ok(access.isPublic({ method: 'GET', headers: {} }, '/api/event/forms') === false, '/api/event/forms is not');

/* ---------- a Long text field's word limit (Field.maxWords) ---------- */
var SUMMARY = fld('summary', 'textarea', 'Entry summary', true, { maxWords: 300 });
var withLimit = F.cleanFormInput(form([SUMMARY]), { creating: true });
ok(!withLimit.error && withLimit.value.fields[2].maxWords === 300, 'a Long text field may have a word limit', JSON.stringify(withLimit).slice(0, 200));
ok(!('maxWords' in F.cleanFormInput(form([fld('msg', 'textarea', 'Message', false)]), { creating: true }).value.fields[2]), 'none unless given');
refused(form([fld('t', 'text', 'Title', false, { maxWords: 20 })]), 'a word limit on a Short text field', 'fields.2.maxWords');
refused(form([fld('s', 'textarea', 'Summary', false, { maxWords: 5 })]), 'a word limit under 10', 'fields.2.maxWords');
refused(form([fld('s', 'textarea', 'Summary', false, { maxWords: 1001 })]), 'a word limit over 1000', 'fields.2.maxWords');
refused(form([fld('s', 'textarea', 'Summary', false, { maxWords: '300' })]), 'a word limit that is text', 'fields.2.maxWords');
refused(form([fld('s', 'textarea', 'Summary', false, { maxWords: 12.5 })]), 'a word limit that is not whole', 'fields.2.maxWords');
ok(!F.cleanFormInput(form([fld('s', 'textarea', 'Summary', false, { maxWords: null })]), { creating: true }).error, 'maxWords: null is "no limit"');
var words300 = new Array(301).join('word '), words301 = words300 + 'more';
var sv = F.validateAnswers({ fields: [SUMMARY] }, { answers: { summary: words300 } });
ok(!sv.errors.summary && sv.answers.summary.split(' ').length === 300, '300 words are taken', JSON.stringify(sv.errors));
sv = F.validateAnswers({ fields: [SUMMARY] }, { answers: { summary: words301 } });
ok(sv.errors.summary === 'Please keep Entry summary to 300 words or fewer (it has 301).', '301 words are refused, with the count', sv.errors.summary);
ok(F.wordCount('  one\ntwo\t three  ') === 3 && F.wordCount('') === 0 && F.wordCount('   ') === 0, 'words are what is between spaces and line breaks');
ok(F.textareaMax({ maxWords: 300 }) === 3600 && F.textareaMax({}) === 2000 && F.textareaMax({ maxWords: 1000 }) === 8000 && F.textareaMax({ maxWords: 50 }) === 2000, 'a word limit makes room for its words (2,000 to 8,000 characters)');
var longWords = new Array(300).join('extraordinarily ');      // 299 long words, over 2,000 characters
sv = F.validateAnswers({ fields: [SUMMARY] }, { answers: { summary: longWords } });
ok(!sv.errors.summary && sv.answers.summary.length > 2000, 'within the word limit, an answer may run past 2,000 characters', sv.answers.summary && sv.answers.summary.length);
var stSum = F.storedForm('f', { name: 'F', fields: [fld('email', 'email', 'Email', true), fld('s', 'textarea', 'S', false, { maxWords: 300 }), fld('t', 'text', 'T', false, { maxWords: 300 }), fld('u', 'textarea', 'U', false, { maxWords: 'x' })] });
ok(stSum.fields[1].maxWords === 300 && !('maxWords' in stSum.fields[2]) && !('maxWords' in stSum.fields[3]), 'a stored word limit is read only where it is valid');
var pubSum = F.publicForm(stSum, {}, F.consentFor('hr'));
ok(pubSum.fields[1].maxWords === 300, 'a visitor\'s page is told the word limit');

/* ---------- required only when an earlier answer is a certain option (Field.requiredWhen) ---------- */
var KIND = fld('kind', 'radio', 'Nominee type', true, { options: ['Individual', 'Organisation'] });
var DESIG = fld('designation', 'text', 'Nominee designation', false, { requiredWhen: { field: 'kind', equals: 'Individual' } });
var condForm = F.cleanFormInput(form([KIND, DESIG]), { creating: true });
ok(!condForm.error && eq(condForm.value.fields[3].requiredWhen, { field: 'kind', equals: 'Individual' }), 'a field may be required only when another answer is a certain option', JSON.stringify(condForm).slice(0, 300));
refused(form([DESIG, KIND]), 'a condition on a question further down', 'fields.2.requiredWhen');
refused(form([KIND, fld('designation', 'text', 'D', false, { requiredWhen: { field: 'kind', equals: 'Robot' } })]), 'a condition on an option the question does not have', 'fields.3.requiredWhen');
refused(form([fld('note', 'text', 'Note', false), fld('designation', 'text', 'D', false, { requiredWhen: { field: 'note', equals: 'x' } })]), 'a condition on a Short text question', 'fields.3.requiredWhen');
refused(form([KIND, fld('designation', 'text', 'D', false, { requiredWhen: { field: 'kind' } })]), 'a condition without its option', 'fields.3.requiredWhen');
refused(form([KIND, fld('designation', 'text', 'D', false, { requiredWhen: { field: 'kind', equals: 'Individual', or: 'x' } })]), 'a condition with other keys', 'fields.3.requiredWhen');
refused({ name: 'X', fields: [fld('kind', 'select', 'Kind', true, { options: ['A'] }), fld('email', 'email', 'Email', false, { requiredWhen: { field: 'kind', equals: 'A' } })], submitLabel: 'S', successMessage: 'T' }, 'the email required only sometimes');
var always = F.cleanFormInput(form([KIND, fld('designation', 'text', 'D', true, { requiredWhen: { field: 'kind', equals: 'Individual' } })]), { creating: true });
ok(!always.error && !('requiredWhen' in always.value.fields[3]), 'a field required anyway drops its condition');
var cf = F.storedForm('c', condForm.value);
var ans = { name: 'Asha', email: 'a@b.co' };
var r1 = F.validateAnswers(cf, { answers: Object.assign({ kind: 'Individual' }, ans), consent: true });
ok(r1.errors.designation === 'Please fill in Nominee designation.', 'an individual must give a designation', JSON.stringify(r1.errors));
var r2 = F.validateAnswers(cf, { answers: Object.assign({ kind: 'Organisation' }, ans), consent: true });
ok(!r2.errors.designation && !Object.keys(r2.errors).length, 'an organisation need not', JSON.stringify(r2.errors));
var r3 = F.validateAnswers(cf, { answers: Object.assign({ kind: 'Individual', designation: 'CIO' }, ans), consent: true });
ok(!Object.keys(r3.errors).length && r3.reg.designation === 'CIO', 'given: stored as the registration\'s designation');
ok(eq(F.publicForm(cf, {}, null).fields[3].requiredWhen, { field: 'kind', equals: 'Individual' }), 'a visitor\'s page is told the condition');

/* ---------- an award's forms ---------- */
ok(F.PURPOSES.indexOf('nomination') !== -1, 'a form may be for nominations');
ok(F.FORM_TEMPLATES.every(function (t) { return t.id !== 'nomination'; }), 'no builder offers a nomination template (it is made from the award\'s categories)');
var co = F.awardCategoryOptions(['Technology › AI Leader', { master: 'Technology', name: 'Cloud Leader' }, { name: 'People', subcategories: ['CHRO of the Year', { title: 'DEI Champion' }] },
  { name: 'Solo' }, 'Technology › AI Leader', '', 42, null, new Array(30).join('Very long category name ')]);
ok(eq(co.options.slice(0, 5), ['Technology › AI Leader', 'Technology › Cloud Leader', 'People › CHRO of the Year', 'People › DEI Champion', 'Solo']) && co.options.length === 6,
  'categories become "Master › Sub" options, once each', JSON.stringify(co.options));
ok(co.options[5].length <= 120 && /…$/.test(co.options[5]), 'a category over 120 characters is shortened', co.options[5]);
var many = []; for (var mi = 0; mi < 130; mi++) many.push('Category ' + mi);
var mo = F.awardCategoryOptions(many);
ok(mo.options.length === 100 && mo.skipped === 30, 'at most 100 categories; the rest are counted', mo.skipped);
ok(F.awardCategoryOptions(null).options.length === 0 && F.awardCategoryOptions('x').options.length === 0, 'no categories: no options');

var nom = F.awardNominationForm({ options: co.options, title: 'Nominate for the ETHR Awards 2027' });
var nomC = F.cleanFormInput(nom, { creating: true });
ok(!nomC.error, 'the nomination form is a valid form', JSON.stringify(nomC.error));
var nf = nomC.value;
ok(eq(nf.fields.map(function (f) { return f.id; }), ['category', 'nominee_type', 'name', 'designation', 'company', 'email', 'phone', 'entry_title', 'entry_summary', 'supporting_link', 'consent']),
  'its questions, in order, and the consent box last', nf.fields.map(function (f) { return f.id; }).join());
var byId = {}; nf.fields.forEach(function (f) { byId[f.id] = f; });
ok(byId.category.type === 'select' && byId.category.required && eq(byId.category.options, co.options), 'Category: a required dropdown of the categories');
ok(byId.nominee_type.type === 'radio' && eq(byId.nominee_type.options, ['Individual', 'Organisation']) && byId.nominee_type.required, 'Nominee type: Individual / Organisation');
ok(byId.name.label === 'Nominee name' && byId.name.required, 'Nominee name (the registration\'s name)');
ok(!byId.designation.required && eq(byId.designation.requiredWhen, { field: 'nominee_type', equals: 'Individual' }), 'Nominee designation: required for an individual only');
ok(byId.company.label === 'Organisation' && byId.company.required, 'Organisation (the registration\'s company)');
ok(byId.email.label === 'Official email' && byId.email.required && byId.phone.type === 'phone' && byId.phone.required, 'Official email and Mobile (with country code)');
ok(byId.entry_title.type === 'text' && byId.entry_title.required, 'Entry title');
ok(byId.entry_summary.type === 'textarea' && byId.entry_summary.maxWords === 300 && byId.entry_summary.required, 'Entry summary: long text, 300 words');
ok(byId.supporting_link.type === 'url' && !byId.supporting_link.required, 'Supporting link: an optional web address');
ok(nf.purpose === 'nomination' && nf.template === 'nomination' && nf.countsAsRegistration === false && nf.needsApproval === false && nf.duplicates === 'allow',
  'for nominations; not a registration; one person may nominate several times');
ok(nf.title === 'Nominate for the ETHR Awards 2027' && nf.name === 'Nomination' && nf.submitLabel === 'Submit nomination', 'its name, title and button');
var nst = F.storedForm('nomination', nf);
ok(nst.template === 'nomination' && nst.purpose === 'nomination', 'stored, it keeps its kind');
var good = { category: co.options[0], nominee_type: 'Individual', name: 'Asha Rao', designation: 'CHRO', company: 'Acme', email: 'asha@acme.com',
  phone: { country: 'IN', number: '98765 43210' }, entry_title: 'Hiring at scale', entry_summary: 'We hired 5,000 people in a year.', supporting_link: 'acme.com/story' };
var nv = F.validateAnswers(nst, { answers: good, consent: true });
ok(!Object.keys(nv.errors).length, 'a complete nomination is taken', JSON.stringify(nv.errors));
ok(nv.reg.name === 'Asha Rao' && nv.reg.company === 'Acme' && nv.reg.designation === 'CHRO' && nv.reg.phone === '+919876543210' && nv.reg.email === 'asha@acme.com',
  'its nominee and contact are the registration\'s own columns', JSON.stringify(nv.reg));
ok(nv.answers.category === co.options[0] && nv.answers.nominee_type === 'Individual' && nv.answers.entry_title === 'Hiring at scale' && nv.answers.supporting_link === 'https://acme.com/story' &&
  nv.answerLabels.entry_summary === 'Entry summary', 'the rest are answers, with their labels (Reporting shows them)', JSON.stringify(nv.answers));
var orgAns = Object.assign({}, good, { nominee_type: 'Organisation', designation: '' });
ok(!Object.keys(F.validateAnswers(nst, { answers: orgAns, consent: true }).errors).length, 'an organisation without a designation is taken');
ok(F.validateAnswers(nst, { answers: Object.assign({}, good, { category: 'Not a category' }), consent: true }).errors.category === 'Please choose one of the options for Category.', 'only the award\'s categories');
ok(F.validateAnswers(nst, { answers: good }).errors.consent === F.CONSENT_MESSAGE, 'the consent box is required');

var intr = F.cleanFormInput(F.awardInterestForm(), { creating: true });
ok(!intr.error && eq(intr.value.fields.map(function (f) { return f.id; }), F.DEFAULT_FIELD_IDS.concat(['consent'])) && intr.value.fields.slice(0, 7).every(function (f) { return f.required; }),
  'Express Interest: the seven standard questions, all required, and the consent box', JSON.stringify(intr.error));
ok(intr.value.purpose === 'interest' && intr.value.name === 'Express Interest' && intr.value.countsAsRegistration === false && intr.value.duplicates === 'reject', 'an expression of interest, not a registration');

var found = F.findAwardForms([F.storedForm('register', { name: 'Register now', purpose: 'register' }), F.storedForm('ei', { name: 'EI', purpose: 'interest' }), nst, F.storedForm('ei2', { name: 'EI2', purpose: 'interest' })]);
ok(found.nominate.id === 'nomination' && found.interest.id === 'ei', 'an event\'s award forms are found by what they are for (the first of each)');
ok(F.findAwardForms([]).nominate === null && F.findAwardForms(null).interest === null, 'none');
ok(F.withCategoryOptions(nst, co.options) === null, 'the same categories: nothing to change');
var moved = F.withCategoryOptions(nst, ['New › One']);
ok(moved && eq(moved.filter(function (f) { return f.id === 'category'; })[0].options, ['New › One']) && moved.length === nst.fields.length &&
  eq(moved.filter(function (f) { return f.id !== 'category'; }), nst.fields.filter(function (f) { return f.id !== 'category'; })), 'new categories change the Category options only');
ok(F.withCategoryOptions(nst, []) === null, 'no categories given: nothing changes');

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('forms: all ' + checks + ' checks passed');
