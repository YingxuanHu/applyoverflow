import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readRepoFile(path: string) {
  return readFileSync(path, "utf8");
}

describe("natural language job search integration", () => {
  it("keeps natural language search as an interpreted handoff to normal jobs filters", () => {
    const pageSource = readRepoFile("src/app/jobs/page.tsx");
    const componentSource = readRepoFile("src/components/jobs/natural-language-job-search.tsx");
    const routeSource = readRepoFile("src/app/api/jobs/natural-language-search/route.ts");

    assert.match(pageSource, /NaturalLanguageJobSearch/);
    assert.match(componentSource, /\/api\/jobs\/natural-language-search/);
    assert.match(componentSource, /router\.push\(searchResult\.href\)/);
    assert.match(componentSource, /searchResult\.href/);
    assert.match(componentSource, /SpeechRecognition/);
    assert.match(componentSource, /webkitSpeechRecognition/);
    assert.match(componentSource, /interimResults = true/);
    assert.match(componentSource, /Type or speak what jobs you want/);
    assert.match(componentSource, /Find jobs/);
    assert.doesNotMatch(componentSource, /Use this search/);
    assert.doesNotMatch(componentSource, /Interpret/);
    assert.doesNotMatch(componentSource, /confidence/);
    assert.doesNotMatch(componentSource, /Listening and transcribing as you speak/);
    assert.match(routeSource, /parseNaturalLanguageJobSearch/);
    assert.match(routeSource, /API_RATE_LIMITS\.naturalLanguageJobSearch/);
    assert.match(routeSource, /MAX_NATURAL_LANGUAGE_SEARCH_LENGTH = 600/);
    assert.doesNotMatch(routeSource, /getJobs\(/);
  });
});
