/* index.js — Payment Prototype: Inside-Event View (CMS Theme) */

/* ═════════════════════════════════════════════════
   STATE
═════════════════════════════════════════════════ */
let activeDetailsTab = "transactions";
let txFilter = "All";
let txSearch = "";
let creditTab = "Pending";
let offlineTab = "Pending";

let extraFields = [{ key: "", value: "" }];
let activeCouponPage = null;
let currentCouponType = "auto";
let expandedPages = {};

window.toggleInitialCoupon = function(checked) {
  document.getElementById("initial-coupon-fields").style.display = checked ? "block" : "none";
}

window.toggleExpand = function(id) {
  expandedPages[id] = !expandedPages[id];
  renderPagesTable();
}

window.removeCoupon = function(pageId, couponId) {
  if (confirm("Remove this coupon?")) {
    const page = window.appData.pages.find(p => p.id === pageId);
    if (page) {
      page.coupons = page.coupons.filter(c => c.id !== couponId);
      window.saveData();
      renderPagesTable();
    }
  }
}
let allCouponCodes = [];

const EVENT = window.CURRENT_EVENT;

/* ═════════════════════════════════════════════════
   SCREEN ROUTER
═════════════════════════════════════════════════ */
function renderHeader() {
  const container = document.getElementById("header-container");
  if (!container) return;
  container.innerHTML = `
    <a class="back-btn" href="../revamp-cms/edit-event.html?event=${EVENT.id}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      Back to events
    </a>
    <span class="ev-title">
      <h1>${EVENT.name}</h1>
      <span class="meta">${EVENT.date} &middot; ${EVENT.location} &middot; ${EVENT.vertical}</span>
    </span>
    <span class="topbar-acts">
      <button class="btn btn-secondary" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>
        Preview
      </button>
      <button class="btn btn-primary" type="button">Publish</button>
    </span>
  `;
}

function renderPaymentMetrics() {
  const eventPages = window.appData.pages.filter(p => p.eventId === EVENT.id);
  const eventTx = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  const successTx = eventTx.filter(t => t.status === "Success");
  const totalRevenue = successTx.reduce((s, t) => s + t.amount, 0);

  return `
      <div class="vhead">
        <div>
          <div class="vhead-sub">PAYMENT MODULE</div>
          <h2 class="vhead-title">Overview & Activity</h2>
        </div>
        <div class="vhead-acts">
          <button class="btn btn-secondary" onclick="window.location.reload()"><i class="ti ti-refresh"></i> Refresh</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat">
          <div class="eyebrow">Payment Pages</div>
          <div class="val">${eventPages.length}</div>
        </div>
        <div class="stat">
          <div class="eyebrow">Total Transactions</div>
          <div class="val">${successTx.length}</div>
        </div>
        <div class="stat">
          <div class="eyebrow">Gross Revenue</div>
          <div class="val" style="color:var(--ok)">${window.utils.fmtCurrency(totalRevenue)}</div>
        </div>
      </div>
  `;
}

