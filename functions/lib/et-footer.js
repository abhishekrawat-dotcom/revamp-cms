/* ET's common footer, for an AI-designed site: the footer every ET B2B portal page and event microsite ends
   with — the portal's logo and its X / Facebook / LinkedIn, the escalation line, the portal's own links (About
   Us … Sitemap), "What's Happening in <portal>" (its own events coming up) and the copyright line — built by the
   server, never written by a model. Above it, a short band for this event: its name, date and place, and its
   main button (registration), so what the old footer offered a visitor is not lost.

     info(slug)               -> PORTAL (below); a slug not in the table gets The Economic Times Business
                                 Verticals footer (ET B2B's links, no events)
     happening(events, o)     -> [EVENT] the events to show: on now or coming, dated, soonest first, at most
                                 o.max (4); never this event itself (o.name, o.series: its previous edition's
                                 address series, et-previous.js seriesOf). o.today 'YYYY-MM-DD' for tests.
     build(data)              -> { html, css }
        data = { portal: slug, mode: 'light' | 'dark' (the logo's version), year: 2026,
                 events: [EVENT] (from et-events.js listUpcoming, already passed through happening()),
                 event: { name, date, place, button: { label, href, register } } | null,
                 buttonInk: '#ffffff' | '#14161b' | '#000000' (the button's text on the theme colour, when the page
                 does not set --rv-on-theme) }

   PORTAL = { slug, site, home, logo: { onLight, onDark }, logoAlt, links: [ [[label, href]], [[label, href]] ] (columns),
              social: [{ kind: 'x'|'facebook'|'linkedin', href }], escalation: { email, who },
              showEvents: boolean, events: ET's events page | '' }

   Every link, logo address and line comes from ET's own pages (read 15 Oct 2026: each portal's event microsite
   footer, #ms_footer, and its home page). Two kinds of portal: the older ones keep ".php" on the privacy and
   terms pages (privacy_policy.php), the newer ones do not (privacy_policy) — a ".php" address there is a 404.
   The logo is the portal's wordmark kept here (templates/_shared/img/portals: <slug>.png dark ink for a light
   ground, <slug>-light.png light ink for a dark one); the page and the editor swap the two by the colour behind
   it (data-rv-portal-logo, data-rv-on-light, data-rv-on-dark).

   ONE TONE: the footer is in the page's own colours (the site's background with a faint tint of its text, its
   text and muted colours), so a light site ends light and a dark site ends dark, as ET's grey footer does on a
   white page. Everything in it is plain html the editor edits like any other section. */

var IMG = '/templates/_shared/img/';

/* the portal table. site: the name ET signs the footer with; clean: the newer kind (no ".php" on privacy and
   terms); ne: no events page (the newer single-topic portals); no: links the portal does not have (each one
   checked: a 404 or a 500 there); kk: escalation goes to Keshav Kumar (as on ET's own footers for these portals); host: when not
   <slug>.economictimes.indiatimes.com. Social links are the ones ET's own footer (or, with no microsite, the
   portal's home page) carries; a portal with none shows none. */
