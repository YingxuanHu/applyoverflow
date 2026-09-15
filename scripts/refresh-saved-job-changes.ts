import "dotenv/config";
import { createBoundedMaintenanceClient } from "../src/lib/db";
import { refreshSavedJobChanges } from "../src/lib/queries/saved-job-changes";

const maintenance = createBoundedMaintenanceClient();
refreshSavedJobChanges(200, maintenance).then((result) => console.log(JSON.stringify(result)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => maintenance.$disconnect());
