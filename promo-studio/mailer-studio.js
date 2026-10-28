/* COPIED from the promotional platform (the owner's Social Post Generator, app/public/index.html) by
   tools/extract-promo-studio.py, unchanged except PATCHES (listed in tools/extract-promo-studio.py) — do not
   edit here: Oneworld's changes are in promo-studio/oneworld.js. */
/* ===== from the platform's index.html: $ ===== */
const $=(id)=>document.getElementById(id);

/* ===== from the platform's index.html: the mailer product's nav ===== */
/** The mailer product carries a persistent nav — its dashboard and its work are
 *  two places you move between constantly, and the crumb trail alone made picking
 *  a portal feel like a dead end. */
function setProdNav(active){
  const nav=$("prodNav"); if(!nav)return;
  nav.style.display=S.product==="mail"?"":"none";
  nav.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.v===active));
}

/* ===== from the platform's index.html: number and date helpers, and the mailer dashboard ===== */
const S_OPEN="#4f46e5", S_CLICK="#eb6834";
const nFmt=(n)=>Number(n||0).toLocaleString();
// "3th edition" — blindly appending "th" is wrong for 1/2/3. 11/12/13 stay "th".
const ordinal=(n)=>{n=Number(n)||0;const t=n%100;return n+(t>=11&&t<=13?"th":["th","st","nd","rd"][n%10]||"th");};
const kFmt=(n)=>{n=Number(n||0); return n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e4?(n/1e3).toFixed(1)+"K":n.toLocaleString();};
const pct=(a,b)=>b>0?Math.round((a/b)*100):0;
const AN={range:30, tmplMetric:"opens", subjMetric:"opens", data:null, openVer:null};

/** 12-point sparkline: de-emphasised, with the last point in the series colour. */
function spark(vals,color){
  const w=104,h=26,pts=vals.slice(-12); if(pts.length<2) return "";
  const max=Math.max(1,...pts), st=w/(pts.length-1);
  const xy=pts.map((v,i)=>[i*st, h-2-(v/max)*(h-5)]);
  const d=xy.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const last=xy[xy.length-1];
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"/></svg>`;
}

/** Two-series trend. One y-axis (never two), hairline grid, 2px lines, a 10%
 *  area wash, and a crosshair that snaps to the nearest day and reports BOTH
 *  series at once — so the pointer never has to find a 2px line. */
