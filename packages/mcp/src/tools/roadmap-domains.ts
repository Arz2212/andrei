import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  formatIsoDate,
  getFinanceBalanceSummary,
  getOwnerBotDbClient,
} from "@life-os/db";
import { errResult, okResult, resolveDateInput } from "../helpers";

/**
 * Modular schemas & ready foundation tools for Stages 2–4:
 * - Stage 2: Finance (Safe-to-Spend, accounts, expenses/income, reimbursements, obligations)
 * - Stage 3: Nutrition & Shopping (recipes, pantry, shopping list) + Health (workouts, medical organizer)
 * - Stage 4: Goals & 1-Tap Habits
 */
export function registerStage2To4DomainTools(server: McpServer): void {
  // ==========================================================================
  // STAGE 2 FOUNDATION — FINANCE
  // ==========================================================================

  server.registerTool(
    "get_finance_overview",
    {
      title: "Сводка по финансам и Safe-to-Spend",
      description:
        "Возвращает баланс Safe-to-Spend (доступно для трат за вычетом обязательных платежей и резервов), счета, ближайшие подписки/платежи и последние операции.",
      inputSchema: {
        recent_limit: z.number().int().min(1).max(50).optional().describe("Сколько последних операций показать (по умолчанию 15)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const [summary, accountsRes, obligationsRes, txRes] = await Promise.all([
          getFinanceBalanceSummary(db),
          db
            .from("finance_accounts")
            .select("*")
            .eq("is_archived", false)
            .order("sort_order", { ascending: true }),
          db
            .from("finance_obligations")
            .select("*")
            .eq("is_active", true)
            .order("next_due_date", { ascending: true }),
          db
            .from("finance_transactions")
            .select("*")
            .order("occurred_at", { ascending: false })
            .limit(args.recent_limit ?? 15),
        ]);

        return okResult({
          ok: true,
          balance_summary: summary,
          accounts: accountsRes.data ?? [],
          upcoming_obligations: obligationsRes.data ?? [],
          recent_transactions: txRes.data ?? [],
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "record_finance_transaction",
    {
      title: "Записать расход или доход (с поддержкой рабочих компенсаций)",
      description:
        "Записывает финансовую операцию в базу и обновляет баланс счёта. Поддерживает отметку рабочих/общих трат с компенсацией (spend_nature), чтобы они не искажали личную аналитику.",
      inputSchema: {
        amount: z.number().positive().describe("Сумма операции"),
        kind: z
          .enum(["expense", "income", "reimbursement_in"])
          .optional()
          .describe("Тип операции: expense (по умолчанию), income, reimbursement_in"),
        description: z.string().min(1).max(500).describe("Описание покупки или поступления"),
        category: z.string().optional().describe("Название категории (опционально)"),
        account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Название счёта или ID (по умолчанию основной активный счёт)"),
        currency: z.string().length(3).optional().describe("Валюта ISO (по умолчанию RUB)"),
        spend_nature: z
          .enum(["personal", "work_reimbursable", "shared_reimbursable"])
          .optional()
          .describe("Характер траты: personal (личная), work_reimbursable (рабочая под возврат), shared_reimbursable (общая)"),
        reimbursable_amount: z
          .number()
          .min(0)
          .optional()
          .describe("Сумма к возврату/компенсации (для рабочих и общих покупок)"),
        reimbursement_counterparty: z
          .string()
          .max(200)
          .optional()
          .describe("Кто должен компенсировать (компания, партнёр, друг)"),
        occurred_at: z.string().optional().describe("Дата/время операции (ISO или YYYY-MM-DD)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const { data: accounts, error: accErr } = await db
          .from("finance_accounts")
          .select("*")
          .eq("is_archived", false)
          .order("sort_order", { ascending: true });
        if (accErr) throw accErr;
        if (!accounts || accounts.length === 0) {
          return errResult("Нет активных счетов в базе finance_accounts.");
        }

        const targetAcc =
          args.account !== undefined
            ? accounts.find(
                (a) =>
                  a.id === Number(args.account) ||
                  a.name.toLowerCase().includes(String(args.account).trim().toLowerCase())
              ) ?? accounts[0]
            : accounts[0];

        const kind = args.kind ?? "expense";
        let categoryId: number | null = null;
        if (args.category?.trim()) {
          const catKind = kind === "income" ? "income" : "expense";
          const { data: cats } = await db
            .from("finance_categories")
            .select("*")
            .eq("kind", catKind);
          const q = args.category.trim().toLowerCase();
          const matched = (cats ?? []).find(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.voice_aliases ?? []).some((al) => al.toLowerCase().includes(q))
          );
          if (matched) categoryId = matched.id;
        }

        const spendNature = args.spend_nature ?? "personal";
        const reimbursable =
          spendNature === "personal"
            ? 0
            : args.reimbursable_amount ?? (spendNature === "work_reimbursable" ? args.amount : args.amount / 2);

        const { data: tx, error: txErr } = await db
          .from("finance_transactions")
          .insert({
            user_id: userId,
            account_id: targetAcc.id,
            category_id: categoryId,
            kind,
            amount: args.amount,
            currency: (args.currency ?? targetAcc.currency ?? "RUB").toUpperCase(),
            occurred_at: args.occurred_at ? new Date(args.occurred_at).toISOString() : new Date().toISOString(),
            description: args.description.trim(),
            spend_nature: spendNature,
            personal_share_amount: kind === "expense" ? Math.max(0, args.amount - reimbursable) : null,
            reimbursable_amount: reimbursable,
            reimbursement_counterparty: args.reimbursement_counterparty?.trim() || null,
            reimbursement_status: reimbursable > 0 ? "pending" : "not_applicable",
            source: "telegram_text",
          })
          .select("*")
          .single();
        if (txErr) throw txErr;

        const delta = kind === "expense" ? -args.amount : args.amount;
        await db
          .from("finance_accounts")
          .update({ balance: Number(targetAcc.balance) + delta })
          .eq("id", targetAcc.id);

        return okResult({ ok: true, transaction: tx, account_name: targetAcc.name });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // STAGE 3 FOUNDATION — NUTRITION, PANTRY & SHOPPING LIST + HEALTH
  // ==========================================================================

  server.registerTool(
    "get_nutrition_overview",
    {
      title: "Обзор меню, запасов дома и списка покупок",
      description:
        "Возвращает активный список покупок, дефицит ингредиентов под план меню (v_meal_plan_missing_ingredients), запасы дома и план блюд.",
      inputSchema: {
        date: z.string().optional().describe("Дата плана питания YYYY-MM-DD (по умолчанию сегодня)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
        const [shoppingRes, pantryRes, mealsRes, missingRes] = await Promise.all([
          db
            .from("shopping_list_items")
            .select("*")
            .eq("is_checked", false)
            .order("aisle_group", { ascending: true }),
          db.from("pantry_items").select("*").order("display_name", { ascending: true }),
          db.from("meal_plan_entries").select("*").eq("plan_date", dateStr),
          db.from("v_meal_plan_missing_ingredients").select("*"),
        ]);

        return okResult({
          ok: true,
          date: dateStr,
          shopping_list: shoppingRes.data ?? [],
          missing_for_planned_meals: missingRes.data ?? [],
          pantry_items: pantryRes.data ?? [],
          meals_for_date: mealsRes.data ?? [],
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "manage_shopping_list",
    {
      title: "Управление списком покупок",
      description: "Добавление позиции в список покупок, отметка купленного или удаление по названию.",
      inputSchema: {
        action: z.enum(["list", "add", "check", "uncheck", "delete"]),
        item_name: z.string().max(250).optional().describe("Название продукта для add или текстового поиска"),
        quantity_needed: z.number().positive().optional().describe("Количество (по умолчанию 1)"),
        unit: z.string().max(30).optional().describe("Единица измерения: pcs, g, ml, pack"),
        aisle_group: z.string().max(80).optional().describe("Отдел магазина (Овощи, Молочное, Бакалея и т.д.)"),
        item_id: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const { data, error } = await db
            .from("shopping_list_items")
            .select("*")
            .order("is_checked", { ascending: true })
            .order("created_at", { ascending: false });
          if (error) throw error;
          return okResult({ ok: true, items: data ?? [] });
        }

        if (args.action === "add") {
          if (!args.item_name?.trim()) return errResult("Укажи `item_name`.");
          const name = args.item_name.trim();
          const { data, error } = await db
            .from("shopping_list_items")
            .insert({
              user_id: userId,
              ingredient_key: name.toLowerCase(),
              display_name: name,
              quantity_needed: args.quantity_needed ?? 1,
              unit: args.unit ?? "pcs",
              aisle_group: args.aisle_group ?? "Прочее",
              added_from: "telegram",
            })
            .select("*")
            .single();
          if (error) throw error;
          return okResult({ ok: true, item: data });
        }

        const { data: all } = await db.from("shopping_list_items").select("*");
        const target = args.item_id
          ? (all ?? []).find((i) => i.id === args.item_id)
          : args.item_name?.trim()
            ? (all ?? []).find((i) =>
                i.display_name.toLowerCase().includes(args.item_name!.trim().toLowerCase())
              )
            : undefined;
        if (!target) return errResult("Позиция в списке покупок не найдена.");

        if (args.action === "delete") {
          await db.from("shopping_list_items").delete().eq("id", target.id);
          return okResult({ ok: true, deleted: target });
        }

        const checked = args.action === "check";
        const { data: upd, error: uErr } = await db
          .from("shopping_list_items")
          .update({ is_checked: checked })
          .eq("id", target.id)
          .select("*")
          .single();
        if (uErr) throw uErr;
        return okResult({ ok: true, item: upd });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "get_health_overview",
    {
      title: "Обзор тренировок и медицинских дел",
      description:
        "Возвращает ближайшие плавающие окна тренировок, последние медицинские записи и невыполненные контрольные шаги по здоровью.",
      inputSchema: {},
    },
    async () => {
      try {
        const { db } = await getOwnerBotDbClient();
        const today = formatIsoDate();
        const [workoutsRes, followUpsRes, recordsRes] = await Promise.all([
          db
            .from("workout_sessions")
            .select("*")
            .gte("window_end_date", today)
            .order("window_start_date", { ascending: true })
            .limit(10),
          db.from("medical_follow_ups").select("*").eq("is_done", false),
          db
            .from("medical_records")
            .select("*")
            .order("record_date", { ascending: false })
            .limit(5),
        ]);

        return okResult({
          ok: true,
          upcoming_workouts: workoutsRes.data ?? [],
          open_medical_follow_ups: followUpsRes.data ?? [],
          recent_medical_records: recordsRes.data ?? [],
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "schedule_workout_window",
    {
      title: "Запланировать или отметить тренировку (плавающее окно)",
      description: "Создаёт тренировку с плавающим окном дат (window_start_date..window_end_date) и предпочтительным слотом дня.",
      inputSchema: {
        title: z.string().min(1).max(250).describe("Название тренировки (например, 'Силовая Верх' или 'Кардио')"),
        window_start_date: z.string().optional().describe("Начало окна YYYY-MM-DD или today/tomorrow"),
        window_end_date: z.string().optional().describe("Конец окна YYYY-MM-DD (по умолчанию совпадает с началом)"),
        planned_date: z.string().nullable().optional().describe("Конкретный выбранный день внутри окна"),
        preferred_slot: z.enum(["morning", "afternoon", "evening", "flexible"]).optional(),
        duration_minutes: z.number().int().min(10).max(300).optional(),
        status: z.enum(["planned", "completed", "skipped"]).optional(),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const wStart = resolveDateInput(args.window_start_date) ?? formatIsoDate();
        const wEnd = resolveDateInput(args.window_end_date) ?? wStart;
        const { data, error } = await db
          .from("workout_sessions")
          .insert({
            user_id: userId,
            title: args.title.trim(),
            window_start_date: wStart,
            window_end_date: wEnd,
            planned_date: resolveDateInput(args.planned_date) ?? wStart,
            preferred_slot: args.preferred_slot ?? "flexible",
            duration_minutes: args.duration_minutes ?? 60,
            status: args.status ?? "planned",
            completed_at: args.status === "completed" ? new Date().toISOString() : null,
            notes: args.notes?.trim() || null,
          })
          .select("*")
          .single();
        if (error) throw error;
        return okResult({ ok: true, workout_session: data });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // STAGE 4 FOUNDATION — GOALS & 1-TAP HABITS
  // ==========================================================================

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
          db.from("goals").select("*").eq("status", "active").order("created_at", { ascending: false }),
          db.from("habits").select("*").eq("is_archived", false).order("sort_order", { ascending: true }),
          db.from("habit_logs").select("*").eq("logged_date", dateStr),
        ]);

        const doneIds = new Set((logsRes.data ?? []).filter((l) => l.completed).map((l) => l.habit_id));
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
        completed: z.boolean().optional().describe("true — выполнено (по умолчанию), false — снять отметку"),
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
