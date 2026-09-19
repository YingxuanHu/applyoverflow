// Serialized alongside the inspector. Only existing, explicit history groups
// are eligible; this never clicks Add, Next, or Submit.
export function createHistoryInspector() {
  let undo = [],
    lastUrl = "",
    expiryTimer;
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
    company: "company",
    "company name": "company",
    employer: "company",
    school: "school",
    "school name": "school",
    university: "school",
    degree: "degree",
    location: "location",
    description: "description",
    "role description": "description",
    "start date": "start",
    from: "start",
    "end date": "end",
    to: "end",
    "start year": "startYear",
    "start month": "startMonth",
    "end year": "endYear",
    "end month": "endMonth",
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
  return async (mode, payload, form, labelFor, visible) => {
    if (
      lastUrl !== location.href ||
      undo.some((entry) => entry.expires <= Date.now())
    )
      clear();
    const groups = [
      ...form.querySelectorAll(
        'fieldset, [role="group"], [data-automation-id]',
      ),
    ]
      .flatMap((group) => {
        const label = normalize(
          group.querySelector(":scope > legend")?.textContent ||
            group.getAttribute("aria-label") ||
            "",
        );
        const auto = group.getAttribute("data-automation-id") || "";
        const kind =
          /^(?:work experience|employment(?: history)?)(?: \d+)?$/.test(
            label,
          ) || /^workExperience-\d+$/.test(auto)
            ? "experience"
            : /^(?:education|education history)(?: \d+)?$/.test(label) ||
                /^education-\d+$/.test(auto)
              ? "education"
              : null;
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
                ["text", "month", "number"].includes(field.type)),
          )
          .map((field) => ({ field, key: keys[normalize(labelFor(field))] }))
          .filter((entry) => entry.key && (!custom(entry.field) ||
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
            (other) => other !== item && other.group.contains(item.group),
          ),
      );
    const emptyGroup = ({ group, fields }) =>
      fields.every(({ field }) => !read(field).trim()) &&
      ![...group.querySelectorAll("input,textarea,select")].some(
        (field) =>
          visible(field) &&
          !["hidden", "button", "submit", "reset"].includes(field.type) &&
          (["checkbox", "radio"].includes(field.type)
            ? field.checked
            : field.value.trim()),
      );
    const available = groups.some(emptyGroup);
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
    const matching = groups.filter((item) => item.kind === payload.kind);
    if (
      matching.some((item) =>
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
      empty.length === 1 ? empty[0] : focused.length === 1 ? focused[0] : null;
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
        /^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/.test(value)
      ) {
        values[part] = value;
        values[`${part}Year`] = value.slice(0, 4);
        if (value.length === 7) values[`${part}Month`] = value.slice(5);
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
    const writes = [];
    const atUrl = location.href;
    for (const { field, key } of target.fields) {
      let value = values[key];
      if (
        typeof value !== "string" ||
        !value.trim() ||
        target.fields.filter((entry) => entry.key === key).length !== 1
      ) {
        skipped++;
        continue;
      }
      if (key === "start" || key === "end") {
        if (field.type === "month" && value.length === 7) {
          /* Exact month precision. */
        } else if (
          /^MM\s*\/\s*YYYY$/i.test(field.placeholder || "") &&
          value.length === 7
        )
          value = `${value.slice(5)}/${value.slice(0, 4)}`;
        else {
          skipped++;
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
    return { filled, skipped, historyUndoAvailable: undo.some(validUndo) };
  };
}
