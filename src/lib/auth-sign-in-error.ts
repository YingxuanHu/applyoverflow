type SignInError = { code?: string; status?: number };

export function getSignInErrorFeedback(error: SignInError) {
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return {
      message: "Email not verified. Check your inbox for the verification link.",
      needsVerification: true,
    };
  }

  let message = "Unable to sign in right now. Please try again.";
  if (error.status === 429) {
    message = "Too many sign-in attempts. Wait a moment, then try again.";
  } else if (error.status === 0) {
    message = "Could not connect. Check your connection and try again.";
  } else if (error.status && error.status >= 500) {
    message = "Sign-in is temporarily unavailable. Please try again shortly.";
  } else if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) {
    message = "Invalid email or password.";
  }
  return { message, needsVerification: false };
}
