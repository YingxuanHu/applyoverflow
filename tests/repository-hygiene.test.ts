import assert from "node:assert/strict";
import test from "node:test";
import { prohibitedRepositoryPath } from "../scripts/check-repository.mjs";

test("repository hygiene rejects private and generated artifacts", () => {
  for (const path of [".env", ".env.local", "deploy/single-vps/.env.production", "data/uploads/resume.pdf", "data/automation-screenshots/run/form.png", "output/check.png", ".vercel/project.json", "logs/worker.log", "database.dump", "backup.bundle", "tsconfig.tsbuildinfo", "200"]) {
    assert.equal(prohibitedRepositoryPath(path), true, path);
  }
});

test("repository hygiene permits templates, source data, docs and product assets", () => {
  for (const path of [".env.example", "deploy/single-vps/.env.production.example", "deploy/single-vps/.env.staging.example", "public/brand/logo.png", "data/discovery/seeds/companies.csv", "src/app/page.tsx", "AGENTS.md", "docs/README.md", "vercel.json"]) {
    assert.equal(prohibitedRepositoryPath(path), false, path);
  }
});
