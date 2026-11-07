/* node functions/lib/site-checks-browser.test.js — the buttons of a live page, in a real Chrome (UX-141, UX-145):
     1. a page as the live pass leaves it (lib/site-checks.js repair): the header's "Register Now" opens the form;
        "Join as Partner" opens it as "Partner with us", with its line above the questions, and a response sent
        from it is recorded with the source "partner-enquiry", and its thank-you says "Thank you", never registered,
        with no calendar, and "Send another response" brings back "Partner with us" (UX-145 with UX-150);
     2. the award ceremony's button opens "Request an invitation", saying there is no online payment;
     3. a page the pass has not seen (templates/_shared/rv-forms.js on its own): a "Register Now" that leads to a
        hidden section opens the form all the same, and one that leads to a section on view still goes there.
   It needs Chrome and puppeteer-core (CHROME_PATH / RV_PUPPETEER, else the usual places); without them it says so
   and passes. No network, no Firebase: a small local server answers the page, the runtime and POST /api/register.
   Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http');
var ROOT = path.join(__dirname, '..', '..');
var SC = require('./site-checks');
var FORMS_LIB = require('./forms');
var kit = require('./api')._testHooks.TOKEN_KIT;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 400) : '')); }
function finish(code) {
  if (failures.length) { console.error('site-checks-browser: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('site-checks-browser: all ' + checks + ' checks passed');
  process.exit(code || 0);
}

function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
var puppeteer = driver();
if (!puppeteer || !CHROME) { console.log('site-checks-browser: skipped — no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER)'); process.exit(0); }

var FORMS = { open: true, waitlist: false, defaultFormId: 'register', forms: [{
  id: 'register', name: 'Register now', rev: 1, open: true, counts: true,
  fields: [{ id: 'name', type: 'text', label: 'Full name', required: true }, { id: 'email', type: 'email', label: 'Official email', required: true }]
}] };
function pageHtml(body) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title>' +
    /* what rv-live.css hides on a live page */
    '<style>[data-rv-empty],[data-rv-nav-empty]{display:none!important}section{min-height:900px}</style></head>' +
    '<body id="gen" data-rv-template-id="gen-t" data-rv-event-id="qa-t" class="microsite rv-generated">' + body +
    '<script id="rv-site-config" type="application/json">{"eventId":"qa-t","mode":"preview"}</script>' +
    '<script id="rv-forms" type="application/json">' + JSON.stringify(FORMS) + '</script>' +
    '<script src="/templates/_shared/rv-forms.js"></script></body></html>';
}
var BODY =
  '<header data-rv-section="nav" id="nav"><a href="#about" class="nav-btn">Register Now</a><a href="#overview" class="nav-link">Overview</a></header>' +
  '<section data-rv-section="hero" id="hero"><a class="hero-btn hero-btn-2" href="#contact-us">Join as Partner</a></section>' +
  '<section data-rv-section="overview" id="overview"><a class="btn" id="to-hidden" href="#contact-us">Register Now</a><a class="btn" id="to-shown" href="#about">Register Now</a></section>' +
  '<section data-rv-section="awards-night" id="awards-night"><a class="aw-cer-btn" href="#hero" data-register-cta>Get Tickets</a></section>' +
  '<section data-rv-section="contact-us" id="contact-us" data-rv-empty="contact"><h2>Contact</h2></section>' +
  '<section data-rv-section="about" id="about"><h2>About</h2></section>';
var REPAIRED = pageHtml(SC.repair(pageHtml(BODY), kit, {}).html.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<script id="rv-site-config"[\s\S]*$/, ''));
var RAW = pageHtml(BODY);

var posted = [];
var server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/api/register') {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try { posted.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { posted.push(null); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      /* answered as lib/api-audience.js handleRegister answers: a request comes back pending, with its kind */
      var sent = posted[posted.length - 1] || {}, enquiry = FORMS_LIB.enquiryOf(sent.source);
      var event = { name: 'QA Summit 2026', when: '5th December, 2026', where: 'Mumbai', calendar: '/api/public/calendar?eventId=qa-t' };
      res.end(JSON.stringify(enquiry
        ? { ok: true, preview: true, id: null, status: 'pending', formId: 'register', enquiry: enquiry.kind, message: enquiry.done, event: event }
        : { ok: true, preview: true, id: null, status: 'confirmed', formId: 'register', message: 'You are registered.', event: event }));
    });
    return;
  }
  if (req.url === '/templates/_shared/rv-forms.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'rv-forms.js')));
  }
  var html = req.url.indexOf('/raw') === 0 ? RAW : req.url.indexOf('/repaired') === 0 ? REPAIRED : null;
  if (!html) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

