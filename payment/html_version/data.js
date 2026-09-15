/* data.js */

// Utilities
const nowDT = () => new Date().toISOString().slice(0, 16);
const addDaysDT = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 16);
};
const fmtCurrency = (amount, currency = "INR") => {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch { return `${currency} ${amount}`; }
};
const fmtDate = (str) => {
  if (!str) return "—";
  try { return new Date(str).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return str; }
};
const fmtDateTime = (str) => {
  if (!str) return "—";
  try {
    const d = new Date(str);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
      " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch { return str; }
};

// Location options
const LOCATION_OPTIONS = {
  India: [
    "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh",
    "Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu & Kashmir",
    "Jharkhand","Karnataka","Kerala","Ladakh","Madhya Pradesh","Maharashtra",
    "Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry",
    "Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura",
    "Uttar Pradesh","Uttarakhand","West Bengal",
  ],
  "United States": ["California","Florida","Illinois","New York","Texas","Washington"],
  "United Kingdom": ["England","Northern Ireland","Scotland","Wales"],
  Singapore: ["Singapore"],
  UAE: ["Abu Dhabi","Ajman","Dubai","Fujairah","Ras Al Khaimah","Sharjah","Umm Al Quwain"],
};
const COUNTRIES = Object.keys(LOCATION_OPTIONS);

function generateCouponCode(existingCodes = []) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code, attempts = 0;
  do {
    const part = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    code = `CPN-${part}`;
    attempts++;
  } while (existingCodes.includes(code) && attempts < 200);
  return code;
}

// Default Seed Data
const initialPlans = [
  { id: "PL-101", title: "Event — General Pass", amount: 12000, status: "Published", planType: "Conference", vertical: "B2B", eventId: "1", template: "Minimal" },
  { id: "PL-102", title: "Event — VIP Pass", amount: 28000, status: "Published", planType: "Conference", vertical: "B2B", eventId: "1", template: "Bold" },
  { id: "PL-103", title: "B2B Roundtable — Delegate", amount: 5000, status: "Draft", planType: "Roundtable", vertical: "B2B", eventId: "EVT-B2B-02", template: "Minimal" },
  { id: "PL-104", title: "CFO Excellence Awards — Nomination", amount: 15000, status: "Draft", planType: "Award", vertical: "CFO", eventId: "EVT-CFO-01", template: "Editorial" },
];

const initialPages = [
  { id: "PG-01", planId: "PL-101", name: "Event General", code: "TS26GEN", price: 12000, currency: "INR", landing: "/Event-2026", gateway: "Razorpay", merchant: "Razorpay — ET B2B Main", country: "India", state: "Maharashtra", saleStart: "2026-08-31T10:00", saleEnd: "2026-09-30T23:59", eventId: "1", coupons: [{ id: "C-1", code: "CPN-ERL01A", type: "auto", discount: 15, discountType: "percent", start: "2026-06-01T00:00", end: "2026-06-30T23:59", maxUses: 500, used: 312, maxPerUser: 1, stack: false, label: "Early bird" }] },
  { id: "PG-02", planId: "PL-102", name: "Event VIP", code: "TS26VIP", price: 28000, currency: "INR", landing: "/Event-2026-vip", gateway: "Razorpay", merchant: "Razorpay — ET B2B Main", country: "India", state: "Maharashtra", saleStart: "2026-08-31T10:00", saleEnd: "2026-09-30T23:59", eventId: "1", coupons: [] },
  { id: "PG-03", planId: "PL-103", name: "B2B Roundtable", code: "B2BRT26", price: 5000, currency: "INR", landing: "/roundtable-2026", gateway: "Razorpay", merchant: "Razorpay — Events Sub-account", country: "India", state: "Delhi", saleStart: "2026-08-01T09:00", saleEnd: "2026-09-15T23:59", eventId: "EVT-B2B-02", coupons: [{ id: "C-2", code: "CPN-PRTN5K", type: "code", discount: 500, discountType: "flat", start: "2026-08-01T00:00", end: "2026-09-15T23:59", maxUses: 100, used: 41, maxPerUser: 1, stack: false, label: "Partner500" }] },
];

