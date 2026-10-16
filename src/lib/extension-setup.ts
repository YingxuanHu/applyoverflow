export const EXTENSION_STORE_ID = "mhkkioknljkgnhgnhcamilkgbadjnmil";
export const EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/applyoverflow-assistant/${EXTENSION_STORE_ID}`;
export const SETUP_PROTOCOL = 2;
export type SetupCapabilities = { contact: boolean; pendingReview: boolean; resume: "none" | "ineligible" | "sharing-off" | "enabled" };
export type SetupBrowserState = "checking" | "unsupported" | "unavailable" | "not-detected" | "outdated" | "disconnected" | "mismatch" | "verified";
export function setupNextAction(state: SetupBrowserState, signedIn: boolean, contact: boolean) {
  if (state === "unsupported") return "jobs";
  if (!signedIn) return "sign-in";
  if (state === "checking") return "wait";
  if (state === "unavailable") return "retry";
  if (state === "not-detected") return "install";
  if (state === "outdated") return "update";
  if (!contact) return "profile";
  if (state === "verified") return "continue";
  return "connect";
}
