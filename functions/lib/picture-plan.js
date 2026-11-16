/* lib/picture-plan.js — W1 "plan and act" (builder A): what pictures a message asks for, checked, as up to
   picture-job.MAX_JOBS jobs made side by side (owner, 16 Nov 2026: "it is very basic … I want to make this AI like an
   advance AI"; up to 4 pictures a message, the 20 a day kept). With the `plan` switch off this is exactly today's
   chatPicture.planAsk on the first entry, so the chat behaves as it did.

   With `plan` on:
   - the model decides what is asked; the server checks its QUOTE: a picture is made when the words the model quoted
     (`ownerQuote`) are in the owner's own latest message (verifyQuote) — page text, screenshots, a document's words and
     attachments cannot produce them — or when it is a yes to the plan kept on the last turn. chatPicture.pictureAsked
     (the old word rules) still counts, and is logged as a signal;
   - the names in a scene are TYPED by the model (`entities`): places, landmarks and venues are drawn ("the Steigenberger
     Grandhotel Belvedere in Davos"), a person is never (the nameless scene is offered, a yes makes it), a brand or an
     organisation is left out at once (gateEntities); the deterministic person checks of chatPicture.cleanSubject
     (honorifics, offices, Content's people, names on the page) still apply;
   - several pictures, one per section: each entry is planAsk's (Content's photos, the navigation and footer, the video
     banner, the banner's place, the slot, add or replace, the frame), with its own picture number (the number after
     the attached and document pictures, then the next, in the order of `newPictures`);
   - across the plan: people only in a section about people (kindFor), at most two pictures with people on the site
     (peopleBudget), "no people" kept for that place (the owner's words, and the ledger's), the day's count for the
     whole plan (quotaFor), and the 4-a-message cap;
   - an edit of a picture already there (`mode` 'edit', switch `edit`) names the picture it changes (editOf), this
     event's own; references (`refs`, switch `refs`) are this event's attachments and document pictures;
   - "Show 3 options" (switch `variants`, owner: off by default): only when the owner asks, three jobs for one place.

     planPictures(entries, ctx) -> planAsk's answer ({ ask, reply, code, note, pending, edits, newSections }) plus
                                   jobs: [job] (picture-job.normalise'd, ready to store), asks: [ask] (planAsk's, one per
                                   job), planLine (the sentence that says the plan and the count; '' for one picture),
                                   signals: { regex, nameRun }
                                   ctx: planAsk's ctx, plus switches, ledger, design, ownPrefix, attachmentUrls
     takeOffer(last, ctx)       -> the same for a bare yes to the plan kept on the last turn (last.offerJobs), or
                                   chatPicture.takeOffer's one picture; null when there is nothing to make
     offerPlan(entries, summary, ctx) -> the offer to keep on a "reply" turn: { record, jobs: [record] } | null
     verifyQuote(quote, instruction) -> true when the quote is the owner's own words
     gateEntities(entities, ctx) -> { person: [e], brand: [e], placeWords: { word: 1 } }
     kindFor(section, ctx)      -> { people: boolean, why }
     peopleMap(sections, ctx)   -> [{ id, name, people }] for the prompt
     peopleBudget(asks, ctx)    -> how many more pictures with people the site may take
     quotaFor(count, ctx)       -> { left, perDay, fits }
     planLineOf(asks, ctx)      -> the plan line */
'use strict';

var chatPicture = require('./chat-picture');
var pictureJob = require('./picture-job');
var pictureSwitches = require('./picture-switches');

var MAX_JOBS = pictureJob.MAX_JOBS;
var QUOTE_MIN_WORDS = 2;
/* "show me a few options", "give me three versions" */
var OPTIONS_RE = /\b(?:options?|variations?|versions|alternatives|choices)\b|\b(?:a\s+few|some|three|3)\s+(?:takes|versions|options|ideas|looks)\b|\bshow\s+me\s+(?:a\s+few|some|three|3)\b/i;
/* sections whose name says they are about people (used only where the design planned no kind for them) */
var PEOPLE_SECTION_RE = /\b(?:who\s+should\s+attend|who\s+attends|attendees?|audience|delegates?|networking|community|meet\s+the|our\s+people|testimonials?|participants?|leaders|members?)\b/i;

