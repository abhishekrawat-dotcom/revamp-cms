/* COPIED from the promotional platform (the owner's Social Post Generator, app/public/index.html) by
   tools/extract-promo-social.py, unchanged except SOCIAL_PATCHES (listed in tools/extract-promo-social.py) — do
   not edit here: Oneworld's changes are in promo-studio/oneworld-social.js, oneworld-social-art.js and
   oneworld-social-caption.js, which load after this file. */
/* ===== from the platform's index.html: $ ===== */
const $=(id)=>document.getElementById(id);

/* ===== from the platform's index.html: ordinal (the header card's "9th edition") ===== */
const ordinal=(n)=>{n=Number(n)||0;const t=n%100;return n+(t>=11&&t<=13?"th":["th","st","nd","rd"][n%10]||"th");};

/* ===== from the platform's index.html: skeletons ===== */
const skGrid=(cls,n,h)=>`<div class="${cls}">${`<div class="card sk-card"><div class="sk" style="height:${h}px"></div></div>`.repeat(n)}</div>`;
function skEvents(){
  return `<div class="page-h"><div><div class="sk" style="width:220px;height:22px"></div>
      <div class="sk" style="width:150px;height:13px;margin-top:9px"></div></div></div>
    ${skGrid("egrid",8,96)}`;
}
function skEventPage(){
  return `<div class="ev-head"><div class="sk" style="width:64px;height:64px;border-radius:12px"></div>
      <div style="flex:1"><div class="sk" style="width:320px;height:24px"></div>
        <div class="sk" style="width:420px;height:13px;margin-top:12px"></div></div></div>
    ${skGrid("mgrid",6,150)}`;
}

/* ===== from the platform's index.html: the event page's social half: the event, its header card, the template cards and thumbnails, the uploads ===== */
async function openEvent(entityId,awardId){
  // `entityId` is the MICROSITE the content lives on; `awardId` identifies the
  // award itself. Both are needed because the two id spaces overlap — the
  // microsite id alone resolves to a different, real event. Opening an ordinary
  // event must CLEAR the award, or the previous one would follow it around.
  S.event=entityId; S.award=awardId||null;
  mark("event");
  crumbs([{t:"Portals",go:"showPortals()"},{t:S.portalName,go:"renderEvents()"},{t:awardId?"Award":"Event"}]); setProdNav("events");
  $("content").innerHTML=skEventPage();
  for(const k in previewCache)delete previewCache[k]; for(const k in thumbCache)delete thumbCache[k];
  // A stale or mistyped deep link (a deleted/nonexistent event) used to blank the
  // page and throw `Cannot read properties of undefined (reading 'name')` in
  // renderEventDetail. Catalog is what carries the event, so if it cannot be
  // loaded — a failed request, or a payload with no `event` — show a readable
  // "could not be found" state with a way back to the portal, not a crash.
  try{
    const r=await api(`/api/catalog?portal=${S.portal}&event=${entityId}`);
    CAT=r.ok?await r.json():null;
  }catch{ CAT=null; }
  if(!CAT||!CAT.event){ MAILERS=null; renderEventMissing(entityId); return; }
  const [assets,mailers]=await Promise.all([
    api(`/api/assets?portal=${S.portal}&event=${entityId}`).then(r=>r.json()).catch(()=>({})),
    api(`/api/mailers?portal=${S.portal}&event=${entityId}`).then(r=>r.json()).catch(()=>null),
  ]);
  MAILERS=mailers;
  // On an award, lead with the award-specific templates (mailer.award-*) so a user
  // opening an award isn't scrolling past Announcement/Conference to reach
  // Nominations/Winners. Stable: everything else keeps its original order. This
  // reorders the one source array, so the cards, the picker and relayout all agree.
  if(MAILERS&&Array.isArray(MAILERS.mailers)&&S.award){
    const aw=(m)=>/^mailer\.award/.test(m.id)?0:1;
    MAILERS.mailers=MAILERS.mailers.map((m,i)=>[m,i]).sort((a,b)=>aw(a[0])-aw(b[0])||a[1]-b[1]).map(x=>x[0]);
  }
  // Off an award, lead with the mailers that fit how far away the event currently
  // is — "GOOD TIMING" cards float to the front instead of sitting wherever the
  // catalog happened to list them. Stable, same idiom as the award reorder above.
  else if(MAILERS&&Array.isArray(MAILERS.mailers)){
    MAILERS.mailers=MAILERS.mailers.map((m,i)=>[m,i])
      .sort((a,b)=>(b[0].suggested-a[0].suggested)||a[1]-b[1]).map(x=>x[0]);
  }
  renderEventDetail(assets);
}
/* The event behind a deep link could not be loaded. Mirror the empty-portal
   state — a plain message and a route back to the portal's events — instead of
   the blank page + thrown error a bad `/mail/<portal>/<id>` used to produce. */
function renderEventMissing(entityId){
  crumbs([{t:"Portals",go:"showPortals()"},{t:S.portalName,go:"openPortal(S.portal,S.portalName)"},{t:"Not found"}]); setProdNav("events");
  $("content").innerHTML=`<div class="empty">
      <div class="big">That event could not be found</div>
      Event <b>${escapeHtml(String(entityId))}</b> isn’t available on ${escapeHtml(S.portalName||S.portal||"this portal")} — it may have been removed, or the link is out of date.
      <div style="margin-top:14px"><button class="btn" onclick="openPortal(S.portal,S.portalName)">← Back to ${escapeHtml(S.portalName||"events")}</button></div>
    </div>`;
}
function renderEventDetail(assets){
  const ev=CAT.event;
  crumbs([{t:"Portals",go:"showPortals()"},{t:S.portalName,go:"renderEvents()"},{t:ev.name}]); setProdNav("events");
  const tpls=CAT.catalog.categories.flatMap(c=>c.templates.map(t=>({...t,catLabel:c.label})));
  const availCount=tpls.filter(t=>t.available).length;
  const mailCount=((MAILERS&&MAILERS.mailers)||[]).filter(m=>m.available).length;
  const site=ev.micrositeUrl||(MAILERS&&MAILERS.event&&MAILERS.event.micrositeUrl);
  $("content").innerHTML=`
    <div class="ev-head">
      <div class="logo grad"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><h2>${escapeHtml(ev.name)}</h2>
          <span class="hchip">${escapeHtml(ev.hashtag)}</span>${ev.edition?`<span class="chip">${ordinal(ev.edition)} edition</span>`:""}
          ${site?`<a class="chip" href="${escapeHtml(site)}" target="_blank" style="text-decoration:none">Website ↗</a>`:""}</div>
        <div class="row">
          <div class="stat">${escapeHtml(ev.dateLabel||"—")} <span>date</span></div>
          <div class="stat">${escapeHtml(ev.venue||"—")} <span>venue</span></div>
          <div class="stat">${ev.counts.speakers} <span>speakers</span></div>
          <div class="stat">${ev.counts.sponsorTiers} <span>sponsor tiers</span></div>
          <div class="stat">${ev.counts.sessions} <span>sessions</span></div>
        </div>
      </div>
    </div>

    <div id="evNav" class="secnav">
      <button id="nav-social" class="on" onclick="setEvSection('social')">Social posts <span class="n">${availCount}</span></button>
      <button id="nav-mail" onclick="setEvSection('mail')">Promotional mailers <span class="n">${mailCount}</span></button>
      <span class="sp" id="secActions"></span>
    </div>

    <div id="secSocial">
      <div class="psd">
        <div class="ic">◧</div>
        <div style="flex:1">
          <div class="t">Background &amp; logo <span class="faint" style="font-weight:400">· event details always come from the API</span></div>
          <div class="h" id="psdStatus">PSD background ${assets.background?'✓':'—'} · logo ${assets.logoUnit?'✓':'—'}</div>
          <div class="assets-slots">
            <label class="slot ${assets.background?'on':''}"><input type="file" accept=".psd" style="display:none" onchange="uploadPsd(this)">PSD</label>
            <label class="slot ${assets.bg1?'on':''}" id="slot-bg1"><input type="file" accept="image/*" style="display:none" onchange="uploadBg(this,'1')">BG 1</label>
            <label class="slot ${assets.bg2?'on':''}" id="slot-bg2"><input type="file" accept="image/*" style="display:none" onchange="uploadBg(this,'2')">BG 2</label>
            <label class="slot ${assets.bg3?'on':''}" id="slot-bg3"><input type="file" accept="image/*" style="display:none" onchange="uploadBg(this,'3')">BG 3</label>
            <label class="slot ${assets.logoUnit?'on':''}" id="slot-logo"><input type="file" accept="image/*" style="display:none" onchange="uploadLogo(this)">Logo</label>
          </div>
        </div>
      </div>
      <div class="tgrid" id="tgrid">${tpls.map(cardHtml).join("")}</div>
    </div>

    <div id="secMail" style="display:none">
      <div id="evSaved">${renderEvSaved()}</div>
      <div class="mgrid" id="mgrid">${mailerCards()}</div>
    </div>`;
  // The chosen product decides which half of the event page you get; without one
  // (a direct call, as the audit suites make) the previous behaviour stands.
  setEvSection(S.product==="mail"?"mail":S.product==="social"?"social":(S.section||"social"));
  loadThumbs(tpls);
}
/** Event page has two workspaces: social creatives and HTML mailers. */
function setEvSection(which){
  S.section=which;
  const social=which==="social";
  // With a product chosen, the event page shows that product only — the switcher
  // is the thing the split replaces. (It stays for a direct call with no product
  // selected, which is how the audit suites drive the page.)
  const nav=$("evNav"); if(nav) nav.style.display=S.product?"none":"";
  $("secSocial").style.display=social?"":"none";
  $("secMail").style.display=social?"none":"";
  $("nav-social").classList.toggle("on",social);
  $("nav-mail").classList.toggle("on",!social);
  $("secActions").innerHTML=social
    ? `<button class="btn alt sm" onclick="openEditor()">Layout editor</button>
       <button class="btn sm" onclick="generateAll()">Generate all</button>`
    : `<button class="btn alt sm" onclick="openMailer()">Open studio</button>
       <button class="btn sm" onclick="downloadAllMailers()">Download all (.zip)</button>`;
}
function cardHtml(t){
  return `<div class="tcard ${t.available?'':'dis'}" id="tc-${t.id.replace(/\W/g,'_')}">
    <div class="thumb" id="th-${t.id.replace(/\W/g,'_')}">${t.isNew?'<span class="newbadge">NEW</span>':''}${t.available?'<span class="spin"></span>':'<span class="faint" style="font-size:12px">preview N/A</span>'}</div>
    <div class="b"><div class="cat">${t.catLabel}</div><div class="nm">${t.label}</div>
      <div class="ds">${t.description}</div>
      <div class="cta">${t.available?`<button class="btn sm" style="width:100%;justify-content:center" onclick='openEditor(${JSON.stringify(t.id)})'>Generate &amp; edit →</button>`:`<div class="warn">needs ${t.missing.join(", ")}</div>`}</div>
    </div></div>`;
}
async function loadThumbs(tpls){
  for(const t of tpls.filter(x=>x.available)){
    const cell=$("th-"+t.id.replace(/\W/g,'_')); if(!cell) continue;
    const badge=t.isNew?'<span class="newbadge">NEW</span>':'';
    const fmt=(t.formats&&t.formats[0]&&t.formats[0].id)||"ig_square";
    try{
      const r=await api("/api/preview",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({portal:S.portal,event:S.event,templateId:t.id,format:fmt,params:{},thumb:true})});
      if(r.ok){ const url=URL.createObjectURL(await r.blob()); thumbCache[t.id]=url; cell.innerHTML=badge+`<img src="${url}">`; }
      else cell.innerHTML=badge+'<span class="faint" style="font-size:12px">—</span>';
    }catch{ cell.innerHTML=badge+'<span class="faint" style="font-size:12px">—</span>'; }
  }
}
function refreshThumbs(){ for(const k in previewCache)delete previewCache[k]; for(const k in thumbCache)delete thumbCache[k];
  const tpls=CAT.catalog.categories.flatMap(c=>c.templates.map(t=>({...t})));
  tpls.filter(t=>t.available).forEach(t=>{const c=$("th-"+t.id.replace(/\W/g,'_'));if(c)c.innerHTML='<span class="spin"></span>';}); loadThumbs(tpls); }
