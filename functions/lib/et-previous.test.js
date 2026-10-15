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

/* reading. The pages below are cut down from real ET microsites (October 2026), keeping the places each names
   ids in and the markup of its gallery; the API answers are modelled on what ET's API gave for them. */
var IMGF = 'https://img.etb2bimg.com/files/retail_files/';
var DM = 'digital_month_id';

/* brandequity…/brand-world-summit-south2025: no digital_month_id at all — its id is siteId, and the
   speakers' widget names it as entity_id and company_id; a menu names a template's id (297); its gallery is a
   marquee of links whose pictures load late (data-original), file names with brackets */
var pageBws2025 = "<script>var siteId = '3391';\nvar event_header_theme = 'light';</script>" +
  '<ul class="event_level_primary_navigation" id="level2_menu_on_scroll_297"></ul>' +
  '<script>speakerSettingsAjaxCall: {"id":135346,"activity_id":1,"entity_id":3391,"section_id":3}, {"company_id":"3391","isUpcache":0}</script>' +
  '<script>var f = "<input type=\\u0022text\\u0022 name=\\u0022siteId\\u0022 id=\\u0022siteId\\u0022 value=\\u00223391\\u0022 style=\\u0022display:none;\\u0022>";</script>' +
  '<section id="glimpses_event" class=" mb-medium bgCover_1 glimpses-carousel glimpses-marquee"><div class="page_hdng4"><h2>Glimpses from Past Edition</h2></div>' +
  '<div class="glimpses-skeleton" data-glimpses-skeleton><div class="glimpses-skel-card" style="aspect-ratio:373/249;"></div></div>' +
  '<div class="glimpses-real" data-glimpses-real style="display:none;"><div class="marquee-track slider_content">' +
  '<a class="images__link" href="' + IMGF + 'file_17587121722152_WhatsApp_Image_2025_09_24_at_16.37.49.jpeg"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-original="' + IMGF + 'file_17587121722152_WhatsApp_Image_2025_09_24_at_16.37.49.jpeg" alt=""></a>' +
  '<a class="images__link" href="' + IMGF + 'file_17587121637184_WhatsApp_Image_2025_09_24_at_16.37.49_(1).jpeg"><img src="data:image/gif;base64,R0lGOD" data-original="' + IMGF + 'file_17587121637184_WhatsApp_Image_2025_09_24_at_16.37.49_(1).jpeg" alt=""></a>' +
  '</div></div></section>' +
  '<section id="contact-us" class="contacts"><img src="https://img.etb2bimg.com/files/cp/upload-0.0.1-photo.jpg"></section>';

/* telecom…/5g-congress2025: the carousel variant — numbered sections, slides with plain src */
var pageCarousel = '<section id="glimpses_event_0" class=" mb-medium bgCover_1 glimpses-carousel glimpses_event_id" data-thumb-w="400" data-thumb-h="500">' +
  '<div class="glimpses_carousel_slider" data-init="false"><div class="glimpse-slide"><img src="' + IMGF + 'data_file_1742989896_35621.jpg" alt=""></div>' +
  '<div class="glimpse-slide"><img src="' + IMGF + 'file_1743067695_A15A3701.JPG" alt=""></div></div></section>' +
  '<section id="glimpses_event_1" class="glimpses-carousel glimpses_event_id"><div class="glimpse-slide"><img src="' + IMGF + 'file_1743067720_A15A3756.jpg"></div></section>';
/* a custom section of photos (brandequity…/brand-world-summit-south), addresses with a version */
var pageCustom = '<section id="glimpsesFromTheRoom" class="mb-medium bgCover_1 glimpsesFromTheRoom" style="background: #102820;"><h2>Moments That Mattered</h2>' +
  '<img src="' + IMGF + 'custom_section_img_17907571032899_39448.png?v=1790756406285"></section>';
