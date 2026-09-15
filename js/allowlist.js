// Who is allowed to sign in, as a pure function so it can be reasoned about (and tested) on its
// own. The list lives in firebase-config.js; see the comment there.
//
//   []                                  -> everyone the Firebase project accepts (the default:
//                                          any Google account, plus the email/password accounts
//                                          you created yourself)
//   ["mgocandoniaccounting.org"]        -> only that email domain
//   ["juan.delacruz@gmail.com"]         -> only that exact address
//   ["mgocandoniaccounting.org", "a@b.com"] -> either form, mixed freely
export function emailAllowedBy(email, list) {
  const entries = (Array.isArray(list) ? list : []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
  if (!entries.length) return true; // empty list = no restriction at all
  const addr = String(email || "").trim().toLowerCase();
  if (!addr) return false;
  return entries.some((entry) => {
    if (entry.includes("@") && !entry.startsWith("@")) return addr === entry; // a whole address
    return addr.endsWith("@" + entry.replace(/^@/, ""));                      // a domain
  });
}
