// node functions/lib/et-events.test.js — ET's own events on a portal, for the previous-edition picker.
const ee = require('./et-events');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* the roster */
var list = ee.portalList();
check('57 portals, each { slug, name }', list.length === 57 && list.every(function (p) { return p.slug && p.name; }), list.length);
check('sorted by name', list.every(function (p, i) { return !i || list[i - 1].name.localeCompare(p.name, 'en', { sensitivity: 'base' }) <= 0; }));
check('the roster\'s names', ee.PORTALS.cio === 'ETCIO' && ee.PORTALS.brandequity === 'ET BrandEquity');
check('a portal on the roster, and nothing else', ee.isPortal('brandequity') && !ee.isPortal('constructor') && !ee.isPortal('__proto__') && !ee.isPortal('x') && !ee.isPortal('') && !ee.isPortal(null) && !ee.isPortal('brandequity\r\nx: y'));

check('ET\'s "0000-00-00" is no date', ee.compact({ entity_id: 9, title: 'x', ownership_type: 1, event_start_date: '0000-00-00 00:00:00' }, true).start === '');
check('a partner\'s event is not one of ours', ee.compact({ entity_id: 9, title: 'x', ownership_type: 2 }, true) === null && ee.compact({ entity_id: 9, title: 'x' }, true) === null);

/* a fake ET: brandequity has 3 past pages; rows of both ownerships, one event listed twice */
function row(id, own, start, extra) {
  return Object.assign({ entity_id: id, title: 'Event ' + id, ownership_type: own, event_start_date: start, event_end_date: start,
    date_str: 'Day ' + id, link: 'https://brandequity.economictimes.indiatimes.com/e' + id, small_logo: 'http://img.etb2bimg.com/l' + id + '.jpg', speakers_cnt: 3 }, extra || {});
}
var PAGES = {
  1: { active: [row(10, 1, '2026-10-15 09:00:00', { is_live: 1 })], upcoming: [row(11, '1', '2026-12-01 09:00:00', { is_upcoming: 1 }), row(12, 2, '2026-11-01 09:00:00', { is_upcoming: 1 })],
       past: { items: [row(1, 1, '2026-09-01 09:00:00'), row(2, 2, '2026-08-01 09:00:00')], total_cnt: 6, total_pages: 3, cur_page: 1, is_last_page: false } },
  2: { past: { items: [row(3, 1, '2025-01-01 09:00:00'), row(1, 1, '2026-09-01 09:00:00')], total_pages: 3, cur_page: 2, is_last_page: false } },
  3: { past: { items: [row(4, '1', '2026-03-05 09:00:00'), row(5, 1, '', { title: '' })], total_pages: 3, cur_page: 3, is_last_page: true } }
};
var calls, inFlight, maxInFlight, failPages;
function reset() { calls = []; inFlight = 0; maxInFlight = 0; failPages = {}; }
function fakeFetch(url, headers) {
  calls.push(url + ' portal=' + headers.portal);
  var n = +(/page=(\d+)/.exec(url) || [])[1];
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      inFlight--;
      if (failPages[n] > 0) { failPages[n]--; return reject(new Error('socket hang up')); }
      if (failPages[n] === 'null') return resolve(null);
      resolve(PAGES[n] ? { status: true, data: PAGES[n] } : { status: false });
    }, 2);
  });
}

