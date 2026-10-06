// Serialized into the isolated world. Field tokens never come from the page and
// every write is revalidated against the current document and visible label.
export function createAutofillInspector() {
  let pageUrl = "", targets = new Map(), undo = [], expires = 0, expiryTimer;
  let completed = new WeakMap();
  let completedByIdentity = new Map();
  const identity = item => item.field.id ? `${item.field.id}\n${item.label}` : "";
  let issues = new WeakMap();
  const ids = new WeakMap();
  const phoneSeeds = new WeakMap();
  const norm = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const custom = field => field.matches('[role="combobox"],button[aria-haspopup="listbox"],input[data-uxi-widget-type="selectinput"],input[data-automation-id="searchBox"],input[aria-autocomplete="list"][aria-haspopup="listbox"],b-single-select > [role="button"][aria-haspopup][aria-labelledby]');
  const chipText = chip => chip.querySelector('.chip-text')?.textContent.trim() || "";
  const validity = field => {
    const pattern = field.getAttribute("pattern");
    if (pattern) {
      try { new RegExp(pattern, "v"); }
      catch {
        // Old employer patterns can be invalid under HTML's Unicode-set mode.
        // Validate the other native constraints without touching their DOM.
        const copy = field.cloneNode(false); copy.removeAttribute("pattern"); copy.value = field.value;
        return copy.validity?.valid !== false;
      }
    }
    return field.validity?.valid !== false;
  };
  const read = field => {
    const promptId = field.getAttribute("data-uxi-multiselect-id");
    if (promptId) {
      const selected = [...document.querySelectorAll(`[data-automation-id="selectedItemList"][data-uxi-multiselect-id="${CSS.escape(promptId)}"] [data-automation-id="promptOption"]`)];
      if (selected.length) return selected.map(node => node.textContent.trim()).join(", ");
      // The query text is not a saved selection.
      if (custom(field)) return "";
    }
    const chips = field.closest('b-chip-input');
    if (chips) return [...chips.querySelectorAll('b-chip')].map(chipText).join(", ") || field.value || "";
    // React Select keeps its search input empty after selecting a value.
    const container = custom(field) && field.closest('.select__value-container');
    if (container && container.querySelectorAll('[role="combobox"]').length === 1) {
      const values = container.querySelectorAll('.select__single-value');
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
    return field instanceof HTMLSelectElement && field.selectedOptions[0]?.disabled ? "" : field instanceof HTMLButtonElement || (custom(field) && !(field instanceof HTMLInputElement)) ?
      (/^(select|choose)( one| an? .+)?[.\u2026]*$/i.test(field.textContent.trim()) ? "" : field.textContent.trim()) : field.value || "";
  };
  const restricted = label => /disab|veteran|gender|race|ethnic|sexual|religio|birth|social security|ssn|criminal|convict|consent|agree|certify|signature|authoriz|sponsor|visa|citizen|eligible to work|right to work/i.test(label);
  const legal = label => /social security|\bssn\b|signature|certify|terms|privacy (?:policy|act)|criminal|convict|date of birth|confirm.{0,60}(?:accurate|truthful)/i.test(label) ||
    (/agree|consent/i.test(label) && !/receive (?:text |sms |email )?(?:messages|communications)|contact me (?:by|via) (?:sms|email|text)/i.test(label));
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
      if (key === "phone") {
        const digits = text.replace(/\D/g, "");
        return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      }
      if (key === "desiredPayAmount" && /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return String(Number(text.replaceAll(",", "")));
      const countryText = key === "phoneCountry" ? text.replace(/\s*\(?\+1\)?\s*$/, "").trim() : text;
      return ["country", "phoneCountry"].includes(key) ? ({ ca: "canada", us: "united states", usa: "united states", "united states of america": "united states" })[countryText] || countryText :
        key === "region" ? aliases[text] || text : text;
    };
    return canonical(a) === canonical(b);
  };
  function reset() {
    clearTimeout(expiryTimer);
    for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
      item.field.removeEventListener(event, item.onEdit);
    undo = []; targets.clear(); completed = new WeakMap(); completedByIdentity.clear(); issues = new WeakMap(); choiceCache = new WeakMap(); confirmedQuestions.clear(); profileGuidance.clear(); expires = Date.now() + 10 * 60_000;
    pageUrl = location.href;
    expiryTimer = setTimeout(() => {
      for (const item of undo) for (const event of ["input", "change", "pointerdown", "keydown"])
        item.field.removeEventListener(event, item.onEdit);
      undo = []; targets.clear(); completed = new WeakMap(); completedByIdentity.clear(); confirmedQuestions.clear(); profileGuidance.clear(); expires = 0;
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
    if (mode === "autofill") {
      confirmedQuestions = new Map((payload.commonAnswers || []).slice(0, 40)
      .filter(answer => typeof answer.label === "string" && typeof answer.answer === "string")
      .map(answer => [norm(answer.label), answer]));
      profileGuidance = new Map((payload.answerDetails || []).slice(0, 40).map(detail => [norm(detail.label), detail]));
    }
    const operationUrl = location.href;
    const deadline = performance.now() + 12000;
    const radioLabel = group => {
      if (!group) return "";
      const named = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent.trim() || "").join(" ").trim();
      const explicit = group.querySelector('legend')?.textContent?.trim() || group.getAttribute('aria-label') || named ||
        (group.matches('.application-question') && group.querySelectorAll('.application-label').length === 1 ? group.querySelector('.application-label').textContent.trim() : '');
      if (explicit) return explicit;
      // Infer a prompt only within a single isolated radio group. Option labels,
      // helper paragraphs and neighbouring questions must not become its name.
      const candidates = [...group.querySelectorAll('p,label,h2,h3,h4,[role="heading"],div,span')].filter(node =>
        !node.querySelector('input,select,textarea,button') && !node.closest('label:has(input[type="radio"])') &&
        !node.hasAttribute("aria-hidden") && visible(node) && node.textContent.trim() && node.textContent.trim().length <= 500 &&
        (!node.children.length || node.matches('p,label,h2,h3,h4,[role="heading"]')));
      const prompts = [...new Set(candidates.map(node => node.textContent.trim()))];
      return prompts.length === 1 ? prompts[0] : "";
    };
    const groupedEntries = entries.flatMap(entry => {
      if (entry.field.type !== "radio") return [entry];
      const lever = /^(?:jobs|jobs\.eu)\.lever\.co$/.test(location.hostname);
      if (!entry.field.name) return [entry];
      const radios = entries.filter(item => item.field.type === "radio" && item.field.name === entry.field.name);
      let group = entry.field.closest(lever ? 'fieldset,[role="radiogroup"],.application-question' : 'fieldset,[role="radiogroup"]');
      if (!group) {
        let parent = entry.field.parentElement;
        for (let depth = 0; parent && parent !== form && depth < 6; depth++, parent = parent.parentElement) {
          if (radios.length > 1 && radios.every(item => parent.contains(item.field)) &&
              [...parent.querySelectorAll('input,select,textarea,button')].every(field => radios.some(item => item.field === field)) && radioLabel(parent)) {
            group = parent; break;
          }
        }
      }
      const groupLabel = radioLabel(group);
      if (!group || !groupLabel) return [entry];
      if (!radios.every(item => group.contains(item.field))) return [entry];
      if (radios[0].field !== entry.field) return [];
      return [{ ...entry, label: groupLabel, originalLabel: entry.label,
        radioFields: radios.map(item => item.field), radioGroup: group }];
    });
    const current = groupedEntries.filter(({ field, label }) => label && label.length <= 500 &&
      !["hidden", "password", "submit", "reset", "file"].includes(field.type) &&
      (!(field instanceof HTMLButtonElement) || custom(field)));
    const safe = item => location.href === operationUrl && pageUrl === operationUrl && form.isConnected && form.contains(item.field) &&
      item.field.isConnected && visible(item.field) && labelFor(item.field) === (item.originalLabel || item.label) &&
      (!item.radioFields || (item.radioFields.every(field => field.isConnected && form.contains(field) && visible(field) && !field.disabled) &&
        radioLabel(item.radioGroup) === item.label)) &&
      !item.field.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]');
    const items = current.slice(0, 80).map(entry => {
      const { field, label } = entry;
      if (!ids.has(field)) ids.set(field, crypto.randomUUID());
      const id = ids.get(field);
      const key = entry.profileKey;
      const group = field.closest('fieldset,[role="group"],section');
      const heading = group?.querySelector('legend,h2,h3')?.textContent || group?.getAttribute("aria-label") || "";
      const inHistory = entry.inHistory || /work experience|employment (?:history|record|details)|^employment$|education|reference|emergency|supervisor/i.test(heading) ||
        !!field.closest('[data-automation-id^="workExperience-"],[data-automation-id^="education-"]');
      const scalar = field instanceof HTMLTextAreaElement ||
        (field instanceof HTMLInputElement && ["text", "email", "tel", "url", "number", "date"].includes(field.type));
      if (key === "phone" && field.type === "tel" && !phoneSeeds.has(field)) {
        const seed = { value: field.value, edited: false };
        phoneSeeds.set(field, seed);
        if (/^\+\d{1,3}$/.test(seed.value.trim())) {
          const preserve = event => { if (event.isTrusted) seed.edited = true; };
          field.addEventListener("input", preserve);
          field.addEventListener("change", preserve);
        }
      }
      const select = field instanceof HTMLSelectElement && !field.multiple;
      const radio = entry.radioFields?.length > 1;
      const widget = custom(field) && (!(field instanceof HTMLButtonElement) || field.type === "button");
      const ambiguous = key && current.filter(item => item.profileKey === key && norm(item.label) === norm(label)).length !== 1;
      const labelAmbiguous = !key && current.filter(item => norm(item.label) === norm(label)).length !== 1;
      const communicationPreference = ["smsUpdates", "emailUpdates"].includes(confirmedQuestions.get(norm(label))?.answerKey);
      const manual = Boolean(entry.manualReason) || inHistory || ambiguous || labelAmbiguous || (legal(label) && !communicationPreference) ||
        !(scalar || select || widget || radio) || field.hasAttribute("list") ||
        (field.hasAttribute("aria-autocomplete") && !widget);
      const options = select ? [...field.options].filter(option => option.value && !option.disabled && !option.closest('optgroup[disabled]'))
        .slice(0, 250).map(option => option.textContent.trim()) : radio ? entry.radioFields.map(labelFor) :
        choiceCache.get(field)?.label === label ? choiceCache.get(field).options : [];
      const help = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || "").join(" ");
      const limitText = `${label} ${help}`;
      const wordLimit = limitText.match(/(?:max(?:imum)?(?: of)?|up to|limit(?: of|:)?|no more than)\s*(\d{1,4})\s*words\b/i)?.[1] ||
        limitText.match(/\b(\d{1,4})\s*words?\s*(?:max(?:imum)?|limit)\b/i)?.[1];
      const charLimit = limitText.match(/(?:max(?:imum)?(?: of)?|up to|limit(?: of|:)?|no more than)\s*(\d{1,5})\s*characters?\b/i)?.[1];
      const maxLength = Math.min(3000, field.maxLength >= 0 ? field.maxLength : 3000, Number(charLimit) || 3000);
      const maxWords = wordLimit ? Math.min(1000, Number(wordLimit)) : undefined;
      const required = field.required || field.getAttribute("aria-required") === "true" || /[*\u2731]\s*$/.test(label) ||
        (field.matches('b-single-select > [role="button"]') && field.parentElement.hasAttribute("required")) || Boolean(field.closest('b-currency-value-select[required]'));
      const item = { ...entry, id, field, label, profileKey: key, manual, options, maxLength, maxWords,
        canRemember: !manual && !["fullAddress", "professionalUrl", "portfolioGithubUrl", "cityRegion", "skills", "currentCompany", "currentTitle"].includes(key) && !(key === "city" && widget) && (!!key || (!entry.identityLabel && rememberable(label))),
        profileLabel: profileGuidance.get(norm(label))?.profileLabel,
        notApplicable: profileGuidance.get(norm(label))?.notApplicable === true && !required,
        title: key === "phoneCountry" ? "Phone country" : inHistory && heading ? `${heading}: ${label}` : label,
        required,
        kind: radio ? "radio" : select ? "select" : widget ? "combobox" : "text",
        reason: entry.manualReason || (field.type === "file" ? "Use Change resume, or attach this file on the form." : inHistory ? "Review work, education or reference details on the form." :
          manual ? "Review this field on the employer form." : issues.get(field)?.label === label ? issues.get(field).reason : profileGuidance.get(norm(label))?.reason || ""),
      };
      targets.set(id, item);
      return item;
    });
    targets = new Map(items.map(item => [item.id, item]));
    const readItem = item => {
      if (!item.radioFields) return read(item.field);
      const selected = item.radioFields.find(field => field.checked);
      return selected ? labelFor(selected) : "";
    };
    const phonePrefixOnly = item => {
      const seed = item.profileKey === "phone" && phoneSeeds.get(item.field);
      return seed && !seed.edited && /^\+\d{1,3}$/.test(seed.value.trim()) && readItem(item) === seed.value;
    };
    const describe = () => items.filter(safe).map(item => {
      const field = item.field;
      const hasValue = item.radioFields ? Boolean(readItem(item)) : ["checkbox", "radio"].includes(field.type) ? field.checked : !phonePrefixOnly(item) && Boolean(read(field).trim());
      const invalid = hasValue && validity(field) === false;
      const condition = profileGuidance.get(norm(item.label))?.dependsOn;
      const parents = condition ? items.filter(parent => confirmedQuestions.get(norm(parent.label))?.answerKey === condition.answerKey) : [];
      const notApplicable = item.notApplicable && (!condition || (parents.length === 1 && safe(parents[0]) && equivalent(readItem(parents[0]), condition.answer)));
      const today = new Date();
      const date = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")];
      const availability = /^(?:date available|availability date|earliest (?:start|starting) date|available from)\s*[*:]?$/i.test(item.label);
      const dateValue = availability && !item.manual ? field.type === "date" ? date.join("-") :
        /^dd-mm-yyyy$/i.test(field.placeholder || "") ? [...date].reverse().join("-") :
        /^mm\/dd\/yyyy$/i.test(field.placeholder || "") ? `${date[1]}/${date[2]}/${date[0]}` : "" : "";
      const discovery = /^(?:how did you (?:learn about|hear about|find) (?:this (?:job(?: opening)?|position|role)|us))\s*[?*]*$/i.test(item.label);
      const sourceValue = discovery && item.options.includes("Other") ? "Other" : "";
      const completion = completed.get(field) || completedByIdentity.get(identity(item));
      return { id: item.id, label: item.label, title: item.title, profileKey: item.profileKey, required: item.required,
        profileLabel: item.profileLabel,
        maxLength: item.maxLength, maxWords: item.maxWords,
        ...(dateValue ? { suggestedAnswer: dateValue, suggestionLabel: "Use today's date" } : sourceValue ? { suggestedAnswer: sourceValue, suggestionLabel: "Use Other as job source" } : {}),
        kind: item.kind, options: item.options, canAnswer: !item.manual && !invalid,
        canRemember: item.canRemember && !invalid,
        state: invalid ? "needed" : hasValue ? completion?.label === item.label && equivalent(completion?.value, readItem(item), item.profileKey) ? "filled" : "kept" : notApplicable ? "not-applicable" : "needed",
        reason: invalid ? "An existing value is invalid. Correct it on the employer form." : item.notApplicable && !notApplicable ? "Review this follow-up against your answer on the form." : item.reason,
      };
    });
    const closeOptions = field => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
      field.blur();
      if (field.getAttribute("aria-expanded") === "true") field.click();
    };
    const chooseOption = option => (option.querySelector('[data-uxi-widget-type="multiselectlistitem"]') || option).click();
    async function loadOptions(item, keepOpen = false, search = "", previousOptions = []) {
      const field = item.field;
      if (!safe(item) || item.kind !== "combobox" || read(field).trim()) return [];
      const promptIdentity = field.getAttribute("data-uxi-multiselect-id");
      const expanded = field.getAttribute("aria-expanded") === "true" || Boolean(promptIdentity && [...document.querySelectorAll('[role="listbox"]')].some(node => visible(node) && !node.matches('[data-automation-id="selectedItemList"]') && node.querySelector(`[data-uxi-multiselect-id="${CSS.escape(promptIdentity)}"]`)));
      const previousLists = new Set([...document.querySelectorAll('[role="listbox"],[role="tree"]')].filter(visible));
      if (!expanded) field.click();
      if (!expanded && field.getAttribute("aria-expanded") !== "true") {
        field.focus();
        field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, view: window }));
      }
      if (search && field instanceof HTMLInputElement) { field.focus(); setValue(field, search); }
      let options = [];
      let searched = false;
      for (let attempt = 0; attempt < (search ? 64 : 16) && safe(item); attempt++) {
        const bob = field.matches('b-single-select > [role="button"]');
        const lists = (field.getAttribute("aria-controls") || field.getAttribute("aria-owns") || (bob ? `list__${field.id}` : "")).split(/\s+/).filter(Boolean)
          .flatMap(id => [...document.querySelectorAll(`#${CSS.escape(id)}`)])
          .filter(node => node.matches('[role="listbox"],[role="tree"]') && visible(node) &&
            (!bob || node.getAttribute("aria-labelledby") === field.getAttribute("aria-labelledby")));
        const promptId = field.getAttribute("data-uxi-multiselect-id");
        const promptLists = promptId ? [...document.querySelectorAll('[role="listbox"],[role="tree"]')].filter(node => visible(node) &&
          !node.matches('[data-automation-id="selectedItemList"]') && node.querySelector(`[data-uxi-multiselect-id="${CSS.escape(promptId)}"]`)) : [];
        // Some accessible widgets omit aria-controls. Bind only the unique new
        // popup created by this focused control, never an already-open list.
        const opened = [...document.querySelectorAll('[role="listbox"],[role="tree"]')].filter(node => visible(node) && !previousLists.has(node) && !node.matches('[data-automation-id="selectedItemList"]'));
        const list = lists.length === 1 ? lists[0] : promptLists.length === 1 ? promptLists[0] :
          !lists.length && !promptLists.length && opened.length === 1 && (document.activeElement === field || opened[0].contains(document.activeElement)) ? opened[0] : null;
        // One explicit saved choice is also safe in an empty multi-select.
        // Existing chips are read above, so we never add to a user's selection.
        options = list ?
          [...list.querySelectorAll('[role="option"],[role="treeitem"]')].filter(option => visible(option) &&
            option.closest('[role="listbox"],[role="tree"]') === list && !option.matches('[aria-disabled="true"],:disabled')) : [];
        if (list && bob && search && !searched) {
          // A short Yes/No list is already complete. Searching it can remove
          // the live options during Angular's asynchronous filter update.
          if (options.some(option => norm(option.textContent) === norm(search))) break;
          const searchBox = list.closest('.cdk-overlay-pane')?.querySelector('input[type="search"][aria-controls]');
          if (searchBox?.getAttribute("aria-controls") === list.id) {
            setValue(searchBox, search);
            searchBox.dispatchEvent(new KeyboardEvent("keyup", { key: search.at(-1), bubbles: true }));
            searched = true; await delay(100); continue;
          }
        }
        if (previousOptions.length && options.some(option => previousOptions.includes(option))) {
          await delay(25); continue;
        }
        if (options.length && (!search || options.some(option => norm(option.textContent).includes(norm(search))))) break;
        if (list && options.length && list.scrollHeight > list.clientHeight && attempt % 4 === 3 && list.scrollTop + list.clientHeight < list.scrollHeight) {
          list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(32, list.clientHeight - 32));
          list.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
        await delay(25);
      }
      item.options = options.map(option => option.textContent.trim()).slice(0, 250);
      choiceCache.set(field, { label: item.label, options: item.options });
      if (!keepOpen && safe(item) && !expanded) closeOptions(field);
      if (!options.length) item.reason = "No choices available yet. This field may need a search on the employer form.";
      return options;
    }
    async function write(item, value) {
      if (performance.now() > deadline) { item.reason = "Click Autofill again to continue on this long form."; return false; }
      if (!safe(item) || item.manual || (readItem(item).trim() && !phonePrefixOnly(item)) || typeof value !== "string" || !value.trim()) return false;
      if (value.length > item.maxLength || (item.maxWords && value.trim().split(/\s+/).length > item.maxWords)) {
        item.reason = `Shorten this answer to ${item.maxWords ? `${item.maxWords} words and ` : ""}${item.maxLength} characters.`; return false;
      }
      let field = item.field;
      const before = readItem(item), originalValue = field.value;
      let phoneEdited = false, phoneEditField;
      const watchPhoneEdit = event => { if (event.isTrusted) phoneEdited = true; };
      const saved = confirmedQuestions.get(norm(item.label));
      if (saved?.dependsOn) {
        const parents = items.filter(parent => confirmedQuestions.get(norm(parent.label))?.answerKey === saved.dependsOn.answerKey);
        const parent = parents.length === 1 ? parents[0] : null;
        const selected = parent?.kind === "select" ? parent.field.selectedOptions[0]?.textContent : parent && readItem(parent);
        if (!parent || !safe(parent) || !equivalent(selected, saved.dependsOn.answer)) {
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
      const optionMatches = (text, candidate = value) => equivalent(text, candidate, item.profileKey);
      const matchingOptions = options => {
        const exact = options.filter(option => optionMatches(option.textContent));
        if (exact.length || !saved || saved.answer !== value) return exact;
        for (const alternative of saved.alternatives || []) {
          const matches = options.filter(option => optionMatches(option.textContent, alternative));
          if (matches.length) return matches;
        }
        return [];
      };
      if (item.kind === "radio") {
        const matches = matchingOptions(item.radioFields.map(field => ({ field, textContent: labelFor(field) })));
        if (matches.length !== 1) { item.reason = "Choose a matching answer on the form."; return false; }
        value = matches[0].textContent.trim();
        matches[0].field.click();
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
        const bobSearch = field.matches('b-single-select > [role="button"]') ?
          (["country", "phoneCountry"].includes(item.profileKey) ? ({ CA: "Canada", US: "United States" })[value] || value : value) : "";
        // Inspect ordinary choices before filtering. The displayed equivalent
        // may differ from a saved preference (for example, a decline option).
        let search = citySearch ? value : bobSearch || (["country", "phoneCountry"].includes(item.profileKey) && field instanceof HTMLInputElement ?
          ({ CA: "Canada", US: "United States" })[value] || value : "");
        let options = await loadOptions(item, true, search);
        let matches = citySearch ? options.filter(option => matchesValue(option.textContent)) : matchingOptions(options);
        const queryOnly = field.hasAttribute("data-uxi-multiselect-id");
        if (!matches.length && (field instanceof HTMLInputElement || bobSearch)) {
          // Virtualized lists may not render "Other" until searched. Use only
          // server-approved equivalents, not a nearest-looking option.
          for (const candidate of [value, ...(saved?.answer === value ? saved.alternatives || [] : [])].slice(0, 4)) {
            if (!safe(item) || edited || read(field) !== (queryOnly || !(field instanceof HTMLInputElement) ? before : search || before) || performance.now() > deadline) break;
            search = candidate;
            options = await loadOptions(item, true, search);
            matches = citySearch ? options.filter(option => matchesValue(option.textContent)) : matchingOptions(options);
            if (matches.length) break;
          }
        }
        field.removeEventListener("input", onEdit);
        if (!safe(item) || edited || read(field) !== (queryOnly ? before : search && field instanceof HTMLInputElement ? search : before) || matches.length !== 1) {
          if (safe(item) && !edited && search && field instanceof HTMLInputElement && field.value === search) setValue(field, originalValue || "");
          if (safe(item) && !edited && !expanded) closeOptions(field);
          item.reason = "Choose a matching option on the form."; return false;
        }
        // Validate against the selected display value, not the temporary search.
        value = matches[0].textContent.trim();
        chooseOption(matches[0]);
        if (queryOnly && saved?.answerKey === "jobSource" && !read(field).trim()) {
          // A job-board category may open a nested menu rather than select a
          // value. Search only the server-approved source alternatives there.
          const children = await loadOptions(item, true, "Other", options);
          const leaves = children.filter(option => (saved.alternatives || []).some(candidate => equivalent(option.textContent, candidate)));
          if (leaves.length === 1) { value = leaves[0].textContent.trim(); chooseOption(leaves[0]); }
        }
        if (safe(item) && field.getAttribute("aria-expanded") === "true") closeOptions(field);
      } else {
        if (item.profileKey === "phone") {
          phoneEditField = field;
          field.addEventListener("input", watchPhoneEdit);
          const country = payload.contact?.phoneCountry;
          let digits = value.replace(/\D/g, "");
          if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
          const international = phonePrefixOnly(item) || /(?:with|including) (?:country|dial(?:ing)?) code|international (?:phone|number|format)/i.test(
            `${field.getAttribute("aria-label") || ""} ${field.placeholder || ""} ${item.label}`) || Boolean(field.closest('.iti,.intl-tel-input'));
          // Tell an international widget the saved country before its formatter
          // can prepend an employer's unrelated default country code.
          if (international && ["CA", "US"].includes(country) && /^\d{10}$/.test(digits)) value = `+1${digits}`;
        }
        setValue(field, value);
        // International-only native phone inputs may reject the saved national
        // format. Add a dial code only when the profile explicitly identifies it.
        if (item.profileKey === "phone" && safe(item) && !validity(field) &&
          ["CA", "US"].includes(payload.contact?.phoneCountry) && /^\d{10}$/.test(value.replace(/\D/g, ""))) {
          value = `+1${value.replace(/\D/g, "")}`; setValue(field, value);
        }
      }
      await delay(35);
      phoneEditField?.removeEventListener("input", watchPhoneEdit);
      if (!field.isConnected && field.id && form.isConnected) {
        const replacements = [...form.querySelectorAll(`#${CSS.escape(field.id)}`)].filter(node => visible(node) && labelFor(node) === (item.originalLabel || item.label) && node.tagName === field.tagName && node.type === field.type);
        if (replacements.length === 1) { field = replacements[0]; item.field = field; ids.set(field, item.id); }
      }
      const valid = safe(item) && Boolean(readItem(item).trim()) &&
        (item.kind === "select" ? equivalent(field.selectedOptions[0]?.textContent, value, item.profileKey) : equivalent(readItem(item), value, item.profileKey || saved?.answerKey)) && validity(field) !== false;
      if (!valid) {
        if (safe(item) && item.kind === "text" && (read(field) === value || (phoneEditField && !phoneEdited))) setValue(field, before);
        item.reason = "The form did not confirm this value. Check it on the page."; return false;
      }
      completed.set(field, { label: item.label, value: readItem(item) });
      if (identity(item)) completedByIdentity.set(identity(item), { label: item.label, value: readItem(item) });
      issues.delete(field);
      item.reason = "";
      if (!["combobox", "radio"].includes(item.kind)) {
        const record = { ...item, before: originalValue, value: read(field), edited: false };
        record.onEdit = event => { if (event.isTrusted) record.edited = true; };
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
        answerTarget.field.focus({ preventScroll: true });
      } else if (!(await write(answerTarget, payload.answer))) {
        return { error: answerTarget.reason || "This field already has a value or needs entry on the form." };
      }
    }
    // Fast scalar fields first: a slow remote dropdown must not starve contact fields.
    const writeOrder = item => confirmedQuestions.get(norm(item.label))?.dependsOn ? 2 : Number(item.kind === "combobox");
    if (mode === "autofill") for (const item of [...items].sort((a, b) => writeOrder(a) - writeOrder(b))) {
      if (item.profileKey === "skills" && item.field.closest('b-chip-input')) {
        const field = item.field;
        if (!safe(item) || item.manual || readItem(item).trim()) continue;
        for (const skill of (payload.skills || []).slice(0, 25)) {
          if (!safe(item) || typeof skill !== "string" || !skill.trim() || skill.length > 120 || performance.now() > deadline) break;
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
      if (!item.profileKey || item.kind !== "text" || item.manual || !safe(item)) continue;
      const record = undo.find(record => record.field === item.field && record.label === item.label &&
        record.profileKey === item.profileKey && !record.before && !record.edited);
      if (!record || equivalent(read(item.field), record.value, item.profileKey)) continue;
      setValue(item.field, record.value);
      await delay(35);
      if (safe(item) && !record.edited && read(item.field) === record.value && validity(item.field))
        completed.set(item.field, { label: item.label, value: record.value });
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
