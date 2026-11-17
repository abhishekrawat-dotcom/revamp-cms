/* "Describe the event", filled in from the previous edition ETB2B already has (owner, 17 Nov 2026).
   Create Event asks for it once an edition is picked from ETB2B's list (GET /api/et/edition-brief). Every line comes
   from ETB2B's own records for that edition, read as they are, with no AI call: a line ETB2B has nothing for stays
   empty after its heading. What the records give (asked 17 Nov 2026, BrandEquity's Brand World Summit South 2026):

     /v1/microsite/details?digital_month_id=<id>   (et-previous.js reads the same record)
       synopsis              one line under the name ("The Biggest Congregation of Marketers in South India")  -> Tagline / theme
       why_join_us           a JSON list of reasons to come                                                     -> Why attend
       who_should_attend     a JSON list of job titles and groups                                               -> Audience
       key_discussion_points a JSON list of topics: Why attend when why_join_us is empty
       company_description   the event's long text: Tagline when synopsis is empty (its first sentence)
       total_registrations   how many registered for it                                                         -> Expected scale
       is_dark_light_theme / forced_theme, template_settings.font_family                                         -> Look and tone
       faq, about_us, seo.*  the questions, the portal's own about text, search text: not lines of the description
     /v1/event-listing (et-events.js): speakers_cnt and action_name ("Register Now")                             -> Expected scale, Main action
     /v1/activity/sponsor/list?entity_id=<id>     the partners, counted                                         -> Expected scale
   Industry is the portal's own field (PORTAL_INDUSTRY); Level is said only when the name says it (South, Global…).

     linesOf(details, listed, o)  -> LINES   o: { kind: 'event' | 'award', portal, partners }
     readEditionBrief(portal, id, kind, fetchJson, listed) -> Promise<LINES | null>   null when ETB2B has no record
   LINES = { tagline, why, audience, industry, level, action, scale, look }, each '' when not known */

var API = 'https://api.economictimes.indiatimes.com';
var etPrevious = require('./et-previous');

function str(v) { return v == null ? '' : String(v); }
function text(v) {
  return str(v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&lsquo;/g, '’')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
/* a JSON list ETB2B keeps as text (or already a list) -> its plain, non-empty items */
function listOf(v) {
  var a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = a.trim() ? [a] : []; } }
  if (!Array.isArray(a)) return [];
  return a.map(function (x) { return text(x && typeof x === 'object' ? (x.title || x.text || x.name || '') : x); }).filter(Boolean);
}
function cap(s, n) { s = str(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; }
function firstSentence(s) { var m = /^(.{20,220}?[.!?])(\s|$)/.exec(text(s)); return m ? m[1] : ''; }
function count(v) { var n = parseInt(v, 10); return n > 0 ? n : 0; }

/* what each portal covers, in plain words: the industry of every event on it */
var PORTAL_INDUSTRY = {
  brandequity: 'Marketing, advertising and media', cio: 'Technology (CIOs and IT leaders)', ciso: 'Cybersecurity', infra: 'Infrastructure',
  cfo: 'Finance (CFOs and finance leaders)', hr: 'Human resources', retail: 'Retail', health: 'Healthcare', auto: 'Automotive', telecom: 'Telecom',
  bfsi: 'Banking, financial services and insurance', energy: 'Energy', government: 'Government and public sector', legal: 'Law and legal services',
  realty: 'Real estate', education: 'Education', manufacturing: 'Manufacturing', supplychain: 'Supply chain and logistics', travel: 'Travel and tourism',
  hospitality: 'Hospitality', pharma: 'Pharmaceuticals', gcc: 'Global capability centres', enterpriseai: 'Enterprise AI', datacenters: 'Data centres',
  electronics: 'Electronics', sustainability: 'Sustainability', workplace: 'Workplace', hrsea: 'Human resources', hrme: 'Human resources',
  ciosea: 'Technology (CIOs and IT leaders)', ciome: 'Technology (CIOs and IT leaders)', energymea: 'Energy'
};

function levelOf(name) {
  var n = str(name);
  if (/\b(global|international|world\s+(?:forum|congress))\b/i.test(n) && !/\bbrand world\b/i.test(n)) return 'global';
  if (/\b(asia|apac|south[- ]?east asia|sea|middle east|mea|gcc region)\b/i.test(n)) return 'regional (outside India)';
  if (/\b(south|north|east|west|central)\b/i.test(n)) return 'regional';
  return '';
}
function actionOf(kind, listed) {
  if (kind === 'award') return 'nominate';
  var a = str(listed && listed.action).toLowerCase();
  if (/invite|invitation/.test(a)) return 'request an invite';
  if (/apply/.test(a)) return 'apply';
  if (/nominat/.test(a)) return 'nominate';
  if (/register|book|attend|join/.test(a)) return 'register';
  return '';
}
function lookOf(d) {
  var theme = str(d.forced_theme || d.is_dark_light_theme).toLowerCase(), font = '';
  try { var t = typeof d.template_settings === 'string' ? JSON.parse(d.template_settings) : d.template_settings; font = text(t && t.font_family).slice(0, 40); } catch (e) { font = ''; }
  var okFont = font && /^[a-z0-9 \-]+$/i.test(font);
  if (theme !== 'light' && theme !== 'dark') theme = '';
  if (!theme && !okFont) return '';
  return 'Last edition: ' + (theme ? 'a ' + theme + ' site' + (okFont ? ', set in ' + font : '') : 'set in ' + font);
}

function linesOf(d, listed, o) {
  d = d || {}; listed = listed || {}; o = o || {};
  var why = listOf(d.why_join_us);
  if (!why.length) why = listOf(d.key_discussion_points);
  var who = listOf(d.who_should_attend);
  var regs = count(d.total_registrations || listed.registrations), speakers = count(listed.speakers), partners = count(o.partners);
  var scale = [regs && 'about ' + regs.toLocaleString('en-IN') + ' registrations', speakers && speakers + ' speakers', partners && partners + ' partners'].filter(Boolean);
  return {
    tagline: cap(text(d.synopsis) || firstSentence(d.company_description), 220),
    why: cap(why.slice(0, 3).map(function (w) { return w.replace(/[\s.;,]+$/, ''); }).join('; '), 600),
    audience: cap(who.slice(0, 10).join(', '), 400),
    industry: PORTAL_INDUSTRY[o.portal] || '',
    level: levelOf(text(d.company_name) || listed.title),
    action: actionOf(o.kind, listed),
    scale: scale.length ? 'Last edition: ' + scale.join(', ') : '',
    look: lookOf(d)
  };
}

/* listed: the edition's row from ETB2B's list ({ speakers, action, registrations, title }), when the caller has it */
function readEditionBrief(portal, id, kind, fetchJson, listed) {
  var get = function (u) { return Promise.resolve().then(function () { return fetchJson(u, { portal: portal, accept: 'application/json' }); }).then(null, function () { return null; }); };
  return Promise.all([
    get(API + '/v1/microsite/details?digital_month_id=' + encodeURIComponent(id)),
    etPrevious.allItems(function (u, h) { return get(u, h); }, '/v1/activity/sponsor/list', id, portal)
  ]).then(function (r) {
    var j = r[0], d = j && j.status !== false && j.data && typeof j.data === 'object' ? j.data : null;
    if (!d) return null;
    var partners = (r[1] || []).filter(function (s) { return s && str(s.status) !== '0'; }).length;
    return linesOf(d, listed, { kind: kind, portal: portal, partners: partners });
  });
}

module.exports = { linesOf, readEditionBrief, PORTAL_INDUSTRY, listOf };
