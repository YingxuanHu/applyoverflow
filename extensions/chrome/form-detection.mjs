// Self-contained factory: adapter.mjs embeds it in the isolated-world runtime.
export function createFormDetection() {
  const controls = 'input,textarea,select,button,[role="combobox"],[role="listbox"],[role="option"],[contenteditable]:not([contenteditable="false"])';
  const historyRows = 'careers-ui-experience-form-control,[data-automation-id^="workExperience-"],[data-automation-id^="education-"]';
  const groups = `fieldset,section,[role="group"],[role="radiogroup"],${historyRows}`;
  const foreign = /\b(?:references?|referral|referrer|referred|emergency|supervisor|manager|employer|employment|work experience|career history|education|billing|shipping)\b/i;
  const parent = node => node?.parentElement || node?.getRootNode()?.host;
  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  function text(node, limit = 500) {
    if (!node) return "";
    const walker = node.ownerDocument.createTreeWalker(node, 5, {
      acceptNode: child => child.nodeType === 1 && child.matches(`${controls},script,style,template`) ? 2 : 1,
    });
    let value = "", count = 0, child;
    while ((child = walker.nextNode())) {
      if (++count > 256) return "";
      // The walker rejects controls and their current answers, including editors.
      if (child.nodeType === 3) value += child.data;
      if (value.length > limit) return "";
    }
    return clean(value);
  }
  function visible(node) {
    if (!node?.getClientRects().length) return false;
    for (let current = node, depth = 0; current; current = parent(current)) {
      if (++depth > 80 || current.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
      const style = getComputedStyle(current);
      if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") return false;
    }
    return true;
  }
  function references(node) {
    const raw = node.getAttribute("aria-labelledby") || "";
    if (raw.length > 1000) return null;
    const ids = [...new Set(raw.split(/\s+/).filter(Boolean))];
    if (!ids.length || ids.length > 8) return null;
    const root = node.getRootNode();
    const result = [];
    for (const id of ids) {
      const matches = root.querySelectorAll(`#${CSS.escape(id)}`);
      if (matches.length !== 1) return null;
      const target = matches[0];
      if (target === node || node.contains(target) || target.closest(controls)) continue;
      const value = text(target);
      if (!value) return null;
      result.push(value);
    }
    return [...new Set(result)];
  }
  function ownLabel(node) {
    const labels = [...node.querySelectorAll(':scope > label')];
    if (labels.length !== 1 || labels[0].querySelector(controls)) return "";
    const label = labels[0];
    const target = label.getAttribute("for");
    // A label already bound to a different control is never borrowed.
    if (target && node.getRootNode().querySelectorAll(`#${CSS.escape(target)}`).length) return "";
    return text(label);
  }
  function compoundLabel(node) {
    const valueControls = 'input,textarea,select,[role="combobox"],[role="radio"],[role="checkbox"],button[aria-pressed]';
    if (node.closest('[role="listbox"],[role="tree"],[role="menu"]')) return "";
    for (let branch = parent(node), depth = 0; branch && depth < 3; branch = parent(branch), depth++) {
      if (branch.matches('form,[role="form"],body,html')) break;
      if ([...branch.querySelectorAll(valueControls)].some(control => visible(control) && control !== node && !node.contains(control))) break;
      const label = ownLabel(branch);
      if (label) return label;
      if (branch.matches(groups)) break;
    }
    return "";
  }
  function labelFor(node, meaning) {
    if (node.hasAttribute("aria-labelledby")) {
      const parts = references(node);
      if (!parts?.length) return "";
      const label = parts.join(" ");
      // Multiple ARIA references may include an external selected answer. Only
      // combine known identity-label fragments; arbitrary widgets stay manual.
      return label.length <= 500 && (parts.length === 1 || meaning(label)) ? label : "";
    }
    if (node.hasAttribute("aria-label")) {
      const label = clean(node.getAttribute("aria-label"));
      return label.length <= 500 ? label : "";
    }
    const labels = [...(node.labels || [])];
    if (labels.length > 8) return "";
    if (!labels.length) return compoundLabel(node);
    const parts = [...new Set(labels.map(label => text(label)))];
    if (parts.some(part => !part)) return "";
    const label = parts.join(" ");
    return label.length <= 500 && (parts.length <= 1 || meaning(label)) ? label : "";
  }
  function groupTitle(node) {
    if (node.hasAttribute("aria-labelledby")) return references(node)?.join(" ") || "";
    return clean(node.getAttribute("aria-label")) || text(node.querySelector(':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4')) ||
      (node.matches('fieldset,[role="group"],[role="radiogroup"]') ? ownLabel(node) : "");
  }
  function groupContext(field, form, fieldLabel = "") {
    const titles = [];
    let unsafe = false;
    for (let node = parent(field), depth = 0; node; node = parent(node)) {
      if (++depth > 80) { unsafe = true; break; }
      if (node.matches(groups)) {
        const title = groupTitle(node);
        titles.push(title);
        const ownCurrentQuestion = /^(?:current (?:company|employer|job title)|company you currently work for)\s*[*:]?$/i.test(title) &&
          clean(title).toLowerCase() === clean(fieldLabel).toLowerCase() &&
          node.querySelectorAll('input,textarea,select,[role="combobox"]').length === 1;
        if ((!ownCurrentQuestion && foreign.test(title)) || (node.hasAttribute("aria-labelledby") && !title) ||
            node.matches(historyRows)) unsafe = true;
      }
      if (node === form) break;
    }
    return { title: titles.find(Boolean) || "", unsafe };
  }
  function manualChoices(form, label) {
    const selector = '[role="radio"],[role="checkbox"],[role="switch"]';
    const nodes = [...form.querySelectorAll(selector)].filter(node => visible(node) && !node.closest('[role="listbox"],[role="tree"],[role="menu"]'));
    const reported = new Set(), result = [];
    for (const node of nodes) {
      const enclosing = node.matches('[role="radio"]') ? node.closest('[role="radiogroup"]') : null;
      const group = enclosing && form.contains(enclosing) ? enclosing : null;
      const field = group || node;
      if (reported.has(field)) continue;
      reported.add(field);
      const choices = group ? nodes.filter(choice => choice.matches('[role="radio"]') && choice.closest('[role="radiogroup"]') === group) : [node];
      // A visible native control is already handled by the existing engine.
      // Hidden inputs behind ARIA wrappers are not safe write targets.
      if (choices.every(choice => {
        const native = choice.matches('input[type="radio"],input[type="checkbox"]') ? [choice] :
          [...choice.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
        return native.length === 1 && visible(native[0]);
      })) continue;
      const optionLabel = choice => label(choice) || text(choice);
      const options = choices.map(optionLabel);
      const titleFor = () => {
        let title = group ? groupTitle(group) : optionLabel(node);
        if (!title && group) {
          // Some accessible custom choices omit the group's name but put a short
          // question immediately before its otherwise control-free wrapper.
          for (let branch = group, depth = 0; branch && branch !== form && depth < 3; branch = branch.parentElement, depth++) {
            if ([...branch.querySelectorAll(`${controls},${selector},[role="radiogroup"]`)].some(control => control !== group && !group.contains(control))) break;
            const preceding = branch.previousElementSibling;
            if (preceding?.matches('p,label,legend,h1,h2,h3,h4') && visible(preceding) && !preceding.querySelector(`${controls},${selector}`)) {
              title = text(preceding);
              break;
            }
          }
        }
        title ||= options.join(" / ");
        if (!title || title.length > 500) title = group ? "Unlabelled radio group" : "Unlabelled choice";
        return title;
      };
      const title = titleFor();
      const role = node.getAttribute("role");
      const members = () => group ? [...group.querySelectorAll(selector)] : [node];
      const initialMembers = members();
      const valid = () => field.isConnected && form.contains(field) && visible(field) && titleFor() === title &&
        choices.every((choice, index) => choice.isConnected && visible(choice) && choice.getAttribute("role") === role && optionLabel(choice) === options[index]) &&
        (!group || (group.getAttribute("role") === "radiogroup" && members().length === initialMembers.length && members().every((choice, index) => choice === initialMembers[index])));
      const writable = () => valid() && (role !== "radio" || (group && choices.length >= 2)) && choices.length <= 80 &&
        initialMembers.length === choices.length &&
        !field.hasAttribute("aria-owns") && !field.querySelector('[role="radiogroup"],[role="group"]') &&
        options.every(Boolean) && new Set(options.map(value => clean(value).normalize("NFKC").toLowerCase())).size === options.length &&
        choices.every(choice => ["true", "false"].includes(choice.getAttribute("aria-checked")) &&
          !choice.closest(':disabled,[disabled],[readonly],[aria-disabled="true"],[aria-readonly="true"],[aria-busy="true"]') &&
          !(choice instanceof HTMLButtonElement && choice.type !== "button") && !choice.matches('a[href],input') &&
          ![...choice.querySelectorAll('input,button,select,textarea,a[href],[contenteditable="true"]')].some(control => visible(control))) &&
        (role !== "radio" || choices.filter(choice => choice.getAttribute("aria-checked") === "true").length <= 1);
      const checked = choices.filter(choice => choice.getAttribute("aria-checked") === "true");
      const selected = group ? checked.length === 1 : ["true", "mixed"].includes(node.getAttribute("aria-checked"));
      result.push({ field, focus: choices.find(choice => choice.tabIndex >= 0) || choices[0], label: title,
        kind: group || node.matches('[role="radio"]') ? "radio" : "checkbox", options: options.slice(0, 80),
        required: field.getAttribute("aria-required") === "true" || Boolean(field.querySelector('input[required]')),
        state: selected ? "kept" : "needed",
        ariaChoice: { fields: choices, labels: options, valid, writable } });
    }
    // Explicit non-submit Yes/No buttons can implement a single choice. Default
    // submit buttons remain detection-only even if their labels look identical.
    for (const node of form.querySelectorAll('button[aria-pressed]')) {
      if (!visible(node) || node.closest('[role="listbox"],[role="tree"],[role="menu"]') || result.some(item => item.field.contains(node))) continue;
      const group = parent(node);
      if (!group || !form.contains(group) || reported.has(group)) continue;
      const choices = [...group.querySelectorAll('button[aria-pressed]')];
      if (choices.length !== 2 || !choices.every(choice => parent(choice) === group && visible(choice))) continue;
      const options = choices.map(choice => label(choice) || text(choice));
      if (options.map(value => value.toLowerCase()).sort().join("|") !== "no|yes") continue;
      const titleFor = () => groupTitle(group) || compoundLabel(group);
      const title = titleFor();
      if (!title) continue;
      reported.add(group);
      const valid = () => group.isConnected && form.contains(group) && visible(group) && titleFor() === title &&
        group.querySelectorAll('button[aria-pressed]').length === choices.length && choices.every((choice, index) =>
          choice.isConnected && parent(choice) === group && visible(choice) && (label(choice) || text(choice)) === options[index]);
      const writable = () => valid() && choices.every(choice => choice.type === "button" &&
        ["true", "false"].includes(choice.getAttribute("aria-pressed")) &&
        !choice.closest(':disabled,[disabled],[aria-disabled="true"],[aria-readonly="true"],[aria-busy="true"]') &&
        !choice.querySelector('input,select,textarea,button,a[href],[contenteditable="true"]')) &&
        ![...group.querySelectorAll('input,select,textarea,[role="combobox"]')].some(control => visible(control)) &&
        choices.filter(choice => choice.getAttribute("aria-pressed") === "true").length <= 1;
      result.push({ field: group, focus: choices[0], label: title, kind: "radio", options,
        required: group.getAttribute("aria-required") === "true",
        state: choices.filter(choice => choice.getAttribute("aria-pressed") === "true").length === 1 ? "kept" : "needed",
        ariaChoice: { fields: choices, labels: options, checkedAttribute: "aria-pressed", valid, writable } });
    }
    return result;
  }
  function scan(root) {
    const elements = [], roots = [root];
    let count = 0;
    for (let index = 0; index < roots.length; index++) {
      const walker = root.ownerDocument?.createTreeWalker(roots[index], 1) || root.createTreeWalker(roots[index], 1);
      let node;
      while ((node = walker.nextNode())) {
        if (++count > 12000) return { oversized: true };
        elements.push(node);
        if (node.shadowRoot && node.id !== "applyoverflow-assistant") {
          if (roots.length >= 24) return { oversized: true };
          roots.push(node.shadowRoot);
        }
      }
    }
    return { elements, roots, oversized: false };
  }
  function applicationEvidence(form) {
    const candidates = [groupTitle(form)];
    candidates.push(...[...form.querySelectorAll('h1,h2,h3,h4,button,input[type="submit"]')].slice(0, 60)
      .filter(node => visible(node) && !node.closest('fieldset,[role="group"]'))
      .map(node => node.tagName === "INPUT" ? node.value : text(node)));
    // A preceding local heading is evidence; an unrelated heading elsewhere in
    // the document (e.g. a careers link above a newsletter) is not.
    for (let node = form, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      let sibling = node.previousElementSibling;
      for (let i = 0; sibling && i < 3; i++, sibling = sibling.previousElementSibling) {
        if (sibling.matches('form,[role="form"]')) break;
        if (sibling.matches('h1,h2,h3,h4,header') && visible(sibling)) candidates.push(text(sibling));
      }
      if (!node.parentElement || node.parentElement.matches('body,main,section,article')) break;
    }
    if (candidates.some(value => /\b(?:loan|credit|grant|rental|coupon|newsletter|subscribe|sign in|sign up)\b/i.test(value))) return false;
    return candidates.some(value => /\b(?:job application|application(?: form)?$|apply for (?:this|the) (?:job|role|position)|submit application|my information|my experience)\b/i.test(value) || /^(?:apply|apply now)$/i.test(value));
  }
  function genericApplication(form, label, meaning) {
    if (!visible(form) || form.querySelector('input[type="password"]')) return false;
    const title = groupTitle(form);
    if (/\b(?:newsletter|job alerts?|subscribe|sign in|sign up|contact us|request (?:a )?(?:demo|quote)|support|loan|credit|grant|rental)\b/i.test(title)) return false;
    const inputs = [...form.querySelectorAll('input')].filter(field => visible(field) && !field.disabled &&
      !groupContext(field, form, label(field)).unsafe && !["hidden", "password", "submit", "button"].includes(field.type));
    const keys = new Set(inputs.map(field => meaning(label(field))));
    const resume = inputs.some(field => field.type === "file" && /^(?:upload |attach )?(?:your )?(?:resume|r\u00e9sum\u00e9|cv|resume\s*\/\s*cv)\s*[*:]?$/i.test(label(field)));
    const identity = keys.has("givenName") || keys.has("familyName") || keys.has("fullName");
    return keys.has("email") && (identity || resume) && (applicationEvidence(form) || (resume && identity));
  }
  function profileLink(value) {
    const text = value.replace(/[.]$/, "").replace(/^a link to (?:your )?/, "");
    if (/^(?:personal )?(?:website\s*(?:\/|or)\s*portfolio|portfolio\s*(?:\/|or)\s*(?:personal )?website)(?: (?:url|link))?$/.test(text)) return "portfolioUrl";
    // Only an explicit choice allowing LinkedIn can use the shared professional
    // URL. "LinkedIn and GitHub" requests two links, not one interchangeable URL.
    const choice = text.replace(/ or similar professional (?:profile or )?website$/, "");
    if (/\bor\b|\//.test(text) && /^linkedin(?: (?:profile|url|link))?\s*(?:,\s*|\/\s*|or\s+)(?:github(?: profile)?|portfolio|(?:personal |professional )?(?:website|profile))(?:\s*(?:,\s*|\/\s*|or\s+)(?:github|portfolio|(?:personal |professional )?(?:website|profile)))*(?: (?:url|link))?$/.test(choice)) return "professionalUrl";
    return undefined;
  }
  return { scan, text, visible, labelFor, groupTitle, groupContext, manualChoices, genericApplication, applicationEvidence, profileLink, parent };
}
