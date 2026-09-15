import { z } from "zod";

export const JOB_REPORT_CATEGORIES = {
  DESCRIPTION: "Description missing or incorrect",
  LOCATION: "Location or work style",
  SALARY: "Salary",
  COMPANY: "Company or logo",
  CLOSED: "Posting closed or link broken",
  OTHER: "Something else",
} as const;

export const jobDataReportSchema = z.object({
  category: z.enum(["DESCRIPTION", "LOCATION", "SALARY", "COMPANY", "CLOSED", "OTHER"]),
  details: z.string().trim().min(5).max(500),
}).strict();
