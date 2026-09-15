import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import { getServerEnv } from "@/config/env.server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { apiSuccess, withApiErrorHandling } from "@/server/api";
import { deriveDisplayName } from "@/server/auth";
import {
  deleteProfileByClerkUserId,
  provisionProfile,
} from "@/services/profile/profile.service";

/**
 * Clerk webhook receiver — the second half of user synchronisation.
 *
 * Just-in-time provisioning (see `ensureProfile`) already keeps profiles in
 * step for anyone who visits the app. This endpoint exists for the events
 * that happen while the user is NOT here:
 *
 *   • `user.deleted` — remove application data promptly rather than on their
 *     next sign-in, which by definition never comes.
 *   • `user.updated` — keep the mirrored email/avatar fresh.
 *
 * Optional: without `CLERK_WEBHOOK_SIGNING_SECRET` the route answers 503 and
 * the application still works correctly through just-in-time sync alone.
 *
 * SECURITY: the payload is entirely attacker-controlled until
 * `verifyWebhook()` has checked the Svix signature, so nothing is read from
 * the body before that call returns.
 */

export const dynamic = "force-dynamic";

const log = logger.child({ route: "webhooks.clerk" });

export const POST = withApiErrorHandling(
  "webhooks.clerk",
  async (request: NextRequest) => {
    const { CLERK_WEBHOOK_SIGNING_SECRET } = getServerEnv();

    if (!CLERK_WEBHOOK_SIGNING_SECRET) {
      log.warn("Webhook received but no signing secret is configured");

      throw new AppError({
        code: "INTERNAL",
        message: "CLERK_WEBHOOK_SIGNING_SECRET is not set",
        userMessage: "This endpoint is not configured.",
      });
    }

    let event: Awaited<ReturnType<typeof verifyWebhook>>;

    try {
      event = await verifyWebhook(request, {
        signingSecret: CLERK_WEBHOOK_SIGNING_SECRET,
      });
    } catch (error) {
      // An unverified payload is indistinguishable from a forged one.
      log.warn("Rejected webhook with an invalid signature", {
        detail: error instanceof Error ? error.message : "unknown",
      });

      throw new AppError({
        code: "UNAUTHORIZED",
        message: "Webhook signature verification failed",
        userMessage: "Invalid webhook signature.",
      });
    }

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const { id, email_addresses, primary_email_address_id, image_url } =
          event.data;

        const primaryEmail =
          email_addresses.find(
            (address) => address.id === primary_email_address_id,
          )?.email_address ?? null;

        await provisionProfile({
          clerkUserId: id,
          email: primaryEmail,
          displayName: deriveDisplayName({
            firstName: event.data.first_name,
            lastName: event.data.last_name,
            username: event.data.username,
            primaryEmailAddress: primaryEmail
              ? { emailAddress: primaryEmail }
              : null,
          }),
          avatarUrl: image_url || null,
        });

        break;
      }

      case "user.deleted": {
        // `id` is optional on this event in Clerk's types.
        if (event.data.id) {
          await deleteProfileByClerkUserId(event.data.id);
        }

        break;
      }

      default:
        // Clerk sends many event types; silently acknowledging the ones we do
        // not handle stops it from retrying them forever.
        log.debug("Ignoring unhandled webhook event", { type: event.type });
    }

    return apiSuccess({ received: true });
  },
);
