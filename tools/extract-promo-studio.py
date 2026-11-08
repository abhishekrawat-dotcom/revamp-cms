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
                                   promo-studio/oneworld.js and promo-studio/oneworld-mail-easy.js (the "Edit myself"
                                   layout, batch B18), promo-studio/oneworld-ai-mode.js ("Edit with AI | Edit
                                   myself", batch B18-ai, with its .css), and, first in its head, promo-studio/oneworld-theme.js:
                                   Oneworld's light or dark, before anything paints

promo-studio/oneworld.js is Oneworld's own (hand-written): the request helper on Oneworld's routes and
sign-in, the event this page is for (or the whole team's view, ?scope=all), and the few functions it replaces
(it loads after the studio, so its function declarations win; promo-studio/oneworld-mail-easy.js, the "Edit myself"
layout of batch B18, loads after it in turn). The ranges below were read from the platform's index.html
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
# anOpenRow, the index-taking anToggleVer, owMayLeave, owMaySend, owFieldValue, owZipName, owDashNotRecorded) and
# AN.fresh are promo-studio/oneworld.js's. P11 and P12 fix faults of the platform's own (owner D; owner B's decision
# 5), so the copy does what the platform meant it to; so do P13 to P25 (the UX sweep's batch B09: no browser dialog is
# left, an unsaved mailer is never dropped without asking, Escape closes only what is on top, a menu shows the value
# in use) and P26 and P27 (batch B20: the dashboard does not say "nothing made yet" while nothing can be recorded).
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
     r'''a.download=owZipName(); a.click(); owTrackToast("zip",r.headers.get("X-Mailer-Tracked")!=="no",""); }''',
     1, 'Download all says when the files went out untracked, and the ZIP is named after the event (UX-136: every '
        'event\'s was "mailers.zip")'),
    (r'''const fallback=hexNorm((MD&&MD.palette&&MD.palette.accent)||"")||"#4f46e5";''',
     r'''const fallback=hexNorm((MD&&MD.pal&&MD.pal.accent)||"")||"#4f46e5";''',
     1, 'a colour field\'s "Use the mailer accent" (its swatch, the picker\'s default, the sample button) reads the palette '
        'the studio keeps, MD.pal (mlApplyPalette); the platform read MD.palette, which nothing sets, so it always showed its indigo'),
    (r'''const avail=(MAILERS.mailers||[]).filter(m=>m.available);''',
     r'''const avail=(MAILERS.mailers||[]).filter(m=>m.available||(saveId&&m.id===preId));''',
     1, 'a saved version of a mailer the event can no longer make (its speakers were removed, say) opens on itself; the '
        'platform listed only the mailers that can be made, and silently opened another one in its place'),
    (r'''function closeMailer(){
  if(MD.dirty&&!confirm("You have unsaved changes in this mailer. Close anyway?"))return;''',
     r'''async function closeMailer(){
  if(MD.dirty&&!(await owMayLeave("close")))return;''',
     1, '← and Escape ask in the studio\'s own dialog, in the words Social posts and Site-look posts use (owMayLeave), '
        'not with the browser\'s confirm'),
    (r'''function switchMailer(){ MD.id=$("mlPick").value; MD.sel=null; MD.ai=null; mlLoad(false,null); }''',
     r'''async function switchMailer(){ const to=$("mlPick").value; if(MD.dirty&&!(await owMayLeave("switch"))){ $("mlPick").value=MD.id; return; } MD.id=to; MD.sel=null; MD.ai=null; mlLoad(false,null); }''',
     1, 'picking another mailer in the studio\'s menu asks first when the open one has unsaved edits (the platform loaded '
        'the other one at once and the edits were gone); on Keep editing the menu goes back to the open mailer'),
    (r'''if(!await uiConfirm("Rebuild from event data?","This starts a fresh draft from the event's current data. Your saved versions are kept.",{ok:"Rebuild"}))return;''',
     r'''if(!await uiConfirm("Rebuild from event data?","This starts a fresh draft from the event's current data. "+(MD.dirty?"Changes you haven't saved are lost; your saved versions are kept.":"Your saved versions are kept."),{ok:"Rebuild",danger:MD.dirty}))return;''',
     1, 'Rebuild says that changes not saved are lost, when there are any (it said only that saved versions are kept)'),
    (r'''function mlTbApply(k){
  const el=IE.el; if(!el)return;
  const d=$("mlFrame").contentDocument;
  const b=MD.doc.blocks[blockIndex(MD.sel)];
  if(EXEC[k]||k==="h") return mlTbWrap(k);
  if(k==="a"){
    const sel=d.getSelection();
    if(!sel||!sel.rangeCount||!sel.toString().trim()){ toast("Select the words to link first"); return; }
    const url=prompt("Link URL","https://"); if(!url)return;
    mlKeepCaret(el,d); d.execCommand("createLink",false,url);''',
     r'''async function mlTbApply(k){
  const el=IE.el; if(!el)return;
  const d=$("mlFrame").contentDocument;
  const b=MD.doc.blocks[blockIndex(MD.sel)];
  if(EXEC[k]||k==="h") return mlTbWrap(k);
  if(k==="a"){
    const sel=d.getSelection();
    if(!sel||!sel.rangeCount||!sel.toString().trim()){ toast("Select the words to link first"); return; }
    const keep=sel.getRangeAt(0).cloneRange();
    el.removeEventListener("blur",IE.onBlur);
    const url=await uiPrompt("Link URL",{value:"https://",placeholder:"https://…",ok:"Add link"});
    if(IE.el!==el||$("mlFrame").contentDocument!==d||!d.contains(el)){ if(url)toast("The link was not added: the mail was redrawn meanwhile. Select the words and add it again.",5000); return; }
    try{ $("mlFrame").contentWindow.focus(); }catch(_){}
    el.focus(); sel.removeAllRanges(); sel.addRange(keep);
    el.addEventListener("blur",IE.onBlur);
    if(!url)return;
    mlKeepCaret(el,d); d.execCommand("createLink",false,url);''',
     1, 'a link typed on the canvas is asked for in the studio\'s own dialog. The dialog takes the focus, which would end '
        'the edit (it ends on blur), so that is held off while the dialog is open, and the words are selected again after it. '
        'A preview drawn again meanwhile (an earlier change answering late) replaces the words being edited: the link is '
        'then not added, and the toast says so'),
    (r'''  if(e.target.closest("#mlTB")||e.target.closest("#mlFrame"))return;''',
     r'''  if(e.target.closest("#mlTB")||e.target.closest("#mlFrame")||e.target.closest("#uiModal"))return;''',
     1, 'a click in the dialog does not end an edit on the canvas (the link dialog above is part of that edit)'),
    (r'''
function fmtApply(el,btn,onchange){
  const v=el.value,''',
     r'''
async function fmtApply(el,btn,onchange){
  const v=el.value,''',
     1, 'the settings panel\'s formatting bar waits for the link dialog below'),
    (r'''    const url=prompt("Link URL","https://");
    if(!url) return;
    const label=sel||"link text";
    out=v.slice(0,a)+`[${label}](${url})`+v.slice(z); caret=a+label.length+url.length+4;''',
     r'''    const url=await uiPrompt("Link URL",{value:"https://",placeholder:"https://…",ok:"Add link"});
    if(!url) return;
    const label=sel||"link text";
    out=v.slice(0,a)+`[${label}](${url})`+v.slice(z); caret=a+label.length+url.length+4;
    if(!el.isConnected){ onchange(out); mlProps(); mlInspector(); return; }''',
     1, 'a link in a settings field is asked for in the studio\'s own dialog; a panel drawn again while it was open (the '
        'speakers arriving, say) is drawn once more, with the link in it'),
    (r'''    if(!confirm(`Remove “${gone?gone.name:"this icon"}” from the library? Tiles already using it keep their URL.`)) return;''',
     r'''    if(!(await uiConfirm("Remove this icon?",`“${escapeHtml(gone?gone.name:"this icon")}” is taken out of the library. Tiles already using it keep their picture.`,{ok:"Remove",danger:true}))) return;''',
     1, 'removing an uploaded icon is confirmed in the studio\'s own dialog (the name is escaped: the dialog\'s text is markup)'),
    (r'''  if(e.target.closest("#icPop")) return;''',
     r'''  if(e.target.closest("#icPop")||e.target.closest("#uiModal")) return;''',
     1, 'a click in that dialog leaves the icon picker open, so it shows the library without the removed icon'),
    (r'''  // Save-name stays a native prompt: the editor audit pins this create-a-version
  // flow through the browser-dialog channel and asserts the exact name typed, and
  // the test file is outside this file's ownership. The duplicate-name auto-suffix
  // below still applies, and Rename/Delete/the AI confirmations use in-app modals.
  const name=prompt("Name this version",mlDefaultName());''',
     r'''  // Named in the studio's own dialog, as Rename is. The duplicate-name auto-suffix below still applies.
  const name=await uiPrompt("Name this version",{value:mlDefaultName(),placeholder:"Version name",ok:"Save"});''',
     1, 'Save as new names the version in the studio\'s own dialog (the platform kept the browser\'s prompt for its own '
        'test suite, which Oneworld does not run)'),
    (r'''if(e.key==="Escape"){ if(ICP.el) iconPopClose();''',
     r'''if(e.key==="Escape"){ if(e.defaultPrevented||$("uiModal").classList.contains("on")) return; if(ICP.el) iconPopClose();''',
     1, 'Escape that closed a dialog closes only the dialog: the studio\'s own Escape (which closes the studio) stands aside '
        'when the dialog has taken the key, as the social posts editor\'s does'),
    (r''': fldInput(f,b.props[f.key],set,''',
     r''': fldInput(f,owFieldValue(b,f,schema),set,''',
     1, 'a menu shows the value the mail uses: the field\'s default when the block has none (it showed the first choice, '
        'so every paragraph read Italic: Show and Line height: Tight)'),
    (r'''const btn=event?.target; if(btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span> zipping…';}''',
     r'''const btn=event?.target; if(!(await owMaySend("zip")))return; if(btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span> zipping…';}''',
     1, 'Download all asks first while the event\'s site is not published (owMaySend): every link in the mails leads to it'),
    (r'''${empty?`<div class="card an-empty"><div class="e">✉</div><h4>No mailers generated yet</h4>''',
     r'''${empty?owDashNotRecorded(a)||`<div class="card an-empty"><div class="e">✉</div><h4>No mailers generated yet</h4>''',
     1, 'while opens and clicks are not recorded, the empty dashboard says so (owDashNotRecorded): "No mailers generated '
        'yet … Download or copy a mailer" was untrue after mailers had been downloaded, and they would never show (UX-133)'),
    (r'''Ask whoever set up this platform to turn on performance tracking.''',
     r'''Ask your ETB2B EventSphere admin to turn on performance tracking.''',
     1, 'the "not being saved" note names who to ask (UX-133)'),
    # P28 to P33 (2026-11-07, ce0e58d): each message says what it is, so Promotions shows a failure in red until it is
    # dismissed and a note without the success tick. They were first written straight into the copied code; they are
    # patches here so that copying the platform again keeps them.
    (r'''catch(err){ toast(String(err.message||err)); }''',
     r'''catch(err){ toast(String(err.message||err),undefined,"error"); }''',
     2, 'an icon that could not be removed or uploaded is said as a failure'),
    (r'''toast(msg,5000); return null; }''',
     r'''toast(msg,5000,"error"); return null; }''',
     1, 'an AI request that failed is said as a failure'),
    (r'''.error||"Save failed"); return false; }''',
     r'''.error||"Save failed",undefined,"error"); return false; }''',
     1, 'a save that failed is said as a failure'),
    (r'''toast("This draft has not been saved yet"); return; }''',
     r'''toast("This draft has not been saved yet",undefined,"info"); return; }''',
     2, 'Rename and Delete on a draft never saved say so as a note'),
    (r'''toast(j.error||"Could not change the layout"); return; }''',
     r'''toast(j.error||"Could not change the layout",undefined,"error"); return; }''',
     1, 'a layout that could not be changed is said as a failure'),
    (r'''toast(j.error||"Could not read that file"); return; }''',
     r'''toast(j.error||"Could not read that file",undefined,"error"); return; }''',
     1, 'an HTML file that could not be read is said as a failure'),
    # P34 to P46 (batch B18, 2026-11-08: the mailer editor made easy, ~/.revamp-cms-qa/promo-easy-edit/DESIGN.md
    # sections 2 and 5). The layout itself is promo-studio/oneworld-mail-easy.js; these are the platform's own words and
    # the one path its in-place word edits take.
    (r'''onclick='openMailer(${q},null,false)'>Open in studio →</button>`)''',
     r'''onclick='openMailer(${q},null,false)'>Edit →</button>`)''',
     1, 'one word opens a design across Promotions: "Edit" (UX-132), not "Open in studio"'),
    (r'''>Continue “${escapeHtml(saves[0].name)}” →</button>''',
     r'''>Edit “${escapeHtml(saves[0].name)}” →</button>''',
     1, 'a card with a saved version opens it with "Edit" too (UX-132)'),
    (r'''`<div class="warn">needs ${m.missing.map(escapeHtml).join(", ")}</div>`''',
     r'''`<div class="warn">Needs ${m.missing.map(escapeHtml).join(", ")}</div>`''',
     1, 'what a mailer lacks reads as a sentence: "Needs at least 2 speakers" (UX-128)'),
    (r'''<div class="sec-h">Recently updated</div>''',
     r'''<div class="sec-h">Saved</div>''',
     1, 'every Promotions tab lists its saved work under "Saved" (UX-132)'),
    (r'''btn.innerHTML='Download all (.zip)';''',
     r'''btn.innerHTML='Download all mailers (ZIP)';''',
     1, 'Download all says what it downloads, in the words the other tabs use (UX-132)'),
    (r'''  if(commit&&txt!==null&&txt!==String(before??"")){ mlSetProp(ed,txt); MD.dirty=true; mlProps(); mlRender(0); }''',
     r'''  if(commit&&txt!==null&&txt!==String(before??"")){ owMailEdit({kind:"words",path:ed,value:txt}); }''',
     1, 'words typed in the mail are written through the one door for changes (owMailEdit), which ETB2B AI uses too: one '
        'Undo step each, in the studio\'s own history'),
    (r'''`<div class="hint" style="padding:8px">This event has no ${spk?"speakers":ses?"sessions":"partners"} in the API.</div>`''',
     r'''`<div class="hint" style="padding:8px">${owRosterNone(spk?"speakers":ses?"sessions":"partners")}</div>`''',
     1, 'an empty list says where its people are added, with a link there, never "in the API" (UX-128)'),
    (r'''<input class="mpq" placeholder="Filter ${shown.length} of ${list.length}…"''',
     r'''<input class="mpq" data-b="${escapeHtml(block.id)}" aria-label="Filter the list" placeholder="Filter ${shown.length} of ${list.length}…"''',
     1, 'a list\'s filter knows its section, so typing in it keeps the keyboard in that one when the panel shows two'),
    (r'''const n=document.querySelector(".mpq");''',
     r'''const n=[...document.querySelectorAll(".mpq")].find(x=>x.dataset.b===block.id)||document.querySelector(".mpq");''',
     1, '… and the panel drawn again puts the keyboard back in that same filter'),
    (r'''hot.title="Click the text to edit it · drag to move this section";''',
     r'''hot.title="Click words to type over them, click a picture to swap it, drag to move this section";''',
     1, 'the mail says what a click does: words are typed over, a picture is swapped'),
    (r'''<button class="ins" title="Insert a block here" onclick=''',
     r'''<button class="ins" title="Add a section here" aria-label="Add a section here" onclick=''',
     1, 'the "+" between sections adds a section, in the words of "+ Add a section"'),
    (r'''if(!r.ok){ toast("Could not add that block"); return; }''',
     r'''if(!r.ok){ toast("That section could not be added. Please try again.",undefined,"error"); return; }''',
     1, 'a section that could not be added is said as a failure, in the editor\'s words'),
    (r'''${full?`<div class="hint">Limit of ${max} reached — untick one to swap, or raise Max above.</div>`''',
     r'''${full?`<div class="hint">${escapeHtml(owLimitNote(max))}</div>`''',
     1, 'a full list says how to swap someone in, without "raise Max above" (a field the overview does not show)'),
    (r'''toast(`Limit of ${max} reached — raise Max above to add more`);''',
     r'''toast(owLimitNote(max),undefined,"info");''',
     1, '… and so does Select all on a full list'),
    (r'''const pill=$("mlState"); pill.style.display="";''',
     r'''const pill=$("mlState"); pill.style.display=(MD.dirty||MD.saved)?"":"none";''',
     1, 'a draft not changed and not saved shows no state beside "New draft", which already says it (it read "New draft" '
        'and "Not saved yet" side by side)'),
    (r'''pill.textContent=MD.dirty?"unsaved":(MD.saved?"saved":"generated");''',
     r'''pill.textContent=MD.dirty?"Unsaved changes":(MD.saved?"Saved":"Not saved yet");''',
     1, 'the bar says where the mail stands in words: "Unsaved changes", "Saved", "Not saved yet" (not "generated")'),
]

