import assert from "node:assert/strict";
import test from "node:test";
import { groupFeedEntries } from "../src/lib/jobs/feed-groups";

test("group repeated titles without dropping distinct requisitions or locations", () => {
  const rows = [
    { id: "a", job: { company: "Laporte", title: "Junior Refrigeration Engineer/EIT", location: "Toronto" } },
    { id: "b", job: { company: "Other", title: "Software Engineer", location: "Toronto" } },
    { id: "c", job: { company: "Laporte", title: "Junior Refrigeration Engineer/EIT", location: "Brossard" } },
    { id: "d", job: { company: "Laporte", title: "Junior Refrigeration Engineer/EIT", location: "Brossard" } },
    { id: "e", job: { company: "Laporte", title: "Senior Refrigeration Engineer/EIT", location: "Brossard" } },
  ];
  assert.deepEqual(groupFeedEntries(rows).map((group) => group.map((row) => row.id)), [["a", "c", "d"], ["b"], ["e"]]);
  assert.equal(groupFeedEntries(rows).flat().length, rows.length);
});

test("unknown or confidential employers are never grouped together", () => {
  const rows = ["a", "b"].map((id) => ({ id, job: { company: "Unknown Company", title: "Engineer" } }));
  assert.equal(groupFeedEntries(rows).length, 2);
});
