import { createFieldValidity } from "./field-validity.mjs";

// Serialized alongside the inspector: keep helpers inside this factory. Record
// actions require a history owner and a bounded editor, never the application.
export function createHistoryInspector() {
  return createHistoryRuntime(createFieldValidity());
}
createHistoryInspector.toString = () => `(function() {
  return (${createHistoryRuntime})((${createFieldValidity})());
})`;

function createHistoryRuntime(fieldValid) {
  let undo = [],
    lastUrl = "",
    expiryTimer;
  const created = new WeakSet();
  const saved = new WeakMap();
  const pending = new WeakMap();
  const normalize = (value) =>
    value
      .normalize("NFKC")
      .replace(/[\u2018\u2019]/g, "'")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[*:]|\(required\)|\(optional\)/gi, "")
      .trim()
      .toLowerCase();
  const keys = {
    "job title": "title",
    "position title": "title",
    title: "title",
    position: "title",
    role: "title",
    company: "company",
    "company name": "company",
    employer: "company",
    school: "school",
    "school name": "school",
    university: "school",
    institution: "school",
    "institution name": "school",
    "school / university": "school",
    "college/university": "school",
    "school or university": "school",
    "college or university": "school",
    degree: "degree",
    qualification: "degree",
    "qualification name": "degree",
    "field of study": "fieldOfStudy",
    "major / field of study": "fieldOfStudy",
    major: "fieldOfStudy",
    discipline: "fieldOfStudy",
    location: "location",
    description: "description",
    summary: "description",
    responsibilities: "description",
    "role description": "description",
    "start date": "start",
    from: "start",
    "end date": "end",
    to: "end",
    "start year": "startYear",
    "start month": "startMonth",
    "end year": "endYear",
    "end month": "endMonth",
    "start date year": "startYear",
    "start date month": "startMonth",
    "end date year": "endYear",
    "end date month": "endMonth",
    "is current": "current",
    "i currently work here": "current",
    "currently employed here": "current",
    "currently studying here": "current",
    "i currently study here": "current",
    "i currently attend this institution": "current",
  };
  const controlsSelector = 'input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"]';
  const containersSelector = 'fieldset,section,article,li,[role="group"],[role="region"],[data-automation-id],careers-ui-experience-form-control,careers-ui-experience-edit-item,.education--form,.education--container';
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthAlternatives = value => [months[Number(value) - 1], months[Number(value) - 1]?.slice(0, 3), String(Number(value)), value].filter(Boolean);
  const institution = (value) => {
    // Only remove an explicit academic-unit suffix. Campuses, cities, acronyms,
    // and similarly named institutions are not interchangeable.
    const text = value.trim();
    const match = text.match(/^(.+?)(?:\s+[-\u2013\u2014]\s+|,\s*|\s*\()((?:[a-z][a-z.'\s&-]{0,80}\s+)?(?:department|faculty|school|college|division)\s+of\s+.+?)\)?$/i);
    return match && /\b(university|college|institute|polytechnic)\b/i.test(match[1]) &&
      !/\b(university|institute|polytechnic|campus)\b/i.test(match[2]) ? match[1].trim() : text;
  };
  let regions;
  const regionName = value => {
    if (!regions) {
      regions = new Set();
      const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const name = names.of(String.fromCharCode(a, b));
        if (name) regions.add(normalize(name));
      }
      regions.add("united states of america");
    }
    return regions.has(normalize(value));
  };
  const optionLabel = (option, key) => {
    const full = option.textContent.trim();
    if (key !== "school") return full;
    const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) if (node.textContent.trim()) parts.push(node.textContent.trim());
    // Rich school options present Name / Country / Domain. Strip only this
    // unambiguous metadata shape; never discard a campus, city or qualification.
    if (parts.length === 3 && regionName(parts[1]) &&
        /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(parts[2])) return parts[0];
    return full;
  };
  const optionMatches = (options, value, key, textOf) => {
    const exact = options.filter(option => normalize(textOf(option)) === normalize(value));
    if (exact.length) return exact;
    const alternatives = key === "degree" ? degreeAlternatives(value) : /Month$/.test(key) ? monthAlternatives(value) : [];
    if (key === "school") return options.filter(option => normalize(institution(textOf(option))) === normalize(institution(value)));
    return options.filter(option => alternatives.some(label => normalize(textOf(option)) === normalize(label)));
  };
  const degreeAlternatives = (value) => {
    const text = normalize(value).replace(/[\u2018\u2019]/g, "'");
    const short = text.replace(/[.\s]/g, "");
    const abbreviations = {
      bachelor: ["bsc", "bs", "ba", "beng", "basc", "bba", "bcom", "bcs"],
      master: ["msc", "ms", "ma", "meng", "masc", "mba"],
      doctorate: ["phd"],
    };
    const mentions = level => new RegExp(`\\b(?:${abbreviations[level].map(abbreviation => abbreviation.split("").join("[.\\s]*")).join("|")})\\b`, "i").test(text);
    const bachelor = /^bachelor(?:'?s)?(?: of| degree|$)/.test(text) || abbreviations.bachelor.includes(short);
    const master = /^master(?:'?s)?(?: of| degree|$)/.test(text) || abbreviations.master.includes(short);
    const doctorate = /^doctor(?:ate| of philosophy)(?:\b|$)/.test(text) || short === "phd";
    // Full program names can map down to their explicit qualification level,
    // never across subjects or from mixed-level credentials to a higher degree.
    if (bachelor && !/\bmaster|\bdoctor/.test(text) && !mentions("master") && !mentions("doctorate")) return ["Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors", "Bachelor", "Bachelor Degree"];
    if (master && !/\bbachelor|\bdoctor/.test(text) && !mentions("bachelor") && !mentions("doctorate")) return ["Master's Degree", "Masters Degree", "Master Degree", "Master's", "Masters", "Master", ...(short === "mba" ? ["Master of Business Administration (M.B.A.)"] : [])];
    if (doctorate && !/\bbachelor|\bmaster/.test(text) && !mentions("bachelor") && !mentions("master")) return ["Doctor of Philosophy (Ph.D.)", "Doctorate", "Doctoral Degree", "PhD"];
    return [];
  };
  const setter = (field, value) => {
    const proto =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const custom = (field) => field.matches('[role="combobox"], button[aria-haspopup="listbox"]');
  const read = (field) => {
    if (field.type === "checkbox") return field.checked ? "true" : "";
    const selected = custom(field) && field.closest('.select__value-container')?.querySelector('.select__single-value');
    if (selected) return selected.textContent.trim();
    if (!custom(field) || field instanceof HTMLInputElement) return field.value || "";
    const text = field.textContent.trim();
    return /^(?:(?:select|choose)(?: (?:one|a school|school|an institution|degree))?(?:\.{3})?|none|--?)$/i.test(text) ? "" : text;
  };
  const display = field => field instanceof HTMLSelectElement && field.value ? field.selectedOptions[0]?.textContent || "" : read(field);
  const required = field => field.required || field.getAttribute("aria-required") === "true";
  const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
  const dateValue = (value, part, field) => {
    if (field.type === "month" && value.length >= 7) return value.slice(0, 7);
    if (/^MM\s*\/\s*YYYY$/i.test(field.placeholder || "") && value.length >= 7)
      return `${value.slice(5, 7)}/${value.slice(0, 4)}`;
    // Employer forms often require a day while resumes supply months. Keep
    // profile precision unchanged; only adapt the value written to this widget.
    if (/^\d{4}-\d{2}$/.test(value)) {
      const day = part === "start" ? 1 : new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).getUTCDate();
      value = `${value}-${String(day).padStart(2, "0")}`;
    }
    if (value.length !== 10) return;
    if (field.type === "date" || /^yyyy-mm-dd$/i.test(field.placeholder || "")) return value;
    if (/^dd-mm-yyyy$/i.test(field.placeholder || "")) return `${value.slice(8)}-${value.slice(5, 7)}-${value.slice(0, 4)}`;
    if (/^mm\/dd\/yyyy$/i.test(field.placeholder || "")) return `${value.slice(5, 7)}/${value.slice(8)}/${value.slice(0, 4)}`;
    if (/^dd\/mm\/yyyy$/i.test(field.placeholder || "")) return `${value.slice(8)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  };
  // Never infer a popup from its position or choose another question's options.
  async function choose(field, label, safe, visible, restoreLabel, alternatives = [], key) {
    if (!safe() || !visible(field) ||
        (field instanceof HTMLButtonElement && field.type !== "button") ||
        field.matches(':disabled, [aria-disabled="true"], [aria-readonly="true"]')) return null;
    const expandedBefore = field.getAttribute("aria-expanded") === "true";
    if (!expandedBefore) field.click();
    if (field.getAttribute("aria-expanded") !== "true") {
      field.focus();
      field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
    }
    const linkedList = () => {
      const ids = (field.getAttribute("aria-controls") || field.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
      const lists = ids.flatMap((id) => {
        const nodes = document.querySelectorAll(`#${CSS.escape(id)}`);
        return nodes.length === 1 ? [nodes[0]] : [];
      }).filter((node) => node?.matches('[role="listbox"]') && visible(node));
      return lists.length === 1 && lists[0].getAttribute("aria-multiselectable") !== "true" ? lists[0] : null;
    };
    const close = () => {
      if (safe(read(field)) && !expandedBefore) {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); field.blur();
        if (!(field instanceof HTMLInputElement) && field.getAttribute("aria-expanded") === "true") field.click();
      }
    };
    let search = key === "school" && field instanceof HTMLInputElement ? field : null;
    let list;
    for (let attempt = 0; attempt < 20 && safe(); attempt++) {
      list = linkedList();
      if (list || search) break;
      await wait();
    }
    if (key === "school" && list && !search) {
      const inputs = [...list.querySelectorAll('input[type="search"],input[role="searchbox"],input[type="text"]')]
        .filter(input => visible(input) && !input.matches(':disabled,[readonly],[aria-disabled="true"]'));
      if (inputs.length === 1 && !inputs[0].value) search = inputs[0];
    }
    const beforeSearch = search?.value || "";
    const query = search ? institution(label) : "";
    let edited = false;
    const onEdit = event => { if (event.isTrusted) edited = true; };
    for (const type of ["input", "change", "keydown", "pointerdown"]) search?.addEventListener(type, onEdit);
    const clean = () => {
      for (const type of ["input", "change", "keydown", "pointerdown"]) search?.removeEventListener(type, onEdit);
    };
    const safeSearch = () => !edited && safe(search === field ? query : undefined) &&
      (!search || (search.isConnected && search.value === query));
    const fail = () => {
      if (search && safeSearch()) setter(search, beforeSearch);
      close(); clean(); return null;
    };
    if (search) {
      if (!safe() || search.readOnly || search.disabled || beforeSearch || (search.maxLength > 0 && query.length > search.maxLength)) { clean(); close(); return null; }
      setter(search, query);
    }
    // Async search may replace the listbox or briefly retain stale options.
    // Re-resolve ownership and wait for a quiet, non-busy result set.
    let options = [], previous = "", stableSince = Date.now();
    const started = Date.now();
    for (let attempt = 0; attempt < 100 && safeSearch(); attempt++) {
      list = linkedList();
      options = list ? [...list.querySelectorAll('[role="option"]')].filter(option =>
        option.closest('[role="listbox"]') === list && visible(option) &&
        !option.matches(':disabled,[aria-disabled="true"]')) : [];
      const signature = JSON.stringify(options.map(option => [option.textContent, option.getAttribute("data-value")]));
      if (signature !== previous || list?.getAttribute("aria-busy") === "true" || field.getAttribute("aria-busy") === "true") {
        previous = signature; stableSince = Date.now();
      }
      if (options.length && Date.now() - stableSince >= 200 && (!search || Date.now() - started >= 500)) break;
      await wait();
    }
    if (!safeSearch() || !list || !options.length || Date.now() - stableSince < 200 ||
        list.getAttribute("aria-busy") === "true" || field.getAttribute("aria-busy") === "true") return fail();
    const empty = options.filter((option) => option.getAttribute("data-value") === "" || option.getAttribute("value") === "");
    let matches = optionMatches(options, label, key, option => optionLabel(option, key));
    if (!matches.length) matches = options.filter(option => alternatives.some(value => normalize(option.textContent) === normalize(value)));
    if (matches.length !== 1) return fail();
    const beforeLabel = restoreLabel || (empty.length === 1 ? empty[0].textContent.trim() : undefined);
    const option = matches[0], value = optionLabel(option, key);
    if (!safeSearch() || !list.isConnected || !option.isConnected ||
        option.closest('button:not([type="button"]),a[href],input[type="submit"]')) return fail();
    let changed = false;
    const onChange = () => { changed = true; };
    field.addEventListener("change", onChange);
    field.addEventListener("input", onChange);
    option.click();
    let accepted = false;
    for (let attempt = 0; attempt < 40 && !edited && safe(read(field)); attempt++) {
      const selected = option.getAttribute("aria-selected") === "true" ||
        Boolean(field.closest('.select__value-container')?.querySelector('.select__single-value'));
      accepted = normalize(read(field)) === normalize(value) &&
        (key !== "school" || field.getAttribute("aria-expanded") === "false") &&
        (!(field instanceof HTMLInputElement) || selected ||
          (field.getAttribute("aria-expanded") === "false" && (changed || read(field) !== query)));
      if (accepted) break;
      await wait();
    }
    field.removeEventListener("change", onChange);
    field.removeEventListener("input", onChange);
    if (!accepted) return fail();
    clean();
    return { beforeLabel, value };
  }
  function clear() {
    clearTimeout(expiryTimer);
    for (const entry of undo) {
      entry.field.removeEventListener("input", entry.onEdit);
      entry.field.removeEventListener("change", entry.onEdit);
      entry.field.removeEventListener("pointerdown", entry.onEdit);
      entry.field.removeEventListener("keydown", entry.onEdit);
    }
    undo = [];
  }
  const kindOf = (group) => {
    if (/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/.test(location.hostname) && group.matches('.education--form,.education--container')) return "education";
    const labelled = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || "").join(" ");
    const localLabel = group.querySelector(":scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > header > h2,:scope > header > h3,:scope > label");
    const first = group.firstElementChild;
    // A heading/label immediately owns the following record controls even when
    // a framework renders plain divs instead of semantic sections/fieldsets.
    const heading = localLabel && !localLabel.querySelector(controlsSelector) ? localLabel :
      first && !first.querySelector(controlsSelector) ? first.querySelector("h2,h3,h4,label") : null;
    const label = normalize(group.getAttribute("aria-label") || labelled || heading?.textContent || "");
    const auto = group.getAttribute("data-automation-id") || "";
    const bob = group.matches('careers-ui-experience-edit-item') ? group.parentElement : group;
    const bobType = bob.matches('careers-ui-experience-form-control') && bob.getAttribute("data-testid");
    if (/^(?:work experience|work history|career history|employment(?: history)?|professional experience)(?: \d+)?$/.test(label) || /^workExperience-\d+$/.test(auto) || bobType === "efc-experiences") return "experience";
    if (/^(?:education|education history|academic history|highest education qualification)(?: \d+)?$/.test(label) || /^education-\d+$/.test(auto) || bobType === "efc-education") return "education";
    return null;
  };
  const actionLabel = (button, verb) =>
    new RegExp(`^(?:\\+\\s*)?${verb}(?: (?:another|more))?(?: (?:work |employment |education )?(?:experience|entry|education|record|qualification))?$`, "i")
      .test((button.getAttribute("aria-label") || button.textContent).trim());
  const action = (button, verb) => button instanceof HTMLButtonElement &&
    (button.type === "button" || (!button.form && !button.closest("form"))) && actionLabel(button, verb);
  const savesIn = (group, visible, includeUnsafe = false) => [...group.querySelectorAll("button")]
    .filter(button => visible(button) && actionLabel(button, "save") && (includeUnsafe || button.type === "button"));
  const controlFields = (group, visible) => [...group.querySelectorAll(controlsSelector)].filter(field =>
    visible(field) && (!["hidden", "submit", "button", "reset"].includes(field.type) || custom(field)));
  function discover(form, labelFor, visible) {
    const structural = [...form.querySelectorAll("div")];
    const sections = [...new Set([...form.querySelectorAll(containersSelector), ...structural])]
      .filter(group => kindOf(group) && visible(group));
    const ownerOf = group => sections.filter(section => section === group || section.contains(group))
      .reduce((owner, section) => !owner || owner.contains(section) ? section : owner, null);
    const inline = new Set(sections.filter(section => !savesIn(section, visible, true).length)
      .flatMap(section => [...section.querySelectorAll("div")]));
    const candidates = [...new Set([...form.querySelectorAll(containersSelector),
      ...sections, ...inline,
      ...sections.flatMap(section => [...section.querySelectorAll("div")].filter(group => savesIn(group, visible, true).length === 1))])];
    const groups = candidates.flatMap(group => {
      const owner = ownerOf(group);
      const kind = kindOf(group) || (owner && kindOf(owner));
      if (!kind || !visible(group)) return [];
      const fields = controlFields(group, visible).filter(field =>
        !field.matches('[list],select[multiple]') &&
        (!field.hasAttribute("aria-autocomplete") || custom(field)) &&
        (custom(field) || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement ||
          ["text", "search", "month", "date", "number", "checkbox"].includes(field.type)))
        .map(field => {
          const label = normalize(labelFor(field));
          let key = keys[label];
          if (!key && /^(month|year)$/.test(label)) {
            const dateGroup = field.closest('fieldset,[role="group"]');
            const dateLabel = normalize(dateGroup?.getAttribute("aria-label") || dateGroup?.querySelector("legend")?.textContent || "");
            if (/^(start|end) date$/.test(dateLabel)) key = dateLabel.split(" ")[0] + (label === "year" ? "Year" : "Month");
          }
          return { field, key };
        })
        .filter(entry => entry.key && (entry.field.type !== "checkbox" || entry.key === "current") &&
          (!custom(entry.field) || /^(school|degree|fieldOfStudy|startMonth|endMonth|startYear|endYear)$/.test(entry.key)));
      // A degree-only wrapper is a field scope, not a school identity. Keep its
      // containing school row instead of deduplicating unrelated institutions.
      const required = kind === "experience" ? ["title", "company"] : ["school"];
      if (!required.every(key => fields.filter(entry => entry.key === key).length === 1)) return [];
      // A single School field wrapper is not the record. Structural rows need
      // corroborating history fields, otherwise sibling dates/major get lost.
      if (inline.has(group) && !kindOf(group) && !group.matches(containersSelector) && new Set(fields.map(entry => entry.key)).size < 2) return [];
      return [{ group, owner, kind, fields, required }];
    }).filter((item, _, all) => !all.some(other => other !== item && (
      // Prefer the tightest scope that retains every recognized field belonging
      // to this identity. A name-only inner wrapper must not lose sibling dates.
      (item.group.contains(other.group) && item.fields.every(entry => other.fields.some(field => field.field === entry.field))) ||
      (other.group.contains(item.group) && other.fields.length > item.fields.length && item.fields.every(entry => other.fields.some(field => field.field === entry.field)))
    )));
    const repeaters = sections.flatMap(group => {
      const buttons = [...group.querySelectorAll('button')].filter(button =>
        visible(button) && action(button, "add") && !groups.some(item => item.group !== group && item.group.contains(button)));
      return buttons.length === 1 ? [{ group, kind: kindOf(group), button: buttons[0] }] : [];
    }).filter((item, _, all) => !all.some(other => other !== item && item.group.contains(other.group) && item.button === other.button));
    for (const item of groups) {
      item.repeater = repeaters.filter(repeater => repeater.kind === item.kind && repeater.group.contains(item.group)).at(-1);
      item.editor = Boolean(item.repeater && item.repeater.group !== item.group && savesIn(item.group, visible, true).length);
    }
    return { groups, repeaters };
  }
  return async function inspectHistory(mode, payload, form, labelFor, visible) {
    if (
      lastUrl !== location.href ||
      undo.some((entry) => entry.expires <= Date.now())
    )
      clear();
    const { groups, repeaters } = discover(form, labelFor, visible);
    if (mode === "history-fields") return groups.flatMap(group => group.fields.map(entry => ({ ...entry, kind: group.kind })));
    const emptyGroup = ({ group, fields }) =>
      fields.every(({ field }) => !read(field).trim()) &&
      ![...group.querySelectorAll(controlsSelector)].some(
        (field) =>
          visible(field) &&
          (custom(field) ? read(field).trim() :
          !["hidden", "button", "submit", "reset"].includes(field.type) &&
          (["checkbox", "radio"].includes(field.type)
            ? field.checked
            : field.value.trim())),
      );
    const available = groups.length > 0 || repeaters.length > 0;
    const validUndo = (entry) =>
      lastUrl === location.href &&
      !entry.edited &&
      entry.field.isConnected &&
      visible(entry.field) &&
      !entry.field.matches(':disabled, [aria-disabled="true"], [readonly], [aria-readonly="true"]') &&
      entry.group.contains(entry.field) &&
      read(entry.field) === entry.value &&
      (!entry.custom || Boolean(entry.beforeLabel)) &&
      groups.some(
        (item) =>
          item.group === entry.group &&
          item.fields.some(
            ({ field, key }) => field === entry.field && key === entry.key,
          ),
      );
    if (mode === "undo-history") {
      let undone = 0,
        kept = 0;
      for (const entry of undo) {
        if (!validUndo(entry)) {
          kept++;
          continue;
        }
        if (entry.custom) {
          await choose(entry.field, entry.beforeLabel, () => validUndo(entry), visible, entry.beforeLabel);
        } else setter(entry.field, entry.before);
        if (read(entry.field) === entry.before) undone++;
        else kept++;
      }
      clear();
      return { undone, kept };
    }
    if (mode !== "fill-history")
      return {
        historyAvailable: available,
        historyUndoAvailable: undo.some(validUndo),
      };
    if (!payload || !["experience", "education"].includes(payload.kind))
      return { error: "Choose a saved work or education entry first." };
    const requiredIdentity = payload.kind === "experience" ? ["title", "company"] : ["school"];
    if (!requiredIdentity.every(key => typeof payload.entry?.[key] === "string" && payload.entry[key].trim()))
      return { error: "Complete this entry's title and employer, or school, in your profile first." };
    const matching = groups.filter((item) => item.kind === payload.kind);
    const fingerprint = JSON.stringify([payload.entry?.title, payload.entry?.company, payload.entry?.school, payload.entry?.degree, payload.entry?.dates]);
    const values = { ...payload.entry };
    for (const part of ["start", "end"]) {
      const value = part === "end" && values.dates?.current ? "" : values.dates?.[part];
      if (typeof value === "string" && /^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(value)) {
        if (value.length === 10 && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) continue;
        values[part] = value;
        values[`${part}Year`] = value.slice(0, 4);
        if (value.length >= 7) values[`${part}Month`] = value.slice(5, 7);
      }
    }
    const identityMatches = item => [...item.required, ...(item.kind === "education" && item.fields.some(f => f.key === "degree") ? ["degree"] : [])]
      .every(key => values[key] && optionMatches([item.fields.find(f => f.key === key).field], values[key], key, display).length === 1);
    // A matching identity allows finishing a bounded editor, never replacing
    // any existing value. Every populated field must still match the profile.
    const compatible = item => (!pending.has(item.group) || pending.get(item.group) === fingerprint) &&
      (item.editor || item.fields.some(({ field, key }) =>
      !read(field).trim() && typeof values[key] === "string" && values[key].trim())) &&
      (pending.get(item.group) === fingerprint || item.fields.some(({ field, key }) =>
        [...item.required, "degree"].includes(key) && read(field).trim() && values[key] &&
        optionMatches([field], values[key], key, display).length === 1)) &&
      controlFields(item.group, visible).every(field => {
        if (!read(field).trim()) return true;
        const key = item.fields.find(f => f.field === field)?.key;
        if (!key) return false;
        if (key === "current") return values.dates?.current === true;
        const expected = ["start", "end"].includes(key) && values[key] ? dateValue(values[key], key, field) : values[key];
        return typeof expected === "string" && optionMatches([field], expected, key, display).length === 1;
      });
    const resumable = matching.filter(compatible);
    if (resumable.length > 1)
      return { filled: 0, skipped: 1, warning: "More than one history row matches this entry. Review the rows before continuing." };
    const summaryMatches = group => {
      const identities = payload.kind === "experience" ? [[values.title], [values.company]] : [[institution(values.school)], values.degree ? [values.degree, ...degreeAlternatives(values.degree)] : []];
      return [...group.querySelectorAll('div,article,li,p,[role="listitem"]')].some(node =>
        visible(node) && !node.querySelector(controlsSelector) && identities.every(alternatives => !alternatives.length || alternatives.some(value =>
          typeof value === "string" && value.trim() && normalize(node.textContent).includes(normalize(value)))));
    };
    const knownSaved = repeaters.some(item => item.kind === payload.kind &&
      (saved.get(item.group)?.has(fingerprint) || summaryMatches(item.group)));
    if (
      knownSaved || matching.some(item => (identityMatches(item) || saved.get(item.group)?.has(fingerprint)) && !resumable.includes(item))
    )
      return {
        error:
          "This entry may already be present. Review the existing rows before adding it again.",
      };
    const empty = matching.filter(emptyGroup);
    const focused = empty.filter(({ group }) =>
      group.contains(document.activeElement),
    );
    const unambiguousOwner = repeaters.filter(item => item.kind === payload.kind).length <= 1;
    if (payload.automatic && repeaters.some(item => item.kind === payload.kind &&
        controlFields(item.group, visible).some(field => !matching.some(row => row.group.contains(field)))))
      return { filled: 0, skipped: 1, warning: "An existing history row cannot be identified safely. Review its school or employer before adding another." };
    if (payload.automatic && repeaters.some(item => item.kind === payload.kind && pending.has(item.group)))
      return { filled: 0, skipped: 1, warning: "The previous history record operation needs review before adding another record." };
    const blocked = matching.some(item => !emptyGroup(item) && !resumable.includes(item) &&
      (item.editor || pending.has(item.group) || item.required.some(key => !read(item.fields.find(f => f.key === key).field).trim())));
    if (payload.automatic && blocked)
      return { filled: 0, skipped: 1, warning: "Complete the partially filled history row before adding another." };
    const target = resumable.length === 1 ? resumable[0] :
      payload.automatic && unambiguousOwner ? empty[0] : !payload.automatic && empty.length === 1 ? empty[0] : focused.length === 1 ? focused[0] : null;
    if (!target && payload.automatic && !payload.addAttempted) {
      if (matching.some(item => !emptyGroup(item) && item.required.some(key => !read(item.fields.find(f => f.key === key).field).trim())))
        return { filled: 0, skipped: 1, warning: "Complete the partially filled history row before adding another." };
      const candidates = repeaters.filter(item => item.kind === payload.kind &&
        !item.button.matches(':disabled,[aria-disabled="true"]') &&
        !matching.some(row => row.editor && item.group.contains(row.group)));
      if (candidates.length === 1) {
        const repeater = candidates[0];
        // An existing row with the same employer/title (or school/degree) needs
        // review, not another copy, including after an extension reload.
        const identity = payload.kind === "experience" ? [payload.entry?.title, payload.entry?.company] : [payload.entry?.school, payload.entry?.degree];
        const text = normalize(repeater.group.textContent);
        if (identity.every(value => typeof value === "string" && value.trim() && text.includes(normalize(value))))
          return { filled: 0, skipped: 1, warning: "A matching history entry is already on the form. Review it before adding another." };
        const atUrl = location.href;
        const before = new Set(groups.map(item => item.group));
        pending.set(repeater.group, fingerprint);
        repeater.button.click();
        for (let attempt = 0; attempt < 80; attempt++) {
          if (location.href !== atUrl || !form.isConnected || !repeater.group.isConnected) return { filled: 0, skipped: 1 };
          const added = discover(form, labelFor, visible).groups.filter(item =>
            !before.has(item.group) && repeater.group.contains(item.group) && item.kind === payload.kind);
          if (added.length === 1 && (emptyGroup(added[0]) || compatible(added[0]))) {
            pending.delete(repeater.group);
            created.add(added[0].group);
            return inspectHistory(mode, { ...payload, addAttempted: true }, form, labelFor, visible);
          }
          if (added.length > 1) break;
          await wait();
        }
      }
    }
    if (!target)
      return {
        error:
          "Add one empty work or education row, or focus the row to fill. Existing rows are never overwritten.",
      };
    if (
      !target.required.every(
        (key) =>
          typeof payload.entry?.[key] === "string" && payload.entry[key].trim(),
      )
    )
      return {
        error:
          "Complete this entry's title and employer, or school, in your profile first.",
      };
    let filled = 0,
      skipped = 0, savedCount = 0, dateAdjusted = 0;
    const warnings = [];
    const writes = [];
    const atUrl = location.href;
    const initiallyEmpty = emptyGroup(target);
    const baseline = new Map(controlFields(target.group, visible).map(field => [field, read(field)]));
    const expected = new Map(baseline);
    let rowEdited = false, changingCurrent = false;
    const onRowEdit = event => { if (event.isTrusted && !changingCurrent) rowEdited = true; };
    for (const type of ["input", "change", "pointerdown", "keydown"]) target.group.addEventListener(type, onRowEdit);
    const unchanged = (active, activeValue) => !rowEdited && location.href === atUrl && form.isConnected &&
      target.group.isConnected && [...expected].every(([field, value]) =>
        field.isConnected && target.group.contains(field) && read(field) === (field === active ? activeValue : value));
    pending.set(target.group, fingerprint);
    // Current status may hide or disable end dates, so apply it before dates.
    const ordered = [...target.fields].sort((a, b) => Number(b.key === "current") - Number(a.key === "current"));
    for (const { field, key } of ordered) {
      if (!unchanged()) { warnings.push("The history row changed during filling. Review it before continuing."); break; }
      if (!visible(field) || field.matches(':disabled,[aria-disabled="true"],[readonly],[aria-readonly="true"]')) continue;
      let value = values[key];
      if (key === "current") {
        if (values.dates?.current === true && !field.checked && field.isConnected && visible(field) && !field.matches(':disabled,[aria-disabled="true"]')) {
          changingCurrent = true;
          field.click();
          changingCurrent = false;
          expected.set(field, read(field));
          if (field.checked) filled++; else skipped++;
        }
        continue;
      }
      if (
        typeof value !== "string" ||
        !value.trim() ||
        target.fields.filter((entry) => entry.key === key).length !== 1
      ) {
        skipped++;
        if (required(field)) warnings.push(`${labelFor(field)} is missing from this profile entry.`);
        continue;
      }
      if (key === "start" || key === "end") {
        value = dateValue(value, key, field);
        if (!value) {
          skipped++;
          if (required(field)) warnings.push(`${labelFor(field)} needs a month and year, or a supported date format.`);
          continue;
        }
      }
      if (field instanceof HTMLSelectElement) {
        let matches = [...field.options].filter(
          (option) =>
            !option.disabled && !option.closest('optgroup[disabled]') &&
            option.value &&
            (/Month$/.test(key)
              ? [
                  months[Number(value) - 1],
                  months[Number(value) - 1]?.slice(0, 3),
                  String(Number(value)),
                  value,
                ].includes(normalize(option.text))
              : normalize(option.text) === normalize(value)),
        );
        if (!matches.length && ["degree", "school"].includes(key)) {
          matches = optionMatches([...field.options].filter(option => !option.disabled && !option.closest('optgroup[disabled]') && option.value), value, key, option => option.text);
        }
        if (matches.length !== 1) {
          skipped++;
          continue;
        }
        value = matches[0].value;
      }
      if (
        location.href !== atUrl ||
        !field.isConnected ||
        !target.group.contains(field) ||
        !visible(field) ||
        read(field).trim() ||
        (field.maxLength > 0 && value.length > field.maxLength)
      ) {
        skipped++;
        continue;
      }
      const entry = {
        field,
        key,
        value,
        before: read(field),
        group: target.group,
        edited: false,
        expires: Date.now() + 10 * 60_000,
      };
      entry.onEdit = (event) => {
        if (event.isTrusted) entry.edited = true;
      };
      field.addEventListener("input", entry.onEdit);
      field.addEventListener("change", entry.onEdit);
      field.addEventListener("pointerdown", entry.onEdit);
      field.addEventListener("keydown", entry.onEdit);
      undo.push(entry);
      lastUrl = atUrl;
      if (custom(field)) {
        const safe = (currentValue = "") => unchanged(field, currentValue) && !entry.edited &&
          !field.matches(':disabled,[aria-disabled="true"],[readonly],[aria-readonly="true"]');
        const alternatives = /Month$/.test(key) ? monthAlternatives(value) : key === "degree" ? degreeAlternatives(value) : [];
        if (/Month$/.test(key)) value = months[Number(value) - 1] || value;
        const selected = await choose(field, value, safe, visible, undefined, alternatives, key);
        if (!selected) { skipped++; continue; }
        value = selected.value;
        entry.custom = true;
        entry.beforeLabel = selected.beforeLabel;
        entry.value = read(field);
        // A click is not evidence the intended value was accepted by the site.
        if (normalize(entry.value) !== normalize(value)) { skipped++; continue; }
      } else setter(field, value);
      expected.set(field, value);
      writes.push(entry);
    }
    const detach = () => {
      for (const type of ["input", "change", "pointerdown", "keydown"]) target.group.removeEventListener(type, onRowEdit);
    };
    if (undo.length) {
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(
        clear,
        Math.max(
          0,
          Math.min(...undo.map((entry) => entry.expires)) - Date.now(),
        ),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (location.href !== atUrl || !form.isConnected) {
      detach();
      return { filled: 0, skipped: writes.length, warning: "The application changed during filling. Review the current form.", historyUndoAvailable: false };
    }
    for (const entry of writes) {
      if (entry.field.isConnected && target.group.contains(entry.field) && read(entry.field) === entry.value && fieldValid(entry.field)) {
        filled++;
        if (["start", "end"].includes(entry.key) && values[entry.key]?.length === 7 && entry.value.length === 10) dateAdjusted++;
      }
      else skipped++;
    }
    const controls = controlFields(target.group, visible).filter(field => !field.matches(':disabled,[aria-disabled="true"]'));
    const missing = controls.filter(field => {
      if (field.type === "checkbox" && target.fields.some(entry => entry.field === field && entry.key === "current"))
        return field.checked !== (values.dates?.current === true);
      return (required(field) && !read(field).trim()) || !fieldValid(field) || field.getAttribute("aria-invalid") === "true";
    });
    const complete = !missing.length && target.required.every(key => read(target.fields.find(entry => entry.key === key).field).trim());
    if (!complete) {
      const labels = [...new Set(missing.map(field => labelFor(field).replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
      warnings.push(`Required history fields are incomplete or invalid${labels.length ? ` (${labels.join(", ")})` : ""}. Review this record before continuing.`);
      skipped = Math.max(skipped, missing.length, 1);
    }
    if (complete && unchanged() && !target.editor) {
      const entries = saved.get(target.group) || new Set(); entries.add(fingerprint); saved.set(target.group, entries);
      pending.delete(target.group);
    }
    // Save is a record operation only when nested beneath a history Add owner.
    // Unknown questions, consent, or navigation controls disqualify that scope.
    if (payload.automatic && target.editor && (initiallyEmpty || created.has(target.group) || resumable.includes(target))) {
      const saves = savesIn(target.group, visible);
      // HiBob exposes optional Industry alongside career facts. It is not a
      // profile inference: leave it blank, and only allow a valid optional field.
      const blankOptionalIndustry = field => target.kind === "experience" && normalize(labelFor(field)) === "industry" &&
        (custom(field) || field instanceof HTMLSelectElement || ["text", "search"].includes(field.type)) &&
        !required(field) && !read(field).trim() && fieldValid(field) && field.getAttribute("aria-invalid") !== "true";
      const bounded = controls.every(field => target.fields.some(entry => entry.field === field) || blankOptionalIndustry(field)) &&
        !target.group.querySelector('button:not([type]),button[type="submit"],input[type="submit"],a[href]') &&
        ![...target.group.querySelectorAll("button")].some(button => /\b(apply|application|submit|continue|next|consent|agree|certify)\b/i.test(button.textContent));
      if (complete && unchanged() && bounded && (filled || resumable.includes(target)) && saves.length === 1 &&
          !saves[0].matches(':disabled,[aria-disabled="true"]')) {
        const owner = target.repeater.group;
        pending.set(owner, fingerprint);
        saves[0].click();
        for (let attempt = 0; attempt < 80 && location.href === atUrl && form.isConnected && owner.isConnected; attempt++) {
          if ((!target.group.isConnected || !visible(target.group)) && summaryMatches(owner)) {
            const entries = saved.get(owner) || new Set(); entries.add(fingerprint); saved.set(owner, entries);
            pending.delete(owner); pending.delete(target.group);
            savedCount++;
            break;
          }
          await wait();
        }
        if (!savedCount) warnings.push("The history row was filled but Save needs review on the form.");
      } else warnings.push("The history row needs review before its record Save can be used.");
    }
    detach();
    return { filled, skipped, saved: savedCount, dateAdjusted, warning: warnings[0], historyUndoAvailable: undo.some(validUndo) };
  };
}
