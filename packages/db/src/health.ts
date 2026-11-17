import type { Json } from "./database.types";
import {
  cancelEntityRemindersInQueue,
  escapeTelegramHtml,
  resolveDefaultTelegramChatId,
} from "./reminders";
import {
  addDaysToIsoDate,
  createTask,
  formatIsoDate,
  getOwnerProfile,
  getWeekBoundsIso,
  localClockToUtcIso,
  normalizeTaskTitleForDedup,
  toggleTaskDone,
} from "./repositories";
import type {
  FuzzyFinanceMatch,
  MedicalDoctor,
  MedicalDoctorInsert,
  MedicalDoctorUpdate,
  MedicalDocument,
  MedicalDocumentInsert,
  MedicalFollowUp,
  MedicalFollowUpInsert,
  MedicalFollowUpUpdate,
  MedicalRecord,
  MedicalRecordFull,
  MedicalRecordInsert,
  MedicalRecordKind,
  MedicalRecordUpdate,
  TypedSupabaseClient,
  UserProfile,
  WorkoutProgram,
  WorkoutProgramDayTemplate,
  WorkoutProgramInsert,
  WorkoutProgramUpdate,
  WorkoutSession,
  WorkoutSessionInsert,
  WorkoutSessionStatus,
  WorkoutSessionUpdate,
} from "./types";

export const MEDICAL_DOCS_BUCKET = "medical-docs";

// ============================================================================
// Health Queue Reminder Sync (Workouts, Medical Follow-Ups & Next Visits)
// ============================================================================

export async function syncWorkoutReminderToQueue(
  db: TypedSupabaseClient,
  session: WorkoutSession,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(session.id);
  await cancelEntityRemindersInQueue(db, entityId, ["workout_window"]);

  if (session.status !== "planned") return;

  const todayStr = formatIsoDate(new Date(), timeZone);
  const targetDate = session.planned_date ?? session.window_end_date;
  if (!targetDate || targetDate < todayStr) return;

  const hourStr =
    session.preferred_slot === "morning"
      ? "09:00"
      : session.preferred_slot === "afternoon"
        ? "14:00"
        : "18:00";

  const triggerAt = localClockToUtcIso(targetDate, hourStr, timeZone);
  const windowLabel =
    session.window_start_date === session.window_end_date
      ? session.window_start_date
      : `${session.window_start_date} — ${session.window_end_date}`;

  const msg =
    `🏋️ <b>Окно тренировки (${escapeTelegramHtml(windowLabel)})</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(session.title)}</b>` +
    (session.notes ? `\n💬 ${escapeTelegramHtml(session.notes.slice(0, 200))}` : "");

  const { error } = await db.from("reminders_queue").insert({
    user_id: session.user_id,
    entity_type: "workout_window",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      workout_session_id: session.id,
      window_start_date: session.window_start_date,
      window_end_date: session.window_end_date,
    } as Json,
  });
  if (error) throw error;
}

export async function syncMedicalVisitReminderToQueue(
  db: TypedSupabaseClient,
  record: MedicalRecord,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(record.id);
  await cancelEntityRemindersInQueue(db, entityId, ["medical_visit"]);

  if (!record.next_visit_date) return;
  const todayStr = formatIsoDate(new Date(), timeZone);
  const warnDate = addDaysToIsoDate(record.next_visit_date, -3);
  const effectiveDate =
    warnDate >= todayStr
      ? warnDate
      : record.next_visit_date >= todayStr
        ? record.next_visit_date
        : null;
  if (!effectiveDate) return;

  const triggerAt = localClockToUtcIso(effectiveDate, "10:00", timeZone);
  const msg =
    `🩺 <b>Плановый контрольный визит (${escapeTelegramHtml(record.next_visit_date)})</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(record.title)}</b>`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: record.user_id,
    entity_type: "medical_visit",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      medical_record_id: record.id,
      next_visit_date: record.next_visit_date,
    } as Json,
  });
  if (error) throw error;
}

