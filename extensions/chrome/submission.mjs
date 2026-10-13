// Serialized into the isolated world. Readiness is independent of optimistic
// Autofill counts; no values leave this closure or enter extension storage.
export function createSubmissionInspector() {
  let approval, expiryTimer, submittedRoot;
  const attempted = new WeakSet();
  const visible = node => node?.isConnected && !node.closest('[hidden],[inert],[aria-hidden="true"]') &&
    node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const text = node => clean(node?.getAttribute("aria-label") || node?.textContent || node?.value);
  const controls = root => [...new Set([
    ...root.querySelectorAll('input,select,textarea,[role="combobox"],[role="listbox"],[role="textbox"],[role="checkbox"],[role="radio"],[role="radiogroup"],[role="spinbutton"],[aria-haspopup="listbox"],[aria-required="true"],[contenteditable="true"],button[aria-pressed]'),
    ...(root instanceof HTMLFormElement ? [...root.elements] : []),
  ])].filter(node => !node.matches('input[type="submit"],input[type="button"],input[type="reset"],fieldset,output') &&
    (!node.matches("button") || node.matches('[role="combobox"],[aria-haspopup="listbox"],[aria-required="true"],[role="radio"],[aria-pressed]')));
  const enabled = node => !node.matches(':disabled,[aria-disabled="true"]');
  const buttons = root => [...new Set([
    ...root.querySelectorAll('button,input[type="submit"],[role="button"]'),
    ...(root instanceof HTMLFormElement ? [...root.elements].filter(node => node.matches('button,input[type="submit"]')) : []),
  ])].filter(visible);
  const finalButton = node => /^(?:submit|submit (?:my |your )?application|send (?:my |your )?application)$/i.test(text(node));
  const confirmations = () => [...document.querySelectorAll('h1,h2,[role="status"],[role="alert"]')].filter(visible)
    .some(node => /^(?:thank you for (?:your application|applying)[.!]?|(?:your )?application (?:has been |was )?(?:successfully )?(?:submitted|received)(?: successfully)?[.!]?|we have received your application[.!]?)$/i.test(text(node)));
  const clear = () => {
    clearTimeout(expiryTimer);
    approval?.root.removeEventListener("submit", approval.invalidate, true);
    approval?.button.removeEventListener("click", approval.invalidate, true);
    approval = undefined;
  };
  function inspect(root, labelFor) {
    const blockers = [];
    const add = message => { if (!blockers.includes(message)) blockers.push(message); };
    const fields = controls(root);
    const actions = buttons(root);
    const finals = actions.filter(finalButton);
    if (attempted.has(root)) add("A submission was already attempted. Check the employer confirmation; do not retry automatically.");
    if (confirmations()) add("An application confirmation is already displayed. Check whether you have already applied.");
    if (finals.length !== 1 || !enabled(finals[0])) add("One enabled final Submit application button could not be verified. Complete this step on the employer site.");
    if (document.querySelector('[aria-current="step"]') || actions.some(node =>
      /^(?:next(?: step)?|continue(?: application)?|save (?:and|&) continue|review application|review and submit)$/i.test(text(node))))
      add("This is a multi-step form. Complete its remaining steps on the employer site.");
    if (actions.some(node => enabled(node) && /^(?:save|save (?:entry|education|experience)|done)$/i.test(text(node))))
      add("Save or close open record editors on the employer site before submitting.");
    if (/\bapplication fee\b/i.test(root.innerText || ""))
      add("Applications requesting a payment require manual review and submission.");
    if (document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,[data-sitekey]'))
      add("This application has a CAPTCHA or verification gate. Submit it on the employer site.");
    if (root.querySelector('iframe') || [...root.querySelectorAll("*")].some(node => node.shadowRoot))
      add("Embedded or shadow-root controls cannot be fully verified. Submit this form manually.");
    if (fields.length > 500) add("This form exceeds the complete-verification limit. Submit it manually.");
    if (root.matches('[aria-busy="true"]') || root.querySelector('[aria-busy="true"],progress'))
      add("The form is still processing or uploading. Wait, then check again.");
    if ([...root.querySelectorAll('[role="alert"],[aria-invalid="true"],.field-error,.error-message')].some(node => visible(node) && (text(node) || node.getAttribute("aria-invalid") === "true")))
      add("The employer form reports an error. Resolve it before submitting.");
    let required = 0, files = 0;
    const snapshot = [];
    for (const field of fields.slice(0, 501)) {
      const label = clean(labelFor(field) || field.getAttribute("aria-label") || field.name || "Unlabelled field").slice(0, 160);
      const type = field.getAttribute("type") || field.getAttribute("role") || field.tagName.toLowerCase();
      const active = enabled(field) && field.type !== "hidden";
      const requiredGroup = field.closest('[aria-required="true"]');
      const needed = active && (field.required || field.getAttribute("aria-required") === "true" ||
        requiredGroup || /\*|\brequired\b/i.test(label));
      const native = field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement;
      let value = native ? field.value : clean(field.getAttribute("aria-valuetext") || field.getAttribute("aria-valuenow") || field.textContent);
      if (field.getAttribute("role") === "combobox") {
        const selected = field.getAttribute("aria-valuetext") || (native ? field.value : field.textContent);
        value = clean(selected);
      }
      let complete = !!clean(value) && !/^(?:select(?: one| an option)?\.*|choose(?: one| an option)?\.*|search\.*)$/i.test(value);
      if (field.type === "checkbox" || field.getAttribute("role") === "checkbox")
        complete = field.checked === true || field.getAttribute("aria-checked") === "true";
      if (field.type === "radio") complete = fields.some(other => other.type === "radio" && other.name === field.name && other.checked);
      if (field.getAttribute("role") === "radio") {
        const group = field.closest('[role="radiogroup"]');
        complete = !!group?.querySelector('[role="radio"][aria-checked="true"]');
      }
      if (field.type === "file") {
        files += field.files?.length || 0;
        complete = !!field.files?.length;
        // File selection is not server acceptance. The separate final approval
        // must explicitly include the user's inspection of upload completion.
      }
      if (needed) { required++; if (!complete) add(`${label}: complete this required field on the form.`); }
      if (active && field.type === "password") add("Sign-in or password controls require manual handling.");
      if (active && (/\bcc-/i.test(field.getAttribute("autocomplete") || "") || /\b(?:credit card|card number|cvv|bank account)\b/i.test(label)))
        add("Payment and banking controls require manual review and submission.");
      if (active && native && field.willValidate) {
        const pattern = field.getAttribute("pattern");
        let validPattern = true;
        try { if (pattern) new RegExp(pattern, "v"); } catch { validPattern = false; }
        if (!validPattern) add(`${label}: the employer's validation rule cannot be verified. Submit manually.`);
        else if (!field.validity.valid) add(`${label}: the employer's validation has not passed.`);
        if (field.value && ((field.maxLength >= 0 && field.value.length > field.maxLength) ||
            (field.minLength > 0 && field.value.length < field.minLength)))
          add(`${label}: the answer does not meet the employer's length limit.`);
      }
      if (needed && ((!native && !["checkbox", "radio"].includes(field.getAttribute("role"))) ||
          field.matches('[role="combobox"],[aria-haspopup="listbox"]')))
        add(`${label}: custom required controls need manual submission verification.`);
      if (active && field.hasAttribute("aria-pressed"))
        add("Choice-button groups need manual submission verification.");
      snapshot.push([field, label, type, value, field.checked, field.required, field.disabled, field.readOnly,
        field.getAttribute("pattern"), field.getAttribute("min"), field.getAttribute("max"), field.getAttribute("minlength"), field.getAttribute("maxlength"), field.getAttribute("aria-required"),
        field.getAttribute("aria-invalid"), field.getAttribute("aria-checked"), field.getAttribute("aria-pressed"), visible(field),
        field.files ? [...field.files].map(file => [file.name, file.size, file.lastModified]) : null,
        field instanceof HTMLSelectElement ? [...field.selectedOptions].map(option => [option.value, option.textContent]) : null]);
    }
    // Include legal text and instructions, not just answers, so approval cannot
    // survive an employer changing the declaration or meaning of a question.
    return { blockers, required, files, fields: fields.length, button: finals[0], snapshot,
      fingerprint: JSON.stringify([location.href, root.textContent, root.getAttribute("action"), root.getAttribute("method"),
        snapshot.map(([, ...state]) => state), actions.map(node => [text(node), enabled(node), node.getAttribute("type"), node.getAttribute("formaction"), node.getAttribute("formmethod")])]) };
  }
  return function submission(mode, root, labelFor, payload = {}) {
    if (mode === "outcome") {
      // A click, form disappearance, HTTP response or redirect alone is not success.
      const previous = submittedRoot;
      const liveForm = previous?.isConnected && controls(previous).some(node => visible(node) && enabled(node));
      const navigationForm = [...document.querySelectorAll('form,[role="form"]')].some(form =>
        visible(form) && controls(form).some(node => visible(node) && enabled(node)));
      return { outcome: (previous || payload.afterNavigation === true) && confirmations() && !liveForm && !navigationForm ? "confirmed" : "unverified" };
    }
    if (mode === "cancel") { clear(); return { cancelled: true }; }
    const current = inspect(root, labelFor);
    if (mode === "prepare") {
      clear();
      if (!current.blockers.length && typeof payload.token === "string") {
        const invalidate = () => { attempted.add(root); clear(); };
        approval = { root, button: current.button, fingerprint: current.fingerprint, fields: current.snapshot.map(row => row[0]),
          fileRefs: controls(root).filter(field => field.type === "file").map(field => ({ field, files: [...field.files] })),
          token: payload.token, files: current.files, invalidate, expires: Date.now() + 90_000 };
        root.addEventListener("submit", invalidate, true);
        current.button.addEventListener("click", invalidate, true);
        expiryTimer = setTimeout(clear, 90_000);
      }
      return { ready: !current.blockers.length, blockers: current.blockers.slice(0, 30),
        blockerCount: current.blockers.length, required: current.required, fields: current.fields, files: current.files };
    }
    const saved = approval;
    clear(); // Every approval is one-use, including failed or stale confirmations.
    if (mode !== "commit" || !saved || payload.token !== saved.token || payload.confirmed !== true ||
        saved.expires <= Date.now() || root !== saved.root || current.button !== saved.button ||
        (saved.files > 0 && payload.documentsReviewed !== true) ||
        current.blockers.length || saved.fingerprint !== current.fingerprint ||
        saved.fileRefs.some(({ field, files }) => files.length !== field.files.length || files.some((file, i) => file !== field.files[i])) ||
        current.snapshot.some((row, i) => row[0] !== saved.fields[i]))
      return { clicked: false, message: "The form changed or approval expired. Review it again. Nothing submitted." };
    attempted.add(root);
    submittedRoot = root;
    saved.button.click();
    return { clicked: true };
  };
}