var T = 'https://twitter.com/', XC = 'https://x.com/', F = 'https://www.facebook.com/', L = 'https://www.linkedin.com/company/', LS = 'https://www.linkedin.com/showcase/';
var DATA = {
  agriculture: { site: 'ETAgriculture.com', clean: 1, ne: 1, li: L + 'etagriculture/' },
  auto: { site: 'ETAuto.com', x: T + 'ETAuto', fb: F + 'EconomicTimesAuto', li: LS + 'et-auto/' },
  b2b: { site: 'EconomictimesB2B.com', li: L + 'etb2b' },
  bfsi: { site: 'ETBFSI.com', x: T + 'ETBFSI', fb: F + 'ET-BFSI-485949031940865/', li: L + '14599667' },
  brandequity: { site: 'ETBrandEquity.com', x: T + 'ETBrandEquity', fb: F + 'ETBrandEquity', li: L + 'etbrandequity/' },
  cfo: { site: 'ETCFO.com', x: T + 'et_cfo', fb: F + 'ETCFO-1204332616320169/', li: LS + 'et-cfo/' },
  chemicals: { site: 'ETChemicals.com', clean: 1, ne: 1, li: L + 'etchemicals/' },
  cio: { site: 'ETCIO.com', x: T + 'ET_CIO', fb: F + 'EconomicTimesCIO', li: L + 'etcio/' },
  ciome: { site: 'ETCIO.com', clean: 1, x: XC + 'ETCIOME', li: L + 'etcio-the-middle-east' },
  ciosea: { site: 'ETCIO.com', clean: 1, x: T + 'ETCIOSEA', fb: F + 'ETCIOSEA/', li: L + 'etcio-south-east-asia' },
  ciso: { site: 'ETCISO.in', x: T + 'ET_CISO', fb: F + 'ET-CISO-240367089728887/', li: LS + 'et-ciso' },
  climate: { site: 'ETClimate.com', clean: 1, ne: 1, li: L + 'etclimate/' },
  construction: { site: 'ETConstruction.com', clean: 1, ne: 1, li: L + 'etconstructionworld/' },
  crypto: { site: 'ETCryptoWorld.com', clean: 1, ne: 1, li: L + 'etcryptoworld/' },
  datacenters: { site: 'ETDatacenters.com', clean: 1, li: L + 'et-datacenters/' },
  defence: { site: 'ETDefence.com', clean: 1, ne: 1, li: L + 'etdefence/' },
  drones: { site: 'ETDrones.com', clean: 1, ne: 1, li: L + 'etdronesworld/' },
  education: { site: 'ETEducation.com', x: T + 'ETEducation_', fb: F + 'eteducation/', li: L + 'economictimeseducation/' },
  electronics: { site: 'ETElectronicsWorld.com', clean: 1, li: L + 'etelectronicsworld/' },
  energy: { site: 'ETEnergyworld.com', x: T + 'ETEnergyWorld', fb: F + 'ETEnergyWorld', li: LS + 'et-energyworld/' },
  energymea: { site: 'ETEnergyworld.com', no: ['sitemap'], x: T + 'etenergymea', fb: F + 'profile.php?id=61551613677360', li: L + 'etenergyworld-mea' },
  enterpriseai: { site: 'ETEnterpriseai.com', x: XC + 'etenterpri72593', fb: F + 'profile.php?id=61576940451782', li: L + 'etaiworld/' },
  entrepreneur: { site: 'ETEntrepreneur.com', li: L + 'etentrepreneur' },
  facilities: { site: 'ETFacilities.com', clean: 1, ne: 1, li: L + 'etfacilities/' },
  food: { site: 'ETFood.com', clean: 1, ne: 1, li: L + 'etfoodworld/' },
  gcc: { site: 'ETGCCWorld.com', x: XC + 'et_gcc', fb: F + 'profile.php?id=61573147364805', li: L + 'et-gcc/' },
  geospatial: { site: 'ETGeospatial.com', clean: 1, ne: 1, li: L + 'etgeospatial/' },
  government: { site: 'ETGovernment.com', x: T + 'ET_Government', fb: F + 'ETGovernment', li: L + 'et-goverment/' },
  health: { site: 'ETHealthworld.com', x: T + 'ETHealthWorld', fb: F + 'pages/ETHealthworld/299165230290200', li: LS + 'et-healthworld/' },
  /* ET's own footer here still links privacy_policy.php and terms_conditions.php, which are 404s */
  hospitality: { site: 'ETHospitalityWorld.com', clean: 1, kk: 1, x: T + 'ETHospitality_', fb: F + 'ETHospitalityworld-105359057734817/', li: L + 'ethospitalityworld' },
  hr: { site: 'ETHRWorld.com', x: T + 'ethrworld', fb: F + 'ETHRWorld-103936844611325', li: L + 'ethrworld' },
  hrme: { site: 'ETHRWorld.com', x: T + 'ETHRWorldME', fb: F + 'ETHRWorld-The-Middle-East-109870898204127', li: L + 'ethrworld-the-middle-east/' },
  hrsea: { site: 'ETHRWorld.com', x: XC + 'ETHRWorldSEA', fb: F + 'ETHRWorldSEA/', li: L + 'ethrworld-south-east-asia/' },
  infra: { site: 'ETInfra.com', kk: 1, x: T + 'ET_Infra', li: L + 'et-infra' },
  jewellery: { site: 'ETJewellery.com', clean: 1, ne: 1, li: L + 'etjewelleryworld/' },
  legal: { site: 'ETLegalWorld.com', x: T + 'EtLegalworld', fb: F + 'ETLegalworld-102949968058742', li: L + 'etlegalworld/' },
  machinetools: { site: 'ETMachineTools.com', clean: 1, ne: 1, li: L + 'etmachinetools/' },
  /* ET's own page links X to "twitter.com/Manufacturing", which is not ET's account: left out */
  manufacturing: { site: 'ETManufacturing.in', fb: F + 'ETManufacturing', li: L + 'etmanufacturing' },
  /* ET Masterclass is a course site: of the portal pages only its privacy policy and terms exist */
  masterclass: { site: 'ETMasterclass.com', no: ['about', 'contact', 'advertise', 'newsletter', 'rss', 'invite', 'guest', 'sitemap'], x: XC + 'EtMasterclass', fb: F + 'ETMasterclass/', li: LS + 'et-masterclass/' },
  packaging: { site: 'ETPackaging.com', clean: 1, ne: 1, li: L + 'etpackaging/' },
  pharma: { site: 'ETPharma.com', x: T + 'ETPharma', fb: F + 'ETPharma', li: L + 'et-pharma/' },
  rajasthan: { site: 'ETRajasthan.com', clean: 1, ne: 1, li: L + 'etrajasthan/' },
  realty: { site: 'ETRealty.com', x: T + 'Realty_Et', fb: F + 'ETRealty', li: LS + 'et-realty' },
  retail: { site: 'ETRetail.com', x: T + 'EtRetail', fb: F + 'EtRetail', li: LS + 'et-retail' },
  safety: { site: 'ETSafety.com', clean: 1, ne: 1, no: ['rss', 'sitemap'] },
  salon: { site: 'ETSalon.com', clean: 1, ne: 1, li: L + 'etsalonworld/' },
  sports: { site: 'ETSports.com', clean: 1, ne: 1, li: L + 'etsportsworld/' },
  /* startup.economictimes.indiatimes.com is ET Entrepreneur's site under another name */
  startup: { site: 'ETEntrepreneur.com', host: 'entrepreneur.economictimes.indiatimes.com', li: L + 'etentrepreneur' },
  supplychain: { site: 'ETSupplychain.com', clean: 1, kk: 1, li: L + 'etsupplychain/' },
  sustainability: { site: 'ETSustainability.com', clean: 1, x: XC + 'ETSustain', li: L + 'etsustainability' },
  techmonk: { site: 'techgig.com', host: 'techgig.com', kk: 1, x: XC + 'ETTechGig', fb: F + 'share/18JYdc9c1e/', li: L + 'et-techgig' },
  telecom: { site: 'ETTelecom.com', x: T + 'Ettelecom', fb: F + 'ettelecom', li: LS + 'et-telecom/' },
  textile: { site: 'ETTextile.com', clean: 1, ne: 1, li: L + 'ettextile/' },
  travel: { site: 'ETTravelWorld.com', clean: 1, kk: 1, x: T + 'ETTravelWorld', li: L + 'ettravelworld/' },
  wastemanagement: { site: 'ETWasteManagement.com', clean: 1, ne: 1, li: L + 'etwastemanagement/' },
  workplace: { site: 'ETWorkplace.com', clean: 1, li: L + 'etworkplace/' }
};