const initialTx = [
  { id: "TXN-9001", page: "Event General", mode: "Online", status: "Success", portal: "ET B2B", merchant: "Razorpay", productCode: "TS26GEN", invoiceGenerated: true, amount: 10200, date: "2026-08-28", eventId: "1" },
  { id: "TXN-9002", page: "Event VIP", mode: "Online", status: "Failed", portal: "ET B2B", merchant: "Razorpay", productCode: "TS26VIP", invoiceGenerated: false, amount: 28000, date: "2026-08-29", eventId: "1" },
  { id: "TXN-9003", page: "B2B Roundtable", mode: "Offline", status: "Incomplete", portal: "ET B2B", merchant: "Bank transfer", productCode: "B2BRT26", invoiceGenerated: false, amount: 4500, date: "2026-08-27", eventId: "EVT-B2B-02" },
  { id: "TXN-9004", page: "Event General", mode: "Online", status: "Success", portal: "ET B2B", merchant: "Razorpay", productCode: "TS26GEN", invoiceGenerated: true, amount: 12000, date: "2026-08-30", eventId: "1" },
  { id: "TXN-9005", page: "Event VIP", mode: "Online", status: "Success", portal: "ET B2B", merchant: "Stripe", productCode: "TS26VIP", invoiceGenerated: true, amount: 28000, date: "2026-08-30", eventId: "1" },
];

const initialInvoices = [
  { id: "INV-501", txnId: "TXN-9001", invoiceNo: "TI-2026-0501", time: "2026-08-28 14:22", amountDue: 10200, amountPaid: 10200 },
  { id: "INV-502", txnId: "TXN-9004", invoiceNo: "TI-2026-0502", time: "2026-08-30 09:10", amountDue: 12000, amountPaid: 12000 },
  { id: "INV-503", txnId: "TXN-9005", invoiceNo: "TI-2026-0503", time: "2026-08-30 11:47", amountDue: 28000, amountPaid: 28000 },
];

const initialInvoiceListing = [
  { id: "PI-01", piNumber: "PI-2026-2201", productCode: "B2BRT26", user: "Neha Kapoor", email: "neha.k@brandco.in", salesperson: "Arjun Mehta", gst: "07ABCDE1234F1Z5", amount: 5000, qty: 1, currency: "INR", location: "Delhi NCR" },
  { id: "PI-02", piNumber: "PI-2026-2202", productCode: "TS26VIP", user: "Rakesh Iyer", email: "rakesh@mediaworks.com", salesperson: "Priya Sharma", gst: "27FGHIJ5678K1Z2", amount: 28000, qty: 1, currency: "INR", location: "Mumbai" },
];

const initialOffline = [
  { id: "OF-201", txnId: "OF-TXN-201", invoiceNo: "-", client: "BrandCo Media", amount: 45000, utr: "UTR2026081900123", claimedBy: "Ops Team", status: "Pending", date: "2026-08-29" },
  { id: "OF-202", txnId: "OF-TXN-202", invoiceNo: "TI-2026-0499", client: "Meridian Events", amount: 22000, utr: "UTR2026082700871", claimedBy: "Ops Team", status: "Approved", date: "2026-08-27" },
  { id: "OF-203", txnId: "OF-TXN-203", invoiceNo: "-", client: "Skyline Corp", amount: 8000, utr: "UTR2026082500456", claimedBy: "Ops Team", status: "Rejected", date: "2026-08-25", reason: "UTR mismatch" },
];

const initialCredit = [
  { id: "CN-301", txnId: "TXN-9002", invoiceNo: "-", amount: 28000, company: "MediaWorks Pvt Ltd", reason: "Duplicate payment", status: "Pending", postedBy: "Rohit", l1: "Reporting Manager", l2: "Finance Head" },
  { id: "CN-302", txnId: "TXN-9001", invoiceNo: "TI-2026-0501", amount: 1800, company: "Event Attendee", reason: "Partial refund — seat downgrade", status: "Approved", postedBy: "Rohit", l1: "Reporting Manager", l2: "Finance Head" },
];

const downloadDocs = [
  { name: "GST Summary — August 2026", type: "GST", date: "2026-08-31", size: "2.4 MB" },
  { name: "Bank Reconciliation — Week 35", type: "Bank", date: "2026-08-29", size: "1.1 MB" },
  { name: "Tax Invoice Bundle — Event", type: "GST", date: "2026-08-30", size: "8.7 MB" },
];

