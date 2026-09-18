import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAnswerReuse,
  type AnswerKind,
  type SavedApplicationAnswer,
} from "../src/lib/application-answer-policy";

const answer: SavedApplicationAnswer = {
  kind: "profile_fact",
  questionKey: "contact.phone",
  answer: "+1 555 0100",
  approved: true,
  reuse: "fill",
  profileRevision: "v1",
};
const context = {
  kind: answer.kind,
  questionKey: answer.questionKey,
  profileRevision: "v1",
};
test("only approved exact factual mappings can fill", () => {
  assert.equal(decideAnswerReuse(answer, context), "fill");
  assert.equal(
    decideAnswerReuse({ ...answer, approved: false }, context),
    "ask",
  );
  assert.equal(
    decideAnswerReuse(answer, {
      ...context,
      questionKey: "emergency-contact.phone",
    }),
    "ask",
  );
  assert.equal(
    decideAnswerReuse(answer, { ...context, profileRevision: "v2" }),
    "suggest",
  );
  assert.equal(
    decideAnswerReuse({ ...answer, reuse: "never" }, context),
    "ask",
  );
});
test("company relationships and referrals are never inferred or reused across companies", () => {
  for (const kind of [
    "referral",
    "company_relationship",
    "custom",
  ] as AnswerKind[]) {
    const saved = { ...answer, kind, companyId: "a" };
    assert.equal(
      decideAnswerReuse(saved, { ...context, kind, companyId: "b" }),
      "ask",
    );
    assert.equal(decideAnswerReuse(saved, { ...context, kind }), "ask");
    assert.equal(
      decideAnswerReuse(saved, { ...context, kind, companyId: "a" }),
      "suggest",
    );
  }
});
test("authorization is jurisdiction-specific and narratives always need review", () => {
  const saved = {
    ...answer,
    kind: "work_authorization" as const,
    country: "CA",
  };
  assert.equal(
    decideAnswerReuse(saved, { ...context, kind: saved.kind, country: "US" }),
    "ask",
  );
  assert.equal(
    decideAnswerReuse(saved, { ...context, kind: saved.kind, country: "CA" }),
    "suggest",
  );
  assert.equal(
    decideAnswerReuse(
      { ...answer, kind: "experience_story" },
      { ...context, kind: "experience_story" },
    ),
    "suggest",
  );
  assert.equal(
    decideAnswerReuse(
      { ...answer, kind: "sensitive" },
      { ...context, kind: "sensitive" },
    ),
    "ask",
  );
});
