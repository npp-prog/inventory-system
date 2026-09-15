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

// Who may sign in. EMPTY (the setting below) means **any Google account** can sign in, plus any
// email/password account you created in the Firebase console. That is the intended setup here.
//
// If you ever want to narrow it, list email domains and/or whole addresses - anyone else is
// signed straight back out with a message:
//
//   export const allowedEmailDomains = ["mgocandoniaccounting.org"];          // a whole domain
//   export const allowedEmailDomains = ["juan@gmail.com", "maria@gmail.com"]; // specific people
//
// Worth knowing either way: firestore.rules only asks for "a signed-in user", so while this list
// is empty, anyone with a Google account who finds the site's address can sign in and edit data.
export const allowedEmailDomains = [];
