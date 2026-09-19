import { APP_ORIGIN } from "./config.mjs";
import { SITE_ORIGINS, applicationContext } from "./sites.mjs";

const supportedOrigin = (url) => {
  try {
    return SITE_ORIGINS.includes(`${new URL(url).origin}/*`);
  } catch {
    return false;
  }
};
async function inspect(target, args = []) {
  await chrome.scripting.executeScript({
    target,
    files: ["adapter-runtime.js"],
  });
  const [result] = await chrome.scripting.executeScript({
    target,
    func: (...values) => globalThis.__applyOverflowInspect(...values),
    args,
  });
  if (result?.error || !result?.result || result.result.error)
    throw new Error(
      result?.result?.error ||
        result?.error?.message ||
        "The page changed. Try again.",
    );
  return result;
}

let registration = Promise.resolve();
function syncDetection() {
  registration = registration
    .catch(() => {})
    .then(async () => {
      const permissions = await chrome.permissions.getAll();
      const origins = SITE_ORIGINS.filter((origin) =>
        permissions.origins?.includes(origin),
      );
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const existing = scripts.find((script) => script.id === "application-detection");
      if (existing && !origins.length)
        await chrome.scripting.unregisterContentScripts({
          ids: ["application-detection"],
        });
      if (origins.length && !existing)
        await chrome.scripting.registerContentScripts([
          {
            id: "application-detection",
            matches: origins,
            js: ["adapter-runtime.js", "indicator.js"],
            runAt: "document_idle",
            allFrames: false,
          },
        ]);
      else if (origins.length && JSON.stringify([...existing.matches].sort()) !== JSON.stringify([...origins].sort()))
        await chrome.scripting.updateContentScripts([{ id: "application-detection", matches: origins }]);
      // Apply permission changes to existing tabs, not just the next navigation.
      for (const tab of await chrome.tabs.query({})) {
        await chrome.tabs
          .sendMessage(tab.id, { type: "permissions-changed" })
          .catch(() => {});
        if (
          tab.url &&
          supportedOrigin(tab.url) &&
          origins.includes(`${new URL(tab.url).origin}/*`)
        )
          await chrome.scripting
            .executeScript({
              target: { tabId: tab.id },
              files: ["adapter-runtime.js", "indicator.js"],
            })
            .catch(() => {});
      }
    });
  return registration;
}
chrome.runtime.onInstalled.addListener(() => void syncDetection());
chrome.runtime.onStartup.addListener(() => void syncDetection());
chrome.permissions.onAdded.addListener(() => void syncDetection());
chrome.permissions.onRemoved.addListener(() => void syncDetection());
// A resumed worker may have permissions but no surviving registration (including
// unpacked updates). Reconcile on every worker start, not only lifecycle events.
void syncDetection().catch(() => {});

const encoded = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = () => encoded(crypto.getRandomValues(new Uint8Array(32)));
async function api(action, body, token) {
  const response = await fetch(`${APP_ORIGIN}/api/extension/v1/${action}`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401)
    await chrome.storage.session.remove("connection");
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed. Try again.");
    error.reconnect = response.status === 401;
    throw error;
  }
  return result;
}

async function connect() {
  const verifier = random();
  const state = random();
  const challenge = encoded(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const clientId = chrome.runtime.id;
  const callback = chrome.identity.getRedirectURL("callback");
  await chrome.storage.session.set({ authorization: { verifier, state } });
  try {
    const finalUrl = await chrome.identity.launchWebAuthFlow({
      interactive: true,
      url: `${APP_ORIGIN}/extension/connect?${new URLSearchParams({ clientId, challenge, state })}`,
    });
    const url = new URL(finalUrl);
    const expected = new URL(callback);
    const pending = (await chrome.storage.session.get("authorization"))
      .authorization;
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.searchParams.get("state") !== pending?.state
    )
      throw new Error("Connection could not be verified. Try again.");
    if (url.searchParams.has("error")) throw new Error("Connection cancelled.");
    const connection = await api("token", {
      clientId,
      code: url.searchParams.get("code"),
      verifier: pending.verifier,
    });
    await chrome.storage.session.set({ connection });
    return {
      connected: true,
      email: connection.email,
      message: "Connected. Open a Greenhouse, Lever or Ashby application form.",
    };
  } finally {
    await chrome.storage.session.remove("authorization");
  }
}

