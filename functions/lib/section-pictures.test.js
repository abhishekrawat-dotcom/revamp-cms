// node functions/lib/section-pictures.test.js — the kind of picture each section gets: people only where the
// section is about people, and the previous edition's own choices read section by section.
const sp = require('./section-pictures');
const gd = require('./gen-design');
const api = require('./api')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---------- 0. a section written without its styles is written again (it would show as bare text) ---------- */
var styled = '.x{padding:clamp(48px,5vw,72px) 0;background:var(--rv-bg)}.x h2{margin:0}';
var unstyled = api.unstyledSectionIds([{ parsed: { sections: [{ id: 'overview', html: '<section></section>', css: styled + styled }, { id: 'who-should-attend', html: '<section></section>', css: '' }] } }],
  { sections: [{ id: 'overview' }, { id: 'who-should-attend' }, { id: 'agenda' }, { id: 'previous-speakers', prebuilt: 'speakers' }] });
check('unstyled or missing sections are named, built ones never', JSON.stringify(unstyled) === '["who-should-attend","agenda"]', unstyled);

var G0 = 'https://img.etb2bimg.com/g0/';
/* ---------- 0c. a picture taken away leaves no empty box ---------- */
check('an empty picture box is caught', api.emptyPictureBox('<div class="why-join-us-media" data-rv-reveal="left"></div>', '.why-join-us-media{height:560px}'));
check('a box painted by its CSS, an overlay, a filled figure are not', !api.emptyPictureBox('<div class="cta-photo"></div>', '.cta-photo{background:url(rvimg://x) center/cover}') &&
  !api.emptyPictureBox('<div class="hero-image-overlay"></div>', '') && !api.emptyPictureBox('<figure class="f-photo"><img src="x"></figure>', ''));
check('a section with an empty picture box is written again', JSON.stringify(api.unstyledSectionIds([{ parsed: { sections: [{ id: 'why-join-us', html: '<div class="wj-media"></div><p>x</p>', css: styled + styled }] } }], { sections: [{ id: 'why-join-us' }] })) === '["why-join-us"]');
var dropped = { id: 'why-join-us', layout: 'Text/picture split: the picture on the left', image: 'a hall' };
api.dropPicture(dropped);
var plain = { id: 'themes', layout: 'A list of six themes', image: 'x' };
api.dropPicture(plain);
check('a picture taken away: the layout is told, one without a picture is left as it was', !dropped.image && /NO PICTURE/.test(dropped.layout) && plain.layout === 'A list of six themes');
var unread = [{ id: 'overview' }];
api.newStandardPictures(unread, [{ url: G0 + 'a.jpg', kind: 'unknown', wide: true }], {});
check('a photo that could not be looked at is never placed', !unread[0].imageUrl);

/* ---------- 0a. a lock-up's picture placed small by <use transform> is a corner of it, not the lock-up ---------- */
var PNG = 'data:image/png;base64,iVBORw0KGgo=';
var drawn = '<path d="M0 0h10v10z"/>';
check('a picture placed at 8% by <use> is not the main picture', api.embedsMainPicture('<svg viewBox="0 0 196 203">' + drawn + '<defs><image width="995" height="426" id="img1" href="' + PNG + '"/></defs><use href="#img1" transform="matrix(.08,0,0,.081,115,155)"/></svg>') === false);
check('a picture drawn at full size still is', api.embedsMainPicture('<svg viewBox="0 0 196 203">' + drawn + '<image width="196" height="203" href="' + PNG + '"/></svg>') === true);
check('a picture placed by a rotation is not known: taken as the main picture', api.embedsMainPicture('<svg viewBox="0 0 196 203">' + drawn + '<defs><image width="50" height="50" id="a" href="' + PNG + '"/></defs><use href="#a" transform="rotate(30)"/></svg>') === true);

/* ---------- 0b. the previous edition's real photos: never a performance, a close-up or a screen full of words ---------- */
var G = 'https://img.etb2bimg.com/g/';
var secs = [{ id: 'overview' }, { id: 'who-should-attend' }, { id: 'closing-cta' }];
api.newStandardPictures(secs, [
  { url: G + 'singer.jpg', kind: 'performance', wide: true }, { url: G + 'name-screen.jpg', kind: 'panel', wide: true, textHeavy: true },
  { url: G + 'face.jpg', kind: 'portrait', wide: false }, { url: G + 'hall.jpg', kind: 'hall', wide: true },
  { url: G + 'stage.jpg', kind: 'stage', wide: true }, { url: G + 'mingle.jpg', kind: 'networking', wide: true }], {});
var shown = secs.map(function (x) { return x.imageUrl || ''; });
check('real photos: no performance, close-up or text-filled shot; none twice', shown.every(function (u) { return u && !/singer|name-screen|face/.test(u); }) && new Set(shown).size === 3, shown);

