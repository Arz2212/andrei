"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarPlusIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DumbbellIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldAlertIcon,
  StethoscopeIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  HealthDashboardData,
  MedicalDoctor,
  MedicalDocument,
  MedicalRecordFull,
  MedicalRecordKind,
  WorkoutPreferredSlot,
  WorkoutProgram,
  WorkoutProgramDayTemplate,
  WorkoutSession,
} from "@life-os/db";
import {
  deleteMedicalDocumentAction,
  deleteMedicalFollowUpAction,
  fetchHealthWeekAction,
  getMedicalDocumentSignedUrlAction,
  scheduleWeekFromProgramAction,
  toggleMedicalFollowUpAction,
} from "@/app/health-actions";
import {
  AddFollowUpModal,
  CompleteWorkoutModal,
  MEDICAL_KIND_LABELS,
  MedicalDoctorModal,
  MedicalRecordModal,
  WORKOUT_SLOT_LABELS,
  WorkoutProgramModal,
  WorkoutSessionModal,
} from "@/components/modules/health-modals";
import { cn, formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function formatFileSizeRu(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatWindowRangeRu(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDateShortRu(startIso);
  return `${formatDateShortRu(startIso)} — ${formatDateShortRu(endIso)}`;
}

interface HealthViewProps {
  initialTab?: string;
  data: HealthDashboardData;
}

export function HealthView({ initialTab, data }: HealthViewProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const validTabs = ["workouts", "programs", "medical", "doctors"];
  const [activeTab, setActiveTab] = React.useState<string>(
    initialTab && validTabs.includes(initialTab) ? initialTab : "workouts"
  );

  // Week navigation state for workouts
  const [weekStart, setWeekStart] = React.useState(data.weekStart);
  const [weekEnd, setWeekEnd] = React.useState(data.weekEnd);
  const [weekSessions, setWeekSessions] = React.useState<WorkoutSession[]>(
    data.weekSessions
  );
  const [weekLoading, setWeekLoading] = React.useState(false);

  React.useEffect(() => {
    if (weekStart === data.weekStart) {
      setWeekSessions(data.weekSessions);
    }
  }, [data.weekStart, data.weekSessions, weekStart]);

  async function handleShiftWeek(anchorIso: string) {
    setWeekLoading(true);
    try {
      const res = await fetchHealthWeekAction(anchorIso);
      setWeekStart(res.weekStart);
      setWeekEnd(res.weekEnd);
      setWeekSessions(res.weekSessions);
    } catch {
      toast.error("Не удалось загрузить тренировки недели");
    } finally {
      setWeekLoading(false);
    }
  }

  // Medical Filters & File Upload State
  const [medSearch, setMedSearch] = React.useState("");
  const [medKindFilter, setMedKindFilter] = React.useState<string>("all");
  const [uploadingRecordId, setUploadingRecordId] = React.useState<number | null>(
    null
  );
  const [openingDocId, setOpeningDocId] = React.useState<number | null>(null);

  // Modals State
  const [sessionModalOpen, setSessionModalOpen] = React.useState(false);
  const [editingSession, setEditingSession] = React.useState<WorkoutSession | null>(
    null
  );

  const [completeModalOpen, setCompleteModalOpen] = React.useState(false);
  const [completingSession, setCompletingSession] =
    React.useState<WorkoutSession | null>(null);

  const [programModalOpen, setProgramModalOpen] = React.useState(false);
  const [editingProgram, setEditingProgram] =
    React.useState<WorkoutProgram | null>(null);

  const [recordModalOpen, setRecordModalOpen] = React.useState(false);
  const [editingRecord, setEditingRecord] =
    React.useState<MedicalRecordFull | null>(null);

  const [followUpModalOpen, setFollowUpModalOpen] = React.useState(false);
  const [followUpRecordId, setFollowUpRecordId] = React.useState<number | null>(
    null
  );

  const [doctorModalOpen, setDoctorModalOpen] = React.useState(false);
  const [editingDoctor, setEditingDoctor] = React.useState<MedicalDoctor | null>(
    null
  );

  // Derived metrics
  const activeProgram = React.useMemo(
    () => data.programs.find((p) => p.is_active) ?? data.programs[0] ?? null,
    [data.programs]
  );

  const completedWeekCount = weekSessions.filter(
    (s) => s.status === "completed"
  ).length;

  const filteredMedicalRecords = React.useMemo(() => {
    const q = medSearch.trim().toLowerCase();
    return data.medicalRecords.filter((r) => {
      if (medKindFilter !== "all" && r.record_kind !== medKindFilter) {
        return false;
      }
      if (q) {
        const hay = `${r.title} ${r.summary ?? ""} ${r.doctor_conclusion ?? ""} ${
          r.doctor?.full_name ?? ""
        } ${r.doctor?.specialty ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.medicalRecords, medSearch, medKindFilter]);

  const recordCountByDoctor = React.useMemo(() => {
    const map = new Map<number, number>();
    for (const r of data.medicalRecords) {
      if (r.doctor_id) {
        map.set(r.doctor_id, (map.get(r.doctor_id) ?? 0) + 1);
      }
    }
    return map;
  }, [data.medicalRecords]);

  // Handlers
  function handleScheduleWeekFromProgram(prog: WorkoutProgram) {
    startTransition(async () => {
      try {
        const count = await scheduleWeekFromProgramAction({
          programId: prog.id,
          weekStartDate: weekStart,
        });
        toast.success(
          `Запланировано плавающих окон на неделю: ${count} (${prog.title})`
        );
        setActiveTab("workouts");
        if (weekStart !== data.weekStart) {
          await handleShiftWeek(weekStart);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка планирования недели");
      }
    });
  }

  async function handleFileUpload(
    recordId: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingRecordId(recordId);
    try {
      const formData = new FormData();
      formData.set("recordId", String(recordId));
      formData.set("file", file);

      const res = await fetch("/api/health/documents", {
        method: "POST",
        body: formData,
      });
      const payload = (await res.json()) as {
        document?: MedicalDocument;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "Ошибка загрузки файла");
      }
      toast.success(`Документ «${file.name}» сохранён в защищённом хранилище`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось загрузить файл");
    } finally {
      setUploadingRecordId(null);
    }
  }

  async function handleOpenDocument(doc: MedicalDocument) {
    setOpeningDocId(doc.id);
    try {
      const signedUrl = await getMedicalDocumentSignedUrlAction(doc.storage_path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось получить ссылку на файл"
      );
    } finally {
      setOpeningDocId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Здоровье и тренировки
          </h1>
          <p className="text-sm text-muted-foreground">
            Плавающие окна тренировок без срыва ритма и защищённая картотека визитов, анализов и PDF-документов
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingRecord(null);
              setRecordModalOpen(true);
            }}
            className="min-h-10 rounded-xl"
          >
            <StethoscopeIcon data-icon="inline-start" />
            Медзапись
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingSession(null);
              setSessionModalOpen(true);
            }}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Окно тренировки
          </Button>
        </div>
      </div>

      {/* Main Flush-Left Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="workouts" className="gap-1.5">
            Тренировки и окна
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {completedWeekCount}/{weekSessions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="programs" className="gap-1.5">
            Программы
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.programs.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="medical" className="gap-1.5">
            Медкарта и анализы
            {data.openFollowUps.length > 0 ? (
              <Badge className="px-1.5 py-0 text-[11px] num-tabular">
                {data.openFollowUps.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="doctors" className="gap-1.5">
            Врачи
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.doctors.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: FLOATING WORKOUT WINDOWS                                  */}
        {/* ================================================================ */}
        <TabsContent value="workouts" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleShiftWeek(shiftIsoDate(weekStart, -7))}
                aria-label="Предыдущая неделя"
                className="size-9 rounded-xl"
              >
                <ChevronLeftIcon />
              </Button>
              <span className="text-sm font-semibold tracking-tight num-tabular">
                {formatDateShortRu(weekStart)} — {formatDateShortRu(weekEnd)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleShiftWeek(shiftIsoDate(weekStart, 7))}
                aria-label="Следующая неделя"
                className="size-9 rounded-xl"
              >
                <ChevronRightIcon />
              </Button>
              {weekStart !== data.weekStart ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleShiftWeek(data.todayDate)}
                  className="rounded-lg"
                >
                  Эта неделя
                </Button>
              ) : null}
              {weekLoading ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs text-muted-foreground num-tabular">
                Закрыто окон за неделю: {completedWeekCount} из {weekSessions.length}
              </span>
              {activeProgram ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleScheduleWeekFromProgram(activeProgram)}
                  className="min-h-10 rounded-xl"
                >
                  <CalendarPlusIcon data-icon="inline-start" />
                  Запланировать неделю по программе
                </Button>
              ) : null}
            </div>
          </div>

          {weekSessions.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <DumbbellIcon className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    На эту неделю окна тренировок ещё не расставлены
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Разложи активную программу на плавающие 2-дневные окна или добавь разовую тренировку.
                  </p>
                </div>
                {activeProgram ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleScheduleWeekFromProgram(activeProgram)}
                    className="rounded-xl"
                  >
                    Разложить «{activeProgram.title}»
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {weekSessions.map((sess) => {
                const isDone = sess.status === "completed";
                const inWindowToday =
                  sess.status === "planned" &&
                  sess.window_start_date <= data.todayDate &&
                  sess.window_end_date >= data.todayDate;
                const sessionLogObj =
                  sess.session_log && typeof sess.session_log === "object"
                    ? (sess.session_log as Record<string, unknown>)
                    : {};
                const exercises = Array.isArray(sessionLogObj.exercises)
                  ? (sessionLogObj.exercises as string[])
                  : [];

                return (
                  <Card
                    key={sess.id}
                    className={cn(
                      "flex flex-col justify-between rounded-2xl shadow-none",
                      inWindowToday && "border-primary/45"
                    )}
                  >
                    <CardHeader className="pb-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isDone ? (
                              <Badge className="gap-1">
                                <CheckCircle2Icon className="size-3" />
                                Выполнено
                              </Badge>
                            ) : inWindowToday ? (
                              <Badge>В окне сегодня</Badge>
                            ) : (
                              <Badge variant="secondary">Плавающее окно</Badge>
                            )}

                            <Badge variant="outline" className="num-tabular">
                              {formatWindowRangeRu(
                                sess.window_start_date,
                                sess.window_end_date
                              )}
                            </Badge>

                            <span className="text-xs text-muted-foreground">
                              {WORKOUT_SLOT_LABELS[
                                sess.preferred_slot as WorkoutPreferredSlot
                              ] ?? sess.preferred_slot}
                            </span>
                          </div>

                          <CardTitle className="text-base font-semibold leading-snug">
                            {sess.title}
                          </CardTitle>
                        </div>

                        {sess.duration_minutes ? (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground num-tabular">
                            {sess.duration_minutes} мин
                            {sess.perceived_effort
                              ? ` · RPE ${sess.perceived_effort}/10`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-2">
                      {exercises.length > 0 ? (
                        <div className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3 text-xs">
                          {exercises.slice(0, 4).map((ex, i) => (
                            <span key={i} className="text-foreground">
                              • {ex}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {sess.notes ? (
                        <p className="text-xs text-muted-foreground">{sess.notes}</p>
                      ) : null}
                    </CardContent>

                    <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                      {!isDone ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setCompletingSession(sess);
                            setCompleteModalOpen(true);
                          }}
                          className="rounded-xl"
                        >
                          <CheckCircle2Icon data-icon="inline-start" />
                          Завершить тренировку
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground num-tabular">
                          Закрыто{" "}
                          {sess.completed_at
                            ? formatDateShortRu(sess.completed_at)
                            : ""}
                        </span>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingSession(sess);
                          setSessionModalOpen(true);
                        }}
                        className="rounded-xl"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Изменить окно
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 2: WORKOUT PROGRAMS                                          */}
        {/* ================================================================ */}
        <TabsContent value="programs" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Шаблоны тренировочных сплитов для автоматической раскладки на неделю
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingProgram(null);
                setProgramModalOpen(true);
              }}
              className="min-h-10 self-start rounded-xl sm:self-auto"
            >
              <PlusIcon data-icon="inline-start" />
              Новая программа
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.programs.map((prog) => {
              const days = Array.isArray(prog.program_structure)
                ? (prog.program_structure as unknown as WorkoutProgramDayTemplate[])
                : [];

              return (
                <Card
                  key={prog.id}
                  className="flex flex-col justify-between rounded-2xl shadow-none"
                >
                  <CardHeader className="pb-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <CardTitle className="text-base font-semibold">
                          {prog.title}
                        </CardTitle>
                        <CardDescription className="num-tabular">
                          {prog.sessions_per_week} тренировки в неделю
                        </CardDescription>
                      </div>
                      {prog.is_active ? (
                        <Badge>Активна</Badge>
                      ) : (
                        <Badge variant="outline">В архиве</Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-2.5">
                    {days.map((d, i) => (
                      <div
                        key={i}
                        className="flex flex-col gap-1 rounded-xl border border-border/75 bg-background/60 p-3 text-xs"
                      >
                        <span className="font-semibold">
                          День {d.day_code} · {d.title}
                        </span>
                        {(d.exercises ?? []).map((ex, j) => (
                          <span key={j} className="text-muted-foreground">
                            • {ex}
                          </span>
                        ))}
                      </div>
                    ))}
                  </CardContent>

                  <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => handleScheduleWeekFromProgram(prog)}
                      className="rounded-xl"
                    >
                      <CalendarPlusIcon data-icon="inline-start" />
                      Запланировать неделю
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingProgram(prog);
                        setProgramModalOpen(true);
                      }}
                      className="rounded-xl"
                    >
                      <PencilIcon data-icon="inline-start" />
                      Настроить
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 3: MEDICAL RECORDS, LABS & PRIVATE STORAGE PDFS              */}
        {/* ================================================================ */}
        <TabsContent value="medical" className="mt-4 flex flex-col gap-4">
          <Alert className="rounded-2xl border-border/85 bg-muted/40">
            <ShieldAlertIcon className="size-4 text-domain-health" />
            <AlertDescription className="text-xs text-muted-foreground">
              Хранилище визитов, анализов и назначенных врачом шагов в приватном контуре{" "}
              <code className="font-mono">medical-docs</code>. Система служит для порядка в документах — медицинские назначения делает исключительно врач.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={medSearch}
                onChange={(e) => setMedSearch(e.target.value)}
                placeholder="Поиск по анализам, врачу или заключению…"
                className="min-h-10 pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={medKindFilter}
                onValueChange={(v) => v && setMedKindFilter(v)}
                variant="outline"
                spacing={1}
                className="flex flex-wrap justify-start"
              >
                <ToggleGroupItem value="all" className="min-h-9 px-2.5 text-xs">
                  Все
                </ToggleGroupItem>
                <ToggleGroupItem value="visit" className="min-h-9 px-2.5 text-xs">
                  Визиты
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="lab_panel"
                  className="min-h-9 px-2.5 text-xs"
                >
                  Анализы
                </ToggleGroupItem>
                <ToggleGroupItem value="imaging" className="min-h-9 px-2.5 text-xs">
                  Обследования
                </ToggleGroupItem>
                <ToggleGroupItem value="checkup" className="min-h-9 px-2.5 text-xs">
                  Чекапы
                </ToggleGroupItem>
              </ToggleGroup>

              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEditingRecord(null);
                  setRecordModalOpen(true);
                }}
                className="min-h-9 rounded-xl"
              >
                <PlusIcon data-icon="inline-start" />
                Запись
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {filteredMedicalRecords.length === 0 ? (
              <Card className="rounded-2xl shadow-none">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Медицинские записи по фильтру не найдены.
                </CardContent>
              </Card>
            ) : (
              filteredMedicalRecords.map((rec) => {
                const isUploading = uploadingRecordId === rec.id;
                const fileInputId = `med-upload-${rec.id}`;

                return (
                  <Card key={rec.id} className="rounded-2xl shadow-none">
                    <CardHeader className="flex flex-col items-start gap-2.5 pb-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">
                            {MEDICAL_KIND_LABELS[
                              rec.record_kind as MedicalRecordKind
                            ] ?? rec.record_kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground num-tabular">
                            {formatDateShortRu(rec.record_date)}
                          </span>
                          {rec.doctor ? (
                            <Badge variant="outline">
                              {rec.doctor.full_name} · {rec.doctor.specialty}
                            </Badge>
                          ) : null}
                          {rec.next_visit_date ? (
                            <Badge variant="outline" className="num-tabular">
                              Контроль: {formatDateShortRu(rec.next_visit_date)}
                            </Badge>
                          ) : null}
                        </div>

                        <CardTitle className="text-lg font-semibold leading-snug">
                          {rec.title}
                        </CardTitle>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id={fileInputId}
                          type="file"
                          accept=".pdf,application/pdf,image/*"
                          className="sr-only"
                          onChange={(e) => handleFileUpload(rec.id, e)}
                        />
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          disabled={isUploading}
                          className="min-h-9 cursor-pointer rounded-xl"
                        >
                          <label htmlFor={fileInputId}>
                            {isUploading ? (
                              <Loader2Icon
                                data-icon="inline-start"
                                className="animate-spin"
                              />
                            ) : (
                              <PaperclipIcon data-icon="inline-start" />
                            )}
                            {isUploading ? "Загрузка…" : "Прикрепить PDF / фото"}
                          </label>
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditingRecord(rec);
                            setRecordModalOpen(true);
                          }}
                          aria-label="Редактировать запись"
                          className="size-9 rounded-xl"
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-col gap-4">
                      {rec.summary ? (
                        <p className="text-sm text-muted-foreground">
                          {rec.summary}
                        </p>
                      ) : null}

                      {rec.doctor_conclusion ? (
                        <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            Заключение и рекомендации врача
                          </span>
                          <p className="mt-1 text-sm leading-relaxed">
                            {rec.doctor_conclusion}
                          </p>
                        </div>
                      ) : null}

                      {/* Attached Private Storage Documents */}
                      {rec.documents.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Файлы и бланки анализов ({rec.documents.length})
                          </span>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {rec.documents.map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <FileTextIcon className="size-4 shrink-0 text-domain-health" />
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-xs font-medium">
                                      {doc.file_name}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground num-tabular">
                                      {formatFileSizeRu(Number(doc.size_bytes))}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="xs"
                                    disabled={openingDocId === doc.id}
                                    onClick={() => handleOpenDocument(doc)}
                                    className="min-h-8 rounded-lg"
                                  >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    Открыть
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() =>
                                      startTransition(async () => {
                                        await deleteMedicalDocumentAction(doc.id);
                                        toast("Файл удалён");
                                      })
                                    }
                                    aria-label={`Удалить файл ${doc.file_name}`}
                                    className="size-8 rounded-lg text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Follow-Up Checklist */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Дальнейшие шаги по записи ({rec.followUps.length})
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setFollowUpRecordId(rec.id);
                              setFollowUpModalOpen(true);
                            }}
                            className="rounded-lg"
                          >
                            <PlusIcon data-icon="inline-start" />
                            Добавить шаг
                          </Button>
                        </div>

                        {rec.followUps.length > 0 ? (
                          <div className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/80 bg-background/50">
                            {rec.followUps.map((fu) => (
                              <div
                                key={fu.id}
                                className="flex min-h-11 items-center justify-between gap-2.5 px-3 py-2"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                  <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
                                    <Checkbox
                                      checked={fu.is_done}
                                      onCheckedChange={(v) =>
                                        startTransition(async () => {
                                          await toggleMedicalFollowUpAction({
                                            id: fu.id,
                                            done: Boolean(v),
                                          });
                                        })
                                      }
                                      aria-label={fu.action_title}
                                    />
                                  </div>
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "text-sm font-medium",
                                        fu.is_done &&
                                          "line-through text-muted-foreground"
                                      )}
                                    >
                                      {fu.action_title}
                                    </span>
                                    {fu.due_date ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[11px] num-tabular"
                                      >
                                        до {formatDateShortRu(fu.due_date)}
                                      </Badge>
                                    ) : null}
                                    {fu.linked_task_id ? (
                                      <Badge variant="secondary" className="text-[11px]">
                                        в задачах
                                      </Badge>
                                    ) : null}
                                  </div>
                                </div>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    startTransition(async () => {
                                      await deleteMedicalFollowUpAction(fu.id);
                                    })
                                  }
                                  aria-label="Удалить шаг"
                                  className="size-8 rounded-lg text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 4: MEDICAL DOCTORS                                           */}
        {/* ================================================================ */}
        <TabsContent value="doctors" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Справочник лечащих врачей, клиник и контактов для быстрой записи
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingDoctor(null);
                setDoctorModalOpen(true);
              }}
              className="min-h-10 self-start rounded-xl sm:self-auto"
            >
              <PlusIcon data-icon="inline-start" />
              Добавить врача
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.doctors.map((doc) => {
              const visitsCount = recordCountByDoctor.get(doc.id) ?? 0;
              return (
                <Card
                  key={doc.id}
                  className="flex flex-col justify-between rounded-2xl shadow-none"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <CardTitle className="text-base font-semibold">
                          {doc.full_name}
                        </CardTitle>
                        <CardDescription>{doc.specialty}</CardDescription>
                      </div>
                      <Badge variant="secondary" className="num-tabular">
                        записей: {visitsCount}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    {doc.clinic_name ? (
                      <span className="font-medium text-foreground">
                        {doc.clinic_name}
                      </span>
                    ) : null}
                    {doc.contacts ? <span>Контакты: {doc.contacts}</span> : null}
                    {doc.notes ? <span>{doc.notes}</span> : null}
                  </CardContent>

                  <CardFooter className="justify-end border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingDoctor(doc);
                        setDoctorModalOpen(true);
                      }}
                      className="rounded-xl"
                    >
                      <PencilIcon data-icon="inline-start" />
                      Изменить
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <WorkoutSessionModal
        open={sessionModalOpen}
        onOpenChange={setSessionModalOpen}
        session={editingSession}
        programs={data.programs}
        defaultDate={data.todayDate}
      />

      <CompleteWorkoutModal
        open={completeModalOpen}
        onOpenChange={setCompleteModalOpen}
        session={completingSession}
      />

      <WorkoutProgramModal
        open={programModalOpen}
        onOpenChange={setProgramModalOpen}
        program={editingProgram}
      />

      <MedicalRecordModal
        open={recordModalOpen}
        onOpenChange={setRecordModalOpen}
        record={editingRecord}
        doctors={data.doctors}
        defaultDate={data.todayDate}
      />

      <AddFollowUpModal
        open={followUpModalOpen}
        onOpenChange={setFollowUpModalOpen}
        recordId={followUpRecordId}
      />

      <MedicalDoctorModal
        open={doctorModalOpen}
        onOpenChange={setDoctorModalOpen}
        doctor={editingDoctor}
      />
    </div>
  );
}
