import {
  extractLocalTimeParts,
  formatTaskTimeRange,
  type DaySlot,
  type TaskStatus,
} from "@life-os/db";

const SLOT_LABELS: Record<DaySlot, string> = {
  morning: "🌅 Утро",
  afternoon: "☀️ День",
  evening: "🌙 Вечер",
  any: "📌 Без жёсткого слота",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "Входящие",
  todo: "К выполнению",
  in_progress: "В работе",
  waiting: "⏳ Ожидание ответа",
  done: "Выполнено",
  cancelled: "Отменено",
};

export interface StagedTaskItem {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: number;
  planned_date?: string | null;
  day_slot?: DaySlot;
  estimated_minutes?: number | null;
  due_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  scheduled_time?: string | null;
  scheduled_end_time?: string | null;
  is_meeting?: boolean;
  remind_before_minutes?: number | null;
  allow_duplicate?: boolean;
  waiting_on_person?: string | null;
  waiting_context?: string | null;
  follow_up_at?: string | null;
  conflict_warnings?: string[];
}

function formatReminderBadge(
  scheduledStartAt: string | null | undefined,
  remindBeforeMinutes: number | null | undefined,
  timeZone: string
): string {
  if (!scheduledStartAt || remindBeforeMinutes === null) return "";
  const lead = remindBeforeMinutes ?? 15;
  if (lead === 0) {
    const startClock = extractLocalTimeParts(scheduledStartAt, timeZone).timeStr;
    return ` · 🔔 ровно в ${startClock}`;
  }
  return ` · 🔔 за ${lead} мин`;
}

export function formatCreateTasksPreview(
  tasks: StagedTaskItem[],
  timeZone = "Europe/Moscow"
): string {
  const hasAnyConflict = tasks.some(
    (t) => t.conflict_warnings && t.conflict_warnings.length > 0
  );
  const lines: string[] = ["📋 **Превью новых задач**", ""];

  tasks.forEach((t, idx) => {
    const slot = SLOT_LABELS[t.day_slot ?? "any"];
    const prioPart = t.priority === 1 ? " 🔥 Главный фокус" : "";
    const kindIcon = t.is_meeting ? "🗓 " : "";
    lines.push(`${idx + 1}. ${kindIcon}**${t.title}**${prioPart}`);

    if (t.scheduled_start_at) {
      const range =
        formatTaskTimeRange(
          {
            scheduled_start_at: t.scheduled_start_at,
            scheduled_end_at: t.scheduled_end_at ?? null,
          },
          timeZone
        ) ?? t.scheduled_time ?? "";
      const dateStr =
        t.planned_date ?? extractLocalTimeParts(t.scheduled_start_at, timeZone).dateStr;
      const reminderStr = formatReminderBadge(
        t.scheduled_start_at,
        t.remind_before_minutes,
        timeZone
      );
      lines.push(`   🕙 **${dateStr}, ${range}** (${slot})${reminderStr}`);
    } else {
      const datePart = t.planned_date ? ` · ${t.planned_date}` : " · Входящие";
      const estPart = t.estimated_minutes ? ` · ~${t.estimated_minutes} мин` : "";
      lines.push(`   ${slot}${datePart}${estPart}`);
    }

    if (t.status === "waiting" || t.waiting_on_person) {
      const who = t.waiting_on_person || "контрагента";
      const remind = t.follow_up_at ? ` (напомнить: ${t.follow_up_at.slice(0, 10)})` : "";
      lines.push(`   ⏳ Ждём ответ от: **${who}**${remind}`);
    }
    if (t.due_date) {
      lines.push(`   📅 Дедлайн: ${t.due_date}`);
    }
    if (t.notes) {
      lines.push(`   💬 ${t.notes}`);
    }
    if (t.conflict_warnings && t.conflict_warnings.length > 0) {
      for (const cw of t.conflict_warnings) {
        lines.push(`   ⚠️ **КОНФЛИКТ ВРЕМЕНИ:** ${cw}`);
      }
    }
  });

  lines.push("");
  if (hasAnyConflict) {
    lines.push(
      "⚠️ **Внимание:** есть пересечение по времени! Нажми «✏️ Исправить», чтобы сдвинуть слот, или подтверди как есть."
    );
  } else {
    lines.push("Подтверждаем запись в план?");
  }
  return lines.join("\n");
}

export interface StagedTaskRescheduleItem {
  task_id: number;
  task_title?: string;
  planned_date?: string | null;
  day_slot?: DaySlot;
  estimated_minutes?: number | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  scheduled_time?: string | null;
  scheduled_end_time?: string | null;
  is_meeting?: boolean;
  remind_before_minutes?: number | null;
  status?: TaskStatus;
  priority?: number;
  waiting_on_person?: string | null;
  follow_up_at?: string | null;
  conflict_warnings?: string[];
}

