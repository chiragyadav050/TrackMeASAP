"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { completeTourCommand } from "@/features/settings/actions";
import { TOUR_STEPS, type TourStep } from "@/features/tour/tour-steps";

/**
 * The first-run walkthrough.
 *
 * WHAT IT IS NOT: a modal sequence that describes the product in the abstract.
 * Each step points at a real control the user can see, because the thing worth
 * teaching is where to look, not what the feature is called.
 *
 * DISMISSAL IS PERMANENT AND SERVER-SIDE. `tourCompletedAt` is stamped on the
 * profile, so finishing on a laptop means it does not reappear on a phone.
 * Skipping counts as finishing — a tour that comes back after you closed it is
 * an annoyance, not an onboarding aid.
 *
 * MISSING TARGETS ARE SKIPPED, NOT FAKED. The sidebar is hidden below `lg`, so
 * on a narrow screen several steps have nothing to point at. Rendering a
 * highlight over empty space would be worse than saying less.
 */

type Rect = { top: number; left: number; width: number; height: number };

/** Where a step's target currently is, or null when it is not on screen. */
function measure(target: string): Rect | null {
  const node = document.querySelector(`[data-tour="${target}"]`);

  if (!node) {
    return null;
  }

  const rect = node.getBoundingClientRect();

  // A zero-sized box means the element is present but not laid out — hidden
  // behind a breakpoint, for instance. Treat it as absent.
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Steps whose targets actually exist right now. */
function visibleSteps(): readonly TourStep[] {
  return TOUR_STEPS.filter((step) => measure(step.target) !== null);
}

export function ProductTour() {
  const [steps, setSteps] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // MEASURED AFTER PAINT, deliberately. Which steps have targets is a fact
  // about the rendered DOM, so it cannot be known during render — and setting
  // it synchronously inside the effect would run before layout has settled as
  // well as triggering a cascading render. `requestAnimationFrame` is the
  // right primitive for "once the browser has drawn", not a workaround.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSteps(visibleSteps()));

    return () => cancelAnimationFrame(frame);
  }, []);

  const step = steps[index];

  // Re-measured on scroll and resize because the highlight is drawn in
  // viewport coordinates: without this it detaches from its target the moment
  // the page moves.
  useEffect(() => {
    if (!step) {
      return;
    }

    const update = (): void => setRect(measure(step.target));

    // Same reason as above: the first measurement waits for paint rather than
    // reading layout in the middle of an effect.
    const frame = requestAnimationFrame(update);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  // Focus moves to the panel so the tour is operable by keyboard from the
  // moment it opens, and so a screen reader announces it rather than leaving
  // focus on whatever was behind.
  useEffect(() => {
    if (step) {
      panelRef.current?.focus();
    }
  }, [step]);

  const finish = useCallback((): void => {
    // Dismissed locally first: the user should never wait on a round-trip to
    // close something they have already decided about.
    setIsDismissed(true);
    void completeTourCommand({});
  }, []);

  const next = useCallback((): void => {
    if (index < steps.length - 1) {
      setIndex(index + 1);
      return;
    }

    finish();
  }, [index, steps.length, finish]);

  // Escape closes it, like any other overlay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        finish();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  if (isDismissed || !step || !rect) {
    return null;
  }

  // Below the target when there is room, above it otherwise. Clamped to the
  // viewport so the panel is never half off-screen on a small display.
  const PANEL_WIDTH = 320;
  const GAP = 12;

  const below = rect.top + rect.height + GAP;
  const fitsBelow = below + 180 < window.innerHeight;

  const top = fitsBelow ? below : Math.max(GAP, rect.top - 180 - GAP);
  const left = Math.min(
    Math.max(GAP, rect.left),
    Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP),
  );

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {/*
        The scrim is click-to-dismiss, which is what people try first. It sits
        behind the cutout so the highlighted control stays legible.
      */}
      <button
        type="button"
        className="absolute inset-0 bg-foreground/50"
        onClick={finish}
        aria-label="Close the tour"
        tabIndex={-1}
      />

      {/*
        The highlight. `outline` rather than a border so it cannot change the
        target's layout, and a huge spread shadow to lift it out of the scrim
        without a second overlay element.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-lg outline-2 outline-offset-4 outline-brand transition-all duration-200 motion-reduce:transition-none"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.0)",
        }}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={{ top, left }}
      >
        <p className="text-label font-medium text-muted-foreground">
          {index + 1} of {steps.length}
        </p>

        <h2
          id="tour-title"
          className="mt-1 text-meta font-semibold tracking-tight"
        >
          {step.title}
        </h2>

        <p className="mt-1.5 text-label text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>

          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIndex(index - 1)}
              >
                Back
              </Button>
            ) : null}

            <Button type="button" size="sm" onClick={next}>
              {index === steps.length - 1 ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
