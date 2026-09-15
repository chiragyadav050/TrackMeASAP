import type { Metadata } from "next";

import { AiConsole } from "@/features/ai/components/ai-console";
import { db } from "@/server/db";
import { requireProfileForPage } from "@/server/auth";
import { getUsageToday, isAgentAvailable } from "@/services/ai/agent.service";
import { toolCount } from "@/services/ai/tool-registry";

export const metadata: Metadata = {
  title: "AI",
};

/**
 * The AI surface.
 *
 * Availability is resolved on the SERVER, so the page can say plainly that no
 * model is connected rather than offering an input that silently fails.
 */
export default async function AiPage() {
  const profile = await requireProfileForPage();

  // Also registers the tools, so `toolCount()` is accurate.
  const isAvailable = isAgentAvailable();

  const [usage, memories] = await Promise.all([
    getUsageToday(profile, new Date()),
    db.aIMemory.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, kind: true, content: true },
    }),
  ]);

  return (
    <AiConsole
      status={{ isAvailable, toolCount: toolCount(), usage }}
      memories={memories}
    />
  );
}
