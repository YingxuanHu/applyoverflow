import { applicationContext } from "./sites.mjs";

// The build serializes this factory and the shared URL resolver into an isolated
// world. No remote code, page globals, or page-provided messages are evaluated.
export function createInspector(resolveContext) {
  let resumeTarget;
  const attemptedResumes = new WeakSet();
  let undoEntries = [], undoUrl = "", undoTimer;
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
    const context = resolveContext(location.href);
    if (!context)
      return {
        error:
          "Open a supported Greenhouse, Lever or Ashby application form. Other sites need manual entry.",
      };
    if (expectedUrl && location.href !== expectedUrl)
      return { error: "The page changed. Open the extension again." };
    const aliases = {
      "first name": "givenName",
      "given name": "givenName",
      "last name": "familyName",
      "family name": "familyName",
      "full name": "fullName",
      email: "email",
      "email address": "email",
      phone: "phone",
      "phone number": "phone",
      "mobile phone": "phone",
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
    const labelFor = (element) => {
      const label = element.labels?.[0]?.cloneNode(true);
      label
        ?.querySelectorAll("input, textarea, select, button")
        .forEach((control) => control.remove());
      const labelledBy = (element.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() || "")
        .join(" ");
      return (
        label?.textContent ||
        labelledBy ||
        element.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ");
    };
    if (document.querySelectorAll("input, textarea, select").length > 500)
      return {
        error: "This form is too large to inspect safely. Use manual entry.",
      };
    const forms = [
      ...document.querySelectorAll(
        context.provider === "ashby"
          ? ".ashby-application-form-container"
          : "form",
      ),
    ].filter(
      (form) =>
        visible(form) &&
        [...form.querySelectorAll("input")].some(
          (field) => aliases[normalize(labelFor(field))] === "email",
        ),
    );
    if (forms.length !== 1)
      return {
        error:
          "A single application form was not found. Embedded or multi-form pages need manual review.",
      };
    const fields = [
      ...forms[0].querySelectorAll("input, textarea, select"),
    ].filter(
      (field) =>
        visible(field) && !field.matches(":disabled") && !field.readOnly,
    );
    const resumeInputs = [
      ...forms[0].querySelectorAll('input[type="file"]'),
    ].filter((field) => {
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
    const entries = fields.map((field) => {
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
      const group = field
        .closest("fieldset")
        ?.querySelector("legend")
        ?.textContent?.trim();
      if (
        group &&
        !/^(personal (information|details)|contact (information|details)|your (information|details))$/i.test(
          group,
        )
      )
        key = undefined;
      // A custom employer question labelled "Email" may concern a reference, not
      // the applicant. Identity fields must also match Greenhouse's standard IDs.
      if (
        context.provider === "greenhouse" &&
        key &&
        identityIds[key] &&
        field.id !== identityIds[key]
      )
        key = undefined;
      return { field, label, key };
    });
    const contactFields = entries.filter(
      ({ field, key }) =>
        key &&
        field instanceof HTMLInputElement &&
        !field.matches('[role="combobox"], [aria-autocomplete], [list]') &&
        ["text", "email", "tel", "url"].includes(field.type),
    );
    const questions = [
      ...new Set(
        entries
          .filter(
            ({ key, field }) =>
              !key &&
              ![
                "submit",
                "button",
                "hidden",
                "password",
                "file",
                "reset",
              ].includes(field.type),
          )
          .map(({ field, label }) => {
            const group = field.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
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
      review: questions.length,
      resumeAvailable,
      undoAvailable: undoEntries.some((entry) =>
        !entry.edited && entry.form === forms[0] && entry.field.isConnected && entry.field.value === entry.value &&
        contactFields.some(({ field, key }) => field === entry.field && key === entry.key) &&
        contactFields.filter(({ key }) => key === entry.key).length === 1,
      ),
      available: contactFields.filter(
        ({ field, key }) =>
          !field.value.trim() &&
          contactFields.filter((entry) => entry.key === key).length === 1,
      ).length,
    };
    if (mode === "undo") {
      const restored = [];
      let kept = 0;
      for (const entry of undoEntries) {
        if (expectedUrl && location.href !== expectedUrl) break;
        const sameField = contactFields.some(({ field, key }) => field === entry.field && key === entry.key);
        if (entry.edited || !sameField || entry.form !== forms[0] ||
          contactFields.filter(({ key }) => key === entry.key).length !== 1 ||
          entry.field.value !== entry.value) {
          kept++;
          continue;
        }
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(entry.field, entry.before);
        entry.field.dispatchEvent(new Event("input", { bubbles: true }));
        entry.field.dispatchEvent(new Event("change", { bubbles: true }));
        restored.push(entry);
      }
      clearUndo();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const undone = restored.filter(({ field, before }) => field.isConnected && field.value === before).length;
      return { ...result, undoAvailable: false, undone, kept, unverified: restored.length - undone };
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
      if (field.value.trim()) {
        result.preserved++;
        continue;
      }
      // Ambiguous repeated fields and unconfirmed profile values are not guessed.
      if (
        contactFields.filter((entry) => entry.key === key).length !== 1 ||
        typeof contact[key] !== "string" ||
        !contact[key].trim()
      ) {
        result.missing++;
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
      const entry = { field, key, value, before: field.value, form: forms[0], edited: false };
      entry.onEdit = (event) => { if (event.isTrusted) entry.edited = true; };
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
        HTMLInputElement.prototype,
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
    result.undoAvailable = undoEntries.some(({ field, value, edited }) => !edited && field.isConnected && field.value === value);
    return result;
  };
}

export const inspectApplication = createInspector(applicationContext);
