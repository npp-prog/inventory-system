// Firebase Auth + Firestore adapter.
// Loaded as an ES module. Uses the Firebase v10 modular CDN build so nothing needs npm-installing
// to run the app itself (only the seed scripts, which run under Node, need `npm install`).
import { firebaseConfig, allowedEmailDomains } from "./firebase-config.js";
import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  updatePassword as fbUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

// Google sign-in. Tries a popup first (fastest, keeps the page state); if the browser blocks it
// - phone browsers and in-app webviews routinely do - it falls back to a full-page redirect,
// whose result is picked up by completeGoogleRedirect() when the page loads again.
const POPUP_FALLBACK_CODES = [
  "auth/popup-blocked",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
];
export function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider).catch((err) => {
    if (POPUP_FALLBACK_CODES.includes((err && err.code) || "")) {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  });
}

// Call once on load: resolves with the signed-in result after a redirect round-trip, or null.
export function completeGoogleRedirect() {
  return getRedirectResult(auth);
}

// Optional guard. `allowedEmailDomains` is empty by default, which allows any account the Firebase
// project itself accepts (the behaviour before Google sign-in existed). Fill it in to restrict
// who can get in once Google sign-in is enabled - see README, "Google sign-in".
export function isAllowedAccount(user) {
  const list = Array.isArray(allowedEmailDomains) ? allowedEmailDomains.filter(Boolean) : [];
  if (!list.length) return true;
  const email = ((user && user.email) || "").toLowerCase();
  return list.some((d) => email.endsWith("@" + String(d).toLowerCase().replace(/^@/, "")));
}

export function signOut() {
  return fbSignOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await fbUpdatePassword(user, newPassword);
}

// --- Firestore adapter -------------------------------------------------
// Thin wrapper matching the exact shape app.js expects:
//   fsCollection(name).doc(id?).set(data) / .update(data) / .delete() / .onSnapshot(cb)
// Docs are addressed by string id; set() without an id auto-generates one.

function wrapDoc(colName, id) {
  const ref = doc(db, colName, id);
  return {
    id,
    set: (data) => setDoc(ref, data, { merge: false }),
    update: (data) => updateDoc(ref, data),
    delete: () => deleteDoc(ref),
  };
}

export function fsCollection(colName) {
  return {
    doc(id) {
      if (id) return wrapDoc(colName, id);
      const ref = doc(collection(db, colName));
      return wrapDoc(colName, ref.id);
    },
    onSnapshot(cb, errCb) {
      return onSnapshot(
        collection(db, colName),
        (snap) => {
          const rows = [];
          snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
          cb(rows);
        },
        errCb
      );
    },
  };
}

export function nowStamp() {
  return serverTimestamp();
}

export function browserDownload(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
