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
const EDITABLE_TABS = ["registry", "ris", "rsmi", "ar", "reconciliation"];
const VIEW_ONLY_TABS = ["dashboard", "distributed"];
const VIEW_TITLES = {
  dashboard: "Dashboard",
  registry: "Inventory Registry",
  ris: "Requisition and Issue Slip (RIS)",
  rsmi: "Report of Supplies and Materials Issued (RSMI)",
  ar: "Acknowledgement Receipt",
  distributed: "Distributed Inventory",
  reconciliation: "Reconciliation",
  users: "Users & Roles",
};

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

const S = {
  currentUser: null,
  currentFund: localStorage.getItem("imsFund") || "GF",
  view: "dashboard",
  items: new Map(),
  ris: new Map(),
  rsmi: new Map(),
  ar: new Map(),
  tbSnapshots: new Map(),
  userRoles: new Map(),
  registryFilter: { q: "", account: "", disposition: "", status: "active" },
  risFilter: { q: "", status: "" },
  arFilter: { q: "", status: "" },
  distributedFilter: { q: "", from: "", to: "" },
  reconPeriod: null,
  _billingDraftUnused: null,
};

const colItems = fsCollection("items");
const colRis = fsCollection("ris");
const colRsmi = fsCollection("rsmi");
const colAr = fsCollection("ar");
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

const SEAL_HTML = `<div style="width:60px;height:60px;border-radius:50%;background:#eee;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;">M</div>`;

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
      <tr><td>Office : <b>${esc(r.office || "")}</b></td><td>RIS No. : <b>${esc(r.ris_no)}</b></td><td></td></tr>
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

function arHtml(r) {
  const lines = r.lines || [];
  const rows = lines.map((l) => `
    <tr>
      <td>${esc(l.stock_no)}</td><td>${esc(l.description)}</td><td>${esc(l.unit)}</td>
      <td class="right">${fmtNum(l.qty_issued != null ? l.qty_issued : l.qty_requested)}</td>
      <td class="right">${fmtNum(l.unit_cost)}</td>
      <td class="right">${fmtNum((l.qty_issued != null ? l.qty_issued : l.qty_requested) * (l.unit_cost || 0))}</td>
    </tr>`).join("");
  const pad = Math.max(0, 10 - lines.length);
  const blanks = Array.from({ length: pad }).map(() => `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const total = lines.reduce((s, l) => s + (l.qty_issued != null ? l.qty_issued : l.qty_requested || 0) * (l.unit_cost || 0), 0);
  return `
    ${printHeaderHtml("", "ACKNOWLEDGEMENT RECEIPT")}
    <table class="noborder"><tr><td>Fund : <b>${esc(fundLabel(r.fund))}</b></td></tr></table>
    <table class="noborder">
      <tr><td>AR No. : <b>${esc(r.ar_no)}</b></td><td style="text-align:right;">Date : <b>${fmtDate(r.date)}</b></td></tr>
      <tr><td>Recipient : <b>${esc(r.recipient_name || "")}</b></td><td style="text-align:right;">Barangay / Address : <b>${esc(r.recipient_barangay || "")}</b></td></tr>
    </table>
    <table>
      <tr><th>Stock No.</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Unit Cost</th><th>Amount</th></tr>
      ${rows}${blanks}
      <tr><td colspan="5" class="right"><b>Total</b></td><td class="right"><b>${fmtNum(total)}</b></td></tr>
    </table>
    <p style="margin-top:10px;">Purpose: ${esc(r.purpose || "")}</p>
    <p style="margin-top:6px;">I acknowledge receipt of the above-listed item(s) in good order and condition.</p>
    <table class="noborder" style="margin-top:20px;">
      <tr>
        <td class="center">Released by:</td><td class="center">Received by:</td><td class="center">Witnessed by:</td>
      </tr>
      <tr>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.released_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.received_by_name || "")}</td>
        <td class="center" style="padding-top:30px;border-top:1px solid #000;">${esc(r.witnessed_by_name || "")}</td>
      </tr>
      <tr>
        <td class="center poscap">Signature over Printed Name</td>
        <td class="center poscap">Signature over Printed Name</td>
        <td class="center poscap">Signature over Printed Name</td>
      </tr>
      <tr>
        <td class="center poscap">${esc(r.released_by_position || "Property Custodian")}</td>
        <td class="center poscap">${esc(r.received_by_position || "")}</td>
        <td class="center poscap">${esc(r.witnessed_by_position || "")}</td>
      </tr>
    </table>`;
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------

function renderDashboard() {
  const fund = S.currentFund;
  const items = activeItems(fund);
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
  const lowStock = items.filter(isLowStock);
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
      <div class="card"><div class="label">Total Inventory Value</div><div class="value">${fmtMoney(totalValue)}</div><div class="foot">${items.length} active item(s) &middot; ${fundLabel(fund)}</div></div>
      <div class="card"><div class="label">Consumed (YTD)</div><div class="value">${fmtMoney(consumedYtd)}</div><div class="foot">Issued to offices, used internally</div></div>
      <div class="card"><div class="label">Distributed (YTD)</div><div class="value">${fmtMoney(distributedYtd)}</div><div class="foot">Issued to barangays / beneficiaries / the public</div></div>
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
      <h3>Recent RIS <span class="small" style="font-weight:normal;">(Consumed Inventory)</span></h3>
      ${renderRecentRisTable(fund)}
    </div>
    <div class="panel">
      <h3>Recent Acknowledgement Receipts <span class="small" style="font-weight:normal;">(Distributed Inventory)</span></h3>
      ${renderRecentArTable(fund)}
    </div>`;
  document.getElementById("view-dashboard").innerHTML = html;
}
function renderRecentRisTable(fund) {
  const rows = [...S.ris.values()].filter((r) => r.fund === fund).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  if (!rows.length) return `<div class="empty">No RIS records yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Date</th><th>Office</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="openRisDetail('${r.id}')"><td>${esc(r.ris_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.office || r.department || "")}</td><td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td></tr>`).join("")}
  </tbody></table></div>`;
}
function renderRecentArTable(fund) {
  const rows = [...S.ar.values()].filter((r) => r.fund === fund).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  if (!rows.length) return `<div class="empty">No Acknowledgement Receipts yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>AR No.</th><th>Date</th><th>Recipient</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="clickable" onclick="openArDetail('${r.id}')"><td>${esc(r.ar_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.recipient_name || "")}${r.recipient_barangay ? " / " + esc(r.recipient_barangay) : ""}</td><td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td></tr>`).join("")}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------------
// Inventory Registry
// ---------------------------------------------------------------------

function filterItemRows(f) {
  const q = (f.q || "").toLowerCase();
  let rows = activeItems(S.currentFund).filter((a) => a.status === (f.status || "active") || (!f.status && true));
  if (f.status === "discontinued") rows = [...S.items.values()].filter((a) => a.fund === S.currentFund && a.status === "discontinued");
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
  document.getElementById("view-registry").innerHTML = `
    <div class="toolbar">
      <input class="grow" id="regSearch" placeholder="Search stock no., description..." value="${esc(f.q)}"/>
      <select id="regAccountFilter"><option value="">All accounts</option>${ACCOUNT_CATALOG.map((a) => `<option value="${a.code}" ${a.code === f.account ? "selected" : ""}>${esc(a.code)} - ${esc(a.name)}</option>`).join("")}</select>
      <select id="regDispFilter">
        <option value="" ${!f.disposition ? "selected" : ""}>Consumed + Distributed</option>
        <option value="consumed" ${f.disposition === "consumed" ? "selected" : ""}>Consumed items</option>
        <option value="distributed" ${f.disposition === "distributed" ? "selected" : ""}>Distributed items</option>
      </select>
      <select id="regStatusFilter">
        <option value="active" ${f.status === "active" ? "selected" : ""}>Active</option>
        <option value="discontinued" ${f.status === "discontinued" ? "selected" : ""}>Discontinued</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportRegistryCsv()">Download CSV</button>
        ${canE ? `<button class="btn primary" onclick="openItemModal()">+ Add item</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Stock No.</th><th>Description</th><th>Account</th><th>Type</th><th class="num">Balance Qty</th><th class="num">Value</th><th></th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((a) => `
          <tr class="clickable" onclick="openItemDetail('${a.id}')">
            <td>${esc(a.stock_no)}</td>
            <td>${esc(a.description)}<div class="small">${esc(a.item || "")}</div></td>
            <td>${esc(a.account_code)}<div class="small">${esc(a.account_name || "")}</div></td>
            <td><span class="pill ${isDistributionAccount(a.account_code) ? "distributed" : "consumed"}">${isDistributionAccount(a.account_code) ? "Distributed" : "Consumed"}</span>${isLowStock(a) ? ' <span class="pill check">Low stock</span>' : ""}</td>
            <td class="num">${fmtNum(qtyBalance(a))} ${esc(a.unit)}</td>
            <td class="num">${fmtMoney(costBalance(a))}</td>
            <td></td>
          </tr>`).join("") : `<tr><td colspan="7"><div class="empty">No items match this filter.</div></td></tr>`}
      </tbody>
    </table></div>`;

  const s = document.getElementById("regSearch");
  s.addEventListener("input", () => { S.registryFilter.q = s.value; renderRegistry(); });
  document.getElementById("regAccountFilter").addEventListener("change", (e) => { S.registryFilter.account = e.target.value; renderRegistry(); });
  document.getElementById("regDispFilter").addEventListener("change", (e) => { S.registryFilter.disposition = e.target.value; renderRegistry(); });
  document.getElementById("regStatusFilter").addEventListener("change", (e) => { S.registryFilter.status = e.target.value; renderRegistry(); });
  restoreFocus(saved);
}