/* the justified grid (auto…/ev-conclave2025), beside a speakers' "gallery" that is not one of photos */
var pageJustified = '<div class="speakers-gallery"><img src="https://img.etb2bimg.com/files/cp/data_file_1_speaker.jpg"></div>' +
  '<div id="justified" class="justified-gallery"><a href="' + IMGF + 'file_1752737914_GAU_0181.JPG" class="images__link"><img src="' + IMGF + 'file_1752737914_GAU_0181.JPG"></a></div>';

check('the page\'s own id, wherever it is named; a menu\'s is not a candidate', ep.idsIn(pageBws2025).join() === '3391', JSON.stringify(ep.candidatesIn(pageBws2025)));
check('where it was named', JSON.stringify(ep.candidatesIn(pageBws2025)[0].from) === '["siteId","entity_id","company_id"]', JSON.stringify(ep.candidatesIn(pageBws2025)[0].from));
check('siteId outranks a more often named digital_month_id', ep.idsIn("var siteId = '4865';" + '{"' + DM + '":"3858"}{"' + DM + '":"3858"}{"entity_id":"3858"}').join() === '4865,3858');
check('marquee: the photos once each, brackets kept, no placeholders, nothing from other sections', JSON.stringify(ep.glimpsesIn(pageBws2025)) === JSON.stringify([IMGF + 'file_17587121722152_WhatsApp_Image_2025_09_24_at_16.37.49.jpeg', IMGF + 'file_17587121637184_WhatsApp_Image_2025_09_24_at_16.37.49_(1).jpeg']), JSON.stringify(ep.glimpsesIn(pageBws2025)));
check('carousel: every numbered section\'s slides', ep.glimpsesIn(pageCarousel).length === 3 && /A15A3701\.JPG$/.test(ep.glimpsesIn(pageCarousel)[1]));
check('a custom photo section, without the version', JSON.stringify(ep.glimpsesIn(pageCustom)) === JSON.stringify([IMGF + 'custom_section_img_17907571032899_39448.png']));
check('justified grid; a speakers\' gallery is not one of photos', JSON.stringify(ep.glimpsesIn(pageJustified)) === JSON.stringify([IMGF + 'file_1752737914_GAU_0181.JPG']), JSON.stringify(ep.glimpsesIn(pageJustified)));
check('no gallery: nothing', ep.glimpsesIn('<section id="speakers"><img src="https://img.etb2bimg.com/files/cp/a.jpg"></section>').length === 0);

