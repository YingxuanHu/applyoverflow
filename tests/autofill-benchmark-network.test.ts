import assert from "node:assert/strict";
import { test } from "node:test";
import { isReadOnlyCatalogRequest } from "../scripts/lib/autofill-benchmark-network.mjs";

test("benchmark allows verified location catalog queries, never application mutations", () => {
  const url = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiAutocompleteGeoLocation";
  const payload = { operationName: "ApiAutocompleteGeoLocation", variables: { text: "Richmond" },
    query: "query ApiAutocompleteGeoLocation($text: String!) { result: autocompleteGeoLocation(text: $text) { suggestions { name } } }" };
  const allowed = (data: unknown, endpoint = url) => isReadOnlyCatalogRequest({ url: endpoint, method: "POST", postData: JSON.stringify(data) });
  assert.equal(allowed(payload), true);
  assert.equal(allowed({ ...payload, query: "mutation ApiAutocompleteGeoLocation { submitApplication }" }), false);
  assert.equal(allowed({ ...payload, operationName: "SubmitApplication" }), false);
  assert.equal(allowed({ ...payload, variables: { text: "Richmond", email: "jordan@example.test" } }), false);
  assert.equal(allowed(payload, url.replace("jobs.ashbyhq.com", "other.example")), false);
  assert.equal(allowed(payload, url.replace("ApiAutocompleteGeoLocation", "SubmitApplication")), false);
  assert.equal(isReadOnlyCatalogRequest({ url, method: "POST", postData: "invalid JSON" }), false);
});

test("Workday source catalogs are allowed but candidate writes remain blocked", () => {
  const url = "https://example.wd1.myworkdayjobs.com/wday/calypso/cxs/jobapplication/example/values/sources/sources";
  assert.equal(isReadOnlyCatalogRequest({ url, method: "GET" }), true);
  const nested = `${url}/12f4eb641e1c10005553491e16ec0000/7e82e399ba7910ae480e5f7a17d4fbb1`;
  assert.equal(isReadOnlyCatalogRequest({ url: nested, method: "GET" }), true);
  assert.equal(isReadOnlyCatalogRequest({ url: nested, method: "POST" }), false);
  assert.equal(isReadOnlyCatalogRequest({ url: `${nested}/candidate`, method: "GET" }), false);
  assert.equal(isReadOnlyCatalogRequest({ url, method: "POST" }), false);
  assert.equal(isReadOnlyCatalogRequest({ url: url.replace("values/sources/sources", "candidate/update"), method: "POST" }), false);
  assert.equal(isReadOnlyCatalogRequest({ url: url.replace("example.wd1.myworkdayjobs.com", "evil.example"), method: "GET" }), false);
});
