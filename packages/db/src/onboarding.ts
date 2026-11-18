import type { Json } from "./database.types";
import {
  getAssistantSettings,
  getOwnerProfile,
  updateAssistantSettings,
  updateOwnerProfile,
} from "./repositories";
import type {
  AssistantSettingsUpdate,
  TelegramOnboardingEntry,
  TelegramOnboardingMap,
  TelegramOnboardingStateResult,
  TelegramOnboardingStatus,
  TypedSupabaseClient,
  UserProfile,
  UserProfileUpdate,
} from "./types";

export const DEFAULT_SHARED_TELEGRAM_IDS: number[] = [1479912341, 561860059];

export function createDefaultTelegramOnboardingEntry(): TelegramOnboardingEntry {
  return {
    status: "not_started",
    current_step: 1,
    completed_steps: [],
    answers: {},
    updated_at: null,
  };
}

function normalizeOnboardingEntry(raw: unknown): TelegramOnboardingEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createDefaultTelegramOnboardingEntry();
  }
  const obj = raw as Record<string, unknown>;
  const rawStatus = String(obj.status ?? "not_started");
  const status: TelegramOnboardingStatus =
    rawStatus === "in_progress" || rawStatus === "completed" ? rawStatus : "not_started";
  const currentStep =
    typeof obj.current_step === "number" && Number.isFinite(obj.current_step) && obj.current_step >= 1
      ? Math.round(obj.current_step)
      : 1;
  const completedSteps = Array.isArray(obj.completed_steps)
    ? Array.from(
        new Set(
          obj.completed_steps
            .map((s) => String(s ?? "").trim())
            .filter((s) => s.length > 0)
        )
      )
    : [];
  const answers =
    obj.answers && typeof obj.answers === "object" && !Array.isArray(obj.answers)
      ? { ...(obj.answers as Record<string, unknown>) }
      : {};
  const updatedAt = typeof obj.updated_at === "string" ? obj.updated_at : null;

  return {
    status,
    current_step: currentStep,
    completed_steps: completedSteps,
    answers,
    updated_at: updatedAt,
  };
}

function parseOnboardingMap(raw: unknown): TelegramOnboardingMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: TelegramOnboardingMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key) continue;
    result[key] = normalizeOnboardingEntry(v);
  }
  return result;
}