let working = false;
async function handle(type, sender) {
  // Session storage is never exposed to content scripts or synced across devices.
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const { connection } = await chrome.storage.session.get("connection");
  const connected = Boolean(
    connection?.token && Date.parse(connection.expiresAt) > Date.now(),
  );
  const fromPage = sender.url !== chrome.runtime.getURL("popup.html");
  if (type === "availability")
    return {
      enabled: await chrome.permissions.contains({
        origins: [`${new URL(sender.url).origin}/*`],
      }),
      connected,
    };
  if (type === "detection-updated") {
    await syncDetection();
    return { connected, message: "Site access updated." };
  }
  if (type === "status") {
    await registration;
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const current = tab?.id && applicationContext(tab.url)
      ? await inspect({ tabId: tab.id }).catch(() => null)
      : null;
    return {
      connected,
      undoAvailable: current?.result.undoAvailable === true,
      email: connected ? connection.email : "",
      message: connected
        ? "Ready on Greenhouse, Lever and Ashby forms."
        : "Connect to your ApplyOverflow profile.",
    };
  }
  if (type === "connect") {
    if (fromPage) {
      const scan = await inspect({
        tabId: sender.tab.id,
        documentIds: [sender.documentId],
      });
      if (!scan.result.available && !scan.result.resumeAvailable)
        throw new Error("No supported empty fields found.");
    }
    const result = await connect();
    return fromPage
      ? { connected: result.connected, message: result.message }
      : result;
  }
  if (!connected && type !== "undo")
    return {
      connected: false,
      message: "Connection expired. Connect to ApplyOverflow again.",
    };
  if (type === "disconnect") {
    // Keep the local token if revocation fails so disconnect can be retried.
    await api("disconnect", {}, connection.token);
    await chrome.storage.session.remove("connection");
    return { connected: false, message: "Disconnected." };
  }
  if (!["fill", "review", "resume", "undo"].includes(type))
    throw new Error("Unsupported action.");
  const tab = fromPage
    ? sender.tab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) throw new Error("Open the employer application tab first.");
  if (!applicationContext(fromPage ? sender.url : tab.url))
    throw new Error(
      "Open a supported Greenhouse, Lever or Ashby application form. Other sites need manual entry.",
    );
  const inspection = await inspect(
    fromPage
      ? { tabId: tab.id, documentIds: [sender.documentId] }
      : { tabId: tab.id },
    type === "resume" ? ["prepare-resume"] : [],
  );
  const scan = inspection.result;
  if (scan.error) throw new Error(scan.error);
  if (type === "undo") {
    const { result } = await inspect(
      { tabId: tab.id, documentIds: [inspection.documentId] },
      ["undo", {}, scan.url],
    );
    return {
      connected,
      undoAvailable: false,
      message: `${result.undone} cleared · ${result.kept} kept · ${result.unverified} unverified. Undo cannot retract information already saved by the employer.`,
    };
  }
  if (type === "resume") {
    const verifier = random();
    const state = random();
    const challenge = encoded(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const request = await api(
      "resume-request",
      { url: scan.url, challenge, state },
      connection.token,
    );
    try {
      const finalUrl = await chrome.identity.launchWebAuthFlow({
        interactive: true,
        url: `${APP_ORIGIN}/extension/resume/${encodeURIComponent(request.id)}`,
      });
      const callback = new URL(finalUrl);
      const expected = new URL(chrome.identity.getRedirectURL("callback"));
      if (
        callback.origin !== expected.origin ||
        callback.pathname !== expected.pathname ||
        callback.searchParams.get("state") !== state
      )
        throw new Error("Resume choice could not be verified. Try again.");
      if (callback.searchParams.has("error"))
        return {
          connected: true,
          message: "Resume sharing cancelled. Nothing attached.",
        };
      // Abort before fetching file bytes if the original document has disappeared.
      await inspect({ tabId: tab.id, documentIds: [inspection.documentId] }, [
        "check-resume",
        { resumeToken: scan.resumeToken },
        scan.url,
      ]);
      const file = await api(
        "resume",
        {
          id: request.id,
          code: callback.searchParams.get("code"),
          verifier,
          url: scan.url,
        },
        connection.token,
      );
      const attached = await inspect(
        { tabId: tab.id, documentIds: [inspection.documentId] },
        ["attach-resume", { ...file, resumeToken: scan.resumeToken }, scan.url],
      );
      return {
        connected: true,
        message: attached.result.resumeSelected
          ? "Resume selected in the form. Check the employer's upload status before submitting."
          : "The file was handed to the form, but acceptance could not be verified. Check the employer's upload status; attach manually if needed.",
      };
    } finally {
      await api("resume-cancel", { id: request.id }, connection.token).catch(
        () => {},
      );
    }
  }
  if (type === "fill") {
    const contact = await api("contact", {}, connection.token);
    const written = await inspect(
      { tabId: tab.id, documentIds: [inspection.documentId] },
      ["fill", contact, scan.url],
    );
    const counts = written.result;
    if (counts.error) throw new Error(counts.error);
    return {
      connected: true,
      undoAvailable: counts.undoAvailable,
      message: `${counts.filled} filled · ${counts.preserved} kept · ${counts.missing} missing or unverified. Review the employer form before submitting.`,
    };
  }
  const result = await api(
    "capture",
    { url: scan.url, title: scan.title, questions: scan.questions },
    connection.token,
  );
  await chrome.tabs.create({
    url: `${APP_ORIGIN}/applications/${encodeURIComponent(result.id)}/review`,
  });
  return {
    connected: true,
    message: scan.truncated
      ? "First 40 questions captured. Review remaining questions on the employer form."
      : "Questions opened in ApplyOverflow. Nothing submitted.",
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const page =
    sender.tab?.id &&
    sender.frameId === 0 &&
    sender.documentId &&
    supportedOrigin(sender.url);
  if (
    !popup &&
    (!page ||
      !["availability", "connect", "fill", "review", "resume", "undo"].includes(
        message?.type,
      ))
  )
    return false;
  const readOnly = ["status", "availability", "detection-updated"].includes(
    message?.type,
  );
  if (working && !readOnly) {
    respond({ error: "An action is already running." });
    return false;
  }
  if (!readOnly) working = true;
  Promise.resolve()
    .then(async () => {
      if (
        page &&
        !(await chrome.permissions.contains({
          origins: [`${new URL(sender.url).origin}/*`],
        }))
      )
        return {
          enabled: false,
          error:
            "Site access was removed. Open the Chrome extension to enable it again.",
        };
      return handle(message?.type, sender);
    })
    .then(respond)
    .catch((error) =>
      respond({
        error: error.message || "Could not complete the action.",
        reconnect: error.reconnect === true,
      }),
    )
    .finally(() => {
      if (!readOnly) working = false;
    });
  return true;
});
