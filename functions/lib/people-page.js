/* A speaker's or a sponsor's page (lib/people.js gives the PERSON; the owner, 11 Nov 2026: "a dedicated page for each
   speakers which will show the journey of that speaker with ET … Same for the sponsor"). One page, in ETB2B's own
   look, whatever event the visitor came from; "Back to <event>" when they came from one.

     render(person, o) -> the whole HTML page. o = { base: 'https://…' (the public address, for the canonical link and
                          the share card), back: { name, href } | null, today: 'YYYY-MM-DD' }

   What it shows, top to bottom: the ETB2B mark (and the way back); the person — photo, name, designation and company
   (the company's logo beside it), LinkedIn / X; how much they have done with ET (events, sessions, since when, on
   which portals); About (the team's text, else ET's); the team's own sections; the journey — what is coming first,
   then each year, newest first: the event (a link to its page), when and on which portal, the company they came
   from when it is not today's, and the sessions they spoke in; the team's links. A sponsor's page has the logo, the
   website, and the tier at each event instead of sessions.

   Everything is set as text (escaped), a link is kept only on http(s), a picture only on https or an uploaded file
   (data:image). No script: the page works, and is read by search engines, as it is sent. Light only, so the ETB2B
   mark (black lettering, the red ET square) is shown as it is drawn. */
