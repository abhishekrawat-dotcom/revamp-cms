/* index.js — ET Events Payment Prototype: Inside-Event View
   revamp-cms/payment/html_version
   Improvements: toast system, multi-page creation, no delete button,
   GST-inclusive price preview, improved empty states, inline coupon remove.
*/

/* ═════════════════════════════════════════════════
   STATE
═════════════════════════════════════════════════ */
let activeDetailsTab = "transactions";
let txFilter = "All";
let txSearch = "";
let creditTab = "Pending";
let offlineTab = "Pending";

let activeCouponPage = null;
let currentCouponType = "auto";
let expandedPages = {};
let editingPageId = null;
let allCouponCodes = [];

const EVENT = window.CURRENT_EVENT;

/* ═════════════════════════════════════════════════
   TOAST SYSTEM
═════════════════════════════════════════════════ */
function showToast(msg, type = "ok") {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icons = { ok: "ti-check", warn: "ti-alert-triangle", err: "ti-alert-circle" };
  t.innerHTML = `<i class="ti ${icons[type] || 'ti-check'}" style="font-size:16px;flex-shrink:0"></i> ${msg}`;
  host.appendChild(t);
  setTimeout(() => {
    t.style.animation = "toast-out .22s ease forwards";
    setTimeout(() => t.remove(), 230);
  }, 3000);
}
window.showToast = showToast;

/* ═════════════════════════════════════════════════
   SCREEN ROUTER
═════════════════════════════════════════════════ */
function renderScreen() {
  const content = document.getElementById("app-content");
  if (!content) return;

  const isPaymentModule = ['pages', 'coupons', 'details'].includes(activeScreen);
  let html = '';

  if (isPaymentModule) {
    html += `
      <div class="fade-in" style="margin-bottom: 24px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px; margin-top:4px; gap:12px; flex-wrap:wrap;">
          <div>
            <h2 style="font-size:24px;margin:2px 0 4px;">Payment Workspace</h2>
            <div style="font-size:14px;color:var(--text-muted);">Manage payment pages, promotional coupons, and view reports.</div>
          </div>
        </div>
        <div class="subtabs" style="margin-bottom: 0; border-bottom: 1px solid var(--border);">
          <button class="${activeScreen === 'pages' ? 'active' : ''}" onclick="setScreen('pages')">Payment Pages</button>
          <button class="${activeScreen === 'coupons' ? 'active' : ''}" onclick="setScreen('coupons')">Coupons</button>
          <button class="${activeScreen === 'details' ? 'active' : ''}" onclick="setScreen('details')">Reports</button>
        </div>
      </div>
    `;
  }

  if (activeScreen === "details") {
    content.innerHTML = html + renderPaymentDetails();
    postRenderDetails();
  } else if (activeScreen === "pages") {
    content.innerHTML = html + renderPaymentPages();
    renderPagesTable();
  } else if (activeScreen === "coupons") {
    content.innerHTML = html + renderCouponsScreen();
  } else if (activeScreen === "create-page") {
    content.innerHTML = renderCreatePageScreen();
  }
}

