import { applicationContext } from "./sites.mjs";
import { createHistoryInspector } from "./history.mjs";
import { createAutofillInspector } from "./autofill.mjs";
import { createFormDetection } from "./form-detection.mjs";
import { createJobContext } from "./job-context.mjs";
import { createFieldValidity } from "./field-validity.mjs";
import { createFieldSemantics } from "./field-semantics.mjs";

// The build serializes this factory and the shared URL resolver into an isolated
// world. No remote code, page globals, or page-provided messages are evaluated.
export function createInspector(resolveContext, history, autofill) {
  return createInspectorRuntime(resolveContext, history, autofill, createFormDetection(), createJobContext(), createFieldValidity(), createFieldSemantics());
}

// Existing build/test callers serialize createInspector. Keep that public
// contract self-contained without runtime imports or page-provided code.
createInspector.toString = () => `(function(resolveContext, history, autofill) {
  return (${createInspectorRuntime})(resolveContext, history, autofill, (${createFormDetection})(), (${createJobContext})(), (${createFieldValidity})(), (${createFieldSemantics})());
})`;

function createInspectorRuntime(resolveContext, history, autofill, detection, jobContext, fieldValid, semantics) {
  let resumeTarget;
  const attemptedResumes = new WeakSet();
  const manualChoiceIds = new WeakMap();
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
          "Open an application form. Sign-in pages and sensitive links need manual entry.",
      };
    if (expectedUrl && location.href !== expectedUrl)
      return { error: "The page changed. Open the extension again." };
    const rippling = context.provider === "generic" && location.hostname === "ats.rippling.com" &&
      /^\/[a-z0-9_-]+\/jobs\/[a-f0-9-]{36}\/apply\/?$/i.test(location.pathname);
    const hibob = /\.careers\.hibob\.com$/.test(location.hostname) &&
      /^\/jobs\/[a-f0-9-]{36}\/apply\/?$/i.test(location.pathname);
    const dom = detection.scan(document);
    if (dom.oversized) return { error: "This page is too large to inspect safely. Use manual entry." };
    const aliases = {
      "first name": "givenName",
      "given name": "givenName",
      "last name": "familyName",
      "family name": "familyName",
      surname: "familyName",
      "full name": "fullName",
      name: "fullName",
      email: "email",
      "email address": "email",
      "e-mail": "email",
      "e-mail address": "email",
      phone: "phone",
      "phone number": "phone",
      "mobile phone": "phone",
      "mobile phone number": "phone",
      telephone: "phone",
      "address line 1": "streetAddress",
      "street address": "streetAddress",
      "address 1": "streetAddress",
      address: "fullAddress",
      "full address": "fullAddress",
      "home address": "fullAddress",
      "address line 2": "addressLine2",
      "address 2": "addressLine2",
      city: "city",
      "current location": "city",
      "city/town": "city",
      "location (city)": "city",
      "postal code": "postalCode",
      province: "region",
      state: "region",
      "state/province": "region",
      "province or state": "region",
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
      "portfolio url": "portfolioUrl",
      skills: "skills",
      "technical skills": "skills",
      "current company": "currentCompany",
      "current employer": "currentCompany",
      "company you currently work for": "currentCompany",
      "current job title": "currentTitle",
      "phone country": "phoneCountry",
      "phone country code": "phoneCountry",
      "telephone country code": "phoneCountry",
      "country calling code": "phoneCountry",
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
      const text = normalize(label).replace(/[?]$/, "").trim()
        .replace(/^(?:please\s+)?(?:enter|provide|share|paste)\s+(?:a\s+)?/, "")
        .replace(/^(?:what is|what's)\s+/, "")
        .replace(/^(?:a link to\s+|link to\s+)?(?:your|applicant|candidate)\s+/, "");
      if (Object.hasOwn(aliases, text)) return aliases[text];
      const intent = semantics.resolve(label);
      if (intent) return intent.key;
      const link = detection.profileLink(text);
      if (link) return link;
      const rules = [
        ["givenName", /^(?:legal )?(?:first|given) name(?:\(s\)|s)?$/],
        ["familyName", /^(?:legal )?(?:last|family) name(?:\(s\)|s)?$/],
        ["fullName", /^(?:legal|complete|first and last) (?:full )?name$/],
        ["email", /^(?:personal|preferred|contact) e[- ]?mail(?: address)?$/],
        ["phone", /^(?:contact|mobile|cell|cellphone|telephone|primary phone)(?: number)?$/],
        ["linkedInUrl", /^(?:link to (?:your )?)?linked[ -]?in(?: (?:profile|public profile))?(?: (?:url|link|address))?$/],
        ["githubUrl", /^github(?: profile)?(?: (?:url|link|address))?$/],
        ["portfolioUrl", /^(?:personal )?(?:portfolio|website)(?: (?:url|link|address))?$/],
        ["region", /^(?:state|province)(?:\s*[/,]\s*(?:state|province|region)){1,2}$/],
        ["region", /(?:^|[.!]\s*)(?:in )?which (?:us |u\.s\. |canadian )?(?:state|province) do you (?:reside|live)(?: in)?\??$|^(?:state|province) of residence$/],
        ["city", /^(?:current |home )?city(?: of residence)?$|^city\s*\/\s*town$|^location\s*\(city\)$/],
        ["country", /^(?:current |home )?country(?: of residence)?$/],
        ["postalCode", /^(?:zip|postal)(?:\s*\/\s*(?:zip|postal))?(?: code)?$/],
        ["streetAddress", /^(?:home |mailing )?street address(?: line 1)?$/],
        ["addressLine2", /^(?:apartment|apt|unit)(?:\s*(?:\/|or)\s*(?:apartment|unit|suite))?(?: number)?$/],
      ];
      return rules.find(([, pattern]) => pattern.test(text))?.[0];
    };
    const visible = detection.visible;
    const labelFor = (element) => {
      // Observed Rippling phone-code widget (2026-09-28): unlike its pronouns
      // picker, the country combobox has only aria-label="Search". Require both
      // the purpose-specific wrapper and control identifiers, never Search alone.
      const phoneCode = rippling && element.closest('[data-testid="phone_number-code"]');
      if (phoneCode && element.matches('input[role="combobox"][data-input="select-search-input"][data-testid="input-select-search-input"][aria-haspopup="listbox"]') &&
          element.getAttribute("aria-label") === "Search" && !element.hasAttribute("aria-labelledby") &&
          phoneCode.querySelectorAll('input').length === 1) return "Phone country";
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
      return detection.labelFor(element, meaning);
    };
    const applicationControl = field => !field.closest('[role="listbox"],[role="tree"],[role="menu"]') &&
      !/^(?:search|filter)(?:\s+(?:options?|countries|locations?|results))?\s*[:*]?$/i.test(labelFor(field));
    const controlSelector =
      'input, textarea, select, [role="textbox"][contenteditable]:not([contenteditable="false"]), [role="combobox"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup][aria-labelledby]';
    const allControlSelector = `${controlSelector},[role="radio"],[role="checkbox"],[role="switch"],button[aria-pressed]`;
    const flexible = ["generic", "workday", "icims", "workable"].includes(
      context.provider,
    );
    const applicationHeading =
      /\b(application|apply|my information|my experience)\b/i.test(
        [
          ...dom.elements.filter(node => node.matches("h1,h2,h3,h4,[role='tab'][aria-selected='true'],[data-automation-id='pageHeaderTitle']") && visible(node)),
        ]
          .map((node) => detection.text(node))
          .join(" "),
      );
    if (dom.elements.filter(node => node.matches(allControlSelector)).length > 500)
      return {
        error: "This form is too large to inspect safely. Use manual entry.",
      };
    const forms = [
      ...dom.elements.filter(node => node.matches(
        hibob ? "careers-ui-job-ad-application-form" : context.provider === "ashby"
          ? ".ashby-application-form-container"
          : context.provider === "workable"
            ? 'form[data-ui="application-form"]'
            : context.provider === "workday"
              ? 'form, [data-automation-id="applyFlowPage"]'
              : 'form, [role="form"]',
      )),
    ]
      .filter(
        (form) =>
          context.provider === "generic" && !hibob
            ? detection.genericApplication(form, labelFor, meaning)
            :
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
              form.querySelector(
                'fieldset, [data-automation-id^="workExperience-"], [data-automation-id^="education-"]',
              ))) &&
          (!flexible ||
            context.provider === "workable" ||
            applicationHeading || hibob ||
            form.querySelector('input[type="file"][accept*="pdf"]')),
      )
      .filter(
        (form, _, all) =>
          !all.some((other) => other !== form && form.contains(other)),
      );
    // Provider containers are fast-path hints. Employer markup drift, custom
    // platforms and later steps all use the same evidence-based fallback.
    if (!forms.length) forms.push(...detection.discoverApplications(dom.elements, labelFor, meaning));
    if (forms.length !== 1)
      return {
        error: forms.length > 1
          ? "More than one application form was found. Open the application you want to fill on its own page."
          : "No application form was recognized on this step. If its fields are still loading, try Autofill again. Embedded forms may need site access.",
      };
    if (context.provider === "ashby") {
      const panel = forms[0].closest('[role="tabpanel"]');
      if (panel && visible(panel) && !panel.querySelector('form,[role="form"],input[type="password"]')) {
        const containers = [...panel.querySelectorAll('.ashby-application-form-container')];
        const primary = containers.filter(node => !node.closest('.ashby-survey-form-container'));
        const surveys = containers.filter(node => node.closest('.ashby-survey-form-container'));
        const unrelated = [...panel.querySelectorAll(allControlSelector)].some(node =>
          !containers.some(container => container.contains(node)) &&
          !node.matches('input[type="file"],input[type="hidden"],input[type="submit"]'));
        if (primary.length === 1 && primary[0] === forms[0] && surveys.length &&
            !unrelated && containers.every(node => node.closest('[role="tabpanel"]') === panel) &&
            surveys.every(node => panel.contains(node.closest('.ashby-survey-form-container')))) forms[0] = panel;
      }
    }
    // Native containment is a write-safety invariant in the history/autofill
    // engines. A whole form inside an open root is safe; split-root controls are
    // not. Do not monkey-patch DOM queries or traverse closed roots/other frames.
    if (dom.roots.some(root => root.host && forms[0].contains(root.host) &&
        root.querySelector(allControlSelector)))
      return { error: "This application has controls split across shadow roots. Use manual entry." };
    const { employmentCountry, employmentLocation } = jobContext.inspect(dom.elements, location.href, detection, forms[0]);
    const fields = [...forms[0].querySelectorAll(controlSelector)].filter(
      (field) =>
        visible(field) &&
        applicationControl(field) &&
        !field.matches(':disabled, [aria-disabled="true"]') &&
        !field.readOnly,
    );
    const resumeInputs = [
      ...forms[0].querySelectorAll('input[type="file"]'),
    ].filter((field) => {
      // Workable has separate resume/import/photo widgets. Keep file uploads
      // manual until the complete upload lifecycle is verified.
      if (context.provider === "workable") return false;
      if (rippling) {
        const widget = field.closest('label[data-testid="resume"]');
        const labels = (widget?.getAttribute("aria-labelledby") || "").split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || "");
        return field.getAttribute("data-testid") === "input-resume" &&
          forms[0].querySelectorAll('input[type="file"][data-testid="input-resume"]').length === 1 &&
          widget && visible(widget) && !field.disabled && !field.multiple &&
          !field.closest('[hidden],[inert],[aria-hidden="true"],[aria-busy="true"]') &&
          labels.some(label => /^(resume|r\u00e9sum\u00e9|resume\/cv|cv)$/.test(normalize(label)));
      }
      if (
        [...field.getRootNode().querySelectorAll("input")].filter(
          (item) => item.id === field.id,
        ).length !== 1
      )
        return false;
      if (
        field.matches(":disabled") ||
        field.multiple ||
        field.closest(
          '[hidden], [inert], [aria-hidden="true"], [aria-busy="true"]',
        )
      )
        return false;
      const label = normalize(labelFor(field));
      if (flexible)
        return /^(resume|resume\/cv|cv)$/.test(label) && visible(field);
      if (context.provider === "greenhouse")
        return (
          field.id === "resume" &&
          /^(attach|resume|resume\/cv|cv)$/.test(label) &&
          visible(field)
        );
      if (context.provider === "lever") {
        const widget = field.closest(".visible-resume-upload");
        return (
          field.name === "resume" &&
          field.id === "resume-upload-input" &&
          !!widget &&
          visible(widget) &&
          /resume|cv/i.test(
            widget.querySelector(".default-label")?.textContent || "",
          ) &&
          !widget.querySelector(".filename")?.textContent?.trim()
        );
      }
      return (
        field.id === "_systemfield_resume" &&
        /^(resume|resume\/cv|cv)$/.test(label) &&
        !field.closest(".ashby-application-form-autofill-input-root") &&
        visible(field.closest(".ashby-application-form-input-file") || field)
      );
    });
    const resumeInput = resumeInputs.length === 1 ? resumeInputs[0] : null;
    const resumeAvailable =
      !!resumeInput &&
      !resumeInput.files?.length &&
      !resumeInput.value &&
      !attemptedResumes.has(resumeInput);
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
      const groupContext = detection.groupContext(field, forms[0], label);
      const group = groupContext.title;
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
        const heading = section && forms[0].contains(section) ? detection.groupTitle(section) : "";
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
      const inferred = meaning(label);
      const intent = semantics.resolve(label);
      const foreign = /\b(?:references?|referral|referrer|referred|emergency|supervisor|manager|employment|work experience|career history|education|billing|shipping)\b/i;
      const currentEmployment = ["currentCompany", "currentTitle"].includes(inferred);
      const foreignContext = groupContext.unsafe || Boolean(inferred && !currentEmployment && foreign.test(label));
      const autoTokens = (field.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
      const declared = semantic[autoTokens.at(-1)];
      const conflict = declared && inferred && declared !== inferred && !(inferred === "fullAddress" && declared === "streetAddress");
      if (foreignContext || conflict || autoTokens.some(token => foreign.test(token))) { profileKey = undefined; key = undefined; }
      else if (!profileKey && inferred) profileKey = inferred;
      if (key === "skills") key = undefined;
      if (
        field.matches(
          '[role="combobox"], [aria-autocomplete], [list], button[aria-haspopup="listbox"]',
        )
      )
        key = undefined;
      return { field, label, key, profileKey, intent: intent?.key === profileKey ? intent : undefined,
        identityLabel: Boolean(inferred), inHistory: foreignContext };
    };
    const manualChoices = detection.manualChoices(forms[0], labelFor);
    const historyFields = history ? await history("history-fields", {}, forms[0], labelFor, visible) : [];
    for (const { field } of manualChoices) if (!manualChoiceIds.has(field)) manualChoiceIds.set(field, crypto.randomUUID());
    // Custom choices share the write engine, never their hidden native inputs.
    // A mixed visible-native/custom subgroup is still reported, but not writable.
    const entries = fields.filter(field => !manualChoices.some(choice => choice.field === field || choice.field.contains(field))).map(field => {
      const entry = contactEntry(field);
      const record = historyFields.find(item => item.field === field);
      return record ? { ...entry, key: undefined, profileKey: undefined, inHistory: true, historyKind: record.kind } : entry;
    });
    if (autofill) entries.push(...manualChoices.map(choice => ({ ...choice,
      inHistory: detection.groupContext(choice.field, forms[0], choice.label).unsafe,
      ...(choice.kind === "radio" ? { radioFields: choice.ariaChoice.fields } : {}),
    })));
    const isContactField = ({ field, key }) =>
      key &&
      !field.matches('[role="combobox"], [aria-autocomplete], [list]') &&
      ((field instanceof HTMLInputElement &&
        ["text", "email", "tel", "url"].includes(field.type)) ||
        (field instanceof HTMLTextAreaElement && key === "streetAddress"));
    const contactFields = entries.filter(isContactField);
    const currentContactFields = () =>
      [...forms[0].querySelectorAll(controlSelector)]
        .filter(field => field.isConnected && visible(field) && applicationControl(field) &&
          !field.matches(':disabled, [aria-disabled="true"]') && !field.readOnly)
        .map(contactEntry)
        .filter(isContactField);
    const valuePrototype = field =>
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const questions = [
      ...new Set([
        ...entries
          .filter(
            ({ key, field }) =>
              !key &&
              (field.type !== "button" ||
                field.matches(
                  '[role="combobox"], [aria-haspopup="listbox"]',
                )) &&
              !["submit", "hidden", "password", "file", "reset"].includes(
                field.type,
              ),
          )
          .map(({ field, label }) => {
            if (manualChoices.some(choice => choice.field === field)) return label;
            const group = detection.groupContext(field, forms[0], label).title;
            return ["radio", "checkbox"].includes(field.type)
              ? field
                  .closest(".application-question")
                  ?.querySelector(".application-label")
                  ?.textContent?.trim() ||
                  field
                    .closest(".ashby-application-form-field-entry")
                    ?.querySelector(".ashby-application-form-question-title")
                    ?.textContent?.trim() ||
                  group ||
                  label
              : group && label && !normalize(label).includes(normalize(group))
                ? `${group}: ${label}`
                : label;
          })
          .filter((label) => label && label.length <= 500),
        ...manualChoices.map(choice => choice.label),
      ]),
    ];
    const aiRestricted = [...forms[0].querySelectorAll('label,legend,p')].some(node =>
      /(?:ai|artificial intelligence|chatgpt)[- ]?(?:generated|written)?[\s\S]{0,180}(?:disqualif|not (?:permitted|allowed)|prohibited)|(?:do not|must not|cannot|may not) use[\s\S]{0,100}(?:artificial intelligence|chatgpt|\bAI\b)/i.test(node.textContent || ""));
    const result = {
      aiRestricted,
      employmentCountry,
      employmentLocation,
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
      resumeDetected: Boolean(resumeInput),
      manualResume: hibob && !resumeInput && [...forms[0].querySelectorAll('careers-ui-upload-document-control')]
        .some(widget => visible(widget) && /\b(resume|cv)\b/i.test(widget.textContent)),
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
    const addManualChoices = () => {
      if (!forms[0].isConnected || location.href !== result.url) return;
      const choices = detection.manualChoices(forms[0], labelFor).map(({ field, label, kind, options, required, state }) => {
        if (!manualChoiceIds.has(field)) manualChoiceIds.set(field, crypto.randomUUID());
        return { label, kind, options, required, state, id: manualChoiceIds.get(field), title: label,
          canAnswer: false, canRemember: false, retryable: false,
          reason: "This custom choice needs selection on the employer form. Nothing was selected automatically.",
          ...(aiRestricted ? { aiRestricted: true } : {}),
        };
      });
      if (choices.length) result.fields = [...(result.fields || []), ...choices];
    };
    const manualTarget = !autofill && manualChoices.find(choice => manualChoiceIds.get(choice.field) === contact.id && choice.label === contact.label);
    if (mode === "autofill-focus" && manualTarget) {
      manualTarget.field.scrollIntoView({ block: "center", behavior: "smooth" });
      manualTarget.focus?.focus({ preventScroll: true });
      // The write engine never owns these tokens. Refresh its regular fields
      // without sending it a custom-choice focus or answer action.
      mode = "inspect";
    }
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
      const details = await autofill(mode, contact, entries, forms[0], labelFor, visible);
      if (details.error) return details;
      Object.assign(result, details);
      if (aiRestricted && result.fields) result.fields = result.fields.map(field => ({ ...field, aiRestricted: true }));
      if (mode === "autofill-context") {
        // Send only the posting text, never applicant answers, and only when the
        // user requests Autofill or an AI draft. Never read a surrounding frame.
        const description = context.provider === "greenhouse"
          ? document.querySelector('.job__description, #content .content, .job-post-container .content')
          : document.querySelector('[itemprop="description"], [data-testid="job-description"], .job-description, .posting-description');
        result.jobDescription = description && !description.querySelector('input,textarea,select,[contenteditable="true"]') && !description.contains(forms[0]) && !forms[0].contains(description)
          ? description.innerText.slice(0, 8000) : "";
      }
      if (mode === "autofill" && history) {
        result.historyFilled = 0;
        result.historySaved = 0;
        result.historyDateAdjusted = 0;
        result.historyNeedsReview = 0;
        result.historyWarnings = [];
        for (const entry of (contact.history || []).slice(0, 20)) {
          if (location.href !== expectedUrl || !forms[0].isConnected) break;
          const filled = await history("fill-history", { ...entry, automatic: true }, forms[0], labelFor, visible);
          result.historyFilled += filled.filled || 0;
          result.historySaved += filled.saved || 0;
          result.historyDateAdjusted += filled.dateAdjusted || 0;
          result.historyNeedsReview += filled.skipped || 0;
          const warning = filled.warning || filled.error;
          if (warning && !result.historyWarnings.includes(warning)) result.historyWarnings.push(warning);
        }
        Object.assign(result, await history("inspect", {}, forms[0], labelFor, visible));
        Object.assign(result, await autofill("inspect", {}, entries, forms[0], labelFor, visible));
        if (aiRestricted && result.fields) result.fields = result.fields.map(field => ({ ...field, aiRestricted: true }));
      }
      if (mode.startsWith("autofill")) return result;
    }
    if (!autofill) addManualChoices();
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
      const binary = atob(contact.base64);
      if (binary.length !== contact.size)
        return { error: "Resume download was incomplete. Try again." };
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const data = new DataTransfer();
      const file = new File([bytes], contact.name, { type: contact.mimeType });
      data.items.add(file);
      attemptedResumes.add(resumeInput);
      resumeInput.files = data.files;
      resumeInput.dispatchEvent(new Event("input", { bubbles: true }));
      resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (rippling && autofill) {
        // Rippling imports contact details asynchronously after resume upload.
        // Keep this bounded; a late employer update still needs user review.
        const until = Date.now() + 5000;
        while (Date.now() < until && location.href === target.url && forms[0].isConnected)
          await new Promise(resolve => setTimeout(resolve, 100));
        if (location.href === target.url && forms[0].isConnected)
          await autofill("autofill-reconcile-resume", {}, entries, forms[0], labelFor, visible);
      }
      const selected = resumeInput.files?.[0];
      return {
        ...result,
        resumeAvailable: false,
        resumeParserReview: rippling,
        resumeSelected:
          resumeInput.isConnected &&
          location.href === target.url &&
          selected?.name === file.name &&
          selected?.size === file.size &&
          fieldValid(resumeInput),
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
      if (field.isConnected && field.value === value && fieldValid(field))
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
