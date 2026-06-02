import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FIRST_PARTY_COMPANY_SEEDS_PATH,
  classifyFirstPartyCompanySeed,
  parseFirstPartyCompanySeedCsv,
  selectFirstPartyCompanySeeds,
  splitCompanySelection,
} from "../src/lib/ingestion/official-company-seeds";

test("first-party company seed CSV parses the provided company list", () => {
  const csv = readFileSync(FIRST_PARTY_COMPANY_SEEDS_PATH, "utf8");
  const seeds = parseFirstPartyCompanySeedCsv(csv);

  assert.ok(seeds.length >= 420);
  assert.deepEqual(
    {
      rank: seeds[0]?.rank,
      companyName: seeds[0]?.companyName,
      companyKey: seeds[0]?.companyKey,
      priorityTier: seeds[0]?.priorityTier,
    },
    {
      rank: 1,
      companyName: "Amazon",
      companyKey: "amazon",
      priorityTier: 1,
    }
  );
});

test("first-party seed selection filters by company and tier", () => {
  const csv = readFileSync(FIRST_PARTY_COMPANY_SEEDS_PATH, "utf8");
  const seeds = parseFirstPartyCompanySeedCsv(csv);
  const selected = selectFirstPartyCompanySeeds(seeds, {
    companies: splitCompanySelection("amazon, apple, no such company"),
    priorityTier: 1,
  });

  assert.deepEqual(
    selected.map((seed) => seed.companyKey),
    ["amazon", "apple"]
  );
});

test("first-party seed classifier promotes only implemented official connectors", () => {
  const csv = readFileSync(FIRST_PARTY_COMPANY_SEEDS_PATH, "utf8");
  const seedsByKey = new Map(
    parseFirstPartyCompanySeedCsv(csv).map((seed) => [seed.companyKey, seed])
  );

  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("amazon")!).kind, "official_connector");
  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("apple")!).kind, "official_connector");
  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("microsoft")!).kind, "official_connector");
  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("nvidia")!).kind, "official_connector");
  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("google")!).kind, "official_connector");
  assert.equal(classifyFirstPartyCompanySeed(seedsByKey.get("netflix")!).kind, "official_connector");

  const meta = classifyFirstPartyCompanySeed(seedsByKey.get("meta")!);
  assert.equal(meta.kind, "deferred");
  assert.equal(meta.recommendation, "blocked");
});
