export const SITE_ORIGINS: string[];
export const APPLICATION_ORIGINS: string[];
export function detectionOrigins(granted?: string[]): string[];
export function applicationContext(raw: string, allowGeneric?: boolean): {
  provider: "greenhouse" | "lever" | "ashby" | "workday" | "icims" | "workable" | "generic";
  tenant: string;
  companyKey: string;
  jobKey?: string;
  url: string;
} | null;
export function sameApplication(left: string, right: string): boolean;
