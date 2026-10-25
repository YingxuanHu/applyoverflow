import { applicationContext } from "./sites.mjs";
import { createHistoryInspector } from "./history.mjs";
import { createAutofillInspector } from "./autofill.mjs";

// The build serializes this factory and the shared URL resolver into an isolated
// world. No remote code, page globals, or page-provided messages are evaluated.
export function createInspector(resolveContext, history, autofill, submission, workspace) {
  let resumeTarget;
  const attemptedResumes = new WeakSet();
  const resumeAttempts = new WeakMap();
  const formResumeAttempts = new WeakMap();
  let undoEntries = [],
    undoUrl = "",
    undoTimer;
  function clearUndo() {
    clearTimeout(undoTimer);
    for (const entry of undoEntries) {
      entry.field.removeEventListener("input", entry.onEdit);
      entry.field.removeEventListener("change", entry.onEdit);
    }
    undoEntries = [];
    undoUrl = "";
  }
  return async function inspectApplication(
    mode = "inspect",
    contact = {},
    expectedUrl = "",
  ) {
    if (undoUrl && undoUrl !== location.href) clearUndo();
    const context = resolveContext(location.href, true);
    if (!context)
      return {
        error:
          "Open a supported application form. Sign-in pages and sensitive links need manual entry.",
      };
    if (expectedUrl && location.href !== expectedUrl)
      return { error: "The page changed. Open the extension again." };
    const rippling = context.provider === "generic" && location.hostname === "ats.rippling.com" &&
      /^\/[a-z0-9_-]+\/jobs\/[a-f0-9-]{36}\/apply\/?$/i.test(location.pathname);
    const hibob = /\.careers\.hibob\.com$/.test(location.hostname) &&
      /^\/jobs\/[a-f0-9-]{36}\/apply\/?$/i.test(location.pathname);
    // Bind country-relative eligibility questions to the posting, never the
    // applicant address or arbitrary text elsewhere on the page.
    let employmentCountry;
    // Prefer the current posting's structured metadata over employer/platform
    // names or applicant location. Multiple job postings/countries are ambiguous.
    const postings = [];
    const collectPosting = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4 || postings.length > 10) return;
      if (Array.isArray(value)) { for (const item of value.slice(0, 40)) collectPosting(item, depth + 1); return; }
      if ([value["@type"]].flat().includes("JobPosting")) postings.push(value);
      if (value["@graph"]) collectPosting(value["@graph"], depth + 1);
    };
    for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 10)) {
      if (script.textContent.length > 200_000) continue;
      try { collectPosting(JSON.parse(script.textContent)); } catch { /* Ignore invalid publisher metadata. */ }
    }
    const posting = postings.length === 1 ? postings[0] : undefined;
    if (posting) {
      const places = [posting.jobLocation].flat().filter(Boolean);
      const countries = places.map(place => {
        const raw = place?.address?.addressCountry;
        return typeof raw === "string" ? raw : raw?.name;
      }).map(value => ({ ca: "CA", canada: "CA", us: "US", usa: "US", "united states": "US", "united states of america": "US" })[String(value || "").trim().toLowerCase()]);
      if (countries.length && countries.every(country => country && country === countries[0])) employmentCountry = countries[0];
    }
    if (context.provider === "workday") {
      const place = decodeURIComponent(new URL(context.url).pathname.split("/job/")[1]?.split("/")[0] || "");
      const ca = /(?:^|[-,\s])(?:CAN|Canada)(?:$|[-,\s])/i.test(place);
      const us = /(?:^|[-,\s])(?:USA|United-States)(?:$|[-,\s])/i.test(place);
      if (ca !== us) employmentCountry = ca ? "CA" : "US";
    }
    if (hibob) {
      const locations = [...document.querySelectorAll('careers-ui-job-ad-header .job-ad-subtitle')];
      if (locations.length === 1) {
        const place = locations[0].textContent.trim().split("\u00b7")[0].trim();
        const parts = place.split(",").map(part => part.trim().toLowerCase());
        const country = { canada: "CA", "united states": "US", "united states of america": "US", usa: "US", us: "US" }[parts.at(-1)];
        if (country && !/\b(?:or|and|uk|united kingdom|mexico)\b|[;/]/i.test(place) &&
            !(country === "CA" && /\bunited states\b|\busa?\b/i.test(place)) &&
            !(country === "US" && /\bcanada\b/i.test(place))) employmentCountry = country;
      }
    }
    const aliases = {
      "first name": "givenName",
      "given name": "givenName",
      "middle name": "middleName",
      "last name": "familyName",
      "family name": "familyName",
      surname: "familyName",
      "full name": "fullName",
      name: "fullName",
      email: "email",
      "email address": "email",
      "confirm email address": "email",
      "confirm email": "email",
      "e-mail": "email",
      "e-mail address": "email",
      phone: "phone",
      "phone number": "phone",
      "phone device type": "phoneType",
      "phone type": "phoneType",
      "phone extension": "phoneExtension",
      "country phone code": "phoneCountry",
      "country dialing code": "phoneCountry",
      "country code picker": "phoneCountry",
      "mobile phone": "phone",
      "mobile phone number": "phone",
      telephone: "phone",
      "address line 1": "streetAddress",
      "street address": "streetAddress",
      street: "streetAddress",
      "address 1": "streetAddress",
      address: "fullAddress",
      "full address": "fullAddress",
      "home address": "fullAddress",
      "address line 2": "addressLine2",
      "address 2": "addressLine2",
      city: "city",
      "city/town": "city",
      "location (city)": "city",
      "location (city, province or state)": "cityRegion",
      "postal code": "postalCode",
      province: "region",
      state: "region",
      "state/province": "region",
      "province or state": "region",
      "province or territory": "region",
      country: "country",
      "country/region": "country",
      "preferred name": "preferredName",
      "preferred first name": "preferredName",
      pronouns: "pronouns",
      "zip code": "postalCode",
      "zip/postal code": "postalCode",
      "postal/zip code": "postalCode",
      linkedin: "linkedInUrl",
      "linkedin profile": "linkedInUrl",
      "linkedin url": "linkedInUrl",
      github: "githubUrl",
      "github url": "githubUrl",
      portfolio: "portfolioUrl",
      "portfolio, github, or personal site": "portfolioGithubUrl",
      "portfolio url": "portfolioUrl",
      skills: "skills",
      "technical skills": "skills",
      "current company": "currentCompany",
      "current employer": "currentCompany",
      "current job title": "currentTitle",
      "current title": "currentTitle",
      "current role": "currentTitle",
      "other website": "portfolioGithubUrl",
    };
    const normalize = (value) =>
      value
        .normalize("NFKC")
        .replace(/[*\u2731\u2217]|\(required\)|\(optional\)/gi, "")
        .replace(/:$/, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    // Match a bounded vocabulary of applicant facts, not edit-distance guesses.
    // "Employer email" and "LinkedIn experience" must never become contact data.
    const meaning = (label) => {
      const text = normalize(label).replace(/[?.!]+$/, "").trim()
        .replace(/^(?:please\s+)?(?:enter|provide|share|paste)\s+(?:a\s+)?/, "")
        .replace(/^(?:what is|what's)\s+/, "")
        .replace(/^(?:a link to\s+|link to\s+)?(?:your|applicant|candidate)\s+/, "");
      if (Object.hasOwn(aliases, text)) return aliases[text];
      const professionalAlternatives = text.split(/\s*(?:,|\bor\b)\s*/).filter(Boolean);
      if (professionalAlternatives.length >= 2 && professionalAlternatives.length <= 5 &&
        professionalAlternatives.every(part => /^(?:your )?(?:linked[ -]?in(?: (?:public )?profile)?|github(?: profile)?|portfolio|(?:personal |professional )?(?:website|site))(?: (?:url|link))?$/.test(part)) &&
        professionalAlternatives.some(part => /linked[ -]?in/.test(part))) return "professionalUrl";
      if (/\b(?:link|url|website|profile)\b/.test(text) && /\bor\b/.test(text) &&
        /linkedin/i.test(text) && /github|portfolio|professional (?:profile|website)/.test(text) &&
        !/experience|describe|explain|employer|reference|referr|company|team/.test(text)) return "professionalUrl";
      if (/\bor\b/.test(text) && /portfolio|personal (?:website|site)/.test(text) && /github|portfolio/.test(text) &&
        !/experience|describe|explain|employer|reference|referr|company|team|linkedin/.test(text)) return "portfolioGithubUrl";
      const rules = [
        ["givenName", /^(?:legal )?(?:first|given) name(?:\(s\)|s)?$/],
        ["familyName", /^(?:legal )?(?:last|family) name(?:\(s\)|s)?$/],
        ["fullName", /^(?:legal|complete|first and last) (?:full )?name$/],
        ["email", /^(?:personal|preferred|contact) e[- ]?mail(?: address)?$/],
        ["phone", /^(?:contact|mobile|cell|cellphone|telephone|primary phone)(?: number)?$/],
        ["linkedInUrl", /^(?:link to (?:your )?)?linked[ -]?in(?: (?:profile|public profile))?(?: (?:url|link|address))?$/],
        ["githubUrl", /^github(?: profile)?(?: (?:url|link|address))?$/],
        ["portfolioUrl", /^(?:personal )?(?:portfolio|website)(?: (?:url|link|address))?$/],
        ["region", /^(?:state|province|region)(?:\s*(?:[/,]|or)\s*(?:state|province|region|territory)){1,2}(?: or local equivalent)?$/],
        ["region", /(?:^|[.!]\s*)(?:in )?which (?:us |u\.s\. |canadian )?(?:state|province) do you (?:reside|live)(?: in)?\??$|^(?:state|province) of residence$/],
        ["city", /^(?:current |home )?city(?: of residence)?$|^city\s*\/\s*town$|^(?:current )?location(?:\s*\(city\))?$/],
        ["cityRegion", /^(?:current )?location\s*\(city,?\s*(?:province|state)(?: or (?:province|state))?\)$/],
        ["country", /^(?:current |home )?country(?: of residence)?$/],
        ["postalCode", /^(?:zip|postal)(?:\s*\/\s*(?:zip|postal))?(?: code)?$/],
        ["streetAddress", /^(?:home |mailing )?street address(?: line 1)?$/],
        ["addressLine2", /^(?:apartment|apt|unit)(?:\s*(?:\/|or)\s*(?:apartment|unit|suite))?(?: number)?$/],
      ];
      return rules.find(([, pattern]) => pattern.test(text))?.[0];
    };
    const visible = (element) =>
      !!element.getClientRects().length &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      getComputedStyle(element).visibility !== "hidden" &&
      getComputedStyle(element).display !== "none";
    const valueControls =
      'input, textarea, select, button, [role="combobox"], [role="listbox"], [role="option"]';
    const choiceSelector = 'button[aria-pressed],[role="radio"][aria-checked]:not(input)';
    const menuSelectSelector = 'button[type="button"][aria-haspopup="true"],button[type="button"][aria-haspopup="menu"]';
    // A labelled native select establishes that this menu is a value picker,
    // not an action menu. Never write to the hidden mirror directly.
    const menuSelectRoot = field => {
      if (!field.matches(menuSelectSelector)) return null;
      for (let root = field.parentElement, depth = 0; root && !root.matches('body,form,[role="form"]') && depth < 6; root = root.parentElement, depth++) {
        const controls = [...root.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"],button[aria-haspopup]')];
        const select = controls.find(node => node instanceof HTMLSelectElement);
        if (controls.length === 2 && controls.includes(field) && select && !visible(select) &&
            !select.multiple && !select.disabled && select.labels?.length === 1 && visible(select.labels[0])) return root;
        if (controls.length > 2) break;
      }
      return null;
    };
    const readonlyTrigger = field => {
      if (!(field instanceof HTMLInputElement) || !field.readOnly || field.tabIndex !== -1 || field.type !== "text") return null;
      const trigger = field.parentElement?.closest('[tabindex="0"]');
      return trigger && !trigger.matches('form,body,button,a') &&
        trigger.querySelectorAll('input,select,textarea,button,a,[role="combobox"]').length === 1 &&
        trigger.contains(field) && visible(trigger) ? trigger : null;
    };
    const phoneGroup = field => {
      if (!field.matches('[role="combobox"][aria-haspopup="listbox"]')) return null;
      for (let root = field.parentElement, depth = 0; root && !root.matches('body,form,[role="form"]') && depth < 12; root = root.parentElement, depth++) {
        const controls = [...root.querySelectorAll('input,select,textarea,button,[role="combobox"]')]
          .filter(node => visible(node) && !node.closest('[role="listbox"]'));
        if (controls.length === 2 && controls.includes(field) && controls.some(node => node !== field &&
          node.matches('input[type="tel"],input[inputmode="tel"],input[autocomplete="tel-national"]'))) return root;
        if (controls.length > 2) break;
      }
      return null;
    };
    const labelFor = (element) => {
      if (element.matches(menuSelectSelector)) {
        const mirror = menuSelectRoot(element)?.querySelector('select');
        return mirror ? labelFor(mirror) : "";
      }
      if (element.matches(choiceSelector))
        return (element.getAttribute("aria-label") || element.textContent).trim().replace(/\s+/g, " ");
      if (phoneGroup(element)) return "Phone country";
      const salary = hibob && element.closest('b-currency-value-select');
      if (salary && salary.querySelectorAll('input').length === 1 &&
          salary.querySelectorAll('b-single-select > [role="button"]').length === 1 &&
          normalize(salary.querySelector('label')?.textContent || "") === "desired salary") {
        if (element.matches('input')) return "Desired salary (amount)";
        if (element.matches('b-single-select > [role="button"]')) return "Desired salary (currency)";
      }
      if (context.provider === "lever" && !["radio", "checkbox"].includes(element.type)) {
        const question = element.closest('.application-question');
        const headings = question?.querySelectorAll('.application-label');
        if (headings?.length === 1 && !headings[0].contains(element)) return headings[0].textContent.trim();
      }
      const linkedLabels = element.id ? [...document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)] : [];
      const originalLabel = element.labels?.[0] || (linkedLabels.length === 1 ? linkedLabels[0] : null);
      const label = originalLabel?.cloneNode(true);
      // Hidden internal IDs/help text are not the question. Inspect computed
      // styles on the live nodes; detached clones no longer inherit site CSS.
      const copies = [...label?.querySelectorAll('*') || []];
      [...originalLabel?.querySelectorAll('*') || []].forEach((node, index) => {
        const style = getComputedStyle(node);
        if (node.matches('[hidden],[aria-hidden="true"]') || style.display === "none" || style.visibility === "hidden") copies[index].remove();
      });
      label
        ?.querySelectorAll(`${valueControls},svg,style,script`)
        .forEach((control) => control.remove());
      for (const node of label?.querySelectorAll('*') || []) {
        if (/^(?:required|optional)[.*:]?$/i.test(node.textContent.trim())) node.remove();
      }
      // Widgets can include their current selection in aria-labelledby. Only
      // accept one independent label; ambiguous references stay manual.
      const labelNodes = [
        ...new Set(
          (element.getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)),
        ),
      ].filter(
        (node) =>
          node &&
          node !== element &&
          !element.contains(node) &&
          !node.contains(element) &&
          !node.closest(valueControls) &&
          !node.querySelector(valueControls),
      );
      const labelledBy =
        labelNodes.length === 1 ? labelNodes[0].textContent : "";
      const explicit = (
        label?.textContent ||
        labelledBy ||
        element.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ");
      if (explicit && !/^(?:select|choose|search)(?: one)?[.\u2026]*$/i.test(explicit)) return explicit;
      // Follow local structural labels only when the container identifies one
      // control. Never lift text from a whole form or use a current answer.
      for (let parent = element.parentElement, depth = 0; parent && !parent.matches('body,form,[role="form"]') && depth < 8; parent = parent.parentElement, depth++) {
        const controls = [...parent.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"],button[aria-haspopup]')].filter(visible);
        if (controls.length !== 1 || controls[0] !== element) continue;
        const labels = [...parent.querySelectorAll('label,legend,[data-testid$="-label"]')].filter(node => !node.contains(element) && !node.closest(valueControls) && !node.querySelector(valueControls));
        if (labels.length === 1) return labels[0].textContent.trim().replace(/\s+/g, " ");
        const headings = [...parent.querySelectorAll('p,h2,h3,h4,[role="heading"]')].filter(node => visible(node) &&
          !node.contains(element) && !node.closest(valueControls) && !node.querySelector(valueControls) &&
          (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) && node.textContent.trim());
        if (!labels.length && headings.length === 1) return headings[0].textContent.trim().replace(/\s+/g, " ");
      }
      // Some forms label a pair of name inputs together and identify each part
      // only by its placeholder. Keep this fallback semantic and subordinate to
      // actual labels; example answers and generic "Type here" are not prompts.
      const placeholder = element.getAttribute("placeholder")?.trim() || "";
      if (placeholder.length <= 100 && (meaning(placeholder) ||
        /^(?:company(?: name)?|employer(?: name)?|job title|title|school(?: name)?|university|degree|field of study|major|start date|end date)$/i.test(placeholder))) return placeholder;
      return "";
    };
    const controlSelector =
      `input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup][aria-labelledby],${menuSelectSelector},${choiceSelector}`;
    const flexible = ["generic", "workday", "icims", "workable"].includes(
      context.provider,
    );
    const accessibleName = node => node.getAttribute("aria-label") ||
      (node.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || "").join(" ");
    // Application shells are often labelled divs, not HTML forms. Their name
    // establishes scope; visible applicant identity fields still gate detection.
    const applicationShells = flexible ? [...document.querySelectorAll('[aria-label],[aria-labelledby]')]
      .filter(node => !node.matches('body,html,input,button,select,textarea,a') && visible(node) &&
        /^(?:(?:job|candidate|employment) )?application(?: form)?$/i.test(accessibleName(node).trim())) : [];
    const applicationHeading =
      /\b(application|apply|my information|my experience|candidate info(?:rmation)?)\b/i.test(
        [
          ...document.querySelectorAll(
            "h1,h2,h3,h4,[role='tab'][aria-selected='true'],[data-automation-id='pageHeaderTitle']",
          ),
        ]
          .map((node) => node.textContent)
          .join(" ") + " " + [...document.querySelectorAll('button,input[type="submit"]')]
          .map(node => node.value || node.textContent).filter(text => /^\s*(?:submit|send|complete)(?: (?:your|this))? application\s*$/i.test(text || "")).join(" "),
      );
    const historyStep = form => [...form.querySelectorAll('h2,h3,h4,legend,[role="heading"]')].some(node =>
      /^(?:work experience|employment history|career history|education(?: history)?)\s*[*:]?$/i.test(node.textContent.trim())) &&
      ([...form.querySelectorAll('input')].some(field => /^(?:job title|position title|school|school name)$/i.test(normalize(labelFor(field)))) ||
       [...form.querySelectorAll('button')].some(button => button.type === "button" && /^add(?: another)?(?: job| experience| education| entry)?$/i.test(button.textContent.trim())));
    if (document.querySelectorAll(controlSelector).length > 500)
      return {
        error: "This form is too large to inspect safely. Use manual entry.",
      };
    const contactEvidence = form => {
      const facts = new Set([...form.querySelectorAll('input')].filter(visible).map(field => meaning(labelFor(field))));
      return facts.has("email") && (facts.has("givenName") || facts.has("fullName")) &&
        !form.querySelector('input[type="password"]');
    };
    const applicationForm = form => (applicationShells.includes(form) ||
      /(?:job[-_]?application|application[-_]?form|applyform)/i.test(`${form.id} ${form.getAttribute("name") || ""}`)) && contactEvidence(form);
    const forms = [
      ...new Set([...applicationShells, ...document.querySelectorAll(
        hibob ? "careers-ui-job-ad-application-form" : context.provider === "ashby"
          ? ".ashby-application-form-container"
          : context.provider === "workable"
            ? 'form[data-ui="application-form"]'
            : context.provider === "workday"
              ? 'form, [data-automation-id="applyFlowPage"]'
              : 'form, [role="form"]',
      )]),
    ]
      .filter(
        (form) =>
          visible(form) &&
          (!flexible || !form.querySelector('input[type="password"]')) &&
          (!flexible || !/\b(newsletter|job alerts?|subscribe|sign in|sign up)\b/i.test(
            [form.getAttribute("aria-label"), form.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > legend")?.textContent].filter(Boolean).join(" "),
          )) &&
          ([...form.querySelectorAll("input")].some(
            (field) => meaning(labelFor(field)) === "email",
          ) ||
            // Signed-in Workday candidates have a read-only email, and later
            // steps can contain questions only. Require the ATS apply container;
            // field-level identity checks below still govern every write.
            (context.provider === "workday" &&
              /\/apply(?:\/|$)/.test(location.pathname) &&
              form.matches('[data-automation-id="applyFlowPage"]') &&
              applicationHeading &&
              [...form.querySelectorAll(controlSelector)].some(
                (field) => visible(field) && labelFor(field),
              )) ||
            (context.provider === "workable" &&
              /\/apply\/?$/.test(location.pathname)) ||
            (flexible &&
              applicationHeading &&
              (historyStep(form) || form.querySelector(
                'fieldset, [data-automation-id^="workExperience-"], [data-automation-id^="education-"]',
              )))) &&
          (!flexible ||
            context.provider === "workable" ||
            (applicationHeading && (contactEvidence(form) || ![...form.querySelectorAll('input')].some(field => meaning(labelFor(field)) === "email"))) || applicationForm(form) || hibob ||
            (contactEvidence(form) && form.querySelector('input[type="file"][accept*="pdf"]'))),
      )
      .filter(
        (form, _, all) =>
          !all.some((other) => other !== form && form.contains(other)),
      );
    // Form-less employer pages: require multiple applicant facts and a resume
    // control inside one non-document container, plus explicit application text.
    if (!forms.length && flexible && applicationHeading && !applicationShells.length) {
      const inputs = [...document.querySelectorAll("input")].filter(field => visible(field));
      const emails = inputs.filter(field => meaning(labelFor(field)) === "email");
      if (emails.length === 1) {
        let root = emails[0].parentElement;
        while (root && !root.matches("body,html")) {
          const keys = new Set([...root.querySelectorAll("input")].map(field => meaning(labelFor(field))));
          if (keys.has("email") && (keys.has("givenName") || keys.has("fullName")) &&
              (root.querySelector('input[type="file"]') || keys.has("phone") || keys.has("city")) && !root.querySelector('input[type="password"]') &&
              !root.querySelector("form")) { forms.push(root); break; }
          root = root.parentElement;
        }
      }
    }
    if (forms.length !== 1)
      return {
        error:
          "A single application form was not found. Embedded or multi-form pages need manual review.",
      };
    const blockingDialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog:modal')].find(dialog =>
      visible(dialog) && !forms[0].contains(dialog) && !dialog.contains(forms[0]) &&
      dialog.querySelector('input,select,textarea,button'));
    if (blockingDialog && /^(?:autofill|fill|resume)/.test(mode) && !/inspect|context|options|focus/.test(mode))
      return { error: "Complete or close the dialog on the employer page, then click Autofill again. Privacy choices and sign-in must be completed by you." };
    if (mode === "submission-preview" || mode === "submission-commit") {
      if (!submission) return { error: "Reload the extension before reviewing submission." };
      return submission(mode === "submission-preview" ? "prepare" : "commit", forms[0], labelFor, contact);
    }
    if (mode === "workspace-review" || mode === "workspace-edit") {
      if (!workspace) return { error: "Update the extension to use the application workspace." };
      if (blockingDialog) return { error: "Complete or close the dialog on the employer form before reviewing." };
      if (mode === "workspace-edit") submission?.("cancel", forms[0], labelFor);
      try { return await workspace(mode === "workspace-edit" ? "edit" : "read", forms[0], labelFor, contact); }
      catch (error) { return { error: error.message || "Could not read or update this field. Refresh the review before retrying." }; }
    }
    const fields = [...forms[0].querySelectorAll(controlSelector)].filter(
      (field) =>
        visible(field) &&
        !field.matches(':disabled, [aria-disabled="true"]') &&
        (!field.readOnly || field.matches('[role="combobox"][aria-haspopup="listbox"]') || readonlyTrigger(field)),
    );
    // An accessible segmented choice is one question, not independent commands.
    // Require one local prompt and one isolated set; never click submit buttons.
    const buttonChoices = new Map();
    for (const field of fields.filter(node => node.matches(choiceSelector))) {
      for (let root = field.parentElement, depth = 0; root && root !== forms[0] && depth < 5; root = root.parentElement, depth++) {
        const choices = [...root.querySelectorAll(choiceSelector)];
        if (choices.length < 2 || choices.length > 12 || choices.some(node => node.form && node.type !== "button")) continue;
        if (choices.some(node => !visible(node) || node.matches(':disabled,[aria-disabled="true"]') ||
          !labelFor(node) || !["true", "false"].includes(node.getAttribute(node.hasAttribute("aria-pressed") ? "aria-pressed" : "aria-checked")))) continue;
        if (new Set(choices.map(node => normalize(labelFor(node)))).size !== choices.length) continue;
        const other = [...root.querySelectorAll('input,select,textarea,button,[role="combobox"]')].filter(node => !choices.includes(node));
        if (other.some(node => node.type !== "hidden" && !(node.type === "radio" && !node.disabled && choices.some(choice => choice.contains(node))) && !(node.type === "checkbox" && node.tabIndex === -1 &&
          (!visible(node) || getComputedStyle(node).opacity === "0" || !node.getBoundingClientRect().width)))) continue;
        const named = (root.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map(id => document.getElementById(id));
        const labels = [...root.querySelectorAll('label,legend,p,h2,h3,h4,[role="heading"]')].filter(node =>
          visible(node) && !node.closest(choiceSelector) && !node.querySelector('input,select,textarea,button,[role="radio"]'));
        const names = [...new Set([root.getAttribute("aria-label"), ...named.filter(node => node && !root.contains(node)).map(node => node.textContent),
          ...labels.map(node => node.textContent)].filter(Boolean).map(text => text.trim().replace(/\s+/g, " ")))];
        if (names.length !== 1 || names[0].length > 500) continue;
        for (const node of choices) buttonChoices.set(node, { choiceFields: choices, choiceGroup: root, label: names[0] });
        for (const node of other) buttonChoices.set(node, { mirror: true });
        break;
      }
    }
    const resumeWidgets = new Map();
    const resumePrompt = value => /^(?:(?:upload|attach|choose|select) (?:your |a )?)?(?:resume|r\u00e9sum\u00e9|cv|curriculum vitae)(?:\s*[/&]\s*(?:resume|cv))?$/.test(normalize(value));
    // A complete list of file-type tokens is guidance, not an uploaded filename.
    const fileTypeHint = value => /^(?:(?:accepted|supported|allowed)\s+(?:file\s+)?(?:types|formats|extensions)\s*:\s*)?(?:\*?\.)?(?:pdf|docx?|rtf|txt)(?:\s*(?:[,;/|]|\bor\b|\band\b)\s*(?:\*?\.)?(?:pdf|docx?|rtf|txt))*$/i.test(value);
    const attachmentPresent = widget => [...widget.querySelectorAll('button,a,p,span,[data-automation-id="fileName"]')]
      .some(node => visible(node) && (/^(?:remove|replace|delete)(?:\s+(?:file|resume|cv|attachment))?$/i.test((node.getAttribute('aria-label') || node.textContent).trim()) ||
        (/^[^\n<>]{1,180}\.(?:pdf|docx?|rtf|txt)$/i.test(node.textContent.trim()) && !fileTypeHint(node.textContent.trim()))));
    const semanticResumeWidget = field => {
      // File inputs are commonly hidden and id-less. Bind one local document
      // prompt to one picker, never the first file input or a page-wide heading.
      const ownLabel = labelFor(field);
      const named = resumePrompt(ownLabel);
      if (/\b(?:cover letter|photo|picture|portfolio|import|autofill)\b/i.test(ownLabel)) return null;
      for (let widget = field.parentElement, depth = 0; widget && widget !== forms[0] && depth < 7; widget = widget.parentElement, depth++) {
        if (widget.querySelectorAll('input[type="file"]').length !== 1 ||
          widget.querySelector('input:not([type="file"]):not([type="hidden"]),textarea,select,[role="combobox"]')) break;
        if (!visible(widget)) continue;
        const prompts = [widget, ...widget.querySelectorAll('label,p,legend,h2,h3,h4,[role="heading"],span')]
          .filter(node => visible(node) && !node.querySelector('input,button,select,textarea') && resumePrompt(node.textContent));
        const accessible = accessibleName(widget);
        const buttons = [...widget.querySelectorAll('button,[role="button"]')].filter(visible);
        const upload = buttons.filter(button => !button.matches(':disabled,[aria-disabled="true"]') &&
          /^(?:(?:select file\s*[-:]\s*)?(?:upload|attach|choose|select) (?:your )?(?:resume|cv|resume\/cv)|(?:choose|select|upload|attach|browse)(?: (?:a )?files?)?)$/.test(normalize(labelFor(button) || button.textContent)));
        const explicitAction = upload.some(button => resumePrompt((labelFor(button) || button.textContent).replace(/^select file\s*[-:]\s*/i, '')));
        const labelled = named || resumePrompt(accessible) || prompts.length > 0 || explicitAction;
        if (!labelled) continue;
        if (/\b(?:cover letter|photo|picture|import|autofill)\b/i.test(accessible)) return null;
        // The visible picker, a local upload action, or a labelled dropzone is
        // enough evidence; a hidden control without a visible UI is not.
        if ((visible(field) && getComputedStyle(field).opacity !== '0') || upload.length === 1 ||
            (!buttons.length && /\b(?:upload|drag.{0,12}drop|choose file|browse)\b/i.test(widget.textContent))) return widget;
      }
      return named && visible(field) ? field : null;
    };
    const resumeCandidates = [
      ...forms[0].querySelectorAll('input[type="file"]'),
    ].filter(field => {
      if (field.closest('.ashby-application-form-autofill-input-root')) return false;
      let widget = semanticResumeWidget(field);
      // Older widgets expose their document prompt through provider-owned
      // groups rather than a native label. They share the same safety checks.
      if (context.provider === "workday") {
        const group = field.closest('[role="group"][aria-labelledby]');
        const names = (group?.getAttribute("aria-labelledby") || "").split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || "").filter(Boolean);
        if (names.length === 1 && resumePrompt(names[0]) && visible(group) &&
            group.querySelectorAll('input[type="file"]').length === 1) widget = group;
      }
      if (rippling) {
        const group = field.closest('label[data-testid="resume"]');
        const labels = (group?.getAttribute("aria-labelledby") || "").split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || "");
        if (field.getAttribute("data-testid") === "input-resume" &&
          forms[0].querySelectorAll('input[type="file"][data-testid="input-resume"]').length === 1 &&
          group && visible(group) && labels.some(resumePrompt)) widget = group;
      }
      const label = normalize(labelFor(field));
      if (!widget && context.provider === 'greenhouse' && field.id === 'resume' &&
          /^(attach|resume|resume\/cv|cv)$/.test(label) && visible(field)) widget = field.parentElement;
      if (context.provider === "lever") {
        const group = field.closest('.visible-resume-upload');
        if (field.name === 'resume' && field.id === 'resume-upload-input' && group && visible(group) &&
            /resume|cv/i.test(group.querySelector('.default-label')?.textContent || '')) widget = group;
      }
      if (!widget && context.provider === 'ashby' && field.id === '_systemfield_resume' && resumePrompt(label) &&
          visible(field.closest('.ashby-application-form-input-file') || field)) widget = field.closest('.ashby-application-form-input-file') || field;
      if (!widget || !visible(widget) || field.parentElement.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      resumeWidgets.set(field, widget);
      return true;
    });
    const resumeInput = resumeCandidates.length === 1 ? resumeCandidates[0] : null;
    const resumeWidget = resumeWidgets.get(resumeInput);
    const uploadOutcome = (field, widget, attempt) => {
      if (!widget.isConnected || location.href !== attempt.url) return { state: 'unverified', message: 'The form changed during resume upload. Check the attachment on the form.' };
      const alerts = [...widget.querySelectorAll('[role="alert"],[aria-live="assertive"]')].filter(node => visible(node) && node.textContent.trim());
      if (field.getAttribute('aria-invalid') === 'true' || field.validity.customError || alerts.some(node => /error|fail|reject|invalid|large|exceed|unsupported|not (?:allowed|accepted)/i.test(node.textContent)))
        return { state: 'failed', message: 'The employer rejected the resume. Check its upload error and attach an accepted file.' };
      if (widget.matches('[aria-busy="true"]') || widget.querySelector('[aria-busy="true"]') ||
          [...widget.querySelectorAll('[role="progressbar"],progress')].some(node => visible(node) && (node.matches('progress')
            ? !node.hasAttribute('value') || node.value < node.max
            : !node.hasAttribute('aria-valuenow') || Number(node.getAttribute('aria-valuenow')) < Number(node.getAttribute('aria-valuemax') || 100))) ||
          /\b(?:uploading|processing file|scanning file)\b/i.test(widget.innerText))
        return { state: 'pending', message: 'Resume upload is still processing. Check the employer form before continuing.' };
      const selected = field.files?.[0];
      const displayed = [...widget.querySelectorAll('a,span,p,[role="status"]')].some(node => visible(node) && node.textContent.trim() === attempt.name);
      if (displayed) return { state: 'attached', message: 'The employer form displays your resume attachment.' };
      if (field.isConnected && selected?.name === attempt.name && selected?.size === attempt.size)
        return { state: 'selected', message: 'Default resume selected. Check the employer form for upload confirmation.' };
      return { state: 'unverified', message: 'Resume upload could not be confirmed. Check the attachment on the form; it was not uploaded again.' };
    };
    const existingResume = !!resumeInput && (Boolean(resumeInput.files?.length || resumeInput.value) || attachmentPresent(resumeWidget) ||
      Boolean(resumeWidget.querySelector('[data-automation-id="fileName"],[data-automation-id="delete-file"],[data-automation-id="deleteFile"]')) ||
      Boolean(resumeWidget.querySelector('.filename')?.textContent?.trim()));
    const previousAttempt = resumeWidget && (resumeAttempts.get(resumeWidget) || formResumeAttempts.get(forms[0]));
    const resumeAttempt = previousAttempt?.url === location.href ? previousAttempt : undefined;
    const resumeOutcome = resumeAttempt && uploadOutcome(resumeInput, resumeWidget, resumeAttempt);
    const resumeAvailable =
      !!resumeInput &&
      !existingResume && !resumeAttempt &&
      !resumeInput.matches(':disabled,[aria-disabled="true"]') &&
      !resumeInput.closest('[inert],[aria-busy="true"]') &&
      (!resumeInput.id || document.querySelectorAll(`[id="${CSS.escape(resumeInput.id)}"]`).length === 1) &&
      !attemptedResumes.has(resumeInput);
    const manualResume = (resumeCandidates.length > 0 && !resumeAvailable && !existingResume && !resumeAttempt) || (!resumeInput && (
      (forms[0].querySelector('input[type="file"]') && [...forms[0].querySelectorAll('label,p,legend,h2,h3,h4,[role="heading"]')]
        .some(node => visible(node) && resumePrompt(node.textContent))) ||
      (hibob && [...forms[0].querySelectorAll('careers-ui-upload-document-control')]
        .some(widget => visible(widget) && /\b(resume|cv)\b/i.test(widget.textContent))) ||
      [...(forms[0].closest('main,[role="main"]') || forms[0]).querySelectorAll('button')].some(button => visible(button) &&
        /^(?:import|upload|attach) (?:resume|cv|resume\/cv)$/.test(normalize(labelFor(button) || button.innerText)))));
    const identityIds = {
      givenName: "first_name",
      familyName: "last_name",
      fullName: "full_name",
      email: "email",
      phone: "phone",
    };
    const contactEntry = (field) => {
      const label = labelFor(field);
      const normalized = normalize(label);
      let key = Object.hasOwn(aliases, normalized)
        ? aliases[normalized]
        : undefined;
      const explicitAddressLine = normalized === "address" &&
        ["street-address", "address-line1"].includes(field.getAttribute("autocomplete"));
      if (explicitAddressLine) key = "streetAddress";
      // ATS-generated identifiers distinguish applicant facts from similarly named
      // employer questions. Never infer identity from autocomplete alone.
      if (context.provider === "lever") {
        const standard = {
          name: "fullName",
          email: "email",
          phone: "phone",
          "urls[LinkedIn]": "linkedInUrl",
          "urls[GitHub]": "githubUrl",
          "urls[Portfolio]": "portfolioUrl",
        };
        key =
          standard[field.name] === key ||
          (field.name === "name" && normalized === "full name")
            ? standard[field.name]
            : undefined;
      }
      if (context.provider === "ashby") {
        const standard = {
          _systemfield_name: "fullName",
          _systemfield_email: "email",
          _systemfield_phone: "phone",
        };
        const systemKey = standard[field.name] ?? standard[field.id];
        key =
          systemKey &&
          (systemKey === key ||
            (systemKey === "fullName" && normalized === "name"))
            ? systemKey
            : undefined;
      }
      if (context.provider === "workday") {
        const standard = {
          legalNameSection_firstName: "givenName",
          legalNameSection_lastName: "familyName",
          email: "email",
          phoneNumber: "phone",
          addressSection_addressLine1: "streetAddress",
          addressSection_addressLine2: "addressLine2",
          addressSection_city: "city",
          addressSection_postalCode: "postalCode",
        };
        // Current Workday application controls also use paired names/IDs,
        // observed on the public Colliers applyManually form (September 2026).
        const paired = {
          "name--legalName--firstName": ["legalName--firstName", "givenName"],
          "name--legalName--lastName": ["legalName--lastName", "familyName"],
          "address--addressLine1": ["addressLine1", "streetAddress"],
          "address--addressLine2": ["addressLine2", "addressLine2"],
          "address--city": ["city", "city"],
          "address--postalCode": ["postalCode", "postalCode"],
          "emailAddress--emailAddress": ["emailAddress", "email"],
          "phoneNumber--phoneNumber": ["phoneNumber", "phone"],
        };
        const pair = paired[field.id];
        if (
          standard[field.getAttribute("data-automation-id")] !== key &&
          !(pair && pair[0] === field.name && pair[1] === key)
        )
          key = undefined;
      }
      if (context.provider === "icims") {
        const standard = {
          firstname: "givenName",
          lastname: "familyName",
          email: "email",
          phonenumber: "phone",
          address: "streetAddress",
          address2: "addressLine2",
          city: "city",
          zip: "postalCode",
        };
        const name = (field.name || field.id)
          .toLowerCase()
          .match(/^personprofilefields[._](\w+)$/)?.[1];
        if (!name || standard[name] !== key) key = undefined;
      }
      if (context.provider === "workable") {
        // Observed on Fastbreak AI's live Workable application (2026-09-20).
        // Names/IDs/data-ui must all agree; custom questions use QA_* IDs.
        const standard = {
          firstname: "givenName", lastname: "familyName", email: "email",
        };
        if (
          standard[field.id] !== key || field.name !== field.id ||
          field.getAttribute("data-ui") !== field.id
        ) key = undefined;
      }
      if (context.provider === "generic") {
        // A label plus an HTML autocomplete semantic are required on unknown
        // sites; never infer personal data from placeholder text or input order.
        const standard = {
          "given-name": "givenName",
          "family-name": "familyName",
          name: "fullName",
          email: "email",
          tel: "phone",
          "street-address": "streetAddress",
          "address-line1": "streetAddress",
          "address-line2": "addressLine2",
          "address-level2": "city",
          "postal-code": "postalCode",
        };
        const tokens = (field.getAttribute("autocomplete") || "")
          .trim()
          .toLowerCase()
          .split(/\s+/);
        // HTML permits section and recipient prefixes. Do not treat reference,
        // billing or shipping sections as the applicant's contact information.
        if (
          /^section-[a-z0-9_-]+$/.test(tokens[0]) &&
          !/reference|referr|emergency|supervisor|billing|shipping/.test(tokens[0])
        )
          tokens.shift();
        if (
          ["home", "work", "mobile"].includes(tokens[0]) &&
          ["email", "tel"].includes(tokens[1])
        ) tokens.shift();
        const token = tokens.length === 1 ? tokens[0] : "";
        const ripplingFields = { first_name: "givenName", last_name: "familyName", email: "email", phone_number: "phone" };
        const input = field.getAttribute("data-input");
        const confirmedRipplingField = rippling && ripplingFields[input] === key && key &&
          field.getAttribute("data-testid") === `input-${input}` &&
          field.getAttribute("aria-labelledby") === `${field.id}-label`;
        if ((!token || standard[token] !== key) && !confirmedRipplingField) key = undefined;
      }
      const group = field
        .closest("fieldset")
        ?.querySelector("legend")
        ?.textContent?.trim();
      const greenhousePhone = context.provider === "greenhouse" && group === "Phone" &&
        field.id === "phone" && key === "phone";
      if (
        group &&
        !greenhousePhone &&
        !/^(personal (information|details)|contact (information|details)|your (information|details))$/i.test(
          group,
        )
      )
        key = undefined;
      if (flexible) {
        const section = field.closest('section, [role="group"]');
        const heading =
          section?.querySelector("h2,h3,legend")?.textContent ||
          section?.getAttribute("aria-label") ||
          "";
        if (
          /reference|referr|emergency|supervisor|manager|work experience|education|employ(?:er|ment)/i.test(
            heading,
          )
        )
          key = undefined;
      }
      // A custom employer question labelled "Email" may concern a reference, not
      // the applicant. Identity fields must also match Greenhouse's standard IDs.
      if (
        context.provider === "greenhouse" &&
        key &&
        identityIds[key] &&
        field.id !== identityIds[key]
      )
        key = undefined;
      // Supplement provider-specific IDs with explicit standard semantics, but
      // never reinterpret reference/history fields or duplicate identity labels.
      let profileKey = key;
      const semantic = { "given-name": "givenName", "family-name": "familyName", name: "fullName",
        "address-level1": "region", country: "country", "country-name": "country",
        email: "email", tel: "phone", "street-address": "streetAddress", "address-line1": "streetAddress",
        "address-line2": "addressLine2", "address-level2": "city", "postal-code": "postalCode" };
      const candidate = explicitAddressLine ? "streetAddress" : aliases[normalized];
      if (!profileKey && candidate && !/reference|referr|emergency|supervisor|employ|education/i.test(group || "")) {
        const token = (field.getAttribute("autocomplete") || "").trim().toLowerCase();
        if (semantic[token] === candidate ||
          (context.provider !== "generic" && ["region", "country", "preferredName", "pronouns", "fullAddress"].includes(candidate))) profileKey = candidate;
      }
      // A telephone's country code is not the applicant's address country.
      if (candidate === "country" && /phone|telephone/i.test(group || "")) profileKey = "phoneCountry";
      if (context.provider === "greenhouse" && field.id === "candidate-location" && candidate === "city") profileKey = "city";
      if (rippling && normalized === "location" && field instanceof HTMLInputElement &&
        field.getAttribute("data-testid") === "input-undefined" &&
        field.getAttribute("aria-labelledby") === `${field.id}-label` &&
        field.getAttribute("aria-autocomplete") === "list" && field.getAttribute("aria-haspopup") === "listbox") profileKey = "city";
      let inferred = meaning(label);
      if (normalized === "keywords" && /\b(?:eg|e\.g\.|such as)\s*:?\s*(?:your )?skills\b/i.test(field.getAttribute("placeholder") || "")) inferred = "skills";
      // intl-tel-input exposes a separate country button. Its country belongs
      // to the adjacent telephone, never the applicant's residence.
      const telephone = field.matches('button[aria-haspopup="listbox"]') && field.closest('.iti');
      if (telephone && telephone.querySelectorAll('input[type="tel"]').length === 1 &&
          telephone.querySelectorAll('button[aria-haspopup="listbox"]').length === 1 &&
          /^selected country$/i.test(label)) inferred = "phoneCountry";
      if (/^country code$/i.test(normalized) && /country code picker/i.test(field.getAttribute("aria-label") || "")) inferred = "phoneCountry";
      if (phoneGroup(field)) inferred = "phoneCountry";
      // Choice labels describe options, not applicant facts (e.g. LinkedIn as
      // a referral source). Their question is resolved by the group scanner.
      if (["checkbox", "radio"].includes(field.type) || field.matches(choiceSelector)) {
        inferred = undefined; profileKey = undefined; key = undefined;
      }
      const foreign = /\b(?:references?|referral|referrer|referred|emergency|supervisor|manager|employment|work experience|career history|education|billing|shipping)\b/i;
      let foreignContext = Boolean(inferred && foreign.test(label));
      let declaration = /signature|attestation/i.test(`${field.id} ${field.name || ""}`);
      for (let node = field.parentElement; node && node !== forms[0]; node = node.parentElement) {
        const heading = node.querySelector(':scope > legend,:scope > h2,:scope > h3,:scope > h4,:scope > header h3') ||
          [...node.children].filter(child => !child.querySelector('input,textarea,select,button,a,[role="combobox"]'))
            .flatMap(child => [...child.querySelectorAll('h2,h3,h4,[role="heading"],p')].filter(title => {
              let parent = title, depth = 0;
              while (parent && parent !== child && depth < 3) { parent = parent.parentElement; depth++; }
              return parent === child && /^(?:experience|work (?:experience|history)|employment(?: history)?|career history|education(?: history)?)\s*[*:]?$/i.test(title.textContent.trim());
            }))[0];
        // A paragraph can be a short section label, but a question mentioning
        // employment is not evidence that its controls belong to a past job.
        const paragraph = [...node.querySelectorAll(':scope > p,:scope > div > p,:scope > header > p')].find(p =>
          (p.parentElement === node || !p.parentElement.querySelector('input,textarea,select,button,a,[role="combobox"]')) &&
          /^(?:experience|work experience|employment(?: history)?|career history|education(?: history)?|references?|emergency contact|supervisor|manager|billing|shipping|signature|attestation)\s*[*:]?$/i.test(p.textContent.trim()));
        if (node.matches('fieldset,section,[role="group"],[role="region"],careers-ui-experience-form-control') || heading || paragraph) {
          const title = accessibleName(node) || (heading || paragraph)?.textContent || "";
          const eligibilityTitle = /\b(?:work (?:authorization|eligibility)|employment (?:eligibility|visa|authorization))\b/i.test(title);
          const disclosureTitle = /\bequal employment opportunit(?:y|ies)\b/i.test(title) &&
            !/\b(?:references?|emergency|supervisor|work experience|employment history)\b/i.test(title);
          // An application title can contain Manager, Education or Employment.
          // It describes the job, not whose contact details the fields request.
          const applicationTitle = /^(?:job application|application(?: for)?|apply(?:ing)? (?:for|to))\s*[:\u2013\u2014-]\s*\S/i.test(title.trim()) &&
            fields.every(control => node.contains(control));
          if ((foreign.test(title) && !eligibilityTitle && !disclosureTitle && !applicationTitle) || /^experience\s*[*:]?$/i.test(title.trim()) || node.matches('careers-ui-experience-form-control')) foreignContext = true;
          if (inferred && /disabilit|voluntary self.identification|attestation|declaration|acknowledg|signature|certification/i.test(title)) declaration = true;
        }
      }
      const autoTokens = (field.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
      const declared = semantic[autoTokens.at(-1)];
      const conflict = declared && inferred && declared !== inferred && !(inferred === "fullAddress" && declared === "streetAddress");
      if (declaration || foreignContext || conflict || autoTokens.some(token => foreign.test(token))) { profileKey = undefined; key = undefined; }
      else if (!profileKey && inferred) profileKey = inferred;
      if (key === "skills") key = undefined;
      if (
        readonlyTrigger(field) || menuSelectRoot(field) || field.matches(
          '[role="combobox"], [aria-autocomplete], [list], button[aria-haspopup="listbox"]',
        )
      )
        key = undefined;
      return { field, label, key, profileKey, selectTrigger: readonlyTrigger(field), menuSelectRoot: menuSelectRoot(field), phoneGroup: phoneGroup(field), identityLabel: Boolean(inferred), inHistory: foreignContext,
        manualReason: declaration ? "Review this declaration on the employer form." : undefined };
    };
    const entryFor = field => {
      const choice = buttonChoices.get(field);
      if (!choice) return [contactEntry(field)];
      if (choice.mirror || choice.choiceFields[0] !== field) return [];
      return [{ ...contactEntry(field), ...choice, originalLabel: labelFor(field) }];
    };
    const entries = fields.flatMap(entryFor);
    const isContactField = ({ field, key }) =>
      key &&
      !field.matches('[role="combobox"], [aria-autocomplete], [list]') &&
      ((field instanceof HTMLInputElement &&
        ["text", "email", "tel", "url"].includes(field.type)) ||
        (field instanceof HTMLTextAreaElement && key === "streetAddress"));
    const contactFields = entries.filter(isContactField);
    const currentContactFields = () =>
      [...forms[0].querySelectorAll(controlSelector)]
        .filter(field => field.isConnected && visible(field) &&
          !field.matches(':disabled, [aria-disabled="true"]') && !field.readOnly)
        .map(contactEntry)
        .filter(isContactField);
    const valuePrototype = field =>
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const questions = [
      ...new Set(
        entries
          .filter(
            ({ key, field, choiceFields, menuSelectRoot }) =>
              !key &&
              (choiceFields || menuSelectRoot || field.type !== "button" ||
                field.matches(
                  '[role="combobox"], [aria-haspopup="listbox"]',
                )) &&
              (choiceFields || !["submit", "hidden", "password", "file", "reset"].includes(
                field.type,
              )),
          )
          .map(({ field, label }) => {
            const group = field
              .closest("fieldset")
              ?.querySelector("legend")
              ?.textContent?.trim();
            return ["radio", "checkbox"].includes(field.type)
              ? field
                  .closest(".application-question")
                  ?.querySelector(".application-label")
                  ?.textContent?.trim() ||
                  field
                    .closest(".ashby-application-form-field-entry")
                    ?.querySelector(".ashby-application-form-question-title")
                    ?.textContent?.trim() ||
                  field
                    .closest("fieldset")
                    ?.querySelector("legend")
                    ?.textContent?.trim() ||
                  label
              : group && label && !normalize(label).includes(normalize(group))
                ? `${group}: ${label}`
                : label;
          })
          .filter((label) => label && label.length <= 500),
      ),
    ];
    const aiRestricted = [...forms[0].querySelectorAll('label,legend,p')].some(node =>
      /(?:ai|artificial intelligence|chatgpt)[- ]?(?:generated|written)?[\s\S]{0,180}(?:disqualif|not (?:permitted|allowed)|prohibited)|(?:do not|must not|cannot|may not) use[\s\S]{0,100}(?:artificial intelligence|chatgpt|\bAI\b)/i.test(node.textContent || ""));
    const result = {
      aiRestricted,
      employmentCountry,
      url: location.href,
      title: (
        (context.provider === "workday" &&
          document.querySelector('[data-automation-id="jobTitleHeading"]')
            ?.textContent) ||
        document.querySelector("h1, .posting-headline h2, careers-ui-job-ad-section h3")?.textContent ||
        document.title
      )
        .trim()
        .slice(0, 180),
      questions: questions.slice(0, 40),
      truncated: questions.length > 40,
      filled: 0,
      preserved: 0,
      missing: 0,
      missingFields: [],
      review: questions.length,
      resumeAvailable,
      resumeDetected: resumeCandidates.length > 0 || manualResume,
      resumeStatus: resumeOutcome?.state || (existingResume ? 'existing' : resumeAvailable ? 'available' : manualResume ? 'manual' : undefined),
      resumeMessage: resumeOutcome?.message || (existingResume ? 'Existing resume kept unchanged.' : manualResume
        ? 'The resume picker is ambiguous, disabled, or unavailable. Attach your resume on the form.' : undefined),
      manualResume,
      undoAvailable: undoEntries.some(
        (entry) =>
          !entry.edited &&
          entry.form === forms[0] &&
          entry.field.isConnected &&
          entry.field.value === entry.value &&
          contactFields.some(
            ({ field, key }) => field === entry.field && key === entry.key,
          ) &&
          contactFields.filter(({ key }) => key === entry.key).length === 1,
      ),
      available: contactFields.filter(
        ({ field, key }) =>
          !field.value.trim() &&
          contactFields.filter((entry) => entry.key === key).length === 1,
      ).length,
    };
    if (history) {
      const historyResult = await history(
        mode,
        contact,
        forms[0],
        labelFor,
        visible,
      );
      if (["fill-history", "undo-history"].includes(mode)) return historyResult;
      Object.assign(result, historyResult);
    }
    if (autofill) {
      let details = await autofill(mode, contact, entries, forms[0], labelFor, visible);
      if (details.error) return details;
      if (mode === "autofill") {
        let known = new Set(entries.map(entry => entry.field));
        // Country/region and conditional controls may become enabled only
        // after a prior selection. Rescan boundedly, preserving every old value.
        for (let pass = 0; pass < 3; pass++) {
          await new Promise(resolve => setTimeout(resolve, 150));
          if (location.href !== expectedUrl || !forms[0].isConnected) break;
          const next = [...forms[0].querySelectorAll(controlSelector)].filter(field => visible(field) &&
            !field.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]') &&
            (!field.readOnly || field.matches('[role="combobox"][aria-haspopup="listbox"]') || readonlyTrigger(field))).flatMap(entryFor);
          if (!next.some(entry => !known.has(entry.field))) break;
          known = new Set(next.map(entry => entry.field));
          details = await autofill(mode, contact, next, forms[0], labelFor, visible);
          if (details.error) break;
        }
      }
      Object.assign(result, details);
      if (aiRestricted && result.fields) result.fields = result.fields.map(field => ({ ...field, aiRestricted: true }));
      if (mode === "autofill-context") {
        // Send only the posting text, never applicant answers, and only when the
        // user requests Autofill or an AI draft. Never read a surrounding frame.
        const description = context.provider === "greenhouse"
          ? document.querySelector('.job__description, #content .content, .job-post-container .content')
          : document.querySelector('[itemprop="description"], [data-testid="job-description"], .job-description, .posting-description');
        result.jobDescription = description && !description.querySelector('input,textarea,select,[contenteditable="true"]') && !description.contains(forms[0]) && !forms[0].contains(description)
          ? description.innerText.slice(0, 8000) : typeof posting?.description === "string" ? new DOMParser().parseFromString(posting.description, "text/html").body.textContent.slice(0, 8000) : "";
      }
      if (mode === "autofill" && history) {
        result.historyFilled = 0;
        result.historySaved = 0;
        result.historyDateAdjusted = 0;
        result.historyNeedsReview = 0;
        result.historyWarnings = [];
        const candidates = (contact.history || []).slice(0, 20);
        const normalizeHistory = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        const historyIdentity = row => {
          const entry = row.entry || {}, degree = normalizeHistory(entry.degree);
          const level = /^master|^(?:meng|msc|ms|ma|mba)$/.test(degree) ? "master" : /^bachelor|^(?:bsc|bs|ba|beng|bba|bcs)$/.test(degree) ? "bachelor" : degree;
          return row.kind === "education" ? JSON.stringify([row.kind, normalizeHistory(entry.school), level, normalizeHistory(entry.fieldOfStudy), entry.dates?.start?.slice(0, 4)]) :
            JSON.stringify([row.kind, normalizeHistory(entry.company), normalizeHistory(entry.title), entry.dates?.start]);
        };
        const conflictingDates = (a, b) => ["start", "end"].some(key => a?.[key] && b?.[key] && !a[key].startsWith(b[key]) && !b[key].startsWith(a[key])) ||
          (typeof a?.current === "boolean" && typeof b?.current === "boolean" && a.current !== b.current);
        const conflicts = new Set(candidates.filter(row => candidates.some(other => row !== other &&
          historyIdentity(row) === historyIdentity(other) && conflictingDates(row.entry?.dates, other.entry?.dates))).map(historyIdentity));
        for (const entry of candidates) {
          if (location.href !== expectedUrl || !forms[0].isConnected) break;
          if (conflicts.has(historyIdentity(entry))) {
            result.historyNeedsReview++;
            const warning = "Conflicting dates exist for the same profile history record. Resolve them in Profile before filling this record.";
            if (!result.historyWarnings.includes(warning)) result.historyWarnings.push(warning);
            continue;
          }
          const filled = await history("fill-history", { ...entry, automatic: true, reconcilePrefilled: contact.reconcilePrefilled === true, peers: candidates }, forms[0], labelFor, visible);
          result.historyFilled += filled.filled || 0;
          result.historyUpdated = (result.historyUpdated || 0) + (filled.updated || 0);
          result.historySaved += filled.saved || 0;
          result.historyDateAdjusted += filled.dateAdjusted || 0;
          result.historyNeedsReview += filled.skipped || 0;
          const warning = filled.warning || filled.error;
          if (warning && !result.historyWarnings.includes(warning)) result.historyWarnings.push(warning);
        }
        Object.assign(result, await history("inspect", {}, forms[0], labelFor, visible));
        const refreshed = [...forms[0].querySelectorAll(controlSelector)].filter(field => visible(field) && !field.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]') &&
          (!field.readOnly || field.matches('[role="combobox"][aria-haspopup="listbox"]') || readonlyTrigger(field))).flatMap(entryFor);
        Object.assign(result, await autofill("inspect", {}, refreshed, forms[0], labelFor, visible));
        if (aiRestricted && result.fields) result.fields = result.fields.map(field => ({ ...field, aiRestricted: true }));
      }
      if (mode.startsWith("autofill")) return result;
    }
    if (mode === "undo") {
      const restored = [];
      let kept = 0;
      for (const entry of undoEntries) {
        if (expectedUrl && location.href !== expectedUrl) break;
        const currentFields = currentContactFields();
        const sameField = currentFields.some(
          ({ field, key }) => field === entry.field && key === entry.key,
        );
        if (
          entry.edited ||
          !sameField ||
          entry.form !== forms[0] ||
          currentFields.filter(({ key }) => key === entry.key).length !== 1 ||
          entry.field.value !== entry.value
        ) {
          kept++;
          continue;
        }
        Object.getOwnPropertyDescriptor(
          valuePrototype(entry.field),
          "value",
        ).set.call(entry.field, entry.before);
        entry.field.dispatchEvent(new Event("input", { bubbles: true }));
        entry.field.dispatchEvent(new Event("change", { bubbles: true }));
        restored.push(entry);
      }
      clearUndo();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const undone = restored.filter(
        ({ field, before }) => field.isConnected && field.value === before,
      ).length;
      return {
        ...result,
        undoAvailable: false,
        undone,
        kept,
        unverified: restored.length - undone,
      };
    }
    if (mode === "prepare-resume") {
      if (!resumeAvailable)
        return {
          error:
            "No unambiguous empty resume field found. Attach your resume manually.",
        };
      resumeTarget = {
        field: resumeInput,
        widget: resumeWidget,
        form: forms[0],
        url: location.href,
        token: crypto.randomUUID(),
        expires: Date.now() + 10 * 60_000,
      };
      return { ...result, resumeToken: resumeTarget.token };
    }
    if (mode === "attach-resume" || mode === "check-resume") {
      const target = resumeTarget;
      if (
        !target ||
        target.expires <= Date.now() ||
        target.token !== contact.resumeToken ||
        target.url !== location.href ||
        target.field !== resumeInput ||
        target.widget !== resumeWidget ||
        target.form !== forms[0] ||
        !resumeAvailable
      )
        return {
          error:
            "The resume field changed or already contains a file. Nothing attached; review it manually.",
        };
      if (mode === "check-resume") return result;
      resumeTarget = undefined;
      const types = {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          ".docx",
      };
      const extension = types[contact.mimeType];
      if (
        !extension ||
        typeof contact.name !== "string" ||
        !contact.name.toLowerCase().endsWith(extension) ||
        !Number.isInteger(contact.size) ||
        contact.size < 1 ||
        contact.size > 5 * 1024 * 1024 ||
        typeof contact.base64 !== "string" ||
        contact.base64.length > 6990508
      )
        return { error: "Resume file is not supported. Attach it manually." };
      const accepts = resumeInput.accept
        .toLowerCase()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (
        accepts.length &&
        !accepts.some(
          (item) =>
            item === extension ||
            item === contact.mimeType ||
            item === "application/*" ||
            item === "*/*",
        )
      )
        return {
          error:
            "This resume format is not accepted by the employer. Choose another file.",
        };
      let binary;
      try { binary = atob(contact.base64); }
      catch { return { error: 'Resume download was incomplete. Try again.' }; }
      if (binary.length !== contact.size)
        return { error: "Resume download was incomplete. Try again." };
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const data = new DataTransfer();
      const file = new File([bytes], contact.name, { type: contact.mimeType });
      data.items.add(file);
      attemptedResumes.add(resumeInput);
      const attempt = { name: file.name, size: file.size, url: target.url };
      resumeAttempts.set(resumeWidget, attempt);
      formResumeAttempts.set(forms[0], attempt);
      resumeInput.files = data.files;
      resumeInput.dispatchEvent(new Event("input", { bubbles: true }));
      resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      let outcome = uploadOutcome(resumeInput, resumeWidget, attempt);
      const uploadDeadline = Date.now() + 3000;
      while (['pending', 'unverified'].includes(outcome.state) && Date.now() < uploadDeadline &&
          location.href === target.url && resumeWidget.isConnected) {
        await new Promise(resolve => setTimeout(resolve, 150));
        outcome = uploadOutcome(resumeWidget.querySelector('input[type="file"]') || resumeInput, resumeWidget, attempt);
      }
      if (rippling && autofill) {
        // Rippling imports contact details asynchronously after resume upload.
        // Keep this bounded; a late employer update still needs user review.
        const until = Date.now() + 5000;
        while (Date.now() < until && location.href === target.url && forms[0].isConnected)
          await new Promise(resolve => setTimeout(resolve, 100));
        if (location.href === target.url && forms[0].isConnected)
          await autofill("autofill-reconcile-resume", {}, entries, forms[0], labelFor, visible);
      }
      outcome = uploadOutcome(resumeWidget.querySelector('input[type="file"]') || resumeInput, resumeWidget, attempt);
      return {
        ...result,
        resumeAvailable: false,
        resumeParserReview: rippling,
        resumeStatus: outcome.state,
        resumeMessage: outcome.message,
        resumeSelected: ['selected', 'attached'].includes(outcome.state),
      };
    }
    if (mode !== "fill") return result;
    if (!contactFields.length)
      return {
        error: "No supported contact fields found. Fill this form manually.",
      };
    const changed = [];
    for (const { field, key } of contactFields) {
      if (expectedUrl && location.href !== expectedUrl)
        return {
          error:
            "The page changed. Review the current form before filling again.",
        };
      const currentFields = currentContactFields();
      if (
        !forms[0].isConnected ||
        !currentFields.some(entry => entry.field === field && entry.key === key) ||
        currentFields.filter(entry => entry.key === key).length !== 1
      ) {
        result.missing++;
        continue;
      }
      if (field.value.trim()) {
        result.preserved++;
        continue;
      }
      // Ambiguous repeated fields and unconfirmed profile values are not guessed.
      if (
        typeof contact[key] !== "string" ||
        !contact[key].trim()
      ) {
        result.missing++;
        result.missingFields.push(key);
        continue;
      }
      const value = contact[key];
      if (
        (field.maxLength > 0 && value.length > field.maxLength) ||
        !visible(field)
      ) {
        result.missing++;
        continue;
      }
      const entry = {
        field,
        key,
        value,
        before: field.value,
        form: forms[0],
        edited: false,
      };
      entry.onEdit = (event) => {
        if (event.isTrusted) entry.edited = true;
      };
      undoEntries = undoEntries.filter((previous) => {
        if (previous.field !== field && previous.field.isConnected) return true;
        previous.field.removeEventListener("input", previous.onEdit);
        previous.field.removeEventListener("change", previous.onEdit);
        return false;
      });
      if (undoEntries.length >= 20) clearUndo();
      field.addEventListener("input", entry.onEdit);
      field.addEventListener("change", entry.onEdit);
      undoEntries.push(entry);
      undoUrl = location.href;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(clearUndo, 10 * 60_000);
      Object.getOwnPropertyDescriptor(
        valuePrototype(field),
        "value",
      ).set.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      changed.push({ field, value });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const { field, value } of changed) {
      if (field.isConnected && field.value === value && field.validity.valid)
        result.filled++;
      else result.missing++;
    }
    result.undoAvailable = undoEntries.some(
      ({ field, value, edited }) =>
        !edited && field.isConnected && field.value === value,
    );
    return result;
  };
}

export const inspectApplication = createInspector(
  applicationContext,
  createHistoryInspector(),
  createAutofillInspector(),
);
