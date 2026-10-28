import assert from "node:assert/strict";
import test from "node:test";
import { OWNER, parseAlert, sendHealthAlert } from "../scripts/send-health-alert.mjs";

const envelope = { schemaVersion: 1, source: "host", kind: "alert", active: ["backup-age"], opened: ["backup-age"], recovered: [] };
const env = { NODE_ENV: "test" as const, MONITOR_ALERT_EMAIL: OWNER, SMTP_HOST: "smtp.invalid", SMTP_PORT: "587", SMTP_USER: "secret-user", SMTP_PASS: "secret-password", SMTP_FROM: "ops@example.invalid" };

test("health mail accepts only fixed condition codes and the owner recipient", async () => {
  assert.deepEqual(parseAlert(envelope), envelope);
  for (const bad of [{ ...envelope, text: "private log" }, { ...envelope, active: ["secret-password"] }, { ...envelope, kind: "arbitrary" }]) {
    assert.throws(() => parseAlert(bad));
  }
  await assert.rejects(sendHealthAlert(envelope, { ...env, MONITOR_ALERT_EMAIL: "other@example.invalid" }), /allowlisted/);
  await assert.rejects(sendHealthAlert(envelope, { ...env, SMTP_PASS: "" }), /configuration/);
});

test("SMTP acceptance is explicit, fixed text is redacted, and transport closes", async () => {
  let closed = false;
  const result = await sendHealthAlert(envelope, env, ((options: Record<string, unknown>) => {
    assert.equal(options.requireTLS, true);
    assert.equal(options.pool, false);
    return {
      sendMail: async (message: Record<string, unknown>) => {
        assert.equal(message.to, OWNER);
        assert.equal(message.disableFileAccess, true);
        assert.doesNotMatch(String(message.text), /secret-user|secret-password|smtp.invalid/);
        assert.match(String(message.text), /verified backup/);
        return { accepted: [OWNER], rejected: [] };
      }, close: () => { closed = true; },
    };
  }) as never);
  assert.equal(result.delivery, "smtp-accepted");
  assert.equal(result.inboxReceiptVerified, false);
  assert.equal(closed, true);
});

test("SMTP refusal is not success and still closes the transport", async () => {
  let closed = false;
  await assert.rejects(sendHealthAlert(envelope, env, (() => ({
    sendMail: async () => ({ accepted: [], rejected: [OWNER] }), close: () => { closed = true; },
  })) as never), /did not accept/);
  assert.equal(closed, true);
});

test("routine summaries are clearly labelled and retain code-only content", async () => {
  await sendHealthAlert({ ...envelope, kind: "summary", active: ["load"], opened: ["load"] }, env, (() => ({
    sendMail: async (message: Record<string, unknown>) => {
      assert.equal(message.subject, "[ApplyOverflow] Operations daily summary");
      assert.match(String(message.text), /System load/);
      return { accepted: [OWNER], rejected: [] };
    }, close: () => {},
  })) as never);
});
