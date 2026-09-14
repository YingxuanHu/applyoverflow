export const TOP_PICK_FEEDBACK_OPTIONS = [
  ["NOT_INTERESTED", "Not interested"],
  ["WRONG_ROLE", "Wrong kind of role"],
  ["TOO_SENIOR", "Too senior"],
  ["TOO_JUNIOR", "Too junior"],
  ["WRONG_LOCATION", "Wrong location"],
  ["WRONG_WORK_MODE", "Wrong work arrangement"],
  ["WRONG_EMPLOYMENT_TYPE", "Wrong employment type"],
  ["LOW_QUALITY", "Incorrect or incomplete posting"],
  ["ALREADY_SEEN", "Already reviewed"],
] as const;

export type TopPickFeedbackType = (typeof TOP_PICK_FEEDBACK_OPTIONS)[number][0];
