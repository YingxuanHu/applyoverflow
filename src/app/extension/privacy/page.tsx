import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";

export const metadata = {
  title: "Application assistant data use | ApplyOverflow",
  description:
    "What ApplyOverflow Assistant reads, shares and stores, and how to disconnect it.",
  alternates: { canonical: "/extension/privacy" },
};

export default function ExtensionPrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-5 py-10 text-sm leading-7 sm:px-8">
      <Link href="/" aria-label="ApplyOverflow home" className="inline-flex">
        <BrandLogo iconClassName="size-8" textClassName="text-base" />
      </Link>
      <header className="space-y-2 border-b pb-6">
        <h1 className="text-2xl font-semibold">
          Application assistant data use
        </h1>
        <p className="text-muted-foreground">Updated October 25, 2026</p>
        <p>
          This notice describes the ApplyOverflow Chrome extension and its
          application-review workflow.
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          Your choices control sharing
        </h2>
        <p>
          Connecting requires sign-in and your approval. The connection can read
          your confirmed name, address, email, phone, preferred name, pronouns, professional links and skills. Filling
          happens only after you choose it. Passwords, legal consent and signatures
          remain manual. Optional demographic and work-eligibility
          answers are shared only after you enter them and separately enable their use in Profile.
          Only supported questions with an exact matching choice are filled; ambiguous choices stay manual.
        </p>
        <p>
          &quot;Update saved contact and history&quot; is checked by default in
          the toolbar and on-page assistant. With it enabled, Autofill can replace
          supported prefilled contact fields and correct a uniquely matched work
          or education record using your saved profile. Turn it off before
          Autofill to keep prefilled values. Edits detected while the assistant is
          active are left unchanged; it cannot reliably identify edits made before
          it started or after a page reload. Review all corrections on the employer form.
          Other existing answers and ambiguous history matches are left for your review.
        </p>
        <p>
          Autofill shares up to ten work entries and ten education entries to fill
          empty rows and add rows in supported work/education sections. Complete
          HiBob row editors can be saved before the next row is added. You can also
          select a single entry in More actions. Unknown dates and unsupported
          controls remain manual. When a form requires full dates but your profile
          has only a month, supported history fields use the first day for starts
          and the last day for ends; review these dates. Autofill never submits an application.
        </p>
        <p>
          Resume sharing is off by default. You can explicitly enable sharing your
          default resume with Autofill in Profile, or choose and approve a file for each
          application. Only the chosen file is
          transferred to the selected form. Employers may save entered fields or
          begin uploading a selected file immediately, before you submit. Undo
          cannot retract information an employer has already received.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">What stays in your browser</h2>
        <p>
          You can grant optional access to common application sites, one employer
          site, or all HTTPS sites. The extension looks for application forms locally
          on permitted pages. Without a grant, use the toolbar on the current page.
          This inspection does not
          fetch your profile or send form contents to ApplyOverflow. In an
          embedded form, filling is limited to the selected application document;
          profile data is not sent to other frames.
        </p>
        <p>
          The extension keeps its connection token in Chrome local storage,
          restricted to trusted extension contexts and inaccessible to content scripts or employer-page scripts, and its site-access preference
          locally. It does not sync profile data to your Chrome account.
          Temporary contact/history-fill values used for Undo expire after ten minutes
          or when the page is closed or navigates away. Resume bytes are not
          saved as another persistent extension file.
          Recently inspected application links and titles stay in session storage
          until the tab closes; they are usable for tracking for thirty minutes.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">What ApplyOverflow receives</h2>
        <p>
          The optional application-review workspace receives the application URL,
          title and up to 40 visible question labels. It does not receive the
          answers already entered on the employer form. Answers you save in
          ApplyOverflow are stored with your account. Remembering an answer is a
          separate choice, scoped to the same employer and question.
          Autofill sends the application URL and up to 40 question labels to find
          matching saved answers. Saved answers must be explicitly enabled for reuse,
          and they require review again when your profile changes. Answers entered in
          the popup or on-page assistant can be inserted with Fill answer or Use answer.
          They are not saved for reuse unless you separately choose to save a supported
          fact to your profile. You can also edit answers directly on the employer form.
          Older explicitly remembered answers remain scoped to the same employer and question. Optional demographic
          answers are not included in ranking or AI-generated materials. Legal agreements,
          signatures and unsupported sensitive fields remain manual.
        </p>
        <p>
          I applied asks you to review the job link, company and title and confirm
          that you submitted it. Only then is it recorded in your private tracker.
          Filling a form or clicking the employer&apos;s Submit button alone does
          not change application status. External jobs are not added to the public board.
        </p>
        <p>
          Profile details, stored resumes and application reviews use
          ApplyOverflow&apos;s database and document storage. The
          extension&apos;s contact-fill, question-capture and resume-transfer
          actions do not send contact details or files to an AI service. When Autofill prepares answer drafts, or you choose Suggest answer, it sends
          the question, a bounded excerpt of the job description, your optional note and
          relevant professional profile evidence to OpenAI through ApplyOverflow.
          Contact details and optional demographic answers are excluded from that profile evidence.
          Clicking Autofill can insert supported professional answers directly into the employer form.
          You can review and edit them there before submitting. Generated answers are not saved as reusable profile facts.
          No answers already entered on the employer form are sent for drafting. Normal
          authentication and service requests may also produce operational logs,
          such as request time, status and network address.
        </p>
        <p>
          When onboarding measurement is enabled, ApplyOverflow records setup and
          autofill event names, random journey/run identifiers, website or extension
          entry, and bounded filled/remaining field counts. These events can be linked
          to your account; they do not contain application URLs, answer values,
          profile fields or document contents. Records older than 30 days are
          scheduled for cleanup when new events are recorded, not erased on an exact timer.
        </p>
        <p>
          The website also tests a Content Security Policy in report-only mode;
          it does not enforce that policy. Browsers may send violation reports to
          ApplyOverflow, including page and resource URLs. The report handler
          discards those URLs, referrers, code samples and other free-form details,
          and logs only allowed directive names and broad resource categories.
          Report sizes and volume are limited. These summaries use operational log
          retention, not the onboarding-event cleanup period.
        </p>
        <p>
          The extension contains no advertising, third-party analytics or
          general browsing-history collection. The separate Review &amp; submit
          action checks supported single-page forms and submits once only after
          your explicit approval for that application. You must review all answers,
          declarations and upload completion on the employer site. CAPTCHAs,
          unverified required custom controls and multi-step flows remain manual.
          Success requires a visible employer confirmation; uncertain attempts are
          not marked applied and are never automatically retried. Hashed account/job
          identifiers and attempt outcomes are stored locally in Chrome to prevent
          duplicates, without answer values or document contents. Removing the
          extension clears this local history.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Disconnect and remove data</h2>
        <p>
          Disconnect in the extension or in{" "}
          <Link className="text-primary underline" href="/settings/extension">
            Application assistant settings
          </Link>
          . The connection survives restarting Chrome but ends when its approving
          sign-in session expires or is revoked, within 30 days. Disconnecting clears the local token.
          Turning off automatic hints removes the
          permission-based hints; using the toolbar is a separate, deliberate
          action.
        </p>
        <p>
          Assistant settings lets you forget remembered answers. Deleting a
          tracked application removes its saved review, but separately
          remembered answers remain until you forget them. Your documents are
          managed in Documents. Account export and account deletion are
          available in{" "}
          <Link className="text-primary underline" href="/settings#account">
            Settings
          </Link>
          . Account deletion removes active account-linked records; existing
          backups can retain earlier copies until their retention period ends.
          Disconnecting alone does not delete your profile, documents or
          application history.
        </p>
      </section>
    </article>
  );
}