/* ---------- 1. a previous edition's content pictures, each under its section ---------- */
var IMG = 'https://img.etb2bimg.com/files/';
var page = '<header><img src="' + IMG + 'site-logo.png"></header><nav><img src="' + IMG + 'menu.jpg"></nav>' +
  '<h2>Sponsors</h2><img src="' + IMG + 'acme.png">' +
  '<h2>Overview</h2><p>…</p><img src="' + IMG + 'overview-hall.jpg" alt="the hall">' +
  '<!-- <h2>Commented Out</h2> -->' +
  '<article><div class="image"><img src="' + IMG + 'tabulator.png"></div><div class="desc"><h2>Scrutiny by Expert Tabulator</h2><ul><li>…</li></ul></div></article>' +
  '<h3>Supporting Partners</h3><a href="https://x.org"><span class="logo-skeleton"> <img data-src="' + IMG + 'ernet.png" alt="ERNET"></span></a><img src="' + IMG + 'partner-2.jpg">' +
  '<h2>Video</h2><div><a href="https://cio.example.com/slikeplayer.html?videoid=1" reftype="video"><figure><img src="' + IMG + 'talk-thumb.jpg"></figure><h2 class="title">Editors Welcome Address</h2></a></div>' +
  '<h2>Why Attend</h2><img src="' + IMG + 'icons/tick.svg"><img src="' + IMG + 'why-1.jpg" width="80"><img src="' + IMG + 'why-2.webp"><img src="' + IMG + 'why-3.jpg"><img src="' + IMG + 'why-4.jpg">' +
  '<h2>Grand Jury</h2><img src="' + IMG + 'juror.jpg">' +
  '<h2>Banner</h2><img src="' + IMG + 'banner.jpg?x=1">' +
  '<footer><h2>About ETCIO</h2><img src="' + IMG + 'footer.jpg"></footer>' +
  '<h2>Some other</h2><h2>And another</h2>';
var found = sp.picturesIn(page, 'https://cio.economictimes.indiatimes.com/x', { skip: [IMG + 'banner.jpg'] });
var by = found.map(function (p) { return p.heading + ' <- ' + p.url.replace(IMG, ''); });
check('content pictures under their sections', by.indexOf('Overview <- overview-hall.jpg') !== -1 && by.indexOf('Why Attend <- why-2.webp') !== -1, by);
check('a picture just before its heading, in its card, is that heading\'s', by.indexOf('Scrutiny by Expert Tabulator <- tabulator.png') !== -1, by);
check('chrome, sponsors, partners in a logo block, juries, video thumbnails, icons, small pictures and the banner are left out',
  !found.some(function (p) { return /site-logo|menu|acme|ernet|partner-2|juror|talk-thumb|tick|why-1|banner|footer/.test(p.url); }), by);
check('at most two a section', found.filter(function (p) { return p.heading === 'Why Attend'; }).length === 2, by);
check('a commented-out heading is no section', !found.some(function (p) { return p.heading === 'Commented Out'; }), by);
check('at most six in all', sp.picturesIn(new Array(12).join('<h2>S{n}</h2><img src="' + IMG + 'p{n}.jpg">').replace(/\{n\}/g, function () { return Math.random().toString(36).slice(2); }) + '<h2>a</h2><h2>b</h2><h2>c</h2>', 'https://x.com/').length === 6);

