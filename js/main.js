import { watchAuth, auth, signOut, isAllowedAccount } from "./firebase.js";
import { initAuthUi } from "./auth-ui.js";
import { initApp } from "./app.js";

initAuthUi();

const signinScreen = document.getElementById("signinScreen");
const appScreen = document.getElementById("appScreen");

let appStarted = false;

watchAuth((user) => {
  // Optional domain guard (see allowedEmailDomains in firebase-config.js). Matters most once
  // Google sign-in is enabled, since Firebase will otherwise accept any Google account.
  if (user && !isAllowedAccount(user)) {
    const errBox = document.getElementById("signinError");
    if (errBox) {
      errBox.textContent = `${user.email || "That account"} isn't allowed to use this system. Sign in with your municipal account.`;
      errBox.hidden = false;
    }
    signOut();
    return;
  }
  if (user) {
    signinScreen.hidden = true;
    appScreen.hidden = false;
    if (!appStarted) {
      appStarted = true;
      initApp(user);
    }
  } else {
    appStarted = false;
    appScreen.hidden = true;
    signinScreen.hidden = false;
  }
});
