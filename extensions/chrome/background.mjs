import { APP_ORIGIN, BUILD_ID } from "./config.mjs";
import { detectionOrigins, applicationContext, sameApplication } from "./sites.mjs";
import { questionAssistance } from "./question-policy.mjs";
import { canPrepareAnswer as canDraft, fillProfessionalAnswers } from "./answer-runner.mjs";
import { recoveryForError, stoppedFields, planQuestions } from "./recovery.mjs";
import { createWorkspaceBridge, allowedWorkspaceSender } from "./workspace-bridge.mjs";
import { createSetupBridge, allowedSetupSender } from "./setup-bridge.mjs";

let verifiedConnection = null;
const recovery = (error, action) => {
  if (error.recovery) return error.recovery;
  const result = recoveryForError(error, action);
  return { ...result, detail: `${result.detail} | Extension: ${chrome.runtime.getManifest?.().version || BUILD_ID}` };
};

const supportedOrigin = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(applicationContext(url, true));
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
  try { return await inspect({ tabId: tab.id }, args); }
  catch (error) {
    // Frame discovery is read-only. Only one identified application document
    // may be selected; all subsequent writes stay pinned to that document.
    if (args.length) throw error;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["adapter-runtime.js"] });
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: buildId => globalThis.__applyOverflowBuild === buildId ? globalThis.__applyOverflowInspect() : null,
        args: [BUILD_ID],
      });
      const candidates = frames.filter(frame => frame.result && !frame.result.error &&
        (frame.result.fields?.length || frame.result.available || frame.result.historyAvailable || frame.result.resumeAvailable));
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) throw new Error("Multiple application frames were found. Use the on-page assistant inside the form you want to fill.");
    } catch (frameError) {
      if (frameError.message.startsWith("Multiple application")) throw frameError;
    }
    throw error;
  }
}

