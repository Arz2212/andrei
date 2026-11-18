import {
  addDaysToIsoDate,
  escapeTelegramHtml,
  extractLocalTimeParts,
  formatTaskTimeRange,
  getAssistantSettings,
  getDailyReview,
  getLifeAnalyticsSummary,
  getOwnerProfile,
  getTodayOverview,
  hasDigestBeenSentForDate,
  listFinanceAccounts,
  listFinanceDebts,
  listFinanceObligations,
  recordDigestSentForDate,
  resolveDefaultTelegramChatId,
  resolveNotifyTelegramIds,
  type AssistantSettings,
  type DaySlot,
  type MealSlot,
  type Task,
  type TypedSupabaseClient,
  type WorkoutPreferredSlot,
} from "@life-os/db";
import { sendTelegramPushFanout } from "./telegram-push";

const SLOT_LABELS: Record<DaySlot, string> = {
  morning: "☀️ Утро",
  afternoon: "🌤 День",
  evening: "🌙 Вечер",
  any: "📌 Гибко",
};

const WORKOUT_SLOT_LABELS: Record<WorkoutPreferredSlot, string> = {
  morning: "утро",
  afternoon: "день",
  evening: "вечер",
  flexible: "гибкое окно",
};

const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
  cook_ahead: "Заготовка",
};

const MEAL_SLOT_ORDER: Record<MealSlot, number> = {
  breakfast: 1,
  lunch: 2,
  snack: 3,
  dinner: 4,
  cook_ahead: 5,
};

function parseHhMmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const clean = hhmm.trim().slice(0, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(clean);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function getIsoWeekdayFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay; // 1 = Monday .. 7 = Sunday
}

function formatRussianDayHeader(dateStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(anchor);
}

