"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { beginProfileReview } from "@/app/onboarding/actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onboardingJourney, trackOnboarding } from "@/lib/onboarding-events";
import { EXTENSION_STORE_URL, SETUP_PROTOCOL, setupNextAction, type SetupBrowserState, type SetupCapabilities } from "@/lib/extension-setup";

type Reply = { protocol?: number; version?: string; nonce?: string; connected?: boolean; error?: string; returned?: boolean };
type ChromeRuntime = { sendMessage: (id: string, message: unknown, callback: (reply?: Reply) => void) => void; lastError?: { message?: string } };
const runtime = () => (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
function message(id: string, value: object, timeout = 8000): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The extension did not respond. Open it from Chrome's toolbar and check again.")), timeout);
    try {
      runtime()!.sendMessage(id, value, reply => {
        clearTimeout(timer);
        if (runtime()?.lastError || !reply) reject(new Error("The extension did not respond."));
        else if (reply.error) reject(new Error(reply.error));
        else resolve(reply);
      });
    } catch { clearTimeout(timer); reject(new Error("Browser detection is unavailable. Open the extension from Chrome's toolbar.")); }
  });
}
async function api(body: object) {
  const response = await fetch("/api/extension/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, journey: onboardingJourney("extension") }), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not verify this connection.");
  return result;
}
const LABELS: Record<SetupBrowserState, string> = {
  checking: "Checking this browser", unsupported: "Extension needs desktop Chrome", unavailable: "Connection could not be verified",
  "not-detected": "Extension not detected in this browser", outdated: "Extension update needed", disconnected: "Account not connected",
  mismatch: "Extension connected to another account", verified: "Connected to this account",
};