const VERTICALS_DATA = [
  { id: "B2B",        label: "B2B",        fullName: "Business to Business",              desc: "Enterprise conferences, roundtables & digital forums",        icon: "ti-briefcase",   color: "#6366F1", bg: "linear-gradient(135deg,#6366F1,#4F46E5)", lightBg: "#EEF2FF" },
  { id: "CFO",        label: "CFO",        fullName: "Chief Financial Officer",           desc: "Finance leadership awards & webinars",                         icon: "ti-coin",        color: "#0EA5E9", bg: "linear-gradient(135deg,#0EA5E9,#0284C7)", lightBg: "#E0F2FE" },
  { id: "Auto",       label: "Auto",       fullName: "Automotive",                        desc: "Auto industry awards, shows & mobility summits",               icon: "ti-car",         color: "#10B981", bg: "linear-gradient(135deg,#10B981,#059669)", lightBg: "#D1FAE5" },
  { id: "BrandEquity",label: "BrandEquity",fullName: "Brand Equity",                     desc: "Marketing, branding & creative industry events",               icon: "ti-palette",     color: "#F59E0B", bg: "linear-gradient(135deg,#F59E0B,#D97706)", lightBg: "#FEF3C7" },
  { id: "Legal",      label: "Legal",      fullName: "Legal",                             desc: "Legal industry awards, CLE programs & roundtables",            icon: "ti-scale",       color: "#8B5CF6", bg: "linear-gradient(135deg,#8B5CF6,#7C3AED)", lightBg: "#EDE9FE" },
  { id: "CISO",       label: "CISO",       fullName: "Chief Information Security Officer",desc: "Cybersecurity summits & awards",                               icon: "ti-shield-lock", color: "#EF4444", bg: "linear-gradient(135deg,#EF4444,#DC2626)", lightBg: "#FEE2E2" },
  { id: "HR",         label: "HR",         fullName: "Human Resources",                   desc: "HR tech, talent acquisition & leadership events",             icon: "ti-users",       color: "#0C5C4C", bg: "linear-gradient(135deg,#0C5C4C,#064E3B)", lightBg: "#D1FAE5" },
  { id: "CIO",        label: "CIO",        fullName: "Chief Information Officer",         desc: "IT leadership, digital transformation & innovation",           icon: "ti-cpu",         color: "#64748B", bg: "linear-gradient(135deg,#64748B,#475569)", lightBg: "#F1F5F9" },
  { id: "Masterclass",label: "Masterclass",fullName: "Masterclass Programs",              desc: "Standalone expert-led masterclasses across industry domains",  icon: "ti-school",      color: "#7C3AED", bg: "linear-gradient(135deg,#7C3AED,#5B21B6)", lightBg: "#EDE9FE" },
];

const EVENT_TYPE_CONFIG = {
  Conference:  { color: "#6366F1", bg: "#EEF2FF",  icon: "ti-building-community" },
  Award:       { color: "#F59E0B", bg: "#FEF3C7",  icon: "ti-trophy" },
  Webinar:     { color: "#10B981", bg: "#D1FAE5",  icon: "ti-device-laptop" },
  Masterclass: { color: "#8B5CF6", bg: "#EDE9FE",  icon: "ti-school" },
  Microsite:   { color: "#0EA5E9", bg: "#E0F2FE",  icon: "ti-world" },
  Roundtable:  { color: "#EF4444", bg: "#FEE2E2",  icon: "ti-users-group" },
};

const EVENTS_DATA = [
  { id: "EVT-B2B-01", verticalId: "B2B", name: "Event",          type: "Conference",  date: "2026-10-15", location: "Mumbai",    attendees: 2000, status: "Upcoming",        desc: "India's largest B2B technology conference with 200+ speakers",      pagesCount: 2 },
  { id: "EVT-B2B-02", verticalId: "B2B", name: "B2B Roundtable Q4",         type: "Roundtable",  date: "2026-09-20", location: "Delhi NCR", attendees: 50,   status: "Open",            desc: "Exclusive executive roundtable for B2B decision makers",             pagesCount: 1 },
  { id: "EVT-B2B-03", verticalId: "B2B", name: "Digital Leaders Webinar",    type: "Webinar",     date: "2026-09-12", location: "Online",    attendees: 500,  status: "Open",            desc: "Weekly webinar series on digital transformation for B2B",            pagesCount: 0 },
  { id: "EVT-B2B-04", verticalId: "B2B", name: "B2B Leaders Summit Q1 2027", type: "Conference",  date: "2027-01-20", location: "Bangalore", attendees: 800,  status: "Upcoming",        desc: "Flagship B2B leadership summit kicking off 2027",                    pagesCount: 0 },
  { id: "EVT-CFO-01", verticalId: "CFO", name: "CFO Excellence Awards 2026", type: "Award",       date: "2026-10-28", location: "Delhi",     attendees: 400,  status: "Nomination Open", desc: "Recognising India's top finance leaders and CFOs of the year",       pagesCount: 1 },
  { id: "EVT-CFO-02", verticalId: "CFO", name: "CFO Roundtable: Budget 2027",type: "Roundtable",  date: "2026-11-10", location: "Mumbai",    attendees: 60,   status: "Upcoming",        desc: "Executive roundtable on Union Budget implications for CFOs",         pagesCount: 0 },
  { id: "EVT-CFO-03", verticalId: "CFO", name: "Finance Webinar Series",      type: "Webinar",     date: "2026-09-10", location: "Online",    attendees: 350,  status: "Open",            desc: "Monthly webinar covering finance trends and CFO leadership",         pagesCount: 0 },
];

