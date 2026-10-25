import Link from "next/link";

export const metadata = { title: "Product email preferences | ApplyOverflow", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ProductEmailPreferences({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  return <div className="app-page max-w-xl space-y-5 py-12">
    <h1 className="page-title">Product-update emails</h1>
    {done === "1" ? <p>You are unsubscribed from product-update emails. Your deadline reminders and account security emails are unchanged.</p> : <>
      <p>Stop receiving feature announcements and setup guides from ApplyOverflow. You can keep using autofill and receiving in-app notifications.</p>
      {token ? <form method="post" action="/api/email/product-updates/unsubscribe">
        <input type="hidden" name="token" value={token} />
        <button className="rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground" type="submit">Unsubscribe from product updates</button>
      </form> : <p>This link is incomplete. Open notification settings to change your email preferences.</p>}
    </>}
    <Link className="block text-primary underline" href="/settings#notifications">Notification settings</Link>
  </div>;
}