'use strict';
var PM = require('./people-match');

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function link(u) { u = str(u).trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) ? u : ''; }
function picture(u) { u = str(u).trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) || /^data:image\/(?:jpeg|png|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : ''; }
function paras(text) {
  return str(text).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
    .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
}
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* '2025-11-20' -> '20 Nov 2025'; '2025' -> '2025' */
function dayLabel(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d));
  if (!m) return /^\d{4}$/.test(str(d)) ? str(d) : '';
  return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
}
/* a session's time: '2025-11-20T10:30:00' or '2025-11-20 10:30' -> '10:30 am'; '14:00' -> '2:00 pm' */
function timeLabel(t) {
  var m = /(?:^|[T\s])(\d{1,2}):(\d{2})/.exec(str(t));
  if (!m) return '';
  var h = +m[1], mm = m[2];
  if (h > 23) return '';
  if (h === 0 && mm === '00' && /^\d{4}-\d{2}-\d{2}[T\s]00:00/.test(str(t))) return '';
  return ((h % 12) || 12) + ':' + mm + (h < 12 ? ' am' : ' pm');
}
function initials(name) { return str(name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
function cut(text, max) {
  text = str(text).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  var at = text.lastIndexOf(' ', max - 1);
  return text.slice(0, at > max * 0.6 ? at : max - 1).replace(/[\s,;:.-]+$/, '') + '…';
}
/* a role as ETB2B's teams sometimes type it, in capitals ("GUEST OF HONOUR"), in the case a page reads: "Guest of
   Honour"; a short word stays as it is (CXO, AI, HR), and a role typed in mixed case is left as it was */
var SMALL_WORDS = { of: 1, and: 1, the: 1, for: 1, in: 1, at: 1, to: 1, on: 1, a: 1, an: 1, by: 1, with: 1 };
function roleLabel(role) {
  role = str(role).replace(/\s+/g, ' ').trim();
  if (!role || role !== role.toUpperCase() || !/[A-Z]{2}/.test(role)) return role;
  return role.split(' ').map(function (w, i) {
    var lw = w.toLowerCase();
    if (i > 0 && SMALL_WORDS[lw]) return lw;
    if (/^[A-Z0-9&]{2,3}$/.test(w) && !SMALL_WORDS[lw]) return w;
    return lw.replace(/(^|[-/(])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }).join(' ');
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function jsonLd(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }


/* ---------- the look (the owner, 12 Nov 2026: "refine the speaker preview page, currently it is too basic") ----------
   A record of someone on ETB2B's stages, set like a business paper's profile: Schibsted Grotesk (drawn for a news
   publisher) throughout; white paper, ink, and ETB2B's red kept for marks — the year bars, a rule, a dot — with a
   deeper red where red is text, so it reads. Two columns: the person's record in the main one, what they share with
   others in the side one (portals, who they shared a stage with, sharing). The one bold thing is "On the ETB2B stage,
   by year": a bar a year, as tall as that year's appearances, each a way into the journey. No script, no motion. */
/* a group that says only that they spoke or came: no role to show (ETB2B's records also write "Speakers & Delegates") */
var GENERIC_ROLE = /^(?:speakers?|our speakers|panell?ists?|session speakers?|delegates?|participants?|speakers?\s*(?:&|and)\s*delegates?|delegates?\s*(?:&|and)\s*speakers?|attendees?)$/i;
/* a tier as one partner's ("Presenting Partners" is "Presenting Partner") */
function tierLabel(t) { return roleLabel(t).replace(/\b(Partner|Sponsor|Associate)s\b/g, '$1'); }
function shownRole(j) {
  var r = roleLabel(j.role);
  if (r && GENERIC_ROLE.test(r)) r = '';
  return r || (j.award ? 'Jury' : '');
}
var ICON = {
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  out: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
  mic: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  li: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22zM8.5 8h4.37v1.92h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 7v7.45h-4.56v-6.6c0-1.57-.03-3.6-2.2-3.6-2.2 0-2.53 1.72-2.53 3.49V22H8.5z"/></svg>',
  x: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.4 8.5L23 22h-6.8l-5.3-6.9L4.8 22H1.7l7.9-9.1L1 2h7l4.8 6.3zm-1.2 18h1.7L6.4 3.9H4.6z"/></svg>',
  wa: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2zm0 18.1a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .8.8-2.94-.2-.3a8.2 8.2 0 1 1 6.9 3.77zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.96-.14.17-.29.19-.54.07a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.48a.92.92 0 0 0-.66.31 2.8 2.8 0 0 0-.87 2.07 4.85 4.85 0 0 0 1.02 2.58 11.1 11.1 0 0 0 4.25 3.76c1.58.68 2.2.74 3 .62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.15-1.18-.06-.1-.22-.16-.47-.28z"/></svg>'
};

var CSS = [
  ':root{--red:#ED1A3B;--red-ink:#C21A33;--on-red:#FFFFFF;--ink:#1A1C21;--soft:#4F5562;--muted:#6B7180;--rule:#E4E6EB;--wash:#FDEDEF;--ground:#F6F7F9;--paper:#FFFFFF}',
  '*{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.6 "Schibsted Grotesk",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-feature-settings:"ss01" 1}',
  'a{color:var(--red-ink);text-underline-offset:3px}',
  'a:hover{color:var(--ink)}',
  'a:focus-visible,button:focus-visible{outline:3px solid var(--ink);outline-offset:3px;border-radius:4px}',
  '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.wrap{max-width:1120px;margin:0 auto;padding:0 24px}',
  /* the top bar */
  '.top{border-bottom:1px solid var(--rule)}',
  '.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}',
  '.mark{flex:0 0 auto}.mark img{display:block;height:28px;width:auto}',
  '.back{display:inline-flex;align-items:center;gap:6px;min-height:40px;min-width:0;padding:0 16px 0 10px;border:1.5px solid var(--red);border-radius:999px;color:var(--red-ink);font-size:15px;font-weight:700;text-decoration:none}',
  '.back:hover{background:var(--red);color:var(--on-red)}',
  '.back span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.back:hover span{text-decoration:none}',
  /* the person */
  '.who{padding:48px 0 36px}',
  '.who .wrap{display:grid;grid-template-columns:240px minmax(0,1fr);gap:44px;align-items:end}',
  '.ph{position:relative;margin:0;width:240px;aspect-ratio:4/5;border-radius:6px;overflow:hidden;background:var(--ground)}',
  '.ph:after{content:"";position:absolute;left:0;right:0;bottom:0;height:6px;background:var(--red)}',
  '.ph img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}',
  '.ph span{position:absolute;inset:0;display:grid;place-items:center;font-size:64px;font-weight:800;color:var(--red-ink);letter-spacing:-.02em}',
  '.ph.logo{display:grid;place-items:center;background:#fff;border:1px solid var(--rule);aspect-ratio:4/3}',
  '.ph.logo img{width:auto;height:auto;max-width:78%;max-height:62%;object-fit:contain}',
  '.since{margin:0 0 10px;font-size:16px;color:var(--soft)}',
  'h1{margin:0;font-size:clamp(40px,6vw,72px);line-height:.98;font-weight:800;letter-spacing:-.035em;overflow-wrap:anywhere}',
  '.role{margin:16px 0 0;font-size:21px;line-height:1.35;color:var(--ink);max-width:34em}',
  '.role .co{font-weight:700}',
  '.co-logo{display:inline-block;vertical-align:middle;height:26px;max-width:96px;margin:0 0 0 10px;object-fit:contain}',
  '.acts{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 0}',
  '.btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--ink);color:var(--ink);font-size:15px;font-weight:700;text-decoration:none}',
  '.btn:hover{background:var(--ink);color:var(--paper)}',
  '.credit{margin:8px 0 0;font-size:13px;color:var(--muted)}',
  /* the one bold thing: a year at a time */
  '.years{border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);background:var(--ground)}',
  '.years .wrap{display:flex;align-items:flex-end;gap:36px;padding-top:22px;padding-bottom:18px}',
  '.years h2{flex:0 0 auto;margin:0 0 6px;font-size:15px;font-weight:600;color:var(--soft);line-height:1.3;max-width:9em}',
  '.bars{display:flex;align-items:flex-end;gap:6px;overflow-x:auto;padding:4px 2px 2px;margin:0;list-style:none;scrollbar-width:thin}',
  '.bars li{flex:0 0 auto}',
  '.bars a{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:48px;padding:4px 2px;color:var(--ink);text-decoration:none;border-radius:4px}',
  '.bars .n{font-size:14px;font-weight:700;line-height:1}',
  '.bars .b{display:block;width:28px;background:var(--red);border-radius:2px 2px 0 0}',
  '.bars .y{font-size:13px;color:var(--muted);line-height:1}',
  '.bars a:hover .y{color:var(--ink);text-decoration:underline}',
  '.tally{margin:0 0 6px auto;display:flex;gap:28px;flex:0 0 auto}',
  '.tally p{margin:0;font-size:14px;color:var(--soft);line-height:1.25}',
  '.tally b{display:block;font-size:30px;font-weight:800;color:var(--ink);letter-spacing:-.02em;line-height:1.05}',
  /* the two columns */
  '.page .wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:64px;padding-top:44px;padding-bottom:72px}',
  'main section+section{margin-top:52px}',
  'h2.h{margin:0 0 18px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.015em}',
  '.prose p{margin:0 0 14px;max-width:38em}',
  '.prose p:last-child{margin-bottom:0}',
  '.next{position:relative;padding:20px 22px 20px 26px;background:var(--wash);border-radius:6px}',
  '.next:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--red);border-radius:6px 0 0 6px}',
  '.next h2{margin:0 0 6px;font-size:15px;font-weight:600;color:var(--red-ink)}',
  '.next .t{display:block;font-size:22px;font-weight:800;line-height:1.25;color:var(--ink);text-decoration:none}',
  '.next .t:hover{text-decoration:underline}',
  '.next p{margin:6px 0 0;color:var(--soft)}',
  '.wiki .src{margin:12px 0 0;font-size:14px;color:var(--muted)}',
  /* the journey */
  '.yr{display:flex;align-items:baseline;gap:12px;margin:34px 0 4px;scroll-margin-top:16px}',
  '.yr:first-of-type{margin-top:0}',
  '.yr h3{margin:0;font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1}',
  '.yr span{font-size:14px;color:var(--muted)}',
  '.ev{list-style:none;margin:0;padding:0}',
  '.ev>li{display:grid;grid-template-columns:72px minmax(0,1fr);gap:18px;padding:18px 0;border-top:1px solid var(--rule)}',
  '.ev>li:first-child{border-top:2px solid var(--ink)}',
  '.dt{font-size:14px;line-height:1.2;color:var(--muted);padding-top:4px}',
  '.dt b{display:block;font-size:24px;font-weight:800;color:var(--ink);letter-spacing:-.02em}',
  '.ev h4{margin:0;font-size:19px;line-height:1.35;font-weight:700;overflow-wrap:anywhere}',
  '.ev h4 a{color:var(--ink);text-decoration:none}',
  '.ev h4 a:hover{text-decoration:underline}',
  '.ev h4 svg{margin-left:5px;vertical-align:1px;color:var(--muted)}',
  '.tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}',
  '.tag,.tier{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border-radius:4px;font-size:13px;font-weight:600;line-height:1.2}',
  '.tag{background:var(--ground);color:var(--soft)}',
  '.tier{background:var(--wash);color:var(--red-ink)}',
  '.was{margin:8px 0 0;font-size:14px;color:var(--muted)}',
  '.ss{list-style:none;margin:12px 0 0;padding:0}',
  '.ss li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;padding:10px 0 0}',
  '.ss li svg{color:var(--red);margin-top:4px}',
  '.ss .st{display:block;font-weight:600;line-height:1.4}',
  '.ss time{font-weight:600;color:var(--muted);margin-right:8px}',
  '.ss .sa{display:block;margin-top:2px;font-size:15px;color:var(--soft)}',
  '.ss .sw{display:block;margin-top:4px;font-size:15px;color:var(--soft)}',
  /* the side */
  'aside section+section{margin-top:40px}',
  'aside h2{margin:0 0 12px;font-size:16px;font-weight:700}',
  '.list{list-style:none;margin:0;padding:0}',
  '.list li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--rule);font-size:15px}',
  '.list li:first-child{border-top:0;padding-top:0}',
  '.list .c{color:var(--muted);font-variant-numeric:tabular-nums}',
  '.share{display:flex;flex-wrap:wrap;gap:8px}',
  '.share a{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border-radius:999px;background:var(--ground);color:var(--ink);font-size:14px;font-weight:600;text-decoration:none}',
  '.share a:hover{background:var(--ink);color:var(--paper)}',
  '.links a{font-weight:600}',
  /* the speaker's next event, beside their name (the owner, 19 Nov 2026: "Show the immediate upcoming event in right side of
     the speaker name with an upcoming ticker"): the one thing on the page that moves, a dot that pulses — still for those
     who ask for less motion */
  '.who .wrap.has-up{grid-template-columns:240px minmax(0,1fr) 300px}',
  '.up-now{position:relative;align-self:end;padding:18px 20px 18px 22px;background:var(--wash);border-radius:6px}',
  '.up-now:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--red);border-radius:6px 0 0 6px}',
  '.tick{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:14px;font-weight:700;color:var(--red-ink)}',
  '.tick .dot{position:relative;width:10px;height:10px;border-radius:50%;background:var(--red)}',
  '.tick .dot:after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--red);animation:pulse 1.6s ease-out infinite}',
  '@keyframes pulse{from{transform:scale(1);opacity:.7}to{transform:scale(2.6);opacity:0}}',
  '.tick .in{margin-left:auto;font-weight:600;color:var(--soft)}',
  '.up-now .t{display:block;font-size:20px;font-weight:800;line-height:1.25;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}',
  'a.t:hover{text-decoration:underline}',
  '.up-now p.m{margin:6px 0 0;font-size:15px;color:var(--soft)}',
  '.up-now .tier{margin-top:10px}',
  '.up-ss{list-style:none;margin:10px 0 0;padding:0;font-size:15px;line-height:1.4}',
  '.up-ss li{padding:4px 0 0;font-weight:600}',
  '.up-ss li.n,.ups .up-ss li.n{font-weight:400;color:var(--muted)}',
  '.up-ss time{font-weight:700;color:var(--red-ink)}',
  '.ups .up-ss{margin-top:4px;font-size:14px}',
  /* the other events to come, in the side */
  '.ups{list-style:none;margin:0;padding:0}',
  '.ups li{padding:12px 0;border-top:1px solid var(--rule)}',
  '.ups li:first-child{border-top:0;padding-top:0}',
  '.ups a,.ups b{display:block;font-size:16px;font-weight:700;line-height:1.35;color:var(--ink);text-decoration:none}',
  '.ups a:hover{text-decoration:underline}',
  '.ups span{display:block;margin-top:2px;font-size:14px;color:var(--muted)}',
  /* "View more" (the owner, 19 Nov 2026: "For some of speakers the profile page is being too long"): the rest of the journey
     and of a long list of sessions, opened in place — no script */
  'details.more{margin-top:8px}',
  'details.more>summary,details.more-s>summary{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;border:1.5px solid var(--ink);font-size:15px;font-weight:700;cursor:pointer;list-style:none}',
  'details.more>summary::-webkit-details-marker,details.more-s>summary::-webkit-details-marker{display:none}',
  'details.more>summary:hover,details.more-s>summary:hover{background:var(--ink);color:var(--paper)}',
  'details.more>summary:focus-visible,details.more-s>summary:focus-visible,.qs summary:focus-visible{outline:3px solid var(--ink);outline-offset:3px}',
  'details.more[open]>summary{margin-bottom:8px}',
  'details[open]>summary .c,details:not([open])>summary .o{display:none}',
  'details.more-s{margin-top:8px}',
  'details.more-s>summary{min-height:36px;padding:0 14px;border-width:1px;font-size:14px}',
  /* speakers of the same industry */
  '.sim{border-top:1px solid var(--rule);background:var(--ground)}',
  '.sim .wrap{padding-top:44px;padding-bottom:48px}',
  '.sim-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}',
  '.sim-list a{display:block;height:100%;padding:0 0 14px;background:var(--paper);border-radius:6px;overflow:hidden;color:var(--ink);text-decoration:none;box-shadow:0 0 0 1px var(--rule)}',
  '.sim-list a:hover{box-shadow:0 0 0 2px var(--ink)}',
  '.sim-list figure{position:relative;margin:0 0 12px;aspect-ratio:4/3;background:var(--wash);overflow:hidden}',
  '.sim-list img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}',
  '.sim-list figure span{position:absolute;inset:0;display:grid;place-items:center;font-size:34px;font-weight:800;color:var(--red-ink)}',
  '.sim-list b{display:block;padding:0 14px;font-size:17px;line-height:1.3;overflow-wrap:anywhere}',
  '.sim-list small{display:block;padding:4px 14px 0;font-size:14px;line-height:1.4;color:var(--soft)}',
  /* the page's questions, at its foot */
  '.faq .wrap{padding-top:44px;padding-bottom:56px}',
  '.qs{max-width:820px;border-top:2px solid var(--ink)}',
  '.qs details{border-bottom:1px solid var(--rule)}',
  '.qs summary{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:56px;padding:12px 0;font-size:18px;font-weight:700;line-height:1.4;cursor:pointer;list-style:none}',
  '.qs summary::-webkit-details-marker{display:none}',
  '.qs summary:after{content:"+";flex:0 0 auto;font-size:26px;font-weight:400;line-height:1;color:var(--red-ink)}',
  '.qs details[open] summary:after{content:"\\2212"}',
  '.qs .prose{padding:0 0 18px}',
  '@media (prefers-reduced-motion:reduce){.tick .dot:after{animation:none}}',
  'footer{border-top:1px solid var(--rule)}',
  'footer .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:72px;font-size:14px;color:var(--muted)}',
  'footer img{height:22px;width:auto;display:block}',
  '@media (max-width:900px){',
  '.who .wrap.has-up{grid-template-columns:200px minmax(0,1fr)}',
  '.who .wrap.has-up .up-now{grid-column:2}',
  '.sim-list{grid-template-columns:repeat(2,minmax(0,1fr))}',
  '.page .wrap{grid-template-columns:minmax(0,1fr);gap:48px}',
  '.years .wrap{flex-wrap:wrap;gap:16px 28px}',
  '.tally{margin-left:0}',
  '}',
  '@media (max-width:640px){',
  '.wrap{padding:0 16px}',
  '.mark img{height:22px}',
  '.back{font-size:14px}',
  '.who{padding:28px 0 26px}',
  '.who .wrap,.who .wrap.has-up{grid-template-columns:minmax(0,1fr);gap:22px}',
  '.who .wrap.has-up .up-now{grid-column:auto}',
  '.sim-list{gap:12px}',
  '.sim-list b{font-size:15px}',
  '.qs summary{font-size:16px}',
  '.ph{width:150px}',
  '.ph span{font-size:44px}',
  '.role{font-size:18px}',
  '.years h2{max-width:none}',
  '.tally{flex-wrap:wrap;gap:14px 22px}',
  '.ev>li{grid-template-columns:56px minmax(0,1fr);gap:12px}',
  '.dt b{font-size:20px}',
  '.yr h3{font-size:28px}',
  '}'
].join('\n');

function head(o) {
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(o.title) + '</title><meta name="description" content="' + esc(o.description) + '">' +
    '<meta name="robots" content="index, follow, max-image-preview:large">' +
    (o.canonical ? '<link rel="canonical" href="' + esc(o.canonical) + '">' : '') +
    '<meta property="og:type" content="' + esc(o.ogType) + '"><meta property="og:title" content="' + esc(o.title) + '"><meta property="og:description" content="' + esc(o.description) + '">' +
    (o.canonical ? '<meta property="og:url" content="' + esc(o.canonical) + '">' : '') +
    (o.image ? '<meta property="og:image" content="' + esc(o.image) + '"><meta name="twitter:image" content="' + esc(o.image) + '">' : '') +
    '<meta property="og:site_name" content="ETB2B Events"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="' + esc(o.title) + '"><meta name="twitter:description" content="' + esc(o.description) + '">' +
    '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;600;700;800&amp;display=swap">' +
    ((o.look && o.look.fonts) || []).filter(function (u) { return /^https:\/\/fonts\.googleapis\.com\/css2?\?[^"'<>\s\\]+$/.test(str(u)); }).slice(0, 3).map(function (u) { return '<link rel="stylesheet" href="' + esc(u) + '">'; }).join('') +
    '<style>' + CSS + lookCss(o.look) + '</style>' +
    '<script type="application/ld+json">' + jsonLd(o.ld) + '</script></head>';
}
function topBar(back, dark) {
  var b = back && link(back.href) ? '<a class="back" href="' + esc(back.href) + '">' + ICON.back + '<span>' + (back.name ? 'Back to ' + esc(back.name) : 'Back to the event') + '</span></a>' : '';
  /* on a dark site the mark drawn for a dark ground: its lettering white, the red ET square as it is (ETB2B's logo rule) */
  return '<header class="top"><div class="wrap"><span class="mark"><img src="' + (dark ? '/templates/_shared/img/et-business-verticals-on-dark.svg' : '/assets/et-b2b-logo.svg') + '" width="171" height="28" alt="ETB2B"></span>' + b + '</div></header>';
}
function footer() {
  return '<footer><div class="wrap"><span>ETB2B, The Economic Times Business Verticals</span><img class="wm" src="/assets/et-b2b-wordmark.svg" alt="" width="152" height="22"></div></footer>';
}

/* ---------- the event site's look (the owner, 19 Nov 2026: "Can we keep the theme of speaker/sponsor page same from where
   the user is being navigated") ----------
   A visitor who came from an event's site sees this page in that site's colours and fonts (lib/people.js lookOf): its
   background and text, its theme colour where ETB2B's red marks things (the year bars, a rule, the dot, the tags), a
   deeper or lighter shade of it where it is text, so it reads; its heading font for headings, its body font for the rest.
   The ETB2B mark keeps its own colours (on a dark site, the copy drawn for a dark ground). Links to other speakers'
   pages keep the look and the way back (KEEP.q). */
var KEEP = { q: '' };
function hexOk(v) { return /^#[0-9a-f]{6}$/i.test(str(v)) ? str(v).toLowerCase() : ''; }
function rgbOf(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hexOfRgb(c) { return '#' + c.map(function (n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }).join(''); }
function mixHex(a, b, t) { var x = rgbOf(a), y = rgbOf(b); return hexOfRgb([0, 1, 2].map(function (i) { return x[i] * t + y[i] * (1 - t); })); }
function lum(h) { return rgbOf(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function contrastOf(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/* the colour moved towards the ink of its ground until it reads there (min: 4.5 for text) */
function readableOn(colour, ground, min) {
  var toward = lum(ground) > 0.4 ? '#000000' : '#ffffff';
  for (var t = 1; t >= 0.2; t -= 0.05) { var c = mixHex(colour, toward, t); if (contrastOf(c, ground) >= min) return c; }
  return toward === '#000000' ? '#1a1c21' : '#f4f4f6';
}
function lookCss(look) {
  if (!look) return '';
  var paper = hexOk(look.bg) || '#ffffff', dark = lum(paper) < 0.2;
  var ink = hexOk(look.text) && contrastOf(look.text, paper) >= 4.5 ? hexOk(look.text) : (dark ? '#f4f4f6' : '#1a1c21');
  var theme = hexOk(look.theme) || hexOk(look.accent) || '';
  var surface = hexOk(look.surface) && hexOk(look.surface) !== paper ? hexOk(look.surface) : mixHex(ink, paper, 0.04);
  var muted = hexOk(look.muted) && contrastOf(look.muted, paper) >= 4.5 ? hexOk(look.muted) : readableOn(mixHex(ink, paper, 0.6), paper, 4.5);
  var v = { '--paper': paper, '--ink': ink, '--soft': readableOn(mixHex(ink, paper, 0.78), paper, 4.5), '--muted': muted, '--rule': mixHex(ink, paper, 0.14), '--ground': surface };
  if (theme) {
    v['--red'] = theme;
    v['--red-ink'] = contrastOf(theme, paper) >= 4.5 ? theme : readableOn(theme, paper, 4.5);
    v['--wash'] = mixHex(theme, paper, 0.1);
    v['--on-red'] = contrastOf('#ffffff', theme) >= contrastOf('#1a1c21', theme) ? '#ffffff' : '#1a1c21';
  }
  var css = ':root{' + Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';') + '}';
  if (look.body) css += 'body{font-family:' + look.body + ',-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-feature-settings:normal}';
  if (look.heading) css += 'h1,h2,h3,h4,.t,.tally b,.dt b,.bars .n,.sim-list b,.qs summary{font-family:' + look.heading + ',-apple-system,"Segoe UI",Roboto,Arial,sans-serif}';
  if (dark) css += 'footer img.wm{filter:invert(1)}.ph.logo,.sim-list a{background:var(--ground)}';
  return css;
}

/* the journey's editions that a visitor reads (the team may leave one off; one not public is never here) */
function shownOf(person) { return (person.journey || []).filter(function (j) { return !j.hidden && !j.why; }); }
function isComing(j, today) { return !!(j.upcoming || (j.date && today && j.date > today)); }
/* a year at a time: { year, count } oldest first, for the bars */
function byYear(list) {
  var at = {}, out = [];
  list.forEach(function (j) { var y = str(j.year) || (str(j.date).slice(0, 4)); if (!/^\d{4}$/.test(y)) return; if (!at[y]) { at[y] = { year: y, count: 0 }; out.push(at[y]); } at[y].count++; });
  return out.sort(function (a, b) { return a.year < b.year ? -1 : 1; });
}
function yearsHtml(person, list, kind) {
  var years = byYear(list);
  if (!years.length) return '';
  var max = Math.max.apply(null, years.map(function (y) { return y.count; }));
  var st = person.stats || {}, tally = [];
  if (kind === 'sponsors') { if (st.events) tally.push('<p><b>' + st.events + '</b>' + (st.events === 1 ? 'ETB2B event' : 'ETB2B events') + '</p>'); }
  else {
    if (st.events) tally.push('<p><b>' + st.events + '</b>' + (st.events === 1 ? 'ETB2B event' : 'ETB2B events') + '</p>');
    if (st.sessions) tally.push('<p><b>' + st.sessions + '</b>' + (st.sessions === 1 ? 'session' : 'sessions') + '</p>');
    if (st.awards) tally.push('<p><b>' + st.awards + '</b>' + (st.awards === 1 ? 'award jury' : 'award juries') + '</p>');
  }
  if (st.since) tally.push('<p><b>' + esc(st.since) + '</b>first with ETB2B</p>');
  var title = kind === 'sponsors' ? 'Partnering ETB2B events, by year' : 'On the ETB2B stage, by year';
  return '<section class="years" aria-labelledby="h-years"><div class="wrap"><h2 id="h-years">' + title + '</h2>' +
    '<ul class="bars">' + years.map(function (y) {
      var h = Math.max(6, Math.round(56 * y.count / max));
      return '<li><a href="#y' + esc(y.year) + '" aria-label="' + esc(y.year + ': ' + plural(y.count, kind === 'sponsors' ? 'event' : 'appearance', kind === 'sponsors' ? 'events' : 'appearances')) + '">' +
        '<span class="n" aria-hidden="true">' + y.count + '</span><span class="b" style="height:' + h + 'px" aria-hidden="true"></span><span class="y" aria-hidden="true">' + esc(y.year) + '</span></a></li>';
    }).join('') + '</ul>' + (tally.length ? '<div class="tally">' + tally.join('') + '</div>' : '') + '</div></section>';
}
function dayParts(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d));
  return m ? { day: String(+m[3]), month: MONTHS[+m[2] - 1] } : null;
}
function eventItem(j, person, sponsor) {
  var href = link(j.link), external = /^https?:/i.test(href);
  var title = href ? '<a href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(j.title) +
    (external ? ICON.out + '<span class="sr"> (opens in a new tab)</span>' : '') + '</a>' : esc(j.title);
  var dp = dayParts(j.date);
  var out = '<li><div class="dt">' + (dp ? '<b>' + esc(dp.day) + '</b>' + esc(dp.month) : '<b>' + esc(str(j.year) || '') + '</b>') + '</div><div><h4>' + title + '</h4>';
  var tags = [];
  if (j.portalName) tags.push('<span class="tag">' + esc(j.portalName) + '</span>');
  var role = sponsor ? tierLabel(j.tier) : shownRole(j);
  if (role) tags.push('<span class="tier">' + esc(role) + '</span>');
  if (tags.length) out += '<div class="tags">' + tags.join('') + '</div>';
  /* who they were then, when it was another company (not the same one spelt another way): their journey */
  if (!sponsor && j.company && person.company && !PM.sameCompany(PM.companyForm(j.company), PM.companyForm(person.company))) {
    out += '<p class="was">Then ' + (j.designation ? esc(j.designation) + ' at ' : 'at ') + esc(j.company) + '</p>';
  }
  /* each session's title, time and who shared it — never its description (the owner, 19 Nov 2026: "Remove the session
     description from the sessions in which the speaker spoken"); past SESSIONS_SHOWN, the rest behind "View more" */
  if (!sponsor && j.sessions && j.sessions.length) {
    var one = function (s) {
      var t = timeLabel(s.start);
      var who = (s.with || []).filter(function (w) { return w && w.name; });
      return '<li>' + ICON.mic + '<span><span class="st">' + (t ? '<time>' + esc(t) + '</time>' : '') + esc(s.title) + '</span>' +
        (who.length ? '<span class="sw">With ' + who.map(function (w) {
          return w.slug ? '<a href="/speakers/' + esc(w.slug) + esc(KEEP.q) + '">' + esc(w.name) + '</a>' : esc(w.name);
        }).join(', ') + '</span>' : '') + '</span></li>';
    };
    var first = j.sessions.slice(0, SESSIONS_SHOWN), rest = j.sessions.slice(SESSIONS_SHOWN);
    out += '<ul class="ss" aria-label="Sessions">' + first.map(one).join('') + '</ul>';
    if (rest.length) out += '<details class="more-s"><summary><span class="c">View ' + plural(rest.length, 'more session', 'more sessions') + '</span><span class="o">Show fewer sessions</span></summary>' +
      '<ul class="ss" aria-label="More sessions">' + rest.map(one).join('') + '</ul></details>';
  }
  return out + '</div></li>';
}
function nextHtml(list, sponsor) {
  if (!list.length) return '';
  var j = list[list.length - 1];   /* the nearest one to come */
  var href = link(j.link), dp = dayParts(j.date);
  var when = dp ? dp.day + ' ' + dp.month + ' ' + str(j.date).slice(0, 4) : str(j.year);
  return '<section class="next" aria-labelledby="h-next"><h2 id="h-next">' + (sponsor ? 'Partnering next' : 'Speaking next') + '</h2>' +
    (href ? '<a class="t" href="' + esc(href) + '">' + esc(j.title) + '</a>' : '<span class="t">' + esc(j.title) + '</span>') +
    '<p>' + esc([when, j.portalName].filter(Boolean).join(', ')) + (list.length > 1 ? ', and ' + plural(list.length - 1, 'more event', 'more events') + ' to come' : '') + '</p></section>';
}
/* A long journey is cut (the owner, 19 Nov 2026: "For some of speakers the profile page is being too long, we can use view
   more button to show more events and session"): the first EVENTS_SHOWN events, the rest behind "View more", opened in
   place; a year's bar still leads to its year (a browser opens the part it is in). A speaker's events to come are not
   here: they are beside the name and the About (upcomingHtml). */
var EVENTS_SHOWN = 5, SESSIONS_SHOWN = 3;
function journeyHtml(person, o) {
  var today = str(o.today), sponsor = person.kind === 'sponsors';
  var shown = shownOf(person);
  if (!shown.length) return '';
  var coming = shown.filter(function (j) { return isComing(j, today); });
  var past = shown.filter(function (j) { return coming.indexOf(j) === -1; });
  var list = sponsor ? coming.concat(past) : past;
  if (!list.length) return '';
  var count = {};
  list.forEach(function (j) { var y = str(j.year) || 'Earlier'; count[y] = (count[y] || 0) + 1; });
  /* in order: years newest first, 'Earlier' last; within a year as the journey has them */
  var years = Object.keys(count).sort(function (a, b) { return a === 'Earlier' ? 1 : b === 'Earlier' ? -1 : (a < b ? 1 : -1); });
  var ordered = [];
  years.forEach(function (y) { list.forEach(function (j) { if ((str(j.year) || 'Earlier') === y) ordered.push(j); }); });
  function block(items, continued) {
    var html = '', y0 = null, open = false;
    items.forEach(function (j, i) {
      var y = str(j.year) || 'Earlier';
      if (y !== y0) {
        if (open) html += '</ul>';
        var again = continued && i === 0;
        html += '<div class="yr"' + (again ? '' : ' id="y' + esc(y) + '"') + '><h3>' + esc(y) + '</h3><span>' + (again ? 'continued' : plural(count[y], sponsor ? 'event' : 'appearance', sponsor ? 'events' : 'appearances')) + '</span></div><ul class="ev">';
        y0 = y; open = true;
      }
      html += eventItem(j, person, sponsor);
    });
    return open ? html + '</ul>' : html;
  }
  var first = ordered.slice(0, EVENTS_SHOWN), rest = ordered.slice(EVENTS_SHOWN);
  var cont = rest.length && first.length && (str(rest[0].year) || 'Earlier') === (str(first[first.length - 1].year) || 'Earlier');
  return '<section aria-labelledby="h-journey"><h2 class="h" id="h-journey">' + (sponsor ? 'Partnerships with ETB2B' : 'Journey with ETB2B') + '</h2>' + block(first, false) +
    (rest.length ? '<details class="more"><summary><span class="c">View ' + plural(rest.length, sponsor ? 'more event' : 'more event', 'more events') + (sponsor ? '' : ' and sessions') + '</span><span class="o">Show fewer</span></summary>' + block(rest, cont) + '</details>' : '') +
    '</section>';
}
function extrasHtml(person) {
  var html = '';
  (person.sections || []).forEach(function (s, i) {
    if (!s || !(s.heading || s.text)) return;
    html += '<section' + (s.heading ? ' aria-labelledby="h-x' + i + '"' : '') + '>' + (s.heading ? '<h2 class="h" id="h-x' + i + '">' + esc(s.heading) + '</h2>' : '') + '<div class="prose">' + paras(s.text) + '</div></section>';
  });
  return html;
}
/* Wikipedia, for the well-known (lib/people-wiki.js): its summary with the credit its licence asks for */
function wikiHtml(person) {
  var w = person.wiki;
  if (!w || !w.extract || !/^https:\/\/[^\s"'<>]+$/.test(str(w.url))) return '';
  return '<section class="wiki" aria-labelledby="h-wiki"><h2 class="h" id="h-wiki">From Wikipedia</h2><div class="prose">' + paras(w.extract) + '</div>' +
    '<p class="src"><a href="' + esc(w.url) + '" target="_blank" rel="noopener">Read more on Wikipedia<span class="sr"> (opens in a new tab)</span></a>. ' +
    'Text from Wikipedia, under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>.</p></section>';
}
/* the side: the portals, who they shared a stage with most, sharing, the team's links */
function portalsHtml(list, sponsor) {
  var at = {}, out = [];
  list.forEach(function (j) { var p = str(j.portalName); if (!p) return; if (!at[p]) { at[p] = { name: p, n: 0 }; out.push(at[p]); } at[p].n++; });
  if (!out.length) return '';
  out.sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
  /* a speaker's: "Speaking on more verticals" (the owner, 19 Nov 2026: "Rename - On these portals to Speaking on More verticals") */
  return '<section aria-labelledby="h-portals"><h2 id="h-portals">' + (sponsor ? 'With these portals' : 'Speaking on more verticals') + '</h2><ul class="list">' +
    out.map(function (p) { return '<li><span>' + esc(p.name) + '</span><span class="c">' + plural(p.n, 'event', 'events') + '</span></li>'; }).join('') + '</ul></section>';
}
function alongsideHtml(list) {
  var at = {}, out = [];
  list.forEach(function (j) {
    (j.sessions || []).forEach(function (s) {
      (s.with || []).forEach(function (w) {
        if (!w || !w.name) return;
        var k = w.slug || PMname(w.name);
        if (!at[k]) { at[k] = { name: w.name, slug: w.slug, n: 0 }; out.push(at[k]); }
        at[k].n++;
      });
    });
  });
  if (!out.length) return '';
  out.sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
  return '<section aria-labelledby="h-along"><h2 id="h-along">Shared the stage with</h2><ul class="list">' + out.slice(0, 8).map(function (p) {
    return '<li><span>' + (p.slug ? '<a href="/speakers/' + esc(p.slug) + esc(KEEP.q) + '">' + esc(p.name) + '</a>' : esc(p.name)) + '</span>' + (p.n > 1 ? '<span class="c">' + plural(p.n, 'session', 'sessions') + '</span>' : '') + '</li>';
  }).join('') + '</ul></section>';
}
function PMname(n) { return str(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function shareHtml(canonical, name) {
  if (!canonical) return '';
  var u = encodeURIComponent(canonical), t = encodeURIComponent(name + ' with ETB2B');
  return '<section aria-labelledby="h-share"><h2 id="h-share">Share this page</h2><div class="share">' +
    '<a href="https://www.linkedin.com/sharing/share-offsite/?url=' + u + '" target="_blank" rel="noopener">' + ICON.li + 'LinkedIn<span class="sr"> (opens in a new tab)</span></a>' +
    '<a href="https://twitter.com/intent/tweet?url=' + u + '&amp;text=' + t + '" target="_blank" rel="noopener">' + ICON.x + 'X<span class="sr"> (opens in a new tab)</span></a>' +
    '<a href="https://wa.me/?text=' + t + '%20' + u + '" target="_blank" rel="noopener">' + ICON.wa + 'WhatsApp<span class="sr"> (opens in a new tab)</span></a></div></section>';
}
function linksHtml(person) {
  var list = (person.links || []).filter(function (l) { return l && link(l.url) && /^https?:/i.test(l.url); });
  if (!list.length) return '';
  return '<section class="links" aria-labelledby="h-links"><h2 id="h-links">Read and watch</h2><ul class="list">' + list.map(function (l) {
    return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + '<span class="sr"> (opens in a new tab)</span></a></li>';
  }).join('') + '</ul></section>';
}

/* What is still to come (the owner, 19 Nov 2026: "Show the immideate upcoming event in right side of the speaker name with an
   upcoming ticker and rest upcoming events will be displayed in the right side of bio before On these portals section"):
   the nearest beside the name, with how far off it is; the others in the side, nearest first. */
function daysTo(date, today) {
  var a = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(date)), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(today));
  if (!a || !b) return null;
  return Math.round((Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3])) / 86400000);
}
function inDays(n) { return n == null || n < 0 ? '' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 60 ? 'In ' + n + ' days' : ''; }
function whenOf(j) { var dp = dayParts(j.date); return dp ? dp.day + ' ' + dp.month + ' ' + str(j.date).slice(0, 4) : str(j.year); }
/* the sessions they will speak in there: the first two, with how many more */
function comingSessions(j, max) {
  var list = (j.sessions || []).filter(function (x) { return x && str(x.title).trim(); });
  if (!list.length) return '';
  return '<ul class="up-ss" aria-label="Sessions">' + list.slice(0, max).map(function (x) {
    var t = timeLabel(x.start);
    return '<li>' + (t ? '<time>' + esc(t) + '</time> ' : '') + esc(x.title) + '</li>';
  }).join('') + (list.length > max ? '<li class="n">and ' + plural(list.length - max, 'more session', 'more sessions') + '</li>' : '') + '</ul>';
}
function upNowHtml(j, today) {
  if (!j) return '';
  var href = link(j.link), role = shownRole(j), soon = inDays(daysTo(j.date, today));
  return '<aside class="up-now" aria-labelledby="h-upnow"><p class="tick"><span class="dot" aria-hidden="true"></span><span id="h-upnow">Upcoming</span>' + (soon ? '<span class="in">' + esc(soon) + '</span>' : '') + '</p>' +
    (href ? '<a class="t" href="' + esc(href) + '">' + esc(j.title) + '</a>' : '<span class="t">' + esc(j.title) + '</span>') +
    '<p class="m">' + esc([whenOf(j), j.portalName].filter(Boolean).join(', ')) + '</p>' + (role ? '<span class="tier">' + esc(role) + '</span>' : '') + comingSessions(j, 2) + '</aside>';
}
function upcomingHtml(list) {
  if (!list.length) return '';
  return '<section aria-labelledby="h-ups"><h2 id="h-ups">' + (list.length === 1 ? 'Also coming up' : 'More upcoming events') + '</h2><ul class="ups">' + list.map(function (j) {
    var href = link(j.link), role = shownRole(j);
    return '<li>' + (href ? '<a href="' + esc(href) + '">' + esc(j.title) + '</a>' : '<b>' + esc(j.title) + '</b>') +
      '<span>' + esc([whenOf(j), j.portalName, role].filter(Boolean).join(', ')) + '</span>' + comingSessions(j, 1) + '</li>';
  }).join('') + '</ul></section>';
}
/* speakers of the same industry (lib/people.js similarOf), before the questions */
function similarHtml(list) {
  list = (list || []).filter(function (x) { return x && x.slug && x.name; });
  if (!list.length) return '';
  return '<section class="sim" aria-labelledby="h-sim"><div class="wrap"><h2 class="h" id="h-sim">Speakers in the same industry</h2><ul class="sim-list">' + list.map(function (x) {
    var ph = picture(x.photo), role = [x.designation, x.company].filter(Boolean).join(', ');
    return '<li><a href="/speakers/' + esc(x.slug) + esc(KEEP.q) + '"><figure>' + (ph ? '<img src="' + esc(ph) + '" alt="" loading="lazy" width="280" height="210">' : '<span aria-hidden="true">' + esc(initials(x.name)) + '</span>') + '</figure>' +
      '<b>' + esc(x.name) + '</b>' + (role ? '<small>' + esc(role) + '</small>' : '') + '</a></li>';
  }).join('') + '</ul></div></section>';
}
/* the page's questions (the team writes them in the console's page editor), at its foot */
/* ---------- the common questions ----------
   The owner, 25 Nov 2026: "Sharing the common FAQs that can be displayed on the Speaker page, replace the variables with
   their values for that speaker" — five questions in the owner's words, each answered from what the page holds:
     Q1 who they are     designation and company; the industry and what they have contributed to when the team has
                         given them (Edit speaker › Common questions: typed, or ETB2B AI's suggestion checked)
     Q2 their expertise  the team's areas of expertise (up to three)
     Q3 the events       the ETB2B events they took part in, with their part there (speaker, panelist, jury member…)
     Q4 the topics       their sessions' titles
     Q5 where to watch   the verticals' sites they appeared on
   A question whose facts are missing is left out, never answered with a gap or a guess. "[He/She]" is their name: no
   speaker's gender is on record, and a name does not tell it. p.common: { off, industry, expertise: [], contributed }. */
var DOMAIN = {
  cio: 'technology', ciosea: 'technology', ciome: 'technology', ciso: 'cybersecurity', infra: 'infrastructure', cfo: 'finance',
  hr: 'human resources', hrsea: 'human resources', hrme: 'human resources', retail: 'retail', health: 'healthcare',
  auto: 'the automotive industry', telecom: 'telecommunications', bfsi: 'banking and financial services', energy: 'energy',
  energymea: 'energy', government: 'governance and the public sector', legal: 'law', realty: 'real estate', education: 'education',
  manufacturing: 'manufacturing', supplychain: 'supply chains', travel: 'travel', hospitality: 'hospitality',
  brandequity: 'marketing and advertising', pharma: 'pharmaceuticals', gcc: 'global capability centres', enterpriseai: 'enterprise AI',
  techmonk: 'software development', entrepreneur: 'entrepreneurship', datacenters: 'data centres', electronics: 'electronics',
  sustainability: 'sustainability', workplace: 'workplace management', agriculture: 'agriculture', chemicals: 'chemicals',
  climate: 'climate', construction: 'construction', crypto: 'digital assets', defence: 'defence', drones: 'drones',
  facilities: 'facilities management', food: 'food', geospatial: 'geospatial technology', jewellery: 'jewellery',
  machinetools: 'machine tools', packaging: 'packaging', safety: 'safety', salon: 'the salon industry', shipping: 'shipping',
  sports: 'sports', startup: 'start-ups', textile: 'textiles', wastemanagement: 'waste management'
};
function listOf(items) {
  items = items.filter(Boolean);
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}
/* the industry of the verticals they appeared on, most appearances first (two at most) */
function domainsOf(shown) {
  var n = {}, order = [];
  shown.forEach(function (j) { var d = DOMAIN[str(j.portal)]; if (!d) return; if (!n[d]) { n[d] = 0; order.push(d); } n[d]++; });
  return order.sort(function (a, b) { return n[b] - n[a]; }).slice(0, 2);
}
/* their part at an event, as a phrase ("a speaker", "a jury member") */
function partOf(j) {
  var r = str(j.role);
  if (/jur|judg/i.test(r) || (j.award && !r)) return 'a jury member';
  if (/moderat/i.test(r)) return 'a moderator';
  if (/panel/i.test(r)) return 'a panelist';
  if (/keynote/i.test(r)) return 'a keynote speaker';
  if (/host|anchor|emcee|master of ceremon/i.test(r)) return 'a host';
  if (/chief guest|guest of honou?r|special guest|^guests?$/i.test(r.trim())) return 'a guest';
  return 'a speaker';
}
function quoted(t) { return '\u201c' + str(t).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') + '\u201d'; }
/* a session's topic: its title without the format before it ("Panel Discussion: …", "Mega Panel: …", "Fireside Chat
   with …:" stays whole, "Plenary Leader's Talk on …") */
var FORMAT_RE = /^(?:(?:mega|plenary|power|cxo|special|leadership|closing|opening|inaugural|grand)\s+)*(?:panel(?:\s+discussion)?|discussion|fireside(?:\s+chat)?|keynote(?:\s+(?:address|session|talk))?|address|presentation|masterclass|workshop|session|talk|roundtable|debate|case\s+study|spotlight)\s*[:\-\u2013\u2014|]\s+/i;
var TALK_ON_RE = /^(?:(?:plenary|special|guest)\s+)?leader[\u2019']?s\s+talk\s+on\s+/i;
function topicOf(t) {
  t = str(t).replace(/\s+/g, ' ').trim();
  var u = t.replace(FORMAT_RE, '').replace(TALK_ON_RE, '');
  return u.length >= 8 ? u.charAt(0).toUpperCase() + u.slice(1) : t;
}
function commonFaqs(p, today) {
  var c = p.common || {};
  if (c.off) return [];
  var name = str(p.name).trim();
  if (!name) return [];
  var shown = (p.journey || []).filter(function (j) { return !j.hidden && !j.why; });
  var past = shown.filter(function (j) { return !isComing(j, today) && str(j.title).trim(); });
  var out = [];
  var desig = str(p.designation).trim(), comp = str(p.company).trim();
  /* the team's words only: the verticals someone spoke at are not their expertise (a Chief Digital Officer of an auto
     parts maker who spoke at ETCISO events is no cybersecurity expert) — they are the box's hint in Edit speaker */
  var industry = str(c.industry).trim();
  var expertise = (c.expertise || []).map(function (x) { return str(x).trim(); }).filter(Boolean).slice(0, 3);
  var contributed = str(c.contributed).trim().replace(/[.\s]+$/, '');
  if (desig || comp) {
    var who = name + ' is ' + (desig && comp ? 'the ' + desig + ' at ' + comp : desig ? 'the ' + desig : 'with ' + comp) +
      (industry ? ', with expertise in ' + industry : '') + '.';
    if (contributed) who += ' ' + name + ' has contributed to ' + contributed + '.';
    out.push({ q: 'Who is ' + name + '?', a: who, common: 1 });
  }
  if (expertise.length) out.push({ q: 'What is ' + name + '\u2019s area of expertise?', a: name + ' specialises in ' + listOf(expertise) + '.', common: 2 });
  if (past.length) {
    var seen = {}, named = past.filter(function (j) { var k = str(j.title).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
    var three = named.slice(0, 3).map(function (j) { return str(j.title).trim() + ' as ' + partOf(j); });
    var a3 = named.length === 1
      ? name + ' has participated in ' + str(named[0].title).trim() + ', organised by The Economic Times, as ' + partOf(named[0]) + '.'
      : named.length <= 3
        ? name + ' has participated in ' + listOf(three) + (named.length === 2 ? ', both' : ', all') + ' organised by The Economic Times.'
        : name + ' has participated in ' + named.length + ' events organised by The Economic Times, among them ' + listOf(three) + '.';
    out.push({ q: 'Which Economic Times events has ' + name + ' participated in?', a: a3, common: 3 });
  }
  var topics = [];
  shown.forEach(function (j) { (j.sessions || []).forEach(function (s) { var t = topicOf(s.title); if (t && topics.map(function (x) { return x.toLowerCase(); }).indexOf(t.toLowerCase()) === -1) topics.push(t); }); });
  if (topics.length) out.push({ q: 'What topics has ' + name + ' discussed at industry events?', a: name + ' has shared insights on ' + listOf(topics.slice(0, 3).map(quoted)) + '.', common: 4 });
  if (past.length) {
    var sites = [];
    past.forEach(function (j) { var n = str(j.portalName).trim(); if (n && sites.indexOf(n) === -1) sites.push(n); });
    out.push({ q: 'Where can I watch ' + name + '\u2019s event sessions?', a: 'Visitors can explore available event videos, session highlights, and related coverage on ' + (listOf(sites.slice(0, 3)) || 'ETB2B') + '.', common: 5 });
  }
  return out;
}
/* the common questions first, then the team's own; a question the team wrote itself replaces the common one */
function faqsOf(p, today) {
  var own = (p.faqs || []).filter(function (f) { return f && str(f.q).trim() && str(f.a).trim(); });
  var key = function (q) { return str(q).toLowerCase().replace(/[\u2019']/g, "'").replace(/[^a-z0-9']+/g, ' ').trim(); };
  var mine = own.map(function (f) { return key(f.q); });
  return commonFaqs(p, today).filter(function (f) { return mine.indexOf(key(f.q)) === -1; }).concat(own);
}

function faqHtml(list) {
  list = (list || []).filter(function (f) { return f && str(f.q).trim() && str(f.a).trim(); });
  if (!list.length) return '';
  return '<section class="faq" aria-labelledby="h-faq"><div class="wrap"><h2 class="h" id="h-faq">Frequently asked questions</h2><div class="qs">' + list.map(function (f) {
    return '<details><summary>' + esc(f.q) + '</summary><div class="prose">' + paras(f.a) + '</div></details>';
  }).join('') + '</div></div></section>';
}

function renderSpeaker(p, o) {
  var base = str(o.base).replace(/\/+$/, ''), canonical = base ? base + '/speakers/' + p.slug : '';
  var role = [p.designation, p.company].filter(Boolean).join(', ');
  var st = p.stats || {}, today = str(o.today);
  var shown = shownOf(p);
  var firstEvent = (shown.filter(function (j) { return !isComing(j, today); })[0] || shown[0] || {}).title || '';
  var title = p.name + (role ? ', ' + role : '') + ' | ETB2B Events';
  var did = [st.events ? 'has spoken at ' + plural(st.events, 'ETB2B event', 'ETB2B events') : '', st.awards ? (st.events ? 'sat on ' : 'has sat on ') + plural(st.awards, 'ETB2B award jury', 'ETB2B award juries') : ''].filter(Boolean).join(' and ');
  var description = cut(p.about || p.bio || (p.wiki && p.wiki.extract) || (p.name + (role ? ' (' + role + ')' : '') + (did ? ' ' + did + (st.since ? ' since ' + st.since : '') + (firstEvent ? ', most recently ' + firstEvent : '') : '') + '.'), 160);
  var photo = picture(p.photo), share = /^https:/.test(photo) ? photo : '';
  var sameAs = [p.linkedin, p.x, p.wiki && p.wiki.url].filter(function (u) { return /^https:\/\//.test(str(u)); });
  var person = { '@type': 'Person', name: p.name };
  if (p.designation) person.jobTitle = p.designation;
  if (p.company) person.worksFor = { '@type': 'Organization', name: p.company };
  if (share) person.image = share;
  if (sameAs.length) person.sameAs = sameAs;
  if (p.about || p.bio) person.description = cut(p.about || p.bio, 300);
  var ld = { '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: person };
  if (canonical) ld.url = canonical;
  var faqs = faqsOf(p, today);
  if (faqs.length) ld = [ld, { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(function (f) { return { '@type': 'Question', name: str(f.q), acceptedAnswer: { '@type': 'Answer', text: str(f.a) } }; }) }];
  var acts = [];
  if (/^https:\/\//.test(str(p.linkedin))) acts.push('<a class="btn" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + ' on LinkedIn (opens in a new tab)">' + ICON.li + 'LinkedIn</a>');
  if (/^https:\/\//.test(str(p.x))) acts.push('<a class="btn" href="' + esc(p.x) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + ' on X (opens in a new tab)">' + ICON.x + 'X</a>');
  var logo = picture(p.logo);
  var credit = p.photoCredit && /^https:\/\//.test(str(p.photoCredit.href)) && photo === p.photo
    ? '<p class="credit">Photo: <a href="' + esc(p.photoCredit.href) + '" target="_blank" rel="noopener">' + esc(p.photoCredit.label || 'Wikimedia Commons') + '</a></p>' : '';
  var sinceLine = st.since ? (st.events ? 'Speaker at ETB2B events since ' + st.since : 'With ETB2B since ' + st.since) : 'Speaker at ETB2B events';
  /* what is to come, nearest first: the first beside the name, the rest in the side */
  var coming = shown.filter(function (j) { return isComing(j, today); }).sort(function (a, b) { var x = a.date || a.year, y = b.date || b.year; return x < y ? -1 : x > y ? 1 : 0; });
  var past = shown.filter(function (j) { return coming.indexOf(j) === -1; });
  var who = '<section class="who" aria-labelledby="h-name"><div class="wrap' + (coming.length ? ' has-up' : '') + '">' +
    '<div><figure class="ph">' + (photo ? '<img src="' + esc(photo) + '" alt="' + esc(p.name) + '" width="240" height="300">' : '<span aria-hidden="true">' + esc(initials(p.name)) + '</span>') + '</figure>' + credit + '</div>' +
    '<div><p class="since">' + esc(sinceLine) + '</p><h1 id="h-name">' + esc(p.name) + '</h1>' +
    (role ? '<p class="role">' + esc(p.designation) + (p.designation && p.company ? ', ' : '') + (p.company ? '<span class="co">' + esc(p.company) + '</span>' : '') + (logo ? '<img class="co-logo" src="' + esc(logo) + '" alt="">' : '') + '</p>' : '') +
    (acts.length ? '<div class="acts">' + acts.join('') + '</div>' : '') + '</div>' + upNowHtml(coming[0], today) + '</div></section>';
  var about = p.about || p.bio;
  var main = (about ? '<section aria-labelledby="h-about"><h2 class="h" id="h-about">About</h2><div class="prose">' + paras(about) + '</div></section>' : '') +
    wikiHtml(p) + extrasHtml(p) + journeyHtml(p, o);
  var side = upcomingHtml(coming.slice(1)) + portalsHtml(shown, false) + alongsideHtml(shown) + linksHtml(p) + shareHtml(canonical, p.name);
  return head({ title: title, description: description, canonical: canonical, image: share, ogType: 'profile', ld: ld, look: o.look }) +
    '<body>' + topBar(o.back, darkLook(o.look)) + who + yearsHtml(p, past, 'speakers') +
    '<div class="page"><div class="wrap"><main>' + main + '</main><aside>' + side + '</aside></div></div>' + similarHtml(p.similar) + faqHtml(faqs) + footer() + '</body></html>\n';
}

function renderSponsor(p, o) {
  var base = str(o.base).replace(/\/+$/, ''), canonical = base ? base + '/sponsors/' + p.slug : '';
  var st = p.stats || {}, today = str(o.today);
  var shown = shownOf(p);
  var title = p.name + ' | ETB2B Events partner';
  var description = cut(p.about || (p.wiki && p.wiki.extract) || (p.name + (st.events ? ' has partnered ' + plural(st.events, 'ETB2B event', 'ETB2B events') + (st.since ? ' since ' + st.since : '') : ' partners ETB2B events') + '.'), 160);
  var logo = picture(p.logo), share = /^https:/.test(logo) ? logo : '';
  var org = { '@type': 'Organization', name: p.name };
  if (/^https?:\/\//.test(str(p.website))) org.url = p.website;
  if (share) org.logo = share;
  if (p.about) org.description = cut(p.about, 300);
  if (p.wiki && /^https:\/\//.test(str(p.wiki.url))) org.sameAs = [p.wiki.url];
  var ld = { '@context': 'https://schema.org', '@type': 'AboutPage', mainEntity: org };
  if (canonical) ld.url = canonical;
  /* the tiers they have partnered at, most often first */
  var tiers = {}, tierList = [];
  shown.forEach(function (j) { var t = tierLabel(j.tier); if (!t) return; if (!tiers[t]) { tiers[t] = { name: t, n: 0 }; tierList.push(tiers[t]); } tiers[t].n++; });
  tierList.sort(function (a, b) { return b.n - a.n; });
  var site = /^https?:\/\//.test(str(p.website)) ? '<div class="acts"><a class="btn" href="' + esc(p.website) + '" target="_blank" rel="noopener" aria-label="' + esc(p.name) + '’s website (opens in a new tab)">Website ' + ICON.out + '</a></div>' : '';
  var who = '<section class="who" aria-labelledby="h-name"><div class="wrap">' +
    '<div><figure class="ph logo">' + (logo ? '<img src="' + esc(logo) + '" alt="' + esc(p.name) + ' logo" width="240" height="240">' : '<span aria-hidden="true">' + esc(initials(p.name)) + '</span>') + '</figure></div>' +
    '<div><p class="since">' + esc(st.since ? 'Partner of ETB2B events since ' + st.since : 'Partner of ETB2B events') + '</p><h1 id="h-name">' + esc(p.name) + '</h1>' + site + '</div></div></section>';
  var coming = shown.filter(function (j) { return isComing(j, today); });
  var main = nextHtml(coming, true) + (p.about ? '<section aria-labelledby="h-about"><h2 class="h" id="h-about">About</h2><div class="prose">' + paras(p.about) + '</div></section>' : '') +
    wikiHtml(p) + extrasHtml(p) + journeyHtml(p, o);
  var side = (tierList.length ? '<section aria-labelledby="h-tiers"><h2 id="h-tiers">Partnered as</h2><ul class="list">' + tierList.slice(0, 8).map(function (t) {
      return '<li><span>' + esc(t.name) + '</span><span class="c">' + plural(t.n, 'time', 'times') + '</span></li>';
    }).join('') + '</ul></section>' : '') + portalsHtml(shown, true) + linksHtml(p) + shareHtml(canonical, p.name);
  return head({ title: title, description: description, canonical: canonical, image: share, ogType: 'website', ld: ld, look: o.look }) +
    '<body>' + topBar(o.back, darkLook(o.look)) + who + yearsHtml(p, shown, 'sponsors') +
    '<div class="page"><div class="wrap"><main>' + main + '</main><aside>' + side + '</aside></div></div>' + footer() + '</body></html>\n';
}

function render(person, o) {
  o = o || {};
  /* the event the visitor came from: its look, and the way back kept on links to other speakers' pages */
  KEEP.q = o.back && /^\?from=[A-Za-z0-9-]+(&via=[A-Za-z0-9._~%-]+)?$/.test(str(o.back.query)) ? str(o.back.query) : '';
  o.look = o.back && o.back.look ? o.back.look : null;
  try { return person.kind === 'sponsors' ? renderSponsor(person, o) : renderSpeaker(person, o); } finally { KEEP.q = ''; }
}
function darkLook(look) { var bg = look && hexOk(look.bg); return !!bg && lum(bg) < 0.2; }

module.exports = { render: render, _test: { dayLabel: dayLabel, timeLabel: timeLabel, cut: cut, paras: paras, picture: picture, link: link, roleLabel: roleLabel, tierLabel: tierLabel, shownRole: shownRole, byYear: byYear, commonFaqs: commonFaqs, faqsOf: faqsOf, DOMAIN: DOMAIN, listOf: listOf, domainsOf: domainsOf, topicOf: topicOf } };
