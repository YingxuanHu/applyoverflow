"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { saveSetup } from "@/app/onboarding/actions";
import { onboardingJourney, trackOnboarding } from "@/lib/onboarding-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandLogo } from "@/components/brand/brand-logo";
import { JobGoalsFields } from "./job-goals-form";
import { HistoryDatesFields } from "./history-dates-fields";
import { SetupConflictReview } from "./setup-conflict-review";
import { historyValidationError, type ProfileHistory } from "@/lib/profile-history";
import {
  makeEmptyEducation,
  makeEmptyExperience,
  makeEmptyProject,
} from "@/lib/profile";
import { supportedResumeAcceptValue } from "@/lib/resume-shared";
import {
  setupProfileSchema,
  isExtensionSetupPath,
  type ReviewScope,
  type JobGoals,
  type OnboardingState,
  type SetupProfile,
} from "@/lib/profile-setup";

const STEPS = ["Resume", "Your details", "Job interests"];
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const ADDRESS_FIELDS = [
  ["streetAddress", "Street address", "address-line1"],
  ["addressLine2", "Apartment or unit", "address-line2"],
  ["city", "City", "address-level2"],
  ["region", "Province or state", "address-level1"],
  ["postalCode", "Postal or ZIP code", "postal-code"],
] as const;

