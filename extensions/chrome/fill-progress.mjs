// Shared, value-free progress display for the popup and injected assistant.
export function createFillProgress() {
  const expanded = new WeakMap();
  return (container, fields, run) => {
    const open = expanded.get(container) || {};
    expanded.set(container, open);
    container.replaceChildren();
    if (!fields.length) return;
    const counts = fields.reduce((all, field) => {
      const state = field.state === "needed" ? field.processing ? "processing" : field.queued ? "queued" : "empty" : field.state;
      all[state] = (all[state] || 0) + 1; return all;
    }, {});
    const summary = document.createElement("p"); summary.className = "fill-counts";
    summary.textContent = [`${counts.filled || 0} filled`, counts.kept ? `${counts.kept} already complete` : "",
      counts.processing || counts.queued ? `${(counts.processing || 0) + (counts.queued || 0)} processing` : "",
      counts.empty ? `${counts.empty} left empty` : ""].filter(Boolean).join(" · ");
    container.append(summary);
    for (const [key, title, rows] of [
      ["pending", "Processing", fields.filter(f => f.state === "needed" && (f.processing || f.queued))],
      ["empty", "Left empty", fields.filter(f => f.state === "needed" && !f.processing && !f.queued)],
      ["complete", "Completed", fields.filter(f => f.state !== "needed")],
    ]) {
      if (!rows.length) continue;
      const section = document.createElement("details"); section.className = "fill-group";
      section.open = open[key] ?? key !== "complete";
      section.addEventListener("toggle", () => { open[key] = section.open; });
      const heading = document.createElement("summary"); heading.textContent = `${title} (${rows.length})`;
      const list = document.createElement("ul"); list.className = "fill-events";
      for (const field of rows) {
        const item = document.createElement("li");
        const label = document.createElement("span"); label.className = "fill-label";
        const name = (field.title || field.label).replace(/[*\u2731\u2217]/g, "").trim();
        label.textContent = name.length > 125 ? `${name.slice(0, 122)}...` : name;
        label.title = name;
        const status = document.createElement("small");
        status.textContent = field.processing ? "Answering..." : field.queued ? "Waiting" :
          field.state === "filled" ? field.reviewReason || "Filled" : field.state === "kept" ? "Already complete" :
          field.state === "not-applicable" ? "Not applicable" : field.reason || "No supported answer matched this question. Review it on the form.";
        item.append(label, status);
        if (key === "empty") {
          const focus = document.createElement("button"); focus.type = "button";
          focus.className = "field-link secondary"; focus.textContent = "Show field";
          focus.setAttribute("aria-label", `Show field: ${name}`);
          focus.addEventListener("click", event => { if (event.isTrusted) void run("autofill-focus", { id: field.id, label: field.label }); });
          item.append(focus);
        }
        list.append(item);
      }
      section.append(heading, list); container.append(section);
    }
  };
}
