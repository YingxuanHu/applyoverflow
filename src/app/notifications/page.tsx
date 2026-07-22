import Link from "next/link";
import { redirect } from "next/navigation";

import { getOptionalSessionUser } from "@/lib/current-user";
import { formatMediumDateTimeEnCa } from "@/lib/formatting";
import {
  dismissNotification,
  dismissReadNotifications,
  getNotificationCenterData,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/queries/tracker";
import { revalidateNotificationCenterViews } from "@/lib/revalidation";

function getNotificationHref(notification: Awaited<ReturnType<typeof getNotificationCenterData>>["notifications"][number]) {
  if (notification.trackedApplicationId) {
    return `/applications/${notification.trackedApplicationId}`;
  }

  if (notification.trackedApplication?.canonicalJobId) {
    return `/jobs/${notification.trackedApplication.canonicalJobId}`;
  }

  return null;
}

function getNotificationCategory(
  type: "DEADLINE_REMINDER" | "APPLICATION_STATUS_CHANGED" | "SYSTEM"
) {
  if (type === "DEADLINE_REMINDER") return "Deadline";
  if (type === "APPLICATION_STATUS_CHANGED") return "Status update";
  return "Reminder";
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

  async function dismissAction(formData: FormData) {
    "use server";

    const notificationId = String(formData.get("notificationId") ?? "").trim();
    if (!notificationId) return;

    await dismissNotification(notificationId);
    revalidateNotificationCenterViews();
  }

  async function dismissReadAction() {
    "use server";

    await dismissReadNotifications();
    revalidateNotificationCenterViews();
  }

  const { notifications, unreadCount } = await getNotificationCenterData();
  const hasReadNotifications = notifications.some((notification) => notification.readAt);

  return (
    <div className="app-page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-description">
            Deadlines, scheduled reminders, and automated application updates.
          </p>
        </div>
      </div>

      <section className="surface-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
            {hasReadNotifications ? (
              <form action={dismissReadAction}>
                <button
                  type="submit"
                  className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
                >
                  Clear read
                </button>
              </form>
            ) : null}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-background/50 px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No notifications yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Deadlines, scheduled reminders, and automatic status updates will appear here.
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
                  className="rounded-lg border border-border/60 bg-background/50 p-4 data-[unread=true]:border-primary/30 data-[unread=true]:bg-primary/[0.035]"
                  data-unread={notification.readAt ? undefined : "true"}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="mb-2 inline-flex rounded-full border border-border/70 bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {getNotificationCategory(notification.type)}
                      </span>
                      {href ? (
                        <Link
                          className="block rounded-lg transition hover:bg-muted/35"
                          href={href}
                        >
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </div>

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
                      <form action={dismissAction}>
                        <input type="hidden" name="notificationId" value={notification.id} />
                        <button
                          type="submit"
                          className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                        >
                          Dismiss
                        </button>
                      </form>
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
