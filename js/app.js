// Inventory Management System (IMS) - MGO Candoni
// Ported architecture from the sibling Property Management System (PMS / PPE Ledger) app:
// Fund switcher (GF/SEF/TF), live Firestore collections held in memory, render-to-innerHTML views,
// focus-preserving live search, printable official-form cards, paste/upload Trial Balance
// reconciliation, and per-tab Access Role permissions. See README.md for the full picture.

import { fsCollection, browserDownload, changePassword as fbChangePassword } from "./firebase.js";
import { signOut } from "./firebase.js";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

export const FUNDS = [
  { code: "GF", name: "General Fund" },
  { code: "SEF", name: "Special Education Fund" },
  { code: "TF", name: "Trust Fund" },
];
function fundInfo(code) { return FUNDS.find((f) => f.code === code) || FUNDS[0]; }
function fundLabel(code) { return fundInfo(code).name; }

// Inventory (asset-side) account catalog - UACS 104xx range, from the client's own Chart of
// Accounts. `distribution:true` marks the "... for Distribution" accounts (10402xxx) - items whose
// issuances are Distributed (to barangays/beneficiaries/the public) rather than Consumed
// internally by an office. `expense` is a suggested default expense account for issuance/JEV
// purposes - always editable per item, never enforced.
export const ACCOUNT_CATALOG = [
  { code: "10401010", name: "Merchandise Inventory", distribution: false, expense: null },
  { code: "10402010", name: "Food Supplies for Distribution", distribution: true, expense: { code: "50299080", name: "Donations" } },
  { code: "10402020", name: "Welfare Goods for Distribution", distribution: true, expense: { code: "50203060", name: "Welfare Goods Expenses" } },
  { code: "10402030", name: "Drugs and Medicines for Distribution", distribution: true, expense: { code: "50203070", name: "Drugs and Medicines Expenses" } },
  { code: "10402040", name: "Medical, Dental and Laboratory Supplies for Distribution", distribution: true, expense: { code: "50203080", name: "Medical, Dental and Laboratory Supplies Expenses" } },
  { code: "10402050", name: "Agricultural and Marine Supplies for Distribution", distribution: true, expense: { code: "50203100", name: "Agricultural and Marine Supplies Expenses" } },
  { code: "10402060", name: "Agricultural Produce for Distribution", distribution: true, expense: null },
  { code: "10402070", name: "Textbooks and Instructional Materials for Distribution", distribution: true, expense: { code: "50203110", name: "Textbooks and Instructional Materials Expenses" } },
  { code: "10402080", name: "Construction Materials for Distribution", distribution: true, expense: null },
  { code: "10402090", name: "Property and Equipment for Distribution", distribution: true, expense: null },
  { code: "10402990", name: "Other Supplies and Materials for Distribution", distribution: true, expense: { code: "50203990", name: "Other Supplies and Materials Expenses" } },
  { code: "10403010", name: "Raw Materials Inventory", distribution: false, expense: null },
  { code: "10403020", name: "Work-in-Process Inventory", distribution: false, expense: null },
  { code: "10403030", name: "Finished Goods Inventory", distribution: false, expense: null },
  { code: "10404010", name: "Office Supplies Inventory", distribution: false, expense: { code: "50203010", name: "Office Supplies Expenses" } },
  { code: "10404020", name: "Accountable Forms, Plates and Stickers", distribution: false, expense: { code: "50203020", name: "Accountable Forms Expenses" } },
  { code: "10404030", name: "Non-Accountable Forms Inventory", distribution: false, expense: { code: "50203030", name: "Non-Accountable Forms Expenses" } },
  { code: "10404040", name: "Animal/Zoological Supplies Inventory", distribution: false, expense: { code: "50203040", name: "Animal/Zoological Supplies Expenses" } },
  { code: "10404050", name: "Food Supplies Inventory", distribution: false, expense: { code: "50203050", name: "Food Supplies Expenses" } },
  { code: "10404060", name: "Drugs and Medicines Inventory", distribution: false, expense: { code: "50203070", name: "Drugs and Medicines Expenses" } },
  { code: "10404070", name: "Medical, Dental and Laboratory Supplies Inventory", distribution: false, expense: { code: "50203080", name: "Medical, Dental and Laboratory Supplies Expenses" } },
  { code: "10404080", name: "Fuel, Oil and Lubricants Inventory", distribution: false, expense: { code: "50203090", name: "Fuel, Oil and Lubricants Expenses" } },
  { code: "10404090", name: "Agricultural and Marine Supplies Inventory", distribution: false, expense: { code: "50203100", name: "Agricultural and Marine Supplies Expenses" } },
  { code: "10404100", name: "Textbooks and Instructional Materials Inventory", distribution: false, expense: { code: "50203110", name: "Textbooks and Instructional Materials Expenses" } },
  { code: "10404110", name: "Military, Police and Traffic Supplies Inventory", distribution: false, expense: { code: "50203120", name: "Military, Police and Traffic Supplies Expenses" } },
  { code: "10404120", name: "Chemical and Filtering Supplies Inventory", distribution: false, expense: { code: "50203130", name: "Chemical and Filtering Supplies Expenses" } },
  { code: "10404130", name: "Construction Materials Inventory", distribution: false, expense: null },
  { code: "10404990", name: "Other Supplies and Materials Inventory", distribution: false, expense: { code: "50203990", name: "Other Supplies and Materials Expenses" } },
];
function accountInfo(code) { return ACCOUNT_CATALOG.find((a) => a.code === code) || null; }
function isDistributionAccount(code) {
  const a = accountInfo(code);
  return !!(a && a.distribution);
}

export const RETIRE_REASONS = [
  "Fully consumed",
  "Expired / spoiled",
  "Damaged / defective",
  "Lost / stolen",
  "Returned to supplier",
  "Discontinued item",
  "Other",
];

const HARDCODED_ADMIN_EMAILS = ["npp@mgocandoniaccounting.org"];
const EDITABLE_TABS = ["registry", "air", "ris", "rsmi", "reconciliation"];
const VIEW_ONLY_TABS = ["dashboard", "medicines", "issued"];
const VIEW_TITLES = {
  dashboard: "Dashboard",
  registry: "Inventory Registry",
  medicines: "Medicines - Health Unit",
  air: "Acceptance and Inspection Report (AIR)",
  ris: "Requisition and Issue Slip (RIS)",
  rsmi: "Report of Supplies and Materials Issued (RSMI)",
  issued: "Issued Inventory",
  reconciliation: "Reconciliation",
  users: "Users & Roles",
};

// A RIS is the single issuance document for both kinds of release - Consumption (used up
// internally by an office) and Distribution (given out to a barangay, beneficiary, or the
// public). The type is set per RIS; a Distribution RIS also carries a Recipient/Barangay.
const ISSUE_TYPES = [
  { code: "consumption", label: "Consumption", disposition: "consumed" },
  { code: "distribution", label: "Distribution", disposition: "distributed" },
];
function issueTypeInfo(code) { return ISSUE_TYPES.find((t) => t.code === code) || ISSUE_TYPES[0]; }
function issueTypeLabel(code) { return issueTypeInfo(code).label; }

// Health Unit medicines. These are ordinary registry items - the Medicines tab is a filtered
// view of the same data, not a separate register - but they are the only items that carry batch
// numbers and expiry dates on receipt, and the only ones the expiry warnings apply to.
// Deliberately just 10404060 (Drugs and Medicines Inventory); widen this list if the RHU later
// wants Medical/Dental/Laboratory Supplies or the "for Distribution" medicines counted too.
const MEDICINE_ACCOUNTS = ["10404060"];
function isMedicineAccount(code) { return MEDICINE_ACCOUNTS.includes(String(code || "")); }
const NEAR_EXPIRY_DAYS = 90;
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr + "T00:00:00").getTime();
  if (isNaN(t)) return null;
  return Math.round((t - new Date(todayStr() + "T00:00:00").getTime()) / 86400000);
}
function expiryPillHtml(dateStr) {
  const d = daysUntil(dateStr);
  if (d == null) return "";
  if (d < 0) return `<span class="pill check">Expired ${Math.abs(d)}d ago</span>`;
  if (d <= NEAR_EXPIRY_DAYS) return `<span class="pill check">Expires in ${d}d</span>`;
  return `<span class="pill ok">OK</span>`;
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

const S = {
  currentUser: null,
  currentFund: localStorage.getItem("imsFund") || "GF",
  view: "dashboard",
  items: new Map(),
  air: new Map(),
  ris: new Map(),
  rsmi: new Map(),
  tbSnapshots: new Map(),
  userRoles: new Map(),
  registryFilter: { q: "", account: "", disposition: "", status: "with_balance" },
  airFilter: { q: "", status: "" },
  medicinesFilter: { q: "" },
  risFilter: { q: "", status: "", type: "" },
  issuedFilter: { q: "", from: "", to: "", type: "" },
  reconPeriod: null,
  _billingDraftUnused: null,
};

const colItems = fsCollection("items");
const colAir = fsCollection("air");
const colRis = fsCollection("ris");
const colRsmi = fsCollection("rsmi");
const colTb = fsCollection("tb_snapshots");
const colRoles = fsCollection("user_roles");

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtMoney(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  const v = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? "-Php " : "Php ") + v;
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function fmtDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}
function periodTag(dateStr) { return (dateStr || todayStr()).slice(0, 7); } // YYYY-MM

function toast(msg, isErr) {
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

let _focusSaved = null;
function captureFocus(containerId) {
  const el = document.activeElement;
  const container = document.getElementById(containerId);
  if (container && el && container.contains(el) && el.id) {
    return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
  }
  return null;
}
function restoreFocus(saved) {
  if (!saved) return;
  const el = document.getElementById(saved.id);
  if (!el) return;
  el.focus();
  if (typeof saved.start === "number" && el.setSelectionRange) {
    try { el.setSelectionRange(saved.start, saved.end); } catch (e) {}
  }
}

function nextDocNumber(map, fund, dateStr, numberField) {
  const ym = periodTag(dateStr);
  let max = 0;
  for (const r of map.values()) {
    if (r.fund !== fund) continue;
    const num = r[numberField] || "";
    const m = num.match(/^(\d{4}-\d{2})-(\d{4,})$/);
    if (m && m[1] === ym) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${ym}-${String(max + 1).padStart(4, "0")}`;
}
function numberTaken(map, fund, numberField, value, excludeId) {
  for (const r of map.values()) {
    if (r.fund === fund && r.id !== excludeId && (r[numberField] || "") === value) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Access Role
// ---------------------------------------------------------------------

function isAdmin() {
  const email = (S.currentUser && S.currentUser.email || "").toLowerCase();
  if (HARDCODED_ADMIN_EMAILS.includes(email)) return true;
  const role = S.userRoles.get(email);
  return !!(role && role.is_admin);
}
function tabAccess(tabKey) {
  if (isAdmin()) return "edit";
  const email = (S.currentUser && S.currentUser.email || "").toLowerCase();
  const role = S.userRoles.get(email);
  if (!role) return EDITABLE_TABS.includes(tabKey) ? "edit" : "view";
  const t = role.tabs || {};
  if (t[tabKey] === undefined || t[tabKey] === null) return EDITABLE_TABS.includes(tabKey) ? "edit" : "view";
  return t[tabKey];
}
function hasTabAccess(tabKey) { return tabAccess(tabKey) !== "none"; }
function canEdit(tabKey) { return tabAccess(tabKey) === "edit"; }
function blockIfViewOnly(tabKey) {
  if (!canEdit(tabKey)) {
    toast("You have view-only access to this section.", true);
    return true;
  }
  return false;
}
function applyAccessControlToNav() {
  const buttons = document.querySelectorAll("#mainNav button[data-view]");
  let hidAny = false;
  buttons.forEach((b) => {
    const v = b.dataset.view;
    if (v === "users") { b.hidden = !isAdmin(); return; }
    const ok = hasTabAccess(v);
    b.hidden = !ok;
    if (!ok && S.view === v) hidAny = true;
  });
  // Hide an entire Consumed/Distributed Inventory group (RIS/RSMI/Report, or Acknowledgement
  // Receipt/Report) when every one of its sub-items is inaccessible - otherwise an empty,
  // unclickable group heading would be left dangling in the sidebar.
  document.querySelectorAll("#mainNav .nav-group").forEach((g) => {
    const anyVisible = [...g.querySelectorAll("button[data-view]")].some((b) => !b.hidden);
    g.hidden = !anyVisible;
  });
  if (hidAny) {
    const firstVisible = [...document.querySelectorAll("#mainNav button[data-view]:not([hidden])")]
      .find((b) => !b.closest(".nav-group[hidden]"));
    if (firstVisible) setView(firstVisible.dataset.view);
  }
}

// ---------------------------------------------------------------------
// Item / ledger helpers
// ---------------------------------------------------------------------

function activeItems(fund) { return [...S.items.values()].filter((a) => a.fund === fund && a.status !== "discontinued"); }
// The registry holds ONE doc per Stock/Property No. per fund. Every later receipt of the same
// stock number (from a posted AIR) is appended inside that same item's ledger rather than
// creating a second row - the same way issuances are.
function itemByStockNo(fund, stockNo) {
  const key = String(stockNo || "").trim().toLowerCase();
  if (!key) return null;
  for (const a of S.items.values()) {
    if (a.fund === fund && String(a.stock_no || "").trim().toLowerCase() === key) return a;
  }
  return null;
}
function itemLedgerSorted(item) {
  return (item.ledger || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.at || 0) - (b.at || 0));
}
function itemRunningTotals(item) {
  let qty = 0, cost = 0;
  const rows = itemLedgerSorted(item).map((e) => {
    if (e.type === "receipt") { qty += Number(e.qty) || 0; cost += Number(e.total_cost) || 0; }
    else { qty -= Number(e.qty) || 0; cost -= Number(e.total_cost) || 0; }
    return { ...e, run_qty: qty, run_cost: cost };
  });
  return { rows, qty, cost };
}
function qtyBalance(item) { return itemRunningTotals(item).qty; }
function costBalance(item) { return itemRunningTotals(item).cost; }
function unitCostBalance(item) {
  const { qty, cost } = itemRunningTotals(item);
  return qty > 0 ? cost / qty : Number(item.unit_cost) || 0;
}
function isLowStock(item) {
  const rp = Number(item.reorder_point) || 0;
  if (rp <= 0) return false;
  return qtyBalance(item) <= rp;
}
function avgDailyIssueQty(item) {
  const cutoff = Date.now() - 90 * 86400000;
  let qty = 0, days = 90;
  for (const e of item.ledger || []) {
    if (e.type !== "issue") continue;
    const t = e.date ? new Date(e.date + "T00:00:00").getTime() : 0;
    if (t >= cutoff) qty += Number(e.qty) || 0;
  }
  return qty > 0 ? qty / days : 0;
}
function daysToConsume(item, balanceQty) {
  const rate = avgDailyIssueQty(item);
  if (!rate) return "—";
  return Math.round(balanceQty / rate).toString();
}
function distinctInventoryAccounts(fund) {
  const set = new Map();
  for (const a of activeItems(fund)) {
    if (!a.account_code) continue;
    if (!set.has(a.account_code)) set.set(a.account_code, a.account_name || (accountInfo(a.account_code) || {}).name || "");
  }
  return [...set.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}
function registryCostFor(code, fund) {
  return activeItems(fund).filter((a) => a.account_code === code).reduce((s, a) => s + costBalance(a), 0);
}

// ---------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------

function openModal(html, extraClass) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-overlay" id="activeModalOverlay">
    <div class="modal ${extraClass || ""}">${html}</div>
  </div>`;
}
function closeModal() {
  document.getElementById("modalRoot").innerHTML = "";
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("activeModalOverlay")) closeModal();
});

function accountOptionsHtml(selected) {
  return ACCOUNT_CATALOG.map((a) => `<option value="${a.code}" ${a.code === selected ? "selected" : ""}>${esc(a.code)} - ${esc(a.name)}</option>`).join("");
}

// ---------------------------------------------------------------------
// Printable forms (SLC / SC / RIS / RSMI) - matching the official Appendix layouts
// ---------------------------------------------------------------------

// The municipal seal, served from this repo's own assets/ folder. Print windows are opened with
// document.write() on the same origin, so an absolute URL built from the app's own path is what
// makes the logo show up there as well as in the app shell.
const APP_BASE_URL = location.origin + location.pathname.replace(/[^/]*$/, "");
const LOGO_URL = APP_BASE_URL + "assets/logo.png";
const SEAL_HTML = `<img src="${LOGO_URL}" alt="Municipality of Candoni" style="width:62px;height:62px;object-fit:contain;"/>`;

function printHeaderHtml(appendixNo, title) {
  return `
    <table class="noborder">
      <tr>
        <td style="width:70px;">${SEAL_HTML}</td>
        <td class="center">
          <div>Republic of the Philippines</div>
          <div><b>MUNICIPAL GOVERNMENT OF CANDONI</b></div>
          <div>Municipal Building, Rizal St., Candoni, Negros Occidental, 6110</div>
        </td>
        <td style="width:90px;text-align:right;">${esc(appendixNo)}</td>
      </tr>
    </table>
    <h2>${esc(title)}</h2>`;
}

