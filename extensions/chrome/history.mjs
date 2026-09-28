// Serialized alongside the inspector. Add is restricted to a single identified
// history section. Save is allowed only in a verified HiBob row editor, never
// the application's submit/continue control.
export function createHistoryInspector() {
  let undo = [],
    lastUrl = "",
    expiryTimer;
  const created = new WeakSet();
  const saved = new WeakMap();
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
    school: "school",
    "school name": "school",
    university: "school",
    institution: "school",
    "institution name": "school",
    "school / university": "school",
    "college/university": "school",
    degree: "degree",
    qualification: "degree",
    "qualification name": "degree",
    "field of study": "fieldOfStudy",
    major: "fieldOfStudy",
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
    "is current": "current",
    "i currently work here": "current",
    "currently employed here": "current",
    "currently studying here": "current",
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
    if (!custom(field) || field instanceof HTMLInputElement) return field.value || "";
    const text = field.textContent.trim();
    return field.value === "" && /^(select(?: one)?|choose(?: one)?|none|--?)$/i.test(text) ? "" : text;
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
  // Never infer a popup from its position or choose from another question's
  // options. A reversible, explicitly associated single-select is required.
  async function choose(field, label, safe, visible, restoreLabel) {
    if (!safe() || !visible(field) ||
        (field instanceof HTMLButtonElement && field.type !== "button") ||
        !(field.getAttribute("aria-controls") || field.getAttribute("aria-owns")) ||
        field.matches(':disabled, [aria-disabled="true"], [aria-readonly="true"]')) return null;
    const expandedBefore = field.getAttribute("aria-expanded") === "true";
    if (!expandedBefore) field.click();
    let list;
    for (let attempt = 0; attempt < 20 && safe(); attempt++) {
      const ids = (field.getAttribute("aria-controls") || field.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
      const lists = ids.flatMap((id) => {
        const nodes = document.querySelectorAll(`#${CSS.escape(id)}`);
        return nodes.length === 1 ? [nodes[0]] : [];
      }).filter((node) => node?.matches('[role="listbox"]') && visible(node));
      if (lists.length === 1) { list = lists[0]; break; }
      await wait();
    }
    const close = () => {
      if (safe() && !expandedBefore && field.getAttribute("aria-expanded") === "true") field.click();
    };
    if (!safe() || !list || list.getAttribute("aria-multiselectable") === "true") { close(); return null; }
    const options = [...list.querySelectorAll('[role="option"]')].filter((option) =>
      option.closest('[role="listbox"]') === list && visible(option) &&
      !option.matches(':disabled, [aria-disabled="true"]'));
    const empty = options.filter((option) => option.getAttribute("data-value") === "" || option.getAttribute("value") === "");
    const matches = options.filter((option) => normalize(option.textContent) === normalize(label));
    if (matches.length !== 1 || (!restoreLabel && empty.length !== 1)) { close(); return null; }
    const beforeLabel = restoreLabel || empty[0].textContent.trim();
    if (!safe() || !list.isConnected || !matches[0].isConnected) { close(); return null; }
    matches[0].click();
    await wait();
    return { beforeLabel };
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
    const label = normalize(group.querySelector(":scope > legend,:scope > h2,:scope > h3,:scope > h4")?.textContent || group.getAttribute("aria-label") || "");
    const auto = group.getAttribute("data-automation-id") || "";
    const bob = group.matches('careers-ui-experience-edit-item') ? group.parentElement : group;
    const bobType = bob.matches('careers-ui-experience-form-control') && bob.getAttribute("data-testid");
    if (/^(?:work experience|work history|career history|employment(?: history)?)(?: \d+)?$/.test(label) || /^workExperience-\d+$/.test(auto) || bobType === "efc-experiences") return "experience";
    if (/^(?:education|education history|highest education qualification)(?: \d+)?$/.test(label) || /^education-\d+$/.test(auto) || bobType === "efc-education") return "education";
    return null;
  };
  return async function inspectHistory(mode, payload, form, labelFor, visible) {
    if (
      lastUrl !== location.href ||
      undo.some((entry) => entry.expires <= Date.now())
    )
      clear();
    const groups = [
      ...form.querySelectorAll(
        'fieldset, section, [role="group"], [data-automation-id], careers-ui-experience-edit-item',
      ),
    ]
      .flatMap((group) => {
        const kind = kindOf(group);
        if (!kind || !visible(group)) return [];
        const fields = [...group.querySelectorAll('input,textarea,select,button[aria-haspopup="listbox"]')]
          .filter(
            (field) =>
              visible(field) &&
              !field.matches(
                ':disabled, [aria-disabled="true"], [readonly], [list], select[multiple]',
              ) &&
              (!field.hasAttribute("aria-autocomplete") || custom(field)) &&
              (custom(field) || field instanceof HTMLTextAreaElement ||
                field instanceof HTMLSelectElement ||
                ["text", "month", "date", "number", "checkbox"].includes(field.type)),
          )
          .map((field) => ({ field, key: keys[normalize(labelFor(field))] }))
          .filter((entry) => entry.key && (entry.field.type !== "checkbox" || entry.key === "current") && (!custom(entry.field) ||
            /^(degree|startMonth|endMonth|startYear|endYear)$/.test(entry.key)));
        const required =
          kind === "experience" ? ["title", "company"] : ["school"];
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
    const repeaters = [...form.querySelectorAll('fieldset,section,[role="group"],careers-ui-experience-form-control')]
      .flatMap(group => {
        const kind = kindOf(group);
        if (!kind || !visible(group)) return [];
        const buttons = [...group.querySelectorAll('button[type="button"]')].filter(button =>
          visible(button) && !button.disabled && /^(?:\+\s*)?add(?: (?:another|more))?(?: (?:work |employment |education )?(?:experience|entry|education))?$/i.test(button.textContent.trim()));
        return buttons.length === 1 ? [{ group, kind, button: buttons[0] }] : [];
      });
    const available = groups.some(emptyGroup) || repeaters.length > 0;
    const validUndo = (entry) =>
      lastUrl === location.href &&
      !entry.edited &&
      entry.field.isConnected &&
      visible(entry.field) &&
      !entry.field.matches(':disabled, [aria-disabled="true"], [readonly], [aria-readonly="true"]') &&
      entry.group.contains(entry.field) &&
      read(entry.field) === entry.value &&
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
    const knownSaved = repeaters.some(item => item.kind === payload.kind && saved.get(item.group)?.has(fingerprint));
    if (
      knownSaved || matching.some((item) =>
        item.required.every((key) => {
          const value = payload.entry?.[key];
          return (
            value &&
            normalize(
              item.fields.find((field) => field.key === key).field.value,
            ) === normalize(value)
          );
        }),
      )
    )
      return {
        error:
          "This entry may already be present. Review the existing rows before adding it again.",
      };
    const empty = matching.filter(emptyGroup);
    const focused = empty.filter(({ group }) =>
      group.contains(document.activeElement),
    );
    const target =
      payload.automatic ? empty[0] : empty.length === 1 ? empty[0] : focused.length === 1 ? focused[0] : null;
    if (!target && payload.automatic && !payload.addAttempted) {
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
        const before = new Set(repeater.group.querySelectorAll('fieldset,[role="group"],careers-ui-experience-edit-item'));
        repeater.button.click();
        for (let attempt = 0; attempt < 40; attempt++) {
          if (location.href !== atUrl || !form.isConnected || !repeater.group.isConnected) return { filled: 0, skipped: 1 };
          const added = [...repeater.group.querySelectorAll('fieldset,[role="group"],careers-ui-experience-edit-item')].filter(node => !before.has(node));
          if (added.some(node => node.querySelector("input"))) {
            for (const group of added) created.add(group);
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
    const values = { ...payload.entry };
    for (const part of ["start", "end"]) {
      const value =
        part === "end" && values.dates?.current ? "" : values.dates?.[part];
      if (
        typeof value === "string" &&
        /^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(value)
      ) {
        values[part] = value;
        values[`${part}Year`] = value.slice(0, 4);
        if (value.length >= 7) values[`${part}Month`] = value.slice(5, 7);
      }
    }
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
    let filled = 0,
      skipped = 0;
    const warnings = [];
    const writes = [];
    const atUrl = location.href;
    for (const { field, key } of target.fields) {
      if (location.href !== atUrl || !form.isConnected || !target.group.contains(field)) break;
      let value = values[key];
      if (key === "current") {
        if (values.dates?.current === true && !field.checked && field.isConnected && visible(field) && !field.matches(':disabled,[aria-disabled="true"]')) {
          field.click();
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
        if (field.required && key !== "end") warnings.push(`${labelFor(field)} is missing from this profile entry.`);
        continue;
      }
      if (key === "start" || key === "end") {
        if (field.type === "month" && value.length >= 7) {
          value = value.slice(0, 7);
        } else if (value.length === 10 && field.type === "date") {
          /* Explicit day precision only; never manufacture an employment date. */
        } else if (value.length === 10 && /^dd-mm-yyyy$/i.test(field.placeholder || "")) {
          value = `${value.slice(8)}-${value.slice(5, 7)}-${value.slice(0, 4)}`;
        } else if (
          /^MM\s*\/\s*YYYY$/i.test(field.placeholder || "") &&
          value.length === 7
        )
          value = `${value.slice(5)}/${value.slice(0, 4)}`;
        else {
          skipped++;
          if (field.required) warnings.push(`${labelFor(field)} needs an exact date; your profile only supplies a year or month.`);
          continue;
        }
      }
      if (field instanceof HTMLSelectElement) {
        const matches = [...field.options].filter(
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
        const safe = () => location.href === atUrl && field.isConnected &&
          target.group.contains(field) && !read(field).trim() && !entry.edited;
        const selected = await choose(field, value, safe, visible);
        if (!selected) { skipped++; continue; }
        entry.custom = true;
        entry.beforeLabel = selected.beforeLabel;
        entry.value = read(field);
        // A click is not evidence the intended value was accepted by the site.
        if (normalize(entry.value) !== normalize(value)) { skipped++; continue; }
      } else setter(field, value);
      writes.push(entry);
    }
    if (writes.length) {
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
    for (const entry of writes) {
      if (validUndo(entry) && (!entry.field.validity || entry.field.validity.valid)) filled++;
      else skipped++;
    }
    // HiBob requires Save for each row before Add is available again. Only save
    // rows we opened and only after every required value validates.
    if (payload.automatic && created.has(target.group) && target.group.matches('careers-ui-experience-edit-item')) {
      const controls = [...target.group.querySelectorAll('input,textarea,select')].filter(visible);
      const complete = controls.every(field => field.type === "checkbox" ? true :
        (!field.required || read(field).trim()) && field.validity?.valid !== false && field.getAttribute("aria-invalid") !== "true");
      const saves = target.group.querySelectorAll('button[type="button"][data-testid="save-btn"]');
      if (complete && filled && saves.length === 1 && !saves[0].disabled && location.href === atUrl) {
        const owner = target.group.parentElement;
        saves[0].click();
        for (let attempt = 0; attempt < 40 && target.group.isConnected && location.href === atUrl; attempt++) await wait();
        if (!target.group.isConnected && owner.isConnected && location.href === atUrl) {
          const entries = saved.get(owner) || new Set(); entries.add(fingerprint); saved.set(owner, entries);
        } else warnings.push("The history row was filled but Save needs review on the form.");
      }
    }
    return { filled, skipped, warning: warnings[0], historyUndoAvailable: undo.some(validUndo) };
  };
}
