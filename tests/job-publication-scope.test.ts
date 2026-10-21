import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";

test("publication rechecks occupation and geography independently of old classification", async () => {
  const { shouldExcludeFromFeedIndex } = await import("../src/lib/ingestion/search-index");
  const now = new Date();
  const valid = {
    title: "People Operations Manager", company: "Example Inc", location: "Toronto, ON, Canada", region: "CA" as const,
    description: "Lead people operations and employee development. Work with business teams to improve hiring, training, retention and employee experience. Responsibilities include developing HR policies, reporting and organizational planning. Requirements include experience in people operations and clear communication skills.",
    shortSummary: "Lead people operations and organizational planning", workMode: "HYBRID", status: "LIVE", availabilityScore: 100,
    applyUrl: "https://example.com/jobs/people-operations", sourceCount: 1, titleConfidence: 1, titleStatus: "verified",
    applyUrlValidationStatus: null, deadline: null, deadSignalAt: null, lastSourceSeenAt: now, lastConfirmedAliveAt: now, now,
  };
  assert.equal(shouldExcludeFromFeedIndex(valid), false);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, description: "", shortSummary: valid.description }), true, "a summary cannot substitute for a missing posting");
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, description: "<div class='padding'>".repeat(20) + "Apply now" + "</div>".repeat(20) }), true, "markup is not description content");
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, descriptionStatus: "page_chrome" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Grocery Clerk Part Time Day" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "HMR Clerk Part Time Evening" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Account Manager:in - Vertriebsaußendienst in Berlin", location: "Remote job", region: null }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "B2B Communications Manager, LATAM", location: "Hybrid", region: null }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "EMEA Partnerships Manager", location: "New York, NY", region: "US" }), false);
  for (const title of ["Bakery InStore Clerk Part Time Day", "Bakery In-Store Clerk Part Time Evening", "Produce In Store Clerk", "InStore Associate"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), true, title);
  }
  for (const title of ["Bakery Operations Analyst", "Retail Software Engineer", "Grocery Supply Chain Manager"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), false, title);
  }
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, location: "Kediri, Jawa Timur, ID" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Healthcare Administration Director" }), false);
  for (const title of ["Principal Wealth Advisor", "Principal Wealth Adviser", "Principal Advisor", "Principal Investment Advisor"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), false, title);
  }
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Senior Scientist, Analytical Development and Quality Control", location: "Brisbane, CA", region: null }), false);
  for (const title of ["School Principal", "Elementary School Principal", "Principal Teacher"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), true, title);
  }
  for (const title of ["Pharmacy Benefits Analyst", "Dental Billing Specialist", "Police Records Clerk", "Hospital Revenue Cycle Manager"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), false, title);
  }
  for (const title of ["Pharmacy Technician", "Dental Assistant", "Police Officer", "Registered Nurse"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), true, title);
  }
  for (const title of ["Overnight Driver-Warehouse", "Housekeeping & Laundry Assistant", "Warehouse Worker", "Material Handler II", "Production Operator", "Assembly Technician", "Security Guard", "Field Technician II", "Geotechnical Lab Technician", "Retail Sales Associate", "Automotive General Service Technician", "Quick Lube Technician", "Skilled Auto Technician"] ) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), true, title);
  }
  for (const title of ["Warehouse Systems Analyst", "Manufacturing Software Engineer", "Hospitality Manager", "Director of Housekeeping", "IT Field Technician", "Research Scientist", "Supply Chain Analyst", "Retail Sales Operations Analyst"]) {
    assert.equal(shouldExcludeFromFeedIndex({ ...valid, title }), false, title);
  }
});
