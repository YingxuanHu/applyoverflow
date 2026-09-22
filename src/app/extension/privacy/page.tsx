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
        <p className="text-muted-foreground">Updated September 21, 2026</p>
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
          your confirmed name, address, email, phone, preferred name, pronouns and professional links. Filling
          happens only after you choose it; existing answers, passwords, legal
          consent and signatures stay unchanged. Optional demographic and work-eligibility
          answers are shared only after you enter them and separately enable their use in Profile.
          Only supported questions with an exact matching choice are filled; ambiguous choices stay manual.
        </p>
        <p>
          Autofill shares up to ten work entries and ten education entries to fill
          existing empty rows. You can also select a single entry in More actions.
          Unknown dates and unsupported controls remain manual; no history rows are added automatically.
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
          Optional site access lets the extension inspect recognized Greenhouse,
          Lever, Ashby, Workday, iCIMS and Workable forms for supported fields. On other
          sites, inspection starts only when you open the toolbar. This inspection does not
          fetch your profile or send form contents to ApplyOverflow. In an
          embedded form, inspection is limited to the permitted ATS frame, not
          the surrounding employer page.
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
          matching saved answers. Only answers explicitly enabled for reuse are filled,
          and they require review again when your profile changes. Answers entered in
          the popup or on-page assistant stay on the form unless you choose to save them to your profile.
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
          actions do not send those contents to an AI service. Choosing Suggest answer sends
          the question, a bounded excerpt of the job description, your optional note and
          relevant professional profile evidence to OpenAI through ApplyOverflow.
          Contact details and optional demographic answers are excluded from that profile evidence.
          Drafts are not saved as reusable answers and are inserted only after you choose Use answer.
          No answers already entered on the employer form are sent for drafting. Normal
          authentication and service requests may also produce operational logs,
          such as request time, status and network address.
        </p>
        <p>
          The extension contains no advertising, third-party analytics or
          general browsing-history collection. It never submits an employer
          application for you.
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
