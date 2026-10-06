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
