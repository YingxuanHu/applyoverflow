// Serialized into the isolated world. Field tokens never come from the page and
// every write is revalidated against the current document and visible label.
export function createAutofillInspector() {
  let pageUrl = "", targets = new Map(), undo = [], expires = 0, expiryTimer;
  let completed = new WeakMap();
  const ids = new WeakMap();
  const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const custom = field => field.matches('[role="combobox"],button[aria-haspopup="listbox"]');
  const read = field => {
    // React Select keeps its search input empty after selecting a value.
    const container = custom(field) && field.closest('.select__value-container');
    if (container && container.querySelectorAll('[role="combobox"]').length === 1) {
      const values = container.querySelectorAll('.select__single-value');
      if (values.length === 1) return values[0].textContent.trim();
    }
    return field instanceof HTMLSelectElement && field.selectedOptions[0]?.disabled ? "" : field instanceof HTMLButtonElement ?
      (/^(select|choose)( one| an? .+)?[.\u2026]*$/i.test(field.textContent.trim()) ? "" : field.textContent.trim()) : field.value || "";
  };
  const restricted = label => /disab|veteran|gender|race|ethnic|sexual|religio|birth|social security|ssn|criminal|convict|consent|agree|certify|signature|authoriz|sponsor|visa|citizen|eligible to work|right to work/i.test(label);
  const rememberable = label => !restricted(label) && !/referr|refer you|hear about|relative|family|relationship|related to|previously employed|worked (here|for)/i.test(label);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const aliases = {
    on: "ontario", qc: "quebec", bc: "british columbia", ab: "alberta", mb: "manitoba", nb: "new brunswick",
    nl: "newfoundland and labrador", ns: "nova scotia", nt: "northwest territories", nu: "nunavut", pe: "prince edward island", sk: "saskatchewan", yt: "yukon",
    al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia",
    fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine",
    md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
    nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon",
    pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia",
    wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  };
  const equivalent = (a, b, key) => {
    const canonical = value => {
      const text = norm(value);
      return key === "country" ? ({ ca: "canada", us: "united states", usa: "united states", "united states of america": "united states" })[text] || text :
        key === "region" ? aliases[text] || text : text;
    };
    return canonical(a) === canonical(b);
  };
  function reset() {
    clearTimeout(expiryTimer);
    for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
      item.field.removeEventListener(event, item.onEdit);
    undo = []; targets.clear(); completed = new WeakMap(); expires = Date.now() + 10 * 60_000;
    pageUrl = location.href;
    expiryTimer = setTimeout(() => {
      for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
        item.field.removeEventListener(event, item.onEdit);
      undo = []; targets.clear(); completed = new WeakMap(); expires = 0;
    }, 10 * 60_000);
  }
  function setValue(field, value) {
    const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return async function autofill(mode, payload, entries, form, labelFor, visible) {
    if (pageUrl !== location.href || expires <= Date.now()) reset();
    const operationUrl = location.href;
    const deadline = performance.now() + 5000;
    const current = entries.filter(({ field, label }) => label && label.length <= 500 &&
      !["hidden", "password", "submit", "reset"].includes(field.type) &&
      (!(field instanceof HTMLButtonElement) || custom(field)));
    const safe = item => location.href === operationUrl && pageUrl === operationUrl && form.isConnected && form.contains(item.field) &&
      item.field.isConnected && visible(item.field) && labelFor(item.field) === item.label &&
      !item.field.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]');
    const items = current.slice(0, 80).map(entry => {
      const { field, label } = entry;
      if (!ids.has(field)) ids.set(field, crypto.randomUUID());
      const id = ids.get(field);
      const key = entry.profileKey;
      const group = field.closest('fieldset,[role="group"],section');
      const heading = group?.querySelector('legend,h2,h3')?.textContent || group?.getAttribute("aria-label") || "";
      const inHistory = /work experience|employment|education|reference|emergency|supervisor/i.test(heading) ||
        !!field.closest('[data-automation-id^="workExperience-"],[data-automation-id^="education-"]');
      const scalar = field instanceof HTMLTextAreaElement ||
        (field instanceof HTMLInputElement && ["text", "email", "tel", "url", "number"].includes(field.type));
      const select = field instanceof HTMLSelectElement && !field.multiple;
      const widget = custom(field) && (!(field instanceof HTMLButtonElement) || field.type === "button");
      const ambiguous = key && current.filter(item => item.profileKey === key).length !== 1;
      const labelAmbiguous = !key && current.filter(item => norm(item.label) === norm(label)).length !== 1;
      const manual = inHistory || ambiguous || labelAmbiguous || restricted(label) ||
        !(scalar || select || widget) || field.hasAttribute("list") ||
        (field.hasAttribute("aria-autocomplete") && !widget);
      const options = select ? [...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]'))
        .slice(0, 250).map(option => option.textContent.trim()) : [];
      const item = { id, field, label, profileKey: key, manual, options,
        canRemember: !manual && (!!key || (!entry.identityLabel && rememberable(label))),
        title: inHistory && heading ? `${heading}: ${label}` : label,
        required: field.required || field.getAttribute("aria-required") === "true",
        kind: select ? "select" : widget ? "combobox" : "text",
        reason: field.type === "file" ? "Attach this file on the form, or use Choose resume in More actions." : inHistory ? "Review work, education or reference details on the form." :
          manual ? "Review this field on the employer form." : "",
      };
      targets.set(id, item);
      return item;
    });
    targets = new Map(items.map(item => [item.id, item]));
    const describe = () => items.filter(safe).map(item => {
      const field = item.field;
      const hasValue = ["checkbox", "radio"].includes(field.type) ? field.checked : Boolean(read(field).trim());
      const invalid = hasValue && field.validity?.valid === false;
      return { id: item.id, label: item.label, title: item.title, profileKey: item.profileKey, required: item.required,
        kind: item.kind, options: item.options, canAnswer: !item.manual && !invalid,
        canRemember: item.canRemember && !invalid,
        state: invalid ? "needed" : hasValue ? completed.get(field)?.label === item.label && completed.get(field)?.value === read(field) ? "filled" : "kept" : "needed",
        reason: invalid ? "An existing value is invalid. Correct it on the employer form." : item.reason,
      };
    });
    async function write(item, value) {
      if (performance.now() > deadline) { item.reason = "Click Autofill again to continue on this long form."; return false; }
      if (!safe(item) || item.manual || read(item.field).trim() || typeof value !== "string" || !value.trim()) return false;
      if (value.length > 3000 || (item.field.maxLength >= 0 && value.length > item.field.maxLength)) return false;
      const field = item.field, before = read(field), originalValue = field.value;
      if (item.kind === "select") {
        const matches = [...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]') &&
          equivalent(option.textContent, value, item.profileKey));
        if (matches.length !== 1) { item.reason = "No unique matching option. Choose on the form."; return false; }
        setValue(field, matches[0].value);
      } else if (item.kind === "combobox") {
        const expanded = field.getAttribute("aria-expanded") === "true";
        if (!expanded) field.click();
        let list;
        for (let attempt = 0; attempt < 16 && safe(item); attempt++) {
          const lists = (field.getAttribute("aria-controls") || field.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean)
            .flatMap(id => [...document.querySelectorAll(`#${CSS.escape(id)}`)])
            .filter(node => node.matches('[role="listbox"]') && visible(node));
          if (lists.length === 1) { list = lists[0]; break; }
          await delay(25);
        }
        const options = list && list.getAttribute("aria-multiselectable") !== "true" ?
          [...list.querySelectorAll('[role="option"]')].filter(option => visible(option) &&
            option.closest('[role="listbox"]') === list && !option.matches('[aria-disabled="true"],:disabled')) : [];
        item.options = options.map(option => option.textContent.trim()).slice(0, 250);
        const matches = options.filter(option => equivalent(option.textContent, value, item.profileKey));
        if (!safe(item) || read(field) !== before || matches.length !== 1) {
          if (safe(item) && !expanded && field.getAttribute("aria-expanded") === "true") field.click();
          item.reason = "Choose a matching option on the form."; return false;
        }
        matches[0].click();
        if (safe(item) && field.getAttribute("aria-expanded") === "true") field.click();
      } else setValue(field, value);
      await delay(35);
      const valid = safe(item) && Boolean(read(field).trim()) &&
        (item.kind === "select" ? equivalent(field.selectedOptions[0]?.textContent, value, item.profileKey) : equivalent(read(field), value, item.profileKey)) && field.validity?.valid !== false;
      if (!valid) {
        if (safe(item) && item.kind === "text" && read(field) === value) setValue(field, before);
        item.reason = "The form did not confirm this value. Check it on the page."; return false;
      }
      completed.set(field, { label: item.label, value: read(field) });
      if (item.kind !== "combobox") {
        const record = { ...item, before: originalValue, value: read(field), edited: false };
        record.onEdit = event => { if (event.isTrusted) record.edited = true; };
        for (const event of ["input", "change", "pointerdown", "keydown"]) field.addEventListener(event, record.onEdit);
        undo.push(record);
      }
      return true;
    }
    let answerTarget;
    if (mode === "autofill-answer" || mode === "autofill-focus") {
      answerTarget = items.find(item => item.id === payload.id && item.label === payload.label);
      if (!answerTarget || !safe(answerTarget)) return { error: "This field changed. Click Autofill to check the current step." };
      if (mode === "autofill-focus") {
        answerTarget.field.scrollIntoView({ block: "center", behavior: "smooth" });
        answerTarget.field.focus({ preventScroll: true });
      } else if (!(await write(answerTarget, payload.answer))) {
        return { error: answerTarget.reason || "This field already has a value or needs entry on the form." };
      }
    }
    if (mode === "autofill") for (const item of items) {
      const value = item.profileKey ? payload.contact?.[item.profileKey] :
        item.canRemember ? payload.answers?.find(answer => norm(answer.label) === norm(item.label))?.answer : undefined;
      if (value) await write(item, value);
    }
    let undone = 0;
    if (mode === "autofill-undo") {
      for (const record of undo) if (!record.edited && safe(record) && read(record.field) === record.value) {
        setValue(record.field, record.before); undone++;
      }
      reset();
    }
    // No filled values are returned to the popup or persisted in extension storage.
    return { fields: describe(), undone, answered: answerTarget ? {
      label: answerTarget.label, profileKey: answerTarget.profileKey, canRemember: answerTarget.canRemember,
    } : undefined, autofillUndoAvailable: undo.some(item => !item.edited && safe(item) && read(item.field) === item.value) };
  };
}
