/* portal-fields.js — what each ET portal's events are about, for the first hero picture ETB2B AI makes.

   An event ETB2B AI starts on the events dashboard gets a first hero picture (functions/lib/ai-hero.js). When the
   person did not say what it should show, the picture is of the event's FIELD at its PLACE, and the field comes
   from the event's portal: an ETHRWorld event gets workplaces, an ETAuto one vehicles and roads. Never from the
   event's name: an image model letters a name onto the picture, and a name steers what is drawn ("Dashbot" drew
   robots for an HR event, QA 3 Nov 2026).

     RevampPortalFields.FIELDS                 { slug: { field, scene } }, one entry for every portal on ET's roster
                                               (functions/lib/et-events.js PORTALS; portal-fields.test.js holds the
                                               two together, both ways)
       field: a few words for people ("technology leadership"): what Create Event's line, the event's History and
              the editor's toast say the picture is of
       scene: what the picture shows, for the image model: the field's places and objects only. Never a person
              (the hero's rules allow none), never a brand, a word or a number to be lettered. And never a thing
              that carries writing: no screens, monitors, displays, dashboards, charts or graphs, no signs, boards
              (white, bill, score, circuit) or panels, no books, maps, labels or packaging that is not plain. An
              image model letters every such surface with made-up glyphs, even when told to carry no text (QA
              follow-up 3: a floating "dashboard panel" read "DU HGR" on an ETHRWorld hero), and the picture check
              then refuses the picture. Goods, vehicles and containers are said to be plain or unmarked.
     RevampPortalFields.KEEP_OUT               what the server says after every scene, in so many words: no screens,
                                               monitors, dashboards, charts, signs, boards or panels anywhere in the
                                               picture (the scene names none, and the key visual's "symbols of the
                                               field" must not bring them in either)
     RevampPortalFields.DEFAULT                { field, scene } for an event with no portal yet (or one off the roster)
     RevampPortalFields.fieldOf(slug)          -> { field, scene, portal: true when the slug is on the table }
     RevampPortalFields.place(venue, city)     -> "Jio World Centre, Mumbai": the venue, then the city unless the venue
                                               already names it (Create Event has one "Venue & city" box)
     RevampPortalFields.subject(slug, venue, city)
                                               -> "technology leadership, Jio World Centre, Mumbai": the picture's
                                               subject when the person gave none, as the page shows it and the server
                                               records it

   Create Event (create-event.html) loads this file and reads window.RevampPortalFields; the server
   (functions/lib/ai-hero.js) requires it, so the line the person reads and the picture that is made agree.

   ES5 on purpose (var, function, no arrows): the page serves it as it is, with no build step. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RevampPortalFields = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* the places, objects and machines of each field. People-heavy fields (HR, workplaces, learning) are drawn as
     their places with no one in them, as the hero's picture rules ask. */
  var HR = { field: 'people and workplaces', scene: 'bright modern offices, open workspaces, campuses and learning spaces, with no one in them' };
  var CIO = { field: 'technology leadership', scene: 'data centres, rows of servers, fibre-optic light and cloud networks drawn as glowing lines' };
  var ENERGY = { field: 'energy', scene: 'solar farms, wind turbines, power lines and refineries' };
  var STARTUP = { field: 'startups', scene: 'co-working spaces, product prototypes and a rising city skyline' };

  var FIELDS = {
    brandequity: { field: 'marketing and advertising', scene: 'creative studios, cameras, spotlights, product forms and bold colour' },
    cio: CIO,
    ciso: { field: 'cybersecurity', scene: 'secure networks, a shield and a lock drawn in light, and protected server halls' },
    infra: { field: 'infrastructure', scene: 'bridges, highways, metro lines, ports and cranes' },
    cfo: { field: 'finance leadership', scene: 'financial district towers, glass atriums and polished stone lobbies in golden light' },
    hr: HR,
    retail: { field: 'retail', scene: 'modern store interiors, shelves of plain unmarked goods, plain shopping bags and carts' },
    health: { field: 'healthcare', scene: 'hospitals, laboratories, microscopes, stethoscopes and calm care spaces' },
    auto: { field: 'mobility and vehicles', scene: 'sleek unbadged cars and electric vehicles, charging cables and open roads' },
    telecom: { field: 'telecommunications', scene: 'telecom towers, fibre optics, satellites and connected networks' },
    bfsi: { field: 'banking and finance', scene: 'bank buildings, vaults, glowing network lines and financial district towers' },
    energy: ENERGY,
    government: { field: 'government and public services', scene: 'civic buildings, public infrastructure and networks drawn as connected light' },
    legal: { field: 'law and legal practice', scene: 'courthouses, stone columns, scales of justice and a gavel' },
    realty: { field: 'real estate', scene: 'residential towers, homes, construction skylines and architectural models' },
    education: { field: 'education', scene: 'campuses, sunlit lecture halls and quiet courtyards, with no one in them' },
    manufacturing: { field: 'manufacturing', scene: 'factory floors, robotic arms, assembly lines and precision machines' },
    supplychain: { field: 'supply chain and logistics', scene: 'warehouses, plain unmarked shipping containers, trucks and conveyor lines' },
    travel: { field: 'travel and tourism', scene: 'plain white aircraft above the clouds, luggage and far-away destinations' },
    hospitality: { field: 'hospitality', scene: 'hotel lobbies, restaurants, laid dining tables and resorts' },
    b2b: { field: 'business and industry', scene: 'a modern business district, industry and connected markets' },
    masterclass: { field: 'professional learning', scene: 'lecture halls, workshops and learning spaces, with no one in them' },
    hrsea: HR,
    hrme: HR,
    ciosea: CIO,
    ciome: CIO,
    pharma: { field: 'pharmaceuticals', scene: 'laboratories, capsules, molecules and research equipment' },
    gcc: { field: 'global capability centres', scene: 'modern technology campuses, office towers and connected global networks' },
    enterpriseai: { field: 'enterprise AI', scene: 'neural networks drawn in light, data centres and glowing unmarked chips' },
    techmonk: { field: 'technology', scene: 'glowing circuitry, unmarked chips and digital networks drawn in light' },
    entrepreneur: { field: 'entrepreneurship', scene: 'co-working spaces, product prototypes and a rising city skyline' },
    datacenters: { field: 'data centres', scene: 'server halls, racks, cooling systems and fibre networks' },
    electronics: { field: 'electronics', scene: 'glowing circuitry, unmarked chips and electronic components' },
    energymea: ENERGY,
    sustainability: { field: 'sustainability', scene: 'green buildings, solar farms, forests and clean water' },
    workplace: { field: 'workplaces', scene: 'modern offices, workspaces and building interiors, with no one in them' },
    agriculture: { field: 'agriculture', scene: 'fields of crops, tractors, irrigation and harvests' },
    chemicals: { field: 'chemicals', scene: 'chemical plants, pipelines, flasks and molecules' },
    climate: { field: 'climate action', scene: 'wind and solar power, forests, oceans and clean skies' },
    construction: { field: 'construction', scene: 'cranes, building sites, steel frames and concrete' },
    crypto: { field: 'crypto and digital assets', scene: 'blockchain networks drawn as linked blocks of light and digital vaults' },
    defence: { field: 'defence and aerospace', scene: 'aircraft, naval ships, radar dishes and aerospace engineering' },
    drones: { field: 'drones', scene: 'drones in flight and aerial views of fields and cities' },
    facilities: { field: 'facility management', scene: 'smart buildings, building systems and clean, well-kept spaces' },
    food: { field: 'food and beverages', scene: 'fresh produce, kitchens and food processing lines' },
    geospatial: { field: 'geospatial technology', scene: 'satellites, terrain seen from above and contour lines of light' },
    jewellery: { field: 'jewellery', scene: 'gems, gold, diamonds and fine craftsmanship' },
    machinetools: { field: 'machine tools', scene: 'lathes, milling machines, precision tools and metalwork' },
    packaging: { field: 'packaging', scene: 'plain unmarked boxes, cartons and packaging lines' },
    rajasthan: { field: 'business in Rajasthan', scene: 'the forts, palaces and desert landscapes of Rajasthan beside modern industry' },
    safety: { field: 'workplace safety', scene: 'hard hats, safety gear, guard rails and well-lit industrial sites' },
    salon: { field: 'beauty and salons', scene: 'salon interiors, mirrors, styling tools and plain unlabelled bottles' },
    shipping: { field: 'shipping and ports', scene: 'container ships with plain unmarked containers, ports, cranes and the open sea' },
    sports: { field: 'sports business', scene: 'stadiums, playing fields, sports equipment and floodlights' },
    startup: STARTUP,
    textile: { field: 'textiles', scene: 'fabrics, looms, threads and weaving' },
    wastemanagement: { field: 'waste management', scene: 'recycling plants, sorting lines, bins and clean cities' }
  };
  /* an event with no portal yet: a picture of business in general, never of its name */
  var DEFAULT = { field: 'business and industry', scene: 'a modern business district, industry and connected markets' };
  /* said after every scene (functions/lib/ai-hero.js sceneOf): the scene names no such thing, and this keeps the model
     from adding one, since the key visual's own lines ask for "the symbols of the field" and a model draws a chart or
     a dashboard for one and letters it */
  var KEEP_OUT = 'and no screens, monitors, dashboards, charts, signs, boards or panels anywhere in it';
  /* frozen: the page and every server request share these objects, and a caller that changed one would change it
     for all of them */
  Object.keys(FIELDS).forEach(function (k) { Object.freeze(FIELDS[k]); });
  Object.freeze(FIELDS);
  Object.freeze(DEFAULT);

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* one line of text, at most `max` characters */
  function line(v, max) {
    return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function fieldOf(slug) {
    var hit = typeof slug === 'string' && own(FIELDS, slug) ? FIELDS[slug] : null;
    return hit ? { field: hit.field, scene: hit.scene, portal: true } : { field: DEFAULT.field, scene: DEFAULT.scene, portal: false };
  }
  function place(venue, city) {
    var v = line(venue, 120), c = line(city, 60);
    return v && c && v.toLowerCase().indexOf(c.toLowerCase()) === -1 ? v + ', ' + c : (v || c);
  }
  function subject(slug, venue, city) {
    return [fieldOf(slug).field, place(venue, city)].filter(function (x) { return !!x; }).join(', ').slice(0, 200);
  }

  return { FIELDS: FIELDS, DEFAULT: DEFAULT, KEEP_OUT: KEEP_OUT, fieldOf: fieldOf, place: place, subject: subject };
});
