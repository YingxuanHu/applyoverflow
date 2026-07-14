import assert from "node:assert/strict";
import test from "node:test";

import { decideSourcePromotionLifecycle } from "../src/lib/ingestion/source-promotion-lifecycle";

test("new ATS frontier source is provisioned for validation", () => {
  assert.deepEqual(decideSourcePromotionLifecycle(null), {
    preserveExistingLifecycle: false,
    enqueueValidation: true,
  });
});

test("healthy ATS source keeps lifecycle state during a repeated frontier signal", () => {
  assert.deepEqual(
    decideSourcePromotionLifecycle({
      status: "ACTIVE",
      validationState: "VALIDATED",
      pollState: "READY",
    }),
    {
      preserveExistingLifecycle: true,
      enqueueValidation: false,
    }
  );
});

test("backed-off ATS source is not reset or revalidated by repeated discovery", () => {
  assert.deepEqual(
    decideSourcePromotionLifecycle({
      status: "DEGRADED",
      validationState: "SUSPECT",
      pollState: "BACKOFF",
    }),
    {
      preserveExistingLifecycle: true,
      enqueueValidation: false,
    }
  );
});

test("quarantined ATS source is not retried without new evidence", () => {
  assert.deepEqual(
    decideSourcePromotionLifecycle({
      status: "REDISCOVER_REQUIRED",
      validationState: "INVALID",
      pollState: "QUARANTINED",
    }),
    {
      preserveExistingLifecycle: true,
      enqueueValidation: false,
    }
  );
});

test("already provisioned ATS source keeps its state and its existing validation task", () => {
  assert.deepEqual(
    decideSourcePromotionLifecycle({
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
    }),
    {
      preserveExistingLifecycle: true,
      enqueueValidation: true,
    }
  );
});