function trendChart(series){
  const W=980,H=210,L=38,R=14,T=12,B=26;
  const iw=W-L-R, ih=H-T-B, n=series.length;
  const max=Math.max(4,...series.map(d=>Math.max(d.opens,d.clicks)));
  const ny=4, step=Math.ceil(max/ny/5)*5||1, top=step*ny;
  const x=i=>L+(n<2?iw/2:(i/(n-1))*iw), y=v=>T+ih-(v/top)*ih;
  const path=(k)=>series.map((d,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(d[k]).toFixed(1)).join(" ");
  const area=(k)=>`${path(k)} L ${x(n-1).toFixed(1)} ${T+ih} L ${x(0).toFixed(1)} ${T+ih} Z`;
  const grid=Array.from({length:ny+1},(_,i)=>{const v=i*step,gy=y(v);
    return `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W-R}" y2="${gy.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>
            <text x="${L-8}" y="${(gy+3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--faint)">${nFmt(v)}</text>`;}).join("");
  const every=Math.max(1,Math.round(n/6));
  const xlab=series.map((d,i)=>i%every===0||i===n-1
    ? `<text x="${x(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="10" fill="var(--faint)">${new Date(d.date+"T00:00:00Z").toLocaleDateString(undefined,{month:"short",day:"numeric"})}</text>`:"").join("");
  const end=(k,c)=>{const v=series[n-1][k]; return `<circle cx="${x(n-1).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" fill="${c}" stroke="var(--panel)" stroke-width="2"/>`;};
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Opens and clicks per day">
    ${grid}
    <path d="${area("opens")}" fill="${S_OPEN}" fill-opacity=".10"/>
    <path d="${area("clicks")}" fill="${S_CLICK}" fill-opacity=".10"/>
    <path d="${path("opens")}" fill="none" stroke="${S_OPEN}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path("clicks")}" fill="none" stroke="${S_CLICK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${end("opens",S_OPEN)}${end("clicks",S_CLICK)}
    <line id="anCross" x1="0" y1="${T}" x2="0" y2="${T+ih}" stroke="var(--axis)" stroke-width="1" opacity="0"/>
    ${xlab}
  </svg>`;
}
/** Hover: aim at a date, not at a line. */
function wireTrend(box,series){
  const svg=box.querySelector("svg"), tip=box.querySelector(".tip"), cross=box.querySelector("#anCross");
  if(!svg||!tip)return;
  const W=980,L=38,R=14,iw=W-L-R,n=series.length;
  const move=(ev)=>{
    const r=svg.getBoundingClientRect(), sx=(ev.clientX-r.left)/r.width*W;
    let i=Math.round(((sx-L)/iw)*(n-1)); i=Math.max(0,Math.min(n-1,i));
    const d=series[i], px=L+(n<2?iw/2:(i/(n-1))*iw);
    cross.setAttribute("x1",px); cross.setAttribute("x2",px); cross.setAttribute("opacity","1");
    tip.textContent="";
    const day=document.createElement("div"); day.className="d";
    day.textContent=new Date(d.date+"T00:00:00Z").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
    tip.appendChild(day);
    for(const [lab,val,col] of [["Opens",d.opens,S_OPEN],["Clicks",d.clicks,S_CLICK]]){
      const row=document.createElement("div"); row.className="r";
      const key=document.createElement("i"); key.style.background=col;
      const b=document.createElement("b"); b.textContent=nFmt(val);
      const sName=document.createElement("s"); sName.textContent=lab;   // untrusted-safe: textContent
      row.append(key,b,sName); tip.appendChild(row);
    }
    tip.style.left=(px/W*r.width)+"px"; tip.style.top=(r.height*0.06)+"px"; tip.style.opacity="1";
  };
  svg.addEventListener("pointermove",move);
  svg.addEventListener("pointerleave",()=>{tip.style.opacity="0";cross.setAttribute("opacity","0");});
}

/** Magnitude, ordered: one hue, thin bars, value at the tip.
    `versions` (templates only) turns a row into a drill-down: the ranking stays
    by template — a template is the thing you pick — and expanding one answers
    "which saved version of it did better", which is the whole point of keeping
    versions. Both metrics ride on every row, so expanding costs no request. */
function rankCard(title,id,rows,metric,versions){
  const max=Math.max(1,...rows.map(r=>r[metric]||0));
  const body=rows.length?`<ol class="rank">${rows.slice(0,6).map((r,i)=>{
      const vs=versions&&versions[r.key];
      const open=vs&&AN.openVer===r.key;
      const vmax=vs?Math.max(1,...vs.map(v=>v[metric]||0)):1;
      return `<li class="${vs?"has":""} ${open?"open":""}" ${vs?`onclick="anToggleVer(${i})"`:""}>
        <span class="no">${vs?`<i class="cv">${open?"▾":"▸"}</i>`:i+1}</span>
        <div><div class="lb" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}${vs?`<span class="vct">${vs.length} versions</span>`:""}</div>
          <div class="tr" style="width:${Math.max(3,Math.round((r[metric]/max)*100))}%"></div></div>
        <span class="vv">${kFmt(r[metric])}<s>${r.sends} send${r.sends===1?"":"s"}</s></span>
        ${open?`<ol class="vrank">${vs.slice().sort((a,b)=>b[metric]-a[metric]).map(v=>`
          <li><div><div class="lb" title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</div>
              <div class="tr" style="width:${Math.max(3,Math.round((v[metric]/vmax)*100))}%"></div></div>
            <span class="vv">${kFmt(v[metric])}<s>${v.sends} send${v.sends===1?"":"s"}</s></span></li>`).join("")}</ol>`:""}
      </li>`;}).join("")}</ol>`
    :`<p class="an-empty" style="padding:18px 0">Nothing recorded yet.</p>`;
  return `<div class="card an-card"><div class="an-hd"><h3>${escapeHtml(title)}</h3>
      <div class="seg">
        <button class="${metric==="opens"?"on":""}" onclick="anMetric('${id}','opens')">Opens</button>
        <button class="${metric==="clicks"?"on":""}" onclick="anMetric('${id}','clicks')">Clicks</button>
      </div></div>${body}</div>`;
}
function anMetric(which,m){ if(which==="tmpl")AN.tmplMetric=m; else AN.subjMetric=m; paintAnalytics(); }
function anToggleVer(key){ AN.openVer=AN.openVer===key?null:key; paintAnalytics(); }
function anRange(d){ AN.range=d; paintAnalytics(); }
/** Reopen the exact mailer a row came from — including the version it was
    generated from, which is the row you clicked on. */
async function anOpen(portal,event,mailerId,name,saveId){
  S.product="mail"; S.portal=portal; S.portalName=name||portal; S.event=Number(event);
  await loadPortals();
  // openEvent is fully awaited (it only resolves once MAILERS is set and the
  // event page is rendered — renderEventDetail is synchronous), so there is
  // nothing left to wait out here. A fixed setTimeout used to sit in this spot;
  // on anything slower than local dev (a cold serverless function, a slow
  // upstream) it could fire before openEvent had actually finished, opening
  // nothing or the wrong mailer's fresh state instead of the requested save.
  await openEvent(Number(event));
  openMailer(mailerId,saveId||null);
}

async function showAnalytics(){
  mark("dashboard");
  crumbs([{t:"Dashboard"}]); setProdNav("dash");
  if(!AN.data) $("content").innerHTML=`<div class="page-h"><div><h2>Mailer performance</h2>
      <p>${owDashSubline()}</p></div></div>
    <div class="kpis">${"<div class=\"card kpi\"><div class=\"sk\" style=\"height:74px\"></div></div>".repeat(4)}</div>
    <div class="card an-card"><div class="sk" style="height:210px"></div></div>`;
  const r=await api("/api/analytics");
  if(!r.ok){ $("content").innerHTML=`<div class="ml-err">Could not load analytics.</div>`; return; }
  AN.data=await r.json();
  paintAnalytics();
}

function paintAnalytics(){
  const a=AN.data; if(!a)return;
  const series=(a.series||[]).slice(-AN.range);
  const win=series.reduce((t,d)=>({opens:t.opens+d.opens,clicks:t.clicks+d.clicks}),{opens:0,clicks:0});
  const t=a.totals;

  // Say what was excluded and why. A number that quietly got smaller is not more
  // trustworthy than one that was quietly too big.
  const filt=a.filtered||{opens:0,clicks:0};
  const filtNote=(filt.opens||filt.clicks)
    ? `<div class="an-note">Excluded <b>${nFmt(filt.opens)}</b> automated open${filt.opens===1?"":"s"} and <b>${nFmt(filt.clicks)}</b> automated click${filt.clicks===1?"":"s"} — mail security gateways and link checkers fetch every image and follow every link before a person sees the mail.</div>`
    : "";
  // Plain language: a marketer can't act on "Vercel KV / Upstash Redis". Say what
  // it means for THEM — are their opens and clicks being saved, or not.
  const note=a.backend==="none"
    ? `<div class="an-note warn"><b>Opens and clicks aren't being saved right now.</b> Mailers you send will still work, but their performance won't show up here. Ask whoever set up this platform to turn on performance tracking.</div>`
    : a.backend==="file" ? `<div class="an-note">Your mailer performance is being saved.</div>` : "";

  const empty=t.sends===0;
  $("content").innerHTML=`<div class="page-h"><div><h2>Mailer performance</h2>
      <p>${owDashSubline()}</p></div>
      <div class="r"><button class="btn alt sm" onclick="AN.data=null;AN.fresh=true;showAnalytics()">Refresh</button>
        <button class="btn sm" onclick="showPortals()">New mailer →</button></div></div>
    ${note}${filtNote}
    ${empty?`<div class="card an-empty"><div class="e">✉</div><h4>No mailers generated yet</h4>
        <p>Download or copy a mailer and its opens and clicks appear here.</p>
        <button class="btn" onclick="showPortals()">${owDashPickLabel()}</button></div>`
    :`
    <div class="an-bar">
      <div class="seg">
        ${[7,30].map(d=>`<button class="${AN.range===d?"on":""}" onclick="anRange(${d})">Last ${d} days</button>`).join("")}
      </div>
      <span class="muted" style="font-size:11.5px">Totals below cover all time; the chart covers the range.</span>
    </div>
    <div class="kpis">
      <div class="card kpi hero"><div class="k">Opens</div><div class="v">${kFmt(t.opens)}</div>
        <div class="sub">${nFmt(win.opens)} in the last ${AN.range} days</div>
        <div class="spark">${spark(series.map(d=>d.opens),S_OPEN)}</div></div>
      <div class="card kpi"><div class="k">Clicks</div><div class="v">${kFmt(t.clicks)}</div>
        <div class="sub">${nFmt(win.clicks)} in range</div>
        <div class="spark">${spark(series.map(d=>d.clicks),S_CLICK)}</div></div>
      <div class="card kpi"><div class="k">Click-to-open</div><div class="v">${pct(t.clicks,t.opens)}%</div>
        <div class="sub">clicks per open</div></div>
      <div class="card kpi"><div class="k">Mailers generated</div><div class="v">${nFmt(t.sends)}</div>
        <div class="sub">all time</div></div>
    </div>
    <div class="card an-card" style="margin-bottom:14px">
      <div class="an-hd"><h3>Opens and clicks per day</h3>
        <div class="lgd"><span><i style="background:${S_OPEN}"></i>Opens</span><span><i style="background:${S_CLICK}"></i>Clicks</span></div>
      </div>
      <div class="chart" id="anChart">${trendChart(series)}<div class="tip"></div></div>
    </div>
    <div class="an-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-bottom:14px">
      ${rankCard("Top templates","tmpl",AN.tmplMetric==="opens"?a.topOpenedTemplates:a.topClickedTemplates,AN.tmplMetric,a.versions||{})}
      ${rankCard("Top subject lines","subj",AN.subjMetric==="opens"?a.topOpenedSubjects:a.topClickedSubjects,AN.subjMetric)}
    </div>
    <div class="card an-card"><div class="an-hd"><h3>Recent mailers</h3>
        <span class="muted" style="font-size:11.5px">Click a row to reopen it in the studio</span></div>
      <table class="an-tbl"><thead><tr>
          <th>Generated</th><th>Template</th><th>Subject</th><th>Event</th><th class="n">Opens</th><th class="n">Clicks</th><th></th></tr></thead>
        <tbody>${a.sends.slice(0,12).map((x,i)=>`<tr onclick="anOpenRow(${i})">
          <td>${new Date(x.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</td>
          <td>${escapeHtml(x.mailerLabel||x.mailerId)}${x.saveName?`<span class="vchip" title="Saved version">${escapeHtml(x.saveName)}</span>`:""}</td>
          <td class="sub" title="${escapeHtml(x.subject)}">${escapeHtml(x.subject)}</td>
          <td>${escapeHtml(x.eventName||"")}</td>
          <td class="n">${nFmt(x.opens)}</td><td class="n">${nFmt(x.clicks)}</td><td class="go">→</td></tr>`).join("")}</tbody></table>
    </div>
    <p class="an-foot">Opens are counted when a mail client loads the tracking image, so they under-count clients that block images and over-count privacy proxies that pre-fetch them. Clicks exclude known bots, but can't be guaranteed exact.</p>`}`;

  const box=$("anChart"); if(box) wireTrend(box,series);
}

/* ===== from the platform's index.html: "Recently updated": every saved version of this event ===== */
/* ---------- Saved (this event) ----------
   Every saved mailer version for the event on screen, across every mailer TYPE,
   newest first — a cross-event "all my work" tab sounded useful but a sender
   is always in the middle of ONE event, and everything they'd want to resume
   was already fetched with it (MAILERS.saves, from /api/mailers) — no separate
   request, no portal to pick, and it can never show a version that belongs
   somewhere else. Lives on the event page's mail section, above the template
   grid, so the most recent update is the first thing you see, not something
   you have to know to go look for under a specific template card. */
function evSavedList(){
  const saves=(MAILERS&&MAILERS.saves)||{};
  const out=[];
  for(const mailerId in saves) for(const s of saves[mailerId]) out.push({...s, mailerId});
  return out.sort((a,b)=>b.savedAt-a.savedAt);
}
/** A saved version, as a card in the same visual language as the template
 *  cards below it (.mcard/.mgrid) — art from the mailer TYPE it belongs to,
 *  the version's own name as the headline (what tells two saves of the same
 *  template apart), its subject as the preview, straight into the studio on
 *  the button, exactly like a template card's "Open in studio". */
function savedCardHtml(s){
  const m=findMailer(s.mailerId); if(!m) return "";
  return `<div class="mcard">
    ${mailerArt(m)}
    <div class="grp"><span>${escapeHtml(m.group)}</span><span class="savedchip">${savedWhen(s.savedAt)}</span></div>
    <div class="nm">${escapeHtml(s.name)}</div>
    ${s.subject?`<div class="subj"><b>Subject</b>${escapeHtml(s.subject)}</div>`:""}
    <div class="cta"><button class="btn sm" style="width:100%;justify-content:center" onclick='openMailer(${JSON.stringify(s.mailerId)},${JSON.stringify(s.saveId)})'>Edit →</button></div>
  </div>`;
}
/** The "Recently updated" heading + card grid, and — only when there is
 *  something to distinguish it from — the "Templates" label that then heads
 *  the template grid below. Both live in one string so refreshMailerCards()
 *  can update them together: the FIRST save of a brand-new event has to make
 *  the "Templates" heading appear too, not just the cards above it. */
function renderEvSaved(){
  const list=evSavedList();
  if(!list.length) return "";
  return `<div class="sec-h">Recently updated</div>
    <div class="mgrid" style="margin-bottom:24px">${list.map(savedCardHtml).join("")}</div>
    <div class="sec-h">Templates</div>`;
}


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

/* ===== from the platform's index.html: escaping, toast and the in-app dialogs ===== */
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


/* ===== from the platform's index.html: menus ===== */
/* ---- menus ---- */
function toggleMenu(id,e){ if(e)e.stopPropagation(); const m=$(id), open=m.classList.contains("on"); closeMenus(); if(!open)m.classList.add("on"); }
function closeMenus(){ document.querySelectorAll(".ed-menu.on").forEach(m=>m.classList.remove("on")); }
document.addEventListener("click",(e)=>{ if(!e.target.closest(".ed-menuwrap")) closeMenus(); });

/* ===== from the platform's index.html: typingTarget ===== */
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

/* ===== from the platform's index.html: the mailer studio ===== */
/* ================= Promotional mailers — block studio =================
   The document is the artefact: templates seed blocks from the event APIs, the
   studio edits blocks, and the server renders blocks back to email HTML. */
let MAILERS=null;                   // catalog: {mailers, blocks, saved, tones, event}
const BS={};                        // block type -> {label, icon, fields}
// Event people/partners for the pickers. Keyed by portal+event: this used to load
// once per session, so opening a second event kept showing the first one's roster.
const MLA={ key:null, loaded:false, speakers:[], sponsors:[], sessions:[] };
const MD={ id:null, doc:null, sel:null, dirty:false, saved:false, saveId:null, saveName:"",
           width:"desktop", tone:"professional", ai:null, insertAt:null, showDocSettings:false };

/* Unsaved-changes guard. Closing the tab or navigating the browser away used to
   drop an edited draft silently. Warn ONLY when there is something to lose
   (MD.dirty) — saving clears the flag, so a clean or just-saved doc leaves the
   handler a no-op and never nags. Calling preventDefault + setting returnValue is
   what makes the browser show its native "leave site?" prompt. */
window.addEventListener("beforeunload",(e)=>{
  if(!MD.dirty) return;
  e.preventDefault();
  e.returnValue="";        // required by Chrome to trigger the prompt
  return "";
});

/* ---------- saved versions ----------
   An event + mailer holds MANY named saves, not one. The catalog carries them all
   so a card can list its versions without a second request; every mutation
   endpoint returns the fresh list, so the client never has to guess. */
const mlSaves=(id)=>((MAILERS&&MAILERS.saves&&MAILERS.saves[id])||[]);
function mlSetSaves(id,saves){
  if(!MAILERS)return;
  MAILERS.saves=MAILERS.saves||{};
  if(saves&&saves.length) MAILERS.saves[id]=saves; else delete MAILERS.saves[id];
  refreshMailerCards();
}
/** Dates on a version row are for telling saves apart, so the recent ones read as
    a time and the older ones as a date. */
function savedWhen(ts){
  if(!ts) return "";
  const d=new Date(ts), mins=(Date.now()-ts)/60000;
  if(mins<1) return "just now";
  if(mins<60) return `${Math.round(mins)}m ago`;
  if(mins<1440) return d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}

/* ---------- card artwork ----------
   What distinguishes two mailers on this page is their SHAPE — a speaker grid
   reads nothing like a stats band — and eight text-only cards hid that. Each
   card carries a miniature of its own layout, drawn as one set by
   `tools/mailer-art.mjs` and served from /assets/mailer-art/.

   Deliberately not eight live iframe previews: that is eight renders and eight
   image-laden documents to lay out, for a picture the size of a stamp. The art
   is generic to the mailer, so the event's REAL block sequence — which varies,
   because a section with no data renders nothing — stays available as the
   tooltip rather than being implied by the picture. */
function mailerArt(m){
  const outline=(m.outline||[]);
  const tip=outline.length?` title="Sections in this mail: ${escapeHtml(outline.join(" · "))}"`:"";
  // A missing asset collapses the box rather than leaving a broken-image frame.
  return `<div class="art"${tip}><img src="/assets/mailer-art/${encodeURIComponent(m.id)}.svg" alt=""
    loading="lazy" onerror="this.closest('.art').style.display='none'"></div>`;
}

/* ---------- event-page cards ---------- */
function mailerCards(){
  if(!MAILERS||!MAILERS.mailers) return `<div class="empty">Mailers unavailable for this event.</div>`;
  return MAILERS.mailers.map(m=>{
    const saves=mlSaves(m.id), q=JSON.stringify(m.id);
    return `<div class="mcard ${m.available?'':'dis'}">
      ${mailerArt(m)}
      <div class="grp"><span>${escapeHtml(m.group)}</span>${saves.length?`<span class="savedchip">${saves.length} SAVED</span>`:''}${m.suggested?`<span class="timingchip">GOOD TIMING</span>`:''}</div>
      <div class="nm">${escapeHtml(m.label)}</div>
      <div class="ds">${escapeHtml(m.description)}</div>
      ${m.subject?`<div class="subj"><b>Subject</b>${escapeHtml(m.subject)}</div>`:""}
      ${saves.length?`<div class="vers">
        <div class="vh">Saved versions</div>
        <div class="vlist">${saves.map(s=>`
          <div class="vrow" title="Open “${escapeHtml(s.name)}”" onclick='openMailer(${q},${JSON.stringify(s.saveId)})'>
            <span class="vn">${escapeHtml(s.name)}</span>
            <span class="vd">${escapeHtml(savedWhen(s.savedAt))}</span>
          </div>`).join("")}</div>
      </div>`:""}
      <div class="cta">${m.available
        // The PRIMARY action resumes the most recent save when one exists — the
        // instinct on any card is to click the big obvious button, and it used to
        // mean "start over from scratch" the moment ANY save existed, which read
        // as "my saved work is gone" even though it was one small click away in
        // the list above. Starting fresh is still there, just demoted to a quiet
        // secondary link so it can never be mistaken for "continue."
        ? (saves.length
            ? `<button class="btn sm" style="width:100%;justify-content:center" onclick='openMailer(${q},${JSON.stringify(saves[0].saveId)})'>Continue “${escapeHtml(saves[0].name)}” →</button>
               <button class="btn ghost sm" style="width:100%;justify-content:center;margin-top:6px" onclick='openMailer(${q},null,true)'>Start a new version instead</button>`
            : `<button class="btn sm" style="width:100%;justify-content:center" onclick='openMailer(${q},null,false)'>Open in studio →</button>`)
        : `<div class="warn">needs ${m.missing.map(escapeHtml).join(", ")}</div>`}</div>
    </div>`;
  }).join("");
}
function refreshMailerCards(){
  const g=$("mgrid"); if(g)g.innerHTML=mailerCards();
  const sv=$("evSaved"); if(sv)sv.innerHTML=renderEvSaved();
}
const findMailer=(id)=>MAILERS&&MAILERS.mailers.find(m=>m.id===id);

async function downloadAllMailers(){
  if(!MAILERS){toast("Open an event first");return;}
  const btn=event?.target; if(btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span> zipping…';}
  const r=await api("/api/mailer/download",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerIds:[]})});
  if(r.ok){ const a=document.createElement("a"); a.href=URL.createObjectURL(await r.blob()); a.download="mailers.zip"; a.click(); owTrackToast("zip",r.headers.get("X-Mailer-Tracked")!=="no",""); }
  else toast("Download failed");
  if(btn){btn.disabled=false;btn.innerHTML='Download all (.zip)';}
}

/* ---------- open / close ---------- */
/** preId — which mailer; saveId — which saved version; fresh — ignore the saves
    and seed a new document from the event data (creating a mailer is unchanged).
    With none of them, a mailer that has saves opens on its most recent. */
function openMailer(preId,saveId,fresh){
  if(!MAILERS){ toast("Open an event first"); return; }
  const avail=(MAILERS.mailers||[]).filter(m=>m.available);
  if(!avail.length){ toast("No mailers available for this event"); return; }
  (MAILERS.blocks||[]).forEach(b=>BS[b.type]=b);
  const akey=`${S.portal}:${S.event}`;
  if(MLA.key!==akey){
    MLA.key=akey; MLA.loaded=false; MLA.speakers=[]; MLA.sponsors=[]; MLA.sessions=[];
    api(`/api/editor/assets?portal=${S.portal}&event=${S.event}&all=1`).then(r=>r.json())
      .then(j=>{ if(MLA.key!==akey)return;                       // a newer event won the race
                 MLA.speakers=j.speakers||[]; MLA.sponsors=j.sponsors||[]; MLA.sessions=j.sessions||[];
                 MLA.loaded=true; if(MD.sel){mlProps(); mlInspector();} })
      .catch(()=>{ MLA.loaded=true; });
  }
  $("mlPick").innerHTML=avail.map(m=>`<option value="${m.id}">${escapeHtml(m.group)} — ${escapeHtml(m.label)}</option>`).join("");
  $("mlPick").value=(preId&&avail.some(m=>m.id===preId))?preId:avail[0].id;
  $("mlPal").innerHTML=(MAILERS.blocks||[]).filter(b=>b.addable)
    .map(b=>`<button onclick="mlAdd('${b.type}')"><span class="i">${b.icon}</span>${escapeHtml(b.label)}</button>`).join("");
  mlRailPalette();
  $("mailer").classList.add("on"); document.body.style.overflow="hidden";
  MD.id=$("mlPick").value; MD.sel=null; MD.ai=null;
  mlLoad(!!fresh,saveId||null);
}
function closeMailer(){
  if(MD.dirty&&!confirm("You have unsaved changes in this mailer. Close anyway?"))return;
  $("mailer").classList.remove("on"); document.body.style.overflow=""; MD.dirty=false; mlPopClose(); iconPopClose();
  mark("event");
}
/** Changing the mailer in the picker: a different mailer, so its own latest
    saved version — not the one that happened to be open. */
function switchMailer(){ MD.id=$("mlPick").value; MD.sel=null; MD.ai=null; mlLoad(false,null); }

/* ---------- load / render ---------- */
/* Building a mailer means a doc build (several API calls) plus a render, and the
   canvas simply sat there dimmed. This puts a labelled spinner over the stage;
   renders only raise it if they take long enough to notice, so quick edits don't
   flash. */
function mlBusy(on,label){
  let el=$("mlBusy");
  if(!el){
    el=document.createElement("div"); el.id="mlBusy"; el.className="ml-busy";
    el.innerHTML=`<div class="bx"><span class="sp"></span><span class="tx"></span></div>`;
    $("mlStage").appendChild(el);
  }
  if(on) el.querySelector(".tx").textContent=label||"Loading…";   // hiding must not wipe the caption
  el.classList.toggle("on",!!on);
}
let _busyT=null;
function mlBusySoon(label,ms){ clearTimeout(_busyT); _busyT=setTimeout(()=>mlBusy(true,label),ms??250); }
function mlBusyDone(){ clearTimeout(_busyT); mlBusy(false); }
async function mlLoad(fresh,saveId){
  const m=findMailer(MD.id); if(!m) return;
  mlBusy(true,`Building ${m.label||"mailer"}…`);
  const r=await api("/api/mailer/doc",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerId:m.id,fresh:!!fresh,saveId:saveId||null,params:{}})});
  if(!r.ok){ mlBusyDone(); toast("Could not build this mailer"); return; }
  const j=await r.json();
  MD.doc=j.doc; MD.saved=!!j.saved; MD.dirty=false; MD.sel=null;
  MD.saveId=j.save?j.save.saveId:null; MD.saveName=j.save?j.save.name:"";
  mlHistReset();                     // a different document, so a different history
  // Keep the loader up until the mail is not just mounted but its remote images
  // have settled — otherwise the canvas appears, then photos and logos pop in
  // for another second, which reads as "still loading". `mlMountReady` resolves
  // on the iframe's load; `mlImagesReady` then waits for the pictures (capped so
  // a slow CDN can never wedge the loader).
  mlBusy(true,"Loading your mailer…");
  mlMount(j.html,true); mlProps(); mlStatus(); mlMarkUrl();
  await mlImagesReady(3000);
  mlBusyDone();
}

/** Resolve once every image in the preview iframe has loaded (or errored), or
 *  after the cap — whichever comes first. Used to hold the open loader over the
 *  brief window where a mounted mail is still fetching its photos.
 *
 *  `maxMs` is a FLOOR, not the cap: a heavy mailer (a full speaker grid, several
 *  sponsor tiers, a banner and a hero image — 30-40+ <img> tags) needs real
 *  grace on a real network, and a flat 3s gave up on it long before its photos
 *  had actually loaded — the loader vanished and the canvas kept popping in
 *  images for another second or two after. The cap is computed once the real
 *  image count is known (first check, after the mount delay) and scales with
 *  it, capped itself so a single stuck image can't wedge the loader forever. */
function mlImagesReady(maxMs){
  return new Promise((done)=>{
    const start=Date.now();
    const floor=maxMs||3000;
    let cap=floor, capSet=false;
    const check=()=>{
      const d=$("mlFrame")?.contentDocument;
      const imgs=d?[...d.querySelectorAll("img")]:[];
      if(!capSet&&imgs.length){ cap=Math.max(floor,Math.min(15000,1200+imgs.length*220)); capSet=true; }
      const pending=imgs.filter(i=>!i.complete||(i.naturalWidth===0&&!i.getAttribute("data-err")));
      if(!d||!imgs.length||!pending.length||Date.now()-start>=cap){ done(); return; }
      setTimeout(check,120);
    };
    // Give the srcdoc a tick to mount before the first look.
    setTimeout(check,80);
  });
}
/** The studio is a view, so it has a URL: reloading or sharing it reopens this
    mailer — and this exact version when one is open. */
function mlMarkUrl(){ mark("studio",{product:"mail",portal:S.portal,event:S.event,mailerId:MD.id,saveId:MD.saveId}); }

/** Re-render on the server, then re-mount. Scroll position is preserved so
    editing a field never jumps the canvas out from under you. */
let _rt;
function mlRender(delay){
  clearTimeout(_rt);
  _rt=setTimeout(async ()=>{
    if(!MD.doc)return;
    mlBusySoon("Updating preview…",300);
    const r=await api("/api/mailer/render",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({portal:S.portal,event:S.event,doc:MD.doc,editor:true})});
    if(!r.ok){ mlBusyDone(); return; }
    const j=await r.json();
    mlMount(j.html);
    if(j.palette) mlApplyPalette(j.palette);
    mlStatus(); mlInspector(); mlBusyDone();
  }, delay===undefined?300:delay);
}
/* The mail resolves its own palette from the event website; the studio's chrome
   and the accent swatch follow it instead of staying on the app's default indigo. */
function mlApplyPalette(pal){
  MD.pal=pal;
  const a=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pal.accent||"")?pal.accent:null;
  if(!a)return;
  const root=$("mailer");
  root.style.setProperty("--accent",a);
  root.style.setProperty("--accent-soft",a+"1f");            // 12% tint for chips/hovers
  const pick=$("mlAccentPick"), txt=$("mlAccent");
  if(pick&&!MD.doc.accent) pick.value=a;
  if(txt&&!MD.doc.accent) txt.placeholder=`${a} (from the event site)`;
}
function mlMount(html,resetScroll){
  const f=$("mlFrame"), stage=$("mlStage");
  let keep=resetScroll?0:stage.scrollTop;
  const from=Math.round(keep);
  f.onload=()=>{
    // A render is a round trip, and the sender can scroll while it is in flight.
    // Their position is then the CURRENT one — restoring the one we set out with
    // would snap the canvas back to where they no longer are. (The restore needs
    // no retry: mlFit leaves its height on the IFRAME ELEMENT, which survives the
    // srcdoc swap, so the stage never collapses under us while the mail reloads.)
    if(!resetScroll&&Math.round(stage.scrollTop)!==from) keep=stage.scrollTop;
    mlFit(); mlOverlay(); stage.scrollTop=keep;
    mlNeutraliseLinks();
    // A just-added block asked to be revealed. The hotspot exists now (mlOverlay
    // ran), so reveal it ONCE and clear the request immediately — a lingering
    // timer would re-scroll on a later, unrelated re-render and fight the scroll
    // the sender had since made.
    if(MD.revealNext){ const rid=MD.revealNext; MD.revealNext=null; mlReveal(rid); }
    // Remote logos/photos can settle after `load`, which would leave the canvas
    // taller (blank space) or shorter (clipped) than its content. Re-measure when
    // each image resolves, and again after the dust settles.
    const d=f.contentDocument;
    if(d){
      d.querySelectorAll("img").forEach(img=>{
        if(img.complete)return;
        img.addEventListener("load",mlRefit,{once:true});
        img.addEventListener("error",mlRefit,{once:true});
      });
      if(window.ResizeObserver&&d.documentElement){
        try{ mlRO?.disconnect(); mlRO=new ResizeObserver(mlRefit); mlRO.observe(d.documentElement); }catch{}
      }
    }
    setTimeout(mlRefit,350); setTimeout(mlRefit,1400);
  };
  f.srcdoc=html;
}
let mlRO=null,_refit;
function mlRefit(){ clearTimeout(_refit); _refit=setTimeout(()=>{ mlFit(); mlOverlay(); },80); }
/** In the studio the mail is a canvas, not a page: clicking a link must select
 *  the block, never navigate. The downloaded copy keeps its real hrefs. */
function mlNeutraliseLinks(){
  const d=$("mlFrame").contentDocument; if(!d)return;
  d.addEventListener("click",(e)=>{ const a=e.target.closest&&e.target.closest("a"); if(a){ e.preventDefault(); e.stopPropagation(); } },true);
  d.querySelectorAll("a").forEach(a=>{ a.style.cursor="default"; a.setAttribute("tabindex","-1"); });
}
/** Size the canvas to the mail's real content.
 *  NOT scrollHeight: that returns max(content, viewport), so sizing the iframe
 *  from it feeds back into the next measurement and the canvas creeps taller by
 *  a couple of pixels on every re-fit. Measuring the body's children is
 *  viewport-independent, and the guard stops any residual loop. */
/** Smallest the preview canvas may be — see mlFit. Mirrored by .ml-frame's
    min-height in the CSS; keep the two in step. */
const MIN_CANVAS=160;
function mlFit(){
  const f=$("mlFrame"), d=f.contentDocument;
  if(!d||!d.body) return;
  let bottom=0;
  for(const el of d.body.children){
    const r=el.getBoundingClientRect();
    if(r.height>0) bottom=Math.max(bottom,r.bottom);
  }
  // The floor only exists so a document that renders nothing does not collapse
  // the canvas to zero. It used to be 620px, which every seeded mailer cleared —
  // until the blank canvas, whose 213px of content sat in a 620px frame with
  // 407px of the mail's page wash below it, looking like a rendering fault.
  const next=Math.max(MIN_CANVAS,Math.ceil(bottom)+2);
  const now=parseFloat(f.style.height)||0;
  if(Math.abs(next-now)>1) f.style.height=next+"px";
}

/** Hotspots over each block row: hover outlines, selection shows the toolbar,
    and a "+" between blocks inserts there. */
function mlOverlay(){
  const f=$("mlFrame"), d=f.contentDocument, ov=$("mlOv");
  ov.innerHTML="";
  if(!d) return;
  ov.style.width=f.clientWidth+"px"; ov.style.height=f.clientHeight+"px";
  const rows=[...d.querySelectorAll("[data-block-id]")];
  rows.forEach((el,n)=>{
    const id=el.getAttribute("data-block-id");
    const r=el.getBoundingClientRect();
    if(r.height<2) return;
    const b=(MD.doc.blocks||[]).find(x=>x.id===id);
    const i=(MD.doc.blocks||[]).findIndex(x=>x.id===id);
    const hot=document.createElement("div");
    hot.className="ml-hot"+(MD.sel===id?" on":"");
    hot.dataset.id=id;
    hot.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    // One gesture, two meanings, disambiguated by movement: press and release
    // without moving is a click (select, then edit the words under the pointer);
    // press and drag is a reorder. Both start here so you never have to find a
    // handle first — the section itself is the handle.
    hot.onpointerdown=(e)=>{
      if(e.button||e.target.closest("button"))return;
      e.stopPropagation();
      startBlockDrag(e,id);
    };
    hot.ondblclick=(e)=>{ e.stopPropagation(); e.preventDefault(); };
    hot.title="Click the text to edit it · drag to move this section";
    hot.innerHTML=`<span class="tag">${b?escapeHtml(BS[b.type]?.label||b.type):""}</span>
      <span class="tb">
        <span class="grip" title="Drag to move this section">⠿</span>
        <button title="Duplicate" onclick="event.stopPropagation();mlDup('${id}')">⧉</button>
        <button title="Delete" onclick="event.stopPropagation();mlDel('${id}')">✕</button>
      </span>
      <button class="ins" title="Insert a block here" onclick="event.stopPropagation();mlPalette(${i+1},event)">+</button>`;
    ov.appendChild(hot);
  });
}
window.addEventListener("resize",()=>{ if($("mailer").classList.contains("on")) mlOverlay(); });

/* ---------- rail palette ----------
   The rail used to mirror the document (a "Structure" list you dragged rows
   around in). It is now the BLOCK PALETTE: you drag a block from here straight
   onto the canvas and drop it exactly where it belongs. Reordering moved to the
   canvas too (see startBlockDrag), so there is only ever one place to arrange
   the mail — the mail itself. */
function mlRailPalette(){
  const host=$("mlRailPal"); if(!host)return;
  const q=String(($("mlPalQ")||{}).value||"").trim().toLowerCase();
  const all=(MAILERS&&MAILERS.blocks||[]).filter(b=>b.addable);
  const hit=all.filter(b=>!q||b.label.toLowerCase().includes(q)||b.type.includes(q));
  host.innerHTML=hit.length
    ? hit.map(b=>`<button type="button" data-type="${escapeHtml(b.type)}" title="Drag onto the canvas, or click to add">
        <span class="i">${b.icon}</span>${escapeHtml(b.label)}</button>`).join("")
    : `<div class="none">Nothing matches “${escapeHtml(q)}”.</div>`;
  host.querySelectorAll("button").forEach(el=>{
    el.addEventListener("pointerdown",(e)=>startPaletteDrag(e,el));
  });
}

/* ---------- one drag language for the whole canvas ----------
   Dragging a NEW block in from the rail and dragging an EXISTING one to a new
   position are the same gesture and show the same indicator, because to the
   sender they are the same act: deciding where something sits. */
const DRAG={ kind:null, type:null, id:null, moved:false, ghost:null };

/** Where a drop at this screen-Y would land, as an index into doc.blocks.
    Measured from the overlay's hotspots, which are the only true record of what
    is actually visible — a block that renders nothing has no hotspot. */
function mlDropIndex(clientY){
  const hots=[...$("mlOv").querySelectorAll(".ml-hot")];
  for(const h of hots){
    const r=h.getBoundingClientRect();
    if(clientY<r.top+r.height/2) return blockIndex(h.dataset.id);
  }
  return (MD.doc.blocks||[]).length;
}
function mlDropShow(index){
  const ov=$("mlOv"); let line=$("mlDrop");
  if(!line){ line=document.createElement("div"); line.id="mlDrop"; line.className="ml-drop"; ov.appendChild(line); }
  const hots=[...ov.querySelectorAll(".ml-hot")];
  const ovr=ov.getBoundingClientRect();
  const target=hots.find(h=>blockIndex(h.dataset.id)===index);
  const r=target?target.getBoundingClientRect():(hots.length?hots[hots.length-1].getBoundingClientRect():null);
  if(!r){ line.classList.remove("on"); return; }
  line.style.top=Math.round((target?r.top:r.bottom)-ovr.top)-1+"px";
  line.classList.add("on");
}
function mlDropHide(){ const l=$("mlDrop"); if(l) l.classList.remove("on"); }
function mlGhost(text,x,y){
  if(!DRAG.ghost){ DRAG.ghost=document.createElement("div"); DRAG.ghost.className="ml-ghost"; document.body.appendChild(DRAG.ghost); }
  DRAG.ghost.textContent=text; DRAG.ghost.style.left=x+"px"; DRAG.ghost.style.top=y+"px";
}
function mlDragEnd(){
  if(DRAG.ghost){ DRAG.ghost.remove(); DRAG.ghost=null; }
  document.querySelectorAll(".ml-pal.rail button.dragging").forEach(b=>b.classList.remove("dragging"));
  mlDropHide();
  DRAG.kind=null; DRAG.type=null; DRAG.id=null; DRAG.moved=false;
}
/** Is this point over the canvas at all? A drop anywhere else is a cancel. */
const overCanvas=(x,y)=>{ const r=$("mlStage").getBoundingClientRect(); return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom; };

/** Drag a new block out of the rail. A press that never moves is a click, and
    clicking still adds after the selection — the fast path when position is
    obvious and you don't want to aim. */
function startPaletteDrag(e,el){
  if(e.button)return;
  e.preventDefault();
  const type=el.dataset.type;
  DRAG.kind="new"; DRAG.type=type; DRAG.moved=false;
  const label=(BS[type]&&BS[type].label)||type;
  const move=(ev)=>{
    if(!DRAG.moved&&Math.abs(ev.clientY-e.clientY)+Math.abs(ev.clientX-e.clientX)<5) return;
    if(!DRAG.moved){ DRAG.moved=true; el.classList.add("dragging"); }
    mlGhost(label,ev.clientX,ev.clientY);
    if(overCanvas(ev.clientX,ev.clientY)) mlDropShow(mlDropIndex(ev.clientY)); else mlDropHide();
  };
  const up=(ev)=>{
    document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",up);
    const dragged=DRAG.moved, at=overCanvas(ev.clientX,ev.clientY)?mlDropIndex(ev.clientY):null;
    mlDragEnd();
    if(!dragged) mlAdd(type);                       // a click: add after the selection
    else if(at!=null) mlAdd(type,at);               // a drag: add exactly where dropped
  };
  document.addEventListener("pointermove",move); document.addEventListener("pointerup",up);
}

/** Drag an existing block to a new position, on the canvas. Replaces the ↑ ↓
    buttons: nudging a section one step at a time told you nothing about where it
    would end up, and moving it five places meant five clicks and five renders. */
function startBlockDrag(e,id){
  DRAG.kind="move"; DRAG.id=id; DRAG.moved=false;
  const label=(BS[(MD.doc.blocks||[]).find(b=>b.id===id)?.type]||{}).label||"Section";
  const move=(ev)=>{
    if(!DRAG.moved&&Math.abs(ev.clientY-e.clientY)+Math.abs(ev.clientX-e.clientX)<5) return;
    if(!DRAG.moved){ DRAG.moved=true; if(IE.el) mlEditEnd(true); }
    mlGhost(label,ev.clientX,ev.clientY);
    if(overCanvas(ev.clientX,ev.clientY)) mlDropShow(mlDropIndex(ev.clientY)); else mlDropHide();
  };
  const up=(ev)=>{
    document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",up);
    const dragged=DRAG.moved, to=overCanvas(ev.clientX,ev.clientY)?mlDropIndex(ev.clientY):null;
    mlDragEnd();
    if(!dragged){ mlSelect(id,{reveal:false}); mlEditAt(ev.clientX,ev.clientY); return; }   // it was a click
    if(to==null)return;
    const from=blockIndex(id);
    // Removing the block first shifts every later index down by one, so a drop
    // below its old home has to come back a step or it lands one too far.
    const dest=to>from?to-1:to;
    if(dest===from||dest<0)return;
    const bs=MD.doc.blocks; bs.splice(dest,0,bs.splice(from,1)[0]);
    MD.dirty=true; MD.sel=id; mlRender(0); toast("Section moved");
  };
  document.addEventListener("pointermove",move); document.addEventListener("pointerup",up);
}

/* ---------- block operations ---------- */
const blockIndex=(id)=>(MD.doc.blocks||[]).findIndex(b=>b.id===id);
/* Edit the copy where you read it. The server marks every text-bearing element in
   the studio render with data-ed="blockId|propPath" (paragraphs also carry #index),
   so a double-click makes that element contentEditable and the text is written
   straight back to the block prop. The canvas iframe is normally pointer-events:none
   with the overlay owning clicks, so editing flips that for the duration and hides
   the overlay, then restores it. Plain text only — pasted markup never enters. */
const IE={ el:null, ed:null, before:null, dirty:false, rich:false };
function mlSetProp(path,value){
  const [id,rest]=path.split("|");
  const b=(MD.doc.blocks||[]).find(x=>x.id===id); if(!b)return;
  const [key,...tail]=rest.split("#")[0].split(".");
  const idx=rest.split("#")[1];
  if(key==="items"&&!tail.length){                          // the whole list, one region
    // One point per line. Blank lines are dropped rather than stored as empty
    // bullets, and each point keeps whatever other fields its row already had.
    const old=Array.isArray(b.props.items)?b.props.items:[];
    b.props.items=String(value).split(/\n+/).map(s=>s.trim()).filter(Boolean)
      .map((t,i)=>({ ...(old[i]||{}), text:t }));
    return;
  }
  if(key==="items"&&tail.length===2){                       // items.N.text
    const arr=Array.isArray(b.props.items)?b.props.items:[];
    const i=Number(tail[0]); if(!arr[i])return;
    arr[i][tail[1]]=value; b.props.items=arr;
  }else if(idx!==undefined){                                 // one paragraph of many
    const lines=String(b.props[key]??"").split(/\n+/);
    lines[Number(idx)]=value; b.props[key]=lines.filter((l,i)=>l.trim()||i<lines.length).join("\n");
  }else b.props[key]=value;
  MD.dirty=true; mlStatus();
}
/* Read back exactly what mlSetProp would write — the STORED text, markers and
   all. In-place editing used to seed itself from the rendered element's
   innerText, where "**x**" has already become <strong>x</strong>; committing
   that wrote the unformatted text back over the source and silently destroyed
   the formatting. Every editor on the canvas seeds from here instead. */
function mlGetProp(path){
  const [id,rest]=String(path||"").split("|");
  const b=(MD.doc.blocks||[]).find(x=>x.id===id); if(!b)return "";
  const [key,...tail]=rest.split("#")[0].split(".");
  const idx=rest.split("#")[1];
  if(key==="items"&&!tail.length){                          // the whole list, one point per line
    return (Array.isArray(b.props.items)?b.props.items:[])
      .map(x=>String((x&&x.text)??"")).filter(Boolean).join("\n");
  }
  if(key==="items"&&tail.length===2){
    const arr=Array.isArray(b.props.items)?b.props.items:[];
    const i=Number(tail[0]);
    return arr[i]?String(arr[i][tail[1]]??""):"";
  }
  if(idx!==undefined) return String(b.props[key]??"").split(/\n+/)[Number(idx)]??"";
  return String(b.props[key]??"");
}
/** The schema entry behind a canvas edit path (`blockId|field`, or
 *  `blockId|items.0.text` for a repeatable row — rows resolve to their list
 *  field, which is not itself rich, so they keep the plain control). */
function mlFieldSchema(path){
  const [id,rest]=String(path||"").split("|");
  const key=String(rest||"").split("#")[0].split(".")[0];
  const b=MD.doc&&MD.doc.blocks.find((x)=>x.id===id);
  const bs=b&&BS[b.type];
  return { block:b||null, field:(bs&&(bs.fields||[]).find((f)=>f.key===key))||null };
}
/** Which canvas fields get the rich editor. Read from the block schema — the
 *  same `rich` flag the settings panel reads — so the two editors cannot
 *  disagree about what a field supports, and neither can drift from what the
 *  renderer actually parses. */
function mlRichPath(path){
  const { block, field }=mlFieldSchema(path);
  if(!field)return false;
  // A `list` field declares `rich` when its ROWS carry marker-parsing copy —
  // bullet points and statement lines both do. This used to be hardcoded to the
  // bullets block, which meant the next list block to arrive silently lost its
  // formatting controls while its renderer went on parsing markers.
  return !!field.rich;
}
/** May this field hold more than one line? The schema already answers it, so no
 *  list of block types is needed here: a `textarea` is a paragraph control and
 *  the renderer splits its stored value on newlines (paragraphs() in
 *  mailers/base.ts), while a `text` field is one line — inlineCopy() prints it
 *  inline and would swallow a break without a trace. `rich` is NOT the test:
 *  most headings declare it and are still single-line. */
function mlMultiline(path){
  if(isListPath(path)) return true;                 // a list region's rows ARE lines
  const { field }=mlFieldSchema(path);
  return !!field&&field.type==="textarea";
}
/* Toolbar docked over the text you are editing, on the canvas. Inline buttons wrap
   the selection in the markers the renderer understands; size/alignment set the
   block's own props (those change the whole paragraph, so they commit and re-render). */
const TB=[
  {k:"b",m:"**",t:"Bold  (⌘B)",l:"B",css:"font-weight:800"},
  {k:"i",m:"*",t:"Italic  (⌘I)",l:"I",css:"font-style:italic"},
  {k:"u",m:"__",t:"Underline  (⌘U)",l:"U",css:"text-decoration:underline"},
  {k:"s",m:"~~",t:"Strikethrough",l:"S",css:"text-decoration:line-through"},
  {k:"h",m:"==",t:"Highlight",l:"H",css:"background:rgba(255,214,0,.35);border-radius:3px"},
  {k:"a",m:null,t:"Hyperlink",l:"🔗",css:""},
  {sep:1},
  {k:"sz-",m:null,t:"Smaller text",l:"A−",css:"font-size:10px"},
  {k:"sz+",m:null,t:"Bigger text",l:"A+",css:"font-size:13px"},
  {sep:1},
  {k:"al",m:null,t:"Align left",l:"⯇",css:""},
  {k:"ac",m:null,t:"Align centre",l:"≡",css:""},
  {k:"ar",m:null,t:"Align right",l:"⯈",css:""},
  {sep:1},
  {k:"x",m:null,t:"Clear formatting",l:"⌫",css:""},
  {sep:1},
  // Escape now KEEPS the edit (it used to discard), so this ✕ is the one explicit
  // way to throw the changes away for the rare case you want that.
  {k:"cancel",m:null,t:"Discard changes",l:"✕",css:"color:#dc2626;font-weight:700"},
  // Enter breaks the line in a field that can hold one, so it is no longer the
  // commit gesture — Esc and ⌘Enter both commit, and this label is where it says so.
  {k:"ok",m:null,t:"Done — Esc or ⌘/Ctrl+Enter",l:"✓",css:"color:var(--accent);font-weight:700"},
];
function mlTbShow(el,rich){
  let tb=$("mlTB");
  if(!tb){
    tb=document.createElement("div"); tb.id="mlTB"; tb.className="ml-tb"; $("mailer").appendChild(tb);
    tb.innerHTML=TB.map(x=>x.sep?`<i class="sep"></i>`
      :`<button type="button" data-k="${x.k}" title="${escapeHtml(x.t)}" style="${x.css}">${x.l}</button>`).join("");
    tb.addEventListener("mousedown",(e)=>{
      const btn=e.target.closest("button"); if(!btn)return;
      e.preventDefault();                                   // never steal the caret
      mlTbApply(btn.dataset.k);
    });
  }
  // A field whose renderer does not parse markers must not be offered them: the
  // wrap would succeed and the reader would get "**bold**" in the inbox. Size,
  // alignment and Done still apply — they are block props, not markup.
  const inlineKeys=new Set(TB.filter(x=>x.m||x.k==="a"||x.k==="x").map(x=>x.k));
  tb.querySelectorAll("button").forEach(b=>{
    b.style.display=(!rich&&inlineKeys.has(b.dataset.k))?"none":"";
  });
  tb.querySelectorAll(".sep").forEach((s,i)=>{ if(i===0) s.style.display=rich?"":"none"; });
  tb.style.display="flex"; mlTbPlace(el);
}
function mlTbPlace(el){
  const tb=$("mlTB"); if(!tb||!el)return;
  const f=$("mlFrame"), fr=f.getBoundingClientRect();
  const sc=parseFloat(getComputedStyle($("mlStage")).getPropertyValue("--s"))||1;
  const r=el.getBoundingClientRect();
  const x=fr.left+r.left*sc, y=fr.top+r.top*sc;
  const w=tb.offsetWidth||360, h=tb.offsetHeight||34;
  tb.style.left=Math.round(Math.max(8,Math.min(x,window.innerWidth-w-8)))+"px";
  tb.style.top=Math.round(y-h-8<8?y+r.height*sc+8:y-h-8)+"px";
}
function mlTbHide(){ const tb=$("mlTB"); if(tb) tb.style.display="none"; }
/* Apply a mark to the selection, as real formatting.
   The old path inserted the MARKERS as literal characters, so you typed into
   text that read "**bold**" and had to picture the result. Now the browser marks
   the selection up for real — you see bold — and htmlToMarkers converts the
   whole element back to markers on commit. The stored value is still plain text
   carrying markers; nothing here changes what a field stores. */
const EXEC={ b:"bold", i:"italic", u:"underline", s:"strikeThrough" };
/** Put the caret back only if it has actually left the field. Focusing an
 *  element that already holds the selection COLLAPSES it, so the command then
 *  applies to an empty range and silently does nothing. */
function mlKeepCaret(el,d){
  const sel=d.getSelection();
  if(!sel||!sel.rangeCount||!el.contains(sel.anchorNode)) el.focus();
  // Emit <b>/<i>/<u> rather than styled spans: both convert, but tags are what
  // the renderer itself produces, so the DOM stays comparable to a fresh render.
  try{ d.execCommand("styleWithCSS",false,false); }catch(_){}
}
/* A mark is the SENDER's, and must not depend on how the renderer already styles
   the element. execCommand decides by computed style, so on a heading — which the
   mail draws bold by design — ⌘B "toggled off" weight that was never a mark: the
   text looked unchanged, and nothing was stored. So the marks are applied
   explicitly instead, with the same tags inlineCopy() itself emits. */
const MARK_TAG={ b:"STRONG", i:"EM", u:"U", s:"S", h:"SPAN" };
/** The element carrying mark `k` around this node, if any (bounded by the field). */
function mlMarkAt(node,k,root){
  for(let n=node;n&&n!==root;n=n.parentNode){
    if(n.nodeType!==1)continue;
    const tag=n.tagName;
    if(k==="h"){ if(tag==="SPAN"&&/background/i.test(n.getAttribute("style")||"")) return n; continue; }
    if(tag===MARK_TAG[k]) return n;
    if(k==="b"&&tag==="B")return n;
    if(k==="i"&&tag==="I")return n;
    if(k==="s"&&(tag==="STRIKE"||tag==="DEL"))return n;
  }
  return null;
}
function mlUnwrap(n){
  const p=n.parentNode; while(n.firstChild) p.insertBefore(n.firstChild,n);
  p.removeChild(n); p.normalize();
}
function mlTbWrap(k){
  const el=IE.el; if(!el)return;
  const d=$("mlFrame").contentDocument;
  mlKeepCaret(el,d);
  const sel=d.getSelection();
  if(!sel||!sel.rangeCount){ toast("Select the words to format first"); return; }
  const r=sel.getRangeAt(0);
  const already=mlMarkAt(r.startContainer,k,el);
  if(already){ mlUnwrap(already); }
  else{
    if(r.collapsed){ toast("Select the words to format first"); return; }
    const node=d.createElement(MARK_TAG[k]==="SPAN"?"span":MARK_TAG[k].toLowerCase());
    if(k==="h") node.style.backgroundColor="#fde68a";       // any background means ==highlight==
    try{ r.surroundContents(node); }
    catch(_){ node.appendChild(r.extractContents()); r.insertNode(node); }
    const nr=d.createRange(); nr.selectNodeContents(node);
    sel.removeAllRanges(); sel.addRange(nr);
  }
  IE.dirty=true; mlFit(); mlTbPlace(el);
}
function mlTbApply(k){
  const el=IE.el; if(!el)return;
  const d=$("mlFrame").contentDocument;
  const b=MD.doc.blocks[blockIndex(MD.sel)];
  if(EXEC[k]||k==="h") return mlTbWrap(k);
  if(k==="a"){
    const sel=d.getSelection();
    if(!sel||!sel.rangeCount||!sel.toString().trim()){ toast("Select the words to link first"); return; }
    const url=prompt("Link URL","https://"); if(!url)return;
    mlKeepCaret(el,d); d.execCommand("createLink",false,url);
    IE.dirty=true; mlFit(); return;
  }
  if(k==="x"){
    mlKeepCaret(el,d);
    d.execCommand("removeFormat",false,null);
    d.execCommand("unlink",false,null);
    IE.dirty=true; mlFit(); return;
  }
  // block-level: these change the whole paragraph, so commit first and re-render
  if(k==="sz-"||k==="sz+"){
    const cur=Number(b.props.size)||(b.type==="heading"?22:15);
    b.props.size=Math.max(10,Math.min(40,cur+(k==="sz+"?1:-1)));
  } else if(k==="al") b.props.align="left";
  else if(k==="ac") b.props.align="center";
  else if(k==="ar") b.props.align="right";
  else if(k==="ok"){ mlEditEnd(true); return; }
  else if(k==="cancel"){ mlEditEnd(false); return; }
  MD.dirty=true; mlEditEnd(true);
}
/** Is this edit path a bullet LIST edited as one region? */
const isListPath=(ed)=>/\|items$/.test(String(ed||""));

/** Read the current value out of the element being edited, as marker text.
 *  A list is read row by row — the wrapper is a table whose rows carry a marker
 *  or number cell as well as the text, so its innerText would fold "•" and "1."
 *  into the copy. Everything else converts whole. */
function mlEditValue(el){
  const R=window.RichText;
  if(isListPath(IE.ed)){
    const rows=[...el.querySelectorAll("tr")];
    const cells=rows.length?rows.map(tr=>tr.lastElementChild).filter(Boolean):[el];
    // A cell can hold several lines once you press Enter in it, and each line is
    // its own point — that is how you add one without leaving the canvas.
    return cells.flatMap(td=>(R?R.htmlToMarkers(td):td.innerText).split("\n"))
      .map(s=>s.trim()).filter(Boolean).join("\n");
  }
  if(IE.rich&&R) return R.htmlToMarkers(el);
  return el.innerText.replace(/\s+\n/g,"\n").trim();
}

function mlEditStart(el,at){
  if(IE.el) mlEditEnd(true);
  const f=$("mlFrame"), ov=$("mlOv");
  // House rule 12: clicking a section never moves the canvas. Focusing and
  // selecting inside the preview both ask the browser to scroll the caret into
  // view, and that walk crosses the iframe boundary into the studio's own
  // scroller — so merely BEGINNING an edit dragged the canvas down by however
  // far the section ran past the stage's edge. Pin the position across the whole
  // of the setup below; the sender is already looking at what they clicked.
  const stage=$("mlStage"), keepTop=stage.scrollTop;
  IE.el=el; IE.ed=el.getAttribute("data-ed");
  IE.rich=mlRichPath(IE.ed);                      // may this field carry markers at all?
  // Seed from the STORED value, never from the rendering: by the time it is on
  // screen `**x**` is already <strong>x</strong>, and comparing against that is
  // how an edit used to silently drop every mark in the field.
  IE.before=mlGetProp(IE.ed);
  f.style.pointerEvents="auto"; ov.style.display="none";
  el.setAttribute("contenteditable","true");
  // A literal colour, not var(--accent) directly: this element lives INSIDE the
  // preview iframe, which is the mail's own document and has none of the app's
  // custom properties — a var() here silently resolves to nothing, so you could
  // not see what you were editing. Read as a computed value from the OUTER page
  // instead (still just copying a colour, not injecting a stylesheet — the mail
  // document stays untouched by the app's theme) so the ring follows whichever
  // studio theme is current — the old indigo normally, lavender under Liquid —
  // rather than being stuck on one colour regardless of theme.
  const editRing=(getComputedStyle(document.documentElement).getPropertyValue("--accent")||"#4f46e5").trim()||"#4f46e5";
  const [erR,erG,erB]=[1,3,5].map(i=>parseInt(editRing.slice(i,i+2),16));
  el.style.outline=`2px solid ${editRing}`; el.style.outlineOffset="3px";
  el.style.borderRadius="3px"; el.style.boxShadow=`0 0 0 6px rgba(${erR},${erG},${erB},.12)`;
  // The marker/number column belongs to the renderer, not the sender — leaving it
  // editable let you type into the bullet glyphs.
  if(isListPath(IE.ed)) el.querySelectorAll("tr").forEach(tr=>{
    if(tr.children.length>1) tr.firstElementChild.setAttribute("contenteditable","false");
  });
  el.focus({preventScroll:true});
  const d=f.contentDocument;
  // Put the caret where the pointer was, like any editor — selecting the whole
  // field meant your first keystroke replaced everything you had written.
  const pos=at&&d.caretRangeFromPoint
    ? d.caretRangeFromPoint((at.x-f.getBoundingClientRect().left)/(parseFloat(getComputedStyle($("mlStage")).getPropertyValue("--s"))||1),
                            (at.y-f.getBoundingClientRect().top)/(parseFloat(getComputedStyle($("mlStage")).getPropertyValue("--s"))||1))
    : null;
  const sel=d.getSelection(); sel.removeAllRanges();
  if(pos&&el.contains(pos.startContainer)) sel.addRange(pos);
  else { const r=d.createRange(); r.selectNodeContents(el); sel.addRange(r); }
  el.addEventListener("paste",IE.onPaste=(e)=>{                 // strip formatting
    e.preventDefault();
    const t=(e.clipboardData||window.clipboardData).getData("text/plain").replace(/\s+/g," ");
    d.execCommand("insertText",false,t);
  });
  el.addEventListener("keydown",IE.onKey=(e)=>{
    // ⌘/Ctrl B·I·U — but only where the renderer parses markers, or the shortcut
    // would quietly format text the mail prints without it.
    if((e.metaKey||e.ctrlKey)&&/^[biu]$/i.test(e.key)){
      e.preventDefault();
      if(IE.rich) mlTbApply(e.key.toLowerCase());
      else toast("This field is plain text — formatting would print as characters");
      return;
    }
    // ⌘/Ctrl+A selects THIS field's text, not the whole page — so "select all and
    // retype" works. Without it the browser could escape the contenteditable and
    // select the studio chrome behind the iframe.
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="a"){
      e.preventDefault();
      const r=d.createRange(); r.selectNodeContents(el);
      const s=d.getSelection(); s.removeAllRanges(); s.addRange(r);
      return;
    }
    // Escape COMMITS, like blur and ⌘Enter — the reflexive "get out" key must not
    // throw away everything typed. The toolbar's ✕ is the explicit discard.
    if(e.key==="Escape"){ e.preventDefault(); mlEditEnd(true); }
    // One gesture finishes an edit whatever the field is, because Enter no
    // longer can — the toolbar's ✓ says this.
    else if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); mlEditEnd(true); }
    // Enter is an ordinary line break wherever the field can hold one. Inside a
    // list the browser's own Enter already adds the next point, so that path is
    // left exactly as it was. On a genuinely single-line field — a heading, a
    // button label — there is nowhere for a break to go, so Enter commits.
    else if(e.key==="Enter"&&!e.shiftKey&&!isListPath(IE.ed)){
      e.preventDefault();
      if(!mlMultiline(IE.ed)){ mlEditEnd(true); return; }
      // An explicit <br>, not the browser's default block split: the host here
      // is the mail's own <td>/<span>, and splitting THAT would drop half the
      // copy outside the region being edited. htmlToMarkers maps <br> to \n,
      // which is what the renderer splits paragraphs on.
      if(!d.execCommand("insertLineBreak")) d.execCommand("insertHTML",false,"<br>");
      mlFit(); mlTbPlace(el);
    }
  });
  el.addEventListener("blur",IE.onBlur=()=>mlEditEnd(true));
  el.addEventListener("input",IE.onInput=()=>{ mlFit(); mlTbPlace(el); });
  // A link inside the copy is content. With the iframe live for editing, a plain
  // click on one would otherwise navigate the preview away from the mail.
  el.addEventListener("click",IE.onClick=(ev)=>{ if(ev.target.closest("a")) ev.preventDefault(); });
  mlTbShow(el,IE.rich);                           // the toolbar rides above the text
  mlPanelEditing(true);                           // one source of truth: hide the stale panel copy
  if(Math.round(stage.scrollTop)!==Math.round(keepTop)) stage.scrollTop=keepTop;   // see the note at the top
  mlStatus();
}
/* Dual-editor de-sync fix: while a field is edited IN the mail, its copy in the
   docked panel would sit showing the pre-edit value — two sources of truth. Hide
   just that field (label kept, so it's clear which one) and say where the value
   lives now. On commit the panel is rebuilt fresh; on cancel we restore here. */
function mlPanelEditing(on){
  const host=$("mlProps"); if(!host)return;
  host.querySelectorAll(".fld.editing-canvas").forEach(w=>{
    w.classList.remove("editing-canvas"); const n=w.querySelector(".ce-note"); if(n)n.remove();
  });
  if(!on||!IE.ed) return;
  const key=(String(IE.ed).split("|")[1]||"").split("#")[0].split(".")[0];
  if(!key) return;
  const wrap=[...host.querySelectorAll(".fld")].find(w=>w.dataset.fkey===key);
  if(!wrap) return;
  wrap.classList.add("editing-canvas");
  const note=document.createElement("div"); note.className="ce-note hint";
  note.textContent="Editing in the mail — your changes show here when you're done.";
  wrap.appendChild(note);
}
function mlEditEnd(commit){
  const el=IE.el; if(!el)return;
  mlPanelEditing(false);                          // restore the panel field (commit rebuilds it anyway)
  const f=$("mlFrame"), ov=$("mlOv"), ed=IE.ed;
  const txt=commit?mlEditValue(el):null;
  const before=IE.before;
  el.removeEventListener("paste",IE.onPaste); el.removeEventListener("keydown",IE.onKey);
  el.removeEventListener("blur",IE.onBlur); el.removeEventListener("input",IE.onInput);
  el.removeEventListener("click",IE.onClick);
  el.removeAttribute("contenteditable"); el.style.outline=""; el.style.outlineOffset=""; el.style.boxShadow="";
  el.querySelectorAll('[contenteditable="false"]').forEach(x=>x.removeAttribute("contenteditable"));
  IE.el=null; IE.ed=null; IE.dirty=false; IE.rich=false; mlTbHide();
  f.style.pointerEvents="none"; ov.style.display="";
  if(commit&&txt!==null&&txt!==String(before??"")){ mlSetProp(ed,txt); MD.dirty=true; mlProps(); mlRender(0); }
  // Escape, or an edit that changed nothing: re-render so the element goes back
  // to exactly what the stored value renders as, marks and all.
  else mlRender(0);
}
/* Clicking the floating toolbar does not blur the iframe on every platform, and
   clicking anywhere else should finish the edit — blur alone was not enough once
   the toolbar became the only chrome. */
document.addEventListener("mousedown",(e)=>{
  if(!IE.el)return;
  if(e.target.closest("#mlTB")||e.target.closest("#mlFrame"))return;
  mlEditEnd(true);
},true);
/* The canvas has no second editor. Prose used to open a Quill panel floating
   over the copy; now every field is edited in the mail itself (mlEditStart), and
   the only chrome is the toolbar that rides above the element. richtext.js and
   mountRich stay — the SETTINGS PANEL still uses Quill, and its round-trip is
   pinned by the formatting suite. */

/* Find the editable element under a point on the overlay and start editing it. */
function mlEditAt(clientX,clientY){
  const f=$("mlFrame"), d=f.contentDocument; if(!d)return false;
  const fr=f.getBoundingClientRect();
  const sc=(parseFloat(getComputedStyle($("mlStage")).getPropertyValue("--s"))||1);
  const el=d.elementFromPoint((clientX-fr.left)/sc,(clientY-fr.top)/sc);
  const t=el&&el.closest&&el.closest("[data-ed]");
  if(!t)return false;
  if(IE.el===t) return true;                       // already editing this very element
  // EVERY field edits in place, in the mail itself. Prose used to open a Quill
  // panel floating over the canvas, which meant the thing you typed into was
  // never the thing you were looking at.
  mlEditStart(t,{x:clientX,y:clientY}); return true;
}
function mlSelect(id,o){
  MD.sel=id; mlProps(); mlOverlay();
  // Clicking a section IN the canvas must never move the canvas — you are already
  // looking at it. Only picking one from the structure list scrolls, and then the
  // block goes to the TOP of the view: aligning its bottom to the bottom edge felt
  // like being thrown down the page.
  if(o&&o.reveal) mlReveal(id);
  mlInspector();
}
/* Bring a block into view when it is selected from the list — and leave the canvas
   alone when it is already visible. The block's own rect lives in the IFRAME's
   coordinates (the frame is full-height and never scrolls itself, the stage does),
   and the frame is CSS-scaled, so comparing it against the stage viewport sent every
   click hundreds of pixels down the page. The overlay hotspot is measured on screen
   in the same space as the stage, so the two are directly comparable. */
function mlReveal(id){
  const stage=$("mlStage"), hot=$("mlOv").querySelector(`.ml-hot[data-id="${id}"]`);
  if(!stage||!hot)return;
  const sr=stage.getBoundingClientRect(), hr=hot.getBoundingClientRect(), pad=24;
  const fullyVisible=hr.top>=sr.top+pad&&hr.bottom<=sr.bottom-pad;
  if(fullyVisible) return;
  // one move, always the same: the block's top sits just under the stage's top edge
  stage.scrollTop=Math.max(0,Math.min(stage.scrollHeight,stage.scrollTop+(hr.top-(sr.top+pad))));
}
/* There is no click-to-nudge any more. Sections are arranged by dragging them
   on the canvas (startBlockDrag), which is the only place their order is
   legible — a pair of arrows moved a block one step and told you nothing about
   where it would end up. */
function mlDup(id){
  const i=blockIndex(id); if(i<0)return;
  const copy=JSON.parse(JSON.stringify(MD.doc.blocks[i]));
  copy.id="b"+Math.random().toString(36).slice(2,10);
  MD.doc.blocks.splice(i+1,0,copy); MD.dirty=true; MD.sel=copy.id; mlProps(); mlRender(0);
}
function mlDel(id){
  const i=blockIndex(id); if(i<0)return;
  MD.doc.blocks.splice(i,1); MD.dirty=true; if(MD.sel===id)MD.sel=null;
  mlProps(); mlRender(0);
}
/* palette popover */
function mlPalette(at,e){
  if(e)e.stopPropagation();
  MD.insertAt=at;
  const pop=$("mlPop");
  pop.classList.add("on");
  if(e&&e.clientX){
    const w=300, x=Math.min(Math.max(12,e.clientX-w/2), window.innerWidth-w-12);
    pop.style.left=x+"px";
    pop.style.top=Math.min(e.clientY+14, window.innerHeight-380)+"px";
  }else{ pop.style.left="228px"; pop.style.top="112px"; }
}
function mlPopClose(){ $("mlPop").classList.remove("on"); }
async function mlAdd(type,dropAt){
  if(!MD.doc)return;
  mlPopClose();
  if(dropAt!=null) MD.insertAt=dropAt;              // dropped at a chosen position
  const r=await api("/api/mailer/block",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,type})});
  if(!r.ok){ toast("Could not add that block"); return; }
  const { block }=await r.json();
  const at=MD.insertAt!=null?MD.insertAt:(MD.sel?blockIndex(MD.sel)+1:MD.doc.blocks.length);
  MD.doc.blocks.splice(at,0,block);
  MD.insertAt=null; MD.dirty=true; MD.sel=block.id;
  // Bring the new section into view once it has rendered — a block added below the
  // fold otherwise lands off-screen and reads as "nothing happened". mlMount reveals
  // it after the overlay hotspot exists (see the reveal in mlMount's onload).
  MD.revealNext=block.id;
  mlProps(); mlRender(0);
  toast(`${BS[type]?.label||type} added`);
}

/* ---------- settings panel (schema-driven) ---------- */
/* Wireframes for the layout choices. A dropdown labelled "Tinted panel, divided"
   tells you nothing until you try it; these show the shape at a glance. Drawn as
   inline SVG so there are no image requests and they inherit the UI accent. */
const TH_W=64, TH_H=44;
function thumbSvg(kind){
  const A="var(--accent)", L="#c9ccd6", F="#eef0f5", T="#9aa0ae";
  const box=(x,y,w,h,fill,r=2)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
  const ln=(x,y,w,c=L,h=2.5)=>box(x,y,w,h,c,1.2);
  const circ=(cx,cy,r,fill)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  const g=(inner)=>`<svg viewBox="0 0 ${TH_W} ${TH_H}" width="${TH_W}" height="${TH_H}" aria-hidden="true">${box(0,0,TH_W,TH_H,"#fff",3)}<rect x=".5" y=".5" width="${TH_W-1}" height="${TH_H-1}" rx="3" fill="none" stroke="#e3e5ec"/>${inner}</svg>`;
  const map={
    // speaker layouts
    "speakers.cards": [0,1,2].map(i=>box(5+i*19,8,15,20,F)+box(5+i*19,29,15,3,A,1)+ln(5+i*19,34,11)).join(""),
    "speakers.circle":[0,1,2,3].map(i=>circ(11+i*14,17,6,F)+ln(7+i*14,27,9)).join(""),
    "speakers.feature":[0,1].map(i=>box(6+i*28,7,24,22,F)+box(6+i*28,30,24,7,A,1)).join(""),
    "speakers.rows":[0,1].map(i=>box(5+i*29,10,10,10,F)+ln(17+i*29,11,11)+ln(17+i*29,16,8)+box(5+i*29,25,26,10,F)).join(""),
    "speakers.tiles":[0,1].map(i=>box(6+i*28,9,24,12,A)+box(6+i*28,24,24,12,A)).join(""),
    // stat layouts
    "stats.band": box(5,15,54,15,F)+[0,1,2,3].map(i=>ln(8+i*13,19,8,A)+ln(8+i*13,24,7,T,2)).join("")+[1,2,3].map(i=>box(5+i*13.5,17,.7,11,L,0)).join(""),
    "stats.boxes":[0,1,2,3].map(i=>box(5+i*14,14,12,17,F)+ln(7+i*14,18,8,A)+ln(7+i*14,24,7,T,2)).join(""),
    "stats.panel": box(5,11,54,23,F,3)+[0,1,2,3].map(i=>ln(8+i*13,17,8,A)+ln(8+i*13,23,7,T,2)).join(""),
    "stats.solid": box(5,14,54,17,A,3)+[0,1,2,3].map(i=>ln(8+i*13,19,8,"#fff")+ln(8+i*13,25,7,"rgba(255,255,255,.65)",2)).join(""),
    "stats.plain":[0,1,2,3].map(i=>ln(8+i*13,17,8,A)+ln(8+i*13,24,7,T,2)).join(""),
    "stats.rules":[0,1,2,3].map(i=>ln(8+i*13,16,8,A)+ln(8+i*13,22,7,T,2)+box(7+i*13,28,10,1.6,A,0)).join(""),
    // list layouts
    "bullets.plain":[0,1,2].map(i=>ln(6,12+i*9,3,T)+ln(12,12+i*9,44)).join(""),
    "bullets.ticks":[0,1,2].map(i=>ln(6,12+i*9,3,A)+ln(12,12+i*9,44)).join(""),
    "bullets.two":[0,1,2].map(i=>ln(6,12+i*9,3,A)+ln(11,12+i*9,18)+ln(35,12+i*9,3,A)+ln(40,12+i*9,18)).join(""),
    "bullets.panel": box(5,8,54,28,F,3)+[0,1,2].map(i=>ln(9,14+i*8,3,A)+ln(14,14+i*8,40)).join(""),
    "bullets.panelTwo": box(5,8,54,28,F,3)+[0,1,2].map(i=>ln(9,14+i*8,3,A)+ln(13,14+i*8,16)+ln(34,14+i*8,3,A)+ln(38,14+i*8,16)).join(""),
    "bullets.numbered":[0,1,2].map(i=>circ(8,13+i*9,3,A)+ln(14,12+i*9,42)).join(""),
    "bullets.cards":[0,1].map(i=>box(5+i*28,10,26,12,F)+ln(8+i*28,15,18)).join("")+[0,1].map(i=>box(5+i*28,25,26,12,F)+ln(8+i*28,30,18)).join(""),
    "bullets.tiles":[0,1].map(i=>box(6+i*28,9,24,12,A)+box(6+i*28,24,24,12,A)).join(""),
    // agenda layouts
    "sessions.cards":[0,1,2].map(i=>box(5,8+i*12,54,10,F)+ln(8,11+i*12,7,A,2)+ln(8,15+i*12,34)).join(""),
    "sessions.timeline":[0,1,2].map(i=>ln(6,11+i*12,10,T,2)+circ(21,12+i*12,2.6,A)+(i<2?box(20.4,15+i*12,1,9,L,0):"")+ln(27,10+i*12,30)+ln(27,15+i*12,20,L,2)).join(""),
    "sessions.table":[0,1,2].map(i=>ln(6,11+i*12,13,A,2)+ln(24,10+i*12,34)+ln(24,15+i*12,24,L,2)+(i?box(5,6+i*12,54,.8,L,0):"")).join(""),
    "sessions.tiles":[0,1].map(i=>box(6+i*28,9,24,12,F)+ln(9+i*28,12,6,A,2)+ln(9+i*28,16,16)).join("")+[0,1].map(i=>box(6+i*28,24,24,12,F)+ln(9+i*28,27,6,A,2)+ln(9+i*28,31,16)).join(""),
    "sessions.numbered":[0,1,2].map(i=>ln(6,11+i*12,4,A,3)+ln(14,10+i*12,44)+ln(14,15+i*12,30,L,2)+(i?box(5,6+i*12,54,.8,L,0):"")).join(""),
    // partner layouts
    "sponsors.cards":[0,1,2].map(i=>box(5+i*19,12,15,18,"#fff")+`<rect x="${5+i*19}.5" y="12.5" width="14" height="17" rx="2" fill="none" stroke="${L}"/>`+ln(8+i*19,19,9,T)).join(""),
    "sponsors.bordered":[0,1,2].map(i=>`<rect x="${5+i*19}.5" y="12.5" width="14" height="17" rx="2" fill="none" stroke="${L}"/>`+ln(8+i*19,19,9,T)).join(""),
    "sponsors.plain":[0,1,2].map(i=>ln(7+i*19,20,11,T,4)).join(""),
    "sponsors.strip":[0,1,2,3,4].map(i=>ln(5+i*11.5,20,9,T,4)).join(""),
  };
  return g(map[kind]||ln(8,20,48));
}
function fldThumbs(f,blockType,val,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  const cur=String(val ?? f.default ?? (f.options?.[0]?.value||""));
  wrap.innerHTML=`<label>${escapeHtml(f.label)}</label>
    <div class="thgrid">${(f.options||[]).map(o=>`
      <button type="button" class="thopt${String(o.value)===cur?" on":""}" data-v="${escapeHtml(o.value)}" title="${escapeHtml(o.label)}">
        ${thumbSvg(blockType+"."+o.value)}<span>${escapeHtml(o.label)}</span></button>`).join("")}</div>
    ${f.hint?`<div class="hint">${escapeHtml(f.hint)}</div>`:""}`;
  wrap.querySelectorAll(".thopt").forEach(btn=>btn.addEventListener("click",()=>{
    wrap.querySelectorAll(".thopt").forEach(x=>x.classList.remove("on"));
    btn.classList.add("on"); onchange(btn.dataset.v);
  }));
  return wrap;
}
/* Formatting bar for copy fields. Buttons wrap the selection in the same inline
   markers the renderer understands (**bold**, *italic*, __underline__, ~~strike~~,
   ==highlight==, [label](url)), so what you press is what the mail shows — no
   contentEditable, no HTML pasted into a field that must stay email-safe.
   Cmd/Ctrl+B / I / U work too. */
const FBAR=[
  {k:"b",m:"**",label:"B",title:"Bold  (⌘B)",css:"font-weight:800"},
  {k:"i",m:"*",label:"I",title:"Italic  (⌘I)",css:"font-style:italic"},
  {k:"u",m:"__",label:"U",title:"Underline  (⌘U)",css:"text-decoration:underline"},
  {k:"s",m:"~~",label:"S",title:"Strikethrough",css:"text-decoration:line-through"},
  {k:"h",m:"==",label:"H",title:"Highlight",css:"background:var(--accent-soft);color:var(--accent);border-radius:3px"},
  {k:"a",m:null,label:"↗",title:"Link",css:""},
  {k:"x",m:null,label:"⌫",title:"Clear formatting",css:"color:var(--soft)"},
];
function fmtApply(el,btn,onchange){
  const v=el.value, a=el.selectionStart, z=el.selectionEnd;
  const sel=v.slice(a,z);
  let out, caret;
  if(btn.k==="x"){
    const clean=(sel||v).replace(/(\*\*|__|~~|==|\*)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1");
    if(sel){ out=v.slice(0,a)+clean+v.slice(z); caret=a+clean.length; }
    else { out=clean; caret=clean.length; }
  } else if(btn.k==="a"){
    const url=prompt("Link URL","https://");
    if(!url) return;
    const label=sel||"link text";
    out=v.slice(0,a)+`[${label}](${url})`+v.slice(z); caret=a+label.length+url.length+4;
  } else {
    const m=btn.m;
    // keep the markers hugging the words: whitespace the user happened to include
    // in the selection stays outside them
    const lead=(sel.match(/^\s+/)||[""])[0], tail=(sel.match(/\s+$/)||[""])[0];
    const core=sel.trim();
    if(core){
      const A=a+lead.length, Z=z-tail.length, inner2=core;
      const wrapped2=v.slice(Math.max(0,A-m.length),A)===m&&v.slice(Z,Z+m.length)===m;
      const out2=wrapped2
        ? v.slice(0,A-m.length)+inner2+v.slice(Z+m.length)
        : v.slice(0,A)+m+inner2+m+v.slice(Z);
      el.value=out2;
      const c2=wrapped2?A-m.length+inner2.length:A+m.length+inner2.length;
      el.setSelectionRange(c2,c2); el.focus(); onchange(out2); return;
    }
    const inner=sel||"text";
    // pressing the same button on already-marked text takes the marks off
    const wrapped=v.slice(Math.max(0,a-m.length),a)===m&&v.slice(z,z+m.length)===m;
    if(wrapped){ out=v.slice(0,a-m.length)+inner+v.slice(z+m.length); caret=a-m.length+inner.length; }
    else { out=v.slice(0,a)+m+inner+m+v.slice(z); caret=a+m.length+inner.length; }
  }
  el.value=out;
  el.setSelectionRange(caret,caret); el.focus();
  onchange(out);
}
function fmtBar(el,onchange){
  const bar=document.createElement("div"); bar.className="fbar";
  bar.innerHTML=FBAR.map(x=>`<button type="button" data-k="${x.k}" title="${escapeHtml(x.title)}" style="${x.css}">${x.label}</button>`).join("")
    +`<span class="fhint">selection · markdown</span>`;
  bar.querySelectorAll("button").forEach(btn=>btn.addEventListener("mousedown",(e)=>{
    e.preventDefault();                                     // keep the field's selection
    fmtApply(el,FBAR.find(x=>x.k===btn.dataset.k),onchange);
  }));
  el.addEventListener("keydown",(e)=>{
    if(!(e.metaKey||e.ctrlKey))return;
    const k=e.key.toLowerCase(), hit=FBAR.find(x=>x.k===k&&x.m);
    if(!hit)return;
    e.preventDefault(); fmtApply(el,hit,onchange);
  });
  return bar;
}
/* Which fields get the bar: the ones whose renderer parses inline markup, which
   the field declares with `rich` (see Field in blocks.ts). Never by field name —
   that let a new field called `title` inherit a bar its renderer would print as
   literal `**bold**`, and a differently named one go without. */
/** Long prose gets a real editor; short single-line fields keep the marker bar.
 *  Falls back to the plain textarea if Quill or the converter failed to load —
 *  a broken asset must not cost you the ability to edit copy. */
const richOk=()=>!!(window.Quill&&window.RichText);
const isRich=(f)=>f.type==="textarea"&&!!f.rich&&richOk();

/** Mount Quill over a field, converting to/from the marker text it stores. */
function mountRich(host,val,onchange){
  const q=new Quill(host,{
    theme:"snow",
    placeholder:"Write the copy…",
    // Exactly the marks inlineCopy() renders. Offering a control the mail can't
    // show would drop formatting silently between here and the inbox.
    formats:["bold","italic","underline","strike","background","link"],
    modules:{toolbar:[["bold","italic","underline","strike"],[{background:[window.RichText.HILITE]}],["link"],["clean"]]},
  });
  q.setContents({ops:window.RichText.markersToDelta(val??"")},"silent");
  q.on("text-change",()=>onchange(window.RichText.deltaToMarkers(q.getContents().ops)));
  host.__quill=q;
  return q;
}
/** Read/write a field control without caring which kind it is. */
function fldGet(el){ return el&&el.__quill?window.RichText.deltaToMarkers(el.__quill.getContents().ops):(el?el.value:""); }
function fldSet(el,text){
  if(!el)return;
  if(el.__quill) el.__quill.setContents({ops:window.RichText.markersToDelta(text??"")},"silent");
  else el.value=text??"";
}
function fldBusy(el,on){
  if(!el)return;
  if(el.__quill) el.__quill.enable(!on);
  else el.disabled=on;
}

/** Hex colour control. The value IS a hex string — the picker is only a way to
 *  produce one, and it writes straight into the field. Empty means "inherit the
 *  mailer accent". Input is normalised (with or without #, 3 or 6 digits), and
 *  the readout shows the label colour the renderer will derive plus its contrast,
 *  so the AA guarantee in house rule 5 is visible rather than implied. */
const hexNorm=(v)=>{ let h=String(v||"").trim().replace(/^#/,"");
  if(/^[0-9a-f]{3}$/i.test(h)) h=h.split("").map(c=>c+c).join("");
  return /^[0-9a-f]{6}$/i.test(h) ? "#"+h.toLowerCase() : ""; };
const relLum=(hex)=>{ const h=hexNorm(hex).slice(1);
  const v=[0,2,4].map(i=>{const c=parseInt(h.substr(i,2),16)/255; return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)});
  return .2126*v[0]+.7152*v[1]+.0722*v[2]; };
const ratio=(a,b)=>{ const x=relLum(a),y=relLum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
/** Mirrors readable() on the server: walk the ink toward black/white until AA. */
function derivedInk(bg){
  const mix=(c1,c2,t)=>{const p=(h)=>[1,3,5].map(i=>parseInt(hexNorm(h).slice(1).substr(i-1,2),16));
    const [r1,g1,b1]=p(c1),[r2,g2,b2]=p(c2);
    return "#"+[r1+(r2-r1)*t,g1+(g2-g1)*t,b1+(b2-b1)*t].map(n=>Math.round(n).toString(16).padStart(2,"0")).join("");};
  let fg="#ffffff";
  if(ratio(fg,bg)>=4.5) return fg;
  const towards=relLum(bg)>0.5?"#000000":"#ffffff";
  for(let t=0.12;t<=1.0001;t+=0.12){ const c=mix(fg,towards,t); if(ratio(c,bg)>=4.5) return c; }
  return towards==="#000000"?"#1a1a1a":"#ffffff";
}
function fldColor(f,val,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  const fallback=hexNorm((MD&&MD.palette&&MD.palette.accent)||"")||"#4f46e5";
  const cur=hexNorm(val);
  wrap.innerHTML=`<label>${escapeHtml(f.label)}</label>
    <div class="hexf">
      <span class="chip2" aria-hidden="true"></span>
      <span class="hash">#</span>
      <input type="text" class="hx" spellcheck="false" maxlength="7" placeholder="accent" value="${cur?cur.slice(1):""}">
      <input type="color" class="pk" value="${cur||fallback}" title="Pick a colour">
      <button type="button" class="rst" title="Use the mailer accent">✕</button>
    </div>
    <div class="hexr"></div>
    ${f.hint?`<div class="hint">${escapeHtml(f.hint)}</div>`:""}`;
  const chip=wrap.querySelector(".chip2"), hx=wrap.querySelector(".hx"),
        pk=wrap.querySelector(".pk"), read=wrap.querySelector(".hexr");
  const paint=(v)=>{
    const eff=hexNorm(v)||fallback;
    chip.style.background=eff; pk.value=eff;
    const ink=derivedInk(eff), r=ratio(ink,eff);
    read.innerHTML=`<span class="pv" style="background:${eff};color:${ink}">Register now</span>
      <span class="ok">label ${ink} · ${r.toFixed(1)}:1 ${r>=4.5?"✓ AA":""}</span>
      ${hexNorm(v)?"":`<span class="mut">using the mailer accent</span>`}`;
  };
  const commit=(v)=>{ const n=hexNorm(v); onchange(n); paint(n||""); };
  hx.addEventListener("input",()=>{ const raw=hx.value.replace(/[^0-9a-fA-F]/g,"").slice(0,6);
    if(hx.value!==raw) hx.value=raw;
    if(!raw){ commit(""); return; }
    if(raw.length===3||raw.length===6) commit(raw); else paint(hx.value); });
  pk.addEventListener("input",()=>{ hx.value=pk.value.slice(1); commit(pk.value); });
  wrap.querySelector(".rst").onclick=()=>{ hx.value=""; commit(""); };
  paint(cur);
  return wrap;
}

function fldInput(f,val,onchange,aiWhat){
  const id="f_"+Math.random().toString(36).slice(2,9);
  const ai=aiWhat?`<span class="ai" onclick="mlAiField('${aiWhat}','${id}')" title="Rewrite with AI">✨</span>`:"";
  let ctl;
  if(f.type==="color") return fldColor(f,val,onchange);
  if(f.type==="icon") return fldIcon(f,val,onchange);
  if(isRich(f)) ctl=`<div id="${id}" class="rt"></div>`;
  else if(f.type==="textarea") ctl=`<textarea id="${id}">${escapeHtml(val??"")}</textarea>`;
  else if(f.type==="select") ctl=`<select id="${id}">${(f.options||[]).map(o=>`<option value="${escapeHtml(o.value)}" ${String(val)===String(o.value)?"selected":""}>${escapeHtml(o.label)}</option>`).join("")}</select>`;
  else if(f.type==="number") ctl=`<input id="${id}" type="number" value="${escapeHtml(val??"")}">`;
  else ctl=`<input id="${id}" type="text" value="${escapeHtml(val??"")}" ${f.type==="url"?'placeholder="https://…"':""}>`;
  const wrap=document.createElement("div"); wrap.className="fld";
  wrap.innerHTML=`<label>${escapeHtml(f.label)}${ai}</label>${ctl}${f.hint?`<div class="hint">${escapeHtml(f.hint)}</div>`:""}`;
  const el=wrap.querySelector("#"+id);
  if(isRich(f)){ mountRich(el,val,onchange); return wrap; }
  const fire=()=>onchange(f.type==="number"?(el.value===""?"":Number(el.value)):el.value);
  el.addEventListener("input",fire); el.addEventListener("change",fire);
  // Single-line copy fields keep the marker bar — a full editor on a one-line
  // heading is more chrome than it earns.
  if((f.type==="textarea"||f.type==="text")&&f.rich)
    el.parentNode.insertBefore(fmtBar(el,(v)=>onchange(v)),el);
  return wrap;
}
/* ================= the `icon` field kind =================
   CONTRACT: the stored value is a plain URL string, exactly as the `url` kind it
   replaces. Nothing about the document, the renderer or a saved version changes —
   only how a sender produces the string. Empty means "no icon", which every
   renderer already handles by printing the tile's words without one.

   The library lives behind /api/icons; a portal's uploads are listed beside the
   house set. That endpoint is allowed to be absent (older deployment, or the
   route not shipped yet) — the picker then says so and the popover still offers
   the paste box and Clear, so the control can never be a dead end. */
const ICONS={ key:null, loaded:false, loading:null, house:[], uploaded:[], err:"" };
/** The app's escapeHtml leaves quotes alone, which is fine for text but not for a
 *  URL going into an attribute — these strings come from the server and from
 *  whatever the sender typed. */
const attrEsc=(s)=>escapeHtml(s).replace(/"/g,"&quot;");
/** The house list's exact shape is the server's to choose. Accept an array of
 *  URLs, an array of objects, or a name→url map, and ignore anything without a
 *  usable url rather than rendering a broken tile. */
function iconsNorm(v){
  const out=[];
  const push=(o,fallbackName)=>{
    if(!o||typeof o!=="object")return;
    const url=String(o.url||o.href||o.src||"").trim();
    if(!url)return;
    const name=String(o.name||o.label||o.title||fallbackName||url.split("/").pop()||"icon").replace(/\.(png|jpe?g|gif|webp|svg)$/i,"");
    out.push({ id:o.id!=null?String(o.id):"", name, url, bytes:Number(o.bytes)||0, at:Number(o.at)||0 });
  };
  if(Array.isArray(v)) v.forEach(x=>typeof x==="string"?push({url:x}):push(x));
  else if(v&&typeof v==="object") Object.entries(v).forEach(([k,x])=>typeof x==="string"?push({url:x},k):push(x,k));
  return out;
}
async function iconsLoad(force){
  const key=String(S.portal||"");
  if(!force&&ICONS.loaded&&ICONS.key===key) return ICONS;
  if(!force&&ICONS.loading&&ICONS.key===key) return ICONS.loading;
  ICONS.key=key;
  ICONS.loading=(async()=>{
    try{
      const r=await fetch(`/api/icons?portal=${encodeURIComponent(key)}`);
      if(!r.ok) throw new Error(r.status===404?"the icon library isn’t available on this server":`icon library returned ${r.status}`);
      const j=await r.json();
      ICONS.house=iconsNorm(j&&j.house); ICONS.uploaded=iconsNorm(j&&j.uploaded); ICONS.err="";
    }catch(err){
      ICONS.house=[]; ICONS.uploaded=[]; ICONS.err=String(err&&err.message||err);
    }
    ICONS.loaded=true; ICONS.loading=null;
    return ICONS;
  })();
  return ICONS.loading;
}
async function iconsUpload(file){
  const r=await fetch(`/api/icons?portal=${encodeURIComponent(String(S.portal||""))}&name=${encodeURIComponent(file.name||"icon")}`,
    {method:"POST",body:file});
  if(!r.ok) throw new Error(`upload failed (${r.status})`);
  const j=await r.json().catch(()=>({}));
  const url=String(j&&j.url||"").trim();
  if(!url) throw new Error("upload returned no URL");
  await iconsLoad(true);
  // Trust the POST over the listing: if the fresh listing hasn't caught up, the
  // picker must still show what was just uploaded rather than losing it.
  if(!ICONS.uploaded.some(x=>x.url===url))
    ICONS.uploaded=[{id:String(j.id??""),name:String(j.name||file.name||"icon").replace(/\.[a-z0-9]+$/i,""),url,bytes:file.size||0,at:Date.now()}].concat(ICONS.uploaded);
  return url;
}
async function iconsDelete(id){
  const r=await fetch(`/api/icons/${encodeURIComponent(id)}?portal=${encodeURIComponent(String(S.portal||""))}`,{method:"DELETE"});
  if(!r.ok) throw new Error(`could not remove that icon (${r.status})`);
  await iconsLoad(true);
}

/* One popover, ever. The control sits in a repeatable LIST, so several rows each
   carry one: keeping a single floating panel keyed to the button that opened it
   means opening row 3's picker cannot touch row 1's markup, and there is no way
   to end up with two open. It hangs off document.body rather than the settings
   panel because .ml-props scrolls and would clip it. */
const ICP={ el:null, anchor:null, get:null, set:null, q:"", busy:false };
function iconPopClose(){
  if(ICP.el) ICP.el.remove();
  ICP.el=null; ICP.anchor=null; ICP.get=null; ICP.set=null; ICP.q=""; ICP.busy=false;
}
function iconPopOpen(anchor,get,set){
  const again=ICP.anchor===anchor;
  iconPopClose();
  if(again) return;                                    // the button toggles
  ICP.anchor=anchor; ICP.get=get; ICP.set=set;
  const el=document.createElement("div"); el.id="icPop"; el.className="icpop";
  el.addEventListener("keydown",(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); iconPopClose(); } });
  document.body.appendChild(el);
  ICP.el=el;
  iconPopPaint(); iconPopPlace();
  iconsLoad().then(()=>{ if(ICP.anchor===anchor){ iconPopPaint(); iconPopPlace(); } });
}
function iconPopPlace(){
  const el=ICP.el, a=ICP.anchor;
  if(!el) return;
  // The panel is rebuilt wholesale on some changes; if the button that opened
  // this went with it, the popover has nothing to belong to.
  if(!a||!document.body.contains(a)){ iconPopClose(); return; }
  const r=a.getBoundingClientRect(), w=el.offsetWidth||296, h=el.offsetHeight||300, gap=6;
  let left=Math.min(Math.max(8,r.left), window.innerWidth-w-8);
  let top=r.bottom+gap;
  if(top+h>window.innerHeight-8) top=Math.max(8,r.top-gap-h);
  el.style.left=Math.round(left)+"px"; el.style.top=Math.round(top)+"px";
}
function iconPopPaint(){
  const el=ICP.el; if(!el) return;
  const cur=String(ICP.get?ICP.get():"");
  const q=(ICP.q||"").toLowerCase();
  const match=(a)=>a.filter(x=>!q||x.name.toLowerCase().includes(q));
  const house=match(ICONS.house), up=match(ICONS.uploaded);
  const total=ICONS.house.length+ICONS.uploaded.length;
  const tile=(x,rm)=>`<button type="button" class="thopt icopt${x.url===cur?" on":""}" data-u="${attrEsc(x.url)}" title="${attrEsc(x.name)}">
      <img src="${attrEsc(x.url)}" alt="" loading="lazy">
      <span>${escapeHtml(x.name)}</span>
      ${rm&&x.id?`<i class="icrm" data-id="${attrEsc(x.id)}" title="Remove “${attrEsc(x.name)}” from the library">✕</i>`:""}</button>`;
  el.innerHTML=`<div class="hd">Icon
      <span class="sp"></span>
      <span class="ai icup" title="Upload a PNG, JPG, GIF or WebP for this portal">Upload…</span>
      <span class="ai mut icnone" title="No icon on this tile">None</span>
      <span class="ai mut icdone" title="Close">Done</span></div>
    ${total>12?`<div style="padding:9px 11px 0"><input class="mpq icq" placeholder="Filter ${house.length+up.length} of ${total}…" value="${attrEsc(ICP.q||"")}"></div>`:""}
    <div class="mplist">
      ${!ICONS.loaded?`<div class="hint" style="padding:6px">Loading the icon library…</div>`
        :ICONS.err?`<div class="hint" style="padding:6px">The icon library is unavailable — ${escapeHtml(ICONS.err)}. You can still paste a URL below, or clear the icon.</div>`
        :""}
      ${house.length?`<div class="icsec">House icons</div><div class="thgrid">${house.map(x=>tile(x,false)).join("")}</div>`:""}
      ${up.length?`<div class="icsec">Uploaded for ${escapeHtml(S.portalName||S.portal||"this portal")}</div><div class="thgrid">${up.map(x=>tile(x,true)).join("")}</div>`:""}
      ${ICONS.loaded&&!ICONS.err&&!house.length&&!up.length
        ? `<div class="hint" style="padding:6px">${q?"Nothing matches that filter.":"No icons yet — upload one and it appears here for every mailer on this portal."}</div>` : ""}
    </div>
    <div class="ft">
      <input class="icurl" spellcheck="false" placeholder="…or paste an image URL" value="${attrEsc(cur)}">
      <div class="hint">Uploads are stored per portal and reusable. The value saved on the tile is the image URL either way.</div>
    </div>
    <input type="file" class="icfile" accept="image/*" hidden>`;
  const commit=(v)=>{ if(ICP.set) ICP.set(v); };
  el.querySelectorAll(".icopt").forEach(btn=>btn.addEventListener("click",(e)=>{
    if(e.target.closest(".icrm")) return;
    commit(btn.dataset.u); iconPopClose();
  }));
  el.querySelectorAll(".icrm").forEach(x=>x.addEventListener("click",async(e)=>{
    e.preventDefault(); e.stopPropagation();
    const id=x.dataset.id;
    const gone=ICONS.uploaded.find(u=>u.id===id);
    if(!confirm(`Remove “${gone?gone.name:"this icon"}” from the library? Tiles already using it keep their URL.`)) return;
    try{ await iconsDelete(id); toast("Icon removed"); }
    catch(err){ toast(String(err.message||err)); }
    if(ICP.el){ iconPopPaint(); iconPopPlace(); }
  }));
  const q2=el.querySelector(".icq");
  if(q2){
    q2.addEventListener("input",()=>{ ICP.q=q2.value; const at=q2.selectionStart; iconPopPaint();
      const n=ICP.el&&ICP.el.querySelector(".icq"); if(n){ n.focus(); n.setSelectionRange(at,at); } });
  }
  const urlIn=el.querySelector(".icurl");
  urlIn.addEventListener("input",()=>commit(urlIn.value.trim()));
  el.querySelector(".icdone").addEventListener("click",iconPopClose);
  el.querySelector(".icnone").addEventListener("click",()=>{ commit(""); iconPopClose(); });
  const file=el.querySelector(".icfile");
  el.querySelector(".icup").addEventListener("click",()=>{ if(!ICP.busy) file.click(); });
  file.addEventListener("change",async()=>{
    const f=file.files&&file.files[0]; if(!f) return;
    ICP.busy=true;
    const chip=el.querySelector(".icup"); if(chip) chip.textContent="Uploading…";
    try{
      const url=await iconsUpload(f);
      commit(url);
      toast(`Uploaded ${f.name}`);
    }catch(err){ toast(String(err.message||err)); }
    ICP.busy=false;
    if(ICP.el){ iconPopPaint(); iconPopPlace(); }
  });
}
document.addEventListener("mousedown",(e)=>{
  if(!ICP.el||!e.target||!e.target.closest) return;
  if(e.target.closest("#icPop")) return;
  // The anchor itself is left alone so its own click can toggle the popover shut.
  if(ICP.anchor&&(e.target===ICP.anchor||ICP.anchor.contains(e.target))) return;
  iconPopClose();
});
window.addEventListener("resize",()=>iconPopPlace());
window.addEventListener("scroll",()=>iconPopPlace(),true);

/** The control itself: a preview of what is set, a button that opens the picker,
 *  and a clear. Deliberately does NOT rebuild the settings panel when it writes —
 *  the list's other rows, the list's own scroll and #mlProps' scroll all stay
 *  exactly where they were. */
function iconCtl(val,onchange){
  const box=document.createElement("div"); box.className="iconf";
  box.innerHTML=`<span class="ipv"></span>
    <button type="button" class="ipick"></button>
    <button type="button" class="iclr" title="No icon">✕</button>`;
  const pv=box.querySelector(".ipv"), pick=box.querySelector(".ipick"), clr=box.querySelector(".iclr");
  let cur=String(val??"");
  const paint=()=>{
    pv.className="ipv"+(cur?"":" empty");
    pv.innerHTML=cur?`<img alt="">`:"";
    const img=pv.querySelector("img");
    if(img){ img.onerror=()=>pv.classList.add("bad"); img.src=cur; }
    // decodeURIComponent throws on a lone "%", and a label is not worth losing
    // the control over — fall back to the raw tail.
    const tail=cur?(cur.split("/").pop()||cur):"";
    let nice=tail; try{ nice=decodeURIComponent(tail); }catch{}
    nice=nice.replace(/\.[a-z0-9]+$/i,"");
    pick.textContent=cur?nice:"Choose an icon…";
    pick.title=cur?cur:"Pick a house icon, upload your own, or paste a URL";
    clr.style.display=cur?"":"none";
  };
  const commit=(v)=>{ cur=String(v||""); paint(); onchange(cur); };
  pick.addEventListener("click",(e)=>{ e.preventDefault(); e.stopPropagation(); iconPopOpen(pick,()=>cur,commit); });
  clr.addEventListener("click",(e)=>{ e.preventDefault(); e.stopPropagation();
    if(ICP.anchor===pick) iconPopClose();
    commit(""); });
  paint();
  return box;
}
/** Top-level `icon` field (none today; the kind is declared once and rendered
 *  once, so a schema that grows one needs no further front-end code). */
function fldIcon(f,val,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  wrap.innerHTML=`<label>${escapeHtml(f.label)}</label>`;
  wrap.appendChild(iconCtl(val,onchange));
  if(f.hint){ const h=document.createElement("div"); h.className="hint"; h.textContent=f.hint; wrap.appendChild(h); }
  return wrap;
}

function fldList(f,arr,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  wrap.innerHTML=`<label>${escapeHtml(f.label)}</label>`;
  const box=document.createElement("div"); box.className="lst";
  const items=Array.isArray(arr)?arr:[];
  // Rows COLLAPSE by default — a speaker row is name+role+company+photo+bio+3
  // socials, so eight fields per person filled the panel with one entry. A
  // collapsed row is a one-line summary you expand to edit. `open` holds which
  // rows are expanded (by their live object, so a reorder keeps the right ones
  // open); a row the sender just added starts open because they are about to
  // fill it in.
  const open=new Set();
  const fields=(f.itemFields||[]);
  const primary=fields[0];                       // "name" for speakers, "title" for partners
  const summaryOf=(it)=>{
    const v=typeof it==="string"?it:(it?.[primary?.key]??"");
    return String(v||"").trim();
  };
  let dragFrom=null;
  const paint=()=>{
    box.innerHTML="";
    if(ICP.el) iconPopPlace();
    items.forEach((it,i)=>{
      const row=document.createElement("div"); row.className="it"+(open.has(it)?" open":" collapsed");
      const tools=`<div class="rowtools">
        <span class="drag" draggable="true" title="Drag to reorder">⠿</span>
        <button class="mv up" title="Move up" ${i===0?"disabled":""}>↑</button>
        <button class="mv dn" title="Move down" ${i===items.length-1?"disabled":""}>↓</button>
        <button class="rm" title="Remove">✕</button></div>`;
      if(!open.has(it)){
        // Collapsed: a summary line + Edit. Nothing else, so the list stays short.
        const sum=summaryOf(it);
        row.innerHTML=tools+`<div class="rowsum"><b>${sum?escapeHtml(sum):'<span class="faint">Empty row</span>'}</b>
          <button class="edit btn alt sm">Edit</button></div>`;
        row.querySelector(".edit").onclick=()=>{ open.add(it); paint(); };
      } else {
        row.innerHTML=tools;
        fields.forEach(sub=>{
          const cell=document.createElement("div"); cell.className="f";
          const val=typeof it==="string"?it:(it?.[sub.key]??"");
          cell.innerHTML=`<label>${escapeHtml(sub.label)}</label>`;
          const store=(v)=>{
            if(typeof items[i]==="string")items[i]={[sub.key]:v};
            else items[i][sub.key]=v;
            onchange(items);
            // keep the collapsed summary in step if the primary field changes
            if(sub===primary){ const s=row.querySelector(".donesum"); if(s)s.textContent=v||"Empty row"; }
          };
          if(sub.type==="icon"){ cell.appendChild(iconCtl(val,store)); row.appendChild(cell); return; }
          cell.insertAdjacentHTML("beforeend",
            sub.type==="textarea"?`<textarea rows="2">${escapeHtml(val)}</textarea>`:`<input type="text" value="${escapeHtml(val)}">`);
          const el=cell.querySelector("input,textarea");
          el.addEventListener("input",()=>store(el.value));
          row.appendChild(cell);
        });
        const done=document.createElement("button"); done.className="btn ghost sm done"; done.textContent="Done";
        done.onclick=()=>{ open.delete(it); paint(); };
        row.appendChild(done);
      }
      row.querySelector(".rm").onclick=()=>{ open.delete(it); items.splice(i,1); onchange(items); paint(); };
      const up=row.querySelector(".mv.up"), dn=row.querySelector(".mv.dn");
      up.onclick=()=>{ if(i>0){ [items[i-1],items[i]]=[items[i],items[i-1]]; onchange(items); paint(); } };
      dn.onclick=()=>{ if(i<items.length-1){ [items[i+1],items[i]]=[items[i],items[i+1]]; onchange(items); paint(); } };
      // Drag to reorder — only the ⠿ handle starts a drag, so text in an expanded
      // row stays selectable. The row is the drop target.
      const handle=row.querySelector(".drag");
      handle.addEventListener("dragstart",(e)=>{ dragFrom=i; row.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",String(i));}catch{} });
      handle.addEventListener("dragend",()=>{ dragFrom=null; [...box.children].forEach(c=>c.classList.remove("dragging","dropinto")); });
      row.addEventListener("dragover",(e)=>{ if(dragFrom===null)return; e.preventDefault(); e.dataTransfer.dropEffect="move"; row.classList.add("dropinto"); });
      row.addEventListener("dragleave",()=>row.classList.remove("dropinto"));
      row.addEventListener("drop",(e)=>{ e.preventDefault(); row.classList.remove("dropinto");
        if(dragFrom===null||dragFrom===i)return;
        const moved=items.splice(dragFrom,1)[0]; items.splice(i,0,moved); dragFrom=null; onchange(items); paint(); });
      box.appendChild(row);
    });
    const add=document.createElement("button"); add.className="btn alt sm add"; add.textContent="+ Add row";
    add.onclick=()=>{ const o={}; fields.forEach(s=>o[s.key]=""); items.push(o); open.add(o); onchange(items); paint(); };
    box.appendChild(add);
  };
  paint(); wrap.appendChild(box);
  return wrap;
}
/** Dropdown of the event's real speakers/partners; choosing one appends it. */
function fldPicker(f,block,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  const list=(MLA[f.source]||[]);
  const items=Array.isArray(block.props.items)?block.props.items:[];
  const have=new Set(items.map(i=>String(i.name||i.title||"").toLowerCase()));
  const max=Number(block.props.max)>0?Number(block.props.max):null;
  const full=max!==null&&items.length>=max;
  const avail=list.filter(x=>!have.has(String(f.source==="speakers"?x.name:x.title||"").toLowerCase()));
  wrap.innerHTML=`<label>${escapeHtml(f.label)}</label>
    <select ${full||!avail.length?"disabled":""}>
      <option value="">${!MLA.loaded?"Loading…":full?`Limit of ${max} reached`:avail.length?"Choose…":"All already added"}</option>
      ${avail.map((x,i)=>`<option value="${i}">${escapeHtml(f.source==="speakers"?`${x.name} — ${x.company||""}`:`${x.title}${x.tier?" — "+x.tier:""}`)}</option>`).join("")}
    </select>
    ${f.hint?`<div class="hint">${escapeHtml(f.hint)}</div>`:""}`;
  wrap.querySelector("select").addEventListener("change",(e)=>{
    const x=avail[+e.target.value]; if(!x)return;
    items.push(f.source==="speakers"
      ? { name:x.name||"", role:x.designation||"", company:x.company||"", photo:x.photoUrl||"" }
      : { title:x.title||"", logo:x.logoUrl||"", url:x.url||"" });
    onchange(items);
  });
  return wrap;
}
const AI_FIELDS={ text:"body copy", sub:"sub-headline", title:"heading", label:"button label", note:"supporting line", quote:"quote", about:"about paragraph" };

/* Every speaker/partner on THIS event, ticked or not. Replaces the single-shot
   "add one" dropdown: tick to include (up to Max), untick to drop. */
function fldMultipick(f,block,onchange){
  const wrap=document.createElement("div"); wrap.className="fld";
  const list=(MLA[f.source]||[]);
  const spk=f.source==="speakers", ses=f.source==="sessions";
  const items=Array.isArray(block.props.items)?block.props.items:[];
  const nameOf=(x)=>String((spk?x.name:x.title)||"").trim();          // sessions carry a title too
  const keyOf=(v)=>v.toLowerCase();
  const chosen=new Set(items.map(i=>keyOf(String((spk?i.name:i.title)||""))));
  const max=Number(block.props.max)>0?Number(block.props.max):null;
  const full=max!==null&&chosen.size>=max;
  const q=(block.__q||"").toLowerCase();
  const shown=list.filter(x=>!q||`${nameOf(x)} ${spk?(x.company||""):ses?(x.who||""):(x.tier||"")}`.toLowerCase().includes(q));
  // The row a tick stores. Built in one place because "Select all" and the
  // checkbox must put identical shapes in the document — a second copy of this
  // is a second chance for the two to drift.
  const rowOf=(x)=>spk
    ? { name:x.name||"", role:x.designation||"", company:x.company||"", photo:x.photoUrl||"" }
    : ses
      ? { time:x.time||"", title:x.title||"", who:x.who||"" }
      : { title:x.title||"", logo:x.logoUrl||"", url:x.url||"", tier:x.tier||"" };
  // Select all is about what you can SEE: with a filter typed, the rows it hides
  // are not part of the gesture, or the control would quietly pull in people the
  // sender had just filtered out.
  const spare=shown.filter(x=>!chosen.has(keyOf(nameOf(x))));
  const room=max===null?spare.length:Math.max(0,max-chosen.size);
  const allOn=shown.length>0&&spare.length===0;
  const act=allOn?"Clear":"Select all";
  const tip=allOn?`Untick ${q?`the ${shown.length} rows shown`:"every row"}`
    :`Tick ${q?`the ${shown.length} rows shown`:"every row"}${max?`, up to the limit of ${max}`:""}`;
  wrap.innerHTML=`<label>${escapeHtml(f.label)}
      <span class="mpact">
        ${MLA.loaded&&shown.length?`<span class="ai mpall"${!allOn&&!room?' style="opacity:.45"':""} title="${escapeHtml(tip)}">${act}</span>`:""}
        <span class="hint" style="margin:0">${chosen.size}${max?" / "+max:""} selected</span>
      </span></label>
    ${list.length>8?`<input class="mpq" placeholder="Filter ${shown.length} of ${list.length}…" value="${escapeHtml(block.__q||"")}">`:""}
    <div class="mplist">${
      !MLA.loaded ? `<div class="hint" style="padding:8px">Loading this event's ${spk?"speakers":ses?"sessions":"partners"}…</div>`
      : !list.length ? `<div class="hint" style="padding:8px">This event has no ${spk?"speakers":ses?"sessions":"partners"} in the API.</div>`
      : shown.map((x,i)=>{
          const on=chosen.has(keyOf(nameOf(x)));
          const sub=spk?[x.designation,x.company].filter(Boolean).join(", "):ses?[x.time,x.who].filter(Boolean).join(" · "):(x.tier||"");
          return `<label class="mpitem${on?" on":""}">
            <input type="checkbox" data-i="${list.indexOf(x)}" ${on?"checked":""} ${(!on&&full)?"disabled":""}>
            <span class="mptx"><b>${escapeHtml(nameOf(x))}</b>${sub?`<i>${escapeHtml(sub)}</i>`:""}</span></label>`;
        }).join("")
    }</div>
    ${full?`<div class="hint">Limit of ${max} reached — untick one to swap, or raise Max above.</div>`:(f.hint?`<div class="hint">${escapeHtml(f.hint)}</div>`:"")}`;
  const qi=wrap.querySelector(".mpq");
  if(qi) qi.addEventListener("input",(e)=>{ block.__q=e.target.value; const box=wrap.parentNode; mlProps(); setTimeout(()=>{const n=document.querySelector(".mpq"); if(n){n.focus(); n.setSelectionRange(n.value.length,n.value.length);}},0); });
  const mplist=wrap.querySelector(".mplist");
  // Every tick rebuilds the whole panel, so this is a NEW element each time and
  // starts at the top — which threw the sender back to the head of a 157-name
  // roster on every pick. Remember the offset on the block, beside the filter
  // query, and put it back once the fresh list is in the document.
  if(mplist){
    mplist.addEventListener("scroll",()=>{ block.__sc=mplist.scrollTop; },{passive:true});
    if(block.__sc) setTimeout(()=>{ mplist.scrollTop=block.__sc; },0);
  }
  const all=wrap.querySelector(".mpall");
  if(all) all.addEventListener("click",()=>{
    const inShown=new Set(shown.map(x=>keyOf(nameOf(x))));
    if(allOn){ onchange(items.filter(i=>!inShown.has(keyOf(String((spk?i.name:i.title)||""))))); return; }
    // The cap is the document's, not this control's: it may fill the list up to
    // Max and must stop dead there rather than writing rows the mail would drop.
    if(!room){ toast(`Limit of ${max} reached — raise Max above to add more`); return; }
    const take=spare.slice(0,room);
    onchange(items.concat(take.map(rowOf)));
    toast(take.length<spare.length
      ? `Added ${take.length} — the limit of ${max} stops it there`
      : `Added ${take.length}${q?" of the rows shown":""}`);
  });
  wrap.querySelectorAll('.mplist input[type=checkbox]').forEach(cb=>cb.addEventListener("change",()=>{
    const x=list[+cb.dataset.i]; if(!x)return;
    const k=keyOf(nameOf(x));
    let next=items.filter(i=>keyOf(String((spk?i.name:i.title)||""))!==k);
    if(cb.checked) next=next.concat([rowOf(x)]);
    onchange(next);
  }));
  return wrap;
}
/* Every control for a block, built from its schema. Shared by the side panel and
   the on-canvas inspector, so the two can never drift apart. */
function mlFields(host,b){
  const schema=BS[b.type]||{label:b.type,fields:[]};
  if(!schema.fields.length){ const d=document.createElement("div"); d.className="hint"; d.textContent="This block has no settings."; host.appendChild(d); return; }
  // a control that cannot affect the chosen layout is hidden rather than inert
  const shows=(f)=>!f.showWhen||Object.entries(f.showWhen).every(([k,vals])=>{
    const cur=String(b.props[k] ?? (BS[b.type]?.fields||[]).find(x=>x.key===k)?.default ?? "");
    return vals.includes(cur);
  });
  // A multipick's tick limit, its "n / max selected" count and its disabled rows
  // all read `max` when the control is built. Changing `max` only re-renders the
  // preview, so the selection list stayed stale until an unrelated click repainted
  // the panel. Refresh those controls IN PLACE — replacing only the multipick node
  // leaves the Max input untouched, so its focus (and mid-typing) survive.
  const refreshMultipicks=()=>{
    for(const mp of schema.fields) if(mp.type==="multipick"&&shows(mp)){
      const cur=host.querySelector(`[data-fkey="${mp.key}"]`);
      if(cur) cur.replaceWith(buildOne(mp));
    }
  };
  const buildOne=(f)=>{
    const set=(v)=>{ b.props[f.key]=v; MD.dirty=true; mlStatus();
      // A control whose sensible value follows another field resets when that
      // field changes — otherwise "3 per row", picked for photo cards, survives a
      // switch to a layout drawn for two and quietly crowds it.
      for(const dep of schema.fields) if(dep.defaultBy&&dep.defaultBy.on===f.key){
        const d=dep.defaultBy.map[String(v)];
        if(d!==undefined) b.props[dep.key]=String(d);
      }
      // Any field another field's showWhen depends on changes which controls are
      // visible, so repaint the panel. This used to test for the literal key
      // "style", which silently broke the moment a second field (the button's
      // "variant") started driving visibility.
      if(schema.fields.some(x=>x.showWhen&&Object.keys(x.showWhen).includes(f.key))){ mlProps(); mlInspector(); }
      // Changing the cap must update the selection list at once, not on the next
      // unrelated click. Done in place so typing in the Max box is not interrupted.
      else if(f.key==="max"&&schema.fields.some(x=>x.type==="multipick")) refreshMultipicks();
      mlRender(f.type==="select"?0:340); };
    const redraw=(items)=>{ b.props.items=items; MD.dirty=true; mlProps(); mlInspector(); mlRender(0); };
    const fldEl=
      f.type==="list"   ? fldList(f,b.props[f.key],set)
    : f.type==="picker" ? fldPicker(f,b,redraw)
    : f.type==="multipick" ? fldMultipick(f,b,redraw)
    : (f.key==="style"&&f.options) ? fldThumbs(f,b.type,b.props[f.key],set)
    : fldInput(f,b.props[f.key],set,AI_FIELDS[f.key]?`${b.id}.${f.key}.${AI_FIELDS[f.key]}`:null);
    fldEl.dataset.fkey=f.key;                 // so 5b can hide the field being edited in-canvas
    return fldEl;
  };
  for(const f of schema.fields.filter(shows)) host.appendChild(buildOne(f));
  // If a field of THIS block is being edited on the canvas, hide its stale panel
  // copy so there is one source of truth (see mlPanelEditing).
  if(IE.el&&MD.sel===b.id) mlPanelEditing(true);
}

/* The on-canvas inspector: a floating card pinned beside the selected block holding
   that block's complete control set — the same fields as the side panel, plus the
   structural actions. It follows the block, flips to whichever side has room, and can
   be dragged by its header. Toggle with the block toolbar's gear or the I key; the
   side panel stays available and in sync. */
// The floating inspector duplicated the docked settings panel exactly — selecting
// a block filled BOTH. The docked panel is now the single home, so nothing opens
// this any more (the ⚙ trigger was removed); mlInspector() stays a safe no-op while
// INS.open is false, so the many call sites need not change.
const INS={ open:false, drag:null, at:null };
function mlInspector(){
  let box=$("mlIns2");
  const b=MD.sel?MD.doc.blocks[blockIndex(MD.sel)]:null;
  if(!b||!INS.open){ if(box) box.remove(); return; }
  if(!box){
    box=document.createElement("div"); box.id="mlIns2"; box.className="ml-ins2";
    $("mailer").appendChild(box);
    box.addEventListener("mousedown",(e)=>{ if(!e.target.closest(".ins2h"))return;
      INS.drag={x:e.clientX,y:e.clientY,l:box.offsetLeft,t:box.offsetTop}; e.preventDefault(); });
  }
  const schema=BS[b.type]||{label:b.type};
  box.innerHTML=`<div class="ins2h"><span class="i">${schema.icon||"◱"}</span><b>${escapeHtml(schema.label||b.type)}</b>
      <span class="acts">
        <button title="Duplicate" onclick="mlDup('${b.id}')">⧉</button>
        <button title="Delete" onclick="mlDel('${b.id}')">✕</button>
        <button title="Close (I)" class="x" onclick="mlInsToggle()">–</button>
      </span></div>
    <div class="ins2b"></div>
    <div class="ins2f">Click text on the canvas to edit it in place</div>`;
  mlFields(box.querySelector(".ins2b"),b);
  mlInsPlace();
}
function mlInsPlace(){
  const box=$("mlIns2"), hot=MD.sel&&$("mlOv").querySelector(`.ml-hot[data-id="${MD.sel}"]`);
  if(!box) return;
  if(INS.at){ box.style.left=INS.at.l+"px"; box.style.top=INS.at.t+"px"; return; }
  const r=hot?hot.getBoundingClientRect():$("mlStage").getBoundingClientRect();
  const w=box.offsetWidth||320, h=box.offsetHeight||360, gap=12;
  let l=r.right+gap;
  if(l+w>window.innerWidth-8) l=Math.max(8,r.left-gap-w);
  box.style.left=Math.round(l)+"px";
  box.style.top=Math.round(Math.min(Math.max(8,r.top),Math.max(8,window.innerHeight-h-8)))+"px";
}
function mlInsToggle(){ INS.open=!INS.open; INS.at=null; mlInspector(); }
window.addEventListener("mousemove",(e)=>{
  if(!INS.drag)return; const box=$("mlIns2"); if(!box)return;
  INS.at={l:INS.drag.l+(e.clientX-INS.drag.x),t:INS.drag.t+(e.clientY-INS.drag.y)};
  mlInsPlace();
});
window.addEventListener("mouseup",()=>{ INS.drag=null; });
function mlProps(){
  mlHistPush();
  const host=$("mlProps");
  // The panel is rebuilt wholesale after every change, so its own scroll offset
  // goes with the old markup — which threw the sender back to the top of the
  // settings on each tick of a picker halfway down it.
  const keep=host.scrollTop;
  host.innerHTML="";
  // Same reason as in fldList's paint(): the icon picker floats on document.body
  // and is keyed to the button that opened it, which has just been thrown away.
  if(ICP.el) iconPopPlace();
  if(!MD.doc){ host.innerHTML=`<div class="ed-empty"><span class="ic">✉</span>Loading…</div>`; return; }
  const b=MD.sel?MD.doc.blocks[blockIndex(MD.sel)]:null;
  // With nothing selected, LEAD with the mail settings (subject first) instead of
  // an empty "click a block" state — the subject is an email's most important
  // field and should never sit collapsed behind a disclosure on first entry.
  const docOpen=MD.showDocSettings||!b;

  // --- selected block: that's what you're editing ---
  const blockWrap=document.createElement("div");
  const sec=document.createElement("div");
  if(!b){
    sec.innerHTML=`<div class="ph">Block settings</div>
      <div class="ed-empty"><span class="ic">◱</span>Click any block in the preview to edit it.<br>Use <b>+</b> between blocks to insert.</div>`;
  }else{
    const schema=BS[b.type]||{label:b.type,fields:[]};
    sec.innerHTML=`<div class="ph">${schema.icon||""} ${escapeHtml(schema.label)}
      <span class="rowbtns"><button class="btn ghost sm" onclick="mlDup('${b.id}')" title="Duplicate">⧉</button><button class="btn ghost sm" onclick="mlDel('${b.id}')" title="Delete">✕</button></span></div>`;
  }
  blockWrap.appendChild(sec);
  if(b){
    const schema=BS[b.type]||{label:b.type,fields:[]};
    if(!schema.fields.length){ const d=document.createElement("div"); d.className="hint"; d.textContent="This block has no settings."; blockWrap.appendChild(d); }
    mlFields(blockWrap,b);
  }

  // --- mail-level settings + AI, collapsed so they don't crowd the panel ---
  const doc=document.createElement("div");
  // With a block selected these settings are a collapsible disclosure below it;
  // with nothing selected they ARE the panel, so the header is static and open.
  const docHead=b
    ? `<div class="ph mt disc" onclick="mlToggleDocSettings()"><span>Mail settings &amp; AI</span><span>${docOpen?"▾":"▸"}</span></div>`
    : `<div class="ph">Mail settings &amp; AI</div>`;
  doc.innerHTML=`${docHead}
    <div id="mlDocBox" style="display:${docOpen?"":"none"}">
      <div class="fld"><label>Subject line</label><input id="mlSubject" value="${escapeHtml(MD.doc.subject||"")}"></div>
      <div class="fld"><label>Preview text</label><input id="mlPre" value="${escapeHtml(MD.doc.preheader||"")}"></div>
      <div class="fld"><label>Palette</label>
        <select id="mlTheme">
          <option value="site" ${MD.doc.theme==="site"?"selected":""}>Match the event website</option>
          <option value="light" ${MD.doc.theme==="light"?"selected":""}>Light</option>
          <option value="dark" ${MD.doc.theme==="dark"?"selected":""}>Dark</option>
        </select></div>
      <div class="fld"><label>Accent colour</label>
        <div class="clr"><input type="color" id="mlAccentPick" value="${escapeHtml(MD.doc.accent||MAILERS.event?.siteAccent||"#4f46e5")}"><input id="mlAccent" value="${escapeHtml(MD.doc.accent||"")}" placeholder="${escapeHtml(MAILERS.event?.siteAccent||"brand default")}"></div></div>
      <div class="fld"><label>Link tracking</label>
        <select onchange="MD.doc.trackLinks=this.value;MD.dirty=true;mlStatus()">
          <option value="no" ${String(MD.doc.trackLinks??"no")==="no"?"selected":""}>Off — links point straight at the real page</option>
          <option value="yes" ${String(MD.doc.trackLinks??"no")==="yes"?"selected":""}>On — count clicks (links go via this platform)</option>
        </select>
        <div class="hint">Off by default: links go straight to the real page, with no Oneworld address on hover and no click figures. Turning it on sends every link through Oneworld's own address so clicks can be counted — recipients see that address on hover. Opens are counted either way.</div></div>
      <div class="fld"><label>Save button on pictures</label>
        <select onchange="MD.doc.imageGuard=this.value;MD.dirty=true;mlRender(0)">
          <option value="yes" ${String(MD.doc.imageGuard??"yes")!=="no"?"selected":""}>Hide it — pictures sit in an empty anchor</option>
          <option value="no" ${String(MD.doc.imageGuard??"yes")==="no"?"selected":""}>Leave it — no extra markup at all</option>
        </select>
        <div class="hint">Gmail and Outlook.com paint a download button over every large picture. The only thing that stops it is the picture sitting inside a link, so photos with no link of their own get an empty one (<code>href="#"</code>) — it goes nowhere, adds no domain, and the click tracker ignores it, so it does not count towards the URLs in your mail. Your own links are untouched either way.</div></div>
      <div class="fld"><label>Mailer background<span class="ai" onclick="mlSetBg('')" title="Back to the palette default">reset</span></label>
        <div class="sw" id="mlSwatches"></div>
        <div class="clr"><input type="color" id="mlBgPick" value="${escapeHtml(MD.doc.background||mlDefaultBg())}"><input id="mlBg" value="${escapeHtml(MD.doc.background||"")}" placeholder="${escapeHtml(mlDefaultBg())} (palette default)"></div>
        <div class="hint">Applies across the whole mailer. Text, borders and tints adapt to stay readable.</div></div>
      <div class="ml-ai">
        <div class="fld" style="margin:0"><label>AI tone</label>
          <select id="mlTone">${(MAILERS.tones||["professional"]).map(t=>`<option value="${t}" ${MD.tone===t?"selected":""}>${t[0].toUpperCase()+t.slice(1)}</option>`).join("")}</select></div>
        <div class="r">
          <button class="btn alt sm" onclick="mlAiSubjects()">Subject ideas</button>
          <button class="btn alt sm" onclick="mlAiPolish()">Polish copy</button>
        </div>
        <div class="r"><button class="btn sm" style="flex:1;justify-content:center" onclick="mlAiEnhance()">✨ Enhance whole mailer</button></div>
        <div id="mlAiOut"></div>
      </div>
    </div>`;
  // Lead with the subject when nothing is selected; otherwise the block leads.
  if(b){ host.appendChild(blockWrap); host.appendChild(doc); }
  else { host.appendChild(doc); host.appendChild(blockWrap); }
  if(docOpen){
    $("mlTone").onchange=(e)=>MD.tone=e.target.value;
    $("mlSubject").oninput=(e)=>{ MD.doc.subject=e.target.value; MD.dirty=true; mlStatus(); mlRender(700); };
    $("mlPre").oninput=(e)=>{ MD.doc.preheader=e.target.value; MD.dirty=true; mlStatus(); mlRender(700); };
    $("mlTheme").onchange=(e)=>{ MD.doc.theme=e.target.value; MD.dirty=true; mlRender(0); };
    $("mlAccent").oninput=(e)=>{ MD.doc.accent=e.target.value.trim()||undefined; MD.dirty=true; mlRender(450); };
    $("mlAccentPick").oninput=(e)=>{ MD.doc.accent=e.target.value; $("mlAccent").value=e.target.value; MD.dirty=true; mlRender(250); };
    $("mlBg").oninput=(e)=>{ mlSetBg(e.target.value.trim(),true); };
    $("mlBgPick").oninput=(e)=>{ mlSetBg(e.target.value,true); };
    mlSwatches();
  }
  if(keep) host.scrollTop=keep;
}
function mlToggleDocSettings(){ MD.showDocSettings=!MD.showDocSettings; mlProps(); }

/* ---- mailer background: swatches + native picker + hex, all in sync ---- */
const mlDefaultBg=()=>{
  const site=MAILERS?.event?.siteAccent;
  const dark=(MAILERS?.event?.siteTheme||"dark")==="dark";
  if(!MD.doc) return dark?"#0f1220":"#ffffff";
  return MD.doc.theme==="light"?"#ffffff":(MD.doc.theme==="dark"||dark?"#0f1220":"#ffffff");
};
function mlSwatchSet(){
  const site=MAILERS?.event?.siteAccent||"#4f46e5";
  return ["", "#ffffff","#f7f8fa","#f2f6fb","#eef0ff", site, mlMixHex(site,"#000000",.72),"#101427","#000000"];
}
/** Tiny hex blend so the swatch row can offer shades of the event's own colour. */
function mlMixHex(a,b,t){
  const ch=(h)=>{h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");const n=parseInt(h,16)||0;return[(n>>16)&255,(n>>8)&255,n&255];};
  const [r1,g1,b1]=ch(a),[r2,g2,b2]=ch(b);
  const to=(x,y)=>Math.max(0,Math.min(255,Math.round(x+(y-x)*t))).toString(16).padStart(2,"0");
  return "#"+to(r1,r2)+to(g1,g2)+to(b1,b2);
}
function mlSwatches(){
  const host=$("mlSwatches"); if(!host)return;
  host.innerHTML=mlSwatchSet().map(c=>{
    const on=(MD.doc.background||"")===c;
    return c
      ? `<button class="s ${on?'on':''}" style="background:${c}" title="${c}" onclick="mlSetBg('${c}')"></button>`
      : `<button class="s auto ${!MD.doc.background?'on':''}" title="Palette default" onclick="mlSetBg('')">A</button>`;
  }).join("");
}
function mlSetBg(hex,fromInput){
  const v=String(hex||"").trim();
  MD.doc.background=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)?v:undefined;
  MD.dirty=true;
  if(!fromInput){ const t=$("mlBg"), pk=$("mlBgPick"); if(t)t.value=MD.doc.background||""; if(pk)pk.value=MD.doc.background||mlDefaultBg(); }
  mlSwatches(); mlStatus(); mlRender(fromInput?260:0);
}

/* ---------- AI ---------- */
async function mlAi(body){
  const out=$("mlAiOut"); if(out)out.innerHTML=`<div class="hint" style="margin-top:9px"><span class="spin"></span> Thinking…</div>`;
  const r=await api("/api/mailer/ai",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,tone:MD.tone,...body})});
  const j=await r.json().catch(()=>({error:"AI request failed"}));
  // The inline box renders low in the panel — below the fold when the Enhance
  // confirm sits high, so a user saw nothing. ALWAYS toast the message too, so a
  // failure (typically no API key) surfaces regardless of scroll position.
  if(!r.ok){ const msg=j.error||"AI request failed"; if(out)out.innerHTML=`<div class="ml-err">${escapeHtml(msg)}</div>`; toast(msg,5000); return null; }
  if(out)out.innerHTML=""; return j;
}
async function mlAiSubjects(){
  const j=await mlAi({action:"subjects",doc:MD.doc});
  if(!j)return;
  $("mlAiOut").innerHTML=(j.options||[]).map((o,i)=>`
    <div class="ai-opt" onclick="mlUseSubject(${i})">
      <div class="s">${escapeHtml(o.subject)}</div>
      <div class="p">${escapeHtml(o.preheader)}</div>
      <div class="a">${escapeHtml(o.angle||"")}</div>
    </div>`).join("")||`<div class="hint">No suggestions came back.</div>`;
  MD.ai=j.options||[];
}
function mlUseSubject(i){
  const o=(MD.ai||[])[i]; if(!o)return;
  MD.doc.subject=o.subject; MD.doc.preheader=o.preheader; MD.dirty=true;
  const s=$("mlSubject"), p=$("mlPre"); if(s)s.value=o.subject; if(p)p.value=o.preheader;
  mlStatus(); mlRender(0); toast("Subject applied");
}
async function mlAiPolish(){
  if(!await uiConfirm("Polish all copy with AI?","Every copy field in this mailer will be rewritten. Your current wording will be replaced — you can Undo afterwards.",{ok:"Polish copy"}))return;
  const j=await mlAi({action:"polish",doc:MD.doc});
  if(!j)return;
  let n=0;
  for(const it of j.items||[]){
    const [id,field]=String(it.ref).split(".");
    const b=MD.doc.blocks.find(x=>x.id===id);
    if(b&&field&&typeof it.text==="string"){ b.props[field]=it.text; n++; }
  }
  MD.dirty=true; mlProps(); mlRender(0);
  toast(n?`${n} field${n===1?"":"s"} rewritten`:"Nothing changed");
}
/** One-click enhance: rewrites weak copy, drops dead sections, reorders the
 *  story and may set a palette — all from the event's real content. */
async function mlAiEnhance(){
  if(!await uiConfirm("Enhance the whole mailer with AI?","AI will restructure and rewrite this mailer from the event's real content. Copy, block order, empty sections and the palette may all change — you can Undo, and nothing is saved until you Save.",{ok:"Enhance mailer"}))return;
  const before=JSON.stringify(MD.doc);
  const j=await mlAi({action:"enhance",doc:MD.doc});
  if(!j)return;
  const byId=new Map(MD.doc.blocks.map(b=>[b.id,b]));
  let copyN=0,delN=0;
  for(const it of j.copy||[]){
    const [id,field]=String(it.ref).split(".");
    const b=byId.get(id);
    if(b&&field&&typeof it.text==="string"&&it.text.trim()){ b.props[field]=it.text; copyN++; }
  }
  const footerIds=new Set(MD.doc.blocks.filter(b=>b.type==="footer").map(b=>b.id));
  for(const id of j.remove||[]){ if(byId.has(id)&&!footerIds.has(id)){ byId.delete(id); delN++; } }
  if(Array.isArray(j.order)&&j.order.length){
    const seen=new Set(), ordered=[];
    for(const id of j.order){ const b=byId.get(id); if(b&&!seen.has(id)){ ordered.push(b); seen.add(id); } }
    for(const b of MD.doc.blocks) if(byId.has(b.id)&&!seen.has(b.id)) ordered.push(b);   // never silently drop
    MD.doc.blocks=ordered;
  } else {
    MD.doc.blocks=MD.doc.blocks.filter(b=>byId.has(b.id));
  }
  if(j.theme&&["site","light","dark"].includes(j.theme)) MD.doc.theme=j.theme;
  if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(j.background||"")) MD.doc.background=j.background;
  if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(j.accent||"")) MD.doc.accent=j.accent;
  MD.dirty=true; MD.sel=null; mlProps(); mlRender(0);
  MD.undo=before;
  $("mlAiOut").innerHTML=`<div class="ai-note">${escapeHtml(j.summary||"Enhanced.")}
    <button class="btn ghost sm" style="margin-top:7px" onclick="mlUndoEnhance()">Undo</button></div>`;
  toast(`Enhanced — ${copyN} field${copyN===1?"":"s"} rewritten${delN?`, ${delN} section${delN===1?"":"s"} removed`:""}`);
}
function mlUndoEnhance(){
  if(!MD.undo)return;
  MD.doc=JSON.parse(MD.undo); MD.undo=null; MD.sel=null; MD.dirty=true;
  mlProps(); mlRender(0); toast("Reverted");
}

async function mlAiField(spec,inputId){
  const [id,field,what]=spec.split(".");
  const b=MD.doc.blocks.find(x=>x.id===id); if(!b)return;
  const cur=String(b.props[field]||"");
  if(!cur.trim()){ toast("Nothing to rewrite in that field yet"); return; }
  // The control is either a plain input or a mounted rich editor; fldGet/fldSet
  // hide the difference so the rewrite flow stays one path.
  const el=document.getElementById(inputId); const prev=el?fldGet(el):cur;
  if(el){ fldBusy(el,true); fldSet(el,"Rewriting…"); }
  const j=await mlAi({action:"rewrite",doc:MD.doc,text:cur,what});
  if(el)fldBusy(el,false);
  if(!j||typeof j.text!=="string"){ fldSet(el,prev); return; }
  b.props[field]=j.text; MD.dirty=true;
  fldSet(el,j.text);
  mlRender(0); toast(j.note||"Rewritten");
}

/* ---------- width / save / export ---------- */
function mlSetWidth(w){
  MD.width=w;
  $("mlFrame").classList.toggle("mob",w==="mobile");
  $("mlWidth").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.v===w));
  setTimeout(()=>{ mlFit(); mlOverlay(); },80);
}
/* ---------- saved versions ----------
   Save updates the version that is open; Save as new creates another. A mailer
   with nothing saved yet has no version to update, so its Save is a create — and
   asks for the name once, pre-filled with the subject line. */
async function mlPutSave(saveId,name){
  if(!MD.doc)return false;
  toast("Saving…");
  const r=await api("/api/mailer/save",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerId:MD.id,doc:MD.doc,saveId:saveId||null,name:name||""})});
  if(!r.ok){ toast((await r.json().catch(()=>({}))).error||"Save failed"); return false; }
  const j=await r.json();
  MD.dirty=false; MD.saved=true;
  MD.saveId=j.save.saveId; MD.saveName=j.save.name;
  mlSetSaves(MD.id,j.saves);
  mlStatus(); mlMarkUrl();
  return true;
}
/** The subject line is the default name because it is what distinguishes two
    versions of the same mailer in the sender's head — and in the dashboard. */
const mlDefaultName=()=>String((MD.doc&&MD.doc.subject)||"").trim()||"Untitled version";
/** Auto-suffix a name that collides with an existing version — a fast Save-as-new
    (name pre-filled with the subject) would otherwise make two "Announcement"s
    indistinguishable in the list and the dashboard. */
function mlUniqueName(name,excludeId){
  const base=String(name||"").trim()||"Untitled version";
  const taken=new Set(mlSaves(MD.id).filter(s=>s.saveId!==excludeId).map(s=>String(s.name)));
  if(!taken.has(base))return base;
  for(let n=2;n<999;n++){ const c=`${base} (${n})`; if(!taken.has(c))return c; }
  return `${base} ${Date.now()}`;
}
async function mlSave(){
  if(!MD.doc)return;
  if(!MD.saveId){ await mlSaveAs(); return; }              // nothing to update yet
  if(await mlPutSave(MD.saveId,MD.saveName)) toast(`Saved “${MD.saveName}”`);
}
async function mlSaveAs(){
  if(!MD.doc)return;
  // Save-name stays a native prompt: the editor audit pins this create-a-version
  // flow through the browser-dialog channel and asserts the exact name typed, and
  // the test file is outside this file's ownership. The duplicate-name auto-suffix
  // below still applies, and Rename/Delete/the AI confirmations use in-app modals.
  const name=prompt("Name this version",mlDefaultName());
  if(name===null)return;                                    // cancelled
  if(await mlPutSave(null,mlUniqueName(name))) toast(`Saved as “${MD.saveName}”`);
}
async function mlRenameVersion(){
  closeMenus();
  if(!MD.saveId){ toast("This draft has not been saved yet"); return; }
  const typed=await uiPrompt("Rename this version",{value:MD.saveName,placeholder:"Version name",ok:"Rename"});
  if(typed===null)return;
  const name=mlUniqueName(typed,MD.saveId);
  const r=await api("/api/mailer/save/rename",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerId:MD.id,saveId:MD.saveId,name})});
  if(!r.ok){ toast("Rename failed"); return; }
  const j=await r.json();
  MD.saveName=j.save.name; mlSetSaves(MD.id,j.saves); mlStatus(); toast("Renamed");
}
async function mlDeleteVersion(){
  closeMenus();
  if(!MD.saveId){ toast("This draft has not been saved yet"); return; }
  if(!await uiConfirm("Delete this version?",`“${escapeHtml(MD.saveName)}” will be removed. Your other saved versions are kept.`,{ok:"Delete version",danger:true}))return;
  const r=await api("/api/mailer/save/delete",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerId:MD.id,saveId:MD.saveId})});
  if(!r.ok){ toast("Delete failed"); return; }
  mlSetSaves(MD.id,(await r.json()).saves);
  // Land on whatever is left rather than on a version that no longer exists.
  const next=mlSaves(MD.id)[0];
  await mlLoad(!next,next?next.saveId:null);
  toast("Version deleted");
}
/** Start again from the event data. Saved versions are untouched — this opens a
    new draft, so the next Save creates a version rather than overwriting one. */
/* ---- change layout, and adopt an outside HTML file ----------------------
   Both replace the document on screen with one the server built, and neither is
   lossless. So both end at `mlNote`, which states what moved and what did not:
   the sender is about to mail this, and a switch that quietly dropped a
   paragraph is worse than one that says it did. Neither saves — the result is a
   dirty draft until the sender keeps it. */

function mlNote(html){
  const n=$("mlNote"); if(!n) return;
  if(!html){ n.style.display="none"; n.innerHTML=""; return; }
  n.innerHTML=`<button class="x" onclick="mlNote('')" title="Dismiss">✕</button>${html}`;
  n.style.display="block";
}
/** A report section as a line, or nothing when it is empty. */
const mlNoteBit=(label,list)=>list&&list.length?`<li>${label}: ${escapeHtml(list.join(", "))}</li>`:"";

function mlRelayoutOpen(e){
  if(e)e.stopPropagation();
  const all=((MAILERS&&MAILERS.mailers)||[]);
  const box=$("mlLayouts");
  const rows=all.filter(m=>m.id!==MD.id).map(m=>
    `<button ${m.available?`onclick="mlRelayoutTo('${m.id}')"`:"disabled title=\"This event has no content for that layout\""}>
       <b>${escapeHtml(m.label||m.id)}</b><i>${escapeHtml(m.description||"")}</i></button>`).join("");
  box.innerHTML=`<div class="ph">Change layout <span class="faint" style="font-weight:400;text-transform:none;letter-spacing:0">your content moves across</span></div>`
    +(rows||`<button disabled><b>No other layout fits this event</b></button>`);
  closeMenus(); box.classList.add("on");
}

async function mlRelayoutTo(id){
  closeMenus();
  const m=findMailer(id); if(!m||!MD.doc) return;
  mlBusy(true,`Moving your content into ${m.label||"the new layout"}…`);
  const r=await api("/api/mailer/relayout",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,mailerId:id,doc:MD.doc,params:{}})});
  mlBusyDone();
  if(!r.ok){ const j=await r.json().catch(()=>({})); toast(j.error||"Could not change the layout"); return; }
  const j=await r.json();
  // A new layout is a NEW draft: it is not the version the sender opened, so it
  // must not overwrite it on the next Save. Clearing saveId turns Save into
  // "keep this as a new version", which is what the sender means here.
  MD.id=id; MD.doc=j.doc; MD.saveId=null; MD.saveName=""; MD.saved=false; MD.dirty=true; MD.sel=null;
  // The top-left picker still named the OLD layout, contradicting the "Now using
  // X" notice below. Point it at the new one (adding the option if it is absent).
  const pick=$("mlPick");
  if(pick){
    if(![...pick.options].some(o=>o.value===id)){ const o=document.createElement("option"); o.value=id; o.textContent=`${m.group||""} — ${m.label||id}`; pick.appendChild(o); }
    pick.value=id;
  }
  mlMount(j.html,true); mlProps(); mlStatus(); mlMarkUrl();
  const rp=j.report||{};
  mlNote(`<b>Now using the ${escapeHtml(m.label||id)} layout.</b> Your work moved across; nothing you typed was thrown away.
    <ul>${mlNoteBit("Kept",rp.kept)}
      ${rp.matched&&rp.matched.length?`<li>Moved into the new layout: ${rp.matched.length} section${rp.matched.length===1?"":"s"}</li>`:""}
      ${rp.carried&&rp.carried.length?`<li>Carried over because the new layout has no slot for them: ${escapeHtml(rp.carried.map(c=>c.type).join(", "))}</li>`:""}
      ${rp.dropped&&rp.dropped.length?`<li>Left behind (you had not changed them, so the new layout's own version is used): ${rp.dropped.length}</li>`:""}
      ${mlNoteBit("Warnings",rp.warnings)}</ul>
    This is an unsaved draft — <b>Save as new</b> to keep it.`);
  toast(`Switched to ${m.label||"the new layout"}`);
}

function mlImportOpen(){ closeMenus(); $("mlFile").click(); }

async function mlImportFile(input){
  const f=input.files&&input.files[0]; input.value="";       // so the same file can be chosen twice
  if(!f) return;
  mlBusy(true,`Reading ${f.name}…`);
  // Sent as raw bytes: the server decodes UTF-8 itself and the importer reads
  // text nodes only, so nothing here needs to understand the file.
  const r=await api(`/api/mailer/import?portal=${encodeURIComponent(S.portal)}&event=${encodeURIComponent(S.event)}`,
    {method:"POST",headers:{"content-type":"text/html"},body:await f.arrayBuffer()});
  mlBusyDone();
  if(!r.ok){ const j=await r.json().catch(()=>({})); toast(j.error||"Could not read that file"); return; }
  const j=await r.json();
  // Remember the document that was open, so a near-empty or wrong import is one
  // click to recover from rather than a dead end. The old doc object is detached
  // once MD.doc is replaced, so no clone is needed.
  MD.importUndo={doc:MD.doc,id:MD.id,saveId:MD.saveId,saveName:MD.saveName,saved:MD.saved};
  MD.doc=j.doc; MD.id=j.doc.mailerId; MD.saveId=null; MD.saveName=""; MD.saved=false; MD.dirty=true; MD.sel=null;
  mlMount(j.html,true); mlProps(); mlStatus();
  const rp=j.report||{}, pct=Math.round((rp.textCoverage??0)*100);
  const sum=(a)=>(a||[]).map(x=>`${x.what}${x.count>1?` ×${x.count}`:""}`);
  // Plain-language cleanup — NOT the raw rp.removed list (it carries technical
  // "unsafe URL" strings the audit needs but a marketer must never be shown).
  const cleaned=(rp.removedSummary||[]).map(x=>`<li>${escapeHtml(x.what)}${x.detail?` <span class="faint">— ${escapeHtml(x.detail)}</span>`:""}</li>`).join("");
  // Shown only when an import lost a lot: a reassuring callout at the TOP, with the
  // way out right there, rather than an alarming near-empty canvas and no context.
  const guide=(rp.guidance&&rp.guidance.length)
    ? `<div class="ml-guide">${rp.guidance.map(g=>`<div>${escapeHtml(g)}</div>`).join("")}
         <button class="btn ghost sm" style="margin-top:6px" onclick="mlUndoImport()">Undo import</button></div>`
    : "";
  mlNote(`${guide}<b>Imported ${escapeHtml(f.name)}</b> — ${rp.blocks||0} section${rp.blocks===1?"":"s"}, <b>${pct}%</b> of the wording carried over.
    <ul>${mlNoteBit("Approximated",sum(rp.approximated))}
      ${mlNoteBit("Could not be represented",sum(rp.unrepresented))}
      ${cleaned?`<li>Cleaned up on import:<ul>${cleaned}</ul></li>`:""}
      ${rp.lostText&&rp.lostText.length?`<li>Wording that did not survive: ${escapeHtml(rp.lostText.slice(0,4).join(" · "))}${rp.lostText.length>4?" …":""}</li>`:""}
      ${mlNoteBit("Warnings",rp.warnings)}</ul>
    Colours and per-section backgrounds are not imported — the mail is repainted in this event's palette.
    This is an unsaved draft — <b>Save as new</b> to keep it, or <b onclick="mlUndoImport()" style="cursor:pointer;text-decoration:underline">Undo import</b> to go back.`);
  toast(`Imported ${rp.blocks||0} sections`);
}
/** Put back the document that was open before the last import. */
function mlUndoImport(){
  const p=MD.importUndo; if(!p){ toast("Nothing to undo"); return; }
  MD.importUndo=null;
  MD.doc=p.doc; MD.id=p.id; MD.saveId=p.saveId; MD.saveName=p.saveName; MD.saved=p.saved;
  MD.dirty=true; MD.sel=null;
  mlProps(); mlStatus(); mlRender(0); mlNote(""); mlMarkUrl();
  toast("Import undone");
}

/** The mail as a picture or a PDF, for approvals and decks. Untracked by
    definition — see the endpoint: rendering the mail fetches its own pixel, so
    an export that counted as a send would invent opens nobody made. */
async function mlExport(format,width){
  closeMenus();
  if(!MD.doc) return;
  mlBusy(true,`Rendering the ${format==="pdf"?"PDF":"image"}…`);
  const r=await api("/api/mailer/export",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,doc:MD.doc,format,width})});
  mlBusyDone();
  if(!r.ok){ toast(`Could not render the ${format.toUpperCase()}`); return; }
  const blob=await r.blob();
  const stem=(MD.doc.subject||"mailer").replace(/[^\w.-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"mailer";
  const a=document.createElement("a");
  // Desktop and mobile image exports built the SAME filename, so saving both left
  // two indistinguishable files (or a "(1)" copy). Tag the image with its width.
  const suffix=format==="png"?(width<=480?"-mobile":"-desktop"):"";
  a.href=URL.createObjectURL(blob); a.download=`${stem}${suffix}.${format}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  toast(`${format.toUpperCase()} downloaded (${Math.round(blob.size/1024)}kb)`);
}

async function mlRebuild(){
  closeMenus();
  if(!await uiConfirm("Rebuild from event data?","This starts a fresh draft from the event's current data. Your saved versions are kept.",{ok:"Rebuild"}))return;
  await mlLoad(true,null); toast("Rebuilt from event data");
}
async function mlCopy(){
  closeMenus();
  // track:true — copying is an export, so it counts as a send and gets the
  // tracking pixel. The preview render never sets this. The version travels with
  // it so the dashboard can attribute the send to the version that produced it.
  const r=await api("/api/mailer/render",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,doc:MD.doc,editor:false,track:true,saveId:MD.saveId,saveName:MD.saveName})});
  if(!r.ok){toast("Render failed");return;}
  try{ const j=await r.json(); await navigator.clipboard.writeText(j.html); owTrackToast("copy",j.tracked!==false,""); }
  catch{ toast("Clipboard blocked by the browser"); }
}
/** The same mail with no pixel and no click rewriting, and no send recorded.
    Checking your own work otherwise fires the tracker on every view — which is
    how a campaign that was never delivered accumulated opens. */
