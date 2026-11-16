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
import { computePositionedBlocks } from "@/components/modules/day-timeline";

const HOUR_HEIGHT_PX = 50;
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
  const weekBounds = React.useMemo(
    () => getWeekBoundsIso(anchorDate),
    [anchorDate]
  );

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

  const isCurrentWeek = weekBounds.dates.includes(todayDate);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Week Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChangeAnchorDate(addDaysToIsoDate(anchorDate, -7))}
            className="min-h-9 rounded-xl"
          >
            <ChevronLeftIcon data-icon="inline-start" />
            Пред. неделя
          </Button>

          <Button
            type="button"
            variant={isCurrentWeek ? "secondary" : "outline"}
            size="sm"
            onClick={() => onChangeAnchorDate(todayDate)}
            className="min-h-9 rounded-xl"
          >
            Сегодня
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChangeAnchorDate(addDaysToIsoDate(anchorDate, 7))}
            className="min-h-9 rounded-xl"
          >
            След. неделя
            <ChevronRightIcon data-icon="inline-end" />
          </Button>

          {loading ? (
            <Loader2Icon className="ml-1.5 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold num-tabular">
            {formatDateShortRu(weekBounds.weekStart)} —{" "}
            {formatDateShortRu(weekBounds.weekEnd)}{" "}
            {weekBounds.weekEnd.slice(0, 4)}
          </span>
        </div>
      </div>

      {/* 7-Day Time-Block Calendar Grid (horizontally scrollable on narrow screens) */}
      <div className="overflow-x-auto rounded-2xl border border-border/80 bg-card">
        <div className="min-w-[880px]">
          {/* Day Headers Row */}
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border/80 bg-muted/35">
            <div className="flex items-center justify-center border-r border-border/60 p-2 text-[11px] font-medium text-muted-foreground">
              МСК
            </div>
            {weekBounds.dates.map((isoDate, idx) => {
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
                      {SHORT_WEEKDAYS_RU[idx]}
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

          {/* All-Day / Flexible Slot Strip (tasks without an exact hour) */}
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-border/80 bg-background/40">
            <div className="flex items-center justify-center border-r border-border/60 px-1 py-2 text-[10px] text-muted-foreground">
              Слоты
            </div>
            {weekBounds.dates.map((isoDate) => {
              const bucket = tasksByDate.get(isoDate);
              const flexItems = bucket?.flexible ?? [];
              const isToday = isoDate === todayDate;

              return (
                <div
                  key={isoDate}
                  className={cn(
                    "flex min-h-10 flex-col gap-1 border-r border-border/60 p-1.5 last:border-r-0",
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
                        className={cn(
                          "flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-1.5 py-1 text-[11px] leading-tight transition-colors",
                          tone,
                          isDone && "opacity-55"
                        )}
                      >
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <Checkbox
                            checked={isDone}
                            onCheckedChange={(v) => onToggleTask(task, Boolean(v))}
                            aria-label={`Выполнить «${task.title}»`}
                            className="size-3.5"
                          />
                        </div>
                        <span
                          className={cn(
                            "truncate font-medium",
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

          {/* Main Hourly Time-Block Grid */}
          <div className="max-h-[620px] overflow-y-auto">
            <div
              className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]"
              style={{ height: `${hours.length * HOUR_HEIGHT_PX}px` }}
            >
              {/* Left Hour Axis */}
              <div className="relative border-r border-border/60 bg-muted/20">
                {hours.map((hr, idx) => (
                  <div
                    key={hr}
                    style={{
                      top: `${idx * HOUR_HEIGHT_PX}px`,
                      height: `${HOUR_HEIGHT_PX}px`,
                    }}
                    className="absolute inset-x-0 border-b border-border/45 pt-1 pr-2 text-right text-[11px] text-muted-foreground num-tabular"
                  >
                    {String(hr).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {/* 7 Day Columns */}
              {weekBounds.dates.map((isoDate) => {
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

                    {/* Time-Blocked Cards */}
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
                        30,
                        ((endMin - startMin) / 60) * HOUR_HEIGHT_PX - 2
                      );
                      const widthPct = 100 / totalCols;
                      const leftPct = colIndex * widthPct;

                      return (
                        <div
                          key={task.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditTask(task);
                          }}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                          className={cn(
                            "absolute z-10 flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border/70 px-2 py-1 text-[11px] leading-snug shadow-2xs transition-colors",
                            tone,
                            isDone && "opacity-60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="font-semibold text-foreground num-tabular">
                              {timeLabel}
                            </span>
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
                          </div>
                          <span
                            className={cn(
                              "line-clamp-2 font-medium text-foreground",
                              isDone && "line-through text-muted-foreground"
                            )}
                          >
                            {task.title}
                          </span>
                          {heightPx >= 58 && proj ? (
                            <span className="mt-auto truncate text-[10px] text-muted-foreground">
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
    </div>
  );
}