function renderCouponsScreen() {
  const pages = window.appData.pages.filter(p => p.eventId === EVENT.id);
  
  let allCouponsMap = {};
  pages.forEach(p => {
    if (p.coupons) {
      p.coupons.forEach(c => {
        if (!allCouponsMap[c.code]) {
          allCouponsMap[c.code] = { 
            ...c, 
            linkedPages: [], 
            totalUsed: 0, 
            totalGrossSales: 0, 
            totalDiscountGiven: 0,
            currency: p.currency || 'INR',
            pageIds: []
          };
        }
        allCouponsMap[c.code].linkedPages.push(p.name);
        allCouponsMap[c.code].pageIds.push(p.id);
        
        const price = p.price || 0;
        const used = c.used || 0;
        const grossSales = price * used;
        let discountGiven = 0;
        if (c.discountType === "percent") {
          discountGiven = price * (c.discount / 100) * used;
        } else {
          discountGiven = c.discount * used;
        }
        
        allCouponsMap[c.code].totalUsed += used;
        allCouponsMap[c.code].totalGrossSales += grossSales;
        allCouponsMap[c.code].totalDiscountGiven += discountGiven;
      });
    }
  });
  
  const uniqueCoupons = Object.values(allCouponsMap);

  let html = `<div class="fade-in">
    <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:24px;">
      <button class="btn btn-primary" onclick="openAddCouponModal()">
        <i class="ti ti-ticket" style="margin-right:6px"></i> Create Coupon
      </button>
    </div>`;

  if (uniqueCoupons.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-icon"><i class="ti ti-ticket"></i></div>
        <h3>No coupons found</h3>
        <p>Create your first discount coupon for this event.</p>
        <button class="btn btn-primary" onclick="openAddCouponModal()" style="margin-top:16px"><i class="ti ti-plus"></i> Add Coupon</button>
      </div>
    `;
  } else {
    html += `<div style="display:flex; flex-direction:column; gap:20px;">
      ${uniqueCoupons.map(c => {
        const isExp = c.end ? new Date(c.end) < new Date() : false;
        const isActive = !isExp && c.active !== false;
        const disc = c.discountType === "percent" ? c.discount + "%" : window.utils.fmtCurrency(c.discount, c.currency);

        const used = c.totalUsed;
        const grossSales = c.totalGrossSales;
        const discountGiven = c.totalDiscountGiven;
        const effectiveDiscountPct = grossSales > 0 ? ((discountGiven / grossSales) * 100).toFixed(1) + "%" : "—";
        const hasData = used > 0;

        return `
          <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-sm);">
            
            <div style="display:flex; align-items:stretch;">
              <!-- Accent sidebar -->
              <div style="width:4px; background:${isActive ? 'var(--accent)' : 'var(--text-faint)'}; flex-shrink:0;"></div>

              <!-- Discount badge -->
              <div style="padding:20px 24px; display:flex; align-items:center; border-right:1px solid var(--border); flex-shrink:0; background:${isActive ? 'transparent' : 'var(--surface-2)'};">
                <div style="text-align:center;">
                  <div style="background:${isActive ? 'var(--accent-soft)' : 'var(--surface-3)'}; color:${isActive ? 'var(--accent-strong)' : 'var(--text-muted)'}; font-size:24px; font-weight:800; padding:12px 18px; border-radius:8px; line-height:1; min-width:80px;">${disc}</div>
                  <div style="margin-top:6px; font-size:10px; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-faint); font-weight:700;">${c.discountType === 'percent' ? 'percent off' : 'flat off'}</div>
                </div>
              </div>

              <!-- Content area -->
              <div style="flex:1; padding:20px 24px; min-width:0;">

                <!-- Row 1: Label + code + badges + actions -->
                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px;">
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span style="font-size:16px; font-weight:700; color:var(--text); white-space:nowrap;">${c.label}</span>
                    ${c.type === 'code' && c.code
                      ? `<span style="font-family:var(--font-mono); font-size:12px; font-weight:600; background:var(--surface-2); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:3px 10px; letter-spacing:1.5px; line-height:1.2; ${isExp ? 'text-decoration:line-through; opacity:0.5;' : ''}">${c.code}</span>`
                      : ''}
                    ${c.type === 'auto'
                      ? `<span style="font-size:11px; background:var(--info-soft); color:var(--info); padding:4px 10px; border-radius:6px; font-weight:600; line-height:1.2;">⚡ Auto-applied</span>`
                      : `<span style="font-size:11px; background:var(--surface-2); color:var(--text-muted); padding:4px 10px; border-radius:6px; font-weight:600; border:1px solid var(--border); line-height:1.2;">Code-based</span>`}
                    <span style="font-size:11px; background:${isActive ? 'var(--ok-soft)' : 'var(--surface-3)'}; color:${isActive ? 'var(--ok)' : 'var(--text-faint)'}; padding:4px 10px; border-radius:6px; font-weight:600; line-height:1.2;">${isActive ? '● Active' : (isExp ? '● Expired' : '● Paused')}</span>
                    ${c.minQty > 0 ? `<span style="font-size:11px; background:var(--warn-soft); color:var(--warn); padding:4px 10px; border-radius:6px; font-weight:600; line-height:1.2;">Min. ${c.minQty} tickets</span>` : ''}
                  </div>
                  
                  <!-- Action buttons top-right -->
                  <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <button title="Copy Promo Link" onclick="copyPromoLink('${c.pageIds[0]}', '${c.code || ''}')"
                      style="height:32px; padding:0 12px; border:1px solid var(--border); border-radius:6px; background:var(--surface); cursor:pointer; display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500; color:var(--text-muted);"
                      onmouseover="this.style.background='var(--surface-2)'; this.style.borderColor='var(--text-muted)';"
                      onmouseout="this.style.background='var(--surface)'; this.style.borderColor='var(--border)';">
                      <i class="ti ti-link" style="font-size:14px;"></i> Share
                    </button>
                    ${!isExp ? `
                    <button title="${c.active !== false ? 'Deactivate coupon' : 'Activate coupon'}" onclick="alert('Toggle coupon across all applied pages logic here')"
                      style="height:32px; padding:0 12px; border:1px solid ${c.active !== false ? 'var(--warn)' : 'var(--ok)'}; border-radius:6px; background:${c.active !== false ? 'var(--warn-soft)' : 'var(--ok-soft)'}; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; color:${c.active !== false ? 'var(--warn)' : 'var(--ok)'};"
                      onmouseover="this.style.opacity='0.8';"
                      onmouseout="this.style.opacity='1';">
                      <i class="ti ti-${c.active !== false ? 'player-pause' : 'player-play'}" style="font-size:14px;"></i>
                      ${c.active !== false ? 'Deactivate' : 'Activate'}
                    </button>` : `
                    <span style="height:32px; padding:0 12px; border:1px solid var(--border); border-radius:6px; background:var(--surface-3); display:inline-flex; align-items:center; font-size:13px; font-weight:600; color:var(--text-faint);">Expired</span>`}
                  </div>
                </div>

                <!-- Row 3: Dates + usage + progress -->
                <div style="display:flex; align-items:center; gap:20px; font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">
                  <span><i class="ti ti-calendar" style="font-size:14px; position:relative; top:2px; margin-right:4px;"></i>${c.start ? window.utils.fmtDate(c.start) : '—'} → ${c.end ? window.utils.fmtDate(c.end) : 'No end'}</span>
                  <span style="color:var(--surface-3);">|</span>
                  <span><span style="font-weight:600; color:var(--text);">${used}</span> / ${c.maxUses ? c.maxUses : '∞'} redemptions</span>
                  ${c.maxUses > 0 ? `
                    <div style="display:flex; align-items:center; gap:6px;">
                      <div style="width:100px; height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden;">
                        <div style="width:${Math.min(100, Math.round(used / c.maxUses * 100))}%; height:100%; background:${used / c.maxUses > 0.8 ? 'var(--accent)' : 'var(--ok)'}; border-radius:3px;"></div>
                      </div>
                      <span style="font-size:11px; color:var(--text-faint); font-weight:600;">${Math.min(100, Math.round(used / c.maxUses * 100))}%</span>
                    </div>` : ''}
                </div>
                
                <!-- Applies to pages label -->
                <div style="font-size:12.5px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
                  <i class="ti ti-layers-linked" style="font-size:14px;"></i>
                  <span>Applies to: <span style="font-weight:600; color:var(--text);">${c.linkedPages.join(', ')}</span></span>
                </div>
              </div>
            </div>

            <!-- Analytics strip -->
            <div style="border-top:1px solid var(--border); background:${hasData ? 'var(--surface-2)' : '#FAFAFA'}; display:grid; grid-template-columns:repeat(4,1fr);">
              ${hasData ? `
                <div style="padding:14px 24px; border-right:1px solid var(--border);">
                  <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-faint); margin-bottom:6px;">Gross Sales</div>
                  <div style="font-size:18px; font-weight:800; color:var(--ok);">${window.utils.fmtCurrency(grossSales, c.currency)}</div>
                </div>
                <div style="padding:14px 24px; border-right:1px solid var(--border);">
                  <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-faint); margin-bottom:6px;">Orders Delivered</div>
                  <div style="font-size:18px; font-weight:800; color:var(--text);">${used}</div>
                </div>
                <div style="padding:14px 24px; border-right:1px solid var(--border);">
                  <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-faint); margin-bottom:6px;">Discount Given</div>
                  <div style="font-size:18px; font-weight:800; color:var(--accent);">${window.utils.fmtCurrency(discountGiven, c.currency)}</div>
                </div>
                <div style="padding:14px 24px;">
                  <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-faint); margin-bottom:6px;">Effective Discount</div>
                  <div style="font-size:18px; font-weight:800; color:var(--text);">${effectiveDiscountPct}</div>
                </div>
              ` : `
                <div colspan="4" style="grid-column:1/-1; padding:16px 24px; display:flex; align-items:center; gap:8px; color:var(--text-faint);">
                  <i class="ti ti-chart-bar" style="font-size:16px;"></i>
                  <span style="font-size:13px; font-weight:500;">Analytics will appear once this coupon is redeemed for the first time.</span>
                </div>
              `}
            </div>
            
          </div>
        `;
      }).join('')}
    </div>`;
  }
  html += `</div>`;
  return html;
}

/* ═════════════════════════════════════════════════
   METRICS STRIP
═════════════════════════════════════════════════ */
function renderPaymentMetrics() {
  const eventPages = window.appData.pages.filter(p => p.eventId === EVENT.id);
  const eventTx = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  const successTx = eventTx.filter(t => t.status === "Success");
  const failedTx = eventTx.filter(t => t.status === "Failed");
  const incompleteTx = eventTx.filter(t => t.status === "Incomplete");
  const totalRev = successTx.reduce((s, t) => s + t.amount, 0);
  const livePg = eventPages.filter(p => p.liveOnSite !== false).length;
  const offlinePending = window.appData.offline.filter(o => o.status === "Pending");
  const pendingAmt = incompleteTx.reduce((s, t) => s + t.amount, 0) +
    offlinePending.reduce((s, o) => s + o.amount, 0);

  return `
    <div class="hud-bar" style="margin-bottom:20px">
      <button class="hud-seg" onclick="setScreen('pages')" title="Payment Pages">
        <i class="ti ti-layout-cards hud-icon"></i>
        <div class="hud-inner">
          <div class="hud-label">Pages</div>
          <div class="hud-val">${eventPages.length} <span class="hud-sub">${livePg} live</span></div>
        </div>
      </button>
      <div class="hud-div"></div>
      <button class="hud-seg" onclick="txFilter='All'; activeDetailsTab='transactions'; setScreen('details');" title="Transactions">
        <i class="ti ti-arrows-exchange hud-icon"></i>
        <div class="hud-inner">
          <div class="hud-label">Transactions</div>
          <div class="hud-val">${successTx.length} <span class="hud-sub">of ${eventTx.length} total</span></div>
        </div>
      </button>
      <div class="hud-div"></div>
      <button class="hud-seg" onclick="txFilter='All'; activeDetailsTab='transactions'; setScreen('details');" title="Gross Revenue">
        <i class="ti ti-currency-rupee hud-icon hud-icon--ok"></i>
        <div class="hud-inner">
          <div class="hud-label">Gross Revenue</div>
          <div class="hud-val hud-val--ok">${window.utils.fmtCurrency(totalRev)}</div>
        </div>
      </button>
      <div class="hud-div"></div>
      <button class="hud-seg" onclick="activeDetailsTab='offline'; setScreen('details');" title="Pending Amount">
        <i class="ti ti-clock hud-icon hud-icon--warn"></i>
        <div class="hud-inner">
          <div class="hud-label">Pending</div>
          <div class="hud-val hud-val--warn">${window.utils.fmtCurrency(pendingAmt)} <span class="hud-sub">${incompleteTx.length + offlinePending.length} items</span></div>
        </div>
      </button>
      <div class="hud-div"></div>
      <button class="hud-seg" onclick="activeDetailsTab='transactions'; setTxFilter('Failed'); setScreen('details');" title="Failed Transactions">
        <i class="ti ti-alert-circle hud-icon ${failedTx.length > 0 ? 'hud-icon--err' : ''}"></i>
        <div class="hud-inner">
          <div class="hud-label">Failed</div>
          <div class="hud-val ${failedTx.length > 0 ? 'hud-val--err' : ''}">${failedTx.length} <span class="hud-sub">tx</span></div>
        </div>
      </button>
    </div>
  `;
}

/* ═════════════════════════════════════════════════
   SCREEN 1: PAYMENT DETAILS
═════════════════════════════════════════════════ */
function renderPaymentDetails() {
  const eventTx = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  const DETAIL_TABS = [
    { id: "transactions", label: "Transactions", count: eventTx.length },
    { id: "tax-invoice", label: "Tax Invoices", count: window.appData.invoices.length },
    { id: "invoice-listing", label: "Invoice Listing", count: window.appData.invoiceListing.length },
    { id: "credit-notes", label: "Credit Notes", count: window.appData.credit.length },
    { id: "offline", label: "Offline Payments", count: window.appData.offline.length },
  ];

  return `
    <div class="fade-in">
      ${renderPaymentMetrics()}
      <div class="panel">
        <div class="panel-body tight">
          <div class="subtabs" style="padding:16px 16px 0 16px;">
            ${DETAIL_TABS.map(tab => `
              <button class="detail-tab ${activeDetailsTab === tab.id ? 'active' : ''}" onclick="switchDetailsTab('${tab.id}')">
                ${tab.label}
                <span class="cnt">${tab.count}</span>
              </button>
            `).join('')}
          </div>
          <div id="detail-tab-content"></div>
        </div>
      </div>
    </div>
  `;
}

function postRenderDetails() { renderDetailsTabContent(); }

function switchDetailsTab(tabId) {
  activeDetailsTab = tabId;
  document.querySelectorAll('.detail-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${tabId}'`));
  });
  renderDetailsTabContent();
}
window.switchDetailsTab = switchDetailsTab;

