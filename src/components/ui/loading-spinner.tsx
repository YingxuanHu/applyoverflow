"use client";

import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export function LoadingSpinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cn("animate-spin motion-reduce:animate-none", className)} />;
}
