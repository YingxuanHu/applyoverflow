// Serializable, platform-independent intents. These describe profile facts and
// valid projections, not ATS selectors or a nearest-string guess at an answer.
export function createFieldSemantics() {
  const normalize = value => String(value || "").normalize("NFKC").toLowerCase()
    .replace(/\((?:required|optional)\)|[*\u2731\u2217]/g, " ")
    .replace(/[?:.]+$/, "").replace(/\s+/g, " ").trim();
  function resolve(label) {
    let text = normalize(label);
    for (let pass = 0; pass < 3; pass++) text = text
      .replace(/^(?:please )?(?:enter|provide|share|paste|specify)\s+/, "")
      .replace(/^(?:what is|what's)\s+/, "")
      .replace(/^(?:a )?link to\s+/, "")
      .replace(/^(?:your|applicant|candidate)\s+/, "");
    const sources = [];
    const remainder = text.replace(/\blinked[ -]?in\b|\bgit[ -]?hub\b|\bportfolio\b|\b(?:personal |professional )?(?:web\s?site|site)\b/g, noun => {
      const source = /linked/.test(noun) ? "linkedInUrl" : /hub/.test(noun) ? "githubUrl" : "portfolioUrl";
      if (!sources.includes(source)) sources.push(source);
      return " ";
    });
    // A disjunction permits one supported link. A conjunction requests multiple
    // facts, so never quietly substitute a single profile URL for it.
    if (sources.length && (sources.length === 1 || /\bor\b|\//.test(text)) && !/\band\b|&/.test(text) && !remainder
      .replace(/\b(?:a|the|one|of|following|public|personal|professional|similar|profile|url|link|address|or)\b/g, "")
      .replace(/[\s,/()]+/g, "")) {
      return { key: sources.length === 1 ? sources[0] : "professionalUrl", sources };
    }
    if (/^(?:(?:current|home|residential|present) )?location$/.test(text) ||
        /^where (?:are you(?: currently)?|do you(?: currently)? (?:live|reside))(?: (?:based|located|living))?$/.test(text))
      return { key: "city", projection: "location" };
    // Compose geographic components in the requested order. Unknown words
    // (preferred office, relocation, citizenship, etc.) invalidate the intent.
    const parts = [];
    const rest = text.replace(/\bcity\b|\btown\b|\bstate\b|\bprovince\b|\bregion\b|\bcountry\b/g, noun => {
      const key = /city|town/.test(noun) ? "city" : noun === "country" ? "country" : "region";
      if (!parts.includes(key)) parts.push(key);
      return " ";
    });
    if (parts.length > 1 && parts.includes("city") && !rest.replace(/\b(?:current|home|location|of residence|or)\b/g, "").replace(/[\s,/()]+/g, ""))
      return { key: "city", projection: "location", parts };
    return undefined;
  }
  function value(intent, contact, kind) {
    if (intent?.sources) {
      const saved = intent.sources.map(key => contact?.[key]).find(value => typeof value === "string" && value.trim());
      if (saved) return saved;
      // Older plans supplied only the shared professional URL. Its type must
      // still be among the question's allowed alternatives.
      try {
        const url = new URL(contact?.professionalUrl);
        const source = /(^|\.)linkedin\.com$/.test(url.hostname) ? "linkedInUrl" : url.hostname === "github.com" ? "githubUrl" : "portfolioUrl";
        if (["https:", "http:"].includes(url.protocol) && intent.sources.includes(source)) return url.href;
      } catch { /* No legacy URL. */ }
      return "";
    }
    if (intent?.projection === "location" && kind === "text") {
      const parts = intent.parts || ["city", "region", "country"];
      if (!contact?.city) return "";
      return parts.map(key => key === "country" ? ({ CA: "Canada", US: "United States" })[contact[key]] || contact[key] : contact[key])
        .filter(Boolean).join(", ");
    }
    return contact?.[intent?.key];
  }
  return { resolve, value };
}
