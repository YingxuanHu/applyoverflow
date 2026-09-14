import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyLogo } from "../src/components/company-logo";

test("server-rendered company images are visible without waiting for hydration", () => {
  const html = renderToStaticMarkup(
    createElement(CompanyLogo, { company: "Stripe", domain: "stripe.com" }),
  );
  assert.match(html, /src="\/api\/company-logo\?domain=stripe.com"/);
  assert.match(html, /size-7/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /opacity-0|visibility:\s*hidden|display:\s*none/);
});

test("unknown employer identity keeps an equally sized, noninteractive initials fallback", () => {
  const html = renderToStaticMarkup(
    createElement(CompanyLogo, {
      company: "Unknown Employer",
      domain: "jobs.lever.co",
    }),
  );
  assert.match(html, /size-7/);
  assert.match(html, />UE<\/span>/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<img|<button|<a /);
});
