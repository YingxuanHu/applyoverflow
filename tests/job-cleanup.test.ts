import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeJobTitle } from "../src/lib/job-cleanup";

test("does not collapse role titles to location suffixes", () => {
  assert.equal(
    sanitizeJobTitle("Territory Sales Representative - Montreal"),
    "Territory Sales Representative"
  );
  assert.equal(
    sanitizeJobTitle(
      "Adjoint ou adjointe, Expansion des affaires, Investly - Montréal / Investly Business Development Associate - Montreal"
    ),
    "Investly Business Development Associate"
  );
  assert.equal(
    sanitizeJobTitle("Éclairagiste d’expérience - Experienced Lighter - Montreal"),
    "Experienced Lighter"
  );
  assert.equal(
    sanitizeJobTitle("AI Trainer - Graphical Abstract - Physics (Remote - Toronto)"),
    "AI Trainer"
  );
});