function openItemModal(id) {
  if (!canEdit("registry")) { toast("You have view-only access to Inventory Registry.", true); return; }
  const a = id ? S.items.get(id) : null;
  openModal(`
    <div class="modal-head"><h3>${a ? "Edit item" : "+ Add item"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
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
      <button class="btn primary" onclick="saveItem('${a ? a.id : ""}')">${a ? "Save" : "Add item"}</button>
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
  } else {
    rec.created_at = Date.now();
    rec.ledger = [];
    const openQtyEl = document.getElementById("f_openqty");
    const openQty = openQtyEl ? Number(openQtyEl.value) || 0 : 0;
    if (openQty > 0) {
      rec.ledger.push({
        id: uid(), type: "receipt", date: document.getElementById("f_openat").value || todayStr(),
        ref: "Opening balance", qty: openQty, unit_cost: rec.unit_cost, total_cost: round2(openQty * rec.unit_cost),
        by: S.currentUser.email, at: Date.now(),
      });
    }
    colItems.doc().set(rec).then(() => { toast("Item added."); closeModal(); }).catch((e) => toast(e.message, true));
  }
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
  const rowsHtml = bal.rows.slice().reverse().map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td><td>${esc(r.ref || "")}</td>
      <td>${r.type === "receipt" ? '<span class="pill ok">Receipt</span>' : `<span class="pill ${r.disposition === "distributed" ? "distributed" : "consumed"}">${r.disposition === "distributed" ? "Distributed" : "Consumed"}</span>`}</td>
      <td class="num">${r.type === "receipt" ? "+" : "-"}${fmtNum(r.qty)}</td>
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
      <h3 style="font-size:13px;">Movement history</h3>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Balance</th><th>Office/Recipient</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="7"><div class="empty">No movement yet.</div></td></tr>'}</tbody></table></div>
    </div>
    <div class="modal-foot">
      ${a.status === "discontinued" ? (canE ? `<button class="btn" onclick="reactivateItem('${a.id}')">Reactivate</button>` : "") : (canE ? `<button class="btn" onclick="openReceiptModal('${a.id}')">+ Record receipt</button><button class="btn danger" onclick="discontinueItem('${a.id}')">Discontinue</button>` : "")}
      <button class="btn" onclick="printSlc('${a.id}')">Print SLC</button>
      <button class="btn" onclick="printSc('${a.id}')">Print Stock Card</button>
      ${canE ? `<button class="btn primary" onclick="closeModal();openItemModal('${a.id}')">Edit</button>` : ""}
    </div>`, "wide");
}

