import { APP_ORIGIN, BUILD_ID } from "./config.mjs";
import { SITE_ORIGINS, applicationContext } from "./sites.mjs";

const supportedOrigin = (url) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      SITE_ORIGINS.some((pattern) => {
        const host = pattern.slice(8, -2);
        return host.startsWith("*.")
          ? parsed.hostname.endsWith(host.slice(1))
          : parsed.hostname === host;
      })
    );
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
    func: (buildId, ...values) => globalThis.__applyOverflowBuild === buildId
      ? globalThis.__applyOverflowInspect(...values)
      : { error: "An extension update is ready. Reload the extension in Chrome, then refresh this application page." },
    args: [BUILD_ID, ...args],
  });
  if (result?.error || !result?.result || result.result.error)
    throw new Error(
      result?.result?.error ||
        result?.error?.message ||
        "The page changed. Try again.",
    );
  return result;
}

async function inspectActive(tab, args = []) {
  const key = `autofill:${tab.id}`;
  const saved = (await chrome.storage.session.get(key))[key];
  if (saved?.expires > Date.now() && (!saved.pageUrl || saved.pageUrl === tab.url)) {
    try { return await inspect({ tabId: tab.id, documentIds: [saved.documentId] }, args); }
    catch { await chrome.storage.session.remove(key); }
  }
  return inspect({ tabId: tab.id }, args);
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
      const existing = scripts.find(
        (script) => script.id === "application-detection",
      );
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
            allFrames: true,
          },
        ]);
      else if (
        origins.length &&
        (!existing.allFrames ||
          JSON.stringify([...existing.matches].sort()) !==
            JSON.stringify([...origins].sort()))
      )
        await chrome.scripting.updateContentScripts([
          { id: "application-detection", matches: origins, allFrames: true },
        ]);
      // Apply permission changes to existing tabs, not just the next navigation.
      for (const tab of await chrome.tabs.query({})) {
        // Background/frozen renderers may never reply. Registration and popup
        // readiness must not wait for best-effort UI notifications or injection.
        void chrome.tabs
          .sendMessage(tab.id, { type: "permissions-changed" })
          .catch(() => {});
        if (
          tab.url &&
          supportedOrigin(tab.url) &&
          (await chrome.permissions.contains({
            origins: [`${new URL(tab.url).origin}/*`],
          }))
        )
          void chrome.scripting
            .executeScript({
              target: { tabId: tab.id, allFrames: true },
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
async function notifyConnectionChanged() {
  // No profile data or token crosses this channel; each frame rechecks access.
  for (const tab of await chrome.tabs.query({}))
    void chrome.tabs
      .sendMessage(tab.id, { type: "connection-changed" })
      .catch(() => {});
}
async function clearAccountSession() {
  await chrome.storage.local.remove("connection");
  const state = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(
    Object.keys(state).filter(
      (key) =>
        key === "connection" ||
        key === "appliedPreview" ||
        key.startsWith("application:") || key.startsWith("autofill:"),
    ),
  );
  await notifyConnectionChanged();
}
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
  if (response.status === 401) await clearAccountSession();
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed. Try again.");
    error.reconnect = response.status === 401;
    throw error;
  }
  return result;
}

async function authorize(url) {
  let timer;
  try {
    // Chrome's timeout option only applies to non-interactive flows. Stop
    // awaiting abandoned windows; a late callback must never exchange a token.
    return await Promise.race([
      chrome.identity.launchWebAuthFlow({ interactive: true, url }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          "Approval timed out. Close the ApplyOverflow sign-in window, then try again.",
        )), 5 * 60_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
    const finalUrl = await authorize(`${APP_ORIGIN}/extension/connect?${new URLSearchParams({ clientId, challenge, state })}`);
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
    await clearAccountSession();
    await chrome.storage.local.set({ connection: { ...connection, origin: APP_ORIGIN } });
    await notifyConnectionChanged();
    return {
      connected: true,
      email: connection.email,
      message: "Connected. Open an employer application form.",
    };
  } finally {
    await chrome.storage.session.remove("authorization");
  }
}

let working = null;
function workingMessage() {
  if (working === "connect") return "Connection in progress. Complete or close the ApplyOverflow sign-in window to continue.";
  if (working === "resume") return "Resume approval in progress. Complete or close the resume selection window to continue.";
  return "Finishing the previous action. Please wait.";
}
async function handle(type, sender, message = {}) {
  if (type === "version") return { activeAction: working, message: working ? workingMessage() : "Ready." };
  // The grant survives browser restarts, but is never exposed to content scripts
  // or synced. Profile data and field state remain transient.
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  let { connection } = await chrome.storage.local.get("connection");
  if (!connection) {
    const legacy = (await chrome.storage.session.get("connection")).connection;
    if (legacy) {
      connection = { ...legacy, origin: APP_ORIGIN };
      await chrome.storage.local.set({ connection });
      await chrome.storage.session.remove("connection");
    }
  }
  if (connection && (connection.origin !== APP_ORIGIN || Date.parse(connection.expiresAt) <= Date.now())) {
    await clearAccountSession(); connection = undefined;
  }
  const connected = Boolean(
    connection?.token && Date.parse(connection.expiresAt) > Date.now(),
  );
  const fromPage = sender.url !== chrome.runtime.getURL("popup.html");
  if (type === "open-popup") {
    try { await chrome.action.openPopup(); }
    catch { return { connected, message: "Open ApplyOverflow from the Chrome toolbar to finish remaining fields." }; }
    return { connected, message: "Continue in the extension popup." };
  }
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
    const tab = (
      await chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    let current, inspectionError;
    const saved = tab?.id ? (await chrome.storage.session.get(`autofill:${tab.id}`))[`autofill:${tab.id}`] : null;
    if (tab?.id && (applicationContext(tab.url, true) || (saved?.expires > Date.now() && (!saved.pageUrl || saved.pageUrl === tab.url)))) {
      let inspectionTimer;
      try {
        // This scan is read-only. A busy renderer must not disable Connect or
        // conceal the independently known account state indefinitely.
        current = await Promise.race([
          inspectActive(tab),
          new Promise((_, reject) => {
            inspectionTimer = setTimeout(() => reject(new Error(
              "This page is taking too long to respond. Reopen the extension when it finishes loading.",
            )), 2500);
          }),
        ]);
      } catch (error) {
        inspectionError = error.message;
      } finally {
        clearTimeout(inspectionTimer);
      }
    }
    if (current)
      await chrome.storage.session.set({
        [`application:${tab.id}`]: {
          url: current.result.url,
          title: current.result.title,
          expires: Date.now() + 30 * 60_000,
        },
      });
    return {
      connected,
      ...(connected && saved?.expires > Date.now() && saved.documentId === current?.documentId && saved.url === current?.result.url ? { fields: current.result.fields } : {}),
      activeAction: working,
      undoAvailable: current?.result.undoAvailable === true,
      historyUndoAvailable: current?.result.historyUndoAvailable === true,
      autofillUndoAvailable: current?.result.autofillUndoAvailable === true,
      email: connected ? connection.email : "",
      form: current
        ? {
            contactFields: current.result.available,
            resumeAvailable: current.result.resumeAvailable,
            historyAvailable: current.result.historyAvailable === true,
            questions: current.result.questions.length,
          }
        : null,
      pageMessage: current
        ? [
            current.result.available && `${current.result.available} empty contact fields`,
            current.result.historyAvailable && "work & education",
            current.result.resumeAvailable && "resume upload",
            current.result.questions.length && `${current.result.questions.length} questions`,
          ].filter(Boolean).join(" · ") || "No empty supported fields on this step."
        : inspectionError || "Open an employer application form to check available fields.",
      message: working ? workingMessage() : connected
        ? current
          ? "Review the employer form after filling."
          : "Open an application form. Some fields need manual entry."
        : "Connect to your ApplyOverflow profile.",
    };
  }
  if (type === "connect") {
    if (fromPage) {
      const scan = await inspect({
        tabId: sender.tab.id,
        documentIds: [sender.documentId],
      });
      if (
        !scan.result.available &&
        !scan.result.resumeAvailable &&
        !scan.result.historyAvailable &&
        !scan.result.questions.length
      )
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
    await clearAccountSession();
    return { connected: false, message: "Disconnected." };
  }
  if (type === "history")
    return {
      connected,
      history: await api("history", {}, connection.token),
      message: "Choose one entry to share with the current form.",
    };
  if (
    ![
      "fill",
      "autofill",
      "autofill-answer",
      "autofill-focus",
      "autofill-options",
      "autofill-suggest",
      "autofill-undo",
      "review",
      "resume",
      "undo",
      "fill-history",
      "undo-history",
      "applied-preview",
      "applied",
    ].includes(type)
  )
    throw new Error("This extension needs an update. Reload it in Chrome, then refresh the application page.");
  const tab = fromPage
    ? sender.tab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) throw new Error("Open the employer application tab first.");
  if (type === "applied") {
    const { appliedPreview } =
      await chrome.storage.session.get("appliedPreview");
    if (
      !appliedPreview ||
      appliedPreview.token !== message.token ||
      appliedPreview.tabId !== tab.id ||
      appliedPreview.expires < Date.now() ||
      tab.url !== appliedPreview.pageUrl ||
      message.confirmed !== true
    )
      throw new Error(
        "The application confirmation expired. Review the job again.",
      );
    const result = await api(
      "applied",
      {
        url: appliedPreview.url,
        title: message.title,
        company: message.company,
        confirmed: true,
      },
      connection.token,
    );
    await chrome.storage.session.remove("appliedPreview");
    await chrome.tabs.create({
      url: `${APP_ORIGIN}/applications/${encodeURIComponent(result.id)}`,
    });
    return {
      connected,
      message:
        "Application recorded. No employer form was submitted by the extension.",
    };
  }
  if (type === "applied-preview") {
    const current = applicationContext(tab.url, true)
      ? await inspect({ tabId: tab.id }).catch(() => null)
      : null;
    const cached = (await chrome.storage.session.get(`application:${tab.id}`))[
      `application:${tab.id}`
    ];
    const candidate =
      current?.result ??
      (cached?.expires > Date.now() &&
      new URL(cached.url).origin === new URL(tab.url).origin
        ? cached
        : null);
    if (!candidate)
      throw new Error(
        "Open the job application form first. You can also add an application in ApplyOverflow.",
      );
    const context = applicationContext(candidate.url, true);
    if (!context)
      throw new Error(
        "This job link cannot be recorded safely. Add it in ApplyOverflow.",
      );
    const preview = {
      url: context.url,
      title: candidate.title,
      company: context.tenant,
      token: random(),
      tabId: tab.id,
      pageUrl: tab.url,
      expires: Date.now() + 120_000,
    };
    await chrome.storage.session.set({ appliedPreview: preview });
    return {
      connected,
      preview,
      message: "Confirm only after the employer has accepted your submission.",
    };
  }
  const savedFrame = (await chrome.storage.session.get(`autofill:${tab.id}`))[`autofill:${tab.id}`];
  if (!applicationContext(fromPage ? sender.url : tab.url, !fromPage) &&
    !(!fromPage && savedFrame?.expires > Date.now() && (!savedFrame.pageUrl || savedFrame.pageUrl === tab.url)))
    throw new Error(
      "Open a supported application form. For an embedded form, use its autofill hint; enable site access and reload if the hint is missing.",
    );
  const inspection = fromPage
    ? await inspect({ tabId: tab.id, documentIds: [sender.documentId] }, type === "resume" ? ["prepare-resume"] : [])
    : await inspectActive(tab, type === "resume" ? ["prepare-resume"] : []);
  const scan = inspection.result;
  if (scan.error) throw new Error(scan.error);
  const target = { tabId: tab.id, documentIds: [inspection.documentId] };
  const report = (result, note = "") => {
    const fields = result.fields || [];
    const filled = fields.filter(field => field.state === "filled").length;
    const kept = fields.filter(field => field.state === "kept").length;
    const needed = fields.filter(field => field.state === "needed").length;
    return { connected: true, fields,
      autofillUndoAvailable: result.autofillUndoAvailable === true,
      historyUndoAvailable: result.historyUndoAvailable === true,
      message: `${filled} filled · ${kept} kept · ${needed} to review.${note} Nothing submitted.`,
    };
  };
  if (type === "autofill") {
    const questions = scan.fields ? [...new Set(scan.fields.filter(field => !field.profileKey && field.canAnswer && field.state === "needed")
      .map(field => field.label))].slice(0, 40) : scan.questions;
    const plan = await api("autofill-plan", {
      url: scan.url, questions, history: scan.historyAvailable === true,
    }, connection.token);
    // Pin both frame document and URL across every asynchronous network step.
    const written = await inspect(target, ["autofill", plan, scan.url]);
    let note = written.result.historyFilled ? ` ${written.result.historyFilled} work/education fields filled.` : "";
    if (scan.resumeAvailable) {
      if (plan.includeResume) {
        try {
          const ready = await inspect(target, ["prepare-resume", {}, scan.url]);
          const file = await api("resume-default", { url: scan.url }, connection.token);
          const attached = await inspect(target, ["attach-resume", { ...file, resumeToken: ready.result.resumeToken }, scan.url]);
          note += attached.result.resumeSelected ? " Default resume selected; check upload status." : " Check the resume upload on the form.";
        } catch (error) {
          if (error.reconnect) return { ...report(written.result), connected: false, reconnect: true, message: "Some fields were filled, but the connection expired before resume sharing. Reconnect to continue." };
          note += ` Resume: ${error.message}`;
        }
      } else note += " Resume not shared. Choose a resume or enable default sharing in Profile.";
    }
    const final = await inspect(target, ["inspect", {}, scan.url]);
    const response = report(final.result, note);
    response.revision = plan.revision;
    // Save only document identity/revision. Profile and answer values stay transient.
    await chrome.storage.session.set({ [`autofill:${tab.id}`]: {
      url: scan.url, documentId: inspection.documentId, revision: plan.revision,
      pageUrl: tab.url,
      expires: Date.now() + 10 * 60_000,
    } });
    return response;
  }
  if (["autofill-answer", "autofill-focus", "autofill-options", "autofill-suggest"].includes(type)) {
    const saved = (await chrome.storage.session.get(`autofill:${tab.id}`))[`autofill:${tab.id}`];
    if (!saved || saved.documentId !== inspection.documentId || saved.url !== scan.url || saved.expires < Date.now())
      throw new Error("Click Autofill to check the current application step first.");
    if (typeof message.id !== "string" || typeof message.label !== "string" ||
      (type === "autofill-answer" && (typeof message.answer !== "string" || message.answer.length > 3000)))
      throw new Error("Check your answer and try again.");
    if (type === "autofill-suggest") {
      const field = scan.fields?.find(field => field.id === message.id && field.label === message.label && field.state === "needed" && field.canAnswer && !field.profileKey && field.kind === "text");
      if (!field || typeof message.note !== "string" || message.note.length > 1200)
        throw new Error("This question changed. Autofill again to check the form.");
      const context = await inspect(target, ["autofill-context", {}, scan.url]);
      const result = await api("autofill-suggest", { url: scan.url, label: field.label,
        title: scan.title || "", jobDescription: context.result.jobDescription || "", note: message.note, revision: saved.revision }, connection.token);
      const current = await inspect(target, ["inspect", {}, scan.url]);
      if (!current.result.fields?.some(f => f.id === field.id && f.label === field.label && f.state === "needed"))
        throw new Error("The form changed while drafting. Your existing answers were not changed.");
      return { connected: true, ...result, message: result.suggestion.answer ? "Draft ready. Edit it, then choose Use answer." : result.suggestion.missing };
    }
    const written = await inspect(target, [type, { id: message.id, label: message.label, answer: message.answer }, scan.url]);
    let note = "";
    if (type === "autofill-answer" && message.remember === true && written.result.answered?.canRemember) {
      try {
        const field = written.result.answered;
        let answer = message.answer.trim();
        if (["country", "phoneCountry"].includes(field.profileKey)) answer = ({ canada: "CA", "united states": "US", "united states of america": "US" })[answer.toLowerCase().replace(/\s*\(?\+1\)?\s*$/, "").trim()] || answer.toUpperCase();
        const result = await api("autofill-answer", { url: scan.url, label: field.label,
          answer, ...(field.profileKey ? { profileKey: field.profileKey } : {}), revision: saved.revision }, connection.token);
        await chrome.storage.session.set({ [`autofill:${tab.id}`]: { ...saved, revision: result.revision } });
        note = field.profileKey ? " Saved to Profile." : " Saved for this exact question at this employer.";
      } catch (error) {
        if (error.reconnect) return { ...report(written.result), connected: false, reconnect: true, message: "Answer filled but not remembered. Reconnect to continue." };
        note = ` Filled, but not remembered: ${error.message}`;
      }
    }
    return report(written.result, note);
  }
  if (type === "autofill-undo") {
    const written = await inspect(target, [type, {}, scan.url]);
    const history = await inspect(target, ["undo-history", {}, scan.url]);
    const final = await inspect(target, ["inspect", {}, scan.url]);
    return { ...report(final.result), message: `${written.result.undone + (history.result.undone || 0)} fields cleared. Unsupported widgets, resumes and employer autosaves cannot be undone here.` };
  }
  await chrome.storage.session.set({
    [`application:${tab.id}`]: {
      url: scan.url,
      title: scan.title,
      expires: Date.now() + 30 * 60_000,
    },
  });
  if (type === "fill-history" || type === "undo-history") {
    const payload =
      type === "fill-history"
        ? await api("history-entry", message.selection, connection.token)
        : {};
    const { result } = await inspect(
      { tabId: tab.id, documentIds: [inspection.documentId] },
      [type, payload, scan.url],
    );
    return {
      connected,
      historyUndoAvailable: result.historyUndoAvailable === true,
      message:
        type === "fill-history"
          ? `${result.filled} history fields filled · ${result.skipped} need review. Check dates and current-role settings.`
          : `${result.undone} history fields cleared · ${result.kept} kept.`,
    };
  }
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
      const finalUrl = await authorize(`${APP_ORIGIN}/extension/resume/${encodeURIComponent(request.id)}`);
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
    const names = {
      givenName: "given name", familyName: "family name", fullName: "full name",
      email: "email", phone: "phone", linkedInUrl: "LinkedIn",
      githubUrl: "GitHub", portfolioUrl: "portfolio", streetAddress: "street address",
      addressLine2: "address line 2", city: "city", postalCode: "postal code",
    };
    const missing = [...new Set(counts.missingFields || [])]
      .filter(key => Object.hasOwn(names, key)).map(key => names[key]);
    const profileHint = missing.length
      ? ` Complete ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " and other missing details" : ""} in your ApplyOverflow profile.`
      : "";
    return {
      connected: true,
      undoAvailable: counts.undoAvailable,
      message: `${counts.filled} filled · ${counts.preserved} kept · ${counts.missing} missing or unverified.${profileHint} Review the employer form before submitting.`,
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
    Number.isInteger(sender.frameId) &&
    sender.frameId >= 0 &&
    sender.documentId &&
    supportedOrigin(sender.url);
  if (
    !popup &&
    (!page ||
      !["availability", "connect", "fill", "autofill", "autofill-answer", "autofill-focus", "autofill-options", "autofill-suggest", "autofill-undo", "review", "resume", "undo", "open-popup"].includes(
        message?.type,
      ))
  )
    return false;
  const readOnly = ["version", "status", "availability", "detection-updated"].includes(
    message?.type,
  );
  if (!readOnly && message.buildId !== BUILD_ID) {
    respond({ error: popup ? "Reopen the extension to finish updating. Nothing was changed." : "This page has an older Autofill version. Refresh the application page; if the message persists, reload the extension in Chrome.", buildId: BUILD_ID });
    return false;
  }
  if (working && !readOnly) {
    respond({ error: workingMessage(), activeAction: working, buildId: BUILD_ID });
    return false;
  }
  if (!readOnly) working = message?.type;
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
      return handle(message?.type, sender, message);
    })
    .then(result => respond({ ...result, buildId: BUILD_ID }))
    .catch((error) =>
      respond({
        error: error.message || "Could not complete the action.",
        reconnect: error.reconnect === true,
        buildId: BUILD_ID,
      }),
    )
    .finally(() => {
      if (!readOnly) working = null;
    });
  return true;
});
chrome.tabs.onRemoved.addListener(
  (tabId) => void chrome.storage.session.remove([`application:${tabId}`, `autofill:${tabId}`]),
);