async function uploadPsd(inp){
  const f=inp.files[0]; inp.value=""; if(!f) return;
  $("psdStatus").innerHTML='<span class="spin"></span> extracting background &amp; logo…';
  const r=await api(`/api/psd?portal=${S.portal}&event=${S.event}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:f});
  let j; try{ j=await r.json(); }catch{ j={error:r.status===413?"file too large (max 120 MB) — flatten the PSD":"upload failed"}; }
  $("psdStatus").innerHTML=j.ok?`PSD background ${j.background?'✅':'—'} · logo ${j.logoUnit?'✅':'—'} (${j.canvasWidth}×${j.canvasHeight}) — refreshing…`:`Upload failed: ${escapeHtml(j.error||'')}`;
  if(j.ok){ inp.closest(".slot")?.classList.toggle("on",!!j.background); if(j.logoUnit)$("slot-logo")?.classList.add("on"); refreshThumbs(); }
}
async function uploadBg(inp,slot){
  const f=inp.files[0]; inp.value=""; if(!f) return;
  $("psdStatus").innerHTML=`<span class="spin"></span> uploading background ${slot}…`;
  const r=await api(`/api/background?portal=${S.portal}&event=${S.event}&slot=${slot}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:f});
  let j; try{ j=await r.json(); }catch{ j={error:"upload failed"}; }
  $("psdStatus").innerHTML=j.ok?`Background ${slot} uploaded (${j.width}×${j.height}) — pick it in the editor's Background selector.`:`Upload failed: ${escapeHtml(j.error||'')}`;
  if(j.ok){ $("slot-bg"+slot)?.classList.add("on"); refreshThumbs(); }
}
async function uploadLogo(inp){
  const f=inp.files[0]; inp.value=""; if(!f) return;
  $("psdStatus").innerHTML='<span class="spin"></span> uploading logo…';
  const r=await api(`/api/logo?portal=${S.portal}&event=${S.event}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:f});
  let j; try{ j=await r.json(); }catch{ j={error:"upload failed"}; }
  $("psdStatus").innerHTML=j.ok?`Logo uploaded (${j.width}×${j.height}) — refreshing…`:`Upload failed: ${escapeHtml(j.error||'')}`;
  if(j.ok){ $("slot-logo")?.classList.add("on"); refreshThumbs(); }
}

/* ===== from the platform's index.html: findTpl ===== */
function findTpl(id){ for(const c of CAT.catalog.categories) for(const t of c.templates) if(t.id===id) return t; }

/* ===== from the platform's index.html: the template options ===== */
function buildParams(t,host){
  const p=host||$("dParams"); p.innerHTML="";
  for(const par of t.params){
    const wrap=document.createElement("div"); wrap.className="param";
    wrap.innerHTML=`<label class="h">${escapeHtml(par.label)}</label>`;
    if(par.type==="stats"){
      const box=document.createElement("div"); box.className="stats-ed"; box.dataset.key="stats";
      const add=(v="",l="")=>{const row=document.createElement("div");row.className="statrow";
        row.innerHTML=`<input class="sv" placeholder="40+" value="${(v+'').replace(/"/g,'&quot;')}"><input class="sl" placeholder="Speakers" value="${(l+'').replace(/"/g,'&quot;')}"><button type="button" class="statx">✕</button>`;
        row.querySelector(".statx").onclick=()=>row.remove(); box.appendChild(row);};
      (Array.isArray(par.default)?par.default:[]).forEach(s=>add(s.value,s.label));
      const b=document.createElement("button");b.type="button";b.className="btn ghost sm";b.textContent="+ add stat";b.onclick=()=>add();
      wrap.appendChild(box); wrap.appendChild(b);
    } else if(par.type==="multiselect"){
      const filt=document.createElement("input");filt.placeholder="filter…";filt.style.marginBottom="6px";
      const ms=document.createElement("div");ms.className="ms";ms.dataset.key=par.key;
      (par.options||[]).forEach(o=>{const l=document.createElement("label");l.innerHTML=`<input type="checkbox" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}`;ms.appendChild(l);});
      filt.oninput=()=>ms.querySelectorAll("label").forEach(l=>l.style.display=l.textContent.toLowerCase().includes(filt.value.toLowerCase())?"":"none");
      wrap.appendChild(filt);wrap.appendChild(ms);
    } else if(par.type==="select"){
      const s=document.createElement("select");s.dataset.key=par.key;
      s.innerHTML=`<option value="">Auto</option>`+(par.options||[]).map(o=>`<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
      if(par.default!==undefined&&!Array.isArray(par.default))s.value=par.default;
      wrap.appendChild(s);
    } else if(par.type==="textarea"){
      const ta=document.createElement("textarea");ta.dataset.key=par.key;ta.rows=4;
      if(par.default!==undefined&&!Array.isArray(par.default))ta.value=par.default;
      wrap.appendChild(ta);
    } else {
      const inp=document.createElement("input");inp.dataset.key=par.key;inp.type=par.type==="number"?"number":"text";
      if(par.type==="image")inp.placeholder="https://… image URL (blank = uploaded asset)";
      if(par.default!==undefined&&!Array.isArray(par.default))inp.value=par.default;
      wrap.appendChild(inp);
    }
    if(par.hint){const h=document.createElement("div");h.className="hint";h.textContent=par.hint;wrap.appendChild(h);}
    p.appendChild(wrap);
  }
}
function collectParams(host){
  const out={};
  (host||$("dParams")).querySelectorAll("[data-key]").forEach(el=>{
    const k=el.dataset.key;
    if(el.classList.contains("ms")){const v=[...el.querySelectorAll("input:checked")].map(i=>i.value);if(v.length)out[k]=v;}
    else if(el.classList.contains("stats-ed")){const rows=[...el.querySelectorAll(".statrow")].map(r=>({value:r.querySelector(".sv").value,label:r.querySelector(".sl").value})).filter(s=>s.value||s.label);if(rows.length)out[k]=rows;}
    else if(el.value!==""&&el.value!=null)out[k]=el.value;
  });
  return out;
}

/* ===== from the platform's index.html: the layout editor: its state, escaping, toast and the in-app dialogs, colours, open and close ===== */
/* ================= Full-page layout editor ================= */
const EDIT={ tid:null, fmt:null, kind:"code", width:0, height:0, base:"", els:[], scale:1 };
let edSel=-1, edSelSet=[], edHist=[], edRedo=[], edMode="props", edClip=[], edPasteN=0, edPanMode=false; const edNodes=[]; const edAssetsCache={};
let edParams={ theme:"dark" };
const EDFONTS=["Inter","Poppins","Montserrat","Mulish","Barlow Condensed","Oswald","Anton","Bebas Neue","Playfair Display","Arial","Georgia","Times New Roman","Courier New"];
const PLACEHOLDER_IMG="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><rect width="100%" height="100%" fill="#d7dbe8"/><text x="50%" y="50%" font-family="Inter,Arial" font-size="18" fill="#8a90a6" text-anchor="middle" dy=".35em">paste image URL</text></svg>');
const escapeHtml=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
let _tt; function toast(m,ms){const t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove("on"),ms||2200);}

/* In-app dialogs replacing prompt()/confirm(). One modal, promise-based, so the
   call sites read almost as they did (await uiConfirm / uiPrompt) but the sender
   sees the app's own chrome. Only one can be open at a time. */