function openReceiptModal(itemId) {
  if (blockIfViewOnly("registry")) return;
  const a = S.items.get(itemId);
  openModal(`
    <div class="modal-head"><h3>Record receipt - ${esc(a.description)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid2">
        <div><label>Date</label><input id="rc_date" type="date" value="${todayStr()}"/></div>
        <div><label>Reference (DV No. / PO No.)</label><input id="rc_ref"/></div>
      </div>
      <div class="grid2">
        <div><label>Quantity received</label><input id="rc_qty" type="number" step="0.01" value="0"/></div>
        <div><label>Unit cost (Php)</label><input id="rc_unitcost" type="number" step="0.01" value="${a.unit_cost}"/></div>
      </div>
      <label>Remarks</label><input id="rc_remarks"/>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveReceipt('${itemId}')">Save receipt</button>
    </div>`);
}
function saveReceipt(itemId) {
  if (blockIfViewOnly("registry")) return;
  const a = S.items.get(itemId);
  const qty = Number(document.getElementById("rc_qty").value) || 0;
  const unit_cost = Number(document.getElementById("rc_unitcost").value) || 0;
  if (qty <= 0) { toast("Quantity must be greater than zero.", true); return; }
  const entry = {
    id: uid(), type: "receipt", date: document.getElementById("rc_date").value || todayStr(),
    ref: document.getElementById("rc_ref").value.trim(), qty, unit_cost, total_cost: round2(qty * unit_cost),
    remarks: document.getElementById("rc_remarks").value.trim(), by: S.currentUser.email, at: Date.now(),
  };
  const ledger = (a.ledger || []).concat([entry]);
  colItems.doc(itemId).update({ ledger, unit_cost }).then(() => { toast("Receipt recorded."); closeModal(); openItemDetail(itemId); }).catch((e) => toast(e.message, true));
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
// RIS - Requisition and Issue Slip
// ---------------------------------------------------------------------

function filterRisRows(f) {
  const q = (f.q || "").toLowerCase();
  let rows = [...S.ris.values()].filter((r) => r.fund === S.currentFund);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (q) rows = rows.filter((r) => [r.ris_no, r.department, r.office, r.purpose].some((v) => (v || "").toLowerCase().includes(q)));
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
      <input class="grow" id="risSearch" placeholder="Search RIS no., office, purpose..." value="${esc(f.q)}"/>
      <select id="risStatusFilter">
        <option value="" ${!f.status ? "selected" : ""}>All statuses</option>
        <option value="draft" ${f.status === "draft" ? "selected" : ""}>Draft</option>
        <option value="issued" ${f.status === "issued" ? "selected" : ""}>Issued</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportRisCsv()">Download CSV</button>
        ${canE ? `<button class="btn primary" onclick="openRisModal()">+ New RIS</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>RIS No.</th><th>Date</th><th>Department / Office</th><th>Purpose</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openRisDetail('${r.id}')">
          <td>${esc(r.ris_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.department)}${r.office ? " / " + esc(r.office) : ""}</td>
          <td>${esc(r.purpose || "")}</td>
          <td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td>
        </tr>`).join("") : `<tr><td colspan="5"><div class="empty">No RIS records match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("risSearch").addEventListener("input", (e) => { S.risFilter.q = e.target.value; renderRis(); });
  document.getElementById("risStatusFilter").addEventListener("change", (e) => { S.risFilter.status = e.target.value; renderRis(); });
  restoreFocus(saved);
}

function risLineRowHtml(l, idx) {
  const item = l.item_id ? S.items.get(l.item_id) : null;
  return `<tr data-idx="${idx}">
    <td><select class="ris_line_item" data-idx="${idx}">
      <option value="">-- pick item --</option>
      ${activeItems(S.currentFund).map((a) => `<option value="${a.id}" ${a.id === l.item_id ? "selected" : ""}>${esc(a.stock_no)} - ${esc(a.description)}</option>`).join("")}
    </select></td>
    <td>${esc(item ? item.unit : l.unit || "")}</td>
    <td><input class="ris_line_qtyreq" data-idx="${idx}" type="number" step="0.01" value="${l.qty_requested || 0}"/></td>
    <td><input class="ris_line_qtyiss" data-idx="${idx}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : ""}"/></td>
    <td><input class="ris_line_remarks" data-idx="${idx}" value="${esc(l.remarks || "")}"/></td>
    <td><button class="btn ghost" onclick="removeRisLine(${idx})">✕</button></td>
  </tr>`;
}

let _risDraftLines = [];
function addRisLine() { _risDraftLines.push({}); renderRisLinesTable(); }
function removeRisLine(idx) { _risDraftLines.splice(idx, 1); renderRisLinesTable(); }
function renderRisLinesTable() {
  const body = document.getElementById("risLinesBody");
  if (!body) return;
  body.innerHTML = _risDraftLines.map((l, i) => risLineRowHtml(l, i)).join("");
}

function openRisModal(id) {
  if (!canEdit("ris")) { toast("You have view-only access to RIS.", true); return; }
  const r = id ? S.ris.get(id) : null;
  _risDraftLines = r ? (r.lines || []).map((l) => ({ ...l })) : [{}];
  const suggested = r ? r.ris_no : nextDocNumber(S.ris, S.currentFund, todayStr(), "ris_no");
  openModal(`
    <div class="modal-head"><h3>${r ? "Edit RIS" : "New RIS"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3">
        <div><label>RIS No.</label><input id="ris_no" value="${esc(suggested)}"/></div>
        <div><label>Date</label><input id="ris_date" type="date" value="${r ? r.date : todayStr()}"/></div>
        <div><label>FPP Code</label><input id="ris_fpp" value="${esc(r ? r.fpp_code || "" : "")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Department</label><input id="ris_dept" value="${esc(r ? r.department : "")}"/></div>
        <div><label>Office</label><input id="ris_office" value="${esc(r ? r.office || "" : "")}"/></div>
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
    disposition: l.disposition || null, recipient: l.recipient || "",
  }));
}

