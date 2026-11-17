"use client";

import * as React from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import {
  addDaysToIsoDate,
  extractLocalTimeParts,
  formatTaskTimeRange,
  type DaySlot,
  type LifeArea,
  type Project,
  type Task,
} from "@life-os/db";
import { cn, formatDateShortRu, formatMinutesRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const HOUR_HEIGHT_PX = 68;

const DOMAIN_BLOCK_STYLES: Record<string, string> = {
  work: "border-l-3 border-l-domain-work bg-domain-work/12 hover:bg-domain-work/18",
  launch: "border-l-3 border-l-domain-finance bg-domain-finance/12 hover:bg-domain-finance/18",
  study: "border-l-3 border-l-domain-mind bg-domain-mind/12 hover:bg-domain-mind/18",
  health: "border-l-3 border-l-domain-health bg-domain-health/12 hover:bg-domain-health/18",
  personal: "border-l-3 border-l-domain-nutrition bg-domain-nutrition/15 hover:bg-domain-nutrition/22",
  default: "border-l-3 border-l-primary bg-accent/65 hover:bg-accent/90",
};

const SLOT_SHORT_LABELS: Record<DaySlot, string> = {
  morning: "Утро",
  afternoon: "День",
  evening: "Вечер",
  any: "Гибко",
};

export interface PositionedBlock {
  task: Task;
  startMin: number;
  endMin: number;
  colIndex: number;
  totalCols: number;
}

export function computePositionedBlocks(tasks: Task[]): PositionedBlock[] {
  const raw = tasks
    .filter((t) => Boolean(t.scheduled_start_at))
    .map((task) => {
      const startParts = extractLocalTimeParts(
        task.scheduled_start_at!,
        "Europe/Moscow"
      );
      const startMin = startParts.hour * 60 + startParts.minute;
      let duration = task.estimated_minutes ?? (task.is_meeting ? 60 : 30);
      if (task.scheduled_end_at) {
        const diff = Math.round(
          (Date.parse(task.scheduled_end_at) -
            Date.parse(task.scheduled_start_at!)) /
            60_000
        );
        if (diff > 0) duration = diff;
      }
      const endMin = Math.min(24 * 60, startMin + Math.max(20, duration));
      return { task, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Group overlapping clusters and assign columns
  const result: PositionedBlock[] = [];
  let cluster: typeof raw = [];
  let clusterMaxEnd = -1;

  const flushCluster = (items: typeof raw) => {
    if (items.length === 0) return;
    const colEnds: number[] = [];
    const assigned: { item: (typeof raw)[number]; col: number }[] = [];

    for (const item of items) {
      let placedCol = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= item.startMin) {
          placedCol = c;
          colEnds[c] = item.endMin;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = colEnds.length;
        colEnds.push(item.endMin);
      }
      assigned.push({ item, col: placedCol });
    }

    const totalCols = Math.max(1, colEnds.length);
    for (const a of assigned) {
      result.push({
        task: a.item.task,
        startMin: a.item.startMin,
        endMin: a.item.endMin,
        colIndex: a.col,
        totalCols,
      });
    }
  };

  for (const item of raw) {
    if (cluster.length === 0 || item.startMin < clusterMaxEnd) {
      cluster.push(item);
      clusterMaxEnd = Math.max(clusterMaxEnd, item.endMin);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterMaxEnd = item.endMin;
    }
  }
  flushCluster(cluster);

  return result;
}

interface DayTimelineProps {
  todayDate: string;
  selectedDate: string;
  onSelectDate: (dateIso: string) => void;
  tasks: Task[];
  projects: Project[];
  bufferMinutes?: number;
  loading?: boolean;
  onToggleTask: (task: Task, checked: boolean) => void;
  onEditTask: (task: Task) => void;
  onCreateAtTime: (dateIso: string, timeStr?: string | null) => void;
}

export function DayTimeline({
  todayDate,
  selectedDate,
  onSelectDate,
  tasks,
  projects,
  bufferMinutes = 90,
  loading = false,
  onToggleTask,
  onEditTask,
  onCreateAtTime,
}: DayTimelineProps) {
  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  // Current Moscow clock line
  const [nowMinuteOfDay, setNowMinuteOfDay] = React.useState<number | null>(null);
  React.useEffect(() => {
    const updateNow = () => {
      const parts = extractLocalTimeParts(new Date().toISOString(), "Europe/Moscow");
      setNowMinuteOfDay(parts.hour * 60 + parts.minute);
    };
    updateNow();
    const id = setInterval(updateNow, 60_000);
    return () => clearInterval(id);
  }, []);

  const dayTasks = React.useMemo(
    () => tasks.filter((t) => t.status !== "cancelled" && t.status !== "waiting"),
    [tasks]
  );

  const timedTasks = React.useMemo(
    () => dayTasks.filter((t) => Boolean(t.scheduled_start_at)),
    [dayTasks]
  );

  const flexibleTasks = React.useMemo(
    () => dayTasks.filter((t) => !t.scheduled_start_at),
    [dayTasks]
  );

  const positioned = React.useMemo(
    () => computePositionedBlocks(timedTasks),
    [timedTasks]
  );

  const { startHour, endHour } = React.useMemo(() => {
    let minH = 8;
    let maxH = 22;
    for (const p of positioned) {
      minH = Math.min(minH, Math.floor(p.startMin / 60));
      maxH = Math.max(maxH, Math.ceil(p.endMin / 60));
    }
    return {
      startHour: Math.max(0, minH - (minH < 8 ? 0 : 1)),
      endHour: Math.min(24, Math.max(maxH, 22) + (maxH < 24 ? 1 : 0)),
    };
  }, [positioned]);

  const hours = React.useMemo(
    () =>
      Array.from({ length: endHour - startHour }, (_, idx) => startHour + idx),
    [startHour, endHour]
  );

  const totalScheduledMins = dayTasks
    .filter((t) => t.status !== "done")
    .reduce((sum, t) => sum + (t.estimated_minutes ?? 30), 0);

  const relativeDateLabel = React.useMemo(() => {
    if (selectedDate === todayDate) {
      return `Сегодня, ${formatDateShortRu(selectedDate)}`;
    }
    if (selectedDate === addDaysToIsoDate(todayDate, -1)) {
      return `Вчера, ${formatDateShortRu(selectedDate)}`;
    }
    if (selectedDate === addDaysToIsoDate(todayDate, 1)) {
      return `Завтра, ${formatDateShortRu(selectedDate)}`;
    }
    return formatDateShortRu(selectedDate);
  }, [selectedDate, todayDate]);

  const isViewingToday = selectedDate === todayDate;
  const showNowLine =
    isViewingToday &&
    nowMinuteOfDay !== null &&
    nowMinuteOfDay >= startHour * 60 &&
    nowMinuteOfDay <= endHour * 60;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Date Navigator + Compact Corner Text Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onSelectDate(addDaysToIsoDate(selectedDate, -1))}
            aria-label="Предыдущий день"
            className="size-8 rounded-lg"
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-[132px] px-2 text-center text-sm font-semibold">
            {relativeDateLabel}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onSelectDate(addDaysToIsoDate(selectedDate, 1))}
            aria-label="Следующий день"
            className="size-8 rounded-lg"
          >
            <ChevronRightIcon />
          </Button>

          {!isViewingToday ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onSelectDate(todayDate)}
              className="ml-1 rounded-lg text-xs"
            >
              Сегодня
            </Button>
          ) : null}

          {loading ? (
            <Loader2Icon className="ml-1 size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground num-tabular">
          <span>
            {formatMinutesRu(totalScheduledMins)} в плане · резерв{" "}
            {formatMinutesRu(bufferMinutes)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onCreateAtTime(selectedDate, null)}
            className="min-h-7 rounded-lg"
          >
            <PlusIcon data-icon="inline-start" />
            В день
          </Button>
        </div>
      </div>

      {/* Flexible Tasks Strip (2-line readable chips!) */}
      {flexibleTasks.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-muted/35 p-2.5">
          <div className="flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
            <span>Гибкие дела дня (по слотам, без жёсткого часа)</span>
            <span className="num-tabular">{flexibleTasks.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {flexibleTasks.map((task) => {
              const isDone = task.status === "done";
              return (
                <div
                  key={task.id}
                  className="inline-flex min-h-9 max-w-full items-start gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-xs"
                >
                  <div className="pt-0.5 shrink-0">
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={(v) => onToggleTask(task, Boolean(v))}
                      aria-label={`Выполнить «${task.title}»`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onEditTask(task)}
                    className={cn(
                      "line-clamp-2 whitespace-normal break-words font-medium text-left leading-snug hover:text-primary",
                      isDone && "line-through text-muted-foreground"
                    )}
                  >
                    {task.title}
                  </button>
                  <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                    {SLOT_SHORT_LABELS[(task.day_slot as DaySlot) ?? "any"]}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Interactive Hourly Vertical Timeline */}
      <div className="max-h-[540px] overflow-y-auto rounded-xl border border-border/80 bg-background/45">
        <div
          className="relative select-none"
          style={{ height: `${hours.length * HOUR_HEIGHT_PX}px` }}
        >
          {/* Hour Grid Lines & Click-to-Schedule Rows */}
          {hours.map((hr, idx) => {
            const hh = `${String(hr).padStart(2, "0")}:00`;
            return (
              <div
                key={hr}
                onClick={() => onCreateAtTime(selectedDate, hh)}
                title={`Запланировать на ${hh}`}
                style={{
                  top: `${idx * HOUR_HEIGHT_PX}px`,
                  height: `${HOUR_HEIGHT_PX}px`,
                }}
                className="group absolute inset-x-0 flex cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/35"
              >
                <div className="flex w-12 shrink-0 items-start justify-end border-r border-border/50 pt-1.5 pr-2 text-[10.5px] text-muted-foreground num-tabular">
                  {hh}
                </div>
                <div className="flex flex-1 items-center justify-end pr-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-[11px] text-muted-foreground">
                    + {hh}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Current Time Indicator Line */}
          {showNowLine && nowMinuteOfDay !== null ? (
            <div
              style={{
                top: `${
                  ((nowMinuteOfDay - startHour * 60) / 60) * HOUR_HEIGHT_PX
                }px`,
              }}
              className="pointer-events-none absolute right-0 left-12 z-20 flex items-center"
            >
              <span className="-ml-1.5 size-2.5 rounded-full bg-primary ring-2 ring-background" />
              <div className="h-[1.5px] flex-1 bg-primary/80" />
            </div>
          ) : null}

          {/* Positioned Time-Blocked Tasks & Meetings */}
          <div className="pointer-events-none absolute top-0 right-2 bottom-0 left-13">
            {positioned.map((block) => {
              const { task, startMin, endMin, colIndex, totalCols } = block;
              const isDone = task.status === "done";
              const proj = task.project_id
                ? projectMap.get(task.project_id)
                : null;
              const areaKey = (proj?.life_area as LifeArea) ?? "default";
              const blockTone =
                DOMAIN_BLOCK_STYLES[areaKey] ?? DOMAIN_BLOCK_STYLES.default;

              const topPx =
                ((startMin - startHour * 60) / 60) * HOUR_HEIGHT_PX + 1;
              const heightPx = Math.max(
                44,
                ((endMin - startMin) / 60) * HOUR_HEIGHT_PX - 2
              );
              const widthPct = 100 / totalCols;
              const leftPct = colIndex * widthPct;
              const timeLabel = formatTaskTimeRange(task, "Europe/Moscow");

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
                    "pointer-events-auto absolute z-10 flex cursor-pointer items-start gap-2 overflow-hidden rounded-xl border border-border/65 px-2.5 py-1.5 text-xs transition-colors",
                    blockTone,
                    isDone && "opacity-60"
                  )}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-0.5 shrink-0"
                  >
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={(v) => onToggleTask(task, Boolean(v))}
                      aria-label={`Отметить «${task.title}»`}
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
                    {timeLabel ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] leading-none font-semibold text-muted-foreground num-tabular">
                        <ClockIcon className="size-2.5 text-primary" />
                        {timeLabel}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "line-clamp-2 whitespace-normal break-words font-medium text-foreground",
                        isDone && "line-through text-muted-foreground"
                      )}
                    >
                      {task.title}
                    </span>
                    {heightPx >= 64 && proj ? (
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {proj.title}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
