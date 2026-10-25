import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { EXTENSION_STORE_URL } from "@/lib/extension-setup";

export const metadata = {
  title: "Start using autofill | ApplyOverflow",
  description: "Set up your profile, install ApplyOverflow Assistant for Chrome, connect your account, and fill your first job application.",
};

function Screenshot({ file, alt, caption, width, height }: { file: string; alt: string; caption: string; width: number; height: number }) {
  return <figure className="mt-5 max-w-2xl">
    <a href={`/images/autofill-guide/${file}.png`} target="_blank" rel="noreferrer" aria-label={`Open full-size screenshot: ${caption}`}>
      <Image className="h-auto max-h-[480px] w-auto max-w-full rounded-lg border border-border object-contain object-left" src={`/images/autofill-guide/${file}.png`} alt={alt} width={width} height={height} />
    </a>
    <figcaption className="mt-2 text-xs text-muted-foreground">{caption} Demo data; select an image to enlarge it.</figcaption>
  </figure>;
}

export default function AutofillGuidePage() {
  return <article className="app-page mx-auto max-w-4xl space-y-8 pb-16">
    <header className="space-y-4 border-b border-border pb-6">
      <p className="text-sm font-medium text-muted-foreground">ApplyOverflow Assistant / Getting started</p>
      <h1 className="page-title">Your first application with autofill</h1>
      <p className="max-w-2xl text-base leading-7 text-muted-foreground">Set up once, then use your saved profile on employer application forms. You review the answers and stay in control of submission.</p>
      <p className="text-sm">Use Chrome on a desktop or laptop. You can prepare your profile on your phone, but the Chrome extension needs a computer.</p>
      <nav aria-label="Guide steps" className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-primary underline underline-offset-4">
        <a href="#profile">1. Profile</a><a href="#install">2. Install</a><a href="#connect">3. Connect</a><a href="#resume">4. Resume</a><a href="#fill">5. Autofill</a>
      </nav>
    </header>

    <section id="profile" className="scroll-mt-24 border-b border-border pb-8">
      <h2 className="text-xl font-semibold">1. Check what autofill will use</h2>
      <p className="mt-3 leading-7">Sign in to <Link className="text-primary underline" href="/profile">your Profile</Link>. Review your name, email, phone country, address and professional links. Add or check your work experience, education, skills and dates, then save your changes.</p>
      <p className="mt-3 leading-7">Already uploaded a resume? Review the imported details before using them. A resume file alone does not guarantee your profile has complete, confirmed work and education records.</p>
      <p className="mt-3 leading-7">In Profile&apos;s application answers, save preferences you want to reuse, such as work authorization by country and availability. Only enable sharing of personal answers you want autofill to use. Unknown facts and legal declarations still need your input.</p>
      <Screenshot file="profile" width={894} height={1035} alt="Profile contact details and the option to include a default resume" caption="Profile: review contact details and sharing choices." />
    </section>

    <section id="install" className="scroll-mt-24 border-b border-border pb-8">
      <h2 className="text-xl font-semibold">2. Install and pin the extension</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-6 leading-7">
        <li>Open <a className="text-primary underline" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">ApplyOverflow Assistant in the Chrome Web Store <ExternalLink className="inline size-3.5" aria-hidden="true" /></a>.</li>
        <li>Choose <strong>Add to Chrome</strong>, then confirm <strong>Add extension</strong>. If Chrome shows <strong>Remove from Chrome</strong>, it is already installed in this browser profile.</li>
        <li>Open Chrome&apos;s <strong>Extensions</strong> menu (the puzzle-piece icon beside the address bar) and pin ApplyOverflow. Its icon will stay in your toolbar.</li>
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">Use the Web Store version. You do not need a ZIP file, Developer mode, or Load unpacked. Avoid enabling a second testing copy alongside it.</p>
    </section>

    <section id="connect" className="scroll-mt-24 border-b border-border pb-8">
      <h2 className="text-xl font-semibold">3. Connect the same ApplyOverflow account</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-6 leading-7">
        <li>Click the ApplyOverflow toolbar icon, then <strong>Connect to ApplyOverflow</strong>. A newer release may call this <strong>Set up autofill</strong>.</li>
        <li>In the tab that opens, sign in if asked. Check that the account is the one with your saved profile and resume, read the sharing information and approve the connection.</li>
        <li>Return to the extension. Check that <strong>Profile</strong> says <strong>Connected</strong> and the account email is yours. No sign-out/sign-in cycle is needed.</li>
      </ol>
      <Screenshot file="connect" width={320} height={329} alt="ApplyOverflow extension showing the Connect to ApplyOverflow button" caption="Start the connection from Chrome's toolbar." />
      <details className="mt-5 border-t border-border pt-4">
        <summary className="cursor-pointer font-medium">Optional: show the assistant automatically on forms</summary>
        <p className="mt-3 leading-7">In the extension, open <strong>Connection &amp; site access</strong>. Select <strong>Show autofill on all application sites</strong> and approve Chrome&apos;s request to read and change those pages. The assistant appears when it detects an application form; filling still requires your click.</p>
        <p className="mt-3 leading-7">Prefer narrower access? Choose supported sites or enable one site instead. You can always open the toolbar on the application page. After changing permissions, refresh that page before entering information.</p>
      </details>
    </section>

    <section id="resume" className="scroll-mt-24 border-b border-border pb-8">
      <h2 className="text-xl font-semibold">4. Choose the resume employers will receive</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-6 leading-7">
        <li>Open <Link className="text-primary underline" href="/documents">Documents</Link> and select <strong>Add resume</strong>. For extension uploads, use a PDF or DOCX file no larger than 5 MB.</li>
        <li>Use the resume&apos;s menu to <strong>Make primary</strong>. Check that the intended file has the <strong>Primary</strong> label.</li>
        <li>For automatic attachment, open <Link className="text-primary underline" href="/profile">Profile</Link>, turn on <strong>Include my default resume when I click Autofill</strong>, and save. Otherwise, use <strong>Change resume</strong> in the extension to choose and approve a file for that application.</li>
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">Employers may receive the file as soon as it uploads, before you submit the application. Check the attached filename on every form. If an upload control is unsupported, attach the file yourself.</p>
      <Screenshot file="documents" width={944} height={259} alt="Documents with a demo resume marked Primary and the Add resume button" caption="Documents: choose the primary resume." />
    </section>

    <section id="fill" className="scroll-mt-24 border-b border-border pb-8">
      <h2 className="text-xl font-semibold">5. Open a form, click Autofill, review</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-6 leading-7">
        <li>Choose a job in <Link className="text-primary underline" href="/jobs">Jobs</Link> and open the employer&apos;s application. If you see only a job description, click the employer&apos;s Apply button first. Complete any required sign-in yourself.</li>
        <li>Click <strong>Autofill</strong> in the on-page assistant or Chrome toolbar. Leave the application open while it processes.</li>
        <li>Read the progress: filled, already complete, or left empty. Review the actual form, including work history, education, dropdowns and attachments. Edit any answer directly there.</li>
        <li>Check professional drafts for accuracy and finish missing fields, CAPTCHA, signatures or consent yourself. <strong>Autofill does not submit.</strong> Submit only after your review; assisted submission, where offered, requires a separate approval.</li>
      </ol>
      <Screenshot file="fill" width={320} height={715} alt="Demo Autofill result showing completed fields and an availability question left empty" caption="Autofill: progress stays in the extension; answers go on the employer form." />
      <p className="mt-4 text-sm text-muted-foreground">Website controls vary. Autofill can save time without completing every field on every site. A field left empty is not permission to guess, and an existing answer still deserves review.</p>
      <Link className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground" href="/jobs">Find a job <ArrowRight className="size-4" aria-hidden="true" /></Link>
    </section>

    <section aria-labelledby="troubleshooting" className="space-y-4">
      <h2 id="troubleshooting" className="text-xl font-semibold">If something gets stuck</h2>
      {[
        ["I cannot see the assistant", "Open the employer's actual application form, then click the toolbar icon. Check Connection & site access, allow access to this site and refresh before entering data. Chrome settings pages, the Web Store and mobile Chrome cannot run autofill."],
        ["It asks me to connect again", "Open the extension and reconnect to the same ApplyOverflow account. Connections can expire or be revoked. Signing into the website alone does not always reconnect the extension."],
        ["The setup checker cannot detect my extension", "The published 0.15.1 release does not support the newer browser checker. Open the toolbar and use Connect to ApplyOverflow. Verify the email and Connected status there; you do not need a developer preview."],
        ["My resume did not attach", "Check the Primary resume in Documents, its type and size, and the sharing option in Profile. Try Change resume in the extension. If the website still rejects it, use its own upload button and verify the filename."],
        ["A field is empty or an answer is wrong", "Read the reason beside the field in the progress list. Correct your saved profile for future applications, and edit the current form directly. Some custom controls and questions need manual input. Review all generated answers."],
      ].map(([question, answer]) => <details className="border-b border-border pb-4" key={question}><summary className="cursor-pointer font-medium">{question}</summary><p className="mt-3 leading-7 text-muted-foreground">{answer}</p></details>)}
      <p className="text-sm text-muted-foreground">When reporting a problem, include the application URL, extension version and error message. Never send passwords; hide personal information in screenshots.</p>
    </section>
    <footer className="flex flex-wrap gap-5 border-t border-border pt-5 text-sm text-primary underline">
      <Link href="/extension/privacy">Extension data use</Link>
      <Link href="/settings/extension">Connection settings</Link>
      <Link href="/settings#notifications">Email preferences</Link>
    </footer>
  </article>;
}
