// Independent, deliberately narrow checks for unambiguous applicant contacts.
// This does not reuse the extension detector or score employer-specific answers.
export const oracleKey = field => {
  if (/reference|emergency|employ|education|supervisor|billing|shipping|disabilit|declaration|attestation|signature/i.test(field.context || "") ||
      /signature|attestation/i.test(`${field.id || ""} ${field.name || ""}`)) return;
  const label = field.label.normalize("NFKC").replace(/[*:\u2731\u2217]|\(required\)|\(optional\)/gi, "").trim().toLowerCase();
  return { "first name": "givenName", "last name": "familyName", "full name": "fullName", name: "fullName",
    email: "email", "email address": "email", phone: "phone", "phone number": "phone",
    city: "city", location: "city", "location (city)": "city", "postal code": "postalCode", zip: "postalCode", "zip code": "postalCode",
    "address line 1": "streetAddress", "street address": "streetAddress", "linkedin url": "linkedInUrl", "linkedin profile": "linkedInUrl" }[label];
};

export const oracleMatches = (contact, key, value) => {
  if (typeof value !== "string") return false;
  if (key === "phone") {
    const digits = value.replace(/\D/g, "");
    return (digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits) === contact.phone;
  }
  // The synthetic cohort always uses Richmond, Virginia, not Richmond, CA/UK.
  if (key === "city" && contact.city === "Richmond" && contact.region === "VA" && contact.country === "US") {
    return new Set(["richmond", "richmond, va", "richmond, virginia", "richmond, va, usa",
      "richmond, va, united states", "richmond, virginia, united states"]).has(value.trim().toLowerCase());
  }
  return value.trim() === contact[key];
};
