import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { TasksWorkspace } from "@/features/tasks/components/tasks-workspace";
import { requireProfileForPage } from "@/server/auth";
import { listTasks } from "@/services/task/task.query";
import { taskFiltersSchema } from "@/services/task/task.schema";

export const metadata: Metadata = {
  title: "Tasks",
};

/**
 * The task workspace.
 *
 * A Server Component: it resolves the session, parses the filters out of the
 * URL and does the query. Only the genuinely interactive parts hydrate.
 *
 * Filters come from `searchParams` and are parsed by the same Zod schema the
 * services use, so a hand-edited URL cannot produce an invalid query — a bad
 * value falls back to the default rather than erroring.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  const parsed = taskFiltersSchema.safeParse({
    status: params.status,
    priority: params.priority,
    category: params.category,
    date: params.date,
    sort: params.sort,
    search: params.search,
  });

  // An unparseable URL degrades to the default view rather than a 500.
  const filters = parsed.success ? parsed.data : taskFiltersSchema.parse({});

  const tasks = await listTasks(profile, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Everything you have captured. Press c to add another."
      />

      <TasksWorkspace tasks={tasks} filters={filters} />
    </div>
  );
}
