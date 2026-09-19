export const fixtures = [
  {
    provider: "greenhouse",
    url: "https://job-boards.greenhouse.io/ao-fixture/jobs/123",
    count: 4,
    fields:
      '<label>First name *<input id="first_name"></label><label>Last name *<input id="last_name"></label><label>Email *<input id="email" type="email"></label><label>Phone<input id="phone" type="tel"></label>',
  },
  {
    provider: "lever",
    url: "https://jobs.lever.co/ao-fixture/ac978161-6f46-4f6b-ad9e-a258e642751c/apply",
    count: 4,
    fields:
      '<label><span class="application-label">Full name\u2731</span><input name="name"></label><label>Email\u2731<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>LinkedIn URL<input name="urls[LinkedIn]"></label>',
  },
  {
    provider: "ashby",
    url: "https://jobs.ashbyhq.com/ao-fixture/ac978161-6f46-4f6b-ad9e-a258e642751c/application",
    count: 2,
    fields:
      '<label for="_systemfield_name">Full Name</label><input id="_systemfield_name" name="_systemfield_name"><label for="_systemfield_email">Email</label><input id="_systemfield_email" name="_systemfield_email" type="email"><label>Phone<input id="custom-phone"></label>',
  },
];
export function resumeFieldHtml(provider) {
  if (provider === "greenhouse")
    return '<label for="resume">Attach</label><input type="file" id="resume" accept=".pdf,.docx">';
  if (provider === "lever")
    return '<a class="visible-resume-upload"><span class="filename"></span><span class="default-label">ATTACH RESUME/CV</span><input type="file" name="resume" id="resume-upload-input"></a>';
  return '<div class="ashby-application-form-autofill-input-root"><input type="file" aria-label="Autofill from resume"></div><label for="_systemfield_resume">Resume</label><div class="ashby-application-form-input-file"><input type="file" id="_systemfield_resume" accept="application/pdf,.docx"></div>';
}
export function fixtureHtml(
  fixture,
  { delayed = false, empty = false, resume = false } = {},
) {
  const tag = fixture.provider === "ashby" ? "div" : "form";
  const fields = empty
    ? "<label>Why this company?<textarea></textarea></label>"
    : fixture.fields;
  const form = `<${tag} class="ashby-application-form-container" id="application-form">${fields}
    <label>Why this role?<textarea name="story">Already written; never upload this answer</textarea></label>
    <fieldset><legend>Reference details</legend><label>Email<input name="reference" type="email"></label></fieldset>
    ${resume ? resumeFieldHtml(fixture.provider) : '<label>Resume<input type="file"></label>'}<label>Password<input type="password"></label>
    <label><input name="consent" type="checkbox">I agree to the terms</label>
    <fieldset><legend>Do you need sponsorship?</legend><label><input type="radio" name="visa">Yes</label></fieldset>
    <button type="button" id="next">Next</button><button type="button" id="submit">Submit application</button></${tag}>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application fixture</title>
    <style>body{font:16px system-ui;margin:24px;max-width:640px}label{display:block;margin:12px 0}input:not([type=checkbox]):not([type=radio]),textarea{display:block;max-width:100%;padding:8px}fieldset{margin:12px 0}button{padding:10px;margin:8px}</style>
    <h1>Analyst - synthetic application</h1><main>${delayed ? "" : form}</main>
    <script>window.submissions=0;window.steps=0;window.formHtml=${JSON.stringify(form)};
    document.addEventListener('submit',e=>{e.preventDefault();window.submissions++});
    document.addEventListener('click',e=>{if(e.target.id==='next')window.steps++;if(e.target.id==='submit')window.submissions++});
    ${delayed ? "setTimeout(()=>{document.querySelector('main').innerHTML=window.formHtml;window.formReady=performance.now()},400);" : "window.formReady=performance.now();"}</script></html>`;
}