export async function syncMedicalFollowUpReminderToQueue(
  db: TypedSupabaseClient,
  followUp: MedicalFollowUp,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(followUp.id);
  await cancelEntityRemindersInQueue(db, entityId, ["medical_followup"]);

  if (followUp.is_done || !followUp.due_date) return;
  const todayStr = formatIsoDate(new Date(), timeZone);
  if (followUp.due_date < todayStr) return;

  const triggerAt = localClockToUtcIso(followUp.due_date, "10:00", timeZone);
  const msg =
    `🩺 <b>Шаг по медкарте (${escapeTelegramHtml(followUp.due_date)})</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(followUp.action_title)}</b>`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: followUp.user_id,
    entity_type: "medical_followup",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      medical_follow_up_id: followUp.id,
      record_id: followUp.record_id,
      due_date: followUp.due_date,
    } as Json,
  });
  if (error) throw error;
}

// ============================================================================
// Workout Programs & Floating-Window Sessions
// ============================================================================

export async function listWorkoutPrograms(
  db: TypedSupabaseClient,
  includeInactive = true
): Promise<WorkoutProgram[]> {
  let query = db
    .from("workout_programs")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createWorkoutProgram(
  db: TypedSupabaseClient,
  input: WorkoutProgramInsert
): Promise<WorkoutProgram> {
  const { data, error } = await db
    .from("workout_programs")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkoutProgram(
  db: TypedSupabaseClient,
  id: number,
  patch: WorkoutProgramUpdate
): Promise<WorkoutProgram> {
  const { data, error } = await db
    .from("workout_programs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteWorkoutProgram(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("workout_programs").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Generates floating workout windows across `[weekStartDate .. weekStartDate + 6]`
 * from a `workout_programs` template without rigid minute-by-minute fragility.
 */
export async function scheduleWeekFromWorkoutProgram(
  db: TypedSupabaseClient,
  programId: number,
  weekStartDate: string
): Promise<WorkoutSession[]> {
  const { data: prog, error } = await db
    .from("workout_programs")
    .select("*")
    .eq("id", programId)
    .maybeSingle();
  if (error) throw error;
  if (!prog) throw new Error("Тренировочная программа не найдена");

  const structure = Array.isArray(prog.program_structure)
    ? (prog.program_structure as unknown as WorkoutProgramDayTemplate[])
    : [];
  const count = Math.max(1, Math.min(7, Number(prog.sessions_per_week || structure.length || 3)));

  // Spread floating 2-day windows evenly across the 7-day week
  const created: WorkoutSession[] = [];
  for (let i = 0; i < count; i += 1) {
    const template = structure[i % Math.max(1, structure.length)];
    const startOffset = Math.min(6, Math.floor((i * 6) / count));
    const endOffset = Math.min(6, startOffset + 1);
    const winStart = addDaysToIsoDate(weekStartDate, startOffset);
    const winEnd = addDaysToIsoDate(weekStartDate, endOffset);
    const title = template
      ? `День ${template.day_code || i + 1} · ${template.title}`
      : `${prog.title} · Тренировка ${i + 1}`;

    const session = await createWorkoutSession(db, {
      user_id: prog.user_id,
      program_id: prog.id,
      title,
      window_start_date: winStart,
      window_end_date: winEnd,
      planned_date: winStart,
      preferred_slot: "evening",
      status: "planned",
      duration_minutes: 60,
      session_log: (template ? { day_code: template.day_code, exercises: template.exercises } : {}) as Json,
    });
    created.push(session);
  }
  return created;
}

export async function listWorkoutSessions(
  db: TypedSupabaseClient,
  filter: { startDate?: string; endDate?: string; status?: WorkoutSessionStatus } = {}
): Promise<WorkoutSession[]> {
  let query = db
    .from("workout_sessions")
    .select("*")
    .order("window_start_date", { ascending: true })
    .order("id", { ascending: true });

  if (filter.startDate) {
    query = query.gte("window_end_date", filter.startDate);
  }
  if (filter.endDate) {
    query = query.lte("window_start_date", filter.endDate);
  }
  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createWorkoutSession(
  db: TypedSupabaseClient,
  input: WorkoutSessionInsert
): Promise<WorkoutSession> {
  const winStart = input.window_start_date;
  const winEnd =
    input.window_end_date && input.window_end_date >= winStart
      ? input.window_end_date
      : winStart;

  const { data, error } = await db
    .from("workout_sessions")
    .insert({
      ...input,
      window_start_date: winStart,
      window_end_date: winEnd,
    })
    .select("*")
    .single();
  if (error) throw error;
  await syncWorkoutReminderToQueue(db, data);
  return data;
}

export async function updateWorkoutSession(
  db: TypedSupabaseClient,
  id: number,
  patch: WorkoutSessionUpdate
): Promise<WorkoutSession> {
  const { data, error } = await db
    .from("workout_sessions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncWorkoutReminderToQueue(db, data);
  return data;
}

export async function completeWorkoutSession(
  db: TypedSupabaseClient,
  id: number,
  details: {
    durationMinutes?: number | null;
    perceivedEffort?: number | null;
    sessionLog?: Record<string, unknown>;
    notes?: string | null;
    completedDate?: string;
  } = {}
): Promise<WorkoutSession> {
  const patch: WorkoutSessionUpdate = {
    status: "completed",
    completed_at: new Date().toISOString(),
  };
  if (details.completedDate) patch.planned_date = details.completedDate;
  if (details.durationMinutes !== undefined) patch.duration_minutes = details.durationMinutes;
  if (details.perceivedEffort !== undefined) patch.perceived_effort = details.perceivedEffort;
  if (details.sessionLog !== undefined) patch.session_log = details.sessionLog as Json;
  if (details.notes !== undefined) patch.notes = details.notes;

  return updateWorkoutSession(db, id, patch);
}

export async function deleteWorkoutSession(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["workout_window"]);
  const { error } = await db.from("workout_sessions").delete().eq("id", id);
  if (error) throw error;
}

export async function findWorkoutSessionByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null,
  date?: string
): Promise<{
  session: WorkoutSession | null;
  matches: FuzzyFinanceMatch<WorkoutSession>[];
}> {
  const sessions = await listWorkoutSessions(
    db,
    date ? { startDate: date, endDate: date } : {}
  );
  if (sessions.length === 0) return { session: null, matches: [] };

  if (query === undefined || query === null || String(query).trim() === "") {
    const planned = sessions.find((s) => s.status === "planned") ?? sessions[0];
    return { session: planned, matches: [{ item: planned, score: 0.9 }] };
  }

  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = sessions.find((s) => s.id === id) ?? null;
    return { session: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<WorkoutSession>[] = [];

  for (const s of sessions) {
    const hay = normalizeTaskTitleForDedup(`${s.title} ${s.notes ?? ""}`);
    let score = 0;
    if (hay === normQ) score = 1.0;
    else if (hay.includes(normQ)) score = 0.9;
    else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.35) {
      const boost = s.status === "planned" ? 0.03 : 0;
      scored.push({ item: s, score: Math.min(1, Number((score + boost).toFixed(3))) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { session: scored[0]?.item ?? null, matches: scored };
}

// ============================================================================
// Medical Organizer (Doctors, Visits/Labs, Follow-ups & Private Storage Docs)
// ============================================================================

export async function listMedicalDoctors(
  db: TypedSupabaseClient
): Promise<MedicalDoctor[]> {
  const { data, error } = await db
    .from("medical_doctors")
    .select("*")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createMedicalDoctor(
  db: TypedSupabaseClient,
  input: MedicalDoctorInsert
): Promise<MedicalDoctor> {
  const { data, error } = await db
    .from("medical_doctors")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateMedicalDoctor(
  db: TypedSupabaseClient,
  id: number,
  patch: MedicalDoctorUpdate
): Promise<MedicalDoctor> {
  const { data, error } = await db
    .from("medical_doctors")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMedicalDoctor(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("medical_doctors").delete().eq("id", id);
  if (error) throw error;
}

export async function resolveDoctorByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null
): Promise<{
  doctor: MedicalDoctor | null;
  matches: FuzzyFinanceMatch<MedicalDoctor>[];
}> {
  if (query === undefined || query === null || String(query).trim() === "") {
    return { doctor: null, matches: [] };
  }
  const doctors = await listMedicalDoctors(db);
  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = doctors.find((d) => d.id === id) ?? null;
    return { doctor: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<MedicalDoctor>[] = [];

  for (const doc of doctors) {
    const hay = normalizeTaskTitleForDedup(
      `${doc.full_name} ${doc.specialty} ${doc.clinic_name ?? ""}`
    );
    let score = 0;
    if (normalizeTaskTitleForDedup(doc.full_name) === normQ || normalizeTaskTitleForDedup(doc.specialty) === normQ) {
      score = 1.0;
    } else if (hay.includes(normQ)) {
      score = 0.9;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) scored.push({ item: doc, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return { doctor: scored[0]?.item ?? null, matches: scored };
}

export async function listMedicalRecords(
  db: TypedSupabaseClient,
  filter: { recordKind?: MedicalRecordKind; doctorId?: number; searchQuery?: string } = {}
): Promise<MedicalRecordFull[]> {
  let recQuery = db
    .from("medical_records")
    .select("*")
    .order("record_date", { ascending: false })
    .order("id", { ascending: false });

  if (filter.recordKind) recQuery = recQuery.eq("record_kind", filter.recordKind);
  if (filter.doctorId) recQuery = recQuery.eq("doctor_id", filter.doctorId);

  const [
    { data: records, error: recErr },
    doctors,
    { data: followUps, error: fuErr },
    { data: docs, error: docErr },
  ] = await Promise.all([
    recQuery,
    listMedicalDoctors(db),
    db
      .from("medical_follow_ups")
      .select("*")
      .order("is_done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    db
      .from("medical_documents")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  if (recErr) throw recErr;
  if (fuErr) throw fuErr;
  if (docErr) throw docErr;

  const docMap = new Map<number, MedicalDoctor>(doctors.map((d) => [d.id, d]));
  const fuByRecord = new Map<number, MedicalFollowUp[]>();
  for (const f of followUps ?? []) {
    const arr = fuByRecord.get(f.record_id) ?? [];
    arr.push(f);
    fuByRecord.set(f.record_id, arr);
  }
  const filesByRecord = new Map<number, MedicalDocument[]>();
  for (const file of docs ?? []) {
    const arr = filesByRecord.get(file.record_id) ?? [];
    arr.push(file);
    filesByRecord.set(file.record_id, arr);
  }

  let full: MedicalRecordFull[] = (records ?? []).map((r) => ({
    ...r,
    doctor: r.doctor_id ? docMap.get(r.doctor_id) ?? null : null,
    followUps: fuByRecord.get(r.id) ?? [],
    documents: filesByRecord.get(r.id) ?? [],
  }));

  if (filter.searchQuery && filter.searchQuery.trim()) {
    const normQ = normalizeTaskTitleForDedup(filter.searchQuery);
    full = full.filter((r) => {
      const hay = normalizeTaskTitleForDedup(
        `${r.title} ${r.summary ?? ""} ${r.doctor_conclusion ?? ""} ${
          r.doctor?.full_name ?? ""
        } ${r.doctor?.specialty ?? ""}`
      );
      return hay.includes(normQ);
    });
  }

  return full;
}

export async function getMedicalRecordFull(
  db: TypedSupabaseClient,
  id: number
): Promise<MedicalRecordFull | null> {
  const all = await listMedicalRecords(db);
  return all.find((r) => r.id === id) ?? null;
}

export interface MedicalFollowUpDraft {
  action_title: string;
  due_date?: string | null;
  create_linked_task?: boolean;
}

export async function createMedicalRecord(
  db: TypedSupabaseClient,
  input: MedicalRecordInsert,
  followUps: MedicalFollowUpDraft[] = []
): Promise<MedicalRecordFull> {
  const { data: rec, error } = await db
    .from("medical_records")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;

  await syncMedicalVisitReminderToQueue(db, rec);

  for (const fu of followUps) {
    if (!fu.action_title.trim()) continue;
    await createMedicalFollowUp(
      db,
      {
        user_id: rec.user_id,
        record_id: rec.id,
        action_title: fu.action_title.trim(),
        due_date: fu.due_date ?? null,
      },
      { createLinkedTask: Boolean(fu.create_linked_task) }
    );
  }

  return (await getMedicalRecordFull(db, rec.id))!;
}

export async function updateMedicalRecord(
  db: TypedSupabaseClient,
  id: number,
  patch: MedicalRecordUpdate
): Promise<MedicalRecord> {
  const { data, error } = await db
    .from("medical_records")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncMedicalVisitReminderToQueue(db, data);
  return data;
}

export async function deleteMedicalRecord(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const full = await getMedicalRecordFull(db, id);
  if (full) {
    await cancelEntityRemindersInQueue(db, String(id), ["medical_visit"]);
    for (const fu of full.followUps) {
      await cancelEntityRemindersInQueue(db, String(fu.id), ["medical_followup"]);
    }
    if (full.documents.length > 0) {
      const paths = full.documents.map((d) => d.storage_path);
      await db.storage.from(MEDICAL_DOCS_BUCKET).remove(paths);
    }
  }
  const { error } = await db.from("medical_records").delete().eq("id", id);
  if (error) throw error;
}

export async function listMedicalFollowUps(
  db: TypedSupabaseClient,
  includeDone = false
): Promise<MedicalFollowUp[]> {
  let query = db
    .from("medical_follow_ups")
    .select("*")
    .order("is_done", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (!includeDone) query = query.eq("is_done", false);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createMedicalFollowUp(
  db: TypedSupabaseClient,
  input: MedicalFollowUpInsert,
  options: { createLinkedTask?: boolean } = {}
): Promise<MedicalFollowUp> {
  let linkedTaskId = input.linked_task_id ?? null;
  if (options.createLinkedTask && !linkedTaskId) {
    const task = await createTask(db, {
      user_id: input.user_id,
      title: input.action_title,
      notes: "Шаг по медицинской карте (раздел Здоровье)",
      status: "todo",
      priority: 2,
      planned_date: input.due_date ?? null,
      due_date: input.due_date ?? null,
      day_slot: "morning",
      tags: ["здоровье"],
      source: "web",
    });
    linkedTaskId = task.id;
  }

  const { data, error } = await db
    .from("medical_follow_ups")
    .insert({
      ...input,
      linked_task_id: linkedTaskId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await syncMedicalFollowUpReminderToQueue(db, data);
  return data;
}

export async function toggleMedicalFollowUpDone(
  db: TypedSupabaseClient,
  id: number,
  done: boolean
): Promise<MedicalFollowUp> {
  const { data, error } = await db
    .from("medical_follow_ups")
    .update({ is_done: done })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await syncMedicalFollowUpReminderToQueue(db, data);
  if (data.linked_task_id) {
    await toggleTaskDone(db, data.linked_task_id, done);
  }
  return data;
}

export async function deleteMedicalFollowUp(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["medical_followup"]);
  const { error } = await db.from("medical_follow_ups").delete().eq("id", id);
  if (error) throw error;
}

export async function findMedicalFollowUpsByFuzzyQuery(
  db: TypedSupabaseClient,
  query: string,
  includeDone = false
): Promise<FuzzyFinanceMatch<MedicalFollowUp>[]> {
  const items = await listMedicalFollowUps(db, includeDone);
  const normQ = normalizeTaskTitleForDedup(query);
  if (!normQ) return [];
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<MedicalFollowUp>[] = [];

  for (const fu of items) {
    const hay = normalizeTaskTitleForDedup(fu.action_title);
    let score = 0;
    if (hay === normQ) score = 1.0;
    else if (hay.includes(normQ)) score = 0.9;
    else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) scored.push({ item: fu, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================================
// Medical Documents Storage (`medical-docs` Private Bucket)
// ============================================================================

export function buildMedicalStoragePath(userId: string, recordId: number, fileName: string): string {
  const safeBase = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-90);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${userId}/${recordId}/${stamp}-${safeBase || "document.pdf"}`;
}

export async function registerMedicalDocument(
  db: TypedSupabaseClient,
  input: MedicalDocumentInsert
): Promise<MedicalDocument> {
  const { data, error } = await db
    .from("medical_documents")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function uploadAndRegisterMedicalDocument(
  db: TypedSupabaseClient,
  params: {
    userId: string;
    recordId: number;
    fileName: string;
    mimeType: string;
    fileBody: Uint8Array | ArrayBuffer | Blob;
    sizeBytes: number;
  }
): Promise<MedicalDocument> {
  const storagePath = buildMedicalStoragePath(
    params.userId,
    params.recordId,
    params.fileName
  );

  const { error: uploadErr } = await db.storage
    .from(MEDICAL_DOCS_BUCKET)
    .upload(storagePath, params.fileBody, {
      contentType: params.mimeType || "application/octet-stream",
      upsert: true,
    });
  if (uploadErr) throw uploadErr;

  return registerMedicalDocument(db, {
    user_id: params.userId,
    record_id: params.recordId,
    storage_path: storagePath,
    file_name: params.fileName,
    mime_type: params.mimeType || "application/octet-stream",
    size_bytes: Math.max(1, params.sizeBytes),
  });
}

export async function createMedicalDocumentSignedUrl(
  db: TypedSupabaseClient,
  storagePath: string,
  expiresInSec = 3600
): Promise<string> {
  const { data, error } = await db.storage
    .from(MEDICAL_DOCS_BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Не удалось создать защищённую ссылку на документ");
  }
  return data.signedUrl;
}

export async function deleteMedicalDocument(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { data: doc, error: selErr } = await db
    .from("medical_documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (selErr) throw selErr;

  if (doc) {
    await db.storage.from(MEDICAL_DOCS_BUCKET).remove([doc.storage_path]);
  }
  const { error } = await db.from("medical_documents").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Composite Health Dashboard Loader
// ============================================================================

export interface HealthDashboardData {
  profile: UserProfile | null;
  todayDate: string;
  weekStart: string;
  weekEnd: string;
  programs: WorkoutProgram[];
  weekSessions: WorkoutSession[];
  recentSessions: WorkoutSession[];
  doctors: MedicalDoctor[];
  medicalRecords: MedicalRecordFull[];
  openFollowUps: MedicalFollowUp[];
}

export async function getHealthDashboardData(
  db: TypedSupabaseClient,
  options: { anchorDate?: string; timeZone?: string } = {}
): Promise<HealthDashboardData> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const todayDate = formatIsoDate(new Date(), tz);
  const anchorDate = options.anchorDate ?? todayDate;
  const { weekStart, weekEnd } = getWeekBoundsIso(anchorDate);
  const recentStart = addDaysToIsoDate(weekStart, -14);
  const horizonEnd = addDaysToIsoDate(weekEnd, 14);

  const [
    profile,
    programs,
    weekSessions,
    recentSessions,
    doctors,
    medicalRecords,
    openFollowUps,
  ] = await Promise.all([
    getOwnerProfile(db),
    listWorkoutPrograms(db, true),
    listWorkoutSessions(db, { startDate: weekStart, endDate: weekEnd }),
    listWorkoutSessions(db, { startDate: recentStart, endDate: horizonEnd }),
    listMedicalDoctors(db),
    listMedicalRecords(db),
    listMedicalFollowUps(db, false),
  ]);

  return {
    profile,
    todayDate,
    weekStart,
    weekEnd,
    programs,
    weekSessions,
    recentSessions,
    doctors,
    medicalRecords,
    openFollowUps,
  };
}
