"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import type {
  IngredientUnit,
  MealCategory,
  MealPlanEntryWithRecipe,
  MealSlot,
  OffParsedProduct,
  PantryItem,
  RecipeIngredientDraft,
  RecipeWithIngredients,
} from "@life-os/db";
import {
  deleteMealPlanEntryAction,
  deletePantryItemAction,
  deleteRecipeAction,
  saveCalorieLogAction,
  saveMealPlanEntryAction,
  savePantryItemAction,
  saveRecipeAction,
} from "@/app/nutrition-actions";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const UNIT_LABELS_RU: Record<IngredientUnit, string> = {
  g: "г",
  kg: "кг",
  ml: "мл",
  l: "л",
  pcs: "шт.",
  tbsp: "ст. л.",
  tsp: "ч. л.",
  pack: "уп.",
};

export const AISLE_GROUPS = [
  "Овощи и зелень",
  "Фрукты и ягоды",
  "Мясо, птица и рыба",
  "Молочное и яйца",
  "Бакалея и крупы",
  "Хлеб и выпечка",
  "Заморозка",
  "Специи и соусы",
  "Напитки",
  "Бытовое",
  "Прочее",
] as const;

export const MEAL_CATEGORY_LABELS: Record<MealCategory, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
  batch_prep: "Впрок",
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
  cook_ahead: "Готовка впрок",
};

// ============================================================================
// 1. Recipe Create / Edit Modal (with Dynamic Structured Ingredients)
// ============================================================================

interface RecipeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: RecipeWithIngredients | null;
  caloriesEnabled: boolean;
}