export function ExtensionSetup({ accountId, email, context, extensionIds, initialCapabilities }: {
  accountId: string | null; email: string | null; context: string; extensionIds: string[]; initialCapabilities: SetupCapabilities | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<SetupBrowserState>("checking");
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; version: string }[]>([]);
  const bridge = useRef<{ id: string; nonce: string } | null>(null);
  const generation = useRef(0);
  const destination = `/extension/setup${context ? `?context=${context}` : ""}`;
  const authQuery = `callbackUrl=${encodeURIComponent(destination)}`;
  const action = setupNextAction(state, Boolean(email), capabilities?.contact ?? false);
  const hadBlocker = useRef(false);
  useEffect(() => { trackOnboarding("setup_opened", "extension"); }, []);
  useEffect(() => {
    if (["unavailable", "outdated", "mismatch"].includes(state)) { hadBlocker.current = true; trackOnboarding("recovery_shown", "extension"); }
    if (state === "verified" && hadBlocker.current) { hadBlocker.current = false; trackOnboarding("recovery_completed", "extension"); }
  }, [state]);

  const check = useCallback(async (selectedId?: string, background = false) => {
    const current = ++generation.current;
    setState("checking"); if (!background) setError(""); bridge.current = null;
    if (!/Chrome\//.test(navigator.userAgent) || /Android|iPhone|iPad|Mobile/.test(navigator.userAgent)) { setState("unsupported"); return; }
    if (!runtime()?.sendMessage) { setState("unavailable"); return; }
    try {
      const found: { id: string; reply: Reply }[] = [];
      for (const id of selectedId ? [selectedId] : extensionIds) {
        try { const reply = await message(id, { action: "setup-ping" }, 1800); found.push({ id, reply }); } catch { /* A probe is not a connection proof. */ }
      }
      if (generation.current !== current) return;
      if (!selectedId) setCandidates(found.map(({ id, reply }) => ({ id, version: reply.version ?? "unknown" })));
      if (!found.length) { setState("not-detected"); return; }
      const chosen = found[0];
      if (chosen.reply.protocol !== SETUP_PROTOCOL || !chosen.reply.nonce) { setState("outdated"); return; }
      const target = { id: chosen.id, nonce: chosen.reply.nonce }; bridge.current = target;
      if (!email) { setState("disconnected"); return; }
      const proof = await api({ action: "challenge", clientId: target.id, accountId });
      const reply = await message(target.id, { action: "setup-check", nonce: target.nonce, challenge: proof.challenge });
      if (generation.current !== current) return;
      if (!reply.connected) { setState("disconnected"); return; }
      const result = await api({ action: "result", challenge: proof.challenge, accountId });
      if (generation.current !== current) return;
      setState(result.state); setCapabilities(result.capabilities);
      if (result.state === "verified") setError("");
    } catch (failure) {
      if (generation.current !== current) return;
      setState("unavailable"); setError(failure instanceof Error ? failure.message : "Check the connection again.");
    }
  }, [email, accountId, extensionIds]);

  useEffect(() => {
    const counter = generation;
    const timer = window.setTimeout(() => { void check(); }, 0);
    return () => { window.clearTimeout(timer); counter.current++; };
  }, [check]);
  useEffect(() => {
    const resume = () => { if (!busy) void check(bridge.current?.id, true); };
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [busy, check]);

  async function connect() {
    if (!bridge.current || busy) return;
    setBusy(true); setError("");
    try {
      await message(bridge.current.id, { action: "setup-connect", nonce: bridge.current.nonce }, 310_000);
      await check(bridge.current.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed. Your saved details are safe."); }
    finally { setBusy(false); }
  }
  async function returnToApplication() {
    const target = bridge.current;
    if (!target || busy) return;
    setBusy(true); setError("");
    try {
      const proof = await api({ action: "challenge", clientId: target.id, accountId });
      await message(target.id, { action: "setup-check", nonce: target.nonce, challenge: proof.challenge });
      const verified = await api({ action: "result", challenge: proof.challenge, accountId });
      if (verified.state !== "verified") { setState(verified.state); return; }
      const returned = await message(target.id, { action: "setup-return", nonce: target.nonce, context });
      if (!returned.returned) throw new Error("Reconnect the extension before continuing.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Open your application and use the toolbar."); }
    finally { setBusy(false); }
  }

  async function reviewProfile() {
    setBusy(true); setError("");
    try { await beginProfileReview(); router.push(`/onboarding?from=${encodeURIComponent(destination)}`); }
    catch { setError("Could not open your profile review. Sign in again and retry."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8">
    <h1 className="text-2xl font-semibold">Set up ApplyOverflow for job applications</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Keep your profile and resumes in ApplyOverflow. Use the Chrome extension to fill available details on employer application forms. You review before submitting.</p>
    <ol className="mt-7 grid grid-cols-3 gap-3 border-b pb-5 text-sm" aria-label="Extension setup progress">
      {[{ label: "Account", done: !!email }, { label: "Your details", done: !!capabilities?.contact }, { label: "Connect", done: state === "verified" }].map((item, index) =>
        <li key={item.label} className="flex items-center gap-2">{item.done ? <Check className="size-4 shrink-0 text-emerald-600" aria-label="Complete" /> : <span>{index + 1}</span>}{item.label}</li>)}
    </ol>
    <dl className="divide-y text-sm">
      <div className="flex flex-wrap justify-between gap-2 py-4"><dt>Account</dt><dd className="break-all">{email ?? "Sign in to save your profile"}</dd></div>
      <div className="flex flex-wrap justify-between gap-2 py-4"><dt>This browser</dt><dd role="status" aria-live="polite">{LABELS[state]}</dd></div>
      {capabilities && <>
        <div className="flex flex-wrap justify-between gap-2 py-4"><dt>Profile</dt><dd>{capabilities.contact ? "Basic contact autofill available" : "Review your contact details"}{capabilities.pendingReview && <p className="mt-1 text-muted-foreground">Imported changes await review</p>}</dd></div>
        <div className="flex flex-wrap justify-between gap-2 py-4"><dt>Resume</dt><dd>{({ none: "No primary resume selected", ineligible: "Attachment needs PDF/DOCX up to 5 MB", "sharing-off": "Saved; sharing is off", enabled: "Default resume sharing enabled" })[capabilities.resume]}</dd></div>
      </>}
    </dl>
    {candidates.length > 1 && <label className="my-4 block text-sm">Extension package<select className="mt-2 block h-10 w-full rounded-lg border bg-background px-3" disabled={busy} onChange={event => void check(event.target.value)}>
      {candidates.map(item => <option key={item.id} value={item.id}>{item.id} ({item.version})</option>)}</select></label>}
    {error && <p role="alert" className="my-4 text-sm text-destructive">{error}{/sign in|session expired|authentication/i.test(error) && <> <Link href={`/sign-in?${authQuery}`} className="underline">Sign in again</Link></>}</p>}
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {action === "sign-in" && <Button render={<Link href={`/sign-up?${authQuery}`} />}>Set up autofill<ArrowRight /></Button>}
      {action === "profile" && <Button disabled={busy} onClick={() => void reviewProfile()}>Review your details<ArrowRight /></Button>}
      {action === "connect" && <Button disabled={busy} onClick={() => void connect()}>{busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}{state === "mismatch" ? "Review account connection" : "Connect extension"}</Button>}
      {action === "continue" && (context ? <Button disabled={busy} onClick={() => void returnToApplication()}>Return to application<ArrowRight /></Button> : <Button render={<Link href="/jobs" />}>Find jobs<ArrowRight /></Button>)}
      {action === "jobs" && <Button render={<Link href="/jobs" />}>Browse jobs<ArrowRight /></Button>}
      {(action === "install" || action === "update") && <Button render={<a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" />}>{action === "install" ? "Get the Chrome extension" : "Open extension listing"}<ArrowRight /></Button>}
      {action === "retry" && <Button disabled={busy} onClick={() => void check()}><RefreshCw />Check again</Button>}
      {action === "wait" && <Button disabled><LoaderCircle className="animate-spin" />Checking</Button>}
      {!email && <Link className="text-sm underline" href={`/sign-in?${authQuery}`}>Sign in</Link>}
      {action !== "jobs" && action !== "continue" && <Link href="/jobs" className="text-sm underline">Browse jobs</Link>}
    </div>
    {state === "verified" && <p className="mt-5 text-sm text-muted-foreground">Open ApplyOverflow from Chrome&apos;s extensions menu. Select Autofill, then review the fields on the form. Pin it there for easier access.</p>}
    {(state === "not-detected" || state === "outdated") && <p className="mt-5 text-sm text-muted-foreground">Already installed? Open ApplyOverflow from the Chrome toolbar, then <button className="underline" onClick={() => void check()}>check again</button>.</p>}
    {email && <div className="mt-7 flex flex-wrap gap-4 border-t pt-5 text-sm">
      <Link href={capabilities?.pendingReview ? `/onboarding?from=${encodeURIComponent(destination)}` : "/profile"} className="underline">{capabilities?.pendingReview ? "Review imported details" : "Edit profile and resume sharing"}</Link>
      <Link href="/settings/extension" className="underline">Manage connections</Link>
    </div>}
  </div>;
}