let registration = Promise.resolve();
function syncDetection() {
  registration = registration
    .catch(() => {})
    .then(async () => {
      const permissions = await chrome.permissions.getAll();
      const origins = detectionOrigins(permissions.origins);
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
chrome.runtime.onInstalled.addListener(details => {
  void syncDetection();
  if (details?.reason === "install") void chrome.tabs.create({ url: `${APP_ORIGIN}/extension/setup` });
});
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
const digest = async value => encoded(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function notifyConnectionChanged() {
  // No profile data or token crosses this channel; each frame rechecks access.
  for (const tab of await chrome.tabs.query({}))
    void chrome.tabs
      .sendMessage(tab.id, { type: "connection-changed" })
      .catch(() => {});
}
async function clearAccountSession() {
  verifiedConnection = null;
  await chrome.storage.local.remove("connection");
  const state = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(
    Object.keys(state).filter(
      (key) =>
        key === "connection" ||
        key === "appliedPreview" ||
        key.startsWith("application:") || key.startsWith("autofill:") || key.startsWith("submission:") || key.startsWith("workspace:"),
    ),
  );
  await notifyConnectionChanged();
}
async function api(action, body, token) {
  let response;
  try { response = await fetch(`${APP_ORIGIN}/api/extension/v1/${action}`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(action === "connection-status" ? 5000 : action === "autofill-suggest" ? 28_000 : 20_000),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }); } catch (cause) {
    const error = Object.assign(new Error("Could not reach ApplyOverflow."), {
      name: cause?.name || "Error", code: ["AbortError", "TimeoutError"].includes(cause?.name) ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
    });
    error.recovery = recovery(error, action); throw error;
  }
  if (response.status === 401) await clearAccountSession();
  let result;
  try { result = await response.json(); } catch { /* A proxy may return HTML or an empty response. */ }
  if (!response.ok || !result || typeof result !== "object" || Array.isArray(result)) {
    const error = new Error(result?.error || "ApplyOverflow returned an unreadable response.");
    error.reconnect = response.status === 401;
    error.status = response.status;
    error.code = result?.code || (response.ok || !result ? "INVALID_RESPONSE" : "");
    error.fields = result?.fields;
    error.requestId = result?.requestId;
    error.retryAfter = response.headers?.get?.("Retry-After");
    error.recovery = recovery(error, action);
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
    await chrome.storage.local.set({ connection: { ...connection, origin: APP_ORIGIN, onboardingJourney: crypto.randomUUID() } });
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

async function openSetup(sender) {
  const tab = sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const context = tab?.id && supportedOrigin(tab.url) ? random() : null;
  const setup = await chrome.tabs.create({ url: `${APP_ORIGIN}/extension/setup${context ? `?context=${context}` : ""}` });
  if (context) {
    const entries = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(entries).filter(key => key.startsWith("setup-return:") && entries[key].expires < Date.now()));
    const { connection } = await chrome.storage.local.get("connection");
    await chrome.storage.session.set({ [`setup-return:${context}`]: { tabId: tab.id, url: tab.url, ownerTabId: setup.id, account: connection?.email, expires: Date.now() + 2 * 60 * 60_000 } });
  }
  return { opened: true, message: "Continue setup in the ApplyOverflow tab. Your application stays open." };
}

let working = null;
let autofillProgress = null;
function workingMessage() {
  if (working === "connect") return "Connection in progress. Complete or close the ApplyOverflow sign-in window to continue.";
  if (working === "resume") return "Resume approval in progress. Complete or close the resume selection window to continue.";
  if (working === "submission-commit") return "Submitting once and checking employer confirmation. Do not submit again on the employer site.";
  return "Finishing the previous action. Please wait.";
}
function submissionPageMatches(raw, originalUrl) {
  try {
    const original = new URL(originalUrl), current = new URL(raw);
    return current.origin === original.origin && (sameApplication(raw, originalUrl) ||
      (!original.search && !current.search && current.pathname.startsWith(`${original.pathname.replace(/\/$/, "")}/`)));
  } catch { return false; }
}
async function submissionOutcome(preview) {
  const tab = await chrome.tabs.get(preview.tabId);
  if (!submissionPageMatches(tab.url, preview.url)) return "unverified";
  const target = { tabId: preview.tabId };
  const [loaded] = await chrome.scripting.executeScript({ target, files: ["adapter-runtime.js"] });
  if (!loaded?.documentId) return "unverified";
  const [result] = await chrome.scripting.executeScript({ target: { tabId: preview.tabId, documentIds: [loaded.documentId] },
    func: (buildId, afterNavigation) => globalThis.__applyOverflowBuild === buildId
      ? { ...globalThis.__applyOverflowSubmission("outcome", null, null, { afterNavigation }), url: location.href } : null,
    args: [BUILD_ID, loaded.documentId !== preview.documentId],
  });
  return submissionPageMatches(result?.result?.url, preview.url) ? result.result.outcome : "unverified";
}
async function handle(type, sender, message = {}, workspaceTab = null) {
  if (type === "version") return { activeAction: working, message: working ? workingMessage() : "Ready." };
  if (["extension-help", "chrome-extensions", "open-profile"].includes(type)) {
    await chrome.tabs.create({ url: type === "chrome-extensions" ? `chrome://extensions/?id=${chrome.runtime.id}` :
      `${APP_ORIGIN}${type === "open-profile" ? "/profile" : "/settings/extension"}` });
    return { opened: true };
  }
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
  const expired = connection && (connection.origin !== APP_ORIGIN || !Number.isFinite(Date.parse(connection.expiresAt)) || Date.parse(connection.expiresAt) <= Date.now());
  if (expired) {
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
    const savedSubmission = tab?.id ? (await chrome.storage.session.get(`submission:result:${tab.id}`))[`submission:result:${tab.id}`] : null;
    const progress = autofillProgress?.tabId === tab?.id && autofillProgress.documentId === current?.documentId && autofillProgress.url === current?.result.url ? autofillProgress : null;
    let connectionError;
    if (connected && !working && (verifiedConnection?.token !== connection.token || verifiedConnection.until < Date.now())) {
      try {
        const status = await api("connection-status", {}, connection.token);
        verifiedConnection = { token: connection.token, until: Date.now() + 60_000, capabilities: status.capabilities, metricsEnabled: status.metricsEnabled === true };
      } catch (error) { connectionError = error; }
    }
    const failure = connectionError ? recovery(connectionError, "connection-status") : expired ? recovery({ code: "SIGN_IN_REQUIRED" }, "connection-status") : progress?.recovery;
    return {
      connected: connected && !connectionError?.reconnect,
      reconnect: connectionError?.reconnect === true || Boolean(expired),
      connectionVerified: connected && !connectionError && verifiedConnection?.token === connection.token && verifiedConnection.until > Date.now(),
      capabilities: verifiedConnection?.token === connection?.token ? verifiedConnection?.capabilities : undefined,
      recovery: failure,
      tabId: tab?.id,
      submissionResult: connected && savedSubmission && submissionPageMatches(tab.url, savedSubmission.url) ? savedSubmission : null,
      ...(connected && (progress || (saved?.expires > Date.now() && saved.documentId === current?.documentId && saved.url === current?.result.url)) ? {
        fields: current.result.fields?.map(field => {
          const previous = autofillProgress?.tabId === tab.id && autofillProgress.documentId === current.documentId
            ? autofillProgress.fields?.find(f => f.id === field.id && f.label === field.label) : null;
          return field.state === "needed" && previous ? { ...field, queued: previous.queued, processing: previous.processing, blocked: previous.blocked, reason: previous.reason } : field;
        }),
      } : {}),
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
            current.result.manualResume && "resume: manual upload",
            current.result.questions.length && `${current.result.questions.length} questions`,
          ].filter(Boolean).join(" · ") || "No empty supported fields on this step."
        : inspectionError || "Open an employer application form to check available fields.",
      message: failure ? failure.message : working && autofillProgress?.tabId === tab?.id ? autofillProgress.message : working ? workingMessage() : connected
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
    const result = await openSetup(sender);
    autofillProgress = null;
    return result;
  }
  if (!connected && type !== "undo")
    return {
      connected: false,
      reconnect: true,
      recovery: recovery({ code: "SIGN_IN_REQUIRED" }, type),
      message: "Sign in to ApplyOverflow, then retry. Your existing form answers will stay unchanged.",
    };
  if (type === "disconnect") {
    // Keep the local token if revocation fails so disconnect can be retried.
    await api("disconnect", {}, connection.token);
    await clearAccountSession();
    autofillProgress = null;
    return { connected: false, message: "Disconnected." };
  }
  const journey = connection?.onboardingJourney || crypto.randomUUID();
  const run = type === "autofill" ? crypto.randomUUID() : null;
  const measure = (event, counts = {}) => {
    if (!run || !connection?.token || (verifiedConnection?.token === connection.token && verifiedConnection.metricsEnabled === false)) return;
    // Include unsupported/failed scans in attempts. The server opt-in controls
    // storage; this independent request cannot alter credentials or execution.
    void fetch(`${APP_ORIGIN}/api/extension/v1/onboarding-event`, { method: "POST", credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(3000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ event, entry: "extension", journey, run, ...counts }) }).catch(() => {});
  };
  if (type === "autofill") { autofillProgress = null; measure("autofill_attempted"); }
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
      "autofill-drafts",
      "autofill-undo",
      "review",
      "resume",
      "undo",
      "fill-history",
      "undo-history",
      "applied-preview",
      "applied",
      "submission-preview",
      "submission-commit",
      "submission-cancel",
    ].includes(type)
  )
    throw new Error("This extension needs an update. Reload it in Chrome, then refresh the application page.");
  const tab = workspaceTab || (fromPage
    ? sender.tab
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
  if (!tab?.id) throw new Error("Open the employer application tab first.");
  if (type.startsWith("submission-")) {
    if (fromPage) throw new Error("Submission approval is only available in the Chrome toolbar.");
    const previewKey = `submission:preview:${tab.id}`;
    if (type === "submission-cancel") {
      await chrome.storage.session.remove(previewKey);
      return { connected, message: "Submission cancelled. Nothing submitted." };
    }
    if (type === "submission-preview") {
      await chrome.storage.session.remove([previewKey, `submission:result:${tab.id}`]);
      const inspection = await inspectActive(tab);
      if (inspection.frameId !== 0) throw new Error("Embedded applications need manual submission in this preview.");
      const scan = inspection.result;
      const context = applicationContext(scan.url, true);
      if (!context) throw new Error("This application cannot be identified safely. Submit it manually.");
      const attemptKey = `submission-attempt:${await digest(`${APP_ORIGIN}|${connection.email}|${context.jobKey || context.url}`)}`;
      if ((await chrome.storage.local.get(attemptKey))[attemptKey])
        throw new Error("A submission was already attempted for this application. Check the employer and your tracker; automatic retries are disabled.");
      const server = await api("submission-check", { url: scan.url }, connection.token);
      if (server.alreadyApplied !== false) throw new Error("Your tracker already records this application as applied, or readiness could not be verified. No submission will be attempted.");
      const token = random();
      const checked = await inspect({ tabId: tab.id, documentIds: [inspection.documentId] }, ["submission-preview", { token }, scan.url]);
      const preview = { token, tabId: tab.id, documentId: inspection.documentId, pageUrl: tab.url,
        url: scan.url, title: scan.title, company: context.tenant, attemptKey,
        connectionStamp: await digest(connection.token), expires: Date.now() + 90_000 };
      if (checked.result.ready) await chrome.storage.session.set({ [previewKey]: preview });
      return { connected, submissionReview: { ...checked.result, token: checked.result.ready ? token : null,
        title: preview.title, company: preview.company, url: preview.url, expires: preview.expires },
        message: checked.result.ready ? "Checks passed. Review the employer form before approving this one submission."
          : "Submission paused. Complete the remaining items on the employer site." };
    }
    const preview = (await chrome.storage.session.get(previewKey))[previewKey];
    if (!preview || preview.token !== message.token || message.confirmed !== true || preview.expires <= Date.now() ||
        preview.pageUrl !== tab.url || preview.connectionStamp !== await digest(connection.token))
      throw new Error("Submission approval expired or the tab changed. Review this application again.");
    const server = await api("submission-check", { url: preview.url }, connection.token);
    if (server.alreadyApplied !== false) throw new Error("Your tracker already records this application as applied, or readiness could not be verified. Nothing submitted.");
    if ((await chrome.storage.local.get(preview.attemptKey))[preview.attemptKey])
      throw new Error("A submission was already attempted. Check the employer confirmation; do not retry automatically.");
    const state = await chrome.storage.local.get(null);
    if (Object.keys(state).filter(key => key.startsWith("submission-attempt:")).length >= 5000)
      throw new Error("Submission history is full. Submit on the employer site and record it manually.");
    // Persist the attempt BEFORE clicking. Worker termination, timeouts, popup
    // closure and ambiguous responses must never cause a second submission.
    const attemptedAt = Date.now();
    await chrome.storage.local.set({ [preview.attemptKey]: { outcome: "unverified", attemptedAt } });
    await chrome.storage.session.remove(previewKey);
    let clicked;
    try {
      clicked = (await inspect({ tabId: tab.id, documentIds: [preview.documentId] }, ["submission-commit", {
        token: preview.token, confirmed: true, documentsReviewed: message.documentsReviewed === true,
      }, preview.url])).result;
    } catch { /* The click might have navigated or lost its response. Never retry it. */ }
    if (clicked?.clicked === false) {
      await chrome.storage.local.remove(preview.attemptKey);
      return { connected, message: clicked.message, submissionResult: { outcome: "blocked", message: clicked.message } };
    }
    let outcome = "unverified";
    for (let i = 0; i < 15; i++) {
      outcome = await submissionOutcome(preview).catch(() => "unverified");
      if (outcome === "confirmed") break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    let resultMessage = "Submission attempted, but employer acceptance could not be verified. Check the employer site before taking any further action. No automatic retry or applied status.";
    let applicationId;
    if (outcome === "confirmed") {
      resultMessage = "Employer confirmation detected. Application submitted.";
      try {
        const recorded = await api("applied", { url: preview.url, title: preview.title, company: preview.company, confirmed: true }, connection.token);
        applicationId = recorded.id;
        resultMessage += " Added to your applications.";
      } catch { resultMessage += " Tracking could not be saved. Use I applied to record it; do not resubmit."; }
    }
    await chrome.storage.local.set({ [preview.attemptKey]: { outcome, attemptedAt } });
    const submissionResult = { outcome, url: preview.url, message: resultMessage, ...(applicationId ? { applicationId } : {}) };
    await chrome.storage.session.set({ [`submission:result:${tab.id}`]: submissionResult });
    return { connected, submissionResult, message: resultMessage };
  }
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
  if (!applicationContext(fromPage ? sender.url : tab.url, true) &&
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
    const kept = fields.filter(field => field.state === "kept" && !field.reviewRequired).length;
    const needed = fields.filter(field => field.state === "needed" || field.reviewRequired).length;
    return { connected: true, fields,
      autofillUndoAvailable: result.autofillUndoAvailable === true,
      historyUndoAvailable: result.historyUndoAvailable === true,
      message: `${filled} filled · ${kept} kept · ${needed} to review.${note} Nothing submitted.`,
    };
  };
  if (type === "autofill") {
    const publish = async (fields, message, active = true, failure = null) => {
      autofillProgress = { type: "autofill-progress", buildId: BUILD_ID, tabId: tab.id, documentId: inspection.documentId,
        url: scan.url, fields, message, active, recovery: failure, connected: failure?.code !== "SIGN_IN_REQUIRED" };
      void chrome.tabs.sendMessage(tab.id, autofillProgress, { documentId: inspection.documentId }).catch(() => {});
      void chrome.runtime.sendMessage(autofillProgress).catch(() => {});
    };
    await publish((scan.fields || []).map(field => ({ ...field, queued: field.state === "needed" })), "Reading your saved profile...");
    const questions = planQuestions(scan);
    const plan = await api("autofill-plan", {
      url: scan.url, questions, history: scan.historyAvailable === true, employmentCountry: scan.employmentCountry,
    }, connection.token);
    // Pin both frame document and URL across every asynchronous network step.
    const written = await inspect(target, ["autofill", { ...plan, reconcilePrefilled: message.reconcilePrefilled === true }, scan.url]);
    await publish(written.result.fields || [], "Saved details filled. Checking your default resume...");
    let note = written.result.historyFilled ? ` ${written.result.historyFilled} work/education fields filled.` : "";
    if (written.result.historyUpdated) note += ` ${written.result.historyUpdated} saved history values corrected from your profile.`;
    let resumeRecovery;
    if (written.result.historySaved) note += ` ${written.result.historySaved} work/education records saved.`;
    if (written.result.historyDateAdjusted) note += " Month-only dates use the first day for starts and the last day for ends.";
    if (scan.aiRestricted) note += " This employer disallows AI-written answers. Saved facts can still be filled.";
    if (written.result.historyWarnings?.length) note += ` ${written.result.historyWarnings.slice(0, 2).join(" ")}`;
    if (scan.manualResume) note += " Review the resume on the form; this site's upload button needs manual attachment.";
    if (scan.resumeAvailable) {
      if (plan.includeResume) {
        try {
          const ready = await inspect(target, ["prepare-resume", {}, scan.url]);
          const file = await api("resume-default", { url: scan.url }, connection.token);
          const attached = await inspect(target, ["attach-resume", { ...file, resumeToken: ready.result.resumeToken }, scan.url]);
          note += attached.result.resumeSelected ? " Default resume selected; check upload status." : " Check the resume upload on the form.";
          if (attached.result.resumeParserReview) note += " Review details imported by the employer's resume parser.";
        } catch (error) {
          if (error.reconnect) throw error;
          resumeRecovery = recovery(error, "resume-default");
          note += ` Resume: ${error.message}`;
        }
      } else note += " Resume not shared. Choose a resume or enable default sharing in Profile.";
    }
    const final = await inspect(target, ["inspect", {}, scan.url]);
    const response = report(final.result, note);
    response.recovery = resumeRecovery;
    response.revision = plan.revision;
    // Save only document identity/revision. Profile and answer values stay transient.
    await chrome.storage.session.set({ [`autofill:${tab.id}`]: {
      url: scan.url, documentId: inspection.documentId, revision: plan.revision,
      pageUrl: tab.url,
      expires: Date.now() + 10 * 60_000,
    } });
    try {
      const context = response.fields.some(field => field.state === "needed" && field.canAnswer && !field.profileKey && !field.aiRestricted)
        ? await inspect(target, ["autofill-context", {}, scan.url]) : null;
      response.fields = await fillProfessionalAnswers({ fields: response.fields,
        inspect: async (mode, payload = {}) => (await inspect(target, [mode, payload, scan.url])).result,
        suggest: field => api("autofill-suggest", { url: scan.url, label: field.label, title: scan.title || "",
          jobDescription: context?.result.jobDescription || "", note: "", revision: plan.revision,
          maxLength: field.maxLength, maxWords: field.maxWords, ...(field.options?.length ? { options: field.options.slice(0, 80) } : {}) }, connection.token),
        progress: (fields, message) => publish(fields, message),
      });
      response.message = `Autofill complete.${note} Nothing submitted.`;
    } catch (error) {
      response.fields = stoppedFields(autofillProgress?.fields || response.fields);
      response.recovery = recovery(error, "autofill-suggest");
      response.message = response.recovery.message;
      if (error.reconnect) { response.connected = false; response.reconnect = true; }
    }
    response.fields = response.fields.map(field => field.state === "needed" && !field.blocked && field.label.length > 500
      ? { ...field, reason: "This question exceeds the supported length. Other fields were processed; answer this one on the employer form." } : field);
    const emptyBefore = new Set((scan.fields || []).filter(field => field.state === "needed").map(field => field.id));
    const newlyFilled = response.fields.filter(field => field.state === "filled" && emptyBefore.has(field.id)).length;
    measure("autofill_completed", { filled: Math.min(500, newlyFilled), remaining: Math.min(500, response.fields.filter(field => field.state === "needed").length) });
    if (newlyFilled) {
      await chrome.storage.local.set({ firstVerifiedFill: true });
      measure("first_real_autofill_succeeded", { filled: Math.min(500, newlyFilled) });
    }
    await publish(response.fields, response.message, false, response.recovery);
    return response;
  }
  if (type === "autofill-drafts") {
    const saved = (await chrome.storage.session.get(`autofill:${tab.id}`))[`autofill:${tab.id}`];
    if (!saved || saved.documentId !== inspection.documentId || saved.url !== scan.url || saved.expires < Date.now())
      throw new Error("Click Autofill to check the current application step first.");
    const fields = (scan.fields || []).filter(canDraft).slice(0, 3);
    if (!fields.length) return report(scan);
    const context = await inspect(target, ["autofill-context", {}, scan.url]);
    const drafts = new Map();
    for (const field of fields) if (field.kind === "combobox" && !field.options?.length) {
      const loaded = await inspect(target, ["autofill-options", { id: field.id, label: field.label }, scan.url]);
      field.options = loaded.result.fields.find(f => f.id === field.id)?.options || [];
    }
    // Bounded concurrency: contact filling finishes before this optional AI work.
    for (let offset = 0; offset < fields.length; offset += 2) await Promise.all(fields.slice(offset, offset + 2).map(async field => {
      try {
        if (field.kind !== "text" && !field.options?.length) throw new Error("Choose on the form; its answer choices could not be read.");
        const result = await api("autofill-suggest", { url: scan.url, label: field.label,
          title: scan.title || "", jobDescription: context.result.jobDescription || "", note: "", revision: saved.revision,
          maxLength: field.maxLength, maxWords: field.maxWords, ...(field.options?.length ? { options: field.options.slice(0, 80) } : {}) }, connection.token);
        drafts.set(field.id, result.suggestion);
      } catch (error) {
        if (error.reconnect) throw error;
        drafts.set(field.id, { answer: "", evidence: [], missing: error.message || "A draft could not be prepared. Try Suggest answer." });
      }
    }));
    const current = await inspect(target, ["inspect", {}, scan.url]);
    const result = report(current.result);
    result.fields = result.fields.map(field => field.state === "needed" && fields.some(f => f.id === field.id && f.label === field.label)
      ? { ...field, suggestion: drafts.get(field.id) } : field);
    const count = [...drafts.values()].filter(draft => draft.answer).length;
    result.message = count ? `${count} answer ${count === 1 ? "draft is" : "drafts are"} ready to review. Nothing submitted.` : "Saved facts filled. Remaining questions need your input.";
    return result;
  }
  if (["autofill-answer", "autofill-focus", "autofill-options", "autofill-suggest"].includes(type)) {
    const saved = (await chrome.storage.session.get(`autofill:${tab.id}`))[`autofill:${tab.id}`];
    if (!saved || saved.documentId !== inspection.documentId || saved.url !== scan.url || saved.expires < Date.now())
      throw new Error("Click Autofill to check the current application step first.");
    if (typeof message.id !== "string" || typeof message.label !== "string" ||
      (type === "autofill-answer" && (typeof message.answer !== "string" || message.answer.length > 3000)))
      throw new Error("Check your answer and try again.");
    if (type === "autofill-suggest") {
      if (scan.aiRestricted) throw new Error("This employer disallows AI-written answers. Write these responses yourself; saved facts can still be filled.");
      const field = scan.fields?.find(field => field.id === message.id && field.label === message.label && field.state === "needed" && field.canAnswer && !field.profileKey &&
        (field.kind === "text" || questionAssistance(field.label) === "qualification"));
      if (!field || typeof message.note !== "string" || message.note.length > 1200)
        throw new Error("This question changed. Autofill again to check the form.");
      const context = await inspect(target, ["autofill-context", {}, scan.url]);
      if (field.kind === "combobox" && !field.options?.length) {
        const loaded = await inspect(target, ["autofill-options", { id: field.id, label: field.label }, scan.url]);
        field.options = loaded.result.fields.find(f => f.id === field.id)?.options || [];
      }
      if (field.kind !== "text" && !field.options?.length) throw new Error("Choose on the form; its answer choices could not be read.");
      const result = await api("autofill-suggest", { url: scan.url, label: field.label,
        title: scan.title || "", jobDescription: context.result.jobDescription || "", note: message.note, revision: saved.revision,
        maxLength: field.maxLength, maxWords: field.maxWords, ...(field.options?.length ? { options: field.options.slice(0, 80) } : {}) }, connection.token);
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

const workspaceBridge = createWorkspaceBridge({ origin: APP_ORIGIN, api, inspect, inspectActive, handle, sameApplication,
  busy: () => working, setBusy: value => { working = value; }, version: chrome.runtime.getManifest?.().version || BUILD_ID });
const setupBridge = createSetupBridge({ origin: APP_ORIGIN, api, connect, random, sameApplication,
  busy: () => working, setBusy: value => { working = value; }, version: chrome.runtime.getManifest?.().version || BUILD_ID });
chrome.runtime.onMessageExternal?.addListener((message, sender, respond) => {
  if (allowedSetupSender(sender, APP_ORIGIN)) {
    setupBridge(message, sender).then(respond).catch(error => respond({ error: error.message || "Check the connection again." }));
    return true;
  }
  if (!allowedWorkspaceSender(sender, APP_ORIGIN)) return false;
  workspaceBridge(message, sender).then(respond).catch(error => respond({ error: error.message || "Workspace action failed. Check the employer tab before retrying." }));
  return true;
});

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
      !["availability", "connect", "fill", "autofill", "autofill-answer", "autofill-focus", "autofill-options", "autofill-suggest", "autofill-drafts", "autofill-undo", "review", "resume", "undo", "open-popup", "extension-help", "chrome-extensions", "open-profile"].includes(
        message?.type,
      ))
  )
    return false;
  // Fixed recovery destinations must remain reachable from a stale page script.
  const readOnly = ["version", "status", "availability", "detection-updated", "extension-help", "chrome-extensions", "open-profile"].includes(
    message?.type,
  );
  if (!readOnly && message.buildId !== BUILD_ID) {
    respond({ error: popup ? "Reopen the extension to finish updating. Nothing was changed." : "This page has an older Autofill version. Refresh the application page; if the message persists, reload the extension in Chrome.", recovery: recovery({ code: "PAGE_OUTDATED" }, message?.type), buildId: BUILD_ID });
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
    .catch((error) => {
      const failure = recovery(error, message?.type || "autofill");
      if (message?.type === "autofill" && autofillProgress?.active) {
        autofillProgress = { ...autofillProgress, active: false,
          fields: stoppedFields(autofillProgress.fields), recovery: failure, connected: !error.reconnect,
          message: failure.message };
        void chrome.tabs.sendMessage(autofillProgress.tabId, autofillProgress, { documentId: autofillProgress.documentId }).catch(() => {});
        void chrome.runtime.sendMessage(autofillProgress).catch(() => {});
      }
      respond({
        error: failure.message,
        recovery: failure,
        ...(message?.type === "autofill" ? { fields: autofillProgress?.fields } : {}),
        reconnect: error.reconnect === true,
        buildId: BUILD_ID,
      });
    })
    .finally(() => {
      if (!readOnly) working = null;
    });
  return true;
});
chrome.tabs.onRemoved.addListener(
  (tabId) => void chrome.storage.session.remove([`application:${tabId}`, `autofill:${tabId}`, `submission:preview:${tabId}`, `submission:result:${tabId}`]),
);
