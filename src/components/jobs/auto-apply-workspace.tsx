"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  LoaderCircle,
  Lock,
  Pencil,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";

import { updateAutoApplyContactAction } from "@/app/profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/components/ui/notification-provider";
import { resolveAutoApplyUserStatus } from "@/lib/automation/user-status";
import { cn } from "@/lib/utils";
import type {
  AutoApplyReviewField,
  AutoApplyReviewSummary,
} from "@/lib/automation/types";

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
  githubUrl: string | null;
  portfolioUrl: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
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

type ResultState =
  | { kind: "idle" }
  | { kind: "running"; intent: "review" | "submit" }
  | {
      kind: "success";
      status: string;
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
  const [isSubmitPending, startSubmitTransition] = useTransition();
  const { notify } = useNotifications();

  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(
    defaultResumeId ?? resumes[0]?.id ?? null
  );
  const [coverLetterEnabled, setCoverLetterEnabled] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState("");
  const [review, setReview] = useState<AutoApplyReviewSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({});

  const [editingContact, setEditingContact] = useState(false);
  const [draftPhone, setDraftPhone] = useState(profilePreview.phone ?? "");
  const [draftLocation, setDraftLocation] = useState(profilePreview.location ?? "");
  const [draftLinkedin, setDraftLinkedin] = useState(profilePreview.linkedinUrl ?? "");
  const [draftGithub, setDraftGithub] = useState(profilePreview.githubUrl ?? "");
  const [draftPortfolio, setDraftPortfolio] = useState(profilePreview.portfolioUrl ?? "");
  const [draftWorkAuth, setDraftWorkAuth] = useState(
    profilePreview.workAuthorization ?? ""
  );

  const [contactState, contactAction, contactPending] = useActionState(
    updateAutoApplyContactAction,
    { error: null, success: null }
  );

  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  const hasResume = resumes.length > 0;
  const selectedResume = useMemo(
    () => resumes.find((resume) => resume.id === selectedResumeId) ?? null,
    [resumes, selectedResumeId]
  );

  const unresolvedRequiredFields = useMemo(
    () =>
      review?.fields.filter(
        (field) => field.required && !getFieldAnswerValue(field, fieldAnswers)
      ) ?? [],
    [fieldAnswers, review]
  );
  const userFacingStatus = review
    ? resolveAutoApplyUserStatus(review.status, unresolvedRequiredFields.length)
    : null;
  const needsRecheck =
    Boolean(review) &&
    !review?.canSubmit &&
    unresolvedRequiredFields.length === 0 &&
    review?.status === "NEEDS_EXTRA_ANSWERS";
  const canReview =
    hasResume && selectedResumeId !== null && !isSubmitPending && job.atsSupported;
  const canSubmit =
    Boolean(review) &&
    Boolean(selectedResumeId) &&
    !isSubmitPending &&
    confirmed &&
    Boolean(review?.canSubmit) &&
    unresolvedRequiredFields.length === 0;

  useEffect(() => {
    setDraftPhone(profilePreview.phone ?? "");
    setDraftLocation(profilePreview.location ?? "");
    setDraftLinkedin(profilePreview.linkedinUrl ?? "");
    setDraftGithub(profilePreview.githubUrl ?? "");
    setDraftPortfolio(profilePreview.portfolioUrl ?? "");
    setDraftWorkAuth(profilePreview.workAuthorization ?? "");
  }, [
    profilePreview.phone,
    profilePreview.location,
    profilePreview.linkedinUrl,
    profilePreview.githubUrl,
    profilePreview.portfolioUrl,
    profilePreview.workAuthorization,
  ]);

  useEffect(() => {
    setReview(null);
    setConfirmed(false);
    setFieldAnswers({});
    setResult({ kind: "idle" });
  }, [selectedResumeId, coverLetterEnabled, coverLetterText]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactState]);

  function handleSaveContact() {
    if (contactPending) return;
    const formData = new FormData();
    formData.set("phone", draftPhone);
    formData.set("location", draftLocation);
    formData.set("linkedinUrl", draftLinkedin);
    formData.set("githubUrl", draftGithub);
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
    setDraftGithub(profilePreview.githubUrl ?? "");
    setDraftPortfolio(profilePreview.portfolioUrl ?? "");
    setDraftWorkAuth(profilePreview.workAuthorization ?? "");
  }

  function buildAnswersPayload() {
    const entries = (review?.fields ?? [])
      .map((field) => [field.label, getFieldAnswerValue(field, fieldAnswers)] as const)
      .filter(([, value]) => value.length > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function postAutoApply(intent: "review" | "submit") {
    if (!selectedResumeId) return;
    setResult({ kind: "running", intent });

    startSubmitTransition(async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}/auto-apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent,
            confirmSubmission: intent === "submit" ? confirmed : undefined,
            mode: "fill_and_submit",
            resumeVariantId: selectedResumeId,
            coverLetterContent:
              coverLetterEnabled && coverLetterText.trim().length > 0
                ? coverLetterText.trim()
                : null,
            answers: buildAnswersPayload(),
          }),
        });

        const data = await response.json().catch(() => null);
        if (data?.review) {
          setReview(data.review as AutoApplyReviewSummary);
          setFieldAnswers((current) => {
            const next = { ...current };
            for (const field of (data.review as AutoApplyReviewSummary).fields) {
              next[field.id] = next[field.id] ?? field.value ?? "";
            }
            return next;
          });
        }

        if (!response.ok) {
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              "Apply assistant could not continue safely."
          );
        }

        if (intent === "review") {
          setConfirmed(false);
          setResult({ kind: "idle" });
          return;
        }

        setResult({
          kind: "success",
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
          message: error instanceof Error ? error.message : "Apply assistant failed.",
        });
      }
    });
  }

  if (result.kind === "success") {
    return <SuccessPanel job={job} result={result} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-accent text-primary">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Apply assistant
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            We prepare the form, ask for anything missing, and submit only after your confirmation.
          </p>
        </div>
      </div>

      <StepStrip review={review} result={result} />

      <section className="grouped-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Resume
              <span className="ml-1.5 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Lock className="h-3 w-3" />
                required
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This is shown in review and attached only after confirmation.
            </p>
          </div>
          <Link
            href="/profile"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage
          </Link>
        </div>

        {hasResume ? (
          <div className="mt-3 grid gap-2">
            {resumes.map((resume) => {
              const isSelected = resume.id === selectedResumeId;
              return (
                <label
                  key={resume.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 transition-colors",
                    isSelected
                      ? "border-primary/45 bg-accent"
                      : "border-border/70 bg-card hover:bg-muted"
                  )}
                >
                  <input
                    type="radio"
                    name="auto-apply-resume"
                    value={resume.id}
                    checked={isSelected}
                    onChange={() => setSelectedResumeId(resume.id)}
                    className="mt-1 h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-foreground">{resume.label}</span>
                      {resume.isDefault ? (
                        <span className="text-xs text-muted-foreground">Primary</span>
                      ) : null}
                      {resume.targetRoleFamily ? (
                        <span className="text-xs text-muted-foreground">
                          {resume.targetRoleFamily}
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
          <div className="mt-3 rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
            No resumes on your profile yet.{" "}
            <Link href="/profile" className="underline underline-offset-2 hover:text-foreground">
              Upload one now
            </Link>{" "}
            before using auto apply.
          </div>
        )}
      </section>

      <section className="grouped-panel p-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={coverLetterEnabled}
            onChange={(event) => setCoverLetterEnabled(event.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium text-foreground">Include a cover letter</span>
          <span className="text-xs text-muted-foreground">optional</span>
        </label>
        {coverLetterEnabled ? (
          <textarea
            value={coverLetterText}
            onChange={(event) => setCoverLetterText(event.target.value)}
            placeholder={`Dear ${job.company} team,\n\nI'm excited to apply for the ${job.title} role because...`}
            rows={5}
            className="mt-3 w-full resize-y rounded-[12px] border border-input bg-card p-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
          />
        ) : null}
      </section>

      <section className="grouped-panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Your saved details</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We use these as starting values. You can still edit every answer before submission.
            </p>
          </div>
          {!editingContact ? (
            <Button size="sm" variant="outline" onClick={() => setEditingContact(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
        </div>

        <div className="mt-4">
          {editingContact ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewField label="Full name" source="Profile" value={profilePreview.fullName} />
              <PreviewField label="Email" source="Profile" value={profilePreview.email} />
              <EditableField label="Phone" value={draftPhone} onChange={setDraftPhone} placeholder="(555) 555-5555" type="tel" />
              <EditableField label="Location" value={draftLocation} onChange={setDraftLocation} placeholder="City, State" />
              <EditableField label="Work authorization" value={draftWorkAuth} onChange={setDraftWorkAuth} placeholder="US citizen, Canadian PR, etc." />
              <EditableField label="LinkedIn" value={draftLinkedin} onChange={setDraftLinkedin} placeholder="https://linkedin.com/in/..." type="url" />
              <EditableField label="GitHub" value={draftGithub} onChange={setDraftGithub} placeholder="https://github.com/..." type="url" />
              <EditableField label="Portfolio" value={draftPortfolio} onChange={setDraftPortfolio} placeholder="https://your-site.com" type="url" />
              <div className="col-span-full flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={handleCancelContactEdit} disabled={contactPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveContact} disabled={contactPending}>
                  {contactPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save details
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewField label="Full name" source="Profile" value={profilePreview.fullName} />
              <PreviewField label="Email" source="Profile" value={profilePreview.email} />
              <PreviewField label="Phone" source="Profile" value={profilePreview.phone ?? "Not set"} muted={!profilePreview.phone} />
              <PreviewField label="Location" source="Profile" value={profilePreview.location ?? "Not set"} muted={!profilePreview.location} />
              <PreviewField label="Work authorization" source="Profile" value={profilePreview.workAuthorization ?? "Not set"} muted={!profilePreview.workAuthorization} />
              <PreviewField label="LinkedIn" source="Profile" value={profilePreview.linkedinUrl ?? "Not set"} muted={!profilePreview.linkedinUrl} />
              <PreviewField label="GitHub" source="Profile" value={profilePreview.githubUrl ?? "Not set"} muted={!profilePreview.githubUrl} />
              <PreviewField label="Portfolio" source="Profile" value={profilePreview.portfolioUrl ?? "Not set"} muted={!profilePreview.portfolioUrl} />
              <PreviewField label="Salary target" source="Profile" value={formatSalary(profilePreview)} muted={!profilePreview.salaryMin && !profilePreview.salaryMax} />
              <PreviewField label="Resume selected" source="Resume" value={selectedResume?.label ?? "None selected"} muted={!selectedResume} />
            </div>
          )}
        </div>
      </section>

      {review ? (
        <ReviewPanel
          answers={fieldAnswers}
          job={job}
          onAnswerChange={(fieldId, value) =>
            setFieldAnswers((current) => ({ ...current, [fieldId]: value }))
          }
          profilePreview={profilePreview}
          review={review}
          selectedResume={selectedResume}
          unresolvedRequiredFields={unresolvedRequiredFields}
        />
      ) : null}

      {result.kind === "error" ? (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {result.message}
        </div>
      ) : null}

      {!job.atsSupported ? (
        <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
          We do not yet have an automated filler for this application form. Open the original posting and submit on the employer site.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {job.atsName ? `${job.atsName} form` : "Supported form"} · no submission happens until you review and confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {userFacingStatus?.kind === "manual" ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={job.applyUrl} target="_blank" rel="noreferrer noopener" />}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open employer form
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={review && !needsRecheck ? "outline" : "default"}
            onClick={() => postAutoApply("review")}
            disabled={!canReview}
          >
            {result.kind === "running" && result.intent === "review" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardCheck className="h-3.5 w-3.5" />
            )}
            {review ? (needsRecheck ? "Save answers and re-check" : "Check again") : "Prepare application"}
          </Button>
          {review && userFacingStatus?.kind !== "manual" ? (
            <Button
              size="sm"
              onClick={() => postAutoApply("submit")}
              disabled={!canSubmit}
            >
              {result.kind === "running" && result.intent === "submit" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              Confirm and submit
            </Button>
          ) : null}
        </div>
      </div>

      {review && userFacingStatus?.kind !== "manual" && review.canSubmit ? (
        <label className="flex items-start gap-2 rounded-[14px] border border-border/70 bg-card p-3 text-sm text-foreground">
          <input
            className="mt-1 h-4 w-4"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>
            I reviewed the selected resume, optional cover letter, and every answer shown above. Submit only these values.
          </span>
        </label>
      ) : null}
    </div>
  );
}

function StepStrip({
  review,
  result,
}: {
  review: AutoApplyReviewSummary | null;
  result: ResultState;
}) {
  const missingRequiredCount =
    review?.fields.filter((field) => field.required && !field.value).length ?? 0;
  const steps = [
    { label: "Prepare", active: !review || result.kind === "running" },
    { label: "Complete", active: Boolean(review) && missingRequiredCount > 0 },
    { label: "Review", active: Boolean(review) && missingRequiredCount === 0 },
    { label: "Submit", active: result.kind === "success" },
  ];
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-[14px] border border-border/70 bg-card text-xs">
      {steps.map((step, index) => (
        <div
          className={cn(
            "border-r border-border/60 px-3 py-2 last:border-r-0",
            step.active ? "text-foreground" : "text-muted-foreground"
          )}
          key={step.label}
        >
          <span className="mr-1 text-muted-foreground">{index + 1}</span>
          {step.label}
        </div>
      ))}
    </div>
  );
}

function ReviewPanel({
  answers,
  job,
  onAnswerChange,
  profilePreview,
  review,
  selectedResume,
  unresolvedRequiredFields,
}: {
  answers: Record<string, string>;
  job: AutoApplyJobContext;
  onAnswerChange: (fieldId: string, value: string) => void;
  profilePreview: AutoApplyProfilePreview;
  review: AutoApplyReviewSummary;
  selectedResume: AutoApplyResumeChoice | null;
  unresolvedRequiredFields: AutoApplyReviewField[];
}) {
  const status = resolveAutoApplyUserStatus(
    review.status,
    unresolvedRequiredFields.length
  );
  const groups = groupReviewFields(review.fields);
  const editableFieldCount = review.fields.length;
  const answeredRequiredCount = review.fields.filter(
    (field) => field.required && getFieldAnswerValue(field, answers)
  ).length;

  return (
    <section className={cn("min-w-0 rounded-[18px] border p-4", status.toneClass)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-foreground">{status.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{status.description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {unresolvedRequiredFields.length > 0
              ? `${unresolvedRequiredFields.length} required field${unresolvedRequiredFields.length === 1 ? "" : "s"} need your input.`
              : `${answeredRequiredCount} required field${answeredRequiredCount === 1 ? "" : "s"} ready for review.`}
          </p>
        </div>
        <span className="inline-flex h-7 items-center rounded-full border border-border/70 bg-card px-2.5 text-xs text-foreground">
          {review.atsName ?? "Unknown ATS"}
        </span>
      </div>

      {status.kind === "manual" ? (
        <div className="mt-4 rounded-[14px] border border-border/70 bg-card p-3 text-sm text-muted-foreground">
          <p>{plainBlockerMessage(review)}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            render={<a href={job.applyUrl} target="_blank" rel="noreferrer noopener" />}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open employer form
          </Button>
        </div>
      ) : null}

      <div className="mt-4 min-w-0 overflow-hidden rounded-[14px] border border-border/70 bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {status.kind === "manual" ? "Autofill assistance" : "Application fields"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status.kind === "manual"
                ? "Use these values as a checklist on the employer site. Nothing will be submitted from the app."
                : "Complete missing answers and review the values that would be submitted."}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {editableFieldCount} application field{editableFieldCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 grid gap-4">
          <ReviewSummaryRow label="Job" value={`${job.title} at ${job.company}`} />
          <ReviewSummaryRow label="Resume" value={selectedResume?.label ?? "No resume selected"} />
          {review.fields.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              We could not read editable fields from this employer form. Open the employer form and apply manually.
            </div>
          ) : null}
          {groups.map((group) => (
            <ReviewFieldGroup
              answers={answers}
              group={group}
              job={job}
              key={group.id}
              onAnswerChange={onAnswerChange}
              profilePreview={profilePreview}
            />
          ))}
        </div>
      </div>

      <DebugDetails review={review} />
    </section>
  );
}

type ReviewFieldGroupData = {
  id: string;
  title: string;
  description: string;
  fields: AutoApplyReviewField[];
};

function ReviewFieldGroup({
  answers,
  group,
  job,
  onAnswerChange,
  profilePreview,
}: {
  answers: Record<string, string>;
  group: ReviewFieldGroupData;
  job: AutoApplyJobContext;
  onAnswerChange: (fieldId: string, value: string) => void;
  profilePreview: AutoApplyProfilePreview;
}) {
  if (group.fields.length === 0) return null;

  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-border/70 bg-card p-3">
      <div>
        <p className="text-sm font-medium text-foreground">{group.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
      </div>
      <div className="mt-3 grid gap-3">
        {group.fields.map((field) => (
          <EditableReviewField
            answer={answers[field.id] ?? field.value ?? ""}
            field={field}
            job={job}
            key={field.id}
            onAnswerChange={onAnswerChange}
            profilePreview={profilePreview}
          />
        ))}
      </div>
    </div>
  );
}

function EditableReviewField({
  answer,
  field,
  job,
  onAnswerChange,
  profilePreview,
}: {
  answer: string;
  field: AutoApplyReviewField;
  job: AutoApplyJobContext;
  onAnswerChange: (fieldId: string, value: string) => void;
  profilePreview: AutoApplyProfilePreview;
}) {
  const isMissingRequired = field.required && !answer.trim();
  const isOptionalBlank = !field.required && !answer.trim();
  const controlId = `auto-apply-field-${field.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const options = field.options ?? [];
  const canDraft =
    field.custom &&
    options.length === 0 &&
    field.fieldType !== "file" &&
    field.fieldType !== "checkbox" &&
    field.source !== "Resume";

  return (
    <label className="grid min-w-0 gap-1.5" htmlFor={controlId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{field.label}</span>
        <FieldPill tone={field.required ? "required" : "neutral"}>
          {field.required ? "Required" : "Optional"}
        </FieldPill>
        {field.sensitive ? <FieldPill tone="warning">Review carefully</FieldPill> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {field.source === "Manual input required"
          ? "We could not fill this automatically. Please answer it here."
          : `Filled from ${field.source}. You can edit it for this application.`}
      </p>

      {options.length > 0 ? (
        <select
          className={cn(
            "h-10 w-full min-w-0 rounded-[12px] border bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25",
            isMissingRequired ? "border-amber-500/70" : "border-border/70"
          )}
          id={controlId}
          value={answer}
          onChange={(event) => onAnswerChange(field.id, event.target.value)}
        >
          <option value="">
            {field.required ? "Select an answer" : "Skip this optional question"}
          </option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.fieldType === "textarea" || isLongAnswerField(field) ? (
        <textarea
          className={cn(
            "min-h-24 w-full min-w-0 rounded-[12px] border bg-card px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25",
            isMissingRequired ? "border-amber-500/70" : "border-border/70"
          )}
          id={controlId}
          value={answer}
          onChange={(event) => onAnswerChange(field.id, event.target.value)}
          placeholder={plainPlaceholder(field)}
        />
      ) : (
        <Input
          className={cn("h-9 text-sm", isMissingRequired ? "border-amber-500/70" : "")}
          id={controlId}
          value={answer}
          onChange={(event) => onAnswerChange(field.id, event.target.value)}
          placeholder={plainPlaceholder(field)}
          type={inputTypeForField(field)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-xs", isMissingRequired ? "text-amber-600" : "text-muted-foreground")}>
          {isMissingRequired
            ? "This must be answered before you can submit."
            : isOptionalBlank
              ? "This optional question will not be submitted."
              : "This value will be shown again before submission."}
        </p>
        {canDraft ? (
          <button
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary transition hover:bg-accent"
            onClick={(event) => {
              event.preventDefault();
              onAnswerChange(field.id, buildDraftStarter(field, job, profilePreview));
            }}
            type="button"
          >
            <Sparkles className="h-3 w-3" />
            Generate draft answer
          </button>
        ) : null}
      </div>
    </label>
  );
}

function ReviewSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function FieldPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "required" | "warning";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[10px]",
        tone === "required"
          ? "border-foreground/20 bg-foreground/[0.04] text-foreground"
          : tone === "warning"
            ? "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300"
            : "border-border/70 bg-card text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function DebugDetails({ review }: { review: AutoApplyReviewSummary }) {
  const searchParams = useSearchParams();

  if (searchParams.get("debug") !== "1") {
    return null;
  }

  return (
    <details className="mt-4 rounded-[14px] border border-border/70 bg-card p-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Developer details
      </summary>
      <div className="mt-3 space-y-3 text-xs text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">Internal status</p>
          <p>{review.status}</p>
          <p>{review.notes}</p>
        </div>
        {review.blockers.length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Diagnostics</p>
            <ul className="mt-1 space-y-1">
              {review.blockers.map((blocker, index) => (
                <li key={`${blocker.type}:${index}`}>
                  [{blocker.type}] {blocker.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="font-medium text-foreground">Detected fields</p>
          <ul className="mt-1 space-y-1">
            {review.fields.map((field) => (
              <li key={field.id}>
                {field.label} · {field.required ? "required" : "optional"} ·{" "}
                {field.value ? "filled" : "needs input"} · {field.source}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

function getFieldAnswerValue(
  field: AutoApplyReviewField,
  answers: Record<string, string>
) {
  return (answers[field.id] ?? field.value ?? "").trim();
}

function plainBlockerMessage(review: AutoApplyReviewSummary) {
  const firstBlocker = review.blockers[0];
  if (!firstBlocker) {
    return "We could not verify this employer form safely. Please open the employer form and apply manually.";
  }

  switch (firstBlocker.type) {
    case "captcha":
      return "The employer form includes CAPTCHA or bot protection, so this application must be submitted on the employer site. Use the answers below as a checklist.";
    case "login_required":
      return "The employer form requires a login or manual step. Open the employer form and finish there.";
    case "position_closed":
      return "The employer appears to have closed this posting. Open the employer form only if you want to verify it manually.";
    case "form_changed":
      return "The employer form changed in a way we do not currently support. Open the employer form and apply manually.";
    case "file_upload_failed":
      return "We could not attach the required document safely. Open the employer form and upload your resume manually.";
    case "required_field_unknown":
      return "The form has required questions we cannot verify safely yet. Answer what you can below, then check again or finish on the employer form.";
    case "timeout":
      return "The employer form did not load reliably. Try checking again, or open the employer form directly.";
    case "unknown":
      return "We could not verify this employer form safely. Please open the employer form and apply manually.";
  }
}

function groupReviewFields(fields: AutoApplyReviewField[]): ReviewFieldGroupData[] {
  const groups: ReviewFieldGroupData[] = [
    {
      id: "contact",
      title: "Contact",
      description: "Basic identity and contact details.",
      fields: [],
    },
    {
      id: "documents",
      title: "Documents",
      description: "Resume, CV, cover letter, and required uploads.",
      fields: [],
    },
    {
      id: "links",
      title: "Links",
      description: "LinkedIn, GitHub, portfolio, and website fields.",
      fields: [],
    },
    {
      id: "eligibility",
      title: "Work eligibility",
      description:
        "Authorization, sponsorship, location eligibility, salary, availability, and similar factual questions.",
      fields: [],
    },
    {
      id: "questions",
      title: "Application questions",
      description: "Company-specific or role-specific questions.",
      fields: [],
    },
    {
      id: "voluntary",
      title: "Voluntary demographic questions",
      description:
        "Optional sensitive questions. Leave blank unless you explicitly want to submit an answer.",
      fields: [],
    },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const field of fields) {
    const groupId = getFieldGroupId(field);
    byId.get(groupId)?.fields.push(field);
  }

  return groups.filter((group) => group.fields.length > 0);
}

function getFieldGroupId(field: AutoApplyReviewField) {
  const label = field.label.toLowerCase();
  if (isVoluntaryDemographicField(label)) return "voluntary";
  if (/\bresume\b|\bcv\b|\bcover\s*letter\b|\bupload\b|\bfile\b/.test(label)) {
    return "documents";
  }
  if (/\blinkedin\b|\bgithub\b|\bportfolio\b|\bwebsite\b|\burl\b|\blink\b/.test(label)) {
    return "links";
  }
  if (
    /\bname\b|\bemail\b|\bphone\b|\bmobile\b|\bcurrent\s+location\b|\bcity\b|\baddress\b/.test(
      label
    ) &&
    !/\bwork\s+out\s+of\b|\bwilling\b|\bable\b|\bauthoriz/.test(label)
  ) {
    return "contact";
  }
  if (
    field.sensitive ||
    /\bauthori[sz]|sponsor|visa|eligible|eligibility|relocat|remote|hybrid|onsite|on-site|work\s+out\s+of|salary|compensation|start\s+date|available|availability|over\s+18|age\b|travel\b/.test(
      label
    )
  ) {
    return "eligibility";
  }
  return "questions";
}

function isVoluntaryDemographicField(label: string) {
  return /\bgender\b|\brace\b|\bethnic|\bveteran\b|\bdisabilit/.test(label);
}

function isLongAnswerField(field: AutoApplyReviewField) {
  return (
    field.fieldType === "textarea" ||
    /\bwhy\b|\bdescribe\b|\btell us\b|\bexplain\b|\bexperience with\b|\binterested\b/i.test(
      field.label
    )
  );
}

function plainPlaceholder(field: AutoApplyReviewField) {
  if (field.reason && !/^unknown required question/i.test(field.reason)) {
    return field.reason;
  }
  if (field.required) return "Enter your answer";
  return "Optional";
}

function inputTypeForField(field: AutoApplyReviewField) {
  if (field.fieldType === "email") return "email";
  if (field.fieldType === "phone") return "tel";
  if (/\burl\b|\blinkedin\b|\bgithub\b|\bportfolio\b|\bwebsite\b/i.test(field.label)) {
    return "url";
  }
  return "text";
}

function buildDraftStarter(
  field: AutoApplyReviewField,
  job: AutoApplyJobContext,
  profile: AutoApplyProfilePreview
) {
  const profileSignals = [
    profile.location ? `I am currently based in ${profile.location}` : null,
    profile.workAuthorization ? `my work authorization is ${profile.workAuthorization}` : null,
    profile.linkedinUrl ? `my LinkedIn is ${profile.linkedinUrl}` : null,
  ].filter(Boolean);
  const context = profileSignals.length > 0 ? ` ${profileSignals.join(", ")}.` : "";
  return `Draft for review: I am interested in the ${job.title} role at ${job.company}.${context} Please edit this answer so it is specific, accurate, and only includes experience you are comfortable submitting.`;
}

function SuccessPanel({
  job,
  result,
}: {
  job: AutoApplyJobContext;
  result: Extract<ResultState, { kind: "success" }>;
}) {
  const isSubmitted = result.status === "submitted";
  const isBlocked = result.status === "blocked";
  const isFailed = result.status === "failed";
  const headline = isSubmitted
    ? "Application submitted"
    : isBlocked
      ? "Could not submit from the app"
      : isFailed
        ? "Could not submit from the app"
        : "Application check complete";
  const Icon = isSubmitted ? CheckCircle2 : XCircle;
  const iconColor = isSubmitted
    ? "text-emerald-600 bg-emerald-500/10"
    : isBlocked
      ? "text-amber-600 bg-amber-500/10"
      : "text-destructive bg-destructive/10";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{headline}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isSubmitted
              ? `We submitted your application to ${job.company}.`
              : "The app stopped before submission. Open the employer form and finish manually."}
          </p>
        </div>
      </div>

      <div className="rounded-[16px] border border-border/70 bg-card p-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Metric label="Platform" value={result.atsName ?? "Unknown"} />
          <Metric label="Fields filled" value={String(result.filledFieldCount)} />
          <Metric label="Duration" value={`${(result.durationMs / 1000).toFixed(1)}s`} />
        </dl>
        {result.blockers.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="text-xs font-medium text-foreground">What to do next</p>
            <ul className="mt-1.5 space-y-1">
              {result.blockers.map((blocker, index) => (
                <li key={index} className="text-xs text-amber-700 dark:text-amber-400">
                  {plainResultBlockerMessage(blocker.type)}
                </li>
              ))}
            </ul>
          </div>
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
            render={<a href={job.applyUrl} target="_blank" rel="noreferrer noopener" />}
          >
            Open employer form
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function plainResultBlockerMessage(type: string) {
  switch (type) {
    case "captcha":
      return "The employer form includes bot protection. Please finish on the employer site.";
    case "login_required":
      return "The employer form requires a login or manual step.";
    case "position_closed":
      return "The employer may have closed this posting.";
    case "form_changed":
      return "The employer form changed and needs manual review.";
    case "file_upload_failed":
      return "The resume upload could not be completed safely.";
    case "required_field_unknown":
      return "Some required answers still need to be completed or verified.";
    case "timeout":
      return "The employer form did not load reliably.";
    case "unknown":
      return "The employer form could not be completed safely from the app.";
    default:
      return "The employer form needs manual review.";
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function PreviewField({
  label,
  source,
  value,
  muted = false,
}: {
  label: string;
  source: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {label}
        <span className="ml-1 text-[10px]">· {source}</span>
      </p>
      <p className={cn("mt-0.5 break-words text-sm", muted ? "text-muted-foreground italic" : "text-foreground")}>
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

function formatSalary(profile: AutoApplyProfilePreview) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: profile.salaryCurrency ?? "USD",
    maximumFractionDigits: 0,
  });

  if (profile.salaryMin && profile.salaryMax) {
    return `${formatter.format(profile.salaryMin)} - ${formatter.format(profile.salaryMax)}`;
  }
  if (profile.salaryMin) return `${formatter.format(profile.salaryMin)}+`;
  if (profile.salaryMax) return `Up to ${formatter.format(profile.salaryMax)}`;
  return "Not set";
}
