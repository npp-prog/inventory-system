# Inventory Management System (IMS) - MGO Candoni

A standalone, self-hosted Inventory / Consumable Supplies system - your own Firebase project
(Firestore + Authentication), your own GitHub repo, deployed on Netlify. No dependency on Claude
or Anthropic infrastructure once it's set up. Built as a sibling app to your Property Management
System (PMS / PPE Ledger) - same overall approach, separate app and separate Firebase project so
the two registers' data and billing stay independent.

## What it does

- **Fund switcher** (General Fund / Special Education Fund / Trust Fund) scopes the whole app to
  one fund's books at a time, the same as PMS.
- **Inventory Registry** - one item per stock number (Account Code, Stock No., Description, Unit,
  Unit Cost, Re-order Point), with a full receipt/issue movement history per item. Every item
  prints two official forms straight from that same history: the **Supplies Ledger Card**
  (Appendix 9 - the accounting office's cost-based view: Receipt/Issue/Balance in Qty, Unit Cost,
  and Total Cost) and the **Stock Card** (Appendix 53 - the GSO/property office's quantity-only
  view: Receipt Qty, Issue Qty + Office, Balance Qty). Recording a new item lets you enter its
  opening balance directly (for onboarding what's already on the shelf) or add stock later as a
  dated Receipt.
- **RIS (Requisition and Issue Slip)** - Appendix 48, generated per issuance. A RIS starts as a
  Draft (what an office is requesting); **Issue** confirms the actual quantity released, deducts
  it from that item's Stock Card/Ledger Card in the same step, and classifies each line as
  **Consumed** (used internally by an office) or **Distributed** (given out to a barangay,
  beneficiary, or the public) - defaulting from the item's own account (the `... for Distribution`
  UACS accounts default to Distributed; the plain `... Inventory` accounts default to Consumed),
  editable per line, with a Recipient/Barangay field for a Distributed line. An issued RIS can be
  reversed (restoring the stock and returning it to Draft) if it was issued in error.
- **RSMI (Report of Supplies and Materials Issued)** - Appendix 40, generated on demand for any
  date range: pulls every issued RIS line in that range and recaps it by Stock No., matching the
  official form and its recapitulation section exactly.
- **Consumed Inventory** / **Distributed Inventory** - the two issuance reports the office asked
  for as their own tabs, each filterable by date range and search, with running totals and its own
  CSV export - Distributed additionally shows who/where each item went.
- **Reconciliation** - paste or upload a Trial Balance (Excel/CSV) and compare it, account by
  account, against the Inventory Registry's own running balance for that account - OK/CHECK pills,
  the same pattern as PMS's own Reconciliation tab.
- **Users & Roles** - an Admin (your own account, `npp@mgocandoniaccounting.org`, is always Admin,
  hardcoded so it can never be edited away) can restrict any other signed-in person's access per
  tab - Hidden, View only, or Edit - from a dedicated tab visible only to Admins. This is
  **app-level only**: it hides menus/buttons, it does not lock the underlying Firestore database
  itself (`firestore.rules` stays "any signed-in user"). Anyone with no role set keeps full access
  everywhere. A signed-in email/password user can also change their own password from the sidebar.
- Currency displays as "Php" with Roboto Mono numerals (no slashed zero), matching PMS.

## What's NOT included yet

Your real data - the "GF_Consumable Distribution Inventory Monitoring Schedule" Google Sheet - has
**not** been imported. This was a deliberate choice: get the item/account structure, the two
printed cards, RIS, RSMI, and reconciliation working and reviewed first, then import the real
history once the shape is confirmed. See `data/README.md` for exactly what's in that sheet and how
to bring it in when you're ready (`npm install` + `node scripts/seed-client.mjs`).

---

## Setup - from zero to a live URL

### 1. Create a new Firebase project