function renderScreen() {
  renderHeader();
  const content = document.getElementById("app-content");

  if (activeScreen === "details") {
    content.innerHTML = renderPaymentDetails();
    postRenderDetails();
  } else if (activeScreen === "pages") {
    content.innerHTML = renderPaymentPages();
    renderPagesTable();
  } else if (activeScreen === "create-page") {
    content.innerHTML = renderCreatePageScreen();
  }
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
          <div class="subtabs" style="padding: 16px 16px 0 16px;">
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

function postRenderDetails() {
  renderDetailsTabContent();
}

function switchDetailsTab(tabId) {
  activeDetailsTab = tabId;
  document.querySelectorAll('.detail-tab').forEach(btn => {
    if (btn.getAttribute('onclick').includes(`'${tabId}'`)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
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
function renderTransactionsTable() {
  const html = `
    <div class="toolbar" style="padding-top:16px;">
      <div class="search-wrap">
        <i class="ti ti-search" style="color:var(--text-muted)"></i>
        <input type="text" class="search-input" id="tx-search" placeholder="Search ID or page..." value="${txSearch}" oninput="updateTxSearch(this.value)">
      </div>
      <div class="chip-group" id="tx-filters">
        ${["All","Success","Failed","Incomplete"].map(s => `
          <button class="chip ${txFilter === s ? 'active' : ''}" onclick="setTxFilter('${s}')">${s}</button>
        `).join('')}
      </div>
    </div>
    <div id="tx-table-inner"></div>
  `;
  setTimeout(() => renderTxInner(), 0);
  return html;
}

function renderTxInner() {
  let txs = window.appData.transactions.filter(t => t.eventId === EVENT.id);
  if (txFilter !== "All") txs = txs.filter(t => t.status === txFilter);
  if (txSearch) txs = txs.filter(t => t.id.toLowerCase().includes(txSearch.toLowerCase()) || t.page.toLowerCase().includes(txSearch.toLowerCase()));

  const container = document.getElementById("tx-table-inner");
  if (!container) return;

  if (txs.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No transactions match this filter.</div>`;
    return;
  }

  const getPillClass = (s) => ({ Success: "pill-success", Failed: "pill-danger", Incomplete: "pill-warning" }[s] || "pill-neutral");

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Txn ID</th><th>Page</th><th>Mode</th><th>Status</th><th>Merchant</th><th>Amount</th><th>Date</th></tr>
      </thead>
      <tbody>
        ${txs.map(t => `
          <tr>
            <td class="mono">${t.id}</td>
            <td style="font-weight:700">${t.page}</td>
            <td style="color:var(--text-muted)">${t.mode}</td>
            <td><span class="spill ${getPillClass(t.status)}"><span class="pill-dot"></span>${t.status}</span></td>
            <td style="color:var(--text-muted)">${t.merchant}</td>
            <td style="font-weight:700;color:var(--accent)">${window.utils.fmtCurrency(t.amount)}</td>
            <td class="mono" style="color:var(--text-muted)">${t.date}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.setTxFilter = function(f) { txFilter = f; renderTransactionsTable(); }
window.updateTxSearch = function(val) { txSearch = val; renderTxInner(); }

/* ── Tax Invoice, Invoice Listing, Credit Notes, Offline ── */
function renderTaxInvoiceTable() {
  return `
    <table>
      <thead><tr><th>Invoice No</th><th>Txn ID</th><th>Name</th><th>Email</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        ${window.appData.invoices.map(i => `
          <tr>
            <td class="mono" style="font-weight:700">${i.id}</td>
            <td class="mono" style="color:var(--text-muted)">${i.txId}</td>
            <td style="font-weight:600">${i.name}</td>
            <td style="color:var(--text-muted)">${i.email}</td>
            <td style="font-weight:700">${window.utils.fmtCurrency(i.amount)}</td>
            <td class="mono" style="color:var(--text-muted)">${i.date}</td>
            <td><button class="btn-link"><i class="ti ti-download"></i> PDF</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderInvoiceListingTable() {
  return `
    <table>
      <thead><tr><th>Invoice No</th><th>Company</th><th>Contact</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        ${window.appData.invoiceListing.map(i => `
          <tr>
            <td class="mono" style="font-weight:700">${i.id}</td>
            <td style="font-weight:600">${i.company}</td>
            <td style="color:var(--text-muted)">${i.contact}</td>
            <td style="font-weight:700">${window.utils.fmtCurrency(i.amount)}</td>
            <td><span class="spill ${i.status === 'Paid' ? 'pill-success' : 'pill-warning'}"><span class="pill-dot"></span>${i.status}</span></td>
            <td class="mono" style="color:var(--text-muted)">${i.date}</td>
            <td><button class="btn-link"><i class="ti ti-send"></i> Resend</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderCreditNotesTable() {
  const html = `
    <div class="subtabs" style="padding: 16px 16px 0 16px;">
      ${["Pending", "Approved", "Rejected"].map(s => `
        <button class="detail-tab ${creditTab === s ? 'active' : ''}" onclick="setCreditTab('${s}')">${s}</button>
      `).join('')}
    </div>
    <div id="credit-table-inner"></div>
  `;
  setTimeout(() => renderCreditInner(), 0);
  return html;
}
window.setCreditTab = function(t) { creditTab = t; renderCreditNotesTable(); }

function renderCreditInner() {
  const notes = window.appData.credit.filter(c => c.status === creditTab);
  const container = document.getElementById("credit-table-inner");
  if (!container) return;

  if (notes.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No ${creditTab.toLowerCase()} credit notes.</div>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Note ID</th><th>Txn ID</th><th>User</th><th>Amount</th><th>Reason</th><th>Date</th>${creditTab === 'Pending' ? '<th>Action</th>' : ''}</tr></thead>
      <tbody>
        ${notes.map(n => `
          <tr>
            <td class="mono" style="font-weight:700">${n.id}</td>
            <td class="mono" style="color:var(--text-muted)">${n.txId}</td>
            <td style="font-weight:600">${n.user}</td>
            <td style="font-weight:700;color:var(--accent)">${window.utils.fmtCurrency(n.amount)}</td>
            <td style="color:var(--text-muted)">${n.reason}</td>
            <td class="mono" style="color:var(--text-muted)">${n.date}</td>
            ${creditTab === 'Pending' ? `
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn-sm btn-primary" onclick="changeCreditStatus('${n.id}', 'Approved')">Approve</button>
                  <button class="btn-sm btn-ghost" onclick="changeCreditStatus('${n.id}', 'Rejected')">Reject</button>
                </div>
              </td>
            ` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.changeCreditStatus = function(id, st) {
  const note = window.appData.credit.find(c => c.id === id);
  if (note) { note.status = st; window.saveData(); renderCreditInner(); }
}

function renderOfflineTable() {
  const html = `
    <div class="subtabs" style="padding: 16px 16px 0 16px;">
      ${["Pending", "Verified"].map(s => `
        <button class="detail-tab ${offlineTab === s ? 'active' : ''}" onclick="setOfflineTab('${s}')">${s}</button>
      `).join('')}
    </div>
    <div id="offline-table-inner"></div>
  `;
  setTimeout(() => renderOfflineInner(), 0);
  return html;
}
window.setOfflineTab = function(t) { offlineTab = t; renderOfflineTable(); }

function renderOfflineInner() {
  const payments = window.appData.offline.filter(o => o.status === offlineTab);
  const container = document.getElementById("offline-table-inner");
  if (!container) return;

  if (payments.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No ${offlineTab.toLowerCase()} offline payments.</div>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Ref ID</th><th>User</th><th>Method</th><th>Bank / Details</th><th>Amount</th><th>Date</th>${offlineTab === 'Pending' ? '<th>Action</th>' : ''}</tr></thead>
      <tbody>
        ${payments.map(o => `
          <tr>
            <td class="mono" style="font-weight:700">${o.id}</td>
            <td style="font-weight:600">${o.user}</td>
            <td style="color:var(--text-muted)">${o.method}</td>
            <td style="color:var(--text-muted)">${o.details}</td>
            <td style="font-weight:700;color:var(--accent)">${window.utils.fmtCurrency(o.amount)}</td>
            <td class="mono" style="color:var(--text-muted)">${o.date}</td>
            ${offlineTab === 'Pending' ? `
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn-sm btn-primary" onclick="changeOfflineStatus('${o.id}', 'Verified')">Verify</button>
                </div>
              </td>
            ` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
window.changeOfflineStatus = function(id, st) {
  const pay = window.appData.offline.find(o => o.id === id);
  if (pay) { pay.status = st; window.saveData(); renderOfflineInner(); }
}

/* ═════════════════════════════════════════════════
   SCREEN 2: PAYMENT PAGES
═════════════════════════════════════════════════ */
function renderPaymentPages() {
  return `
    <div class="fade-in">
      ${renderPaymentMetrics()}
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; margin-top: 32px;">
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px;">Active Payment Pages</div>
          <h2 style="font-size: 20px; font-weight: 600; margin: 0; color: var(--text);">Payment Pages</h2>
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Configure and manage individual payment checkout pages for this event.</div>
        </div>
        <button class="btn btn-primary" onclick="setScreen('create-page')"><i class="ti ti-plus"></i> Create New Page</button>
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
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">No payment pages found.</div>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Page Name & Code</th>
          <th>Price</th>
          <th>Coupons</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pages.map(p => {
          const cCount = p.coupons.length;
          return `
            <tr>
              <td>
                <div style="font-weight:700">${p.name}</div>
                <div class="mono" style="color:var(--text-muted);font-size:11.5px;margin-top:2px;">${p.code}</div>
              </td>
              <td>
                <div style="font-weight:700">${window.utils.fmtCurrency(p.price, p.currency)}</div>
              </td>
              <td>
                ${cCount === 0 ? `<span style="color:var(--text-muted);font-size:12px;">None</span>` : `
                <div style="cursor: pointer; color: var(--accent); font-weight: 500; font-size: 13px; display: flex; align-items: center; gap: 4px;" onclick="toggleExpand('${p.id}')">
                  ${cCount} Coupon${cCount !== 1 ? "s" : ""}
                  <i class="ti ti-chevron-${expandedPages[p.id] ? "up" : "down"}"></i>
                </div>
                `}
              </td>
              <td>
                <label class="toggle-switch" title="Live on Site">
                  <input type="checkbox" ${p.liveOnSite !== false ? 'checked' : ''} onchange="toggleLive('${p.id}', this.checked)">
                  <span class="toggle-slider"></span>
                </label>
              </td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-secondary btn-sm" title="Edit" onclick="editPage('${p.id}')"><i class="ti ti-pencil"></i></button>
                  <button class="btn btn-secondary btn-sm" title="Add Coupon" onclick="openAddCouponModal('${p.id}')"><i class="ti ti-tag"></i></button>
                  <button class="btn btn-secondary btn-sm" title="Copy URL" onclick="copyPageUrl('${p.id}')"><i class="ti ti-link"></i></button>
                </div>
              </td>
            </tr>
            ${expandedPages[p.id] ? `
            <tr style="background: var(--bg-body)">
              <td colspan="5" style="padding: 16px 24px">
                <div style="background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
                  <table style="margin: 0; background: transparent;">
                    <thead style="background: var(--bg-body)">
                      <tr>
                        <th style="font-size: 11px; padding: 8px 16px;">Code</th>
                        <th style="font-size: 11px; padding: 8px 16px;">Label</th>
                        <th style="font-size: 11px; padding: 8px 16px;">Discount</th>
                        <th style="font-size: 11px; padding: 8px 16px;">Validity</th>
                        <th style="font-size: 11px; padding: 8px 16px; text-align: right;">Uses</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${p.coupons.map(c => {
                        const isExp = new Date(c.end) < new Date();
                        const disc = c.discountType === "percent" ? c.discount + "%" : window.utils.fmtCurrency(c.discount, p.currency);
                        return `
                        <tr>
                          <td style="padding: 8px 16px;">
                            ${c.type === 'code' && c.code ? 
                              `<span class="coupon-chip ${isExp ? 'expired' : ''}">${c.code}</span>` : 
                              `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Auto-applied</span>`
                            }
                          </td>
                          <td style="padding: 8px 16px; font-size: 12px; color: var(--text-muted);">${c.label}</td>
                          <td style="padding: 8px 16px; font-size: 12px; font-weight: 500;">
                            ${disc}
                            ${c.type === 'auto' ? '<span style="margin-left:6px;font-size:10px;background:#E0E7FF;color:#4338CA;padding:2px 6px;border-radius:4px">Auto</span>' : ''}
                          </td>
                          <td style="padding: 8px 16px; font-size: 11px; color: var(--text-muted);">
                            ${window.utils.fmtDate(c.start)} → ${window.utils.fmtDate(c.end)}
                          </td>
                          <td style="padding: 8px 16px; font-size: 12px; text-align: right;">
                            ${c.used} / ${c.maxUses === 0 ? "Unlimited" : c.maxUses}
                          </td>
                        </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
            ` : ''}
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

window.toggleLive = function(id, isLive) {
  const p = window.appData.pages.find(x => x.id === id);
  if (p) { p.liveOnSite = isLive; window.saveData(); }
}
window.deletePage = function(id) {
  if(confirm("Are you sure you want to delete this payment page?")) {
    window.appData.pages = window.appData.pages.filter(x => x.id !== id);
    window.saveData();
    renderPagesTable();
  }
}

/* ═════════════════════════════════════════════════
   MODAL LOGIC
═════════════════════════════════════════════════ */
let editingPageId = null;

window.updateLivePreview = function() {
  const name = document.getElementById("page-name") ? document.getElementById("page-name").value : "";
  const amt = document.getElementById("page-amount") ? document.getElementById("page-amount").value : "";
  const curr = document.getElementById("page-currency") ? document.getElementById("page-currency").value : "INR";
  
  const pName = document.getElementById("preview-page-name");
  const pPrice = document.getElementById("preview-price");
  
  if(pName) pName.innerText = name || "e.g. VIP Pass";
  if(pPrice) pPrice.innerText = window.utils.fmtCurrency(amt ? parseInt(amt) : 12000, curr);
}

function renderCreatePageScreen() {
    const startIso = window.utils.nowDT();
    let endIso = startIso;
    try {
        const d = new Date(EVENT.date);
        d.setHours(23, 59, 59);
        endIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } catch(e) {}

    setTimeout(() => {
        populatePageDropdowns();
        if (editingPageId) {
            const p = window.appData.pages.find(x => x.id === editingPageId);
            if (p) {
                document.getElementById("page-name").value = p.name || "";
                document.getElementById("page-amount").value = p.price || "";
                if(p.currency) document.getElementById("page-currency").value = p.currency;
            }
        }
        window.updateLivePreview();
    }, 0);

    const title = editingPageId ? "Edit Payment Page" : "Create Payment Page";
    const btnText = editingPageId ? "Save Changes" : "Create Page";

    return `
    <div class="fade-in create-page-grid">
      <div class="create-page-form">
          <div style="padding: 0 0 24px 0; display: flex; justify-content: space-between; align-items: center;">
              <div>
                  <h2 style="margin: 0; font-size: 24px;">${title}</h2>
                  <div style="font-size: 14px; color: var(--text-muted); margin-top: 4px;">For ${EVENT.name}</div>
              </div>
              <button class="btn-icon" onclick="setScreen('pages')"><i class="ti ti-x"></i></button>
          </div>
          
          <div style="padding-right: 16px; display: flex; flex-direction: column; gap: 24px; flex: 1; overflow-y: auto;">
            <div class="form-section">
                <label class="field">
                    <span class="field-label">Payment page name <span class="req">*</span></span>
                    <input type="text" id="page-name" placeholder="e.g. VIP Pass" oninput="window.updateLivePreview()">
                </label>
            </div>
            
            <div class="form-section">
                <div class="form-section-header"><span class="fsec-title">Pricing & Currency</span></div>
                <div class="two-col">
                    <label class="field">
                        <span class="field-label">Currency</span>
                        <select id="page-currency" onchange="window.updateLivePreview()"><option value="INR">INR</option><option value="USD">USD</option><option value="AED">AED</option></select>
                    </label>
                    <label class="field">
                        <span class="field-label">Amount <span class="req">*</span></span>
                        <input type="number" id="page-amount" placeholder="12000" oninput="window.updateLivePreview()">
                    </label>
                </div>
            </div>
            
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
            
            <div class="form-section">
                <div class="form-section-header"><span class="fsec-title">Validity & Fulfillment</span></div>
                <div class="two-col">
                    <label class="field">
                        <span class="field-label">Validity Start</span>
                        <input type="datetime-local" id="page-sale-start" value="${startIso}">
                    </label>
                    <label class="field">
                        <span class="field-label">Validity End</span>
                        <input type="datetime-local" id="page-sale-end" value="${endIso}">
                    </label>
                </div>
                
                <label class="field" style="margin-top: 16px;">
                    <span class="field-label">Max quantity <span class="req">*</span></span>
                    <input type="number" id="page-max-qty" value="100">
                </label>
            </div>

            <div id="page-error" class="form-error" style="display:none;"></div>
          </div>
          
          <div style="padding: 24px 16px 0 0; display: flex; justify-content: flex-start; gap: 12px;">
              <button class="btn btn-primary" onclick="savePage()">${btnText}</button>
              <button class="btn btn-secondary" onclick="setScreen('pages')">Cancel</button>
          </div>
        </div>

        <div class="create-page-preview">
          <div class="preview-header">Live Preview</div>
          <div class="preview-card-wrap">
            <div class="preview-mockup">
               <div class="mockup-header">
                 <div class="mockup-logo"></div>
                 <div class="mockup-event">${EVENT.name}</div>
               </div>
               <div class="mockup-body">
                 <div class="mockup-title" id="preview-page-name">VIP Pass</div>
                 <div class="mockup-price" id="preview-price">${window.utils.fmtCurrency(12000, "INR")}</div>
                 <div class="mockup-divider"></div>
                 <div class="mockup-row"><span>Quantity</span><span>1</span></div>
                 <div class="mockup-row"><span>Fees & Taxes</span><span>Calculated at checkout</span></div>
                 <button class="mockup-btn">Continue to Payment</button>
               </div>
            </div>
          </div>
        </div>
      </div>
      `;
  }

window.editPage = function(id) {
    editingPageId = id;
    setScreen('create-page');
}

function populatePageDropdowns() {
    const cSel = document.getElementById("page-country");
    if (cSel && window.appData.countries) {
        cSel.innerHTML = Object.keys(window.appData.countries).map(c => `<option value="${c}">${c}</option>`).join('');
        updateStates();
    }
}

window.updateStates = function() {
    const c = document.getElementById("page-country");
    if (!c) return;
    const list = window.appData.countries[c.value] || [];
    const sSel = document.getElementById("page-state");
    if(sSel) {
        sSel.innerHTML = list.map(s => `<option value="${s}">${s}</option>`).join('');
    }
}

window.savePage = function() {
    const name = document.getElementById("page-name").value;
    const amt = document.getElementById("page-amount").value;
    const err = document.getElementById("page-error");
  
    if (!name || !amt) {
      err.style.display = "flex";
      err.innerHTML = `<i class="ti ti-alert-circle"></i> Please fill in all required fields.`;
      return;
    }
  
    if (editingPageId) {
      const existing = window.appData.pages.find(x => x.id === editingPageId);
      if (existing) {
        existing.name = name;
        existing.price = parseInt(amt);
        existing.currency = document.getElementById("page-currency").value;
      }
    } else {
      const newId = "page_" + Math.random().toString(36).substr(2, 6);
      window.appData.pages.push({
        id: newId,
        eventId: EVENT.id,
        name: name,
        code: "PG" + Math.floor(1000 + Math.random() * 9000),
        currency: document.getElementById("page-currency").value,
        price: parseInt(amt),
        gateway: "Stripe",
        merchant: "Global Payments Ltd",
        liveOnSite: true,
        coupons: []
      });
    }
  
    window.saveData();
    editingPageId = null;
    setScreen('pages');
}

window.openAddCouponModal = function(pageId) {
  activeCouponPage = pageId;
  const p = window.appData.pages.find(x => x.id === pageId);
  document.getElementById("coupon-modal-subtitle").innerText = "For: " + (p ? p.name : "");
  document.getElementById("add-coupon-modal").style.display = "flex";
  
  allCouponCodes = window.appData.pages.flatMap(x => x.coupons.filter(c => c.type === 'code').map(c => c.code));
  
  setCouponType('auto');
  document.getElementById("coupon-label").value = "";
  document.getElementById("coupon-discount").value = "";
  document.getElementById("coupon-warning").style.display = "none";
  
  const startIso = window.utils.nowDT();
  let endIso = startIso;
  try {
      const d = new Date(EVENT.date);
      d.setHours(23, 59, 59);
      endIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } catch(e) {}
  
  document.getElementById("coupon-start").value = startIso;
  document.getElementById("coupon-end").value = endIso;
}
window.closeAddCouponModal = function() {
  document.getElementById("add-coupon-modal").style.display = "none";
}
window.setCouponType = function(type) {
  currentCouponType = type;
  document.getElementById("btn-type-auto").classList.toggle("active", type === "auto");
  document.getElementById("btn-type-code").classList.toggle("active", type === "code");
  document.getElementById("coupon-code").parentElement.style.opacity = type === "code" ? "1" : "0.4";
  document.getElementById("coupon-code").parentElement.style.pointerEvents = type === "code" ? "auto" : "none";
  
  if(type === "code") {
    regenerateCouponCode();
    document.getElementById("coupon-type-hint").innerText = "Users must enter this code at checkout to claim the discount.";
  } else {
    document.getElementById("coupon-code").innerText = "AUTO_APPLIED";
    document.getElementById("coupon-type-hint").innerText = "Applied automatically — no code entry needed.";
  }
}
window.regenerateCouponCode = function() {
  if (currentCouponType !== 'code') return;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for(let i=0; i<8; i++) { code += chars.charAt(Math.floor(Math.random() * chars.length)); }
  document.getElementById("coupon-code").innerText = code;
}
window.updateDiscountLabel = function() {
  const type = document.getElementById("coupon-discount-type").value;
  document.getElementById("discount-val-label").innerHTML = type === 'percent' ? 'Percentage (max 30%) <span class="req">*</span>' : 'Flat Amount <span class="req">*</span>';
  checkDiscountWarning();
}
window.checkDiscountWarning = function() {
  const type = document.getElementById("coupon-discount-type").value;
  const val = parseInt(document.getElementById("coupon-discount").value || "0");
  document.getElementById("coupon-warning").style.display = (type === 'percent' && val > 30) ? "flex" : "none";
}
window.saveCoupon = function() {
  const label = document.getElementById("coupon-label").value;
  const disc = document.getElementById("coupon-discount").value;
  const type = document.getElementById("coupon-discount-type").value;
  const err = document.getElementById("coupon-error");

  if (!label || !disc) {
    err.style.display = "flex";
    err.innerHTML = `<i class="ti ti-alert-circle"></i> Please fill in all required fields.`;
    return;
  }

  const p = window.appData.pages.find(x => x.id === activeCouponPage);
  if (p) {
    if (currentCouponType === 'auto') {
      p.coupons = p.coupons.filter(c => c.type !== 'auto');
    }
    
    p.coupons.push({
      id: "coup_" + Math.random().toString(36).substr(2,6),
      type: currentCouponType,
      label: label,
      code: currentCouponType === 'code' ? document.getElementById("coupon-code").innerText : null,
      discountType: type,
      discount: parseInt(disc),
      maxUses: document.getElementById("coupon-max-uses").value || null,
      active: true
    });
    window.saveData();
    renderScreen();
  }
  closeAddCouponModal();
}

window.showEmbedCode = function(pageId) {
  const p = window.appData.pages.find(x => x.id === pageId);
  if (!p) return;
  
  const code = `<script src="https://checkout.etevents.com/v1/embed.js"></script>\n<et-checkout-button page-id="${p.code}" theme="light">\n  Buy Tickets\n</et-checkout-button>`;
  document.getElementById("embed-page-name").innerText = "For: " + p.name;
  document.getElementById("embed-code-content").innerText = code;
  document.getElementById("embed-modal").style.display = "flex";
}
window.closeEmbedModal = function() {
  document.getElementById("embed-modal").style.display = "none";
}
window.copyEmbedCode = function() {
  const text = document.getElementById("embed-code-content").innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-embed-btn");
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="ti ti-check"></i> Copied`;
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

// Initial render
document.addEventListener("DOMContentLoaded", () => {
  renderScreen();
});
