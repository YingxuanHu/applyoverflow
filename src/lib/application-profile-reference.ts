import { normalizeContact, normalizeEducations, normalizeExperiences } from "@/lib/profile";
import { historyDateText, type ProfileHistory } from "@/lib/profile-history";

export type ReferenceField = { label: string; value: string };
export type ReferenceEntry = { title: string; subtitle: string; dates: string; fields: ReferenceField[] };
export type ApplicationProfileReference = {
  contact: ReferenceField[];
  experience: ReferenceEntry[];
  education: ReferenceEntry[];
};

const fields = (values: Array<[string, string | undefined]>): ReferenceField[] =>
  values.filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([label, value]) => ({ label, value }));

function dates(entry: ProfileHistory): ReferenceField[] {
  if (!entry.dates) return fields([["Dates", entry.time]]);
  return fields([
    ["Start date", entry.dates.start],
    ["End date", entry.dates.current ? "Present" : entry.dates.end],
  ]);
}

// Web-only projection. Never infer missing facts or send history to the extension.
export function buildApplicationProfileReference(profile: {
  contactJson?: unknown; experiencesJson?: unknown; educationsJson?: unknown;
} | null): ApplicationProfileReference {
  const contact = normalizeContact(profile?.contactJson);
  return {
    contact: fields([
      ["Full name", contact.fullName], ["Given name", contact.givenName],
      ["Family name", contact.familyName], ["Email", contact.email],
      ["Phone", contact.phone], ["Street address", contact.streetAddress],
      ["Address line 2", contact.addressLine2], ["City", contact.city],
      ["State / province", contact.region], ["Postal code", contact.postalCode],
      ["Country", contact.country === "CA" ? "Canada" : contact.country === "US" ? "United States" : ""],
      ["Location", contact.location], ["LinkedIn", contact.linkedInUrl],
      ["GitHub", contact.githubUrl], ["Portfolio", contact.portfolioUrl],
    ]),
    experience: normalizeExperiences(profile?.experiencesJson).map((entry) => ({
      title: entry.title || entry.company || "Work experience",
      subtitle: entry.title ? entry.company : "",
      dates: historyDateText(entry),
      fields: [
        ...fields([["Job title", entry.title], ["Company", entry.company], ["Location", entry.location]]),
        ...dates(entry), ...fields([["Description", entry.description]]),
      ],
    })),
    education: normalizeEducations(profile?.educationsJson).map((entry) => ({
      title: entry.school || entry.degree || "Education",
      subtitle: entry.school ? entry.degree : "",
      dates: historyDateText(entry),
      fields: [
        ...fields([["School", entry.school], ["Degree", entry.degree], ["Location", entry.location]]),
        ...dates(entry), ...fields([["Description", entry.description]]),
      ],
    })),
  };
}
