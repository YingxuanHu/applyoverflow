"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type GoogleAuthButtonProps = {
  callbackUrl?: string;
  mode?: "sign-in" | "sign-up";
  onError?: (message: string) => void;
};

export function GoogleAuthButton({
  callbackUrl = "/jobs",
  mode = "sign-in",
  onError,
}: GoogleAuthButtonProps) {
  const [pending, setPending] = useState(false);

  async function startGoogleFlow() {
    setPending(true);
    const errorCallbackURL = "/sign-in?google=error";

    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackUrl,
      errorCallbackURL,
      disableRedirect: true,
    });

    if (result.error) {
      setPending(false);
      onError?.("Google authentication failed. Try again.");
      return;
    }

    if (result.data?.url) {
      window.location.assign(result.data.url);
      return;
    }

    setPending(false);
  }

  const label = mode === "sign-up" ? "Sign up with Google" : "Continue with Google";

  return (
    <Button
      className="h-11 w-full rounded-full border-[#cfd8dc] bg-white text-base font-semibold text-black shadow-none hover:bg-[#f8fafd] dark:border-[#cfd8dc] dark:bg-white dark:text-black dark:hover:bg-[#f8fafd]"
      disabled={pending}
      onClick={startGoogleFlow}
      type="button"
      variant="outline"
    >
      {pending ? (
        <>
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <svg
            aria-hidden="true"
            className="size-5"
            focusable="false"
            viewBox="0 0 18 18"
          >
            <path
              d="M17.64 9.204c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.909c1.702-1.567 2.683-3.874 2.683-6.615Z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.467-.806 5.957-2.18l-2.909-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18Z"
              fill="#34A853"
            />
            <path
              d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.594.103-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.581C13.463.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.162 6.656 3.58 9 3.58Z"
              fill="#EA4335"
            />
          </svg>
          {label}
        </>
      )}
    </Button>
  );
}