let _uiResolve=null;
function uiClose(val){
  const m=$("uiModal"); if(!m)return;
  m.classList.remove("on"); m.setAttribute("aria-hidden","true");
  const r=_uiResolve; _uiResolve=null; if(r)r(val);
}
function uiOpen({title,message,input,value,placeholder,ok,cancel,danger}){
  return new Promise((resolve)=>{
    // Never leave a prior dialog hanging: resolve it as cancelled first.
    if(_uiResolve){ const prev=_uiResolve; _uiResolve=null; prev(input?null:false); }
    _uiResolve=resolve;
    $("uiModalTitle").textContent=title||"";
    $("uiModalBody").innerHTML=message||"";
    $("uiModalBody").style.display=message?"":"none";
    const inp=$("uiModalInput");
    inp.style.display=input?"":"none";
    if(input){ inp.value=value||""; inp.placeholder=placeholder||""; }
    const okBtn=$("uiModalOk"), cancelBtn=$("uiModalCancel");
    okBtn.textContent=ok||"OK"; cancelBtn.textContent=cancel||"Cancel";
    okBtn.className="btn sm"+(danger?" danger":"");
    okBtn.onclick=()=>uiClose(input?inp.value:true);
    cancelBtn.onclick=()=>uiClose(input?null:false);
    $("uiModal").onmousedown=(e)=>{ if(e.target===$("uiModal")) uiClose(input?null:false); };
    inp.onkeydown=(e)=>{ if(e.key==="Enter"){ e.preventDefault(); uiClose(inp.value); } if(e.key==="Escape"){ e.preventDefault(); uiClose(null); } };
    $("uiModal").classList.add("on"); $("uiModal").setAttribute("aria-hidden","false");
    setTimeout(()=>{ if(input){ inp.focus(); inp.select(); } else okBtn.focus(); },30);
  });
}
// Global Escape for the button-focused (confirm) case; the input has its own.
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&_uiResolve&&$("uiModal").classList.contains("on")){ const isInput=$("uiModalInput").style.display!=="none"; if(!isInput){ e.preventDefault(); uiClose(false); } } });
const uiConfirm=(title,message,o={})=>uiOpen({title,message,ok:o.ok||"Confirm",cancel:o.cancel||"Cancel",danger:o.danger});
const uiPrompt=(title,o={})=>uiOpen({title,message:o.message,input:true,value:o.value,placeholder:o.placeholder,ok:o.ok||"Save",cancel:o.cancel||"Cancel"});

/* ---- colour helpers ---- */
function parseColor(s){ s=String(s||"").trim();
  let m=s.match(/rgba?\(([^)]+)\)/i);
  if(m){const p=m[1].split(",").map(x=>x.trim());return{r:+p[0]||0,g:+p[1]||0,b:+p[2]||0,a:p[3]!=null?+p[3]:1};}
  m=s.match(/^#?([0-9a-f]{6})$/i); if(m){const n=parseInt(m[1],16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255,a:1};}
  m=s.match(/^#?([0-9a-f]{3})$/i); if(m){const h=m[1];return{r:parseInt(h[0]+h[0],16),g:parseInt(h[1]+h[1],16),b:parseInt(h[2]+h[2],16),a:1};}
  return{r:255,g:255,b:255,a:1};
}
const _2=(n)=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0");
const toHexRGB=(o)=>"#"+_2(o.r)+_2(o.g)+_2(o.b);
const toHex=(s)=>toHexRGB(parseColor(s));
const rgbaStr=(hex,a)=>{const o=parseColor(hex);return`rgba(${o.r}, ${o.g}, ${o.b}, ${+(+a).toFixed(3)})`;};
const matchFont=(f)=>{const first=String(f||"").split(",")[0].replace(/["']/g,"").trim();return EDFONTS.find(x=>x.toLowerCase()===first.toLowerCase())||"Inter";};
const isTransp=(bg)=>!bg||/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)||bg==="transparent";

/* ---- open / load ---- */
function openEditor(preId){
  if(!CAT){toast("Open an event first");return;}
  const avail=CAT.catalog.categories.flatMap(c=>c.templates.filter(t=>t.available));
  if(!avail.length){toast("No available templates");return;}
  $("edTpl").innerHTML=avail.map(t=>`<option value="${t.id}">${t.label}${t.isNew?" • NEW":""}</option>`).join("");
  $("edTpl").value=(preId&&avail.some(t=>t.id===preId))?preId:avail[0].id;
  edMode="props"; wireTheme(); wireBg();
  $("editor").classList.add("on"); document.body.style.overflow="hidden";
  switchEditorTpl();
}
function closeEditor(){ $("editor").classList.remove("on"); document.body.style.overflow=""; closeMenus(); }

/* ===== from the platform's index.html: the layout editor: stage, elements, panels, insert, save, reset, download and its keys ===== */
function wireTheme(){ const box=$("edTheme"); box.querySelectorAll("button").forEach(b=>{ b.classList.toggle("on",b.dataset.v===edParams.theme);
  b.onclick=()=>{ if(b.dataset.v===edParams.theme)return; edParams.theme=b.dataset.v; box.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); loadEditor(); }; }); }
// Populate the background-source selector from which assets exist for this event.
async function wireBg(){
  let st={}; try{ st=await (await api(`/api/assets?portal=${S.portal}&event=${S.event}`)).json(); }catch{}
  const opts=[`<option value="">Background: PSD / template</option>`];
  if(st.bg1)opts.push(`<option value="1">Background: Upload 1</option>`);
  if(st.bg2)opts.push(`<option value="2">Background: Upload 2</option>`);
  if(st.bg3)opts.push(`<option value="3">Background: Upload 3</option>`);
  const sel=$("edBg"); sel.innerHTML=opts.join(""); sel.value=edParams.bg||"";
}
function edSetBg(){ edParams.bg=$("edBg").value||undefined; loadEditor(); }
function switchEditorTpl(){
  const t=findTpl($("edTpl").value); if(!t)return;
  const fmt=$("edFmt");
  fmt.innerHTML=t.formats.map(f=>`<option value="${f.id}">${f.ratio}</option>`).join("");
  fmt.style.display=t.kind==="psd"?"none":"";
  edParams={ theme:edParams.theme, bg:edParams.bg }; // per-template options reset; keep theme + background
  loadEditor();
}
function normEl(e){ const o={...e,x:+e.x||0,y:+e.y||0,w:+e.w||10,rotate:+e.rotate||0}; if(e.h!=null)o.h=+e.h; if(e.fontSize!=null)o.fontSize=+e.fontSize; return o; }
async function loadEditor(fresh){
  const tid=$("edTpl").value, fmt=$("edFmt").value; const t=findTpl(tid); if(!t)return;
  EDIT.tid=tid; EDIT.fmt=fmt; EDIT.kind=t.kind; edSel=-1; edSelSet=[]; edHist=[]; edRedo=[]; edMode="props"; edZoom="fit"; updUndo();
  $("edSide").innerHTML=`<div class="ed-empty"><span class="spin"></span></div>`;
  $("edStage").querySelectorAll(".ednode").forEach(n=>n.remove()); $("edBase").src="";
  const r=await api("/api/editor/load",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,templateId:tid,format:fmt,params:{...edParams},fresh:!!fresh})});
  if(!r.ok){ $("edSide").innerHTML=`<div class="ed-empty">Couldn't load this template.</div>`; return; }
  const j=await r.json();
  EDIT.width=j.width; EDIT.height=j.height; EDIT.base=j.base; EDIT.els=(j.elements||[]).map(normEl);
  mountStage();
  if(j.saved) toast("↺ Loaded your saved layout for this event");
}
let edZoom="fit"; // "fit" or a numeric scale (e.g. 1 = 100%)
function fitScale(){ const area=$("edCanvas"); return Math.min((area.clientWidth-52)/EDIT.width,(area.clientHeight-52)/EDIT.height,1); }
function mountStage(){ $("edBase").src=EDIT.base; buildNodes(); layoutStage(); selectEl(-1); }
function layoutStage(){
  const area=$("edCanvas"); if(!EDIT.width)return;
  let s = edZoom==="fit" ? fitScale() : edZoom;
  if(!isFinite(s)||s<=0)s=.3; EDIT.scale=s;
  const st=$("edStage");
  st.style.width=EDIT.width+"px"; st.style.height=EDIT.height+"px";
  st.style.transform=`scale(${s})`; st.style.setProperty("--s",s);
  $("edStageWrap").style.width=(EDIT.width*s)+"px"; $("edStageWrap").style.height=(EDIT.height*s)+"px";
  const pct=$("edZoomPct"); if(pct)pct.textContent = edZoom==="fit" ? "Fit" : Math.round(s*100)+"%";
  layoutGroupFrame();
}
function edZoomFit(){ edZoom="fit"; layoutStage(); }
function edZoomStep(dir){
  const cur = edZoom==="fit" ? fitScale() : edZoom;
  let next = Math.round((cur + dir*0.1)*10)/10;
  next = Math.max(0.1, Math.min(3, next));
  edZoom = next; layoutStage();
}

/* ---- nodes ---- */
function buildNodes(){ const st=$("edStage"); st.querySelectorAll(".ednode").forEach(n=>n.remove()); edNodes.length=0;
  EDIT.els.forEach((el,i)=>{ const n=makeNode(el,i); edNodes[i]=n; st.appendChild(n); }); }