function saveRis(id, markIssue) {
  if (blockIfViewOnly("ris")) return;
  const ris_no = document.getElementById("ris_no").value.trim();
  const fund = S.currentFund;
  if (numberTaken(S.ris, fund, "ris_no", ris_no, id)) { toast(`RIS No. ${ris_no} is already used in this fund.`, true); return; }
  const department = document.getElementById("ris_dept").value.trim();
  if (!department) { toast("Department is required.", true); return; }
  const rec = {
    fund, ris_no, date: document.getElementById("ris_date").value || todayStr(),
    fpp_code: document.getElementById("ris_fpp").value.trim(),
    department, office: document.getElementById("ris_office").value.trim(),
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
  const rows = (r.lines || []).map((l) => {
    return `<tr>
      <td>${esc(l.stock_no)}</td><td>${esc(l.description)}</td>
      <td class="num">${fmtNum(l.qty_requested)}</td>
      <td class="num">${l.qty_issued != null ? fmtNum(l.qty_issued) : "—"}</td>
    </tr>`;
  }).join("");
  openModal(`
    <div class="modal-head"><h3>RIS ${esc(r.ris_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3 small">
        <div><b>Date</b><br/>${fmtDate(r.date)}</div>
        <div><b>Department/Office</b><br/>${esc(r.department)}${r.office ? " / " + esc(r.office) : ""}</div>
        <div><b>Status</b><br/><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></div>
      </div>
      <div class="hr"></div>
      <div class="table-wrap"><table><thead><tr><th>Stock No.</th><th>Description</th><th class="num">Qty Req.</th><th class="num">Qty Issued</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small" style="margin-top:10px;"><b>Purpose:</b> ${esc(r.purpose || "")}</p>
      <p class="small">RIS is used for <b>Consumed Inventory</b> only - issued stock is recorded as used internally by the requesting office. For issuances to a barangay, beneficiary, or the public, use an <b>Acknowledgement Receipt</b> instead.</p>
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
      <p class="small">Confirm the quantity actually issued for each line. This deducts stock immediately and records it as <b>Consumed</b> by ${esc(r.office || r.department)} - it cannot be edited afterward (only reversed).</p>
      <table class="line-table"><thead><tr><th>Item</th><th class="num">Qty Req.</th><th>Qty Issued</th></tr></thead>
      <tbody>
        ${(r.lines || []).map((l, i) => `<tr>
            <td>${esc(l.stock_no)} - ${esc(l.description)}</td>
            <td class="num">${fmtNum(l.qty_requested)}</td>
            <td><input class="iss_qty" data-idx="${i}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : l.qty_requested}"/></td>
          </tr>`).join("")}
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
    return { ...l, qty_issued: Number(qtyEl.value) || 0, disposition: "consumed", recipient: "" };
  });
  // Validate stock availability first.
  for (const l of lines) {
    const item = S.items.get(l.item_id);
    if (!item) continue;
    if (l.qty_issued > qtyBalance(item) + 1e-6) { toast(`Not enough stock for ${item.description} (balance ${fmtNum(qtyBalance(item))} ${item.unit}).`, true); return; }
  }
  const office = r.office || r.department;
  const writes = [];
  for (const l of lines) {
    if (l.qty_issued <= 0) continue;
    const item = S.items.get(l.item_id);
    if (!item) continue;
    const uc = unitCostBalance(item);
    const entry = {
      id: uid(), type: "issue", date: r.date, ref: r.ris_no,
      qty: l.qty_issued, unit_cost: uc, total_cost: round2(l.qty_issued * uc),
      office, disposition: "consumed", ris_id: r.id,
      by: S.currentUser.email, at: Date.now(),
    };
    const ledger = (item.ledger || []).concat([entry]);
    writes.push(colItems.doc(item.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colRis.doc(id).update({ lines, status: "issued", issued_at: Date.now(), issued_by_email: S.currentUser.email }))
    .then(() => { toast("RIS issued - stock updated (Consumed Inventory)."); closeModal(); })
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
  const header = ["RIS No.", "Date", "Department", "Office", "Purpose", "Status", "Stock No.", "Description", "Qty Requested", "Qty Issued"];
  const lines = [header.join(",")];
  for (const r of rows) {
    for (const l of r.lines || []) {
      lines.push([r.ris_no, r.date, r.department, r.office, r.purpose, r.status, l.stock_no, l.description, l.qty_requested, l.qty_issued].map(csvField).join(","));
    }
  }
  browserDownload(`RIS_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Acknowledgement Receipt (AR) - used whenever inventory is given out to a barangay, beneficiary,
// or the public (Distributed Inventory). Mirrors the RIS draft -> issue -> reverse lifecycle, but
// there is no official COA form for this - MGO Candoni had no reference to match, so this is a
// reasonable design based on standard LGU distribution-record practice (recipient, items,
// quantities, date, and three signature blocks).
// ---------------------------------------------------------------------

function filterArRows(f) {
  const q = (f.q || "").toLowerCase();
  let rows = [...S.ar.values()].filter((r) => r.fund === S.currentFund);
  if (f.status) rows = rows.filter((r) => r.status === f.status);
  if (q) rows = rows.filter((r) => [r.ar_no, r.recipient_name, r.recipient_barangay, r.purpose].some((v) => (v || "").toLowerCase().includes(q)));
  rows.sort((a, b) => (b.ar_no || "").localeCompare(a.ar_no || ""));
  return rows;
}

function renderAr() {
  const saved = captureFocus("view-ar");
  const f = S.arFilter;
  const rows = filterArRows(f);
  const canE = canEdit("ar");
  document.getElementById("view-ar").innerHTML = `
    <div class="panel small">Acknowledgement Receipt is used whenever inventory is given out to a barangay, beneficiary, or the public (Distributed Inventory). For inventory issued to an office for its own internal use, use RIS (Consumed Inventory) instead.</div>
    <div class="toolbar">
      <input class="grow" id="arSearch" placeholder="Search AR no., recipient, barangay, purpose..." value="${esc(f.q)}"/>
      <select id="arStatusFilter">
        <option value="" ${!f.status ? "selected" : ""}>All statuses</option>
        <option value="draft" ${f.status === "draft" ? "selected" : ""}>Draft</option>
        <option value="issued" ${f.status === "issued" ? "selected" : ""}>Issued</option>
      </select>
      <div class="toolbar-right">
        <button class="btn" onclick="exportArCsv()">Download CSV</button>
        ${canE ? `<button class="btn primary" onclick="openArModal()">+ New Acknowledgement Receipt</button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>AR No.</th><th>Date</th><th>Recipient</th><th>Purpose</th><th>Status</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openArDetail('${r.id}')">
          <td>${esc(r.ar_no)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.recipient_name || "")}${r.recipient_barangay ? " / " + esc(r.recipient_barangay) : ""}</td>
          <td>${esc(r.purpose || "")}</td>
          <td><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></td>
        </tr>`).join("") : `<tr><td colspan="5"><div class="empty">No Acknowledgement Receipts match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("arSearch").addEventListener("input", (e) => { S.arFilter.q = e.target.value; renderAr(); });
  document.getElementById("arStatusFilter").addEventListener("change", (e) => { S.arFilter.status = e.target.value; renderAr(); });
  restoreFocus(saved);
}

function arLineRowHtml(l, idx) {
  const item = l.item_id ? S.items.get(l.item_id) : null;
  return `<tr data-idx="${idx}">
    <td><select class="ar_line_item" data-idx="${idx}">
      <option value="">-- pick item --</option>
      ${activeItems(S.currentFund).map((a) => `<option value="${a.id}" ${a.id === l.item_id ? "selected" : ""}>${esc(a.stock_no)} - ${esc(a.description)}</option>`).join("")}
    </select></td>
    <td>${esc(item ? item.unit : l.unit || "")}</td>
    <td><input class="ar_line_qtyreq" data-idx="${idx}" type="number" step="0.01" value="${l.qty_requested || 0}"/></td>
    <td><input class="ar_line_qtyiss" data-idx="${idx}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : ""}"/></td>
    <td><input class="ar_line_remarks" data-idx="${idx}" value="${esc(l.remarks || "")}"/></td>
    <td><button class="btn ghost" onclick="removeArLine(${idx})">✕</button></td>
  </tr>`;
}

let _arDraftLines = [];
function addArLine() { _arDraftLines.push({}); renderArLinesTable(); }
function removeArLine(idx) { _arDraftLines.splice(idx, 1); renderArLinesTable(); }
function renderArLinesTable() {
  const body = document.getElementById("arLinesBody");
  if (!body) return;
  body.innerHTML = _arDraftLines.map((l, i) => arLineRowHtml(l, i)).join("");
}

function openArModal(id) {
  if (!canEdit("ar")) { toast("You have view-only access to Acknowledgement Receipt.", true); return; }
  const r = id ? S.ar.get(id) : null;
  _arDraftLines = r ? (r.lines || []).map((l) => ({ ...l })) : [{}];
  const suggested = r ? r.ar_no : nextDocNumber(S.ar, S.currentFund, todayStr(), "ar_no");
  openModal(`
    <div class="modal-head"><h3>${r ? "Edit Acknowledgement Receipt" : "New Acknowledgement Receipt"}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid2">
        <div><label>AR No.</label><input id="ar_no" value="${esc(suggested)}"/></div>
        <div><label>Date</label><input id="ar_date" type="date" value="${r ? r.date : todayStr()}"/></div>
      </div>
      <div class="grid2">
        <div><label>Recipient (name / office)</label><input id="ar_recipient" value="${esc(r ? r.recipient_name : "")}"/></div>
        <div><label>Barangay / Address</label><input id="ar_barangay" value="${esc(r ? r.recipient_barangay || "" : "")}"/></div>
      </div>
      <div class="hr"></div>
      <table class="line-table"><thead><tr><th>Item</th><th>Unit</th><th>Qty Requested</th><th>Qty Issued</th><th>Remarks</th><th></th></tr></thead>
        <tbody id="arLinesBody"></tbody>
      </table>
      <button class="btn" style="margin-top:8px;" onclick="addArLine()">+ Add line</button>
      <div class="hr"></div>
      <label>Purpose</label><textarea id="ar_purpose">${esc(r ? r.purpose || "" : "")}</textarea>
      <div class="grid2">
        <div><label>Released by (name)</label><input id="ar_rel_name" value="${esc(r ? r.released_by_name || "" : "")}"/></div>
        <div><label>Released by (position)</label><input id="ar_rel_pos" value="${esc(r ? r.released_by_position || "PROPERTY CUSTODIAN" : "PROPERTY CUSTODIAN")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Received by (name)</label><input id="ar_rec_name" value="${esc(r ? r.received_by_name || "" : "")}"/></div>
        <div><label>Received by (position)</label><input id="ar_rec_pos" value="${esc(r ? r.received_by_position || "" : "")}"/></div>
      </div>
      <div class="grid2">
        <div><label>Witnessed by (name)</label><input id="ar_wit_name" value="${esc(r ? r.witnessed_by_name || "" : "")}"/></div>
        <div><label>Witnessed by (position)</label><input id="ar_wit_pos" value="${esc(r ? r.witnessed_by_position || "" : "")}"/></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveAr('${r ? r.id : ""}')">Save as draft</button>
    </div>`, "wide");
  renderArLinesTable();
  document.getElementById("arLinesBody").addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (idx == null || isNaN(idx)) return;
    const l = _arDraftLines[idx] || (_arDraftLines[idx] = {});
    if (e.target.classList.contains("ar_line_item")) {
      l.item_id = e.target.value;
      const item = S.items.get(l.item_id);
      if (item) { l.stock_no = item.stock_no; l.description = item.description; l.unit = item.unit; }
    } else if (e.target.classList.contains("ar_line_qtyreq")) l.qty_requested = Number(e.target.value) || 0;
    else if (e.target.classList.contains("ar_line_qtyiss")) l.qty_issued = e.target.value === "" ? null : Number(e.target.value);
    else if (e.target.classList.contains("ar_line_remarks")) l.remarks = e.target.value;
  });
}