export function resolveNotifyTelegramIds(
  profile?: Pick<UserProfile, "notify_telegram_ids" | "telegram_user_id"> | null
): number[] {
  const ids = new Set<number>();

  if (profile?.notify_telegram_ids && Array.isArray(profile.notify_telegram_ids)) {
    for (const rawId of profile.notify_telegram_ids) {
      const n = Number(rawId);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }

  if (profile?.telegram_user_id) {
    const n = Number(profile.telegram_user_id);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }

  if (typeof process !== "undefined") {
    const rawEnvList =
      process.env.NOTIFY_TELEGRAM_IDS || process.env.ALLOWED_TELEGRAM_USER_ID || "";
    for (const part of rawEnvList.split(/[,\s]+/)) {
      const n = Number(part.trim());
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }

  if (ids.size === 0) {
    for (const defId of DEFAULT_SHARED_TELEGRAM_IDS) {
      ids.add(defId);
    }
  }

  return Array.from(ids);
}

export async function getTelegramOnboardingState(
  db: TypedSupabaseClient,
  telegramUserId?: string | number
): Promise<TelegramOnboardingStateResult> {
  const [profile, assistantSettings] = await Promise.all([
    getOwnerProfile(db),
    getAssistantSettings(db),
  ]);

  const allEntries = parseOnboardingMap(profile?.telegram_onboarding);
  const resolvedTgId =
    telegramUserId !== undefined && telegramUserId !== null && String(telegramUserId).trim() !== ""
      ? String(telegramUserId).trim()
      : Object.keys(allEntries)[0] ?? "561860059";

  const entry = allEntries[resolvedTgId] ?? createDefaultTelegramOnboardingEntry();
  const notifyTelegramIds = resolveNotifyTelegramIds(profile);

  return {
    ...entry,
    telegramUserId: resolvedTgId,
    entry,
    allEntries,
    displayName: profile?.display_name ?? "Владелец",
    notifyTelegramIds,
    assistantSettings,
  };
}

export interface UpdateTelegramOnboardingPatch {
  status?: TelegramOnboardingStatus;
  currentStep?: number;
  completedStep?: string;
  completedSteps?: string[];
  answersPatch?: Record<string, unknown>;
  displayName?: string;
  toneGuidelines?: string;
  morningDigestTime?: string;
  eveningReviewTime?: string;
  dailyBufferMinutes?: number;
  defaultAvailableMinutes?: number;
}

function normalizeTimeHhMm(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export async function updateTelegramOnboardingState(
  db: TypedSupabaseClient,
  userId: string,
  telegramUserId: string | number,
  patch: UpdateTelegramOnboardingPatch
): Promise<TelegramOnboardingStateResult> {
  const profile = await getOwnerProfile(db);
  const tgKey = String(telegramUserId).trim();
  if (!tgKey) {
    throw new Error("Не указан Telegram User ID для обновления онбординга");
  }

  const allEntries = parseOnboardingMap(profile?.telegram_onboarding);
  const prev = allEntries[tgKey] ?? createDefaultTelegramOnboardingEntry();

  const mergedSteps = new Set<string>(prev.completed_steps);
  if (Array.isArray(patch.completedSteps)) {
    for (const s of patch.completedSteps) {
      if (s && s.trim()) mergedSteps.add(s.trim());
    }
  }
  if (patch.completedStep && patch.completedStep.trim()) {
    mergedSteps.add(patch.completedStep.trim());
  }

  const nextStatus: TelegramOnboardingStatus =
    patch.status ??
    (prev.status === "not_started" ? "in_progress" : prev.status);

  const nextEntry: TelegramOnboardingEntry = {
    status: nextStatus,
    current_step:
      patch.currentStep !== undefined && Number.isFinite(patch.currentStep)
        ? Math.max(1, Math.round(patch.currentStep))
        : prev.current_step,
    completed_steps: Array.from(mergedSteps),
    answers: {
      ...prev.answers,
      ...(patch.answersPatch ?? {}),
    },
    updated_at: new Date().toISOString(),
  };

  const nextMap: TelegramOnboardingMap = {
    ...allEntries,
    [tgKey]: nextEntry,
  };

  const notifyIds = new Set<number>(resolveNotifyTelegramIds(profile));
  const numericTg = Number(tgKey);
  if (Number.isFinite(numericTg) && numericTg > 0) {
    notifyIds.add(numericTg);
  }

  const profilePatch: UserProfileUpdate = {
    telegram_onboarding: nextMap as unknown as Json,
    notify_telegram_ids: Array.from(notifyIds),
  };

  if (patch.displayName && patch.displayName.trim()) {
    profilePatch.display_name = patch.displayName.trim();
  }
  if (
    patch.dailyBufferMinutes !== undefined &&
    Number.isFinite(patch.dailyBufferMinutes)
  ) {
    profilePatch.daily_buffer_minutes = Math.max(0, Math.round(patch.dailyBufferMinutes));
  }
  if (
    patch.defaultAvailableMinutes !== undefined &&
    Number.isFinite(patch.defaultAvailableMinutes)
  ) {
    profilePatch.default_available_minutes = Math.max(
      60,
      Math.round(patch.defaultAvailableMinutes)
    );
  }

  await updateOwnerProfile(db, userId, profilePatch);

  const settingsPatch: AssistantSettingsUpdate = {};
  let hasSettingsPatch = false;

  if (patch.toneGuidelines !== undefined && patch.toneGuidelines.trim()) {
    settingsPatch.tone_guidelines = patch.toneGuidelines.trim();
    hasSettingsPatch = true;
  }
  const morningTime = normalizeTimeHhMm(patch.morningDigestTime);
  if (morningTime) {
    settingsPatch.morning_digest_time = morningTime;
    hasSettingsPatch = true;
  }
  const eveningTime = normalizeTimeHhMm(patch.eveningReviewTime);
  if (eveningTime) {
    settingsPatch.evening_review_time = eveningTime;
    hasSettingsPatch = true;
  }

  if (hasSettingsPatch) {
    await updateAssistantSettings(db, userId, settingsPatch);
  }

  return getTelegramOnboardingState(db, tgKey);
}
