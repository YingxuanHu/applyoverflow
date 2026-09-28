import type { ProfileFormValues } from "@/lib/profile";
import { autofillHistoryDates, readHistoryDates, type ProfileHistory } from "@/lib/profile-history";
import { parseSuggestion, questionAssistance } from "@/lib/extension-suggestions";

type Input = { label: string; options?: string[]; note?: string; maxLength?: number; maxWords?: number };
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function professionalThreshold(input: Input) {
  if (questionAssistance(input.label) !== "qualification") return null;
  const label = input.label.toLowerCase().replace(/\s+/g, " ").replace(/^(?:(?:please|\((?:required|optional)\))\s*)+/, "");
  if (!/^do you have\b/.test(label) ||
      /\b(?:degree|diploma|certif\w*|licen[cs]\w*|consecutive|continuous|recent|between|under|less than|at most|no more than|personal|hobby|hobbies|academic|coursework|study|studies|volunteer\w*|unpaid|informal|equivalent)\b|\b(?:within|in|over) (?:the )?(?:last|past|previous)\b/.test(label)) return null;
  // Employment tenure does not bound skills learned in education or hobbies.
  // Clinical supply operations are professional work, unlike generic projects.
  const workScoped = /\b(?:professional|employment|employed|work experience|paid work)\b/.test(label) ||
    (/\b(?:managing|management|leading|supervising)\b/.test(label) && /\b(?:direct reports|employees|staff|hiring)\b/.test(label)) ||
    (/\b(?:clinical supply|clinical project|supply chain|trial supply)\b/.test(label) && /\b(?:clinical|pharma\w*|biotech\w*)\b/.test(label));
  if (!workScoped) return null;
  const matches = [...label.matchAll(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*years?\b/g)];
  if (matches.length !== 1 || /\d\s*[-–]\s*\d/.test(label)) return null;
  if (!/^do you have (?:(?:at least|a minimum of|more than|over) )?$/.test(label.slice(0, matches[0].index))) return null;
  const years = numberWords[matches[0][1]] ?? Number(matches[0][1]);
  if (years <= 0 || years > 40 || !Number.isInteger(years * 12)) return null;
  const choices = (word: string) => input.options?.filter(option => option.trim().toLowerCase() === word) ?? [];
  if (input.options?.length && (choices("yes").length !== 1 || choices("no").length !== 1)) return null;
  return { months: years * 12, no: choices("no")[0] ?? "No" };
}

export function screeningHistoryComplete(raw: unknown, projected: Array<{ description: string }>) {
  if (raw == null) return !projected.length;
  return Array.isArray(raw) && raw.length === projected.length && raw.every((entry, index) =>
    entry && typeof entry === "object" &&
    (entry.description == null || typeof entry.description === "string") &&
    (entry.description || "").trim() === projected[index].description &&
    (!entry.dates || Boolean(readHistoryDates(entry.dates))));
}

type Span = [number, number];
function months(entry: ProfileHistory, now: Date): Span | null {
  const dates = autofillHistoryDates({ ...entry,
    time: entry.time.replace(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(\d{4})\b/gi, "$1 $2").replace(/\s*-\s*(?=[A-Za-z])/g, " - ") });
  if (!dates?.start || dates.start.length < 7 || (!dates.current && dates.end.length < 7)) return null;
  const index = (part: string) => Number(part.slice(0, 4)) * 12 + Number(part.slice(5, 7)) - 1;
  const today = now.toISOString().slice(0, 10), currentMonth = index(today);
  if ((dates.start.length === 10 && dates.start > today) || (dates.end.length === 10 && dates.end > today)) return null;
  const start = index(dates.start), end = dates.current ? currentMonth : index(dates.end);
  return start <= end && start <= currentMonth && end <= currentMonth ? [start, end + 1] : null;
}
function merge(spans: Span[]) {
  const union: Span[] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = union.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else union.push([start, end]);
  }
  return union;
}

// Only a conservative No is derived here. Total documented work cannot
// prove the requested domain/activity, so sufficient tenure never becomes Yes.
export function documentedWorkScreening(profile: ProfileFormValues, input: Input, now = new Date()) {
  const threshold = professionalThreshold(input);
  if (!threshold || input.note?.trim() || !profile.experiences.length || profile.experiences.length > 25 || profile.projects.length > 25) return null;
  const spans = [...profile.experiences.map(entry => (entry.title.trim() || entry.company.trim()) ? months(entry, now) : null),
    ...profile.projects.map(entry => months(entry, now))];
  if (spans.some(span => !span)) return null;
  const union = merge(spans as Span[]);
  const upperMonths = union.reduce((total, [start, end]) => total + end - start, 0);
  if (upperMonths >= threshold.months) return null;
  // Read complete descriptions for conflicting tenure; never decide absence
  // from clipped model evidence or a sampled subset of the supplied history.
  const texts = [profile.headline, profile.summary, input.note || "", ...profile.skills.map(skill => skill.name),
    ...profile.experiences.map(entry => entry.description), ...profile.projects.map(entry => `${entry.name} ${entry.description}`)];
  if (texts.reduce((size, text) => size + text.length, 0) > 100_000) return null;
  for (const text of texts) {
    if (/\b(?:prior|previous|additional|earlier|unlisted|undocumented) (?:roles?|employment|work|professional experience)\b|\b(?:since|from|before|dating back to)\s+(?:19|20)\d{2}\b/i.test(text)) return null;
    const duration = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*[+-]?\s*(years?|months?)\b/g;
    for (const match of text.toLowerCase().matchAll(duration)) {
      const value = (numberWords[match[1]] ?? Number(match[1])) * (match[2].startsWith("year") ? 12 : 1);
      if (value > upperMonths) return null;
    }
    if (/\b(?:years?|months?|decades?|centur(?:y|ies))\b/.test(text.toLowerCase().replace(duration, ""))) return null;
  }
  const quote = `The supplied employment and project entries cover at most ${upperMonths} calendar months after overlapping dates are merged. This is not a claim about lifetime experience.`;
  const evidence = [{ id: "documented-work-history", text: quote }];
  try {
    const suggestion = parseSuggestion(JSON.stringify({ answer: threshold.no,
      evidence: [{ id: evidence[0].id, quote }], missing: "" }), evidence, input);
    return { ...suggestion, inferred: true, reviewRequired: true, reviewReason: "Based on documented work history; review",
      assessment: { documentedMonthsUpperBound: upperMonths, requiredMonths: threshold.months,
        sourceIds: [...profile.experiences.map((_, index) => `experience-${index}`), ...profile.projects.map((_, index) => `project-${index}`)] } };
  } catch { return null; }
}
