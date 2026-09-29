// Serialized into the isolated world with each inspector factory.
export function createFieldValidity() {
  const patterns = new WeakMap();
  const constraints = ["valueMissing", "typeMismatch", "tooLong", "tooShort", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput", "customError"];
  return function fieldValid(field) {
    try {
      const validity = field.validity;
      if (!validity) return true;
      if (field instanceof HTMLInputElement && /^(?:text|search|url|tel|email|password)$/.test(field.type)) {
        const pattern = field.getAttribute("pattern");
        if (pattern !== null) {
          let cached = patterns.get(field);
          if (!cached || cached.pattern !== pattern) {
            let malformed = false;
            try { new RegExp(pattern, "v"); } catch { malformed = true; }
            cached = { pattern, malformed };
            patterns.set(field, cached);
          }
          // HTML ignores unparseable patterns. Chrome's valid/patternMismatch
          // getters still log their compile error, even inside try/catch. Read
          // the other native constraints without changing the employer's DOM.
          if (cached.malformed) return !constraints.some(key => validity[key]);
        }
      }
      return validity.valid;
    } catch {
      // A broken/custom validity getter must not abort the rest of the form.
      return false;
    }
  };
}