# The page's markup, copied from the platform with these changes, applied in order and counted as PATCHES are
# (batch B18, DESIGN.md sections 2 and 5): the bar's back button reads "← Back to mailers" (UX-131), the editor's
# title is for screen readers only, the button that downloads reads "Download", and the always-open rail of 30 blocks
# is gone: "+ Add a section" in the panel and the "+" between sections open the grouped list (oneworld-mail-easy.js).
MARKUP_PATCHES = [
    ('''<button class="back" onclick="closeMailer()" title="Back">←</button>''',
     '''<button class="back" type="button" onclick="closeMailer()">← Back to mailers</button>''',
     1, 'the back button has words, as every Promotions editor\'s does (UX-131)'),
    ('''<div class="ttl">Mailer studio</div>''',
     '''<h1 class="ttl ow-sr">Mailer editor</h1>''',
     1, 'the bar names the mailer itself (its menu); the editor\'s name is kept for screen readers'),
    ('''<select id="mlPick" onchange="switchMailer()"></select>''',
     '''<select id="mlPick" onchange="switchMailer()" aria-label="Mailer"></select>''',
     1, 'the mailer menu has a name for screen readers'),
    ('''<button class="btn sm" onclick="mlDownload()" title="Download the sendable .html — the file you send from your email tool">Download to send</button>''',
     '''<button class="btn sm" onclick="mlDownload()" title="Download the mail as an .html file: the file you send from your email tool">Download</button>''',
     1, 'Save, Save as new, Download: the bar\'s words (DESIGN.md section 2)'),
    ('''<button class="btn ghost sm" onclick="toggleMenu('mlMore',event)" title="More">···</button>''',
     '''<button class="btn ghost sm" onclick="toggleMenu('mlMore',event)" title="More" aria-label="More actions">···</button>''',
     1, 'the ··· menu has a name for screen readers'),
    ('''<b>Save as image (desktop)</b><i>A picture to show your team — not for sending</i>''',
     '''<b>Save as picture · desktop, 800 px wide</b><i>To show your team, not for sending</i>''',
     1, 'sizes are named with their pixels and where they are used, as Site-look posts names them (UX-132)'),
    ('''<b>Save as image (mobile)</b><i>How it looks on a phone</i>''',
     '''<b>Save as picture · phone, 390 px wide</b><i>How it looks on a phone</i>''',
     1, '… the phone size too'),
    ('''      <div class="ml-rail">
        <div class="ml-railtop">
          <input id="mlPalQ" class="palq" type="search" placeholder="Search blocks…" oninput="mlRailPalette()" autocomplete="off">
        </div>
        <div class="ml-scroll">
          <div class="ph">Add block <span class="faint" style="font-weight:400;text-transform:none;letter-spacing:0">drag onto the canvas</span></div>
          <div class="ml-pal rail" id="mlRailPal"></div>
        </div>
      </div>''',
     '''      <!-- ONEWORLD PORT (B18): the rail is gone; "+ Add a section" opens the sections in plain groups -->''',
     1, 'the always-open rail of 30 blocks gives way to "+ Add a section" (DESIGN.md section 2)'),
    ('''<div class="ml-pop" id="mlPop">
      <div class="hd">Add a block<button onclick="mlPopClose()">✕</button></div>''',
     '''<div class="ml-pop" id="mlPop" role="dialog" aria-label="Add a section">
      <div class="hd">Add a section<button type="button" onclick="mlPopClose()" aria-label="Close">✕</button></div>''',
     1, 'the list of sections to add is named "Add a section", and its close button too'),
]
for n, (old, new, want, why) in enumerate(MARKUP_PATCHES, 1):
    got = MARKUP.count(old)
    if got != want:
        sys.exit('markup patch M%d (%s): its text is found %d time(s) in the copied markup, not %d — the platform changed; read it again and fix MARKUP_PATCHES'
                 % (n, why, got, want))
    MARKUP = MARKUP.replace(old, new)
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
<link rel="stylesheet" href="promo-studio/oneworld-mail-easy.css">
<link rel="stylesheet" href="promo-studio/oneworld-ai-mode.css">
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
<script src="promo-studio/oneworld-mail-easy.js"></script>
<script src="promo-studio/oneworld-ai-mode.js"></script>
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
