import { applicationContext } from "./sites.mjs";
import { createHistoryInspector } from "./history.mjs";
import { createAutofillInspector } from "./autofill.mjs";

// The build serializes this factory and the shared URL resolver into an isolated
// world. No remote code, page globals, or page-provided messages are evaluated.
export function createInspector(resolveContext, history, autofill) {
  let resumeTarget;
  const attemptedResumes = new WeakSet();
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
      "address line 2": "addressLine2",
      "address 2": "addressLine2",
      city: "city",
      "city/town": "city",
      "postal code": "postalCode",
      province: "region",
      state: "region",
      "state/province": "region",
      "province or state": "region",
      country: "country",
      "country/region": "country",
      "preferred name": "preferredName",
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
    };
    const normalize = (value) =>
      value
        .replace(/[*\u2731\u2217]|\(required\)|\(optional\)/gi, "")
        .replace(/:$/, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    const visible = (element) =>
      !!element.getClientRects().length &&
      !element.closest("[hidden], [inert], [aria-hidden='true']") &&
      getComputedStyle(element).visibility !== "hidden" &&
      getComputedStyle(element).display !== "none";
    const valueControls =
      'input, textarea, select, button, [role="combobox"], [role="listbox"], [role="option"]';
    const labelFor = (element) => {
      const label = element.labels?.[0]?.cloneNode(true);
      label
        ?.querySelectorAll(valueControls)
        .forEach((control) => control.remove());
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
      return (
        label?.textContent ||
        labelledBy ||
        element.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ");
    };
    const controlSelector =
      'input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"]';
    const flexible = ["generic", "workday", "icims", "workable"].includes(
      context.provider,
    );
    const applicationHeading =
      /\b(application|apply|my information|my experience)\b/i.test(
        [
          ...document.querySelectorAll(
            "h1,h2,h3,[data-automation-id='pageHeaderTitle']",
          ),
        ]
          .map((node) => node.textContent)
          .join(" "),
      );
    if (document.querySelectorAll(controlSelector).length > 500)
      return {
        error: "This form is too large to inspect safely. Use manual entry.",
      };
    const forms = [
      ...document.querySelectorAll(
        context.provider === "ashby"
          ? ".ashby-application-form-container"
          : context.provider === "workable"
            ? 'form[data-ui="application-form"]'
            : context.provider === "workday"
              ? 'form, [data-automation-id="applyFlowPage"]'
              : "form",
      ),
    ]
      .filter(
        (form) =>
          visible(form) &&
          (!flexible || !form.querySelector('input[type="password"]')) &&
          ([...form.querySelectorAll("input")].some(
            (field) => aliases[normalize(labelFor(field))] === "email",
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
            applicationHeading ||
            form.querySelector('input[type="file"][accept*="pdf"]')),
      )
      .filter(
        (form, _, all) =>
          !all.some((other) => other !== form && form.contains(other)),
      );
    if (forms.length !== 1)
      return {
        error:
          "A single application form was not found. Embedded or multi-form pages need manual review.",
      };
    const fields = [...forms[0].querySelectorAll(controlSelector)].filter(
      (field) =>
        visible(field) &&
        !field.matches(':disabled, [aria-disabled="true"]') &&
        !field.readOnly,
    );
    const resumeInputs = [
      ...forms[0].querySelectorAll('input[type="file"]'),
    ].filter((field) => {
      // Workable has separate resume/import/photo widgets. Keep file uploads
      // manual until the complete upload lifecycle is verified.
      if (context.provider === "workable") return false;
      if (
        [...document.querySelectorAll("input")].filter(
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
        if (!token || standard[token] !== key) key = undefined;
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
      const candidate = aliases[normalized];
      if (!profileKey && candidate && !/reference|referr|emergency|supervisor|employ|education/i.test(group || "")) {
        const token = (field.getAttribute("autocomplete") || "").trim().toLowerCase();
        if (semantic[token] === candidate ||
          (context.provider !== "generic" && ["region", "country", "preferredName", "pronouns"].includes(candidate))) profileKey = candidate;
      }
      // A telephone's country code is not the applicant's address country.
      if (candidate === "country" && /phone|telephone/i.test(group || "")) profileKey = undefined;
      if (
        field.matches(
          '[role="combobox"], [aria-autocomplete], [list], button[aria-haspopup="listbox"]',
        )
      )
        key = undefined;
      return { field, label, key, profileKey, identityLabel: Boolean(aliases[normalized]) };
    };
    const entries = fields.map(contactEntry);
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
    const result = {
      url: location.href,
      title: (
        (context.provider === "workday" &&
          document.querySelector('[data-automation-id="jobTitleHeading"]')
            ?.textContent) ||
        document.querySelector("h1, .posting-headline h2")?.textContent ||
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
      const details = await autofill(mode, contact, entries, forms[0], labelFor, visible);
      if (details.error) return details;
      Object.assign(result, details);
      if (mode === "autofill" && history) {
        result.historyFilled = 0;
        result.historyNeedsReview = 0;
        for (const entry of (contact.history || []).slice(0, 20)) {
          if (location.href !== expectedUrl || !forms[0].isConnected) break;
          const filled = await history("fill-history", { ...entry, automatic: true }, forms[0], labelFor, visible);
          result.historyFilled += filled.filled || 0;
          result.historyNeedsReview += filled.skipped || 0;
        }
        Object.assign(result, await history("inspect", {}, forms[0], labelFor, visible));
        Object.assign(result, await autofill("inspect", {}, entries, forms[0], labelFor, visible));
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
      const selected = resumeInput.files?.[0];
      return {
        ...result,
        resumeAvailable: false,
        resumeSelected:
          resumeInput.isConnected &&
          location.href === target.url &&
          selected?.name === file.name &&
          selected?.size === file.size &&
          resumeInput.validity.valid,
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
