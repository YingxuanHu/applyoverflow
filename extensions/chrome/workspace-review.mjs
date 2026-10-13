// Values are returned only to the authenticated, same-account workspace bridge.
// They stay in memory and are never written to extension storage or logs.
export function createWorkspaceReviewer() {
  let saved;
  const ids = new WeakMap();
  let serial = 0;
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const visible = field => field.isConnected && !field.closest('[hidden],[inert],[aria-hidden="true"]') && field.getClientRects().length > 0 && getComputedStyle(field).visibility !== "hidden";
  const valueOf = field => field.type === "file" ? [...field.files].map(file => file.name).join(", ") :
    field.type === "checkbox" || field.type === "radio" ? field.checked ? "Yes" : "No" :
    field instanceof HTMLSelectElement ? field.value :
    "value" in field ? field.value : field.getAttribute("aria-valuetext") || field.getAttribute("aria-valuenow") || clean(field.textContent);
  function rows(root, labelFor) {
    return [...new Set([...root.querySelectorAll('input,textarea,select,[role="combobox"],[role="textbox"],button[aria-pressed],button[role="radio"]'),
      ...[...(root.elements || [])].filter(field => field.matches('input,textarea,select'))])]
      .filter(field => !field.matches('input[type="hidden"],input[type="password"],input[type="submit"],input[type="button"],input[type="reset"]') &&
        !/\b(?:cc-|one-time-code|current-password|new-password)/.test(field.autocomplete || "") &&
        !/\b(?:ssn|social security|bank account|credit card|security code)\b/i.test(labelFor(field) || "") && (visible(field) || (field.type === "file" && field.files?.length)))
      .slice(0, 500).map(field => {
        if (!ids.has(field)) ids.set(field, `review-${++serial}`);
        const label = clean(labelFor(field) || field.getAttribute("aria-label") || field.name || "Unlabelled field").slice(0, 500);
        const native = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement;
        const type = field.type || field.getAttribute("role") || "text";
        const options = field instanceof HTMLSelectElement ? [...field.options].slice(0, 500).map(option => ({ value: option.value, label: option.textContent.trim(), disabled: option.disabled || !!option.closest('optgroup[disabled]') })) : [];
        const readOnly = !native || field.disabled || field.readOnly || field.type === "file" || field.multiple || String(valueOf(field) ?? "").length > 15000 || field.matches('[role="combobox"],[aria-haspopup="listbox"]');
        const value = String(valueOf(field) ?? "").slice(0, 15000);
        const section = clean(field.closest('fieldset,[role="group"],section')?.querySelector('legend,h2,h3,[role="heading"]')?.textContent).slice(0, 150);
        return { field, id: ids.get(field), label, value, type, options, readOnly, section,
          required: !!field.required || field.getAttribute("aria-required") === "true" || /\*/.test(label),
          maxLength: field.maxLength >= 0 ? field.maxLength : 15000 };
      });
  }
  const fingerprint = row => JSON.stringify([row.label, row.value, row.type, row.options, row.readOnly, row.required, row.maxLength]);
  return async function review(mode, root, labelFor, input = {}) {
    const originalUrl = location.href;
    let current = rows(root, labelFor);
    if (mode === "edit") {
      const prior = saved?.rows.find(row => row.id === input.id);
      const row = current.find(row => row.id === input.id);
      if (!saved || saved.root !== root || saved.url !== location.href || saved.expires <= Date.now() || input.revision !== saved.revision ||
          !prior || !row || row.field !== prior.field || fingerprint(row) !== fingerprint(prior) || row.readOnly)
        throw new Error("The form changed. Refresh the review before editing; nothing was overwritten.");
      if (typeof input.value !== "string" || input.value.length > Math.min(row.maxLength, 15000)) throw new Error("The answer exceeds this field's limit.");
      saved = null;
      const field = row.field;
      if (["checkbox", "radio"].includes(row.type)) {
        if (!["Yes", "No"].includes(input.value) || row.type === "radio" && input.value === "No") throw new Error("Select this choice on the employer form.");
        if (field.checked !== (input.value === "Yes")) field.click();
      } else {
        if (row.type === "select-one" && !row.options.some(option => option.value === input.value && !option.disabled)) throw new Error("That option is no longer available.");
        const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(field, input.value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.blur();
      }
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!field.isConnected || location.href !== originalUrl || valueOf(field) !== input.value)
        throw new Error("The employer did not retain this edit. Check the field on the employer form.");
      current = rows(root, labelFor);
    }
    const revision = crypto.randomUUID();
    saved = { root, rows: current, revision, url: location.href, expires: Date.now() + 5 * 60_000 };
    return { revision, fields: current.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "field"))), url: location.href,
      notice: "Only the current employer step is shown. File upload status, custom controls, declarations and additional steps need review on the employer form." };
  };
}
