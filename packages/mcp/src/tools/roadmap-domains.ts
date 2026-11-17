import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatIsoDate, getOwnerBotDbClient } from "@life-os/db";
import { errResult, okResult, resolveDateInput } from "../helpers";

/**
 * Foundation tools for Stage 4:
 * - Goals & 1-Tap Habits
 */
export function registerStage4DomainTools(server: McpServer): void {
  server.registerTool(
    "get_goals_and_habits",
    {
      title: "Сводка целей и привычек",
      description: "Возвращает активные цели с прогрессом и трекеры привычек с отметками за сегодня.",
      inputSchema: {
        date: z.string().optional().describe("Дата для проверки привычек YYYY-MM-DD (по умолчанию сегодня)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
        const [goalsRes, habitsRes, logsRes] = await Promise.all([
          db
            .from("goals")
            .select("*")
            .eq("status", "active")
            .order("created_at", { ascending: false }),
          db
            .from("habits")
            .select("*")
            .eq("is_archived", false)
            .order("sort_order", { ascending: true }),
          db.from("habit_logs").select("*").eq("logged_date", dateStr),
        ]);

        const doneIds = new Set(
          (logsRes.data ?? []).filter((l) => l.completed).map((l) => l.habit_id)
        );
        return okResult({
          ok: true,
          date: dateStr,
          goals: goalsRes.data ?? [],
          habits: (habitsRes.data ?? []).map((h) => ({
            ...h,
            completed_on_date: doneIds.has(h.id),
          })),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "log_habit_checkin",
    {
      title: "Отметить привычку (по названию или ID)",
      description: "Отмечает выполнение привычки за выбранный день (или снимает отметку).",
      inputSchema: {
        query: z.string().optional().describe("Название привычки (например, 'вода', 'шаги', 'чтение')"),
        habit_id: z.number().int().positive().optional(),
        date: z.string().optional().describe("Дата YYYY-MM-DD (по умолчанию сегодня)"),
        completed: z
          .boolean()
          .optional()
          .describe("true — выполнено (по умолчанию), false — снять отметку"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
        const { data: habits, error: hErr } = await db
          .from("habits")
          .select("*")
          .eq("is_archived", false);
        if (hErr) throw hErr;

        const target = args.habit_id
          ? (habits ?? []).find((h) => h.id === args.habit_id)
          : args.query?.trim()
            ? (habits ?? []).find((h) =>
                h.title.toLowerCase().includes(args.query!.trim().toLowerCase())
              )
            : undefined;
        if (!target) {
          return errResult("Привычка не найдена. Вызови get_goals_and_habits для списка привычек.");
        }

        const completed = args.completed ?? true;
        if (!completed) {
          await db
            .from("habit_logs")
            .delete()
            .eq("habit_id", target.id)
            .eq("logged_date", dateStr);
          return okResult({ ok: true, habit: target.title, date: dateStr, completed: false });
        }

        const { data: logRow, error: lErr } = await db
          .from("habit_logs")
          .upsert(
            {
              user_id: userId,
              habit_id: target.id,
              logged_date: dateStr,
              completed: true,
              source: "telegram",
            },
            { onConflict: "habit_id,logged_date" }
          )
          .select("*")
          .single();
        if (lErr) throw lErr;
        return okResult({ ok: true, habit: target.title, log: logRow });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
