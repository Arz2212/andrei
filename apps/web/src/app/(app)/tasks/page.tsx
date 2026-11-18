import {
  formatIsoDate,
  getDayPlan,
  getOwnerProfile,
  listGoalsWithDetails,
  listProjects,
  listTasks,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { TasksView } from "@/components/modules/tasks-view";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const { db } = await requireOwnerSession();
  const profile = await getOwnerProfile(db);
  const todayDate = formatIsoDate(
    new Date(),
    profile?.timezone ?? "Europe/Moscow"
  );

  const [tasks, projects, dayPlan, goals] = await Promise.all([
    listTasks(db, { includeDone: true }),
    listProjects(db, false),
    getDayPlan(db, todayDate),
    listGoalsWithDetails(db, { status: "all" }),
  ]);

  return (
    <TasksView
      todayDate={todayDate}
      initialTab={params.tab || "today"}
      tasks={tasks}
      projects={projects}
      goals={goals}
      dayPlan={dayPlan}
      defaultAvailableMinutes={profile?.default_available_minutes ?? 480}
      defaultBufferMinutes={profile?.daily_buffer_minutes ?? 90}
    />
  );
}
