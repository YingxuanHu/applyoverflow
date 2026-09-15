// These board destinations require a separate job-seeker registration before
// revealing the application link. Employer ATS sign-in is not a board gate.
export const REGISTRATION_GATED_BOARD_PREFIXES = [
  "https://weworkremotely.com/", "http://weworkremotely.com/",
  "https://www.weworkremotely.com/", "http://www.weworkremotely.com/",
] as const;

export function isRegistrationGatedBoardUrl(value: string | null | undefined) {
  if (!value) return false;
  return REGISTRATION_GATED_BOARD_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix));
}
