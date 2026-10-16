import { z } from "zod";

export const onboardingEventSchema = z.object({
  event: z.enum(["setup_opened", "authentication_completed", "profile_import_attempted", "profile_import_completed", "profile_import_failed", "profile_details_confirmed", "extension_connection_completed", "setup_step_deferred", "autofill_attempted", "autofill_completed", "first_real_autofill_succeeded", "recovery_shown", "recovery_completed"]),
  journey: z.string().uuid(),
  run: z.string().uuid().optional(),
  entry: z.enum(["website", "extension"]),
  filled: z.number().int().min(0).max(500).optional(),
  remaining: z.number().int().min(0).max(500).optional(),
}).strict().refine(data => !["autofill_attempted", "autofill_completed", "first_real_autofill_succeeded"].includes(data.event) || Boolean(data.run), {
  message: "Autofill events need a unique run identifier.",
});
export type OnboardingEvent = z.infer<typeof onboardingEventSchema>;

// No URLs, answers, profile fields, filenames or free-form errors are accepted.
export function onboardingJourney(entry: OnboardingEvent["entry"]): string | undefined {
  try {
    const key = `ao-setup-journey:${entry}`;
    const journey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, journey);
    return journey;
  } catch { return undefined; }
}
export function trackOnboarding(event: OnboardingEvent["event"], entry: OnboardingEvent["entry"]) {
  try {
    const journey = onboardingJourney(entry);
    if (!journey) return;
    void fetch("/api/onboarding/events", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, entry, journey }), keepalive: true }).catch(() => {});
  } catch { /* Measurement never blocks the task. */ }
}