server.listen(0, '127.0.0.1', function () {
  var base = 'http://127.0.0.1:' + server.address().port;
  var browser;
  puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] }).then(function (b) {
    browser = b;
    return browser.newPage();
  }).then(function (page) {
    var errors = [];
    page.on('pageerror', function (e) { errors.push(String(e && e.message || e)); });
    function modal() {
      return page.evaluate(function () {
        var m = document.querySelector('.rv-form-modal');
        if (!m) return null;
        var t = m.querySelector('.rv-form-modal-title'), intro = m.querySelector('.rv-form-intro');
        return { title: t ? t.textContent : '', intro: intro ? intro.textContent : '' };
      });
    }
    function closeModal() { return page.keyboard.press('Escape').then(function () { return sleep(150); }); }
    function click(sel) { return page.click(sel).then(function () { return sleep(400); }); }

    return page.goto(base + '/repaired', { waitUntil: 'load' }).then(function () { return sleep(300); })
      /* 1. the header's Register Now */
      .then(function () { return click('header .nav-btn'); }).then(modal).then(function (m) {
        ok(m && /provide us with your Information/.test(m.title) && !m.intro, 'the header\'s "Register Now" (it led to the About section) opens the registration form', m);
      }).then(closeModal)
      /* Join as Partner: its own title and line, and the source of what it sends */
      .then(function () { return click('.hero-btn-2'); }).then(modal).then(function (m) {
        ok(m && m.title === 'Partner with us' && /Tell us about your organisation/.test(m.intro), '"Join as Partner" opens a partner enquiry, said as such above the questions', m);
        return page.evaluate(function () {
          var mod = document.querySelector('.rv-form-modal');
          function set(el, v) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
          Array.prototype.forEach.call(mod.querySelectorAll('input'), function (i) {
            if (i.type === 'email') set(i, 'asha.rao@tatamotors.com');
            else if (i.type === 'checkbox') { if (!i.checked) i.click(); }
            else if (i.type === 'text' && !i.closest('[aria-hidden="true"]') && i.offsetParent) set(i, 'Asha Rao');
          });
          var submit = mod.querySelector('button[type="submit"]');
          if (submit) submit.click();
          return !!submit;
        });
      }).then(function () { return sleep(800); }).then(function () {
        ok(posted.length === 1 && posted[0] && posted[0].source === 'partner-enquiry' && posted[0].preview === true, 'what it sends is recorded as a partner enquiry', posted);
        return page.evaluate(function () {
          var mod = document.querySelector('.rv-form-modal'), done = mod && mod.querySelector('.rv-form-done');
          var again = done && done.querySelector('.rv-form-link');
          return { title: (mod.querySelector('.rv-form-modal-title') || {}).textContent || '', text: done ? done.textContent : '',
            facts: !!(done && done.querySelector('.rv-form-done-facts')), calendar: !!(done && done.querySelector('.rv-form-cal')),
            again: again ? again.textContent : '' };
        });
      }).then(function (d) {
        ok(d.title === 'Thank you' && !/registered/i.test(d.title + ' ' + d.text) && /reached the event team/.test(d.text), 'the partner enquiry\'s thank-you says thank you and that the team has it, never registered', d);
        ok(!d.facts && !d.calendar && d.again === 'Send another response', 'a request holds no place: no date line, no calendar, "Send another response"', d);
        return page.click('.rv-form-modal .rv-form-done .rv-form-link').then(function () { return sleep(300); }).then(modal);
      }).then(function (m) {
        ok(m && m.title === 'Partner with us', 'sending another brings back the button\'s own title', m);
      }).then(closeModal)
      /* 2. the ceremony */
      .then(function () { return click('.aw-cer-btn'); }).then(modal).then(function (m) {
        ok(m && m.title === 'Request an invitation' && /no online payment/.test(m.intro), 'the ceremony\'s button asks for an invitation and says there is no online payment', m);
        return page.evaluate(function () { return document.querySelector('.aw-cer-btn').textContent; });
      }).then(function (label) {
        ok(label === 'Request an invitation', 'and says so on the page', label);
      }).then(closeModal)
      /* 3. rv-forms.js on its own: the safety net */
      .then(function () { return page.goto(base + '/raw', { waitUntil: 'load' }); }).then(function () { return sleep(300); })
      .then(function () { return click('#to-hidden'); }).then(modal).then(function (m) {
        ok(m && /provide us with your Information/.test(m.title), 'a "Register Now" to a hidden section opens the form, even on a page the live pass has not seen', m);
      }).then(closeModal)
      .then(function () { return click('#to-shown'); }).then(function () {
        return Promise.all([modal(), page.evaluate(function () { return location.hash; })]);
      }).then(function (r) {
        ok(!r[0] && r[1] === '#about', 'a "Register Now" to a section on view still goes there (the owner chose it)', r);
      }).then(function () {
        ok(errors.length === 0, 'no script errors', errors);
      });
  }).then(function () { return browser.close(); }, function (err) {
    ok(false, 'the browser run finished', err && err.stack);
    return browser && browser.close();
  }).then(function () { server.close(); finish(); });
});
