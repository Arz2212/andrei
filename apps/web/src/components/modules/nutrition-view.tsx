"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  BarcodeIcon,
  CalendarPlusIcon,
  CheckCircle2Icon,
  ChefHatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FlameIcon,
  Loader2Icon,
  MinusIcon,
  PackageCheckIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShoppingCartIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
  UtensilsIcon,
} from "lucide-react";
import type {
  CalorieLog,
  IngredientUnit,
  MealCategory,
  MealPlanEntryWithRecipe,
  MealSlot,
  NutritionDashboardData,
  OffParsedProduct,
  PantryItem,
  RecipeWithIngredients,
  ShoppingListItem,
} from "@life-os/db";
import {
  addShoppingItemAction,
  adjustPantryQtyAction,
  clearCheckedShoppingAction,
  deleteCalorieLogAction,
  deleteShoppingItemAction,
  evaluateOffBarcodeAction,
  fetchNutritionWeekAction,
  generateShoppingFromMenuAction,
  markMealStatusAction,
  searchOffProductsAction,
  setCaloriesFeatureFlagAction,
  toggleRecipeFavoriteAction,
  toggleShoppingItemAction,
} from "@/app/nutrition-actions";
import {
  AISLE_GROUPS,
  CalorieLogModal,
  MEAL_CATEGORY_LABELS,
  MEAL_SLOT_LABELS,
  MealPlanFormModal,
  PantryFormModal,
  RecipeFormModal,
  UNIT_LABELS_RU,
} from "@/components/modules/nutrition-modals";
import { cn, formatDateLongRu, formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  const rounded = Number.isInteger(val) ? String(val) : val.toFixed(1).replace(/\.0$/, "");
  const label = UNIT_LABELS_RU[unit as IngredientUnit] ?? unit;
  return `${rounded} ${label}`;
}

interface NutritionViewProps {
  initialTab?: string;
  data: NutritionDashboardData;
}

