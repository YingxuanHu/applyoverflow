import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse, type AtRule, type Rule } from "postcss";

const styles = parse(readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8"));
const panelSelectors = [
  ".app-scroll-root [data-job-list-scroll]",
  ".app-scroll-root [data-description-scroll]",
];

function containmentRule() {
  const matches: Rule[] = [];
  styles.walkRules((rule) => {
    if (rule.selectors.some((selector) => panelSelectors.includes(selector))) {
      matches.push(rule);
    }
  });
  assert.equal(matches.length, 1, "both feed panels should share one containment rule");
  return matches[0];
}

test("job scroll containment targets the inner panels, not the whole page", () => {
  const rule = containmentRule();
  assert.deepEqual(rule.selectors, panelSelectors);
  const declarations: Record<string, string> = {};
  rule.walkDecls((declaration) => { declarations[declaration.prop] = declaration.value; });
  assert.deepEqual(declarations, { "overscroll-behavior-y": "contain" });
});

test("job scroll containment starts only at the two-column lg breakpoint", () => {
  const rule = containmentRule();
  assert.equal(rule.parent?.type, "atrule");
  const media = rule.parent as AtRule;
  assert.equal(media.name, "media");
  assert.equal(media.params, "(min-width: 64rem)", "stacked mobile/tablet must still scroll the page");
});

test("the shared job feed retains both scroll-containment hooks", () => {
  const component = readFileSync(new URL("../src/components/jobs/job-feed-master-detail.tsx", import.meta.url), "utf8");
  assert.match(component, /data-job-list-scroll/);
  assert.match(component, /data-description-scroll/);
});