function collectArLines() {
  return _arDraftLines.filter((l) => l.item_id).map((l) => ({
    id: l.id || uid(), item_id: l.item_id, stock_no: l.stock_no, description: l.description, unit: l.unit,
    qty_requested: Number(l.qty_requested) || 0,
    qty_issued: l.qty_issued == null ? null : Number(l.qty_issued),
    remarks: l.remarks || "",
  }));
}

function saveAr(id) {
  if (blockIfViewOnly("ar")) return;
  const ar_no = document.getElementById("ar_no").value.trim();
  const fund = S.currentFund;
  if (numberTaken(S.ar, fund, "ar_no", ar_no, id)) { toast(`AR No. ${ar_no} is already used in this fund.`, true); return; }
  const recipient_name = document.getElementById("ar_recipient").value.trim();
  if (!recipient_name) { toast("Recipient is required.", true); return; }
  const rec = {
    fund, ar_no, date: document.getElementById("ar_date").value || todayStr(),
    recipient_name, recipient_barangay: document.getElementById("ar_barangay").value.trim(),
    lines: collectArLines(),
    purpose: document.getElementById("ar_purpose").value.trim(),
    released_by_name: document.getElementById("ar_rel_name").value.trim(),
    released_by_position: document.getElementById("ar_rel_pos").value.trim(),
    received_by_name: document.getElementById("ar_rec_name").value.trim(),
    received_by_position: document.getElementById("ar_rec_pos").value.trim(),
    witnessed_by_name: document.getElementById("ar_wit_name").value.trim(),
    witnessed_by_position: document.getElementById("ar_wit_pos").value.trim(),
    status: "draft",
    updated_at: Date.now(),
  };
  if (!rec.lines.length) { toast("Add at least one item line.", true); return; }
  if (id) {
    colAr.doc(id).update(rec).then(() => { toast("Acknowledgement Receipt saved."); closeModal(); }).catch((e) => toast(e.message, true));
  } else {
    rec.created_at = Date.now();
    colAr.doc().set(rec).then(() => { toast("Acknowledgement Receipt saved as draft."); closeModal(); }).catch((e) => toast(e.message, true));
  }
}

