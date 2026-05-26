"use client";

import { startTransition, useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  LoaderCircle,
  Lock,
  Pencil,
  XCircle,
} from "lucide-react";

import { updateAutoApplyContactAction } from "@/app/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/components/ui/notification-provider";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AutoApplyResumeChoice = {
  id: string;
  label: string;
  isDefault: boolean;
  targetRoleFamily: string | null;
  filename: string | null;
  updatedAtLabel: string;
};

export type AutoApplyProfilePreview = {
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  workAuthorization: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
};

export type AutoApplyJobContext = {
  id: string;
  title: string;
  company: string;
  applyUrl: string;
  atsSupported: boolean;
  atsName: string | null;
};

export type AutoApplyWorkspaceProps = {
  job: AutoApplyJobContext;
  resumes: AutoApplyResumeChoice[];
  profilePreview: AutoApplyProfilePreview;
  defaultResumeId: string | null;
};

// ─── Component ──────────────────────────────────────────────────────────────

type SubmitMode = "fill_and_submit";

type ResultState =
  | { kind: "idle" }
  | { kind: "running"; mode: SubmitMode }
  | {
      kind: "success";
      mode: SubmitMode;
      status: string; // submitted | filled | blocked
      atsName: string | null;
      filledFieldCount: number;
      unfillableFieldCount: number;
      blockers: Array<{ type: string; detail: string }>;
      durationMs: number;
      submittedAt: string | null;
      applicationId: string | null;
    }
  | { kind: "error"; message: string };

