# Resume upload validation

## Scope

Shared extension handling for hidden, id-less and dynamically mounted resume
pickers. Detection binds a locally labelled document widget to its file input;
it does not infer the target from a site hostname or use the first file picker.
Default-resume uploads are reinspected after the contact/history fill and require
the existing document-sharing consent. Existing attachments are preserved.

## Live verification

Tested the local preview 0.16.0 in normal Chrome against Signal1's BambooHR
application at `https://signal1.bamboohr.com/careers/46`, with the account owner's
explicit permission to use their saved profile and default resume.

- Two fresh applications displayed the default PDF and a remove-file control
  after the extension's on-page Autofill action. No manual file selection used.
- Toolbar-driven reruns preserved the existing attachment.
- Contact, address and professional-link fields populated from the profile.
- No application submitted; CAPTCHA was not touched.

## Remaining live gap

The Province control is a labelled hidden select paired with an ARIA menu button.
It was previously omitted from results. The shared detector now includes this
structure and reads its native committed value. Owned-menu, pointer and keyboard
paths pass synthetic fixtures, but did not successfully open this live widget.
Province remains empty and is explicitly reported as requiring manual selection.
Do not count this live dropdown as a successful autofill.

Date Available and Desired Pay remained empty with profile-completion guidance.
This validation does not establish universal platform compatibility.

## Repeatable checks

- `npm run extension:test:upload-widgets`: 48 intercepted fixture navigations,
  including ambiguous targets, existing files, asynchronous rejection, remounts,
  malformed download data, and post-fill conditional pickers.
- `npm run extension:test:origins`: 30 synthetic domains with the packaged MV3
  worker; consent, default download, exact bytes, outcome reporting, duplicate
  protection, and embedded-form isolation.
- `npm run extension:test:modern`: select-backed menu and existing modern-widget
  regressions, including actual native-value commit checks and non-submission.
- `node scripts/test-application-extension-compatibility.mjs`: generic forms and
  Workable resume attachment, with unrelated file inputs preserved.

Synthetic fixtures intercept employer requests. Their counts are not counts of
live employer sites. This build is installed locally, not a public store release.