function openPrintWindow(bodyHtml, orientation) {
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title>
  <style>
    @page { size: A4 ${orientation}; margin: 12mm; }
    body { margin:0; }
  </style>
  <link rel="stylesheet" href="${location.origin + location.pathname.replace(/index\.html$/, "")}css/styles.css">
  </head><body class="printwrap">${bodyHtml}
  <script>window.onload = () => setTimeout(() => window.print(), 250);<\/script>
  </body></html>`);
  w.document.close();
}

function slcHtml(item) {
  const { rows } = itemRunningTotals(item);
  const bal = itemRunningTotals(item);
  const trs = rows.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${esc(r.ref || "")}</td>
      <td class="right">${r.type === "receipt" ? fmtNum(r.qty) : ""}</td>
      <td class="right">${r.type === "receipt" ? fmtNum(r.unit_cost) : ""}</td>
      <td class="right">${r.type === "receipt" ? fmtNum(r.total_cost) : ""}</td>
      <td class="right">${r.type === "issue" ? fmtNum(r.qty) : ""}</td>
      <td class="right">${r.type === "issue" ? fmtNum(r.unit_cost) : ""}</td>
      <td class="right">${r.type === "issue" ? fmtNum(r.total_cost) : ""}</td>
      <td class="right">${fmtNum(r.run_qty)}</td>
      <td class="right">${fmtNum(r.run_qty ? r.run_cost / r.run_qty : 0)}</td>
      <td class="right">${fmtNum(r.run_cost)}</td>
      <td class="right">${daysToConsume(item, r.run_qty)}</td>
    </tr>`).join("");
  return `
    ${printHeaderHtml("Appendix 9", "SUPPLIES LEDGER CARD")}
    <table class="noborder">
      <tr><td style="width:80%;">Fund : <b>${esc(fundLabel(item.fund))}</b></td><td></td></tr>
    </table>
    <table class="noborder">
      <tr><td>Item : <b>${esc(item.item || item.description)}</b></td><td style="text-align:right;">Item Code : <b>${esc(item.stock_no)}</b></td></tr>
      <tr><td>Description : <b>${esc(item.description)}</b></td><td style="text-align:right;">Re-order Point : <b>${fmtNum(item.reorder_point)}</b></td></tr>
      <tr><td>Unit of Measurement : <b>${esc(item.unit)}</b></td><td></td></tr>
    </table>
    <table>
      <tr>
        <th rowspan="2">Date</th><th rowspan="2">Reference</th>
        <th colspan="3">Receipt</th><th colspan="3">Issue</th><th colspan="3">Balance</th>
        <th rowspan="2">No. of Days<br/>to Consume</th>
      </tr>
      <tr>
        <th>Qty.</th><th>Unit Cost</th><th>Total Cost</th>
        <th>Qty.</th><th>Unit Cost</th><th>Total Cost</th>
        <th>Qty.</th><th>Unit Cost</th><th>Total Cost</th>
      </tr>
      ${trs || '<tr><td colspan="12" class="center">No movement recorded yet</td></tr>'}
    </table>
    <p class="small" style="margin-top:14px;">For Accounting Office Use</p>`;
}

function scHtml(item) {
  const { rows } = itemRunningTotals(item);
  const trs = rows.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${esc(r.ref || "")}</td>
      <td class="right">${r.type === "receipt" ? fmtNum(r.qty) : ""}</td>
      <td class="right">${r.type === "issue" ? fmtNum(r.qty) : ""}</td>
      <td>${r.type === "issue" ? esc(r.office || r.recipient || "") : ""}</td>
      <td class="right">${fmtNum(r.run_qty)}</td>
      <td class="right">${daysToConsume(item, r.run_qty)}</td>
    </tr>`).join("");
  return `
    ${printHeaderHtml("Appendix 53", "STOCK CARD")}
    <table class="noborder"><tr><td>Fund : <b>${esc(fundLabel(item.fund))}</b></td></tr></table>
    <table class="noborder">
      <tr><td>Item : <b>${esc(item.item || item.description)}</b></td><td style="text-align:right;">Stock No. : <b>${esc(item.stock_no)}</b></td></tr>
      <tr><td>Description : <b>${esc(item.description)}</b></td><td style="text-align:right;">Re-order Point : <b>${fmtNum(item.reorder_point)}</b></td></tr>
      <tr><td>Unit of Measurement : <b>${esc(item.unit)}</b></td><td></td></tr>
    </table>
    <table>
      <tr><th rowspan="2">Date</th><th rowspan="2">Reference</th><th>Receipt</th><th colspan="2">Issue</th><th rowspan="2">Balance</th><th rowspan="2">No. of Days<br/>to Consume</th></tr>
      <tr><th>Qty.</th><th>Qty.</th><th>Office</th></tr>
      ${trs || '<tr><td colspan="7" class="center">No movement recorded yet</td></tr>'}
    </table>
    <p class="small" style="margin-top:14px;">For Property Office Use</p>`;
}

function risHtml(r) {
  const lines = r.lines || [];
  const rows = lines.map((l) => `
    <tr>
      <td>${esc(l.stock_no)}</td><td>${esc(l.unit)}</td><td>${esc(l.description)}</td>
      <td class="right">${fmtNum(l.qty_requested)}</td>
      <td class="right">${fmtNum(l.qty_issued)}</td>
      <td>${esc(l.remarks || "")}</td>
    </tr>`).join("");
  const pad = Math.max(0, 12 - lines.length);
  const blanks = Array.from({ length: pad }).map(() => `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  return `
    ${printHeaderHtml("Appendix 48", "REQUISITION AND ISSUE SLIP")}
    <table class="noborder"><tr><td>Fund : <b>${esc(fundLabel(r.fund))}</b></td></tr></table>
    <table class="noborder">
      <tr><td>Department : <b>${esc(r.department)}</b></td><td>FPP Code: <b>${esc(r.fpp_code || "")}</b></td><td style="text-align:right;">Date: <b>${fmtDate(r.date)}</b></td></tr>
      <tr><td>Office : <b>${esc(r.office || "")}</b></td><td>RIS No. : <b>${esc(r.ris_no)}</b></td><td style="text-align:right;">Type: <b>${esc(issueTypeLabel(r.issue_type))}</b></td></tr>
      ${r.issue_type === "distribution" ? `<tr><td colspan="2">Recipient : <b>${esc(r.recipient_name || "")}</b></td><td style="text-align:right;">Barangay/Address : <b>${esc(r.recipient_barangay || "")}</b></td></tr>` : ""}
    </table>
    <table>
      <tr><th colspan="4">Requisition</th><th colspan="2">Issuance</th></tr>
      <tr><th>Stock No.</th><th>Unit</th><th>Description</th><th>Quantity</th><th>Quantity</th><th>Remarks</th></tr>
      ${rows}${blanks}
    </table>
    <p style="margin-top:10px;">Purpose: ${esc(r.purpose || "")}</p>
    <table class="noborder" style="margin-top:20px;">
      <tr>
        <td class="center">Requested by:</td><td class="center">Approved by:</td><td class="center">Issued by:</td><td class="center">Received by:</td>
      </tr>
      <tr>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.requested_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.approved_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.issued_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.received_by_name || "")}</td>
      </tr>
      <tr>
        <td class="center poscap">Signature over Printed Name</td>
        <td class="center poscap">Signature over Printed Name</td>
        <td class="center poscap">Signature over Printed Name</td>
        <td class="center poscap">Signature over Printed Name</td>
      </tr>
      <tr>
        <td class="center poscap">${esc(r.requested_by_position || "")}</td>
        <td class="center poscap">${esc(r.approved_by_position || "")}</td>
        <td class="center poscap">${esc(r.issued_by_position || "")}</td>
        <td class="center poscap">${esc(r.received_by_position || "")}</td>
      </tr>
    </table>`;
}