export function formatRescheduleTasksPreview(
  updates: StagedTaskRescheduleItem[],
  timeZone = "Europe/Moscow"
): string {
  const hasAnyConflict = updates.some(
    (u) => u.conflict_warnings && u.conflict_warnings.length > 0
  );
  const lines: string[] = ["🔄 **Превью обновления плана задач**", ""];

  updates.forEach((u, idx) => {
    const label = u.task_title ? `**${u.task_title}** (#${u.task_id})` : `Задача #${u.task_id}`;
    const changes: string[] = [];

    if (u.scheduled_start_at) {
      const range =
        formatTaskTimeRange(
          {
            scheduled_start_at: u.scheduled_start_at,
            scheduled_end_at: u.scheduled_end_at ?? null,
          },
          timeZone
        ) ?? "";
      const dStr =
        u.planned_date ?? extractLocalTimeParts(u.scheduled_start_at, timeZone).dateStr;
      const rem = formatReminderBadge(u.scheduled_start_at, u.remind_before_minutes, timeZone);
      changes.push(`🕙 ${dStr}, ${range}${rem}`);
    } else {
      if (u.planned_date !== undefined) {
        changes.push(u.planned_date ? `дата → ${u.planned_date}` : "убрать дату");
      }
      if (u.scheduled_start_at === null) {
        changes.push("убрать точное время");
      }
      if (u.day_slot !== undefined) {
        changes.push(`слот → ${SLOT_LABELS[u.day_slot]}`);
      }
    }

    if (u.status !== undefined) {
      changes.push(`статус → ${STATUS_LABELS[u.status]}`);
    }
    if (u.priority !== undefined) {
      changes.push(`приоритет → P${u.priority}`);
    }
    if (u.waiting_on_person) {
      changes.push(`ждём: ${u.waiting_on_person}`);
    }
    if (u.follow_up_at) {
      changes.push(`напомнить: ${u.follow_up_at.slice(0, 10)}`);
    }

    lines.push(`${idx + 1}. ${label}`);
    lines.push(`   ${changes.join(" · ") || "без изменений"}`);

    if (u.conflict_warnings && u.conflict_warnings.length > 0) {
      for (const cw of u.conflict_warnings) {
        lines.push(`   ⚠️ **КОНФЛИКТ ВРЕМЕНИ:** ${cw}`);
      }
    }
  });

  lines.push("");
  if (hasAnyConflict) {
    lines.push("⚠️ Обнаружено наложение по времени! Проверь или нажми «✏️ Исправить».");
  } else {
    lines.push("Применить эти изменения к плану?");
  }
  return lines.join("\n");
}

export function formatDayPlanPreview(payload: {
  plan_date: string;
  main_focus?: string | null;
  available_minutes?: number;
  buffer_minutes?: number;
  energy_mode?: string;
  notes?: string | null;
}): string {
  const lines: string[] = [`🗓 **Превью настройки дня (${payload.plan_date})**`, ""];
  if (payload.main_focus !== undefined) {
    lines.push(`• Главный фокус: **${payload.main_focus || "не задан"}**`);
  }
  if (payload.available_minutes !== undefined) {
    lines.push(`• Доступное окно работы: **${payload.available_minutes} мин**`);
  }
  if (payload.buffer_minutes !== undefined) {
    lines.push(`• Защитный буфер дня: **${payload.buffer_minutes} мин**`);
  }
  if (payload.energy_mode) {
    lines.push(`• Режим энергии: **${payload.energy_mode}**`);
  }
  if (payload.notes) {
    lines.push(`• Заметка: ${payload.notes}`);
  }
  lines.push("", "Обновляем параметры дня?");
  return lines.join("\n");
}

export interface StagedTransactionItem {
  amount: number;
  currency?: string;
  category_name: string;
  description?: string;
  spend_nature?: "personal" | "work_reimbursable" | "shared_reimbursable";
  reimbursable_amount?: number;
  source?: string;
}

export function formatTransactionsPreview(
  kind: "create_expenses" | "create_income",
  items: StagedTransactionItem[]
): string {
  const header =
    kind === "create_income" ? "💰 **Превью поступления**" : "💳 **Превью записи трат**";
  const lines: string[] = [header, ""];
  let total = 0;
  items.forEach((item, idx) => {
    total += item.amount;
    const cur = item.currency || "RUB";
    const curSymbol = cur === "RUB" ? "₽" : cur;
    const scopeNote =
      item.spend_nature === "work_reimbursable"
        ? " *(рабочая — к компенсации, не искажает личные траты)*"
        : item.spend_nature === "shared_reimbursable"
          ? ` *(общая покупка — к возврату ${(item.reimbursable_amount ?? 0).toLocaleString("ru-RU")} ${curSymbol})*`
          : "";
    const desc = item.description ? ` — ${item.description}` : "";
    lines.push(
      `${idx + 1}. **${item.amount.toLocaleString("ru-RU")} ${curSymbol}** · ${item.category_name}${desc}${scopeNote}`
    );
  });
  lines.push("", `Итого: **${total.toLocaleString("ru-RU")} ₽**`, "Сохраняем операции в базу?");
  return lines.join("\n");
}

export function formatAgreementPreview(scope: string, ruleText: string): string {
  return [
    "🤝 **Новое правило / договорённость с ассистентом**",
    "",
    `• Раздел: \`${scope}\``,
    `• Правило: **«${ruleText}»**`,
    "",
    "Запомнить эту договорённость на будущее?",
  ].join("\n");
}
