#!/usr/bin/env python3
"""python3 tools/extract-promo-social.py [path to the platform's app/public/index.html]

Copies the promotional platform's social posts studio (the owner's Social Post Generator, app/public/index.html)
into Oneworld, by line range, unchanged except SOCIAL_PATCHES (listed below):

  promo-studio/social-studio.js    the studio's code: the event page's social half (the header card, the upload
                                   strip, the template cards and their thumbnails), the template options, and the
                                   whole layout editor with its toast and in-app dialogs
  promo-social-studio.html         the page: Oneworld's theme first, the platform's fonts and stylesheet, the
                                   editor's markup, the toast and the dialog, then those files and Oneworld's own

The page links the platform's stylesheet that tools/extract-promo-studio.py already copies
(promo-studio/mailer-studio.css is the same lines of index.html, and holds the posts studio's rules too), so the
platform's CSS lives in one copy only. Then promo-studio/oneworld.css (the console's tokens, shared with the
mailer page) and promo-studio/oneworld-social.css (the few rules only this page needs) give it Oneworld's look.

Oneworld's own files on this page are hand-written and load after the copied code, so their function
declarations replace the platform's of the same name:
  promo-studio/oneworld-social.js          the request helper on Oneworld's routes and sign-in, the event this
                                           page is for, the browser drawing, the cards and previews, the guards
  promo-studio/oneworld-social-art.js      the PSD, background and logo uploads, drawn and sized in the browser
  promo-studio/oneworld-social-caption.js  the Caption tab, Write with AI and Suggest headlines (loads last)

Left out on purpose: generateAll (its "Generate all" button is never shown once a product is chosen), the
Generate drawer and its preview / download (nothing opens it), and editFromDrawer (the drawer's way into the
editor). The ranges below were read from the platform's index.html on 2026-10-29; when the platform changes,
check them against the file and run this again. Every range is checked by its first line, and every patch by how
many times its text is found, before anything is written.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/Social Post Generator/app/public/index.html')
lines = open(SRC, encoding='utf-8').read().split('\n')

def rng(a, b, starts):
    """lines a..b (1-based, inclusive), checked: line a must start with `starts` (after spaces)"""
    first = lines[a - 1].lstrip()
    if not first.startswith(starts):
        sys.exit('line %d no longer starts with %r (it is %r): the platform changed; read the file again' % (a, starts, first[:80]))
    return '\n'.join(lines[a - 1:b])

# The platform's Google Fonts link: the nine families the templates and the editor's font list (EDFONTS) use.
FONTS = rng(15, 17, '<link rel="preconnect" href="https://fonts.googleapis.com">')
EDITOR = rng(1010, 1043, '<div id="editor">')
DIALOGS = rng(1140, 1155, '<div class="toast" id="toast">')
JS_PARTS = [
    ('$', rng(1158, 1158, 'const $=')),
    ('ordinal (the header card\'s "9th edition")', rng(1437, 1437, 'const ordinal=')),
    ('skeletons', rng(1689, 1700, 'const skGrid')),
    ('the event page\'s social half: the event, its header card, the template cards and thumbnails, the uploads',
     rng(1845, 2020, 'async function openEvent')),
    ('findTpl', rng(2031, 2031, 'function findTpl')),
    ('the template options', rng(2041, 2088, 'function buildParams')),
    ('the layout editor: its state, escaping, toast and the in-app dialogs, colours, open and close',
     rng(2117, 2188, '/* ================= Full-page layout editor')),
    ('the layout editor: stage, elements, panels, insert, save, reset, download and its keys',
     rng(2190, 2768, 'function wireTheme')),
]
JS = '\n\n'.join('/* ===== from the platform\'s index.html: %s ===== */\n%s' % (t, s) for t, s in JS_PARTS)
TEXT = {'code': JS, 'markup': EDITOR}

# ONEWORLD PORT: the only changes made to the platform's code and markup, as (id, where, old, new, times old must be
# found, why). `where` is the assembled code or the editor's markup. They are applied in order, S1 first. A count
# that differs stops the copy before anything is written, so a platform change under an anchor is read and
# re-decided, never shipped half-patched. Raw strings: the code holds backticks, ${} and regular expressions. The
# functions they call (owLeaveEditor, owNudgeSnap, owConfirmReset, owMayDiscard) and the OWS state S14 reads are
# promo-studio/oneworld-social.js's, and owRenderCaption is promo-studio/oneworld-social-caption.js's.
SOCIAL_PATCHES = [
    ('S1', 'code',
     r'''const escapeHtml=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");''',
     r'''const escapeHtml=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");''',
     1, 'quotes are escaped too, so a name or an address with a quote in it cannot end the attribute it is written into'),
    ('S2', 'code',
     r'''$("edBg").src="";''',
     r'''$("edBase").src="";''',
     1, 'the stage\'s base picture has its own id: the platform gave it "edBg", which the Background select already has, so the picture was never set and never shown'),
    ('S3', 'code',
     r'''function mountStage(){ $("edBg").src=EDIT.base;''',
     r'''function mountStage(){ $("edBase").src=EDIT.base;''',
     1, 'the stage shows the base picture it was drawn on (same reason)'),
    ('S4', 'code',
     r'''t.id==="edBg"||''',
     r'''t.id==="edBg"||t.id==="edBase"||''',
     1, 'a click on the base picture clears the selection, as a click on the empty stage does'),
    ('S5′', 'code',
     r'''function applyOptions(){
  const host=$("edOpts"); const p=host?collectParams(host):{};
  edParams={ theme:edParams.theme, ...p };
  edMode="props"; loadEditor(true); toast("✓ Options applied — re-rendered from the template"); // fresh; Save to keep
}''',
     r'''async function applyOptions(){
  const host=$("edOpts"); const p=host?collectParams(host):{};
  if(!(await owMayDiscard()))return;
  edParams={ theme:edParams.theme, bg:edParams.bg, ...p };
  edMode="props"; loadEditor(true); toast("✓ Options applied — re-rendered from the template"); // fresh; Save to keep
}''',
     1, 'applying options keeps the chosen background, and asks first when the layout has unsaved edits; on Cancel the Options tab stays with what was typed, and no "applied" toast is shown'),
    ('S6', 'code',
     r'''const params={ theme:edParams.theme, ...(host?collectParams(host):{}) };''',
     r'''const params={ theme:edParams.theme, bg:edParams.bg, ...(host?collectParams(host):{}) };''',
     1, 'the all-sizes ZIP is drawn on the chosen background, as the canvas is'),
    ('S7′', 'code',
     r'''if(e.key==="Escape"){ closeEditor(); return; }''',
     r'''if(e.key==="Escape"){ const ae=document.activeElement||{}, picked=ae.tagName==="SELECT"||(ae.tagName==="INPUT"&&/^(checkbox|radio|range|color|file|button|submit|reset|image)$/.test(ae.type||"")); if((!inField||picked)&&!e.defaultPrevented) owLeaveEditor(); return; }''',
     1, 'Escape no longer closes the editor while typing in a field, asks before dropping unsaved edits, and does nothing when the dialog\'s own Escape has just closed the dialog. Only text entry holds Escape back: focus stays on a select after a pick (template, size, background, font) and on a checkbox or the colour picker after a click, and Escape still leaves from those, as it did on the platform (typingTarget counts them as fields so that arrows and Backspace keep working there)'),
    ('S8', 'markup',
     r'''<button class="back" onclick="closeEditor()" title="Back">←</button>''',
     r'''<button class="back" onclick="owLeaveEditor()" title="Back">←</button>''',
     1, 'the Back arrow asks before dropping unsaved edits'),
    ('S9', 'code',
     r'''if(e.key.startsWith("Arrow")){ e.preventDefault(); const d=e.shiftKey?10:1;''',
     r'''if(e.key.startsWith("Arrow")){ e.preventDefault(); owNudgeSnap(); const d=e.shiftKey?10:1;''',
     1, 'arrow-key nudges can be undone (one undo step per burst of nudges)'),
    ('S10', 'code',
     r'''const el=EDIT.els[edSel],px=$("epX"),py=$("epY"); if(el){if(px)px.value=Math.round(el.x);if(py)py.value=Math.round(el.y);} }''',
     r'''const el=EDIT.els[edSel],px=$("epX"),py=$("epY"); if(el){if(px)px.value=Math.round(el.x);if(py)py.value=Math.round(el.y);} layoutGroupFrame(); }''',
     1, 'the group\'s frame follows a nudged selection instead of staying where it was'),
    ('S11', 'code',
     r'''const el=EDIT.els[edSel], px=$("epX"),py=$("epY"); if(el){ if(px)px.value=Math.round(el.x); if(py)py.value=Math.round(el.y); }
}''',
     r'''const el=EDIT.els[edSel], px=$("epX"),py=$("epY"); if(el){ if(px)px.value=Math.round(el.x); if(py)py.value=Math.round(el.y); }
  layoutGroupFrame();
}''',
     1, 'the group\'s frame follows an aligned selection too'),
    ('S12', 'code',
     r'''if(it.el.type==="image"||it.el.type==="shape") it.el.h=''',
     r'''if(it.el.type==="image"||it.el.type==="shape"||it.el.type==="frame") it.el.h=''',
     1, 'resizing a group scales a photo frame\'s height with its width, as it does for images and shapes, instead of stretching it'),
    ('S13', 'code',
     r'''async function edReset(){
  await api("/api/editor/reset",''',
     r'''async function edReset(){
  if(!(await owConfirmReset()))return;
  const rr=await api("/api/editor/reset",''',
     1, 'Reset asks first: it deletes the saved layout'),
    ('S14', 'code',
     r'''edHist=[]; edRedo=[]; updUndo(); loadEditor(true); toast("Reset to the original template");''',
     r'''if(!rr.ok){ if(window.OWS)OWS.skipGuard=false; toast("Reset failed"); return; } edHist=[]; edRedo=[]; updUndo(); loadEditor(true); toast("Reset to the original template");''',
     1, 'a reset that failed says so, instead of claiming the layout was reset. The yes to "Reset this layout?" (S13) let the one redraw that follows skip the unsaved-edits question; no redraw follows a failure, so that pass is given back here, whatever way the request failed, or the next template, size, theme or background switch would draw over unsaved edits without asking'),
    ('S15', 'code',
     r'''const j=r.ok?await r.json():{speakers:[],sponsors:[]}; edAssetsCache[k]=j; return j; }''',
     r'''if(!r.ok) return {speakers:[],sponsors:[]}; const j=await r.json(); edAssetsCache[k]=j; return j; }''',
     1, 'a failed speakers and sponsors fetch is not kept, so opening Insert again tries again'),
    ('S16', 'code',
     r'''tx.oninput=()=>{el.text=tx.value;applyNode(node,el);updLayerLabel();};''',
     r'''tx.oninput=()=>{el.text=tx.value;if(/\n/.test(el.text)&&el.whiteSpace==="nowrap")el.whiteSpace="pre-wrap";applyNode(node,el);updLayerLabel();};''',
     1, 'a line break typed into one-line text breaks the line on the canvas and in the download'),
    ('S17', 'code',
     r'''<button class="${edMode==="options"?"on":""}" onclick="edTab('options')">Options</button></div><div id="edSideBody"></div>`;''',
     r'''<button class="${edMode==="options"?"on":""}" onclick="edTab('options')">Options</button>
    <button class="${edMode==="caption"?"on":""}" onclick="edTab('caption')">Caption</button></div><div id="edSideBody"></div>`;''',
     1, 'the side panel gains a fourth tab, Caption (Oneworld\'s captions, merged into the editor)'),
    ('S18', 'code',
     r'''if(edMode==="insert") renderInsert(); else if(edMode==="options") renderOptions(); else renderProps();''',
     r'''if(edMode==="insert") renderInsert(); else if(edMode==="options") renderOptions(); else if(edMode==="caption") owRenderCaption(); else renderProps();''',
     1, 'the Caption tab shows the caption panel'),
    ('S19', 'code',
     r'''wrap.innerHTML=`<label class="h">${par.label}</label>`;''',
     r'''wrap.innerHTML=`<label class="h">${escapeHtml(par.label)}</label>`;''',
     1, 'option labels are escaped: they hold the event\'s speaker and partner names'),
    ('S20', 'code',
     r'''l.innerHTML=`<input type="checkbox" value="${o.value}"> ${o.label}`;''',
     r'''l.innerHTML=`<input type="checkbox" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}`;''',
     1, 'the multiselect\'s choices are escaped (names from the event)'),
    ('S21', 'code',
     r'''`<option value="${o.value}">${o.label}</option>`''',
     r'''`<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`''',
     1, 'the select\'s choices are escaped (names from the event)'),
    ('S22', 'code',
     r'''${s.photoUrl?`<img src="${s.photoUrl}"''',
     r'''${s.photoUrl?`<img src="${escapeHtml(s.photoUrl)}"''',
     1, 'a speaker\'s photo address is escaped before it is written into the Insert list'),
    ('S23', 'code',
     r'''<img src="${s.logoUrl}"''',
     r'''<img src="${escapeHtml(s.logoUrl)}"''',
     1, 'a partner\'s logo address is escaped too'),
    ('S24', 'code',
     r'''const f=inp.files[0]; if(!f) return;''',
     r'''const f=inp.files[0]; inp.value=""; if(!f) return;''',
     3, 'the file picker is cleared after each pick, so the same file can be uploaded again'),
    ('S25', 'code',
     r'''if(j.ok){ inp.closest(".slot")?.classList.add("on");''',
     r'''if(j.ok){ inp.closest(".slot")?.classList.toggle("on",!!j.background);''',
     1, 'the PSD pill turns on only when the PSD gave a background'),
    ('S26', 'markup',
     r'''<img class="bg" id="edBg">''',
     r'''<img class="bg" id="edBase" alt="">''',
     1, 'the stage\'s base picture gets its own id (see S2) and an empty alt: it is the post itself, drawn as one picture'),
    ('S27', 'code',
     r'''`Upload failed: ${j.error||''}`''',
     r'''`Upload failed: ${escapeHtml(j.error||'')}`''',
     3, 'the server\'s reason for a failed upload is escaped before it is written into the status line'),
    ('S28', 'code',
     r'''toast(r.ok?"✓ Saved — your edits will reload next time":"Save failed");''',
     r'''const sj=r.ok?null:await r.json().catch(()=>null); toast(r.ok?"✓ Saved — your edits will reload next time":"Save failed"+(sj&&sj.error?": "+sj.error:""), r.ok?undefined:6000);''',
     1, 'a failed save says why when the server says why (someone else changed the layout meanwhile, it is too large…), for long enough to read'),
]
for pid, where, old, new, want, why in SOCIAL_PATCHES:
    got = TEXT[where].count(old)
    if got != want:
        sys.exit('patch %s (%s): its text is found %d time(s) in the copied %s, not %d — the platform changed; read it again and fix SOCIAL_PATCHES'
                 % (pid, why, got, where, want))
    TEXT[where] = TEXT[where].replace(old, new)
JS, EDITOR = TEXT['code'], TEXT['markup']

JS_BANNER = ('/* COPIED from the promotional platform (the owner\'s Social Post Generator, app/public/index.html) by\n'
             '   tools/extract-promo-social.py, unchanged except SOCIAL_PATCHES (listed in tools/extract-promo-social.py) — do\n'
             '   not edit here: Oneworld\'s changes are in promo-studio/oneworld-social.js, oneworld-social-art.js and\n'
             '   oneworld-social-caption.js, which load after this file. */\n')

HTML = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Social posts — Oneworld 2.0</title>
<!-- GENERATED by tools/extract-promo-social.py: the promotional platform's social posts studio (its event page's
     social half and its layout editor), on Oneworld. Shown inside Promotions → Social posts (marketing.html).
     Edit promo-studio/oneworld-social.js, oneworld-social-art.js, oneworld-social-caption.js or
     oneworld-social.css, not this file. -->
<script src="promo-studio/oneworld-theme.js"></script>
''' + FONTS + '''
<link rel="stylesheet" href="promo-studio/mailer-studio.css">
<link rel="stylesheet" href="promo-studio/oneworld.css">
<link rel="stylesheet" href="promo-studio/oneworld-social.css">
</head>
<body class="ow-embed ow-social">
  <div id="app" style="display:block">
    <div class="content" id="content"></div>
  </div>

''' + EDITOR + '''

''' + DIALOGS + '''

<script src="auth.js"></script>
<script src="assets/vendor/html-to-image-exact.js"></script>
<script src="assets/vendor/jszip.min.js"></script>
<script src="assets/vendor/promo-social.js"></script>
<script src="promo-studio/social-studio.js"></script>
<script src="promo-studio/oneworld-social.js"></script>
<script src="promo-studio/oneworld-social-art.js"></script>
<script src="promo-studio/oneworld-social-caption.js"></script>
</body>
</html>
'''

# Everything is read and checked above; only now is anything written.
os.makedirs(os.path.join(ROOT, 'promo-studio'), exist_ok=True)
with open(os.path.join(ROOT, 'promo-studio', 'social-studio.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(JS_BANNER + JS + '\n')
with open(os.path.join(ROOT, 'promo-social-studio.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(HTML)
print('Copied the social studio: %d JS lines (%d patches), markup %d lines'
      % (JS.count('\n') + 1, len(SOCIAL_PATCHES), EDITOR.count('\n') + DIALOGS.count('\n') + 2))
