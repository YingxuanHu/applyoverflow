import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationProvider } from "@/components/ui/notification-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const appIconVersion = "20260531-large-favicon";
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ApplyOverflow — Job Search & Application Engine",
  description:
    "Find fresher, higher-quality jobs and keep every application step organized.",
  applicationName: "ApplyOverflow",
  icons: {
    icon: [
      {
        url: `/brand/applyoverflow-favicon.png?v=${appIconVersion}`,
        type: "image/png",
        sizes: "512x512",
      },
    ],
    shortcut: [`/brand/applyoverflow-favicon.png?v=${appIconVersion}`],
    apple: [
      {
        url: `/brand/applyoverflow-favicon.png?v=${appIconVersion}`,
        type: "image/png",
        sizes: "512x512",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>
            <NotificationProvider>
              <AppShell>{children}</AppShell>
            </NotificationProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
