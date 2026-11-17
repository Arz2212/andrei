"use server";

import { revalidatePath } from "next/cache";
import {
  completeWorkoutSession,
  createMedicalDoctor,
  createMedicalFollowUp,
  createMedicalDocumentSignedUrl,
  createMedicalRecord,
  createWorkoutProgram,
  createWorkoutSession,
  deleteMedicalDoctor,
  deleteMedicalDocument,
  deleteMedicalFollowUp,
  deleteMedicalRecord,
  deleteWorkoutProgram,
  deleteWorkoutSession,
  getWeekBoundsIso,
  listWorkoutSessions,
  scheduleWeekFromWorkoutProgram,
  toggleMedicalFollowUpDone,
  updateMedicalDoctor,
  updateMedicalRecord,
  updateWorkoutProgram,
  updateWorkoutSession,
  type MedicalFollowUpDraft,
  type MedicalRecordKind,
  type WorkoutPreferredSlot,
  type WorkoutProgramDayTemplate,
  type WorkoutSession,
  type WorkoutSessionStatus,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

function revalidateHealthAndHome() {
  revalidatePath("/", "layout");
}

// ============================================================================
// Week Sessions Fetcher
// ============================================================================

export async function fetchHealthWeekAction(anchorDate: string): Promise<{
  weekStart: string;
  weekEnd: string;
  weekSessions: WorkoutSession[];
}> {
  const { db } = await requireOwnerSession();
  const { weekStart, weekEnd } = getWeekBoundsIso(anchorDate);
  const weekSessions = await listWorkoutSessions(db, {
    startDate: weekStart,
    endDate: weekEnd,
  });
  return { weekStart, weekEnd, weekSessions };
}

// ============================================================================
// Workout Programs & Floating Windows
// ============================================================================

export async function saveWorkoutProgramAction(payload: {
  id?: number;
  title: string;
  sessions_per_week: number;
  is_active?: boolean;
  days: WorkoutProgramDayTemplate[];
}) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название программы");

  const cleanDays = payload.days
    .map((d, idx) => ({
      day_code: d.day_code.trim() || String.fromCharCode(65 + idx),
      title: d.title.trim() || `Тренировка ${idx + 1}`,
      exercises: d.exercises.map((e) => e.trim()).filter(Boolean),
    }))
    .filter((d) => d.title || d.exercises.length > 0);

  const common = {
    title,
    sessions_per_week: Math.max(
      1,
      Math.min(14, Math.round(Number(payload.sessions_per_week) || 3))
    ),
    is_active: payload.is_active ?? true,
    program_structure: cleanDays as unknown as never,
  };

  if (payload.id) {
    await updateWorkoutProgram(db, payload.id, common);
  } else {
    await createWorkoutProgram(db, {
      user_id: userId,
      ...common,
    });
  }
  revalidateHealthAndHome();
}

export async function deleteWorkoutProgramAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteWorkoutProgram(db, id);
  revalidateHealthAndHome();
}

export async function scheduleWeekFromProgramAction(payload: {
  programId: number;
  weekStartDate: string;
}) {
  const { db } = await requireOwnerSession();
  const created = await scheduleWeekFromWorkoutProgram(
    db,
    payload.programId,
    payload.weekStartDate
  );
  revalidateHealthAndHome();
  return created.length;
}

export async function saveWorkoutSessionAction(payload: {
  id?: number;
  program_id?: number | null;
  title: string;
  window_start_date: string;
  window_end_date: string;
  planned_date?: string | null;
  preferred_slot: WorkoutPreferredSlot;
  status?: WorkoutSessionStatus;
  duration_minutes?: number | null;
  notes?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название тренировки");

  const start = payload.window_start_date;
  const end =
    payload.window_end_date && payload.window_end_date >= start
      ? payload.window_end_date
      : start;

  const common = {
    program_id: payload.program_id || null,
    title,
    window_start_date: start,
    window_end_date: end,
    planned_date: payload.planned_date || start,
    preferred_slot: payload.preferred_slot,
    status: payload.status ?? ("planned" as WorkoutSessionStatus),
    duration_minutes:
      payload.duration_minutes && Number(payload.duration_minutes) > 0
        ? Math.round(Number(payload.duration_minutes))
        : null,
    notes: payload.notes?.trim() || null,
  };

  if (payload.id) {
    await updateWorkoutSession(db, payload.id, common);
  } else {
    await createWorkoutSession(db, {
      user_id: userId,
      ...common,
    });
  }
  revalidateHealthAndHome();
}

export async function completeWorkoutSessionAction(payload: {
  id: number;
  durationMinutes?: number | null;
  perceivedEffort?: number | null;
  notes?: string | null;
}) {
  const { db } = await requireOwnerSession();
  await completeWorkoutSession(db, payload.id, {
    durationMinutes:
      payload.durationMinutes && Number(payload.durationMinutes) > 0
        ? Math.round(Number(payload.durationMinutes))
        : undefined,
    perceivedEffort:
      payload.perceivedEffort && Number(payload.perceivedEffort) >= 1
        ? Math.min(10, Math.round(Number(payload.perceivedEffort)))
        : undefined,
    notes: payload.notes?.trim() || undefined,
  });
  revalidateHealthAndHome();
}

export async function deleteWorkoutSessionAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteWorkoutSession(db, id);
  revalidateHealthAndHome();
}

