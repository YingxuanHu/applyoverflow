export const SITE_ORIGINS: string[];
export function applicationContext(raw: string, allowGeneric?: boolean): {
  provider: "greenhouse" | "lever" | "ashby" | "workday" | "icims" | "generic";
  tenant: string;
  companyKey: string;
  jobKey?: string;
  url: string;
} | null;
export function sameApplication(left: string, right: string): boolean;
