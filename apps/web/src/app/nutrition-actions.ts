"use server";

import { revalidatePath } from "next/cache";
import {
  addShoppingItem,
  adjustPantryQuantity,
  clearCheckedShoppingItems,
  createCalorieLog,
  createMealPlanEntry,
  createRecipeWithIngredients,
  deleteCalorieLog,
  deleteMealPlanEntry,
  deletePantryItem,
  deleteRecipe,
  deleteShoppingItem,
  evaluateAndSaveOffProduct,
  generateShoppingListFromMealPlan,
  getWeekBoundsIso,
  listCalorieLogs,
  listMealPlanEntries,
  markMealCookedOrEaten,
  normalizeIngredientUnit,
  searchOpenFoodFactsProducts,
  setCaloriesFeatureFlag,
  toggleShoppingItemChecked,
  updateMealPlanEntry,
  updatePantryItem,
  updateRecipeWithIngredients,
  upsertPantryItem,
  type CalorieLog,
  type IngredientUnit,
  type MealCategory,
  type MealPlanEntryWithRecipe,
  type MealPlanStatus,
  type MealSlot,
  type OffParsedProduct,
  type OffProductEvaluation,
  type RecipeIngredientDraft,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

function revalidateNutritionAndHome() {
  revalidatePath("/", "layout");
}

// ============================================================================
// Feature Flag & Week Loader
// ============================================================================

export async function setCaloriesFeatureFlagAction(enabled: boolean) {
  const { db, userId } = await requireOwnerSession();
  await setCaloriesFeatureFlag(db, userId, enabled);
  revalidateNutritionAndHome();
}

export async function fetchNutritionWeekAction(anchorDate: string): Promise<{
  weekStart: string;
  weekEnd: string;
  weekDates: string[];
  weekMealPlan: MealPlanEntryWithRecipe[];
  calorieLogs: CalorieLog[];
}> {
  const { db } = await requireOwnerSession();
  const { weekStart, weekEnd, dates } = getWeekBoundsIso(anchorDate);
  const [weekMealPlan, calorieLogs] = await Promise.all([
    listMealPlanEntries(db, { startDate: weekStart, endDate: weekEnd }),
    listCalorieLogs(db, anchorDate),
  ]);
  return {
    weekStart,
    weekEnd,
    weekDates: dates,
    weekMealPlan,
    calorieLogs,
  };
}

// ============================================================================
// Recipes & Structured Ingredients
// ============================================================================

export interface SaveRecipePayload {
  id?: number;
  title: string;
  meal_category: MealCategory;
  default_servings: number;
  cook_time_minutes?: number | null;
  steps_markdown?: string | null;
  tags?: string[];
  is_favorite?: boolean;
  kcal_per_serving?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  ingredients: RecipeIngredientDraft[];
}

export async function saveRecipeAction(payload: SaveRecipePayload) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название рецепта");

  const common = {
    title,
    meal_category: payload.meal_category,
    default_servings: Math.max(1, Math.round(Number(payload.default_servings) || 2)),
    cook_time_minutes:
      payload.cook_time_minutes && Number(payload.cook_time_minutes) > 0
        ? Math.round(Number(payload.cook_time_minutes))
        : null,
    steps_markdown: payload.steps_markdown?.trim() || null,
    tags: (payload.tags ?? [])
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean),
    is_favorite: Boolean(payload.is_favorite),
    kcal_per_serving:
      payload.kcal_per_serving !== null &&
      payload.kcal_per_serving !== undefined &&
      Number(payload.kcal_per_serving) >= 0
        ? Math.round(Number(payload.kcal_per_serving))
        : null,
    protein_g:
      payload.protein_g !== null &&
      payload.protein_g !== undefined &&
      Number(payload.protein_g) >= 0
        ? Number(payload.protein_g)
        : null,
    fat_g:
      payload.fat_g !== null &&
      payload.fat_g !== undefined &&
      Number(payload.fat_g) >= 0
        ? Number(payload.fat_g)
        : null,
    carbs_g:
      payload.carbs_g !== null &&
      payload.carbs_g !== undefined &&
      Number(payload.carbs_g) >= 0
        ? Number(payload.carbs_g)
        : null,
  };

  if (payload.id) {
    await updateRecipeWithIngredients(db, payload.id, common, payload.ingredients);
  } else {
    await createRecipeWithIngredients(
      db,
      { user_id: userId, ...common },
      payload.ingredients
    );
  }
  revalidateNutritionAndHome();
}

