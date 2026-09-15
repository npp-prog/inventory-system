// Wires the sign-in screen: email/password form, Google sign-in button, forgot-password link.
import { signInEmail, signInGoogle, resetPassword, completeGoogleRedirect } from "./firebase.js";

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Incorrect email or password.";
  }
  if (code.includes("too-many-requests")) {
    return "Too many attempts. Please wait a bit and try again.";
  }
  if (code.includes("invalid-email")) {
    return "That doesn't look like a valid email address.";
  }
  if (code.includes("popup-closed-by-user")) {
    return "Sign-in was cancelled.";
  }
  // The two things that actually go wrong the first time Google sign-in is switched on:
  if (code.includes("operation-not-allowed")) {
    return "Google sign-in isn't switched on for this project yet. In the Firebase console open Authentication -> Sign-in method and enable Google.";
  }
  if (code.includes("unauthorized-domain")) {
    // Nothing to do with which email address is being used - Firebase is refusing the WEBSITE.
    const host = (typeof location !== "undefined" && location.hostname) || "this site";
    return `Google sign-in is blocked for this website, not for your account. Add "${host}" in the Firebase console under Authentication -> Settings -> Authorized domains, then try again.`;
  }
  if (code.includes("account-exists-with-different-credential")) {
    return "That email already signs in with a password here. Use the email and password form above instead.";
  }
  if (code.includes("network-request-failed")) {
    return "Couldn't reach Firebase - check the internet connection and try again.";
  }
  return "Sign-in failed. Please try again.";
}

export function initAuthUi() {
  const form = document.getElementById("signinForm");
  const errBox = document.getElementById("signinError");
  const googleBtn = document.getElementById("googleSigninBtn");
  const forgotLink = document.getElementById("forgotPasswordLink");

  // If Google sign-in had to fall back to a full-page redirect, this is where we land afterwards:
  // a successful result signs the user in via watchAuth, a failed one needs reporting here.
  completeGoogleRedirect().catch((err) => {
    if (!errBox) return;
    errBox.textContent = friendlyAuthError(err);
    errBox.hidden = false;
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const email = document.getElementById("signinEmail").value.trim();
      const password = document.getElementById("signinPassword").value;
      try {
        await signInEmail(email, password);
      } catch (err) {
        errBox.textContent = friendlyAuthError(err);
        errBox.hidden = false;
      }
    });
  }

  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      errBox.hidden = true;
      googleBtn.disabled = true;
      try {
        await signInGoogle();
      } catch (err) {
        errBox.textContent = friendlyAuthError(err);
        errBox.hidden = false;
      } finally {
        googleBtn.disabled = false;
      }
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = document.getElementById("signinEmail").value.trim();
      if (!email) {
        errBox.textContent = "Type your email above first, then click \"Forgot password\".";
        errBox.hidden = false;
        return;
      }
      try {
        await resetPassword(email);
        errBox.textContent = "Password reset email sent to " + email + ".";
        errBox.hidden = false;
      } catch (err) {
        errBox.textContent = friendlyAuthError(err);
        errBox.hidden = false;
      }
    });
  }
}