/* ---------- 2. one reading of them all; what is none of the kinds is dropped ---------- */
var withImages = found.map(function (p) { return Object.assign({}, p, { image: { mimeType: 'image/jpeg', data: 'AA==' } }); });
var asked = null;
sp.classify(withImages, function (prompt, schema, images) {
  asked = { prompt: prompt, images: images.length, kinds: schema.properties.pictures.items.properties.kind.enum };
  return Promise.resolve({ parsed: { pictures: [{ n: 1, kind: 'place', about: 'A conference hall.' }, { n: 2, kind: 'graphic', about: 'Line art.' }, { n: 3, kind: 'other', about: 'A logo.' }, { n: 9, kind: 'people', about: 'x' }] } });
}).then(function (kinds) {
  check('one reading, every picture in it, each named by its section', asked && asked.images === withImages.length && /1\. in the section headed "Overview"/.test(asked.prompt) && asked.kinds.join() === 'people,place,subject,graphic,other', asked);
  check('the kinds come back by section; "other" and unknown numbers dropped', kinds.length === 2 && kinds[0].heading === found[0].heading && kinds[0].kind === 'place' && kinds[1].kind === 'graphic', kinds);
  return sp.classify(withImages, function () { return Promise.reject(new Error('down')); });
}).then(function (kinds) {
  check('a reading that fails: nothing known, nothing thrown', Array.isArray(kinds) && !kinds.length);
  return sp.classify([], function () { throw new Error('never asked'); });
}).then(function (kinds) {
  check('no pictures: no reading', kinds.length === 0);

  /* ---------- 3. the picture prompt follows the kind ---------- */
  var design = { mode: 'light', themeColor: '#123456', imageStyle: 'editorial' };
  var people = gd.imagePrompt('delegates over coffee', design, { kind: 'people' });
  var place = gd.imagePrompt('the venue', design, { kind: 'place' });
  var subject = gd.imagePrompt('a battery module', design, { kind: 'subject', context: 'About EV batteries.' });
  var graphic = gd.imagePrompt('line art of a car', design, { kind: 'graphic', context: 'Networking with decision makers.' });
  check('people: the people rules', /PEOPLE: the people are Indian/.test(people) && !/NO PEOPLE/.test(people));
  check('place and subject: photographs with no people', /photograph of a PLACE/.test(place) && /NO PEOPLE/.test(place) && !/PEOPLE: the people are Indian/.test(place) &&
    /photograph of the SUBJECT/.test(subject) && /NO PEOPLE/.test(subject) && /About EV batteries/.test(subject));
  check('graphic: an illustration, nothing labelled, and not told the section\'s words (they came back as labels)',
    /graphic illustration/.test(graphic) && /nothing in it is labelled/.test(graphic) && /no labels, captions/.test(graphic) && !/Networking/.test(graphic) && !/PEOPLE: the people/.test(graphic));
  check('no kind given: as before (people)', /PEOPLE: the people are Indian/.test(gd.imagePrompt('x', design, {})));
  check('the hero is a key visual whatever the kind: no people', /KEY VISUAL/.test(gd.imagePrompt('a hall', design, { hero: true, kind: 'people' })) && !/PEOPLE: the people are Indian/.test(gd.imagePrompt('a hall', design, { hero: true, kind: 'people' })));

  /* ---------- 4. the plan: at most two people pictures, never side by side ---------- */
  function sec(id, kind, purpose) { return { id: id, kind: 'custom', purpose: purpose || id, layout: 'split', image: 'a picture for ' + id, imageKind: kind }; }
  /* the people cap on its own (the plan keeps at most MAX_SECTION_IMAGES pictures before it) */
  var out = api.fewerPeoplePictures([sec('overview', 'people'), sec('themes', 'people'), sec('why-attend', 'people'), sec('networking', 'people'),
    sec('venue', 'place'), sec('who-should-attend', 'people'), sec('numbers', 'subject')]);
  var kinds = {}; out.forEach(function (s) { kinds[s.id] = s.imageKind; });
  check('the sections about people keep theirs; the rest become the subject', kinds.networking === 'people' && kinds['who-should-attend'] === 'people' &&
    kinds.overview === 'subject' && kinds.themes === 'subject' && kinds['why-attend'] === 'subject' && kinds.venue === 'place', kinds);
  check('a section turned away from people gets a scene without them', /with no people/.test(out.filter(function (s) { return s.id === 'themes'; })[0].image));
  check('an unknown kind: the subject', kinds.numbers === 'subject', kinds);
  out = api.fewerPeoplePictures([sec('networking', 'people'), sec('who-attends', 'people'), sec('x', 'graphic')]);
  check('never two people pictures side by side', out[0].imageKind === 'people' && out[1].imageKind === 'subject', out.map(function (s) { return s.imageKind; }));
  check('the plan asks for a kind for every section', api.DESIGN_PLAN_SCHEMA.properties.sections.items.required.indexOf('imageKind') !== -1);

  /* ---------- 5. the plan prompt carries the previous edition's choices ---------- */
  var prompt = api.buildDesignPlanPrompt({ eventMeta: { name: 'X Summit 2027' }, sources: [{ type: 'previousEdition', url: 'https://x', extractedSections: [],
    sectionPictures: [{ heading: 'Overview', kind: 'place', about: 'The venue at dusk.' }] }], themeInfo: {}, artDirection: gd.ART_DIRECTIONS[0], siteMode: 'standard' });
  check('the previous edition\'s pictures, by section and kind, are in the plan prompt', /THE PICTURES THE PREVIOUS EDITION PUT IN ITS SECTIONS/.test(prompt) && /"Overview": place — The venue at dusk\./.test(prompt));
  check('the plan prompt no longer puts people in every picture', !/People belong in them/.test(prompt) && /PICTURE KINDS/.test(prompt) && /at most 2 sections with "people" pictures/.test(prompt));
}).then(function () {
  if (failed) { console.error('section-pictures: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('section-pictures: all ' + passed + ' checks passed');
}, function (err) { console.error('section-pictures: crashed — ' + (err && err.stack)); process.exit(1); });