export async function toggleRecipeFavoriteAction(
  id: number,
  isFavorite: boolean
) {
  const { db } = await requireOwnerSession();
  await updateRecipeWithIngredients(db, id, { is_favorite: isFavorite });
  revalidateNutritionAndHome();
}

export async function deleteRecipeAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteRecipe(db, id);
  revalidateNutritionAndHome();
}

// ============================================================================
// Meal Plan & Cooking
// ============================================================================

export async function saveMealPlanEntryAction(payload: {
  id?: number;
  plan_date: string;
  meal_slot: MealSlot;
  recipe_id?: number | null;
  custom_meal_title?: string | null;
  planned_servings: number;
  status?: MealPlanStatus;
}) {
  const { db, userId } = await requireOwnerSession();
  if (!payload.recipe_id && !payload.custom_meal_title?.trim()) {
    throw new Error("Выбери рецепт или напиши название блюда");
  }

  const common = {
    plan_date: payload.plan_date,
    meal_slot: payload.meal_slot,
    recipe_id: payload.recipe_id || null,
    custom_meal_title: payload.custom_meal_title?.trim() || null,
    planned_servings: Math.max(0.5, Number(payload.planned_servings) || 1),
    status: payload.status ?? ("planned" as MealPlanStatus),
  };

  if (payload.id) {
    await updateMealPlanEntry(db, payload.id, common);
  } else {
    await createMealPlanEntry(db, {
      user_id: userId,
      ...common,
    });
  }
  revalidateNutritionAndHome();
}

export async function markMealStatusAction(payload: {
  id: number;
  status: MealPlanStatus;
  deductFromPantry?: boolean;
}) {
  const { db } = await requireOwnerSession();
  const res = await markMealCookedOrEaten(db, payload.id, payload.status, {
    deductFromPantry: payload.deductFromPantry,
  });
  revalidateNutritionAndHome();
  return res.deductedIngredientsCount;
}

export async function deleteMealPlanEntryAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteMealPlanEntry(db, id);
  revalidateNutritionAndHome();
}

// ============================================================================
// Smart Shopping List
// ============================================================================

export async function addShoppingItemAction(payload: {
  display_name: string;
  quantity_needed?: number;
  unit?: IngredientUnit | string;
  aisle_group?: string;
}) {
  const { db, userId } = await requireOwnerSession();
  const name = payload.display_name.trim();
  if (!name) throw new Error("Укажи название продукта");

  await addShoppingItem(db, {
    user_id: userId,
    display_name: name,
    quantity_needed: Math.max(0.1, Number(payload.quantity_needed) || 1),
    unit: normalizeIngredientUnit(payload.unit ?? "pcs"),
    aisle_group: payload.aisle_group?.trim() || "Прочее",
    added_from: "manual",
  });
  revalidateNutritionAndHome();
}

export async function toggleShoppingItemAction(id: number, checked: boolean) {
  const { db } = await requireOwnerSession();
  await toggleShoppingItemChecked(db, id, checked);
  revalidateNutritionAndHome();
}

export async function deleteShoppingItemAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteShoppingItem(db, id);
  revalidateNutritionAndHome();
}

export async function clearCheckedShoppingAction(options: {
  moveToPantry?: boolean;
}) {
  const { db } = await requireOwnerSession();
  const res = await clearCheckedShoppingItems(db, options);
  revalidateNutritionAndHome();
  return res;
}

