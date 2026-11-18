"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarcodeIcon,
  CalendarPlusIcon,
  ChefHatIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  MinusIcon,
  MoonStarIcon,
  PackageCheckIcon,
  PencilIcon,
  PlusIcon,
  ScaleIcon,
  SearchIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
  Trash2Icon,
  TrendingDownIcon,
  UtensilsIcon,
} from "lucide-react";
import type {
  BodyWeightLog,
  CalorieLog,
  DayFoodDiary,
  DiaryMealSlot,
  IngredientUnit,
  MealCategory,
  MealPlanEntryWithRecipe,
  MealSlot,
  NutritionAndWeightAnalytics,
  NutritionDashboardData,
  PantryItem,
  RecipeWithIngredients,
  ShoppingListItem,
} from "@life-os/db";
import {
  addShoppingItemAction,
  adjustPantryQtyAction,
  clearCheckedShoppingAction,
  deleteBodyWeightAction,
  deleteCalorieLogAction,
  deleteShoppingItemAction,
  fetchDayFoodDiaryAction,
  fetchNutritionAndWeightAnalyticsAction,
  fetchNutritionWeekAction,
  generateShoppingFromMenuAction,
  markMealStatusAction,
  toggleRecipeFavoriteAction,
  toggleShoppingItemAction,
} from "@/app/nutrition-actions";
import {
  AISLE_GROUPS,
  AddFoodModal,
  AiTargetsConfigurator,
  MEAL_CATEGORY_LABELS,
  MEAL_SLOT_LABELS,
  MealPlanFormModal,
  NutritionTargetsModal,
  PantryFormModal,
  RecipeFormModal,
  UNIT_LABELS_RU,
  WeightLogModal,
} from "@/components/modules/nutrition-modals";
import { cn, formatDateLongRu, formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function formatQtyUnitRu(qty: number | null | undefined, unit: string): string {
  const val = Number(qty ?? 0);
  const rounded = Number.isInteger(val)
    ? String(val)
    : val.toFixed(1).replace(/\.0$/, "");
  const label = UNIT_LABELS_RU[unit as IngredientUnit] ?? unit;
  return `${rounded} ${label}`;
}

function MealSlotVisualIcon({ slot }: { slot: DiaryMealSlot }) {
  switch (slot) {
    case "breakfast":
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-warning">
          <SunriseIcon className="size-5" />
        </div>
      );
    case "lunch":
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-domain-work">
          <SunIcon className="size-5" />
        </div>
      );
    case "dinner":
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-domain-health">
          <SunsetIcon className="size-5" />
        </div>
      );
    default:
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-domain-mind">
          <MoonStarIcon className="size-5" />
        </div>
      );
  }
}

const LOG_SOURCE_BADGES: Record<string, string> = {
  barcode: "штрихкод",
  photo_ai: "фото ИИ",
  recipe: "рецепт",
  mcp: "TG",
  openclaw: "TG",
};

// ============================================================================
// Pure SVG Charts for Weight Trend & Daily Calories vs Target
// ============================================================================

