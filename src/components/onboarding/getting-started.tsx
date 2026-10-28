"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Loader2, RotateCcw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveGettingStarted } from "@/app/onboarding/guide-actions";
import { EXTENSION_STORE_URL } from "@/lib/extension-setup";
import { GUIDE_STEP_COUNT, type GuideSnapshot, type GuideState } from "@/lib/getting-started";

const STEPS = [
  { title: "Review your profile", target: "/profile", href: "/profile#application-profile", action: "Open profile", image: "profile", width: 894, height: 1035,
    description: "Your saved profile supplies the answers. Check your contact details, work history, education and dates. Review imported resume details, then save.",
    note: "Application answers are optional. Add work authorization, availability and other preferences you want to reuse. Share only what you choose." },
  { title: "Choose your resume", target: "/documents", href: "/documents", action: "Add or choose resume", image: "documents", width: 944, height: 259,
    description: "In Documents, choose Add resume. Use a PDF or DOCX up to 5 MB for extension uploads, then choose Make primary from its menu.",
    note: "For automatic attachment, enable 'Include my default resume when I click Autofill' in Profile and save. Otherwise, choose Change resume in the extension. Employers may receive an upload before submission." },
  { title: "Tell us what fits", target: "/profile", href: "/profile#job-preferences", action: "Set job preferences",
    description: "Choose your target roles, locations and preferred working style in Profile. Add relocation and work authorization preferences where relevant.",
    note: "This step is optional. You can browse Jobs now and refine your preferences later; skipping does not invent answers for you." },
  { title: "Install and connect", target: "/settings", href: "/extension/setup", action: "Check my connection", image: "connect", width: 320, height: 329,
    description: "Use Chrome on a computer. Install ApplyOverflow Assistant from the Chrome Web Store and pin it from Chrome's puzzle-piece menu.",
    note: "Open the toolbar icon, choose Connect to ApplyOverflow (or Set up autofill), and approve the same account you use here. Check the email and Connected status. Website sign-in alone does not connect the extension." },
  { title: "Try autofill, then review", target: "/jobs", href: "/jobs", action: "Find a job",
    description: "Open a job's employer application form, then click Autofill in the assistant or Chrome toolbar. Review and edit answers directly on the form.",
    note: "Finish missing answers, consent and CAPTCHA yourself. Check attachments and generated drafts before submitting. Autofill never submits an application." },
] as const;

