/* Real "previous edition" data for create-event.html's Pull content (step 1) and Clone design (step 2)
   flows — replaces the hardcoded PAST_EDITIONS fixture as the data SOURCE only. applyPastEditionContent()
   and the clone-design flow in create-event.html are unchanged; they already consume a content{} shape
   exactly like what realEditionContent() below produces.

   Speakers/Agenda/Sponsors come from edit-event.html's own per-event storage (localStorage,
   'revamp-edit-event-<id>', the same key RevampCore.loadState/saveState use) — real data a user entered
   there, not canned content. Overview/Glimpses have no real per-event source anywhere in the app today
   (edit-event.html uses shared hardcoded copy for both), so they're simply never offered from a real
   edition — same as any edition that never filled a given block, which the existing pull-content flow
   already treats as "keep the template's default content".

   Clone design additionally needs to know which template a past event used, which nothing records for
   RevampCore's seed events (they were never built through this wizard). A small registry this wizard
   writes to on its own hand-off (registerEventTemplate(), called from openInEditor()) tracks that
   going forward; only events present in it are offered as clone-design candidates — honest behavior
   rather than guessing a template for an event that was never actually assembled here. */
(function () {
  'use strict';

  var TEMPLATE_REGISTRY_KEY = 'revamp.eventTemplates.v1';
  var CAT_BY_TYPE = { ip: 'IP', client: 'Client', awards: 'Awards', leadgen: 'Client', editorial: 'IP', roundtable: 'Client' };

  function readEventState(id) {
    try {
      var raw = localStorage.getItem('revamp-edit-event-' + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function realEditions() {
    var C = window.RevampCore;
    if (!C || !C.EVENTS) return [];
    return C.EVENTS.map(function (ev) {
      return { id: ev.id, name: ev.name, cat: CAT_BY_TYPE[ev.type] || 'IP' };
    });
  }

  /* events offered in the "Bring in content" picker — any real event; content presence is checked per-field */
  function editionsForCategory(cat) {
    return realEditions().filter(function (e) { return e.cat === cat; });
  }

  /* Events this wizard itself has built, pulled from the same registry registerEventTemplate() writes to.
     RevampCore.EVENTS is a static seed array — a newly-created event never joins it (no backend), so without
     this a "Clone design" picker could never show anything real within a single browser session either.
     Keyed by event slug (there's no numeric EVENTS id for a wizard-created event). */
  function wizardCreatedEditions(cat) {
    try {
      var raw = localStorage.getItem(TEMPLATE_REGISTRY_KEY);
      var map = raw ? JSON.parse(raw) : {};
      return Object.keys(map)
        .map(function (key) { return Object.assign({ id: key }, map[key]); })
        .filter(function (e) { return e.templateId && (!cat || e.cat === cat); });
    } catch (e) { return []; }
  }

  /* events offered in "Clone design" — real RevampCore events with a recorded template (none today — see
     registerEventTemplate()) plus any event actually built with this wizard this session/browser */
  function editionsWithTemplate(cat) {
    var fromCore = editionsForCategory(cat)
      .map(function (e) { return Object.assign({}, e, { templateId: eventTemplateId(e.id) }); })
      .filter(function (e) { return !!e.templateId; });
    return fromCore.concat(wizardCreatedEditions(cat));
  }

  function speakersContent(state) {
    if (!state || !state.speakers || !state.speakers.length) return null;
    return { items: state.speakers.map(function (p) { return { n: p.name || '', r: p.desig || '', c: p.comp || '' }; }) };
  }

  function agendaContent(state) {
    if (!state || !state.sessions || !state.sessions.length) return null;
    var byId = {};
    (state.speakers || []).forEach(function (p) { byId[p.id] = p.name; });
    return {
      items: state.sessions.map(function (s) {
        return { t: s.start || '', ti: s.title || '', sp: (s.speakers || []).map(function (id) { return byId[id]; }).filter(Boolean).join(', ') };
      })
    };
  }

  function partnersContent(state) {
    if (!state || !state.spTiers || !state.spTiers.length) return null;
    var tiers = state.spTiers.map(function (tier) {
      return { t: tier.name, logos: (state.partners || []).filter(function (p) { return p.tid === tier.id; }).map(function (p) { return { n: p.name }; }) };
    }).filter(function (t) { return t.logos.length; });
    return tiers.length ? { tiers: tiers } : null;
  }

  /* content{} shaped exactly like the old PAST_EDITIONS[*].content — applyPastEditionContent() in
     create-event.html reads it unchanged. Only libIds the real event has actual stored data for are
     present; everything else keeps the template's default content, same as today. */
  function realEditionContent(eventId) {
    var state = readEventState(eventId);
    if (!state) return null;
    var content = {};
    var sp = speakersContent(state); if (sp) content.speakers = sp;
    var ag = agendaContent(state); if (ag) content.agenda = ag;
    var pt = partnersContent(state); if (pt) content.partners = pt;
    return Object.keys(content).length ? content : null;
  }

  function registerEventTemplate(eventKey, templateId, meta) {
    if (!eventKey || !templateId) return;
    try {
      var raw = localStorage.getItem(TEMPLATE_REGISTRY_KEY);
      var map = raw ? JSON.parse(raw) : {};
      map[eventKey] = Object.assign({ templateId: templateId, savedAt: Date.now() }, meta || {});
      localStorage.setItem(TEMPLATE_REGISTRY_KEY, JSON.stringify(map));
    } catch (e) {}
  }
  function eventTemplateId(eventKey) {
    try {
      var raw = localStorage.getItem(TEMPLATE_REGISTRY_KEY);
      var map = raw ? JSON.parse(raw) : {};
      return (map[eventKey] && map[eventKey].templateId) || null;
    } catch (e) { return null; }
  }

  window.RevampEditions = {
    editionsForCategory: editionsForCategory,
    editionsWithTemplate: editionsWithTemplate,
    contentFor: realEditionContent,
    registerEventTemplate: registerEventTemplate,
    eventTemplateId: eventTemplateId
  };
})();
