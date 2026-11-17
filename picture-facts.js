/* picture-facts.js — the last line of ETB2B AI's card for a message that made several pictures (the advanced picture
   assistant, W4 "tells the truth", 16 Nov 2026): built only from what really happened to each picture on the page —
   placed, kept off the page and why, not made, an option waiting — never from the model's own summary (owner, 16 Nov
   2026: "kept off the page" was said of a picture on the page, and "placed" of one that was not).

     RevampPictureFacts.closingLine(jobs, o) -> one or two sentences ('' for no jobs)
       jobs: [{ label, outcome, why, line, where }]
         outcome  'placed'   on the page (line: the runner's one true sentence about it, e.g. "I removed two small figures")
                  'held'     made, kept off the page by its check (why: the reason; where: where it waits)
                  'kept'     made, not put on the page (the section's rework left it out, the place was gone…; where)
                  'option'   one of the "Show 3 options" pictures, waiting for the owner to choose (where)
                  'failed'   not made (why)
                  'stopped'  not made: the owner pressed Stop
       o: { status: the change's ('failed' when nothing on the page changed) }
     RevampPictureFacts.lineOf(job) -> the part about one picture ('offered' too: a document photo offered, not placed)
     RevampPictureFacts.offeredLine(offers) -> the last line for the document photos a message offered and did not place
       (the owner, 17 Nov 2026: a document photo that shows people is never placed by itself, in any section; nor one
       whose people check is missing): offers [{ label, page, why: 'people' | 'unknown', place: true when "Put it in"
       is under the message (else only "Use this picture": the section has no place for one) }]; '' for none
   Plain words, no bare "ET". ES5, no DOM: loaded by the editor (custom_editor.html) and tested in node
   (functions/lib/picture-facts.test.js). */
(function (root) {
  'use strict';
  function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  function bare(s) { return clean(s, 300).replace(/[\s.;:,]+$/, ''); }
  /* a sentence put after a dash: its first letter lower case, except "I" and a name ("ETB2B", "Davos …") */
  function lower(s) {
    s = bare(s);
    if (!s || /^I\b/.test(s) || /^[A-Z][A-Z0-9]/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function quote(s) { return '“' + (clean(s, 60) || 'a section') + '”'; }

  function lineOf(j) {
    j = j && typeof j === 'object' ? j : {};
    var name = quote(j.label), why = lower(j.why), where = lower(j.where), line = lower(j.line);
    switch (j.outcome) {
      case 'placed': return name + ' placed' + (line ? ' (' + line + ')' : '');
      case 'held': return name + ' kept off the page' + (why ? ' — ' + why : ' — it did not pass its check') + (where ? '; ' + where : '');
      case 'kept': return name + ' made but not put on the page' + (why ? ' — ' + why : '') + (where ? '; ' + where : '');
      case 'option': return 'another option for ' + name + (where ? ' — ' + where : ' waits under my message');
      case 'offered': return name + ' offered, not placed' + (why ? ' — ' + why : '') + (where ? '; ' + where : '');
      case 'stopped': return name + ' not made — you pressed Stop';
      default: return name + ' not made' + (why ? ' — ' + why : '');
    }
  }
  function closingLine(jobs, o) {
    var list = (jobs && jobs.length ? jobs : []).filter(function (j) { return j && typeof j === 'object'; });
    if (!list.length) return '';
    o = o || {};
    var placed = list.filter(function (j) { return j.outcome === 'placed'; }).length;
    var made = list.filter(function (j) { return j.outcome !== 'option'; }).length;
    var parts = list.map(lineOf).join('; ');
    var head;
    if (o.status === 'failed' || o.status === 'stopped' || !placed) head = 'Nothing on the page changed for the new pictures: ';
    else if (placed === made) head = (placed === 1 ? 'The new picture is' : 'All ' + placed + ' new pictures are') + ' on the page: ';
    else head = placed + ' of the ' + made + ' new pictures ' + (placed === 1 ? 'is' : 'are') + ' on the page: ';
    return head + parts + '.';
  }

  /* the document photos offered, not placed: what each is, where it would go and why it was not put there; then how
     the owner puts it in. Never says "placed" of any of them. */
  function offeredLine(offers) {
    var list = (offers && offers.length ? offers : []).filter(function (o) { return o && typeof o === 'object'; });
    if (!list.length) return '';
    function whyOf(o) { return o.why === 'unknown' ? 'I could not check whether it shows people' : 'it shows people'; }
    var parts = list.map(function (o) {
      var page = parseInt(o.page, 10);
      return (page > 0 ? 'page ' + page + '\'s photo' : 'a photo from your document') + ' for ' + quote(o.label) + ' (' + whyOf(o) + ')';
    });
    var placeable = list.filter(function (o) { return o.place; }).length, one = list.length === 1;
    var how = placeable === list.length
      ? '“Put it in” under my message puts ' + (one ? 'it' : 'each') + ' there, and Undo takes it out again.'
      : !placeable ? '“Use this picture” under my message puts ' + (one ? 'it' : 'each') + ' in the tray: then tell me where it goes.'
        : '“Put it in” under my message puts each there (Undo takes it out again); where there is no place for one, “Use this picture” puts it in the tray.';
    return 'Offered, not placed: ' + parts.join('; ') + '. ' + (one ? 'It is not on the page: ' : 'None of them is on the page: ') + how;
  }

  var api = { closingLine: closingLine, lineOf: lineOf, offeredLine: offeredLine };
  root.RevampPictureFacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
