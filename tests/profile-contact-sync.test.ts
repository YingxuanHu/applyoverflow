import assert from "node:assert/strict";
import test from "node:test";

import { contactToProfileColumnUpdates } from "../src/lib/profile-contact-sync";

test("contactToProfileColumnUpdates: copies the flat contact fields into a Prisma update payload", () => {
  assert.deepEqual(
    contactToProfileColumnUpdates({
      fullName: "Alvin Hu",
      email: "alvin.hu@mail.utoronto.ca",
      phone: "+1 416 555 1234",
      location: "Toronto, ON",
      linkedInUrl: "https://linkedin.com/in/alvinhu",
      githubUrl: "https://github.com/alvinhu",
      portfolioUrl: "https://alvinhu.com",
    }),
    {
      phone: "+1 416 555 1234",
      location: "Toronto, ON",
      linkedinUrl: "https://linkedin.com/in/alvinhu",
      githubUrl: "https://github.com/alvinhu",
      portfolioUrl: "https://alvinhu.com",
    }
  );
});

test("contactToProfileColumnUpdates: turns empty strings into null so 'Not set' renders properly", () => {
  // Application/profile surfaces use `?? "Not set"` against direct columns,
  // meaning a blank string would skip that fallback and render an empty field.
  // Coerce to null so the user clearly sees the missing-data state.
  assert.deepEqual(
    contactToProfileColumnUpdates({
      fullName: "",
      email: "",
      phone: "",
      location: "",
      linkedInUrl: "",
      githubUrl: "",
      portfolioUrl: "",
    }),
    {
      phone: null,
      location: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    }
  );
});

test("contactToProfileColumnUpdates: trims whitespace before storing", () => {
  // Users routinely paste URLs with leading/trailing whitespace. The
  // direct-column copy should normalize so downstream comparisons and exports
  // don't trip on stray spaces.
  assert.deepEqual(
    contactToProfileColumnUpdates({
      fullName: "  ",
      email: "  ",
      phone: "  +1 555  ",
      location: "  ",
      linkedInUrl: " https://linkedin.com/in/x  ",
      githubUrl: "  ",
      portfolioUrl: "  ",
    }),
    {
      phone: "+1 555",
      location: null,
      linkedinUrl: "https://linkedin.com/in/x",
      githubUrl: null,
      portfolioUrl: null,
    }
  );
});
