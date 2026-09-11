import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readRepoFile(path: string) {
  return readFileSync(path, "utf8");
}

describe("natural language job search integration", () => {
  it("keeps AI search as an interpreted handoff inside the standard jobs search bar", () => {
    const pageSource = readRepoFile("src/app/jobs/page.tsx");
    const topPicksPageSource = readRepoFile("src/app/jobs/top-picks/page.tsx");
    const componentSource = readRepoFile("src/components/jobs/jobs-search-form.tsx");
    const routeSource = readRepoFile("src/app/api/jobs/natural-language-search/route.ts");

    assert.match(pageSource, /<JobsSearchForm/);
    assert.doesNotMatch(pageSource, /NaturalLanguageJobSearch/);
    assert.match(topPicksPageSource, /basePath="\/jobs\/top-picks"/);
    assert.match(componentSource, /\/api\/jobs\/natural-language-search/);
    assert.match(componentSource, /router\.push\(href\)/);
    assert.match(componentSource, /searchResult\.params/);
    assert.match(componentSource, /SpeechRecognition/);
    assert.match(componentSource, /webkitSpeechRecognition/);
    assert.match(componentSource, /interimResults = true/);
    assert.match(componentSource, /Describe a role, location, level, or work style/);
    assert.match(componentSource, /AI search/);
    assert.match(componentSource, /mergeNaturalLanguageJobsSearch/);
    assert.match(componentSource, /Use voice input/);
    assert.match(componentSource, /basePath/);
    assert.match(componentSource, /showJobsLoadingPopup\(href\)/);
    assert.match(routeSource, /parseNaturalLanguageJobSearch/);
    assert.match(routeSource, /API_RATE_LIMITS\.naturalLanguageJobSearch/);
    assert.match(routeSource, /MAX_NATURAL_LANGUAGE_SEARCH_LENGTH = 600/);
    assert.doesNotMatch(routeSource, /getJobs\(/);
  });
});
