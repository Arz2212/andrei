import { InlineKeyboard, type Bot, type Context } from "grammy";
import {
  createStateCheckin,
  formatIsoDate,
  getOwnerBotDbClient,
  getOwnerProfile,
  getTodayOverview,
  getWaitingTasks,
  updateOwnerProfile,
} from "@life-os/db";
import { botConfig } from "./config";
import { replyFormatted, type TopicDomain } from "./telegram-helpers";

const VALID_DOMAINS: TopicDomain[] = ["assistant", "finance", "nutrition", "health", "journal"];

export function registerCommands(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    const lines = [
      "👋 **На связи — твой напарник Life OS.**",
      "",
      "Сюда можно кидать всё как есть:",
      "• **Текстом или голосом** — сумбурные мысли, список дел, разбор завала на неделе или траты одной фразой;",
      "• **Фото** — чеки, заметки, скрины переписок или документы;",
      "• Любые изменения плана и финансов я сначала пришлю аккуратной карточкой с кнопками **✅ Подтвердить / ✏️ Исправить / ❌ Отмена**.",
      "",
      "Быстрые команды:",
      "• `/today` — картина сегодняшнего дня, слоты и буфер",
      "• `/waiting` — от кого ждём ответ и когда напомнить",
      "• `/pulse` — отметить настроение и энергию в 1 тап",
      "• `/bind_topic <assistant|finance|nutrition|health|journal>` — привязать тему в супергруппе",
      "",
      `🌐 Веб-интерфейс и настройки: ${botConfig.appUrl}`,
    ];
    await replyFormatted(ctx, lines.join("\n"));
  });

  bot.command("help", async (ctx) => {
    await replyFormatted(
      ctx,
      [
        "**Команды и возможности Life OS:**",
        "• `/today` — главный фокус, слоты Утро/День/Вечер, буфер и Safe-to-Spend",
        "• `/waiting` — все зависшие ожидания ответа",
        "• `/pulse` (или `/pulse 4 5 бодрое утро`) — чекин состояния",
        "• `/bind_topic finance` — привязка текущего Топика супергруппы к разделу",
        "",
        "В свободной речи можно просто рассуждать вслух (я не буду лепить лишние задачи без спроса) или попросить разобрать завал.",
      ].join("\n")
    );
  });

  bot.command("today", async (ctx) => {
    const { db } = await getOwnerBotDbClient();
    const overview = await getTodayOverview(db);
    const plan = overview.dayPlan;
    const avail = plan?.available_minutes ?? 480;
    const buf = plan?.buffer_minutes ?? 90;

    const activeTasks = overview.todayTasks.filter(
      (t) => t.status !== "done" && t.status !== "cancelled"
    );
    const doneTasks = overview.todayTasks.filter((t) => t.status === "done");
    const scheduledMins = activeTasks.reduce((s, t) => s + (t.estimated_minutes ?? 30), 0);
    const freeNet = Math.max(avail - buf - scheduledMins, 0);

    const bySlot = (slot: string) =>
      overview.todayTasks
        .filter((t) => t.day_slot === slot && t.status !== "cancelled")
        .map(
          (t) =>
            `  ${t.status === "done" ? "☑️" : "⬜"} ${t.title}${t.estimated_minutes ? ` (${t.estimated_minutes}м)` : ""}`
        );

    const sections: string[] = [
      `🗓 **Сегодня · ${overview.todayDate}**`,
      `🎯 Фокус: **${plan?.main_focus || "не задан"}**`,
      `🛡 Буфер дня: **${buf} мин** · Свободный запас: **${freeNet} мин** (закрыто ${doneTasks.length}/${overview.todayTasks.length})`,
      "",
    ];

    for (const [slotKey, label] of [
      ["morning", "🌅 **Утро**"],
      ["afternoon", "☀️ **День**"],
      ["evening", "🌙 **Вечер**"],
      ["any", "📌 **В течение дня**"],
    ] as const) {
      const rows = bySlot(slotKey);
      if (rows.length > 0) {
        sections.push(label, ...rows, "");
      }
    }

    if (overview.todayTasks.length === 0) {
      sections.push("На сегодня задач пока нет — напиши или надиктуй голосом, что планируем.", "");
    }

    if (overview.financeSummary) {
      sections.push(
        `💳 Доступно для трат (Safe-to-Spend): **${Number(overview.financeSummary.safe_to_spend ?? 0).toLocaleString("ru-RU")} ₽**`
      );
    }

    await replyFormatted(ctx, sections.join("\n"));
  });

  bot.command("waiting", async (ctx) => {
    const { db } = await getOwnerBotDbClient();
    const list = await getWaitingTasks(db);
    if (list.length === 0) {
      await replyFormatted(ctx, "✨ Зависших ожиданий сейчас нет — никто ничего не задерживает.");
      return;
    }

    const lines = ["⏳ **Лист ожидания ответа:**", ""];
    list.forEach((t, i) => {
      const who = t.waiting_on_person || "не указан";
      const remind = t.follow_up_at ? ` · напомнить ${t.follow_up_at.slice(0, 10)}` : "";
      lines.push(`${i + 1}. **${t.title}**\n   Ждём: **${who}**${remind}`);
    });
    await replyFormatted(ctx, lines.join("\n"));
  });

  bot.command("pulse", async (ctx) => {
    const argText = (ctx.match ?? "").trim();
    const match = argText.match(/^([1-5])\s+([1-5])(?:\s+([\s\S]+))?$/);
    if (match) {
      const mood = Number(match[1]);
      const energy = Number(match[2]);
      const note = match[3]?.trim() || null;
      const { db, userId } = await getOwnerBotDbClient();
      await createStateCheckin(db, {
        user_id: userId,
        mood_score: mood,
        energy_score: energy,
        note,
        source: "telegram",
      });
      await replyFormatted(
        ctx,
        `✅ **Пульс записан:** настроение ${mood}/5 · энергия ${energy}/5${note ? `\n💬 ${note}` : ""}`
      );
      return;
    }

    const kb = new InlineKeyboard()
      .text("🙂 5 · ⚡ 5", "pulse:5:5")
      .text("🙂 4 · ⚡ 4", "pulse:4:4")
      .row()
      .text("😐 3 · ⚡ 3", "pulse:3:3")
      .text("🙂 4 · 🔋 2", "pulse:4:2")
      .row()
      .text("😕 2 · 🔋 2", "pulse:2:2")
      .text("🪫 2 · 🔋 1", "pulse:2:1");

    await replyFormatted(
      ctx,
      "Отметь текущее **настроение и энергию** в один тап (или напиши `/pulse 4 3 комментарий`):",
      kb
    );
  });

  bot.command("bind_topic", async (ctx) => {
    const domain = (ctx.match ?? "").trim().toLowerCase() as TopicDomain;
    const threadId = ctx.msg?.message_thread_id;

    if (!threadId) {
      await replyFormatted(
        ctx,
        "Эту команду нужно отправить **внутри нужной Темы (Топика)** приватной супергруппы.\nПример: `/bind_topic finance`"
      );
      return;
    }

    if (!VALID_DOMAINS.includes(domain)) {
      await replyFormatted(
        ctx,
        `Укажи раздел из списка: \`${VALID_DOMAINS.join(" | ")}\`\nНапример: \`/bind_topic finance\``
      );
      return;
    }

    const { db, userId } = await getOwnerBotDbClient();
    const profile = await getOwnerProfile(db);
    const currentMap =
      profile?.telegram_topic_map && typeof profile.telegram_topic_map === "object"
        ? (profile.telegram_topic_map as Record<string, number>)
        : {};

    const updatedMap = {
      ...currentMap,
      [domain]: threadId,
    };

    await updateOwnerProfile(db, userId, {
      telegram_forum_chat_id: ctx.chat.id,
      telegram_topic_map: updatedMap,
    });

    await replyFormatted(
      ctx,
      `✅ Топик \`#${threadId}\` привязан к разделу **${domain}** (группа \`${ctx.chat.id}\`, дата ${formatIsoDate()}).`
    );
  });
}