function openArDetail(id) {
  const r = S.ar.get(id);
  if (!r) return;
  const canE = canEdit("ar");
  const rows = (r.lines || []).map((l) => `<tr>
      <td>${esc(l.stock_no)}</td><td>${esc(l.description)}</td>
      <td class="num">${fmtNum(l.qty_requested)}</td>
      <td class="num">${l.qty_issued != null ? fmtNum(l.qty_issued) : "—"}</td>
    </tr>`).join("");
  openModal(`
    <div class="modal-head"><h3>Acknowledgement Receipt ${esc(r.ar_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3 small">
        <div><b>Date</b><br/>${fmtDate(r.date)}</div>
        <div><b>Recipient</b><br/>${esc(r.recipient_name)}${r.recipient_barangay ? " / " + esc(r.recipient_barangay) : ""}</div>
        <div><b>Status</b><br/><span class="pill ${r.status === "issued" ? "ok" : "muted"}">${r.status === "issued" ? "Issued" : "Draft"}</span></div>
      </div>
      <div class="hr"></div>
      <div class="table-wrap"><table><thead><tr><th>Stock No.</th><th>Description</th><th class="num">Qty Req.</th><th class="num">Qty Issued</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small" style="margin-top:10px;"><b>Purpose:</b> ${esc(r.purpose || "")}</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="printAr('${r.id}')">Print AR</button>
      ${canE && r.status !== "issued" ? `<button class="btn" onclick="closeModal();openArModal('${r.id}')">Edit</button><button class="btn primary" onclick="openIssueArModal('${r.id}')">Issue</button><button class="btn danger" onclick="deleteAr('${r.id}')">Delete</button>` : ""}
      ${canE && r.status === "issued" ? `<button class="btn danger" onclick="reverseAr('${r.id}')">↩ Reverse issuance</button>` : ""}
    </div>`, "wide");
}

function deleteAr(id) {
  if (blockIfViewOnly("ar")) return;
  const r = S.ar.get(id);
  if (r && r.status === "issued") { toast("An issued Acknowledgement Receipt can only be undone via Reverse issuance.", true); return; }
  if (!confirm("Delete this draft Acknowledgement Receipt?")) return;
  colAr.doc(id).delete().then(() => { toast("Acknowledgement Receipt deleted."); closeModal(); }).catch((e) => toast(e.message, true));
}

