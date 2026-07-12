export type LifecycleProfileName = "aggressive" | "balanced" | "conservative";

export type LifecycleProfile = {
  name: LifecycleProfileName;
  statusThresholds: {
    liveMinScore: number;
    agingMinScore: number;
    staleMinScore: number;
  };
  confirmationFloorScores: {
    live: number;
    agingWithActiveMappings: number;
    agingWithoutActiveMappings: number;
    staleWithActiveMappings: number;
    staleWithoutActiveMappings: number;
  };
  confirmationWindowsDays: {
    liveFloor: number;
    agingFloor: number;
    staleFloor: number;
  };
  activeMappingRecencyHours: {
    hottest: number;
    warm: number;
    recent: number;
    aging: number;
    stale: number;
    longTail: number;
  };
  confirmationBonusDays: {
    hottest: number;
    warm: number;
    recent: number;
    aging: number;
    stale: number;
  };
  applyUrlCheckIntervalHours: number;
  removalPenaltyCaps: {
    withActiveMappings: number;
    withoutActiveMappings: number;
  };
  strongRemovalEvidenceWindowDays: number;
};

const LIFECYCLE_PROFILES: Record<LifecycleProfileName, LifecycleProfile> = {
  aggressive: {
    name: "aggressive",
    statusThresholds: {
      liveMinScore: 76,
      agingMinScore: 54,
      staleMinScore: 30,
    },
    confirmationFloorScores: {
      live: 76,
      agingWithActiveMappings: 64,
      agingWithoutActiveMappings: 54,
      staleWithActiveMappings: 54,
      staleWithoutActiveMappings: 38,
    },
    confirmationWindowsDays: {
      liveFloor: 3,
      agingFloor: 7,
      staleFloor: 14,
    },
    activeMappingRecencyHours: {
      hottest: 12,
      warm: 48,
      recent: 24 * 7,
      aging: 24 * 14,
      stale: 24 * 30,
      longTail: 24 * 60,
    },
    confirmationBonusDays: {
      hottest: 1,
      warm: 3,
      recent: 7,
      aging: 14,
      stale: 30,
    },
    applyUrlCheckIntervalHours: 12,
    removalPenaltyCaps: {
      withActiveMappings: 32,
      withoutActiveMappings: 78,
    },
    strongRemovalEvidenceWindowDays: 28,
  },
  balanced: {
    name: "balanced",
    statusThresholds: {
      liveMinScore: 72,
      agingMinScore: 48,
      staleMinScore: 22,
    },
    confirmationFloorScores: {
      live: 72,
      agingWithActiveMappings: 60,
      agingWithoutActiveMappings: 48,
      staleWithActiveMappings: 48,
      staleWithoutActiveMappings: 30,
    },
    confirmationWindowsDays: {
      liveFloor: 3,
      agingFloor: 7,
      staleFloor: 14,
    },
    activeMappingRecencyHours: {
      hottest: 12,
      warm: 48,
      recent: 24 * 7,
      aging: 24 * 14,
      stale: 24 * 30,
      longTail: 24 * 60,
    },
    confirmationBonusDays: {
      hottest: 1,
      warm: 3,
      recent: 7,
      aging: 14,
      stale: 30,
    },
    applyUrlCheckIntervalHours: 18,
    removalPenaltyCaps: {
      withActiveMappings: 28,
      withoutActiveMappings: 70,
    },
    strongRemovalEvidenceWindowDays: 21,
  },
  conservative: {
    name: "conservative",
    statusThresholds: {
      liveMinScore: 68,
      agingMinScore: 40,
      staleMinScore: 14,
    },
    confirmationFloorScores: {
      live: 68,
      agingWithActiveMappings: 56,
      agingWithoutActiveMappings: 40,
      staleWithActiveMappings: 40,
      staleWithoutActiveMappings: 22,
    },
    confirmationWindowsDays: {
      liveFloor: 5,
      agingFloor: 12,
      staleFloor: 21,
    },
    activeMappingRecencyHours: {
      hottest: 18,
      warm: 72,
      recent: 24 * 10,
      aging: 24 * 21,
      stale: 24 * 45,
      longTail: 24 * 90,
    },
    confirmationBonusDays: {
      hottest: 2,
      warm: 5,
      recent: 12,
      aging: 21,
      stale: 45,
    },
    applyUrlCheckIntervalHours: 12,
    removalPenaltyCaps: {
      withActiveMappings: 22,
      withoutActiveMappings: 56,
    },
    strongRemovalEvidenceWindowDays: 14,
  },
};

export function getLifecycleProfileName(): LifecycleProfileName {
  const raw = process.env.LIFECYCLE_PROFILE?.trim().toLowerCase();
  if (
    raw === "aggressive" ||
    raw === "balanced" ||
    raw === "conservative"
  ) {
    return raw;
  }

  return "balanced";
}

export function getLifecycleProfile(): LifecycleProfile {
  return LIFECYCLE_PROFILES[getLifecycleProfileName()];
}
