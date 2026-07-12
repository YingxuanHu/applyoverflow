import assert from "node:assert/strict";
import test from "node:test";

import {
  extractBalancedTagContent,
  extractDescriptionFromHtml,
} from "../src/lib/ingestion/html-description";

// The opening `<div>` is 5 chars, so content starts at index 5 in these fixtures.
const AFTER_OPEN_DIV = 5;

test("extractBalancedTagContent returns full inner across nested same-name tags", () => {
  const html = "<div>A<div>B</div>C</div>";
  assert.equal(
    extractBalancedTagContent(html, "div", AFTER_OPEN_DIV),
    "A<div>B</div>C"
  );
});

test("extractBalancedTagContent treats <div /> (space-slash) as self-closing", () => {
  const html = "<div>A<div />B</div>";
  assert.equal(extractBalancedTagContent(html, "div", AFTER_OPEN_DIV), "A<div />B");
});

test("extractBalancedTagContent does not self-close on an unquoted attr ending in slash", () => {
  // `<div data-x=a/>` is an OPENING div (the slash ends the attribute value), so
  // depth must increment and the walker must find the OUTER close.
  const html = "<div>A<div data-x=a/>B</div>C</div>";
  assert.equal(
    extractBalancedTagContent(html, "div", AFTER_OPEN_DIV),
    "A<div data-x=a/>B</div>C"
  );
});

test("extractBalancedTagContent is case-insensitive", () => {
  const html = "<DIV>A<DiV>B</dIv>C</DIV>";
  assert.equal(
    extractBalancedTagContent(html, "div", AFTER_OPEN_DIV),
    "A<DiV>B</dIv>C"
  );
});

test("extractBalancedTagContent ignores false-prefix tags (<divider>)", () => {
  const html = "<div>A<divider>X</divider>B</div>";
  assert.equal(
    extractBalancedTagContent(html, "div", AFTER_OPEN_DIV),
    "A<divider>X</divider>B"
  );
});

test("extractBalancedTagContent returns the remainder on unclosed markup", () => {
  const html = "<div>A<div>B";
  assert.equal(extractBalancedTagContent(html, "div", AFTER_OPEN_DIV), "A<div>B");
});

test("extractDescriptionFromHtml captures a nested-div container whole (no first-</div> truncation)", () => {
  const html = `<html><body>
    <div class="job-description">
      <div><p>First critical point: you will design resilient network infrastructure across offices and cloud environments.</p></div>
      <div><ul><li>Own routing, switching, firewall, and wireless changes end to end.</li></ul></div>
      <div><p>Last critical point: requirements include five years of hands-on network engineering experience.</p></div>
    </div>
  </body></html>`;

  const text = extractDescriptionFromHtml(html);

  // The old lazy `([\s\S]*?)</div>` stopped at the first nested </div> and lost
  // everything after the first paragraph. The balanced walker keeps all of it.
  assert.match(text, /First critical point/);
  assert.match(text, /Own routing, switching/);
  assert.match(text, /Last critical point/);
});

test("extractDescriptionFromHtml is not corrupted by a </div> inside an inline script", () => {
  const html = `<html><body>
    <div class="job-description">
      <script>var marker = "</div>";</script>
      <p>Real complete description content that is long enough to pass the minimum candidate length threshold and be treated as a usable job description body.</p>
    </div>
  </body></html>`;

  const text = extractDescriptionFromHtml(html);

  assert.match(text, /Real complete description content/);
  assert.doesNotMatch(text, /var marker/);
});

test("extractDescriptionFromHtml keeps real content wrapped in a broadly-named noise element", () => {
  // A class/id false positive (here 'masthead') must not delete the real body:
  // the total-loss guard falls back to the un-stripped text.
  const html = `<html><body><div class="masthead"><div class="logo">BrandCo</div><p>We are hiring a Backend Engineer to build reliable, scalable services and improve deployment safety across the platform for engineering teams throughout the entire company every single day. You will own critical backend APIs, design resilient distributed systems, and partner closely with product and security to ship features that are correct and easy to support in production over the long term.</p></div></body></html>`;

  const text = extractDescriptionFromHtml(html);
  assert.match(text, /Backend Engineer/);
  assert.match(text, /resilient distributed systems/);
});

test("extractDescriptionFromHtml drops similar-jobs class noise but keeps the real body", () => {
  const html = `<html><body>
    <div class="job-description">
      <p>We are hiring a Platform Engineer to build reliable developer-facing systems and improve deployment safety across the organization every day.</p>
      <div class="similar-jobs"><div>Senior Cook</div><div>Warehouse Associate</div></div>
    </div>
  </body></html>`;

  const text = extractDescriptionFromHtml(html);

  assert.match(text, /Platform Engineer/);
  assert.doesNotMatch(text, /Warehouse Associate/);
});
