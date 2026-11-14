/* editor-start.js — the site editor's first steps (custom_editor.html).

   A newcomer opening the editor saw 11 rail items, 6 tools, a mode switch and three buttons, and nothing said what to
   do next (NU-008). Now:
     - the first time a person opens the editor (once per person in this browser, whichever event), a short dialog
       says what to do next, in five steps: change the words, change the pictures, add speakers / agenda / sponsors in
       the console, check the registration form, then save, preview and send for approval. It says where each step
       stands where the editor knows it (how many of the design's sample texts are left, whether the site is saved).
       For a site ETB2B AI generated from a brief it is the editor's welcome ("Your site is ready to review"), with
       what that welcome said before: the draft is the person's own, and generating again makes a new draft.
     - Help, in the tools row above the page, opens the same steps again, as they stand then.
     - while the design's sample texts or pictures are still on the page, a line above the page says how many, what
       their dashed amber outline means, and "Show next" brings each into view (NU-009). It can be dismissed for the
       visit. The outline also says it when pointed at (editor-template-ui.js placeSampleTag).

   window.RevampEditorStart (and module.exports, for functions/lib/editor-start.test.js)
     ready(host)          custom_editor.html, once the site is on the canvas. host: { openDialog, showNotice,
                          clearNotice, generated (true for a site Create Event just generated from a brief) }
     openSteps(first)     the steps dialog; first: the first-time welcome
     steps(st)            -> [{ key, title, text, state, done }]   (pure)
     stepsTitle(st)       -> the dialog's title                      (pure)
     legendText(words, pictures) -> the line above the page, '' when nothing is left   (pure)
     seenKey(user)        -> where this browser remembers the person has seen the steps
     TEXT                 every sentence this file says

   ES5 on purpose (var, function), as every browser file of the editor: it is served as it is, with no build step. */
