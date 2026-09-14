export type PreflightCheck = {
  label: string;
  status: "ready" | "review" | "missing";
  detail: string;
  href?: string;
};
type PreflightInput = {
  resume: { label: string; content: string | null; updatedAt: Date } | null;
  packageUpdatedAt: Date | null;
  email: string | null;
  workAuthorization: string | null;
  confirmedAt: Date | null;
  sourceSeenAt: Date | null;
  previousApplicationId: string | null;
  description: string;
  hasCoverLetter: boolean;
};

export function buildApplicationPreflight(
  input: PreflightInput,
  now = new Date(),
): PreflightCheck[] {
  const changedResume = Boolean(
    input.resume &&
      input.packageUpdatedAt &&
      input.resume.updatedAt > input.packageUpdatedAt,
  );
  const checked = input.confirmedAt ?? input.sourceSeenAt;
  const recent = checked && now.getTime() - checked.getTime() <= 86_400_000;
  const coverLetterRequired = input.description
    .split(/[.!?\n]+/)
    .some((sentence) => {
      if (
        /(?:cover letter.{0,35}(?:not required|optional|not necessary)|(?:no|without|do not|don't).{0,30}cover letter)/i.test(
          sentence,
        )
      )
        return false;
      return /(?:cover letter.{0,45}(?:required|must be|mandatory)|(?:must|please|required to).{0,35}(?:include|submit|attach).{0,20}cover letter)/i.test(
        sentence,
      );
    });
  return [
    {
      label: "Resume",
      status: !input.resume ? "missing" : changedResume ? "review" : "ready",
      detail: !input.resume
        ? "Choose a resume before preparing an application."
        : changedResume
          ? `${input.resume.label} changed after this package was prepared. Review and update the package.`
          : input.resume.label,
      href: "/documents",
    },
    {
      label: "Contact email",
      status: input.email ? "ready" : "missing",
      detail: input.email ?? "Add a contact email to your profile.",
      href: "/profile",
    },
    {
      label: "Work authorization",
      status: input.workAuthorization ? "ready" : "review",
      detail: input.workAuthorization
        ? "Saved answer available; confirm it applies to this role."
        : "No saved answer. Check the employer's country and sponsorship requirements.",
      href: "/profile",
    },
    {
      label: "Posting availability",
      status: recent ? "ready" : "review",
      detail: checked
        ? `${input.confirmedAt ? "Confirmed available" : "Seen at source"} ${checked.toISOString().slice(0, 16).replace("T", " ")} UTC. Recheck the original posting before submitting.`
        : "No recent availability confirmation. Check the original posting.",
    },
    {
      label: "Previous application",
      status: input.previousApplicationId ? "review" : "ready",
      detail: input.previousApplicationId
        ? "An application for this job or one of its source URLs is already tracked."
        : "No previous application found for this job or its known source URLs.",
      href: input.previousApplicationId
        ? `/applications/${input.previousApplicationId}`
        : undefined,
    },
    {
      label: "Cover letter",
      status:
        coverLetterRequired && !input.hasCoverLetter ? "missing" : "review",
      detail:
        coverLetterRequired && !input.hasCoverLetter
          ? "The posting asks for a cover letter, but this package has none."
          : "Check the employer's requested documents and any custom questions.",
    },
    {
      label: "Claims and answers",
      status: "review",
      detail:
        "Confirm every qualification, date, metric, and answer against your actual experience. This checklist does not verify their accuracy.",
    },
  ];
}
