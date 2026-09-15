import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { getPhase, type PhaseId } from "@/config/phases";

type PhasePlaceholderProps = {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly phase: PhaseId;
};

/**
 * The stand-in for a surface that exists in navigation but is not built yet.
 *
 * It states plainly which phase delivers the feature and what that phase will
 * bring. There are no disabled buttons, no greyed-out charts and no sample
 * data — a control that implies working functionality would be a lie.
 */
export function PhasePlaceholder({
  title,
  description,
  icon: Icon,
  phase,
}: PhasePlaceholderProps) {
  const { id, name, summary } = getPhase(phase);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="outline">Phase {id}</Badge>}
      />

      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={Icon}
          title={`${name} arrives in Phase ${id}`}
          description={summary}
        />
      </div>
    </div>
  );
}