function makeNode(el,i){
  const n=document.createElement("div");
  n.className="ednode "+(el.type==="image"?"im":el.type==="shape"?"sh":el.type==="frame"?"fr":"tx"); n.dataset.i=i;
  if(el.type==="image"){ n.appendChild(document.createElement("img")); }
  else if(el.type==="frame"){ const clip=document.createElement("div"); clip.className="frclip"; clip.appendChild(document.createElement("img")); const sc=document.createElement("div"); sc.className="edscrim2"; clip.appendChild(sc); n.appendChild(clip); }
  else if(el.type==="text"){ const t=document.createElement("div"); t.className="edtxt"; t.style.width="100%"; n.appendChild(t); }
  const rot=document.createElement("div"); rot.className="edrot"; n.appendChild(rot);
  const h=document.createElement("div"); h.className="edhandle br"; n.appendChild(h);
  applyNode(n,el);
  n.addEventListener("pointerdown",(e)=>{ if(e.target.classList.contains("edhandle")||e.target.classList.contains("edrot"))return; e.preventDefault();
    const add=e.shiftKey||e.metaKey||e.ctrlKey;
    if(add){ selectEl(i,true); return; }
    if(!edSelSet.includes(i)) selectEl(i);
    if(EDIT.els[i].type==="frame" && edPanMode){ startPanImage(e,i); return; }
    startDrag(e,i); });
  h.addEventListener("pointerdown",(e)=>{ e.preventDefault(); e.stopPropagation(); startResize(e,el,n,i); });
  rot.addEventListener("pointerdown",(e)=>{ e.preventDefault(); e.stopPropagation(); startRotate(e,el,n,i); });
  return n;
}
function applyNode(n,el){
  n.style.left=el.x+"px"; n.style.top=el.y+"px"; n.style.width=el.w+"px";
  n.style.transform="rotate("+(el.rotate||0)+"deg)"; n.style.transformOrigin="center center";
  if(el.type==="image"){
    n.style.height=(el.h||el.w)+"px"; n.style.borderRadius=el.radius||"0"; n.style.background="transparent";
    n.style.boxShadow=(el.boxShadow&&el.boxShadow!=="none")?el.boxShadow:"none";
    const img=n.querySelector("img"); img.src=el.src||"";
    img.style.objectFit=el.objectFit||"cover"; img.style.objectPosition=el.objectPosition||"center";
    img.style.padding=el.padding||"0"; img.style.borderRadius=el.radius||"0"; img.style.boxSizing="border-box";
    img.style.background=isTransp(el.background)?"transparent":el.background;
    return;
  }
  if(el.type==="frame"){
    n.style.height=(el.h||el.w)+"px"; n.style.background="transparent";
    n.style.boxShadow=(el.boxShadow&&el.boxShadow!=="none")?el.boxShadow:"none"; n.style.borderRadius=el.radius||"0";
    const clip=n.querySelector(".frclip"); clip.style.borderRadius=el.radius||"0";
    clip.style.border=(el.border&&el.border!=="none")?el.border:"none";
    clip.style.background=isTransp(el.background)?"transparent":el.background;
    const img=clip.querySelector("img"); img.src=el.src||"";
    img.style.objectFit=el.objectFit||"cover"; img.style.objectPosition=el.objectPosition||"center";
    img.style.transform=`translate(${el.imgX||0}px,${el.imgY||0}px) scale(${el.imgScale||1}) rotate(${el.imgRotate||0}deg)`;
    clip.querySelector(".edscrim2").style.background=(el.scrim&&el.scrim!=="none")?el.scrim:"transparent";
    return;
  }
  if(el.type==="shape"){
    n.style.height=(el.h||el.w)+"px";
    n.style.background=isTransp(el.background)?"transparent":el.background;
    const bf=(el.backdropFilter&&el.backdropFilter!=="none")?el.backdropFilter:"none";
    n.style.backdropFilter=bf; n.style.webkitBackdropFilter=bf;
    n.style.border=(el.border&&el.border!=="none")?el.border:"none";
    n.style.borderRadius=el.radius||"0";
    n.style.boxShadow=(el.boxShadow&&el.boxShadow!=="none")?el.boxShadow:"none";
    return;
  }
  n.style.height="auto";
  n.style.fontFamily=el.fontFamily||"Inter"; n.style.fontSize=(el.fontSize||24)+"px";
  n.style.fontWeight=el.fontWeight||"400"; n.style.fontStyle=el.fontStyle||"normal";
  n.style.color=el.color||"#fff"; n.style.textAlign=el.textAlign||"left";
  n.style.lineHeight=el.lineHeight||"normal"; n.style.letterSpacing=el.letterSpacing||"normal";
  n.style.textTransform=el.textTransform||"none";
  n.style.textShadow=(el.textShadow&&el.textShadow!=="none")?el.textShadow:"none";
  n.style.background=isTransp(el.background)?"transparent":el.background;
  const tbf=(el.backdropFilter&&el.backdropFilter!=="none")?el.backdropFilter:"none";
  n.style.backdropFilter=tbf; n.style.webkitBackdropFilter=tbf;
  n.style.padding=el.padding||"0"; n.style.borderRadius=el.radius||"0";
  n.style.boxShadow=(el.boxShadow&&el.boxShadow!=="none")?el.boxShadow:"none";
  n.style.whiteSpace=el.whiteSpace||"pre-wrap";
  n.querySelector(".edtxt").textContent=el.text||"";
}
// additive (Shift/Ctrl/Cmd) toggles the element in the multi-selection; the last
// one is the "primary" that shows handles and drives the property panel.
function selectEl(i,additive){
  if(i<0){ edSelSet=[]; }
  else if(additive){ const p=edSelSet.indexOf(i); if(p>=0)edSelSet.splice(p,1); else edSelSet.push(i); }
  else { edSelSet=[i]; }
  edSel = edSelSet.length ? edSelSet[edSelSet.length-1] : -1;
  edPanMode=false; // reset image-reposition mode on any selection change
  const single = edSelSet.length===1;
  edNodes.forEach((n,k)=>{ if(!n)return; n.classList.toggle("sel",edSelSet.includes(k)); n.classList.toggle("primary",k===edSel&&single); });
  layoutGroupFrame();
  if(edSel>=0)edMode="props"; paintSide();
}
function groupBBox(){ let x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
  edSelSet.forEach(k=>{ const el=EDIT.els[k], n=edNodes[k]; if(!el||!n)return; const h=el.h||n.offsetHeight;
    x1=Math.min(x1,el.x); y1=Math.min(y1,el.y); x2=Math.max(x2,el.x+el.w); y2=Math.max(y2,el.y+h); });
  return { x:x1, y:y1, w:x2-x1, h:y2-y1 };
}
function layoutGroupFrame(){ const g=$("edGroup"); if(!g)return;
  if(edSelSet.length>1){ const b=groupBBox(); g.style.left=b.x+"px"; g.style.top=b.y+"px"; g.style.width=b.w+"px"; g.style.height=b.h+"px"; g.classList.add("on"); }
  else g.classList.remove("on");
}
function edDeleteSel(){ if(!edSelSet.length)return; pushHistory();
  [...edSelSet].sort((a,b)=>b-a).forEach(idx=>EDIT.els.splice(idx,1));
  edSelSet=[]; edSel=-1; buildNodes(); layoutStage(); selectEl(-1);
}