async function mlDownloadTest(){
  closeMenus();
  if(!MD.doc)return; toast("Preparing an untracked copy…");
  const r=await api("/api/mailer/download",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,doc:MD.doc,test:true})});
  if(!r.ok){ toast("Download failed"); return; }
  const cd=r.headers.get("Content-Disposition")||"";
  const a=document.createElement("a"); a.href=URL.createObjectURL(await r.blob());
  a.download=((cd.match(/filename="([^"]+)"/)||[])[1]||"mailer.html").replace(/\.html$/,"-test.html"); a.click();
  toast("Test copy downloaded — nothing recorded");
}
async function mlDownload(){
  if(!MD.doc)return; toast("Preparing…");
  const r=await api("/api/mailer/download",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({portal:S.portal,event:S.event,doc:MD.doc,saveId:MD.saveId,saveName:MD.saveName})});
  if(!r.ok){ toast("Download failed"); return; }
  const cd=r.headers.get("Content-Disposition")||"";
  const a=document.createElement("a"); a.href=URL.createObjectURL(await r.blob());
  const fname=(cd.match(/filename="([^"]+)"/)||[])[1]||"mailer.html"; a.download=fname; a.click();
  // Download gave zero on-screen feedback before — a first-timer couldn't tell it
  // worked. Name the file and say where the numbers will land, held on screen longer.
  owTrackToast("download",r.headers.get("X-Mailer-Tracked")!=="no",fname);
}
function mlStatus(){
  mlHistPush();                      // every mutation path reaches here or mlProps
  const pill=$("mlState"); pill.style.display="";
  pill.className="pill"+(MD.dirty?"":" cache");
  pill.textContent=MD.dirty?"unsaved":(MD.saved?"saved":"generated");
  // Which version is open, so Save is never ambiguous about what it overwrites.
  const v=$("mlVer"); if(!v)return;
  v.classList.toggle("none",!MD.saveId);
  v.textContent=MD.saveId?MD.saveName:"New draft";
  v.title=MD.saveId
    ? `Editing the saved version “${MD.saveName}” — Save updates it, Save as new creates another`
    : "Not saved yet — Save creates the first version of this mailer";
}