export function RecipeFormModal({
  open,
  onOpenChange,
  recipe,
  caloriesEnabled,
}: RecipeFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<MealCategory>("dinner");
  const [servings, setServings] = React.useState("2");
  const [cookMinutes, setCookMinutes] = React.useState("25");
  const [isFavorite, setIsFavorite] = React.useState(false);
  const [steps, setSteps] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");
  const [kcal, setKcal] = React.useState("");
  const [protein, setProtein] = React.useState("");
  const [fat, setFat] = React.useState("");
  const [carbs, setCarbs] = React.useState("");
  const [ingredients, setIngredients] = React.useState<RecipeIngredientDraft[]>([
    { display_name: "", amount: 100, unit: "g", aisle_group: "Бакалея и крупы" },
  ]);

  React.useEffect(() => {
    if (!open) return;
    if (recipe) {
      setTitle(recipe.title);
      setCategory((recipe.meal_category as MealCategory) ?? "dinner");
      setServings(String(recipe.default_servings ?? 2));
      setCookMinutes(recipe.cook_time_minutes ? String(recipe.cook_time_minutes) : "");
      setIsFavorite(Boolean(recipe.is_favorite));
      setSteps(recipe.steps_markdown ?? "");
      setTagsText((recipe.tags ?? []).join(", "));
      setKcal(
        recipe.kcal_per_serving !== null && recipe.kcal_per_serving !== undefined
          ? String(recipe.kcal_per_serving)
          : ""
      );
      setProtein(
        recipe.protein_g !== null && recipe.protein_g !== undefined
          ? String(recipe.protein_g)
          : ""
      );
      setFat(
        recipe.fat_g !== null && recipe.fat_g !== undefined
          ? String(recipe.fat_g)
          : ""
      );
      setCarbs(
        recipe.carbs_g !== null && recipe.carbs_g !== undefined
          ? String(recipe.carbs_g)
          : ""
      );
      setIngredients(
        recipe.ingredients.length > 0
          ? recipe.ingredients.map((i) => ({
              display_name: i.display_name,
              ingredient_key: i.ingredient_key,
              amount: Number(i.amount),
              unit: i.unit as IngredientUnit,
              aisle_group: i.aisle_group || "Прочее",
              is_optional: i.is_optional,
            }))
          : [{ display_name: "", amount: 100, unit: "g", aisle_group: "Прочее" }]
      );
    } else {
      setTitle("");
      setCategory("dinner");
      setServings("2");
      setCookMinutes("25");
      setIsFavorite(false);
      setSteps("");
      setTagsText("");
      setKcal("");
      setProtein("");
      setFat("");
      setCarbs("");
      setIngredients([
        { display_name: "", amount: 200, unit: "g", aisle_group: "Мясо, птица и рыба" },
      ]);
    }
  }, [open, recipe]);

  function updateIng(idx: number, patch: Partial<RecipeIngredientDraft>) {
    setIngredients((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  }

  function addIngRow() {
    setIngredients((prev) => [
      ...prev,
      { display_name: "", amount: 100, unit: "g", aisle_group: "Овощи и зелень" },
    ]);
  }

  function removeIngRow(idx: number) {
    setIngredients((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveRecipeAction({
          id: recipe?.id,
          title,
          meal_category: category,
          default_servings: Number(servings) || 2,
          cook_time_minutes: cookMinutes ? Number(cookMinutes) : null,
          is_favorite: isFavorite,
          steps_markdown: steps,
          tags: tagsText
            .split(/[,;]+/)
            .map((t) => t.trim())
            .filter(Boolean),
          kcal_per_serving: kcal !== "" ? Number(kcal) : recipe?.kcal_per_serving ?? null,
          protein_g: protein !== "" ? Number(protein) : recipe?.protein_g ?? null,
          fat_g: fat !== "" ? Number(fat) : recipe?.fat_g ?? null,
          carbs_g: carbs !== "" ? Number(carbs) : recipe?.carbs_g ?? null,
          ingredients: ingredients.filter(
            (i) => i.display_name.trim() && Number(i.amount) > 0
          ),
        });
        toast.success(recipe ? "Рецепт обновлён" : "Рецепт добавлен в библиотеку");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить рецепт");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={recipe ? "Редактировать рецепт" : "Новый рецепт"}
      description="Ингредиенты автоматически вычитаются из домашних запасов при сборке списка покупок."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="rec-title">Название блюда</FieldLabel>
            <Input
              id="rec-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Индейка в сливочно-грибном соусе с гречкой"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel>Категория</FieldLabel>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as MealCategory)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(MEAL_CATEGORY_LABELS).map(([k, lbl]) => (
                      <SelectItem key={k} value={k}>
                        {lbl}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="rec-serv">Базовые порции</FieldLabel>
              <Input
                id="rec-serv"
                type="number"
                min={1}
                max={20}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="rec-time">Готовка (мин)</FieldLabel>
              <Input
                id="rec-time"
                type="number"
                min={1}
                max={600}
                value={cookMinutes}
                onChange={(e) => setCookMinutes(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field
            orientation="horizontal"
            className="items-center justify-between rounded-xl border border-border/80 px-3.5 py-2.5"
          >
            <FieldLabel htmlFor="rec-fav" className="font-normal text-sm">
              Избранный рецепт (закрепить наверху)
            </FieldLabel>
            <Switch
              id="rec-fav"
              checked={isFavorite}
              onCheckedChange={setIsFavorite}
            />
          </Field>

          <Separator />

          {/* Dynamic Ingredients */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Ингредиенты (на {servings || 2} порц.)
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={addIngRow}
                className="rounded-lg"
              >
                <PlusIcon data-icon="inline-start" />
                Продукт
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {ingredients.map((ing, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 items-center gap-1.5 rounded-xl border border-border/75 bg-muted/25 p-2"
                >
                  <Input
                    value={ing.display_name}
                    onChange={(e) =>
                      updateIng(idx, { display_name: e.target.value })
                    }
                    placeholder="Продукт (напр. Куриное филе)"
                    className="col-span-12 min-h-9 sm:col-span-5"
                  />
                  <Input
                    type="number"
                    min={0.1}
                    step="any"
                    value={String(ing.amount)}
                    onChange={(e) =>
                      updateIng(idx, { amount: Number(e.target.value) || 0 })
                    }
                    className="col-span-4 min-h-9 sm:col-span-2 num-tabular"
                  />
                  <div className="col-span-4 sm:col-span-2">
                    <Select
                      value={String(ing.unit ?? "g")}
                      onValueChange={(v) =>
                        updateIng(idx, { unit: v as IngredientUnit })
                      }
                    >
                      <SelectTrigger className="min-h-9 w-full">
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
                  <div className="col-span-3 sm:col-span-2">
                    <Select
                      value={ing.aisle_group || "Прочее"}
                      onValueChange={(v) => updateIng(idx, { aisle_group: v })}
                    >
                      <SelectTrigger className="min-h-9 w-full">
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
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeIngRow(idx)}
                      aria-label="Убрать ингредиент"
                    >
                      <Trash2Icon className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="rec-steps">Шаги приготовления</FieldLabel>
            <Textarea
              id="rec-steps"
              rows={3}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="Короткий алгоритм без воды…"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rec-tags">Теги (через запятую)</FieldLabel>
            <Input
              id="rec-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="белок, быстро, в контейнер"
              className="min-h-10"
            />
          </Field>

          {caloriesEnabled ? (
            <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-border/80 bg-muted/35 p-3 sm:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="rec-kcal">Ккал / порц.</FieldLabel>
                <Input
                  id="rec-kcal"
                  type="number"
                  min={0}
                  value={kcal}
                  onChange={(e) => setKcal(e.target.value)}
                  className="min-h-9 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-prot">Белки (г)</FieldLabel>
                <Input
                  id="rec-prot"
                  type="number"
                  min={0}
                  step="0.1"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  className="min-h-9 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-fat">Жиры (г)</FieldLabel>
                <Input
                  id="rec-fat"
                  type="number"
                  min={0}
                  step="0.1"
                  value={fat}
                  onChange={(e) => setFat(e.target.value)}
                  className="min-h-9 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-carb">Углеводы (г)</FieldLabel>
                <Input
                  id="rec-carb"
                  type="number"
                  min={0}
                  step="0.1"
                  value={carbs}
                  onChange={(e) => setCarbs(e.target.value)}
                  className="min-h-9 num-tabular"
                />
              </Field>
            </div>
          ) : null}
        </FieldGroup>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 bg-background pt-2">
          {recipe ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteRecipeAction(recipe.id);
                  toast("Рецепт удалён");
                  onOpenChange(false);
                })
              }
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            {pending ? (
              <>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                Сохраняем…
              </>
            ) : (
              "Сохранить рецепт"
            )}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 2. Meal Plan Create / Edit Modal
// ============================================================================

interface MealPlanFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: MealPlanEntryWithRecipe | null;
  recipes: RecipeWithIngredients[];
  defaultDate: string;
  defaultRecipeId?: number | null;
}

export function MealPlanFormModal({
  open,
  onOpenChange,
  entry,
  recipes,
  defaultDate,
  defaultRecipeId,
}: MealPlanFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [planDate, setPlanDate] = React.useState(defaultDate);
  const [mealSlot, setMealSlot] = React.useState<MealSlot>("dinner");
  const [sourceMode, setSourceMode] = React.useState<"recipe" | "custom">("recipe");
  const [recipeId, setRecipeId] = React.useState<string>("");
  const [customTitle, setCustomTitle] = React.useState("");
  const [servings, setServings] = React.useState("2");

  React.useEffect(() => {
    if (!open) return;
    if (entry) {
      setPlanDate(entry.plan_date);
      setMealSlot(entry.meal_slot as MealSlot);
      if (entry.recipe_id) {
        setSourceMode("recipe");
        setRecipeId(String(entry.recipe_id));
        setCustomTitle("");
      } else {
        setSourceMode("custom");
        setRecipeId(recipes[0] ? String(recipes[0].id) : "");
        setCustomTitle(entry.custom_meal_title ?? "");
      }
      setServings(String(entry.planned_servings ?? 2));
    } else {
      setPlanDate(defaultDate);
      const chosenRec = defaultRecipeId
        ? recipes.find((r) => r.id === defaultRecipeId)
        : recipes[0];
      setMealSlot(
        chosenRec?.meal_category === "breakfast"
          ? "breakfast"
          : chosenRec?.meal_category === "lunch"
            ? "lunch"
            : chosenRec?.meal_category === "batch_prep"
              ? "cook_ahead"
              : "dinner"
      );
      setSourceMode(recipes.length > 0 ? "recipe" : "custom");
      setRecipeId(chosenRec ? String(chosenRec.id) : "");
      setCustomTitle("");
      setServings(String(chosenRec?.default_servings ?? 2));
    }
  }, [open, entry, defaultDate, defaultRecipeId, recipes]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveMealPlanEntryAction({
          id: entry?.id,
          plan_date: planDate,
          meal_slot: mealSlot,
          recipe_id: sourceMode === "recipe" && recipeId ? Number(recipeId) : null,
          custom_meal_title: sourceMode === "custom" ? customTitle : null,
          planned_servings: Number(servings) || 1,
          status: entry?.status as "planned" | "cooked" | "eaten" | "skipped" | undefined,
        });
        toast.success(entry ? "Запись в меню обновлена" : "Блюдо поставлено в меню");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? "Изменить блюдо в меню" : "Поставить блюдо в меню"}
      description="Блюда из библиотеки рецептов автоматически формируют точный список покупок с учётом порций."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="mp-date">Дата</FieldLabel>
              <Input
                id="mp-date"
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="mp-serv">Порций</FieldLabel>
              <Input
                id="mp-serv"
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Приём пищи</FieldLabel>
            <ToggleGroup
              type="single"
              value={mealSlot}
              onValueChange={(v) => v && setMealSlot(v as MealSlot)}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-3 gap-1 sm:grid-cols-5"
            >
              {Object.entries(MEAL_SLOT_LABELS).map(([k, lbl]) => (
                <ToggleGroupItem key={k} value={k} className="min-h-10 text-xs">
                  {lbl === "Готовка впрок" ? "Впрок" : lbl}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <ToggleGroup
            type="single"
            value={sourceMode}
            onValueChange={(v) => {
              if (v === "recipe" || v === "custom") setSourceMode(v);
            }}
            variant="outline"
            spacing={1}
            className="grid w-full grid-cols-2 gap-1"
          >
            <ToggleGroupItem value="recipe" className="min-h-10">
              Из рецептов
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="min-h-10">
              Свободное блюдо
            </ToggleGroupItem>
          </ToggleGroup>

          {sourceMode === "recipe" ? (
            <Field>
              <FieldLabel>Выбери рецепт</FieldLabel>
              <Select value={recipeId} onValueChange={setRecipeId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="Выбери рецепт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {recipes.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="mp-custom">Название блюда</FieldLabel>
              <Input
                id="mp-custom"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Например: Ужин вне дома или Доставка боула"
                required
                className="min-h-11"
              />
            </Field>
          )}
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {entry ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteMealPlanEntryAction(entry.id);
                  toast("Блюдо убрано из плана");
                  onOpenChange(false);
                })
              }
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Убрать
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            Сохранить
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 3. Pantry Item Create / Edit Modal
// ============================================================================

interface PantryFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PantryItem | null;
}

export function PantryFormModal({
  open,
  onOpenChange,
  item,
}: PantryFormModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [unit, setUnit] = React.useState<IngredientUnit>("g");
  const [aisle, setAisle] = React.useState("Бакалея и крупы");
  const [lowThreshold, setLowThreshold] = React.useState("");
  const [expiresOn, setExpiresOn] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (item) {
      setName(item.display_name);
      setQty(String(item.quantity_on_hand));
      setUnit((item.unit as IngredientUnit) ?? "g");
      setAisle(item.aisle_group || "Прочее");
      setLowThreshold(
        item.low_stock_threshold !== null && item.low_stock_threshold !== undefined
          ? String(item.low_stock_threshold)
          : ""
      );
      setExpiresOn(item.expires_on ?? "");
    } else {
      setName("");
      setQty("500");
      setUnit("g");
      setAisle("Бакалея и крупы");
      setLowThreshold("");
      setExpiresOn("");
    }
  }, [open, item]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await savePantryItemAction({
          id: item?.id,
          display_name: name,
          quantity_on_hand: Number(qty) || 0,
          unit,
          aisle_group: aisle,
          low_stock_threshold: lowThreshold ? Number(lowThreshold) : null,
          expires_on: expiresOn || null,
        });
        toast.success(item ? "Запас обновлён" : "Продукт добавлен в запасы дома");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "Изменить домашний запас" : "Добавить в запасы дома"}
      description="Запасы дома автоматически вычитаются при формировании списка покупок по меню."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="pan-name">Название продукта</FieldLabel>
            <Input
              id="pan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Рис басмати или Куриное филе"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="pan-qty">В наличии</FieldLabel>
              <Input
                id="pan-qty"
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel>Единица</FieldLabel>
              <Select
                value={unit}
                onValueChange={(v) => setUnit(v as IngredientUnit)}
              >
                <SelectTrigger className="min-h-11 w-full">
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
            </Field>
          </div>

          <Field>
            <FieldLabel>Категория / отдел</FieldLabel>
            <Select value={aisle} onValueChange={setAisle}>
              <SelectTrigger className="min-h-11 w-full">
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
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="pan-low">Порог «Мало»</FieldLabel>
              <Input
                id="pan-low"
                type="number"
                min={0}
                step="any"
                value={lowThreshold}
                onChange={(e) => setLowThreshold(e.target.value)}
                placeholder="Опционально"
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="pan-exp">Годен до</FieldLabel>
              <Input
                id="pan-exp"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {item ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deletePantryItemAction(item.id);
                  toast("Запас удалён");
                  onOpenChange(false);
                })
              }
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            Сохранить
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 4. Calorie Log Modal (supports prefill from Open Food Facts 100g macros!)
// ============================================================================

interface CalorieLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  prefillOffProduct?: OffParsedProduct | null;
}

export function CalorieLogModal({
  open,
  onOpenChange,
  defaultDate,
  prefillOffProduct,
}: CalorieLogModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [loggedDate, setLoggedDate] = React.useState(defaultDate);
  const [mealSlot, setMealSlot] = React.useState<
    "breakfast" | "lunch" | "dinner" | "snack"
  >("snack");
  const [title, setTitle] = React.useState("");
  const [grams, setGrams] = React.useState("100");
  const [kcal, setKcal] = React.useState("");
  const [protein, setProtein] = React.useState("");
  const [fat, setFat] = React.useState("");
  const [carbs, setCarbs] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setLoggedDate(defaultDate);
    if (prefillOffProduct && prefillOffProduct.found) {
      setTitle(
        [prefillOffProduct.product_name, prefillOffProduct.brands]
          .filter(Boolean)
          .join(" · ") || prefillOffProduct.barcode
      );
      setGrams("100");
      setKcal(
        prefillOffProduct.kcal_100g !== null
          ? String(Math.round(prefillOffProduct.kcal_100g))
          : "0"
      );
      setProtein(
        prefillOffProduct.protein_100g !== null
          ? String(prefillOffProduct.protein_100g)
          : ""
      );
      setFat(
        prefillOffProduct.fat_100g !== null
          ? String(prefillOffProduct.fat_100g)
          : ""
      );
      setCarbs(
        prefillOffProduct.carbs_100g !== null
          ? String(prefillOffProduct.carbs_100g)
          : ""
      );
    } else {
      setTitle("");
      setGrams("");
      setKcal("");
      setProtein("");
      setFat("");
      setCarbs("");
    }
  }, [open, defaultDate, prefillOffProduct]);

  function handleGramsChange(nextGrams: string) {
    setGrams(nextGrams);
    const g = Number(nextGrams);
    if (prefillOffProduct && prefillOffProduct.found && g > 0) {
      const ratio = g / 100;
      if (prefillOffProduct.kcal_100g !== null) {
        setKcal(String(Math.round(prefillOffProduct.kcal_100g * ratio)));
      }
      if (prefillOffProduct.protein_100g !== null) {
        setProtein(
          String(Math.round(prefillOffProduct.protein_100g * ratio * 10) / 10)
        );
      }
      if (prefillOffProduct.fat_100g !== null) {
        setFat(String(Math.round(prefillOffProduct.fat_100g * ratio * 10) / 10));
      }
      if (prefillOffProduct.carbs_100g !== null) {
        setCarbs(
          String(Math.round(prefillOffProduct.carbs_100g * ratio * 10) / 10)
        );
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveCalorieLogAction({
          logged_date: loggedDate,
          meal_slot: mealSlot,
          title,
          barcode: prefillOffProduct?.barcode ?? null,
          grams: grams ? Number(grams) : null,
          kcal: Number(kcal) || 0,
          protein_g: protein !== "" ? Number(protein) : null,
          fat_g: fat !== "" ? Number(fat) : null,
          carbs_g: carbs !== "" ? Number(carbs) : null,
        });
        toast.success("Запись КБЖУ сохранена");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Записать приём пищи (КБЖУ)"
      description={
        prefillOffProduct?.found
          ? "Макронутриенты автоматически пересчитываются пропорционально весу порции."
          : "Добавь блюдо в дневник КБЖУ за выбранный день."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="cal-title">Блюдо или продукт</FieldLabel>
            <Input
              id="cal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="cal-date">Дата</FieldLabel>
              <Input
                id="cal-date"
                type="date"
                value={loggedDate}
                onChange={(e) => setLoggedDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cal-grams">Вес порции (г)</FieldLabel>
              <Input
                id="cal-grams"
                type="number"
                min={1}
                value={grams}
                onChange={(e) => handleGramsChange(e.target.value)}
                placeholder="100"
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Приём пищи</FieldLabel>
            <ToggleGroup
              type="single"
              value={mealSlot}
              onValueChange={(v) =>
                v &&
                setMealSlot(v as "breakfast" | "lunch" | "dinner" | "snack")
              }
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-4 gap-1"
            >
              <ToggleGroupItem value="breakfast" className="min-h-10 text-xs">
                Завтрак
              </ToggleGroupItem>
              <ToggleGroupItem value="lunch" className="min-h-10 text-xs">
                Обед
              </ToggleGroupItem>
              <ToggleGroupItem value="dinner" className="min-h-10 text-xs">
                Ужин
              </ToggleGroupItem>
              <ToggleGroupItem value="snack" className="min-h-10 text-xs">
                Перекус
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="cal-kcal">Ккал</FieldLabel>
              <Input
                id="cal-kcal"
                type="number"
                min={0}
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                required
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cal-p">Белки (г)</FieldLabel>
              <Input
                id="cal-p"
                type="number"
                min={0}
                step="0.1"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cal-f">Жиры (г)</FieldLabel>
              <Input
                id="cal-f"
                type="number"
                min={0}
                step="0.1"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
                className="min-h-10 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cal-c">Углеводы (г)</FieldLabel>
              <Input
                id="cal-c"
                type="number"
                min={0}
                step="0.1"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
                className="min-h-10 num-tabular"
              />
            </Field>
          </div>
        </FieldGroup>

        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl"
        >
          Сохранить в дневник КБЖУ
        </Button>
      </form>
    </ResponsiveModal>
  );
}
