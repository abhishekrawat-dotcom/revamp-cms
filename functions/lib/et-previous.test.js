// node functions/lib/et-previous.test.js — a previous edition's records, and the sections made of them.
const ep = require('./et-previous');
const ps = require('./prev-sections');
const { scopeSectionCss, sectionRootInfo } = require('./gen-markup');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

check('portal from an ET microsite address', ep.portalOf('https://enterpriseai.economictimes.indiatimes.com/agentic-ai-summit') === 'enterpriseai' && ep.portalOf('https://cio.economictimes.indiatimes.com/x?y') === 'cio');
check('no portal elsewhere', ep.portalOf('https://example.com/x') === '' && ep.portalOf('https://www.economictimes.indiatimes.com/x') === '' && ep.portalOf('') === '');
var page = '<script>{"entity_id":"3858","digital_month_id":"3858"} {"digital_month_id":"4865"} {"digital_month_id":"3858"}</script>' +
  '<img src="https://img.etb2bimg.com/files/retail_files/glimpses_1_a.webp"><img src="http://img.etb2bimg.com/files/retail_files/glimpses_2_b.jpg"><img src="https://img.etb2bimg.com/files/retail_files/glimpses_1_a.webp"><img src="https://img.etb2bimg.com/files/cp/logo.png">';
check('the ids a page names, the most named first', JSON.stringify(ep.idsIn(page)) === '["3858","4865"]', JSON.stringify(ep.idsIn(page)));
check('the gallery photos, once each, on https', JSON.stringify(ep.glimpsesIn(page)) === JSON.stringify(['https://img.etb2bimg.com/files/retail_files/glimpses_1_a.webp', 'https://img.etb2bimg.com/files/retail_files/glimpses_2_b.jpg']), JSON.stringify(ep.glimpsesIn(page)));

var raw = {
  portal: 'enterpriseai', id: '3858', url: 'https://enterpriseai.economictimes.indiatimes.com/x',
  details: { company_name: 'Agentic AI Summit 2026 Edition 1', event_start_date: '2026-02-12 08:00:00', event_venue: 'Taj Santacruz, Mumbai' },
  speakers: [
    { speaker_name: 'B &amp; Co', speaker_desig: 'CTO', speaker_company: 'Acme', speaker_picture: 'cp/b.jpg', speaker_weightage: 2, group: { group_name: 'Speakers' } },
    { speaker_name: 'A Name', speaker_desig: '<b>Minister</b>', speaker_company: 'Govt', speaker_picture: 'cp/a.jpg', speaker_weightage: 1, group: { group_name: 'Chief Guest' } },
    { speaker_name: '', speaker_picture: 'cp/x.jpg' }
  ],
  sponsors: [{ sponsor_title: 'NITI Aayog', sponsor_logo: 'file_n.svg', weightage: 1, url: 'https://niti.gov.in/', group: { group_name: 'Supported By' } }, { sponsor_title: 'No logo' }],
  agenda: [{ agenda_title: 'Second', agenda_start_datetime: '2026-02-12 11:00:00', agenda_end_datetime: '2026-02-12 11:30:00', speakers: [{ speaker_name: 'A Name' }] }, { agenda_title: 'First', agenda_start_datetime: '2026-02-12 10:00:00' }],
  glimpses: ['https://img.etb2bimg.com/files/retail_files/glimpses_1_a.webp']
};
var p = ep.normalise(raw);
check('name without its "Edition N"', p.name === 'Agentic AI Summit 2026', p.name);
check('speakers in the site\'s own order, text cleaned, nameless ones out', p.speakers.length === 2 && p.speakers[0].name === 'A Name' && p.speakers[0].designation === 'Minister' && p.speakers[1].name === 'B & Co');
check('a speaker photo on ET\'s image host', p.speakers[0].photo === 'https://img.etb2bimg.com/files/cp/a.jpg' && p.speakers[0].group === 'Chief Guest');
check('sponsor logos under retail_files; a sponsor with no logo is left out', p.sponsors.length === 1 && p.sponsors[0].logo === 'https://img.etb2bimg.com/files/retail_files/file_n.svg' && p.sponsors[0].tier === 'Supported By');
check('agenda in time order, with its speakers', p.agenda[0].title === 'First' && p.agenda[1].speakers[0] === 'A Name');