export function AutoApplyWorkspace({
  job,
  resumes,
  profilePreview,
  defaultResumeId,
}: AutoApplyWorkspaceProps) {
  const router = useRouter();
  // Renamed to disambiguate from the React-imported `startTransition` we use
  // below for the inline contact-edit action.
  const [isSubmitPending, startSubmitTransition] = useTransition();
  const { notify } = useNotifications();

  // Resume — required. Default to primary, otherwise first.
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(
    defaultResumeId ?? resumes[0]?.id ?? null
  );

  // Cover letter — optional. Can be auto-generated later; for now just
  // a short free-form field so a user who already has one can paste it.
  const [coverLetterEnabled, setCoverLetterEnabled] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState("");

  // Expandable review section showing what we'll submit.
  const [showReview, setShowReview] = useState(false);

  // Inline editing of the review-section contact fields. The user can fix
  // Phone / Location / LinkedIn / Portfolio / Work auth right here without
  // leaving the auto-apply flow.
  const [editingContact, setEditingContact] = useState(false);
  const [draftPhone, setDraftPhone] = useState(profilePreview.phone ?? "");
  const [draftLocation, setDraftLocation] = useState(profilePreview.location ?? "");
  const [draftLinkedin, setDraftLinkedin] = useState(profilePreview.linkedinUrl ?? "");
  const [draftPortfolio, setDraftPortfolio] = useState(profilePreview.portfolioUrl ?? "");
  const [draftWorkAuth, setDraftWorkAuth] = useState(
    profilePreview.workAuthorization ?? ""
  );

  const [contactState, contactAction, contactPending] = useActionState(
    updateAutoApplyContactAction,
    { error: null, success: null }
  );

  // Reset drafts whenever the server-rendered preview changes (e.g. after
  // router.refresh() following a successful save).
  useEffect(() => {
    setDraftPhone(profilePreview.phone ?? "");
    setDraftLocation(profilePreview.location ?? "");
    setDraftLinkedin(profilePreview.linkedinUrl ?? "");
    setDraftPortfolio(profilePreview.portfolioUrl ?? "");
    setDraftWorkAuth(profilePreview.workAuthorization ?? "");
  }, [
    profilePreview.phone,
    profilePreview.location,
    profilePreview.linkedinUrl,
    profilePreview.portfolioUrl,
    profilePreview.workAuthorization,
  ]);

  // Surface the action result via toast + refresh on success.
  useEffect(() => {
    if (contactState.success) {
      notify({
        title: "Details updated",
        message: contactState.success,
        tone: "success",
      });
      setEditingContact(false);
      router.refresh();
    } else if (contactState.error) {
      notify({
        title: "Couldn't update details",
        message: contactState.error,
        tone: "error",
      });
    }
    // notify identity is stable; depending only on `contactState` ensures
    // one toast per server-action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactState]);

  function handleSaveContact() {
    if (contactPending) return;
    const formData = new FormData();
    formData.set("phone", draftPhone);
    formData.set("location", draftLocation);
    formData.set("linkedinUrl", draftLinkedin);
    formData.set("portfolioUrl", draftPortfolio);
    formData.set("workAuthorization", draftWorkAuth);
    startTransition(() => {
      contactAction(formData);
    });
  }

  function handleCancelContactEdit() {
    setEditingContact(false);
    setDraftPhone(profilePreview.phone ?? "");
    setDraftLocation(profilePreview.location ?? "");
    setDraftLinkedin(profilePreview.linkedinUrl ?? "");
    setDraftPortfolio(profilePreview.portfolioUrl ?? "");
    setDraftWorkAuth(profilePreview.workAuthorization ?? "");
  }

  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  const hasResume = resumes.length > 0;
  const canSubmit = hasResume && selectedResumeId !== null && !isSubmitPending;

  const selectedResume = useMemo(
    () => resumes.find((resume) => resume.id === selectedResumeId) ?? null,
    [resumes, selectedResumeId]
  );

  function submit(mode: SubmitMode) {
    if (!canSubmit || !selectedResumeId) return;
    setResult({ kind: "running", mode });

    startSubmitTransition(async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/auto-apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            resumeVariantId: selectedResumeId,
            coverLetterContent:
              coverLetterEnabled && coverLetterText.trim().length > 0
                ? coverLetterText.trim()
                : null,
          }),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              "Auto-apply failed. Please try again."
          );
        }

        setResult({
          kind: "success",
          mode,
          status: String(data?.status ?? "unknown"),
          atsName: data?.atsName ?? null,
          filledFieldCount: Number(data?.filledFieldCount ?? 0),
          unfillableFieldCount: Number(data?.unfillableFieldCount ?? 0),
          blockers: Array.isArray(data?.blockers) ? data.blockers : [],
          durationMs: Number(data?.durationMs ?? 0),
          submittedAt: data?.submittedAt ?? null,
          applicationId: typeof data?.applicationId === "string" ? data.applicationId : null,
        });
        router.refresh();
      } catch (error) {
        setResult({
          kind: "error",
          message: error instanceof Error ? error.message : "Auto-apply failed.",
        });
      }
    });
  }

  // ── Post-submission state view ───────────────────────────────────
  if (result.kind === "success") {
    return <SuccessPanel job={job} result={result} />;
  }

  // ── Form view ───────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Auto-apply to this job
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            We&apos;ll fill the application form for {job.company} using your profile
            and submit it for you.
          </p>
        </div>
      </div>

      {/* Resume picker — always required */}
      <section className="rounded-xl border border-border/70 bg-background/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Resume
              <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Lock className="h-3 w-3" />
                required
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We&apos;ll attach this file to the application.
            </p>
          </div>
          <Link
            href="/profile"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage resumes
          </Link>
        </div>

        {hasResume ? (
          <div className="mt-3 space-y-2">
            {resumes.map((resume) => {
              const isSelected = resume.id === selectedResumeId;
              return (
                <label
                  key={resume.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    isSelected
                      ? "border-emerald-500/50 bg-emerald-500/[0.04]"
                      : "border-border/70 bg-background/40 hover:border-border"
                  )}
                >
                  <input
                    type="radio"
                    name="auto-apply-resume"
                    value={resume.id}
                    checked={isSelected}
                    onChange={() => setSelectedResumeId(resume.id)}
                    className="mt-1 h-4 w-4 accent-emerald-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {resume.label}
                      </span>
                      {resume.isDefault ? (
                        <span className="text-xs text-emerald-600">Primary</span>
                      ) : null}
                      {resume.targetRoleFamily ? (
                        <span className="text-xs text-muted-foreground">
                          · {resume.targetRoleFamily}
                        </span>
                      ) : null}
                    </div>
                    {resume.filename ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        {resume.filename}
                        <span className="mx-1.5 text-border">·</span>
                        updated {resume.updatedAtLabel}
                      </p>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No resumes on your profile yet.{" "}
            <Link
              href="/profile"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Upload one now
            </Link>{" "}
            to auto-apply.
          </div>
        )}
      </section>

      {/* Optional cover letter */}
      <section className="rounded-xl border border-border/70 bg-background/60 p-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={coverLetterEnabled}
            onChange={(event) => setCoverLetterEnabled(event.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          <span className="text-sm font-medium text-foreground">
            Include a cover letter
          </span>
          <span className="text-xs text-muted-foreground">· optional</span>
        </label>
        {coverLetterEnabled ? (
          <textarea
            value={coverLetterText}
            onChange={(event) => setCoverLetterText(event.target.value)}
            placeholder={`Dear ${job.company} team,\n\nI'm excited to apply for the ${job.title} role because...`}
            rows={6}
            className="mt-3 w-full resize-y rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground outline-none focus:border-emerald-500/50"
          />
        ) : null}
      </section>

      {/* Expandable review */}
      <section className="rounded-xl border border-border/70 bg-background/60">
        <button
          type="button"
          onClick={() => setShowReview((prev) => !prev)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div>
            <p className="text-sm font-medium text-foreground">
              Review what we&apos;ll submit
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pulled from your profile. We&apos;ll fill the rest of the form from here.
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              showReview && "rotate-180"
            )}
          />
        </button>
        {showReview ? (
          <div className="border-t border-border/60 p-4">
            {editingContact ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <PreviewField label="Full name" value={profilePreview.fullName} />
                <PreviewField label="Email" value={profilePreview.email} />
                <EditableField
                  label="Phone"
                  value={draftPhone}
                  onChange={setDraftPhone}
                  placeholder="(555) 555-5555"
                  type="tel"
                />
                <EditableField
                  label="Location"
                  value={draftLocation}
                  onChange={setDraftLocation}
                  placeholder="City, State"
                />
                <EditableField
                  label="Work authorization"
                  value={draftWorkAuth}
                  onChange={setDraftWorkAuth}
                  placeholder="e.g. US Citizen / H1B"
                />
                <EditableField
                  label="LinkedIn"
                  value={draftLinkedin}
                  onChange={setDraftLinkedin}
                  placeholder="https://linkedin.com/in/…"
                  type="url"
                />
                <EditableField
                  label="Portfolio"
                  value={draftPortfolio}
                  onChange={setDraftPortfolio}
                  placeholder="https://your-site.com"
                  type="url"
                />
                <PreviewField
                  label="Resume attached"
                  value={selectedResume?.label ?? "None selected"}
                  muted={!selectedResume}
                />
                <div className="col-span-full flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelContactEdit}
                    disabled={contactPending}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveContact} disabled={contactPending}>
                    {contactPending ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Save details
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreviewField label="Full name" value={profilePreview.fullName} />
                  <PreviewField label="Email" value={profilePreview.email} />
                  <PreviewField
                    label="Phone"
                    value={profilePreview.phone ?? "Not set"}
                    muted={!profilePreview.phone}
                  />
                  <PreviewField
                    label="Location"
                    value={profilePreview.location ?? "Not set"}
                    muted={!profilePreview.location}
                  />
                  <PreviewField
                    label="Work authorization"
                    value={profilePreview.workAuthorization ?? "Not set"}
                    muted={!profilePreview.workAuthorization}
                  />
                  <PreviewField
                    label="LinkedIn"
                    value={profilePreview.linkedinUrl ?? "Not set"}
                    muted={!profilePreview.linkedinUrl}
                  />
                  <PreviewField
                    label="Portfolio"
                    value={profilePreview.portfolioUrl ?? "Not set"}
                    muted={!profilePreview.portfolioUrl}
                  />
                  <PreviewField
                    label="Resume attached"
                    value={selectedResume?.label ?? "None selected"}
                    muted={!selectedResume}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
                  <span>
                    Any additional screening questions on the form will be filled
                    from your profile where possible.
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingContact(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    <Pencil className="h-3 w-3" />
	                    Edit details
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      {/* Error state */}
      {result.kind === "error" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {result.message}
        </div>
      ) : null}

      {/* Not ATS-supported warning */}
      {!job.atsSupported ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
          We don&apos;t yet have an automated filler for this application form. Open
          the original posting and submit via the employer&apos;s site.
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {job.atsName
            ? `This form is powered by ${job.atsName}.`
            : "We'll detect the application form when you submit."}
          {" "}Only supported forms are submitted automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => submit("fill_and_submit")}
            disabled={!canSubmit || !job.atsSupported}
          >
            {result.kind === "running" && result.mode === "fill_and_submit" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            Submit application
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Success panel ──────────────────────────────────────────────────────────

function SuccessPanel({
  job,
  result,
}: {
  job: AutoApplyJobContext;
  result: Extract<ResultState, { kind: "success" }>;
}) {
  const isSubmitted = result.status === "submitted";
  const isFilled = result.status === "filled";
  const isBlocked = result.status === "blocked";
  const isFailed = result.status === "failed";

  const headline = isSubmitted
    ? "Application submitted"
    : isFilled
      ? "Form filled — review & submit"
      : isBlocked
        ? "Application paused"
        : isFailed
          ? "Auto-apply failed"
          : "Auto-apply complete";

  const Icon = isSubmitted || isFilled ? CheckCircle2 : XCircle;
  const iconColor =
    isSubmitted || isFilled
      ? "text-emerald-600 bg-emerald-500/10"
      : isBlocked
        ? "text-amber-600 bg-amber-500/10"
        : "text-destructive bg-destructive/10";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconColor
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {headline}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isSubmitted
              ? `We submitted your application to ${job.company}. You'll see it in Applications.`
              : isFilled
                ? `We filled the form for ${job.company}. Open it, review, and click submit yourself.`
                : isBlocked
                  ? "The form needed information we couldn't supply automatically. Open it and finish the remaining fields."
                  : "Something prevented the automation from finishing."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-background/60 p-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Platform</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              {result.atsName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fields filled</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              {result.filledFieldCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Duration</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              {(result.durationMs / 1000).toFixed(1)}s
            </dd>
          </div>
        </dl>
        {result.blockers.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="text-xs font-medium text-foreground">Items needing review</p>
            <ul className="mt-1.5 space-y-1">
              {result.blockers.map((blocker, index) => (
                <li key={index} className="text-xs text-amber-700 dark:text-amber-400">
                  [{blocker.type}] {blocker.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.unfillableFieldCount > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {result.unfillableFieldCount} field
            {result.unfillableFieldCount === 1 ? "" : "s"} couldn&apos;t be filled
            automatically.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" render={<Link href={`/jobs/${job.id}`} />}>
          Back to job
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<Link href={result.applicationId ? `/applications/${result.applicationId}` : "/applications"} />}
        >
          View applications
        </Button>
        {!isSubmitted ? (
          <Button
            size="sm"
            variant="ghost"
            render={
              <a href={job.applyUrl} target="_blank" rel="noreferrer noopener" />
            }
          >
            Open form on employer&apos;s site
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function PreviewField({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 break-words text-sm",
          muted ? "text-muted-foreground italic" : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="mt-1 h-9 text-sm"
      />
    </div>
  );
}
