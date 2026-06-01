"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import { authClient } from "@/lib/auth-client";

type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
};

type ActiveSession = {
  id: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
};

type AccountSecurityPanelProps = {
  accounts: LinkedAccount[];
  currentSessionId: string | null;
  email: string;
  sessions: ActiveSession[];
};

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "Unknown";
  }
}

function getProviderLabel(providerId: string) {
  if (providerId === "credential") return "Email and password";
  if (providerId === "google") return "Google";
  return providerId;
}

function getSessionDeviceLabel(userAgent: string | null) {
  const value = (userAgent ?? "").toLowerCase();
  const device = value.includes("iphone")
    ? "iPhone"
    : value.includes("ipad")
      ? "iPad"
      : value.includes("android")
        ? "Android"
        : value.includes("macintosh") || value.includes("mac os")
          ? "Mac"
          : value.includes("windows")
            ? "Windows"
            : value.includes("linux")
              ? "Linux"
              : "Unknown device";
  const browser = value.includes("edg/")
    ? "Edge"
    : value.includes("firefox/")
      ? "Firefox"
      : value.includes("chrome/")
        ? "Chrome"
        : value.includes("safari/")
          ? "Safari"
          : "Browser";

  return `${browser} on ${device}`;
}

function SecurityInput({
  autoComplete,
  label,
  name,
  type = "text",
  value,
  onChange,
}: {
  autoComplete?: string;
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        autoComplete={autoComplete}
        className="h-9 rounded-lg border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
        name={name}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

export function AccountSecurityPanel({
  accounts,
  currentSessionId,
  email,
  sessions,
}: AccountSecurityPanelProps) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOtherSessions, setShowOtherSessions] = useState(false);

  const credentialAccount = useMemo(
    () => accounts.find((account) => account.providerId === "credential"),
    [accounts]
  );
  const googleAccount = useMemo(
    () => accounts.find((account) => account.providerId === "google"),
    [accounts]
  );
  const hasPassword = Boolean(credentialAccount?.hasPassword);
  const signInMethod = hasPassword
    ? credentialAccount
    : googleAccount ?? credentialAccount ?? accounts[0] ?? null;
  const currentSession =
    sessions.find((session) => session.id === currentSessionId) ?? sessions[0] ?? null;
  const otherSessions = currentSession
    ? sessions.filter((session) => session.id !== currentSession.id)
    : sessions;
  const visibleOtherSessions = showOtherSessions ? otherSessions.slice(0, 5) : [];
  const hiddenOtherSessionCount = Math.max(0, otherSessions.length - visibleOtherSessions.length);

  function showError(message: string) {
    notify({ tone: "error", title: "Security update failed", message });
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showError("Passwords do not match.");
      return;
    }

    setPendingAction("change-password");
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPendingAction(null);

    if (result.error) {
      showError("Current password was not accepted, or the session needs a fresh sign-in.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    notify({
      tone: "success",
      title: "Password changed",
      message: "Other sessions were signed out.",
    });
    router.refresh();
  }

  async function onChangeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const emailInput = newEmail.trim().toLowerCase();
    if (!emailInput || emailInput === email.toLowerCase()) {
      showError("Enter a different email address.");
      return;
    }

    setPendingAction("change-email");
    const result = await authClient.changeEmail({
      newEmail: emailInput,
      callbackURL: "/settings?email=changed",
    });
    setPendingAction(null);

    if (result.error) {
      showError("Unable to start email change. The email may already be in use.");
      return;
    }

    setNewEmail("");
    notify({
      tone: "success",
      title: "Check your email",
      message: "Confirm the change from your current email, then verify the new address.",
    });
  }

  async function onRevokeOtherSessions() {
    setPendingAction("revoke-other-sessions");
    const result = await authClient.revokeOtherSessions();
    setPendingAction(null);

    if (result.error) {
      showError("Unable to sign out other devices right now.");
      return;
    }

    notify({
      tone: "success",
      title: "Other devices signed out",
      message: "This browser session is still active.",
    });
    router.refresh();
  }

  async function onRevokeAllSessions() {
    setPendingAction("revoke-sessions");
    const result = await authClient.revokeSessions();

    if (result.error) {
      setPendingAction(null);
      showError("Unable to sign out all devices right now.");
      return;
    }

    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="mt-3 grid gap-4 sm:mt-4">
      <div className="grid gap-2 md:hidden">
        <details className="rounded-[14px] border border-border/60 bg-background/60" open>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            Sign-in method
            <span className="text-xs text-muted-foreground">
              {signInMethod ? getProviderLabel(signInMethod.providerId) : "Missing"}
            </span>
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3">
            <p className="text-xs leading-5 text-muted-foreground">
              {signInMethod
                ? `${getProviderLabel(signInMethod.providerId)} is used for this account.`
                : "No sign-in method was found for this account."}
            </p>
            {signInMethod ? (
              <div className="mt-3 rounded-[12px] border border-border/60 bg-muted/25 px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">
                  {getProviderLabel(signInMethod.providerId)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Created {formatDate(signInMethod.createdAt)}
                </p>
              </div>
            ) : null}
          </div>
        </details>

        <details className="rounded-[14px] border border-border/60 bg-background/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            Change password
            <span className="text-xs text-muted-foreground">
              {hasPassword ? "Available" : "Google"}
            </span>
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3">
            {hasPassword ? (
              <form onSubmit={onChangePassword}>
                <div className="grid gap-3">
                  <SecurityInput
                    autoComplete="current-password"
                    label="Current"
                    name="mobileCurrentPassword"
                    onChange={setCurrentPassword}
                    type="password"
                    value={currentPassword}
                  />
                  <SecurityInput
                    autoComplete="new-password"
                    label="New"
                    name="mobileNewPassword"
                    onChange={setNewPassword}
                    type="password"
                    value={newPassword}
                  />
                  <SecurityInput
                    autoComplete="new-password"
                    label="Confirm"
                    name="mobileConfirmPassword"
                    onChange={setConfirmPassword}
                    type="password"
                    value={confirmPassword}
                  />
                </div>
                <Button
                  className="mt-3 w-full"
                  disabled={
                    pendingAction === "change-password" ||
                    currentPassword.length < 1 ||
                    newPassword.length < 8
                  }
                  type="submit"
                >
                  {pendingAction === "change-password" ? "Saving..." : "Change password"}
                </Button>
              </form>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                This account signs in with Google. Use normal registration for a separate email/password account.
              </p>
            )}
          </div>
        </details>

        <details className="rounded-[14px] border border-border/60 bg-background/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            Change email
            <span className="max-w-[11rem] truncate text-xs text-muted-foreground">
              {email}
            </span>
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3">
            {hasPassword ? (
              <form onSubmit={onChangeEmail}>
                <p className="mb-3 truncate rounded-[12px] border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                  Current: <span className="text-foreground">{email}</span>
                </p>
                <SecurityInput
                  autoComplete="email"
                  label="New email"
                  name="mobileNewEmail"
                  onChange={setNewEmail}
                  type="email"
                  value={newEmail}
                />
                <Button
                  className="mt-3 w-full"
                  disabled={pendingAction === "change-email" || !newEmail.trim()}
                  type="submit"
                  variant="secondary"
                >
                  {pendingAction === "change-email" ? "Sending..." : "Start email change"}
                </Button>
              </form>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                This email comes from Google. To use another address, create a separate account.
              </p>
            )}
          </div>
        </details>

        <details className="rounded-[14px] border border-border/60 bg-background/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            Active sessions
            <span className="text-xs text-muted-foreground">
              {sessions.length} active
            </span>
          </summary>
          <div className="grid gap-2 border-t border-border/60 px-3.5 py-3">
            {currentSession ? (
              <SessionMobileRow
                current
                getSessionDeviceLabel={getSessionDeviceLabel}
                session={currentSession}
              />
            ) : null}
            {otherSessions.slice(0, 5).map((session) => (
              <SessionMobileRow
                getSessionDeviceLabel={getSessionDeviceLabel}
                key={session.id}
                session={session}
              />
            ))}
            {otherSessions.length > 5 ? (
              <p className="text-xs text-muted-foreground">
                {otherSessions.length - 5} older sessions hidden.
              </p>
            ) : null}
            <div className="mt-1 grid gap-2">
              {otherSessions.length > 0 ? (
                <Button
                  disabled={pendingAction === "revoke-other-sessions"}
                  onClick={onRevokeOtherSessions}
                  type="button"
                  variant="outline"
                >
                  Sign out others
                </Button>
              ) : null}
              <Button
                disabled={pendingAction === "revoke-sessions"}
                onClick={onRevokeAllSessions}
                type="button"
                variant="secondary"
              >
                Sign out everywhere
              </Button>
            </div>
          </div>
        </details>
      </div>

      <div className="hidden gap-4 md:grid">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Sign-in method</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {signInMethod
                  ? `${getProviderLabel(signInMethod.providerId)} is used for this account.`
                  : "No sign-in method was found for this account."}
              </p>
            </div>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </div>

          {signInMethod ? (
            <div className="mt-4 rounded-lg border border-border/60 bg-background/60 px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {getProviderLabel(signInMethod.providerId)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {formatDate(signInMethod.createdAt)}
                  </p>
                </div>
                <span className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
                  {hasPassword ? "Password enabled" : "Provider sign-in"}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {hasPassword ? (
          <form
            className="rounded-lg border border-border/60 bg-background/60 p-4"
            onSubmit={onChangePassword}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Change password</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Changing your password signs out other devices.
                </p>
              </div>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="mt-4 grid gap-3">
              <SecurityInput
                autoComplete="current-password"
                label="Current password"
                name="currentPassword"
                onChange={setCurrentPassword}
                type="password"
                value={currentPassword}
              />
              <SecurityInput
                autoComplete="new-password"
                label="New password"
                name="newPassword"
                onChange={setNewPassword}
                type="password"
                value={newPassword}
              />
              <SecurityInput
                autoComplete="new-password"
                label="Confirm password"
                name="confirmPassword"
                onChange={setConfirmPassword}
                type="password"
                value={confirmPassword}
              />
            </div>

            <Button
              className="mt-4"
              disabled={
                pendingAction === "change-password" ||
                currentPassword.length < 1 ||
                newPassword.length < 8
              }
              type="submit"
            >
              {pendingAction === "change-password" ? (
                <>
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Change password"
              )}
            </Button>
          </form>
        ) : (
          <div className="rounded-lg border border-border/60 bg-background/60 p-4">
            <p className="text-sm font-medium text-foreground">Password</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              This account signs in with Google. Password setup is not available because Google
              sign-in is kept separate from email/password registration.
            </p>
          </div>
        )}
      </div>

      {hasPassword ? (
        <form className="rounded-lg border border-border/60 bg-background/60 p-4" onSubmit={onChangeEmail}>
          <p className="text-sm font-medium text-foreground">Change email</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Your current email stays active until the new address is verified.
          </p>
          <div className="mt-4 grid gap-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Current: <span className="text-foreground">{email}</span>
            </div>
            <SecurityInput
              autoComplete="email"
              label="New email"
              name="newEmail"
              onChange={setNewEmail}
              type="email"
              value={newEmail}
            />
          </div>
          <Button
            className="mt-4"
            disabled={pendingAction === "change-email" || !newEmail.trim()}
            type="submit"
            variant="secondary"
          >
            {pendingAction === "change-email" ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              "Start email change"
            )}
          </Button>
        </form>
      ) : (
        <div className="rounded-lg border border-border/60 bg-background/60 p-4">
          <p className="text-sm font-medium text-foreground">Email</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This email comes from Google. To use a different email/password account, create a
            separate account with normal registration.
          </p>
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground">
            {email}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Active sessions</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {otherSessions.length > 0
                ? `${otherSessions.length} other signed-in ${otherSessions.length === 1 ? "device" : "devices"}.`
                : "Only this device is signed in."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {otherSessions.length > 0 ? (
              <Button
                disabled={pendingAction === "revoke-other-sessions"}
                onClick={onRevokeOtherSessions}
                type="button"
                variant="outline"
              >
                Sign out others
              </Button>
            ) : null}
            <Button
              disabled={pendingAction === "revoke-sessions"}
              onClick={onRevokeAllSessions}
              type="button"
              variant="secondary"
            >
              Sign out everywhere
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {currentSession ? (
            <div className="rounded-[14px] border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">This device</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {getSessionDeviceLabel(currentSession.userAgent)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Active {formatDate(currentSession.updatedAt)}
                </p>
              </div>
            </div>
          ) : null}

          {otherSessions.length > 0 ? (
            <div className="rounded-[14px] border border-border/60 bg-background/60">
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setShowOtherSessions((value) => !value)}
                type="button"
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Other sessions
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {otherSessions.length} active {otherSessions.length === 1 ? "session" : "sessions"}
                  </span>
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {showOtherSessions ? "Hide" : "Show"}
                </span>
              </button>

              {showOtherSessions ? (
                <div className="border-t border-border/60">
                  {visibleOtherSessions.map((session) => (
                    <div
                      className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                      key={session.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {getSessionDeviceLabel(session.userAgent)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last active {formatDate(session.updatedAt)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Expires {formatDate(session.expiresAt)}
                      </p>
                    </div>
                  ))}
                  {hiddenOtherSessionCount > 0 ? (
                    <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                      {hiddenOtherSessionCount} older {hiddenOtherSessionCount === 1 ? "session" : "sessions"} hidden.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}

function SessionMobileRow({
  current,
  getSessionDeviceLabel: getLabel,
  session,
}: {
  current?: boolean;
  getSessionDeviceLabel: (userAgent: string | null) => string;
  session: ActiveSession;
}) {
  return (
    <details
      className={`rounded-[12px] border px-3 py-2 ${
        current
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-border/60 bg-muted/20"
      }`}
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {current ? "This device" : getLabel(session.userAgent)}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {current ? getLabel(session.userAgent) : `Updated ${formatDate(session.updatedAt)}`}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Details</span>
        </div>
      </summary>
      <div className="mt-2 grid gap-1 border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">
        <p>Updated {formatDate(session.updatedAt)}</p>
        <p>Expires {formatDate(session.expiresAt)}</p>
        <p className="break-all">IP {session.ipAddress || "unknown"}</p>
        <p className="break-all">Browser {session.userAgent || "Unknown browser"}</p>
      </div>
    </details>
  );
}
