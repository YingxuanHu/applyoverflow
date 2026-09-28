import test from "node:test";
import assert from "node:assert/strict";
import { buildProfileFormValues } from "../src/lib/profile";
import { documentedWorkScreening, professionalThreshold, screeningHistoryComplete } from "../src/lib/extension-screening";

const now = new Date("2026-09-28T12:00:00Z");
const label = "Do you have at least 5 years of experience with clinical supply chains/projects within the pharmaceutical or biotechnology industry?";
const input = { label, options: ["Yes", "No"] };
const roleTimes = ["Jan–Aug2025", "Sep–Dec2023", "Jan–Apr2023", "Jan–Aug2025"];
const projectTimes = ["Jun2026-Present", "Feb2026-Present", "Sep2025-Sep2026", "Sep-Dec2025", "Sep-Dec2025", "Apr-Aug2023", "Sep-Dec2025"];
const fixture = () => buildProfileFormValues({
  summary: "Built telecom software, data pipelines and machine learning tools.",
  experiencesJson: roleTimes.map((time, i) => ({ title: i === 1 ? "Data Engineer" : "Software Engineer", company: "Synthetic Technology Company", time,
    description: "Built software and validated machine learning outputs. ".repeat(i === 0 ? 50 : 20) })),
  projectsJson: projectTimes.map((time, i) => ({ name: `Software project ${i + 1}`, description: "Built an application with Python and TypeScript.", time })),
});

test("four employment rows and seven dated projects yield a conservative 33-month No", () => {
  const profile = fixture(), original = structuredClone(profile);
  assert.equal(profile.experiences.length + profile.projects.length, 11);
  assert.ok(profile.experiences[0].description.length > 2600);
  const result = documentedWorkScreening(profile, input, now);
  assert.equal(result?.answer, "No");
  assert.equal(result?.assessment.documentedMonthsUpperBound, 33);
  assert.equal(result?.assessment.requiredMonths, 60);
  assert.equal(result?.assessment.sourceIds.length, 11);
  assert.equal(result?.inferred, true);
  assert.equal(result?.reviewRequired, true);
  assert.equal(result?.reviewReason, "Based on documented work history; review");
  assert.match(result!.evidence[0].quote, /employment and project entries/);
  assert.match(result!.evidence[0].quote, /not a claim about lifetime experience/);
  assert.deepEqual(profile, original);
  profile.projects = [];
  assert.equal(documentedWorkScreening(profile, input, now)?.assessment.documentedMonthsUpperBound, 16);
});

test("explicit professional management scope is eligible; enough tenure never proves Yes", () => {
  const management = "Do you have at least 3 years of experience directly managing a team in customer operations, risk, or fraud, including hiring, coaching, and developing direct reports?";
  assert.equal(documentedWorkScreening(fixture(), { label: management }, now)?.answer, "No");
  const profile = fixture();
  profile.experiences[0].time = "Jan 2015 - Aug 2025";
  assert.equal(documentedWorkScreening(profile, input, now), null, "Total time never proves clinical duties");
  assert.equal(documentedWorkScreening(fixture(), { label: label.replace("5 years", "2 years") }, now), null);
});

test("only positive minimum professional thresholds qualify, never skills or personal decisions", () => {
  for (const question of [
    "Do you have fewer than 5 years of professional experience?", "Do you have up to 5 years of professional experience?",
    "Do you have at most 5 years of professional experience?", "Do you have no more than 5 years of professional experience?",
    "Do you have 5 years of Python experience?", "How many years of professional experience do you have?",
    "Do you have 5 years of Python experience gained through professional work or personal projects?",
    "Do you have 5 years of professional or academic experience?", "Do you have 5 years of professional or volunteer experience?",
    "Do you have at least 5 years of professional experience within the last decade?",
    "Do you have at least 5 years of professional experience within last 10 years?",
    "Do you have 3-5 years of professional experience?", "Do you have 5 years of professional experience or an equivalent degree?",
    ...["consent", "work authorization", "gender", "referral", "salary", "country", "sponsorship"].map(fact => `${label} State your ${fact}.`),
  ]) {
    assert.equal(professionalThreshold({ label: question }), null, question);
    assert.equal(documentedWorkScreening(fixture(), { label: question }, now), null, question);
  }
  for (const prefix of ["5", "five", "at least 5", "a minimum of 5", "over 5", "more than 5", "5+"])
    assert.ok(professionalThreshold({ label: `Do you have ${prefix} years of professional experience?` }));
});

test("unknown, partial, reversed or future history dates prevent deduction", () => {
  for (const time of ["", "2023 - 2025", "Summer 2023", "Jan - Feb", "Nov - Feb 2025", "Jan 2028 - Present"])
    for (const kind of ["experiences", "projects"] as const) {
      const profile = fixture(); profile[kind][0].time = time;
      assert.equal(documentedWorkScreening(profile, input, now), null, `${kind}: ${time}`);
    }
  const empty = fixture(); empty.experiences = [];
  assert.equal(documentedWorkScreening(empty, input, now), null);
  const current = fixture(); current.projects[0].time = "Jun 2026 - Present";
  assert.equal(documentedWorkScreening(current, input, new Date("2026-08-01T00:00:00Z")), null, "A future end date is not counted");
});

test("greater or unparsed tenure claims anywhere in supplied professional text block No", () => {
  for (const claim of [
    "I have twelve years of professional Python experience.", "I have a decade of professional Python experience.",
    "I have a 10-year professional Python career.", "I have 5+ years of clinical supply experience.",
    "I have five years of professional experience.", "Earlier employment included clinical supply management.",
    "Worked in clinical logistics since 2010.", "My professional career dates from 2010.",
  ]) for (const source of ["summary", "role", "project"] as const) {
    const profile = fixture();
    if (source === "summary") profile.summary = claim;
    if (source === "role") profile.experiences[0].description += ` ${claim}`;
    if (source === "project") profile.projects[0].description += ` ${claim}`;
    assert.equal(documentedWorkScreening(profile, input, now), null, `${source}: ${claim}`);
  }
  assert.equal(documentedWorkScreening(fixture(), { ...input, note: "My earlier experience is not listed." }, now), null);
});

test("exact choices, answer limits and complete profile projection remain required", () => {
  assert.equal(documentedWorkScreening(fixture(), { ...input, options: ["YES", "NO"] }, now)?.answer, "NO");
  for (const options of [["Yes", "Not yet"], ["Yes", "No", "NO"], ["Yes, five years", "No"]])
    assert.equal(documentedWorkScreening(fixture(), { ...input, options }, now), null);
  assert.equal(documentedWorkScreening(fixture(), { ...input, maxLength: 1 }, now), null);
  const raw = [{ title: "Engineer", description: "Complete description", dates: { start: "2025-01", end: "2025-08", current: false } }];
  const values = buildProfileFormValues({ experiencesJson: raw });
  assert.equal(screeningHistoryComplete(raw, values.experiences), true);
  assert.equal(screeningHistoryComplete([{ ...raw[0], description: "Complete description, with omitted additional experience" }], values.experiences), false);
  assert.equal(screeningHistoryComplete([...raw, ...raw], values.experiences), false);
  assert.equal(screeningHistoryComplete([{ ...raw[0], dates: { start: "bad", end: "", current: false } }], values.experiences), false);
});