// ============================================================================
// Medical Organizer (Doctors, Records, Follow-Ups & Private Documents)
// ============================================================================

export async function saveMedicalDoctorAction(payload: {
  id?: number;
  full_name: string;
  specialty: string;
  clinic_name?: string | null;
  contacts?: string | null;
  notes?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const fullName = payload.full_name.trim();
  const specialty = payload.specialty.trim();
  if (!fullName || !specialty) {
    throw new Error("Укажи имя врача и специализацию");
  }

  const common = {
    full_name: fullName,
    specialty,
    clinic_name: payload.clinic_name?.trim() || null,
    contacts: payload.contacts?.trim() || null,
    notes: payload.notes?.trim() || null,
  };

  if (payload.id) {
    await updateMedicalDoctor(db, payload.id, common);
  } else {
    await createMedicalDoctor(db, {
      user_id: userId,
      ...common,
    });
  }
  revalidateHealthAndHome();
}

export async function deleteMedicalDoctorAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteMedicalDoctor(db, id);
  revalidateHealthAndHome();
}

export async function saveMedicalRecordAction(payload: {
  id?: number;
  doctor_id?: number | null;
  record_kind: MedicalRecordKind;
  record_date: string;
  title: string;
  summary?: string | null;
  doctor_conclusion?: string | null;
  next_visit_date?: string | null;
  followUps?: MedicalFollowUpDraft[];
}): Promise<number> {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи заголовок медицинской записи");

  const common = {
    doctor_id: payload.doctor_id || null,
    record_kind: payload.record_kind,
    record_date: payload.record_date,
    title,
    summary: payload.summary?.trim() || null,
    doctor_conclusion: payload.doctor_conclusion?.trim() || null,
    next_visit_date: payload.next_visit_date || null,
  };

  let recordId: number;
  if (payload.id) {
    const updated = await updateMedicalRecord(db, payload.id, common);
    recordId = updated.id;
  } else {
    const created = await createMedicalRecord(
      db,
      { user_id: userId, ...common },
      payload.followUps ?? []
    );
    recordId = created.id;
  }
  revalidateHealthAndHome();
  return recordId;
}

export async function deleteMedicalRecordAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteMedicalRecord(db, id);
  revalidateHealthAndHome();
}

export async function addMedicalFollowUpAction(payload: {
  record_id: number;
  action_title: string;
  due_date?: string | null;
  createLinkedTask?: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  const actionTitle = payload.action_title.trim();
  if (!actionTitle) throw new Error("Укажи формулировку шага");

  await createMedicalFollowUp(
    db,
    {
      user_id: userId,
      record_id: payload.record_id,
      action_title: actionTitle,
      due_date: payload.due_date || null,
    },
    { createLinkedTask: Boolean(payload.createLinkedTask) }
  );
  revalidateHealthAndHome();
}

export async function toggleMedicalFollowUpAction(payload: {
  id: number;
  done: boolean;
}) {
  const { db } = await requireOwnerSession();
  await toggleMedicalFollowUpDone(db, payload.id, payload.done);
  revalidateHealthAndHome();
}

export async function deleteMedicalFollowUpAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteMedicalFollowUp(db, id);
  revalidateHealthAndHome();
}

export async function getMedicalDocumentSignedUrlAction(
  storagePath: string
): Promise<string> {
  const { db } = await requireOwnerSession();
  return createMedicalDocumentSignedUrl(db, storagePath, 3600);
}

export async function deleteMedicalDocumentAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteMedicalDocument(db, id);
  revalidateHealthAndHome();
}