document.addEventListener("click",(e)=>{ if($("mailer").classList.contains("on")&&!e.target.closest("#mlPop")&&!e.target.closest(".ins")&&!e.target.closest(".ml-railtop")) mlPopClose(); });
/* ---- undo / redo ---------------------------------------------------------
   The studio changes MD.doc from about two dozen places. Rather than instrument
   every one — and quietly miss the next one someone adds — history is captured
   from the three functions all of them end up calling: mlRender, mlProps and
   mlStatus. The snapshot is compared against the top of the stack before it is
   kept, so a path that fires two of the three still records ONE step, and a
   render that changed nothing records none.

   The snapshot carries the mailer id as well as the document, so switching
   layout is undoable too — restoring the blocks without the id would leave the
   studio editing one mailer while claiming to be another. */
const MLH={stack:[],at:-1,t:null,busy:false}, MLH_MAX=60;
const mlHistSnap=()=>MD.doc?JSON.stringify({id:MD.id,doc:MD.doc}):null;
function mlHistReset(){
  clearTimeout(MLH.t); MLH.stack=[]; MLH.at=-1;
  const s=mlHistSnap(); if(s){ MLH.stack=[s]; MLH.at=0; }
}
function mlHistPush(){
  if(MLH.busy||!MD.doc) return;
  // Debounced, so holding a key in a settings field is one step and not forty.
  clearTimeout(MLH.t);
  MLH.t=setTimeout(()=>{
    const s=mlHistSnap();
    if(!s||s===MLH.stack[MLH.at]) return;
    MLH.stack=MLH.stack.slice(0,MLH.at+1);      // editing after an undo drops the redo branch
    MLH.stack.push(s);
    if(MLH.stack.length>MLH_MAX) MLH.stack.shift();
    MLH.at=MLH.stack.length-1;
  },350);
}
function mlHistGo(step){
  clearTimeout(MLH.t);
  const i=MLH.at+step;
  if(!MD.doc||i<0||i>=MLH.stack.length){ toast(step<0?"Nothing left to undo":"Nothing to redo"); return; }
  MLH.at=i;
  // Restoring calls the very functions that record history, so the recorder is
  // held off until after the debounce would have fired.
  MLH.busy=true;
  const s=JSON.parse(MLH.stack[i]);
  MD.id=s.id; MD.doc=s.doc; MD.sel=null; MD.dirty=true;
  mlProps(); mlStatus(); mlRender(0);
  setTimeout(()=>{ MLH.busy=false; },420);
  toast(step<0?"Undone":"Redone");
}
const mlUndo=()=>mlHistGo(-1), mlRedo=()=>mlHistGo(1);

document.addEventListener("keydown",(e)=>{
  if(!$("mailer").classList.contains("on")) return;
  // Also treat an open editor session as typing: the rich popover keeps focus in
  // its own subtree, and in-place editing focuses the iframe.
  const inField=typingTarget()||!!(typeof IE!=="undefined"&&IE.el);
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); mlSave(); return; }
  // Undo/redo sit BELOW the typing guard on purpose: inside a text field or an
  // in-canvas edit, ⌘Z has to keep meaning "undo my typing", which is the
  // browser's own undo. Stealing it there would make text editing worse.
  if(inField) return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){ e.preventDefault(); mlUndo(); return; }
  if((e.metaKey||e.ctrlKey)&&(e.key.toLowerCase()==="y"||(e.key.toLowerCase()==="z"&&e.shiftKey))){ e.preventDefault(); mlRedo(); return; }
  if(e.key==="Escape"){ if(ICP.el) iconPopClose(); else if($("mlPop").classList.contains("on")) mlPopClose(); else if(MD.sel) mlSelect(null); else closeMailer(); return; }
  if(MD.sel&&(e.key==="Backspace"||e.key==="Delete")){ e.preventDefault(); mlDel(MD.sel); }
});

