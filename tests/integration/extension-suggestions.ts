import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { chromium } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { suggestApplicationAnswer } from "../../src/lib/queries/extension-suggestions";
import { exchangeExtensionCode, authenticateExtension } from "../../src/lib/queries/application-assistant";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "");
  const liveAI = process.argv.includes("--live-ai");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  if (liveAI && !process.env.OPENAI_API_KEY) {
    const { readFile } = await import("node:fs/promises");
    const { parse } = await import("dotenv");
    // Load only the AI credential. Never replace the guarded local database URL.
    process.env.OPENAI_API_KEY = parse(await readFile(".env")).OPENAI_API_KEY;
  }
  if (!liveAI) process.env.OPENAI_API_KEY ||= "test-only-no-network";
  const suffix = randomBytes(8).toString("hex");
  const email = `extension-drafts-${suffix}@example.test`, password = randomBytes(24).toString("base64url");
  const user = await prisma.user.create({ data: { name: "Draft Fixture", email, emailVerified: true,
    profile: { create: { name: "Draft Fixture", email, summary: "Built a finance dashboard using TypeScript and SQL.",
      contactJson: { email, phone: "5555550199", streetAddress: "Private fixture address", applicationAnswers: { enabled: true, values: { gender: "Woman" } } },
      experiencesJson: [{ title: "Software Developer", company: "Example Company", description: "Built a finance dashboard using TypeScript and SQL." }],
    } } }, include: { profile: true } });
  const request = { url: "https://job-boards.greenhouse.io/fixture/jobs/123", title: "Software Engineer", label: "Why are you interested in this role?", jobDescription: "Build reporting tools for finance teams using TypeScript.", note: "", revision: user.profile!.updatedAt.toISOString() };
  let calls = 0, browser;
  try {
    if (!liveAI) globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.openai.com/")) return originalFetch(input, init);
      calls++;
      const body = JSON.parse(String(init?.body));
      const payload = body.messages.find((m: { role: string }) => m.role === "user").content;
      for (const secret of [email, "5555550199", "Private fixture address", "Woman"]) assert.ok(!payload.includes(secret));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "I built a finance dashboard using TypeScript and SQL, and would like to apply that experience to reporting tools.", evidence: [{ id: "summary", quote: "Built a finance dashboard using TypeScript and SQL." }], missing: "" }) } }] });
    };
    await assert.rejects(() => suggestApplicationAnswer(user.id, { ...request, label: "What weekdays are you available?" }), /decision/);
    await assert.rejects(() => suggestApplicationAnswer(user.id, { ...request, label: "Explain why you are interested in part time employment" }), /short note/);
    await assert.rejects(() => suggestApplicationAnswer(user.id, { ...request, revision: new Date(0).toISOString() }), /profile changed/);
    assert.equal(calls, 0, "Personal decisions and stale revisions never invoke AI");
    const start = Date.now();
    const result = await suggestApplicationAnswer(user.id, request);
    assert.ok(result.suggestion.answer); assert.ok(result.suggestion.evidence.length);
    if (liveAI) console.log(`PASS live AI (${Date.now() - start}ms): ${result.suggestion.answer}`);
    else assert.equal(calls, 1);
    const partTime = await suggestApplicationAnswer(user.id, { ...request, label: "Explain why you are interested in part time employment", note: "I am studying and want to use my software skills in practical reporting work alongside my studies." });
    assert.ok(partTime.suggestion.answer);
    if (liveAI) console.log(`PASS live AI with explicit note: ${partTime.suggestion.answer}`);
    assert.equal(await prisma.trackedApplication.count({ where: { userId: user.profile!.id } }), 0, "Drafting creates no application or saved review");
    console.log("PASS draft policy, bounded professional evidence, user-note workflow, no implicit saving");

    if (!process.argv.includes("--browser")) return;
    globalThis.fetch = originalFetch;
    await prisma.account.create({ data: { userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(password) } });
    const origin = process.env.ASSISTANT_TEST_ORIGIN || "http://127.0.0.1:3004";
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const clientId = process.env.APPLICATION_EXTENSION_IDS!.split(",")[0];
    const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
    const connect = `/extension/connect?${new URLSearchParams({ clientId, state, challenge: createHash("sha256").update(verifier).digest("base64url") })}`;
    browser = await chromium.launch(); const context = await browser.newContext();
    context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(30_000);
    const page = await context.newPage();
    const signIn = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { Origin: origin }, data: { email, password } });
    assert.equal(signIn.status(), 200);
    console.log("Authenticated disposable browser account; checking aged-session approval");
    await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 2 * 86400_000) } });
    await page.goto(origin + connect, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Allow connection" }).click();
    try { await page.getByRole("heading", { name: "Confirm your sign-in" }).waitFor(); }
    catch (error) { console.log("Consent diagnostics", new URL(page.url()).pathname, await page.locator("body").innerText()); throw error; }
    console.log("Stale consent returned directly to confirm sign-in");
    assert.equal(await page.getByRole("textbox", { name: /^Email/ }).inputValue(), email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(u => u.pathname === "/extension/connect", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Allow connection" }).waitFor();
    await page.waitForTimeout(800);
    let callback = "";
    await page.route(`https://${clientId}.chromiumapp.org/**`, route => { callback = route.request().url(); return route.fulfill({ body: "Connection approved" }); });
    await page.getByRole("button", { name: "Allow connection" }).click();
    await page.waitForURL(`https://${clientId}.chromiumapp.org/**`);
    const parsed = new URL(callback); assert.equal(parsed.searchParams.get("state"), state);
    const grant = await exchangeExtensionCode({ clientId, verifier, code: parsed.searchParams.get("code") });
    assert.ok(Date.parse(grant.expiresAt) > Date.now() + 8 * 3600_000);
    const authRequest = new Request(`${origin}/api/extension/v1/contact`, { headers: { Authorization: `Bearer ${grant.token}` } });
    assert.equal((await authenticateExtension(authRequest)).userId, user.id);
    await context.request.post(`${origin}/api/auth/sign-out`, { headers: { Origin: origin }, data: {} });
    await assert.rejects(() => authenticateExtension(authRequest), /expired/i);
    console.log("PASS real stale-session reauthentication without logout, return to consent, PKCE, longer session-bound grant and sign-out revocation");
  } finally {
    await browser?.close(); globalThis.fetch = originalFetch; process.env.OPENAI_API_KEY = originalKey;
    await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