type Spotlight = { left: number; top: number; width: number; height: number };
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function useSpotlight(open: boolean, target: string) {
  const [rect, setRect] = useState<Spotlight | null>(null);
  useEffect(() => {
    if (!open) return;
    const element = document.querySelector<HTMLElement>(`[data-setup-target="${target}"]`);
    const measure = () => {
      const box = element?.getBoundingClientRect();
      setRect(box && innerWidth >= 1100 && box.width > 0 && box.top >= 8 && box.bottom < innerHeight - 8
        ? { left: box.left, top: box.top, width: box.width, height: box.height } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, target]);
  return rect;
}

function AutofillPractice() {
  const [values, setValues] = useState(["", "", ""]);
  const [filled, setFilled] = useState(false);
  return <section aria-label="Autofill practice" className="space-y-3 border-y border-border py-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Practice form</h3>
      <span className="text-xs text-muted-foreground">Sample data only</span>
    </div>
    <div className="grid gap-2">
      {["Full name", "Email", "City"].map((label, index) => <label className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 text-xs" key={label}>
        {label}<input className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm" aria-label={`Practice ${label.toLowerCase()}`} value={values[index]}
          onChange={(event) => setValues(values.map((value, i) => i === index ? event.target.value : value))} />
      </label>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={() => {
        setValues(values.map((value, i) => value || ["Jordan Lee", "jordan@example.com", "Toronto"][i])); setFilled(true);
      }}><WandSparkles className="size-4" />Try Autofill</Button>
      <Button type="button" variant="ghost" size="icon-sm" title="Reset practice form" aria-label="Reset practice form" onClick={() => { setValues(["", "", ""]); setFilled(false); }}><RotateCcw className="size-4" /></Button>
    </div>
    <p className="text-xs text-muted-foreground" role="status">{filled
      ? "Sample answers filled. Try editing one. Nothing was sent, and this demo does not check your extension."
      : "Try the button, then edit an answer. This stays in your browser and does not use your profile."}</p>
  </section>;
}

export function GettingStarted({ snapshot }: { snapshot: GuideSnapshot }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<GuideState>(snapshot.state);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const welcomed = useRef(false);
  const current = STEPS[state.step];
  const rect = useSpotlight(open, current.target);

  useEffect(() => {
    // Never interrupt extension consent, an application, or the profile wizard.
    if (pathname === "/jobs" && state.status === "new" && !welcomed.current) {
      welcomed.current = true;
      setOpen(true);
    }
  }, [pathname, state.status]);

  async function persist(step: number, status: "deferred" | "complete", after?: () => void) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const result = await saveGettingStarted({ accountId: snapshot.accountId, step, status });
      if (result.error || !result.state) { setError(result.error ?? "Could not save progress. Please try again."); return; }
      setState(result.state);
      after?.();
    } catch {
      setError("Could not save progress. Check your connection and try again.");
    } finally { saving.current = false; setBusy(false); }
  }

  const close = () => void persist(state.step, state.status === "complete" ? "complete" : "deferred", () => setOpen(false));
  return <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (nextOpen) setOpen(true); else close(); }}>
    <Dialog.Trigger disabled={!hydrated} render={<Button variant="ghost" size="sm" aria-label="Getting started" title="Getting started" />}>
      <BookOpen className="size-4" /><span className="hidden sm:inline">Getting started</span>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className={`fixed inset-0 z-50 ${rect ? "" : "bg-black/40"}`} />
      {rect ? <>
        <div data-testid="setup-spotlight" aria-hidden="true" className="pointer-events-none fixed z-50 rounded-lg border-2 border-primary" style={{ ...rect, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.4)" }} />
        <ArrowLeft aria-hidden="true" className="pointer-events-none fixed z-50 size-4 text-white" style={{ left: rect.left + rect.width + 4, top: rect.top + rect.height / 2 - 8 }} />
      </> : null}
      <Dialog.Popup className="fixed top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100%-2rem))] -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none"
        style={{ left: rect ? rect.left + rect.width + 28 : "50%", transform: rect ? undefined : "translateX(-50%)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">Getting started: {state.step + 1} of {GUIDE_STEP_COUNT}</p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={close}>Finish later</Button>
        </div>
        <nav aria-label="Setup steps" className="my-3 flex gap-1.5">
          {STEPS.map((step, index) => <button type="button" key={step.title} aria-label={`Step ${index + 1}: ${step.title}`} aria-current={state.step === index ? "step" : undefined}
            disabled={busy} onClick={() => void persist(index, "deferred")}
            className={`h-2 min-w-0 flex-1 rounded-full outline-offset-4 ${state.step === index ? "bg-primary" : "bg-muted hover:bg-primary/40"}`} />)}
        </nav>
        <Dialog.Title className="text-xl font-semibold">{current.title}</Dialog.Title>
        <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">{current.description}</Dialog.Description>
        <div className="mt-4 space-y-4">
          {"image" in current ? <a href={`/images/autofill-guide/${current.image}.png`} target="_blank" rel="noreferrer" aria-label={`Enlarge example: ${current.title}`} className="block">
            <Image className="h-40 w-full rounded-md border border-border bg-muted/20 object-contain" src={`/images/autofill-guide/${current.image}.png`} width={current.width} height={current.height} alt={`Example ${current.title.toLowerCase()} screen with demo data`} />
            <span className="mt-1 block text-xs text-muted-foreground">Example screen. Select to enlarge.</span>
          </a> : null}
          {state.step === 3 ? <>
            <a className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">Install from Chrome Web Store <ExternalLink className="size-3.5" /></a>
            <p className="text-sm leading-6">To show the assistant automatically, open <strong>Connection &amp; site access</strong> in the extension and choose the access you want. Filling still needs your click. Mobile users can finish this step on a computer.</p>
          </> : null}
          {state.step === 4 ? <AutofillPractice /> : null}
          <p className="text-sm leading-6 text-muted-foreground">{current.note}</p>
          <Button className="w-full" disabled={busy} onClick={() => void persist(state.step, "deferred", () => {
            setOpen(false); router.push(current.href);
          })}>{current.action}<ArrowRight className="size-4" /></Button>
          <p className="text-xs text-muted-foreground">Every step can wait. Reopen Getting started at the top of any app page to continue. Viewing this guide does not mark your setup complete.</p>
          {error ? <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close without saving</Button>
          </div> : null}
        </div>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Link href="/extension/guide" target="_blank" className="text-xs text-primary underline underline-offset-4">Full screenshot guide</Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Previous step" title="Previous step" disabled={busy || state.step === 0} onClick={() => void persist(state.step - 1, "deferred")}><ArrowLeft className="size-4" /></Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void persist(Math.min(state.step + 1, GUIDE_STEP_COUNT - 1), state.step === 4 ? "complete" : "deferred", state.step === 4 ? () => setOpen(false) : undefined)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}{state.step === 4 ? "Finish guide" : "Next / skip"}
            </Button>
          </div>
        </footer>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
