import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import {
  ANSWER_LIBRARY_KEY,
  parseAssistantState,
} from "../../src/lib/application-assistant";
import {
  authorizeExtension,
  exchangeExtensionCode,
  authenticateExtension,
  captureApplicationQuestions,
  saveApplicationQuestionReview,
  getApplicationQuestionReview,
  getExtensionContact,
  hashSecret,
  getExtensionHistory,
  confirmExtensionApplication,
} from "../../src/lib/queries/application-assistant";

async function main() {
  if (!isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL))
    throw new Error("Local database required");
  const suffix = randomBytes(8).toString("hex");
  const clientId = "a".repeat(32);
  process.env.APPLICATION_EXTENSION_IDS = clientId;
  const user = await prisma.user.create({
    data: {
      email: `assistant-${suffix}@example.test`,
      name: "Assistant Test",
      profile: {
        create: {
          email: `assistant-${suffix}@example.test`,
          name: "Assistant Test",
          contactJson: {
            fullName: "Test Name",
            email: "test@example.test",
            givenName: "Test",
            familyName: "Name",
            workAuthorization: "secret",
          },
          experiencesJson: [
            { title: "Analyst", company: "Example", time: "2020 - 2022" },
          ],
        },
      },
    },
  });
  const other = await prisma.user.create({
    data: { email: `assistant-other-${suffix}@example.test`, name: "Other" },
  });
  let canonicalId: string | undefined;
  try {
    const session = await prisma.session.create({
      data: {
        token: randomBytes(32).toString("hex"),
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const verifier = randomBytes(32).toString("base64url");
    const request = {
      clientId,
      challenge: hashSecret(verifier),
      state: randomBytes(32).toString("base64url"),
    };
    const code = await authorizeExtension(
      { authUserId: user.id, sessionId: session.id },
      request,
    );
    await assert.rejects(() =>
      exchangeExtensionCode({ clientId, code, verifier: "b".repeat(43) }),
    );
    const exchanged = await Promise.allSettled([
      exchangeExtensionCode({ clientId, code, verifier }),
      exchangeExtensionCode({ clientId, code, verifier }),
    ]);
    assert.equal(
      exchanged.filter((item) => item.status === "fulfilled").length,
      1,
    );
    const success = exchanged.find((item) => item.status === "fulfilled")!;
    if (success.status !== "fulfilled") throw new Error("No token");
    const http = new Request("http://localhost/api/extension/contact", {
      headers: { Authorization: `Bearer ${success.value.token}` },
    });
    assert.equal((await authenticateExtension(http)).userId, user.id);
    assert.equal(
      "workAuthorization" in (await getExtensionContact(user.id)),
      false,
    );
    assert.equal((await getExtensionContact(user.id)).givenName, "Test");
    const history = await getExtensionHistory(user.id);
    assert.ok(history.entries);
    if (!history.entries) throw new Error("Missing entries");
    assert.equal(history.entries.length, 1);
    assert.equal(JSON.stringify(history).includes("secret"), false);
    const selected = await getExtensionHistory(user.id, {
      kind: "experience",
      index: 0,
      revision: history.revision,
    });
    assert.ok(selected.entry);
    if (!selected.entry) throw new Error("Missing entry");
    assert.equal(
      selected.entry.dates,
      undefined,
      "legacy dates are not guessed",
    );
    await assert.rejects(() => getExtensionHistory(other.id));
    await assert.rejects(() =>
      getExtensionHistory(user.id, {
        kind: "experience",
        index: 0,
        revision: "2020-01-01T00:00:00.000Z",
      }),
    );
    await assert.rejects(() =>
      getExtensionHistory(user.id, {
        kind: "experience",
        index: 49,
        revision: history.revision,
      }),
    );
    await assert.rejects(() =>
      authenticateExtension(
        new Request("http://localhost", {
          headers: { Cookie: "some-web-session" },
        }),
      ),
    );
    const payload = {
      url: "https://boards.greenhouse.io/fixture/jobs/123",
      title: "Test Engineer",
      questions: ["Why this role?", "Do you need sponsorship?"],
    };
    const captures = await Promise.all([
      captureApplicationQuestions(user.id, payload),
      captureApplicationQuestions(user.id, payload),
    ]);
    assert.equal(captures[0].id, captures[1].id);
    const id = captures[0].id;
    const record = await prisma.trackedApplication.findUniqueOrThrow({
      where: { id },
    });
    assert.equal(record.status, "PREPARING");
    const external = {
      url: "https://careers.example.com/apply?job=123",
      title: "External analyst",
      company: "Example",
      confirmed: true,
    };
    await assert.rejects(() =>
      confirmExtensionApplication(user.id, { ...external, confirmed: false }),
    );
    const confirmations = await Promise.all([
      confirmExtensionApplication(user.id, external),
      confirmExtensionApplication(user.id, external),
    ]);
    assert.equal(confirmations[0].id, confirmations[1].id);
    const tracked = await prisma.trackedApplication.findUniqueOrThrow({
      where: { id: confirmations[0].id },
      include: { events: true },
    });
    assert.equal(tracked.canonicalJobId, null);
    assert.equal(tracked.status, "APPLIED");
    assert.equal(
      tracked.events.filter((event) => event.type === "APPLIED").length,
      1,
    );
    await prisma.trackedApplication.update({
      where: { id: tracked.id },
      data: { status: "INTERVIEW" },
    });
    await confirmExtensionApplication(user.id, external);
    assert.equal(
      (
        await prisma.trackedApplication.findUniqueOrThrow({
          where: { id: tracked.id },
        })
      ).status,
      "INTERVIEW",
      "repeated confirmation must not regress progress",
    );
    const separateOwner = await confirmExtensionApplication(other.id, external);
    assert.notEqual(separateOwner.id, tracked.id);
    const preparing = await captureApplicationQuestions(user.id, {
      url: external.url.replace("123", "456"),
      title: "Another role",
      questions: ["Why here?"],
    });
    await confirmExtensionApplication(user.id, {
      ...external,
      url: external.url.replace("123", "456"),
    });
    const confirmed = await prisma.trackedApplication.findUniqueOrThrow({
      where: { id: preparing.id },
    });
    assert.equal(confirmed.status, "APPLIED");
    assert.equal(confirmed.company, external.company);
    assert.equal(confirmed.roleTitle, external.title);
    assert.ok(confirmed.assistantState, "confirmation preserves review drafts");
    const workday = {
      url: "https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Analyst_R123",
      title: "Analyst",
      questions: ["Why this role?"],
    };
    const firstWorkday = await captureApplicationQuestions(user.id, workday);
    const appliedWorkday = await confirmExtensionApplication(user.id, {
      ...external,
      url:
        workday.url.replace("Toronto", "Toronto%2C-Ontario") +
        "/apply/myExperience",
    });
    assert.equal(
      appliedWorkday.id,
      firstWorkday.id,
      "Workday location rewrites do not duplicate applications",
    );
    assert.equal(await getApplicationQuestionReview(other.id, id), null);
    const state = parseAssistantState(record.assistantState)!;
    await assert.rejects(() =>
      saveApplicationQuestionReview(other.id, id, {
        revision: state.revision,
        answers: [],
      }),
    );
    await assert.rejects(() =>
      saveApplicationQuestionReview(user.id, id, { revision: 0, answers: [] }),
    );
    await assert.rejects(() =>
      saveApplicationQuestionReview(user.id, id, {
        revision: state.revision,
        answers: [
          { key: "do you need sponsorship?", answer: "No", remember: true },
        ],
      }),
    );
    const saved = await saveApplicationQuestionReview(user.id, id, {
      revision: state.revision,
      answers: [
        { key: "why this role?", answer: "My approved answer", remember: true },
      ],
    });
    assert.equal(saved.revision, state.revision + 1);
    await captureApplicationQuestions(user.id, {
      ...payload,
      questions: ["Anything else?"],
    });
    const reviewed = await getApplicationQuestionReview(user.id, id);
    assert.equal(reviewed?.reference.experience[0].title, "Analyst");
    assert.equal(JSON.stringify(reviewed?.reference).includes("secret"), false);
    assert.equal(
      Object.getPrototypeOf(reviewed!.suggestions),
      Object.prototype,
      "review suggestions must be serializable as React client props",
    );
    assert.equal(reviewed?.state?.questions[0].answer, "My approved answer");
    assert.equal(reviewed?.state?.questions.length, 3);
    const second = await captureApplicationQuestions(user.id, {
      ...payload,
      url: payload.url.replace("123", "456"),
    });
    assert.equal(
      (await getApplicationQuestionReview(user.id, second.id))?.suggestions[
        "why this role?"
      ],
      "My approved answer",
    );
    const unrelated = await captureApplicationQuestions(user.id, {
      ...payload,
      url: payload.url.replace("fixture", "another"),
    });
    assert.deepEqual(
      Object.keys(
        (await getApplicationQuestionReview(user.id, unrelated.id))
          ?.suggestions ?? {},
      ),
      [],
    );
    for (const [host, step] of [
      ["jobs.lever.co", "apply"],
      ["jobs.ashbyhq.com", "application"],
    ]) {
      const base = `https://${host}/fixture/ac978161-6f46-4f6b-ad9e-a258e642751c`;
      const first = await captureApplicationQuestions(user.id, {
        ...payload,
        url: base,
      });
      const repeated = await captureApplicationQuestions(user.id, {
        ...payload,
        url: `${base}/${step}?utm_source=test`,
      });
      assert.equal(first.id, repeated.id);
      const review = await getApplicationQuestionReview(user.id, repeated.id);
      assert.equal(review?.state?.sourceUrl, base);
      assert.equal(review?.state?.revision, 2);
      assert.deepEqual(Object.keys(review?.suggestions ?? {}), []);
    }
    await prisma.trackedApplication.update({
      where: { id },
      data: { status: "APPLIED" },
    });
    await captureApplicationQuestions(user.id, payload);
    assert.equal(
      (await prisma.trackedApplication.findUniqueOrThrow({ where: { id } }))
        .status,
      "APPLIED",
    );
    assert.equal(
      await prisma.applicationSubmission.count({
        where: { user: { authUserId: user.id } },
      }),
      0,
    );
    const library = await prisma.userPreference.findFirst({
      where: { user: { authUserId: user.id }, key: ANSWER_LIBRARY_KEY },
    });
    assert.ok(library?.value.includes("My approved answer"));
    await prisma.session.delete({ where: { id: session.id } });
    await assert.rejects(() => authenticateExtension(http));
    assert.equal(
      await prisma.extensionConnection.count({ where: { userId: user.id } }),
      0,
    );
    const knownUrl = `https://job-boards.greenhouse.io/fixture-${suffix}/jobs/999`;
    const canonical = await prisma.jobCanonical.create({
      data: {
        title: "Known fixture job",
        company: "Known fixture company",
        location: "Toronto",
        workMode: "REMOTE",
        employmentType: "FULL_TIME",
        description: "Synthetic",
        shortSummary: "Synthetic",
        roleFamily: "FINANCE",
        applyUrl: knownUrl,
        applyUrlKey: knownUrl.replace("https://", ""),
        postedAt: new Date(),
        status: "REMOVED",
      },
    });
    canonicalId = canonical.id;
    const linked = await captureApplicationQuestions(user.id, {
      ...payload,
      url: knownUrl,
    });
    assert.equal(
      (
        await prisma.trackedApplication.findUniqueOrThrow({
          where: { id: linked.id },
        })
      ).canonicalJobId,
      canonical.id,
    );
    assert.equal(
      (await getApplicationQuestionReview(user.id, linked.id))?.company,
      "Known fixture company",
    );
    const again = await captureApplicationQuestions(user.id, {
      ...payload,
      url: knownUrl.replace("job-boards.", "boards.") + "?utm_source=test",
    });
    assert.equal(again.id, linked.id);
    console.log(
      "PASS: PKCE, replay race, minimal contact, owner isolation, capture dedupe, revision conflicts, sensitive answers, scoped suggestions, status preservation, session revocation",
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [user.id, other.id] } },
    });
    if (canonicalId)
      await prisma.jobCanonical.delete({ where: { id: canonicalId } });
    await prisma.$disconnect();
  }
}
void main();
