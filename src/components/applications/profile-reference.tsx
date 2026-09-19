"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ApplicationProfileReference, ReferenceField } from "@/lib/application-profile-reference";

export function ProfileReference({ reference }: { reference: ApplicationProfileReference }) {
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const attempt = useRef(0);
  function renderFields(items: ReferenceField[], prefix: string) {
    return <dl className="divide-y divide-border/50">
      {items.map(({ label, value }, index) => {
        const key = `${prefix}-${index}`;
        return <div key={key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] gap-x-3 py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="col-start-1 row-start-2 min-w-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{value}</dd>
          <div className="col-start-2 row-span-2 row-start-1">
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Copy ${label.toLowerCase()}`} onClick={async () => {
                const current = ++attempt.current;
                try {
                  await navigator.clipboard.writeText(value);
                  if (current !== attempt.current) return;
                  setCopied(key);
                  setMessage(`${label} copied.`);
                } catch {
                  if (current !== attempt.current) return;
                  setCopied("");
                  setMessage(`Could not copy ${label.toLowerCase()}. Select the text and copy it manually.`);
                }
              }} />}>
                {copied === key ? <Check className="size-4" /> : <Copy className="size-4" />}
              </TooltipTrigger>
              <TooltipContent>Copy {label.toLowerCase()}</TooltipContent>
            </Tooltip>
          </div>
        </div>;
      })}
    </dl>;
  }
  return <details className="group/reference min-w-0 border-y py-4">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
      Profile reference
      <ChevronDown className="size-4 shrink-0 transition-transform group-open/reference:rotate-180" />
    </summary>
    <div className="mt-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs defaultValue="contact" className="w-full min-w-0" onValueChange={() => {
          attempt.current++;
          setCopied("");
          setMessage("");
        }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList variant="line" aria-label="Profile sections">
              <TabsTrigger value="contact">Contact</TabsTrigger>
              <TabsTrigger value="experience">Work</TabsTrigger>
              <TabsTrigger value="education">Education</TabsTrigger>
            </TabsList>
            <Link href="/profile" target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Edit profile</Link>
          </div>
          <TabsContent value="contact">
            {reference.contact.length ? renderFields(reference.contact, "contact") : <p className="py-4 text-muted-foreground">No contact details saved.</p>}
          </TabsContent>
          {(["experience", "education"] as const).map((section) => <TabsContent value={section} key={section}>
            {!reference[section].length && <p className="py-4 text-muted-foreground">No {section === "experience" ? "work experience" : "education"} saved.</p>}
            <div className="divide-y">
              {reference[section].map((entry, index) => <details key={`${section}-${index}`} className="group/entry py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <p className="font-medium">{entry.title}</p>
                    {entry.subtitle && <p className="mt-1 text-muted-foreground">{entry.subtitle}</p>}
                    {entry.dates && <p className="mt-1 text-xs text-muted-foreground">{entry.dates}</p>}
                  </div>
                  <ChevronDown className="size-4 shrink-0 transition-transform group-open/entry:rotate-180" />
                </summary>
                {renderFields(entry.fields, `${section}-${index}`)}
              </details>)}
            </div>
          </TabsContent>)}
        </Tabs>
      </div>
      <p role="status" className="min-h-6 pt-2 text-xs text-muted-foreground">{message}</p>
    </div>
  </details>;
}
