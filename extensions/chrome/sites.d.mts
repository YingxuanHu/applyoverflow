export const SITE_ORIGINS: string[];
export function applicationContext(raw: string): {
  provider: "greenhouse" | "lever" | "ashby";
  tenant: string;
  companyKey: string;
  url: string;
} | null;
