import test from "node:test";
import assert from "node:assert/strict";
import { fillProfessionalAnswers } from "../extensions/chrome/answer-runner.mjs";

type Field = { id: string; label: string; state: string; canAnswer: boolean; kind: string; options?: string[]; profileKey?: string; aiRestricted?: boolean };
const field = (id: string, label: string, kind = "text"): Field => ({ id, label, kind, state: "needed", canAnswer: true });
test("autofill inserts professional answers and exact choices, without a second popup form", async () => {
  const fields = [field("fit", "Describe your relevant experience"), field("qual", "Do you have experience building Python applications?", "combobox"),
    field("citizen", "Are you a US citizen?", "combobox"), field("legal", "I certify this is accurate", "combobox")];
  const writes: string[] = [], updates: string[] = [];
  const result = await fillProfessionalAnswers({ fields,
    inspect: async (mode: string, payload: { id?: string; answer?: string } = {}) => {
      if (mode === "autofill-options") fields.find(f => f.id === payload.id)!.options = ["Yes", "No"];
      if (mode === "autofill-answer") { fields.find(f => f.id === payload.id)!.state = "filled"; writes.push(payload.answer!); }
      return { fields: structuredClone(fields) };
    },
    suggest: async (f: Field) => ({ suggestion: { answer: f.id === "qual" ? "Yes" : "I built Python reporting tools.", missing: "" } }),
    progress: async (_fields: Field[], message: string) => { updates.push(message); },
  });
  assert.deepEqual(writes, ["I built Python reporting tools.", "Yes"]);
  assert.equal(result.find((f: Field) => f.id === "citizen").state, "needed");
  assert.equal(result.find((f: Field) => f.id === "legal").state, "needed");
  assert.ok(updates.some(message => message.startsWith("Answering:")));
  assert.ok(updates.some(message => message.startsWith("Filled:")));
});

test("answer queue preserves edits made while AI runs and refuses unavailable choices", async () => {
  const fields = [field("edited", "Describe a project you built"), { ...field("choice", "Do you have Python experience?", "select"), options: ["Yes", "No"] },
    field("missing", "Describe your relevant experience")];
  let writes = 0;
  const result = await fillProfessionalAnswers({ fields,
    inspect: async (mode: string) => { if (mode === "autofill-answer") writes++; return { fields: structuredClone(fields) }; },
    suggest: async (f: Field) => {
      if (f.id === "edited") { fields[0].state = "kept"; return { suggestion: { answer: "Generated answer", missing: "" } }; }
      return { suggestion: { answer: f.id === "choice" ? "Probably" : "", missing: f.id === "missing" ? "Which project should be used?" : "" } };
    }, progress: async () => {},
  });
  assert.equal(writes, 0);
  assert.equal(result[0].state, "kept");
  assert.match(result[1].reason, /No exact supported choice/);
  assert.match(result[2].reason, /Which project/);
  assert.ok(result.every((f: { queued: boolean; processing: boolean }) => !f.queued && !f.processing));
});

test("AI restrictions and unsupported widgets do not trigger answer generation", async () => {
  const fields = [{ ...field("restricted", "Describe a project"), aiRestricted: true },
    { ...field("manual", "Describe your experience"), canAnswer: false }, { ...field("contact", "Describe your experience"), profileKey: "givenName" }];
  let calls = 0;
  await fillProfessionalAnswers({ fields, inspect: async () => ({ fields }), suggest: async () => { calls++; }, progress: async () => {} });
  assert.equal(calls, 0);
});

test("answer progress distinguishes throttling from missing profile facts", async () => {
  const fields = [field("fit", "Describe your relevant experience")];
  const result = await fillProfessionalAnswers({ fields, inspect: async () => ({ fields }),
    suggest: async () => { throw Object.assign(new Error("Request limited"), { status: 429 }); }, progress: async () => {} });
  assert.equal(result[0].state, "needed");
  assert.match(result[0].reason, /temporarily limited/);
});
