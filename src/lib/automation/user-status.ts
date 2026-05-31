import type { AutoApplyReadinessStatus } from "@/lib/automation/types";

export type AutoApplyUserStatusMeta = {
  kind: "ready" | "needs-input" | "manual";
  label: "Auto Apply" | "Needs Info" | "Manual Apply";
  description: string;
  toneClass: string;
};

export function resolveAutoApplyUserStatus(
  status: AutoApplyReadinessStatus,
  unresolvedRequiredCount = 0
): AutoApplyUserStatusMeta {
  switch (status) {
    case "AUTO_APPLY_READY":
      return {
        kind: "ready",
        label: "Auto Apply",
        description:
          "Everything required has a value. Review the answers below, then confirm when you are ready.",
        toneClass: "border-emerald-500/25 bg-emerald-500/[0.04]",
      };
    case "NEEDS_USER_REVIEW":
      return {
        kind: "ready",
        label: "Auto Apply",
        description:
          "This application can be completed in the app, but review custom or sensitive answers before submitting.",
        toneClass: "border-emerald-500/25 bg-emerald-500/[0.04]",
      };
    case "NEEDS_EXTRA_ANSWERS":
    case "PARTIAL_AUTOFILL_ONLY":
      return {
        kind: "needs-input",
        label: "Needs Info",
        description:
          unresolvedRequiredCount > 0
            ? `${unresolvedRequiredCount} required field${unresolvedRequiredCount === 1 ? "" : "s"} need an answer before this can be submitted.`
            : "Answer the required questions below, then check the form again before submitting.",
        toneClass: "border-amber-500/25 bg-amber-500/[0.04]",
      };
    case "NOT_AUTO_APPLICABLE":
    case "BLOCKED_OR_UNSUPPORTED":
      return {
        kind: "manual",
        label: "Manual Apply",
        description:
          "This application cannot be completed in the app yet. Open the employer form and apply there.",
        toneClass: "border-amber-500/25 bg-amber-500/[0.025]",
      };
  }
}

export function getAutoApplyReadinessCopy(
  status: AutoApplyReadinessStatus,
  missingRequiredCount = 0
) {
  const meta = resolveAutoApplyUserStatus(status, missingRequiredCount);
  return {
    statusLabel: meta.label,
    statusDescription: meta.description,
  };
}