reset();
ee.fetchIpEvents('brandequity', fakeFetch).then(function (events) {
  check('every page read, with the portal as a header', calls.length === 3 && calls.every(function (c) { return / portal=brandequity$/.test(c); }) && calls[0].indexOf(ee.API + '/v1/event-listing?page=1') === 0, calls.join(' | '));
  var ids = events.map(function (e) { return e.id; });
  check('only ET\'s own events (ownership 1, number or text), once each, newest first, what is coming first', JSON.stringify(ids) === '["11","10","1","4","3"]', JSON.stringify(ids));
  var e1 = events.filter(function (e) { return e.id === '1'; })[0], e11 = events[0];
  check('compact rows', JSON.stringify(Object.keys(e1).sort()) === JSON.stringify(['dateLabel', 'end', 'id', 'kind', 'link', 'logo', 'past', 'speakers', 'start', 'title', 'upcoming']));
  check('row fields', e1.title === 'Event 1' && e1.start === '2026-09-01 09:00:00' && e1.dateLabel === 'Day 1' && e1.link === 'https://brandequity.economictimes.indiatimes.com/e1' && e1.logo === 'https://img.etb2bimg.com/l1.jpg' && e1.speakers === 3 && e1.past === true && e1.upcoming === false);
  check('upcoming marked', e11.upcoming === true && e11.past === false);
  check('a complete read is not partial', !events.partial);

  /* bounded concurrency over many pages */
  reset();
  var many = {}; for (var n = 1; n <= 30; n++) many[n] = { past: { items: [row(100 + n, 1, '2024-01-' + String(n).padStart(2, '0') + ' 09:00:00')], total_pages: 30, is_last_page: n === 30 } };
  many[1].active = []; many[1].upcoming = [];
  var saved = PAGES; PAGES = many;
  return ee.fetchIpEvents('brandequity', fakeFetch).then(function (ev) {
    PAGES = saved;
    check('30 pages, 6 at a time at most', calls.length === 30 && maxInFlight <= 6 && maxInFlight >= 2 && ev.length === 30, calls.length + ' calls, ' + maxInFlight + ' at once, ' + ev.length);
    check('past sorted newest first', ev[0].id === '130' && ev[29].id === '101');
  });
}).then(function () {
  /* a page that fails once is asked again; one that keeps failing leaves the list partial */
  reset(); failPages[2] = 1;
  return ee.fetchIpEvents('brandequity', fakeFetch).then(function (ev) {
    check('a page that failed once is asked again', !ev.partial && ev.length === 5 && calls.length === 4, calls.length);
    reset(); failPages[3] = 5;
    return ee.fetchIpEvents('brandequity', fakeFetch);
  }).then(function (ev) {
    check('a page that keeps failing: the rest, marked partial', ev.partial === true && ev.length === 4);
  });
}).then(function () {
  /* page 1 failing is ET being down */
  reset(); failPages[1] = 'null';
  return ee.fetchIpEvents('brandequity', fakeFetch).then(function () { check('ET down rejects', false); }, function (err) { check('ET down: et-down', err.code === 'et-down', err.code); });
}).then(function () {
  reset();
  return ee.fetchIpEvents('nope', fakeFetch).then(function () { check('unknown portal rejects', false); }, function (err) {
    check('unknown portal: refused before ET is asked', err.code === 'unknown-portal' && calls.length === 0);
  });
}).then(function () {
  /* the cache */
  ee.clearCache(); reset();
  var t = 1000; var clock = { now: function () { return t; } };
  var a = ee.listIpEvents('brandequity', fakeFetch, clock), b = ee.listIpEvents('brandequity', fakeFetch, clock);
  check('callers asking at once share one read', a === b);
  return a.then(function () {
    check('one read for both', calls.length === 3, calls.length);
    t += ee.TTL_MS - 1;
    return ee.listIpEvents('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('kept within 6 hours', calls.length === 3 && ev.length === 5);
    t += 2;
    return ee.listIpEvents('brandequity', fakeFetch, clock);
  }).then(function () {
    check('read again after 6 hours', calls.length === 6, calls.length);
    /* a failure is not kept */
    ee.clearCache(); reset(); failPages[1] = 2;
    return ee.listIpEvents('brandequity', fakeFetch, clock).then(function () { check('failure rejects', false); }, function (err) { check('a failed read rejects', err.code === 'et-down'); });
  }).then(function () {
    reset();
    return ee.listIpEvents('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('a failed read is not kept: the next caller asks ET again', calls.length === 3 && ev.length === 5, calls.length);
    /* a partial list is kept only briefly */
    ee.clearCache(); reset(); failPages[3] = 5;
    return ee.listIpEvents('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('partial list returned', ev.partial === true);
    reset(); t += ee.PARTIAL_TTL_MS + 1;
    return ee.listIpEvents('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('a partial list is read again after a few minutes', calls.length === 3 && !ev.partial && ev.length === 5, calls.length);
    reset();
    return ee.listIpEvents('cio', fakeFetch, clock);
  }).then(function () {
    check('one entry a portal', calls.length === 3 && / portal=cio$/.test(calls[0]));
    reset();
    return ee.listIpEvents('cio\nportal: x', fakeFetch, clock).then(function () { check('unknown portal (cached path) rejects', false); }, function (err) {
      check('unknown portal through the cache: refused, nothing asked', err.code === 'unknown-portal' && calls.length === 0);
    });
  });
}).then(function () {
  /* listUpcoming: page 1 only, what is on now or coming, kept; the whole list's entry wins while fresh */
  var t = 1000, clock = { now: function () { return t; } };
  ee.clearCache(); reset();
  return ee.listUpcoming('brandequity', fakeFetch, clock).then(function (ev) {
    check('listUpcoming: one request, page 1 only', calls.length === 1 && /page=1 portal=brandequity$/.test(calls[0]), calls.join(' | '));
    check('listUpcoming: our own events on now or coming, no past ones', ev.map(function (e) { return e.id; }).join(',') === '10,11', ev.map(function (e) { return e.id; }).join(','));
    reset();
    return ee.listUpcoming('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('listUpcoming: kept (no second request)', calls.length === 0 && ev.length === 2);
    reset(); t += ee.TTL_MS + 1;
    return ee.listUpcoming('brandequity', fakeFetch, clock);
  }).then(function () {
    check('listUpcoming: read again after 6 hours', calls.length === 1);
    ee.clearCache(); reset();
    return ee.listIpEvents('brandequity', fakeFetch, clock).then(function () { reset(); return ee.listUpcoming('brandequity', fakeFetch, clock); });
  }).then(function (ev) {
    check('listUpcoming: the whole list, fresh, is used instead of asking', calls.length === 0 && ev.map(function (e) { return e.id; }).join(',') === '11,10', ev.map(function (e) { return e.id; }).join(','));
    ee.clearCache(); reset(); failPages[1] = 1;
    return ee.listUpcoming('brandequity', fakeFetch, clock).then(function () { check('listUpcoming failure rejects', false); }, function (err) { check('listUpcoming: ET down is et-down', err.code === 'et-down'); });
  }).then(function () {
    reset();
    return ee.listUpcoming('brandequity', fakeFetch, clock);
  }).then(function (ev) {
    check('listUpcoming: a failure is not kept', calls.length === 1 && ev.length === 2);
    reset();
    return ee.listUpcoming('nope', fakeFetch, clock).then(function () { check('listUpcoming unknown portal', false); }, function (err) { check('listUpcoming: unknown portal refused, nothing asked', err.code === 'unknown-portal' && calls.length === 0); });
  });
}).then(function () {
  /* awards: their own listing, the MICROSITE id (event_id) as the id, kept apart from the events */
  var aw = function (entity, micro, extra) {
    return Object.assign({ entity_id: entity, event_id: micro, title: 'Award ' + entity, complete_date: '2025-02-27 23:00:00', date_unix: 1740627000,
      date_str: 'Thu, 27 Feb 2025', link: 'https://cio.economictimes.indiatimes.com/a' + entity, small_logo: 'https://img.etb2bimg.com/a' + entity + '.jpg', is_past: 1 }, extra || {});
  };
  var a = ee.compactAward(aw(233, 3056), true);
  check('compactAward: id is the microsite (event_id), awardId the award', a && a.id === '3056' && a.awardId === '233' && a.kind === 'award' && a.past === true, JSON.stringify(a));
  check('compactAward: the ceremony stands for the date', a.start === '2025-02-27 23:00:00' && a.dateLabel === 'Thu, 27 Feb 2025');
  check('compactAward: date_unix when complete_date is missing', ee.compactAward(aw(1, 2, { complete_date: '' }), true).start === '2025-02-27 03:30:00');
  check('compactAward: no microsite, no row', ee.compactAward(aw(1, 0), true) === null && ee.compactAward(aw(1, ''), true) === null && ee.compactAward(aw('', 5), true) === null);
  var AW = {
    1: { active: [], upcoming: [aw(407, 4648, { complete_date: '2026-10-31 18:00:00', is_past: 0, is_upcoming: 1 })],
         past: { items: [aw(233, 3056), aw(9, 0)], total_pages: 2, cur_page: 1, is_last_page: false } },
    2: { past: { items: [aw(157, 2109, { complete_date: '2024-02-22 19:00:00' })], total_pages: 2, cur_page: 2, is_last_page: true } }
  };
  var awCalls = [];
  function awFetch(url, headers) {
    awCalls.push(url + ' portal=' + headers.portal);
    var n = +(/page=(\d+)/.exec(url) || [])[1];
    return Promise.resolve(/award-listing/.test(url) && AW[n] ? { status: true, data: AW[n] } : { status: false });
  }
  ee.clearCache();
  var clock = { now: function () { return 5000; } };
  return ee.listAwards('cio', awFetch, clock).then(function (list) {
    check('listAwards: every page of /v1/award-listing', awCalls.length === 2 && awCalls.every(function (c) { return c.indexOf(ee.API + '/v1/award-listing?page=') === 0 && / portal=cio$/.test(c); }), awCalls.join(' | '));
    check('listAwards: coming first, then the past newest first; no microsite left out', list.map(function (e) { return e.id; }).join(',') === '4648,3056,2109', list.map(function (e) { return e.id; }).join(','));
    check('listAwards: the coming one is marked upcoming', list[0].upcoming === true && list[1].upcoming === false);
    awCalls = [];
    return ee.listAwards('cio', awFetch, clock);
  }).then(function () {
    check('listAwards: kept', awCalls.length === 0);
    reset();
    return ee.listUpcoming('cio', fakeFetch, clock);
  }).then(function () {
    check('listAwards: the footer\'s upcoming list does not use the awards\' entry', calls.length === 1 && /event-listing/.test(calls[0]));
  });
}).then(function () {
  if (failed) { console.error('et-events: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('et-events: all ' + passed + ' checks passed');
}, function (err) { console.error('et-events: crashed — ' + (err && err.stack)); process.exit(1); });
