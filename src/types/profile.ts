// Compatibility exports: readers and editors share one profile representation.
export type {
  ProfileExperience,
  ProfileEducation,
  ProfileProject,
  ProfileContact,
} from "@/lib/profile";
export {
  normalizeExperiences as parseExperiences,
  normalizeEducations as parseEducations,
  normalizeProjects as parseProjects,
  makeEmptyExperience as emptyExperience,
  makeEmptyEducation as emptyEducation,
  makeEmptyProject as emptyProject,
} from "@/lib/profile";
import { normalizeSkills } from "@/lib/profile";
export function parseSkills(json: unknown): string[] {
  return normalizeSkills(json).map((skill) => skill.name);
}
