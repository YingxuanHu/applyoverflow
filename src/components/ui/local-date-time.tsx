"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function LocalDateTime({ value }: { value: string | Date }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <>Unknown</>;

  // Use the same initial text in both runtimes, then show the viewer's zone.
  const label = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(hydrated ? {} : { timeZone: "UTC" }),
  }).format(date);

  return <time dateTime={date.toISOString()}>{label}{hydrated ? "" : " UTC"}</time>;
}
