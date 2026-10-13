"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Save, Send, Settings2, Trash2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { MatchRequirementsForm } from "@/components/profile/match-requirements-form";
import type { getAutoApplyWorkspace } from "@/lib/queries/auto-apply";
import { cn } from "@/lib/utils";

type WorkspaceData = Awaited<ReturnType<typeof getAutoApplyWorkspace>>;
type ReviewField = { id: string; label: string; value: string; type: string; required: boolean; readOnly: boolean; section: string; maxLength: number; options: { value: string; label: string; disabled: boolean }[] };
type Review = { revision: string; fields: ReviewField[]; notice: string; url: string };
type Approval = { ready: boolean; token: string | null; expires: number; blockers: string[]; files: number };
type BridgeReply = { error?: string; protocol?: number; version?: string; message?: string; review?: Review; submissionReview?: Approval; submissionResult?: { outcome: string; message: string }; recovery?: { message: string } };
type BrowserRuntime = { lastError?: { message?: string }; sendMessage: (id: string, message: unknown, callback: (result?: BridgeReply) => void) => void };

function sendToExtension(id: string, message: Record<string, unknown>): Promise<BridgeReply> {
  const runtime = (window as Window & { chrome?: { runtime?: BrowserRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error("Open this workspace in Chrome with the updated ApplyOverflow extension installed."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message.action === "submit" ? "Submission status is unknown. Check the employer confirmation; do not submit again." : "The browser action timed out. Check the employer tab before retrying.")), message.action === "ping" ? 2500 : 240_000);
    runtime.sendMessage(id, message, result => {
      clearTimeout(timer);
      if (runtime.lastError || !result) reject(new Error("The extension is unavailable. Update or reload it, reconnect in Settings, then retry."));
      else if (result.error) reject(new Error(result.error));
      else resolve(result);
    });
  });
}
async function request(action: string, id: string) {
  const response = await fetch("/api/applications/auto-apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update this application.");
  return data;
}

