import Link from "next/link";
import { redirect } from "next/navigation";

import { getOptionalSessionUser } from "@/lib/current-user";
import { formatMediumDateTimeEnCa } from "@/lib/formatting";
import {
  getNotificationCenterData,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/queries/tracker";
import { revalidateNotificationCenterViews } from "@/lib/revalidation";

function getNotificationHref(notification: Awaited<ReturnType<typeof getNotificationCenterData>>["notifications"][number]) {
  if (notification.trackedApplication?.canonicalJobId) {
    return `/jobs/${notification.trackedApplication.canonicalJobId}`;
  }

  if (notification.trackedApplicationId) {
    return `/applications/${notification.trackedApplicationId}`;
  }

  return null;
}

export default async function NotificationsPage() {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  async function markAllAction() {
    "use server";

    await markAllNotificationsRead();
    revalidateNotificationCenterViews();
  }

  async function markOneAction(formData: FormData) {
    "use server";

    const notificationId = String(formData.get("notificationId") ?? "").trim();
    if (!notificationId) return;

    await markNotificationRead(notificationId);
    revalidateNotificationCenterViews();
  }

  const { notifications, unreadCount } = await getNotificationCenterData();

  return (
    <div className="app-page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-description">
            Deadline reminders and tracker updates.
          </p>
        </div>
      </div>

      <section className="surface-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
          {unreadCount > 0 ? (
            <form action={markAllAction}>
              <button
                type="submit"
                className="h-9 rounded-lg border border-border/70 bg-background/60 px-4 text-sm font-medium"
              >
                Mark all as read
              </button>
            </form>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/50 px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No notifications yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Deadline reminders and tracker activity will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {notifications.map((notification) => {
              const href = getNotificationHref(notification);
              const content = (
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {notification.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMediumDateTimeEnCa(notification.createdAt)}
                  </p>
                </div>
              );

              return (
                <article
                  key={notification.id}
                  className="rounded-lg border border-border/60 bg-background/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    {href ? (
                      <Link
                        className="min-w-0 flex-1 rounded-lg transition hover:bg-muted/35"
                        href={href}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1">{content}</div>
                    )}

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {notification.readAt ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          Read
                        </span>
                      ) : (
                        <>
                          <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background">
                            Unread
                          </span>
                          <form action={markOneAction}>
                            <input type="hidden" name="notificationId" value={notification.id} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            >
                              Mark read
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