export function NutritionView({ initialTab, data }: NutritionViewProps) {
  const [pending, startTransition] = React.useTransition();

  // Feature Flag: enable_calories_off (instant local state + server persistence)
  const [caloriesEnabled, setCaloriesEnabled] = React.useState(data.caloriesEnabled);
  React.useEffect(() => {
    setCaloriesEnabled(data.caloriesEnabled);
  }, [data.caloriesEnabled]);

  const validTabs = ["menu", "shopping", "pantry", "recipes", "calories"];
  const [activeTab, setActiveTab] = React.useState<string>(() => {
    if (initialTab && validTabs.includes(initialTab)) {
      if (initialTab === "calories" && !data.caloriesEnabled) return "menu";
      return initialTab;
    }
    return "menu";
  });

  function handleToggleCaloriesFlag(checked: boolean) {
    setCaloriesEnabled(checked);
    if (!checked && activeTab === "calories") {
      setActiveTab("menu");
    }
    startTransition(async () => {
      try {
        await setCaloriesFeatureFlagAction(checked);
        toast.success(
          checked
            ? "Учёт КБЖУ и штрихкодов Open Food Facts включён"
            : "Режим КБЖУ скрыт — фокус только на меню и покупках"
        );
      } catch {
        setCaloriesEnabled(!checked);
        toast.error("Не удалось переключить настройку КБЖУ");
      }
    });
  }

  // Week navigation state for Meal Plan
  const [weekStart, setWeekStart] = React.useState(data.weekStart);
  const [weekEnd, setWeekEnd] = React.useState(data.weekEnd);
  const [weekDates, setWeekDates] = React.useState(data.weekDates);
  const [weekMealPlan, setWeekMealPlan] = React.useState<MealPlanEntryWithRecipe[]>(
    data.weekMealPlan
  );
  const [calorieLogs, setCalorieLogs] = React.useState<CalorieLog[]>(
    data.todayCalorieLogs
  );
  const [weekLoading, setWeekLoading] = React.useState(false);
  const [deductOnCook, setDeductOnCook] = React.useState(true);

  React.useEffect(() => {
    if (weekStart === data.weekStart) {
      setWeekMealPlan(data.weekMealPlan);
      setCalorieLogs(data.todayCalorieLogs);
    }
  }, [data.weekStart, data.weekMealPlan, data.todayCalorieLogs, weekStart]);

  async function handleShiftWeek(anchorIso: string) {
    setWeekLoading(true);
    try {
      const res = await fetchNutritionWeekAction(anchorIso);
      setWeekStart(res.weekStart);
      setWeekEnd(res.weekEnd);
      setWeekDates(res.weekDates);
      setWeekMealPlan(res.weekMealPlan);
      setCalorieLogs(res.calorieLogs);
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

  // Quick Add Shopping state
  const [shopName, setShopName] = React.useState("");
  const [shopQty, setShopQty] = React.useState("1");
  const [shopUnit, setShopUnit] = React.useState<IngredientUnit>("pcs");
  const [shopAisle, setShopAisle] = React.useState("Овощи и зелень");

  // Pantry & Recipes filters
  const [pantrySearch, setPantrySearch] = React.useState("");
  const [recipeSearch, setRecipeSearch] = React.useState("");
  const [recipeCategory, setRecipeCategory] = React.useState<string>("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  // Open Food Facts Lab state
  const [barcodeInput, setBarcodeInput] = React.useState("");
  const [offQueryInput, setOffQueryInput] = React.useState("");
  const [offLoading, setOffLoading] = React.useState(false);
  const [offSearchResults, setOffSearchResults] = React.useState<OffParsedProduct[]>(
    []
  );

  // Modals State
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
  const [editingPantry, setEditingPantry] = React.useState<PantryItem | null>(null);

  const [calorieModalOpen, setCalorieModalOpen] = React.useState(false);
  const [prefillOffProduct, setPrefillOffProduct] =
    React.useState<OffParsedProduct | null>(null);

  // Derived metrics
  const uncheckedShoppingCount = optimisticShopping.filter(
    (i) => !i.is_checked
  ).length;
  const checkedShoppingCount = optimisticShopping.filter((i) => i.is_checked).length;

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

  const dailyMacros = React.useMemo(() => {
    return calorieLogs.reduce(
      (acc, log) => ({
        kcal: acc.kcal + Number(log.kcal ?? 0),
        protein: Math.round((acc.protein + Number(log.protein_g ?? 0)) * 10) / 10,
        fat: Math.round((acc.fat + Number(log.fat_g ?? 0)) * 10) / 10,
        carbs: Math.round((acc.carbs + Number(log.carbs_g ?? 0)) * 10) / 10,
      }),
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );
  }, [calorieLogs]);

  // Handlers
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
          prev.map((m) => (m.id === entry.id ? { ...m, status: nextStatus } : m))
        );
        toast.success(
          nextStatus === "cooked"
            ? deducted > 0
              ? `Отмечено приготовленным (списано из запасов: ${deducted})`
              : "Отмечено приготовленным"
            : "Возвращено в план"
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка обновления статуса");
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

  async function handleBarcodeTest(e: React.FormEvent) {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    setOffLoading(true);
    try {
      const saved = await evaluateOffBarcodeAction({
        barcode: barcodeInput,
      });
      if (saved.found_in_off) {
        toast.success(
          `Найдено в Open Food Facts: ${saved.product_name ?? saved.barcode}`
        );
      } else {
        toast("Штрихкод не найден в базе Open Food Facts — записано в журнал оценки");
      }
      setBarcodeInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка запроса к Open Food Facts");
    } finally {
      setOffLoading(false);
    }
  }

  async function handleOffTextSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!offQueryInput.trim()) return;
    setOffLoading(true);
    try {
      const items = await searchOffProductsAction(offQueryInput);
      setOffSearchResults(items);
      if (items.length === 0) {
        toast("Ничего не найдено по текстовому запросу в Open Food Facts");
      }
    } catch {
      toast.error("Не удалось выполнить поиск в Open Food Facts");
    } finally {
      setOffLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header + Calories Feature-Flag Switch */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Питание и покупки
          </h1>
          <p className="text-sm text-muted-foreground">
            Конструктор меню, библиотека рецептов, домашние запасы и авто-список покупок
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label
            htmlFor="calories-flag-switch"
            className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/80 bg-card px-3.5 py-2 text-xs font-medium"
          >
            <FlameIcon
              className={cn(
                "size-4 shrink-0",
                caloriesEnabled ? "text-domain-nutrition" : "text-muted-foreground"
              )}
            />
            <span>КБЖУ и штрихкоды (OFF)</span>
            <Switch
              id="calories-flag-switch"
              checked={caloriesEnabled}
              onCheckedChange={handleToggleCaloriesFlag}
            />
          </label>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingRecipe(null);
              setRecipeModalOpen(true);
            }}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Рецепт
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingMeal(null);
              setMealDefaultDate(data.todayDate);
              setMealDefaultRecipeId(null);
              setMealModalOpen(true);
            }}
            className="min-h-10 rounded-xl"
          >
            <CalendarPlusIcon data-icon="inline-start" />
            В меню
          </Button>
        </div>
      </div>

      {/* Main Flush-Left Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="menu">Меню и готовка</TabsTrigger>
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
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.pantryItems.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="recipes" className="gap-1.5">
            Рецепты
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.recipes.length}
            </Badge>
          </TabsTrigger>
          {caloriesEnabled ? (
            <TabsTrigger value="calories" className="gap-1.5">
              КБЖУ и Open Food Facts
              <Badge variant="outline" className="px-1.5 py-0 text-[11px] num-tabular">
                {dailyMacros.kcal} ккал
              </Badge>
            </TabsTrigger>
          ) : null}
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: MEAL PLANNER & COOKING                                    */}
        {/* ================================================================ */}
        <TabsContent value="menu" className="mt-4 flex flex-col gap-4">
          {/* Week Toolbar + Smart Shopping Generator */}
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

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={deductOnCook}
                  onCheckedChange={setDeductOnCook}
                />
                <span>Списывать запасы при готовке</span>
              </label>

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

          {/* 7-Day Meal Plan Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {weekDates.map((dateIso) => {
              const isToday = dateIso === data.todayDate;
              const entries = weekMealPlan.filter((m) => m.plan_date === dateIso);
              const dayKcal = caloriesEnabled
                ? entries.reduce((sum, e) => {
                    const perServ = Number(e.recipe?.kcal_per_serving ?? 0);
                    return sum + Math.round(perServ * Number(e.planned_servings));
                  }, 0)
                : 0;

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
                      {caloriesEnabled && dayKcal > 0 ? (
                        <span className="text-xs text-muted-foreground num-tabular">
                          План: ~{dayKcal} ккал
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
                                  {caloriesEnabled &&
                                  entry.recipe?.kcal_per_serving ? (
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
        {/* TAB 2: SMART SHOPPING LIST                                       */}
        {/* ================================================================ */}
        <TabsContent value="shopping" className="mt-4 flex flex-col gap-4">
          {/* Quick Add Item Form */}
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
                    <CardTitle className="text-sm font-semibold">{aisle}</CardTitle>
                    <Badge variant="secondary" className="num-tabular">
                      {items.filter((i) => !i.is_checked).length} / {items.length}
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
        {/* TAB 3: HOME PANTRY INVENTORY                                     */}
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
                  Number(item.quantity_on_hand) <= Number(item.low_stock_threshold);
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

                        {isLow ? (
                          <Badge variant="destructive">Мало</Badge>
                        ) : null}
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

        {/* ================================================================ */}
        {/* TAB 4: RECIPE LIBRARY                                            */}
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredRecipes.map((rec) => (
              <Card
                key={rec.id}
                className="flex flex-col justify-between rounded-2xl shadow-none"
              >
                <CardHeader className="pb-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">
                          {MEAL_CATEGORY_LABELS[rec.meal_category as MealCategory] ??
                            rec.meal_category}
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

                  {caloriesEnabled && rec.kcal_per_serving ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5 text-xs num-tabular">
                      <span className="font-medium">
                        {rec.kcal_per_serving} ккал / порц.
                      </span>
                      {rec.protein_g !== null ? (
                        <span className="text-muted-foreground">
                          Б {rec.protein_g} г
                        </span>
                      ) : null}
                      {rec.fat_g !== null ? (
                        <span className="text-muted-foreground">
                          Ж {rec.fat_g} г
                        </span>
                      ) : null}
                      {rec.carbs_g !== null ? (
                        <span className="text-muted-foreground">
                          У {rec.carbs_g} г
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>

                <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
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
                    <UtensilsIcon data-icon="inline-start" />
                    Поставить в меню
                  </Button>

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
                    Рецепт
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 5: CALORIES & OPEN FOOD FACTS LAB (ONLY WHEN FLAG IS ON!)    */}
        {/* ================================================================ */}
        {caloriesEnabled ? (
          <TabsContent value="calories" className="mt-4 flex flex-col gap-5">
            {/* Completeness Score Card + Quick Off Button */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Card className="rounded-2xl shadow-none lg:col-span-5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold">
                      Полнота базы Open Food Facts
                    </CardTitle>
                    <Badge
                      variant={
                        data.offStats.recommendation === "recommended"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {data.offStats.recommendation === "recommended"
                        ? "Высокое покрытие"
                        : "Частичное покрытие"}
                    </Badge>
                  </div>
                  <CardDescription>
                    Изолированная проверка реальных штрихкодов твоих продуктов
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/55 p-3 text-center">
                    <div className="flex flex-col">
                      <span className="text-lg font-semibold num-tabular">
                        {data.offStats.total_tested}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Проверено
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-lg font-semibold num-tabular">
                        {data.offStats.found_rate_percent}%
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Найдено ({data.offStats.found_count})
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-lg font-semibold num-tabular">
                        {data.offStats.complete_macros_rate_percent}%
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Полные КБЖУ
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Если база не закрывает твои привычные российские продукты, отключи КБЖУ в один клик — интерфейс останется полностью чистым.
                  </p>
                </CardContent>

                <CardFooter className="border-t border-border/60 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleCaloriesFlag(false)}
                    className="w-full rounded-xl"
                  >
                    Отключить КБЖУ и скрыть раздел
                  </Button>
                </CardFooter>
              </Card>

              {/* Live Barcode & Text Tester */}
              <Card className="rounded-2xl shadow-none lg:col-span-7">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">
                    Сканер штрихкодов и поиск Open Food Facts
                  </CardTitle>
                  <CardDescription>
                    Проверь товар по штрихкоду EAN-13 или названию и сразу перенеси порцию в дневник
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                  <form
                    onSubmit={handleBarcodeTest}
                    className="flex flex-col gap-2 sm:flex-row"
                  >
                    <div className="relative flex-1">
                      <BarcodeIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        placeholder="Штрихкод EAN (например: 3017620422003)"
                        className="min-h-10 pl-9 num-tabular"
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={offLoading}
                      className="min-h-10 rounded-xl"
                    >
                      Проверить штрихкод
                    </Button>
                  </form>

                  <form
                    onSubmit={handleOffTextSearch}
                    className="flex flex-col gap-2 sm:flex-row"
                  >
                    <Input
                      value={offQueryInput}
                      onChange={(e) => setOffQueryInput(e.target.value)}
                      placeholder="Или поиск по названию (например: греческий йогурт Teos)"
                      className="min-h-10 flex-1"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={offLoading}
                      className="min-h-10 rounded-xl"
                    >
                      Найти продукт
                    </Button>
                  </form>

                  {offSearchResults.length > 0 ? (
                    <div className="flex max-h-[210px] flex-col gap-2 overflow-y-auto pt-1">
                      {offSearchResults.map((prod) => (
                        <div
                          key={prod.barcode}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border/80 p-2.5 text-xs"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-sm">
                              {prod.product_name || prod.barcode}
                            </span>
                            <span className="text-muted-foreground num-tabular">
                              На 100 г: {prod.kcal_100g ?? "—"} ккал · Б{" "}
                              {prod.protein_100g ?? "—"} · Ж {prod.fat_100g ?? "—"} · У{" "}
                              {prod.carbs_100g ?? "—"}
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            onClick={() => {
                              setPrefillOffProduct(prod);
                              setCalorieModalOpen(true);
                            }}
                            className="shrink-0 rounded-lg"
                          >
                            В дневник
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <Separator />

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Последние проверенные штрихкоды ({data.offEvaluations.length})
                    </span>
                    <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
                      {data.offEvaluations.slice(0, 6).map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/45 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {ev.found_in_off ? (
                              <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
                            ) : (
                              <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate font-medium">
                              {ev.product_name || ev.query_note || ev.barcode}
                            </span>
                          </div>
                          <span className="shrink-0 text-muted-foreground num-tabular">
                            {ev.found_in_off
                              ? `${ev.kcal_100g ?? "—"} ккал / 100 г`
                              : `нет в OFF (${ev.barcode})`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Daily Calorie Tracker */}
            <Card className="rounded-2xl shadow-none">
              <CardHeader className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <CardTitle className="text-base font-semibold">
                    Дневник КБЖУ за сегодня ({formatDateShortRu(data.todayDate)})
                  </CardTitle>
                  <CardDescription className="num-tabular">
                    Итого: {dailyMacros.kcal} ккал · Белки {dailyMacros.protein} г ·
                    Жиры {dailyMacros.fat} г · Углеводы {dailyMacros.carbs} г
                  </CardDescription>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setPrefillOffProduct(null);
                    setCalorieModalOpen(true);
                  }}
                  className="rounded-xl"
                >
                  <PlusIcon data-icon="inline-start" />
                  Записать приём пищи
                </Button>
              </CardHeader>

              <CardContent className="flex flex-col divide-y divide-border/65">
                {calorieLogs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Записей КБЖУ за сегодня пока нет.
                  </p>
                ) : (
                  calorieLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {log.title}
                        </span>
                        <span className="text-xs text-muted-foreground num-tabular">
                          {MEAL_SLOT_LABELS[log.meal_slot as MealSlot] ?? log.meal_slot}
                          {log.grams ? ` · ${log.grams} г` : ""} · Б{" "}
                          {log.protein_g ?? 0} · Ж {log.fat_g ?? 0} · У{" "}
                          {log.carbs_g ?? 0}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold num-tabular">
                          {log.kcal} ккал
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            startTransition(async () => {
                              await deleteCalorieLogAction(log.id);
                            })
                          }
                          aria-label="Удалить запись КБЖУ"
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
        ) : null}
      </Tabs>

      {/* Modals */}
      <RecipeFormModal
        open={recipeModalOpen}
        onOpenChange={setRecipeModalOpen}
        recipe={editingRecipe}
        caloriesEnabled={caloriesEnabled}
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

      <CalorieLogModal
        open={calorieModalOpen}
        onOpenChange={setCalorieModalOpen}
        defaultDate={data.todayDate}
        prefillOffProduct={prefillOffProduct}
      />
    </div>
  );
}