check('slug of a microsite address', ep.slugOf('https://cio.economictimes.indiatimes.com/Annual-Conclave/agenda?utm=x') === 'annual-conclave' && ep.slugOf('https://retail.economictimes.indiatimes.com/microsite/test') === 'test' && ep.slugOf('https://x.economictimes.indiatimes.com/') === '');
var at = 'https://enterpriseai.economictimes.indiatimes.com/agentic-ai-summit';
check('own: its url_text is the page', ep.relationOf({ portal: 'enterpriseai', url_text: 'agentic-ai-summit', branding_url: at }, at) === 'own');
check('edition: the slug with a year', ep.relationOf({ portal: 'enterpriseai', url_text: 'agentic-ai-summit2026', branding_url: at + '2026' }, at) === 'edition');
check('edition: its address is this page', ep.relationOf({ portal: 'cio', url_text: 'annual-conclave-2026', branding_url: 'https://cio.economictimes.indiatimes.com/annual-conclave' }, 'https://cio.economictimes.indiatimes.com/annual-conclave') === 'edition');
check('another portal\'s event is nothing to it, however the API was asked', ep.relationOf({ portal: 'supplychain', url_text: 'brand-world-summit-south2025' }, 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south') === '' &&
  ep.relationOf({ url_text: 'brand-world-summit-south2025', branding_url: 'https://supplychain.economictimes.indiatimes.com/brand-world-summit-south2025' }, 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south') === '');
check('a sister event on the same portal is nothing to it', ep.relationOf({ portal: 'health', url_text: 'nutrition-wellness-awards2025', branding_url: 'https://health.economictimes.indiatimes.com/nutrition-wellness-awards2025' }, 'https://health.economictimes.indiatimes.com/nutrition-wellness-conclave2025') === '' &&
  ep.relationOf({ portal: 'hr', url_text: 'future-forward-kolkata-chapter' }, 'https://hr.economictimes.indiatimes.com/future-forward') === '');
check('the gallery from the image list: shown photos of named groups, once each', JSON.stringify(ep.photosOf([
  { status: 1, img_name: 'glimpses_1.webp', group: { group_name: 'Previous Edition Glimpses' } }, { status: 0, img_name: 'hidden.jpg', group: { group_name: 'G' } },
  { status: 1, img_name: 'loose.jpg', group: null }, { status: '1', img_name: 'a_(1).jpeg', group: { group_name: 'Gallery' } }, { status: 1, img_name: 'glimpses_1.webp', group: { group_name: 'Glimpses' } }
])) === JSON.stringify([IMGF + 'glimpses_1.webp', IMGF + 'a_(1).jpeg']));

/* ET's API, as a table: { portal asked: { id: { details, speaker, sponsor, agenda, image } } } — an id the API knows
   answers whatever portal it is asked with, as the real one does */
function api(table) {
  var calls = [];
  function fetchJson(url, headers) {
    calls.push(url + ' portal=' + headers.portal);
    var id = (/(?:entity_id|digital_month_id)=(\d+)/.exec(url) || [])[1], rec = table[id];
    var list = /\/activity\/(speaker|sponsor|agenda|image)\/list/.exec(url);
    if (list) return Promise.resolve({ status: true, data: { is_last_page: true, items: rec && rec[list[1]] || [] } });
    if (/\/microsite\/details/.test(url)) return Promise.resolve(rec ? { status: true, data: rec.details } : { status: false, message: 'not found' });
    return Promise.reject(new Error('unexpected ' + url));
  }
  return { fetchJson: fetchJson, calls: calls };
}
function edition(portal, id, slug, start, extra) {
  return Object.assign({ details: { company_id: +id, company_name: extra && extra.name || slug, portal: portal, url_text: slug, branding_url: 'https://' + portal + '.economictimes.indiatimes.com/' + (extra && extra.at || slug), event_start_date: start } }, extra && extra.records || {});
}
var NOW = Date.UTC(2026, 9, 15);
var someSpeakers = raw.speakers, someSponsors = raw.sponsors;
var bwsApi = api({
  3391: edition('brandequity', 3391, 'brand-world-summit-south2025', '2025-12-05 08:00:00', { name: 'Brand World Summit South - 2025', records: { speaker: someSpeakers, sponsor: someSponsors, agenda: raw.agenda,
    image: [{ status: 1, img_name: 'file_17587121722152_WhatsApp_Image_2025_09_24_at_16.37.49.jpeg', group: { group_name: 'Glimpses from Past Edition' } }, { status: 0, img_name: 'x.jpeg', group: { group_name: 'Glimpses from Past Edition' } }] } }),
  297: edition('retail', 297, 'test', '0000-00-00 00:00:00', { at: 'microsite/test' })
});
var bwsUrl = 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025';

var reads = [
  function () {
    return ep.readPrevious(bwsUrl, pageBws2025, { fetchJson: bwsApi.fetchJson, now: NOW }).then(function (r) {
      check('a page naming itself only as siteId / entity_id / company_id is read', r && r.id === '3391' && r.name === 'Brand World Summit South - 2025' && r.speakers.length === 2 && r.sponsors.length === 1 && r.agenda.length === 2, JSON.stringify(r && { id: r.id, s: r.speakers.length }));
      check('its glimpses from the image list (the shown ones)', r && JSON.stringify(r.glimpses) === JSON.stringify([IMGF + 'file_17587121722152_WhatsApp_Image_2025_09_24_at_16.37.49.jpeg']), r && JSON.stringify(r.glimpses));
      check('the portal goes with every request', bwsApi.calls.length > 0 && bwsApi.calls.every(function (c) { return / portal=brandequity$/.test(c); }));
      check('a menu\'s stray id is not even asked about', !bwsApi.calls.some(function (c) { return /=297\b/.test(c); }));
    });
  },
  function () {
    /* no image list: the page's own gallery */
    var a = api({ 3391: edition('brandequity', 3391, 'brand-world-summit-south2025', '2025-12-05 08:00:00', { records: { speaker: someSpeakers } }) });
    return ep.readPrevious(bwsUrl, pageBws2025, { fetchJson: a.fetchJson, now: NOW }).then(function (r) {
      check('no image list: the photos the page shows', r && r.glimpses.length === 2 && /_\(1\)\.jpeg$/.test(r.glimpses[1]), r && JSON.stringify(r.glimpses));
    });
  },
  function () {
    /* enterpriseai…/agentic-ai-summit: the evergreen address is the next edition's (no records yet); it names
       the last one as digital_month_id — and a form copied from another portal's event names that one, which
       has more records than either */
    var html = "var siteId = '4865';" + '{"' + DM + '":"4865"}{"' + DM + '":"3858"}{"entity_id":"3858"}{"' + DM + '":"4185"}' + pageCarousel;
    var a = api({
      4865: edition('enterpriseai', 4865, 'agentic-ai-summit', '2026-12-09 07:00:00', { name: 'Agentic Summit 2026' }),
      3858: edition('enterpriseai', 3858, 'agentic-ai-summit2026', '2026-02-12 08:00:00', { name: 'Agentic AI Summit 2026 Edition 1', records: { speaker: someSpeakers, sponsor: someSponsors } }),
      4185: edition('supplychain', 4185, 'supply-chain-logistics-conclave', '2026-08-20 09:00:00', { records: { speaker: someSpeakers.concat(someSpeakers, someSpeakers), sponsor: someSponsors.concat(someSponsors) } })
    });
    return ep.readPrevious(at, html, { fetchJson: a.fetchJson, now: NOW }).then(function (r) {
      check('evergreen address: the last edition it names is read', r && r.id === '3858' && r.name === 'Agentic AI Summit 2026' && r.speakers.length === 2, r && r.id);
      check('another portal\'s event named on the page is never read, though it has more records', r && r.id !== '4185' && !a.calls.some(function (c) { return /activity\/.*entity_id=4185/.test(c); }));
      check('no image list: the page\'s carousel photos', r && r.glimpses.length === 3);
    });
  },
  function () {
    /* brandequity…/brand-world-summit-south: the next edition, with only a sister portal's event named beside it */
    var html = "var siteId = '4708';" + '{"' + DM + '":"4708"}{"' + DM + '":"4185"}' + pageCustom;
    var a = api({
      4708: edition('brandequity', 4708, 'brand-world-summit-south', '2026-11-26 09:00:00', { name: 'Brand World Summit South 2026' }),
      4185: edition('supplychain', 4185, 'supply-chain-logistics-conclave', '2026-08-20 09:00:00', { records: { speaker: someSpeakers } })
    });
    return ep.readPrevious('https://brandequity.economictimes.indiatimes.com/brand-world-summit-south', html, { fetchJson: a.fetchJson, now: NOW }).then(function (r) {
      check('nothing of its own yet: the photos it shows, under no edition\'s name', r && r.id === '' && r.name === '' && r.speakers.length === 0 && r.glimpses.length === 1, JSON.stringify(r));
    });
  },
  function () {
    /* hr…/future-forward: the next edition has announced speakers; the last one shares its address */
    var url = 'https://hr.economictimes.indiatimes.com/future-forward';
    var a = api({
      4149: edition('hr', 4149, 'future-forward', '2026-10-28 09:00:00', { records: { speaker: someSpeakers } }),
      3409: edition('hr', 3409, 'future-forward-2025', '2025-11-20 08:00:00', { at: 'future-forward', name: 'ETHRWorld Future Forward 2025', records: { speaker: someSpeakers.slice(0, 1), sponsor: someSponsors, agenda: raw.agenda } })
    });
    return ep.readPrevious(url, "var siteId = '4149';" + '{"' + DM + '":"3409"}', { fetchJson: a.fetchJson, now: NOW }).then(function (r) {
      check('an edition still to come is not the previous one, though it has speakers', r && r.id === '3409' && r.name === 'ETHRWorld Future Forward 2025' && r.agenda.length === 2, r && r.id);
      return ep.readPrevious('https://cio.economictimes.indiatimes.com/tech-500-summit', "var siteId = '4560';", { fetchJson: api({ 4560: edition('cio', 4560, 'tech-500-summit', '2026-11-27 08:00:00', { records: { speaker: someSpeakers } }) }).fetchJson, now: NOW });
    }).then(function (r) {
      check('only an edition still to come: nothing', r === null);
    });
  },
  function () {
    /* health…/nutrition-wellness-conclave2025 names the awards held beside it */
    var url = 'https://health.economictimes.indiatimes.com/nutrition-wellness-conclave2025';
    var html = "var siteId = '3403';" + '<ul id="level2_menu_section_3406"></ul>{"entity_id":3406}';
    var conclave = edition('health', 3403, 'nutrition-wellness-conclave2025', '2025-11-27 09:00:00', { records: { speaker: someSpeakers.slice(0, 1) } });
    var awards = edition('health', 3406, 'nutrition-wellness-awards2025', '2025-11-27 18:00:00', { records: { speaker: someSpeakers, sponsor: someSponsors } });
    return ep.readPrevious(url, html, { fetchJson: api({ 3403: conclave, 3406: awards }).fetchJson, now: NOW }).then(function (r) {
      check('a sister event on the same portal is never read, though it has more records', r && r.id === '3403' && r.speakers.length === 1, r && r.id);
      return ep.readPrevious(url, html, { fetchJson: api({ 3403: edition('health', 3403, 'nutrition-wellness-conclave2025', '2025-11-27 09:00:00'), 3406: awards }).fetchJson, now: NOW });
    }).then(function (r) {
      check('…not even when the page has nothing of its own', r === null);
    });
  },
  function () {
    /* auto…/auto-tech-summit: the next edition, undated, no records — but the page shows the last one's photos */
    var a = api({ 4478: edition('auto', 4478, 'auto-tech-summit', '0000-00-00 00:00:00', { name: 'ETAuto Tech Summit 2027' }) });
    return ep.readPrevious('https://auto.economictimes.indiatimes.com/auto-tech-summit', "var siteId = '4478';" + pageJustified, { fetchJson: a.fetchJson, now: NOW }).then(function (r) {
      check('an undated page with no records: its photos, not its name', r && r.name === '' && r.glimpses.length === 1, JSON.stringify(r));
    });
  },
  function () {
    /* the details not answering: the id the page calls its own is still read; others are not */
    var down = api({ 3391: { speaker: someSpeakers } });
    return ep.readPrevious(bwsUrl, "var siteId = '3391';" + '{"' + DM + '":"3858"}', { fetchJson: down.fetchJson, now: NOW }).then(function (r) {
      check('details unknown: the page\'s own id is still trusted', r && r.id === '3391' && r.speakers.length === 2);
      return ep.readPrevious(bwsUrl, '{"' + DM + '":"3391"}', { fetchJson: down.fetchJson, now: NOW });
    }).then(function (r) {
      check('details unknown: an id the page does not call its own is not', r === null);
    });
  },
  function () {
    return ep.readPrevious('https://example.com/x', page, { fetchJson: bwsApi.fetchJson }).then(function (r) {
      check('not an ET microsite: nothing read', r === null);
      return ep.readPrevious('https://cio.economictimes.indiatimes.com/x', "var siteId = '1';", { fetchJson: function () { return Promise.reject(new Error('down')); } });
    }).then(function (r) {
      check('the API down: nothing, and no failure', r === null);
    });
  }
];
reads.reduce(function (p, step) { return p.then(step); }, Promise.resolve()).then(function () {

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
