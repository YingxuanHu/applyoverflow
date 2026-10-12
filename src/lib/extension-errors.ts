import type { ZodError } from "zod";

const requestFields = new Set(["url", "questions", "history", "employmentCountry", "employmentLocation", "label", "options", "maxLength", "maxWords", "revision"]);

// Validation messages can contain submitted values or unknown property names.
// Return only known schema paths; never log questions, answers, tokens or URLs.
export function extensionValidationFields(error: ZodError) {
  return [...new Set(error.issues.map(issue => {
    const root = String(issue.path[0] ?? "request");
    if (!requestFields.has(root)) return "request";
    const index = issue.path[1];
    return `${root}${typeof index === "number" && Number.isInteger(index) && index >= 0 ? `.${index}` : ""}`;
  }))].slice(0, 4);
}