var ESCALATION = {
  shahbaz: { email: 'shahbaz.khan@timesinternet.in', who: 'Md. Shahbaz Khan, Director - Special Initiatives & Business Strategy, The Economic Times Business Verticals.' },
  keshav: { email: 'keshav.kumar@timesinternet.in', who: 'Keshav Kumar, Director - Brand Solutions And Product Marketing Strategy, The Economic Times Business Verticals.' }
};

/* The Economic Times Business Verticals footer, for a site whose portal is not known: ET B2B's own pages */
var FALLBACK = 'b2b';

function own(obj, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k); }
function isKnown(slug) { return own(DATA, slug); }

function info(slug) {
  var known = own(DATA, slug);
  var key = known ? slug : FALLBACK, d = DATA[key];
  var home = 'https://' + (d.host || key + '.economictimes.indiatimes.com');
  var php = d.clean ? '' : '.php';
  var social = [];
  if (d.x) social.push({ kind: 'x', href: d.x });
  if (d.fb) social.push({ kind: 'facebook', href: d.fb });
  if (d.li) social.push({ kind: 'linkedin', href: d.li });
  return {
    slug: known ? slug : '', site: d.site, home: home,
    logo: known
      ? { onLight: IMG + 'portals/' + slug + '.png', onDark: IMG + 'portals/' + slug + '-light.png' }
      : { onLight: IMG + 'et-business-verticals-on-light.svg', onDark: IMG + 'et-business-verticals-on-dark.svg' },
    logoAlt: known ? d.site : 'The Economic Times Business Verticals',
    links: [
      [['about', 'About Us', home + '/about_us.php'], ['contact', 'Contact Us', home + '/contact_us.php'], ['advertise', 'Advertise with us', home + '/contact_us.php'],
        ['newsletter', 'Newsletter', home + '/etnewsletter.php'], ['rss', 'RSS Feeds', home + '/rss'], ['invite', 'Invite Friends', home + '/invite']],
      [['privacy', 'Privacy Policy', home + '/privacy_policy' + php], ['terms', 'Terms & Conditions', home + '/terms_conditions' + php],
        ['guest', 'Guest-Post Guidelines', home + '/guest-post-guidelines'], ['sitemap', 'Sitemap', home + '/sitemap']]
    ].map(function (col) {
      return col.filter(function (l) { return !(d.no && d.no.indexOf(l[0]) !== -1); }).map(function (l) { return [l[1], l[2]]; });
    }).filter(function (col) { return col.length; }),
    social: social,
    escalation: ESCALATION[d.kk ? 'keshav' : 'shahbaz'],
    /* whether "What's Happening" is shown (an unknown portal's events are not ours to show), and ET's events
       page its heading links to, when the portal has one */
    showEvents: known,
    events: known && !d.ne ? home + '/events' : ''
  };
}