/* ---- drag / resize / rotate ---- */
function startDrag(e,i){ pushHistory();
  const s=EDIT.scale, sx=e.clientX, sy=e.clientY, T=10;
  const set = edSelSet.length ? edSelSet : [i];
  const items = set.map(k=>({el:EDIT.els[k], n:edNodes[k], ox:EDIT.els[k].x, oy:EDIT.els[k].y}));
  const pel = EDIT.els[edSel] || items[0].el, pn = edNodes[edSel] || items[0].n;
  const single = items.length===1;
  const gv=$("edGuideV"),gh=$("edGuideH");
  const mv=(ev)=>{
    let dx=(ev.clientX-sx)/s, dy=(ev.clientY-sy)/s; let sV=false,sH=false;
    if(single){ // centre-snap a single element to the canvas midlines
      const w=pel.w, h=pel.h||pn.offsetHeight;
      if(Math.abs(items[0].ox+dx+w/2-EDIT.width/2)<=T){ dx=(EDIT.width-w)/2-items[0].ox; sV=true; }
      if(Math.abs(items[0].oy+dy+h/2-EDIT.height/2)<=T){ dy=(EDIT.height-h)/2-items[0].oy; sH=true; }
    }
    items.forEach(it=>{ it.el.x=Math.round(it.ox+dx); it.el.y=Math.round(it.oy+dy); it.n.style.left=it.el.x+"px"; it.n.style.top=it.el.y+"px"; });
    gv.classList.toggle("on",sV); gh.classList.toggle("on",sH);
    if(!single) layoutGroupFrame();
    const px=$("epX"),py=$("epY"); if(px)px.value=Math.round(pel.x); if(py)py.value=Math.round(pel.y);
  };
  const up=()=>{ gv.classList.remove("on"); gh.classList.remove("on"); document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
function startResize(e,el,n,i){ selectEl(i); pushHistory();
  const sx=e.clientX,s=EDIT.scale,ow=el.w,oh=el.h||n.offsetHeight,of=el.fontSize||24;
  const mv=(ev)=>{ const nw=Math.max(16,ow+(ev.clientX-sx)/s);
    if(el.type==="image"||el.type==="shape"||el.type==="frame"){ const ar=oh/ow||1; el.w=Math.round(nw); el.h=Math.round(nw*ar); const w=$("epW"),h=$("epH"); if(w)w.value=el.w; if(h)h.value=el.h; }
    else { const ratio=nw/ow; el.w=Math.round(nw); el.fontSize=Math.max(6,Math.round(of*ratio)); const sz=$("epSize"); if(sz)sz.value=el.fontSize; }
    applyNode(n,el); };
  const up=()=>{ document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
function startRotate(e,el,n,i){ selectEl(i); pushHistory();
  const rc=n.getBoundingClientRect(), cx=rc.left+rc.width/2, cy=rc.top+rc.height/2;
  const a0=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI, r0=el.rotate||0;
  const mv=(ev)=>{ let a=Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI; let rot=r0+(a-a0);
    if(ev.shiftKey)rot=Math.round(rot/15)*15; el.rotate=Math.round(rot);
    n.style.transform="rotate("+el.rotate+"deg)"; const ri=$("epRot"),rr=$("epRotR"); if(ri)ri.value=el.rotate; if(rr)rr.value=el.rotate; };
  const up=()=>{ document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
/* ---- reposition the image INSIDE a frame (pan) ---- */
function startPanImage(e,i){ const el=EDIT.els[i], n=edNodes[i]; pushHistory();
  const s=EDIT.scale, sx=e.clientX, sy=e.clientY, ox=el.imgX||0, oy=el.imgY||0;
  const mv=(ev)=>{ el.imgX=Math.round(ox+(ev.clientX-sx)/s); el.imgY=Math.round(oy+(ev.clientY-sy)/s); applyNode(n,el);
    const px=$("epImgX"),py=$("epImgY"); if(px)px.value=el.imgX; if(py)py.value=el.imgY; };
  const up=()=>{ document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
/* ---- group (multi-select) resize & rotate around the whole selection ---- */
function startGroupResize(e){ e.preventDefault(); e.stopPropagation(); if(edSelSet.length<2)return; pushHistory();
  const s=EDIT.scale, sx=e.clientX, bb=groupBBox();
  const items=edSelSet.map(k=>{ const el=EDIT.els[k], n=edNodes[k]; return {el,n, ox:el.x,oy:el.y,ow:el.w,oh:el.h||n.offsetHeight,of:el.fontSize||0}; });
  const mv=(ev)=>{ let f=(bb.w+(ev.clientX-sx)/s)/bb.w; f=Math.max(0.1,f);
    items.forEach(it=>{ it.el.x=Math.round(bb.x+(it.ox-bb.x)*f); it.el.y=Math.round(bb.y+(it.oy-bb.y)*f);
      it.el.w=Math.max(8,Math.round(it.ow*f));
      if(it.el.type==="image"||it.el.type==="shape"||it.el.type==="frame") it.el.h=Math.max(8,Math.round(it.oh*f));
      else if(it.of) it.el.fontSize=Math.max(6,Math.round(it.of*f));
      applyNode(it.n,it.el); });
    layoutGroupFrame(); };
  const up=()=>{ document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); paintSide(); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}
function startGroupRotate(e){ e.preventDefault(); e.stopPropagation(); if(edSelSet.length<2)return; pushHistory();
  const bb=groupBBox(), cx0=bb.x+bb.w/2, cy0=bb.y+bb.h/2;
  const rc=$("edGroup").getBoundingClientRect(), scx=rc.left+rc.width/2, scy=rc.top+rc.height/2;
  const a0=Math.atan2(e.clientY-scy,e.clientX-scx)*180/Math.PI;
  const items=edSelSet.map(k=>{ const el=EDIT.els[k], n=edNodes[k], h=el.h||n.offsetHeight;
    return {el,n, ccx:el.x+el.w/2, ccy:el.y+h/2, r0:el.rotate||0}; });
  const mv=(ev)=>{ let d=Math.atan2(ev.clientY-scy,ev.clientX-scx)*180/Math.PI-a0; if(ev.shiftKey)d=Math.round(d/15)*15;
    const rad=d*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
    items.forEach(it=>{ const dx=it.ccx-cx0, dy=it.ccy-cy0, nx=cx0+dx*cos-dy*sin, ny=cy0+dx*sin+dy*cos, h=it.el.h||it.n.offsetHeight;
      it.el.x=Math.round(nx-it.el.w/2); it.el.y=Math.round(ny-h/2); it.el.rotate=Math.round(it.r0+d); applyNode(it.n,it.el); });
    layoutGroupFrame(); };
  const up=()=>{ document.removeEventListener("pointermove",mv); document.removeEventListener("pointerup",up); paintSide(); };
  document.addEventListener("pointermove",mv); document.addEventListener("pointerup",up);
}

/* ---- history ---- */
function pushHistory(){ edHist.push(JSON.stringify(EDIT.els)); if(edHist.length>80)edHist.shift(); edRedo=[]; updUndo(); }
function updUndo(){ const u=$("edUndo"); if(u)u.disabled=edHist.length===0; const r=$("edRedo"); if(r)r.disabled=edRedo.length===0; }
function edUndo(){ if(!edHist.length)return; edRedo.push(JSON.stringify(EDIT.els)); EDIT.els=JSON.parse(edHist.pop()).map(normEl); edSel=-1; edSelSet=[]; buildNodes(); layoutStage(); selectEl(-1); updUndo(); }
function edRedoFn(){ if(!edRedo.length)return; edHist.push(JSON.stringify(EDIT.els)); EDIT.els=JSON.parse(edRedo.pop()).map(normEl); edSel=-1; edSelSet=[]; buildNodes(); layoutStage(); selectEl(-1); updUndo(); }

/* ---- clipboard (copy / cut / paste / duplicate / select-all) ---- */
function edCopy(){ if(!edSelSet.length)return; edClip=edSelSet.map(k=>JSON.parse(JSON.stringify(EDIT.els[k]))); edPasteN=0; toast(`Copied ${edClip.length} element(s)`); }
function edCut(){ if(!edSelSet.length)return; edClip=edSelSet.map(k=>JSON.parse(JSON.stringify(EDIT.els[k]))); edPasteN=0; edDeleteSel(); toast(`Cut ${edClip.length} element(s)`); }
function edSelectMany(list){ edSelSet=list.slice(); edSel=edSelSet.length?edSelSet[edSelSet.length-1]:-1; const single=edSelSet.length===1;
  edNodes.forEach((n,k)=>{ if(!n)return; n.classList.toggle("sel",edSelSet.includes(k)); n.classList.toggle("primary",k===edSel&&single); });
  layoutGroupFrame(); if(edSel>=0)edMode="props"; paintSide(); }
function edPaste(){ if(!edClip.length||!EDIT.width)return; pushHistory(); edPasteN++; const off=24*edPasteN, start=EDIT.els.length;
  edClip.forEach((c,n)=>{ const el=normEl(JSON.parse(JSON.stringify(c))); el.id="c"+Date.now()+"_"+n; el.x=(+el.x||0)+off; el.y=(+el.y||0)+off; EDIT.els.push(el); });
  buildNodes(); layoutStage(); const idxs=[]; for(let k=start;k<EDIT.els.length;k++)idxs.push(k); edSelectMany(idxs);
  toast(`Pasted ${edClip.length} element(s)`); }
function edDuplicate(){ if(!edSelSet.length)return; edClip=edSelSet.map(k=>JSON.parse(JSON.stringify(EDIT.els[k]))); edPasteN=0; edPaste(); }
function edSelectAll(){ if(!EDIT.els.length)return; edSelectMany(EDIT.els.map((_,i)=>i)); }

/* ---- side panel (Properties / Insert tabs) ---- */
function elLabel(e){ if(e.type==="frame")return "Photo frame";
  if(e.type==="image"){ const s=e.src||""; if(!s||s.startsWith("data:"))return "Image"; return (s.split("/").pop()||"").split("?")[0]||"Image"; }
  if(e.type==="shape"){ return /blur/.test(e.backdropFilter||"")?"Blur panel":"Rectangle"; } return e.text||"text"; }
function updLayerLabel(){ const l=$("edSideBody")&&$("edSideBody").querySelector(`.ed-layer[data-i="${edSel}"] .lt`); if(l)l.textContent=elLabel(EDIT.els[edSel]); }
function segWire(id,cur,cb){ const box=$(id); if(!box)return; box.querySelectorAll("button").forEach(b=>{ b.classList.toggle("on",b.dataset.v===cur); b.onclick=()=>{ box.querySelectorAll("button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); cb(b.dataset.v); }; }); }
function paintSide(){
  $("edSide").innerHTML=`<div class="ed-tabs">
    <button class="${edMode==="props"?"on":""}" onclick="edTab('props')">Style</button>
    <button class="${edMode==="insert"?"on":""}" onclick="edTab('insert')">Insert</button>
    <button class="${edMode==="options"?"on":""}" onclick="edTab('options')">Options</button>
    <button class="${edMode==="caption"?"on":""}" onclick="edTab('caption')">Caption</button></div><div id="edSideBody"></div>`;
  if(edMode==="insert") renderInsert(); else if(edMode==="options") renderOptions(); else if(edMode==="caption") owRenderCaption(); else renderProps();
}
function edTab(m){ edMode=m; paintSide(); }
function renderOptions(){
  const body=$("edSideBody"); const t=findTpl(EDIT.tid); if(!t){ body.innerHTML=`<div class="ed-empty">No options.</div>`; return; }
  // Reflect the CURRENT edited values (e.g. stats added earlier) back into the
  // controls, not just the API defaults.
  const params=(t.params||[]).filter(p=>p.key!=="theme").map(p=> edParams[p.key]!=null ? {...p, default:edParams[p.key]} : p);
  body.innerHTML=`<div class="ph">Template options</div>`+
    (params.length?`<div id="edOpts"></div>`:`<div class="ed-empty" style="padding:10px">This template has no extra options.</div>`)+
    `<button class="btn" style="width:100%;justify-content:center;margin-top:8px" onclick="applyOptions()">Apply &amp; re-render</button>
     <button class="btn alt sm" style="width:100%;justify-content:center;margin-top:8px" onclick="edDownloadZip()">⬇ Download all sizes (ZIP)</button>
     <div class="hint" style="margin-top:8px">Data comes from the API. Applying re-renders from the template and resets manual layout edits.</div>`;
  if(params.length){
    const host=$("edOpts"); buildParams({...t,params},host);
    host.querySelectorAll("[data-key]").forEach(el=>{ const v=edParams[el.dataset.key];
      if(v!=null && (el.tagName==="SELECT" || (el.tagName==="INPUT" && el.type!=="checkbox")) && !Array.isArray(v)) el.value=v; });
  }
}
async function applyOptions(){
  const host=$("edOpts"); const p=host?collectParams(host):{};
  if(!(await owMayDiscard()))return;
  edParams={ theme:edParams.theme, bg:edParams.bg, ...p };
  edMode="props"; loadEditor(true); toast("✓ Options applied — re-rendered from the template"); // fresh; Save to keep
}
async function edDownloadZip(){
  const t=findTpl(EDIT.tid); if(!t)return; toast("Rendering all sizes…");
  const host=$("edOpts"); const params={ theme:edParams.theme, bg:edParams.bg, ...(host?collectParams(host):{}) };
  const fmts=(t.formats||[]).map(f=>f.id);
  const r=await api("/api/download",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,templates:[EDIT.tid],formats:fmts,params:{[EDIT.tid]:params}})});
  if(!r.ok){ toast("ZIP failed"); return; }
  const a=document.createElement("a"); a.href=URL.createObjectURL(await r.blob());
  a.download=`${(t.label||"post").toLowerCase().replace(/[^a-z0-9]+/g,"-")}.zip`; a.click(); toast("✓ Downloaded ZIP");
}
function propsCommon(){ return `
  <div class="edrow"><label>Pos</label><input class="mini" type="number" id="epX"><input class="mini" type="number" id="epY"></div>
  <div class="edrow"><label>Rotate</label><input type="range" id="epRotR" min="-180" max="180"><input class="mini" type="number" id="epRot"></div>
  <div class="edrow"><label>Align to canvas</label></div>
  <div class="ed-align"><button onclick="edAlign('l')">L</button><button onclick="edAlign('cx')">C</button><button onclick="edAlign('r')">R</button>
    <button onclick="edAlign('t')">T</button><button onclick="edAlign('cy')">M</button><button onclick="edAlign('b')">B</button></div>
  <button class="btn danger sm" id="epDel" style="width:100%;justify-content:center;margin-top:12px">🗑 Delete element</button>`; }
function renderProps(){
  const body=$("edSideBody"); const el=edSel>=0?EDIT.els[edSel]:null; let top="";
  if(!el){ top=`<div class="ed-empty"><span class="ic">🎯</span>Click any element on the canvas to move, resize, rotate or restyle it — or use the <b>Insert</b> tab to add text, shapes, speakers &amp; sponsors.</div>`; }
  else if(el.type==="frame"){
    top=`<div class="ph">Photo frame</div><div class="edgrp">
      <div class="edrow"><label>Image</label></div><textarea id="epSrc" placeholder="Paste an image URL…"></textarea>
      <div class="edrow" style="margin-top:8px"><label>Fit</label><div class="seg" id="epFit"><button data-v="cover">Cover</button><button data-v="contain">Contain</button></div>
        <button class="tgl" id="epPan" title="Then drag the photo on the canvas to reposition it inside the frame">✥ Move photo</button></div>
      <div class="edrow"><label>Zoom</label><input type="range" id="epZoom" min="50" max="300"><span class="muted" id="epZoomV"></span></div>
      <div class="edrow"><label>Photo ∠</label><input type="range" id="epImgRot" min="-180" max="180"><input class="mini" type="number" id="epImgRotN"></div>
      <div class="edrow"><label>Photo pos</label><input class="mini" type="number" id="epImgX"><input class="mini" type="number" id="epImgY"></div>
      <div class="ph" style="margin-top:6px">Frame</div>
      <div class="edrow"><label>Size</label><input class="mini" type="number" id="epW"><span class="muted">×</span><input class="mini" type="number" id="epH"></div>
      <div class="edrow"><label>Round</label><input class="mini" type="number" id="epRad"></div>
    </div>${propsCommon()}`;
  }
  else if(el.type==="image"){
    top=`<div class="ph">Image element</div><div class="edgrp">
      <div class="edrow"><label>Source</label></div><textarea id="epSrc"></textarea>
      <div class="edrow" style="margin-top:8px"><label>Fit</label><div class="seg" id="epFit"><button data-v="cover">Cover</button><button data-v="contain">Contain</button></div></div>
      <div class="edrow"><label>Size</label><input class="mini" type="number" id="epW"><span class="muted">×</span><input class="mini" type="number" id="epH"></div>
      <div class="edrow"><label>Plate</label><input type="color" id="epBg"><input type="range" id="epBgA" min="0" max="100"><button class="tgl" id="epBgClear">none</button></div>
      <div class="edrow"><label>Pad</label><input type="range" id="epPad" min="0" max="80"><label>Round</label><input class="mini" type="number" id="epRad"></div>
    </div>${propsCommon()}`;
  }
  else if(el.type==="shape"){
    top=`<div class="ph">Blur / panel</div><div class="edgrp">
      <div class="edrow"><label>Fill</label><input type="color" id="epBg"><input type="range" id="epBgA" min="0" max="100"><button class="tgl" id="epBgClear">none</button></div>
      <div class="edrow"><label>Blur</label><input type="range" id="epBlur" min="0" max="40"><span class="muted" id="epBlurV"></span></div>
      <div class="edrow"><label>Round</label><input class="mini" type="number" id="epRad"></div>
      <div class="edrow"><label>Size</label><input class="mini" type="number" id="epW"><span class="muted">×</span><input class="mini" type="number" id="epH"></div>
    </div>${propsCommon()}`;
  }
  else {
    top=`<div class="ph">Text element</div><div class="edgrp">
      <textarea id="epText"></textarea>
      <div class="edrow" style="margin-top:8px"><label>Font</label><select id="epFont">${EDFONTS.map(f=>`<option value="${f}">${f}</option>`).join("")}</select></div>
      <div class="edrow"><label>Size</label><input class="mini" type="number" id="epSize"><label>Weight</label><select id="epWeight" class="mini">${[300,400,500,600,700].map(w=>`<option>${w}</option>`).join("")}</select></div>
      <div class="edrow"><label>Style</label><div class="seg" id="epAlign"><button data-v="left">L</button><button data-v="center">C</button><button data-v="right">R</button></div>
        <button class="tgl" id="epItalic" title="Italic"><i>I</i></button><button class="tgl" id="epUpper" title="UPPERCASE">AA</button></div>
      <div class="edrow"><label>Color</label><input type="color" id="epColor"></div>
      <div class="edrow"><label>Fill</label><input type="color" id="epBg"><input type="range" id="epBgA" min="0" max="100"><button class="tgl" id="epBgClear">none</button></div>
      <div class="edrow"><label>Round</label><input class="mini" type="number" id="epRad"><label>Pad</label><input type="range" id="epPad" min="0" max="80"></div>
    </div>${propsCommon()}`;
  }
  const multi = edSelSet.length>1 ? `<div class="ed-multi">${edSelSet.length} elements selected · drag moves all, edits apply to the last</div>` : "";
  const ic=(t)=>t==="image"?"🖼":t==="frame"?"🎞":t==="shape"?"▭":"T";
  const layers=`<div class="ed-layers"><div class="ph">Layers · ${EDIT.els.length}</div>${EDIT.els.map((e,i)=>`<div class="ed-layer ${edSelSet.includes(i)?"on":""}" data-i="${i}"><span class="lk">${ic(e.type)}</span><span class="lt">${escapeHtml(elLabel(e))}</span></div>`).join("")}</div>`;
  body.innerHTML=multi+top+layers;
  wirePanel(el);
}
function wirePanel(el){
  $("edSideBody").querySelectorAll(".ed-layer").forEach(l=>l.onclick=(ev)=>selectEl(+l.dataset.i, ev.shiftKey||ev.metaKey||ev.ctrlKey));
  if(!el)return; const node=edNodes[edSel]; const snap=()=>pushHistory();
  const del=$("epDel"); if(del){ del.textContent = edSelSet.length>1 ? `🗑 Delete ${edSelSet.length} elements` : "🗑 Delete element"; del.onclick=edDeleteSel; }
  const px=$("epX"),py=$("epY");
  if(px){ px.value=Math.round(el.x); px.onfocus=snap; px.oninput=()=>{el.x=+px.value||0;node.style.left=el.x+"px";}; }
  if(py){ py.value=Math.round(el.y); py.onfocus=snap; py.oninput=()=>{el.y=+py.value||0;node.style.top=el.y+"px";}; }
  const rr=$("epRotR"),rn=$("epRot");
  if(rr){ rr.value=el.rotate||0; rn.value=el.rotate||0; const setR=(v)=>{el.rotate=Math.round(+v||0);rr.value=el.rotate;rn.value=el.rotate;node.style.transform="rotate("+el.rotate+"deg)";};
    rr.onfocus=snap; rn.onfocus=snap; rr.oninput=()=>setR(rr.value); rn.oninput=()=>setR(rn.value); }
  const bg=$("epBg"),bga=$("epBgA"),bgc=$("epBgClear");
  if(bg){ const bgp=parseColor(el.background||"rgba(0,0,0,0)"); bg.value=toHexRGB(bgp); bga.value=Math.round((bgp.a||0)*100); bgc.classList.toggle("on",(bgp.a||0)<=0);
    const applyBg=()=>{ el.background=(+bga.value<=0)?"rgba(0, 0, 0, 0)":rgbaStr(bg.value,+bga.value/100); applyNode(node,el); bgc.classList.toggle("on",+bga.value<=0); };
    bg.onfocus=snap; bg.oninput=()=>{ if(+bga.value<=0)bga.value=100; applyBg(); };
    bga.onfocus=snap; bga.oninput=applyBg; bgc.onclick=()=>{ snap(); bga.value=0; applyBg(); }; }
  const rad=$("epRad"); if(rad){ rad.value=parseFloat(el.radius)||0; rad.onfocus=snap; rad.oninput=()=>{el.radius=(+rad.value||0)+"px";applyNode(node,el);}; }
  const pad=$("epPad"); if(pad){ pad.value=parseFloat(el.padding)||0; pad.onfocus=snap; pad.oninput=()=>{el.padding=(+pad.value||0)+"px";applyNode(node,el);}; }
  const w=$("epW"),h=$("epH");
  if(w){ w.value=Math.round(el.w); w.onfocus=snap; w.oninput=()=>{el.w=+w.value||1;applyNode(node,el);}; }
  if(h){ h.value=Math.round(el.h||node.offsetHeight); h.onfocus=snap; h.oninput=()=>{el.h=+h.value||1;applyNode(node,el);}; }

  if(el.type==="frame"){
    const src=$("epSrc"); const isData=(el.src||"").startsWith("data:");
    src.value=isData?"":(el.src||""); src.onfocus=snap; src.onchange=()=>{ const v=src.value.trim(); if(v){el.src=v;applyNode(node,el);} };
    segWire("epFit",el.objectFit||"cover",v=>{snap();el.objectFit=v;applyNode(node,el);});
    const pan=$("epPan"); if(pan){ pan.classList.toggle("on",edPanMode); pan.onclick=()=>{ edPanMode=!edPanMode; pan.classList.toggle("on",edPanMode); }; }
    const z=$("epZoom"),zv=$("epZoomV"); if(z){ z.value=Math.round((el.imgScale||1)*100); if(zv)zv.textContent=z.value+"%"; z.onfocus=snap;
      z.oninput=()=>{ el.imgScale=(+z.value||100)/100; if(zv)zv.textContent=z.value+"%"; applyNode(node,el); }; }
    const ir=$("epImgRot"),irn=$("epImgRotN"); if(ir){ ir.value=el.imgRotate||0; irn.value=el.imgRotate||0;
      const setIR=(v)=>{ el.imgRotate=Math.round(+v||0); ir.value=el.imgRotate; irn.value=el.imgRotate; applyNode(node,el); };
      ir.onfocus=snap; irn.onfocus=snap; ir.oninput=()=>setIR(ir.value); irn.oninput=()=>setIR(irn.value); }
    const ix=$("epImgX"),iy=$("epImgY"); if(ix){ ix.value=el.imgX||0; iy.value=el.imgY||0; ix.onfocus=snap; iy.onfocus=snap;
      ix.oninput=()=>{el.imgX=+ix.value||0;applyNode(node,el);}; iy.oninput=()=>{el.imgY=+iy.value||0;applyNode(node,el);}; }
    return;
  }
  if(el.type==="image"){
    const src=$("epSrc"); const isData=(el.src||"").startsWith("data:");
    src.value=isData?"":(el.src||""); src.placeholder=isData?"Embedded image — paste a URL to replace":"Paste an image URL…";
    src.onfocus=snap; src.onchange=()=>{ const v=src.value.trim(); if(v){el.src=v;applyNode(node,el);updLayerLabel();} };
    segWire("epFit",el.objectFit||"cover",v=>{snap();el.objectFit=v;applyNode(node,el);});
    return;
  }
  if(el.type==="shape"){
    const blur=$("epBlur"),blurV=$("epBlurV"); const cur=(/blur\(([\d.]+)px\)/.exec(el.backdropFilter||"")||[])[1]||0;
    blur.value=cur; if(blurV)blurV.textContent=cur+"px"; blur.onfocus=snap;
    blur.oninput=()=>{ const v=+blur.value||0; el.backdropFilter=v>0?`blur(${v}px) saturate(1.1)`:"none"; if(blurV)blurV.textContent=v+"px"; applyNode(node,el); };
    return;
  }
  const tx=$("epText"); tx.value=el.text||""; tx.onfocus=snap; tx.oninput=()=>{el.text=tx.value;if(/\n/.test(el.text)&&el.whiteSpace==="nowrap")el.whiteSpace="pre-wrap";applyNode(node,el);updLayerLabel();};
  const font=$("epFont"); font.value=matchFont(el.fontFamily); font.onchange=()=>{snap();el.fontFamily=font.value;applyNode(node,el);};
  const size=$("epSize"); size.value=Math.round(el.fontSize||24); size.onfocus=snap; size.oninput=()=>{el.fontSize=+size.value||1;applyNode(node,el);};
  const wt=$("epWeight"); wt.value=String(parseInt(el.fontWeight)||400); wt.onchange=()=>{snap();el.fontWeight=wt.value;applyNode(node,el);};
  segWire("epAlign",el.textAlign||"left",v=>{snap();el.textAlign=v;applyNode(node,el);});
  const it=$("epItalic"); it.classList.toggle("on",el.fontStyle==="italic"); it.onclick=()=>{snap();el.fontStyle=el.fontStyle==="italic"?"normal":"italic";it.classList.toggle("on");applyNode(node,el);};
  const up=$("epUpper"); up.classList.toggle("on",el.textTransform==="uppercase"); up.onclick=()=>{snap();el.textTransform=el.textTransform==="uppercase"?"none":"uppercase";up.classList.toggle("on");applyNode(node,el);};
  const col=$("epColor"); col.value=toHex(el.color||"#ffffff"); col.onfocus=snap; col.oninput=()=>{el.color=col.value;applyNode(node,el);};
}

/* ---- align to canvas ---- */
function edAlign(kind){ if(!edSelSet.length)return; pushHistory();
  edSelSet.forEach(idx=>{ const el=EDIT.els[idx], n=edNodes[idx]; const h=el.h||n.offsetHeight;
    if(kind==="l")el.x=0; else if(kind==="cx")el.x=Math.round((EDIT.width-el.w)/2); else if(kind==="r")el.x=EDIT.width-el.w;
    else if(kind==="t")el.y=0; else if(kind==="cy")el.y=Math.round((EDIT.height-h)/2); else if(kind==="b")el.y=EDIT.height-h;
    applyNode(n,el); });
  const el=EDIT.els[edSel], px=$("epX"),py=$("epY"); if(el){ if(px)px.value=Math.round(el.x); if(py)py.value=Math.round(el.y); }
  layoutGroupFrame();
}

/* ---- add elements ---- */
function edCenter(w,h){ return { x:Math.round((EDIT.width-w)/2), y:Math.round((EDIT.height-h)/2) }; }
// toBack=true inserts at the back of the stack (behind images/text) — used for
// blur panels & rectangles so they act as backdrops, not covers.
function addEl(el,toBack){ pushHistory(); if(toBack)EDIT.els.unshift(el); else EDIT.els.push(el);
  buildNodes(); layoutStage(); edMode="props"; selectEl(toBack?0:EDIT.els.length-1); closeMenus(); }
function edAdd(kind){
  if(!EDIT.width){ closeMenus(); return; }
  const id="n"+Date.now();
  if(kind==="text"){ const w=Math.round(EDIT.width*.5), c=edCenter(w,0);
    addEl({ id, type:"text", x:c.x, y:Math.round(EDIT.height*.45), w, text:"New text", fontFamily:"Inter", fontSize:Math.round(EDIT.width*.05),
      fontWeight:"700", fontStyle:"normal", color:"#ffffff", textAlign:"center", lineHeight:"1.1", letterSpacing:"normal", textTransform:"none",
      textShadow:"0 2px 12px rgba(0,0,0,.55)", background:"rgba(0, 0, 0, 0)", padding:"0", radius:"0", boxShadow:"none", rotate:0 }); }
  else if(kind==="image"){ const w=Math.round(EDIT.width*.28), c=edCenter(w,w);
    addEl({ id, type:"image", x:c.x, y:c.y, w, h:w, src:PLACEHOLDER_IMG, objectFit:"contain", objectPosition:"center",
      background:"rgba(0, 0, 0, 0)", padding:"0", radius:"12px", boxShadow:"none", rotate:0 }); }
  else if(kind==="blur"){ const w=Math.round(EDIT.width*.6), h=Math.round(EDIT.height*.3), c=edCenter(w,h);
    addEl({ id, type:"shape", x:c.x, y:c.y, w, h, background:"rgba(8, 10, 22, 0.34)", backdropFilter:"blur(16px) saturate(1.1)",
      border:"none", radius:"28px", boxShadow:"0 16px 44px rgba(0,0,0,.28)", rotate:0 }, true); }
  else if(kind==="rect"){ const w=Math.round(EDIT.width*.4), h=Math.round(EDIT.height*.15), c=edCenter(w,h);
    addEl({ id, type:"shape", x:c.x, y:c.y, w, h, background:"rgba(255, 255, 255, 0.14)", backdropFilter:"none",
      border:"none", radius:"18px", boxShadow:"none", rotate:0 }, true); }
  else if(kind==="frame"){ const w=Math.round(EDIT.width*.28), c=edCenter(w,w);
    addEl({ id, type:"frame", x:c.x, y:c.y, w, h:w, rotate:0, radius:"18px", border:"none", boxShadow:"0 12px 30px rgba(0,0,0,.25)",
      background:"rgba(255,255,255,.06)", src:PLACEHOLDER_IMG, objectFit:"cover", objectPosition:"center", imgScale:1, imgX:0, imgY:0, imgRotate:0, scrim:"" }); }
}

/* ---- insert speakers / sponsors from the API ---- */
async function loadAssets(){ const k=S.portal+"|"+S.event; if(edAssetsCache[k])return edAssetsCache[k];
  const r=await api(`/api/editor/assets?portal=${S.portal}&event=${S.event}`); if(!r.ok) return {speakers:[],sponsors:[]}; const j=await r.json(); edAssetsCache[k]=j; return j; }
const spkCk=(s,i)=>`<label class="ed-ck" data-i="${i}"><input type="checkbox">${s.photoUrl?`<img src="${escapeHtml(s.photoUrl)}" onerror="this.style.visibility='hidden'">`:""}<span class="li"><span class="ln">${escapeHtml(s.name)}</span><span class="ld">${escapeHtml([s.designation,s.company].filter(Boolean).join(", "))}</span></span></label>`;
const spoCk=(s,i)=>`<label class="ed-ck" data-i="${i}"><img src="${escapeHtml(s.logoUrl)}" style="object-fit:contain;background:#fff" onerror="this.style.visibility='hidden'"><span class="li"><span class="ln">${escapeHtml(s.title)}</span><span class="ld">${escapeHtml(s.tier||"")}</span></span><input type="checkbox"></label>`;
const ADD_SECTION=`<div class="ph">Add element</div>
  <div class="ed-addgrid">
    <button onclick="edAdd('text')">🔤 Text</button>
    <button onclick="edAdd('frame')">🎞 Photo frame</button>
    <button onclick="edAdd('image')">🖼 Image</button>
    <button onclick="edAdd('blur')">🌫 Blur panel</button>
    <button onclick="edAdd('rect')">▭ Rectangle</button>
  </div>
  <div class="ph" style="margin-top:16px">Insert from event</div>`;
function renderInsert(){ const body=$("edSideBody"); body.innerHTML=ADD_SECTION+`<div class="ed-empty"><span class="spin"></span></div>`;
  loadAssets().then(a=>{
    body.innerHTML=ADD_SECTION+`
      <button class="ed-dd" onclick="edToggleDD('spkDD',this)">👤 Add speakers <span class="faint" style="font-weight:500">· ${a.speakers.length}</span><span class="cv">▾</span></button>
      <div class="ed-ddp" id="spkDD">
        <input id="qSpk" placeholder="Search speakers…">
        <div class="ed-cklist" id="spkList">${a.speakers.length?a.speakers.map((s,i)=>spkCk(s,i)).join(""):'<div class="ed-empty" style="padding:8px">No speakers with photos.</div>'}</div>
        <button class="btn sm" style="width:100%;justify-content:center" onclick="edAddSelected('spk')">Add selected</button>
      </div>
      <button class="ed-dd" style="margin-top:12px" onclick="edToggleDD('spoDD',this)">🏢 Add sponsors <span class="faint" style="font-weight:500">· ${a.sponsors.length}</span><span class="cv">▾</span></button>
      <div class="ed-ddp" id="spoDD">
        <input id="qSpo" placeholder="Search sponsors…">
        <div class="ed-cklist" id="spoList">${a.sponsors.length?a.sponsors.map((s,i)=>spoCk(s,i)).join(""):'<div class="ed-empty" style="padding:8px">No sponsors with logos.</div>'}</div>
        <button class="btn sm" style="width:100%;justify-content:center" onclick="edAddSelected('spo')">Add selected</button>
      </div>
      <div class="hint" style="margin-top:10px">Tick the ones you need and Add — they drop onto the canvas as movable elements.</div>`;
    const qs=$("qSpk"); if(qs)qs.oninput=()=>filterCk("spkList",qs.value);
    const qo=$("qSpo"); if(qo)qo.oninput=()=>filterCk("spoList",qo.value);
  });
}
function edToggleDD(id,btn){ const p=$(id); const open=p.classList.toggle("on"); if(btn)btn.classList.toggle("on",open); }
function filterCk(listId,q){ q=(q||"").toLowerCase(); const list=$(listId); if(!list)return;
  list.querySelectorAll(".ed-ck").forEach(l=>l.style.display=l.textContent.toLowerCase().includes(q)?"":"none"); }
function edAddSelected(kind){
  const a=edAssetsCache[S.portal+"|"+S.event]; if(!a||!EDIT.width)return;
  const list=$(kind==="spk"?"spkList":"spoList"); if(!list)return;
  const idxs=[...list.querySelectorAll(".ed-ck input:checked")].map(cb=>+cb.closest(".ed-ck").dataset.i);
  if(!idxs.length){ toast("Tick at least one"); return; }
  pushHistory();
  idxs.forEach((idx,n)=>{ if(kind==="spk") pushSpeaker(a.speakers[idx],n); else pushSponsor(a.sponsors[idx],n); });
  buildNodes(); layoutStage(); edMode="props"; selectEl(EDIT.els.length-1);
  toast(`✓ Added ${idxs.length} ${kind==="spk"?"speaker(s)":"sponsor(s)"}`);
}
function pushSpeaker(s,n){ if(!s)return; const off=(n||0)*Math.round(EDIT.width*.03);
  const d=Math.round(EDIT.width*.22), x=Math.round((EDIT.width-d)/2)+off, y=Math.round(EDIT.height*.3)+off;
  const nameFs=Math.round(EDIT.width*.03), roleFs=Math.round(EDIT.width*.022), gap=Math.round(EDIT.width*.012), tw=Math.round(d*2.2), tx=Math.round(x-(tw-d)/2), t="t"+Date.now()+"_"+(n||0);
  EDIT.els.push(
    { id:"p"+t, type:"frame", x, y, w:d, h:d, rotate:0, radius:Math.round(d/2)+"px", border:"none", boxShadow:"0 12px 30px rgba(0,0,0,.28)", background:"rgba(255,255,255,.06)", src:s.photoUrl, objectFit:"cover", objectPosition:"top center", imgScale:1, imgX:0, imgY:0, imgRotate:0, scrim:"" },
    { id:"n"+t, type:"text", x:tx, y:y+d+gap, w:tw, text:s.name, fontFamily:"Inter", fontSize:nameFs, fontWeight:"700", fontStyle:"normal", color:"#ffffff", textAlign:"center", lineHeight:"1.1", letterSpacing:"normal", textTransform:"none", textShadow:"0 2px 10px rgba(0,0,0,.6)", background:"rgba(0, 0, 0, 0)", padding:"0", radius:"0", boxShadow:"none", rotate:0 },
    { id:"r"+t, type:"text", x:tx, y:y+d+gap+nameFs+8, w:tw, text:[s.designation,s.company].filter(Boolean).join(", "), fontFamily:"Inter", fontSize:roleFs, fontWeight:"600", fontStyle:"normal", color:"#ffffff", textAlign:"center", lineHeight:"1.2", letterSpacing:"normal", textTransform:"none", textShadow:"0 2px 8px rgba(0,0,0,.6)", background:"rgba(0, 0, 0, 0)", padding:"0", radius:"0", boxShadow:"none", rotate:0 }
  );
}
function pushSponsor(s,n){ if(!s)return; const off=(n||0)*Math.round(EDIT.width*.03);
  const w=Math.round(EDIT.width*.24), h=Math.round(EDIT.height*.11), x=Math.round((EDIT.width-w)/2)+off, y=Math.round(EDIT.height*.4)+off;
  EDIT.els.push({ id:"so"+Date.now()+"_"+(n||0), type:"image", x, y, w, h, src:s.logoUrl, objectFit:"contain", objectPosition:"center",
    background:"rgba(255, 255, 255, 0.96)", padding:Math.round(w*.06)+"px", radius:"14px", boxShadow:"0 10px 30px rgba(0,0,0,.18)", rotate:0 });
}

/* ---- menus ---- */
function toggleMenu(id,e){ if(e)e.stopPropagation(); const m=$(id), open=m.classList.contains("on"); closeMenus(); if(!open)m.classList.add("on"); }
function closeMenus(){ document.querySelectorAll(".ed-menu.on").forEach(m=>m.classList.remove("on")); }
document.addEventListener("click",(e)=>{ if(!e.target.closest(".ed-menuwrap")) closeMenus(); });

/* ---- save / reset / download ---- */
async function edSave(){
  if(!EDIT.width)return; toast("Saving…");
  const r=await api("/api/editor/save",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,templateId:EDIT.tid,format:EDIT.fmt,params:{...edParams},
      width:EDIT.width,height:EDIT.height,base:EDIT.base,elements:EDIT.els})});
  const sj=r.ok?null:await r.json().catch(()=>null); toast(r.ok?"✓ Saved — your edits will reload next time":"Save failed"+(sj&&sj.error?": "+sj.error:""), r.ok?undefined:6000);
}
async function edReset(){
  if(!(await owConfirmReset()))return;
  const rr=await api("/api/editor/reset",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,templateId:EDIT.tid,format:EDIT.fmt,params:{...edParams}})});
  if(!rr.ok){ if(window.OWS)OWS.skipGuard=false; toast("Reset failed"); return; } edHist=[]; edRedo=[]; updUndo(); loadEditor(true); toast("Reset to the original template");
}
async function edDownload(){
  if(!EDIT.width)return; toast("Rendering…");
  const r=await api("/api/editor/render",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({width:EDIT.width,height:EDIT.height,base:EDIT.base,elements:EDIT.els,download:true})});
  if(!r.ok){ toast("Render failed"); return; }
  const t=findTpl(EDIT.tid); const a=document.createElement("a");
  a.href=URL.createObjectURL(await r.blob());
  a.download=`${(t?t.label:"post").toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${EDIT.fmt}.png`; a.click();
  toast("✓ Downloaded");
}

/* ---- global editor listeners ---- */
$("edCanvas").addEventListener("pointerdown",(e)=>{ const t=e.target; if(t.id==="edCanvas"||t.id==="edStage"||t.id==="edBg"||t.id==="edBase"||t.id==="edGuideV"||t.id==="edGuideH"||t.id==="edGroup"||t.classList.contains("ed-stagewrap")) selectEl(-1); });
$("edGroupRes").addEventListener("pointerdown",startGroupResize);
$("edGroupRot").addEventListener("pointerdown",startGroupRotate);
window.addEventListener("resize",()=>{ if($("editor").classList.contains("on")&&EDIT.width) layoutStage(); });
/** Does the focused thing own this keystroke? A tag-name test is not enough:
 *  the rich-text editors are contenteditable DIVs, and in-place canvas editing
 *  puts focus inside the preview IFRAME. Missing either meant Backspace deleted
 *  the whole section while you were typing in it. */
function typingTarget(){
  const ae=document.activeElement;
  if(!ae) return false;
  if(/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(ae.tagName||"")) return true;
  if(ae.isContentEditable) return true;
  return !!(ae.closest&&ae.closest(".ql-editor,[contenteditable='true']"));
}
document.addEventListener("keydown",(e)=>{
  if(!$("editor").classList.contains("on"))return;
  const inField=typingTarget();
  if(e.key==="Escape"){ const ae=document.activeElement||{}, picked=ae.tagName==="SELECT"||(ae.tagName==="INPUT"&&/^(checkbox|radio|range|color|file|button|submit|reset|image)$/.test(ae.type||"")); if((!inField||picked)&&!e.defaultPrevented) owLeaveEditor(); return; }
  // Cmd/Ctrl shortcuts — skipped inside inputs so native text copy/paste still works
  if((e.metaKey||e.ctrlKey)&&!inField){
    const k=e.key.toLowerCase();
    if(k==="c"){ e.preventDefault(); edCopy(); return; }
    if(k==="x"){ e.preventDefault(); edCut(); return; }
    if(k==="v"){ e.preventDefault(); edPaste(); return; }
    if(k==="d"){ e.preventDefault(); edDuplicate(); return; }
    if(k==="a"){ e.preventDefault(); edSelectAll(); return; }
    if(k==="z"){ e.preventDefault(); e.shiftKey?edRedoFn():edUndo(); return; }
    if(k==="y"){ e.preventDefault(); edRedoFn(); return; }
  }
  if(!edSelSet.length)return;
  if(inField)return;
  if(e.key==="Delete"||e.key==="Backspace"){ e.preventDefault(); edDeleteSel(); return; }
  if(e.key.startsWith("Arrow")){ e.preventDefault(); owNudgeSnap(); const d=e.shiftKey?10:1;
    edSelSet.forEach(idx=>{ const el=EDIT.els[idx], n=edNodes[idx];
      if(e.key==="ArrowLeft")el.x-=d; else if(e.key==="ArrowRight")el.x+=d; else if(e.key==="ArrowUp")el.y-=d; else if(e.key==="ArrowDown")el.y+=d;
      n.style.left=el.x+"px"; n.style.top=el.y+"px"; });
    const el=EDIT.els[edSel],px=$("epX"),py=$("epY"); if(el){if(px)px.value=Math.round(el.x);if(py)py.value=Math.round(el.y);} layoutGroupFrame(); }
});
