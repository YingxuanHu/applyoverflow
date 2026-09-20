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
        <p className="text-muted-foreground">Updated September 20, 2026</p>
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
          your confirmed name, address, email, phone and professional links. Filling
          happens only after you choose it; existing answers, passwords, legal
          consent and demographic choices are not filled automatically.
        </p>
        <p>
          Work and education filling requires selecting one saved entry in the
          extension. Only that entry is shared with the form. Unknown dates and
          custom dropdowns remain manual; no history rows are added automatically.
        </p>
        <p>
          Resume sharing requires a separate choice and confirmation for each
          application. No resume is selected by default. Only the chosen file is
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
          The extension keeps its connection token in Chrome session storage,
          inaccessible to employer-page scripts, and its site-access preference
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
          Choosing Review sends the application URL, title and up to 40 visible
          question labels to your application workspace. It does not send the
          answers already entered on the employer form. Answers you save in
          ApplyOverflow are stored with your account. Remembering an answer is a
          separate choice, scoped to the same employer and question.
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
          actions do not send those contents to an AI service. Separate AI tools
          in the website are not part of this extension workflow. Normal
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
          . Access also ends when its sign-in session ends and expires after at
          most eight hours. Turning off automatic hints removes the
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