function renderDetailsTabContent() {
  const container = document.getElementById("detail-tab-content");
  if (!container) return;
  switch (activeDetailsTab) {
    case "transactions": container.innerHTML = renderTransactionsTable(); break;
    case "tax-invoice": container.innerHTML = renderTaxInvoiceTable(); break;
    case "invoice-listing": container.innerHTML = renderInvoiceListingTable(); break;
    case "credit-notes": container.innerHTML = renderCreditNotesTable(); break;
    case "offline": container.innerHTML = renderOfflineTable(); break;
  }
}

/* ── Transactions ── */
let txDateFilter = "all";
function renderTransactionsTable() {
  setTimeout(() => renderTxInner(), 0);
  return `
    <div class="toolbar" style="padding-top:16px;flex-wrap:wrap;gap:8px;">
      <div class="search-wrap">
        <i class="ti ti-search" style="color:var(--text-muted)"></i>
        <input type="text" class="search-input" id="tx-search" placeholder="Search buyer, ID or page..." value="${txSearch}" oninput="updateTxSearch(this.value)">
      </div>
      <div class="chip-group" id="tx-filters">
        ${["All", "Success", "Failed", "Incomplete"].map(s => `
          <button class="chip ${txFilter === s ? 'active' : ''}" onclick="setTxFilter('${s}')">${s}</button>
        `).join('')}
      </div>
      <div class="chip-group" id="tx-date-filters" style="margin-left:auto">
        ${[["all", "All time"], ["today", "Today"], ["week", "This week"], ["month", "This month"]].map(([v, l]) => `
          <button class="chip ${txDateFilter === v ? 'active' : ''}" onclick="setTxDateFilter('${v}')">${l}</button>
        `).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="exportTxCSV()" style="margin-left:4px">
        <i class="ti ti-download"></i> Export CSV
      </button>
    </div>
    <div id="tx-table-inner"></div>
  `;
}

