import test from "node:test";
import assert from "node:assert/strict";
import { fillProfessionalAnswers, fillSavedDetails } from "../extensions/chrome/answer-runner.mjs";

type Field = { id: string; label: string; state: string; canAnswer: boolean; canPlan?: boolean; kind: string; options?: string[]; profileKey?: string; aiRestricted?: boolean };
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

test("one autofill run discovers dependent questions and retains parent context", async () => {
  const fields = [field("source", "How did you hear about this job?")];
  const requests: string[][] = [];
  const { result } = await fillSavedDetails({ scan: { fields: structuredClone(fields) },
    getPlan: async (scan: { questions: string[] }) => { requests.push(scan.questions); return { revision: "1" }; },
    inspect: async (mode: string) => {
      if (mode === "autofill") {
        const next = fields.find(f => f.state === "needed");
        if (next) next.state = "filled";
        if (fields.length === 1) fields.push(field("detail", "If Other, please specify"));
      }
      return { fields: structuredClone(fields), historyFilled: mode === "autofill" ? 2 : 0 };
    }, progress: async () => {},
  });
  assert.deepEqual(requests, [["How did you hear about this job?"], ["How did you hear about this job?", "If Other, please specify"]]);
  assert.ok(result.fields.every((f: Field) => f.state === "filled"));
  assert.equal(result.historyFilled, 4);
});

test("saved-detail passes stop on stable unresolved fields, profile changes and continual remounts", async () => {
  let requests = 0;
  const stable = { fields: [field("missing", "Availability")] };
  await fillSavedDetails({ scan: stable, getPlan: async () => { requests++; return {}; }, inspect: async () => stable, progress: async () => {} });
  assert.equal(requests, 1, "do not repeatedly request missing facts");
  let scans = 0;
  requests = 0;
  const inspect = async () => ({ fields: [field(String(++scans), "Availability")] });
  await fillSavedDetails({ scan: stable, getPlan: async () => { requests++; return {}; }, inspect, progress: async () => {} });
  assert.equal(requests, 4, "hostile/unstable DOM cannot loop forever");
  requests = 0;
  await assert.rejects(fillSavedDetails({ scan: stable, getPlan: async () => ({ revision: String(++requests) }), inspect, progress: async () => {} }), /profile changed/);
});

test("saved-detail queue retries a cleared write once, but cannot spin on a rejecting form", async () => {
  let writes = 0;
  const scan = { fields: [{ ...field("first", "First name"), profileKey: "givenName", retryable: false }] };
  await fillSavedDetails({ scan, getPlan: async () => ({}),
    inspect: async (mode: string) => {
      if (mode === "autofill") { writes++; scan.fields[0].retryable = true; }
      return structuredClone(scan);
    }, progress: async () => {},
  });
  assert.equal(writes, 2);
});

test("saved-detail queue retains pre-filled parent labels in current form order", async () => {
  const parent = { ...field("source", "How did you hear about this job?"), state: "kept" };
  const child = field("details", "If Other, please specify");
  const scan = { fields: [parent, child] };
  let labels: string[] = [];
  await fillSavedDetails({ scan, getPlan: async (current: { questions: string[] }) => { labels = current.questions; return {}; },
    inspect: async () => scan, progress: async () => {},
  });
  assert.deepEqual(labels, [parent.label, child.label]);
});

test("saved-only planning discovers fresh choices without permitting AI or looping", async () => {
  const fields = [field("first", "How did you hear about this job?")];
  const choice = { ...field("choice", "Do you have Python experience?", "radio"), canAnswer: false, canPlan: true };
  const requests: string[][] = [];
  await fillSavedDetails({ scan: { fields: structuredClone(fields) },
    getPlan: async (scan: { questions: string[] }) => { requests.push(scan.questions); return {}; },
    inspect: async (mode: string) => {
      if (mode === "autofill" && fields.length === 1) { fields[0].state = "filled"; fields.push(choice); }
      return { fields: structuredClone(fields) };
    }, progress: async () => {},
  });
  assert.deepEqual(requests, [[fields[0].label], [fields[0].label, choice.label]]);
  let generated = false;
  await fillProfessionalAnswers({ fields: [choice], inspect: async () => ({ fields: [choice] }),
    suggest: async () => { generated = true; }, progress: async () => {} });
  assert.equal(generated, false);
});
