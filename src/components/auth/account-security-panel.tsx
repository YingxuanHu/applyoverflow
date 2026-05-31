"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

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
  googleEnabled: boolean;
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
  googleEnabled,
  sessions,
}: AccountSecurityPanelProps) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("");

  const credentialAccount = useMemo(
    () => accounts.find((account) => account.providerId === "credential"),
    [accounts]
  );
  const googleAccount = useMemo(
    () => accounts.find((account) => account.providerId === "google"),
    [accounts]
  );
  const hasPassword = Boolean(credentialAccount?.hasPassword);

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

  async function onSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupPassword !== setupPasswordConfirm) {
      showError("Passwords do not match.");
      return;
    }

    setPendingAction("set-password");
    const result = await fetch("/api/account/password/set", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newPassword: setupPassword }),
    });
    setPendingAction(null);

    if (!result.ok) {
      showError("Unable to add a password right now. Sign in again and try once more.");
      return;
    }

    setSetupPassword("");
    setSetupPasswordConfirm("");
    notify({
      tone: "success",
      title: "Password added",
      message: "You can now sign in with email and password.",
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

  async function onDisconnectGoogle() {
    if (!googleAccount) return;

    setPendingAction("disconnect-google");
    const result = await authClient.unlinkAccount({
      providerId: "google",
      accountId: googleAccount.accountId,
    });
    setPendingAction(null);

    if (result.error) {
      showError("Google could not be disconnected. Keep at least one sign-in method on the account.");
      return;
    }

    notify({
      tone: "success",
      title: "Google disconnected",
      message: "Your account remains available through your other sign-in method.",
    });
    router.refresh();
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
    <div className="mt-4 grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="rounded-lg border border-border/60 bg-background/60 p-4"
          onSubmit={hasPassword ? onChangePassword : onSetPassword}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {hasPassword ? "Change password" : "Add password"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {hasPassword
                  ? "Changing your password signs out other devices."
                  : "Add a password to a Google-only account."}
              </p>
            </div>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-4 grid gap-3">
            {hasPassword ? (
              <SecurityInput
                autoComplete="current-password"
                label="Current password"
                name="currentPassword"
                onChange={setCurrentPassword}
                type="password"
                value={currentPassword}
              />
            ) : null}
            <SecurityInput
              autoComplete="new-password"
              label="New password"
              name="newPassword"
              onChange={hasPassword ? setNewPassword : setSetupPassword}
              type="password"
              value={hasPassword ? newPassword : setupPassword}
            />
            <SecurityInput
              autoComplete="new-password"
              label="Confirm password"
              name="confirmPassword"
              onChange={hasPassword ? setConfirmPassword : setSetupPasswordConfirm}
              type="password"
              value={hasPassword ? confirmPassword : setupPasswordConfirm}
            />
          </div>

          <Button
            className="mt-4"
            disabled={
              pendingAction === "change-password" ||
              pendingAction === "set-password" ||
              (hasPassword ? currentPassword.length < 1 || newPassword.length < 8 : setupPassword.length < 8)
            }
            type="submit"
          >
            {pendingAction === "change-password" || pendingAction === "set-password" ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : hasPassword ? (
              "Change password"
            ) : (
              "Add password"
            )}
          </Button>
        </form>

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
      </div>

      <div className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Connected accounts</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              One user can have multiple sign-in methods. OAuth accounts are linked by verified provider identity.
            </p>
          </div>
          {googleEnabled && !googleAccount ? (
            <div className="w-full sm:w-44">
              <GoogleAuthButton
                callbackUrl="/settings?google=linked"
                mode="link"
                onError={showError}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2">
          {accounts.map((account) => (
            <div
              className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              key={account.id}
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  {getProviderLabel(account.providerId)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Connected {formatDate(account.createdAt)}
                </p>
              </div>
              {account.providerId === "google" ? (
                <Button
                  disabled={pendingAction === "disconnect-google"}
                  onClick={onDisconnectGoogle}
                  type="button"
                  variant="outline"
                >
                  Disconnect
                </Button>
              ) : (
                <span className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
                  {account.hasPassword ? "Password enabled" : "No password"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-background/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Active sessions</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Review signed-in devices and revoke sessions you do not recognize.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pendingAction === "revoke-other-sessions"}
              onClick={onRevokeOtherSessions}
              type="button"
              variant="outline"
            >
              Sign out other devices
            </Button>
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

        <div className="mt-4 grid gap-2">
          {sessions.map((session) => (
            <div
              className={cn(
                "rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm",
                session.id === currentSessionId && "border-emerald-500/30 bg-emerald-500/5"
              )}
              key={session.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {session.id === currentSessionId ? "Current session" : "Signed-in device"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Updated {formatDate(session.updatedAt)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {session.userAgent || "Unknown browser"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                IP {session.ipAddress || "unknown"} · Expires {formatDate(session.expiresAt)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
