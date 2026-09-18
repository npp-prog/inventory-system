// Who is allowed to sign in, as pure functions so this can be reasoned about (and tested) on its
// own. The configured list lives in firebase-config.js; see the comment there.
//
//   []                                  -> everyone the Firebase project accepts (NO restriction:
//                                          any Google account, plus every email/password account)
//   ["mgocandoniaccounting.org"]        -> only that email domain
//   ["juan.delacruz@gmail.com"]         -> only that exact address
//   ["mgocandoniaccounting.org", "a@b.com"] -> either form, mixed freely

// Failsafe: these addresses can always sign in, whatever the configured list says, so a typo in
// firebase-config.js can never lock the office out of its own system. Keep this in step with
// HARDCODED_ADMIN_EMAILS in js/app.js, which is what grants Admin rights once signed in - this
// list only governs getting through the door.
export const ALWAYS_ALLOWED_EMAILS = ["npp@mgocandoniaccounting.org"];

function normalize(email) {
  return String(email || "").trim().toLowerCase();
}

// Pure rule: does `email` match any entry of `list`? An empty list means no restriction at all.
export function emailAllowedBy(email, list) {
  const entries = (Array.isArray(list) ? list : []).map(normalize).filter(Boolean);
  if (!entries.length) return true;
  const addr = normalize(email);
  if (!addr) return false;
  return entries.some((entry) => {
    if (entry.includes("@") && !entry.startsWith("@")) return addr === entry; // a whole address
    return addr.endsWith("@" + entry.replace(/^@/, ""));                      // a domain
  });
}

// What the app actually calls: the configured rule, plus the never-lock-out failsafe above.
export function isEmailAllowed(email, list) {
  if (ALWAYS_ALLOWED_EMAILS.map(normalize).includes(normalize(email))) return true;
  return emailAllowedBy(email, list);
}