function txDateMatches(dateStr) {
  if (txDateFilter === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (txDateFilter === "today") {
    return d.toDateString() === now.toDateString();
  }
  if (txDateFilter === "week") {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    return d >= weekAgo;
  }
  if (txDateFilter === "month") {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return true;
}

function renderTxInner() {
  let txs = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  if (txFilter !== "All") txs = txs.filter(t => t.status === txFilter);
  txs = txs.filter(t => txDateMatches(t.date));
  if (txSearch) txs = txs.filter(t =>
    (t.id || "").toLowerCase().includes(txSearch.toLowerCase()) ||
    (t.page || "").toLowerCase().includes(txSearch.toLowerCase()) ||
    (t.buyer || "").toLowerCase().includes(txSearch.toLowerCase()) ||
    (t.email || "").toLowerCase().includes(txSearch.toLowerCase())
  );
  const container = document.getElementById("tx-table-inner");
  if (!container) return;
  const total = window.appData.transactions.filter(t => t.eventId === EVENT.id).length;
  // update tab count badge dynamically
  const activeTab = document.querySelector('.detail-tab.active .cnt');
  if (activeTab) activeTab.textContent = txs.length < total ? `${txs.length} of ${total}` : total;

  if (txs.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No transactions match this filter.</div>`;
    return;
  }
  const getPillClass = s => ({ Success: "pill-success", Failed: "pill-danger", Incomplete: "pill-warning" }[s] || "pill-neutral");
  container.innerHTML = `
    <table>
      <thead><tr><th>Txn ID</th><th>Buyer</th><th>Page</th><th>Mode</th><th>Status</th><th>Merchant</th><th>Amount</th><th>Date</th><th></th></tr></thead>
      <tbody>
        ${txs.map(t => `
          <tr>
            <td class="mono" style="font-weight:700">${t.id}</td>
            <td>
              <div style="font-weight:700">${t.buyer || '—'}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${t.email || ''}</div>
            </td>
            <td style="font-weight:600">${t.page}</td>
            <td style="color:var(--text-muted)">${t.mode}</td>
            <td><span class="spill ${getPillClass(t.status)}"><span class="pill-dot"></span>${t.status}</span></td>
            <td style="color:var(--text-muted)">${t.merchant}</td>
            <td style="font-weight:700;color:var(--ok)">${window.utils.fmtCurrency(t.amount)}</td>
            <td class="mono" style="color:var(--text-muted)">${t.date}</td>
            <td>
              <div style="position:relative;display:inline-block">
                <button class="btn btn-secondary btn-sm tx-action-trigger" onclick="toggleTxMenu('${t.id}')" title="Actions">
                  <i class="ti ti-dots"></i>
                </button>
                <div class="tx-action-menu" id="tx-menu-${t.id}" style="display:none">
                  <button onclick="txAction('resend','${t.id}')"><i class="ti ti-send"></i> Resend Receipt</button>
                  ${t.status === 'Success' ? `<button onclick="txAction('invoice','${t.id}')"><i class="ti ti-file-invoice"></i> View Invoice</button>` : ''}
                  <button onclick="txAction('creditnote','${t.id}')"><i class="ti ti-receipt-refund"></i> Initiate Credit Note</button>
                </div>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.setTxFilter = function (f) { txFilter = f; renderTransactionsTable(); }
window.setTxDateFilter = function (f) { txDateFilter = f; renderTxInner(); }
window.updateTxSearch = function (val) { txSearch = val; renderTxInner(); }
window.toggleTxMenu = function (id) {
  document.querySelectorAll('.tx-action-menu').forEach(m => { if (m.id !== `tx-menu-${id}`) m.style.display = 'none'; });
  const m = document.getElementById(`tx-menu-${id}`);
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.tx-action-trigger') && !e.target.closest('.tx-action-menu')) {
    document.querySelectorAll('.tx-action-menu').forEach(m => m.style.display = 'none');
  }
});
window.txAction = function (action, txId) {
  document.querySelectorAll('.tx-action-menu').forEach(m => m.style.display = 'none');
  if (action === 'resend') showToast(`Receipt resent for ${txId}.`, 'ok');
  if (action === 'invoice') showToast(`Opening invoice for ${txId}...`, 'ok');
  if (action === 'creditnote') showToast(`Credit note initiated for ${txId}.`, 'warn');
}
window.exportTxCSV = function () {
  let txs = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  if (txFilter !== "All") txs = txs.filter(t => t.status === txFilter);
  txs = txs.filter(t => txDateMatches(t.date));
  const headers = ['Txn ID', 'Buyer', 'Email', 'Page', 'Mode', 'Status', 'Merchant', 'Amount', 'Date'];
  const rows = txs.map(t => [
    t.id, t.buyer || '', t.email || '', t.page, t.mode, t.status, t.merchant, t.amount, t.date
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `transactions_${EVENT.id}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  showToast('CSV exported.', 'ok');
}

/* ── Tax Invoice ── */
function renderTaxInvoiceTable() {
  const invs = window.appData.invoices;
  if (!invs.length) return emptyState("ti-file-invoice", "No Tax Invoices", "Generated invoices will appear here once payments are processed.");
  return `<table>
    <thead><tr><th>Invoice No</th><th>Txn ID</th><th>Buyer</th><th>Email</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead>
    <tbody>
      ${invs.map(i => `
        <tr>
          <td class="mono" style="font-weight:700">${i.id}</td>
          <td class="mono" style="color:var(--text-muted)">${i.txId || '—'}</td>
          <td style="font-weight:600">${i.name || '—'}</td>
          <td style="color:var(--text-muted)">${i.email || '—'}</td>
          <td style="font-weight:700">${window.utils.fmtCurrency(i.amount)}</td>
          <td class="mono" style="color:var(--text-muted)">${i.date || '—'}</td>
          <td>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn-link" onclick="showToast('Invoice sent to ${i.email || 'buyer'}','ok')"><i class="ti ti-mail"></i> Mail</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

/* ── Invoice Listing ── */
function renderInvoiceListingTable() {
  const listings = window.appData.invoiceListing;
  if (!listings.length) return emptyState("ti-list", "No Invoice Listings", "Invoice records will appear once created.");
  return `<table>
    <thead><tr><th>Invoice No</th><th>Company</th><th>Contact</th><th>Email</th><th>Salesperson</th><th>GST</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
    <tbody>
      ${listings.map(i => `
        <tr>
          <td class="mono" style="font-weight:700">${i.id}</td>
          <td style="font-weight:600">${i.company || '—'}</td>
          <td style="color:var(--text-muted)">${i.contact || '—'}</td>
          <td style="color:var(--text-muted);font-size:12px">${i.email || '—'}</td>
          <td style="color:var(--text-muted)">${i.salesperson || '—'}</td>
          <td class="mono" style="font-size:11.5px;color:var(--text-muted)">${i.gst || '—'}</td>
          <td style="font-weight:700">${window.utils.fmtCurrency(i.amount)}</td>
          <td><span class="spill ${i.status === 'Paid' ? 'pill-success' : 'pill-warning'}"><span class="pill-dot"></span>${i.status || '—'}</span></td>
          <td class="mono" style="color:var(--text-muted)">${i.date || '—'}</td>
          <td>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn-link" onclick="showToast('Invoice sent to ${i.email || 'client'}','ok')"><i class="ti ti-mail"></i> Mail</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

/* ── Credit Notes ── */
function renderCreditNotesTable() {
  setTimeout(() => renderCreditInner(), 0);
  return `
    <div class="subtabs" style="padding:16px 16px 0 16px;">
      ${["Pending", "Approved", "Rejected"].map(s => `
        <button class="detail-tab ${creditTab === s ? 'active' : ''}" onclick="setCreditTab('${s}')">${s}</button>
      `).join('')}
    </div>
    <div id="credit-table-inner"></div>
  `;
}
window.setCreditTab = function (t) { creditTab = t; renderCreditInner(); }

function renderCreditInner() {
  const notes = window.appData.credit.filter(c => c.status === creditTab);
  const container = document.getElementById("credit-table-inner");
  if (!container) return;
  if (!notes.length) { container.innerHTML = emptyState("ti-file-minus", `No ${creditTab} Credit Notes`, "Credit note requests will appear here."); return; }
  container.innerHTML = `
    <table>
      <thead><tr><th>Note ID</th><th>Txn ID</th><th>User</th><th>Email</th><th>Amount</th><th>Reason</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        ${notes.map(n => `
          <tr>
            <td class="mono" style="font-weight:700">${n.id}</td>
            <td class="mono" style="color:var(--text-muted)">${n.txId || '—'}</td>
            <td style="font-weight:600">${n.user || '—'}</td>
            <td style="color:var(--text-muted);font-size:12px">${n.email || '—'}</td>
            <td style="font-weight:700;color:var(--accent)">${window.utils.fmtCurrency(n.amount)}</td>
            <td style="color:var(--text-muted)">${n.reason || '—'}</td>
            <td class="mono" style="color:var(--text-muted)">${n.date || '—'}</td>
            <td>
              <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <button class="btn-link" onclick="showToast('Credit note sent to ${n.email || 'user'}','ok')" style="margin-right:4px;">
                  <i class="ti ti-mail"></i> Mail
                </button>
                ${creditTab === 'Pending' ? `
                  <button class="btn btn-sm btn-primary" onclick="changeCreditStatus('${n.id}','Approved')">Approve</button>
                  <button class="btn btn-sm btn-ghost" onclick="changeCreditStatus('${n.id}','Rejected')">Reject</button>
                ` : ''}
                ${creditTab === 'Approved' ? `
                  <button class="btn btn-sm ${n.refundIssued ? 'btn-secondary' : 'btn-primary'}" onclick="markRefundIssued('${n.id}')" ${n.refundIssued ? 'disabled' : ''}>
                    <i class="ti ti-${n.refundIssued ? 'check' : 'send'}"></i> ${n.refundIssued ? 'Refund Issued' : 'Mark Refund Issued'}
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.changeCreditStatus = function (id, st) {
  const note = window.appData.credit.find(c => c.id === id);
  if (note) { note.status = st; window.saveData(); renderCreditInner(); showToast(`Credit note ${st.toLowerCase()}.`, st === 'Approved' ? 'ok' : 'warn'); }
}
window.markRefundIssued = function (id) {
  const note = window.appData.credit.find(c => c.id === id);
  if (note) { note.refundIssued = true; window.saveData(); renderCreditInner(); showToast('Refund marked as issued.', 'ok'); }
}

/* ── Offline Payments ── */
function renderOfflineTable() {
  setTimeout(() => renderOfflineInner(), 0);
  return `
    <div class="subtabs" style="padding:16px 16px 0 16px;">
      ${["Pending", "Verified", "Rejected"].map(s => `
        <button class="detail-tab ${offlineTab === s ? 'active' : ''}" onclick="setOfflineTab('${s}')">${s}</button>
      `).join('')}
    </div>
    <div id="offline-table-inner"></div>
  `;
}
window.setOfflineTab = function (t) { offlineTab = t; renderOfflineInner(); }

function renderOfflineInner() {
  const payments = window.appData.offline.filter(o => o.status === offlineTab);
  const container = document.getElementById("offline-table-inner");
  if (!container) return;
  if (!payments.length) { container.innerHTML = emptyState("ti-bank", "No Offline Payments", `No ${offlineTab.toLowerCase()} offline payments found.`); return; }
  container.innerHTML = `
    <table>
      <thead><tr><th>Ref ID</th><th>Client</th><th>UTR / Ref</th><th>Method</th><th>Bank / Details</th><th>Amount</th><th>Date</th>${offlineTab === 'Rejected' ? '<th>Reason</th>' : ''}<th>Action</th></tr></thead>
      <tbody>
        ${payments.map(o => `
          <tr>
            <td class="mono" style="font-weight:700">${o.id}</td>
            <td style="font-weight:600">${o.client || o.user || '—'}</td>
            <td class="mono" style="font-size:11.5px;color:var(--text-muted)">${o.utr || '—'}</td>
            <td style="color:var(--text-muted)">${o.method || '—'}</td>
            <td style="color:var(--text-muted);font-size:12px">${o.details || '—'}</td>
            <td style="font-weight:700;color:var(--ok)">${window.utils.fmtCurrency(o.amount)}</td>
            <td class="mono" style="color:var(--text-muted)">${o.date}</td>
            ${offlineTab === 'Rejected' ? `<td style="color:var(--warn);font-size:12px">${o.reason || '—'}</td>` : ''}
            <td>
              ${offlineTab === 'Pending' ? `<button class="btn btn-sm btn-primary" onclick="changeOfflineStatus('${o.id}','Verified')">Verify</button>` : ''}
              ${offlineTab === 'Verified' ? `<span style="color:var(--ok);font-size:12px;font-weight:700"><i class="ti ti-check"></i> Verified</span>` : ''}
              ${offlineTab === 'Rejected' ? `<span style="color:var(--accent-strong);font-size:12px;font-weight:700"><i class="ti ti-x"></i> Rejected</span>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.changeOfflineStatus = function (id, st) {
  const pay = window.appData.offline.find(o => o.id === id);
  if (pay) { pay.status = st; window.saveData(); renderOfflineInner(); showToast("Payment verified.", "ok"); }
}

/* ═════════════════════════════════════════════════
   EMPTY STATE HELPER
═════════════════════════════════════════════════ */
function emptyState(icon, title, desc, btnLabel, btnAction) {
  return `
    <div class="empty">
      <div class="ico"><i class="ti ${icon}"></i></div>
      <h4>${title}</h4>
      <p>${desc}</p>
      ${btnLabel ? `<button class="btn btn-primary" style="margin-top:4px" onclick="${btnAction}">${btnLabel}</button>` : ''}
    </div>
  `;
}

/* ═════════════════════════════════════════════════
   SCREEN 2: PAYMENT PAGES
═════════════════════════════════════════════════ */
function renderPaymentPages() {
  return `
    <div class="fade-in">
      ${renderPaymentMetrics()}

      <div style="display:flex; justify-content:flex-end; margin-bottom:14px; margin-top:4px;">
        <button class="btn btn-primary" onclick="openCreatePage()">
          <i class="ti ti-plus"></i> Create New Page
        </button>
      </div>

      <div class="panel">
        <div class="panel-body tight">
          <div id="pages-table-container"></div>
        </div>
      </div>
    </div>
  `;
}

function renderPagesTable() {
  const pages = window.appData.pages.filter(p => p.eventId === EVENT.id);
  const container = document.getElementById("pages-table-container");
  if (!container) return;

  if (pages.length === 0) {
    container.innerHTML = emptyState(
      "ti-credit-card-off",
      "No Payment Pages Yet",
      "Create your first checkout page to start accepting payments for this event.",
      "<i class='ti ti-plus'></i>&nbsp;Create First Page",
      "openCreatePage()"
    );
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Page Name &amp; Code</th>
          <th>Price</th>
          <th>Seats</th>
          <th>Revenue</th>
          <th>Registration Ends</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="pages-tbody">
        ${pages.map(p => renderPageRow(p)).join('')}
      </tbody>
    </table>
  `;
}

function renderPageRow(p) {
  const cCount = p.coupons ? p.coupons.length : 0;
  const isLive = p.liveOnSite !== false;
  const gst = Math.round(p.price * 1.18);

  // Seats sold = successful transactions for this page
  const soldTx = window.appData.transactions.filter(
    t => t.eventId === EVENT.id && (t.page === p.name || t.pageCode === p.code) && t.status === 'Success'
  );
  const sold = soldTx.length;
  const maxQty = p.maxQty || 0;
  const pct = maxQty > 0 ? Math.min(100, Math.round(sold / maxQty * 100)) : 0;
  const pageRev = soldTx.reduce((s, t) => s + t.amount, 0);

  // Days until sale closes
  let closeLabel = '—';
  if (p.saleEnd) {
    const daysLeft = Math.ceil((new Date(p.saleEnd) - new Date()) / 86400000);
    if (daysLeft < 0) closeLabel = `<span style="color:var(--accent-strong);font-size:11.5px">Closed</span>`;
    else if (daysLeft === 0) closeLabel = `<span style="color:var(--warn);font-size:11.5px">Closes today</span>`;
    else closeLabel = `<span style="font-size:11.5px">${daysLeft}d left</span>`;
  }

  return `
    <tr id="row-${p.id}">
      <td>
        <div style="font-weight:700">${p.name}</div>
        <div class="mono" style="color:var(--text-muted);font-size:11.5px;margin-top:2px;">${p.code}</div>
      </td>
      <td>
        <div style="font-weight:700">${window.utils.fmtCurrency(p.price, p.currency)}</div>
      </td>
      <td>
        <div style="font-size:12px;font-weight:700">${sold} / ${maxQty || '∞'}</div>
        ${maxQty > 0 ? `<div class="pg-progress-track"><div class="pg-progress-fill ${pct >= 90 ? 'pg-progress--warn' : ''}" style="width:${pct}%"></div></div>` : ''}
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${pct}% achieved</div>
      </td>
      <td>
        <div style="font-weight:700;color:var(--ok)">${window.utils.fmtCurrency(pageRev, p.currency)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sold} success</div>
      </td>
      <td>${closeLabel}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <button
            onclick="toggleLive('${p.id}',this)"
            title="${isLive ? 'Live – click to pause' : 'Draft – click to publish'}"
            style="position:relative;width:36px;height:20px;border-radius:999px;border:none;cursor:pointer;padding:0;flex-shrink:0;background:${isLive ? '#2F8F5B' : '#D1C9C8'};transition:background .2s">
            <span style="position:absolute;top:2px;${isLive ? 'left:18px' : 'left:2px'};width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:left .2s"></span>
          </button>
          <span class="live-label" style="font-size:12px;font-weight:700;color:${isLive ? '#2F8F5B' : '#A0908C'}">${isLive ? 'Live' : 'Draft'}</span>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-secondary btn-sm" title="Edit" onclick="editPage('${p.id}')"><i class="ti ti-pencil"></i></button>
          <button class="btn btn-secondary btn-sm" title="Add Coupon" onclick="openAddCouponModal('${p.id}')"><i class="ti ti-tag"></i></button>
          <button class="btn btn-secondary btn-sm" title="Copy Page URL" onclick="copyPageUrl('${p.id}')"><i class="ti ti-link"></i></button>
          <button class="btn btn-secondary btn-sm" title="Preview Page" onclick="previewPage('${p.id}')"><i class="ti ti-eye"></i></button>
        </div>
      </td>
    </tr>
  `;
}

window.removeCoupon = function (pageId, couponId) {
  const page = window.appData.pages.find(p => p.id === pageId);
  if (page) {
    page.coupons = page.coupons.filter(c => c.id !== couponId);
    window.saveData();
    renderPagesTable();
    showToast("Coupon removed.", "warn");
  }
}

window.toggleCoupon = function (pageId, couponId) {
  const page = window.appData.pages.find(p => p.id === pageId);
  if (!page) return;
  const coupon = page.coupons.find(c => c.id === couponId);
  if (!coupon) return;
  coupon.active = coupon.active === false ? true : false;
  window.saveData();
  renderPagesTable();
  showToast(coupon.active ? `Coupon "${coupon.label}" activated.` : `Coupon "${coupon.label}" deactivated.`, coupon.active ? "ok" : "warn");
}

window.toggleLive = function (id, btn) {
  const p = window.appData.pages.find(x => x.id === id);
  if (!p) return;
  p.liveOnSite = !p.liveOnSite;
  const isLive = p.liveOnSite;
  // Update track background
  btn.style.background = isLive ? '#2F8F5B' : '#D1C9C8';
  // Move knob
  const knob = btn.querySelector('span');
  if (knob) knob.style.left = isLive ? '18px' : '2px';
  // Update label
  const label = btn.parentElement ? btn.parentElement.querySelector('.live-label') : null;
  if (label) {
    label.textContent = isLive ? 'Live' : 'Draft';
    label.style.color = isLive ? '#2F8F5B' : '#A0908C';
  }
  window.saveData();
  showToast(isLive ? `"${p.name}" is now Live.` : `"${p.name}" set to Draft.`, isLive ? "ok" : "warn");
}

window.openCreatePage = function () {
  editingPageId = null;
  setScreen('create-page');
}

/* ═════════════════════════════════════════════════
   SCREEN 3: CREATE / EDIT PAGE
═════════════════════════════════════════════════ */
function renderCreatePageScreen() {
  const startIso = window.utils.nowDT();
  let endIso = startIso;
  try {
    const d = new Date(EVENT.date);
    d.setHours(23, 59, 59);
    endIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } catch (e) { }

  const isEditing = !!editingPageId;
  const title = isEditing ? "Edit Payment Page" : "Create Payment Page";
  const btnText = isEditing ? "Save Changes" : "Create Page";

  setTimeout(() => {
    populatePageDropdowns();
    if (isEditing) {
      const p = window.appData.pages.find(x => x.id === editingPageId);
      if (p) {
        document.getElementById("page-name").value = p.name || "";
        const descEl = document.getElementById("page-desc");
        if (descEl) descEl.value = p.description || "";
        document.getElementById("page-amount").value = p.price || "";
        if (p.currency) document.getElementById("page-currency").value = p.currency;
        const pnEl = document.getElementById("page-price-note");
        if (pnEl) pnEl.value = p.priceNote || "";
        const bnEl = document.getElementById("page-button-note");
        if (bnEl) bnEl.value = p.buttonNote || "";
      }
    }
    window.updateLivePreview();
  }, 0);

  return `
    <div class="fade-in create-page-grid">

      <!-- ── LEFT: FORM ── -->
      <div class="create-page-form" style="min-height:0;">
        <div style="padding:0 0 24px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <div class="crumb">Payment Pages</div>
            <h2 style="margin:0;font-size:22px;">${title}</h2>
            <div style="font-size:13px;color:var(--text-muted);margin-top:3px;">For ${EVENT.name}</div>
          </div>
          <button class="btn-icon" onclick="setScreen('pages')" aria-label="Cancel"><i class="ti ti-x"></i></button>
        </div>

        <div style="padding-right:4px;display:flex;flex-direction:column;gap:24px;flex:1;overflow-y:auto;">

          <!-- Page Identity -->
          <div class="form-section">
            <label class="field">
              <span class="field-label">Payment page name <span class="req">*</span></span>
              <input type="text" id="page-name" placeholder="e.g. VIP Pass" oninput="window.updateLivePreview()">
            </label>
            <label class="field" style="margin-top:16px;">
              <span class="field-label">Description</span>
              <textarea id="page-desc" placeholder="Add a description (each line becomes a bullet point)" rows="3" oninput="window.updateLivePreview()"></textarea>
              <span class="field-hint">Each line will appear as a bullet point on the checkout card.</span>
            </label>
          </div>

          <!-- Pricing -->
          <div class="form-section">
            <div class="form-section-header"><span class="fsec-title">Pricing &amp; Currency</span></div>
            <div class="two-col">
              <label class="field">
                <span class="field-label">Currency</span>
                <select id="page-currency" onchange="window.updateLivePreview()">
                  <option value="INR">INR — ₹</option>
                  <option value="USD">USD — $</option>
                  <option value="AED">AED</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">Amount (excl. GST) <span class="req">*</span></span>
                <input type="number" id="page-amount" placeholder="25000" oninput="window.updateLivePreview()">
              </label>
            </div>
            <label class="field" style="margin-top:16px;">
              <span class="field-label">Price note</span>
              <input type="text" id="page-price-note" placeholder="e.g. Per person, excl. GST" oninput="window.updateLivePreview()">
            </label>
          </div>

          <!-- Location -->
          <div class="form-section">
            <div class="form-section-header"><span class="fsec-title">Location</span></div>
            <div class="two-col">
              <label class="field">
                <span class="field-label">Country</span>
                <select id="page-country" onchange="updateStates()"></select>
              </label>
              <label class="field">
                <span class="field-label">State / Region</span>
                <select id="page-state"></select>
              </label>
            </div>
          </div>

          <!-- Validity -->
          <div class="form-section">
            <div class="form-section-header"><span class="fsec-title">Validity &amp; Fulfillment</span></div>
            <div class="two-col">
              <label class="field">
                <span class="field-label">Validity Start</span>
                <input type="datetime-local" id="page-sale-start" value="${startIso}">
              </label>
              <label class="field" style="margin-top:16px;">
              <span class="field-label">Validity End</span>
              <input type="datetime-local" id="page-sale-end" value="${endIso}" oninput="checkSaleEndWarning()">
            </label>
            <div id="sale-end-warning" class="callout warn-box" style="display:none;margin-top:8px">
              <i class="ti ti-alert-triangle" style="font-size:16px;flex-shrink:0"></i>
              <span>Sale end date is in the past — this page won't accept new payments.</span>
            </div>
              </label>
            </div>
            <label class="field" style="margin-top:16px;">
              <span class="field-label">Max quantity <span class="req">*</span></span>
              <input type="number" id="page-max-qty" value="100">
            </label>
            <label class="field" style="margin-top:16px;">
              <span class="field-label">Button note</span>
              <input type="text" id="page-button-note" placeholder="e.g. Secure payment via Stripe" oninput="window.updateLivePreview()">
            </label>
          </div>

          <div id="page-error" class="form-error" style="display:none;"></div>
        </div>

        <div style="padding:24px 4px 0;display:flex;gap:12px;flex-shrink:0;">
          <button class="btn btn-primary" onclick="savePage()">${btnText}</button>
          <button class="btn btn-secondary" onclick="setScreen('pages')">Cancel</button>
        </div>
      </div>

      <!-- ── RIGHT: LIVE PREVIEW ── -->
      <div class="create-page-preview">
        <div class="preview-header">Live Preview</div>
        <div class="preview-card-wrap">
          <div class="preview-mockup">
            <div class="mockup-body" style="padding-bottom:12px;">
              <div class="mockup-title" id="preview-page-name">Page Name</div>
              <div class="mockup-price" id="preview-price" style="margin-bottom:4px;">${window.utils.fmtCurrency(0, "INR")}</div>
              <div id="preview-gst" style="font-size:11px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:4px;min-height:0"></div>
              <div id="preview-price-note" style="text-align:center;font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:4px;font-style:italic;min-height:0"></div>
              <div id="preview-page-desc-container" style="margin-top:8px;"></div>
              <div class="mockup-divider"></div>
              <div class="mockup-btn-wrap has-coupon" id="preview-btn-wrap">
                <div class="mockup-coupon-box" id="preview-coupon-box">
                  20% Early Bird Off applied automatically
                </div>
                <button class="mockup-btn">Reserve My Seat</button>
              </div>
              <div id="preview-button-note" style="text-align:center;font-size:11px;color:rgba(255,255,255,0.55);min-height:0"></div>
            </div>
          </div>
        </div>
        <div style="padding:10px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--text-muted);line-height:1.6">
          <strong style="color:var(--text);display:block;margin-bottom:3px">Preview Note</strong>
          Live preview of the buyer-facing checkout card. Reflects name, price, description bullets, and notes.
        </div>
      </div>

    </div>
  `;
}

window.updateLivePreview = function () {
  const name = document.getElementById("page-name")?.value || "";
  const amt = parseInt(document.getElementById("page-amount")?.value || "0");
  const curr = document.getElementById("page-currency")?.value || "INR";
  const desc = document.getElementById("page-desc")?.value || "";
  const priceNote = document.getElementById("page-price-note")?.value || "";
  const btnNote = document.getElementById("page-button-note")?.value || "";

  const pName = document.getElementById("preview-page-name");
  const pPrice = document.getElementById("preview-price");
  const pGst = document.getElementById("preview-gst");
  const pTax = document.getElementById("preview-tax");
  const pPriceNote = document.getElementById("preview-price-note");
  const pBtnNote = document.getElementById("preview-button-note");
  const pDescCont = document.getElementById("preview-page-desc-container");

  if (pName) pName.textContent = name || "Page Name";

  // Check for auto coupons
  let showCoup = false;
  let coupTxt = "";
  let finalAmt = amt;

  if (editingPageId) {
    const existing = window.appData.pages.find(x => x.id === editingPageId);
    if (existing && existing.coupons) {
      const autoCoup = existing.coupons.find(c => c.type === 'auto' && c.showDesc !== false);
      if (autoCoup && autoCoup.descText) {
        showCoup = true;
        coupTxt = autoCoup.descText;
        if (autoCoup.discountType === 'percent') {
          finalAmt = Math.max(0, amt - (amt * (autoCoup.discount / 100)));
        } else {
          finalAmt = Math.max(0, amt - autoCoup.discount);
        }
      }
    }
  }

  if (pPrice) {
    if (showCoup && amt > 0) {
      pPrice.innerHTML = `<span style="text-decoration:line-through; font-size:16px; color:var(--text-faint); margin-right:8px">${window.utils.fmtCurrency(amt, curr)}</span>${window.utils.fmtCurrency(finalAmt, curr)}`;
    } else {
      pPrice.textContent = window.utils.fmtCurrency(amt || 0, curr);
    }
  }

  // GST line — always rendered, empty text collapses naturally
  if (pGst) {
    pGst.textContent = '';
  }
  if (pTax) {
    pTax.textContent = finalAmt > 0
      ? window.utils.fmtCurrency(Math.round(finalAmt * 0.18), curr)
      : 'Calculated at checkout';
  }

  // Price note — always rendered, empty collapses
  if (pPriceNote) {
    pPriceNote.textContent = priceNote;
  }

  // Button note — always rendered, empty collapses
  if (pBtnNote) {
    pBtnNote.textContent = btnNote;
  }

  // Coupon box
  const pBtnWrap = document.getElementById("preview-btn-wrap");
  const pCouponBox = document.getElementById("preview-coupon-box");
  if (pBtnWrap && pCouponBox) {
    if (showCoup && coupTxt.trim()) {
      pCouponBox.style.display = "block";
      pCouponBox.textContent = coupTxt;
      pBtnWrap.classList.add("has-coupon");
    } else {
      pCouponBox.style.display = "none";
      pBtnWrap.classList.remove("has-coupon");
    }
  }

  // Description bullets — always rendered, shows/hides list
  if (pDescCont) {
    if (desc.trim()) {
      const points = desc.split('\n').filter(pt => pt.trim());
      pDescCont.innerHTML = points.length > 0
        ? '<ul style="margin:6px 0 0 0;padding-left:18px;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.7">' +
        points.map(pt => `<li>${pt.trim()}</li>`).join('') + '</ul>'
        : '';
    } else {
      pDescCont.innerHTML = '';
    }
  }
}

window.editPage = function (id) {
  editingPageId = id;
  setScreen('create-page');
}

function populatePageDropdowns() {
  const cSel = document.getElementById("page-country");
  if (cSel && window.appData.countries) {
    cSel.innerHTML = Object.keys(window.appData.countries).map(c => `<option value="${c}">${c}</option>`).join('');
    updateStates();
  }
  updateMerchants();
  checkSaleEndWarning();
}

window.updateMerchants = function () {
  const gSel = document.getElementById("page-gateway");
  const mSel = document.getElementById("page-merchant");
  if (!gSel || !mSel) return;
  const merchants = window.appData.gateways[gSel.value] || [];
  mSel.innerHTML = merchants.map(m => `<option value="${m}">${m}</option>`).join('');
}

window.checkSaleEndWarning = function () {
  const endEl = document.getElementById("page-sale-end");
  const warn = document.getElementById("sale-end-warning");
  if (!endEl || !warn) return;
  const past = endEl.value && new Date(endEl.value) < new Date();
  warn.style.display = past ? 'flex' : 'none';
}

window.updateStates = function () {
  const c = document.getElementById("page-country");
  if (!c) return;
  const list = window.appData.countries[c.value] || [];
  const sSel = document.getElementById("page-state");
  if (sSel) sSel.innerHTML = list.map(s => `<option value="${s}">${s}</option>`).join('');
}

window.savePage = function () {
  const name = document.getElementById("page-name")?.value?.trim();
  const desc = document.getElementById("page-desc")?.value || "";
  const priceNote = document.getElementById("page-price-note")?.value || "";
  const btnNote = document.getElementById("page-button-note")?.value || "";
  const amt = document.getElementById("page-amount")?.value;
  const err = document.getElementById("page-error");

  if (!name) {
    err.style.display = "flex";
    err.innerHTML = `<i class="ti ti-alert-circle"></i> Payment page name is required.`;
    return;
  }
  if (!amt || Number(amt) <= 0) {
    err.style.display = "flex";
    err.innerHTML = `<i class="ti ti-alert-circle"></i> Enter a valid amount.`;
    return;
  }
  err.style.display = "none";

  if (editingPageId) {
    const existing = window.appData.pages.find(x => x.id === editingPageId);
    if (existing) {
      existing.name = name;
      existing.description = desc;
      existing.priceNote = priceNote;
      existing.buttonNote = btnNote;
      existing.price = parseInt(amt);
      existing.currency = document.getElementById("page-currency")?.value || "INR";
    }
    window.saveData();
    editingPageId = null;
    setScreen('pages');
    showToast(`"${name}" updated successfully.`, "ok");
  } else {
    const newId = "page_" + Math.random().toString(36).substr(2, 6);
    window.appData.pages.push({
      id: newId,
      eventId: EVENT.id,
      name,
      description: desc,
      priceNote,
      buttonNote: btnNote,
      code: "PG" + Math.floor(1000 + Math.random() * 9000),
      currency: document.getElementById("page-currency")?.value || "INR",
      price: parseInt(amt),
      gateway: "Stripe",
      merchant: "Global Payments Ltd",
      country: document.getElementById("page-country")?.value || "",
      state: document.getElementById("page-state")?.value || "",
      saleStart: document.getElementById("page-sale-start")?.value || "",
      saleEnd: document.getElementById("page-sale-end")?.value || "",
      maxQty: parseInt(document.getElementById("page-max-qty")?.value || "100"),
      liveOnSite: true,
      coupons: []
    });
    window.saveData();
    editingPageId = null;
    setScreen('pages');
    showToast(`"${name}" created! You can add another page anytime.`, "ok");
  }
}

/* ═════════════════════════════════════════════════
   PAGE PREVIEW MODAL
═════════════════════════════════════════════════ */
window.previewPage = function (pageId) {
  const p = window.appData.pages.find(x => x.id === pageId);
  if (!p) return;

  document.getElementById("pm-page-name").textContent = p.name || "Page Name";

  let showCoup = false;
  let coupTxt = "";
  let finalAmt = p.price || 0;

  if (p.coupons) {
    const autoCoup = p.coupons.find(c => c.type === 'auto' && c.showDesc !== false);
    if (autoCoup && autoCoup.descText) {
      showCoup = true;
      coupTxt = autoCoup.descText;
      if (autoCoup.discountType === 'percent') {
        finalAmt = Math.max(0, p.price - (p.price * (autoCoup.discount / 100)));
      } else {
        finalAmt = Math.max(0, p.price - autoCoup.discount);
      }
    }
  }

  const pPrice = document.getElementById("pm-price");
  if (showCoup && p.price > 0) {
    pPrice.innerHTML = `<span style="text-decoration:line-through; font-size:16px; color:var(--text-faint); margin-right:8px">${window.utils.fmtCurrency(p.price, p.currency || 'INR')}</span>${window.utils.fmtCurrency(finalAmt, p.currency || 'INR')}`;
  } else {
    pPrice.textContent = window.utils.fmtCurrency(p.price || 0, p.currency || 'INR');
  }

  const pGst = document.getElementById("pm-gst");
  pGst.textContent = '';

  document.getElementById("pm-price-note").textContent = p.priceNote || "";
  document.getElementById("pm-button-note").textContent = p.buttonNote || "";

  const descCont = document.getElementById("pm-desc-container");
  if (p.description && p.description.trim()) {
    const points = p.description.split('\n').filter(pt => pt.trim());
    descCont.innerHTML = points.length > 0 ? '<ul style="margin:6px 0 0 0;padding-left:18px;font-size:12px;color:rgba(255,255,255,0.6);line-height:1.7">' + points.map(pt => `<li>${pt.trim()}</li>`).join('') + '</ul>' : '';
  } else {
    descCont.innerHTML = '';
  }

  const btnWrap = document.getElementById("pm-btn-wrap");
  const coupBox = document.getElementById("pm-coupon-box");
  if (showCoup && coupTxt.trim()) {
    coupBox.style.display = "block";
    coupBox.textContent = coupTxt;
    btnWrap.classList.add("has-coupon");
  } else {
    coupBox.style.display = "none";
    btnWrap.classList.remove("has-coupon");
  }

  document.getElementById("page-preview-modal").style.display = "flex";
}

/* ═════════════════════════════════════════════════
   COUPON MODAL
═════════════════════════════════════════════════ */
window.updateCouponDesc = function () {
  const dType = document.getElementById("coupon-discount-type")?.value;
  const dVal = document.getElementById("coupon-discount")?.value;
  const descEl = document.getElementById("coupon-desc-text");

  if (!descEl) return;

  if (!dVal || isNaN(dVal) || Number(dVal) <= 0) {
    descEl.value = "";
    return;
  }

  let text = "";
  if (dType === "percent") {
    text = `${dVal}% off applied automatically`;
  } else {
    text = `₹${dVal} off applied automatically`;
  }
  descEl.value = text;
}

window.openAddCouponModal = function (pageId) {
  activeCouponPage = null; // No longer tied to single page
  const subtitle = document.getElementById("coupon-modal-subtitle");
  if (subtitle) subtitle.textContent = "Set up a promotional code for your pages";

  let pages = window.appData.pages.filter(p => p.eventId === EVENT.id);
  const pagesCheckboxes = document.getElementById('coupon-pages-checkboxes');
  if (pagesCheckboxes) {
    if (pages.length === 0) {
      pagesCheckboxes.innerHTML = `<span class="field-hint">No pages found. Please create a payment page first.</span>`;
    } else {
      pagesCheckboxes.innerHTML = pages.map(p => `
        <label class="checkline" style="margin-top:4px; display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="coupon-pages" value="${p.id}" ${(!pageId || p.id === pageId) ? 'checked' : ''}>
          <span style="font-size: 13px; color: var(--text);">${p.name}</span>
        </label>
      `).join('');
    }
  }

  allCouponCodes = window.appData.pages.flatMap(x =>
    (x.coupons || []).filter(c => c.type === 'code').map(c => c.code)
  );

  const lbl = document.getElementById("coupon-label");
  const disc = document.getElementById("coupon-discount");
  const warn = document.getElementById("coupon-warning");
  const cErr = document.getElementById("coupon-error");
  const minQty = document.getElementById("coupon-min-qty");
  if (lbl) lbl.value = "";
  if (disc) disc.value = "";
  if (minQty) minQty.value = "";
  if (warn) warn.style.display = "none";
  if (cErr) cErr.style.display = "none";

  const startIso = window.utils.nowDT();
  let endIso = startIso;
  try {
    const d = new Date(EVENT.date);
    d.setHours(23, 59, 59);
    endIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } catch (e) { }
  const cs = document.getElementById("coupon-start");
  const ce = document.getElementById("coupon-end");
  if (cs) cs.value = startIso;
  if (ce) ce.value = endIso;

  const dType = document.getElementById("coupon-discount-type");
  if (dType) dType.value = "percent";
  window.updateDiscountLabel();
  
  // Apply Early Bird template by default
  const earlyBirdBtn = document.querySelector('#coupon-templates button');
  if(earlyBirdBtn) window.applyCouponTemplate('earlybird', earlyBirdBtn);

  document.getElementById("add-coupon-modal").style.display = "flex";
}

window.closeAddCouponModal = function () {
  document.getElementById("add-coupon-modal").style.display = "none";
}

function setCouponType(type) {
  currentCouponType = type;
  document.getElementById("btn-type-auto").classList.toggle("active", type === "auto");
  document.getElementById("btn-type-code").classList.toggle("active", type === "code");

  const hint = document.getElementById("coupon-type-hint");
  if (type === "code") {
    if (hint) hint.textContent = "Users must enter this code at checkout to claim the discount.";
  } else {
    if (hint) hint.textContent = "Applied automatically — no code entry needed (Tracking code used for reporting).";
  }
}
window.setCouponType = setCouponType;

window.applyCouponTemplate = function(templateId, btnEl) {
  if (btnEl) {
    document.querySelectorAll('#coupon-templates button').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }

  const label = document.getElementById("coupon-label");
  const disc = document.getElementById("coupon-discount");
  const discType = document.getElementById("coupon-discount-type");
  const minQty = document.getElementById("coupon-min-qty");
  const maxUser = document.getElementById("coupon-max-user");
  const maxUses = document.getElementById("coupon-max-uses");
  const codeSelect = document.getElementById("coupon-code");

  let codes = [];
  
  if (templateId === 'earlybird') {
    if(label) label.value = "Early Bird";
    if(discType) discType.value = "percent";
    if(disc) disc.value = "15";
    if(minQty) minQty.value = "";
    if(maxUser) maxUser.value = "1";
    if(maxUses) maxUses.value = "";
    codes = ["FLOCK25", "FIRSTWING", "DAWNRUN10", "EARLYB26"];
    setCouponType('auto');
  } else if (templateId === 'bogo') {
    if(label) label.value = "Buy 1 Get 1";
    if(discType) discType.value = "percent";
    if(disc) disc.value = "50";
    if(minQty) minQty.value = "2";
    if(maxUser) maxUser.value = "1";
    if(maxUses) maxUses.value = "";
    codes = ["TWINSTACK", "PAIRUP25", "DUOGRID", "TWOFONE"];
    setCouponType('auto');
  } else if (templateId === 'buy2get1') {
    if(label) label.value = "Buy 2 Get 1";
    if(discType) discType.value = "percent";
    if(disc) disc.value = "33.33";
    if(minQty) minQty.value = "3";
    if(maxUser) maxUser.value = "1";
    if(maxUses) maxUses.value = "";
    codes = ["TRIOGATE", "TRIPLESTACK", "THIRDFREE", "TRIOLOCK25", "TWOPLUS", "THIRDWAVE", "ODDLOT3"];
    setCouponType('auto');
  } else {
    // Custom
    if(label) label.value = "";
    if(discType) discType.value = "percent";
    if(disc) disc.value = "";
    if(minQty) minQty.value = "";
    if(maxUser) maxUser.value = "1";
    if(maxUses) maxUses.value = "";
    codes = [];
  }
  window.updateDiscountLabel();
  window.updateCouponDesc();

  // Populate code dropdown
  if (codeSelect) {
    codeSelect.innerHTML = '';
    if (codes.length > 0) {
      codes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        codeSelect.appendChild(opt);
      });
    } else {
      window.regenerateCouponCode();
    }
  }
}
window.setCouponType = setCouponType;

window.regenerateCouponCode = function () {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  const sel = document.getElementById("coupon-code");
  if (sel) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    sel.appendChild(opt);
    sel.value = code;
  }
}

window.updateDiscountLabel = function () {
  const type = document.getElementById("coupon-discount-type")?.value;
  const label = document.getElementById("discount-val-label");
  const input = document.getElementById("coupon-discount");
  if (!type || !label) return;
  label.innerHTML = type === 'percent'
    ? 'Percentage (max 30%) <span class="req">*</span>'
    : 'Flat Amount (₹) <span class="req">*</span>';
  if (input) input.placeholder = type === 'percent' ? '15' : '500';
  checkDiscountWarning();
}

window.checkDiscountWarning = function () {
  const type = document.getElementById("coupon-discount-type")?.value;
  const val = parseInt(document.getElementById("coupon-discount")?.value || "0");
  const warn = document.getElementById("coupon-warning");
  const btn = document.getElementById("btn-save-coupon");
  const show = type === 'percent' && val > 30;
  if (warn) warn.style.display = show ? "flex" : "none";
  if (btn) btn.textContent = show ? "Request Approval" : "Activate Coupon";
}
function checkDiscountWarning() { window.checkDiscountWarning(); }

window.saveCoupon = function () {
  const label = document.getElementById("coupon-label")?.value?.trim();
  const disc = document.getElementById("coupon-discount")?.value;
  const type = document.getElementById("coupon-discount-type")?.value;
  const code = document.getElementById("coupon-code")?.value || "";
  const end = document.getElementById("coupon-end")?.value;
  const start = document.getElementById("coupon-start")?.value;
  const maxUses = document.getElementById("coupon-max-uses")?.value;
  const maxUser = document.getElementById("coupon-max-user")?.value;
  const minQty = document.getElementById("coupon-min-qty")?.value;
  const showDesc = document.getElementById("coupon-show-desc")?.checked;
  const descText = document.getElementById("coupon-desc-text")?.value || "";
  const err = document.getElementById("coupon-error");

  if (!label) {
    if (err) { err.style.display = "flex"; err.innerHTML = `<i class="ti ti-alert-circle"></i> Give this coupon a label.`; }
    return;
  }
  if (!disc || Number(disc) <= 0) {
    if (err) { err.style.display = "flex"; err.innerHTML = `<i class="ti ti-alert-circle"></i> Enter a valid discount value.`; }
    return;
  }
  if (err) err.style.display = "none";

  const selectedPagesIds = Array.from(document.querySelectorAll('input[name="coupon-pages"]:checked')).map(cb => cb.value);
  if (selectedPagesIds.length === 0) {
    if (err) { err.style.display = "flex"; err.innerHTML = `<i class="ti ti-alert-circle"></i> Select at least one payment page.`; }
    return;
  }

  selectedPagesIds.forEach(pageId => {
    const p = window.appData.pages.find(x => x.id === pageId);
    if (p) {
      if (currentCouponType === 'auto') {
        p.coupons = (p.coupons || []).filter(c => c.type !== 'auto');
      }
      p.coupons = p.coupons || [];
      p.coupons.push({
        id: "coup_" + Math.random().toString(36).substr(2, 6),
        type: currentCouponType,
        label,
        code,
        discountType: type,
        discount: parseInt(disc),
        start,
        end,
        maxUses: maxUses ? parseInt(maxUses) : 0,
        maxPerUser: maxUser ? parseInt(maxUser) : 1,
        minQty: minQty ? parseInt(minQty) : 0,
        showDesc: showDesc,
        descText: descText,
        used: 0,
        active: true
      });
    }
  });

  window.saveData();
  renderScreen();
  showToast(`Coupon "${label}" created.`, "ok");
  window.closeAddCouponModal();
}

/* Embed code removed — use copyPageUrl instead */

window.copyPageUrl = function (pageId) {
  const p = window.appData.pages.find(x => x.id === pageId);
  if (!p) return;
  const url = `https://pay.etevents.com/${p.code}`;
  navigator.clipboard.writeText(url).then(() => showToast("Page URL copied.", "ok"));
}

window.copyPromoLink = function (pageId, couponCode) {
  const p = window.appData.pages.find(x => x.id === pageId);
  if (!p) return;
  let url = `https://pay.etevents.com/${p.code}`;
  if (couponCode) {
    url += `?coupon=${couponCode}`;
  }
  navigator.clipboard.writeText(url).then(() => showToast("Promo link copied.", "ok"));
}

/* ═════════════════════════════════════════════════
   BOOT
═════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderScreen();
});
