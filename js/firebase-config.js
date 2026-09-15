// Paste your Firebase project's own web app config here.
// Firebase Console -> Project settings -> General -> "Your apps" -> Web app -> SDK setup and configuration -> Config
// This is NOT a secret value - it is safe to commit to a public repo.
export const firebaseConfig = {
  apiKey: "AIzaSyCweXnloCVJ5LJ96xmcaVykK5h-vSE0K5Y",
  authDomain: "mgo-inventory.firebaseapp.com",
  projectId: "mgo-inventory",
  storageBucket: "mgo-inventory.firebasestorage.app",
  messagingSenderId: "632212909410",
  appId: "1:632212909410:web:be8263f65fa8fe8402d03b"
};

// Optional: restrict who may sign in, by email domain. Leave it EMPTY to let in any account your
// Firebase project accepts (email/password accounts you created yourself, and - once you switch
// Google sign-in on - any Google account).
//
// IMPORTANT: enabling Google sign-in in the Firebase console lets ANY Google account through,
// because firestore.rules only asks for "a signed-in user". If you turn Google sign-in on, put
// your own domain here so outsiders are signed straight back out:
//
//   export const allowedEmailDomains = ["mgocandoniaccounting.org"];
//
export const allowedEmailDomains = [];
 
