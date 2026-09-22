// One shared, serialized view for the toolbar and on-page assistant.
export function createQuestionReview(classify) {
  const states = new WeakMap();
  const clean = value => value.replace(/[*\u2731\u2217]/g, "").trim();
  return function render(container, fields, run) {
    const state = states.get(container) || { groups: {}, drafts: new Map() };
    states.set(container, state);
    const pending = fields.filter(field => field.state === "needed");
    const ids = new Set(pending.map(field => field.id));
    for (const id of state.drafts.keys()) if (!ids.has(id)) state.drafts.delete(id);
    container.replaceChildren();
    for (const [key, title, members] of [
      ["draft", "Answer drafts", pending.filter(f => f.canAnswer && !f.profileKey && f.kind === "text" && classify(f.label) !== "personal")],
      ["input", "Needs your input", pending.filter(f => !(f.canAnswer && !f.profileKey && f.kind === "text" && classify(f.label) !== "personal"))],
    ]) {
      if (!members.length) continue;
      const group = state.groups[key] ||= { id: members[0].id, open: key === "draft" };
      const section = document.createElement("details"); section.className = "question-group"; section.open = group.open;
      section.addEventListener("toggle", () => { group.open = section.open; });
      const heading = document.createElement("summary"); heading.textContent = `${title} (${members.length})`;
      section.append(heading);
      const field = members.find(f => f.id === group.id) || members[0]; group.id = field.id;
      const picker = document.createElement("select"); picker.className = "question-picker"; picker.setAttribute("aria-label", `${title}: choose a field`);
      picker.replaceChildren(...members.map((f, index) => new Option(`${index + 1}. ${clean(f.title || f.label)}`, f.id)));
      picker.value = field.id;
      picker.addEventListener("change", () => { group.id = picker.value; render(container, fields, run); });
      if (members.length > 1) section.append(picker);
      const question = document.createElement("p"); question.className = "question-title";
      question.textContent = clean(field.title || field.label); section.append(question);
      const draft = state.drafts.get(field.id) || { value: "", note: "", evidence: [], missing: "" };
      state.drafts.set(field.id, draft);
      const action = (label, fn) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary"; button.textContent = label;
        button.addEventListener("click", event => { if (event.isTrusted) void fn(); }); return button;
      };
      if (field.canAnswer) {
        const form = document.createElement("form"); form.className = "answer-row";
        const control = document.createElement(field.options?.length ? "select" : "textarea");
        control.setAttribute("aria-label", `Answer: ${clean(field.label)}`); control.required = true;
        if (field.options?.length) control.replaceChildren(new Option("Choose an answer", ""), ...field.options.map(option => new Option(option, option)));
        else { control.rows = key === "draft" ? 5 : 2; control.maxLength = 3000; }
        control.value = draft.value; control.addEventListener("input", () => { draft.value = control.value; });
        if (key === "draft") {
          const noteLabel = document.createElement("label");
          noteLabel.textContent = classify(field.label) === "context" ? "What's your reason? A short note is enough." : "Anything to emphasize? (optional)";
          const note = document.createElement("textarea"); note.rows = 2; note.maxLength = 1200; note.value = draft.note;
          note.setAttribute("aria-label", noteLabel.textContent);
          note.addEventListener("input", () => { draft.note = note.value; }); noteLabel.append(note);
          const context = document.createElement("details");
          const contextTitle = document.createElement("summary"); contextTitle.textContent = "Add context (optional)";
          context.append(contextTitle, noteLabel);
          const needsNote = classify(field.label) === "context";
          const disclosure = document.createElement("p"); disclosure.className = "question-hint";
          disclosure.textContent = "AI uses your professional profile, this job description and your note. Review before using.";
          const feedback = document.createElement("p"); feedback.setAttribute("role", "status");
          const evidence = document.createElement("details");
          const drawEvidence = () => {
            feedback.textContent = draft.missing;
            evidence.replaceChildren(); evidence.hidden = !draft.evidence.length;
            const title = document.createElement("summary"); title.textContent = "Based on your profile"; evidence.append(title);
            for (const ref of draft.evidence) { const p = document.createElement("p"); p.textContent = `${ref.id === "your-note" ? "Your note" : "Profile"}: ${ref.quote}`; evidence.append(p); }
          };
          drawEvidence();
          const generate = action("Suggest answer", async () => {
            if (classify(field.label) === "context" && !note.value.trim()) { feedback.textContent = "Add your reason first; we won't guess it."; note.focus(); return; }
            generate.disabled = true; generate.textContent = "Drafting...";
            const previousValue = control.value;
            try {
              const result = await run("autofill-suggest", { id: field.id, label: field.label, note: note.value });
              if (result?.suggestion && control.isConnected && control.value === previousValue) {
                draft.value = result.suggestion.answer; draft.evidence = result.suggestion.evidence; draft.missing = result.suggestion.missing;
                control.value = draft.value; drawEvidence(); control.focus();
              }
            } finally { generate.disabled = false; generate.textContent = "Suggest answer"; }
          });
          form.append(needsNote ? noteLabel : context, disclosure, generate, feedback, evidence);
        } else if (field.kind === "combobox" && !field.options?.length) {
          form.append(action("Load choices", () => run("autofill-options", { id: field.id, label: field.label })));
        }
        form.append(control);
        const remember = document.createElement("input"); remember.type = "checkbox";
        if (field.profileKey && field.canRemember) {
          const label = document.createElement("label"); label.className = "remember-answer remember";
          label.append(remember, document.createTextNode("Save to my profile for future applications")); form.append(label);
        }
        const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = key === "draft" ? "Use answer" : "Fill answer";
        form.append(submit);
        form.addEventListener("submit", event => {
          event.preventDefault();
          if (event.isTrusted) void run("autofill-answer", { id: field.id, label: field.label, answer: control.value, remember: remember.checked });
        });
        section.append(form);
      } else {
        const reason = document.createElement("p"); reason.textContent = field.reason || "Complete this field on the form."; section.append(reason);
      }
      const jump = action("Show on form", () => run("autofill-focus", { id: field.id, label: field.label }));
      jump.className = "field-link secondary"; section.append(jump);
      container.append(section);
    }
  };
}
