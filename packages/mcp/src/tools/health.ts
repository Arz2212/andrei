import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Json } from "@life-os/db";
import {
  addDaysToIsoDate,
  completeWorkoutSession,
  createMedicalDoctor,
  createMedicalDocumentSignedUrl,
  createMedicalFollowUp,
  createMedicalRecord,
  createWorkoutProgram,
  createWorkoutSession,
  deleteMedicalDoctor,
  deleteMedicalFollowUp,
  deleteMedicalRecord,
  deleteWorkoutProgram,
  deleteWorkoutSession,
  findMedicalFollowUpsByFuzzyQuery,
  findWorkoutSessionByFuzzyQuery,
  formatIsoDate,
  getHealthDashboardData,
  getMedicalRecordFull,
  getOwnerBotDbClient,
  getWeekBoundsIso,
  listMedicalDoctors,
  listMedicalFollowUps,
  listMedicalRecords,
  listWorkoutPrograms,
  listWorkoutSessions,
  normalizeTaskTitleForDedup,
  resolveDoctorByFuzzyQuery,
  scheduleWeekFromWorkoutProgram,
  toggleMedicalFollowUpDone,
  updateMedicalDoctor,
  updateMedicalRecord,
  updateWorkoutProgram,
  updateWorkoutSession,
  type FuzzyFinanceMatch,
  type MedicalDoctorUpdate,
  type MedicalFollowUp,
  type MedicalFollowUpDraft,
  type MedicalRecordFull,
  type MedicalRecordKind,
  type MedicalRecordUpdate,
  type TypedSupabaseClient,
  type WorkoutProgram,
  type WorkoutProgramDayTemplate,
  type WorkoutProgramUpdate,
  type WorkoutSession,
  type WorkoutSessionStatus,
  type WorkoutSessionUpdate,
} from "@life-os/db";
import { DEFAULT_TIMEZONE, errResult, okResult, resolveDateInput } from "../helpers";

const MEDICAL_ORGANIZATIONAL_DISCLAIMER =
  "Организационное хранилище визитов, анализов и шагов, назначенных врачом. Система не ставит диагнозы и не выписывает лечение — назначения делает исключительно врач.";

const WorkoutDayTemplateSchema = z.object({
  day_code: z.string().min(1).max(20).describe("Код тренировочного дня (например, 'A', 'B', 'C' или '1')"),
  title: z.string().min(1).max(200).describe("Название дня сплита (например, 'Тяга и спина', 'Жим и плечи')"),
  exercises: z
    .array(z.string().min(1).max(250))
    .default([])
    .describe("Список упражнений с ориентиром подходов/повторений"),
});

const MedicalFollowUpInputSchema = z.union([
  z.string().min(1).max(300),
  z.object({
    action_title: z.string().min(1).max(300).describe("Что поручил сделать врач (сдать анализ, записаться на контроль и т.д.)"),
    due_date: z
      .string()
      .nullable()
      .optional()
      .describe("Контрольная дата шага YYYY-MM-DD или today/+14d"),
    create_linked_task: z
      .boolean()
      .optional()
      .describe("Создать ли сразу связанную задачу в разделе Задачи (по умолчанию false)"),
  }),
]);

