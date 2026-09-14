"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateTrackedApplicationForm } from "@/components/dashboard/create-tracked-application-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ApplicationsOverviewBar() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Add application
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>Add application</DialogTitle>
        <DialogDescription>
          Keep an application from any source in your tracker.
        </DialogDescription>
        <CreateTrackedApplicationForm onCreated={() => setIsOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
