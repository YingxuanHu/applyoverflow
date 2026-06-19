export const TOP_PICKS_CANDIDATE_LIMIT =
  Number(process.env.TOP_PICKS_CANDIDATE_LIMIT ?? 12000) || 12000;
export const TOP_PICKS_STORE_LIMIT =
  Number(process.env.TOP_PICKS_STORE_LIMIT ?? 150) || 150;
export const TOP_PICKS_PAGE_LIMIT =
  Number(process.env.TOP_PICKS_PAGE_LIMIT ?? 25) || 25;
export const TOP_PICKS_REFRESH_MAX_AGE_MINUTES =
  Number(process.env.TOP_PICKS_REFRESH_MAX_AGE_MINUTES ?? 60) || 60;
export const TOP_PICKS_ACTIVE_USER_DAYS =
  Number(process.env.TOP_PICKS_ACTIVE_USER_DAYS ?? 30) || 30;

export const TOP_PICKS_RESULT_TTL_MS =
  TOP_PICKS_REFRESH_MAX_AGE_MINUTES * 60_000;

export const TOP_PICK_SCORING_WEIGHTS = {
  roleFit: 34,
  seniorityFit: 24,
  skillFit: 18,
  semanticFit: 8,
  preferenceFit: 6,
  locationWorkModeFit: 6,
  salaryFit: 3,
  freshnessFit: 3,
  sourceQualityFit: 3,
  feedbackFit: 3,
} as const;

export const TOP_PICK_MIN_SCORE =
  Number(process.env.TOP_PICK_MIN_SCORE ?? 65) || 65;
export const TOP_PICK_STRONG_SCORE =
  Number(process.env.TOP_PICK_STRONG_SCORE ?? 80) || 80;
export const TOP_PICK_EXCELLENT_SCORE =
  Number(process.env.TOP_PICK_EXCELLENT_SCORE ?? 90) || 90;

export const TOP_PICK_ROLE_CONFIDENCE_THRESHOLD = 0.7;
export const TOP_PICK_UNKNOWN_ROLE_SCORE_CAP = 68;
export const TOP_PICK_ADJACENT_ROLE_SCORE_CAP = 78;
export const TOP_PICK_WEAK_ROLE_SCORE_CAP = 65;
export const TOP_PICK_STRETCH_SENIORITY_SCORE_CAP = 75;
export const TOP_PICK_WEAK_SENIORITY_SCORE_CAP = 65;
