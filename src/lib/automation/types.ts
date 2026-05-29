import type { Page } from "playwright";

// ─── Automation modes ────────────────────────────────────────────────────────

/**
 * Controls how deep the automation goes for a given run.
 *
 * - `dry_run`          — Navigate to the form, detect fields, map them, screenshot. Fill nothing.
 * - `fill_only`        — Fill fields and upload resume but do NOT click submit. Screenshot the filled form.
 * - `fill_and_submit`  — Fill and submit. Only allowed after explicit user confirmation or an explicit CLI override.
 */
export type AutomationRunMode = "dry_run" | "fill_only" | "fill_and_submit";

// ─── Filler context (passed to each ATS-specific filler) ─────────────────────

export type FillerProfile = {
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  workAuthorization: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  skillsText: string | null;
  experienceText: string | null;
  educationText: string | null;
};

export type FillerResume = {
  label: string;
  /** Absolute path to the resume file on disk, or null if content-only */
  filePath: string | null;
  /** Raw text content for pasting, if no file exists */
  content: string | null;
  /** Cleanup hook for temporary local files materialized from remote storage */
  cleanup?: (() => Promise<void>) | null;
};

export type FillerPackage = {
  coverLetterContent: string | null;
  savedAnswers: Record<string, string>;
  attachedLinks: Record<string, string>;
  whyItMatches: string | null;
};

export type ATSFillerContext = {
  page: Page;
  applyUrl: string;
  jobTitle: string;
  company: string;
  profile: FillerProfile;
  resume: FillerResume;
  applicationPackage: FillerPackage;
  mode: AutomationRunMode;
  /** Directory to save screenshots to */
  screenshotDir: string;
};

// ─── Filler results ─────────────────────────────────────────────────────────

export type FilledField = {
  label: string;
  selector: string;
  value: string;
  required?: boolean;
  fieldType?: AutoApplyDetectedFieldType;
  options?: string[];
  sourcePlatform?: string;
  confidence?: "high" | "medium" | "low";
  sensitive?: boolean;
  custom?: boolean;
  reviewRequired?: boolean;
};

export type UnfillableField = {
  label: string;
  reason: string;
  required: boolean;
  selector?: string;
  fieldType?: AutoApplyDetectedFieldType;
  options?: string[];
  sourcePlatform?: string;
  confidence?: "high" | "medium" | "low";
  sensitive?: boolean;
  custom?: boolean;
  reviewRequired?: boolean;
};

export type AutomationBlocker = {
  type:
    | "captcha"
    | "login_required"
    | "position_closed"
    | "form_changed"
    | "required_field_unknown"
    | "file_upload_failed"
    | "timeout"
    | "unknown";
  detail: string;
};

export type ATSFillerResult = {
  status: "filled" | "submitted" | "failed" | "blocked";
  atsName: string;
  filledFields: FilledField[];
  unfillableFields: UnfillableField[];
  blockers: AutomationBlocker[];
  screenshots: string[];
  submittedAt: Date | null;
  notes: string;
  durationMs: number;
};

// ─── Review/preflight types ────────────────────────────────────────────────

export type AutoApplyReadinessStatus =
  | "AUTO_APPLY_READY"
  | "NEEDS_USER_REVIEW"
  | "NEEDS_EXTRA_ANSWERS"
  | "PARTIAL_AUTOFILL_ONLY"
  | "NOT_AUTO_APPLICABLE"
  | "BLOCKED_OR_UNSUPPORTED";

export type AutoApplyFieldSource =
  | "Profile"
  | "Resume"
  | "Saved answer"
  | "User-entered answer"
  | "Generated cover letter"
  | "Manual input required";

export type AutoApplyDetectedFieldType =
  | "text"
  | "email"
  | "phone"
  | "textarea"
  | "file"
  | "select"
  | "radio"
  | "checkbox"
  | "unknown";

export type AutoApplyReviewField = {
  id: string;
  label: string;
  selector: string;
  value: string | null;
  required: boolean;
  source: AutoApplyFieldSource;
  fieldType?: AutoApplyDetectedFieldType;
  options?: string[];
  sourcePlatform?: string;
  confidence: "high" | "medium" | "low";
  sensitive: boolean;
  custom: boolean;
  reviewRequired: boolean;
  editable: boolean;
  reason: string | null;
};

export type AutoApplyReviewSummary = {
  status: AutoApplyReadinessStatus;
  statusLabel: string;
  statusDescription: string;
  canSubmit: boolean;
  atsName: string | null;
  fields: AutoApplyReviewField[];
  missingRequiredFields: AutoApplyReviewField[];
  blockers: AutomationBlocker[];
  screenshots: string[];
  notes: string;
  durationMs: number;
};

// ─── Filler interface ────────────────────────────────────────────────────────

export type ATSFiller = {
  /** Human-readable ATS name */
  atsName: string;
  /** Regex to match apply URLs this filler can handle */
  urlPattern: RegExp;
  /** Execute the form-fill operation */
  fill(context: ATSFillerContext): Promise<ATSFillerResult>;
};

// ─── Engine-level types ─────────────────────────────────────────────────────

export type AutoApplyCandidate = {
  jobId: string;
  jobTitle: string;
  company: string;
  applyUrl: string;
  submissionCategory: string;
  packageId: string;
  submissionId: string | null;
};

export type AutoApplyRunResult = {
  jobId: string;
  fillerResult: ATSFillerResult | null;
  error: string | null;
};
