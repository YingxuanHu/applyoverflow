/**
 * Mirror the structured ProfileContact JSON back onto UserProfile's direct
 * columns (`phone`, `location`, `linkedinUrl`, `githubUrl`, `portfolioUrl`).
 *
 * The profile form writes the structured `contactJson` shape, but other
 * surfaces (auto-apply review screen, AI prompt context builders, exported
 * resume/cover-letter generators) read from the direct columns. Without
 * this sync, fields the user typed in /profile silently appear as
 * "Not set" everywhere else.
 */
import type { ProfileContact } from "@/lib/profile";

/**
 * Direct-column subset of UserProfile that mirrors ProfileContact.
 * Returned as a plain object so it can be spread into a Prisma update.
 */
export type ProfileContactColumns = {
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function contactToProfileColumnUpdates(
  contact: ProfileContact
): ProfileContactColumns {
  return {
    phone: clean(contact.phone),
    location: clean(contact.location),
    // ProfileContact uses camelCase `linkedInUrl` (capital I); the Prisma
    // column is `linkedinUrl` (lowercase i). Normalize here so callers
    // can paste the result straight into `prisma.userProfile.update`.
    linkedinUrl: clean(contact.linkedInUrl),
    githubUrl: clean(contact.githubUrl),
    portfolioUrl: clean(contact.portfolioUrl),
  };
}
