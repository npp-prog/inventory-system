// Wires the sign-in screen: email/password form, Google sign-in button, forgot-password link.
import { signInEmail, signInGoogle, resetPassword } from "./firebase.js";

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
  return "Sign-in failed. Please try again.";
}

export function initAuthUi() {
  const form = document.getElementById("signinForm");
  const errBox = document.getElementById("signinError");
  const googleBtn = document.getElementById("googleSigninBtn");
  const forgotLink = document.getElementById("forgotPasswordLink");

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
      try {
        await signInGoogle();
      } catch (err) {
        errBox.textContent = friendlyAuthError(err);
        errBox.hidden = false;
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