function rsmiHtml(r) {
  const rows = (r.lines || []).map((l) => `
    <tr>
      <td>${esc(l.ris_no)}</td><td>${esc(l.responsibility_center || "")}</td><td>${esc(l.stock_no)}</td>
      <td>${esc(l.item)}</td><td>${esc(l.unit)}</td>
      <td class="right">${fmtNum(l.qty)}</td><td class="right">${fmtNum(l.unit_cost)}</td><td class="right">${fmtNum(l.amount)}</td>
    </tr>`).join("");
  const recap = (r.recap || []).map((c) => `
    <tr><td>${esc(c.stock_no)}</td><td class="right">${fmtNum(c.qty)}</td><td class="right">${fmtNum(c.unit_cost)}</td><td class="right">${fmtNum(c.amount)}</td><td>${esc(c.account_code)}</td></tr>`).join("");
  const total = (r.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return `
    ${printHeaderHtml("Appendix 40", "REPORT OF SUPPLIES AND MATERIALS ISSUED")}
    <p class="center">For the Period ${fmtDate(r.period_from)} to ${fmtDate(r.period_to)}</p>
    <table class="noborder">
      <tr><td>Fund: <b>${esc(fundLabel(r.fund))}</b></td><td style="text-align:right;">Serial No. : <b>${esc(r.serial_no)}</b></td></tr>
      <tr><td></td><td style="text-align:right;">Date : <b>${fmtDate(r.date)}</b></td></tr>
    </table>
    <table>
      <tr><th>RIS No.</th><th>Responsibility<br/>Center Code</th><th>Stock No.</th><th>Item</th><th>Unit</th><th>Quantity<br/>Issued</th><th>Unit Cost</th><th>Amount</th></tr>
      ${rows || '<tr><td colspan="8" class="center">No issuances in this period</td></tr>'}
      <tr><td colspan="7" class="right"><b>Total</b></td><td class="right"><b>${fmtNum(total)}</b></td></tr>
    </table>
    <p style="margin-top:14px;"><b>Recapitulation:</b></p>
    <table>
      <tr><th>Stock No.</th><th>Quantity</th><th>Unit Cost</th><th>Total Cost</th><th>Account Code</th></tr>
      ${recap || '<tr><td colspan="5" class="center">&nbsp;</td></tr>'}
    </table>
    <p style="margin-top:20px;">I hereby certify to the correctness of the above information.</p>
    <table class="noborder" style="margin-top:26px;">
      <tr>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.certified_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.posted_by_name || "")}</td>
        <td class="center" style="padding-top:30px;">${fmtDate(r.date)}</td>
      </tr>
      <tr>
        <td class="center poscap">Signature over Printed Name of Supply and/or Property Custodian</td>
        <td class="center poscap">Signature over Printed Name of Designated Accounting Staff</td>
        <td class="center poscap">Date</td>
      </tr>
    </table>`;
}

function airHtml(r) {
  const lines = r.lines || [];
  const rows = lines.map((l) => `
    <tr>
      <td>${esc(l.stock_no)}</td>
      <td>${esc(l.description)}${l.batch_no || l.expiry_date ? ` <i>(${[l.batch_no ? "Batch " + esc(l.batch_no) : "", l.expiry_date ? "exp. " + fmtDate(l.expiry_date) : ""].filter(Boolean).join(", ")})</i>` : ""}</td>
      <td class="center">${esc(l.unit)}</td>
      <td class="right">${fmtNum(l.qty)}</td>
    </tr>`).join("");
  const pad = Math.max(0, 16 - lines.length);
  const blanks = Array.from({ length: pad }).map(() => `<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>`).join("");
  const box = (on) => `<span style="display:inline-block;width:13px;height:13px;border:1px solid #000;text-align:center;line-height:13px;font-size:11px;">${on ? "&#10003;" : "&nbsp;"}</span>`;
  return `
    ${printHeaderHtml("", "ACCEPTANCE AND INSPECTION REPORT")}
    <table class="noborder">
      <tr><td style="width:60%;">Dept/Office : <b>${esc(r.dept_office || "")}</b></td><td>Fund : <b>${esc(fundLabel(r.fund))}</b></td></tr>
    </table>
    <table class="noborder">
      <tr><td style="width:60%;">Supplier : <b>${esc(r.supplier || "")}</b></td><td>AIR No. : <b>${esc(r.air_no)}</b></td></tr>
      <tr><td>PO No./Date : <b>${esc(r.po_no || "")}</b>${r.po_date ? " / " + fmtDate(r.po_date) : ""}</td><td>Date : <b>${fmtDate(r.date)}</b></td></tr>
      <tr><td>Requisitioning Office/Dept. : <b>${esc(r.requisitioning_office || "")}</b></td><td>Inv No. : <b>${esc(r.inv_no || "")}</b></td></tr>
      <tr><td></td><td>Date : <b>${r.inv_date ? fmtDate(r.inv_date) : ""}</b></td></tr>
    </table>
    <table>
      <tr><th style="width:16%;">Stock/ Property<br/>No.</th><th>Description</th><th style="width:11%;">Unit</th><th style="width:15%;">Quantity</th></tr>
      ${rows}${blanks}
    </table>
    <table style="margin-top:0;">
      <tr><th style="width:50%;"><i>ACCEPTANCE</i></th><th><i>INSPECTION</i></th></tr>
      <tr>
        <td style="vertical-align:top;padding:8px;">
          <div>Date Received : <b>${r.date_received ? fmtDate(r.date_received) : ""}</b></div>
          <div style="margin-top:10px;">${box(r.acceptance === "complete")} &nbsp;Complete</div>
          <div style="margin-top:6px;">${box(r.acceptance === "partial")} &nbsp;Partial (pls. specify) <i>${esc(r.partial_note || "")}</i></div>
          <div style="margin-top:34px;" class="center"><b>${esc(r.custodian_name || "")}</b></div>
          <div class="center poscap" style="border-top:1px solid #000;">Supply and/or Property Custodian</div>
        </td>
        <td style="vertical-align:top;padding:8px;">
          <div>Date Inspected : <b>${r.date_inspected ? fmtDate(r.date_inspected) : ""}</b></div>
          <div style="margin-top:10px;">${box(!!r.inspected_ok)} &nbsp;Inspected, verified and found in order as to quantity and specifications</div>
          <div style="margin-top:34px;" class="center"><b>${esc(r.inspector_name || "")}</b></div>
          <div class="center poscap" style="border-top:1px solid #000;">Inspection Officer/Inspection Committee</div>
        </td>
      </tr>
    </table>`;
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

function renderDashboard() {
  const fund = S.currentFund;
  const items = activeItems(fund);
  const onHand = items.filter((a) => Math.abs(qtyBalance(a)) > 1e-9);
  const totalValue = items.reduce((s, a) => s + costBalance(a), 0);
  const ytdFrom = new Date().getFullYear() + "-01-01";
  let consumedYtd = 0, distributedYtd = 0;
  for (const a of items) {
    for (const e of a.ledger || []) {
      if (e.type !== "issue" || !e.date || e.date < ytdFrom) continue;
      if (e.disposition === "distributed") distributedYtd += Number(e.total_cost) || 0;
      else consumedYtd += Number(e.total_cost) || 0;
    }
  }
  const lowStock = onHand.filter(isLowStock);
  const pendingAir = [...S.air.values()].filter((r) => r.fund === fund && r.status !== "posted");
  const tbForFund = [...S.tbSnapshots.values()].filter((t) => t.fund === fund).sort((a, b) => (a.period || "").localeCompare(b.period || ""));
  const latestTb = tbForFund[tbForFund.length - 1];
  let reconOk = 0, reconCheck = 0;
  if (latestTb) {
    for (const acc of distinctInventoryAccounts(fund)) {
      const tbLine = (latestTb.lines || []).find((l) => l.account_code === acc.code);
      const tbAmt = tbLine ? (Number(tbLine.debit) || 0) - (Number(tbLine.credit) || 0) : 0;
      const regAmt = registryCostFor(acc.code, fund);
      if (Math.abs(tbAmt - regAmt) < 0.5) reconOk++; else reconCheck++;
    }
  }

  const html = `
    <div class="cardrow">
      <div class="card"><div class="label">Total Inventory Value</div><div class="value">${fmtMoney(totalValue)}</div><div class="foot">${onHand.length} item(s) on hand &middot; ${fundLabel(fund)}</div></div>
      <div class="card ${pendingAir.length ? "warn" : ""}"><div class="label">AIR Awaiting Accounting</div><div class="value">${pendingAir.length}</div><div class="foot">received, not yet in the registry</div></div>
      <div class="card"><div class="label">Issued - Consumption (YTD)</div><div class="value">${fmtMoney(consumedYtd)}</div><div class="foot">used internally by offices</div></div>
      <div class="card"><div class="label">Issued - Distribution (YTD)</div><div class="value">${fmtMoney(distributedYtd)}</div><div class="foot">to barangays / beneficiaries / the public</div></div>
      <div class="card ${lowStock.length ? "warn" : ""}"><div class="label">Low Stock</div><div class="value">${lowStock.length}</div><div class="foot">at or below re-order point</div></div>
      <div class="card ${reconCheck ? "warn" : ""}"><div class="label">Reconciliation</div><div class="value">${latestTb ? `${reconOk} OK / ${reconCheck} check` : "No TB yet"}</div><div class="foot">${latestTb ? fmtDate(latestTb.period + "-01") : "Paste a Trial Balance to begin"}</div></div>
    </div>
    <div class="panel">
      <h3>Low stock items</h3>
      ${lowStock.length ? `<div class="table-wrap"><table><thead><tr><th>Stock No.</th><th>Description</th><th class="num">Balance</th><th class="num">Re-order Pt.</th></tr></thead><tbody>
        ${lowStock.map((a) => `<tr class="clickable" onclick="openItemDetail('${a.id}')"><td>${esc(a.stock_no)}</td><td>${esc(a.description)}</td><td class="num">${fmtNum(qtyBalance(a))} ${esc(a.unit)}</td><td class="num">${fmtNum(a.reorder_point)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Nothing is at or below its re-order point right now.</div>`}
    </div>
    <div class="panel">
      <h3>Recent Acceptance and Inspection Reports <span class="small" style="font-weight:normal;">(incoming deliveries)</span></h3>
      ${renderRecentAirTable(fund)}
    </div>
    <div class="panel">
      <h3>Recent RIS <span class="small" style="font-weight:normal;">(issuances - consumption and distribution)</span></h3>
      ${renderRecentRisTable(fund)}
    </div>`;
  document.getElementById("view-dashboard").innerHTML = html;
}
function renderRecentRisTable(fund) {
  const rows = [...S.ris.values()].filter((r) => r.fund === fund).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  if (!rows.length) return `<div class="empty">No RIS records yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Date</th><th>Type</th><th>Issued to</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="openRisDetail('${r.id}')"><td>${esc(r.ris_no)}</td><td>${fmtDate(r.date)}</td>
      <td><span class="pill ${r.issue_type === "distribution" ? "distributed" : "consumed"}">${esc(issueTypeLabel(r.issue_type))}</span></td>
      <td>${esc(risIssuedTo(r))}</td>
      <td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td></tr>`).join("")}
  </tbody></table></div>`;
}
function renderRecentAirTable(fund) {
  const rows = [...S.air.values()].filter((r) => r.fund === fund).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  if (!rows.length) return `<div class="empty">No Acceptance and Inspection Reports yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>AIR No.</th><th>Date</th><th>Supplier</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="openAirDetail('${r.id}')"><td>${esc(r.air_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.supplier || "")}</td>
      <td><span class="pill ${r.status === "posted" ? "ok" : "muted"}">${r.status === "posted" ? "In Registry" : "For Accounting"}</span></td></tr>`).join("")}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------------
// Inventory Registry
// ---------------------------------------------------------------------

function filterItemRows(f) {
  const q = (f.q || "").toLowerCase();
  const fund = S.currentFund;
  const status = f.status || "with_balance";
  let rows;
  if (status === "discontinued") {
    rows = [...S.items.values()].filter((a) => a.fund === fund && a.status === "discontinued");
  } else {
    rows = activeItems(fund);
    // The registry is the list of what is actually on the shelf: an item whose running balance
    // has gone to zero (fully issued) drops out of the default view, but stays in the database
    // and can be brought back with the "Zero balance" / "All" filter.
    if (status === "with_balance") rows = rows.filter((a) => Math.abs(qtyBalance(a)) > 1e-9);
    else if (status === "zero") rows = rows.filter((a) => Math.abs(qtyBalance(a)) <= 1e-9);
  }
  if (q) rows = rows.filter((a) => [a.stock_no, a.description, a.item, a.account_name].some((v) => (v || "").toLowerCase().includes(q)));
  if (f.account) rows = rows.filter((a) => a.account_code === f.account);
  if (f.disposition) rows = rows.filter((a) => (isDistributionAccount(a.account_code) ? "distributed" : "consumed") === f.disposition);
  rows.sort((a, b) => (a.account_code || "").localeCompare(b.account_code || "") || (a.stock_no || "").localeCompare(b.stock_no || ""));
  return rows;
}

function renderRegistry() {
  const saved = captureFocus("view-registry");
  const f = S.registryFilter;
  const rows = filterItemRows(f);
  const canE = canEdit("registry");
  const totalValue = rows.reduce((s, a) => s + costBalance(a), 0);
  document.getElementById("view-registry").innerHTML = `
    <div class="panel small">One row per <b>Stock/Property No.</b> - every later delivery of the same stock number is filed <i>inside</i> that same item (open it to see each receipt and issuance), never as a second row. Items are created here only by posting an <b>AIR</b> to the registry, or by adding an opening balance for stock already on the shelf.</div>
    <div class="toolbar">
      <input class="grow" id="regSearch" placeholder="Search stock no., description..." value="${esc(f.q)}"/>
      <select id="regAccountFilter"><option value="">All accounts</option>${ACCOUNT_CATALOG.map((a) => `<option value="${a.code}" ${a.code === f.account ? "selected" : ""}>${esc(a.code)} - ${esc(a.name)}</option>`).join("")}</select>
      <select id="regStatusFilter">
        <option value="with_balance" ${f.status === "with_balance" ? "selected" : ""}>On hand (balance not zero)</option>
        <option value="zero" ${f.status === "zero" ? "selected" : ""}>Zero balance</option>
        <option value="all" ${f.status === "all" ? "selected" : ""}>All active items</option>
        <option value="discontinued" ${f.status === "discontinued" ? "selected" : ""}>Discontinued</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportRegistryCsv()">Download CSV</button>
        ${canE ? `<button class="btn primary" onclick="openItemModal()">+ Add opening balance</button>` : ""}
      </div>
    </div>
    <div class="cardrow" style="grid-template-columns: 1fr;">
      <div class="card"><div class="label">Total value shown</div><div class="value">${fmtMoney(totalValue)}</div><div class="foot">${rows.length} item(s) &middot; ${esc(fundLabel(S.currentFund))}</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Stock No.</th><th>Description</th><th>Account</th><th class="num">Receipts</th><th class="num">Balance Qty</th><th class="num">Value</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((a) => {
          const receipts = (a.ledger || []).filter((e) => e.type === "receipt").length;
          return `
          <tr class="clickable" onclick="openItemDetail('${a.id}')">
            <td>${esc(a.stock_no)}</td>
            <td>${esc(a.description)}<div class="small">${esc(a.item || "")}</div>${isLowStock(a) ? ' <span class="pill check">Low stock</span>' : ""}</td>
            <td>${esc(a.account_code)}<div class="small">${esc(a.account_name || "")}</div></td>
            <td class="num">${receipts}</td>
            <td class="num">${fmtNum(qtyBalance(a))} ${esc(a.unit)}</td>
            <td class="num">${fmtMoney(costBalance(a))}</td>
          </tr>`; }).join("") : `<tr><td colspan="6"><div class="empty">No items match this filter.</div></td></tr>`}
      </tbody>
    </table></div>`;

  const s = document.getElementById("regSearch");
  s.addEventListener("input", () => { S.registryFilter.q = s.value; renderRegistry(); });
  document.getElementById("regAccountFilter").addEventListener("change", (e) => { S.registryFilter.account = e.target.value; renderRegistry(); });
  document.getElementById("regStatusFilter").addEventListener("change", (e) => { S.registryFilter.status = e.target.value; renderRegistry(); });
  restoreFocus(saved);
}

function openItemModal(id) {
  if (!canEdit("registry")) { toast("You have view-only access to Inventory Registry.", true); return; }
  const a = id ? S.items.get(id) : null;
  openModal(`
    <div class="modal-head"><h3>${a ? "Edit item" : "+ Add opening balance"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      ${!a ? `<div class="panel small" style="margin-bottom:12px;">Use this only to onboard stock that is <b>already on the shelf</b> before this system started. New deliveries come in through an <b>AIR</b> instead. If the Stock No. you type already exists in this fund, the opening balance is filed inside that existing item.</div>` : ""}
      <div class="grid2">
        <div><label>Account</label><select id="f_account">${accountOptionsHtml(a && a.account_code)}</select></div>
        <div><label>Stock No.</label><input id="f_stockno" value="${esc(a ? a.stock_no : "")}"/></div>
      </div>
      <label>Description</label><input id="f_desc" value="${esc(a ? a.description : "")}"/>
      <div class="grid3">
        <div><label>Item / category</label><input id="f_item" value="${esc(a ? a.item : "")}"/></div>
        <div><label>Unit of measurement</label><input id="f_unit" value="${esc(a ? a.unit : "")}"/></div>
        <div><label>Re-order point</label><input id="f_reorder" type="number" step="0.01" value="${a ? a.reorder_point : 0}"/></div>
      </div>
      <div class="grid2">
        <div><label>Current unit cost (Php)</label><input id="f_unitcost" type="number" step="0.01" value="${a ? a.unit_cost : 0}"/></div>
        <div><label>Expense account (for issuance/JEV)</label><input id="f_expcode" value="${esc(a ? a.expense_account_code || "" : "")}" placeholder="e.g. 50203010"/></div>
      </div>
      <label>Expense account name</label><input id="f_expname" value="${esc(a ? a.expense_account_name || "" : "")}"/>
      ${!a ? `<div class="hr"></div><label>Opening balance (optional)</label>
      <div class="grid2">
        <div><label style="margin-top:0;">Opening Qty</label><input id="f_openqty" type="number" step="0.01" value="0"/></div>
        <div><label style="margin-top:0;">As of date</label><input id="f_openat" type="date" value="${todayStr()}"/></div>
      </div>` : ""}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveItem('${a ? a.id : ""}')">${a ? "Save" : "Add opening balance"}</button>
    </div>`);
  const accSel = document.getElementById("f_account");
  accSel.addEventListener("change", () => {
    if (a) return;
    const info = accountInfo(accSel.value);
    if (info && info.expense) {
      document.getElementById("f_expcode").value = info.expense.code;
      document.getElementById("f_expname").value = info.expense.name;
    }
  });
}

function saveItem(id) {
  if (blockIfViewOnly("registry")) return;
  const account = document.getElementById("f_account").value;
  const info = accountInfo(account);
  const stock_no = document.getElementById("f_stockno").value.trim();
  const description = document.getElementById("f_desc").value.trim();
  if (!stock_no || !description) { toast("Stock No. and Description are required.", true); return; }
  const rec = {
    fund: S.currentFund,
    account_code: account,
    account_name: info ? info.name : "",
    stock_no,
    description,
    item: document.getElementById("f_item").value.trim(),
    unit: document.getElementById("f_unit").value.trim(),
    reorder_point: Number(document.getElementById("f_reorder").value) || 0,
    unit_cost: Number(document.getElementById("f_unitcost").value) || 0,
    expense_account_code: document.getElementById("f_expcode").value.trim(),
    expense_account_name: document.getElementById("f_expname").value.trim(),
    status: "active",
    updated_at: Date.now(),
  };
  if (id) {
    colItems.doc(id).update(rec).then(() => { toast("Item saved."); closeModal(); }).catch((e) => toast(e.message, true));
    return;
  }
  const openQtyEl = document.getElementById("f_openqty");
  const openQty = openQtyEl ? Number(openQtyEl.value) || 0 : 0;
  const openDate = (document.getElementById("f_openat") || {}).value || todayStr();
  const entry = openQty > 0 ? {
    id: uid(), type: "receipt", date: openDate,
    ref: "Opening balance", qty: openQty, unit_cost: rec.unit_cost, total_cost: round2(openQty * rec.unit_cost),
    by: S.currentUser.email, at: Date.now(),
  } : null;
  // One row per Stock No. per fund: if this stock number is already in the registry, the opening
  // balance is filed inside that existing item instead of creating a second row for it.
  const existing = itemByStockNo(S.currentFund, stock_no);
  if (existing) {
    if (!entry) { toast(`Stock No. ${stock_no} already exists in this fund.`, true); return; }
    const ledger = (existing.ledger || []).concat([entry]);
    colItems.doc(existing.id).update({ ledger, unit_cost: rec.unit_cost, status: "active", updated_at: Date.now() })
      .then(() => { toast(`Opening balance filed inside the existing item ${stock_no}.`); closeModal(); })
      .catch((e) => toast(e.message, true));
    return;
  }
  rec.created_at = Date.now();
  rec.ledger = entry ? [entry] : [];
  colItems.doc().set(rec).then(() => { toast("Item added."); closeModal(); }).catch((e) => toast(e.message, true));
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function discontinueItem(id) {
  if (blockIfViewOnly("registry")) return;
  const a = S.items.get(id);
  if (!a) return;
  if (qtyBalance(a) > 0 && !confirm(`${a.description} still has ${fmtNum(qtyBalance(a))} ${a.unit} on hand. Discontinue anyway?`)) return;
  colItems.doc(id).update({ status: "discontinued" }).then(() => { toast("Item discontinued."); closeModal(); }).catch((e) => toast(e.message, true));
}
function reactivateItem(id) {
  if (blockIfViewOnly("registry")) return;
  colItems.doc(id).update({ status: "active" }).then(() => { toast("Item reactivated."); closeModal(); }).catch((e) => toast(e.message, true));
}

function openItemDetail(id) {
  const a = S.items.get(id);
  if (!a) return;
  const bal = itemRunningTotals(a);
  const canE = canEdit("registry");
  const receipts = (a.ledger || []).filter((e) => e.type === "receipt").length;
  const issues = (a.ledger || []).filter((e) => e.type === "issue").length;
  const rowsHtml = bal.rows.slice().reverse().map((r) => `
    <tr${r.air_id || r.ris_id ? ` class="clickable" onclick="closeModal();${r.air_id ? `openAirDetail('${r.air_id}')` : `openRisDetail('${r.ris_id}')`}"` : ""}>
      <td>${fmtDate(r.date)}</td><td>${esc(r.ref || "")}</td>
      <td>${r.type === "receipt" ? '<span class="pill ok">Receipt</span>' : `<span class="pill ${r.disposition === "distributed" ? "distributed" : "consumed"}">${r.disposition === "distributed" ? "Distribution" : "Consumption"}</span>`}</td>
      <td class="num">${r.type === "receipt" ? "+" : "-"}${fmtNum(r.qty)}${r.batch_no || r.expiry_date ? `<div class="small">${esc(r.batch_no || "")}${r.expiry_date ? " &middot; exp. " + fmtDate(r.expiry_date) : ""}</div>` : ""}</td>
      <td class="num">${fmtNum(r.unit_cost)}</td>
      <td class="num">${fmtMoney(r.total_cost)}</td>
      <td class="num">${fmtNum(r.run_qty)}</td>
      <td>${esc(r.office || r.recipient || "")}</td>
    </tr>`).join("");
  openModal(`
    <div class="modal-head"><h3>${esc(a.description)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3 small">
        <div><b>Stock No.</b><br/>${esc(a.stock_no)}</div>
        <div><b>Account</b><br/>${esc(a.account_code)} - ${esc(a.account_name)}</div>
        <div><b>Unit</b><br/>${esc(a.unit)}</div>
      </div>
      <div class="grid3 small" style="margin-top:8px;">
        <div><b>Balance Qty</b><br/>${fmtNum(bal.qty)} ${esc(a.unit)}</div>
        <div><b>Balance Value</b><br/>${fmtMoney(bal.cost)}</div>
        <div><b>Re-order point</b><br/>${fmtNum(a.reorder_point)} ${isLowStock(a) ? '<span class="pill check">Low stock</span>' : ""}</div>
      </div>
      <div class="hr"></div>
      <h3 style="font-size:13px;">Movement history <span class="small" style="font-weight:normal;">- ${receipts} receipt(s) from AIR, ${issues} issuance(s) from RIS, all filed under this one stock number</span></h3>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Amount</th><th class="num">Balance</th><th>Office/Recipient</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="8"><div class="empty">No movement yet.</div></td></tr>'}</tbody></table></div>
      <p class="small" style="margin-top:10px;">New stock is added by posting an <b>Acceptance and Inspection Report</b> to the registry, not by editing this item.</p>
    </div>
    <div class="modal-foot">
      ${a.status === "discontinued" ? (canE ? `<button class="btn" onclick="reactivateItem('${a.id}')">Reactivate</button>` : "") : (canE ? `<button class="btn danger" onclick="discontinueItem('${a.id}')">Discontinue</button>` : "")}
      <button class="btn" onclick="printSlc('${a.id}')">Print SLC</button>
      <button class="btn" onclick="printSc('${a.id}')">Print Stock Card</button>
      ${canE ? `<button class="btn primary" onclick="closeModal();openItemModal('${a.id}')">Edit</button>` : ""}
    </div>`, "wide");
}

function printSlc(id) { openPrintWindow(slcHtml(S.items.get(id)), "landscape"); }
function printSc(id) { openPrintWindow(scHtml(S.items.get(id)), "landscape"); }

function exportRegistryCsv() {
  const rows = filterItemRows(S.registryFilter);
  const header = ["Fund", "Account Code", "Account Name", "Stock No.", "Description", "Unit", "Type", "Balance Qty", "Unit Cost", "Balance Value", "Re-order Point", "Status"];
  const lines = [header.join(",")];
  for (const a of rows) {
    lines.push([fundLabel(a.fund), a.account_code, a.account_name, a.stock_no, a.description, a.unit,
      isDistributionAccount(a.account_code) ? "Distributed" : "Consumed",
      qtyBalance(a), unitCostBalance(a).toFixed(2), costBalance(a).toFixed(2), a.reorder_point, a.status].map(csvField).join(","));
  }
  browserDownload(`Inventory_Registry_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Medicines - Health Unit. A filtered view of the same registry/AIR/RIS data, not a separate
// register: it shows only items on the Drugs and Medicines Inventory account (MEDICINE_ACCOUNTS),
// with the batch numbers and expiry dates their deliveries carry, and flags anything expired or
// expiring within NEAR_EXPIRY_DAYS.
// ---------------------------------------------------------------------

function medicineItems(fund) {
  return [...S.items.values()]
    .filter((a) => a.fund === fund && a.status !== "discontinued" && isMedicineAccount(a.account_code))
    .sort((a, b) => (a.description || "").localeCompare(b.description || ""));
}

// Every batch ever received for a medicine item, newest expiry problems first.
function medicineBatches(fund) {
  const out = [];
  for (const a of medicineItems(fund)) {
    for (const e of a.ledger || []) {
      if (e.type !== "receipt") continue;
      out.push({ item: a, entry: e, days: daysUntil(e.expiry_date) });
    }
  }
  out.sort((x, y) => {
    const dx = x.days == null ? Infinity : x.days;
    const dy = y.days == null ? Infinity : y.days;
    return dx - dy;
  });
  return out;
}

function earliestExpiry(item) {
  const dates = (item.ledger || []).filter((e) => e.type === "receipt" && e.expiry_date).map((e) => e.expiry_date).sort();
  return dates[0] || "";
}

function renderMedicines() {
  const saved = captureFocus("view-medicines");
  const fund = S.currentFund;
  const q = (S.medicinesFilter.q || "").toLowerCase();
  const match = (a) => !q || [a.stock_no, a.description, a.item].some((v) => (v || "").toLowerCase().includes(q));
  const items = medicineItems(fund).filter(match);
  const onHand = items.filter((a) => Math.abs(qtyBalance(a)) > 1e-9);
  const batches = medicineBatches(fund).filter((b) => match(b.item));
  const expired = batches.filter((b) => b.days != null && b.days < 0);
  const nearExpiry = batches.filter((b) => b.days != null && b.days >= 0 && b.days <= NEAR_EXPIRY_DAYS);
  const noExpiry = batches.filter((b) => b.days == null);
  const totalValue = onHand.reduce((s, a) => s + costBalance(a), 0);

  // Issuances of medicine items, newest first.
  const issues = [];
  for (const a of items) {
    for (const e of a.ledger || []) {
      if (e.type === "issue") issues.push({ item: a, entry: e });
    }
  }
  issues.sort((x, y) => (y.entry.date || "").localeCompare(x.entry.date || ""));

  document.getElementById("view-medicines").innerHTML = `
    <div class="panel small">Everything on the <b>Drugs and Medicines Inventory (10404060)</b> account, filtered out of the main registry. Stock arrives through <b>Acceptance</b> (where each delivery records its Batch No. and Expiry) and leaves through a <b>RIS</b>, exactly like any other item - this view just puts the Health Unit's medicines, their batches and their expiry dates in one place.</div>
    <div class="toolbar">
      <input class="grow" id="medSearch" placeholder="Search medicine name or stock no..." value="${esc(S.medicinesFilter.q)}"/>
      <div class="toolbar-right"><button class="btn" onclick="exportMedicinesCsv()">Download CSV</button></div>
    </div>
    <div class="cardrow">
      <div class="card"><div class="label">Medicines on hand</div><div class="value">${onHand.length}</div><div class="foot">${esc(fundLabel(fund))}</div></div>
      <div class="card"><div class="label">Stock value</div><div class="value">${fmtMoney(totalValue)}</div><div class="foot">at running average cost</div></div>
      <div class="card ${nearExpiry.length ? "warn" : ""}"><div class="label">Expiring in ${NEAR_EXPIRY_DAYS} days</div><div class="value">${nearExpiry.length}</div><div class="foot">batch(es) to use or endorse first</div></div>
      <div class="card ${expired.length ? "warn" : ""}"><div class="label">Expired</div><div class="value">${expired.length}</div><div class="foot">batch(es) past their expiry date</div></div>
    </div>

    <div class="panel">
      <h3>Medicine stock</h3>
      ${onHand.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Stock No.</th><th>Medicine</th><th class="num">Balance</th><th class="num">Value</th><th>Earliest expiry</th></tr></thead>
        <tbody>${onHand.map((a) => {
          const exp = earliestExpiry(a);
          return `<tr class="clickable" onclick="openItemDetail('${a.id}')">
            <td>${esc(a.stock_no)}</td>
            <td>${esc(a.description)}${isLowStock(a) ? ' <span class="pill check">Low stock</span>' : ""}</td>
            <td class="num">${fmtNum(qtyBalance(a))} ${esc(a.unit || "")}</td>
            <td class="num">${fmtMoney(costBalance(a))}</td>
            <td>${exp ? fmtDate(exp) + " " + expiryPillHtml(exp) : '<span class="small">not recorded</span>'}</td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No medicines on hand in ${esc(fundLabel(fund))}.</div>`}
    </div>

    <div class="panel">
      <h3>Batches received <span class="small" style="font-weight:normal;">(soonest expiry first)</span></h3>
      ${batches.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Expiry</th><th>Batch No.</th><th>Stock No.</th><th>Medicine</th><th class="num">Qty received</th><th>AIR No.</th><th>Supplier</th><th>Date received</th></tr></thead>
        <tbody>${batches.map((b) => `<tr class="clickable" onclick="${b.entry.air_id ? `openAirDetail('${b.entry.air_id}')` : `openItemDetail('${b.item.id}')`}">
          <td>${b.entry.expiry_date ? fmtDate(b.entry.expiry_date) + " " + expiryPillHtml(b.entry.expiry_date) : '<span class="small">not recorded</span>'}</td>
          <td>${esc(b.entry.batch_no || "")}</td>
          <td>${esc(b.item.stock_no)}</td>
          <td>${esc(b.item.description)}</td>
          <td class="num">${fmtNum(b.entry.qty)} ${esc(b.item.unit || "")}</td>
          <td>${esc(b.entry.ref || "")}</td>
          <td>${esc(b.entry.supplier || "")}</td>
          <td>${fmtDate(b.entry.date)}</td>
        </tr>`).join("")}</tbody></table></div>
        ${noExpiry.length ? `<p class="small">${noExpiry.length} batch(es) have no expiry date recorded - add it on the Acceptance line when the delivery is entered.</p>` : ""}`
        : `<div class="empty">No medicine deliveries recorded yet.</div>`}
    </div>

    <div class="panel">
      <h3>Medicines issued</h3>
      ${issues.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>RIS No.</th><th>Type</th><th>Medicine</th><th class="num">Qty</th><th class="num">Amount</th><th>Office / Recipient</th></tr></thead>
        <tbody>${issues.slice(0, 50).map((r) => `<tr class="clickable" onclick="${r.entry.ris_id ? `openRisDetail('${r.entry.ris_id}')` : `openItemDetail('${r.item.id}')`}">
          <td>${fmtDate(r.entry.date)}</td><td>${esc(r.entry.ref || "")}</td>
          <td><span class="pill ${r.entry.disposition === "distributed" ? "distributed" : "consumed"}">${r.entry.disposition === "distributed" ? "Distribution" : "Consumption"}</span></td>
          <td>${esc(r.item.description)}</td>
          <td class="num">${fmtNum(r.entry.qty)} ${esc(r.item.unit || "")}</td>
          <td class="num">${fmtMoney(r.entry.total_cost)}</td>
          <td>${esc(r.entry.recipient || r.entry.office || "")}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No medicines issued yet.</div>`}
    </div>`;
  document.getElementById("medSearch").addEventListener("input", (e) => { S.medicinesFilter.q = e.target.value; renderMedicines(); });
  restoreFocus(saved);
}

function exportMedicinesCsv() {
  const fund = S.currentFund;
  const header = ["Stock No.", "Medicine", "Unit", "Balance Qty", "Balance Value", "Batch No.", "Expiry", "Days to expiry", "Qty received", "AIR No.", "Supplier", "Date received"];
  const lines = [header.join(",")];
  for (const b of medicineBatches(fund)) {
    lines.push([b.item.stock_no, b.item.description, b.item.unit, qtyBalance(b.item), costBalance(b.item).toFixed(2),
      b.entry.batch_no || "", b.entry.expiry_date || "", b.days == null ? "" : b.days,
      b.entry.qty, b.entry.ref || "", b.entry.supplier || "", b.entry.date].map(csvField).join(","));
  }
  browserDownload(`Medicines_HealthUnit_${fund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}


// ---------------------------------------------------------------------
// RIS - Requisition and Issue Slip. The single issuance document in the system: every release of
// stock goes through a RIS, tagged either Consumption (used internally by an office) or
// Distribution (given out to a barangay, beneficiary, or the public, with a recipient recorded).
// Draft -> Issue (deducts stock) -> reversible.
// ---------------------------------------------------------------------

function risIssuedTo(r) {
  if (r.issue_type === "distribution") {
    return [r.recipient_name, r.recipient_barangay].filter(Boolean).join(" / ") || r.office || r.department || "";
  }
  return r.office || r.department || "";
}

function filterRisRows(f) {
  const q = (f.q || "").toLowerCase();
  let rows = [...S.ris.values()].filter((r) => r.fund === S.currentFund);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (f.type) rows = rows.filter((r) => (r.issue_type || "consumption") === f.type);
  if (q) rows = rows.filter((r) => [r.ris_no, r.department, r.office, r.purpose, r.recipient_name, r.recipient_barangay].some((v) => (v || "").toLowerCase().includes(q)));
  rows.sort((a, b) => (b.ris_no || "").localeCompare(a.ris_no || ""));
  return rows;
}

function renderRis() {
  const saved = captureFocus("view-ris");
  const f = S.risFilter;
  const rows = filterRisRows(f);
  const canE = canEdit("ris");
  document.getElementById("view-ris").innerHTML = `
    <div class="toolbar">
      <input class="grow" id="risSearch" placeholder="Search RIS no., office, recipient, purpose..." value="${esc(f.q)}"/>
      <select id="risTypeFilter">
        <option value="" ${!f.type ? "selected" : ""}>All types</option>
        ${ISSUE_TYPES.map((t) => `<option value="${t.code}" ${f.type === t.code ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
      </select>
      <select id="risStatusFilter">
        <option value="" ${!f.status ? "selected" : ""}>All statuses</option>
        <option value="draft" ${f.status === "draft" ? "selected" : ""}>Draft</option>
        <option value="issued" ${f.status === "issued" ? "selected" : ""}>Issued</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportRisCsv()">Download CSV</button>
        ${canE ? `<button class="btn" onclick="openBulkRisModal()">⇪ Bulk upload</button><button class="btn primary" onclick="openRisModal()">+ New RIS</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>RIS No.</th><th>Date</th><th>Type</th><th>Issued to</th><th>Purpose</th><th class="num">Lines</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openRisDetail('${r.id}')">
          <td>${esc(r.ris_no)}</td><td>${fmtDate(r.date)}</td>
          <td><span class="pill ${r.issue_type === "distribution" ? "distributed" : "consumed"}">${esc(issueTypeLabel(r.issue_type))}</span></td>
          <td>${esc(risIssuedTo(r))}</td>
          <td>${esc(r.purpose || "")}</td>
          <td class="num">${(r.lines || []).length}</td>
          <td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td>
        </tr>`).join("") : `<tr><td colspan="7"><div class="empty">No RIS records match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("risSearch").addEventListener("input", (e) => { S.risFilter.q = e.target.value; renderRis(); });
  document.getElementById("risTypeFilter").addEventListener("change", (e) => { S.risFilter.type = e.target.value; renderRis(); });
  document.getElementById("risStatusFilter").addEventListener("change", (e) => { S.risFilter.status = e.target.value; renderRis(); });
  restoreFocus(saved);
}

function risLineRowHtml(l, idx) {
  const item = l.item_id ? S.items.get(l.item_id) : null;
  return `<tr data-idx="${idx}">
    <td><select class="ris_line_item" data-idx="${idx}">
      <option value="">-- pick item --</option>
      ${issuableItems(S.currentFund).map((a) => `<option value="${a.id}" ${a.id === l.item_id ? "selected" : ""}>${esc(a.stock_no)} - ${esc(a.description)} (${fmtNum(qtyBalance(a))} ${esc(a.unit)})</option>`).join("")}
    </select></td>
    <td>${esc(item ? item.unit : l.unit || "")}</td>
    <td><input class="ris_line_qtyreq" data-idx="${idx}" type="number" step="0.01" value="${l.qty_requested || 0}"/></td>
    <td><input class="ris_line_qtyiss" data-idx="${idx}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : ""}"/></td>
    <td><input class="ris_line_remarks" data-idx="${idx}" value="${esc(l.remarks || "")}"/></td>
    <td><button class="btn ghost" onclick="removeRisLine(${idx})">✕</button></td>
  </tr>`;
}

// Only stock that is actually on hand can be issued - plus whatever this draft already points at,
// so an existing line never silently disappears from its own dropdown.
function issuableItems(fund) {
  return activeItems(fund).filter((a) => Math.abs(qtyBalance(a)) > 1e-9 || _risDraftLines.some((l) => l.item_id === a.id));
}

let _risDraftLines = [];
function addRisLine() { _risDraftLines.push({}); renderRisLinesTable(); }
function removeRisLine(idx) { _risDraftLines.splice(idx, 1); renderRisLinesTable(); }
function renderRisLinesTable() {
  const body = document.getElementById("risLinesBody");
  if (!body) return;
  body.innerHTML = _risDraftLines.map((l, i) => risLineRowHtml(l, i)).join("");
}

function toggleRisRecipientFields() {
  const wrap = document.getElementById("risRecipientWrap");
  if (!wrap) return;
  wrap.hidden = document.getElementById("ris_type").value !== "distribution";
}

function openRisModal(id) {
  if (!canEdit("ris")) { toast("You have view-only access to RIS.", true); return; }
  const r = id ? S.ris.get(id) : null;
  _risDraftLines = r ? (r.lines || []).map((l) => ({ ...l })) : [{}];
  const suggested = r ? r.ris_no : nextDocNumber(S.ris, S.currentFund, todayStr(), "ris_no");
  const type = r ? r.issue_type || "consumption" : "consumption";
  openModal(`
    <div class="modal-head"><h3>${r ? "Edit RIS" : "New RIS"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3">
        <div><label>RIS No.</label><input id="ris_no" value="${esc(suggested)}"/></div>
        <div><label>Date</label><input id="ris_date" type="date" value="${r ? r.date : todayStr()}"/></div>
        <div><label>Type of issuance</label><select id="ris_type" onchange="toggleRisRecipientFields()">
          ${ISSUE_TYPES.map((t) => `<option value="${t.code}" ${type === t.code ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid3">
        <div><label>Department</label><input id="ris_dept" value="${esc(r ? r.department : "")}"/></div>
        <div><label>Office</label><input id="ris_office" value="${esc(r ? r.office || "" : "")}"/></div>
        <div><label>FPP Code</label><input id="ris_fpp" value="${esc(r ? r.fpp_code || "" : "")}"/></div>
      </div>
      <div class="grid2" id="risRecipientWrap" ${type === "distribution" ? "" : "hidden"}>
        <div><label>Recipient (name / group)</label><input id="ris_recipient" value="${esc(r ? r.recipient_name || "" : "")}"/></div>
        <div><label>Barangay / Address</label><input id="ris_barangay" value="${esc(r ? r.recipient_barangay || "" : "")}"/></div>
      </div>
      <div class="hr"></div>
      <table class="line-table"><thead><tr><th>Item</th><th>Unit</th><th>Qty Requested</th><th>Qty Issued</th><th>Remarks</th><th></th></tr></thead>
        <tbody id="risLinesBody"></tbody>
      </table>
      <button class="btn" style="margin-top:8px;" onclick="addRisLine()">+ Add line</button>
      <div class="hr"></div>
      <label>Purpose</label><textarea id="ris_purpose">${esc(r ? r.purpose || "" : "")}</textarea>
      <div class="grid2">
        <div><label>Requested by (name)</label><input id="ris_req_name" value="${esc(r ? r.requested_by_name || "" : "")}"/></div>
        <div><label>Requested by (position)</label><input id="ris_req_pos" value="${esc(r ? r.requested_by_position || "" : "")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Approved by (name)</label><input id="ris_app_name" value="${esc(r ? r.approved_by_name || "" : "")}"/></div>
        <div><label>Approved by (position)</label><input id="ris_app_pos" value="${esc(r ? r.approved_by_position || "" : "")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Issued by (name)</label><input id="ris_iss_name" value="${esc(r ? r.issued_by_name || "" : "")}" placeholder="Property Custodian"/></div>
        <div><label>Issued by (position)</label><input id="ris_iss_pos" value="${esc(r ? r.issued_by_position || "PROPERTY CUSTODIAN" : "PROPERTY CUSTODIAN")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Received by (name)</label><input id="ris_rec_name" value="${esc(r ? r.received_by_name || "" : "")}"/></div>
        <div><label>Received by (position)</label><input id="ris_rec_pos" value="${esc(r ? r.received_by_position || "" : "")}"/></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveRis('${r ? r.id : ""}', false)">Save as draft</button>
    </div>`, "wide");
  renderRisLinesTable();
  document.getElementById("risLinesBody").addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (idx == null || isNaN(idx)) return;
    const l = _risDraftLines[idx] || (_risDraftLines[idx] = {});
    if (e.target.classList.contains("ris_line_item")) {
      l.item_id = e.target.value;
      const item = S.items.get(l.item_id);
      if (item) { l.stock_no = item.stock_no; l.description = item.description; l.unit = item.unit; }
    } else if (e.target.classList.contains("ris_line_qtyreq")) l.qty_requested = Number(e.target.value) || 0;
    else if (e.target.classList.contains("ris_line_qtyiss")) l.qty_issued = e.target.value === "" ? null : Number(e.target.value);
    else if (e.target.classList.contains("ris_line_remarks")) l.remarks = e.target.value;
  });
}

function collectRisLines() {
  return _risDraftLines.filter((l) => l.item_id).map((l) => ({
    id: l.id || uid(), item_id: l.item_id, stock_no: l.stock_no, description: l.description, unit: l.unit,
    qty_requested: Number(l.qty_requested) || 0,
    qty_issued: l.qty_issued == null ? null : Number(l.qty_issued),
    remarks: l.remarks || "",
  }));
}

function saveRis(id, markIssue) {
  if (blockIfViewOnly("ris")) return;
  const ris_no = document.getElementById("ris_no").value.trim();
  const fund = S.currentFund;
  if (numberTaken(S.ris, fund, "ris_no", ris_no, id)) { toast(`RIS No. ${ris_no} is already used in this fund.`, true); return; }
  const issue_type = document.getElementById("ris_type").value;
  const department = document.getElementById("ris_dept").value.trim();
  const recipient_name = document.getElementById("ris_recipient").value.trim();
  if (issue_type === "distribution") {
    if (!recipient_name) { toast("A Distribution RIS needs a Recipient.", true); return; }
  } else if (!department) { toast("Department is required.", true); return; }
  const rec = {
    fund, ris_no, date: document.getElementById("ris_date").value || todayStr(),
    issue_type,
    fpp_code: document.getElementById("ris_fpp").value.trim(),
    department, office: document.getElementById("ris_office").value.trim(),
    recipient_name,
    recipient_barangay: document.getElementById("ris_barangay").value.trim(),
    lines: collectRisLines(),
    purpose: document.getElementById("ris_purpose").value.trim(),
    requested_by_name: document.getElementById("ris_req_name").value.trim(),
    requested_by_position: document.getElementById("ris_req_pos").value.trim(),
    approved_by_name: document.getElementById("ris_app_name").value.trim(),
    approved_by_position: document.getElementById("ris_app_pos").value.trim(),
    issued_by_name: document.getElementById("ris_iss_name").value.trim(),
    issued_by_position: document.getElementById("ris_iss_pos").value.trim(),
    received_by_name: document.getElementById("ris_rec_name").value.trim(),
    received_by_position: document.getElementById("ris_rec_pos").value.trim(),
    status: "draft",
    updated_at: Date.now(),
  };
  if (!rec.lines.length) { toast("Add at least one item line.", true); return; }
  if (id) {
    colRis.doc(id).update(rec).then(() => { toast("RIS saved."); closeModal(); }).catch((e) => toast(e.message, true));
  } else {
    rec.created_at = Date.now();
    colRis.doc().set(rec).then(() => { toast("RIS saved as draft."); closeModal(); }).catch((e) => toast(e.message, true));
  }
}

function openRisDetail(id) {
  const r = S.ris.get(id);
  if (!r) return;
  const canE = canEdit("ris");
  const rows = (r.lines || []).map((l) => `<tr>
      <td>${esc(l.stock_no)}</td><td>${esc(l.description)}</td>
      <td class="num">${fmtNum(l.qty_requested)}</td>
      <td class="num">${l.qty_issued != null ? fmtNum(l.qty_issued) : "—"}</td>
      <td>${esc(l.remarks || "")}</td>
    </tr>`).join("");
  openModal(`
    <div class="modal-head"><h3>RIS ${esc(r.ris_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3 small">
        <div><b>Date</b><br/>${fmtDate(r.date)}</div>
        <div><b>Type</b><br/><span class="pill ${r.issue_type === "distribution" ? "distributed" : "consumed"}">${esc(issueTypeLabel(r.issue_type))}</span></div>
        <div><b>Status</b><br/><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></div>
      </div>
      <div class="grid2 small" style="margin-top:8px;">
        <div><b>Department/Office</b><br/>${esc(r.department || "")}${r.office ? " / " + esc(r.office) : ""}</div>
        <div><b>${r.issue_type === "distribution" ? "Recipient" : "Issued to"}</b><br/>${esc(risIssuedTo(r))}</div>
      </div>
      <div class="hr"></div>
      <div class="table-wrap"><table><thead><tr><th>Stock No.</th><th>Description</th><th class="num">Qty Req.</th><th class="num">Qty Issued</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small" style="margin-top:10px;"><b>Purpose:</b> ${esc(r.purpose || "")}</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="printRis('${r.id}')">Print RIS</button>
      ${canE && r.status !== "issued" ? `<button class="btn" onclick="closeModal();openRisModal('${r.id}')">Edit</button><button class="btn primary" onclick="openIssueRisModal('${r.id}')">Issue</button><button class="btn danger" onclick="deleteRis('${r.id}')">Delete</button>` : ""}
      ${canE && r.status === "issued" ? `<button class="btn danger" onclick="reverseRis('${r.id}')">↩ Reverse issuance</button>` : ""}
    </div>`, "wide");
}

function deleteRis(id) {
  if (blockIfViewOnly("ris")) return;
  const r = S.ris.get(id);
  if (r && r.status === "issued") { toast("An issued RIS can only be undone via Reverse issuance.", true); return; }
  if (!confirm("Delete this draft RIS?")) return;
  colRis.doc(id).delete().then(() => { toast("RIS deleted."); closeModal(); }).catch((e) => toast(e.message, true));
}

function openIssueRisModal(id) {
  if (blockIfViewOnly("ris")) return;
  const r = S.ris.get(id);
  openModal(`
    <div class="modal-head"><h3>Issue RIS ${esc(r.ris_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">Confirm the quantity actually issued for each line. This deducts stock immediately and records it as
        <b>${esc(issueTypeLabel(r.issue_type))}</b> to <b>${esc(risIssuedTo(r))}</b> - it cannot be edited afterward (only reversed).</p>
      <table class="line-table"><thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Qty Req.</th><th>Qty Issued</th></tr></thead>
      <tbody>
        ${(r.lines || []).map((l, i) => {
          const item = S.items.get(l.item_id);
          return `<tr>
            <td>${esc(l.stock_no)} - ${esc(l.description)}</td>
            <td class="num">${item ? fmtNum(qtyBalance(item)) + " " + esc(item.unit) : "—"}</td>
            <td class="num">${fmtNum(l.qty_requested)}</td>
            <td><input class="iss_qty" data-idx="${i}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : l.qty_requested}"/></td>
          </tr>`;
        }).join("")}
      </tbody></table>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="confirmIssueRis('${r.id}')">Confirm issuance</button>
    </div>`, "wide");
}

function confirmIssueRis(id) {
  if (blockIfViewOnly("ris")) return;
  const r = S.ris.get(id);
  const lines = (r.lines || []).map((l, i) => {
    const qtyEl = document.querySelector(`.iss_qty[data-idx="${i}"]`);
    return { ...l, qty_issued: Number(qtyEl.value) || 0 };
  });
  for (const l of lines) {
    const item = S.items.get(l.item_id);
    if (!item) continue;
    if (l.qty_issued > qtyBalance(item) + 1e-6) { toast(`Not enough stock for ${item.description} (balance ${fmtNum(qtyBalance(item))} ${item.unit}).`, true); return; }
  }
  const disposition = issueTypeInfo(r.issue_type).disposition;
  const office = r.office || r.department || "";
  const recipient = r.issue_type === "distribution" ? risIssuedTo(r) : "";
  const writes = [];
  for (const l of lines) {
    if (l.qty_issued <= 0) continue;
    const item = S.items.get(l.item_id);
    if (!item) continue;
    const uc = unitCostBalance(item);
    const entry = {
      id: uid(), type: "issue", date: r.date, ref: r.ris_no,
      qty: l.qty_issued, unit_cost: uc, total_cost: round2(l.qty_issued * uc),
      office, disposition, recipient, ris_id: r.id,
      by: S.currentUser.email, at: Date.now(),
    };
    const ledger = (item.ledger || []).concat([entry]);
    writes.push(colItems.doc(item.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colRis.doc(id).update({ lines, status: "issued", issued_at: Date.now(), issued_by_email: S.currentUser.email }))
    .then(() => { toast(`RIS issued - stock updated (${issueTypeLabel(r.issue_type)}).`); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function reverseRis(id) {
  if (blockIfViewOnly("ris")) return;
  const r = S.ris.get(id);
  if (!confirm(`Reverse issuance of RIS ${r.ris_no}? This restores the issued stock back onto each item and returns the RIS to Draft.`)) return;
  const writes = [];
  for (const l of r.lines || []) {
    const item = S.items.get(l.item_id);
    if (!item || !l.qty_issued) continue;
    const ledger = (item.ledger || []).filter((e) => !(e.ris_id === r.id));
    writes.push(colItems.doc(item.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colRis.doc(id).update({ status: "draft", issued_at: null, reversed_at: Date.now(), reversed_by: S.currentUser.email }))
    .then(() => { toast("Issuance reversed."); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function printRis(id) { openPrintWindow(risHtml(S.ris.get(id)), "portrait"); }

function exportRisCsv() {
  const rows = filterRisRows(S.risFilter);
  const header = ["RIS No.", "Date", "Type", "Department", "Office", "Recipient", "Barangay", "Purpose", "Status", "Stock No.", "Description", "Qty Requested", "Qty Issued", "Remarks"];
  const lines = [header.join(",")];
  for (const r of rows) {
    for (const l of r.lines || []) {
      lines.push([r.ris_no, r.date, issueTypeLabel(r.issue_type), r.department, r.office, r.recipient_name, r.recipient_barangay,
        r.purpose, r.status, l.stock_no, l.description, l.qty_requested, l.qty_issued, l.remarks].map(csvField).join(","));
    }
  }
  browserDownload(`RIS_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Bulk RIS upload - one spreadsheet, many RIS. Each row is one item line; rows that share a
// RIS No. are folded into a single RIS. Everything imports as a Draft, so nothing touches stock
// until each RIS is reviewed and Issued in the normal way.
// ---------------------------------------------------------------------

const BULK_RIS_HEADERS = ["RIS No.", "Date", "Type", "Department", "Office", "Recipient", "Barangay", "FPP Code", "Purpose", "Stock No.", "Qty Requested", "Qty Issued", "Remarks"];
let _bulkRisParsed = null;

function downloadRisTemplate() {
  const sample = [
    ["2026-09-0001", todayStr(), "Consumption", "Municipal Treasurer's Office", "MTO", "", "", "", "Office supplies for the quarter", "OS-0001", "20", "20", ""],
    ["2026-09-0002", todayStr(), "Distribution", "Rural Health Unit", "RHU", "Brgy. Captain Dela Cruz", "Barangay Poblacion", "", "Medicine distribution", "MED-0001", "50", "50", ""],
  ];
  const lines = [BULK_RIS_HEADERS.join(",")].concat(sample.map((r) => r.map(csvField).join(",")));
  browserDownload("RIS_bulk_upload_template.csv", lines.join("\n"), "text/csv");
}

function openBulkRisModal() {
  if (!canEdit("ris")) { toast("You have view-only access to RIS.", true); return; }
  _bulkRisParsed = null;
  openModal(`
    <div class="modal-head"><h3>Bulk upload RIS</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">One row per item line. Rows sharing the same <b>RIS No.</b> become a single RIS. <b>Stock No.</b> must already exist in the Inventory Registry for ${esc(fundLabel(S.currentFund))}. Everything imports as a <b>Draft</b> - stock only moves when you Issue each RIS.</p>
      <p class="small"><b>Columns:</b> ${BULK_RIS_HEADERS.join(" &middot; ")}</p>
      <button class="btn" onclick="downloadRisTemplate()">⇩ Download blank template (CSV)</button>
      <div class="hr"></div>
      <label>Upload a file (.xlsx / .xls / .csv)</label><input id="bulkRisFile" type="file" accept=".xlsx,.xls,.csv"/>
      <label>...or paste rows (tab- or comma-delimited, header row optional)</label>
      <textarea id="bulkRisPaste" rows="7" placeholder="RIS No.&#9;Date&#9;Type&#9;Department&#9;Office&#9;Recipient&#9;Barangay&#9;FPP Code&#9;Purpose&#9;Stock No.&#9;Qty Requested&#9;Qty Issued&#9;Remarks"></textarea>
      <div id="bulkRisPreview"></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="previewBulkRis()">Check rows</button>
      <button class="btn primary" onclick="importBulkRis()">Import as drafts</button>
    </div>`, "wide");
  const fileEl = document.getElementById("bulkRisFile");
  fileEl.addEventListener("change", () => {
    const file = fileEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rowsArr = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        document.getElementById("bulkRisPaste").value = rowsArr.map((r) => (r || []).slice(0, BULK_RIS_HEADERS.length).join("\t")).join("\n");
        previewBulkRis();
      } catch (e) { toast("Could not read that file.", true); }
    };
    reader.readAsArrayBuffer(file);
  });
}

function parseBulkRisText(text) {
  const fund = S.currentFund;
  const errors = [];
  const byNo = new Map();
  const rawLines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  rawLines.forEach((line, i) => {
    const cells = (line.includes("\t") ? line.split("\t") : splitCsvLine(line)).map((c) => c.trim());
    if (!cells[0]) return;
    if (i === 0 && cells[0].toLowerCase().replace(/[^a-z]/g, "") === "risno") return; // header row
    const [ris_no, date, typeRaw, department, office, recipient, barangay, fpp, purpose, stock_no, qtyReq, qtyIss, remarks] = cells;
    const rowNo = i + 1;
    const type = (typeRaw || "").toLowerCase().startsWith("d") ? "distribution" : "consumption";
    const item = itemByStockNo(fund, stock_no);
    if (!stock_no) { errors.push(`Row ${rowNo}: no Stock No.`); return; }
    if (!item) { errors.push(`Row ${rowNo}: Stock No. "${stock_no}" is not in the ${fundLabel(fund)} registry.`); return; }
    if (numberTaken(S.ris, fund, "ris_no", ris_no, null)) { errors.push(`Row ${rowNo}: RIS No. ${ris_no} already exists in this fund.`); return; }
    if (type === "distribution" && !recipient) { errors.push(`Row ${rowNo}: a Distribution row needs a Recipient.`); return; }
    const rec = byNo.get(ris_no) || {
      fund, ris_no, date: date || todayStr(), issue_type: type,
      department: department || "", office: office || "",
      recipient_name: recipient || "", recipient_barangay: barangay || "",
      fpp_code: fpp || "", purpose: purpose || "",
      lines: [], status: "draft",
    };
    rec.lines.push({
      id: uid(), item_id: item.id, stock_no: item.stock_no, description: item.description, unit: item.unit,
      qty_requested: Number(qtyReq) || 0,
      qty_issued: qtyIss === "" || qtyIss == null ? null : Number(qtyIss) || 0,
      remarks: remarks || "",
    });
    byNo.set(ris_no, rec);
  });
  return { records: [...byNo.values()], errors };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function previewBulkRis() {
  const text = document.getElementById("bulkRisPaste").value;
  if (!text.trim()) { toast("Paste some rows or pick a file first.", true); return null; }
  const { records, errors } = parseBulkRisText(text);
  _bulkRisParsed = records;
  const wrap = document.getElementById("bulkRisPreview");
  wrap.innerHTML = `
    <div class="hr"></div>
    <h3 style="font-size:13px;">${records.length} RIS ready &middot; ${records.reduce((s, r) => s + r.lines.length, 0)} line(s)${errors.length ? ` &middot; ${errors.length} row(s) skipped` : ""}</h3>
    ${records.length ? `<div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Date</th><th>Type</th><th>Issued to</th><th class="num">Lines</th></tr></thead><tbody>
      ${records.map((r) => `<tr><td>${esc(r.ris_no)}</td><td>${fmtDate(r.date)}</td>
        <td><span class="pill ${r.issue_type === "distribution" ? "distributed" : "consumed"}">${esc(issueTypeLabel(r.issue_type))}</span></td>
        <td>${esc(risIssuedTo(r))}</td><td class="num">${r.lines.length}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    ${errors.length ? `<div class="panel small" style="margin-top:10px;"><b>Skipped rows</b><br/>${errors.map(esc).join("<br/>")}</div>` : ""}`;
  return records;
}

function importBulkRis() {
  if (blockIfViewOnly("ris")) return;
  const records = _bulkRisParsed || previewBulkRis();
  if (!records || !records.length) { toast("Nothing to import - check the rows first.", true); return; }
  const writes = records.map((rec) => colRis.doc().set({ ...rec, created_at: Date.now(), updated_at: Date.now(), created_by: S.currentUser.email }));
  Promise.all(writes)
    .then(() => { toast(`${records.length} RIS imported as drafts.`); closeModal(); })
    .catch((e) => toast(e.message, true));
}

// ---------------------------------------------------------------------
// AIR - Acceptance and Inspection Report. Every delivery lands here first: the Supply/Property
// Custodian accepts it and the Inspection Officer inspects it, and the AIR sits as "For
// Accounting" until Accounting posts it to the Inventory Registry ("Received in Accounting"),
// which is what actually creates/updates the registry item and its stock balance. Posting is
// reversible (Unpost) - it strips exactly this AIR's receipt entries back out again.
// ---------------------------------------------------------------------

function filterAirRows(f) {
  const q = (f.q || "").toLowerCase();
  let rows = [...S.air.values()].filter((r) => r.fund === S.currentFund);
  if (f.status) rows = rows.filter((r) => (r.status || "for_accounting") === f.status);
  if (q) rows = rows.filter((r) => [r.air_no, r.supplier, r.dept_office, r.po_no, r.inv_no, r.requisitioning_office].some((v) => (v || "").toLowerCase().includes(q)));
  rows.sort((a, b) => (b.air_no || "").localeCompare(a.air_no || ""));
  return rows;
}

function airTotal(r) {
  return (r.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
}

function renderAir() {
  const saved = captureFocus("view-air");
  const f = S.airFilter;
  const rows = filterAirRows(f);
  const canE = canEdit("air");
  document.getElementById("view-air").innerHTML = `
    <div class="panel small">Deliveries are parked here after they are received and inspected. They only become stock in the <b>Inventory Registry</b> once Accounting opens the AIR and clicks <b>Received in Accounting</b>.</div>
    <div class="toolbar">
      <input class="grow" id="airSearch" placeholder="Search AIR no., supplier, PO no., office..." value="${esc(f.q)}"/>
      <select id="airStatusFilter">
        <option value="" ${!f.status ? "selected" : ""}>All statuses</option>
        <option value="for_accounting" ${f.status === "for_accounting" ? "selected" : ""}>For Accounting</option>
        <option value="posted" ${f.status === "posted" ? "selected" : ""}>In Registry</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportAirCsv()">Download CSV</button>
        ${canE ? `<button class="btn" onclick="openBulkAirModal()">⇪ Bulk upload</button><button class="btn primary" onclick="openAirModal()">+ New AIR</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>AIR No.</th><th>Date</th><th>Supplier</th><th>Dept/Office</th><th class="num">Items</th><th class="num">Value</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openAirDetail('${r.id}')">
          <td>${esc(r.air_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.supplier || "")}</td><td>${esc(r.dept_office || "")}</td>
          <td class="num">${(r.lines || []).length}</td>
          <td class="num">${fmtMoney(airTotal(r))}</td>
          <td><span class="pill ${r.status === "posted" ? "ok" : "muted"}">${r.status === "posted" ? "In Registry" : "For Accounting"}</span></td>
        </tr>`).join("") : `<tr><td colspan="7"><div class="empty">No Acceptance and Inspection Reports match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("airSearch").addEventListener("input", (e) => { S.airFilter.q = e.target.value; renderAir(); });
  document.getElementById("airStatusFilter").addEventListener("change", (e) => { S.airFilter.status = e.target.value; renderAir(); });
  restoreFocus(saved);
}

// The item picker on an AIR line searches the registry by EITHER stock code or item name: the
// datalist option's value holds both ("OS-0001 — Bond Paper A4"), and browsers substring-match
// that value, so typing "OS-00" or "bond" both narrow it. Whatever is typed that doesn't resolve
// to a registry item is treated as a brand-new stock code, which posting will create.
function airItemLabel(a) { return `${a.stock_no} — ${a.description}`; }
function parseStockInput(raw) {
  const s = String(raw || "").trim();
  const i = s.indexOf(" — ");
  return i > 0 ? s.slice(0, i).trim() : s;
}
function airItemDatalistHtml(fund) {
  return `<datalist id="airItemList">${activeItems(fund)
    .sort((a, b) => (a.stock_no || "").localeCompare(b.stock_no || ""))
    .map((a) => `<option value="${esc(airItemLabel(a))}">${esc(a.unit || "")} &middot; on hand ${fmtNum(qtyBalance(a))}</option>`)
    .join("")}</datalist>`;
}

function airLineRowHtml(l, idx) {
  const known = itemByStockNo(S.currentFund, l.stock_no);
  const shown = known ? airItemLabel(known) : (l.stock_no || "");
  const med = isMedicineAccount(l.account_code || (known && known.account_code));
  return `<tr data-idx="${idx}">
    <td><input class="air_line_stockno" data-idx="${idx}" list="airItemList" value="${esc(shown)}" placeholder="Search code or item name, or type a new code"/>
      <div class="small air_line_hint" data-idx="${idx}">${known ? "in registry &middot; on hand " + fmtNum(qtyBalance(known)) + " " + esc(known.unit || "") : (l.stock_no ? "new stock code - a new registry item will be created" : "")}</div></td>
    <td><input class="air_line_desc" data-idx="${idx}" value="${esc(l.description || "")}"/></td>
    <td><input class="air_line_unit" data-idx="${idx}" value="${esc(l.unit || "")}" style="width:70px;"/></td>
    <td><input class="air_line_qty" data-idx="${idx}" type="number" step="0.01" value="${l.qty || 0}" style="width:80px;"/></td>
    <td><input class="air_line_unitcost" data-idx="${idx}" type="number" step="0.01" value="${l.unit_cost || 0}" style="width:90px;"/></td>
    <td><select class="air_line_account" data-idx="${idx}">${accountOptionsHtml(l.account_code || (known && known.account_code))}</select></td>
    <td><button class="btn ghost" onclick="removeAirLine(${idx})">✕</button></td>
  </tr>
  <tr class="air_line_extra" data-idx="${idx}" ${med ? "" : "hidden"}>
    <td colspan="7" style="background:var(--accent-soft);">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="small"><b>Health Unit medicine</b> - record the batch and expiry:</span>
        <label style="margin:0;" class="small">Batch / Lot No.
          <input class="air_line_batch" data-idx="${idx}" value="${esc(l.batch_no || "")}" style="width:130px;"/></label>
        <label style="margin:0;" class="small">Expiry date
          <input class="air_line_expiry" data-idx="${idx}" type="date" value="${esc(l.expiry_date || "")}" style="width:160px;"/></label>
      </div>
    </td>
  </tr>`;
}

// Batch no. and expiry only apply to Health Unit medicines, so their sub-row is shown or hidden
// in place - never by re-rendering the table, which would wipe whatever field is being typed into.
function syncAirMedicineFields(body, idx, accountCode) {
  const med = isMedicineAccount(accountCode);
  const extra = body.querySelector(`.air_line_extra[data-idx="${idx}"]`);
  if (extra) extra.hidden = !med;
  if (!med) {
    for (const cls of ["air_line_batch", "air_line_expiry"]) {
      const el = body.querySelector(`.${cls}[data-idx="${idx}"]`);
      if (el) el.value = "";
    }
  }
}

let _airDraftLines = [];
function addAirLine() { _airDraftLines.push({}); renderAirLinesTable(); }
function removeAirLine(idx) { _airDraftLines.splice(idx, 1); renderAirLinesTable(); }
function renderAirLinesTable() {
  const body = document.getElementById("airLinesBody");
  if (!body) return;
  body.innerHTML = _airDraftLines.map((l, i) => airLineRowHtml(l, i)).join("");
}

function openAirModal(id) {
  if (!canEdit("air")) { toast("You have view-only access to AIR.", true); return; }
  const r = id ? S.air.get(id) : null;
  if (r && r.status === "posted") { toast("This AIR is already in the registry - unpost it first to edit.", true); return; }
  _airDraftLines = r ? (r.lines || []).map((l) => ({ ...l })) : [{}];
  const suggested = r ? r.air_no : nextDocNumber(S.air, S.currentFund, todayStr(), "air_no");
  openModal(`
    <div class="modal-head"><h3>${r ? "Edit AIR" : "New Acceptance and Inspection Report"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3">
        <div><label>AIR No.</label><input id="air_no" value="${esc(suggested)}"/></div>
        <div><label>Date</label><input id="air_date" type="date" value="${r ? r.date : todayStr()}"/></div>
        <div><label>Dept/Office</label><input id="air_dept" value="${esc(r ? r.dept_office || "" : "")}"/></div>
      </div>
      <div class="grid3">
        <div><label>Supplier</label><input id="air_supplier" value="${esc(r ? r.supplier || "" : "")}"/></div>
        <div><label>PO No.</label><input id="air_pono" value="${esc(r ? r.po_no || "" : "")}"/></div>
        <div><label>PO Date</label><input id="air_podate" type="date" value="${r ? r.po_date || "" : ""}"/></div>
      </div>
      <div class="grid3">
        <div><label>Requisitioning Office/Dept.</label><input id="air_reqoffice" value="${esc(r ? r.requisitioning_office || "" : "")}"/></div>
        <div><label>Invoice No.</label><input id="air_invno" value="${esc(r ? r.inv_no || "" : "")}"/></div>
        <div><label>Invoice Date</label><input id="air_invdate" type="date" value="${r ? r.inv_date || "" : ""}"/></div>
      </div>
      <div class="hr"></div>
      ${airItemDatalistHtml(S.currentFund)}
      <div class="table-wrap">
        <table class="line-table"><thead><tr><th>Item (search code or name)</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Unit Cost</th><th>Inventory account</th><th></th></tr></thead>
          <tbody id="airLinesBody"></tbody>
        </table>
      </div>
      <button class="btn" style="margin-top:8px;" onclick="addAirLine()">+ Add line</button>
      <p class="small">Start typing a <b>stock code or item name</b> to pick something already in the registry - anything else you type is treated as a <b>new stock code</b> and becomes a new registry item when Accounting posts this AIR. A line on the <b>Drugs and Medicines (10404060)</b> account opens a batch/expiry row underneath it - that is what feeds the Medicines &middot; RHU tab's expiry warnings. Unit Cost and the inventory account are not on the printed AIR form - they're captured here because the registry needs them to value the stock.</p>
      <div class="hr"></div>
      <div class="grid2">
        <div>
          <label>Acceptance - Date Received</label><input id="air_daterec" type="date" value="${r ? r.date_received || todayStr() : todayStr()}"/>
          <label>Acceptance</label>
          <select id="air_acceptance">
            <option value="complete" ${!r || r.acceptance !== "partial" ? "selected" : ""}>Complete</option>
            <option value="partial" ${r && r.acceptance === "partial" ? "selected" : ""}>Partial (pls. specify)</option>
          </select>
          <label>If partial, specify</label><input id="air_partial" value="${esc(r ? r.partial_note || "" : "")}"/>
          <label>Supply and/or Property Custodian</label><input id="air_custodian" value="${esc(r ? r.custodian_name || "" : "")}"/>
        </div>
        <div>
          <label>Inspection - Date Inspected</label><input id="air_dateinsp" type="date" value="${r ? r.date_inspected || todayStr() : todayStr()}"/>
          <label style="display:flex;align-items:center;gap:8px;margin-top:12px;"><input type="checkbox" id="air_inspected" style="width:auto;" ${!r || r.inspected_ok !== false ? "checked" : ""}/> Inspected, verified and found in order as to quantity and specifications</label>
          <label>Inspection Officer/Inspection Committee</label><input id="air_inspector" value="${esc(r ? r.inspector_name || "" : "")}"/>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveAir('${r ? r.id : ""}')">Save AIR</button>
    </div>`, "wide");
  renderAirLinesTable();
  const body = document.getElementById("airLinesBody");
  const onEdit = (e) => {
    const idx = Number(e.target.dataset.idx);
    if (idx == null || isNaN(idx)) return;
    const l = _airDraftLines[idx] || (_airDraftLines[idx] = {});
    if (e.target.classList.contains("air_line_stockno")) {
      // Accepts either a picked "CODE — Description" suggestion or a freely typed new code.
      l.stock_no = parseStockInput(e.target.value);
      const known = itemByStockNo(S.currentFund, l.stock_no);
      const hint = body.querySelector(`.air_line_hint[data-idx="${idx}"]`);
      if (hint) {
        hint.textContent = known
          ? `in registry · ${known.description} · on hand ${fmtNum(qtyBalance(known))} ${known.unit || ""}`
          : (l.stock_no ? "new stock code - a new registry item will be created" : "");
      }
      if (known) {
        // Pre-fill the rest of the row from that item, so this delivery files itself inside it.
        // Patched in place on purpose - re-rendering the table here would yank away whatever
        // field is being typed into next.
        const fill = (cls, val) => {
          const el = body.querySelector(`.${cls}[data-idx="${idx}"]`);
          if (el && !el.value) el.value = val || "";
        };
        if (!l.description) { l.description = known.description; fill("air_line_desc", known.description); }
        if (!l.unit) { l.unit = known.unit; fill("air_line_unit", known.unit); }
        if (!l.account_code) {
          l.account_code = known.account_code;
          const sel = body.querySelector(`.air_line_account[data-idx="${idx}"]`);
          if (sel) sel.value = known.account_code;
        }
        syncAirMedicineFields(body, idx, l.account_code);
      }
    } else if (e.target.classList.contains("air_line_desc")) l.description = e.target.value;
    else if (e.target.classList.contains("air_line_unit")) l.unit = e.target.value;
    else if (e.target.classList.contains("air_line_qty")) l.qty = Number(e.target.value) || 0;
    else if (e.target.classList.contains("air_line_unitcost")) l.unit_cost = Number(e.target.value) || 0;
    else if (e.target.classList.contains("air_line_batch")) l.batch_no = e.target.value.trim();
    else if (e.target.classList.contains("air_line_expiry")) l.expiry_date = e.target.value;
    else if (e.target.classList.contains("air_line_account")) {
      l.account_code = e.target.value;
      if (!isMedicineAccount(l.account_code)) { l.batch_no = ""; l.expiry_date = ""; }
      syncAirMedicineFields(body, idx, l.account_code);
    }
  };
  // "input" keeps the draft in step with every keystroke; "change" catches the select.
  body.addEventListener("input", onEdit);
  body.addEventListener("change", onEdit);
}

function collectAirLines() {
  return _airDraftLines.filter((l) => (l.stock_no || "").trim()).map((l) => ({
    id: l.id || uid(),
    stock_no: (l.stock_no || "").trim(),
    description: (l.description || "").trim(),
    unit: (l.unit || "").trim(),
    qty: Number(l.qty) || 0,
    unit_cost: Number(l.unit_cost) || 0,
    account_code: l.account_code || ACCOUNT_CATALOG[0].code,
    batch_no: isMedicineAccount(l.account_code) ? (l.batch_no || "") : "",
    expiry_date: isMedicineAccount(l.account_code) ? (l.expiry_date || "") : "",
  }));
}

function saveAir(id) {
  if (blockIfViewOnly("air")) return;
  const air_no = document.getElementById("air_no").value.trim();
  const fund = S.currentFund;
  if (numberTaken(S.air, fund, "air_no", air_no, id)) { toast(`AIR No. ${air_no} is already used in this fund.`, true); return; }
  const lines = collectAirLines();
  if (!lines.length) { toast("Add at least one item line (a Stock/Property No. is required).", true); return; }
  const rec = {
    fund, air_no, date: document.getElementById("air_date").value || todayStr(),
    dept_office: document.getElementById("air_dept").value.trim(),
    supplier: document.getElementById("air_supplier").value.trim(),
    po_no: document.getElementById("air_pono").value.trim(),
    po_date: document.getElementById("air_podate").value || "",
    requisitioning_office: document.getElementById("air_reqoffice").value.trim(),
    inv_no: document.getElementById("air_invno").value.trim(),
    inv_date: document.getElementById("air_invdate").value || "",
    lines,
    date_received: document.getElementById("air_daterec").value || "",
    acceptance: document.getElementById("air_acceptance").value,
    partial_note: document.getElementById("air_partial").value.trim(),
    custodian_name: document.getElementById("air_custodian").value.trim(),
    date_inspected: document.getElementById("air_dateinsp").value || "",
    inspected_ok: document.getElementById("air_inspected").checked,
    inspector_name: document.getElementById("air_inspector").value.trim(),
    status: "for_accounting",
    updated_at: Date.now(),
  };
  if (id) {
    colAir.doc(id).update(rec).then(() => { toast("AIR saved."); closeModal(); }).catch((e) => toast(e.message, true));
  } else {
    rec.created_at = Date.now();
    colAir.doc().set(rec).then(() => { toast("AIR saved - waiting for Accounting."); closeModal(); }).catch((e) => toast(e.message, true));
  }
}

function openAirDetail(id) {
  const r = S.air.get(id);
  if (!r) return;
  const canE = canEdit("air");
  const posted = r.status === "posted";
  const rows = (r.lines || []).map((l) => {
    const known = itemByStockNo(r.fund, l.stock_no);
    return `<tr>
      <td>${esc(l.stock_no)}${known ? ` <span class="pill muted">${posted ? "in registry" : "existing item"}</span>` : (posted ? "" : ' <span class="pill check">new item</span>')}</td>
      <td>${esc(l.description)}</td><td>${esc(l.unit)}</td>
      <td class="num">${fmtNum(l.qty)}</td>
      <td class="num">${fmtNum(l.unit_cost)}</td>
      <td class="num">${fmtMoney((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</td>
      <td>${l.batch_no || l.expiry_date ? `${esc(l.batch_no || "")}${l.expiry_date ? `<div class="small">exp. ${fmtDate(l.expiry_date)} ${expiryPillHtml(l.expiry_date)}</div>` : ""}` : ""}</td>
    </tr>`;
  }).join("");
  openModal(`
    <div class="modal-head"><h3>AIR ${esc(r.air_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3 small">
        <div><b>Date</b><br/>${fmtDate(r.date)}</div>
        <div><b>Supplier</b><br/>${esc(r.supplier || "")}</div>
        <div><b>Status</b><br/><span class="pill ${posted ? "ok" : "muted"}">${posted ? "Received in Accounting - in Registry" : "For Accounting"}</span></div>
      </div>
      <div class="grid3 small" style="margin-top:8px;">
        <div><b>Dept/Office</b><br/>${esc(r.dept_office || "")}</div>
        <div><b>PO No./Date</b><br/>${esc(r.po_no || "")}${r.po_date ? " / " + fmtDate(r.po_date) : ""}</div>
        <div><b>Invoice No./Date</b><br/>${esc(r.inv_no || "")}${r.inv_date ? " / " + fmtDate(r.inv_date) : ""}</div>
      </div>
      <div class="hr"></div>
      <div class="table-wrap"><table><thead><tr><th>Stock/Property No.</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Amount</th><th>Batch / Expiry</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5" class="num"><b>Total</b></td><td class="num"><b>${fmtMoney(airTotal(r))}</b></td><td></td></tr></tfoot></table></div>
      <div class="grid2 small" style="margin-top:10px;">
        <div><b>Acceptance</b><br/>${r.acceptance === "partial" ? "Partial" : "Complete"}${r.partial_note ? " - " + esc(r.partial_note) : ""}<br/>Received ${r.date_received ? fmtDate(r.date_received) : "—"} &middot; ${esc(r.custodian_name || "")}</div>
        <div><b>Inspection</b><br/>${r.inspected_ok ? "Inspected, verified and found in order" : "Not yet inspected"}<br/>Inspected ${r.date_inspected ? fmtDate(r.date_inspected) : "—"} &middot; ${esc(r.inspector_name || "")}</div>
      </div>
      ${posted ? `<p class="small" style="margin-top:10px;">Posted to the registry ${r.posted_at ? "on " + fmtDate(new Date(r.posted_at).toISOString().slice(0, 10)) : ""} by ${esc(r.posted_by || "")}.</p>` : ""}
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="printAir('${r.id}')">Print AIR</button>
      ${canE && !posted ? `<button class="btn" onclick="closeModal();openAirModal('${r.id}')">Edit</button><button class="btn primary" onclick="openPostAirModal('${r.id}')">Received in Accounting</button><button class="btn danger" onclick="deleteAir('${r.id}')">Delete</button>` : ""}
      ${canE && posted ? `<button class="btn danger" onclick="unpostAir('${r.id}')">↩ Unpost from registry</button>` : ""}
    </div>`, "wide");
}

function deleteAir(id) {
  if (blockIfViewOnly("air")) return;
  const r = S.air.get(id);
  if (r && r.status === "posted") { toast("This AIR is in the registry - unpost it first.", true); return; }
  if (!confirm("Delete this AIR?")) return;
  colAir.doc(id).delete().then(() => { toast("AIR deleted."); closeModal(); }).catch((e) => toast(e.message, true));
}

function openPostAirModal(id) {
  if (blockIfViewOnly("air")) return;
  const r = S.air.get(id);
  const rows = (r.lines || []).map((l) => {
    const known = itemByStockNo(r.fund, l.stock_no);
    return `<tr>
      <td>${esc(l.stock_no)} - ${esc(l.description)}</td>
      <td class="num">${fmtNum(l.qty)} ${esc(l.unit)}</td>
      <td>${known ? `<span class="pill ok">filed inside existing item</span><div class="small">${esc(known.description)} &middot; balance now ${fmtNum(qtyBalance(known))} ${esc(known.unit)}</div>`
                  : `<span class="pill check">creates a new registry item</span>`}</td>
    </tr>`;
  }).join("");
  openModal(`
    <div class="modal-head"><h3>Received in Accounting - AIR ${esc(r.air_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">This moves the delivery into the <b>Inventory Registry</b>. Each line goes <i>inside</i> the item with the same Stock/Property No. if one already exists in ${esc(fundLabel(r.fund))}; otherwise a new item is created. It can be undone with Unpost.</p>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty</th><th>Where it lands</th></tr></thead><tbody>${rows}</tbody></table></div>
      <label>Posted by (Accounting)</label><input id="air_postedby" value="${esc(S.currentUser.email)}"/>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="confirmPostAir('${r.id}')">Confirm - move to Inventory Registry</button>
    </div>`, "wide");
}

function confirmPostAir(id) {
  if (blockIfViewOnly("air")) return;
  const r = S.air.get(id);
  if (!r || r.status === "posted") return;
  const postedBy = (document.getElementById("air_postedby") || {}).value || S.currentUser.email;
  const writes = [];
  const newDocs = [];
  // Group this AIR's lines by stock number first, so two lines of the same stock number in one
  // AIR still end up inside a single registry item.
  const pending = new Map();
  for (const l of r.lines || []) {
    const qty = Number(l.qty) || 0;
    if (qty <= 0) continue;
    const key = String(l.stock_no).trim().toLowerCase();
    const entry = {
      id: uid(), type: "receipt", date: r.date_received || r.date,
      ref: r.air_no, qty, unit_cost: Number(l.unit_cost) || 0, total_cost: round2(qty * (Number(l.unit_cost) || 0)),
      air_id: r.id, supplier: r.supplier || "",
      batch_no: l.batch_no || "", expiry_date: l.expiry_date || "",
      by: S.currentUser.email, at: Date.now(),
    };
    const cur = pending.get(key) || { line: l, entries: [] };
    cur.entries.push(entry);
    pending.set(key, cur);
  }
  if (!pending.size) { toast("Nothing to post - every line has zero quantity.", true); return; }
  for (const { line, entries } of pending.values()) {
    const existing = itemByStockNo(r.fund, line.stock_no);
    if (existing) {
      const ledger = (existing.ledger || []).concat(entries);
      const last = entries[entries.length - 1];
      writes.push(colItems.doc(existing.id).update({ ledger, unit_cost: last.unit_cost, status: "active", updated_at: Date.now() }));
    } else {
      const info = accountInfo(line.account_code);
      const last = entries[entries.length - 1];
      newDocs.push({
        fund: r.fund,
        account_code: line.account_code || ACCOUNT_CATALOG[0].code,
        account_name: info ? info.name : "",
        stock_no: line.stock_no,
        description: line.description,
        item: line.description,
        unit: line.unit,
        reorder_point: 0,
        unit_cost: last.unit_cost,
        expense_account_code: info && info.expense ? info.expense.code : "",
        expense_account_name: info && info.expense ? info.expense.name : "",
        status: "active",
        ledger: entries,
        created_at: Date.now(), updated_at: Date.now(),
      });
    }
  }
  for (const doc of newDocs) writes.push(colItems.doc().set(doc));
  Promise.all(writes)
    .then(() => colAir.doc(id).update({ status: "posted", posted_at: Date.now(), posted_by: postedBy }))
    .then(() => { toast("AIR received in Accounting - stock is now in the Inventory Registry."); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function unpostAir(id) {
  if (blockIfViewOnly("air")) return;
  const r = S.air.get(id);
  if (!confirm(`Unpost AIR ${r.air_no} from the Inventory Registry? This removes exactly this AIR's receipts from every affected item and returns it to "For Accounting".`)) return;
  const writes = [];
  for (const a of S.items.values()) {
    if (a.fund !== r.fund) continue;
    const ledger = (a.ledger || []).filter((e) => e.air_id !== r.id);
    if (ledger.length !== (a.ledger || []).length) writes.push(colItems.doc(a.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colAir.doc(id).update({ status: "for_accounting", posted_at: null, unposted_at: Date.now(), unposted_by: S.currentUser.email }))
    .then(() => { toast("AIR unposted - the stock was removed from the registry."); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function printAir(id) { openPrintWindow(airHtml(S.air.get(id)), "portrait"); }

function exportAirCsv() {
  const rows = filterAirRows(S.airFilter);
  const header = ["AIR No.", "Date", "Supplier", "Dept/Office", "PO No.", "Invoice No.", "Status", "Stock/Property No.", "Description", "Unit", "Quantity", "Unit Cost", "Amount", "Batch No.", "Expiry"];
  const lines = [header.join(",")];
  for (const r of rows) {
    for (const l of r.lines || []) {
      lines.push([r.air_no, r.date, r.supplier, r.dept_office, r.po_no, r.inv_no, r.status === "posted" ? "In Registry" : "For Accounting",
        l.stock_no, l.description, l.unit, l.qty, l.unit_cost, round2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0)),
        l.batch_no || "", l.expiry_date || ""].map(csvField).join(","));
    }
  }
  browserDownload(`AIR_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Bulk AIR upload - one spreadsheet, many Acceptance reports. Each row is one delivered item;
// rows sharing an AIR No. are folded into a single AIR. Everything imports as "For Accounting",
// so nothing becomes stock until each AIR is reviewed and received in Accounting as usual.
// ---------------------------------------------------------------------

const BULK_AIR_HEADERS = ["AIR No.", "Date", "Dept/Office", "Supplier", "PO No.", "PO Date",
  "Requisitioning Office", "Invoice No.", "Invoice Date", "Date Received", "Acceptance", "Date Inspected",
  "Custodian", "Inspector", "Stock/Property No.", "Description", "Unit", "Quantity", "Unit Cost",
  "Account Code", "Batch No.", "Expiry"];
let _bulkAirParsed = null;

function downloadAirTemplate() {
  const today = todayStr();
  const sample = [
    ["2026-09-9001", today, "General Services Office", "ABC Trading", "PO-2026-0142", today,
      "Municipal Treasurer's Office", "SI-88213", today, today, "Complete", today,
      "JUAN D. DELA CRUZ", "MARIA L. SANTOS", "OS-0001", "Bond Paper, A4", "REAM", "100", "250",
      "10404010", "", ""],
    ["2026-09-9002", today, "Rural Health Unit", "MedSupply Inc.", "PO-2026-0150", today,
      "Rural Health Unit", "SI-90011", today, today, "Complete", today,
      "JUAN D. DELA CRUZ", "MARIA L. SANTOS", "MED-0001", "Paracetamol 500mg", "TABLET", "5000", "2",
      "10404060", "LOT-2026-A", "2027-06-30"],
  ];
  const lines = [BULK_AIR_HEADERS.join(",")].concat(sample.map((r) => r.map(csvField).join(",")));
  browserDownload("AIR_bulk_upload_template.csv", lines.join("\n"), "text/csv");
}

function openBulkAirModal() {
  if (!canEdit("air")) { toast("You have view-only access to Acceptance.", true); return; }
  _bulkAirParsed = null;
  openModal(`
    <div class="modal-head"><h3>Bulk upload Acceptance reports</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">One row per delivered item. Rows sharing the same <b>AIR No.</b> become a single Acceptance report, taking their header details (supplier, dates, signatories) from the first of those rows. A <b>Stock/Property No.</b> already in the ${esc(fundLabel(S.currentFund))} registry files itself inside that item on posting; anything else becomes a new item. Everything imports as <b>For Accounting</b> - nothing becomes stock until you receive each one in Accounting.</p>
      <p class="small"><b>Columns:</b> ${BULK_AIR_HEADERS.join(" &middot; ")}</p>
      <p class="small"><b>Acceptance</b> is "Complete" or "Partial". <b>Account Code</b> is the inventory account (e.g. 10404010); leave it blank to inherit it from an existing item or fall back to Other Supplies. <b>Batch No.</b> and <b>Expiry</b> apply to medicines (10404060) and are ignored elsewhere.</p>
      <button class="btn" onclick="downloadAirTemplate()">⇩ Download blank template (CSV)</button>
      <div class="hr"></div>
      <label>Upload a file (.xlsx / .xls / .csv)</label><input id="bulkAirFile" type="file" accept=".xlsx,.xls,.csv"/>
      <label>...or paste rows (tab- or comma-delimited, header row optional)</label>
      <textarea id="bulkAirPaste" rows="7" placeholder="AIR No.&#9;Date&#9;Dept/Office&#9;Supplier&#9;..."></textarea>
      <div id="bulkAirPreview"></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="previewBulkAir()">Check rows</button>
      <button class="btn primary" onclick="importBulkAir()">Import for Accounting</button>
    </div>`, "wide");
  const fileEl = document.getElementById("bulkAirFile");
  fileEl.addEventListener("change", () => {
    const file = fileEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rowsArr = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        document.getElementById("bulkAirPaste").value = rowsArr.map((r) => (r || []).slice(0, BULK_AIR_HEADERS.length).join("\t")).join("\n");
        previewBulkAir();
      } catch (e) { toast("Could not read that file.", true); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Excel hands dates back in a few shapes depending on how the sheet was formatted; normalise the
// common ones to the YYYY-MM-DD the date inputs and the ledger use.
function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return "";
}

function parseBulkAirText(text) {
  const fund = S.currentFund;
  const errors = [];
  const byNo = new Map();
  const rawLines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  rawLines.forEach((line, i) => {
    const cells = (line.includes("\t") ? line.split("\t") : splitCsvLine(line)).map((c) => c.trim());
    if (!cells[0]) return;
    if (i === 0 && cells[0].toLowerCase().replace(/[^a-z]/g, "") === "airno") return; // header row
    const [air_no, date, dept_office, supplier, po_no, po_date, requisitioning_office, inv_no, inv_date,
      date_received, acceptanceRaw, date_inspected, custodian_name, inspector_name,
      stock_no, description, unit, qtyRaw, unitCostRaw, accountRaw, batch_no, expiryRaw] = cells;
    const rowNo = i + 1;
    if (!stock_no) { errors.push(`Row ${rowNo}: no Stock/Property No.`); return; }
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) { errors.push(`Row ${rowNo}: quantity must be greater than zero.`); return; }
    if (numberTaken(S.air, fund, "air_no", air_no, null)) { errors.push(`Row ${rowNo}: AIR No. ${air_no} already exists in this fund.`); return; }
    const known = itemByStockNo(fund, stock_no);
    let account_code = String(accountRaw || "").trim();
    if (account_code && !accountInfo(account_code)) {
      errors.push(`Row ${rowNo}: account code "${account_code}" isn't in the chart of accounts.`);
      return;
    }
    if (!account_code) account_code = (known && known.account_code) || "10404990";
    const rec = byNo.get(air_no) || {
      fund, air_no, date: normalizeDate(date) || todayStr(),
      dept_office: dept_office || "", supplier: supplier || "",
      po_no: po_no || "", po_date: normalizeDate(po_date),
      requisitioning_office: requisitioning_office || "",
      inv_no: inv_no || "", inv_date: normalizeDate(inv_date),
      date_received: normalizeDate(date_received) || normalizeDate(date) || todayStr(),
      acceptance: String(acceptanceRaw || "").toLowerCase().startsWith("p") ? "partial" : "complete",
      partial_note: "",
      date_inspected: normalizeDate(date_inspected) || normalizeDate(date) || todayStr(),
      inspected_ok: true,
      custodian_name: custodian_name || "", inspector_name: inspector_name || "",
      lines: [], status: "for_accounting",
      _new_items: 0, _existing_items: 0,
    };
    const med = isMedicineAccount(account_code);
    rec.lines.push({
      id: uid(),
      stock_no, description: description || (known ? known.description : ""),
      unit: unit || (known ? known.unit : ""),
      qty, unit_cost: Number(unitCostRaw) || 0, account_code,
      batch_no: med ? (batch_no || "") : "",
      expiry_date: med ? normalizeDate(expiryRaw) : "",
    });
    if (known) rec._existing_items++; else rec._new_items++;
    byNo.set(air_no, rec);
  });
  return { records: [...byNo.values()], errors };
}

function previewBulkAir() {
  const text = document.getElementById("bulkAirPaste").value;
  if (!text.trim()) { toast("Paste some rows or pick a file first.", true); return null; }
  const { records, errors } = parseBulkAirText(text);
  _bulkAirParsed = records;
  const wrap = document.getElementById("bulkAirPreview");
  wrap.innerHTML = `
    <div class="hr"></div>
    <h3 style="font-size:13px;">${records.length} Acceptance report(s) ready &middot; ${records.reduce((s, r) => s + r.lines.length, 0)} line(s)${errors.length ? ` &middot; ${errors.length} row(s) skipped` : ""}</h3>
    ${records.length ? `<div class="table-wrap"><table><thead><tr><th>AIR No.</th><th>Date</th><th>Supplier</th><th>Dept/Office</th><th class="num">Lines</th><th class="num">Value</th><th>Items</th></tr></thead><tbody>
      ${records.map((r) => `<tr><td>${esc(r.air_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.supplier)}</td><td>${esc(r.dept_office)}</td>
        <td class="num">${r.lines.length}</td><td class="num">${fmtMoney(airTotal(r))}</td>
        <td class="small">${r._existing_items ? `${r._existing_items} existing` : ""}${r._existing_items && r._new_items ? " &middot; " : ""}${r._new_items ? `<span class="pill check">${r._new_items} new</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    ${errors.length ? `<div class="panel small" style="margin-top:10px;"><b>Skipped rows</b><br/>${errors.map(esc).join("<br/>")}</div>` : ""}`;
  return records;
}

function importBulkAir() {
  if (blockIfViewOnly("air")) return;
  const records = _bulkAirParsed || previewBulkAir();
  if (!records || !records.length) { toast("Nothing to import - check the rows first.", true); return; }
  const writes = records.map((rec) => {
    const { _new_items, _existing_items, ...doc } = rec;
    return colAir.doc().set({ ...doc, created_at: Date.now(), updated_at: Date.now(), created_by: S.currentUser.email });
  });
  Promise.all(writes)
    .then(() => { toast(`${records.length} Acceptance report(s) imported - waiting for Accounting.`); closeModal(); })
    .catch((e) => toast(e.message, true));
}


// ---------------------------------------------------------------------
// RSMI - Report of Supplies and Materials Issued (generated recap of issued RIS)
// ---------------------------------------------------------------------

function renderRsmi() {
  const fund = S.currentFund;
  const rows = [...S.rsmi.values()].filter((r) => r.fund === fund).sort((a, b) => (b.serial_no || "").localeCompare(a.serial_no || ""));
  const canE = canEdit("rsmi");
  document.getElementById("view-rsmi").innerHTML = `
    <div class="toolbar">
      <div class="toolbar-right" style="margin-left:0;">
        ${canE ? `<button class="btn primary" onclick="openGenerateRsmiModal()">+ Generate RSMI</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Serial No.</th><th>Period</th><th class="num"># Lines</th><th class="num">Total Amount</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openRsmiDetail('${r.id}')">
          <td>${esc(r.serial_no)}</td><td>${fmtDate(r.period_from)} - ${fmtDate(r.period_to)}</td>
          <td class="num">${(r.lines || []).length}</td>
          <td class="num">${fmtMoney((r.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0))}</td>
        </tr>`).join("") : `<tr><td colspan="4"><div class="empty">No RSMI generated yet for ${esc(fundLabel(fund))}.</div></td></tr>`}</tbody>
    </table></div>`;
}

function openGenerateRsmiModal() {
  if (!canEdit("rsmi")) { toast("You have view-only access to RSMI.", true); return; }
  const today = todayStr();
  const firstOfMonth = today.slice(0, 8) + "01";
  openModal(`
    <div class="modal-head"><h3>Generate RSMI</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid2">
        <div><label>Period from</label><input id="rsmi_from" type="date" value="${firstOfMonth}"/></div>
        <div><label>Period to</label><input id="rsmi_to" type="date" value="${today}"/></div>
      </div>
      <div class="grid2">
        <div><label>Certified by (Supply/Property Custodian)</label><input id="rsmi_certby"/></div>
        <div><label>Posted by (Accounting staff)</label><input id="rsmi_postby"/></div>
      </div>
      <label>Include</label>
      <select id="rsmi_type">
        <option value="">Consumption + Distribution (all issuances)</option>
        ${ISSUE_TYPES.map((t) => `<option value="${t.code}">${esc(t.label)} only</option>`).join("")}
      </select>
      <p class="small">Pulls every issued RIS line dated within this range, grouped by Stock No. for the recapitulation.</p>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="generateRsmi()">Generate</button>
    </div>`);
}

function generateRsmi() {
  if (blockIfViewOnly("rsmi")) return;
  const fund = S.currentFund;
  const from = document.getElementById("rsmi_from").value;
  const to = document.getElementById("rsmi_to").value;
  if (!from || !to || from > to) { toast("Enter a valid period range.", true); return; }
  const onlyType = document.getElementById("rsmi_type").value;
  const lines = [];
  for (const r of S.ris.values()) {
    if (r.fund !== fund || r.status !== "issued") continue;
    if (r.date < from || r.date > to) continue;
    if (onlyType && (r.issue_type || "consumption") !== onlyType) continue;
    for (const l of r.lines || []) {
      if (!l.qty_issued) continue;
      const item = S.items.get(l.item_id);
      // Prefer the cost actually captured on the ledger entry this RIS wrote, so a later
      // delivery at a different price can't retroactively change what this report says.
      const entry = item ? (item.ledger || []).find((e) => e.ris_id === r.id) : null;
      const unit_cost = entry ? Number(entry.unit_cost) || 0 : (item ? unitCostBalance(item) : 0);
      lines.push({
        ris_no: r.ris_no, responsibility_center: r.fpp_code || "", stock_no: l.stock_no, item: l.description,
        unit: l.unit, qty: l.qty_issued, unit_cost,
        amount: entry ? Number(entry.total_cost) || 0 : round2(l.qty_issued * unit_cost),
        account_code: item ? item.account_code : "",
        issue_type: r.issue_type || "consumption",
      });
    }
  }
  const byStock = new Map();
  for (const l of lines) {
    const k = l.stock_no;
    const cur = byStock.get(k) || { stock_no: k, qty: 0, unit_cost: l.unit_cost, amount: 0, account_code: l.account_code };
    cur.qty += l.qty; cur.amount += l.amount;
    byStock.set(k, cur);
  }
  const rec = {
    fund, period_from: from, period_to: to, date: todayStr(), issue_type: onlyType || "",
    serial_no: nextDocNumber(S.rsmi, fund, todayStr(), "serial_no"),
    lines, recap: [...byStock.values()],
    certified_by_name: document.getElementById("rsmi_certby").value.trim(),
    posted_by_name: document.getElementById("rsmi_postby").value.trim(),
    created_at: Date.now(), created_by: S.currentUser.email,
  };
  colRsmi.doc().set(rec).then(() => { toast("RSMI generated."); closeModal(); }).catch((e) => toast(e.message, true));
}

function openRsmiDetail(id) {
  const r = S.rsmi.get(id);
  openModal(`
    <div class="modal-head"><h3>RSMI ${esc(r.serial_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">${fmtDate(r.period_from)} to ${fmtDate(r.period_to)} &middot; ${esc(fundLabel(r.fund))}</p>
      <div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Type</th><th>Stock No.</th><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
      <tbody>${(r.lines || []).map((l) => `<tr><td>${esc(l.ris_no)}</td>
        <td><span class="pill ${l.issue_type === "distribution" ? "distributed" : "consumed"}">${esc(issueTypeLabel(l.issue_type))}</span></td>
        <td>${esc(l.stock_no)}</td><td>${esc(l.item)}</td><td class="num">${fmtNum(l.qty)}</td><td class="num">${fmtMoney(l.amount)}</td></tr>`).join("") || '<tr><td colspan="6"><div class="empty">No issuances in this period.</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="exportRsmiCsv('${r.id}')">Download CSV</button>
      <button class="btn primary" onclick="printRsmi('${r.id}')">Print RSMI</button>
      ${canEdit("rsmi") ? `<button class="btn danger" onclick="deleteRsmi('${r.id}')">Delete</button>` : ""}
    </div>`, "wide");
}
function deleteRsmi(id) {
  if (blockIfViewOnly("rsmi")) return;
  if (!confirm("Delete this generated RSMI? (It can be regenerated from the same RIS records at any time.)")) return;
  colRsmi.doc(id).delete().then(() => { toast("RSMI deleted."); closeModal(); }).catch((e) => toast(e.message, true));
}
function printRsmi(id) { openPrintWindow(rsmiHtml(S.rsmi.get(id)), "portrait"); }
function exportRsmiCsv(id) {
  const r = S.rsmi.get(id);
  const header = ["RIS No.", "Type", "Stock No.", "Item", "Unit", "Qty", "Unit Cost", "Amount", "Account Code"];
  const lines = [header.join(",")].concat((r.lines || []).map((l) => [l.ris_no, issueTypeLabel(l.issue_type), l.stock_no, l.item, l.unit, l.qty, l.unit_cost, l.amount, l.account_code].map(csvField).join(",")));
  browserDownload(`RSMI_${esc(r.serial_no)}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Issued Inventory - the single, merged issuance report. Every issuance in the system comes from
// a RIS, tagged Consumption or Distribution, so this one report covers both; filter by type to
// see either side on its own.
// ---------------------------------------------------------------------

function issuedRowsFor(f) {
  const fund = S.currentFund;
  const wanted = f.type ? issueTypeInfo(f.type).disposition : null;
  const rows = [];
  for (const a of S.items.values()) {
    if (a.fund !== fund) continue;
    for (const e of a.ledger || []) {
      if (e.type !== "issue") continue;
      const disp = e.disposition === "distributed" ? "distributed" : "consumed";
      if (wanted && disp !== wanted) continue;
      if (f.from && e.date < f.from) continue;
      if (f.to && e.date > f.to) continue;
      if (f.q) {
        const q = f.q.toLowerCase();
        if (![a.stock_no, a.description, e.office, e.recipient, e.ref].some((v) => (v || "").toLowerCase().includes(q))) continue;
      }
      rows.push({ item: a, entry: e, disp });
    }
  }
  rows.sort((x, y) => (y.entry.date || "").localeCompare(x.entry.date || ""));
  return rows;
}

function renderIssued() {
  const saved = captureFocus("view-issued");
  const f = S.issuedFilter;
  const rows = issuedRowsFor(f);
  const total = rows.reduce((s, r) => s + (Number(r.entry.total_cost) || 0), 0);
  const consumedTotal = rows.filter((r) => r.disp === "consumed").reduce((s, r) => s + (Number(r.entry.total_cost) || 0), 0);
  const distributedTotal = total - consumedTotal;
  document.getElementById("view-issued").innerHTML = `
    <div class="toolbar">
      <input class="grow" id="issuedSearch" placeholder="Search stock no., office, recipient, RIS no..." value="${esc(f.q)}"/>
      <select id="issuedTypeFilter">
        <option value="" ${!f.type ? "selected" : ""}>Consumption + Distribution</option>
        ${ISSUE_TYPES.map((t) => `<option value="${t.code}" ${f.type === t.code ? "selected" : ""}>${esc(t.label)} only</option>`).join("")}
      </select>
      <label style="margin:0;">From <input id="issuedFrom" type="date" value="${esc(f.from)}"/></label>
      <label style="margin:0;">To <input id="issuedTo" type="date" value="${esc(f.to)}"/></label>
      <div class="toolbar-right"><button class="btn" onclick="exportIssuedCsv()">Download CSV</button></div>
    </div>
    <div class="cardrow">
      <div class="card"><div class="label">Total Issued</div><div class="value">${fmtMoney(total)}</div><div class="foot">${rows.length} issuance line(s)${f.from || f.to ? " in range" : ""}</div></div>
      <div class="card"><div class="label">Consumption</div><div class="value">${fmtMoney(consumedTotal)}</div><div class="foot">used internally by offices</div></div>
      <div class="card"><div class="label">Distribution</div><div class="value">${fmtMoney(distributedTotal)}</div><div class="foot">to barangays / beneficiaries / the public</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>RIS No.</th><th>Type</th><th>Stock No.</th><th>Description</th><th class="num">Qty</th><th class="num">Amount</th><th>Office / Recipient</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openItemDetail('${r.item.id}')">
          <td>${fmtDate(r.entry.date)}</td><td>${esc(r.entry.ref || "")}</td>
          <td><span class="pill ${r.disp === "distributed" ? "distributed" : "consumed"}">${r.disp === "distributed" ? "Distribution" : "Consumption"}</span></td>
          <td>${esc(r.item.stock_no)}</td><td>${esc(r.item.description)}</td>
          <td class="num">${fmtNum(r.entry.qty)} ${esc(r.item.unit)}</td><td class="num">${fmtMoney(r.entry.total_cost)}</td>
          <td>${esc(r.entry.recipient || r.entry.office || "")}</td>
        </tr>`).join("") : `<tr><td colspan="8"><div class="empty">No issuances match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("issuedSearch").addEventListener("input", (e) => { S.issuedFilter.q = e.target.value; renderIssued(); });
  document.getElementById("issuedTypeFilter").addEventListener("change", (e) => { S.issuedFilter.type = e.target.value; renderIssued(); });
  document.getElementById("issuedFrom").addEventListener("change", (e) => { S.issuedFilter.from = e.target.value; renderIssued(); });
  document.getElementById("issuedTo").addEventListener("change", (e) => { S.issuedFilter.to = e.target.value; renderIssued(); });
  restoreFocus(saved);
}

function exportIssuedCsv() {
  const rows = issuedRowsFor(S.issuedFilter);
  const header = ["Date", "RIS No.", "Type", "Stock No.", "Description", "Qty", "Unit", "Unit Cost", "Amount", "Office", "Recipient"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.entry.date, r.entry.ref, r.disp === "distributed" ? "Distribution" : "Consumption", r.item.stock_no, r.item.description,
      r.entry.qty, r.item.unit, r.entry.unit_cost, r.entry.total_cost, r.entry.office || "", r.entry.recipient || ""].map(csvField).join(","));
  }
  browserDownload(`Issued_Inventory_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------

function tbSnapshotsForFund(fund) { return [...S.tbSnapshots.values()].filter((t) => t.fund === fund).sort((a, b) => (a.period || "").localeCompare(b.period || "")); }

function parseTbText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.includes("\t") ? line.split("\t") : line.split(",");
    if (parts.length < 3) continue;
    const code = (parts[0] || "").replace(/[^0-9]/g, "");
    if (!code) continue;
    out.push({ account_code: code, account_name: (parts[1] || "").trim(), debit: parseFloat(parts[2]) || 0, credit: parseFloat(parts[3]) || 0 });
  }
  return out;
}

function renderReconciliation() {
  const fund = S.currentFund;
  const snaps = tbSnapshotsForFund(fund);
  if (S.reconPeriod === null && snaps.length) S.reconPeriod = snaps[snaps.length - 1].period;
  const current = snaps.find((t) => t.period === S.reconPeriod) || null;
  const accounts = distinctInventoryAccounts(fund);
  const canE = canEdit("reconciliation");
  const rows = accounts.map((acc) => {
    const tbLine = current ? (current.lines || []).find((l) => l.account_code === acc.code) : null;
    const tbAmt = tbLine ? (Number(tbLine.debit) || 0) - (Number(tbLine.credit) || 0) : null;
    const regAmt = registryCostFor(acc.code, fund);
    const ok = tbAmt != null && Math.abs(tbAmt - regAmt) < 0.5;
    return { acc, tbAmt, regAmt, ok };
  });
  document.getElementById("view-reconciliation").innerHTML = `
    <div class="toolbar">
      <select id="reconPeriodSelect">
        ${snaps.length ? snaps.map((t) => `<option value="${t.period}" ${t.period === S.reconPeriod ? "selected" : ""}>${fmtDate(t.period + "-01")}</option>`).join("") : `<option value="">No Trial Balance saved yet</option>`}
      </select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Account Code</th><th>Account Name</th><th class="num">Trial Balance</th><th class="num">Registry</th><th class="num">Variance</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr>
          <td>${esc(r.acc.code)}</td><td>${esc(r.acc.name)}</td>
          <td class="num">${r.tbAmt == null ? "—" : fmtMoney(r.tbAmt)}</td>
          <td class="num">${fmtMoney(r.regAmt)}</td>
          <td class="num">${r.tbAmt == null ? "—" : fmtMoney(r.tbAmt - r.regAmt)}</td>
          <td><span class="pill ${r.ok ? "ok" : "check"}">${r.tbAmt == null ? "No TB" : r.ok ? "OK" : "CHECK"}</span></td>
        </tr>`).join("") : `<tr><td colspan="6"><div class="empty">No inventory accounts in the registry yet.</div></td></tr>`}</tbody>
    </table></div>
    ${canE ? `
    <div class="panel" style="margin-top:16px;">
      <h3>Paste or upload a Trial Balance</h3>
      <p class="small">Tab- or comma-delimited: Account Code, Account Name, Debit, Credit - one line per account.</p>
      <label>Period (month)</label><input id="tbPeriod" type="month" value="${S.reconPeriod || new Date().toISOString().slice(0, 7)}"/>
      <label>Paste Trial Balance</label><textarea id="tbPaste" rows="8"></textarea>
      <label>...or upload a file (.xlsx / .xls / .csv)</label><input id="tbFile" type="file" accept=".xlsx,.xls,.csv"/>
      <button class="btn primary" style="margin-top:10px;" onclick="saveTbSnapshot()">Save Trial Balance</button>
    </div>` : ""}`;
  document.getElementById("reconPeriodSelect").addEventListener("change", (e) => { S.reconPeriod = e.target.value; renderReconciliation(); });
  if (canE) {
    const fileEl = document.getElementById("tbFile");
    fileEl.addEventListener("change", () => {
      const file = fileEl.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = window.XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rowsArr = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
          const text = rowsArr.map((r) => (r || []).slice(0, 4).join("\t")).join("\n");
          document.getElementById("tbPaste").value = text;
        } catch (e) { toast("Could not read that file.", true); }
      };
      reader.readAsArrayBuffer(file);
    });
  }
}
function saveTbSnapshot() {
  if (blockIfViewOnly("reconciliation")) return;
  const period = document.getElementById("tbPeriod").value;
  if (!period) { toast("Pick a period.", true); return; }
  const lines = parseTbText(document.getElementById("tbPaste").value);
  if (!lines.length) { toast("Nothing to parse - paste or upload a Trial Balance first.", true); return; }
  const fund = S.currentFund;
  const id = fund === "GF" ? period : `${fund}__${period}`;
  colTb.doc(id).set({ fund, period, lines, saved_by: S.currentUser.email, saved_at: Date.now() })
    .then(() => { S.reconPeriod = period; toast("Trial Balance saved."); renderReconciliation(); })
    .catch((e) => toast(e.message, true));
}

// ---------------------------------------------------------------------
// Users & Roles
// ---------------------------------------------------------------------

const TAB_KEYS = ["dashboard", "registry", "medicines", "air", "ris", "rsmi", "issued", "reconciliation"];
function summarizeRestrictions(role) {
  const t = role.tabs || {};
  const parts = [];
  for (const k of TAB_KEYS) {
    if (t[k] === "none") parts.push(`${VIEW_TITLES[k]}: Hidden`);
    else if (t[k] === "view" && EDITABLE_TABS.includes(k)) parts.push(`${VIEW_TITLES[k]}: View only`);
  }
  return parts.length ? parts.join(", ") : "Full access";
}

function renderUsers() {
  if (!isAdmin()) { document.getElementById("view-users").innerHTML = `<div class="empty">You don't have access to this section.</div>`; return; }
  const roles = [...S.userRoles.values()];
  document.getElementById("view-users").innerHTML = `
    <div class="panel small">Access Role is app-level only: it hides menus/buttons here, but does not lock the underlying Firestore database itself - a technically determined person could still reach the data directly.</div>
    <div class="toolbar"><div class="toolbar-right" style="margin-left:0;"><button class="btn primary" onclick="openUserRoleModal()">+ Add user</button></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Email</th><th>Access</th><th></th></tr></thead>
      <tbody>
        ${HARDCODED_ADMIN_EMAILS.map((e) => `<tr><td>${esc(e)}</td><td>Permanent Admin</td><td></td></tr>`).join("")}
        ${roles.map((r) => `<tr>
          <td>${esc(r.id)}${r.is_admin ? " (Admin)" : ""}</td>
          <td>${r.is_admin ? "Full Admin" : esc(summarizeRestrictions(r))}</td>
          <td><button class="btn" onclick="openUserRoleModal('${r.id}')">Edit</button> <button class="btn danger" onclick="deleteUserRole('${r.id}')">Delete</button></td>
        </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function openUserRoleModal(email) {
  const r = email ? S.userRoles.get(email) : null;
  const rows = TAB_KEYS.map((k) => {
    const cur = r && r.tabs ? r.tabs[k] : undefined;
    const editable = EDITABLE_TABS.includes(k);
    return `<div class="grid2" style="align-items:center;">
      <label style="margin:6px 0;">${VIEW_TITLES[k]}</label>
      <select data-tabkey="${k}" class="role_tab">
        ${editable ? `<option value="edit" ${!cur || cur === "edit" ? "selected" : ""}>Edit</option>` : ""}
        <option value="view" ${cur === "view" ? "selected" : ""}>View</option>
        <option value="none" ${cur === "none" ? "selected" : ""}>Hidden</option>
      </select>
    </div>`;
  }).join("");
  openModal(`
    <div class="modal-head"><h3>${r ? "Edit access" : "+ Add user"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <label>Email</label><input id="role_email" value="${esc(r ? r.id : "")}" ${r ? "disabled" : ""}/>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;"><input type="checkbox" id="role_admin" style="width:auto;" ${r && r.is_admin ? "checked" : ""}/> Full Admin (all tabs, incl. Users &amp; Roles)</label>
      <div class="hr"></div>
      <div id="role_tabs_wrap">${rows}</div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveUserRole('${r ? r.id : ""}')">Save</button>
    </div>`);
}
function saveUserRole(existingEmail) {
  const email = (existingEmail || document.getElementById("role_email").value.trim()).toLowerCase();
  if (!email) { toast("Email is required.", true); return; }
  if (!existingEmail && S.userRoles.has(email)) { toast("That email already has a role.", true); return; }
  const is_admin = document.getElementById("role_admin").checked;
  const tabs = {};
  document.querySelectorAll(".role_tab").forEach((el) => { tabs[el.dataset.tabkey] = el.value; });
  colRoles.doc(email).set({ is_admin, tabs, updated_at: Date.now() }).then(() => { toast("Access saved."); closeModal(); }).catch((e) => toast(e.message, true));
}
function deleteUserRole(email) {
  if (!confirm(`Remove ${email}'s custom access? They will revert to full access everywhere.`)) return;
  colRoles.doc(email).delete().then(() => toast("Reverted to full access.")).catch((e) => toast(e.message, true));
}

// ---------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------
function openChangePasswordModal() {
  openModal(`
    <div class="modal-head"><h3>Change password</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <label>Current password</label><input id="cp_current" type="password"/>
      <label>New password</label><input id="cp_new" type="password"/>
      <label>Confirm new password</label><input id="cp_confirm" type="password"/>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitChangePassword()">Change password</button></div>`);
}
function submitChangePassword() {
  const cur = document.getElementById("cp_current").value;
  const n1 = document.getElementById("cp_new").value;
  const n2 = document.getElementById("cp_confirm").value;
  if (n1 !== n2) { toast("New passwords don't match.", true); return; }
  if (n1.length < 6) { toast("New password should be at least 6 characters.", true); return; }
  fbChangePassword(cur, n1).then(() => { toast("Password changed."); closeModal(); }).catch((e) => {
    const code = e.code || "";
    let msg = "Could not change password.";
    if (code.includes("wrong-password") || code.includes("invalid-credential")) msg = "Current password is incorrect.";
    else if (code.includes("weak-password")) msg = "New password is too weak.";
    toast(msg, true);
  });
}

// ---------------------------------------------------------------------
// Shell / navigation
// ---------------------------------------------------------------------

const RENDERERS = {
  dashboard: renderDashboard, registry: renderRegistry, medicines: renderMedicines, air: renderAir,
  ris: renderRis, rsmi: renderRsmi, issued: renderIssued,
  reconciliation: renderReconciliation, users: renderUsers,
};

function renderAll() {
  for (const [key, fn] of Object.entries(RENDERERS)) {
    try { fn(); } catch (e) { console.error("render error", key, e); }
  }
  applyAccessControlToNav();
  renderFundSwitch();
}
function setView(view) {
  S.view = view;
  document.querySelectorAll("#mainNav button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.getElementById("viewTitle").textContent = VIEW_TITLES[view] || view;
  // RIS/RSMI/Report live under the Consumed Inventory group, and Acknowledgement Receipt/Report
  // live under Distributed Inventory - open (but don't force-close) whichever group contains the
  // view being switched to, and bold its heading while one of its sub-items is active.
  document.querySelectorAll("#mainNav .nav-group").forEach((g) => {
    const isCurrentGroup = !!g.querySelector(`button[data-view="${view}"]`);
    if (isCurrentGroup) g.classList.add("open");
    const toggle = g.querySelector(".nav-group-toggle");
    if (toggle) toggle.classList.toggle("active-parent", isCurrentGroup);
  });
}
function renderFundSwitch() {
  document.getElementById("fundSwitch").innerHTML = FUNDS.map((f) => `
    <button class="${f.code === S.currentFund ? "active" : ""}" onclick="setFund('${f.code}')">
      <span class="fundcode">${f.code}</span><br/>${f.name}
    </button>`).join("");
}
function setFund(code) {
  S.currentFund = code;
  localStorage.setItem("imsFund", code);
  S.reconPeriod = null;
  renderAll();
}

function bindStaticUI() {
  document.querySelectorAll("#mainNav button[data-view]").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  document.querySelectorAll("#mainNav .nav-group-toggle").forEach((b) => {
    b.addEventListener("click", () => b.closest(".nav-group").classList.toggle("open"));
  });
  document.getElementById("signOutBtn").addEventListener("click", () => signOut());
  document.getElementById("changePasswordBtn").addEventListener("click", () => openChangePasswordModal());
  document.getElementById("whoami").textContent = S.currentUser.email;
  const isGoogle = (S.currentUser.providerData || [])[0] && S.currentUser.providerData[0].providerId === "google.com";
  document.getElementById("changePasswordBtn").hidden = !!isGoogle;
}

export function initApp(user) {
  S.currentUser = user;
  bindStaticUI();
  setView(S.view);
  renderFundSwitch();

  colItems.onSnapshot((rows) => { S.items = new Map(rows.map((r) => [r.id, r])); renderAll(); });
  colRis.onSnapshot((rows) => { S.ris = new Map(rows.map((r) => [r.id, r])); renderAll(); });
  colRsmi.onSnapshot((rows) => { S.rsmi = new Map(rows.map((r) => [r.id, r])); renderAll(); });
  colAir.onSnapshot((rows) => { S.air = new Map(rows.map((r) => [r.id, r])); renderAll(); });
  colTb.onSnapshot((rows) => { S.tbSnapshots = new Map(rows.map((r) => [r.id, r])); renderAll(); });
  colRoles.onSnapshot((rows) => { S.userRoles = new Map(rows.map((r) => [r.id, r])); renderAll(); });
}

// Test-only hook (harmless in production): lets an automated test switch which user is "signed
// in" and force a re-render, without a full page reload (which would wipe an in-memory test
// database). Never called by the app itself.
function __setTestUser(user) {
  S.currentUser = user;
  const who = document.getElementById("whoami");
  if (who) who.textContent = user.email;
  renderAll();
}

// Expose everything referenced from inline onclick="" attributes - module scope isn't global.
Object.assign(window, {
  setFund, setView, closeModal, __setTestUser, renderAll,
  openItemModal, saveItem, openItemDetail, discontinueItem, reactivateItem,
  printSlc, printSc, exportRegistryCsv,
  exportMedicinesCsv,
  openAirModal, saveAir, addAirLine, removeAirLine, openAirDetail, deleteAir,
  openPostAirModal, confirmPostAir, unpostAir, printAir, exportAirCsv,
  openBulkAirModal, downloadAirTemplate, previewBulkAir, importBulkAir,
  openRisModal, saveRis, addRisLine, removeRisLine, openRisDetail, deleteRis,
  toggleRisRecipientFields, openIssueRisModal, confirmIssueRis, reverseRis, printRis, exportRisCsv,
  openBulkRisModal, downloadRisTemplate, previewBulkRis, importBulkRis,
  openGenerateRsmiModal, generateRsmi, openRsmiDetail, deleteRsmi, printRsmi, exportRsmiCsv,
  exportIssuedCsv, saveTbSnapshot,
  openUserRoleModal, saveUserRole, deleteUserRole,
  openChangePasswordModal, submitChangePassword,
});
