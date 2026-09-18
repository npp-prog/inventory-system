import { emailAllowedBy, isEmailAllowed, ALWAYS_ALLOWED_EMAILS } from "../js/allowlist.js";
let pass = 0, fail = 0;
const t = (c, m) => { if (c) { pass++; console.log("  ok -", m); } else { fail++; console.log("  FAIL -", m); } };

t(emailAllowedBy("someone@gmail.com", []) === true, "empty list = no restriction (any account)");
t(emailAllowedBy("x@y.com", undefined) === true, "a missing list is treated as no restriction");
t(emailAllowedBy("npp@mgocandoniaccounting.org", ["mgocandoniaccounting.org"]) === true, "domain entry allows that domain");
t(emailAllowedBy("outsider@gmail.com", ["mgocandoniaccounting.org"]) === false, "domain entry blocks other domains");
t(emailAllowedBy("juan@gmail.com", ["juan@gmail.com"]) === true, "a whole address can be listed on its own");
t(emailAllowedBy("maria@gmail.com", ["juan@gmail.com"]) === false, "...and only that address gets in");
t(emailAllowedBy("JUAN@GMAIL.COM", ["juan@gmail.com"]) === true, "matching ignores capitalisation");
t(emailAllowedBy("juan@gmail.com", ["@gmail.com"]) === true, "a domain written with a leading @ still works");
t(emailAllowedBy("evil@notgmail.com", ["gmail.com"]) === false, "a lookalike domain suffix is not a match");
t(emailAllowedBy("a@b.com", ["  ", "b.com"]) === true, "blank entries are ignored");
t(emailAllowedBy("", ["b.com"]) === false, "a blank email is refused once a restriction exists");

// The failsafe layer the app actually calls
t(ALWAYS_ALLOWED_EMAILS.includes("npp@mgocandoniaccounting.org"), "the hardcoded Admin is in ALWAYS_ALLOWED_EMAILS");
t(isEmailAllowed("npp@mgocandoniaccounting.org", ["wrong-domain.org"]) === true, "Admin gets in despite a wrong allowlist");
t(isEmailAllowed("NPP@MgoCandoniAccounting.org", ["wrong-domain.org"]) === true, "...case-insensitively");
t(isEmailAllowed("someone.else@gmail.com", ["mgocandoniaccounting.org"]) === false, "the failsafe does not leak to anyone else");
t(isEmailAllowed("staff@mgocandoniaccounting.org", ["mgocandoniaccounting.org"]) === true, "normal office account still allowed");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