function WeightTrendSvgChart({
  analytics,
}: {
  analytics: NutritionAndWeightAnalytics;
}) {
  const pts = analytics.series;
  const values: number[] = [];
  for (const p of pts) {
    if (p.weight_kg !== null) values.push(p.weight_kg);
    if (p.weight_ma7_kg !== null) values.push(p.weight_ma7_kg);
  }
  if (analytics.weight_summary.target_weight_kg !== null) {
    values.push(analytics.weight_summary.target_weight_kg);
  }

  if (values.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
        Добавь хотя бы один замер веса, чтобы увидеть график тренда
      </div>
    );
  }

  const minVal = Math.floor((Math.min(...values) - 0.8) * 10) / 10;
  const maxVal = Math.ceil((Math.max(...values) + 0.8) * 10) / 10;
  const span = Math.max(1, maxVal - minVal);

  const W = 620;
  const H = 190;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const toX = (idx: number) =>
    pts.length <= 1
      ? padL + plotW / 2
      : padL + (idx / (pts.length - 1)) * plotW;
  const toY = (val: number) => padT + ((maxVal - val) / span) * plotH;

  const maCoords = pts
    .map((p, idx) =>
      p.weight_ma7_kg !== null ? `${toX(idx).toFixed(1)},${toY(p.weight_ma7_kg).toFixed(1)}` : null
    )
    .filter(Boolean) as string[];

  const rawDots = pts
    .map((p, idx) =>
      p.weight_kg !== null
        ? { x: toX(idx), y: toY(p.weight_kg), val: p.weight_kg, date: p.date }
        : null
    )
    .filter(Boolean) as Array<{ x: number; y: number; val: number; date: string }>;

  const targetW = analytics.weight_summary.target_weight_kg;
  const targetY = targetW !== null ? toY(targetW) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-48 w-full overflow-visible"
      role="img"
      aria-label="График динамики веса тела"
    >
      {/* Y Grid lines */}
      {[0, 0.5, 1].map((t) => {
        const val = maxVal - span * t;
        const y = padT + plotH * t;
        return (
          <g key={t}>
            <line
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              className="stroke-border/70"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] num-tabular"
            >
              {val.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* Target weight dashed line */}
      {targetY !== null ? (
        <g>
          <line
            x1={padL}
            y1={targetY}
            x2={W - padR}
            y2={targetY}
            className="stroke-domain-nutrition"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          <text
            x={W - padR}
            y={targetY - 5}
            textAnchor="end"
            className="fill-muted-foreground text-[10px] num-tabular"
          >
            Цель {targetW} кг
          </text>
        </g>
      ) : null}

      {/* 7-day moving average polyline */}
      {maCoords.length >= 2 ? (
        <polyline
          fill="none"
          points={maCoords.join(" ")}
          className="stroke-primary"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {/* Raw weight measurements */}
      {rawDots.map((d) => (
        <circle
          key={d.date}
          cx={d.x}
          cy={d.y}
          r={4}
          className="fill-card stroke-primary"
          strokeWidth={2}
        />
      ))}

      {/* X axis start / middle / end dates */}
      {[0, Math.floor((pts.length - 1) / 2), pts.length - 1]
        .filter((v, i, arr) => v >= 0 && v < pts.length && arr.indexOf(v) === i)
        .map((idx) => (
          <text
            key={idx}
            x={toX(idx)}
            y={H - 6}
            textAnchor={
              idx === 0 ? "start" : idx === pts.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground text-[10px] num-tabular"
          >
            {formatDateShortRu(pts[idx].date)}
          </text>
        ))}
    </svg>
  );
}

function CalorieBarsSvgChart({
  analytics,
}: {
  analytics: NutritionAndWeightAnalytics;
}) {
  const pts = analytics.series;
  if (pts.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
        Запиши приёмы пищи, чтобы увидеть динамику калорий по дням
      </div>
    );
  }
  const targetKcal = Math.max(1000, Number(analytics.targets.kcal_target || 2200));
  const maxKcal = Math.max(
    targetKcal * 1.2,
    ...pts.map((p) => p.kcal),
    1500
  );

  const W = 620;
  const H = 190;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const slotW = plotW / Math.max(1, pts.length);
  const barW = Math.max(4, Math.min(26, slotW * 0.66));
  const toY = (val: number) => padT + ((maxKcal - val) / maxKcal) * plotH;
  const targetY = toY(targetKcal);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-48 w-full overflow-visible"
      role="img"
      aria-label="График потребления калорий по дням"
    >
      {[0, 0.5, 1].map((t) => {
        const val = Math.round(maxKcal * (1 - t));
        const y = padT + plotH * t;
        return (
          <g key={t}>
            <line
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              className="stroke-border/70"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] num-tabular"
            >
              {val}
            </text>
          </g>
        );
      })}

      {/* Daily bars */}
      {pts.map((p, idx) => {
        const xCenter = padL + slotW * idx + slotW / 2;
        const barH = Math.max(2, (p.kcal / maxKcal) * plotH);
        const y = padT + plotH - barH;
        const isOver = p.kcal > targetKcal * 1.12;
        return (
          <rect
            key={p.date}
            x={xCenter - barW / 2}
            y={p.kcal > 0 ? y : padT + plotH - 2}
            width={barW}
            height={p.kcal > 0 ? barH : 2}
            rx={4}
            className={cn(
              p.kcal === 0
                ? "fill-muted"
                : isOver
                  ? "fill-warning"
                  : "fill-primary/85"
            )}
          />
        );
      })}

      {/* Norm line */}
      <line
        x1={padL}
        y1={targetY}
        x2={W - padR}
        y2={targetY}
        className="stroke-foreground/75"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <text
        x={W - padR}
        y={targetY - 5}
        textAnchor="end"
        className="fill-foreground text-[10px] font-medium num-tabular"
      >
        Норма {targetKcal} ккал
      </text>

      {[0, Math.floor((pts.length - 1) / 2), pts.length - 1]
        .filter((v, i, arr) => v >= 0 && v < pts.length && arr.indexOf(v) === i)
        .map((idx) => {
          const xCenter = padL + slotW * idx + slotW / 2;
          return (
            <text
              key={idx}
              x={xCenter}
              y={H - 6}
              textAnchor={
                idx === 0 ? "start" : idx === pts.length - 1 ? "end" : "middle"
              }
              className="fill-muted-foreground text-[10px] num-tabular"
            >
              {formatDateShortRu(pts[idx].date)}
            </text>
          );
        })}
    </svg>
  );
}

// ============================================================================
// Main NutritionView Component
// ============================================================================

interface NutritionViewProps {
  initialTab?: string;
  data: NutritionDashboardData;
}

export function NutritionView({ initialTab, data }: NutritionViewProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const validTabs = ["diary", "recipes", "stats", "menu", "shopping", "pantry"];
  const [activeTab, setActiveTab] = React.useState<string>(
    initialTab && validTabs.includes(initialTab) ? initialTab : "diary"
  );

  // Day Food Diary state (Default Landing View!)
  const [diaryDate, setDiaryDate] = React.useState<string>(data.dayDiary.date);
  const [dayDiary, setDayDiary] = React.useState<DayFoodDiary>(data.dayDiary);
  const [diaryLoading, setDiaryLoading] = React.useState(false);
  const [expandedMeals, setExpandedMeals] = React.useState<
    Record<DiaryMealSlot, boolean>
  >({
    breakfast: false,
    lunch: false,
    dinner: false,
    snack: false,
  });

  React.useEffect(() => {
    if (diaryDate === data.dayDiary.date) {
      setDayDiary(data.dayDiary);
    }
  }, [data.dayDiary, diaryDate]);

  const loadDiaryDate = React.useCallback(
    async (targetDate: string) => {
      setDiaryDate(targetDate);
      if (targetDate === data.dayDiary.date) {
        setDayDiary(data.dayDiary);
        return;
      }
      setDiaryLoading(true);
      try {
        const res = await fetchDayFoodDiaryAction(targetDate);
        setDayDiary(res);
      } catch {
        toast.error("Не удалось загрузить дневник за выбранный день");
      } finally {
        setDiaryLoading(false);
      }
    },
    [data.dayDiary]
  );

  // Combined Weight + КБЖУ Analytics state
  const [statsDays, setStatsDays] = React.useState<7 | 14 | 30 | 90>(14);
  const [analytics, setAnalytics] = React.useState<NutritionAndWeightAnalytics>(
    data.analytics14d
  );
  const [statsLoading, setStatsLoading] = React.useState(false);

  React.useEffect(() => {
    if (statsDays === 14) {
      setAnalytics(data.analytics14d);
    }
  }, [data.analytics14d, statsDays]);

  async function handleSelectStatsPeriod(nextDays: 7 | 14 | 30 | 90) {
    setStatsDays(nextDays);
    if (nextDays === 14) {
      setAnalytics(data.analytics14d);
      return;
    }
    setStatsLoading(true);
    try {
      const res = await fetchNutritionAndWeightAnalyticsAction(nextDays);
      setAnalytics(res);
    } catch {
      toast.error("Не удалось загрузить статистику за период");
    } finally {
      setStatsLoading(false);
    }
  }

  // Week Meal Plan state
  const [weekStart, setWeekStart] = React.useState(data.weekStart);
  const [weekEnd, setWeekEnd] = React.useState(data.weekEnd);
  const [weekDates, setWeekDates] = React.useState(data.weekDates);
  const [weekMealPlan, setWeekMealPlan] = React.useState<
    MealPlanEntryWithRecipe[]
  >(data.weekMealPlan);
  const [weekLoading, setWeekLoading] = React.useState(false);
  const [deductOnCook, setDeductOnCook] = React.useState(true);

  React.useEffect(() => {
    if (weekStart === data.weekStart) {
      setWeekMealPlan(data.weekMealPlan);
    }
  }, [data.weekStart, data.weekMealPlan, weekStart]);

  async function handleShiftWeek(anchorIso: string) {
    setWeekLoading(true);
    try {
      const res = await fetchNutritionWeekAction(anchorIso);
      setWeekStart(res.weekStart);
      setWeekEnd(res.weekEnd);
      setWeekDates(res.weekDates);
      setWeekMealPlan(res.weekMealPlan);
    } catch {
      toast.error("Не удалось загрузить неделю меню");
    } finally {
      setWeekLoading(false);
    }
  }

  // Optimistic Shopping List
  const [optimisticShopping, applyOptimisticCheck] = React.useOptimistic(
    data.shoppingItems,
    (current: ShoppingListItem[], upd: { id: number; checked: boolean }) =>
      current.map((item) =>
        item.id === upd.id ? { ...item, is_checked: upd.checked } : item
      )
  );
  const [shopName, setShopName] = React.useState("");
  const [shopQty, setShopQty] = React.useState("1");
  const [shopUnit, setShopUnit] = React.useState<IngredientUnit>("pcs");
  const [shopAisle, setShopAisle] = React.useState("Овощи и зелень");

  // Pantry & Recipe Filters
  const [pantrySearch, setPantrySearch] = React.useState("");
  const [recipeSearch, setRecipeSearch] = React.useState("");
  const [recipeCategory, setRecipeCategory] = React.useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  // Modals State
  const [addFoodOpen, setAddFoodOpen] = React.useState(false);
  const [addFoodSlot, setAddFoodSlot] =
    React.useState<DiaryMealSlot>("breakfast");
  const [addFoodMode, setAddFoodMode] = React.useState<
    "search" | "barcode" | "recipe"
  >("search");
  const [addFoodRecipeId, setAddFoodRecipeId] = React.useState<number | null>(
    null
  );
  const [editingDiaryEntry, setEditingDiaryEntry] =
    React.useState<CalorieLog | null>(null);

  const [targetsModalOpen, setTargetsModalOpen] = React.useState(false);

  const [weightModalOpen, setWeightModalOpen] = React.useState(false);
  const [editingWeight, setEditingWeight] =
    React.useState<BodyWeightLog | null>(null);

  const [recipeModalOpen, setRecipeModalOpen] = React.useState(false);
  const [editingRecipe, setEditingRecipe] =
    React.useState<RecipeWithIngredients | null>(null);

  const [mealModalOpen, setMealModalOpen] = React.useState(false);
  const [editingMeal, setEditingMeal] =
    React.useState<MealPlanEntryWithRecipe | null>(null);
  const [mealDefaultDate, setMealDefaultDate] = React.useState(data.todayDate);
  const [mealDefaultRecipeId, setMealDefaultRecipeId] =
    React.useState<number | null>(null);

  const [pantryModalOpen, setPantryModalOpen] = React.useState(false);
  const [editingPantry, setEditingPantry] = React.useState<PantryItem | null>(
    null
  );

  function openAddFood(
    slot: DiaryMealSlot,
    mode: "search" | "barcode" | "recipe" = "search",
    recipeId: number | null = null
  ) {
    setEditingDiaryEntry(null);
    setAddFoodSlot(slot);
    setAddFoodMode(mode);
    setAddFoodRecipeId(recipeId);
    setAddFoodOpen(true);
  }

  // Derived data
  const targets = dayDiary.targets;
  const totals = dayDiary.totals;
  const displayedWeight = dayDiary.dayWeight ?? dayDiary.latestWeight;

  const uncheckedShoppingCount = optimisticShopping.filter(
    (i) => !i.is_checked
  ).length;
  const checkedShoppingCount = optimisticShopping.filter(
    (i) => i.is_checked
  ).length;

  const groupedShopping = React.useMemo(() => {
    const groups = new Map<string, ShoppingListItem[]>();
    for (const item of optimisticShopping) {
      const aisle = item.aisle_group || "Прочее";
      const arr = groups.get(aisle) ?? [];
      arr.push(item);
      groups.set(aisle, arr);
    }
    return Array.from(groups.entries());
  }, [optimisticShopping]);

  const lowStockCount = React.useMemo(
    () =>
      data.pantryItems.filter(
        (p) =>
          p.low_stock_threshold !== null &&
          Number(p.quantity_on_hand) <= Number(p.low_stock_threshold)
      ).length,
    [data.pantryItems]
  );

  const filteredPantry = React.useMemo(() => {
    const q = pantrySearch.trim().toLowerCase();
    if (!q) return data.pantryItems;
    return data.pantryItems.filter(
      (p) =>
        p.display_name.toLowerCase().includes(q) ||
        (p.aisle_group ?? "").toLowerCase().includes(q)
    );
  }, [data.pantryItems, pantrySearch]);

  const filteredRecipes = React.useMemo(() => {
    const q = recipeSearch.trim().toLowerCase();
    return data.recipes.filter((r) => {
      if (recipeCategory !== "all" && r.meal_category !== recipeCategory) {
        return false;
      }
      if (favoritesOnly && !r.is_favorite) return false;
      if (q) {
        const hay = `${r.title} ${(r.tags ?? []).join(" ")} ${r.ingredients
          .map((i) => i.display_name)
          .join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.recipes, recipeSearch, recipeCategory, favoritesOnly]);

  function handleGenerateShopping() {
    startTransition(async () => {
      try {
        const res = await generateShoppingFromMenuAction({
          startDate: weekStart,
          endDate: weekEnd,
        });
        const pantryNote =
          res.coveredByPantryCount > 0 || res.partiallySubtractedCount > 0
            ? ` (вычтены запасы дома: ${res.coveredByPantryCount} полностью, ${res.partiallySubtractedCount} частично)`
            : "";
        toast.success(
          `Список покупок собран: ${res.addedCount} поз.${pantryNote}`
        );
        setActiveTab("shopping");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не удалось собрать список покупок"
        );
      }
    });
  }

  function handleMarkCooked(entry: MealPlanEntryWithRecipe) {
    startTransition(async () => {
      try {
        const nextStatus = entry.status === "planned" ? "cooked" : "planned";
        const deducted = await markMealStatusAction({
          id: entry.id,
          status: nextStatus,
          deductFromPantry: nextStatus === "cooked" && deductOnCook,
        });
        setWeekMealPlan((prev) =>
          prev.map((m) =>
            m.id === entry.id ? { ...m, status: nextStatus } : m
          )
        );
        toast.success(
          nextStatus === "cooked"
            ? deducted > 0
              ? `Отмечено приготовленным (списано из запасов: ${deducted})`
              : "Отмечено приготовленным"
            : "Возвращено в план"
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Ошибка обновления статуса"
        );
      }
    });
  }

  function handleToggleShopping(item: ShoppingListItem, checked: boolean) {
    startTransition(async () => {
      applyOptimisticCheck({ id: item.id, checked });
      try {
        await toggleShoppingItemAction(item.id, checked);
      } catch {
        toast.error("Не удалось отметить покупку");
      }
    });
  }

  function handleQuickAddShopping(e: React.FormEvent) {
    e.preventDefault();
    if (!shopName.trim()) return;
    startTransition(async () => {
      try {
        await addShoppingItemAction({
          display_name: shopName,
          quantity_needed: Number(shopQty) || 1,
          unit: shopUnit,
          aisle_group: shopAisle,
        });
        setShopName("");
        setShopQty("1");
        toast.success("Добавлено в список покупок");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка добавления");
      }
    });
  }

  const refreshActiveDiaryIfNeeded = React.useCallback(() => {
    if (diaryDate !== data.todayDate) {
      void loadDiaryDate(diaryDate);
    } else {
      router.refresh();
    }
  }, [diaryDate, data.todayDate, loadDiaryDate, router]);

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Питание и дневник КБЖУ
          </h1>
          <p className="text-sm text-muted-foreground">
            Дневник приёмов пищи, сканер штрихкодов, рецепты с авто-КБЖУ, покупки и вес
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTargetsModalOpen(true)}
            className="min-h-10 rounded-xl"
          >
            <SparklesIcon data-icon="inline-start" />
            Норма КБЖУ (ИИ)
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingWeight(null);
              setWeightModalOpen(true);
            }}
            className="min-h-10 rounded-xl"
          >
            <ScaleIcon data-icon="inline-start" />
            Внести вес
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => openAddFood("snack", "barcode")}
            className="min-h-10 rounded-xl"
          >
            <BarcodeIcon data-icon="inline-start" />
            Штрихкод
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => openAddFood("breakfast", "search")}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Записать еду
          </Button>
        </div>
      </div>

      {/* Main Flush-Left Tabs (Default = Day Diary!) */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="diary">Дневник дня</TabsTrigger>
          <TabsTrigger value="recipes" className="gap-1.5">
            Рецепты
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[11px] num-tabular"
            >
              {data.recipes.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="stats">Вес и статистика</TabsTrigger>
          <TabsTrigger value="menu">Меню недели</TabsTrigger>
          <TabsTrigger value="shopping" className="gap-1.5">
            Список покупок
            {uncheckedShoppingCount > 0 ? (
              <Badge className="px-1.5 py-0 text-[11px] num-tabular">
                {uncheckedShoppingCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="pantry" className="gap-1.5">
            Запасы дома
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[11px] num-tabular"
            >
              {data.pantryItems.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: SPECIFIC DAY DIARY (DEFAULT LANDING VIEW!)                */}
        {/* ================================================================ */}
        <TabsContent value="diary" className="mt-4 flex flex-col gap-4">
          {/* AI First-Entry Calorie & Macro Onboarding Banner */}
          {!targets.is_configured ? (
            <Card className="rounded-2xl border-primary/40 bg-accent/35 shadow-none">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SparklesIcon className="size-4 text-primary" />
                    <CardTitle className="text-base font-semibold tracking-tight">
                      Первичная настройка нормы КБЖУ с ИИ
                    </CardTitle>
                  </div>
                  <Badge>Первый запуск</Badge>
                </div>
                <CardDescription>
                  Опиши свой ритм, параметры и цель своими словами — ИИ рассчитает индивидуальный калораж и баланс белков, жиров и углеводов
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AiTargetsConfigurator
                  targets={targets}
                  latestWeightKg={
                    displayedWeight ? Number(displayedWeight.weight_kg) : null
                  }
                  onSaved={refreshActiveDiaryIfNeeded}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Day Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/85 bg-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void loadDiaryDate(shiftIsoDate(diaryDate, -1))}
                aria-label="Предыдущий день"
                className="size-9 rounded-xl"
              >
                <ChevronLeftIcon />
              </Button>

              <div className="flex items-center gap-2 px-1">
                <span className="text-sm font-semibold tracking-tight">
                  {formatDateLongRu(diaryDate)}
                </span>
                {diaryDate === data.todayDate ? (
                  <Badge variant="secondary">Сегодня</Badge>
                ) : null}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void loadDiaryDate(shiftIsoDate(diaryDate, 1))}
                aria-label="Следующий день"
                className="size-9 rounded-xl"
              >
                <ChevronRightIcon />
              </Button>

              {diaryLoading ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {diaryDate !== data.todayDate ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void loadDiaryDate(data.todayDate)}
                  className="min-h-9 rounded-lg"
                >
                  Сегодня
                </Button>
              ) : null}
              <Input
                type="date"
                value={diaryDate}
                onChange={(e) => {
                  if (e.target.value) void loadDiaryDate(e.target.value);
                }}
                aria-label="Выбрать дату дневника"
                className="h-9 w-[142px] text-xs num-tabular"
              />
            </div>
          </div>

          {/* Daily Summary Strip (Calories + Macros + Today's Weight) */}
          <Card className="rounded-2xl shadow-none">
            <CardContent className="flex flex-col gap-3.5 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-2.5 num-tabular">
                  <span className="text-3xl font-semibold tracking-tight">
                    {totals.kcal}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    из {targets.kcal_target} ккал ({totals.pct_of_target}%)
                  </span>
                  <Badge
                    variant={totals.remaining_kcal >= 0 ? "secondary" : "outline"}
                  >
                    {totals.remaining_kcal >= 0
                      ? `Осталось ${totals.remaining_kcal} ккал`
                      : `Сверх нормы +${Math.abs(totals.remaining_kcal)} ккал`}
                  </Badge>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingWeight(dayDiary.dayWeight);
                    setWeightModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/45 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted num-tabular"
                >
                  <ScaleIcon className="size-3.5 text-primary" />
                  {displayedWeight
                    ? `Вес: ${displayedWeight.weight_kg} кг`
                    : "Внести вес"}
                </button>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    totals.remaining_kcal < -150 ? "bg-warning" : "bg-primary"
                  )}
                  style={{
                    width: `${Math.min(100, Math.max(2, totals.pct_of_target))}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3 num-tabular">
                <div className="flex flex-col justify-between gap-1.5 rounded-xl bg-muted/50 px-2.5 py-2.5 sm:px-3">
                  <span className="truncate text-[11px] font-medium leading-none text-muted-foreground">
                    Белки
                  </span>
                  <div className="whitespace-nowrap leading-tight">
                    <span className="text-xs font-semibold text-foreground sm:text-sm">
                      {totals.protein_g}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {" "}
                      / {targets.protein_target_g} г
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-domain-work"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (totals.protein_g /
                              Math.max(1, Number(targets.protein_target_g))) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-1.5 rounded-xl bg-muted/50 px-2.5 py-2.5 sm:px-3">
                  <span className="truncate text-[11px] font-medium leading-none text-muted-foreground">
                    Жиры
                  </span>
                  <div className="whitespace-nowrap leading-tight">
                    <span className="text-xs font-semibold text-foreground sm:text-sm">
                      {totals.fat_g}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {" "}
                      / {targets.fat_target_g} г
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-domain-nutrition"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (totals.fat_g /
                              Math.max(1, Number(targets.fat_target_g))) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-between gap-1.5 rounded-xl bg-muted/50 px-2.5 py-2.5 sm:px-3">
                  <span className="truncate text-[11px] font-medium leading-none text-muted-foreground">
                    Углеводы
                  </span>
                  <div className="whitespace-nowrap leading-tight">
                    <span className="text-xs font-semibold text-foreground sm:text-sm">
                      {totals.carbs_g}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {" "}
                      / {targets.carbs_target_g} г
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-domain-finance"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (totals.carbs_g /
                              Math.max(1, Number(targets.carbs_target_g))) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Column Totals Header + 4 Collapsible Meal Cards (Matching Reference Screenshot!) */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {/* Top Column Legend & Day Totals Row */}
            <div className="grid grid-cols-12 items-center px-4 text-xs text-muted-foreground num-tabular">
              <span className="col-span-3 truncate whitespace-nowrap font-medium">
                <span className="hidden sm:inline">Белки </span>
                <span className="sm:hidden">Б </span>
                {totals.protein_g}
              </span>
              <span className="col-span-3 truncate whitespace-nowrap font-medium">
                <span className="hidden sm:inline">Жиры </span>
                <span className="sm:hidden">Ж </span>
                {totals.fat_g}
              </span>
              <span className="col-span-3 truncate whitespace-nowrap font-medium">
                <span className="hidden sm:inline">Угл. </span>
                <span className="sm:hidden">У </span>
                {totals.carbs_g}
              </span>
              <span className="col-span-1 whitespace-nowrap text-right">
                {totals.pct_of_target}%
              </span>
              <span className="col-span-2 whitespace-nowrap text-right text-sm font-bold text-foreground">
                {totals.kcal}
              </span>
            </div>

            {dayDiary.mealList.map((meal) => {
              const isExpanded = Boolean(expandedMeals[meal.slot]);
              const mealTitle =
                meal.slot === "snack" ? "Перекус / Другое" : meal.label;

              return (
                <div
                  key={meal.slot}
                  className="overflow-hidden rounded-2xl border border-border/85 bg-card shadow-xs"
                >
                  {/* Top Meal Header Row: Icon + Title on Left | Kcal + Green '+' on Right */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMeals((prev) => ({
                          ...prev,
                          [meal.slot]: !prev[meal.slot],
                        }))
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <MealSlotVisualIcon slot={meal.slot} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-lg font-semibold tracking-tight">
                          {mealTitle}
                        </span>
                        {meal.entries.length > 0 ? (
                          <span className="text-xs text-muted-foreground num-tabular">
                            Записей: {meal.entries.length}
                          </span>
                        ) : null}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="flex flex-col items-end num-tabular">
                        <span className="text-xl font-bold leading-none tracking-tight">
                          {meal.kcal}
                        </span>
                        <span className="pt-0.5 text-[11px] text-muted-foreground">
                          ккал
                        </span>
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        onClick={() => openAddFood(meal.slot, "search")}
                        aria-label={`Добавить еду в ${mealTitle}`}
                        className="size-11 rounded-full bg-accent text-primary hover:bg-primary hover:text-primary-foreground"
                      >
                        <PlusIcon className="size-5" />
                      </Button>
                    </div>
                  </div>

                  {/* Tinted Macro Sub-Bar: Б / Ж / У / % of day + Expand Chevron */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMeals((prev) => ({
                        ...prev,
                        [meal.slot]: !prev[meal.slot],
                      }))
                    }
                    aria-expanded={isExpanded}
                    className="grid w-full grid-cols-12 items-center border-t border-border/60 bg-muted/65 px-4 py-2.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-muted num-tabular"
                  >
                    <span className="col-span-3 truncate whitespace-nowrap">
                      Б {meal.protein_g}
                    </span>
                    <span className="col-span-3 truncate whitespace-nowrap">
                      Ж {meal.fat_g}
                    </span>
                    <span className="col-span-3 truncate whitespace-nowrap">
                      У {meal.carbs_g}
                    </span>
                    <span className="col-span-2 whitespace-nowrap text-right text-muted-foreground">
                      {meal.pct_of_day}%
                    </span>
                    <span className="col-span-1 flex justify-end">
                      <ChevronDownIcon
                        className={cn(
                          "size-4 text-muted-foreground transition-transform duration-150",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </span>
                  </button>

                  {/* Expanded Meal Entries */}
                  {isExpanded ? (
                    <div className="divide-y divide-border/60 border-t border-border/60 bg-background/55">
                      {meal.entries.length === 0 ? (
                        <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
                          <span>Пока ничего не записано</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => openAddFood(meal.slot, "barcode")}
                            className="rounded-lg"
                          >
                            <BarcodeIcon data-icon="inline-start" />
                            Сканировать штрихкод
                          </Button>
                        </div>
                      ) : (
                        meal.entries.map((entry) => {
                          const srcLabel = LOG_SOURCE_BADGES[entry.source];
                          return (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between gap-3 px-4 py-2.5"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingDiaryEntry(entry);
                                  setAddFoodOpen(true);
                                }}
                                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-medium">
                                    {entry.title}
                                  </span>
                                  {entry.grams ? (
                                    <span className="text-xs text-muted-foreground num-tabular">
                                      · {entry.grams} г
                                    </span>
                                  ) : entry.servings ? (
                                    <span className="text-xs text-muted-foreground num-tabular">
                                      · {entry.servings} порц.
                                    </span>
                                  ) : null}
                                  {srcLabel ? (
                                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {srcLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-[11px] text-muted-foreground num-tabular">
                                  Б {entry.protein_g ?? 0} г · Ж{" "}
                                  {entry.fat_g ?? 0} г · У {entry.carbs_g ?? 0} г
                                </span>
                              </button>

                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className="text-sm font-semibold num-tabular">
                                  {entry.kcal} ккал
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => {
                                    setEditingDiaryEntry(entry);
                                    setAddFoodOpen(true);
                                  }}
                                  aria-label="Изменить порцию"
                                  className="size-9 rounded-xl"
                                >
                                  <PencilIcon className="size-3.5 text-muted-foreground" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={pending}
                                  onClick={() =>
                                    startTransition(async () => {
                                      await deleteCalorieLogAction(entry.id);
                                      refreshActiveDiaryIfNeeded();
                                    })
                                  }
                                  aria-label="Удалить запись"
                                  className="size-9 rounded-xl text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 2: RECIPES WITH AUTO-CALCULATED КБЖУ                         */}
        {/* ================================================================ */}
        <TabsContent value="recipes" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Поиск по названию блюда, ингредиенту или тегу…"
                className="min-h-10 pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={recipeCategory}
                onValueChange={(v) => v && setRecipeCategory(v)}
                variant="outline"
                spacing={1}
                className="flex flex-wrap justify-start"
              >
                <ToggleGroupItem value="all" className="min-h-9 px-2.5 text-xs">
                  Все
                </ToggleGroupItem>
                {Object.entries(MEAL_CATEGORY_LABELS).map(([k, lbl]) => (
                  <ToggleGroupItem
                    key={k}
                    value={k}
                    className="min-h-9 px-2.5 text-xs"
                  >
                    {lbl}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <Button
                type="button"
                variant={favoritesOnly ? "secondary" : "outline"}
                size="sm"
                onClick={() => setFavoritesOnly((f) => !f)}
                className="min-h-9 rounded-xl"
              >
                <StarIcon data-icon="inline-start" />
                Избранные
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEditingRecipe(null);
                  setRecipeModalOpen(true);
                }}
                className="min-h-9 rounded-xl"
              >
                <PlusIcon data-icon="inline-start" />
                Новый рецепт
              </Button>
            </div>
          </div>

          {filteredRecipes.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <ChefHatIcon className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    {data.recipes.length === 0
                      ? "Книга рецептов пока пуста"
                      : "Рецепты по фильтру не найдены"}
                  </p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Добавь свои любимые блюда с граммовками ингредиентов — КБЖУ на порцию и на 100 г рассчитаются автоматически по справочнику продуктов.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setEditingRecipe(null);
                    setRecipeModalOpen(true);
                  }}
                  className="min-h-10 rounded-xl"
                >
                  <PlusIcon data-icon="inline-start" />
                  Новый рецепт
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredRecipes.map((rec) => {
              const targetDiarySlot: DiaryMealSlot =
                rec.meal_category === "breakfast"
                  ? "breakfast"
                  : rec.meal_category === "lunch"
                    ? "lunch"
                    : rec.meal_category === "dinner"
                      ? "dinner"
                      : "snack";

              return (
                <Card
                  key={rec.id}
                  className="flex flex-col justify-between rounded-2xl shadow-none"
                >
                  <CardHeader className="pb-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">
                            {MEAL_CATEGORY_LABELS[
                              rec.meal_category as MealCategory
                            ] ?? rec.meal_category}
                          </Badge>
                          {rec.cook_time_minutes ? (
                            <Badge variant="outline" className="gap-1 num-tabular">
                              <ClockIcon className="size-3" />
                              {rec.cook_time_minutes} мин
                            </Badge>
                          ) : null}
                          <span className="text-xs text-muted-foreground num-tabular">
                            на {rec.default_servings} порц.
                          </span>
                        </div>
                        <CardTitle className="text-base font-semibold leading-snug">
                          {rec.title}
                        </CardTitle>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          startTransition(async () => {
                            await toggleRecipeFavoriteAction(
                              rec.id,
                              !rec.is_favorite
                            );
                          })
                        }
                        aria-label="Избранное"
                        className="size-9 shrink-0 rounded-xl"
                      >
                        <StarIcon
                          className={cn(
                            "size-4",
                            rec.is_favorite
                              ? "fill-primary text-primary"
                              : "text-muted-foreground"
                          )}
                        />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-2.5">
                    {/* Auto-Calculated Macros Box */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/55 px-3 py-2 text-xs num-tabular">
                      <span className="font-semibold text-foreground">
                        {rec.kcal_per_serving ?? 0} ккал / порц.
                      </span>
                      <span className="text-muted-foreground">
                        Б {rec.protein_g ?? 0} · Ж {rec.fat_g ?? 0} · У{" "}
                        {rec.carbs_g ?? 0}
                      </span>
                      {rec.kcal_per_100g ? (
                        <span className="text-[11px] text-muted-foreground">
                          ({Math.round(Number(rec.kcal_per_100g))} ккал/100г)
                        </span>
                      ) : null}
                    </div>

                    {rec.ingredients.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {rec.ingredients.slice(0, 6).map((ing) => (
                          <span
                            key={ing.id}
                            className="rounded-lg bg-muted/70 px-2 py-0.5 text-xs text-foreground num-tabular"
                          >
                            {ing.display_name} ·{" "}
                            {formatQtyUnitRu(ing.amount, ing.unit)}
                          </span>
                        ))}
                        {rec.ingredients.length > 6 ? (
                          <span className="px-1 py-0.5 text-xs text-muted-foreground num-tabular">
                            +{rec.ingredients.length - 6}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {rec.steps_markdown ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {rec.steps_markdown}
                      </p>
                    ) : null}
                  </CardContent>

                  <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          openAddFood(targetDiarySlot, "recipe", rec.id)
                        }
                        className="rounded-xl"
                      >
                        <PlusIcon data-icon="inline-start" />В дневник дня
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingMeal(null);
                          setMealDefaultDate(data.todayDate);
                          setMealDefaultRecipeId(rec.id);
                          setMealModalOpen(true);
                        }}
                        className="rounded-xl"
                      >
                        <UtensilsIcon data-icon="inline-start" />В меню
                      </Button>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingRecipe(rec);
                        setRecipeModalOpen(true);
                      }}
                      className="rounded-xl"
                    >
                      <PencilIcon data-icon="inline-start" />
                      Состав
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 3: BODY WEIGHT & COMBINED КБЖУ STATISTICS                    */}
        {/* ================================================================ */}
        <TabsContent value="stats" className="mt-4 flex flex-col gap-5">
          {/* Period Switcher + Add Weight */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={String(statsDays)}
                onValueChange={(v) => {
                  if (v === "7" || v === "14" || v === "30" || v === "90") {
                    void handleSelectStatsPeriod(Number(v) as 7 | 14 | 30 | 90);
                  }
                }}
                variant="outline"
                spacing={1}
              >
                <ToggleGroupItem value="7" className="min-h-9 px-3 text-xs num-tabular">
                  7 дн.
                </ToggleGroupItem>
                <ToggleGroupItem value="14" className="min-h-9 px-3 text-xs num-tabular">
                  14 дн.
                </ToggleGroupItem>
                <ToggleGroupItem value="30" className="min-h-9 px-3 text-xs num-tabular">
                  30 дн.
                </ToggleGroupItem>
                <ToggleGroupItem value="90" className="min-h-9 px-3 text-xs num-tabular">
                  90 дн.
                </ToggleGroupItem>
              </ToggleGroup>
              {statsLoading ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingWeight(null);
                setWeightModalOpen(true);
              }}
              className="min-h-10 rounded-xl"
            >
              <ScaleIcon data-icon="inline-start" />
              Внести замер веса
            </Button>
          </div>

          {/* 4 Summary KPI Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-1.5">
                <CardDescription>Текущий вес и динамика</CardDescription>
                <CardTitle className="text-2xl font-semibold num-tabular">
                  {analytics.weight_summary.latest_weight_kg !== null
                    ? `${analytics.weight_summary.latest_weight_kg} кг`
                    : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-1.5 pt-0 text-xs text-muted-foreground num-tabular">
                <TrendingDownIcon className="size-3.5 text-primary" />
                {analytics.weight_summary.weight_delta_kg !== null
                  ? `Изменение за ${analytics.days} дн.: ${
                      analytics.weight_summary.weight_delta_kg > 0 ? "+" : ""
                    }${analytics.weight_summary.weight_delta_kg} кг`
                  : "Недостаточно точек для дельты"}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-1.5">
                <CardDescription>Средний калораж за период</CardDescription>
                <CardTitle className="text-2xl font-semibold num-tabular">
                  {analytics.averages.avg_kcal} ккал
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground num-tabular">
                Дневная цель: {analytics.targets.kcal_target} ккал
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-1.5">
                <CardDescription>Средние Б / Ж / У в день</CardDescription>
                <CardTitle className="text-xl font-semibold num-tabular">
                  {analytics.averages.avg_protein_g} /{" "}
                  {analytics.averages.avg_fat_g} /{" "}
                  {analytics.averages.avg_carbs_g} г
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground num-tabular">
                Заполнено дней: {analytics.averages.logged_days_count} из{" "}
                {analytics.days}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-1.5">
                <CardDescription>Попадание в коридор нормы</CardDescription>
                <CardTitle className="text-2xl font-semibold text-primary num-tabular">
                  {analytics.averages.target_adherence_pct}%
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                В пределах ±15% от дневной цели ккал
              </CardContent>
            </Card>
          </div>

          {/* Dual SVG Charts: Weight Trend + Calorie Intake */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  График веса и скользящая средняя (7 дн.)
                </CardTitle>
                <CardDescription>
                  Линия тренда сглаживает задержку воды и показывает реальное движение к цели
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WeightTrendSvgChart analytics={analytics} />
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Потребление калорий по дням vs норма
                </CardTitle>
                <CardDescription>
                  Сравнение фактического рациона с твоей целевой планкой КБЖУ
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CalorieBarsSvgChart analytics={analytics} />
              </CardContent>
            </Card>
          </div>

          {/* Weight Log History */}
          <Card className="rounded-2xl shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                История взвешиваний ({data.weightLogs.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border/65">
              {data.weightLogs.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Замеров веса пока нет — нажми «Внести вес» или отправь вес боту в Telegram.
                </p>
              ) : (
                data.weightLogs.slice(0, 15).map((w) => (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold num-tabular">
                        {w.weight_kg} кг
                      </span>
                      <span className="text-xs text-muted-foreground num-tabular">
                        {formatDateShortRu(w.logged_date)}
                      </span>
                      {w.body_fat_pct !== null ? (
                        <Badge variant="outline" className="text-[11px] num-tabular">
                          жир {w.body_fat_pct}%
                        </Badge>
                      ) : null}
                      {w.waist_cm !== null ? (
                        <Badge variant="outline" className="text-[11px] num-tabular">
                          талия {w.waist_cm} см
                        </Badge>
                      ) : null}
                      {w.note ? (
                        <span className="text-xs text-muted-foreground">
                          · {w.note}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setEditingWeight(w);
                          setWeightModalOpen(true);
                        }}
                        aria-label="Изменить замер"
                      >
                        <PencilIcon className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await deleteBodyWeightAction(w.id);
                            toast("Замер удалён");
                          })
                        }
                        aria-label="Удалить замер"
                      >
                        <Trash2Icon className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 4: WEEK MEAL PLANNER & COOKING                               */}
        {/* ================================================================ */}
        <TabsContent value="menu" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleShiftWeek(shiftIsoDate(weekStart, -7))}
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
                onClick={() => void handleShiftWeek(shiftIsoDate(weekStart, 7))}
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
                  onClick={() => void handleShiftWeek(data.todayDate)}
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
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={deductOnCook}
                  onCheckedChange={setDeductOnCook}
                />
                <span>Списывать запасы при готовке</span>
              </label>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingMeal(null);
                  setMealDefaultDate(data.todayDate);
                  setMealDefaultRecipeId(null);
                  setMealModalOpen(true);
                }}
                className="min-h-10 rounded-xl"
              >
                <CalendarPlusIcon data-icon="inline-start" />В план меню
              </Button>

              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={handleGenerateShopping}
                className="min-h-10 rounded-xl"
              >
                <ShoppingCartIcon data-icon="inline-start" />
                Собрать список покупок по меню
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {weekDates.map((dateIso) => {
              const isToday = dateIso === data.todayDate;
              const entries = weekMealPlan.filter((m) => m.plan_date === dateIso);
              const dayKcal = entries.reduce((sum, e) => {
                const perServ = Number(e.recipe?.kcal_per_serving ?? 0);
                return sum + Math.round(perServ * Number(e.planned_servings));
              }, 0);

              return (
                <Card
                  key={dateIso}
                  className={cn(
                    "flex flex-col justify-between rounded-2xl shadow-none",
                    isToday && "border-primary/45"
                  )}
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-semibold">
                          {formatDateLongRu(dateIso)}
                        </CardTitle>
                        {isToday ? <Badge>Сегодня</Badge> : null}
                      </div>
                      {dayKcal > 0 ? (
                        <span className="text-xs text-muted-foreground num-tabular">
                          План меню: ~{dayKcal} ккал
                        </span>
                      ) : null}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditingMeal(null);
                        setMealDefaultDate(dateIso);
                        setMealDefaultRecipeId(null);
                        setMealModalOpen(true);
                      }}
                      aria-label={`Добавить блюдо на ${dateIso}`}
                      className="size-9 rounded-xl"
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-2">
                    {entries.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/75 p-3.5 text-center text-xs text-muted-foreground">
                        Меню свободно — добавь рецепт или заготовку
                      </div>
                    ) : (
                      entries.map((entry) => {
                        const isDone =
                          entry.status === "cooked" || entry.status === "eaten";
                        const dishTitle =
                          entry.recipe?.title ||
                          entry.custom_meal_title ||
                          "Блюдо";
                        const slotLabel =
                          MEAL_SLOT_LABELS[entry.meal_slot as MealSlot] ??
                          entry.meal_slot;

                        return (
                          <div
                            key={entry.id}
                            className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMeal(entry);
                                  setMealModalOpen(true);
                                }}
                                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="secondary" className="text-[11px]">
                                    {slotLabel}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground num-tabular">
                                    {Number(entry.planned_servings)} порц.
                                  </span>
                                  {entry.recipe?.kcal_per_serving ? (
                                    <span className="text-xs text-muted-foreground num-tabular">
                                      ·{" "}
                                      {Math.round(
                                        Number(entry.recipe.kcal_per_serving) *
                                          Number(entry.planned_servings)
                                      )}{" "}
                                      ккал
                                    </span>
                                  ) : null}
                                </div>
                                <span
                                  className={cn(
                                    "text-sm font-medium leading-snug",
                                    isDone &&
                                      "line-through text-muted-foreground"
                                  )}
                                >
                                  {dishTitle}
                                </span>
                              </button>

                              <Button
                                type="button"
                                size="xs"
                                variant={isDone ? "outline" : "secondary"}
                                disabled={pending}
                                onClick={() => handleMarkCooked(entry)}
                                className="min-h-8 shrink-0 rounded-lg"
                              >
                                <ChefHatIcon data-icon="inline-start" />
                                {isDone ? "Готово" : "Приготовлено"}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 5: SMART SHOPPING LIST                                       */}
        {/* ================================================================ */}
        <TabsContent value="shopping" className="mt-4 flex flex-col gap-4">
          <Card className="rounded-2xl shadow-none">
            <CardContent className="pt-4">
              <form
                onSubmit={handleQuickAddShopping}
                className="grid grid-cols-1 gap-2.5 sm:grid-cols-12"
              >
                <Input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Что докупить (например: Авокадо или Молоко 2.5%)"
                  className="min-h-10 sm:col-span-5"
                  required
                />
                <Input
                  type="number"
                  min={0.1}
                  step="any"
                  value={shopQty}
                  onChange={(e) => setShopQty(e.target.value)}
                  className="min-h-10 sm:col-span-2 num-tabular"
                />
                <div className="sm:col-span-2">
                  <Select
                    value={shopUnit}
                    onValueChange={(v) => setShopUnit(v as IngredientUnit)}
                  >
                    <SelectTrigger className="min-h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(UNIT_LABELS_RU).map(([k, lbl]) => (
                          <SelectItem key={k} value={k}>
                            {lbl}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-3">
                  <Select value={shopAisle} onValueChange={setShopAisle}>
                    <SelectTrigger className="min-h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {AISLE_GROUPS.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-12">
                  <div className="flex flex-wrap items-center gap-2">
                    {checkedShoppingCount > 0 ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const res = await clearCheckedShoppingAction({
                                moveToPantry: true,
                              });
                              toast.success(
                                `Перенесено в запасы дома: ${res.movedToPantryCount}`
                              );
                            })
                          }
                          className="min-h-10 rounded-xl"
                        >
                          <PackageCheckIcon data-icon="inline-start" />
                          Купленное в запасы ({checkedShoppingCount})
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await clearCheckedShoppingAction({
                                moveToPantry: false,
                              });
                              toast("Отмеченные покупки очищены");
                            })
                          }
                          className="min-h-10 rounded-xl"
                        >
                          Очистить отмеченное
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Отмечай купленное в магазине и одной кнопкой переноси в домашние запасы
                      </span>
                    )}
                  </div>

                  <Button
                    type="submit"
                    size="sm"
                    disabled={pending}
                    className="min-h-10 rounded-xl"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Добавить
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {groupedShopping.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <ShoppingCartIcon className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Список покупок чист</p>
                  <p className="text-xs text-muted-foreground">
                    Собери список автоматически из плана готовки (запасы дома вычтутся сами) или надиктуй боту в Telegram.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleGenerateShopping}
                  className="rounded-xl"
                >
                  Собрать по меню недели
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {groupedShopping.map(([aisle, items]) => (
                <Card key={aisle} className="rounded-2xl shadow-none">
                  <CardHeader className="flex flex-row items-center justify-between pb-2.5">
                    <CardTitle className="text-sm font-semibold">
                      {aisle}
                    </CardTitle>
                    <Badge variant="secondary" className="num-tabular">
                      {items.filter((i) => !i.is_checked).length} /{" "}
                      {items.length}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col divide-y divide-border/65">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex min-h-12 items-center justify-between gap-2.5 py-2"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
                            <Checkbox
                              checked={item.is_checked}
                              onCheckedChange={(v) =>
                                handleToggleShopping(item, Boolean(v))
                              }
                              aria-label={`Отметить «${item.display_name}»`}
                            />
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span
                              className={cn(
                                "truncate text-sm font-medium",
                                item.is_checked &&
                                  "line-through text-muted-foreground"
                              )}
                            >
                              {item.display_name}
                            </span>
                            {item.added_from === "meal_plan" ? (
                              <span className="text-[11px] text-muted-foreground">
                                из меню (с учётом запасов)
                              </span>
                            ) : item.added_from !== "manual" ? (
                              <span className="text-[11px] text-muted-foreground">
                                из Telegram
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge variant="outline" className="num-tabular">
                            {formatQtyUnitRu(item.quantity_needed, item.unit)}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              startTransition(async () => {
                                await deleteShoppingItemAction(item.id);
                              })
                            }
                            aria-label={`Удалить ${item.display_name}`}
                            className="size-9 rounded-xl text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 6: HOME PANTRY INVENTORY                                     */}
        {/* ================================================================ */}
        <TabsContent value="pantry" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={pantrySearch}
                  onChange={(e) => setPantrySearch(e.target.value)}
                  placeholder="Поиск в домашних запасах…"
                  className="min-h-10 pl-9"
                />
              </div>
              {lowStockCount > 0 ? (
                <Badge variant="outline" className="num-tabular">
                  Заканчивается: {lowStockCount}
                </Badge>
              ) : null}
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingPantry(null);
                setPantryModalOpen(true);
              }}
              className="min-h-10 self-start rounded-xl sm:self-auto"
            >
              <PlusIcon data-icon="inline-start" />
              Добавить запас
            </Button>
          </div>

          {filteredPantry.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Домашние запасы пока не заполнены. Добавь крупы, мясо, заморозку и базовые продукты — они будут автоматически вычитаться из списка покупок.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredPantry.map((item) => {
                const isLow =
                  item.low_stock_threshold !== null &&
                  Number(item.quantity_on_hand) <=
                    Number(item.low_stock_threshold);
                const step =
                  item.unit === "g" || item.unit === "ml"
                    ? 100
                    : item.unit === "kg" || item.unit === "l"
                      ? 0.5
                      : 1;

                return (
                  <Card
                    key={item.id}
                    className="flex flex-col justify-between rounded-2xl shadow-none"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <CardTitle className="truncate text-base font-semibold">
                            {item.display_name}
                          </CardTitle>
                          <CardDescription>
                            {item.aisle_group || "Прочее"}
                            {item.expires_on
                              ? ` · годен до ${formatDateShortRu(item.expires_on)}`
                              : ""}
                          </CardDescription>
                        </div>

                        {isLow ? <Badge variant="destructive">Мало</Badge> : null}
                      </div>
                    </CardHeader>

                    <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await adjustPantryQtyAction({
                                id: item.id,
                                delta: -step,
                              });
                            })
                          }
                          aria-label="Уменьшить остаток"
                          className="size-9 rounded-xl"
                        >
                          <MinusIcon className="size-3.5" />
                        </Button>

                        <span className="min-w-[72px] text-center text-sm font-semibold num-tabular">
                          {formatQtyUnitRu(item.quantity_on_hand, item.unit)}
                        </span>

                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await adjustPantryQtyAction({
                                id: item.id,
                                delta: step,
                              });
                            })
                          }
                          aria-label="Увеличить остаток"
                          className="size-9 rounded-xl"
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingPantry(item);
                          setPantryModalOpen(true);
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
          )}
        </TabsContent>
      </Tabs>

      {/* Modals & Drawers */}
      <AddFoodModal
        open={addFoodOpen}
        onOpenChange={setAddFoodOpen}
        loggedDate={diaryDate}
        defaultSlot={addFoodSlot}
        initialMode={addFoodMode}
        defaultRecipeId={addFoodRecipeId}
        editingEntry={editingDiaryEntry}
        dictionaryHighlights={data.dictionaryHighlights}
        recipes={data.recipes}
        onSaved={refreshActiveDiaryIfNeeded}
      />

      <NutritionTargetsModal
        open={targetsModalOpen}
        onOpenChange={setTargetsModalOpen}
        targets={targets}
        latestWeightKg={
          displayedWeight ? Number(displayedWeight.weight_kg) : null
        }
      />

      <WeightLogModal
        open={weightModalOpen}
        onOpenChange={setWeightModalOpen}
        defaultDate={diaryDate}
        editingWeight={editingWeight}
        latestWeightKg={
          displayedWeight ? Number(displayedWeight.weight_kg) : null
        }
        onSaved={refreshActiveDiaryIfNeeded}
      />

      <RecipeFormModal
        open={recipeModalOpen}
        onOpenChange={setRecipeModalOpen}
        recipe={editingRecipe}
      />

      <MealPlanFormModal
        open={mealModalOpen}
        onOpenChange={setMealModalOpen}
        entry={editingMeal}
        recipes={data.recipes}
        defaultDate={mealDefaultDate}
        defaultRecipeId={mealDefaultRecipeId}
      />

      <PantryFormModal
        open={pantryModalOpen}
        onOpenChange={setPantryModalOpen}
        item={editingPantry}
      />
    </div>
  );
}
