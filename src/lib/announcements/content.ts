import { EXTENSION_STORE_URL } from "../extension-setup";

export const AUTOFILL_ANNOUNCEMENT = {
  key: "autofill-getting-started-2026-10",
  title: "Your profile, ready to autofill",
  message: "ApplyOverflow Assistant is on the Chrome Web Store. Set up your profile, connect the extension, and fill your first application with our five-step screenshot guide.",
  path: "/extension/guide",
  subject: "New on ApplyOverflow: set up application autofill in 5 steps",
} as const;

// Notification destinations are deliberately allowlisted, not arbitrary URLs.
export function announcementPath(value: string | null | undefined) {
  return value === AUTOFILL_ANNOUNCEMENT.path ? value : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function autofillAnnouncementEmail(origin: string, unsubscribeUrl: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Announcement links require HTTPS");
  const url = (path: string) => new URL(path, base.origin).href;
  const guide = url(AUTOFILL_ANNOUNCEMENT.path);
  const steps = [
    ["Review your profile", "Check your contact details, work history, education and application preferences. Save your changes.", url("/profile")],
    ["Install the Chrome extension", "On desktop Chrome, choose Add to Chrome in the official listing, then pin ApplyOverflow from Chrome's Extensions menu.", EXTENSION_STORE_URL],
    ["Connect your account", "Open the extension from Chrome's toolbar, choose Connect to ApplyOverflow, sign in to the same account and approve the connection.", `${guide}#connect`],
    ["Choose your resume", "Upload a PDF or DOCX (up to 5 MB) in Documents and make it Primary. In Profile, enable Include my default resume when I click Autofill, or approve a file using Change resume on each application.", url("/documents")],
    ["Fill, then review", "Open an employer's application form and click Autofill in the extension. Check the progress, edit answers directly on the form, and finish any fields left empty. Autofill never submits your application.", `${guide}#fill`],
  ];
  const text = [
    "ApplyOverflow product update", "", "Your profile, ready to autofill", "",
    "ApplyOverflow Assistant is now available on the Chrome Web Store. Use your saved profile to spend less time retyping job applications.", "",
    ...steps.flatMap(([title, copy, link], index) => [`${index + 1}. ${title}`, copy, link, ""]),
    `See the screenshot guide: ${guide}`, "",
    "Want the assistant on application pages? In the extension, open Connection & site access and choose Show autofill on all application sites. Approve Chrome's permission request. This is optional; the toolbar also works.", "",
    "Some questions, logins and website controls still need your input. Employers may receive field values or resume files before you submit. Review AI-drafted answers for accuracy.", "",
    `Data use: ${url("/extension/privacy")}`, "",
    "You received this because you opted into ApplyOverflow product-update emails. Deadline reminders are a separate preference.",
    `Unsubscribe from product updates: ${unsubscribeUrl}`,
    `Notification settings: ${url("/settings#notifications")}`,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(AUTOFILL_ANNOUNCEMENT.subject)}</title></head>
<body style="margin:0;background:#f6f7f9;color:#202124;font-family:Arial,sans-serif;line-height:1.6">
<div style="display:none;max-height:0;overflow:hidden">Profile, extension, connection, resume, first Autofill. A five-step guide with screenshots.</div>
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px">
<table role="presentation" style="width:100%;max-width:600px;margin:auto;background:#fff;border-collapse:collapse"><tr><td style="padding:28px">
<p style="margin:0;color:#555;font-size:13px">ApplyOverflow &middot; Product update</p>
<h1 style="font-size:26px;line-height:1.25;margin:14px 0">Your profile, ready to autofill</h1>
<p>ApplyOverflow Assistant is now on the Chrome Web Store. Spend less time retyping your next application.</p>
<p style="margin:24px 0"><a href="${guide}" style="display:inline-block;padding:12px 20px;background:#006bd6;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Open the screenshot guide</a></p>
${steps.map(([title, copy, link], index) => `<h2 style="font-size:17px;margin:24px 0 6px">${index + 1}. <a href="${link}" style="color:#0062c4">${escapeHtml(title)}</a></h2><p style="margin:0">${escapeHtml(copy)}</p>`).join("")}
<p style="margin:24px 0 4px"><a href="${guide}#fill"><img src="${url("/images/autofill-guide/fill.png")}" width="520" alt="Example: the Autofill button and field-by-field progress in the Chrome extension" style="display:block;width:100%;max-width:520px;height:auto;border:1px solid #ddd;border-radius:6px"></a></p>
<p style="font-size:13px;color:#555">Screenshot uses a demo profile. Images blocked? All steps are written above.</p>
<p><strong>Want it on the page?</strong> Open <strong>Connection &amp; site access</strong> in the extension, choose <strong>Show autofill on all application sites</strong> and approve Chrome's permission request. This is optional; you can use the toolbar instead.</p>
<p style="font-size:14px">Some questions, logins and website controls still need your input. Employers may receive values or files before submission. Review AI-drafted answers for accuracy. <a href="${url("/extension/privacy")}">Data use</a>.</p>
<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#555">You opted into ApplyOverflow product-update emails. Deadline reminders are separate.<br><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from product updates</a> &middot; <a href="${url("/settings#notifications")}">Notification settings</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: AUTOFILL_ANNOUNCEMENT.subject, text, html };
}
