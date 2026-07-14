import type { CompanySource } from "@/generated/prisma/client";

type PromotionLifecycleSource = Pick<
  CompanySource,
  "status" | "validationState" | "pollState"
>;

export type PromotionLifecycleDecision = {
  preserveExistingLifecycle: boolean;
  enqueueValidation: boolean;
};

/**
 * A repeated discovery signal is not new evidence about an already-managed
 * source. Preserve its lifecycle so broad discovery sweeps cannot reset a
 * healthy source or repeatedly retry an already-quarantined endpoint.
 */
export function decideSourcePromotionLifecycle(
  existingSource: PromotionLifecycleSource | null
): PromotionLifecycleDecision {
  if (!existingSource) {
    return {
      preserveExistingLifecycle: false,
      enqueueValidation: true,
    };
  }

  const terminalOrBackedOff =
    existingSource.status === "DISABLED" ||
    existingSource.status === "REDISCOVER_REQUIRED" ||
    existingSource.pollState === "QUARANTINED" ||
    existingSource.pollState === "BACKOFF";

  return {
    preserveExistingLifecycle: true,
    enqueueValidation:
      !terminalOrBackedOff && existingSource.validationState !== "VALIDATED",
  };
}
