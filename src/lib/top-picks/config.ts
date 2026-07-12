export const TOP_PICKS_CANDIDATE_LIMIT =
  Number(process.env.TOP_PICKS_CANDIDATE_LIMIT ?? 20000) || 20000;
export const TOP_PICKS_STORE_LIMIT =
  Number(process.env.TOP_PICKS_STORE_LIMIT ?? 300) || 300;
export const TOP_PICKS_PAGE_LIMIT =
  Number(process.env.TOP_PICKS_PAGE_LIMIT ?? 30) || 30;
export const TOP_PICKS_REFRESH_MAX_AGE_MINUTES =
  Number(process.env.TOP_PICKS_REFRESH_MAX_AGE_MINUTES ?? 60) || 60;
export const TOP_PICKS_ACTIVE_USER_DAYS =
  Number(process.env.TOP_PICKS_ACTIVE_USER_DAYS ?? 30) || 30;

export const TOP_PICKS_RESULT_TTL_MS =
  TOP_PICKS_REFRESH_MAX_AGE_MINUTES * 60_000;

export const TOP_PICK_SCORING_WEIGHTS = {
  roleFit: 30,
  seniorityFit: 22,
  skillFit: 15,
  topApplicantFit: 16,
  semanticFit: 6,
  preferenceFit: 6,
  locationWorkModeFit: 6,
  salaryFit: 3,
  freshnessFit: 3,
  sourceQualityFit: 4,
  feedbackFit: 5,
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