export function ProfileSetup({
  profileId,
  initialState,
  initialProfile,
  initialGoals,
  profileUpdatedAt,
  resumeTitle,
  returnTo,
  profileChanged,
}: {
  profileId: string;
  initialState: OnboardingState;
  initialProfile: SetupProfile;
  initialGoals: JobGoals;
  profileUpdatedAt: string;
  resumeTitle: string | null;
  returnTo: string;
  profileChanged: boolean;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [step, setStep] = useState(isExtensionSetupPath(returnTo) ? Math.min(initialState.step, 1) : initialState.step);
  const [draft, setDraft] = useState(initialState.draft ?? initialProfile);
  const [goals, setGoals] = useState(initialState.goals ?? initialGoals);
  const [resume, setResume] = useState(resumeTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [autosaving, setAutosaving] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewScope[]>(["contact"]);
  const [reconciled, setReconciled] = useState(!profileChanged);
  const extensionIntent = isExtensionSetupPath(returnTo);
  const entry = extensionIntent ? "extension" : "website";
  const revision = useRef(initialState.revision);
  const profileRevision = useRef(initialState.profileUpdatedAt ?? profileUpdatedAt);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastSaved = useRef(JSON.stringify([initialState.draft ?? initialProfile, initialState.goals ?? initialGoals]));
  const currentSnapshot = useRef(JSON.stringify([initialState.draft ?? initialProfile, initialState.goals ?? initialGoals]));
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);

  function checkpoint(intent: "save" | "defer" | "complete" | "confirm" | "goals", nextStep: number, snapshot = draft, interests = goals) {
    const operation = queue.current.catch(() => {}).then(async () => {
      const result = await saveSetup({ intent, protocol: 2, profileId, scopes: reviewed, revision: revision.current,
        journey: onboardingJourney(entry), entry,
        profileUpdatedAt: profileRevision.current, step: nextStep, draft: snapshot, goals: interests });
      if (!("revision" in result)) throw new Error(result.error);
      revision.current = result.revision;
      if ("profileUpdatedAt" in result && result.profileUpdatedAt) profileRevision.current = result.profileUpdatedAt;
      const acknowledged = "draft" in result && result.draft ? result.draft : snapshot;
      lastSaved.current = JSON.stringify([acknowledged, interests]);
      if (intent === "confirm") setDraft(acknowledged);
      return result;
    });
    queue.current = operation;
    return operation;
  }

  useEffect(() => { trackOnboarding("setup_opened", entry); }, [entry]);
  useEffect(() => { currentSnapshot.current = JSON.stringify([draft, goals]); }, [draft, goals]);

  useEffect(() => {
    if (!hydrated || pending || error || !reconciled || JSON.stringify([draft, goals]) === lastSaved.current) return;
    const timer = setTimeout(() => {
      setAutosaving(true);
      void checkpoint("save", step).then(() => {
        if (currentSnapshot.current === lastSaved.current) setSaved("Draft saved. Changes await confirmation.");
      })
        .catch(failure => setError(failure.message || "Could not save your draft. Try again."))
        .finally(() => setAutosaving(false));
    }, 900);
    return () => clearTimeout(timer);
    // checkpoint reads the latest acknowledged revision when its queued save runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, goals, hydrated, pending, error, reconciled, step]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify([draft, goals]) !== lastSaved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, goals]);

  function reviewControl(scope: ReviewScope, label: string) {
    return <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed.includes(scope)}
      onChange={event => setReviewed(values => event.target.checked ? [...new Set([...values, scope])] : values.filter(value => value !== scope))} />
      {label}</label>;
  }
  function editSection(scope: ReviewScope, next: SetupProfile) {
    setReviewed(values => values.filter(value => value !== scope));
    setDraft(next);
  }

  function updateContact(key: keyof SetupProfile["contact"], value: string) {
    if (ADDRESS_FIELDS.some(([field]) => field === key) || ["country", "linkedInUrl", "githubUrl", "portfolioUrl"].includes(key))
      setReviewed(values => values.filter(value => value !== "address"));
    setDraft((current) => ({
      ...current,
      contact: { ...current.contact, [key]: value },
    }));
    setSaved("");
  }

  async function persist(
    intent: "save" | "defer" | "complete" | "confirm" | "goals",
    nextStep = step,
  ) {
    if (busy.current) return;
    if (!reconciled && intent === "confirm") { setError("Review the changed profile before using these details."); return; }
    const historyError = intent === "confirm" && ((reviewed.includes("experiences") && historyValidationError(draft.experiences)) || (reviewed.includes("educations") && historyValidationError(draft.educations)));
    if (historyError) {
      setError(historyError);
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    setSaved("");
    try {
      await checkpoint(intent, nextStep);
      if (["defer", "complete", "goals"].includes(intent) || (intent === "confirm" && extensionIntent)) {
        router.replace(returnTo);
        router.refresh();
      } else {
        setStep(nextStep);
        setSaved(intent === "confirm" ? "Reviewed details saved for autofill. Job interests are optional." : "Draft saved. Changes await confirmation.");
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not save. Your changes are still here; please try again.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function upload(file?: File) {
    if (!file || busy.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a resume smaller than 10 MB.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    trackOnboarding("profile_import_attempted", entry);
    try {
      // Checkpoint edits before parsing so an upload never replaces unsaved setup.
      await checkpoint("save", step);
      const data = new FormData();
      data.set("file", file);
      data.set("reviewOnly", "true");
      data.set("profileId", profileId);
      data.set("setupRevision", String(revision.current));
      const response = await fetch("/api/profile/resumes", {
        method: "POST",
        body: data,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not import this resume.");
      const profile = setupProfileSchema.parse(result.draft);
      revision.current = result.revision;
      setDraft(profile);
      setReviewed(["contact"]);
      lastSaved.current = JSON.stringify([profile, goals]);
      setStep(1);
      setResume(file.name);
      setSaved("Resume imported for review");
      trackOnboarding("profile_import_completed", entry);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (failure) {
      trackOnboarding("profile_import_failed", entry);
      setError(
        failure instanceof Error
          ? failure.message
          : "Upload failed. Try again or enter your details manually.",
      );
    } finally {
      busy.current = false;
      setPending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-10">
      <header className="mb-8 flex items-center justify-between gap-3">
        <BrandLogo iconClassName="size-8" textClassName="text-base" />
        <Button
          variant="ghost"
          size="sm"
          disabled={!hydrated || pending}
          onClick={() => persist("defer")}
        >
          {step === 2 ? "Skip for now" : "Finish later"}
        </Button>
      </header>
      <ol
        aria-label="Profile setup progress"
        className={`mb-8 grid gap-3 ${extensionIntent ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {STEPS.slice(0, extensionIntent ? 2 : 3).map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={`border-t-2 pt-3 text-sm ${step === index ? "border-primary font-medium text-foreground" : "border-border text-muted-foreground"}`}
          >
            <span className="mr-2 inline-flex size-5 items-center justify-center text-xs">
              {index < step ? <Check className="size-4" /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mb-2 text-2xl font-semibold outline-none"
      >
        {step === 0
          ? "Start with your resume"
          : step === 1
            ? "Make these details yours"
            : "What comes next?"}
      </h1>
      <p className="mb-7 text-sm text-muted-foreground">
        {step === 0
          ? "PDF, Word, or text. No resume? Start with the basics."
          : step === 1
            ? "Confirm your contact details now. Review additional imported sections whenever you are ready."
            : "Your interests guide Picks for you. They do not change your application details."}
      </p>
      {profileChanged && !reconciled ? (
        <SetupConflictReview current={initialProfile} draft={draft} onResolve={profile => {
          setDraft(profile); setReviewed(["contact"]); profileRevision.current = profileUpdatedAt; setReconciled(true); setError("");
        }} />
      ) : null}
      <form
        noValidate
        onChange={() => setSaved("")}
        onSubmit={(event) => {
          event.preventDefault();
          void persist(step === 2 ? "goals" : step === 1 ? "confirm" : "save", Math.min(step + 1, 2));
        }}
      >
        <fieldset
          disabled={!hydrated || pending}
          className="min-w-0 space-y-5 disabled:opacity-70"
        >
          {step === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-8 text-center">
              <FileText className="size-9 text-muted-foreground" />
              {resume ? (
                <p className="max-w-full break-words px-4 text-sm">{resume}</p>
              ) : null}
              <input
                ref={fileInput}
                className="sr-only"
                tabIndex={-1}
                aria-label="Resume file"
                type="file"
                accept={supportedResumeAcceptValue}
                onChange={(event) => void upload(event.target.files?.[0])}
              />
              <Button type="button" onClick={() => fileInput.current?.click()}>
                <Upload />
                {resume ? "Choose another resume" : "Upload resume"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => persist("save", 1)}
              >
                {resume ? "Continue with saved details" : "Enter manually"}
                <ArrowRight />
              </Button>
            </div>
          ) : null}
          {step === 1 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name">
                  <Input
                    autoComplete="name"
                    required
                    maxLength={160}
                    value={draft.contact.fullName}
                    onChange={(event) =>
                      updateContact("fullName", event.target.value)
                    }
                  />
                </Field>
                <Field label="Contact email">
                  <Input
                    autoComplete="email"
                    required
                    type="email"
                    maxLength={160}
                    value={draft.contact.email}
                    onChange={(event) =>
                      updateContact("email", event.target.value)
                    }
                  />
                </Field>
                <Field label="Phone (optional)">
                  <Input
                    autoComplete="tel"
                    type="tel"
                    maxLength={80}
                    value={draft.contact.phone}
                    onChange={(event) =>
                      updateContact("phone", event.target.value)
                    }
                  />
                </Field>
                <Field label="Current city or region">
                  <Input
                    maxLength={140}
                    value={draft.contact.location}
                    onChange={(event) =>
                      updateContact("location", event.target.value)
                    }
                  />
                </Field>
                <Field label="Phone country (optional)">
                  <select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={draft.contact.phoneCountry ?? ""}
                    onChange={event => updateContact("phoneCountry", event.target.value)}>
                    <option value="">Not provided</option><option value="CA">Canada (+1)</option><option value="US">United States (+1)</option>
                  </select>
                </Field>
              </div>
              <details className="border-t border-border py-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Address and links{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {ADDRESS_FIELDS.map(([key, label, autoComplete]) => (
                    <Field key={key} label={label}>
                      <Input
                        autoComplete={autoComplete}
                        maxLength={
                          key === "postalCode"
                            ? 30
                            : key === "streetAddress"
                              ? 200
                              : key === "addressLine2"
                                ? 120
                                : 100
                        }
                        value={draft.contact[key] ?? ""}
                        onChange={(event) =>
                          updateContact(key, event.target.value)
                        }
                      />
                    </Field>
                  ))}
                  <Field label="Country">
                    <select
                      autoComplete="country"
                      className="h-10 w-full rounded-lg border border-input bg-background px-3"
                      value={draft.contact.country ?? ""}
                      onChange={(event) =>
                        updateContact("country", event.target.value)
                      }
                    >
                      <option value="">Not provided</option>
                      <option value="CA">Canada</option>
                      <option value="US">United States</option>
                    </select>
                  </Field>
                  {(
                    [
                      ["linkedInUrl", "LinkedIn"],
                      ["portfolioUrl", "Portfolio"],
                      ["githubUrl", "GitHub"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <Input
                        type="url"
                        maxLength={280}
                        value={draft.contact[key]}
                        onChange={(event) =>
                          updateContact(key, event.target.value)
                        }
                      />
                    </Field>
                  ))}
                </div>
                {reviewControl("address", "I reviewed these address and link details")}
              </details>
              <HistorySection
                title="Work experience"
                currentLabel="I currently work here"
                items={draft.experiences}
                fields={[
                  ["title", "Job title"],
                  ["company", "Company"],
                  ["time", "Dates"],
                  ["location", "Location"],
                  ["description", "Experience and achievements"],
                ]}
                onChange={(experiences) => editSection("experiences", { ...draft, experiences })}
                empty={makeEmptyExperience}
                review={reviewControl("experiences", "I reviewed this work experience")}
              />
              <HistorySection
                title="Education"
                currentLabel="I currently study here"
                items={draft.educations}
                fields={[
                  ["school", "School"],
                  ["degree", "Degree or qualification"],
                  ["fieldOfStudy", "Field of study"],
                  ["time", "Dates"],
                  ["location", "Location"],
                  ["description", "Details"],
                ]}
                onChange={(educations) => editSection("educations", { ...draft, educations })}
                empty={makeEmptyEducation}
                review={reviewControl("educations", "I reviewed this education")}
              />
              <HistorySection
                title="Projects"
                items={draft.projects}
                fields={[
                  ["name", "Project name"],
                  ["title", "Role"],
                  ["time", "Dates"],
                  ["location", "Location"],
                  ["description", "Details"],
                ]}
                onChange={(projects) => editSection("projects", { ...draft, projects })}
                empty={makeEmptyProject}
                review={reviewControl("projects", "I reviewed these projects")}
              />
              <details className="border-t border-border py-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Skills and summary
                </summary>
                <div className="mt-4 space-y-4">
                  <Field label="Skills (one per line)">
                    <Textarea
                      value={draft.skills
                        .map((skill) => skill.name)
                        .join("\n")}
                      rows={4}
                      onChange={(event) =>
                        editSection("summary", {
                          ...draft,
                          skills: event.target.value
                            .split("\n")
                            .map((name) => ({ name })),
                        })
                      }
                    />
                  </Field>
                  <Field label="Headline">
                    <Input
                      value={draft.headline}
                      maxLength={200}
                      onChange={(event) =>
                        editSection("summary", { ...draft, headline: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Summary">
                    <Textarea
                      value={draft.summary}
                      maxLength={5000}
                      rows={4}
                      onChange={(event) =>
                        editSection("summary", { ...draft, summary: event.target.value })
                      }
                    />
                  </Field>
                </div>
                {reviewControl("summary", "I reviewed these skills and summary")}
              </details>
            </>
          ) : null}
          {step === 2 ? (
            <JobGoalsFields value={goals} onChange={setGoals} />
          ) : null}
        </fieldset>
        {error ? (
          <p role="alert" className="mt-5 text-sm text-destructive">
            {error}
            {/session expired/i.test(error) && <a className="ml-2 underline" target="_blank" rel="noopener noreferrer" href={`/sign-in?callbackUrl=${encodeURIComponent(`/onboarding?from=${encodeURIComponent(returnTo)}`)}`}>Sign in in a new tab, then retry here</a>}
          </p>
        ) : null}
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div className="flex items-center gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={!hydrated || pending}
                onClick={() => persist("save", step - 1)}
              >
                <ArrowLeft />
                Back
              </Button>
            ) : null}
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground"
            >
              {pending || autosaving ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" />
                  {step === 0 ? "Preparing your profile..." : "Saving..."}
                </span>
              ) : (
                saved
              )}
            </p>
          </div>
          {step > 0 ? (
            <Button type="submit" disabled={!hydrated || pending}>
              {step === 2 ? "Save interests and continue" : "Use reviewed details"}
              <ArrowRight />
            </Button>
          ) : null}
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function HistorySection<T extends ProfileHistory>({
  title,
  items,
  fields,
  onChange,
  empty,
  currentLabel,
  review,
}: {
  title: string;
  items: T[];
  fields: [keyof T & string, string][];
  onChange: (items: T[]) => void;
  empty: () => T;
  currentLabel?: string;
  review?: ReactNode;
}) {
  return (
    <details className="border-t border-border py-4">
      <summary className="cursor-pointer text-sm font-medium">
        {title}
        <span className="ml-2 font-normal text-muted-foreground">
          {items.length
            ? `${items.length} ${items.length === 1 ? "entry" : "entries"}`
            : "Optional"}
        </span>
      </summary>
      <div className="mt-3 divide-y divide-border">
        {items.map((item, index) => (
          <fieldset
            key={index}
            className="grid min-w-0 gap-4 py-4 sm:grid-cols-2"
          >
            <legend className="sr-only">
              {title} {index + 1}
            </legend>
            {fields.map(([key, label]) => (
              <div
                key={key}
                className={key === "description" || (key === "time" && currentLabel) ? "sm:col-span-2" : ""}
              >
                {key === "time" && currentLabel ? (
                  <HistoryDatesFields value={item} currentLabel={currentLabel}
                    onChange={(dates) => onChange(items.map((entry, i) => i === index ? { ...entry, dates: undefined, ...dates } : entry))} />
                ) : (
                <Field label={label}>
                  {key === "description" ? (
                    <Textarea
                      value={String(item[key] ?? "")}
                      maxLength={3000}
                      rows={3}
                      onChange={(event) =>
                        onChange(
                          items.map((entry, i) =>
                            i === index
                              ? { ...entry, [key]: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  ) : (
                    <Input
                      value={String(item[key] ?? "")}
                      maxLength={
                        key === "time"
                          ? 100
                          : key === "school" ||
                              key === "degree" ||
                              key === "name"
                            ? 160
                            : 140
                      }
                      onChange={(event) =>
                        onChange(
                          items.map((entry, i) =>
                            i === index
                              ? { ...entry, [key]: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Trash2 />
              Remove entry {index + 1}
            </Button>
          </fieldset>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={items.length >= 25}
        onClick={() => onChange([...items, empty()])}
      >
        <Plus />
        Add {title.toLowerCase()}
      </Button>
      {review}
    </details>
  );
}
