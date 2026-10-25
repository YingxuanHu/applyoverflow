// Serialized alongside the inspector. Record identity, section scope and
// readback govern Add/Save; application submit/continue controls are excluded.
export function createHistoryInspector() {
  let undo = [],
    lastUrl = "",
    expiryTimer;
  const created = new WeakSet();
  const saved = new WeakMap();
  const ownClicks = new WeakSet();
  const clickCheck = field => { ownClicks.add(field); try { field.click(); } finally { ownClicks.delete(field); } };
  let editUrl = "", editedFields = new WeakSet(), editedIds = new Set();
  const trackEdit = event => {
    if (!event.isTrusted) return;
    if (editUrl !== location.href) { editUrl = location.href; editedFields = new WeakSet(); editedIds.clear(); }
    const field = event.target.closest?.('input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"]');
    if (!field || ownClicks.has(field)) return;
    editedFields.add(field);
    if (field.id) editedIds.add(field.id);
  };
  for (const event of ["input", "change", "pointerdown", "keydown"]) globalThis.document?.addEventListener(event, trackEdit, true);
  const userEdited = field => editUrl === location.href && (editedFields.has(field) || (field.id && editedIds.has(field.id)));
  const normalize = (value) =>
    value
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
    "employer name": "company",
    "organization": "company",
    "organisation": "company",
    school: "school",
    "school name": "school",
    university: "school",
    institution: "school",
    "institution name": "school",
    "school / university": "school",
    "school or university": "school",
    "college or university": "school",
    "college/university": "school",
    degree: "degree",
    "education level": "degree",
    qualification: "degree",
    "qualification name": "degree",
    "field of study": "fieldOfStudy",
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
    "i currently work here.": "current",
    "i currently work here": "current",
    "currently employed here": "current",
    "currently studying here": "current",
    "current position": "current",
    "current role": "current",
    "currently work here": "current",
    "i am currently working in this role": "current",
  };
  const keyFor = label => {
    const text = normalize(label);
    if (keys[text]) return keys[text];
    const segment = /^(start|end|from|to)(?: date)?\s*[(/-]?\s*(month|year|day)\)?$/.exec(text);
    if (segment) return (/^(start|from)$/.test(segment[1]) ? "start" : "end") + segment[2][0].toUpperCase() + segment[2].slice(1);
    return undefined;
  };
  const valid = field => {
    const pattern = field.getAttribute("pattern");
    if (pattern) try { new RegExp(pattern, "v"); } catch {
      const copy = field.cloneNode(false); copy.removeAttribute("pattern"); copy.value = field.value;
      return copy.validity?.valid !== false;
    }
    return field.validity?.valid !== false;
  };
  const degreeAlternatives = (value) => {
    const text = normalize(value).replace(/[\u2018\u2019]/g, "'");
    const short = text.replace(/[.\s]/g, "");
    const bachelor = /^(?:bachelor(?:'s)?(?: of| degree|$))/.test(text) || /^(bsc|bs|ba|beng|bba|bcom|bcs)$/.test(short);
    const master = /^master(?:'s)?(?: of| degree|$)/.test(text) || /^(msc|ms|ma|meng|mba)$/.test(short);
    const doctorate = /^doctor(?:ate| of philosophy)(?:\b|$)/.test(text) || short === "phd";
    // Full program names can map down to their explicit qualification level,
    // never across subjects or from mixed-level credentials to a higher degree.
    if (bachelor && !/\bmaster|\bdoctor|\bphd/.test(text)) return ["Bachelor's Degree", "Bachelor's degree", "Bachelors", "Bachelor", "Bachelor Degree"];
    if (master && !/\bbachelor|\bdoctor|\bphd/.test(text)) return ["Master's Degree", "Masters", "Master", ...(short === "mba" ? ["Master of Business Administration (M.B.A.)"] : [])];
    if (doctorate && !/\bbachelor|\bmaster/.test(text)) return ["Doctor of Philosophy (Ph.D.)", "Doctorate", "Doctoral Degree", "PhD"];
    return [];
  };
  const schoolAlternatives = value => {
    // A named faculty is not part of the institution's catalog name. Preserve
    // campuses, locations and other qualifiers; never guess a similar school.
    const match = /^(.+?(?:university|college|institute)(?: of [^,]+)?|(?:university|college|institute) of .+?)\s*(?:,| -| \u2013| \u2014)\s*(?:school|faculty|department) of\s+.+$/i.exec(value.trim());
    return match ? [match[1].trim()] : [];
  };
  const alternativesFor = (key, value) => key === "degree" ? degreeAlternatives(value) : key === "school" ? schoolAlternatives(value) : [];
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
  const custom = (field) => field.matches('[role="combobox"], button[aria-haspopup="listbox"],input[data-uxi-widget-type="selectinput"],input[data-automation-id="searchBox"]');
  const read = (field) => {
    if (field.type === "checkbox") return field.checked ? "true" : "";
    const promptId = field.getAttribute("data-uxi-multiselect-id");
    if (promptId) {
      const labels = [...document.querySelectorAll(`[data-automation-id="selectedItemList"][data-uxi-multiselect-id="${CSS.escape(promptId)}"] [data-automation-id="promptOption"]`)];
      return labels.map(node => node.textContent.trim()).join(", ");
    }
    const selected = custom(field) && field.closest('.select__value-container')?.querySelector('.select__single-value');
    if (selected) return selected.textContent.trim();
    if (!custom(field) || field instanceof HTMLInputElement) {
      const value = field.value || "";
      return field.getAttribute("role") === "spinbutton" && /^(month|year|day)$/i.test(field.getAttribute("aria-label") || "") && /^\d+$/.test(value)
        ? String(Number(value)) : value;
    }
    const text = field.textContent.trim();
    return field.value === "" && /^(select(?: one)?|choose(?: one)?|none|--?)$/i.test(text) ? "" : text;
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
  const write = async (field, value, canWrite) => {
    if (field.type === "checkbox") {
      if (canWrite() && field.checked !== (value === "true")) clickCheck(field);
      return;
    }
    const segmentedDate = field.getAttribute("role") === "spinbutton" &&
      /^(month|year|day)$/i.test(field.getAttribute("aria-label") || "");
    // Selecting the segment and allowing controlled state to render matters:
    // text can display correctly while the owning date still has no value.
    const before = read(field);
    if (!canWrite()) return;
    if (segmentedDate) {
      if (value && /^(month|day)$/i.test(field.getAttribute("aria-label"))) value = value.padStart(2, "0");
      field.click(); await wait();
      if (!canWrite() || !field.isConnected || read(field) !== before) return;
      field.focus(); await wait();
    }
    if (!canWrite() || !field.isConnected || read(field) !== before) return;
    setter(field, value);
    if (segmentedDate) { await wait(); if (canWrite() && field.isConnected) field.blur(); await wait(); }
  };
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
  // Month-only React Datepicker inputs may expose no format at all. Select the
  // month through the local component and verify its selected option, rather
  // than guessing a locale-dependent string that only looks filled.
  async function chooseMonth(field, value, safe, visible) {
    const wrapper = field.closest('.react-datepicker-wrapper')?.parentElement;
    if (!wrapper || wrapper.querySelectorAll('input').length !== 1 || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value) || !safe()) return null;
    field.focus(); field.click();
    const calendar = () => {
      const nodes = [...wrapper.querySelectorAll('.react-datepicker')].filter(visible);
      return nodes.length === 1 && nodes[0].querySelector('.react-datepicker__monthPicker[role="listbox"]') ? nodes[0] : null;
    };
    for (let i = 0; i < 20 && safe() && !calendar(); i++) await wait();
    const close = () => { if (safe()) { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); field.blur(); } };
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7));
    const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const options = () => [...calendar()?.querySelectorAll('[role="option"]') || []].filter(node =>
      visible(node) && node.getAttribute('aria-label') === `Choose ${names[month - 1]} ${year}` &&
      !node.matches('[aria-disabled="true"],.react-datepicker__month-text--disabled'));
    for (let i = 0; i < 100 && safe(); i++) {
      const root = calendar();
      const current = Number(root?.querySelector('.react-datepicker-year-header')?.textContent.trim());
      if (!Number.isInteger(current) || current < 1900 || current > 2200) break;
      if (current === year) {
        const matches = options();
        if (matches.length !== 1) break;
        matches[0].click(); await wait();
        if (!safe() || !field.value.trim()) break;
        // Read the component's retained selection after reopening it.
        const retained = field.value;
        field.focus(); field.click(); await wait();
        const selected = options();
        const accepted = safe() && selected.length === 1 && selected[0].getAttribute('aria-selected') === 'true' && field.value === retained;
        close();
        return accepted ? retained : null;
      }
      const direction = current > year ? 'Previous Year' : 'Next Year';
      const buttons = [...root.querySelectorAll('button[type="button"]')].filter(button => visible(button) && !button.disabled && button.getAttribute('aria-label') === direction);
      if (buttons.length !== 1) break;
      buttons[0].click(); await wait();
      const next = Number(calendar()?.querySelector('.react-datepicker-year-header')?.textContent.trim());
      if (next !== current + (current > year ? -1 : 1)) break;
    }
    close(); return null;
  }
  // Never infer a popup from its position or choose another question's options.
  async function choose(field, label, safe, visible, restoreLabel, alternatives = [], retried = false) {
    const allowed = safe;
    safe = () => allowed(label);
    if (!safe() || !visible(field) ||
        (field instanceof HTMLButtonElement && field.type !== "button") ||
        field.matches(':disabled, [aria-disabled="true"], [aria-readonly="true"]')) return null;
    const expandedBefore = field.getAttribute("aria-expanded") === "true";
    if (!expandedBefore) { field.focus(); field.click(); }
    await wait();
    if (field.getAttribute("aria-expanded") !== "true" && !field.hasAttribute("data-uxi-multiselect-id")) {
      field.focus();
      field.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      field.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
    }
    const search = field instanceof HTMLInputElement && custom(field);
    const promptId = field.getAttribute("data-uxi-multiselect-id");
    const committed = () => promptId && [label, ...alternatives].some(value => normalize(read(field)) === normalize(value));
    const dismiss = () => {
      if (!field.isConnected || userEdited(field)) return;
      for (const type of ["keydown", "keyup"]) field.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      field.blur();
    };
    if (search) { field.focus(); setter(field, label); }
    // Some prompt catalogs only search on Enter, not on input/change.
    if (search && field.getAttribute("enterkeyhint") === "search" && field.hasAttribute("data-uxi-multiselect-id") && safe()) {
      await wait();
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      field.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    let list;
    for (let attempt = 0; attempt < 64 && safe(); attempt++) {
      if (committed()) { dismiss(); return { beforeLabel: restoreLabel, value: read(field) }; }
      const ids = (field.getAttribute("aria-controls") || field.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
      const lists = ids.flatMap((id) => {
        const nodes = document.querySelectorAll(`#${CSS.escape(id)}`);
        return nodes.length === 1 ? [nodes[0]] : [];
      }).filter((node) => node?.matches('[role="listbox"],[role="tree"]') && visible(node));
      const promptId = field.getAttribute("data-uxi-multiselect-id");
      const promptLists = promptId ? [...document.querySelectorAll('[role="listbox"],[role="tree"]')].filter(node => visible(node) &&
        !node.matches('[data-automation-id="selectedItemList"]') && node.querySelector(`[data-uxi-multiselect-id="${CSS.escape(promptId)}"]`)) : [];
      if (lists.length === 1) { list = lists[0]; break; }
      if (promptLists.length === 1) { list = promptLists[0]; break; }
      await wait();
    }
    // Search confirmation can itself commit a unique catalog result. Read the
    // selected chip, never the query string, before reporting a missing menu.
    if (committed()) { dismiss(); return { beforeLabel: restoreLabel, value: read(field) }; }
    const close = () => {
      if (safe()) {
        if (search && field.value === label) setter(field, "");
        if (!expandedBefore) dismiss();
      }
    };
    if (!safe() || !list || list.getAttribute("aria-multiselectable") === "true") { close(); return null; }
    let options = [];
    for (let attempt = 0; attempt < 60 && safe() && list.isConnected; attempt++) {
      options = [...list.querySelectorAll('[role="option"],[role="treeitem"]')].filter((option) =>
        option.closest('[role="listbox"],[role="tree"]') === list && visible(option) &&
        !option.matches(':disabled, [aria-disabled="true"]'));
      if (options.some(option => [label, ...alternatives].some(value => normalize(option.textContent) === normalize(value)))) break;
      if (list.scrollHeight > list.clientHeight && attempt % 3 === 2 && list.scrollTop + list.clientHeight < list.scrollHeight) {
        list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(32, list.clientHeight - 32));
        list.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      await wait();
    }
    const empty = options.filter((option) => option.getAttribute("data-value") === "" || option.getAttribute("value") === "");
    let matches = options.filter((option) => normalize(option.textContent) === normalize(label));
    if (!matches.length) matches = options.filter(option => alternatives.some(value => normalize(option.textContent) === normalize(value)));
    if (matches.length !== 1) {
      close();
      await wait();
      // Searchable catalogs filter before matching. A full program/faculty
      // name can hide the correct qualification/institution option entirely.
      if (!matches.length && search && alternatives.length && !retried && allowed(""))
        return choose(field, alternatives[0], allowed, visible, restoreLabel, [label, ...alternatives.slice(1)], true);
      return null;
    }
    const beforeLabel = restoreLabel || (empty.length === 1 ? empty[0].textContent.trim() : undefined);
    if (!safe() || !list.isConnected || !matches[0].isConnected) { close(); return null; }
    (matches[0].querySelector('[data-uxi-widget-type="multiselectlistitem"]') || matches[0]).click();
    await wait();
    dismiss();
    return { beforeLabel, value: matches[0].textContent.trim() };
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
  const headingSelector = 'legend,h2,h3,h4,[role="heading"],p';
  const kindFromLabel = label => {
    label = label.replace(/\s*\(complete or remove this section\)$/, "");
    if (/^(?:(?:your|previous|professional) )?(?:experience|work experience|work history|career history|employment(?: history| experience)?|professional experience)(?: \d+)?$/.test(label)) return "experience";
    if (/^(?:your )?(?:education|education history|education background|educational background|highest education qualification)(?: \d+)?$/.test(label)) return "education";
    return null;
  };
  const addLabel = button => normalize(button.getAttribute("aria-label") || button.textContent)
    .replace(/[\uE000-\uF8FF]/g, "").replace(/\s*\(complete or remove this section\)$/, "").trim();
  const isAdd = button => /^(?:\+\s*)?add(?: (?:another|more))?(?: (?:work |employment |education )?(?:experience|entry|education|job|position))?$/.test(addLabel(button));
  const kindOf = (group) => {
    if (/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/.test(location.hostname) && group.matches('.education--form,.education--container')) return "education";
    const named = (group.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || "").join(" ");
    const label = normalize(group.querySelector(":scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > [role=heading],:scope > header h2,:scope > header h3,:scope > p")?.textContent || group.getAttribute("aria-label") || named);
    const auto = group.getAttribute("data-automation-id") || "";
    const bob = group.matches('careers-ui-experience-edit-item') ? group.parentElement : group;
    const bobType = bob.matches('careers-ui-experience-form-control') && bob.getAttribute("data-testid");
    if (/^workExperience-\d+$/.test(auto) || bobType === "efc-experiences") return "experience";
    if (/^education-\d+$/.test(auto) || bobType === "efc-education") return "education";
    if (kindFromLabel(label)) return kindFromLabel(label);
    // Presentation wrappers around a section heading do not change ownership.
    // Only look through short, control-free wrappers, not into another row.
    const kinds = new Set();
    for (const child of group.children) {
      if (child.querySelector('input,textarea,select,a,[role="combobox"]')) continue;
      for (const heading of child.matches(headingSelector) ? [child] : child.querySelectorAll(headingSelector)) {
        let node = heading, depth = 0;
        while (node && node !== child && depth < 3) { node = node.parentElement; depth++; }
        const kind = node === child && kindFromLabel(normalize(heading.textContent));
        if (kind) kinds.add(kind);
      }
    }
    if (kinds.size === 1) return [...kinds][0];
    return null;
  };
  return async function inspectHistory(mode, payload, form, labelFor, visible) {
    if (
      lastUrl !== location.href ||
      undo.some((entry) => entry.expires <= Date.now())
    )
      clear();
    const controls = 'input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"]';
    const containers = new Map();
    for (const group of form.querySelectorAll('fieldset,section,[role="group"],[role="region"],[data-automation-id],careers-ui-experience-edit-item,careers-ui-experience-form-control,.education--form,.education--container')) {
      const kind = kindOf(group);
      if (kind && visible(group)) containers.set(group, kind);
    }
    // Custom ATSs often use divs rather than fieldsets. Locate the section by
    // its heading, then identify individual rows by unique identity fields.
    for (const heading of form.querySelectorAll('h2,h3,h4,legend,[role="heading"],p')) {
      for (let node = heading.parentElement, depth = 0; node && node !== form && depth < 4; node = node.parentElement, depth++) {
        const kind = kindOf(node);
        if (kind && visible(node) && (node.querySelector(controls) || [...node.querySelectorAll('button')].some(isAdd))) {
          containers.set(node, kind); break;
        }
      }
    }
    // A repeater's Add control can be a sibling of its labelled rows. Locate
    // their nearest shared owner, without absorbing other sections or Submit.
    for (const button of form.querySelectorAll('button[type="button"]')) {
      const match = /^(?:\+\s*)?add(?: (?:another|more))?(?: (?:work )?(experience|education))?$/.exec(addLabel(button));
      if (!match || !visible(button)) continue;
      for (let node = button.parentElement, depth = 0; node && node !== form && depth < 4; node = node.parentElement, depth++) {
        const kinds = new Set([...containers].filter(([group]) => node.contains(group)).map(([, kind]) => kind));
        const kind = match[1]?.toLowerCase() || (kinds.size === 1 && [...kinds][0]);
        if (!kind) continue;
        const rows = [...containers].filter(([group, type]) => node.contains(group) && type === kind).map(([group]) => group);
        if (rows.length && ![...containers].some(([group, type]) => node.contains(group) && type !== kind) &&
            [...node.querySelectorAll(controls)].filter(visible).every(field => rows.some(row => row.contains(field)) || keyFor(labelFor(field)))) {
          containers.set(node, kind); break;
        }
      }
    }
    const rowContainers = new Map(containers);
    for (const [section, kind] of containers) {
      const identityKeys = kind === "experience" ? ["title", "company"] : ["school"];
      const anchors = [...section.querySelectorAll(controls)].filter(field => visible(field) && keyFor(labelFor(field)) === identityKeys[0]);
      for (const anchor of anchors) {
        let candidate;
        for (let node = anchor.parentElement; node && section.contains(node); node = node.parentElement) {
          const fields = [...node.querySelectorAll(controls)].filter(visible);
          const identified = fields.map(field => keyFor(labelFor(field)));
          if (identityKeys.every(key => identified.filter(value => value === key).length === 1)) {
            candidate = node;
            const buttons = [...node.querySelectorAll('button')].filter(visible);
            if (node.matches('careers-ui-experience-edit-item') ||
              (buttons.some(button => /^cancel$/i.test(button.textContent.trim())) &&
               buttons.some(button => /^(save|update)$/i.test(button.textContent.trim())))) break;
          }
          else if (candidate) break;
          if (node === section) break;
        }
        if (candidate) rowContainers.set(candidate, kind);
      }
    }
    const groups = [
      ...rowContainers.keys(),
    ]
      .flatMap((group) => {
        const kind = rowContainers.get(group);
        if (!kind || !visible(group)) return [];
        const fields = [...group.querySelectorAll('input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"]')]
          .filter(
            (field) =>
              visible(field) &&
              !field.matches(
                ':disabled, [aria-disabled="true"], [readonly]:not([type="checkbox"]), [list], select[multiple]',
              ) &&
              (!field.hasAttribute("aria-autocomplete") || custom(field)) &&
              (custom(field) || field instanceof HTMLTextAreaElement ||
                field instanceof HTMLSelectElement ||
                ["text", "month", "date", "number", "checkbox"].includes(field.type)),
          )
          .map((field) => {
            let key = keyFor(labelFor(field));
            const part = normalize(labelFor(field));
            if (["month", "year", "day"].includes(part)) {
              // Date widgets nest unnamed/value-labelled groups inside the
              // actual From/To group. Stop at this record, not the first group.
              for (let parent = field.parentElement; parent && group.contains(parent); parent = parent.parentElement) {
                const named = (parent.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
                  .map(id => document.getElementById(id)?.textContent || "").join(" ");
                const parentLabel = normalize(parent.getAttribute("aria-label") || named || parent.querySelector(':scope > legend')?.textContent || "");
                const direction = /^(?:from|start date)$/.test(parentLabel) ? "start" : /^(?:to|end date)(?: \(actual or expected\))?$/.test(parentLabel) ? "end" : "";
                if (direction) { key = direction + part[0].toUpperCase() + part.slice(1); break; }
                if (parent === group) break;
              }
            }
            return { field, key };
          })
          .filter((entry) => entry.key && (entry.field.type !== "checkbox" || entry.key === "current") && (!custom(entry.field) ||
            /^(school|degree|fieldOfStudy|startMonth|endMonth|startYear|endYear)$/.test(entry.key)));
        const required =
          kind === "experience" ? ["title", "company"] : group.matches('.education--form') && !fields.some(f => f.key === "school") ? ["degree"] : ["school"];
        if (
          !required.every(
            (key) => fields.filter((entry) => entry.key === key).length === 1,
          )
        )
          return [];
        return [{ group, kind, fields, required }];
      })
      .filter(
        (item, _, all) =>
          !all.some(
            (other) => other !== item && item.group.contains(other.group),
          ),
      );
    const emptyGroup = ({ group, fields }) =>
      fields.every(({ field }) => !read(field).trim()) &&
      ![...group.querySelectorAll('input,textarea,select,button[aria-haspopup="listbox"]')].some(
        (field) =>
          visible(field) &&
          (custom(field) ? read(field).trim() :
          !["hidden", "button", "submit", "reset"].includes(field.type) &&
          (["checkbox", "radio"].includes(field.type)
            ? field.checked
            : field.value.trim())),
      );
    const repeaters = [...containers.keys()]
      .flatMap(group => {
        const kind = containers.get(group);
        if (!kind || !visible(group)) return [];
        const buttons = [...group.querySelectorAll('button')].filter(button =>
          (button.type === "button" || !button.form) && visible(button) && !button.disabled && isAdd(button));
        return buttons.length === 1 ? [{ group, kind, button: buttons[0] }] : [];
      }).filter((item, _, all) => !all.some(other => other !== item && item.group.contains(other.group) && item.button === other.button));
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
      for (const entry of [...undo].reverse()) {
        if (!validUndo(entry)) {
          kept++;
          continue;
        }
        if (entry.custom) {
          await choose(entry.field, entry.beforeLabel, () => validUndo(entry), visible, entry.beforeLabel);
        } else await write(entry.field, entry.before, () => !entry.edited && lastUrl === location.href &&
          entry.group.contains(entry.field) && visible(entry.field) && !entry.field.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]'));
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
        values[part] = value;
        values[`${part}Year`] = value.slice(0, 4);
        if (value.length >= 7) {
          values[`${part}Month`] = value.slice(5, 7);
          values[`${part}Day`] = value.length === 10 ? value.slice(8) : part === "start" ? "01" : String(new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).getUTCDate());
        }
      }
    }
    const identityMatches = item => item.required.every(key => values[key] &&
      [values[key], ...alternativesFor(key, values[key])].some(value => normalize(read(item.fields.find(f => f.key === key).field)) === normalize(value)));
    const identified = matching.filter(identityMatches);
    const peers = (payload.peers || [payload]).filter(peer => peer.kind === payload.kind && requiredIdentity.every(key =>
      typeof peer.entry?.[key] === "string" && [peer.entry[key], ...alternativesFor(key, peer.entry[key])].some(value =>
        [values[key], ...alternativesFor(key, values[key])].some(other => normalize(value) === normalize(other)))));
    const reconcile = payload.reconcilePrefilled === true && identified.length === 1 && peers.length === 1;
    if (payload.reconcilePrefilled && identified.length && (!reconcile || identified[0].fields.some(({ field }) => userEdited(field))))
      return { filled: 0, skipped: 1, warning: reconcile ? "You edited this history record. Left unchanged." : "Multiple history records share this identity. Review them on the form." };
    // Resume an identifiable unfinished record, even after reload, but
    // never mix profile values with a conflicting or independently edited row.
    const compatible = item => (identityMatches(item) || saved.get(item.group)?.has(fingerprint)) &&
      !undo.some(entry => entry.group === item.group && entry.edited) &&
      [...item.group.querySelectorAll('input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"]')].filter(visible).every(field => {
        if (!read(field).trim()) return true;
        const key = item.fields.find(f => f.field === field)?.key;
        if (!key) return false;
        if (key === "current") return values.dates?.current === true;
        let expected = ["start", "end"].includes(key) && values[key] ? dateValue(values[key], key, field) : values[key];
        if (/^(?:start|end)(?:Month|Year|Day)$/.test(key) && typeof expected === "string") expected = String(Number(expected));
        if (typeof expected === "string" && alternativesFor(key, expected).map(normalize).includes(normalize(read(field)))) return true;
        if (/Month$/.test(key) && values[key]) {
          const month = new Date(Date.UTC(2000, Number(values[key]) - 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
          if ([month, month.slice(0, 3), values[key], String(Number(values[key]))].map(normalize).includes(normalize(read(field)))) return true;
        }
        return typeof expected === "string" && normalize(read(field)) === normalize(expected);
      });
    const resumable = matching.filter(item => compatible(item) &&
      (!saved.get(item.group)?.size || saved.get(item.group).has(fingerprint)) &&
      item.fields.some(({ field, key }) => !read(field).trim() && typeof values[key] === "string" && values[key].trim()));
    const knownSaved = repeaters.some(item => item.kind === payload.kind && saved.get(item.group)?.has(fingerprint));
    if (
      !reconcile && ((knownSaved && !resumable.length) || matching.some(item => (identityMatches(item) || saved.get(item.group)?.has(fingerprint)) && !resumable.includes(item)))
    )
      return {
        error:
          "This entry may already be present. Review the existing rows before adding it again.",
      };
    const empty = matching.filter(emptyGroup);
    const focused = empty.filter(({ group }) =>
      group.contains(document.activeElement),
    );
    const target = reconcile ? identified[0] : resumable.length === 1 ? resumable[0] :
      payload.automatic ? empty[0] : empty.length === 1 ? empty[0] : focused.length === 1 ? focused[0] : null;
    if (!target && payload.automatic && !payload.addAttempted) {
      if (matching.some(item => !emptyGroup(item) && item.required.some(key => !read(item.fields.find(f => f.key === key).field).trim())))
        return { filled: 0, skipped: 1, warning: "Complete the partially filled history row before adding another." };
      const candidates = repeaters.filter(item => item.kind === payload.kind &&
        !item.group.querySelector('careers-ui-experience-edit-item'));
      if (candidates.length === 1) {
        const repeater = candidates[0];
        // An existing row with the same employer/title (or school/degree) needs
        // review, not another copy, including after an extension reload.
        const identity = payload.kind === "experience" ? [payload.entry?.title, payload.entry?.company] : [payload.entry?.school, payload.entry?.degree];
        const text = normalize(repeater.group.textContent);
        if (identity.every(value => typeof value === "string" && value.trim() && text.includes(normalize(value))))
          return { filled: 0, skipped: 1, warning: "A matching history entry is already on the form. Review it before adding another." };
        const atUrl = location.href;
        const beforeFields = new Set(repeater.group.querySelectorAll(controls));
        repeater.button.click();
        for (let attempt = 0; attempt < 40; attempt++) {
          if (location.href !== atUrl || !form.isConnected || !repeater.group.isConnected) return { filled: 0, skipped: 1 };
          const added = [...repeater.group.querySelectorAll(controls)].filter(node => !beforeFields.has(node) && visible(node));
          const addedKeys = added.map(field => keyFor(labelFor(field)));
          if ((payload.kind === "experience" ? ["title", "company"] : ["school"]).every(key => addedKeys.includes(key))) {
            for (const field of added) for (let node = field.parentElement; node && node !== repeater.group; node = node.parentElement) created.add(node);
            return inspectHistory(mode, { ...payload, addAttempted: true }, form, labelFor, visible);
          }
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
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    // Turning off "current" can mount previously absent end-date controls.
    // Reinspect that row before filling, rather than silently skipping its end.
    const currentField = target.fields.find(item => item.key === "current")?.field;
    if (reconcile && values.dates?.current === false && currentField?.checked && !payload.currentAdjusted && !userEdited(currentField)) {
      const change = { field: currentField, key: "current", before: "true", value: "", group: target.group, edited: false, expires: Date.now() + 10 * 60_000 };
      change.onEdit = event => { if (event.isTrusted && !ownClicks.has(currentField)) change.edited = true; };
      currentField.addEventListener("change", change.onEdit);
      undo.push(change); lastUrl = location.href;
      clickCheck(currentField);
      await wait();
      if (!currentField.checked && currentField.isConnected && !userEdited(currentField)) {
        const result = await inspectHistory(mode, { ...payload, currentAdjusted: true }, form, labelFor, visible);
        return { ...result, filled: (result.filled || 0) + 1, updated: (result.updated || 0) + 1 };
      }
      return { filled: 0, skipped: 1, warning: "Current role could not be changed safely. Review this record." };
    }
    let filled = 0,
      skipped = 0, savedCount = 0, dateAdjusted = 0, updated = 0;
    const warnings = [];
    const writes = [];
    const atUrl = location.href;
    const baseline = new Map([...target.group.querySelectorAll('input,textarea,select')].map(field => [field, read(field)]));
    for (const { field, key } of target.fields) {
      if (location.href !== atUrl || !form.isConnected || !target.group.contains(field)) break;
      if (userEdited(field)) { skipped++; warnings.push("You edited this history record. Left unchanged."); continue; }
      if (/^end(?:Month|Year|Day)?$/.test(key) && values.dates?.current === true) continue;
      let value = values[key];
      if (key === "current") {
        if (typeof values.dates?.current === "boolean" && field.checked !== values.dates.current && (!field.checked || reconcile) && field.isConnected && visible(field) && !field.matches(':disabled,[aria-disabled="true"]')) {
          const wasChecked = field.checked;
          const change = { field, key, before: wasChecked ? "true" : "", value: values.dates.current ? "true" : "", group: target.group, edited: false, expires: Date.now() + 10 * 60_000 };
          change.onEdit = event => { if (event.isTrusted && !ownClicks.has(field)) change.edited = true; };
          field.addEventListener("change", change.onEdit);
          undo.push(change); lastUrl = atUrl;
          clickCheck(field);
          if (field.checked === values.dates.current) { filled++; if (wasChecked) updated++; } else skipped++;
        }
        continue;
      }
      if (
        typeof value !== "string" ||
        !value.trim() ||
        target.fields.filter((entry) => entry.key === key).length !== 1
      ) {
        skipped++;
        if (field.required && key !== "end") warnings.push(`${labelFor(field)} is missing from this profile entry.`);
        continue;
      }
      const pickerDate = (key === "start" || key === "end") && !dateValue(value, key, field) && field.closest('.react-datepicker-wrapper');
      if ((key === "start" || key === "end") && !pickerDate) {
        value = dateValue(value, key, field);
        if (!value) {
          skipped++;
          if (field.required) warnings.push(`${labelFor(field)} needs a month and year, or a supported date format.`);
          continue;
        }
      }
      if (/^(?:start|end)(?:Month|Year|Day)$/.test(key) && !custom(field)) value = String(Number(value));
      if (field instanceof HTMLSelectElement) {
        let matches = [...field.options].filter(
          (option) =>
            !option.disabled &&
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
          const alternatives = alternativesFor(key, value).map(normalize);
          matches = [...field.options].filter(option => !option.disabled && option.value && alternatives.includes(normalize(option.text)));
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
        (read(field).trim() && !reconcile) ||
        (field.maxLength > 0 && value.length > field.maxLength)
      ) {
        skipped++;
        continue;
      }
      if (normalize(read(field)) === normalize(value) || alternativesFor(key, value).some(option => normalize(option) === normalize(read(field)))) continue;
      // Selected multi-value chips need an explicit remove/replace transaction.
      // Do not append another selection or erase an unrelated saved credential.
      if (read(field).trim() && custom(field) && field.hasAttribute('data-uxi-multiselect-id')) {
        skipped++; warnings.push(`${labelFor(field)} differs from your profile. Review the selected value on the form.`); continue;
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
      if (pickerDate) {
        const selected = await chooseMonth(field, value, () => !entry.edited && location.href === atUrl && form.isConnected &&
          field.isConnected && target.group.contains(field) && visible(field) && !field.matches(':disabled,[readonly],[aria-disabled="true"]'), visible);
        if (!selected) { skipped++; warnings.push(`${labelFor(field)} needs review; the date selection could not be verified.`); continue; }
        entry.value = selected;
        entry.custom = true;
      } else if (custom(field)) {
        const safe = (query = value) => location.href === atUrl && field.isConnected &&
          target.group.contains(field) && (!read(field).trim() || (reconcile && read(field) === entry.before) || field instanceof HTMLInputElement && field.value === query && !field.hasAttribute('data-uxi-multiselect-id')) && !entry.edited && !userEdited(field);
        const alternatives = /Month$/.test(key) && months[Number(value) - 1]
          ? [months[Number(value) - 1].slice(0, 3), String(Number(value)), value] : alternativesFor(key, value);
        if (/Month$/.test(key)) value = months[Number(value) - 1] || value;
        const selected = await choose(field, value, safe, visible, reconcile && entry.before || undefined, alternatives);
        if (!selected) { skipped++; warnings.push(`${labelFor(field)}: no unique matching option was available. Retry or review this field.`); continue; }
        value = selected.value;
        entry.custom = true;
        entry.beforeLabel = selected.beforeLabel;
        entry.value = read(field);
        // A click is not evidence the intended value was accepted by the site.
        if (normalize(entry.value) !== normalize(value)) { skipped++; continue; }
      } else await write(field, value, () => !entry.edited && !userEdited(field) && location.href === atUrl && form.isConnected &&
        target.group.contains(field) && visible(field) && !field.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]'));
      writes.push(entry);
    }
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
    if (location.href !== atUrl || !form.isConnected)
      return { filled: 0, skipped: writes.length, warning: "The application changed during filling. Review the current form.", historyUndoAvailable: false };
    for (const entry of writes) {
      if (entry.field.isConnected && target.group.contains(entry.field) && read(entry.field) === entry.value && valid(entry.field)) {
        filled++;
        if (entry.before.trim()) updated++;
        if (["start", "end"].includes(entry.key) && values[entry.key]?.length === 7 && entry.value.length === 10) dateAdjusted++;
      }
      else skipped++;
    }
    const allRowButtons = [...target.group.querySelectorAll('button,input[type="submit"]')].filter(visible);
    const rowButtons = allRowButtons.filter(button => button.type === "button" && !button.disabled);
    const saveButtons = rowButtons.filter(button => /^(?:save|save (?:entry|experience|education)|add (?:entry|experience|education)|update)$/i.test(button.textContent.trim()));
    const verifiedEditor = target.group.matches('careers-ui-experience-edit-item') &&
      target.group.closest('careers-ui-experience-form-control') && saveButtons[0]?.matches('[data-testid="save-btn"]');
    const rowEditor = saveButtons.length === 1 && (verifiedEditor || rowButtons.some(button => /^cancel$/i.test(button.textContent.trim()))) &&
      !target.group.querySelector('input[type="email"],input[type="password"]') &&
      !allRowButtons.some(button => button.type === "submit" || /submit|continue|next|apply/i.test(button.textContent || button.value));
    if (filled && !rowEditor) {
      const entries = saved.get(target.group) || new Set(); entries.add(fingerprint); saved.set(target.group, entries);
    }
    // A local row editor needs Save + Cancel (or a verified editor contract), a unique record identity and
    // valid unchanged controls. Never click an application's Next or Submit.
    if (payload.automatic && rowEditor && (reconcile || created.has(target.group) || resumable.includes(target) || empty.includes(target))) {
      const controls = [...target.group.querySelectorAll('input,textarea,select,[role="combobox"],button[aria-haspopup="listbox"],[role="checkbox"],[role="radio"]')].filter(visible);
      const complete = controls.every(field => field.matches('[role="checkbox"],[role="radio"]') ?
        field.getAttribute('aria-required') !== 'true' || field.getAttribute('aria-checked') === 'true' : field.type === "checkbox" ?
        target.fields.some(entry => entry.field === field && entry.key === "current") || !field.required || field.checked :
        (!(field.required || field.getAttribute("aria-required") === "true") || read(field).trim()) && valid(field) && field.getAttribute("aria-invalid") !== "true");
      const unchanged = controls.every(field => {
        const write = writes.find(entry => entry.field === field);
        if (write) return !write.edited && read(field) === write.value;
        if (field.type === "checkbox" && target.fields.some(entry => entry.field === field && entry.key === "current") && values.dates?.current === true) return field.checked;
        return baseline.has(field) && baseline.get(field) === read(field);
      });
      const saves = saveButtons;
      if (complete && unchanged && (filled || resumable.includes(target)) && saves.length === 1 && !saves[0].disabled && location.href === atUrl) {
        const owner = repeaters.find(item => item.kind === payload.kind && item.group.contains(target.group))?.group || target.group.parentElement;
        saves[0].click();
        for (let attempt = 0; attempt < 40 && target.group.isConnected && location.href === atUrl; attempt++) await wait();
        if (!target.group.isConnected && owner.isConnected && location.href === atUrl) {
          const entries = saved.get(owner) || new Set(); entries.add(fingerprint); saved.set(owner, entries);
          savedCount++;
        } else warnings.push("The history row was filled but Save needs review on the form.");
      }
    }
    return { filled, updated, skipped, saved: savedCount, dateAdjusted, warning: warnings[0], historyUndoAvailable: undo.some(validUndo) };
  };
}
