"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { applyReviewedSetup, pendingSetupScopes, type ReviewScope, type SetupProfile } from "@/lib/profile-setup";

const labels: Record<ReviewScope, string> = {
  contact: "Contact details", address: "Address and links", experiences: "Work experience",
  educations: "Education", projects: "Projects", summary: "Summary and skills",
};

function lines(profile: SetupProfile, scope: ReviewScope): string[] {
  const contact = profile.contact;
  if (scope === "contact") return [contact.fullName, contact.givenName, contact.familyName, contact.preferredName,
    contact.email, contact.phone, contact.phoneCountry, contact.location].filter((value): value is string => Boolean(value));
  if (scope === "address") return [contact.streetAddress, contact.addressLine2, contact.city, contact.region, contact.postalCode,
    contact.country, contact.linkedInUrl, contact.githubUrl, contact.portfolioUrl].filter((value): value is string => Boolean(value));
  if (scope === "summary") return [profile.headline, profile.summary, profile.skills.map(item => item.name).join(", ")].filter(Boolean);
  return profile[scope].map(item => {
    const title = "company" in item ? `${item.title} at ${item.company}` : "school" in item
      ? [item.school, item.degree, item.fieldOfStudy].filter(Boolean).join(" | ") : `${item.name} ${item.title}`;
    const dates = "dates" in item && item.dates ? `${item.dates.start} - ${item.dates.current ? "Present" : item.dates.end}` : item.time;
    return [title, dates, item.location, item.description].filter(Boolean).join("\n");
  });
}

export function SetupConflictReview({ current, draft, onResolve }: {
  current: SetupProfile; draft: SetupProfile; onResolve: (profile: SetupProfile) => void;
}) {
  const [useDraft, setUseDraft] = useState<ReviewScope[]>([]);
  return <section aria-label="Compare profile changes" className="mb-6 border-y py-5">
    <h2 className="text-base font-semibold">Your saved profile changed</h2>
    <p className="mt-2 text-sm text-muted-foreground">Your draft is still here. Choose which version of each changed section to keep, then review before confirming.</p>
    {pendingSetupScopes(current, draft).map(scope => <fieldset key={scope} className="mt-5 min-w-0 border-t pt-4">
      <legend className="px-1 text-sm font-medium">{labels[scope]}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {[{ label: "Saved profile", value: current, selected: false }, { label: "Your draft", value: draft, selected: true }].map(option =>
          <div key={option.label} className="min-w-0">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="radio" name={`conflict-${scope}`} checked={useDraft.includes(scope) === option.selected}
                onChange={() => setUseDraft(values => option.selected ? [...new Set([...values, scope])] : values.filter(value => value !== scope))} />
              {option.label}
            </label>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {(lines(option.value, scope).length ? lines(option.value, scope) : ["No details"]).map((line, index) =>
                <li key={index} className="whitespace-pre-wrap break-words">{line}</li>)}
            </ul>
          </div>)}
      </div>
    </fieldset>)}
    <Button type="button" className="mt-5" onClick={() => onResolve(applyReviewedSetup(current, draft, useDraft))}>Use selected sections</Button>
  </section>;
}
