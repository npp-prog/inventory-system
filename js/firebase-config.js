// The Firebase project's own web app config.
// Firebase Console -> Project settings -> General -> "Your apps" -> Web app -> SDK setup and configuration -> Config
// This is NOT a secret value - it is safe to commit to a public repo. A Firebase web apiKey only
// identifies the project; what actually protects the data is firestore.rules plus the Authorized
// domains list under Authentication -> Settings. Never treat it as a password, and never move it
// into a "secret" that the browser would still have to download anyway.
export const firebaseConfig = {
  apiKey: "AIzaSyCweXnloCVJ5LJ96xmcaVykK5h-vSE0K5Y",
  authDomain: "mgo-inventory.firebaseapp.com",
  projectId: "mgo-inventory",
  storageBucket: "mgo-inventory.firebasestorage.app",
  messagingSenderId: "632212909410",
  appId: "1:632212909410:web:be8263f65fa8fe8402d03b",
};

// ---------------------------------------------------------------------------------------------
// WHO MAY SIGN IN.  Anyone whose email does not match an entry below is signed straight back out
// with a message, even if Firebase itself accepted their Google account.
//
//   "mgocandoniaccounting.org"   - a whole email domain
//   "juan.delacruz@gmail.com"    - one exact address
//   (empty list)                 - NO restriction: any Google account on earth can sign in
//
// npp@mgocandoniaccounting.org can always sign in regardless of this list (see
// ALWAYS_ALLOWED_EMAILS in js/allowlist.js), so a mistake here cannot lock the office out.
//
// SET TO EMPTY ON PURPOSE (Sept 2026). This is NOT an oversight - do not "fix" it by adding the
// office domain back unless you have read the next paragraph and decided otherwise.
//
// Access is controlled by APPROVAL, not by email address. Anyone signing in with Google now lands
// on a "Waiting for approval" screen and can read and write nothing at all until an Administrator
// approves them in Users & Roles. Because that gate exists, filtering by email address here would
// only add a second way to be refused - and a worse one, because someone blocked here is bounced
// at the door with no request reaching anybody, and no way to ask.
//
// If you ever DO want address filtering as well, the format is:
//   "mgocandoniaccounting.org"    - a whole email domain
//   "juan.delacruz@gmail.com"     - one exact address
// Anyone not matching is signed straight back out. npp@mgocandoniaccounting.org can always sign in
// regardless (see ALWAYS_ALLOWED_EMAILS in js/allowlist.js), so a mistake here cannot lock the
// office out of its own system.
// ---------------------------------------------------------------------------------------------
export const allowedEmailDomains = [];