(function (root) {
  'use strict';

  var TEXT = {
    titleFirst: 'Your site is ready: what to do next',
    titleFirstAi: 'Your site is ready to review',
    titleAgain: 'How to finish your site',
    leadAi: 'This draft is yours now. Generating from the brief again makes a new draft and does not change this one.',
    foot: 'Prefer to ask? Choose Edit with AI at the top and tell ETB2B AI what to change. These steps open again from Help, above the page.',
    footPhone: 'These steps open again from Help, above the page.',
    gotIt: 'Got it',
    close: 'Close',
    showSamples: 'Show the sample texts',
    showSamplesAll: 'Show the samples',
    showNext: 'Show next',
    helpTitle: 'How to finish your site, step by step',
    left: function (n) { return n + ' left'; },
    done: 'Done',
    saved: 'Saved',
    notSaved: 'Not saved yet',
    unsaved: 'Unsaved changes'
  };

  function str(v) { return v == null ? '' : String(v); }
  function isFn(f) { return typeof f === 'function'; }
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, one, many) { return n === 1 ? 'one ' + one : n + ' ' + many; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ---------------------------------------------------------------- pure parts (tested) */
  /* st: { kind: 'gen'|'template'|'imported'|'', samples: { words, pictures }, saved: bool, dirty: bool, phone: bool,
     mac: bool } -> the five steps, each { key, title, text, state ('' | words), done } */
  function steps(st) {
    st = st || {};
    var s = st.samples || {}, words = +s.words || 0, pictures = +s.pictures || 0;
    var keys = st.mac ? '⌘S' : 'Ctrl+S';
    var click = st.phone ? 'Tap' : 'Click';
    var out = [];

    var wordsText = st.kind === 'gen'
      ? 'ETB2B AI wrote this from your brief: read it, and ' + (st.phone ? 'tap' : 'click') + ' any text to correct it.'
      : click + ' any text on the page and type over it.';
    if (words) wordsText += ' ' + cap(plural(words, 'text is', 'texts are')) + ' still the design’s sample, with a dashed amber outline: replace ' + (words === 1 ? 'it' : 'them') + ' with your event’s own, or hide ' + (words === 1 ? 'its' : 'their') + ' section.';
    if (st.phone) wordsText += ' Or ask ETB2B AI, at the bottom, to change it for you.';
    out.push({ key: 'words', title: 'Change the words', text: wordsText,
      state: words ? TEXT.left(words) : (st.kind === 'template' ? TEXT.done : ''), done: !words && st.kind === 'template' });

    /* another event's pictures the design came with (NEW-4): the banner's own, and photos in its samples */
    var photos = +s.photos || 0, banner = Math.min(+s.banner || 0, photos), others = photos - banner;
    var picText = click + ' a picture, then Replace image.';
    if (pictures) picText += ' ' + cap(plural(pictures, 'picture box is', 'picture boxes are')) + ' still empty, with a dashed amber outline.';
    if (banner) picText += ' The banner still shows the design’s sample picture, from another event: select the banner, then Background picture, to replace it.';
    if (others) picText += ' ' + cap(plural(others, 'picture is', 'pictures are')) + ' another event’s, from the design, with a dashed amber outline: replace ' + (others === 1 ? 'it' : 'them') + ' with your event’s own.';
    out.push({ key: 'pictures', title: 'Change the pictures', text: picText, state: pictures + photos ? TEXT.left(pictures + photos) : '', done: false });

    out.push({ key: 'content', title: 'Add speakers, agenda and sponsors',
      text: (st.phone ? 'Speakers, Agenda and Sponsors, in the event’s menu (switch to Myself to see it), open' : 'Speakers, Agenda and Sponsors, in the left bar, open') +
        ' the event console (marked ↗). Each shows on the site in its own section; if this design has none for it yet, the site editor adds one the next time it opens (press Save to keep it).',
      state: '', done: false });

    out.push({ key: 'form', title: 'Check the registration form',
      text: st.phone ? 'Forms is in the tools row on a computer. Here, ask ETB2B AI to change the form.' : 'Forms, in the tools row above the page, shows the form visitors fill in and lets you change it.',
      state: '', done: false });

    out.push({ key: 'send', title: 'Save, preview, then send for approval',
      text: 'Save' + (st.phone ? '' : ' (' + keys + ')') + ' keeps your changes: the editor does not save by itself. Preview opens the site in a new tab. Send for approval… asks an approver to put it live.',
      state: st.dirty ? TEXT.unsaved : st.saved ? TEXT.saved : TEXT.notSaved, done: !!st.saved && !st.dirty });
    return out;
  }
  function stepsTitle(st) {
    st = st || {};
    if (!st.first) return TEXT.titleAgain;
    return st.generated ? TEXT.titleFirstAi : TEXT.titleFirst;
  }
  /* the line above the page while the design's samples are on it (NU-009); photos: another event's pictures the design
     came with, the banner's among them (NEW-4) */
  function legendText(words, pictures, photos) {
    words = +words || 0; pictures = +pictures || 0; photos = +photos || 0;
    if (!words && !pictures && !photos) return '';
    var bits = [];
    if (words) bits.push(plural(words, 'text', 'texts'));
    if (pictures) bits.push(plural(pictures, 'picture box', 'picture boxes'));
    if (photos) bits.push(plural(photos, 'picture', 'pictures'));
    var what = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
    var many = words + pictures + photos > 1;
    return cap(what) + ' on this page ' + (many ? 'are' : 'is') + ' still the design’s sample' + (many ? 's' : '') +
      ': ' + (many ? 'they have' : 'it has') + ' a dashed amber outline. Replace ' + (many ? 'them' : 'it') +
      ' with your event’s own, or hide ' + (many ? 'their' : 'its') + ' section, before you send the site for approval.';
  }
  function seenKey(user) {
    return 'revamp.editorSteps.seen.' + str((user && (user.uid || user.email)) || 'anon');
  }

  /* ---------------------------------------------------------------- the editor around it */
  var host = null, started = false, legendGone = false, legendSaid = '';
  function doc() { return root.document || null; }
  function ui() { var U = root.RevampTemplateUI; return U && isFn(U.samplesLeft) ? U : null; }
  function user() {
    try { return root.RevampAuth && isFn(root.RevampAuth.currentUser) ? root.RevampAuth.currentUser() : null; } catch (e) { return null; }
  }
  function stored(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* this visit only */ } }
  function onPhone() { try { return !!(isFn(root.matchMedia) && root.matchMedia('(max-width: 720px)').matches); } catch (e) { return false; } }
  function onMac() {
    var p = '';
    try { p = str(root.navigator && (root.navigator.platform || root.navigator.userAgent)); } catch (e) { p = ''; }
    return /Mac|iPhone|iPad|iPod/i.test(p);
  }
  function state(first) {
    var U = ui(), s = U ? U.samplesLeft() : { words: 0, pictures: 0 }, site = U && isFn(U.siteState) ? U.siteState() : null;
    var info = site && site.info;
    return { first: !!first, generated: !!(host && host.generated), kind: U && isFn(U.siteKind) ? U.siteKind() : '', samples: s,
      saved: !!(info && info.savedVersion), dirty: !!(site && site.dirty), phone: onPhone(), mac: onMac() };
  }
  function stepsHtml(st) {
    var list = steps(st);
    var html = st.first && st.generated ? '<p class="ed-steps-lead">' + esc(TEXT.leadAi) + '</p>' : '';
    html += '<ol class="ed-steps">' + list.map(function (s, i) {
      return '<li class="ed-step' + (s.done ? ' is-done' : '') + '" data-step="' + esc(s.key) + '">' +
        '<span class="ed-step-n" aria-hidden="true">' + (s.done ? '✓' : (i + 1)) + '</span>' +
        '<span class="ed-step-body"><span class="ed-step-head"><strong>' + esc(s.title) + '</strong>' +
        (s.state ? '<span class="ed-step-state' + (s.done ? ' ok' : '') + '">' + esc(s.state) + '</span>' : '') + '</span>' +
        '<span class="ed-step-text">' + esc(s.text) + '</span></span></li>';
    }).join('') + '</ol>';
    html += '<p class="ed-steps-foot">' + esc(st.phone ? TEXT.footPhone : TEXT.foot) + '</p>';
    return html;
  }
  /* the dialog; first: the first-time welcome, remembered as seen once the person has closed it (not when another of
     the editor's dialogs took its place as the page opened) */
  function openSteps(first) {
    if (!host || !isFn(host.openDialog)) return null;
    var st = state(first), U = ui();
    var actions = [];
    if (st.samples && (+st.samples.words || +st.samples.pictures || +st.samples.photos) && U && isFn(U.showNextSample)) {
      actions.push({ label: +st.samples.words ? TEXT.showSamples : TEXT.showSamplesAll, kind: 'secondary', aside: true, onClick: function () { setTimeout(function () { U.showNextSample(); }, 0); } });
    }
    actions.push({ label: first ? TEXT.gotIt : TEXT.close, kind: 'primary', autofocus: true });
    var d = host.openDialog({
      title: stepsTitle(st), bodyHtml: stepsHtml(st), actions: actions,
      onClose: function () {
        if (!first) return;
        setTimeout(function () {
          var D = doc();
          var other = D && D.querySelector('.scrim .ed-dialog');
          if (!other) store(seenKey(user()), '1');
        }, 0);
      }
    });
    if (d && d.el && d.el.classList) d.el.classList.add('ed-steps-dialog');
    return d;
  }
  /* the first-time steps wait for the editor's own questions as it opens (an older copy, the logo) and for the first
     save of a site Create Event just made, so they say where it stands: asked when neither is under way, for up to
     20 s */
  function busyOpening() {
    var D = doc(), U = ui(), site = U && isFn(U.siteState) ? U.siteState() : null;
    return !!(D && D.querySelector('.scrim')) || !!(site && (site.firstSave || site.saving));
  }
  function firstTime() {
    if (stored(seenKey(user()))) return;
    var tries = 0;
    (function attempt() {
      if (busyOpening() && ++tries < 40) { setTimeout(attempt, 500); return; }
      if (doc() && doc().querySelector('.scrim')) return;
      openSteps(true);
    })();
  }

  /* ---------------------------------------------------------------- the line above the page (NU-009) */
  function drawLegend() {
    var U = ui();
    if (!host || !U || legendGone || !isFn(host.showNotice)) return;
    var s = U.samplesLeft(), text = legendText(s.words, s.pictures, s.photos);
    if (text === legendSaid) return;
    legendSaid = text;
    if (!text) { if (isFn(host.clearNotice)) host.clearNotice('samples'); return; }
    host.showNotice('samples', { kind: 'warn', text: text, dismissible: true,
      actions: [{ label: TEXT.showNext, onClick: function () { U.showNextSample(); } }],
      onDismiss: function () { legendGone = true; } });
  }
  var legendTimer = null;
  function scheduleLegend() {
    if (legendTimer) clearTimeout(legendTimer);
    legendTimer = setTimeout(function () { legendTimer = null; drawLegend(); }, 300);
  }

  /* ---------------------------------------------------------------- Help */
  function wireHelp() {
    var D = doc(), btn = D && D.getElementById('btn-editor-help');
    if (!btn || btn.getAttribute('data-wired')) return;
    btn.setAttribute('data-wired', '1');
    btn.hidden = false;
    btn.addEventListener('click', function () { openSteps(false); });
  }

  function ready(h) {
    if (started) return;
    started = true;
    host = h || {};
    wireHelp();
    var U = ui();
    if (U && isFn(U.onChange)) U.onChange(scheduleLegend);
    drawLegend();
    firstTime();
  }

  var api = { ready: ready, openSteps: openSteps, steps: steps, stepsTitle: stepsTitle, legendText: legendText, seenKey: seenKey, TEXT: TEXT };
  root.RevampEditorStart = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