async function resolveWorkoutProgramByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null,
  preferActiveWhenEmpty = false
): Promise<{
  program: WorkoutProgram | null;
  matches: FuzzyFinanceMatch<WorkoutProgram>[];
}> {
  const programs = await listWorkoutPrograms(db, true);
  if (programs.length === 0) return { program: null, matches: [] };

  if (query === undefined || query === null || String(query).trim() === "") {
    if (!preferActiveWhenEmpty) return { program: null, matches: [] };
    const active = programs.find((p) => p.is_active) ?? programs[0];
    return { program: active, matches: [{ item: active, score: 0.95 }] };
  }

  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = programs.find((p) => p.id === id) ?? null;
    return { program: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<WorkoutProgram>[] = [];

  for (const prog of programs) {
    const hay = normalizeTaskTitleForDedup(prog.title);
    let score = 0;
    if (hay === normQ) score = 1.0;
    else if (hay.includes(normQ) || (normQ.length >= 4 && normQ.includes(hay))) score = 0.9;
    else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) {
      const boost = prog.is_active ? 0.03 : 0;
      scored.push({ item: prog, score: Math.min(1, Number((score + boost).toFixed(3))) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { program: scored[0]?.item ?? null, matches: scored };
}

async function resolveMedicalRecordByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null
): Promise<{
  record: MedicalRecordFull | null;
  matches: FuzzyFinanceMatch<MedicalRecordFull>[];
}> {
  if (query === undefined || query === null || String(query).trim() === "") {
    return { record: null, matches: [] };
  }
  const records = await listMedicalRecords(db);
  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = records.find((r) => r.id === id) ?? null;
    return { record: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<MedicalRecordFull>[] = [];

  for (const rec of records) {
    const hay = normalizeTaskTitleForDedup(
      `${rec.title} ${rec.summary ?? ""} ${rec.doctor_conclusion ?? ""} ${rec.doctor?.full_name ?? ""} ${rec.doctor?.specialty ?? ""} ${rec.record_date}`
    );
    const normTitle = normalizeTaskTitleForDedup(rec.title);
    let score = 0;
    if (normTitle === normQ) score = 1.0;
    else if (normTitle.includes(normQ) || hay.includes(normQ)) score = 0.9;
    else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) {
      scored.push({ item: rec, score: Number(score.toFixed(3)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { record: scored[0]?.item ?? null, matches: scored };
}

async function formatMedicalRecordForMcp(
  db: TypedSupabaseClient,
  rec: MedicalRecordFull,
  includeSignedUrls = true
) {
  const documents = await Promise.all(
    rec.documents.map(async (doc) => {
      let signedUrl: string | null = null;
      if (includeSignedUrls) {
        try {
          signedUrl = await createMedicalDocumentSignedUrl(db, doc.storage_path, 3600);
        } catch {
          signedUrl = null;
        }
      }
      return {
        id: doc.id,
        file_name: doc.file_name,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        storage_path: doc.storage_path,
        created_at: doc.created_at,
        signed_url: signedUrl,
      };
    })
  );

  return {
    id: rec.id,
    record_kind: rec.record_kind,
    record_date: rec.record_date,
    title: rec.title,
    doctor: rec.doctor
      ? {
          id: rec.doctor.id,
          full_name: rec.doctor.full_name,
          specialty: rec.doctor.specialty,
          clinic_name: rec.doctor.clinic_name,
        }
      : null,
    summary: rec.summary,
    doctor_conclusion: rec.doctor_conclusion,
    next_visit_date: rec.next_visit_date,
    follow_ups: rec.followUps,
    documents,
  };
}

function formatWorkoutSessionForMcp(session: WorkoutSession, todayDate: string) {
  const inWindowToday =
    session.status === "planned" &&
    session.window_start_date <= todayDate &&
    session.window_end_date >= todayDate;

  return {
    id: session.id,
    program_id: session.program_id,
    title: session.title,
    status: session.status,
    window_start_date: session.window_start_date,
    window_end_date: session.window_end_date,
    planned_date: session.planned_date,
    preferred_slot: session.preferred_slot,
    in_window_today: inWindowToday,
    duration_minutes: session.duration_minutes,
    perceived_effort: session.perceived_effort,
    session_log: session.session_log,
    notes: session.notes,
    completed_at: session.completed_at,
  };
}

export function registerHealthTools(server: McpServer): void {
  // ==========================================================================
  // 1. HEALTH OVERVIEW
  // ==========================================================================

  server.registerTool(
    "get_health_overview",
    {
      title: "Обзор здоровья: активные программы тренировок, плавающие окна недели, врачи и медкарта",
      description:
        "Возвращает сводку раздела «Здоровье» вокруг anchor_date (по умолчанию сегодня по МСК): активные тренировочные программы, плавающие окна тренировок этой недели, список врачей, последние записи медкарты/анализов, даты следующих визитов и открытые контрольные шаги.",
      inputSchema: {
        anchor_date: z
          .string()
          .optional()
          .describe("Опорная дата недели YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        date: z
          .string()
          .optional()
          .describe("Алиас для anchor_date (YYYY-MM-DD или today/tomorrow)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const anchorDate =
          resolveDateInput(args.anchor_date ?? args.date) ?? formatIsoDate(new Date(), DEFAULT_TIMEZONE);
        const dash = await getHealthDashboardData(db, {
          anchorDate,
          timeZone: DEFAULT_TIMEZONE,
        });

        const activePrograms = dash.programs.filter((p) => p.is_active);
        const upcomingNextVisits = dash.medicalRecords
          .filter((r) => Boolean(r.next_visit_date) && r.next_visit_date! >= dash.todayDate)
          .map((r) => ({
            record_id: r.id,
            title: r.title,
            next_visit_date: r.next_visit_date,
            doctor_name: r.doctor?.full_name ?? null,
            specialty: r.doctor?.specialty ?? null,
          }))
          .sort((a, b) => (a.next_visit_date ?? "").localeCompare(b.next_visit_date ?? ""));

        const formattedRecords = await Promise.all(
          dash.medicalRecords.slice(0, 10).map((r) => formatMedicalRecordForMcp(db, r, false))
        );

        return okResult({
          ok: true,
          organizational_disclaimer: MEDICAL_ORGANIZATIONAL_DISCLAIMER,
          anchor_date: anchorDate,
          today_date: dash.todayDate,
          week_start: dash.weekStart,
          week_end: dash.weekEnd,
          active_workout_programs: activePrograms,
          all_workout_programs_count: dash.programs.length,
          week_workout_windows: dash.weekSessions.map((s) =>
            formatWorkoutSessionForMcp(s, dash.todayDate)
          ),
          doctors: dash.doctors,
          open_medical_follow_ups: dash.openFollowUps,
          upcoming_next_visits: upcomingNextVisits,
          recent_medical_records: formattedRecords,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. WORKOUT PROGRAMS & WEEKLY FLOATING WINDOW GENERATOR
  // ==========================================================================

  server.registerTool(
    "manage_workout_program",
    {
      title: "Тренировочные программы и автопланирование плавающих окон на неделю",
      description:
        "Управляет шаблонами тренировочных программ (`list | create | update | schedule_week | delete`) с нечётким поиском по названию. Действие `schedule_week` автоматически раскладывает плавающие окна тренировок по выбранной неделе.",
      inputSchema: {
        action: z
          .enum(["list", "create", "update", "schedule_week", "delete"])
          .describe("Действие: list, create, update, schedule_week, delete"),
        program_id: z.number().int().positive().optional().describe("Точный ID программы, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск программы по названию (для schedule_week, если не указан, берётся активная программа)"),
        include_inactive: z
          .boolean()
          .optional()
          .describe("Включить ли неактивные программы при list (по умолчанию true)"),
        title: z
          .string()
          .max(250)
          .optional()
          .describe("Название тренировочной программы (например, 'Силовая + тонус · 3 раза в неделю')"),
        sessions_per_week: z
          .number()
          .int()
          .min(1)
          .max(7)
          .optional()
          .describe("Целевое число тренировок в неделю (1..7, по умолчанию 3)"),
        is_active: z.boolean().optional().describe("Активна ли программа (по умолчанию true)"),
        program_structure: z
          .array(WorkoutDayTemplateSchema)
          .optional()
          .describe("Структура дней программы (day_code, title, exercises[])"),
        week_start_date: z
          .string()
          .optional()
          .describe("Дата недели YYYY-MM-DD или today/tomorrow для schedule_week (берётся понедельник этой недели)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const programs = await listWorkoutPrograms(db, args.include_inactive ?? true);
          return okResult({
            ok: true,
            count: programs.length,
            programs,
          });
        }

        if (args.action === "create") {
          const title = (args.title ?? args.query ?? "").trim();
          if (!title) {
            return errResult("Для создания тренировочной программы укажи `title`.");
          }
          const structure: WorkoutProgramDayTemplate[] = args.program_structure ?? [];
          const created = await createWorkoutProgram(db, {
            user_id: userId,
            title,
            sessions_per_week: args.sessions_per_week ?? Math.max(1, structure.length || 3),
            is_active: args.is_active ?? true,
            program_structure: structure as unknown as Json,
          });
          return okResult({
            ok: true,
            program: created,
          });
        }

        const lookupRef =
          args.program_id ??
          (args.action === "update" ? args.query : args.query ?? args.title);
        const { program, matches } = await resolveWorkoutProgramByFuzzyQuery(
          db,
          lookupRef,
          args.action === "schedule_week"
        );

        if (!program) {
          return errResult(
            lookupRef
              ? `Тренировочная программа «${lookupRef}» не найдена.`
              : "Активная тренировочная программа не найдена. Передай `query` или создай программу."
          );
        }

        if (
          !args.program_id &&
          lookupRef &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих программ тренировок. Уточни название или program_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              title: m.item.title,
              is_active: m.item.is_active,
              score: m.score,
            })),
          });
        }

        if (args.action === "schedule_week") {
          const anchor = resolveDateInput(args.week_start_date) ?? formatIsoDate();
          const { weekStart } = getWeekBoundsIso(anchor);
          const createdSessions = await scheduleWeekFromWorkoutProgram(db, program.id, weekStart);
          const today = formatIsoDate();
          return okResult({
            ok: true,
            program: { id: program.id, title: program.title },
            week_start_date: weekStart,
            scheduled_count: createdSessions.length,
            sessions: createdSessions.map((s) => formatWorkoutSessionForMcp(s, today)),
          });
        }

        if (args.action === "delete") {
          await deleteWorkoutProgram(db, program.id);
          return okResult({
            ok: true,
            deleted_program: { id: program.id, title: program.title },
          });
        }

        // action === "update"
        const patch: WorkoutProgramUpdate = {};
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.sessions_per_week !== undefined) patch.sessions_per_week = args.sessions_per_week;
        if (args.is_active !== undefined) patch.is_active = args.is_active;
        if (args.program_structure !== undefined) {
          patch.program_structure = args.program_structure as unknown as Json;
        }

        const updated = await updateWorkoutProgram(db, program.id, patch);
        return okResult({
          ok: true,
          program: updated,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. FLOATING-WINDOW WORKOUT SESSIONS
  // ==========================================================================

  server.registerTool(
    "manage_workout_session",
    {
      title: "Тренировки с плавающими окнами (расписание, перенос окна, завершение с RPE и весами, удаление)",
      description:
        "Управляет тренировками с гибкими плавающими окнами дат (`window_start_date..window_end_date`) без жёсткой поминутной хрупкости: `list | schedule | update | complete | delete`. Автоматически синхронизирует напоминание `workout_window` в Telegram и позволяет искать тренировку без знания ID.",
      inputSchema: {
        action: z
          .enum(["list", "schedule", "update", "complete", "delete"])
          .describe("Действие: list, schedule, update, complete, delete"),
        session_id: z.number().int().positive().optional().describe("Точный ID тренировки, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск тренировки по названию (при complete без query автоматически выбирается текущая запланированная тренировка)"),
        date: z
          .string()
          .optional()
          .describe("Опциональная дата YYYY-MM-DD или today/tomorrow для поиска тренировки в окне или фиксации даты выполнения"),
        start_date: z.string().optional().describe("Начало периода для list YYYY-MM-DD"),
        end_date: z.string().optional().describe("Конец периода для list YYYY-MM-DD"),
        status: z
          .enum(["planned", "completed", "skipped"])
          .optional()
          .describe("Статус тренировки: planned, completed, skipped"),
        program: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Привязка к тренировочной программе по названию или ID"),
        title: z
          .string()
          .max(250)
          .optional()
          .describe("Название тренировки (например, 'День B · Жим, плечи и кор' или 'Кардио 45 мин')"),
        window_start_date: z
          .string()
          .optional()
          .describe("Начало плавающего окна тренировки YYYY-MM-DD или today/tomorrow (по умолчанию сегодня)"),
        window_end_date: z
          .string()
          .optional()
          .describe("Конец плавающего окна YYYY-MM-DD (по умолчанию +1 день от начала для гибкого 2-дневного окна или равно началу)"),
        planned_date: z
          .string()
          .nullable()
          .optional()
          .describe("Предпочтительный день внутри окна YYYY-MM-DD или today/tomorrow"),
        preferred_slot: z
          .enum(["morning", "afternoon", "evening", "flexible"])
          .optional()
          .describe("Предпочтительный слот дня: morning, afternoon, evening, flexible (по умолчанию 'evening')"),
        duration_minutes: z
          .number()
          .int()
          .min(5)
          .max(360)
          .nullable()
          .optional()
          .describe("Длительность тренировки в минутах (по умолчанию 60)"),
        perceived_effort: z
          .number()
          .int()
          .min(1)
          .max(10)
          .nullable()
          .optional()
          .describe("Субъективная тяжесть нагрузки RPE по шкале 1..10"),
        session_log: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Журнал выполнения: рабочие веса, подходы, пульс, упражнения (произвольный JSON-объект)"),
        notes: z.string().max(2000).nullable().optional().describe("Заметки по самочувствию или технике"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const today = formatIsoDate();

        if (args.action === "list") {
          const startDate = resolveDateInput(args.start_date);
          const endDate = resolveDateInput(args.end_date);
          const sessions = await listWorkoutSessions(db, {
            startDate: startDate ?? undefined,
            endDate: endDate ?? undefined,
            status: args.status as WorkoutSessionStatus | undefined,
          });
          return okResult({
            ok: true,
            count: sessions.length,
            sessions: sessions.map((s) => formatWorkoutSessionForMcp(s, today)),
          });
        }

        if (args.action === "schedule") {
          const title = (args.title ?? args.query ?? "").trim();
          if (!title) {
            return errResult("Для планирования тренировки укажи `title`.");
          }

          let programId: number | null = null;
          if (args.program !== undefined && args.program !== null && args.program !== "") {
            const { program } = await resolveWorkoutProgramByFuzzyQuery(db, args.program);
            if (!program) return errResult(`Программа тренировок «${args.program}» не найдена.`);
            programId = program.id;
          }

          const winStart = resolveDateInput(args.window_start_date ?? args.date) ?? today;
          const winEnd =
            args.window_end_date !== undefined
              ? resolveDateInput(args.window_end_date) ?? winStart
              : addDaysToIsoDate(winStart, 1);
          const plannedDate =
            args.planned_date === null
              ? null
              : resolveDateInput(args.planned_date) ?? winStart;

          const created = await createWorkoutSession(db, {
            user_id: userId,
            program_id: programId,
            title,
            window_start_date: winStart,
            window_end_date: winEnd >= winStart ? winEnd : winStart,
            planned_date: plannedDate,
            preferred_slot: args.preferred_slot ?? "evening",
            status: args.status ?? "planned",
            completed_at: args.status === "completed" ? new Date().toISOString() : null,
            duration_minutes: args.duration_minutes !== undefined ? args.duration_minutes : 60,
            perceived_effort: args.perceived_effort ?? null,
            session_log: (args.session_log ?? {}) as Json,
            notes: args.notes?.trim() || null,
          });

          return okResult({
            ok: true,
            workout_session: formatWorkoutSessionForMcp(created, today),
          });
        }

        // Resolve target workout session for update / complete / delete
        const resolvedDate = resolveDateInput(args.date) ?? undefined;
        let { session, matches } = await findWorkoutSessionByFuzzyQuery(
          db,
          args.session_id ?? args.query,
          resolvedDate
        );
        if (!session && resolvedDate) {
          const fallback = await findWorkoutSessionByFuzzyQuery(db, args.session_id ?? args.query);
          session = fallback.session;
          matches = fallback.matches;
        }

        if (!session) {
          return errResult(
            "Подходящая тренировка не найдена. Вызови get_health_overview или manage_workout_session(action='list')."
          );
        }

        if (
          !args.session_id &&
          args.query &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих тренировок. Уточни дату, название или session_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              title: m.item.title,
              window_start_date: m.item.window_start_date,
              window_end_date: m.item.window_end_date,
              status: m.item.status,
              score: m.score,
            })),
          });
        }

        if (args.action === "delete") {
          await deleteWorkoutSession(db, session.id);
          return okResult({
            ok: true,
            deleted_workout_session: formatWorkoutSessionForMcp(session, today),
          });
        }

        if (args.action === "complete") {
          const mergedLog =
            args.session_log !== undefined
              ? {
                  ...(session.session_log && typeof session.session_log === "object" && !Array.isArray(session.session_log)
                    ? (session.session_log as Record<string, unknown>)
                    : {}),
                  ...args.session_log,
                }
              : undefined;

          const completed = await completeWorkoutSession(db, session.id, {
            durationMinutes: args.duration_minutes,
            perceivedEffort: args.perceived_effort,
            sessionLog: mergedLog,
            notes: args.notes !== undefined ? args.notes?.trim() || null : undefined,
            completedDate: resolvedDate ?? today,
          });

          return okResult({
            ok: true,
            workout_session: formatWorkoutSessionForMcp(completed, today),
          });
        }

        // action === "update"
        const patch: WorkoutSessionUpdate = {};
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.window_start_date !== undefined) {
          const ws = resolveDateInput(args.window_start_date);
          if (ws) patch.window_start_date = ws;
        }
        if (args.window_end_date !== undefined) {
          const we = resolveDateInput(args.window_end_date);
          if (we) patch.window_end_date = we;
        }
        if (args.planned_date !== undefined) {
          patch.planned_date = args.planned_date === null ? null : resolveDateInput(args.planned_date);
        }
        if (args.preferred_slot !== undefined) patch.preferred_slot = args.preferred_slot;
        if (args.status !== undefined) {
          patch.status = args.status;
          if (args.status === "completed" && !session.completed_at) {
            patch.completed_at = new Date().toISOString();
          } else if (args.status !== "completed") {
            patch.completed_at = null;
          }
        }
        if (args.duration_minutes !== undefined) patch.duration_minutes = args.duration_minutes;
        if (args.perceived_effort !== undefined) patch.perceived_effort = args.perceived_effort;
        if (args.session_log !== undefined) patch.session_log = args.session_log as Json;
        if (args.notes !== undefined) patch.notes = args.notes?.trim() || null;

        if (args.program !== undefined) {
          if (args.program === null || args.program === "") {
            patch.program_id = null;
          } else {
            const { program } = await resolveWorkoutProgramByFuzzyQuery(db, args.program);
            if (!program) return errResult(`Программа «${args.program}» не найдена.`);
            patch.program_id = program.id;
          }
        }

        const updated = await updateWorkoutSession(db, session.id, patch);
        return okResult({
          ok: true,
          workout_session: formatWorkoutSessionForMcp(updated, today),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. MEDICAL DOCTORS DIRECTORY
  // ==========================================================================

  server.registerTool(
    "manage_medical_doctor",
    {
      title: "Справочник врачей и клиник (список, добавление, обновление, удаление)",
      description:
        "Управляет списком профильных врачей и специалистов (`list | create | update | delete`) с нечётким поиском по ФИО, специальности или названию клиники без знания ID.",
      inputSchema: {
        action: z
          .enum(["list", "create", "update", "delete"])
          .describe("Действие: list, create, update, delete"),
        doctor_id: z.number().int().positive().optional().describe("Точный ID врача, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск врача по ФИО, специальности или клинике (для update / delete)"),
        full_name: z.string().max(250).optional().describe("ФИО или имя врача"),
        specialty: z
          .string()
          .max(200)
          .optional()
          .describe("Специальность (например, 'Терапевт', 'Стоматолог', 'Эндокринолог')"),
        clinic_name: z.string().max(250).nullable().optional().describe("Клиника / медицинский центр"),
        contacts: z.string().max(300).nullable().optional().describe("Телефон, мессенджер или ссылка для записи"),
        notes: z.string().max(2000).nullable().optional().describe("Организационные заметки"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const doctors = await listMedicalDoctors(db);
          return okResult({
            ok: true,
            count: doctors.length,
            doctors,
          });
        }

        if (args.action === "create") {
          const fullName = (args.full_name ?? "").trim();
          const specialty = (args.specialty ?? "").trim();
          if (!fullName || !specialty) {
            return errResult("Для добавления врача укажи `full_name` (ФИО) и `specialty` (специальность).");
          }
          const created = await createMedicalDoctor(db, {
            user_id: userId,
            full_name: fullName,
            specialty,
            clinic_name: args.clinic_name?.trim() || null,
            contacts: args.contacts?.trim() || null,
            notes: args.notes?.trim() || null,
          });
          return okResult({
            ok: true,
            doctor: created,
          });
        }

        const lookupRef =
          args.doctor_id ??
          (args.action === "update" ? args.query : args.query ?? args.full_name ?? args.specialty);
        if (!lookupRef) {
          return errResult("Укажи `query` (ФИО или специальность врача) или `doctor_id`.");
        }

        const { doctor, matches } = await resolveDoctorByFuzzyQuery(db, lookupRef);
        if (!doctor) {
          return errResult(`Врач по запросу «${lookupRef}» не найден.`);
        }
        if (
          !args.doctor_id &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько подходящих врачей. Уточни ФИО/специальность или doctor_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              full_name: m.item.full_name,
              specialty: m.item.specialty,
              clinic_name: m.item.clinic_name,
              score: m.score,
            })),
          });
        }

        if (args.action === "delete") {
          await deleteMedicalDoctor(db, doctor.id);
          return okResult({
            ok: true,
            deleted_doctor: doctor,
          });
        }

        const patch: MedicalDoctorUpdate = {};
        if (args.full_name !== undefined && args.full_name.trim()) {
          patch.full_name = args.full_name.trim();
        }
        if (args.specialty !== undefined && args.specialty.trim()) {
          patch.specialty = args.specialty.trim();
        }
        if (args.clinic_name !== undefined) patch.clinic_name = args.clinic_name?.trim() || null;
        if (args.contacts !== undefined) patch.contacts = args.contacts?.trim() || null;
        if (args.notes !== undefined) patch.notes = args.notes?.trim() || null;

        const updated = await updateMedicalDoctor(db, doctor.id, patch);
        return okResult({
          ok: true,
          doctor: updated,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. MEDICAL RECORDS & SIGNED STORAGE DOCUMENT LISTING (STRICTLY ORGANIZATIONAL)
  // ==========================================================================

  server.registerTool(
    "manage_medical_record",
    {
      title: "Медкарта: визиты, анализы, чекапы и защищённые ссылки на файлы (строго организационно)",
      description:
        "Организационное ведение медкарты (`list | get | create | update | delete`): хранит дату и тип записи (`visit | lab_panel | imaging | checkup | other`), привязку к врачу нечётким поиском, краткую выжимку, заключение врача (`doctor_conclusion`), дату следующего визита (`next_visit_date` с авто-напоминанием), контрольные шаги (`follow_ups`) и выдаёт временные защищённые ссылки (signed URL) на прикреплённые документы из приватного бакета `medical-docs`. ВНИМАНИЕ: инструмент строго организационный — медицинские назначения делает только врач!",
      inputSchema: {
        action: z
          .enum(["list", "get", "create", "update", "delete"])
          .describe("Действие: list, get, create, update, delete"),
        record_id: z.number().int().positive().optional().describe("Точный ID записи медкарты, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск записи по заголовку, врачу, дате или тексту (для get/update/delete и фильтрации list)"),
        record_kind: z
          .enum(["visit", "lab_panel", "imaging", "checkup", "other"])
          .optional()
          .describe("Тип записи: visit (приём врача), lab_panel (анализы), imaging (УЗИ/МРТ/КТ), checkup (чекап), other"),
        doctor: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Врач по ФИО, специальности или ID (нечёткий поиск)"),
        record_date: z
          .string()
          .optional()
          .describe("Дата приёма или сдачи анализов YYYY-MM-DD или today/yesterday (по умолчанию сегодня)"),
        title: z
          .string()
          .max(250)
          .optional()
          .describe("Заголовок записи (например, 'Ежегодный чекап и биохимия крови')"),
        summary: z
          .string()
          .max(4000)
          .nullable()
          .optional()
          .describe("Краткое организационное резюме визита или показателей"),
        doctor_conclusion: z
          .string()
          .max(4000)
          .nullable()
          .optional()
          .describe("Зафиксированное заключение и рекомендации самого врача (без генерации самоназначений!)"),
        next_visit_date: z
          .string()
          .nullable()
          .optional()
          .describe("Дата следующего планового визита YYYY-MM-DD (автоматически ставит напоминание в Telegram)"),
        follow_ups: z
          .array(MedicalFollowUpInputSchema)
          .optional()
          .describe("Список контрольных организационных шагов, порученных врачом (для create)"),
        include_signed_urls: z
          .boolean()
          .optional()
          .describe("Сгенерировать ли временные signed URL (на 1 час) для прикреплённых файлов (по умолчанию true для get/create/update)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          let doctorId: number | undefined;
          if (args.doctor !== undefined && args.doctor !== null && args.doctor !== "") {
            const { doctor } = await resolveDoctorByFuzzyQuery(db, args.doctor);
            if (!doctor) return errResult(`Врач «${args.doctor}» не найден.`);
            doctorId = doctor.id;
          }

          const records = await listMedicalRecords(db, {
            recordKind: args.record_kind as MedicalRecordKind | undefined,
            doctorId,
            searchQuery: args.query,
          });

          const withUrls = args.include_signed_urls ?? true;
          const formatted = await Promise.all(
            records.map((r) => formatMedicalRecordForMcp(db, r, withUrls && r.documents.length > 0))
          );

          return okResult({
            ok: true,
            organizational_disclaimer: MEDICAL_ORGANIZATIONAL_DISCLAIMER,
            count: formatted.length,
            records: formatted,
          });
        }

        if (args.action === "create") {
          const title = (args.title ?? "").trim();
          if (!title) {
            return errResult("Для создания записи медкарты укажи `title`.");
          }

          let doctorId: number | null = null;
          if (args.doctor !== undefined && args.doctor !== null && String(args.doctor).trim() !== "") {
            const { doctor } = await resolveDoctorByFuzzyQuery(db, args.doctor);
            if (!doctor) {
              return errResult(
                `Врач «${args.doctor}» не найден в справочнике. Сначала добавь его через manage_medical_doctor(action='create') или не передавай doctor.`
              );
            }
            doctorId = doctor.id;
          }

          const recordDate = resolveDateInput(args.record_date) ?? formatIsoDate();
          const nextVisitDate =
            args.next_visit_date === null || args.next_visit_date === undefined
              ? null
              : resolveDateInput(args.next_visit_date);

          const followUpDrafts: MedicalFollowUpDraft[] = (args.follow_ups ?? []).map((f) => {
            if (typeof f === "string") {
              return { action_title: f.trim(), due_date: null, create_linked_task: false };
            }
            return {
              action_title: f.action_title.trim(),
              due_date: f.due_date ? resolveDateInput(f.due_date) : null,
              create_linked_task: Boolean(f.create_linked_task),
            };
          });

          const createdFull = await createMedicalRecord(
            db,
            {
              user_id: userId,
              doctor_id: doctorId,
              record_kind: args.record_kind ?? "visit",
              record_date: recordDate,
              title,
              summary: args.summary?.trim() || null,
              doctor_conclusion: args.doctor_conclusion?.trim() || null,
              next_visit_date: nextVisitDate,
            },
            followUpDrafts
          );

          return okResult({
            ok: true,
            organizational_disclaimer: MEDICAL_ORGANIZATIONAL_DISCLAIMER,
            record: await formatMedicalRecordForMcp(
              db,
              createdFull,
              args.include_signed_urls ?? true
            ),
          });
        }

        // Resolve target record for get / update / delete
        const lookupRef =
          args.record_id ?? (args.action === "update" ? args.query : args.query ?? args.title);
        if (!lookupRef) {
          return errResult("Укажи `query` (заголовок или врач записи медкарты) или `record_id`.");
        }

        const { record, matches } = await resolveMedicalRecordByFuzzyQuery(db, lookupRef);
        if (!record) {
          return errResult(`Медицинская запись по запросу «${lookupRef}» не найдена.`);
        }
        if (
          !args.record_id &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих записей медкарты. Уточни название, дату или record_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              record_date: m.item.record_date,
              record_kind: m.item.record_kind,
              title: m.item.title,
              doctor_name: m.item.doctor?.full_name ?? null,
              score: m.score,
            })),
          });
        }

        if (args.action === "get") {
          return okResult({
            ok: true,
            organizational_disclaimer: MEDICAL_ORGANIZATIONAL_DISCLAIMER,
            record: await formatMedicalRecordForMcp(db, record, args.include_signed_urls ?? true),
          });
        }

        if (args.action === "delete") {
          await deleteMedicalRecord(db, record.id);
          return okResult({
            ok: true,
            deleted_record: {
              id: record.id,
              title: record.title,
              record_date: record.record_date,
            },
          });
        }

        // action === "update"
        const patch: MedicalRecordUpdate = {};
        if (args.record_kind !== undefined) patch.record_kind = args.record_kind;
        if (args.record_date !== undefined) {
          const rd = resolveDateInput(args.record_date);
          if (rd) patch.record_date = rd;
        }
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.summary !== undefined) patch.summary = args.summary?.trim() || null;
        if (args.doctor_conclusion !== undefined) {
          patch.doctor_conclusion = args.doctor_conclusion?.trim() || null;
        }
        if (args.next_visit_date !== undefined) {
          patch.next_visit_date =
            args.next_visit_date === null ? null : resolveDateInput(args.next_visit_date);
        }
        if (args.doctor !== undefined) {
          if (args.doctor === null || args.doctor === "") {
            patch.doctor_id = null;
          } else {
            const { doctor } = await resolveDoctorByFuzzyQuery(db, args.doctor);
            if (!doctor) return errResult(`Врач «${args.doctor}» не найден.`);
            patch.doctor_id = doctor.id;
          }
        }

        await updateMedicalRecord(db, record.id, patch);
        const refreshed = await getMedicalRecordFull(db, record.id);
        return okResult({
          ok: true,
          organizational_disclaimer: MEDICAL_ORGANIZATIONAL_DISCLAIMER,
          record: refreshed
            ? await formatMedicalRecordForMcp(db, refreshed, args.include_signed_urls ?? true)
            : null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 6. MEDICAL FOLLOW-UPS (WITH OPTIONAL LINKED TASK MIRRORING)
  // ==========================================================================

  server.registerTool(
    "manage_medical_followup",
    {
      title: "Дальнейшие шаги по медкарте (контрольные анализы, запись к врачу и связка с Задачами)",
      description:
        "Управляет организационными шагами после визитов к врачу (`list | add | complete | delete`) с нечётким поиском без ID, авто-напоминанием в Telegram (`medical_followup`) и опцией `create_linked_task: true` для автоматического дублирования шага в список задач.",
      inputSchema: {
        action: z
          .enum(["list", "add", "complete", "delete"])
          .describe("Действие: list, add, complete, delete"),
        follow_up_id: z.number().int().positive().optional().describe("Точный ID контрольного шага, если известен"),
        query: z
          .string()
          .max(300)
          .optional()
          .describe("Нечёткий поиск шага по названию (для complete / delete)"),
        include_done: z
          .boolean()
          .optional()
          .describe("Включить уже выполненные шаги при list (по умолчанию false)"),
        record: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Запись медкарты по заголовку или ID (для add; если не указана, привязывается к последней записи медкарты)"),
        action_title: z
          .string()
          .max(300)
          .optional()
          .describe("Формулировка шага (например, 'Пересдать ферритин и витамин D через 8 недель')"),
        due_date: z
          .string()
          .nullable()
          .optional()
          .describe("Контрольная дата шага YYYY-MM-DD или today/+30d"),
        create_linked_task: z
          .boolean()
          .optional()
          .describe("Создать ли связанную задачу в разделе Задачи (по умолчанию false)"),
        done: z
          .boolean()
          .optional()
          .describe("Статус выполнения для action='complete' (по умолчанию true; false чтобы вернуть в открытые)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const items = await listMedicalFollowUps(db, args.include_done ?? false);
          return okResult({
            ok: true,
            count: items.length,
            follow_ups: items,
          });
        }

        if (args.action === "add") {
          const actionTitle = (args.action_title ?? args.query ?? "").trim();
          if (!actionTitle) {
            return errResult("Для добавления шага укажи `action_title`.");
          }

          let targetRecordId: number | null = null;
          if (args.record !== undefined && String(args.record).trim() !== "") {
            const { record } = await resolveMedicalRecordByFuzzyQuery(db, args.record);
            if (!record) {
              return errResult(`Запись медкарты «${args.record}» не найдена.`);
            }
            targetRecordId = record.id;
          } else {
            const records = await listMedicalRecords(db);
            if (records.length === 0) {
              return errResult(
                "В медкарте ещё нет ни одной записи. Сначала создай запись визита/чекапа через manage_medical_record(action='create')."
              );
            }
            targetRecordId = records[0].id;
          }

          const dueDate =
            args.due_date === null || args.due_date === undefined
              ? null
              : resolveDateInput(args.due_date);

          const created = await createMedicalFollowUp(
            db,
            {
              user_id: userId,
              record_id: targetRecordId,
              action_title: actionTitle,
              due_date: dueDate,
            },
            { createLinkedTask: Boolean(args.create_linked_task) }
          );

          return okResult({
            ok: true,
            follow_up: created,
            linked_task_created: Boolean(created.linked_task_id),
          });
        }

        // Resolve target follow-up for complete / delete
        let target: MedicalFollowUp | null = null;
        if (args.follow_up_id) {
          const all = await listMedicalFollowUps(db, true);
          target = all.find((f) => f.id === args.follow_up_id) ?? null;
        } else {
          const searchStr = (args.query ?? args.action_title ?? "").trim();
          if (!searchStr) {
            return errResult("Укажи `query` (название шага) или `follow_up_id`.");
          }
          let matches = await findMedicalFollowUpsByFuzzyQuery(db, searchStr, false);
          if (matches.length === 0) {
            matches = await findMedicalFollowUpsByFuzzyQuery(db, searchStr, true);
          }
          if (matches.length === 0) {
            return errResult(`Контрольный шаг «${searchStr}» не найден.`);
          }
          if (
            matches.length > 1 &&
            (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
          ) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "Найдено несколько похожих шагов по медкарте. Уточни название или follow_up_id.",
              candidates: matches.slice(0, 5).map((m) => ({
                id: m.item.id,
                action_title: m.item.action_title,
                due_date: m.item.due_date,
                is_done: m.item.is_done,
                score: m.score,
              })),
            });
          }
          target = matches[0].item;
        }

        if (!target) {
          return errResult("Контрольный шаг по медкарте не найден.");
        }

        if (args.action === "delete") {
          await deleteMedicalFollowUp(db, target.id);
          return okResult({
            ok: true,
            deleted_follow_up: target,
          });
        }

        const updated = await toggleMedicalFollowUpDone(db, target.id, args.done ?? true);
        return okResult({
          ok: true,
          follow_up: updated,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