function openIssueArModal(id) {
  if (blockIfViewOnly("ar")) return;
  const r = S.ar.get(id);
  openModal(`
    <div class="modal-head"><h3>Issue Acknowledgement Receipt ${esc(r.ar_no)}</h3><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p class="small">Confirm the quantity actually released for each line. This deducts stock immediately and records it as <b>Distributed</b> to ${esc(r.recipient_name)}${r.recipient_barangay ? " (" + esc(r.recipient_barangay) + ")" : ""} - it cannot be edited afterward (only reversed).</p>
      <table class="line-table"><thead><tr><th>Item</th><th class="num">Qty Req.</th><th>Qty Issued</th></tr></thead>
      <tbody>
        ${(r.lines || []).map((l, i) => `<tr>
            <td>${esc(l.stock_no)} - ${esc(l.description)}</td>
            <td class="num">${fmtNum(l.qty_requested)}</td>
            <td><input class="ariss_qty" data-idx="${i}" type="number" step="0.01" value="${l.qty_issued != null ? l.qty_issued : l.qty_requested}"/></td>
          </tr>`).join("")}
      </tbody></table>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="confirmIssueAr('${r.id}')">Confirm issuance</button>
    </div>`, "wide");
}

function confirmIssueAr(id) {
  if (blockIfViewOnly("ar")) return;
  const r = S.ar.get(id);
  const lines = (r.lines || []).map((l, i) => {
    const qtyEl = document.querySelector(`.ariss_qty[data-idx="${i}"]`);
    return { ...l, qty_issued: Number(qtyEl.value) || 0 };
  });
  // Validate stock availability first.
  for (const l of lines) {
    const item = S.items.get(l.item_id);
    if (!item) continue;
    if (l.qty_issued > qtyBalance(item) + 1e-6) { toast(`Not enough stock for ${item.description} (balance ${fmtNum(qtyBalance(item))} ${item.unit}).`, true); return; }
  }
  const recipient = r.recipient_name + (r.recipient_barangay ? ` (${r.recipient_barangay})` : "");
  const writes = [];
  for (const l of lines) {
    if (l.qty_issued <= 0) continue;
    const item = S.items.get(l.item_id);
    if (!item) continue;
    const uc = unitCostBalance(item);
    const entry = {
      id: uid(), type: "issue", date: r.date, ref: r.ar_no,
      qty: l.qty_issued, unit_cost: uc, total_cost: round2(l.qty_issued * uc),
      disposition: "distributed", recipient, ar_id: r.id,
      by: S.currentUser.email, at: Date.now(),
    };
    const ledger = (item.ledger || []).concat([entry]);
    writes.push(colItems.doc(item.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colAr.doc(id).update({ lines, status: "issued", issued_at: Date.now(), issued_by_email: S.currentUser.email }))
    .then(() => { toast("Acknowledgement Receipt issued - stock updated (Distributed Inventory)."); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function reverseAr(id) {
  if (blockIfViewOnly("ar")) return;
  const r = S.ar.get(id);
  if (!confirm(`Reverse issuance of Acknowledgement Receipt ${r.ar_no}? This restores the issued stock back onto each item and returns the AR to Draft.`)) return;
  const writes = [];
  for (const l of r.lines || []) {
    const item = S.items.get(l.item_id);
    if (!item || !l.qty_issued) continue;
    const ledger = (item.ledger || []).filter((e) => !(e.ar_id === r.id));
    writes.push(colItems.doc(item.id).update({ ledger }));
  }
  Promise.all(writes)
    .then(() => colAr.doc(id).update({ status: "draft", issued_at: null, reversed_at: Date.now(), reversed_by: S.currentUser.email }))
    .then(() => { toast("Issuance reversed."); closeModal(); })
    .catch((e) => toast(e.message, true));
}

function printAr(id) { openPrintWindow(arHtml(S.ar.get(id)), "portrait"); }

function exportArCsv() {
  const rows = filterArRows(S.arFilter);
  const header = ["AR No.", "Date", "Recipient", "Barangay/Address", "Purpose", "Status", "Stock No.", "Description", "Qty Requested", "Qty Issued"];
  const lines = [header.join(",")];
  for (const r of rows) {
    for (const l of r.lines || []) {
      lines.push([r.ar_no, r.date, r.recipient_name, r.recipient_barangay, r.purpose, r.status, l.stock_no, l.description, l.qty_requested, l.qty_issued].map(csvField).join(","));
    }
  }
  browserDownload(`AR_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
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
  const lines = [];
  for (const r of S.ris.values()) {
    if (r.fund !== fund || r.status !== "issued") continue;
    if (r.date < from || r.date > to) continue;
    for (const l of r.lines || []) {
      if (!l.qty_issued) continue;
      const item = S.items.get(l.item_id);
      lines.push({
        ris_no: r.ris_no, responsibility_center: r.fpp_code || "", stock_no: l.stock_no, item: l.description,
        unit: l.unit, qty: l.qty_issued, unit_cost: item ? unitCostBalance(item) : 0,
        amount: round2(l.qty_issued * (item ? unitCostBalance(item) : 0)), account_code: item ? item.account_code : "",
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
    fund, period_from: from, period_to: to, date: todayStr(),
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
      <div class="table-wrap"><table><thead><tr><th>RIS No.</th><th>Stock No.</th><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
      <tbody>${(r.lines || []).map((l) => `<tr><td>${esc(l.ris_no)}</td><td>${esc(l.stock_no)}</td><td>${esc(l.item)}</td><td class="num">${fmtNum(l.qty)}</td><td class="num">${fmtMoney(l.amount)}</td></tr>`).join("") || '<tr><td colspan="5"><div class="empty">No issuances in this period.</div></td></tr>'}</tbody>
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
  const header = ["RIS No.", "Stock No.", "Item", "Unit", "Qty", "Unit Cost", "Amount", "Account Code"];
  const lines = [header.join(",")].concat((r.lines || []).map((l) => [l.ris_no, l.stock_no, l.item, l.unit, l.qty, l.unit_cost, l.amount, l.account_code].map(csvField).join(",")));
  browserDownload(`RSMI_${esc(r.serial_no)}.csv`, lines.join("\n"), "text/csv");
}

// ---------------------------------------------------------------------
// Distributed Inventory (issuance report) - RSMI already serves as Consumed Inventory's own
// report (a recap of every issued RIS line), so there is no separate "Report" item under the
// Consumed Inventory group; this report exists only for Distributed Inventory / Acknowledgement
// Receipts, which have no equivalent recap document.
// ---------------------------------------------------------------------

function distributedRowsFor(f) {
  const fund = S.currentFund;
  const rows = [];
  for (const a of S.items.values()) {
    if (a.fund !== fund) continue;
    for (const e of a.ledger || []) {
      if (e.type !== "issue") continue;
      if ((e.disposition || (isDistributionAccount(a.account_code) ? "distributed" : "consumed")) !== "distributed") continue;
      if (f.from && e.date < f.from) continue;
      if (f.to && e.date > f.to) continue;
      if (f.q) {
        const q = f.q.toLowerCase();
        if (![a.stock_no, a.description, e.recipient, e.ref].some((v) => (v || "").toLowerCase().includes(q))) continue;
      }
      rows.push({ item: a, entry: e });
    }
  }
  rows.sort((x, y) => (y.entry.date || "").localeCompare(x.entry.date || ""));
  return rows;
}

function renderDistributed() {
  const f = S.distributedFilter;
  const rows = distributedRowsFor(f);
  const total = rows.reduce((s, r) => s + (Number(r.entry.total_cost) || 0), 0);
  document.getElementById("view-distributed").innerHTML = `
    <div class="toolbar">
      <input class="grow" id="distributedSearch" placeholder="Search stock no., recipient..." value="${esc(f.q)}"/>
      <label style="margin:0;">From <input id="distributedFrom" type="date" value="${esc(f.from)}"/></label>
      <label style="margin:0;">To <input id="distributedTo" type="date" value="${esc(f.to)}"/></label>
      <div class="toolbar-right"><button class="btn" onclick="exportDistributedCsv()">Download CSV</button></div>
    </div>
    <div class="cardrow" style="grid-template-columns: 1fr;">
      <div class="card"><div class="label">Total Distributed</div><div class="value">${fmtMoney(total)}</div><div class="foot">${rows.length} issuance line(s)${f.from || f.to ? " in range" : ""}</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>AR No.</th><th>Stock No.</th><th>Description</th><th class="num">Qty</th><th class="num">Amount</th><th>Recipient / Barangay</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `
        <tr class="clickable" onclick="openItemDetail('${r.item.id}')">
          <td>${fmtDate(r.entry.date)}</td><td>${esc(r.entry.ref || "")}</td><td>${esc(r.item.stock_no)}</td><td>${esc(r.item.description)}</td>
          <td class="num">${fmtNum(r.entry.qty)} ${esc(r.item.unit)}</td><td class="num">${fmtMoney(r.entry.total_cost)}</td>
          <td>${esc(r.entry.recipient)}</td>
        </tr>`).join("") : `<tr><td colspan="7"><div class="empty">No distributed issuances match this filter.</div></td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("distributedSearch").addEventListener("input", (e) => { S.distributedFilter.q = e.target.value; renderDistributed(); });
  document.getElementById("distributedFrom").addEventListener("change", (e) => { S.distributedFilter.from = e.target.value; renderDistributed(); });
  document.getElementById("distributedTo").addEventListener("change", (e) => { S.distributedFilter.to = e.target.value; renderDistributed(); });
}

function exportDistributedCsv() {
  const rows = distributedRowsFor(S.distributedFilter);
  const header = ["Date", "AR No.", "Stock No.", "Description", "Qty", "Unit", "Amount", "Recipient"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.entry.date, r.entry.ref, r.item.stock_no, r.item.description, r.entry.qty, r.item.unit, r.entry.total_cost, r.entry.recipient].map(csvField).join(","));
  }
  browserDownload(`Distributed_Inventory_${S.currentFund}_${todayStr()}.csv`, lines.join("\n"), "text/csv");
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

const TAB_KEYS = ["dashboard", "registry", "ris", "rsmi", "ar", "distributed", "reconciliation"];
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
  dashboard: renderDashboard, registry: renderRegistry, ris: renderRis, rsmi: renderRsmi, ar: renderAr,
  distributed: renderDistributed, reconciliation: renderReconciliation, users: renderUsers,
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
  colAr.onSnapshot((rows) => { S.ar = new Map(rows.map((r) => [r.id, r])); renderAll(); });
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
  openReceiptModal, saveReceipt, printSlc, printSc, exportRegistryCsv,
  openRisModal, saveRis, addRisLine, removeRisLine, openRisDetail, deleteRis,
  openIssueRisModal, confirmIssueRis, reverseRis, printRis, exportRisCsv,
  openArModal, saveAr, addArLine, removeArLine, openArDetail, deleteAr,
  openIssueArModal, confirmIssueAr, reverseAr, printAr, exportArCsv,
  openGenerateRsmiModal, generateRsmi, openRsmiDetail, deleteRsmi, printRsmi, exportRsmiCsv,
  exportDistributedCsv, saveTbSnapshot,
  openUserRoleModal, saveUserRole, deleteUserRole,
  openChangePasswordModal, submitChangePassword,
});
