import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createStateCheckin,
  deleteDailyReview,
  deleteStateCheckin,
  extractLocalTimeParts,
  formatIsoDate,
  getDailyReview,
  getOwnerBotDbClient,
  getStateCheckin,
  listDailyReviews,
  listEveningCriteria,
  listStateCheckins,
  updateStateCheckin,
  upsertDailyReview,
  type StateCheckin,
  type TypedSupabaseClient,
} from "@life-os/db";
import { DEFAULT_TIMEZONE, errResult, okResult, resolveDateInput } from "../helpers";

async function resolveTargetCheckin(
  db: TypedSupabaseClient,
  params: {
    checkin_id?: number;
    use_latest?: boolean;
    date?: string;
    query?: string;
  }
): Promise<{ checkin?: StateCheckin; error?: string }> {
  if (params.checkin_id) {
    const found = await getStateCheckin(db, params.checkin_id);
    return found ? { checkin: found } : { error: `Отметка состояния id=${params.checkin_id} не найдена.` };
  }

  const recent = await listStateCheckins(db, 40);
  if (recent.length === 0) {
    return { error: "В дневнике пока нет ни одной отметки состояния." };
  }

  let pool = recent;
  const targetDate = resolveDateInput(params.date);
  if (targetDate) {
    pool = pool.filter(
      (c) => extractLocalTimeParts(c.logged_at, DEFAULT_TIMEZONE).dateStr === targetDate
    );
  }

  if (params.query?.trim()) {
    const q = params.query.trim().toLowerCase();
    pool = pool.filter(
      (c) =>
        (c.note ?? "").toLowerCase().includes(q) ||
        (c.context_tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  if (pool.length === 0) {
    return { error: "Не найдена подходящая отметка состояния по указанной дате/заметке." };
  }

  if (params.use_latest !== false || pool.length === 1) {
    return { checkin: pool[0] };
  }

  return { checkin: pool[0] };
}

export function registerJournalAndStateTools(server: McpServer): void {
  server.registerTool(
    "get_state_summary",
    {
      title: "Сводка состояния, пульса и вечернего дневника",
      description:
        "Возвращает последние отметки настроения/энергии/напряжения (1–10), средние показатели, вечерние раздельные оценки дня и настроенные на сайте правила оценки.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Конкретная дата YYYY-MM-DD или today/yesterday для проверки вечерней оценки"),
        limit: z.number().int().min(1).max(60).optional().describe("Сколько последних отметок пульса вернуть (по умолчанию 15)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const targetDate = resolveDateInput(args.date) ?? formatIsoDate();
        const [checkins, dateReview, recentReviews, criteria] = await Promise.all([
          listStateCheckins(db, args.limit ?? 15),
          getDailyReview(db, targetDate),
          listDailyReviews(db, 10),
          listEveningCriteria(db),
        ]);

        const avgEnergy =
          checkins.length > 0
            ? Number(
                (checkins.reduce((acc, c) => acc + c.energy_score, 0) / checkins.length).toFixed(1)
              )
            : null;
        const avgMood =
          checkins.length > 0
            ? Number(
                (checkins.reduce((acc, c) => acc + c.mood_score, 0) / checkins.length).toFixed(1)
              )
            : null;

        return okResult({
          ok: true,
          date: targetDate,
          stats: {
            checkins_count: checkins.length,
            avg_energy: avgEnergy,
            avg_mood: avgMood,
          },
          latest_checkin: checkins[0] ?? null,
          checkins: checkins.map((c) => {
            const msk = extractLocalTimeParts(c.logged_at, DEFAULT_TIMEZONE);
            return {
              ...c,
              logged_msk: `${msk.dateStr} ${msk.timeStr}`,
            };
          }),
          date_evening_review: dateReview,
          recent_evening_reviews: recentReviews,
          active_scoring_criteria: criteria.filter((c) => c.is_active),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "log_state_checkin",
    {
      title: "Записать пульс состояния (энергия и настроение 1–10)",
      description:
        "Добавляет быструю отметку самочувствия, энергии, настроения и напряжения (шкала 1–10) с факторами и заметкой.",
      inputSchema: {
        energy_score: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("Оценка энергии от 1 до 10"),
        mood_score: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("Оценка настроения от 1 до 10"),
        tension_score: z
          .number()
          .int()
          .min(1)
          .max(10)
          .nullable()
          .optional()
          .describe("Оценка внутреннего напряжения/стресса от 1 до 10 (опционально)"),
        factors: z
          .array(z.string().min(1).max(50))
          .optional()
          .describe("Факторы/теги состояния (например: ['выспался', 'после тренировки', 'перегруз созвонами'])"),
        note: z.string().max(2000).nullable().optional().describe("Заметка о текущем состоянии или мыслях"),
        logged_at: z.string().optional().describe("Опциональное время отметки (ISO), по умолчанию сейчас"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const created = await createStateCheckin(db, {
          user_id: userId,
          energy_score: args.energy_score,
          mood_score: args.mood_score,
          tension_score: args.tension_score ?? null,
          context_tags: args.factors ?? [],
          note: args.note?.trim() || null,
          logged_at: args.logged_at ? new Date(args.logged_at).toISOString() : undefined,
          source: "mcp",
        });
        return okResult({ ok: true, checkin: created });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "update_state_checkin",
    {
      title: "Отредактировать отметку пульса дня",
      description:
        "Изменяет последнюю отметку состояния (по умолчанию) либо отметку по дате/заметке/ID.",
      inputSchema: {
        checkin_id: z.number().int().positive().optional().describe("Опциональный ID отметки"),
        use_latest: z
          .boolean()
          .optional()
          .describe("Редактировать самую свежую отметку (по умолчанию true, если не указан checkin_id)"),
        date: z.string().optional().describe("Дата YYYY-MM-DD или today/yesterday"),
        query: z.string().optional().describe("Поиск по тексту заметки или фактору"),
        energy_score: z.number().int().min(1).max(10).optional(),
        mood_score: z.number().int().min(1).max(10).optional(),
        tension_score: z.number().int().min(1).max(10).nullable().optional(),
        factors: z.array(z.string().min(1).max(50)).optional().describe("Обновить список факторов"),
        note: z.string().max(2000).nullable().optional().describe("Обновить заметку"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveTargetCheckin(db, {
          checkin_id: args.checkin_id,
          use_latest: args.use_latest ?? true,
          date: args.date,
          query: args.query,
        });
        if (resolved.error || !resolved.checkin) {
          return errResult(resolved.error ?? "Отметка не найдена");
        }

        const updated = await updateStateCheckin(db, resolved.checkin.id, {
          energy_score: args.energy_score,
          mood_score: args.mood_score,
          tension_score: args.tension_score,
          context_tags: args.factors,
          note: args.note !== undefined ? args.note?.trim() || null : undefined,
        });
        return okResult({ ok: true, checkin: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "delete_state_checkin",
    {
      title: "Удалить отметку пульса дня",
      description: "Удаляет отметку состояния по ID, заметке/дате или самую последнюю (use_latest: true).",
      inputSchema: {
        checkin_id: z.number().int().positive().optional(),
        use_latest: z.boolean().optional().describe("Удалить последнюю отметку"),
        date: z.string().optional(),
        query: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveTargetCheckin(db, {
          checkin_id: args.checkin_id,
          use_latest: args.use_latest ?? false,
          date: args.date,
          query: args.query,
        });
        if (resolved.error || !resolved.checkin) {
          return errResult(resolved.error ?? "Отметка для удаления не найдена.");
        }
        await deleteStateCheckin(db, resolved.checkin.id);
        return okResult({ ok: true, deleted_id: resolved.checkin.id });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "upsert_evening_review",
    {
      title: "Сохранить или обновить вечернюю раздельную оценку дня",
      description:
        "Создаёт или обновляет вечерний чекин за выбранную дату (строго одна запись на дату: при повторном вызове обновляет существующую оценку). Оценки по сферам — от 1 до 10 (на сайте по умолчанию 1–5 или согласно критериям).",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Дата оценки YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        tasks_score: z.number().int().min(1).max(10).nullable().optional().describe("Оценка дня по задачам"),
        health_score: z.number().int().min(1).max(10).nullable().optional().describe("Оценка дня по здоровью/сну/спорту"),
        nutrition_score: z.number().int().min(1).max(10).nullable().optional().describe("Оценка дня по питанию"),
        habits_score: z.number().int().min(1).max(10).nullable().optional().describe("Оценка дня по привычкам"),
        custom_scores: z
          .record(z.string(), z.number().min(1).max(10))
          .optional()
          .describe("Дополнительные пользовательские метрики дня"),
        day_highlight: z
          .string()
          .max(2000)
          .nullable()
          .optional()
          .describe("Что сегодня получилось хорошо / победа дня"),
        what_drained_energy: z
          .string()
          .max(2000)
          .nullable()
          .optional()
          .describe("Что забрало лишнюю энергию или мешало"),
        tomorrow_main_thing: z
          .string()
          .max(1000)
          .nullable()
          .optional()
          .describe("Главный шаг на завтра"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const reviewDate = resolveDateInput(args.date) ?? formatIsoDate();
        const existing = await getDailyReview(db, reviewDate);

        const saved = await upsertDailyReview(db, {
          user_id: userId,
          review_date: reviewDate,
          tasks_score:
            args.tasks_score !== undefined ? args.tasks_score : existing?.tasks_score ?? null,
          health_score:
            args.health_score !== undefined ? args.health_score : existing?.health_score ?? null,
          nutrition_score:
            args.nutrition_score !== undefined
              ? args.nutrition_score
              : existing?.nutrition_score ?? null,
          habits_score:
            args.habits_score !== undefined ? args.habits_score : existing?.habits_score ?? null,
          custom_scores:
            args.custom_scores ??
            ((existing?.custom_scores as Record<string, number> | null) ?? {}),
          day_highlight:
            args.day_highlight !== undefined
              ? args.day_highlight?.trim() || null
              : existing?.day_highlight ?? null,
          what_drained_energy:
            args.what_drained_energy !== undefined
              ? args.what_drained_energy?.trim() || null
              : existing?.what_drained_energy ?? null,
          tomorrow_main_thing:
            args.tomorrow_main_thing !== undefined
              ? args.tomorrow_main_thing?.trim() || null
              : existing?.tomorrow_main_thing ?? null,
        });

        return okResult({
          ok: true,
          mode: existing ? "updated_existing" : "created",
          evening_review: saved,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "delete_evening_review",
    {
      title: "Удалить вечернюю оценку дня",
      description: "Удаляет вечерний чекин за выбранную дату (по умолчанию сегодня по МСК) или по ID.",
      inputSchema: {
        date: z.string().optional().describe("Дата YYYY-MM-DD или today/yesterday"),
        review_id: z.number().int().positive().optional().describe("Опциональный ID записи"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const target = args.review_id ?? resolveDateInput(args.date) ?? formatIsoDate();
        await deleteDailyReview(db, target);
        return okResult({ ok: true, deleted_target: target });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