export function AutoApplyWorkspace({ initial }: { initial: WorkspaceData }) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState<"matches" | "queue">("matches");
  const [selected, setSelected] = useState("");
  const [extension, setExtension] = useState("");
  const [connection, setConnection] = useState("Checking extension...");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState<"fill" | "submit" | "remove" | null>(null);
  const [outcome, setOutcome] = useState("");
  const [opened, setOpened] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<string[]>([]);
  const dirtyChanged = useCallback((id: string, dirty: boolean) => {
    setDirtyFields(current => dirty ? current.includes(id) ? current : [...current, id] : current.filter(item => item !== id));
    if (dirty) { setApproval(null); setReviewed(false); }
  }, []);
  const running = useRef(false);
  const handoff = useRef<{ token: string; expires: number; id: string } | null>(null);
  const initialRefresh = useRef<Promise<void> | null>(null);
  const refreshPolls = useRef(0);
  const active = data.queued.find(item => item.id === selected);

  useEffect(() => {
    if (!data.profileReady || !data.stale || data.refreshing) return;
    let live = true;
    initialRefresh.current ??= fetch("/api/jobs/top-picks/refresh", { method: "POST" }).then(response => {
      if (!response.ok) throw new Error();
    });
    void initialRefresh.current.then(async () => {
      const latest = await fetch(`/api/applications/auto-apply?page=${data.page}`, { cache: "no-store" });
      if (!latest.ok) throw new Error();
      const next = await latest.json();
      if (live) setData(next);
    }).catch(() => { if (live) setMessage("Matches could not refresh. You can still continue queued applications."); });
    return () => { live = false; };
  }, [data.profileReady, data.stale, data.refreshing, data.page]);

  useEffect(() => {
    if (!data.refreshing || busy || refreshPolls.current >= 20) return;
    let live = true;
    const timer = setTimeout(() => {
      refreshPolls.current++;
      void fetch(`/api/applications/auto-apply?page=${data.page}`, { cache: "no-store" }).then(async response => {
        if (!response.ok) return;
        const next = await response.json();
        if (live) setData(next);
      }).catch(() => {});
    }, 6000);
    return () => { live = false; clearTimeout(timer); };
  }, [data, busy]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.href === location.href || url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      if (running.current || dirtyFields.length && !window.confirm("Discard your unsaved answer edits? The employer form has not changed.")) {
        event.preventDefault(); event.stopImmediatePropagation();
      } else setDirtyFields([]);
    };
    if (dirtyFields.length || busy) window.addEventListener("beforeunload", protect);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", protect); document.removeEventListener("click", navigate, true); };
  }, [dirtyFields.length, busy]);

  useEffect(() => {
    let live = true;
    void (async () => {
      for (const id of data.extensionIds) {
        try {
          const reply = await sendToExtension(id, { action: "ping" });
          if (reply.protocol === 1 && live) { setExtension(id); setConnection(`Extension ${reply.version} connected`); return; }
        } catch { /* Check other connections on this account. */ }
      }
      if (live) { setExtension(""); setConnection("Updated Chrome extension required"); }
    })();
    return () => { live = false; };
  }, [data.extensionIds]);

  useEffect(() => {
    if (!approval?.ready) return;
    const timer = setTimeout(() => { setApproval(null); setReviewed(false); setConfirm(current => current === "submit" ? null : current); setMessage("Approval expired. Check the form again before submitting."); }, Math.max(0, approval.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [approval]);

  async function reload(page = data.page) {
    const response = await fetch(`/api/applications/auto-apply?page=${page}`, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in to ApplyOverflow to continue." : "Could not refresh the queue. Your current review is unchanged.");
    setData(await response.json());
  }
  async function run(label: string, task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label); setError(""); setMessage("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed. Try again."); }
    finally { running.current = false; setBusy(""); }
  }
  function discardEdits() {
    if (dirtyFields.length && !window.confirm("Discard your unsaved answer edits? The employer form has not changed.")) return false;
    setDirtyFields([]);
    return true;
  }
  function changeView(next: "matches" | "queue") {
    if (next !== view && discardEdits()) setView(next);
  }
  function select(id: string) {
    if (!discardEdits()) return;
    setSelected(id); setReview(null); setApproval(null); setReviewed(false); setOpened(false); setOutcome(""); setError(""); setMessage(""); handoff.current = null;
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (!extension || !active) throw new Error("Connect the updated extension and choose a queued job first.");
    if (dirtyFields.length && ["fill", "snapshot", "open", "check", "submit"].includes(action)) throw new Error("Save or discard your answer edits before continuing.");
    if (action === "open") handoff.current = { ...await request("handoff", active.id), id: active.id };
    if (!handoff.current || handoff.current.id !== active.id || handoff.current.expires <= Date.now()) throw new Error("Workspace connection expired. Reopen the employer tab from here.");
    const result = await sendToExtension(extension, { ...extra, action, token: handoff.current.token });
    if (action === "open") setReview(null);
    if (result.review) setReview(result.review);
    if (result.submissionReview) setApproval(result.submissionReview);
    if (result.message) setMessage(result.message);
    if (result.recovery?.message) setError(result.recovery.message);
    if (result.submissionResult) { setOutcome(result.submissionResult.outcome === "blocked" ? "" : result.submissionResult.outcome); setMessage(result.submissionResult.message); setApproval(null); }
    return result;
  }
  async function queue(jobId: string) {
    await run("Adding to queue", async () => { const result = await request("queue", jobId); await reload(); select(result.id); setView("queue"); setMessage("Added to review queue. Nothing submitted."); });
  }

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Auto Apply views">
        <Button type="button" variant={view === "matches" ? "secondary" : "ghost"} aria-pressed={view === "matches"} disabled={!!busy} onClick={() => changeView("matches")}>Matches</Button>
        <Button type="button" variant={view === "queue" ? "secondary" : "ghost"} aria-pressed={view === "queue"} disabled={!!busy} onClick={() => changeView("queue")}>Prepare & review <span className="tabular-nums">{data.queued.length}</span></Button>
        <Button render={<Link href="/applications?status=APPLIED" />} variant="ghost"><CheckCircle2 className="size-4" />Submitted</Button>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" aria-label="Matching settings" title="Matching settings" onClick={() => setSettings(!settings)}><Settings2 className="size-4" /></Button>
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run("Refreshing matches", async () => {
          const response = await fetch("/api/jobs/top-picks/refresh", { method: "POST" });
          if (!response.ok) throw new Error("Could not request new matches. Try again shortly.");
          refreshPolls.current = 0;
          await reload(); setMessage("Match refresh requested. Your prepared applications are unchanged.");
        })}><RefreshCw className="size-4" />Refresh matches</Button>
      </div>
    </div>
    {settings && <MatchRequirementsForm defaultOpen initial={data.requirements} homeLocation={data.homeLocation} onSaved={() => { refreshPolls.current = 0; return reload(); }} />}
    <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3 text-sm">
      <span className="text-muted-foreground">{connection}</span>
      <div className="flex flex-wrap gap-3 whitespace-nowrap"><Link href="/profile#application-profile" className="text-primary">Profile & resume</Link><Link href="/settings/extension" className="text-primary">Extension settings</Link><button type="button" disabled={!!busy} className="text-primary" onClick={() => void run("Checking connection", () => reload())}>Recheck</button></div>
    </div>
    <div aria-live="polite" aria-atomic="true" className="min-h-6 text-sm">
      {busy ? <span className="flex items-center gap-2"><LoadingSpinner className="size-4" />{busy}...</span> : error ? <p role="alert" className="text-destructive">{error}</p> : message || (data.refreshing ? "Finding new matches. Existing applications remain available." : "")}
    </div>
    {view === "matches" ? <>
      {!data.profileReady && <div className="border-l-2 border-primary py-2 pl-4 text-sm"><p>{data.profileMessage}</p><Link className="mt-2 inline-block text-primary" href="/profile">Complete profile <ArrowRight className="inline size-3" /></Link></div>}
      <ul className="divide-y border-y">
        {data.matches.map(job => <li key={job.jobId} className="grid min-w-0 gap-3 py-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1"><Link href={`/jobs/${job.jobId}`} className="break-words text-base font-semibold hover:underline">{job.title}</Link><p className="text-sm">{job.company} <span className="text-muted-foreground">· {job.location} · {job.workMode.toLowerCase()}</span></p>
            <p className="text-sm text-muted-foreground">{job.reasons.join(" · ")}</p>
            {job.category === "MANUAL_ONLY" && <p className="text-xs text-muted-foreground">{job.automationReason}</p>}
            {job.concerns.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-amber-700 dark:text-amber-300">{job.concerns.length} item{job.concerns.length === 1 ? "" : "s"} to confirm</summary><ul className="mt-2 list-inside list-disc text-muted-foreground">{job.concerns.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
          </div>
          <div className="flex items-center gap-3 md:flex-col md:items-end"><span className="text-xs text-muted-foreground">{job.category === "MANUAL_ONLY" ? "Manual only" : "Form review required"}</span>
            {job.category === "MANUAL_ONLY" ? <Button render={<a href={job.applyUrl} target="_blank" rel="noreferrer" />} variant="outline"><ExternalLink className="size-4" />Employer form</Button> : <Button disabled={!!busy} onClick={() => void queue(job.jobId)}><Plus className="size-4" />Add to review</Button>}
          </div>
        </li>)}
      </ul>
      {!data.matches.length && <p className="py-8 text-sm text-muted-foreground">No new matches on this page. Refresh matches, adjust your requirements, or continue a queued application.</p>}
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!!busy || data.page <= 1} onClick={() => void run("Loading matches", () => reload(data.page - 1))}><ChevronLeft className="size-4" />Previous</Button><span className="text-sm text-muted-foreground">Page {data.page}</span><Button variant="outline" disabled={!!busy || !data.hasNextPage} onClick={() => void run("Loading matches", () => reload(data.page + 1))}>Next<ChevronRight className="size-4" /></Button></div>
    </> : <div className="auto-apply-layout">
      <aside aria-label="Preparation queue" className="min-w-0 lg:border-r lg:pr-4"><ul className="divide-y">{data.queued.map(item => <li key={item.id}><button type="button" disabled={!!busy} aria-pressed={selected === item.id} className={cn("w-full min-w-0 border-l-2 py-3 pl-3 text-left", selected === item.id ? "border-primary bg-muted/50" : "border-transparent")} onClick={() => select(item.id)}><span className="block break-words text-sm font-medium">{item.roleTitle}</span><span className="text-xs text-muted-foreground">{item.company}</span></button></li>)}</ul>{!data.queued.length && <p className="py-6 text-sm text-muted-foreground">No applications queued.</p>}</aside>
      <div className="min-w-0">{!active ? <p className="py-8 text-sm text-muted-foreground">Select an application to prepare and review.</p> : <>
        <header className="flex items-start justify-between gap-3 border-b pb-4"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{active.roleTitle}</h2><p className="text-sm text-muted-foreground">{active.company}</p><Link className="mt-1 inline-block text-xs text-primary" href={`/applications/${active.id}`}>Documents & timeline</Link></div><Button type="button" variant="ghost" title="Remove from review queue" aria-label="Remove from review queue" disabled={!!busy || !!dirtyFields.length || outcome === "unverified"} onClick={() => setConfirm("remove")}><Trash2 className="size-4" /></Button></header>
        <div className="flex flex-wrap gap-2 py-4">
          <Button variant="outline" disabled={!!busy || !extension || outcome === "confirmed" || outcome === "unverified"} onClick={() => void run("Opening employer form", async () => { await command("open"); setOpened(true); setApproval(null); setReviewed(false); })}><ExternalLink className="size-4" />{opened ? "Reconnect employer tab" : "Open employer tab"}</Button>
          <Button disabled={!!busy || !opened || !!outcome} onClick={() => setConfirm("fill")}><WandSparkles className="size-4" />Prepare application</Button>
          <Button variant="ghost" disabled={!!busy || !opened} onClick={() => void run("Reading employer form", async () => { setApproval(null); setReviewed(false); await command("snapshot"); })}><RefreshCw className="size-4" />Refresh review</Button>
          <Button variant="ghost" disabled={!!busy || !opened} onClick={() => void run("Opening employer tab", async () => { await command("focus"); })}>View employer form<ExternalLink className="size-4" /></Button>
        </div>
        {review && <><div className="flex flex-wrap justify-between gap-2 border-y py-3 text-sm"><span>{review.fields.length} fields on this step</span><span className="text-muted-foreground">{review.fields.filter(field => field.required && (!field.value || field.type === "checkbox" && field.value === "No")).length} empty required fields</span></div>
          <div className="divide-y">{review.fields.map(field => <FieldEditor key={`${field.id}:${field.value}`} field={field} dirtyChanged={dirtyChanged} disabled={!!busy || !!outcome} save={value => run("Updating employer field", async () => { setApproval(null); setReviewed(false); await command("edit", { id: field.id, value, revision: review.revision }); })} />)}</div>
          <p className="py-4 text-xs text-muted-foreground">{review.notice}</p></>}
        <div className="space-y-3 border-t py-5">
          <h3 className="text-sm font-semibold">Submission check</h3>
          {dirtyFields.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">{dirtyFields.length} unsaved answer edit(s). Update the fields before checking readiness.</p>}
          {outcome === "confirmed" ? <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300"><CheckCircle2 className="size-4" />Employer confirmation received.</p> : outcome === "unverified" ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Submission attempted; acceptance is unknown. Check the employer tab. Automatic retry is disabled.</p> : <>
            <Button variant="outline" disabled={!!busy || !review} onClick={() => void run("Checking required fields and submission", async () => { setApproval(null); setReviewed(false); await command("check"); })}><CheckCircle2 className="size-4" />Check readiness</Button>
            {approval && !approval.ready && <ul className="space-y-2 text-sm text-amber-700 dark:text-amber-300">{approval.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}
            {approval?.ready && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-1" />I reviewed the employer form, every answer, declarations, and uploaded documents.</label><Button disabled={!!busy || !reviewed} onClick={() => setConfirm("submit")}><Send className="size-4" />Submit this application</Button></>}
          </>}
        </div>
      </>}</div>
    </div>}
    <ConfirmActionDialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }} pending={!!busy}
      title={confirm === "fill" ? "Prepare this application?" : confirm === "submit" ? "Submit this application?" : "Remove from review queue?"}
      description={confirm === "fill" ? `Your saved profile, generated answers and enabled default resume will be shared with ${active?.company}. The employer may save them before submission. Nothing is submitted during preparation.` : confirm === "submit" ? `Send the reviewed application to ${active?.company} for ${active?.roleTitle}? This cannot be undone. One submission will be attempted; an uncertain result will not be retried.` : "The application will return to Wishlist. Its documents and notes are kept."}
      confirmLabel={busy ? "Working..." : confirm === "fill" ? "Prepare with my profile" : confirm === "submit" ? "Approve and submit once" : "Remove from queue"}
      onConfirm={() => void run(confirm === "fill" ? "Filling saved details, work history and answers" : confirm === "submit" ? "Submitting once and verifying employer confirmation" : "Removing from queue", async () => {
        const action = confirm; setConfirm(null);
        if (action === "fill") { setApproval(null); setReviewed(false); await command("fill"); }
        if (action === "submit") {
          try { await command("submit", { approvalToken: approval?.token, confirmed: true, documentsReviewed: reviewed }); }
          catch (cause) { setOutcome("unverified"); setApproval(null); throw cause; }
        }
        if (action === "remove" && active) { await request("remove", active.id); select(""); await reload(); setMessage("Removed from review queue. Kept in Wishlist."); }
      })} />
  </section>;
}

function FieldEditor({ field, disabled, save, dirtyChanged }: { field: ReviewField; disabled: boolean; save: (value: string) => Promise<void>; dirtyChanged: (id: string, dirty: boolean) => void }) {
  const [value, setValue] = useState(field.value);
  useEffect(() => { dirtyChanged(field.id, value !== field.value); }, [field.id, field.value, value, dirtyChanged]);
  useEffect(() => () => dirtyChanged(field.id, false), [field.id, dirtyChanged]);
  const classes = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60";
  return <div className="space-y-2 py-4">
    {field.section && <p className="text-xs text-muted-foreground">{field.section}</p>}
    <label className="block break-words text-sm font-medium" htmlFor={field.id}>{field.label}{field.required && !field.label.includes("*") ? " *" : ""}</label>
    {field.readOnly ? <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{value || "Empty"} <span className="block text-xs">{field.type === "file" ? "Verify upload on employer form" : "Edit on employer form"}</span></p> : <>
      {field.options.length ? <select id={field.id} className={classes} value={value} disabled={disabled} onChange={event => setValue(event.target.value)}>{field.options.map((option, index) => <option key={index} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>
        : ["checkbox", "radio"].includes(field.type) ? <input id={field.id} type={field.type} checked={value === "Yes"} disabled={disabled} onChange={event => setValue(event.target.checked ? "Yes" : "No")} />
        : field.type === "textarea" || value.length > 160 ? <textarea id={field.id} className={classes} value={value} rows={4} maxLength={field.maxLength} disabled={disabled} onChange={event => setValue(event.target.value)} />
        : <input id={field.id} className={classes} type={["email", "url", "tel", "date", "month", "number"].includes(field.type) ? field.type : "text"} value={value} maxLength={field.maxLength} disabled={disabled} onChange={event => setValue(event.target.value)} />}
      {value !== field.value && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => void save(value)}><Save className="size-4" />Update field</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => setValue(field.value)}>Discard edit</Button></div>}
    </>}
  </div>;
}