const EVENT_STATUS_CLASS = {
  "Upcoming":        "pill-neutral",
  "Open":            "pill-success",
  "Nomination Open": "pill-warning",
  "Live":            "pill-success",
  "Closed":          "pill-danger",
};
const ACTIVE_STATUSES = ["Open", "Nomination Open", "Live"];
const isPaymentActive = (evt) => ACTIVE_STATUSES.includes(evt.status);

const MODULES = [
  { id: "plans",        label: "Payment Plans",    desc: "Manage pricing configs and event templates",    icon: "ti-credit-card",     color: "#6366F1", bg: "linear-gradient(135deg,#6366F1,#4F46E5)", lightBg: "#EEF2FF" },
  { id: "pages",        label: "Payment Pages",    desc: "Live payment pages and coupon management",      icon: "ti-layout-grid",     color: "#0EA5E9", bg: "linear-gradient(135deg,#0EA5E9,#0284C7)", lightBg: "#E0F2FE" },
  { id: "transactions", label: "Transactions",     desc: "All transactions — online, offline & docs",     icon: "ti-arrows-exchange", color: "#10B981", bg: "linear-gradient(135deg,#10B981,#059669)", lightBg: "#D1FAE5" },
  { id: "taxinvoice",   label: "Tax Invoice",      desc: "View and download generated tax invoices",      icon: "ti-file-invoice",    color: "#F59E0B", bg: "linear-gradient(135deg,#F59E0B,#D97706)", lightBg: "#FEF3C7" },
  { id: "invoicelisting",label: "Invoice Listing", desc: "Proforma invoices and billing records",         icon: "ti-list-details",    color: "#8B5CF6", bg: "linear-gradient(135deg,#8B5CF6,#7C3AED)", lightBg: "#EDE9FE" },
  { id: "creditnote",   label: "Credit Note",      desc: "Refunds and multi-level approval workflow",     icon: "ti-receipt-refund",  color: "#EF4444", bg: "linear-gradient(135deg,#EF4444,#DC2626)", lightBg: "#FEE2E2" },
  { id: "offline",      label: "Offline Payments", desc: "Bank transfers and UTR reconciliation",         icon: "ti-building-bank",   color: "#0C5C4C", bg: "linear-gradient(135deg,#0C5C4C,#064E3B)", lightBg: "#D1FAE5" },
  { id: "download",     label: "Download Center",  desc: "GST reports, bank recon files & bundles",       icon: "ti-download",        color: "#64748B", bg: "linear-gradient(135deg,#64748B,#475569)", lightBg: "#F1F5F9" },
];

const GATEWAY_MERCHANTS = {
  Razorpay: ["Razorpay — ET B2B Main", "Razorpay — Events Sub-account"],
  Stripe:   ["Stripe — Global Events"],
  PayU:     ["PayU — India Domestic"],
};


// Persistence Logic (LocalStorage)
function getPersistedData(key, defaultData) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : defaultData;
}

function setPersistedData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Initialize Global State
window.appData = {
  plans: getPersistedData('plans', initialPlans),
  pages: getPersistedData('pages', initialPages),
  transactions: getPersistedData('transactions', initialTx),
  invoices: getPersistedData('invoices', initialInvoices),
  invoiceListing: getPersistedData('invoiceListing', initialInvoiceListing),
  offline: getPersistedData('offline', initialOffline),
  credit: getPersistedData('credit', initialCredit),
  selectedVertical: getPersistedData('selectedVertical', null),
  selectedEvent: getPersistedData('selectedEvent', null),
  gateways: GATEWAY_MERCHANTS,
  countries: LOCATION_OPTIONS,
};

window.saveData = function(key, data) {
  window.appData[key] = data;
  setPersistedData(key, data);
};

// Expose utilities and constants
window.utils = {
  nowDT, addDaysDT, fmtCurrency, fmtDate, fmtDateTime,
  generateCouponCode, isPaymentActive,
  LOCATION_OPTIONS, COUNTRIES, VERTICALS_DATA, EVENT_TYPE_CONFIG, EVENTS_DATA, EVENT_STATUS_CLASS, MODULES, GATEWAY_MERCHANTS, downloadDocs
};
