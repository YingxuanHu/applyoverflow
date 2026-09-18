"use client";

import { useRef, useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandLogo } from "@/components/brand/brand-logo";
import { JobGoalsFields } from "./job-goals-form";
import {
  makeEmptyEducation,
  makeEmptyExperience,
  makeEmptyProject,
} from "@/lib/profile";
import { supportedResumeAcceptValue } from "@/lib/resume-shared";
import {
  setupProfileSchema,
  type JobGoals,
  type OnboardingState,
  type SetupProfile,
} from "@/lib/profile-setup";

const STEPS = ["Resume", "Your details", "Job interests"];
const ADDRESS_FIELDS = [
  ["streetAddress", "Street address", "address-line1"],
  ["addressLine2", "Apartment or unit", "address-line2"],
  ["city", "City", "address-level2"],
  ["region", "Province or state", "address-level1"],
  ["postalCode", "Postal or ZIP code", "postal-code"],
] as const;

export function ProfileSetup({
  initialState,
  initialProfile,
  initialGoals,
  profileUpdatedAt,
  resumeTitle,
  returnTo,
  profileChanged,
}: {
  initialState: OnboardingState;
  initialProfile: SetupProfile;
  initialGoals: JobGoals;
  profileUpdatedAt: string;
  resumeTitle: string | null;
  returnTo: string;
  profileChanged: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialState.step);
  const [draft, setDraft] = useState(initialState.draft ?? initialProfile);
  const [goals, setGoals] = useState(initialState.goals ?? initialGoals);
  const [resume, setResume] = useState(resumeTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const revision = useRef(initialState.revision);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);

  function updateContact(key: keyof SetupProfile["contact"], value: string) {
    setDraft((current) => ({
      ...current,
      contact: { ...current.contact, [key]: value },
    }));
    setSaved("");
  }

  async function persist(
    intent: "save" | "defer" | "complete",
    nextStep = step,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setSaved("");
    try {
      const result = await saveSetup({
        intent,
        revision: revision.current,
        profileUpdatedAt,
        step: nextStep,
        draft,
        goals,
      });
      if (!("revision" in result)) {
        setError(result.error);
        return;
      }
      revision.current = result.revision;
      if (intent !== "save") {
        router.replace(returnTo);
        router.refresh();
      } else {
        setStep(nextStep);
        setSaved("Progress saved");
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch {
      setError(
        "Could not save. Your changes are still here; please try again.",
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
    try {
      // Checkpoint edits before parsing so an upload never replaces unsaved setup.
      const checkpoint = await saveSetup({
        intent: "save",
        revision: revision.current,
        profileUpdatedAt,
        step,
        draft,
        goals,
      });
      if (!("revision" in checkpoint)) throw new Error(checkpoint.error);
      revision.current = checkpoint.revision;
      const data = new FormData();
      data.set("file", file);
      data.set("reviewOnly", "true");
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
      setStep(1);
      setResume(file.name);
      setSaved("Resume imported for review");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (failure) {
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
          disabled={pending}
          onClick={() => persist("defer")}
        >
          Finish later
        </Button>
      </header>
      <ol
        aria-label="Profile setup progress"
        className="mb-8 grid grid-cols-3 gap-3"
      >
        {STEPS.map((label, index) => (
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
            ? "Review your contact details and experience before saving them to your profile."
            : "Your interests guide Picks for you. They do not change your application details."}
      </p>
      {profileChanged ? (
        <p
          role="status"
          className="mb-5 border-l-2 border-primary pl-3 text-sm"
        >
          Your profile changed since setup was saved. Your latest profile
          details are shown here for review.
        </p>
      ) : null}
      <form
        onChange={() => setSaved("")}
        onSubmit={(event) => {
          event.preventDefault();
          void persist(step === 2 ? "complete" : "save", Math.min(step + 1, 2));
        }}
      >
        <fieldset
          disabled={pending}
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
              </details>
              <HistorySection
                title="Work experience"
                items={draft.experiences}
                fields={[
                  ["title", "Job title"],
                  ["company", "Company"],
                  ["time", "Dates"],
                  ["location", "Location"],
                  ["description", "Experience and achievements"],
                ]}
                onChange={(experiences) => setDraft({ ...draft, experiences })}
                empty={makeEmptyExperience}
              />
              <HistorySection
                title="Education"
                items={draft.educations}
                fields={[
                  ["school", "School"],
                  ["degree", "Degree or qualification"],
                  ["time", "Dates"],
                  ["location", "Location"],
                  ["description", "Details"],
                ]}
                onChange={(educations) => setDraft({ ...draft, educations })}
                empty={makeEmptyEducation}
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
                onChange={(projects) => setDraft({ ...draft, projects })}
                empty={makeEmptyProject}
              />
              <details className="border-t border-border py-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Skills and summary
                </summary>
                <div className="mt-4 space-y-4">
                  <Field label="Skills (one per line)">
                    <Textarea
                      defaultValue={draft.skills
                        .map((skill) => skill.name)
                        .join("\n")}
                      rows={4}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          skills: event.target.value
                            .split("\n")
                            .map((name) => ({ name: name.trim() }))
                            .filter((skill) => skill.name),
                        })
                      }
                    />
                  </Field>
                  <Field label="Headline">
                    <Input
                      value={draft.headline}
                      maxLength={200}
                      onChange={(event) =>
                        setDraft({ ...draft, headline: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Summary">
                    <Textarea
                      value={draft.summary}
                      maxLength={5000}
                      rows={4}
                      onChange={(event) =>
                        setDraft({ ...draft, summary: event.target.value })
                      }
                    />
                  </Field>
                </div>
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
          </p>
        ) : null}
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div className="flex items-center gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
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
              {pending ? (
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
            <Button type="submit" disabled={pending}>
              {step === 2 ? "Finish setup" : "Confirm details"}
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

function HistorySection<T extends Record<string, string>>({
  title,
  items,
  fields,
  onChange,
  empty,
}: {
  title: string;
  items: T[];
  fields: [keyof T & string, string][];
  onChange: (items: T[]) => void;
  empty: () => T;
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
                className={key === "description" ? "sm:col-span-2" : ""}
              >
                <Field label={label}>
                  {key === "description" ? (
                    <Textarea
                      value={item[key]}
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
                      value={item[key]}
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
    </details>
  );
}