/* ---------- "What's Happening" ---------- */
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* "26 Nov '26", as ET's footer writes it */
function shortDate(start) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(start || ''));
  return m && +m[2] >= 1 && +m[2] <= 12 ? (+m[3] < 10 ? '0' : '') + (+m[3]) + ' ' + MON[+m[2] - 1] + ' \'' + m[1].slice(2) : '';
}
function words(s) { return String(s || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function seriesOfLink(link) {
  var m = /^https?:\/\/[^\/?#]+\/([^?#]*)/i.exec(String(link || ''));
  var parts = (m ? m[1] : '').split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'microsite') parts.shift();
  return String(parts[0] || '').toLowerCase().replace(/[-_]?(?:19|20)\d{2}$/, '').replace(/[-_]+$/, '');
}
function happening(events, o) {
  o = o || {};
  var today = /^\d{4}-\d{2}-\d{2}$/.test(String(o.today || '')) ? o.today : new Date().toISOString().slice(0, 10);
  var max = o.max > 0 ? o.max : 4, name = words(o.name), series = String(o.series || '').toLowerCase();
  return (Array.isArray(events) ? events : []).filter(function (e) {
    if (!e || e.past || !e.title || !/^https:\/\//i.test(String(e.link || '')) || !shortDate(e.start)) return false;
    if (String(e.end || e.start).slice(0, 10) < today) return false;       // over, though still listed
    if (series && seriesOfLink(e.link) === series) return false;             // this event's own next edition
    if (name && words(e.title) === name) return false;
    return true;
  }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }).slice(0, max);
}

/* ---------- the markup ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function httpsUrl(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function hrefOf(u) { u = String(u || '').trim(); return /^(#[A-Za-z][\w-]*|https:\/\/[^\s"'<>]+)$/.test(u) ? u : ''; }

var ICONS = {
  x: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2.1L14.1 2C10.9 2 10.2 4.4 10.2 5.9v2.6H8v3.8h2.2V22h3.8v-9.7h2.9l.4-3.8H14z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3V9.75zm6.5 0h3.8v1.54h.05c.53-1 1.83-2.05 3.76-2.05 4.02 0 4.76 2.65 4.76 6.08V21h-4v-5.02c0-1.2-.02-2.74-1.67-2.74-1.67 0-1.93 1.3-1.93 2.65V21h-4V9.75z"/></svg>'
};
var SOCIAL_NAME = { x: 'X', facebook: 'Facebook', linkedin: 'LinkedIn' };

function build(data) {
  data = data || {};
  var p = info(data.portal);
  var dark = data.mode === 'dark';
  var year = +data.year > 2000 ? +data.year : new Date().getFullYear();
  var c = 'etf';
  var ext = ' target="_blank" rel="noopener"';

  /* this event: its name, date and place, and its main button */
  var ev = data.event || null, band = '';
  if (ev && ev.name) {
    var meta = [ev.date, ev.place].filter(Boolean).map(esc).join(' <span aria-hidden="true">·</span> ');
    var b = ev.button || {}, bHref = hrefOf(b.href);
    band = '<div class="' + c + '-event"><div class="' + c + '-in ' + c + '-event-in">' +
      '<div class="' + c + '-event-text"><p class="' + c + '-event-name">' + esc(ev.name) + '</p>' +
      (meta ? '<p class="' + c + '-event-meta">' + meta + '</p>' : '') + '</div>' +
      (b.label && bHref ? '<a class="' + c + '-event-btn"' + (b.register === false ? '' : ' data-register-cta') + ' href="' + esc(bHref) + '">' + esc(b.label) + '</a>' : '') +
      '</div></div>';
  }

  var logo = '<a class="' + c + '-logo-link" href="' + esc(p.home) + '"' + ext + '>' +
    '<img class="' + c + '-logo" data-rv-portal-logo data-rv-on-light="' + esc(p.logo.onLight) + '" data-rv-on-dark="' + esc(p.logo.onDark) + '" src="' + esc(dark ? p.logo.onDark : p.logo.onLight) + '" alt="' + esc(p.logoAlt) + '"></a>';
  var social = p.social.length ? '<div class="' + c + '-social">' + p.social.map(function (s) {
    return '<a href="' + esc(s.href) + '" target="_blank" rel="noopener nofollow" aria-label="' + esc(p.site + ' on ' + SOCIAL_NAME[s.kind]) + '">' + ICONS[s.kind] + '</a>';
  }).join('') + '</div>' : '';

  var cols = p.links.map(function (col) {
    return '<ul class="' + c + '-links">' + col.map(function (l) { return '<li><a href="' + esc(l[1]) + '"' + ext + '>' + esc(l[0]) + '</a></li>'; }).join('') + '</ul>';
  }).join('');

  var cards = (p.showEvents && Array.isArray(data.events) ? data.events : []).map(function (e) {
    var link = httpsUrl(e.link), img = httpsUrl(e.logo), when = shortDate(e.start);
    if (!link || !e.title) return '';
    return '<li class="' + c + '-card"><a href="' + esc(link) + '"' + ext + '>' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="' + c + '-card-blank" aria-hidden="true"></span>') +
      '<span class="' + c + '-cap">' + esc(e.title) + (when ? ' | ' + esc(when) : '') + '</span></a></li>';
  }).join('');
  var title = 'What\'s Happening in ' + esc(p.site);
  var events = cards ? '<div class="' + c + '-happening"><h2 class="' + c + '-h">' + (p.events ? '<a href="' + esc(p.events) + '"' + ext + '>' + title + '</a>' : title) + '</h2>' +
    '<ul class="' + c + '-cards">' + cards + '</ul></div>' : '';

  var html = '<footer id="footer" class="' + c + '" data-rv-et-footer="' + esc(p.slug || 'et') + '">' + band +
    '<div class="' + c + '-top"><div class="' + c + '-in ' + c + '-top-in">' + logo + social + '</div></div>' +
    '<div class="' + c + '-in ' + c + '-body">' +
    '<p class="' + c + '-esc">For any issues requiring immediate escalation, please write to <a href="mailto:' + esc(p.escalation.email) + '">' + esc(p.escalation.email) + '</a> - ' + esc(p.escalation.who) + '</p>' +
    '<div class="' + c + '-grid">' + cols + events + '</div>' +
    '<p class="' + c + '-copy">Copyright © <span data-rv-year>' + year + '</span> ' + esc(p.site) + '. All Rights Reserved.</p>' +
    '</div></footer>';

  var ink = /^#[0-9a-f]{6}$/i.test(String(data.buttonInk || '')) ? data.buttonInk : '#ffffff';
  var rule = 'color-mix(in srgb,var(--rv-text) 13%,transparent)';
  var css = [
    /* the page's own ground with a faint tint of its text: ET's calm grey on a white page, a shade lifted on a dark one */
    '.' + c + '{background-color:var(--rv-bg);background-image:linear-gradient(color-mix(in srgb,var(--rv-text) 4%,transparent),color-mix(in srgb,var(--rv-text) 4%,transparent));color:var(--rv-muted);font-family:var(--body-font-family);font-size:0.875rem;line-height:1.55;border-top:1px solid ' + rule + '}',
    '.' + c + '-in{max-width:1200px;margin:0 auto;padding-left:24px;padding-right:24px;box-sizing:border-box}',
    '.' + c + '-event{border-bottom:1px solid ' + rule + '}',
    '.' + c + '-event-in{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:18px 32px;padding-top:32px;padding-bottom:32px}',
    '.' + c + '-event-text{min-width:0;flex:1 1 320px}',
    '.' + c + '-event-name{margin:0;font-family:var(--heading-font-family);font-size:1.375rem;font-weight:700;line-height:1.25;color:var(--rv-text);overflow-wrap:anywhere}',
    '.' + c + '-event-meta{margin:6px 0 0;font-size:0.9375rem;line-height:1.5;color:var(--rv-muted)}',
    /* the button keeps its ink in every theme (its ground is the theme colour): the page's button ground and words
       (--rv-theme-fill, --rv-on-theme: rv-theme.js derivedVars, 4.5:1), this colour's own ink as the fallback */
    '.' + c + '-event-btn{--rv-keep:1;display:inline-flex;align-items:center;justify-content:center;text-align:center;padding:14px 30px;border-radius:var(--rv-radius,8px);background:var(--rv-theme-fill,var(--theme-color));color:var(--rv-on-theme,' + ink + ');font-family:var(--body-font-family);font-size:0.9375rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;line-height:1.2;text-decoration:none;transition:transform .25s ease,box-shadow .25s ease}',
    '.' + c + '-event-btn:hover{transform:translateY(-2px);box-shadow:0 10px 22px -12px rgba(0,0,0,.5)}',
    '.' + c + '-top{border-bottom:1px solid ' + rule + '}',
    '.' + c + '-top-in{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px 24px;padding-top:20px;padding-bottom:20px}',
    '.' + c + '-logo-link{display:inline-block;line-height:0;max-width:100%}',
    '.' + c + '-logo{display:block;height:28px;width:auto;max-width:min(260px,100%);object-fit:contain;object-position:left center}',
    '.' + c + '-social{display:flex;gap:10px}',
    '.' + c + '-social a{width:34px;height:34px;box-sizing:border-box;border:1px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--rv-muted);transition:color .2s ease}',
    '.' + c + '-social a:hover{color:var(--theme-color)}',
    '.' + c + '-social svg{display:block}',
    '.' + c + '-body{padding-top:24px;padding-bottom:28px}',
    '.' + c + '-esc{margin:0 0 22px;max-width:760px;font-size:0.875rem;line-height:1.6;color:var(--rv-muted)}',
    '.' + c + '-esc a{color:var(--rv-text);font-weight:600;text-decoration:none;overflow-wrap:anywhere}',
    '.' + c + '-grid{display:grid;grid-template-columns:1fr 1fr 2fr;gap:24px 32px;align-items:start}',
    '.' + c + '-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.' + c + '-links a{color:var(--rv-muted);text-decoration:none;transition:color .2s ease}',
    '.' + c + '-links a:hover{color:var(--rv-text)}',
    '.' + c + '-h{margin:0 0 14px;font-family:var(--body-font-family);font-size:1rem;font-weight:700;line-height:1.35;letter-spacing:0;text-transform:none;color:var(--rv-text)}',
    '.' + c + '-h a{color:inherit;text-decoration:none}',
    '.' + c + '-cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,120px));gap:16px}',
    '.' + c + '-card a{display:block;color:var(--rv-muted);text-decoration:none}',
    '.' + c + '-card img,.' + c + '-card-blank{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:4px;margin:0 0 8px;border:1px solid ' + rule + ';box-sizing:border-box}',
    '.' + c + '-cap{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:0.875rem;line-height:1.4;overflow-wrap:anywhere}',
    '.' + c + '-card a:hover .' + c + '-cap{color:var(--rv-text)}',
    '.' + c + '-copy{margin:28px 0 0;text-align:center;font-size:0.875rem;color:var(--rv-muted)}',
    '@media (max-width:820px){.' + c + '-grid{grid-template-columns:1fr 1fr}.' + c + '-happening{grid-column:1/-1}}',
    '@media (max-width:520px){.' + c + '-in{padding-left:16px;padding-right:16px}.' + c + '-event-btn{width:100%}.' + c + '-cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.' + c + '-grid{gap:20px 16px}}'
  ].join('');
  return { html: html, css: css };
}

module.exports = { info, isKnown, happening, build, shortDate, DATA, ESCALATION };
