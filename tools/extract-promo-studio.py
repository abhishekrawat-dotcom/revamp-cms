#!/usr/bin/env python3
"""python3 tools/extract-promo-studio.py [path to the platform's app/public/index.html]

Copies the promotional platform's mailer studio (the owner's Social Post Generator, app/public/index.html)
into Oneworld, by line range, unchanged except PATCHES (listed below):

  promo-studio/mailer-studio.css   the page's stylesheet (the studio, its cards, dialogs, toast, the dashboard)
  promo-studio/mailer-studio.js    the studio's code: the event page's mailer half, the block studio, and the
                                   mailer product's nav and dashboard ("Mailer performance")
  promo-studio/richtext.js         the rich-text bridge (marker text <-> formatting), as the platform has it
  assets/vendor/quill/             the vendored Quill the platform edits long copy with
  promo-mailer-studio.html         the page: the product nav, the studio's markup, then those files, then
                                   promo-studio/oneworld.js (and, first in its head, promo-studio/oneworld-theme.js:
                                   Oneworld's light or dark, before anything paints)

promo-studio/oneworld.js is Oneworld's own (hand-written): the request helper on Oneworld's routes and
sign-in, the event this page is for (or the whole team's view, ?scope=all), and the few functions it replaces
(it loads last, so its function declarations win). The ranges below were read from the platform's index.html
of 2026-10-28; when the platform changes, check them against the file and run this again. Every range is
checked by its first line, and every patch by how many times its text is found, before anything is written.
"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/Social Post Generator/app/public/index.html')
PUB = os.path.dirname(SRC)
lines = open(SRC, encoding='utf-8').read().split('\n')

def rng(a, b, starts):
    """lines a..b (1-based, inclusive), checked: line a must start with `starts` (after spaces)"""
    first = lines[a - 1].lstrip()
    if not first.startswith(starts):
        sys.exit('line %d no longer starts with %r (it is %r): the platform changed; read the file again' % (a, starts, first[:80]))
    return '\n'.join(lines[a - 1:b])

CSS = rng(27, 955, '')
MARKUP = rng(1046, 1156, '<div id="mailer">')
NAV = rng(974, 977, '<div class="pnav" id="prodNav"')
JS_PARTS = [
    ('$', rng(1158, 1158, 'const $=')),
    ('the mailer product\'s nav', rng(1337, 1344, '/** The mailer product carries a persistent nav')),
    ('number and date helpers, and the mailer dashboard', rng(1434, 1639, 'const S_OPEN')),
    ('"Recently updated": every saved version of this event', rng(1641, 1683, '/* ---------- Saved (this event)')),
    ('skeletons', rng(1689, 1700, 'const skGrid')),
    ('escaping, toast and the in-app dialogs', rng(2123, 2161, 'const escapeHtml')),
    ('menus', rng(2700, 2703, '/* ---- menus ---- */')),
    ('typingTarget', rng(2734, 2744, '/** Does the focused thing own this keystroke?')),
    ('the mailer studio', rng(2770, 5076, '/* ================= Promotional mailers')),
]
JS = '\n\n'.join('/* ===== from the platform\'s index.html: %s ===== */\n%s' % (t, s) for t, s in JS_PARTS)

# ONEWORLD PORT: the only changes made to the platform's code, as (old, new, times old must be found, why). They
# are applied to the assembled JS in order, P1 first. A count that differs stops the copy before anything is
# written, so a platform change under an anchor is read and re-decided, never shipped half-patched. Raw strings:
# the code holds backticks and ${}. The functions they call (owTrackToast, owDashSubline, owDashPickLabel,
# anOpenRow, the index-taking anToggleVer) and AN.fresh are promo-studio/oneworld.js's. P11 and P12 fix faults of
# the platform's own (owner D; owner B's decision 5), so the copy does what the platform meant it to.
PATCHES = [
    (r'''const escapeHtml=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");''',
     r'''const escapeHtml=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");''',
     1, 'quotes are escaped too, so a subject or a name with a quote in it cannot end the attribute it is written into'),
    (r'''Off by default: clean, direct URLs, no vercel/deployment domain on hover, no click figures. Turning it on rewrites every href through this deployment's domain so clicks can be counted — recipients see that domain on hover. Opens (if tracking is configured on this deployment at all) are counted either way.''',
     r'''Off by default: links go straight to the real page, with no Oneworld address on hover and no click figures. Turning it on sends every link through Oneworld's own address so clicks can be counted — recipients see that address on hover. Opens are counted either way.''',
     1, 'the "Link tracking" hint in Oneworld\'s words; the field itself is hidden when tracking is off for the event'),
    (r'''toast(`Downloaded ${fname} — opens and clicks will show on your dashboard once it's sent.`,5000);''',
     r'''owTrackToast("download",r.headers.get("X-Mailer-Tracked")!=="no",fname);''',
     1, 'the download toast says when the file went out untracked, or that tracking is off, instead of promising numbers'),
    (r'''<p>Opens and clicks for every mailer downloaded or copied from this platform.</p>''',
     r'''<p>${owDashSubline()}</p>''',
     2, 'the dashboard\'s subline names its scope: this event\'s mailers, or every event\'s'),
    (r'''onclick="showPortals()">Pick an event →</button>''',
     r'''onclick="showPortals()">${owDashPickLabel()}</button>''',
     1, 'the empty dashboard\'s button: "Make a mailer" on an event, "Pick an event" for the team'),
    (r'''map(x=>`<tr onclick="anOpen('${escapeHtml(x.portal)}','${escapeHtml(x.event)}','${escapeHtml(x.mailerId)}','${escapeHtml(x.eventName||"")}','${escapeHtml(x.saveId||"")}')">''',
     r'''map((x,i)=>`<tr onclick="anOpenRow(${i})">''',
     1, 'a Recent mailers row reopens by its index: no name or id is written into an inline handler, where an escaped quote is decoded before the script runs'),
    (r'''${vs?`onclick="anToggleVer('${escapeHtml(r.key)}')"`:""}''',
     r'''${vs?`onclick="anToggleVer(${i})"`:""}''',
     1, 'a template\'s versions open by row index, for the same reason'),
    (r'''onclick="AN.data=null;showAnalytics()">Refresh</button>''',
     r'''onclick="AN.data=null;AN.fresh=true;showAnalytics()">Refresh</button>''',
     1, 'Refresh skips the team view\'s 30-second cache'),
    (r'''try{ await navigator.clipboard.writeText((await r.json()).html); toast("HTML copied — paste into your ESP"); }''',
     r'''try{ const j=await r.json(); await navigator.clipboard.writeText(j.html); owTrackToast("copy",j.tracked!==false,""); }''',
     1, 'Copy HTML says when the copy went out untracked; a failure still says "Clipboard blocked by the browser"'),
    (r'''a.download="mailers.zip"; a.click(); toast("Downloaded — saved edits included"); }''',
     r'''a.download="mailers.zip"; a.click(); owTrackToast("zip",r.headers.get("X-Mailer-Tracked")!=="no",""); }''',
     1, 'Download all says when the files went out untracked'),
    (r'''const fallback=hexNorm((MD&&MD.palette&&MD.palette.accent)||"")||"#4f46e5";''',
     r'''const fallback=hexNorm((MD&&MD.pal&&MD.pal.accent)||"")||"#4f46e5";''',
     1, 'a colour field\'s "Use the mailer accent" (its swatch, the picker\'s default, the sample button) reads the palette '
        'the studio keeps, MD.pal (mlApplyPalette); the platform read MD.palette, which nothing sets, so it always showed its indigo'),
    (r'''const avail=(MAILERS.mailers||[]).filter(m=>m.available);''',
     r'''const avail=(MAILERS.mailers||[]).filter(m=>m.available||(saveId&&m.id===preId));''',
     1, 'a saved version of a mailer the event can no longer make (its speakers were removed, say) opens on itself; the '
        'platform listed only the mailers that can be made, and silently opened another one in its place'),
]
for n, (old, new, want, why) in enumerate(PATCHES, 1):
    got = JS.count(old)
    if got != want:
        sys.exit('patch P%d (%s): its text is found %d time(s) in the copied code, not %d — the platform changed; read it again and fix PATCHES'
                 % (n, why, got, want))
    JS = JS.replace(old, new)

# The stylesheet keeps the plain banner (it is copied unchanged); the code says it carries PATCHES.
BANNER = ('/* COPIED from the promotional platform (the owner\'s Social Post Generator, app/public/index.html) by\n'
          '   tools/extract-promo-studio.py — do not edit here: Oneworld\'s changes are in promo-studio/oneworld.js. */\n')
JS_BANNER = ('/* COPIED from the promotional platform (the owner\'s Social Post Generator, app/public/index.html) by\n'
             '   tools/extract-promo-studio.py, unchanged except PATCHES (listed in tools/extract-promo-studio.py) — do not\n'
             '   edit here: Oneworld\'s changes are in promo-studio/oneworld.js. */\n')

HTML = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mailers — Oneworld 2.0</title>
<!-- GENERATED by tools/extract-promo-studio.py: the promotional platform's mailer studio, on Oneworld.
     Shown inside Promotions → Mailers (marketing.html), and as the team's Mailer performance
     (mailer-performance.html, ?scope=all). Edit promo-studio/oneworld.js, not this file. -->
<script src="promo-studio/oneworld-theme.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/vendor/quill/quill.snow.css">
<link rel="stylesheet" href="promo-studio/mailer-studio.css">
<link rel="stylesheet" href="promo-studio/oneworld.css">
<script src="assets/vendor/quill/quill.js"></script>
<script type="module" src="promo-studio/richtext.js"></script>
</head>
<body class="ow-embed">
  <div id="app" style="display:block">
    <div class="ow-bar">
''' + NAV + '''
    </div>
    <div class="content" id="content"></div>
  </div>

''' + MARKUP + '''

<script src="auth.js"></script>
<script src="assets/vendor/html-to-image.js"></script>
<script src="promo-studio/mailer-studio.js"></script>
<script src="promo-studio/oneworld.js"></script>
</body>
</html>
'''

# Everything is read and checked above; only now is anything written.
os.makedirs(os.path.join(ROOT, 'promo-studio'), exist_ok=True)
open(os.path.join(ROOT, 'promo-studio', 'mailer-studio.css'), 'w', encoding='utf-8').write(BANNER + CSS + '\n')
open(os.path.join(ROOT, 'promo-studio', 'mailer-studio.js'), 'w', encoding='utf-8').write(JS_BANNER + JS + '\n')
shutil.copyfile(os.path.join(PUB, 'richtext.js'), os.path.join(ROOT, 'promo-studio', 'richtext.js'))
qdst = os.path.join(ROOT, 'assets', 'vendor', 'quill')
os.makedirs(qdst, exist_ok=True)
for f in os.listdir(os.path.join(PUB, 'vendor', 'quill')):
    shutil.copyfile(os.path.join(PUB, 'vendor', 'quill', f), os.path.join(qdst, f))
open(os.path.join(ROOT, 'promo-mailer-studio.html'), 'w', encoding='utf-8').write(HTML)
print('Copied the studio: %d CSS lines, %d JS lines (%d patches), markup %d lines'
      % (CSS.count('\n') + 1, JS.count('\n') + 1, len(PATCHES), MARKUP.count('\n') + 1))
