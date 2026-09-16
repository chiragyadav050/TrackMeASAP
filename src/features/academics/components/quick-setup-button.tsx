"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AcademicStep } from "@/features/onboarding/academic-step";

/**
 * Semester and subjects in one pass, opened from the place they are missed.
 *
 * This used to be a step in onboarding, which was the wrong place for it: it
 * made everyone pay for a setup only students with an active term need, before
 * they had seen anything the product does. Here it costs one tap, and only the
 * people who actually hit the wall ever see it.
 *
 * It still creates the semester AND its subjects together, which is the reason
 * it exists at all — the alternative is a semester form, then a subject form,
 * then a subject form again.
 */
export function QuickSetupButton() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button size="sm" onClick={() => setIsOpen(true)}>
        Set up in ten seconds
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Set up your semester</DialogTitle>
            <DialogDescription>
              Create the current semester and its subjects.
            </DialogDescription>
          </DialogHeader>

          <AcademicStep
            onDone={() => {
              setIsOpen(false);
              // The page is a Server Component reading the semester it just
              // gained, so it has to be re-fetched rather than re-rendered.
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
