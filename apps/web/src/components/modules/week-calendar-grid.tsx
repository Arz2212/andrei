"use client";

import * as React from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import {
  addDaysToIsoDate,
  extractLocalTimeParts,
  formatTaskTimeRange,
  getWeekBoundsIso,
  type DayPlan,
  type LifeArea,
  type Project,
  type Task,
} from "@life-os/db";
import { cn, formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { computePositionedBlocks } from "@/components/modules/day-timeline";

const HOUR_HEIGHT_PX = 62;
const SHORT_WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const SPHERE_CARD_STYLES: Record<string, string> = {
  work: "border-l-3 border-l-domain-work bg-domain-work/14 hover:bg-domain-work/22",
  launch:
    "border-l-3 border-l-domain-finance bg-domain-finance/14 hover:bg-domain-finance/22",
  study: "border-l-3 border-l-domain-mind bg-domain-mind/14 hover:bg-domain-mind/22",
  health:
    "border-l-3 border-l-domain-health bg-domain-health/14 hover:bg-domain-health/22",
  personal:
    "border-l-3 border-l-domain-nutrition bg-domain-nutrition/16 hover:bg-domain-nutrition/24",
  default: "border-l-3 border-l-primary bg-accent/70 hover:bg-accent/95",
};

function getWeekdayShortRu(isoDate: string): string {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  const jsDay = dt.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  return SHORT_WEEKDAYS_RU[(jsDay + 6) % 7];
}

interface WeekCalendarGridProps {
  todayDate: string;
  anchorDate: string;
  onChangeAnchorDate: (nextAnchorIso: string) => void;
  tasks: Task[];
  dayPlans?: DayPlan[];
  projects: Project[];
  loading?: boolean;
  onToggleTask: (task: Task, checked: boolean) => void;
  onEditTask: (task: Task) => void;
  onCreateAtCell: (dateIso: string, timeStr?: string | null) => void;
}

export function WeekCalendarGrid({
  todayDate,
  anchorDate,
  onChangeAnchorDate,
  tasks,
  projects,
  loading = false,
  onToggleTask,
  onEditTask,
  onCreateAtCell,
}: WeekCalendarGridProps) {
  const [daysMode, setDaysMode] = React.useState<"7" | "3">("7");
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  const weekBounds = React.useMemo(
    () => getWeekBoundsIso(anchorDate),
    [anchorDate]
  );

  // Visible dates: all 7 days of the week, or a focused 3-day slice inside the week
  const visibleDates = React.useMemo(() => {
    if (daysMode === "7") return weekBounds.dates;
    const idx = weekBounds.dates.indexOf(anchorDate);
    const baseIdx = idx >= 0 ? Math.min(4, Math.max(0, idx)) : 0;
    return weekBounds.dates.slice(baseIdx, baseIdx + 3);
  }, [daysMode, weekBounds.dates, anchorDate]);

  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const activeWeekTasks = React.useMemo(
    () => tasks.filter((t) => t.status !== "cancelled" && t.status !== "waiting"),
    [tasks]
  );

  const tasksByDate = React.useMemo(() => {
    const map = new Map<string, { timed: Task[]; flexible: Task[] }>();
    for (const d of weekBounds.dates) {
      map.set(d, { timed: [], flexible: [] });
    }
    for (const t of activeWeekTasks) {
      const dateKey = t.scheduled_start_at
        ? extractLocalTimeParts(t.scheduled_start_at, "Europe/Moscow").dateStr
        : t.planned_date;
      if (!dateKey || !map.has(dateKey)) continue;
      const bucket = map.get(dateKey)!;
      if (t.scheduled_start_at) {
        bucket.timed.push(t);
      } else {
        bucket.flexible.push(t);
      }
    }
    return map;
  }, [activeWeekTasks, weekBounds.dates]);

  const { startHour, endHour } = React.useMemo(() => {
    let minH = 8;
    let maxH = 22;
    for (const d of weekBounds.dates) {
      const bucket = tasksByDate.get(d);
      if (!bucket) continue;
      for (const b of computePositionedBlocks(bucket.timed)) {
        minH = Math.min(minH, Math.floor(b.startMin / 60));
        maxH = Math.max(maxH, Math.ceil(b.endMin / 60));
      }
    }
    return {
      startHour: Math.max(0, Math.min(minH, 8)),
      endHour: Math.min(24, Math.max(maxH, 23)),
    };
  }, [tasksByDate, weekBounds.dates]);

  const hours = React.useMemo(
    () =>
      Array.from({ length: endHour - startHour }, (_, idx) => startHour + idx),
    [startHour, endHour]
  );

  // Gently center horizontal scroll on today if today is Wed..Sun on mobile, while sticky left hour column stays pinned!
  React.useEffect(() => {
    if (daysMode !== "7" || !scrollContainerRef.current) return;
    const todayIdx = weekBounds.dates.indexOf(todayDate);
    if (todayIdx >= 2 && scrollContainerRef.current.clientWidth < 768) {
      scrollContainerRef.current.scrollLeft = Math.max(
        0,
        (todayIdx - 1) * 164
      );
    }
  }, [daysMode, todayDate, weekBounds.dates]);

  const isCurrentWeek = weekBounds.dates.includes(todayDate);
  const stepDays = daysMode === "3" ? 3 : 7;

  const gridColsClass =
    daysMode === "3"
      ? "grid-cols-[46px_repeat(3,minmax(160px,1fr))]"
      : "grid-cols-[46px_repeat(7,minmax(164px,1fr))]";

  const minWidthClass = daysMode === "3" ? "min-w-[526px]" : "min-w-[1194px]";

  return (
    <div lang="ru" className="flex flex-col gap-3.5">
      {/* Week Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-border/80 bg-card px-3.5 py-2.5 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChangeAnchorDate(addDaysToIsoDate(anchorDate, -stepDays))
            }
            className="min-h-9 rounded-xl px-2.5"
          >
            <ChevronLeftIcon data-icon="inline-start" />
            {daysMode === "3" ? "Назад" : "Пред."}
          </Button>

          <Button
            type="button"
            variant={isCurrentWeek ? "secondary" : "outline"}
            size="sm"
            onClick={() => onChangeAnchorDate(todayDate)}
            className="min-h-9 rounded-xl px-3"
          >
            Сегодня
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChangeAnchorDate(addDaysToIsoDate(anchorDate, stepDays))
            }
            className="min-h-9 rounded-xl px-2.5"
          >
            {daysMode === "3" ? "Вперёд" : "След."}
            <ChevronRightIcon data-icon="inline-end" />
          </Button>

          {loading ? (
            <Loader2Icon className="ml-1 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <ToggleGroup
            type="single"
            value={daysMode}
            onValueChange={(v) => {
              if (v === "3" || v === "7") setDaysMode(v);
            }}
            variant="outline"
            spacing={1}
            className="md:hidden"
          >
            <ToggleGroupItem
              value="3"
              className="min-h-8 px-2.5 text-xs num-tabular"
            >
              3 дня
            </ToggleGroupItem>
            <ToggleGroupItem
              value="7"
              className="min-h-8 px-2.5 text-xs num-tabular"
            >
              7 дней
            </ToggleGroupItem>
          </ToggleGroup>

          <span className="text-sm font-semibold num-tabular">
            {formatDateShortRu(visibleDates[0])} —{" "}
            {formatDateShortRu(visibleDates[visibleDates.length - 1])}{" "}
            {visibleDates[visibleDates.length - 1].slice(0, 4)}
          </span>
        </div>
      </div>

      {/* Single-Page Time-Block Calendar Grid (horizontal scroll ONLY; zero nested vertical scroll!) */}
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto rounded-2xl border border-border/80 bg-card touch-pan-x"
      >
        <div className={minWidthClass}>
          {/* Day Headers Row */}
          <div
            className={cn(
              "grid border-b border-border/80 bg-muted/35",
              gridColsClass
            )}
          >
            <div className="sticky left-0 z-30 flex items-center justify-center border-r border-border bg-card px-1 py-2 text-[10px] font-medium text-muted-foreground">
              МСК
            </div>
            {visibleDates.map((isoDate) => {
              const isToday = isoDate === todayDate;
              const dayNum = Number(isoDate.slice(8, 10));
              const monthNum = isoDate.slice(5, 7);
              return (
                <div
                  key={isoDate}
                  className={cn(
                    "flex items-center justify-between border-r border-border/60 px-2.5 py-2 last:border-r-0",
                    isToday && "bg-accent/55"
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        isToday ? "text-primary" : "text-foreground"
                      )}
                    >
                      {getWeekdayShortRu(isoDate)}
                    </span>
                    <span className="text-xs text-muted-foreground num-tabular">
                      {dayNum}.{monthNum}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCreateAtCell(isoDate, null)}
                    title={`Добавить задачу на ${isoDate}`}
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* All-Day / Flexible Slot Strip (2-line readable chips + pinned sticky label!) */}
          <div
            className={cn(
              "grid border-b border-border/80 bg-background/40",
              gridColsClass
            )}
          >
            <div className="sticky left-0 z-30 flex items-center justify-center border-r border-border bg-card px-0.5 py-2 text-[9.5px] font-medium text-muted-foreground">
              Слоты
            </div>
            {visibleDates.map((isoDate) => {
              const bucket = tasksByDate.get(isoDate);
              const flexItems = bucket?.flexible ?? [];
              const isToday = isoDate === todayDate;

              return (
                <div
                  key={isoDate}
                  className={cn(
                    "flex min-h-9 flex-col gap-1 border-r border-border/60 p-1.5 last:border-r-0",
                    isToday && "bg-accent/20"
                  )}
                >
                  {flexItems.map((task) => {
                    const isDone = task.status === "done";
                    const proj = task.project_id
                      ? projectMap.get(task.project_id)
                      : null;
                    const sphere = (proj?.life_area as LifeArea) ?? "default";
                    const tone =
                      SPHERE_CARD_STYLES[sphere] ?? SPHERE_CARD_STYLES.default;

                    return (
                      <div
                        key={task.id}
                        onClick={() => onEditTask(task)}
                        title={task.title}
                        className={cn(
                          "flex cursor-pointer items-start gap-1.5 rounded-lg border border-border/65 px-2 py-1 text-[11px] leading-[1.2] transition-colors",
                          tone,
                          isDone && "opacity-55"
                        )}
                      >
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 pt-0.5"
                        >
                          <Checkbox
                            checked={isDone}
                            onCheckedChange={(v) =>
                              onToggleTask(task, Boolean(v))
                            }
                            aria-label={`Выполнить «${task.title}»`}
                            className="size-3.5"
                          />
                        </div>
                        <span
                          style={{ hyphens: "auto" }}
                          className={cn(
                            "line-clamp-2 whitespace-normal break-words hyphens-auto font-medium text-foreground",
                            isDone && "line-through text-muted-foreground"
                          )}
                        >
                          {task.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Main Hourly Time-Block Grid (Full Natural Height — No Inner Vertical Scroll!) */}
          <div
            className={cn("grid", gridColsClass)}
            style={{ height: `${hours.length * HOUR_HEIGHT_PX}px` }}
          >
            {/* Pinned Sticky Left Hour Scale (`sticky left-0 z-30 bg-card`) */}
            <div className="sticky left-0 z-30 flex flex-col border-r border-border bg-card">
              {hours.map((hr) => (
                <div
                  key={hr}
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                  className="shrink-0 border-b border-border/45 pt-1 pr-1.5 text-right text-[10px] font-medium text-muted-foreground num-tabular"
                >
                  {String(hr).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {/* Day Columns */}
            {visibleDates.map((isoDate) => {
              const bucket = tasksByDate.get(isoDate);
              const positioned = computePositionedBlocks(bucket?.timed ?? []);
              const isToday = isoDate === todayDate;

              return (
                <div
                  key={isoDate}
                  className={cn(
                    "relative border-r border-border/60 last:border-r-0",
                    isToday && "bg-accent/15"
                  )}
                >
                  {/* Clickable Hour Cells */}
                  {hours.map((hr, idx) => {
                    const hh = `${String(hr).padStart(2, "0")}:00`;
                    return (
                      <div
                        key={hr}
                        onClick={() => onCreateAtCell(isoDate, hh)}
                        title={`Создать задачу ${isoDate} в ${hh}`}
                        style={{
                          top: `${idx * HOUR_HEIGHT_PX}px`,
                          height: `${HOUR_HEIGHT_PX}px`,
                        }}
                        className="absolute inset-x-0 cursor-pointer border-b border-border/45 transition-colors hover:bg-muted/35"
                      />
                    );
                  })}

                  {/* Time-Blocked Cards (Compact 62px/h + Hyphenated 3..4 Line Titles!) */}
                  {positioned.map((b) => {
                    const { task, startMin, endMin, colIndex, totalCols } = b;
                    const isDone = task.status === "done";
                    const proj = task.project_id
                      ? projectMap.get(task.project_id)
                      : null;
                    const sphere = (proj?.life_area as LifeArea) ?? "default";
                    const tone =
                      SPHERE_CARD_STYLES[sphere] ?? SPHERE_CARD_STYLES.default;
                    const timeLabel = formatTaskTimeRange(
                      task,
                      "Europe/Moscow"
                    );

                    const topPx =
                      ((startMin - startHour * 60) / 60) * HOUR_HEIGHT_PX + 1;
                    const heightPx = Math.max(
                      42,
                      ((endMin - startMin) / 60) * HOUR_HEIGHT_PX - 2
                    );
                    const widthPct = 100 / totalCols;
                    const leftPct = colIndex * widthPct;

                    const lineClampClass =
                      heightPx >= 76
                        ? "line-clamp-4"
                        : heightPx >= 56
                          ? "line-clamp-3"
                          : "line-clamp-2";

                    return (
                      <div
                        key={task.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                        title={task.title}
                        style={{
                          top: `${topPx}px`,
                          height: `${heightPx}px`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        className={cn(
                          "absolute z-10 flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg border border-border/75 px-1.5 py-1 shadow-2xs transition-colors",
                          tone,
                          isDone && "opacity-60"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] leading-none font-semibold text-muted-foreground num-tabular">
                            {timeLabel}
                          </span>
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0"
                          >
                            <Checkbox
                              checked={isDone}
                              onCheckedChange={(v) =>
                                onToggleTask(task, Boolean(v))
                              }
                              aria-label={`Выполнить «${task.title}»`}
                              className="size-3.5"
                            />
                          </div>
                        </div>

                        <span
                          style={{ hyphens: "auto" }}
                          className={cn(
                            "whitespace-normal break-words hyphens-auto text-[11px] leading-[1.18] font-medium text-foreground",
                            lineClampClass,
                            isDone && "line-through text-muted-foreground"
                          )}
                        >
                          {task.title}
                        </span>

                        {heightPx >= 86 && proj ? (
                          <span className="mt-auto truncate text-[9.5px] text-muted-foreground">
                            {proj.title}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
