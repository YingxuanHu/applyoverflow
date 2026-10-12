import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { recoveryForError, stoppedFields, planQuestions } from "../extensions/chrome/recovery.mjs";
import { extensionValidationFields } from "../src/lib/extension-errors";
import { autofillPlanSchema } from "../src/lib/extension-autofill";

test("recovery distinguishes authentication, validation, network, server and profile failures", () => {
  for (const [error, code, command] of [
    [{ status: 401 }, "SIGN_IN_REQUIRED", "connect"],
    [{ status: 400 }, "EXTENSION_REQUEST_INVALID", "extension-help"],
    [{ status: 413 }, "EXTENSION_REQUEST_INVALID", "extension-help"],
    [{ status: 502 }, "SERVICE_UNAVAILABLE", "autofill"],
    [{ code: "INVALID_RESPONSE" }, "SERVICE_UNAVAILABLE", "autofill"],
    [{ code: "NETWORK_ERROR" }, "NETWORK_ERROR", "autofill"],
    [{ name: "TimeoutError" }, "REQUEST_TIMEOUT", "autofill"],
    [{ code: "PROFILE_REQUIRED", status: 400 }, "PROFILE_REQUIRED", "open-profile"],
    [{ code: "RESUME_SHARING_DISABLED", status: 403 }, "RESUME_SHARING_DISABLED", "open-profile"],
    [{ code: "PAGE_OUTDATED" }, "PAGE_OUTDATED", "chrome-extensions"],
    [{ status: 429 }, "RATE_LIMITED", "autofill"],
    [{ status: 409 }, "PROFILE_CHANGED", "autofill"],
  ] as const) {
    const result = recoveryForError(error, "autofill-plan");
    assert.equal(result.code, code);
    assert.equal(result.actions[0].type, command);
    if (code !== "SIGN_IN_REQUIRED") assert.ok(!result.actions.some((action: { type: string }) => action.type === "connect"));
  }
});

test("interrupted fields are not reported as missing profile facts; completed answers remain intact", () => {
  const fields = stoppedFields([{ state: "filled", label: "Name" }, { state: "kept", label: "Email" },
    { state: "needed", label: "Phone", queued: true }, { state: "needed", label: "Experience" }]);
  assert.equal(fields.filter((field: { blocked?: boolean }) => field.blocked).length, 2);
  assert.equal(fields[0].state, "filled"); assert.equal(fields[1].state, "kept");
  assert.ok(fields.every((field: { queued: boolean; processing: boolean }) => !field.queued && !field.processing));
  assert.match(fields[2].reason, /Not processed/);
});

test("cancelled sign-in offers a direct reconnect, not an Autofill retry", () => {
  const result = recoveryForError(new Error("Connection cancelled."), "connect");
  assert.equal(result.code, "CONNECTION_INCOMPLETE");
  assert.equal(result.actions[0].type, "connect");
});

test("plan bounds labels and UTF-8 size without truncating question meaning", () => {
  const scan = { fields: Array.from({ length: 50 }, (_, i) => ({ label: `${i}${"\u4e00".repeat(490)}`, state: "needed", canAnswer: true })) };
  const labels = planQuestions(scan);
  assert.ok(labels.length > 0 && labels.length < 40);
  assert.ok(Buffer.byteLength(JSON.stringify(labels)) < 18_002);
  assert.equal(planQuestions({ fields: [{ label: "x".repeat(501), state: "needed", canAnswer: true }] }).length, 0);
  assert.deepEqual(planQuestions({ questions: ["Useful question", "", "Useful question"] }), ["Useful question"]);
  const request = { url: "https://job-boards.greenhouse.io/example/jobs/123", questions: ["Why this role?", "x".repeat(501), "   "] };
  assert.deepEqual(autofillPlanSchema.parse(request).questions, ["Why this role?"]);
  assert.equal(autofillPlanSchema.safeParse({ ...request, questions: [12] }).success, false);
  assert.equal(autofillPlanSchema.safeParse({ ...request, questions: Array(41).fill("Question") }).success, false);
});

test("diagnostics expose only allowlisted paths, never submitted values or unknown keys", () => {
  const result = z.object({ questions: z.array(z.string()) }).strict().safeParse({ questions: [123], "private-user-value": "secret" });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.deepEqual(extensionValidationFields(result.error), ["questions.0", "request"]);
  const recovery = recoveryForError({ status: 400, fields: ["questions.0", "private-user-value"], requestId: "<secret>" });
  assert.match(recovery.detail, /questions.0/);
  assert.doesNotMatch(recovery.detail, /private|secret/);
});
