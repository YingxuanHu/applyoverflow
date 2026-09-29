import { createFieldValidity } from "./field-validity.mjs";

// Serialized into the isolated world. Field tokens never come from the page and
// every write is revalidated against the current document and visible label.
export function createAutofillInspector() {
  return createAutofillRuntime(createFieldValidity());
}
createAutofillInspector.toString = () => `(function() {
  return (${createAutofillRuntime})((${createFieldValidity})());
})`;

function createAutofillRuntime(fieldValid) {
  let pageUrl = "", targets = new Map(), undo = [], expires = 0, expiryTimer;
  let completed = new WeakMap();
  let issues = new WeakMap();
  let userEdited = new WeakSet(), programmatic = 0;
  const editObservers = new Map();
  const editEvents = ["input", "change", "pointerdown", "keydown"];
  const observeEdits = field => {
    if (editObservers.has(field)) return;
    const onEdit = event => { if (event.isTrusted && !programmatic) userEdited.add(field); };
    for (const event of editEvents) field.addEventListener(event, onEdit);
    editObservers.set(field, onEdit);
  };
  const edited = item => (item.ariaChoice?.fields || item.radioFields || [item.field]).some(field => userEdited.has(field));
  const clickChoice = field => {
    programmatic++;
    try { field.click(); } finally { programmatic--; }
  };
  const clearEditObservers = () => {
    for (const [field, onEdit] of editObservers) for (const event of editEvents) field.removeEventListener(event, onEdit);
    editObservers.clear(); userEdited = new WeakSet();
  };
  const ids = new WeakMap();
  const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const custom = field => field.matches('[role="combobox"],button[aria-haspopup="listbox"],input[aria-autocomplete="list"][aria-haspopup="listbox"],b-single-select > [role="button"][aria-haspopup][aria-labelledby]');
  const chipText = chip => chip.querySelector('.chip-text')?.textContent.trim() || "";
  const read = field => {
    const chips = field.closest('b-chip-input');
    if (chips) return [...chips.querySelectorAll('b-chip')].map(chipText).join(", ") || field.value || "";
    // React Select keeps its search input empty after selecting a value.
    const container = custom(field) && field.closest('.select__value-container,[class$="-ValueContainer"]');
    if (container && container.querySelectorAll('[role="combobox"]').length === 1) {
      const values = container.querySelectorAll('.select__single-value,[class$="-singleValue"]');
      if (values.length === 1) {
        // Greenhouse displays only a flag and dial code after selection. +1 is
        // ambiguous; read the widget's country identity, not the dial code.
        const flag = values[0].querySelector('.iti__flag');
        if (field.id === "country" && field.closest('fieldset.phone-input') && flag) {
          if (flag.classList.contains("iti__ca")) return "Canada +1";
          if (flag.classList.contains("iti__us")) return "United States +1";
        }
        return values[0].textContent.trim();
      }
      const chips = container.querySelectorAll('.select__multi-value__label');
      if (chips.length) return [...chips].map(chip => chip.textContent.trim()).join(", ");
    }
    if (field instanceof HTMLInputElement && field.type === "checkbox") return field.checked ? "Yes" : "";
    return field instanceof HTMLSelectElement && field.selectedOptions[0]?.disabled ? "" : field instanceof HTMLButtonElement || (custom(field) && !(field instanceof HTMLInputElement)) ?
      (/^(select|choose)( one| an? .+)?[.\u2026]*$/i.test(field.textContent.trim()) ? "" : field.textContent.trim()) : field.value || "";
  };
  const restricted = label => /disab|veteran|gender|race|ethnic|sexual|religio|birth|social security|ssn|criminal|convict|consent|agree|certify|signature|authori[sz]|sponsor|visa|citizen|eligible to work|right to work|legally (?:able|allowed|entitled|permitted)/i.test(label);
  const legal = (label, saved, planningSaved = false) => /social security|\bssn\b|signature|certify|terms|privacy (?:policy|act)|criminal|convict|date of birth|confirm.{0,60}(?:accurate|truthful)/i.test(label) ||
    (/agree|consent/i.test(label) && !/receive (?:text |sms |email )?(?:messages|communications)|contact me (?:by|via) (?:sms|email|text)|\bjoin .{0,60}talent (?:community|network)|\breceive (?:email )?(?:job alerts|career newsletters)/i.test(label) &&
      !((planningSaved || saved?.answerKey === "smsUpdates") && /^check yes or no to indicate your agreement to receive text message updates from .{1,120} regarding your job application[.?]/i.test(label)));
  const rememberable = label => !restricted(label);
  let confirmedQuestions = new Map();
  let profileGuidance = new Map();
  let choiceCache = new WeakMap();
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
      if (key === "phone") return text.replace(/[^\d+]/g, "");
      if (key === "pronouns") {
        const pronouns = text.replace(/\s*\/\s*/g, "/");
        return ({ "she/her/hers": "she/her", "he/him/his": "he/him", "they/them/theirs": "they/them" })[pronouns] || pronouns;
      }
      if (key === "authorizedCountries") return ({ "canada (ca)": "canada", "united states (usa)": "united states",
        "united states (us)": "united states", "united states of america": "united states", us: "united states", usa: "united states", ca: "canada" })[text] || text;
      if (key === "desiredPayAmount" && /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return String(Number(text.replaceAll(",", "")));
      const countryText = key === "phoneCountry" ? text.replace(/\s*\(?\+1\)?\s*$/, "").trim() : text;
      return ["country", "phoneCountry"].includes(key) ? ({ ca: "canada", us: "united states", usa: "united states", "united states of america": "united states" })[countryText] || countryText :
        key === "region" ? aliases[text] || text : text;
    };
    return canonical(a) === canonical(b);
  };
  function reset() {
    clearTimeout(expiryTimer);
    clearEditObservers();
    for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
      item.field.removeEventListener(event, item.onEdit);
    undo = []; targets.clear(); completed = new WeakMap(); issues = new WeakMap(); choiceCache = new WeakMap(); confirmedQuestions.clear(); profileGuidance.clear(); expires = Date.now() + 10 * 60_000;
    pageUrl = location.href;
    expiryTimer = setTimeout(() => {
      clearEditObservers();
      for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
        item.field.removeEventListener(event, item.onEdit);
      undo = []; targets.clear(); completed = new WeakMap(); confirmedQuestions.clear(); profileGuidance.clear(); expires = 0;
    }, 10 * 60_000);
  }
  function setValue(field, value) {
    const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function rootReferences(field, attribute, property, fallback = "") {
    const root = field.getRootNode();
    const raw = field.getAttribute(attribute) || "";
    if ((raw || fallback).length > 1000) return [];
    const reflected = !raw ? field[property] : null;
    if (Array.isArray(reflected) && reflected.length) {
      if (reflected.length > 8) return [];
      const references = [...new Set(reflected)];
      // Native reflected ARIA element references can explicitly link a shadow
      // control to a portal in an ancestor root. IDREF attributes cannot.
      // https://developer.mozilla.org/en-US/docs/Web/API/Element/ariaControlsElements
      const scopes = new Set();
      for (let scope = root; scope && scopes.size < 24; scope = scope.host?.getRootNode()) scopes.add(scope);
      return references.every(node => node instanceof Element && node.isConnected &&
        node.ownerDocument === field.ownerDocument && scopes.has(node.getRootNode())) ? references : [];
    }
    const names = [...new Set((raw || fallback).split(/\s+/).filter(Boolean))];
    if (names.length > 8) return [];
    const references = [];
    for (const id of names) {
      const matches = root.querySelectorAll(`#${CSS.escape(id)}`);
      if (matches.length !== 1) return [];
      references.push(matches[0]);
    }
    return references;
  }
  return async function autofill(mode, payload, entries, form, labelFor, visible) {
    if (pageUrl !== location.href || expires <= Date.now()) reset();
    if (mode === "autofill") {
      confirmedQuestions = new Map((payload.commonAnswers || []).slice(0, 40)
      .filter(answer => typeof answer.label === "string" && typeof answer.answer === "string")
      .map(answer => [norm(answer.label), answer]));
      profileGuidance = new Map((payload.answerDetails || []).slice(0, 40).map(detail => [norm(detail.label), detail]));
    }
    const operationUrl = location.href;
    const deadline = performance.now() + 12000;
    const questionText = node => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
    const radioLabel = group => {
      const labels = group ? [...group.querySelectorAll(':scope > label')] : [];
      const ownLabel = labels.length === 1 && !labels[0].control && !labels[0].querySelector('input,select,textarea,button') ? questionText(labels[0]) : "";
      const heading = group?.firstElementChild;
      const structural = heading && !heading.matches('input,select,textarea,button') &&
        !heading.querySelector('input,select,textarea,button,[role="combobox"],[role="radio"]') ? questionText(heading) : "";
      return questionText(group?.querySelector(':scope > legend')) || group?.getAttribute('aria-label') || ownLabel ||
        (group?.matches('.application-question') && group.querySelectorAll('.application-label').length === 1 ? questionText(group.querySelector('.application-label')) : '') ||
        (structural.length <= 500 ? structural : "");
    };
    const nativeGroup = radios => {
      if (radios.length < 2 || !radios[0].field.name) return null;
      const members = new Set(radios.map(item => item.field));
      for (let group = radios[0].field.parentElement, depth = 0; group && group !== form && depth < 8; group = group.parentElement, depth++) {
        if (!radios.every(item => group.contains(item.field))) continue;
        // Lowest common ownership plus a local question title, not CSS from a
        // particular ATS. Never borrow a neighbouring question's controls.
        if ([...group.querySelectorAll('input,select,textarea,[role="combobox"],[role="radio"],button[aria-pressed]')]
          .some(field => visible(field) && field.type !== "hidden" && !members.has(field))) return null;
        if (radioLabel(group)) return group;
      }
      return null;
    };
    const groupedEntries = entries.flatMap(entry => {
      if (entry.ariaChoice) return [entry];
      if (!["radio", "checkbox"].includes(entry.field.type)) return [entry];
      const radios = entries.filter(item => item.field.type === entry.field.type && item.field.name === entry.field.name);
      const explicit = entry.field.closest('fieldset,[role="radiogroup"],.application-question');
      const group = explicit && radioLabel(explicit) ? explicit : nativeGroup(radios);
      const groupLabel = radioLabel(group);
      if (!group || !groupLabel || !entry.field.name) return [entry];
      if (!radios.every(item => group.contains(item.field))) return [entry];
      if (radios[0].field !== entry.field) return [];
      return [{ ...entry, label: groupLabel, originalLabel: entry.label,
        radioFields: radios.map(item => item.field), radioLabels: radios.map(item => labelFor(item.field)), radioGroup: group }];
    });
    const current = groupedEntries.filter(({ field, label, ariaChoice }) => label && label.length <= 500 &&
      (ariaChoice || !["hidden", "password", "submit", "reset", "file"].includes(field.type)) &&
      (!(field instanceof HTMLButtonElement) || custom(field) || field.matches('[role="checkbox"],[role="switch"]')));
    const safe = item => location.href === operationUrl && pageUrl === operationUrl && form.isConnected && form.contains(item.field) &&
      item.field.isConnected && visible(item.field) && (item.ariaChoice ? item.ariaChoice.valid() : (labelFor(item.field) === (item.originalLabel || item.label) &&
      (!item.radioFields || (item.radioFields.every((field, index) => field.isConnected && form.contains(field) && visible(field) && !field.disabled && labelFor(field) === item.radioLabels[index]) &&
        radioLabel(item.radioGroup) === item.label)) &&
      !item.field.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]')));
    const items = current.slice(0, 80).map(entry => {
      const { field, label } = entry;
      for (const control of entry.ariaChoice?.fields || entry.radioFields || [field]) observeEdits(control);
      if (!ids.has(field)) ids.set(field, crypto.randomUUID());
      const id = ids.get(field);
      const key = entry.profileKey;
      const group = field.closest('fieldset,[role="group"],section');
      // A nested question or a section outside this form cannot label its contacts.
      const heading = group && form.contains(group) ?
        group.querySelector(':scope > legend,:scope > h2,:scope > h3')?.textContent || group.getAttribute("aria-label") || "" : "";
      const inHistory = entry.inHistory || /work experience|employment|education|reference|emergency|supervisor/i.test(heading) ||
        !!field.closest('[data-automation-id^="workExperience-"],[data-automation-id^="education-"]');
      const scalar = field instanceof HTMLTextAreaElement ||
        (field instanceof HTMLInputElement && ["text", "email", "tel", "url", "number", "date"].includes(field.type));
      const select = field instanceof HTMLSelectElement;
      const radio = entry.ariaChoice ? entry.kind === "radio" : entry.radioFields?.length > 1;
      const checkbox = entry.ariaChoice ? entry.kind === "checkbox" : field instanceof HTMLInputElement && field.type === "checkbox";
      const widget = custom(field) && (!(field instanceof HTMLButtonElement) || field.type === "button");
      const ambiguous = key && current.filter(item => item.profileKey === key).length !== 1;
      const labelAmbiguous = !key && current.filter(item => norm(item.label) === norm(label)).length !== 1;
      const saved = confirmedQuestions.get(norm(label));
      const manual = inHistory || ambiguous || labelAmbiguous || legal(label, saved) || (entry.ariaChoice && !entry.ariaChoice.writable()) ||
        !(scalar || select || widget || radio || checkbox) ||
        (field.hasAttribute("aria-autocomplete") && !widget);
      // Planning is not permission to answer. The exact saved-answer planner
      // needs these labels before it can authorize a previously unknown choice.
      const canPlan = Boolean(entry.ariaChoice && !inHistory && !ambiguous && !labelAmbiguous &&
        entry.ariaChoice.writable() && !legal(label, undefined, true));
      const options = entry.ariaChoice ? radio ? entry.ariaChoice.labels : ["Yes", "No"] : select ? [...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]'))
        .slice(0, 250).map(option => option.textContent.trim()) : radio ? entry.radioFields.map(labelFor) :
        choiceCache.get(field)?.label === label ? choiceCache.get(field).options : [];
      const help = rootReferences(field, "aria-describedby", "ariaDescribedByElements")
        .map(node => (node.textContent || "").slice(0, 500)).join(" ");
      const limitText = `${label} ${help}`;
      const wordLimit = limitText.match(/(?:max(?:imum)?(?: of)?|up to|limit(?: of|:)?|no more than)\s*(\d{1,4})\s*words\b/i)?.[1] ||
        limitText.match(/\b(\d{1,4})\s*words?\s*(?:max(?:imum)?|limit)\b/i)?.[1];
      const charLimit = limitText.match(/(?:max(?:imum)?(?: of)?|up to|limit(?: of|:)?|no more than)\s*(\d{1,5})\s*characters?\b/i)?.[1];
      const maxLength = Math.min(3000, field.maxLength >= 0 ? field.maxLength : 3000, Number(charLimit) || 3000);
      const maxWords = wordLimit ? Math.min(1000, Number(wordLimit)) : undefined;
      const required = entry.required || field.required || field.getAttribute("aria-required") === "true" ||
        (field.matches('b-single-select > [role="button"]') && field.parentElement.hasAttribute("required")) || Boolean(field.closest('b-currency-value-select[required]'));
      const item = { ...entry, id, field, label, profileKey: key, manual, canPlan, options, maxLength, maxWords,
        canRemember: !manual && !entry.ariaChoice && !["fullAddress", "professionalUrl", "skills", "currentCompany", "currentTitle"].includes(key) && !(key === "city" && widget) && (!!key || (!entry.identityLabel && rememberable(label))),
        profileLabel: profileGuidance.get(norm(label))?.profileLabel,
        notApplicable: profileGuidance.get(norm(label))?.notApplicable === true && !required,
        title: key === "phoneCountry" ? "Phone country" : inHistory && heading ? `${heading}: ${label}` : label,
        required,
        kind: radio ? checkbox ? "checkbox-group" : "radio" : checkbox ? "checkbox" : select ? "select" : widget ? "combobox" : "text",
        reason: field.type === "file" ? "Use Change resume, or attach this file on the form." : inHistory ? entry.historyKind ? `This ${entry.historyKind === "education" ? "education" : "work"} record could not be completed. Check the saved record and the form's available choices.` : "Review work, education or reference details on the form." :
          manual ? "Review this field on the employer form." : issues.get(field)?.label === label ? issues.get(field).reason : profileGuidance.get(norm(label))?.reason || "",
      };
      targets.set(id, item);
      return item;
    });
    targets = new Map(items.map(item => [item.id, item]));
    const checked = (item, field) => item.ariaChoice ? field.getAttribute(item.ariaChoice.checkedAttribute || "aria-checked") === "true" : field.checked;
    const choiceLabel = (item, field) => item.ariaChoice ? item.ariaChoice.labels[item.ariaChoice.fields.indexOf(field)] : labelFor(field);
    const savedChoice = item => {
      const saved = confirmedQuestions.get(norm(item.label));
      return saved && typeof saved.answerKey === "string" && saved.answerKey && typeof saved.answer === "string" && saved.answer.trim();
    };
    const readItem = item => {
      if (item.ariaChoice && item.kind === "checkbox") return checked(item, item.field) ? "Yes" : "";
      if (item.kind === "select" && item.field.multiple)
        return [...item.field.selectedOptions].filter(option => !option.disabled && option.value).map(option => option.textContent.trim()).join(", ");
      if (!item.radioFields) return read(item.field);
      return item.radioFields.filter(field => checked(item, field)).map(field => choiceLabel(item, field)).join(", ");
    };
    const describe = () => items.filter(safe).map(item => {
      const field = item.field;
      const hasUserEdit = edited(item);
      const editedCheckbox = item.kind === "checkbox" && undo.some(record => record.field === field && record.edited);
      const hasValue = item.radioFields ? Boolean(readItem(item)) : item.kind === "checkbox" ? editedCheckbox || checked(item, field) ||
        (completed.get(field)?.label === item.label && completed.get(field)?.value === "No") : field.type === "radio" ? field.checked : Boolean(read(field).trim());
      const partialChoice = issues.get(field)?.label === item.label && issues.get(field)?.reason === "The form did not confirm every saved choice. Review this field.";
      const choiceRejected = item.ariaChoice && issues.get(field)?.label === item.label && issues.get(field)?.reason === "The form did not confirm this value. Check it on the page.";
      const invalid = choiceRejected || (hasValue && (!fieldValid(field) || partialChoice));
      const retryable = !hasUserEdit && !hasValue && !item.manual && !choiceRejected && (completed.get(field)?.label === item.label ||
        issues.get(field)?.reason === "The form did not confirm this value. Check it on the page.") &&
        !undo.some(record => record.field === field && record.edited);
      const condition = profileGuidance.get(norm(item.label))?.dependsOn;
      const parents = condition ? items.filter(parent => confirmedQuestions.get(norm(parent.label))?.answerKey === condition.answerKey) : [];
      const notApplicable = item.notApplicable && (!condition || (parents.length === 1 && safe(parents[0]) &&
        [condition.answer, ...(condition.alternatives || [])].some(value => equivalent(readItem(parents[0]), value))));
      const today = new Date();
      const date = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")];
      const availability = /^(?:date available|availability date|earliest (?:start|starting) date|available from)\s*[*:]?$/i.test(item.label);
      const dateValue = availability && !item.manual ? field.type === "date" ? date.join("-") :
        /^dd-mm-yyyy$/i.test(field.placeholder || "") ? [...date].reverse().join("-") :
        /^mm\/dd\/yyyy$/i.test(field.placeholder || "") ? `${date[1]}/${date[2]}/${date[0]}` : "" : "";
      const discovery = /^(?:how did you (?:learn about|hear about|find) (?:this (?:job(?: opening)?|position|role)|us))\s*[?*]*$/i.test(item.label);
      const sourceValue = discovery && item.options.includes("Other") ? "Other" : "";
      return { id: item.id, label: item.label, title: item.title, profileKey: item.profileKey, required: item.required,
        profileLabel: item.profileLabel,
        maxLength: item.maxLength, maxWords: item.maxWords,
        ...(dateValue ? { suggestedAnswer: dateValue, suggestionLabel: "Use today's date" } : sourceValue ? { suggestedAnswer: sourceValue, suggestionLabel: "Use Other as job source" } : {}),
        kind: item.kind, options: item.options, canAnswer: !item.manual && !invalid && !hasUserEdit && (!item.ariaChoice || Boolean(savedChoice(item))),
        canPlan: item.canPlan && !invalid && !hasUserEdit,
        retryable,
        canRemember: item.canRemember && !invalid,
        state: invalid ? "needed" : hasValue ? !hasUserEdit && !editedCheckbox && completed.get(field)?.label === item.label && equivalent(completed.get(field)?.value, item.kind === "checkbox" && !checked(item, field) ? "No" : readItem(item), item.profileKey) ? "filled" : "kept" : notApplicable ? "not-applicable" : "needed",
        reason: hasUserEdit ? "You edited this field. Left unchanged." : partialChoice || choiceRejected ? issues.get(field).reason : invalid ? "An existing value is invalid. Correct it on the employer form." : retryable ? "The form cleared this value. Retrying is available." : item.notApplicable && !notApplicable ? "Review this follow-up against your answer on the form." : item.ariaChoice && !item.manual && !savedChoice(item) ? "Save this preference in Profile, or choose on the form." : item.reason,
      };
    });
    const closeOptions = field => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      field.blur();
      if (field.getAttribute("aria-expanded") === "true") field.click();
    };
    async function loadOptions(item, keepOpen = false, search = "") {
      const field = item.field;
      if (!safe(item) || item.kind !== "combobox" || (read(field).trim() && read(field) !== search)) return [];
      const expanded = field.getAttribute("aria-expanded") === "true";
      if (!expanded) field.click();
      if (field.getAttribute("aria-expanded") !== "true") {
        field.focus();
        field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, view: window }));
      }
      if (search && field instanceof HTMLInputElement) { field.focus(); setValue(field, search); }
      let options = [];
      let searched = false;
      let signature = "", stableSince = 0, settled = false;
      for (let attempt = 0; attempt < (search ? 64 : 16) && safe(item); attempt++) {
        const bob = field.matches('b-single-select > [role="button"]');
        const controls = field.getAttribute("aria-controls") || field.ariaControlsElements?.length;
        const owns = field.getAttribute("aria-owns") || field.ariaOwnsElements?.length;
        const lists = (controls ? rootReferences(field, "aria-controls", "ariaControlsElements") :
          owns ? rootReferences(field, "aria-owns", "ariaOwnsElements") :
            bob ? rootReferences(field, "aria-controls", "ariaControlsElements", `list__${field.id}`) : [])
          .filter(node => node.matches('[role="listbox"],[role="tree"]') && visible(node) &&
            (!bob || node.getAttribute("aria-labelledby") === field.getAttribute("aria-labelledby")));
        const list = lists.length === 1 ? lists[0] : null;
        // One explicit saved choice is also safe in an empty multi-select.
        // Existing chips are read above, so we never add to a user's selection.
        options = list ?
          [...list.querySelectorAll('[role="option"],[role="treeitem"]')].filter(option => visible(option) &&
            option.closest('[role="listbox"],[role="tree"]') === list && !option.matches('[aria-disabled="true"],:disabled')) : [];
        if (list && search && !searched && !(field instanceof HTMLInputElement)) {
          // A short Yes/No list is already complete. Searching it can remove
          // the live options during Angular's asynchronous filter update.
          const rootInputs = options.some(option => norm(option.textContent) === norm(search)) ? [] : list.getRootNode().querySelectorAll('input');
          const searchBoxes = rootInputs.length <= 500 ? [...rootInputs].filter(input =>
            input !== field && visible(input) && ["text", "search"].includes(input.type) && !input.disabled && !input.readOnly &&
            rootReferences(input, "aria-controls", "ariaControlsElements").includes(list)) : [];
          const searchBox = searchBoxes.length === 1 ? searchBoxes[0] : null;
          if (searchBox) {
            setValue(searchBox, search);
            searchBox.dispatchEvent(new KeyboardEvent("keyup", { key: search.at(-1), bubbles: true }));
            searched = true; await delay(100); continue;
          }
        }
        const busy = field.getAttribute("aria-busy") === "true" || list?.getAttribute("aria-busy") === "true";
        if (!busy && options.length && (!search || options.some(option => norm(option.textContent).includes(norm(search))))) {
          const next = JSON.stringify(options.map(option => [option.id, option.textContent]));
          if (signature !== next) { signature = next; stableSince = performance.now(); }
          else if (performance.now() - stableSince >= 100) { settled = true; break; }
        } else { signature = ""; stableSince = 0; }
        await delay(25);
      }
      if (!settled) options = [];
      item.options = options.map(option => option.textContent.trim()).slice(0, 250);
      choiceCache.set(field, { label: item.label, options: item.options });
      if (!keepOpen && safe(item) && !expanded) closeOptions(field);
      if (!options.length) item.reason = "No choices available yet. This field may need a search on the employer form.";
      return options;
    }
    async function write(item, value) {
      if (performance.now() > deadline) { item.reason = "Click Autofill again to continue on this long form."; return false; }
      if (edited(item)) { item.reason = "You edited this field. Left unchanged."; return false; }
      if (!safe(item) || item.manual || readItem(item).trim() || typeof value !== "string" || !value.trim()) return false;
      if (value.length > item.maxLength || (item.maxWords && value.trim().split(/\s+/).length > item.maxWords)) {
        item.reason = `Shorten this answer to ${item.maxWords ? `${item.maxWords} words and ` : ""}${item.maxLength} characters.`; return false;
      }
      const field = item.field, before = readItem(item), originalValue = field.value;
      const saved = confirmedQuestions.get(norm(item.label));
      if (item.ariaChoice && (!savedChoice(item) || saved.answer !== value || !item.ariaChoice.writable() ||
          (saved.selections?.length && (saved.selections.length !== 1 || saved.selections[0] !== value)))) {
        item.reason = "Choose this option on the form, or save its preference in Profile."; return false;
      }
      if (item.ariaChoice && issues.get(field)?.label === item.label &&
          issues.get(field)?.reason === "The form did not confirm this value. Check it on the page.") return false;
      // Only visible wrappers receive clicks. ARIA state, not hidden input state
      // or a successful click dispatch, must settle to the exact selected set.
      const confirmAriaChoice = async selected => {
        if (!item.ariaChoice) return true;
        let stableSince;
        for (let attempt = 0; attempt < 12 && performance.now() < deadline; attempt++) {
          if (!safe(item) || !item.ariaChoice.writable() || edited(item)) return false;
          const confirmed = item.ariaChoice.fields.every(choice => checked(item, choice) === selected.includes(choice));
          if (confirmed) {
            stableSince ??= performance.now();
            if (performance.now() - stableSince >= 100) return true;
          } else stableSince = undefined;
          await delay(25);
        }
        return false;
      };
      if (saved?.selections?.length && (saved.selections.length > 1 || item.kind === "checkbox-group" || field instanceof HTMLSelectElement && field.multiple)) {
        if (saved.answer !== value || saved.selections.length > 12 || !saved.selections.every(value => typeof value === "string" && value.trim())) return false;
        const checkboxGroup = item.kind === "checkbox-group";
        const multiple = item.kind === "select" && field.multiple;
        if (!checkboxGroup && !multiple) {
          item.reason = "This field needs multiple saved choices. Select them on the form.";
          return false;
        }
        const options = checkboxGroup ? item.radioFields : [...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]'));
        const text = option => checkboxGroup ? labelFor(option) : option.textContent.trim();
        const matches = saved.selections.map(value => options.filter(option => equivalent(text(option), value, saved.answerKey)));
        if (matches.some(options => options.length !== 1) || new Set(matches.map(options => options[0])).size !== matches.length) {
          item.reason = "No unique match for every saved choice. Choose on the form.";
          return false;
        }
        const selected = matches.flat();
        let edited = false, writing = false;
        const onEdit = event => { if (event.isTrusted && !writing) edited = true; };
        const listen = checkboxGroup ? item.radioGroup : field;
        listen.addEventListener("input", onEdit, true);
        listen.addEventListener("change", onEdit, true);
        try {
          if (multiple) {
            for (const option of field.options) option.selected = selected.includes(option);
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.dispatchEvent(new Event("change", { bubbles: true }));
          } else for (const option of selected) {
            if (!safe(item) || edited || option.checked) break;
            writing = true;
            try { clickChoice(option); } finally { writing = false; }
            await delay(25);
          }
          await delay(35);
          const checked = checkboxGroup ? options.filter(option => option.checked) : [...field.selectedOptions];
          if (!safe(item) || edited || checked.length !== selected.length || selected.some(option => !checked.includes(option))) {
            item.reason = "The form did not confirm every saved choice. Review this field.";
            return false;
          }
          completed.set(field, { label: item.label, value: readItem(item) });
          issues.delete(field); item.reason = "";
          return true;
        } finally {
          listen.removeEventListener("input", onEdit, true);
          listen.removeEventListener("change", onEdit, true);
        }
      }
      if (item.kind === "checkbox") {
        // An unchecked checkbox is not evidence of a user's answer. Only an
        // explicit profile choice may set it, never generated or remembered prose.
        if (undo.some(record => record.field === field && record.edited)) return false;
        if (!saved || saved.answer !== value || !["Yes", "No"].includes(value) || (field.required && value === "No")) {
          item.reason = "Choose this option on the form, or save its preference in Profile."; return false;
        }
        const beforeChecked = checked(item, field);
        if (value === "Yes") clickChoice(field);
        if (!(await confirmAriaChoice(value === "Yes" ? [field] : [])) || !safe(item) || checked(item, field) !== (value === "Yes")) {
          item.reason = "The form did not confirm this value. Check it on the page."; return false;
        }
        completed.set(field, { label: item.label, value });
        issues.delete(field); item.reason = "";
        if (item.ariaChoice) return true;
        const record = { ...item, beforeChecked, value, edited: false };
        record.onEdit = event => { if (event.isTrusted && !programmatic) record.edited = true; };
        for (const event of ["input", "change", "pointerdown", "keydown"]) field.addEventListener(event, record.onEdit);
        undo.push(record);
        return true;
      }
      if (saved?.dependsOn) {
        const parents = items.filter(parent => confirmedQuestions.get(norm(parent.label))?.answerKey === saved.dependsOn.answerKey);
        const parent = parents.length === 1 ? parents[0] : null;
        const selected = parent?.kind === "select" ? parent.field.selectedOptions[0]?.textContent : parent && readItem(parent);
        if (!parent || !safe(parent) || ![saved.dependsOn.answer, ...(saved.dependsOn.alternatives || [])].some(value => equivalent(selected, value))) {
          item.reason = selected ? "Not applicable to the selected answer. Left blank." : "Select the preceding answer first.";
          item.notApplicable = Boolean(selected) && !item.required;
          return false;
        }
      }
      if (saved?.answerKey === "startDate" && /^\d{4}-\d{2}-\d{2}$/.test(value) && field.type !== "date") {
        const [year, month, day] = value.split("-");
        const format = field.getAttribute("placeholder")?.toLowerCase() || "";
        if (/mm\/dd\/yyyy/.test(format)) value = `${month}/${day}/${year}`;
        else if (/dd\/mm\/yyyy/.test(format)) value = `${day}/${month}/${year}`;
        else if (/dd-mm-yyyy/.test(format)) value = `${day}-${month}-${year}`;
      }
      const optionMatches = (text, candidate = value) => equivalent(text, candidate, item.profileKey || saved?.answerKey);
      const optionText = option => option instanceof HTMLOptionElement ? option.label || option.value : option.textContent;
      const matchingOptions = options => {
        const exact = options.filter(option => optionMatches(optionText(option)));
        if (exact.length || !saved || saved.answer !== value) return exact;
        return options.filter(option => (saved.alternatives || []).some(alternative => optionMatches(optionText(option), alternative)));
      };
      if (["radio", "checkbox-group"].includes(item.kind)) {
        if (item.kind === "checkbox-group" && (!saved || saved.answer !== value)) {
          item.reason = "Choose this option on the form, or save its preference in Profile."; return false;
        }
        const exact = item.radioFields.filter(field => equivalent(choiceLabel(item, field), value, item.ariaChoice ? undefined : saved?.answerKey));
        const matches = exact.length ? exact : item.radioFields.filter(field => saved?.answer === value &&
          (saved.alternatives || []).some(alternative => equivalent(choiceLabel(item, field), alternative, item.ariaChoice ? undefined : saved?.answerKey)));
        if (matches.length !== 1) { item.reason = "Choose a matching answer on the form."; return false; }
        value = choiceLabel(item, matches[0]);
        clickChoice(matches[0]);
        if (!(await confirmAriaChoice(matches))) {
          item.reason = "The form did not confirm this value. Check it on the page."; return false;
        }
      } else if (item.kind === "select") {
        const matches = matchingOptions([...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]')));
        if (matches.length !== 1) { item.reason = "No unique matching option. Choose on the form."; return false; }
        value = matches[0].textContent.trim();
        setValue(field, matches[0].value);
      } else if (item.kind === "combobox") {
        const expanded = field.getAttribute("aria-expanded") === "true";
        const citySearch = item.profileKey === "city" && field instanceof HTMLInputElement && payload.contact?.region && payload.contact?.country;
        const matchesValue = text => {
          if (!citySearch) return equivalent(text, value, item.profileKey);
          const parts = text.split(",").map(part => part.trim());
          return parts.length === 3 && equivalent(parts[0], value) &&
            equivalent(parts[1], payload.contact.region, "region") && equivalent(parts[2], payload.contact.country, "country");
        };
        let edited = false;
        const onEdit = event => { if (event.isTrusted) edited = true; };
        field.addEventListener("input", onEdit);
        const searchValue = ["country", "phoneCountry"].includes(item.profileKey) ? ({ CA: "Canada", US: "United States" })[value] || value :
          item.profileKey === "region" ? aliases[norm(value)] || value : value;
        let activeSearch = citySearch ? value : field.matches('b-single-select > [role="button"]') ? searchValue : "";
        let options = await loadOptions(item, true, activeSearch);
        let matches = citySearch ? options.filter(option => matchesValue(option.textContent)) : matchingOptions(options);
        if (!matches.length && !activeSearch && !edited && safe(item) && read(field) === before) {
          activeSearch = searchValue;
          options = await loadOptions(item, true, activeSearch);
          matches = citySearch ? options.filter(option => matchesValue(option.textContent)) : matchingOptions(options);
        }
        if (activeSearch && !matches.length && saved?.answer === value) {
          // Virtualized lists may not render "Other" until searched. Use only
          // server-approved equivalents, not a nearest-looking option.
          for (const alternative of (saved.alternatives || []).slice(0, 2)) {
            if (!safe(item) || edited || read(field) !== (field instanceof HTMLInputElement ? activeSearch : before) || performance.now() > deadline) break;
            if (field instanceof HTMLInputElement) setValue(field, before);
            activeSearch = alternative;
            options = await loadOptions(item, true, alternative);
            matches = matchingOptions(options);
            if (matches.length) break;
          }
        }
        field.removeEventListener("input", onEdit);
        if (!safe(item) || edited || read(field) !== (activeSearch && field instanceof HTMLInputElement ? activeSearch : before) || matches.length !== 1) {
          if (safe(item) && !edited && activeSearch && field instanceof HTMLInputElement && read(field) === activeSearch) setValue(field, before);
          if (safe(item) && !edited && !expanded) closeOptions(field);
          item.reason = "Choose a matching option on the form."; return false;
        }
        // Validate against the selected display value, not the temporary search.
        value = matches[0].textContent.trim();
        const selectedOption = matches[0];
        let selectionChanged = false;
        const onSelection = () => { selectionChanged = true; };
        field.addEventListener("input", onSelection);
        field.addEventListener("change", onSelection);
        clickChoice(selectedOption);
        // Search text is not a committed selection. Wait for the widget to
        // acknowledge the choice before we dismiss its list or report success.
        let committed = false;
        for (let attempt = 0; attempt < 12 && safe(item); attempt++) {
          const selected = equivalent(read(field), value, item.profileKey || saved?.answerKey);
          const acknowledged = selectedOption.getAttribute("aria-selected") === "true" ||
            (selectionChanged && field.getAttribute("aria-expanded") === "false") ||
            (!(field instanceof HTMLInputElement) && read(field) !== before) ||
            (field instanceof HTMLInputElement && Boolean(read(field)) &&
              (field.value !== activeSearch || (read(field) !== field.value && read(field) !== before)));
          if (selected && acknowledged) { committed = true; break; }
          await delay(25);
        }
        field.removeEventListener("input", onSelection);
        field.removeEventListener("change", onSelection);
        if (!committed) {
          if (safe(item) && !edited && activeSearch && field instanceof HTMLInputElement && field.value === activeSearch)
            setValue(field, before);
          if (safe(item) && !expanded) closeOptions(field);
          item.reason = "The form did not confirm this value. Check it on the page.";
          return false;
        }
        if (safe(item) && field.getAttribute("aria-expanded") === "true") closeOptions(field);
      } else {
        if (field.list) {
          const matches = matchingOptions([...field.list.options].filter(option => !option.disabled));
          if (matches.length !== 1) { item.reason = "No unique matching suggestion. Choose on the form."; return false; }
          value = matches[0].value;
        }
        setValue(field, value);
      }
      await delay(35);
      const valid = safe(item) && (!item.ariaChoice || (item.ariaChoice.writable() && !edited(item))) && Boolean(readItem(item).trim()) &&
        (item.kind === "select" ? field.selectedOptions.length === 1 && equivalent(field.selectedOptions[0]?.textContent, value, item.profileKey) : equivalent(readItem(item), value, item.profileKey || saved?.answerKey)) && fieldValid(field);
      if (!valid) {
        if (safe(item) && item.kind === "text" && read(field) === value) setValue(field, before);
        item.reason = "The form did not confirm this value. Check it on the page."; return false;
      }
      completed.set(field, { label: item.label, value: readItem(item) });
      issues.delete(field);
      item.reason = "";
      if (!["combobox", "radio", "checkbox-group"].includes(item.kind)) {
        const record = { ...item, before: originalValue, value: read(field), edited: false };
        record.onEdit = event => { if (event.isTrusted && !programmatic) record.edited = true; };
        for (const event of ["input", "change", "pointerdown", "keydown"]) field.addEventListener(event, record.onEdit);
        undo.push(record);
      }
      return true;
    }
    let answerTarget;
    if (["autofill-answer", "autofill-focus", "autofill-options"].includes(mode)) {
      answerTarget = items.find(item => item.id === payload.id && item.label === payload.label);
      if (!answerTarget || !safe(answerTarget)) return { error: "This field changed. Click Autofill to check the current step." };
      if (mode === "autofill-options") await loadOptions(answerTarget);
      else if (mode === "autofill-focus") {
        answerTarget.field.scrollIntoView({ block: "center", behavior: "smooth" });
        (answerTarget.ariaChoice ? answerTarget.focus : answerTarget.field).focus({ preventScroll: true });
      } else if (!(await write(answerTarget, payload.answer))) {
        return { error: answerTarget.reason || "This field already has a value or needs entry on the form." };
      }
    }
    // Fast scalar fields first: a slow remote dropdown must not starve contact fields.
    const writeOrder = item => confirmedQuestions.get(norm(item.label))?.dependsOn ? 2 : Number(item.kind === "combobox");
    if (mode === "autofill") for (const item of [...items].sort((a, b) => writeOrder(a) - writeOrder(b))) {
      if (item.profileKey === "skills" && item.field.closest('b-chip-input')) {
        const field = item.field;
        if (!safe(item) || item.manual || edited(item) || readItem(item).trim()) continue;
        for (const skill of (payload.skills || []).slice(0, 25)) {
          if (!safe(item) || edited(item) || typeof skill !== "string" || !skill.trim() || skill.length > 120 || performance.now() > deadline) break;
          const widget = field.closest('b-chip-input');
          if ([...widget.querySelectorAll('b-chip')].some(chip => norm(chipText(chip)) === norm(skill))) continue;
          field.focus();
          setValue(field, skill);
          await delay(35);
          field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          field.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          await delay(35);
          if (!safe(item) || ![...widget.querySelectorAll('b-chip')].some(chip => norm(chipText(chip)) === norm(skill))) {
            if (safe(item) && field.value === skill) setValue(field, "");
            item.reason = "Some skills need entry on the form."; issues.set(field, { label: item.label, reason: item.reason }); break;
          }
          completed.set(field, { label: item.label, value: readItem(item) });
        }
        continue;
      }
      const value = item.profileKey === "skills" && item.kind === "text" ? payload.skills?.join(", ") : item.profileKey ? payload.contact?.[item.profileKey] :
        confirmedQuestions.get(norm(item.label))?.answer ||
        (item.canRemember ? payload.answers?.find(answer => norm(answer.label) === norm(item.label))?.answer : undefined);
      if (value) await write(item, value);
      else if (item.profileKey && !readItem(item).trim() && !item.manual) item.reason = "Add this detail to your ApplyOverflow profile, or enter it on the form.";
      if (item.reason) issues.set(item.field, { label: item.label, reason: item.reason });
    }
    // Some ATS resume parsers overwrite contact fields after upload. Restore
    // only our own previously empty scalar fields, never a user's edits.
    if (mode === "autofill-reconcile-resume") for (const item of items) {
      if (!item.profileKey || item.kind !== "text" || item.manual || edited(item) || !safe(item)) continue;
      const record = undo.find(record => record.field === item.field && record.label === item.label &&
        record.profileKey === item.profileKey && !record.before && !record.edited);
      if (!record || equivalent(read(item.field), record.value, item.profileKey)) continue;
      setValue(item.field, record.value);
      await delay(35);
      if (safe(item) && !record.edited && read(item.field) === record.value && fieldValid(item.field))
        completed.set(item.field, { label: item.label, value: record.value });
    }
    let undone = 0;
    const unchanged = record => record.kind === "checkbox" ? (record.field.checked ? "Yes" : "No") === record.value : read(record.field) === record.value;
    if (mode === "autofill-undo") {
      for (const record of [...undo].reverse()) if (!record.edited && safe(record) && unchanged(record)) {
        if (record.kind === "checkbox") { if (record.field.checked !== record.beforeChecked) record.field.click(); }
        else setValue(record.field, record.before);
        undone++;
      }
      reset();
    }
    // No filled values are returned to the popup or persisted in extension storage.
    return { fields: describe(), undone, answered: answerTarget ? {
      label: answerTarget.label, profileKey: answerTarget.profileKey, canRemember: answerTarget.canRemember,
    } : undefined, autofillUndoAvailable: undo.some(item => !item.edited && safe(item) && unchanged(item)) };
  };
}