function formatShortDayMonth(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}`;
}

function formatDurationCompact(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 мин";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function formatMoneyAmount(amount: number | string | null | undefined, currency = "RUB"): string {
  const raw = Number(amount ?? 0);
  const num = Number.isFinite(raw) ? raw : 0;
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(num) ? 0 : 2,
  }).format(num);
  const symbol =
    currency === "RUB" ? "₽" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;
  return `${formatted} ${symbol}`;
}

function formatRelativeDueLabel(dueDate: string, todayDate: string, tomorrowDate: string): string {
  if (dueDate < todayDate) return "просрочено";
  if (dueDate === todayDate) return "сегодня";
  if (dueDate === tomorrowDate) return "завтра";
  return dueDate;
}

export async function buildMorningDigestHtml(
  db: TypedSupabaseClient,
  todayDate: string,
  timeZone: string,
  appUrl: string
): Promise<string> {
  const tomorrowDate = addDaysToIsoDate(todayDate, 1);
  const [overview, obligations, accounts, openDebts] = await Promise.all([
    getTodayOverview(db, todayDate),
    listFinanceObligations(db, false),
    listFinanceAccounts(db, false),
    listFinanceDebts(db, "open"),
  ]);

  const activeTasks = overview.todayTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );
  const timedTasks = activeTasks.filter((t) => Boolean(t.scheduled_start_at));
  const flexibleTasks = activeTasks.filter((t) => !t.scheduled_start_at);

  const totalPlannedMins = activeTasks.reduce(
    (acc, t) => acc + (t.estimated_minutes ?? (t.is_meeting ? 60 : 30)),
    0
  );
  const bufferMins =
    overview.dayPlan?.buffer_minutes ?? overview.profile?.daily_buffer_minutes ?? 90;

  const lines: string[] = [
    `☀️ <b>Утренняя сводка · ${escapeTelegramHtml(formatRussianDayHeader(todayDate, timeZone))}</b>`,
  ];

  if (overview.dayPlan?.main_focus) {
    lines.push(`\n🎯 <b>Фокус дня:</b> ${escapeTelegramHtml(overview.dayPlan.main_focus)}`);
  }

  if (activeTasks.length > 0) {
    lines.push(
      `⏱ В плане: <b>${formatDurationCompact(totalPlannedMins)}</b> · защитный резерв <b>${formatDurationCompact(bufferMins)}</b>`
    );
  }

  if (
    accounts.length > 0 &&
    overview.financeSummary &&
    overview.financeSummary.safe_to_spend !== null
  ) {
    const baseCurrency = overview.profile?.base_currency || "RUB";
    lines.push(
      `💳 Доступно для трат: <b>${escapeTelegramHtml(
        formatMoneyAmount(overview.financeSummary.safe_to_spend, baseCurrency)
      )}</b>`
    );
  }

  if (timedTasks.length > 0) {
    const meetingLines = timedTasks.slice(0, 8).map((t) => {
      const range = formatTaskTimeRange(t, timeZone) ?? "ко времени";
      return `• <code>${escapeTelegramHtml(range)}</code> — ${escapeTelegramHtml(t.title)}`;
    });
    lines.push(`\n🗓 <b>Ко времени (${timedTasks.length}):</b>\n${meetingLines.join("\n")}`);
  }

  if (flexibleTasks.length > 0) {
    const flexLines = flexibleTasks.slice(0, 8).map((t) => {
      const slot = SLOT_LABELS[(t.day_slot as DaySlot) || "any"] ?? "📌";
      const mins = t.estimated_minutes ? ` <i>(${t.estimated_minutes} м)</i>` : "";
      return `• ${slot}: ${escapeTelegramHtml(t.title)}${mins}`;
    });
    lines.push(`\n📋 <b>Гибкие слоты (${flexibleTasks.length}):</b>\n${flexLines.join("\n")}`);
  }

  if (timedTasks.length === 0 && flexibleTasks.length === 0) {
    lines.push(
      `\n✨ <b>План на сегодня пока свободен</b> — напиши в чат главную задачу дня или добавь слот на сайте.`
    );
  }

  // Stage 4: Compact Habits & Goals section
  const habitsSummary = overview.habitsSummary;
  const goalsSummary = overview.goalsSummary;
  if (
    (habitsSummary && habitsSummary.totalCount > 0) ||
    (goalsSummary && goalsSummary.activeCount > 0)
  ) {
    const hgLines: string[] = [];

    if (habitsSummary && habitsSummary.totalCount > 0) {
      const morningTitles = habitsSummary.items
        .filter((h) => !h.completedOnAnchorDate && h.preferred_slot === "morning")
        .slice(0, 3)
        .map((h) => escapeTelegramHtml(h.title));
      const morningHint =
        morningTitles.length > 0 ? ` <i>(утро: ${morningTitles.join(", ")})</i>` : "";
      hgLines.push(
        `🔁 Привычки на день: <b>${habitsSummary.doneCount}/${habitsSummary.totalCount}</b>${morningHint}`
      );
    }

    if (goalsSummary && goalsSummary.activeCount > 0) {
      const stalledGoal = goalsSummary.items.find((g) => g.progress.isStalled);
      if (stalledGoal) {
        hgLines.push(
          `⚠️ Цель без открытого шага: <b>${escapeTelegramHtml(stalledGoal.title)}</b> (<code>${stalledGoal.progress.progressPct}%</code>)`
        );
      } else {
        const topGoal = goalsSummary.items[0];
        if (topGoal) {
          hgLines.push(
            `🧭 Цель в фокусе: <b>${escapeTelegramHtml(topGoal.title)}</b> (<code>${topGoal.progress.progressPct}%</code>)`
          );
        }
      }
    }

    if (hgLines.length > 0) {
      lines.push(`\n${hgLines.join("\n")}`);
    }
  }

  // Stage 3: Today's floating workout windows & planned meals
  const todayWorkouts = (overview.activeWorkoutWindows ?? []).filter(
    (w) =>
      w.status === "planned" &&
      (w.planned_date === todayDate ||
        (w.window_start_date <= todayDate && w.window_end_date >= todayDate))
  );

  if (todayWorkouts.length > 0) {
    const workoutParts = todayWorkouts.slice(0, 2).map((w) => {
      const slotHint =
        WORKOUT_SLOT_LABELS[(w.preferred_slot as WorkoutPreferredSlot) || "flexible"] ??
        "гибкое окно";
      const windowHint =
        w.window_end_date > todayDate
          ? `, окно до ${formatShortDayMonth(w.window_end_date)}`
          : w.window_end_date === todayDate && w.window_start_date < todayDate
            ? ", крайний день окна"
            : "";
      return `<b>${escapeTelegramHtml(w.title)}</b> <i>(${slotHint}${windowHint})</i>`;
    });
    lines.push(`\n🏋️ Тренировка: ${workoutParts.join(" · ")}`);
  }

  const activeMeals = [...(overview.todayMeals ?? [])]
    .filter((m) => m.status !== "skipped")
    .sort(
      (a, b) =>
        (MEAL_SLOT_ORDER[(a.meal_slot as MealSlot) || "dinner"] ?? 9) -
        (MEAL_SLOT_ORDER[(b.meal_slot as MealSlot) || "dinner"] ?? 9)
    );

  if (activeMeals.length > 0 || (overview.uncheckedShoppingItems?.length ?? 0) > 0) {
    const mealSnippets = activeMeals.slice(0, 4).map((m) => {
      const slotName = MEAL_SLOT_LABELS[(m.meal_slot as MealSlot) || "dinner"] ?? m.meal_slot;
      const title = m.recipe?.title || m.custom_meal_title || "Блюдо";
      return `${slotName}: <b>${escapeTelegramHtml(title)}</b>`;
    });
    const shoppingCount = overview.uncheckedShoppingItems?.length ?? 0;
    const shoppingTail = shoppingCount > 0 ? ` · 🛒 купить: <b>${shoppingCount}</b>` : "";
    if (mealSnippets.length > 0) {
      lines.push(`\n🍽 Меню: ${mealSnippets.join(" · ")}${shoppingTail}`);
    } else if (shoppingCount > 0) {
      lines.push(`\n🛒 Список покупок: <b>${shoppingCount} поз.</b>`);
    }
  }

  // Stage 2: Finance deadlines due today or tomorrow
  const financeAlertLines: string[] = [];

  for (const ob of obligations) {
    if (ob.is_active && ob.next_due_date <= tomorrowDate) {
      const dueTag = formatRelativeDueLabel(ob.next_due_date, todayDate, tomorrowDate);
      const kindIcon = ob.obligation_kind === "subscription" ? "🔁" : "🧾";
      financeAlertLines.push(
        `• ${kindIcon} ${escapeTelegramHtml(ob.title)} (<i>${dueTag}</i>) — <code>${escapeTelegramHtml(
          formatMoneyAmount(ob.amount, ob.currency)
        )}</code>`
      );
    }
  }

  for (const acc of accounts) {
    const debt = Number(acc.statement_debt ?? 0);
    if (
      acc.account_type === "credit_card" &&
      debt > 0 &&
      acc.grace_period_due_date &&
      acc.grace_period_due_date <= tomorrowDate
    ) {
      const dueTag = formatRelativeDueLabel(acc.grace_period_due_date, todayDate, tomorrowDate);
      financeAlertLines.push(
        `• 💳 Грейс по карте «${escapeTelegramHtml(acc.name)}» (<i>${dueTag}</i>) — <code>${escapeTelegramHtml(
          formatMoneyAmount(debt, acc.currency)
        )}</code>`
      );
    }
  }

  for (const debtItem of openDebts) {
    const rem = Number(debtItem.remaining_amount ?? 0);
    if (
      debtItem.direction === "i_owe" &&
      rem > 0 &&
      debtItem.due_date &&
      debtItem.due_date <= tomorrowDate
    ) {
      const dueTag = formatRelativeDueLabel(debtItem.due_date, todayDate, tomorrowDate);
      financeAlertLines.push(
        `• 🤝 Долг «${escapeTelegramHtml(debtItem.title)}» (${escapeTelegramHtml(
          debtItem.counterparty
        )}, <i>${dueTag}</i>) — <code>${escapeTelegramHtml(
          formatMoneyAmount(rem, debtItem.currency)
        )}</code>`
      );
    }
  }

  if (financeAlertLines.length > 0) {
    lines.push(
      `\n💸 <b>Платежи и грейс (сегодня / завтра):</b>\n${financeAlertLines.slice(0, 6).join("\n")}`
    );
  }

  const dueWaiting = overview.waitingTasks.filter((w) => {
    if (!w.follow_up_at) return false;
    const followDate = extractLocalTimeParts(w.follow_up_at, timeZone).dateStr;
    return followDate <= todayDate;
  });

  if (dueWaiting.length > 0) {
    const waitLines = dueWaiting.slice(0, 4).map((w) => {
      const who = w.waiting_on_person ? ` (${escapeTelegramHtml(w.waiting_on_person)})` : "";
      return `• ${escapeTelegramHtml(w.title)}${who}`;
    });
    lines.push(`\n⏳ <b>Пора пингануть (${dueWaiting.length}):</b>\n${waitLines.join("\n")}`);
  }

  lines.push(`\n🔗 <a href="${escapeTelegramHtml(appUrl)}">Открыть план в Life OS</a>`);
  return lines.join("\n");
}

export async function buildEveningReviewNudgeHtml(
  db: TypedSupabaseClient,
  todayDate: string,
  timeZone: string,
  appUrl: string
): Promise<string> {
  const overview = await getTodayOverview(db, todayDate);
  const doneTasks: Task[] = overview.todayTasks.filter((t) => t.status === "done");
  const openTasks: Task[] = overview.todayTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );

  const lines: string[] = [
    `🌙 <b>Вечернее подведение итогов · ${escapeTelegramHtml(formatRussianDayHeader(todayDate, timeZone))}</b>`,
  ];

  if (doneTasks.length > 0 || openTasks.length > 0) {
    lines.push(
      `\n✅ Задачи за день: закрыто <b>${doneTasks.length}</b> · осталось открытых: <b>${openTasks.length}</b>`
    );
  } else {
    lines.push(
      `\n✨ Задач в плане на сегодня не было — можно спокойно отметить состояние и главный шаг на завтра.`
    );
  }

  const habitsSummary = overview.habitsSummary;
  if (habitsSummary && habitsSummary.totalCount > 0) {
    lines.push(
      `🔁 Привычки сегодня: <b>${habitsSummary.doneCount} из ${habitsSummary.totalCount}</b>`
    );

    const remainingHabits = [...habitsSummary.items]
      .filter(
        (h) =>
          !h.completedOnAnchorDate &&
          (h.cadence === "daily" || h.thisWeekDone < h.thisWeekTarget)
      )
      .sort((a, b) => {
        const aEve = a.preferred_slot === "evening" ? 0 : 1;
        const bEve = b.preferred_slot === "evening" ? 0 : 1;
        return aEve - bEve || a.sort_order - b.sort_order;
      })
      .slice(0, 3);

    if (remainingHabits.length > 0) {
      const remLines = remainingHabits.map((h) => `• ${escapeTelegramHtml(h.title)}`);
      lines.push(`Не забудь отметить:\n${remLines.join("\n")}`);
    }
  }

  lines.push(
    `\nНадиктуй короткие итоги в чат или отметь на сайте:`,
    `🔗 <a href="${escapeTelegramHtml(`${appUrl}/journal`)}">Вечерняя оценка</a> · <a href="${escapeTelegramHtml(`${appUrl}/goals`)}">Привычки</a>`
  );

  return lines.join("\n");
}

export async function buildWeeklyDigestHtml(
  db: TypedSupabaseClient,
  todayDate: string,
  timeZone: string,
  appUrl: string
): Promise<string> {
  const summary = await getLifeAnalyticsSummary(db, todayDate, 7, timeZone);
  const rangeLabel = `${formatShortDayMonth(summary.startDate)}–${formatShortDayMonth(summary.endDate)}`;

  const isCleanSlate =
    summary.tasks.completedCount === 0 &&
    summary.tasks.openCount === 0 &&
    summary.habits.todayTotal === 0 &&
    summary.goals.activeCount === 0;

  const lines: string[] = [
    `🧭 <b>Итоги недели · Life OS (${escapeTelegramHtml(rangeLabel)})</b>`,
  ];

  if (isCleanSlate) {
    lines.push(
      `\n✨ <b>Чистый старт новой недели!</b>\nЗадай 1–2 главные цели, пару ежедневных привычек и ключевые встречи недели в чате или на сайте.`
    );
  } else {
    lines.push(
      `\n✅ <b>Задачи (7 дн.):</b> закрыто <b>${summary.tasks.completedCount}</b>` +
        (summary.tasks.completedCount > 0 || summary.tasks.openCount > 0
          ? ` · выполнение плана <b>${summary.tasks.focusCompletionRatePct}%</b>`
          : "")
    );

    if (summary.habits.todayTotal > 0) {
      const streakTail = summary.habits.topStreakHabit
        ? ` · 🔥 «${escapeTelegramHtml(summary.habits.topStreakHabit.title)}» (${summary.habits.topStreakHabit.currentStreak} дн.)`
        : "";
      lines.push(
        `🔁 <b>Привычки:</b> стабильность <b>${summary.habits.adherenceWindowPct}%</b>${streakTail}`
      );
    }

    if (
      summary.healthAndNutrition.workoutsCompletedThisWeek > 0 ||
      summary.healthAndNutrition.openWorkoutWindowsCount > 0
    ) {
      lines.push(
        `🏋️ <b>Тренировки недели:</b> <b>${summary.healthAndNutrition.workoutsCompletedThisWeek} из ${summary.healthAndNutrition.workoutsTargetThisWeek}</b>`
      );
    }

    if (summary.goals.activeCount > 0) {
      lines.push(
        `🎯 <b>Активные цели (${summary.goals.activeCount}):</b> средний прогресс <b>${summary.goals.avgProgressPct}%</b>`
      );
      if (summary.goals.stalledGoals.length > 0) {
        const stalledTitles = summary.goals.stalledGoals
          .slice(0, 2)
          .map((g) => `«${escapeTelegramHtml(g.title)}»`)
          .join(", ");
        lines.push(`⚠️ Нужен следующий шаг: ${stalledTitles}`);
      }
    }

    const topInsights = summary.proactiveInsights.slice(0, 2);
    if (topInsights.length > 0) {
      const insightLines = topInsights.map((ins) => {
        const icon =
          ins.severity === "attention" ? "🔸" : ins.severity === "positive" ? "✨" : "💡";
        return `${icon} <b>${escapeTelegramHtml(ins.title)}</b> — ${escapeTelegramHtml(ins.description)}`;
      });
      lines.push(`\n<b>Фокус напарника:</b>\n${insightLines.join("\n")}`);
    }
  }

  lines.push(
    `\n🔗 <a href="${escapeTelegramHtml(`${appUrl}/goals`)}">Цели и аналитика</a> · <a href="${escapeTelegramHtml(`${appUrl}/tasks?tab=week`)}">План новой недели</a>`
  );

  return lines.join("\n");
}

export class DigestCheckController {
  private sentLocks = new Set<string>();
  private cachedSettings: AssistantSettings | null = null;
  private lastSettingsFetchMs = 0;

  invalidateSettingsCache(): void {
    this.lastSettingsFetchMs = 0;
  }

  async checkAndSendDigests(params: {
    db: TypedSupabaseClient;
    userId: string;
    botToken: string;
    fallbackChatId: number;
    appUrl: string;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    if (!this.cachedSettings || Date.now() - this.lastSettingsFetchMs > 55_000) {
      this.cachedSettings = await getAssistantSettings(params.db);
      this.lastSettingsFetchMs = Date.now();
    }

    const settings = this.cachedSettings;
    if (!settings || !settings.proactive_reminders_enabled) {
      return;
    }

    const profile = await getOwnerProfile(params.db);
    const timeZone = profile?.timezone || "Europe/Moscow";
    const targetChatIds = resolveNotifyTelegramIds(profile);
    const primaryRecordChatId = resolveDefaultTelegramChatId(
      profile?.telegram_user_id ?? params.fallbackChatId
    );

    const localNow = extractLocalTimeParts(now.toISOString(), timeZone);
    const nowMinutesOfDay = localNow.hour * 60 + localNow.minute;
    const todayDate = localNow.dateStr;

    // 1) Morning Digest
    const morningTargetMins = parseHhMmToMinutes(settings.morning_digest_time);
    if (
      morningTargetMins !== null &&
      nowMinutesOfDay >= morningTargetMins &&
      nowMinutesOfDay <= morningTargetMins + 15
    ) {
      const lockKey = `morning_digest:${todayDate}`;
      if (!this.sentLocks.has(lockKey)) {
        const alreadySent = await hasDigestBeenSentForDate(
          params.db,
          "morning_digest",
          todayDate
        );
        if (alreadySent) {
          this.sentLocks.add(lockKey);
        } else {
          this.sentLocks.add(lockKey);
          try {
            const html = await buildMorningDigestHtml(
              params.db,
              todayDate,
              timeZone,
              params.appUrl
            );
            const res = await sendTelegramPushFanout({
              botToken: params.botToken,
              chatIds: targetChatIds,
              htmlText: html,
            });
            await recordDigestSentForDate(params.db, {
              userId: params.userId,
              entityType: "morning_digest",
              dateStr: todayDate,
              messageText: html,
              telegramChatId: primaryRecordChatId,
              status: "sent",
              metadata: {
                date: todayDate,
                delivered_chats: res.delivered.map((d) => d.chatId),
                skipped_uninitiated: res.skippedUninitiated.map((s) => s.chatId),
              },
            });
            console.info(
              `[notifier] Sent morning_digest for ${todayDate} to [${res.delivered.map((d) => d.chatId).join(", ")}]`
            );
          } catch (err) {
            this.sentLocks.delete(lockKey);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifier] Failed morning_digest for ${todayDate}:`, msg);
          }
        }
      }
    }

    // 2) Proactive Weekly Digest
    const isoWeekday = getIsoWeekdayFromDateStr(todayDate);
    const targetReviewDay = settings.weekly_review_day || 7;
    const eveningTargetMins = parseHhMmToMinutes(settings.evening_review_time);
    const weeklyTargetMins =
      eveningTargetMins !== null ? Math.max(0, eveningTargetMins - 30) : 20 * 60 + 30;

    if (
      isoWeekday === targetReviewDay &&
      nowMinutesOfDay >= weeklyTargetMins &&
      nowMinutesOfDay <= weeklyTargetMins + 15
    ) {
      const lockKey = `weekly_digest:${todayDate}`;
      if (!this.sentLocks.has(lockKey)) {
        const alreadySent = await hasDigestBeenSentForDate(
          params.db,
          "weekly_digest",
          todayDate
        );
        if (alreadySent) {
          this.sentLocks.add(lockKey);
        } else {
          this.sentLocks.add(lockKey);
          try {
            const html = await buildWeeklyDigestHtml(
              params.db,
              todayDate,
              timeZone,
              params.appUrl
            );
            const res = await sendTelegramPushFanout({
              botToken: params.botToken,
              chatIds: targetChatIds,
              htmlText: html,
            });
            await recordDigestSentForDate(params.db, {
              userId: params.userId,
              entityType: "weekly_digest",
              dateStr: todayDate,
              messageText: html,
              telegramChatId: primaryRecordChatId,
              status: "sent",
              metadata: {
                date: todayDate,
                delivered_chats: res.delivered.map((d) => d.chatId),
                skipped_uninitiated: res.skippedUninitiated.map((s) => s.chatId),
              },
            });
            console.info(
              `[notifier] Sent weekly_digest for ${todayDate} to [${res.delivered.map((d) => d.chatId).join(", ")}]`
            );
          } catch (err) {
            this.sentLocks.delete(lockKey);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifier] Failed weekly_digest for ${todayDate}:`, msg);
          }
        }
      }
    }

    // 3) Evening Review Nudge
    if (
      eveningTargetMins !== null &&
      nowMinutesOfDay >= eveningTargetMins &&
      nowMinutesOfDay <= eveningTargetMins + 15
    ) {
      const lockKey = `evening_review:${todayDate}`;
      if (!this.sentLocks.has(lockKey)) {
        const [alreadySent, existingReview] = await Promise.all([
          hasDigestBeenSentForDate(params.db, "evening_review", todayDate),
          getDailyReview(params.db, todayDate),
        ]);

        if (alreadySent || existingReview) {
          this.sentLocks.add(lockKey);
        } else {
          this.sentLocks.add(lockKey);
          try {
            const html = await buildEveningReviewNudgeHtml(
              params.db,
              todayDate,
              timeZone,
              params.appUrl
            );
            const res = await sendTelegramPushFanout({
              botToken: params.botToken,
              chatIds: targetChatIds,
              htmlText: html,
            });
            await recordDigestSentForDate(params.db, {
              userId: params.userId,
              entityType: "evening_review",
              dateStr: todayDate,
              messageText: html,
              telegramChatId: primaryRecordChatId,
              status: "sent",
              metadata: {
                date: todayDate,
                delivered_chats: res.delivered.map((d) => d.chatId),
                skipped_uninitiated: res.skippedUninitiated.map((s) => s.chatId),
              },
            });
            console.info(
              `[notifier] Sent evening_review nudge for ${todayDate} to [${res.delivered.map((d) => d.chatId).join(", ")}]`
            );
          } catch (err) {
            this.sentLocks.delete(lockKey);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifier] Failed evening_review nudge for ${todayDate}:`, msg);
          }
        }
      }
    }
  }
}
