import { watchAuth, auth } from "./firebase.js";
import { initAuthUi } from "./auth-ui.js";
import { initApp } from "./app.js";

initAuthUi();

const signinScreen = document.getElementById("signinScreen");
const appScreen = document.getElementById("appScreen");

let appStarted = false;

watchAuth((user) => {
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
