/* node functions/lib/forms-builder.test.js — the registration forms builder's own rules (forms-builder.js, the
   browser component the console and the site editor share), run without a browser: what it sends the server,
   what it refuses before sending, and the preview it hands the form runtime. Exits 1 on any failure. */
const fs = require('fs'), path = require('path'), vm = require('vm');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

var src = fs.readFileSync(path.join(__dirname, '..', '..', 'forms-builder.js'), 'utf8');
var win = {};
vm.runInNewContext(src, { window: win, document: {}, console: console, JSON: JSON, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
var B = win.RevampFormsBuilder;
ok(B && typeof B.mount === 'function', 'forms-builder.js defines RevampFormsBuilder.mount');
var P = B._pure;

/* the source is ES5: no arrow functions, let/const, template strings or classes in the browser code */
var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/=>/.test(code), 'no arrow functions');
ok(!/\b(let|const|class)\s/.test(code), 'no let / const / class');
ok(code.indexOf('`') === -1, 'no template strings');

var vip = {
  id: 'vip-delegates', name: 'VIP delegates', title: 'Request a VIP delegate invitation', intro: 'Places are limited.', purpose: 'vip',
  fields: [
    { id: 'name', type: 'text', label: 'Full name', required: true, placeholder: '', help: '' },
    { id: 'email', type: 'email', label: 'Work email', required: true, placeholder: '', help: '' },
    { id: 'interest', type: 'select', label: 'Interest', required: true, placeholder: '', help: '', options: ['A', 'B'] },
    { id: 'country', type: 'country', label: 'Country', required: false, placeholder: '', help: '' }
  ],
  submitLabel: 'Request an invitation', successMessage: 'Thank you.', countsAsRegistration: true, needsApproval: true,
  open: true, duplicates: 'reject', order: 3, template: 'vip', rev: 4, createdAt: 'x', createdBy: 'y', updatedAt: 'z', updatedBy: 'w'
};

/* formInput: exactly the FormInput keys, never the server's own */
var input = P.formInput(vip);
ok(JSON.stringify(Object.keys(input).sort()) === JSON.stringify(['countsAsRegistration', 'duplicates', 'fields', 'intro', 'name', 'needsApproval', 'open', 'purpose', 'submitLabel', 'successMessage', 'template', 'title']),
  'formInput sends the FormInput keys only', Object.keys(input).join(','));
ok(!('id' in input) && !('rev' in input) && !('order' in input) && !('updatedAt' in input), 'no id, rev, order or timestamps in the input');
ok(input.fields[2].options.join('|') === 'A|B' && !('options' in input.fields[0]) && !('options' in input.fields[3]), 'options only on select / radio / multiselect');
ok(input.fields[0].id === 'name', 'an existing field keeps its id');
var fresh = P.formInput({ name: ' New ', fields: [{ type: 'text', label: ' Label ', required: false }], submitLabel: 'Go', successMessage: 'Done' });
ok(!('id' in fresh.fields[0]) && fresh.fields[0].label === 'Label' && fresh.name === 'New', 'a new field is sent without an id, values trimmed', JSON.stringify(fresh.fields[0]));
ok(fresh.duplicates === 'reject' && fresh.open === true && fresh.template === 'blank' && fresh.purpose === 'custom', 'defaults: reject duplicates, open, blank, custom');

/* drafts and changes */
var d = P.draftOf(vip);
ok(P.sameDraft(d, vip), 'a draft of a form is the same form');
d.fields[0].label = 'Name';
ok(!P.sameDraft(d, vip), 'a relabelled field is a change');
d = P.draftOf(vip); d.fields[2].options.push('C');
ok(!P.sameDraft(d, vip) && vip.fields[2].options.length === 2, 'adding an option is a change, and does not touch the stored form');

/* validateDraft: what the server would refuse is found first */
function keys(errs) { return errs.map(function (e) { return e.key + (e.field != null ? '@' + e.field : '') + (e.option != null ? '.' + e.option : ''); }).join(','); }
ok(P.validateDraft(P.draftOf(vip)).length === 0, 'a valid form has no problems');
d = P.draftOf(vip); d.name = '  ';
ok(keys(P.validateDraft(d)) === 'name', 'an empty name is refused', keys(P.validateDraft(d)));
d = P.draftOf(vip); d.fields[1].label = '';
ok(keys(P.validateDraft(d)) === 'label@1', 'an empty label is refused');
d = P.draftOf(vip); d.fields[2].options = [];
ok(keys(P.validateDraft(d)) === 'options@2', 'a dropdown with no options is refused');
d = P.draftOf(vip); d.fields[2].options = ['A', ' ', 'a'];
ok(keys(P.validateDraft(d)) === 'option@2.1,option@2.2', 'an empty option and a repeated one are refused', keys(P.validateDraft(d)));
ok(/Each option must be different/.test(P.validateDraft(d)[1].msg), 'the repeat is named');
d = P.draftOf(vip); d.submitLabel = ''; d.successMessage = '';
ok(keys(P.validateDraft(d)) === 'submitLabel,successMessage', 'submit label and success message are needed');
d = P.draftOf(vip); while (d.fields.length < 41) d.fields.push({ type: 'text', label: 'F' + d.fields.length, required: false });
ok(/fields/.test(keys(P.validateDraft(d, { maxFields: 40, maxOptions: 100 }))), 'more than 40 fields is refused');
d = P.draftOf(vip); d.fields[2].options = []; for (var i = 0; i < 101; i++) d.fields[2].options.push('o' + i);
ok(/options@2/.test(keys(P.validateDraft(d, { maxFields: 40, maxOptions: 100 }))), 'more than 100 options is refused');

d = P.draftOf(vip); d.name = '  vip   DELEGATES ';
ok(keys(P.validateDraft(d, null, ['Register now', 'VIP delegates'])) === 'name', 'a name another form has is refused (case and spaces aside)');
ok(/already called/.test(P.validateDraft(d, null, ['VIP delegates'])[0].msg), 'the clash is explained');
ok(P.validateDraft(d, null, ['Register now']).length === 0, 'a name no other form has is fine');

/* pasted options */
ok(P.parseOptionList('One\n two \n\nONE\nThree', ['three']).join('|') === 'One|two', 'a pasted list: trimmed, empty lines and repeats (any case) dropped', P.parseOptionList('One\n two \n\nONE\nThree', ['three']).join('|'));
ok(P.parseOptionList(new Array(200).join('x')).join('').length === 120, 'a pasted option is cut to 120 characters');

/* moving */
var list = ['a', 'b', 'c'];
ok(P.moveItem(list, 0, 2) && list.join('') === 'bca', 'moveItem moves down');
ok(!P.moveItem(list, 0, 5) && list.join('') === 'bca', 'moveItem refuses out of range');

/* the server's field names */
ok(JSON.stringify(P.serverFieldOf('fields.3.label')) === '{"field":3,"key":"label"}', 'fields.3.label');
ok(JSON.stringify(P.serverFieldOf('fields[2].options')) === '{"field":2,"key":"options"}', 'fields[2].options');
ok(JSON.stringify(P.serverFieldOf('form.submitLabel')) === '{"key":"submitLabel"}', 'form.submitLabel');

/* templates of either shape */
var t1 = P.templateForm({ id: 'vip', name: 'VIP delegates', purpose: 'vip', fields: vip.fields, needsApproval: true, countsAsRegistration: true, submitLabel: 'x', successMessage: 'y' });
var t2 = P.templateForm({ id: 'vip', form: { name: 'VIP delegates', purpose: 'vip', fields: vip.fields, needsApproval: true, countsAsRegistration: true } });
ok(t1.name === 'VIP delegates' && t1.template === 'vip' && t1.needsApproval && t2.name === 'VIP delegates' && t2.template === 'vip' && t2.countsAsRegistration, 'a template, flat or wrapped');
ok(/needs approval, counts as a registration/.test(P.describeTemplate({ id: 'vip', name: 'VIP delegates', fields: [], needsApproval: true, countsAsRegistration: true })), 'a template described by its switches');

/* the preview the runtime draws */
var pf = P.previewForm({ name: 'X', title: '', fields: [{ type: 'text', label: 'A' }, { type: 'text', label: 'B' }, { id: 'c', type: 'country', label: 'Country' }, { type: 'select', label: 'S', options: ['a', '', 'b'] }], submitLabel: '', countsAsRegistration: true }, null, ['India', 'Nepal']);
var ids = pf.fields.map(function (f) { return f.id; });
ok(ids.length === 4 && ids.every(Boolean) && new Set(ids).size === 4, 'every preview field has an id of its own', ids.join(','));
ok(pf.fields[2].options.join('|') === 'India|Nepal', 'a country field gets the country list');
ok(pf.fields[3].options.join('|') === 'a|b', 'empty options are not drawn');
ok(pf.submitLabel === 'Submit' && pf.counts === true && pf.open === true, 'preview defaults');

/* every piece of form data reaches the page escaped (no raw data in innerHTML) */
ok(/function esc\(/.test(src) && !/innerHTML\s*=\s*[^;]*\b(f|form|field|d)\.(name|label|title|intro)\b(?![^;]*esc\()/.test(src), 'labels and names go through esc()');

if (failures.length) {
  console.error('forms-builder.test.js: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('forms-builder.test.js: all ' + checks + ' checks passed');