/* reading: the id with records is the one used */
var calls = [];
function fakeFetch(url, headers) {
  calls.push(url + ' portal=' + headers.portal);
  var id = (/(?:entity_id|digital_month_id)=(\d+)/.exec(url) || [])[1];
  if (/speaker\/list/.test(url)) return Promise.resolve({ status: true, data: { is_last_page: true, items: id === '3858' ? raw.speakers : [] } });
  if (/sponsor\/list/.test(url)) return Promise.resolve({ status: true, data: { is_last_page: true, items: id === '3858' ? raw.sponsors : [] } });
  if (/agenda\/list/.test(url)) return Promise.resolve({ status: true, data: { is_last_page: true, items: raw.agenda } });
  if (/details/.test(url)) return Promise.resolve({ status: true, data: raw.details });
  return Promise.reject(new Error('unexpected ' + url));
}
var pageOtherFirst = '{"digital_month_id":"4865"}{"digital_month_id":"4865"}{"digital_month_id":"3858"}';
ep.readPrevious('https://enterpriseai.economictimes.indiatimes.com/agentic-ai-summit', pageOtherFirst, { fetchJson: fakeFetch }).then(function (r) {
  check('of the ids named, the one with records is used', r && r.id === '3858' && r.speakers.length === 2, r && r.id);
  check('the portal goes with every request', calls.every(function (c) { return / portal=enterpriseai$/.test(c); }));
  return ep.readPrevious('https://example.com/x', page, { fetchJson: fakeFetch });
}).then(function (r) {
  check('not an ET microsite: nothing read', r === null);
  return ep.readPrevious('https://cio.economictimes.indiatimes.com/x', '{"digital_month_id":"1"}', { fetchJson: function () { return Promise.reject(new Error('down')); } });
}).then(function (r) {
  check('the API down: nothing, and no failure', r === null);
  /* an edition picked from ET's list: exactly that portal and id, whatever the page names (or not) */
  calls = [];
  return ep.readPrevious('https://example.com/not-an-et-page', '{"digital_month_id":"4865"}', { fetchJson: fakeFetch, portal: 'brandequity', id: '3858' });
}).then(function (r) {
  check('picked: that id is read, and no other', r && r.id === '3858' && r.portal === 'brandequity' && r.speakers.length === 2 && calls.every(function (c) { return !/4865/.test(c); }), r && r.id);
  check('picked: the picked portal goes with every request', calls.length > 0 && calls.every(function (c) { return / portal=brandequity$/.test(c); }));
  calls = [];
  return ep.readPrevious('https://enterpriseai.economictimes.indiatimes.com/x', '', { fetchJson: fakeFetch, id: '3858' });
}).then(function (r) {
  check('picked id, portal from the address: read though the page names no id', r && r.id === '3858' && calls.every(function (c) { return / portal=enterpriseai$/.test(c); }));
  calls = [];
  return ep.readPrevious('https://enterpriseai.economictimes.indiatimes.com/x', pageOtherFirst, { fetchJson: fakeFetch, id: '4865' });
}).then(function (r) {
  check('picked an id with no records and no photos: nothing (the page\'s other id is not tried)', r === null && calls.every(function (c) { return !/3858/.test(c); }));

  /* the sections */
  var planned = ps.plan(p);
  check('a section for each list the edition has', JSON.stringify(planned.map(function (x) { return x.id; })) === '["previous-speakers","previous-agenda","previous-sponsors","previous-glimpses"]');
  check('their headings', planned.map(function (x) { return x.name; }).join('|') === 'Previous Edition Speakers|Previous Edition Agenda|Previous Edition Sponsors|Previous Edition Glimpses');
  check('nothing planned for an edition with nothing', ps.plan({ speakers: [], sponsors: [], agenda: [], glimpses: [] }).length === 0 && ps.plan(null).length === 0);
  var spk = ps.build('speakers', p, {});
  check('speakers: an auto carousel of the real people', /data-rv-carousel="auto"/.test(spk.html) && /data-rv-carousel-track/.test(spk.html) && /A Name/.test(spk.html) && /cp\/a\.jpg/.test(spk.html) && /Chief Guest/.test(spk.html));
  check('speakers: the edition named above the heading', /Agentic AI Summit 2026/.test(spk.html) && /Previous Edition Speakers/.test(spk.html));
  check('text is escaped', /B &amp; Co/.test(spk.html));
  var spn = ps.build('sponsors', p, {});
  check('sponsors: an auto carousel of logos on white, linked', /data-rv-carousel="auto"/.test(spn.html) && /retail_files\/file_n\.svg/.test(spn.html) && /href="https:\/\/niti\.gov\.in\/"/.test(spn.html) && /background:#ffffff/.test(spn.css));
  var agd = ps.build('agenda', p, {});
  check('agenda: by day, times and speakers', /12 February 2026/.test(agd.html) && /10:00 AM/.test(agd.html) && /11:00 – 11:30 AM|11:00 AM – 11:30 AM/.test(agd.html) && /A Name/.test(agd.html));
  var glm = ps.build('glimpses', p, {});
  check('glimpses: an auto carousel of the photos', /data-rv-carousel="auto"/.test(glm.html) && /glimpses_1_a\.webp/.test(glm.html));
  check('every colour and font is a page variable (themes reach it)', [spk, spn, agd, glm].every(function (b) {
    var css = b.css.replace(/background:#ffffff|#1b1d22|rgba\([^)]*\)/g, '');
    return !/#[0-9a-f]{3,6}\b/i.test(css) && /var\(--rv-text\)/.test(b.css);
  }));
  check('scoped like any other section', [spk, glm].every(function (b) { var sc = scopeSectionCss(b.css, 'previous-speakers', sectionRootInfo(b.html)); return /\[data-rv-section="previous-speakers"\]/.test(sc); }));
  check('motion: headings ease in', /data-rv-reveal/.test(spk.html) && /data-rv-reveal/.test(agd.html));
  check('no script anywhere', [spk, spn, agd, glm].every(function (b) { return !/<script|on[a-z]+=/i.test(b.html); }));
  check('a photo address that is not https is left out', !/http:\/\//.test(ps.build('glimpses', { name: 'x', glimpses: ['http://img/x.jpg', 'javascript:alert(1)'] }, {}).html));

  if (failed) { console.error('et-previous: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('et-previous: all ' + passed + ' checks passed');
});
