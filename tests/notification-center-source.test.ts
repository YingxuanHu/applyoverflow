import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("notification center surfaces deadlines, reminders, and automated status updates", () => {
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const trackerSource = readRepoFile("src/lib/queries/tracker.ts");
  const remindersSource = readRepoFile("src/lib/reminders.ts");
  const pageSource = readRepoFile("src/app/notifications/page.tsx");
  const topBarSource = readRepoFile("src/components/layout/top-bar.tsx");
  const topBarInnerSource = readRepoFile("src/components/layout/top-bar-inner.tsx");
  const sidebarSource = readRepoFile("src/components/layout/nav-sidebar.tsx");
  const mobileNavSource = readRepoFile("src/components/layout/mobile-nav-sheet.tsx");

  assert.match(schemaSource, /APPLICATION_STATUS_CHANGED/);
  assert.match(trackerSource, /applyAutomatedTrackedApplicationStatusUpdate/);
  assert.match(trackerSource, /Status updated from .* after an email update/);
  assert.match(trackerSource, /type: "APPLICATION_STATUS_CHANGED"/);
  assert.match(trackerSource, /dismissNotification/);
  assert.match(trackerSource, /dismissReadNotifications/);
  assert.match(trackerSource, /type: true/);
  assert.match(remindersSource, /input\.status === "WISHLIST" \|\| input\.status === "PREPARING"/);
  assert.match(remindersSource, /isSavedJob \? "Saved job" : "Application"/);
  assert.match(remindersSource, /\$\{targetLabel\} deadline/);
  assert.match(pageSource, /getNotificationCategory/);
  assert.match(pageSource, /Clear read/);
  assert.match(pageSource, />\s*Dismiss\s*</);
  assert.match(pageSource, /\/applications\/\$\{notification\.trackedApplicationId\}/);
  assert.match(topBarSource, /unreadNotificationCount/);
  assert.match(topBarInnerSource, /Notifications, \$\{unreadNotificationCount\} unread/);
  assert.match(sidebarSource, /href: "\/notifications"/);
  assert.match(mobileNavSource, /href: "\/notifications"/);
});