export async function generateShoppingFromMenuAction(payload: {
  startDate: string;
  endDate: string;
}) {
  const { db } = await requireOwnerSession();
  const res = await generateShoppingListFromMealPlan(db, {
    startDate: payload.startDate,
    endDate: payload.endDate,
    replaceUncheckedMealPlanItems: true,
  });
  revalidateNutritionAndHome();
  return {
    addedCount: res.items.length,
    coveredByPantryCount: res.coveredByPantryCount,
    partiallySubtractedCount: res.partiallySubtractedCount,
  };
}

// ============================================================================
// Home Pantry Stock
// ============================================================================

export async function savePantryItemAction(payload: {
  id?: number;
  display_name: string;
  quantity_on_hand: number;
  unit: IngredientUnit;
  aisle_group?: string;
  low_stock_threshold?: number | null;
  expires_on?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const name = payload.display_name.trim();
  if (!name) throw new Error("Укажи название запаса");

  const common = {
    display_name: name,
    quantity_on_hand: Math.max(0, Number(payload.quantity_on_hand) || 0),
    unit: normalizeIngredientUnit(payload.unit),
    aisle_group: payload.aisle_group?.trim() || "Прочее",
    low_stock_threshold:
      payload.low_stock_threshold !== null &&
      payload.low_stock_threshold !== undefined &&
      Number(payload.low_stock_threshold) > 0
        ? Number(payload.low_stock_threshold)
        : null,
    expires_on: payload.expires_on || null,
  };

  if (payload.id) {
    await updatePantryItem(db, payload.id, common);
  } else {
    await upsertPantryItem(db, {
      user_id: userId,
      ...common,
    });
  }
  revalidateNutritionAndHome();
}

export async function adjustPantryQtyAction(payload: {
  id: number;
  delta: number;
}) {
  const { db } = await requireOwnerSession();
  await adjustPantryQuantity(db, payload.id, payload.delta);
  revalidateNutritionAndHome();
}

export async function deletePantryItemAction(id: number) {
  const { db } = await requireOwnerSession();
  await deletePantryItem(db, id);
  revalidateNutritionAndHome();
}

// ============================================================================
// Open Food Facts Evaluation & Calorie Logs
// ============================================================================

export async function evaluateOffBarcodeAction(payload: {
  barcode: string;
  queryNote?: string | null;
}): Promise<OffProductEvaluation> {
  const { db, userId } = await requireOwnerSession();
  const saved = await evaluateAndSaveOffProduct(
    db,
    userId,
    payload.barcode.trim(),
    payload.queryNote?.trim() || null
  );
  revalidateNutritionAndHome();
  return saved;
}

export async function searchOffProductsAction(
  query: string
): Promise<OffParsedProduct[]> {
  await requireOwnerSession();
  if (!query.trim()) return [];
  return searchOpenFoodFactsProducts(query.trim(), 8);
}

export async function saveCalorieLogAction(payload: {
  logged_date: string;
  meal_slot: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  barcode?: string | null;
  grams?: number | null;
  kcal: number;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название блюда или продукта");

  await createCalorieLog(db, {
    user_id: userId,
    logged_date: payload.logged_date,
    meal_slot: payload.meal_slot,
    title,
    barcode: payload.barcode?.trim() || null,
    grams:
      payload.grams !== null &&
      payload.grams !== undefined &&
      Number(payload.grams) > 0
        ? Number(payload.grams)
        : null,
    kcal: Math.max(0, Math.round(Number(payload.kcal) || 0)),
    protein_g:
      payload.protein_g !== null && payload.protein_g !== undefined
        ? Number(payload.protein_g)
        : null,
    fat_g:
      payload.fat_g !== null && payload.fat_g !== undefined
        ? Number(payload.fat_g)
        : null,
    carbs_g:
      payload.carbs_g !== null && payload.carbs_g !== undefined
        ? Number(payload.carbs_g)
        : null,
  });
  revalidateNutritionAndHome();
}

export async function deleteCalorieLogAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteCalorieLog(db, id);
  revalidateNutritionAndHome();
}
