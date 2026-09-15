# Importing your real data

This repo ships with **no real inventory data seeded** - by design, so the item/account structure
could be reviewed and confirmed first. Your real data lives in the Google Sheet
**"GF_Consumable Distribution Inventory Monitoring Schedule"**
(`1iZy3g44Wg5tYC4Epfd8jjiQ3B12bviLSnFbQjMBIcE0`), which has 11 tabs:

- `01_Inventories` - the main item register (Account Code, Stock No., Description, Unit Cost,
  Qty/Cost Receipt, Qty/Cost Issued, Qty/Cost Balance, DV No./RIS No., Expense Account) - this is
  the primary source for `data/seed_items.json`.
- `02.0 Inventories_Beg (RHU)`, `02.1_Inventories - RHU Purchase`, `02.2_Stock Transfer Supplies`,
  `02.3_Inventories RHU End`, `RHU Summary` - Rural Health Unit-specific detail (batch numbers,
  expiration dates, donor/source tracking, quarantine quantities) that goes beyond this system's
  current item model. If the RHU's data needs the same batch/expiry-level detail the app will
  need small schema additions (e.g. `batch_no`, `expiry_date` on a receipt entry) before importing
  this tab faithfully.
- `Variance Analysis` - the client's own cost-vs-Trial-Balance comparison per account, useful for
  verifying an import landed correctly (the same way the sibling PMS's own imports were verified).
- `Consumption` - a per-account DR/CR summary for the year, used to build this app's default
  expense-account mapping (see `ACCOUNT_CATALOG` in `js/app.js`).
- `Chart of Accounts` - the full COA; only the `104xx` (Inventory) and `502030xx` (Supplies and
  Materials Expenses) ranges were used here.
- `Ledger` - a JEV-level transaction ledger (RowID/ReferenceNumber/TransDate/AccountCode/Debit/
  Credit) - out of scope for this app's own item ledger, which tracks physical receipt/issue
  movements rather than journal entries.
- `Sheet8` - not inspected; check before importing.

## Suggested next step

When you're ready to import: re-fetch `01_Inventories`, map each row to an item doc (Account
Code -> `account_code`, Stock No. -> `stock_no`, Description -> `description`, Item -> `item`,
Unit of Measurement -> `unit`, Unit Cost -> `unit_cost`, Expense Account (+ Name) ->
`expense_account_code`/`expense_account_name`), and seed each item's `ledger[]` from its own
Qty/Cost Receipt and Qty/Cost Issued columns as a single opening "receipt" + "issue" pair (or,
for a fuller history, from the underlying `Ledger` tab's transaction-level detail). Save the
result as `data/seed_items.json` (an array of item objects, `id` optional) and run:

```
npm install
node scripts/seed-client.mjs you@yourdomain.com "your-password"
```

(or `node scripts/seed.mjs` if you have a service-account key - see that script's own comments).