Go to [console.firebase.google.com](https://console.firebase.google.com) -> **Add project**. Give
it its own name (e.g. "mgo-candoni-ims") - **do not reuse your PMS/PPE Ledger's Firebase
project**, so the two systems' data and billing stay fully separate.

### 2. Turn on Firestore and Authentication

- **Build -> Firestore Database -> Create database** - production mode, pick a nearby region.
- **Build -> Authentication -> Get started** - enable **Email/Password**, and **Google** if you
  want staff to be able to sign in with their Google account.
- **Authentication -> Users -> Add user** - create an account for yourself and anyone else who
  needs access. There is no self-service sign-up in this app on purpose.

### 3. Register a web app and get your config

**Project settings (gear icon) -> General -> Your apps -> Add app -> Web** (the `</>` icon). Name
it anything. Firebase shows you a `firebaseConfig` object - copy it.

Open `js/firebase-config.js` in this repo and paste your real values in place of the
`PASTE_YOUR_...` placeholders. This file is **not secret** - it's fine to commit to a public repo.

### 4. Publish the Firestore security rules

**Firestore Database -> Rules** tab in the console, paste in the contents of this repo's
`firestore.rules`, and click **Publish**.

### 5. Push this repo to GitHub

If you're comfortable with a terminal:

```
cd inventory-system
git init
git add .
git commit -m "Initial Inventory Management System"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git push -u origin main
```

If you'd rather not use the command line, install **GitHub Desktop**
([desktop.github.com](https://desktop.github.com)), sign in, choose **Add local repository**,
point it at this folder, **Create a repository**, then **Publish repository**.

### 6. Deploy on Netlify

1. Go to [app.netlify.com](https://app.netlify.com) -> **Add new site -> Import an existing
   project**.
2. Connect your GitHub account and pick the repo you just pushed.
3. Build settings: leave **Build command** blank and set **Publish directory** to `.` (this repo
   has no build step - it's plain HTML/CSS/JS).
4. **Deploy site.** Netlify gives you a URL like `your-site-name.netlify.app` - open it, sign in
   with the account you created in Step 2, and you're live.

Any future change: edit the files, `git push` (or commit + Publish in GitHub Desktop) - Netlify
redeploys automatically within a minute or two.

### 7. Sign in and start using it

Sign in with the account you created in Step 2. The sidebar defaults to **General Fund** - use the
switcher to add items under Special Education Fund or Trust Fund whenever needed. Add your first
items under **Inventory Registry**, then use **RIS** to record issuances.

---

## Repo structure

- `index.html` - sign-in screen + app shell (no framework, plain DOM). Loads SheetJS (`xlsx`, from
  cdnjs) for the Reconciliation Excel-upload feature.
- `css/styles.css` - light/dark-aware design system: sidebar with the Fund switcher and nav,
  cards, tables, modals, and a separate print stylesheet for the four official forms.
- `js/firebase-config.js` - your project's own web config (paste in Step 3 above).
- `js/firebase.js` - Firebase Auth helpers (sign-in, Google sign-in, password reset/change) and a
  thin Firestore adapter matching the exact `collection().doc().set()/.update()/.delete()/
  .onSnapshot()` shape `app.js` expects.
- `js/auth-ui.js` - wires the sign-in form, Google sign-in button, forgot-password link.
- `js/main.js` - watches Firebase auth state, shows/hides the sign-in screen vs. the app.
- `js/app.js` - the whole system: item/ledger engine, RIS/RSMI, Consumed/Distributed reports,
  Reconciliation, Access Role, printable Appendix 9/40/48/53 forms. All functions referenced from
  inline `onclick=""` HTML are attached to `window` at the very bottom of the file (this app runs
  as an ES module, so module-scope names aren't global the way they are in a classic `<script>`) -
  **remember to add any new inline-onclick function to that block**.
- `firestore.rules` - `allow read, write: if request.auth != null;` (any signed-in user; nobody
  else). Access Role's per-tab restrictions are enforced by the app, not by these rules - see the
  Users & Roles description above for that caveat.
- `netlify.toml` - tells Netlify this is a static site with no build step.
- `scripts/seed.mjs` / `scripts/seed-client.mjs` - one-time data-import scripts (admin-key and
  client-SDK variants respectively) for once you're ready to bring in real data - see
  `data/README.md`.
- `data/README.md` - what's in your real source spreadsheet and how to map it into this system
  when you're ready to import it.

## Chart of accounts used

Inventory (asset-side, UACS `104xx`) and their suggested default expense accounts (UACS
`50203xxx`) are both defined in `js/app.js`'s `ACCOUNT_CATALOG` - taken directly from your own
Chart of Accounts tab and Consumption summary. Every account is always editable per item; nothing
here is enforced beyond being a sensible default when you add a new item. Accounts whose name ends
"... for Distribution" are the ones whose issuances default to **Distributed**; every other
Inventory account defaults to **Consumed**.

## If you want the same hands-on deployment help you had with PMS

Bring this repo (or just describe where you're stuck) back to this same kind of session - the
walkthrough above follows the exact same shape as PMS's own setup (Firebase project creation,
Firestore + Auth, GitHub Desktop for a no-terminal push), so the same troubleshooting playbook
(Notepad "Save as type: All Files" for editing `firebase-config.js` on Windows, the
service-account-key org-policy workaround in `scripts/seed-client.mjs`, and so on) applies here
too.