function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function int(v, lo, hi) { v = parseInt(v, 10); if (!(v >= lo)) return lo; return v > hi ? hi : v; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function tokens(s) {
  return (String(s || '').toLowerCase().replace(/[‘’`´]/g, '\'').replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}]+)?/gu) || []);
}
function on(sw, name) { return pictureSwitches.on(sw, name, 'chat'); }

/* ---------- the owner's own words ---------- */
/* The quote, after case, spaces, quotes and punctuation are evened out, is a run of the message's own words: at least
   two words, or the whole message ("warmer"). */
function verifyQuote(quote, instruction) {
  var q = tokens(quote), all = tokens(instruction);
  if (!q.length || !all.length) return false;
  if (q.length < QUOTE_MIN_WORDS && !(q.length === all.length && q[0] === all[0])) return false;
  for (var i = 0; i + q.length <= all.length; i++) {
    var same = true;
    for (var j = 0; j < q.length; j++) if (all[i + j] !== q[j]) { same = false; break; }
    if (same) return true;
  }
  return false;
}

/* ---------- the names in a scene ---------- */
function gateEntities(entities, ctx) {
  ctx = ctx || {};
  var own = chatPicture.eventWords(ctx.eventData, ctx.designPlan);
  var out = { person: [], brand: [], placeWords: {} };
  (Array.isArray(entities) ? entities : []).forEach(function (e) {
    e = obj(e);
    if (!e || !oneLine(e.text, 120)) return;
    var w = tokens(e.text);
    /* the event's own name, venue and city are never refused (owner, 16 Nov 2026: Davos is a place) */
    var ours = w.length > 0 && w.every(function (x) { return own[x]; });
    if (e.type === 'person' && !ours) out.person.push({ text: oneLine(e.text, 120), type: 'person' });
    else if ((e.type === 'brand' || e.type === 'organisation') && !ours) out.brand.push({ text: oneLine(e.text, 120), type: e.type });
    else if (e.type === 'place' || e.type === 'landmark' || e.type === 'venue') w.forEach(function (x) { if (x.length >= 2) out.placeWords[x] = 1; });
  });
  return out;
}
/* the scene with no name in it: the model's plain words, else the subject with the names taken out */
function namelessOf(entry, ctx) {
  var nameCtx = { sections: ctx.sections || [], event: ctx.eventData, designPlan: ctx.designPlan };
  var tries = [entry.plainSubject, chatPicture.withoutNames(entry.subject, nameCtx)];
  for (var i = 0; i < tries.length; i++) {
    var r = chatPicture.cleanSubject(tries[i], nameCtx);
    if (r.ok && tokens(r.subject).length >= 3) return r.subject;
  }
  return '';
}
/* a named thing taken out of the subject (a brand or an organisation): its words removed, the rest kept when enough
   is left, else the plain words */
function withoutText(subject, list) {
  var s = String(subject || '');
  list.forEach(function (e) { s = s.split(e.text).join(' '); });
  return s.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/* ---------- people ---------- */
function sectionOf(ctx, id) { return (Array.isArray(ctx.sections) ? ctx.sections : []).filter(function (s) { return s && s.id === id; })[0] || null; }
function planSection(ctx, id) {
  var plan = obj(ctx.designPlan) || obj(obj(ctx.eventData) && ctx.eventData.designPlan) || {};
  return (Array.isArray(plan.sections) ? plan.sections : []).filter(function (s) { return s && s.id === id; })[0] || null;
}
/* Is the section one about people? The design's kind for its picture first (the previous edition's choice is in it, as
   site generation follows that edition section by section); with none planned, its name. Never the banner, the
   navigation, the footer, nor Content's records (their photos are Content's). */
function kindFor(sec, ctx) {
  ctx = ctx || {};
  if (!sec) return { people: false, why: 'none' };
  if (sec.role === 'hero') return { people: false, why: 'banner' };
  if (sec.role === 'nav' || sec.role === 'footer' || sec.role === 'records') return { people: false, why: sec.role };
  var ps = planSection(ctx, sec.id);
  if (ps && typeof ps.imageKind === 'string' && ps.imageKind) return { people: ps.imageKind === 'people', why: 'design' };
  return PEOPLE_SECTION_RE.test(String(sec.name || '') + ' ' + String(sec.id || '').replace(/[-_]+/g, ' ')) ? { people: true, why: 'name' } : { people: false, why: 'name' };
}
function peopleMap(sections, ctx) {
  return (Array.isArray(sections) ? sections : []).filter(function (s) { return s && s.id && s.role !== 'nav' && s.role !== 'footer'; }).map(function (s) {
    return { id: s.id, name: chatPicture.cleanSectionName(s.name || s.id), people: kindFor(s, ctx).people };
  });
}
/* how many more pictures with people the site may take: two at most, counting those on the site outside the sections
   these pictures go in (and never the banner) */
function peopleBudget(asks, ctx) {
  var skip = {};
  (asks || []).forEach(function (a) { if (a) skip[a.sectionId] = true; });
  var rest = (Array.isArray(ctx.sections) ? ctx.sections : []).filter(function (s) { return s && !skip[s.id]; });
  return Math.max(0, chatPicture.MAX_PEOPLE_PICTURES - chatPicture.peoplePictures(rest, '', ctx.designPlan));
}

/* ---------- the day ---------- */
function quotaFor(count, ctx) {
  var q = obj(ctx && ctx.quota);
  var perDay = (q && q.perDay) || chatPicture.PER_DAY;
  var left = q ? int(q.left, 0, 100000) : typeof (ctx && ctx.picturesLeft) === 'number' ? Math.max(0, ctx.picturesLeft) : perDay;
  return { left: left, perDay: perDay, fits: Math.min(count, left), failedOut: !!(q && q.failedOut) };
}

/* ---------- numbers ---------- */
/* number n taken out of every rework and new section (a picture that is not made is put in by nothing) */
function stripN(list, n) {
  return (Array.isArray(list) ? list : []).map(function (x) {
    if (!x || !Array.isArray(x.pictures) || x.pictures.indexOf(n) === -1) return x;
    return Object.assign({}, x, { pictures: x.pictures.filter(function (p) { return p !== n; }) });
  });
}

/* ---------- edits and references (W3's switches) ---------- */
function ownUrl(u, ctx) {
  u = String(u || '').trim();
  var p = String((ctx && ctx.ownPrefix) || '');
  return p && u.indexOf(p) === 0 && /^https:\/\/[^\s"'<>#]+$/.test(u) ? u : '';
}
/* the picture an edit changes: the one made last (this place's), the one selected, or the section's by its slot — this
   event's own, never a logo (the editor's describe() leaves logos and Content's photos out of the list) */
function editTarget(x, ask, ctx) {
  var last = obj(ctx.lastTurnPicture), sec = sectionOf(ctx, ask.sectionId);
  var list = sec && sec.pics && Array.isArray(sec.pics.list) ? sec.pics.list : [];
  var lastUrl = last && last.state === 'made' && last.sectionId === ask.sectionId ? ownUrl(last.url, ctx) : '';
  var focus = obj(ctx.focus) || {};
  var bySlot = function (n) { var e = n >= 1 ? list[n - 1] : null; return e && typeof e === 'object' ? ownUrl(e.src, ctx) : ''; };
  if (x.editOf === 'last-made' && lastUrl) return lastUrl;
  if (x.editOf === 'selected' && focus.sectionId === ask.sectionId && bySlot(int(focus.slot, 0, 50))) return bySlot(int(focus.slot, 0, 50));
  if (x.editOf === 'slot' && bySlot(ask.slot)) return bySlot(ask.slot);
  return lastUrl || bySlot(ask.slot);
}
function refsFor(x, raw, ctx) {
  var wanted = x.refs.slice();
  var legacy = parseInt(raw && raw.reference, 10);
  if (legacy >= 1 && !wanted.some(function (r) { return r.n === legacy; })) wanted.push({ n: legacy, use: 'subject' });
  var attached = int(ctx.attachmentCount, 0, 6), urls = Array.isArray(ctx.attachmentUrls) ? ctx.attachmentUrls : [];
  var docs = Array.isArray(ctx.docPictures) ? ctx.docPictures : [];
  return wanted.map(function (r) {
    if (r.use === 'as-is') return null;
    if (r.n <= attached) return pictureJob.refOf({ id: 'attachment-' + r.n, kind: 'attachment', url: ownUrl(urls[r.n - 1], ctx), use: r.use });
    var d = docs.filter(function (p) { return p && p.n === r.n; })[0];
    return d ? pictureJob.refOf({ id: 'document-' + r.n, kind: 'document', url: ownUrl(d.url, ctx), use: r.use }) : null;
  }).filter(Boolean).slice(0, pictureJob.MAX_REFS);
}

/* ---------- the job as the turn keeps it ---------- */
function jobOf(ask, x, raw, k, ctx, extra) {
  var rec = chatPicture.turnRecord(ask, ctx.design);
  var sw = ctx.switches;
  var job = Object.assign(rec, {
    k: k, mode: 'new', basedOn: x.basedOn, ownerQuote: x.ownerQuote, plainSubject: oneLine(raw && raw.plainSubject, 400), entities: x.entities,
    editOf: null, change: '', changeKind: '', refs: on(sw, 'refs') ? refsFor(x, raw, ctx) : [], variantOf: null
  }, extra || {});
  if (x.mode === 'edit' && on(sw, 'edit') && ask.apply === 'swap') {
    var url = editTarget(x, ask, ctx);
    if (url) {
      job.mode = 'edit';
      job.editOf = { url: url };
      job.change = x.change || 'Make the change the owner asked for; change nothing else.';
      job.changeKind = x.changeKind;
    }
  }
  return pictureJob.normalise(job, k);
}

/* ---------- across the plan ---------- */
/* people where they belong, and two at most; "no people" kept for that place */
function holdPeople(asks, xs, ctx, notes) {
  var said = String(ctx.instruction || '');
  var budget = peopleBudget(asks, ctx);
  var ledger = Array.isArray(ctx.ledger) ? ctx.ledger : [];
  var noPeopleNow = require('./picture-ledger').NO_PEOPLE_RE.test(said);
  asks.forEach(function (a, i) {
    var x = xs[i], sec = sectionOf(ctx, a.sectionId);
    var quote = x.ownerQuote || said;
    var before = ledger.filter(function (l) { return l && l.sectionId === a.sectionId; }).slice(-1)[0];
    a.peopleRule = noPeopleNow || (before && before.noPeople) ? 'none' : '';
    if (a.peopleRule === 'none' && a.kind === 'people') a.kind = 'subject';
    if (a.kind !== 'people') return;
    if (!kindFor(sec, ctx).people && !chatPicture.peopleAsked(quote)) {
      a.kind = 'place';
      notes.push(chatPicture.sentence('notPeopleSection', { name: chatPicture.nameRef(sec || { id: a.sectionId, name: a.sectionName }) }));
      return;
    }
    if (budget <= 0) {
      a.kind = 'place';
      notes.push(chatPicture.sentence('people'));
      return;
    }
    budget--;
  });
}

function planLineOf(asks, ctx, jobs) {
  if (!asks.length) return '';
  var q = quotaFor(asks.length, ctx);
  if (jobs && jobs.length > 1 && jobs[1].variantOf === 0) return chatPicture.sentence('variants', { name: '“' + asks[0].sectionName + '”', left: q.left });
  if (asks.length === 1) {
    var j0 = jobs && jobs[0];
    if (j0 && j0.mode === 'edit') return chatPicture.sentence('editOne', { name: '“' + asks[0].sectionName + '”', change: j0.change.replace(/[;,.]?\s*change nothing else\.?$/i, '') });
    return '';
  }
  var list = asks.map(function (a) { return '“' + a.sectionName + '”: ' + chatPicture.shortScene(a.subject); }).join('; ');
  return chatPicture.sentence('planMany', { count: asks.length, list: list, left: q.left });
}

/* the answer of a plan: the first refusal stands when nothing is made */
function answer(asks, jobs, refusals, notes, edits, newSections, ctx, signals) {
  var first = refusals[0] || null;
  if (asks.length) {
    var refusalLines = refusals.map(function (r) { return r.reply; }).filter(Boolean);
    return { ask: asks[0], asks: asks, jobs: jobs, reply: '', code: '', note: notes.concat(refusalLines).filter(function (l, i, all) { return l && all.indexOf(l) === i; }).join(' '),
      pending: null, edits: edits, newSections: newSections, planLine: planLineOf(asks, ctx, jobs), signals: signals };
  }
  return { ask: null, asks: [], jobs: [], reply: first ? first.reply : '', code: first ? first.code : '', note: '', pending: first ? first.pending || null : null,
    edits: edits, newSections: newSections, planLine: '', signals: signals };
}

function today(entries, ctx) {
  var planned = chatPicture.planAsk(entries, ctx) || {};
  planned.jobs = planned.ask ? [pictureJob.fromAsk(planned.ask, 0)] : [];
  return planned;
}

function planPictures(entries, ctx) {
  ctx = ctx || {};
  if (!on(ctx.switches, 'plan')) return today(entries, ctx);
  var list = (Array.isArray(entries) ? entries : []).filter(obj);
  if (!ctx.canMakePictures || !list.length || !ctx.eventId) {
    var none = today(list.slice(0, 1), ctx);
    none.asks = none.ask ? [none.ask] : [];
    none.planLine = '';
    return none;
  }
  var said = String(ctx.instruction || '');
  var attached = int(ctx.attachmentCount, 0, 6), numbered = Math.max(attached, int(ctx.numbered, 0, chatPicture.MAX_NUMBERED));
  var last = obj(ctx.lastTurnPicture), pend = chatPicture.pendingOf(last);
  var docs = numbered > attached ? (ctx.docFresh === true ? 'fresh' : 'kept') : '';
  var signals = { regex: chatPicture.pictureAsked(said, attached, last, docs), nameRun: chatPicture.nameRun(said, chatPicture.eventWords(ctx.eventData, ctx.designPlan)) };
  var notes = [], refusals = [], asks = [], xs = [], raws = [], used = {}, skippedQuota = [];
  var edits = ctx.sectionEdits, newSections = ctx.newSections;
  var over = list.slice(MAX_JOBS);
  list = list.slice(0, MAX_JOBS);
  var q = quotaFor(list.length, ctx);
  var variants = on(ctx.switches, 'variants') && list.length === 1 && pictureJob.entryOf(list[0]).variants === 3 && OPTIONS_RE.test(said);
  list.forEach(function (raw, i) {
    var n = numbered + 1 + i, x = pictureJob.entryOf(raw);
    var sec = sectionOf(ctx, raw.sectionId);
    function skip() { edits = stripN(edits, n); newSections = stripN(newSections, n); }
    /* an attached or document picture as it is: the model's sectionEdits or pictureSwaps put it in, not a new picture */
    if (x.mode === 'place') return skip();
    var quoted = x.basedOn === 'owner-words' && verifyQuote(x.ownerQuote, said);
    var accepted = x.basedOn === 'accepted-offer' && !!pend && (chatPicture.bareYes(said) || tokens(said).length <= 12);
    var ctxK = Object.assign({}, ctx, { numbered: numbered + i, sectionEdits: edits, newSections: newSections });
    if (!(quoted || accepted || signals.regex)) {
      /* not the owner's words: planAsk says so in its own sentence (and nothing is spent) */
      var no = chatPicture.planAsk([raw], ctxK);
      edits = no.edits; newSections = no.newSections;
      refusals.push(no);
      return;
    }
    if (raw.sectionId && used[raw.sectionId]) {
      notes.push(chatPicture.sentence('sameSection', { name: chatPicture.nameRef(sec || { id: raw.sectionId }) }));
      return skip();
    }
    if (asks.length >= q.left && q.left > 0) { skippedQuota.push(chatPicture.nameRef(sec || { id: raw.sectionId })); return skip(); }
    /* a section of Content's records is reworked around a new picture only as the plan's first: the editor checks its
       records come out unchanged for that one (editor-template-ui.js recordsState); a later one is asked for alone */
    if (asks.length && sec && sec.role === 'records' && !(raw.placement === 'background' && sec.pics && sec.pics.background === true)) {
      notes.push(chatPicture.sentence('recordsLater', { name: chatPicture.nameRef(sec) }));
      return skip();
    }
    var gate = gateEntities(x.entities, ctx), e = Object.assign({}, raw);
    var confirming = accepted || (!!pend && chatPicture.bareYes(said));
    if (gate.person.length) {
      var scene = namelessOf(raw, ctx);
      if (!scene || !confirming) {
        skip();
        var offer = scene ? chatPicture.offerOf(Object.assign({}, raw, { subject: scene }), ctx.sections || [], ctx) : null;
        refusals.push({ reply: scene ? chatPicture.sentence('entityPerson', { scene: chatPicture.shortScene(scene) }) : chatPicture.sentence('nameAsk'), code: 'name',
          pending: offer ? offer.record : null });
        return;
      }
      e.subject = scene;
      notes.push(chatPicture.sentence('plainNote'));
    }
    if (gate.brand.length) {
      var left = withoutText(e.subject, gate.brand), plain = namelessOf(raw, ctx);
      e.subject = tokens(left).length >= 4 && !gate.brand.some(function (b) { return left.toLowerCase().indexOf(b.text.toLowerCase()) !== -1; }) ? left : plain || left;
      notes.push(chatPicture.sentence('entityBrand', { name: chatPicture.nameRef(sec || { id: raw.sectionId }) }));
    }
    ctxK.quoteVerified = true;
    ctxK.modelChooses = true;
    ctxK.placeWords = gate.placeWords;
    var planned = chatPicture.planAsk([e], ctxK);
    edits = planned.edits; newSections = planned.newSections;
    if (!planned.ask) { refusals.push(planned); return; }
    if (planned.note) notes.push(planned.note);
    used[planned.ask.sectionId] = true;
    asks.push(planned.ask); xs.push(x); raws.push(raw);
  });
  if (skippedQuota.length) notes.push(chatPicture.sentence('planQuota', { left: q.left, count: asks.length, skipped: skippedQuota.join(', ') }));
  if (over.length) {
    over.forEach(function (raw, j) { var n = numbered + 1 + MAX_JOBS + j; edits = stripN(edits, n); newSections = stripN(newSections, n); });
    notes.push(chatPicture.sentence('planCap', { skipped: over.map(function (r) { return chatPicture.nameRef(sectionOf(ctx, r.sectionId) || { id: r.sectionId }); }).join(', ') }));
  }
  holdPeople(asks, xs, ctx, notes);
  var jobs = asks.map(function (a, k) { return jobOf(a, xs[k], raws[k], k, ctx, { peopleRule: a.peopleRule || '' }); });
  /* "Show 3 options": two more of the same place, made beside it; the first is placed, the others wait */
  if (variants && asks.length === 1 && q.left >= 3) {
    for (var v = 1; v < 3; v++) {
      var copy = Object.assign({}, asks[0], { n: asks[0].n + v });
      asks.push(copy);
      jobs.push(pictureJob.normalise(Object.assign({}, jobs[0], { k: v, n: copy.n, variantOf: 0, mode: 'new', editOf: null }), v));
    }
  }
  return answer(asks, jobs, refusals, notes, edits, newSections, ctx, signals);
}

/* ---------- a yes to the plan kept on the last turn ---------- */
function takeOffer(last, ctx) {
  ctx = ctx || {};
  if (!on(ctx.switches, 'plan')) return chatPicture.takeOffer(last, ctx);
  last = obj(last);
  var offered = last && Array.isArray(last.offerJobs) && last.offerJobs.length > 1 && last.state === 'offered' ? last.offerJobs.filter(obj).slice(0, MAX_JOBS) : null;
  if (!offered) {
    var one = chatPicture.takeOffer(last, Object.assign({}, ctx, { lastTurnPicture: last }));
    if (!one || !one.ask) return null;
    var x0 = pictureJob.entryOf({ basedOn: 'accepted-offer' }), notes0 = one.note ? [one.note] : [];
    holdPeople([one.ask], [x0], ctx, notes0);
    one.asks = [one.ask];
    one.jobs = [jobOf(one.ask, x0, last, 0, ctx, { peopleRule: one.ask.peopleRule || '' })];
    one.note = notes0.join(' ');
    one.planLine = '';
    return one;
  }
  var attached = int(ctx.attachmentCount, 0, 6), numbered = Math.max(attached, int(ctx.numbered, 0, chatPicture.MAX_NUMBERED));
  var asks = [], xs = [], raws = [], edits = [], notes = [], q = quotaFor(offered.length, ctx);
  offered.forEach(function (rec, i) {
    if (asks.length >= q.left) return;
    var one = Object.assign({}, rec, { state: 'offered', options: [rec.sectionId], optionNames: [rec.sectionName || ''] });
    var taken = chatPicture.takeOffer(one, Object.assign({}, ctx, { numbered: numbered + i, lastTurnPicture: one }));
    if (!taken || !taken.ask || asks.some(function (a) { return a.sectionId === taken.ask.sectionId; })) return;
    var tsec = sectionOf(ctx, taken.ask.sectionId);
    if (asks.length && tsec && tsec.role === 'records' && taken.ask.apply === 'rework') { notes.push(chatPicture.sentence('recordsLater', { name: chatPicture.nameRef(tsec) })); return; }
    (taken.edits || []).forEach(function (e) { if (e && !edits.some(function (x) { return x.sectionId === e.sectionId; })) edits.push(e); });
    if (taken.note) notes.push(taken.note);
    asks.push(taken.ask); xs.push(pictureJob.entryOf({ basedOn: 'accepted-offer' })); raws.push(rec);
  });
  if (!asks.length) return null;
  if (asks.length < offered.length && q.left < offered.length) notes.push(chatPicture.sentence('planQuota', { left: q.left, count: asks.length, skipped: 'the rest' }));
  holdPeople(asks, xs, ctx, notes);
  var jobs = asks.map(function (a, k) { return jobOf(a, xs[k], raws[k], k, ctx, { peopleRule: a.peopleRule || '' }); });
  return answer(asks, jobs, [], notes, edits, [], ctx, { regex: false, nameRun: false });
}

/* ---------- the offer a "reply" keeps ---------- */
function offerPlan(entries, summary, ctx) {
  ctx = ctx || {};
  if (!on(ctx.switches, 'plan')) { var r0 = chatPicture.offerInReply(entries, summary, ctx); return r0 ? { record: r0, jobs: [r0] } : null; }
  var list = (Array.isArray(entries) ? entries : []).filter(obj).slice(0, MAX_JOBS);
  var records = [], seen = {};
  list.forEach(function (e, i) {
    var planned = chatPicture.planAsk([e], Object.assign({}, ctx, { offering: true, sectionEdits: [], newSections: [], numbered: int(ctx.numbered, 0, chatPicture.MAX_NUMBERED) + i,
      placeWords: gateEntities(pictureJob.entryOf(e).entities, ctx).placeWords }));
    var a = planned && planned.ask;
    if (!a || seen[a.sectionId] || gateEntities(pictureJob.entryOf(e).entities, ctx).person.length) return;
    seen[a.sectionId] = true;
    records.push(chatPicture.offeredRecord({ sectionId: a.sectionId, placement: a.placement, slot: a.slot, sectionName: a.sectionName, subject: a.subject, kind: a.kind, alt: a.alt,
      options: [a.sectionId], optionNames: [a.sectionName], frame: a.apply === 'rework' && a.placement === 'picture' ? a.aspect : '' }));
  });
  if (records.length < 2) {
    var r = chatPicture.offerInReply(entries, summary, ctx);
    return r ? { record: r, jobs: [r] } : null;
  }
  var first = Object.assign({}, records[0], { options: records.map(function (x) { return x.sectionId; }), optionNames: records.map(function (x) { return x.sectionName; }) });
  return { record: first, jobs: records };
}

module.exports = { planPictures: planPictures, takeOffer: takeOffer, offerPlan: offerPlan, verifyQuote: verifyQuote, gateEntities: gateEntities, kindFor: kindFor,
  peopleMap: peopleMap, peopleBudget: peopleBudget, quotaFor: quotaFor, planLineOf: planLineOf, OPTIONS_RE: OPTIONS_RE, MAX_JOBS: MAX_JOBS };
