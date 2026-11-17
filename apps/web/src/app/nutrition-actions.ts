"use server";

import { revalidatePath } from "next/cache";
import {
  addShoppingItem,
  adjustPantryQuantity,
  cacheFoodDictionaryItem,
  calculateNutritionTargetsWithAi,
  clearCheckedShoppingItems,
  createMealPlanEntry,
  createRecipeWithIngredients,
  deleteBodyWeightLog,
  deleteCalorieLog,
  deleteMealPlanEntry,
  deletePantryItem,
  deleteRecipe,
  deleteShoppingItem,
  generateShoppingListFromMealPlan,
  getDayFoodDiary,
  getNutritionAndWeightAnalytics,
  getWeekBoundsIso,
  listMealPlanEntries,
  logFoodDiaryEntry,
  lookupBarcodeWithAutoCache,
  markMealCookedOrEaten,
  normalizeIngredientUnit,
  searchFoodNutritionWithAutoLookup,
  toggleShoppingItemChecked,
  updateCalorieLog,
  updateMealPlanEntry,
  updatePantryItem,
  updateRecipeWithIngredients,
  upsertBodyWeightLog,
  upsertNutritionTargets,
  upsertPantryItem,
  type AiCalculatedTargetsResult,
  type CalorieLogSource,
  type DayFoodDiary,
  type DiaryMealSlot,
  type FoodDictionaryItem,
  type IngredientUnit,
  type MealCategory,
  type MealPlanEntryWithRecipe,
  type MealPlanStatus,
  type MealSlot,
  type NutritionAndWeightAnalytics,
  type NutritionConfiguredVia,
  type NutritionGoalMode,
  type NutritionSex,
  type OffParsedProduct,
  type RecipeIngredientDraft,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

function revalidateNutritionAndHome() {
  revalidatePath("/", "layout");
}

// ============================================================================
// Day Diary, AI Targets & Combined Weight + КБЖУ Analytics
// ============================================================================

export async function fetchDayFoodDiaryAction(
  dateStr: string
): Promise<DayFoodDiary> {
  const { db } = await requireOwnerSession();
  return getDayFoodDiary(db, dateStr, "Europe/Moscow");
}

export async function calculateAiTargetsAction(params: {
  prompt?: string | null;
  sex?: NutritionSex | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  activityLevel?: string | null;
  goalMode?: NutritionGoalMode | null;
}): Promise<AiCalculatedTargetsResult> {
  await requireOwnerSession();
  return calculateNutritionTargetsWithAi(params);
}

export async function saveNutritionTargetsAction(payload: {
  kcal_target: number;
  protein_target_g: number;
  fat_target_g: number;
  carbs_target_g: number;
  fiber_target_g?: number | null;
  goal_mode: NutritionGoalMode;
  sex?: NutritionSex | null;
  age?: number | null;
  height_cm?: number | null;
  baseline_weight_kg?: number | null;
  target_weight_kg?: number | null;
  activity_level?: string | null;
  ai_explanation?: string | null;
  configured_via?: NutritionConfiguredVia;
  logBaselineWeight?: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  const saved = await upsertNutritionTargets(db, {
    user_id: userId,
    markConfigured: true,
    kcal_target: Math.round(Number(payload.kcal_target) || 2200),
    protein_target_g: Number(payload.protein_target_g) || 150,
    fat_target_g: Number(payload.fat_target_g) || 73,
    carbs_target_g: Number(payload.carbs_target_g) || 235,
    fiber_target_g:
      payload.fiber_target_g !== null && payload.fiber_target_g !== undefined
        ? Number(payload.fiber_target_g)
        : 28,
    goal_mode: payload.goal_mode,
    sex: payload.sex ?? null,
    age: payload.age ? Math.round(Number(payload.age)) : null,
    height_cm: payload.height_cm ? Number(payload.height_cm) : null,
    baseline_weight_kg: payload.baseline_weight_kg
      ? Number(payload.baseline_weight_kg)
      : null,
    target_weight_kg: payload.target_weight_kg
      ? Number(payload.target_weight_kg)
      : null,
    activity_level: payload.activity_level?.trim() || null,
    ai_explanation: payload.ai_explanation?.trim() || null,
    configured_via: payload.configured_via ?? "ai",
  });

  if (
    payload.logBaselineWeight &&
    payload.baseline_weight_kg &&
    Number(payload.baseline_weight_kg) >= 25
  ) {
    await upsertBodyWeightLog(db, {
      user_id: userId,
      weight_kg: Number(payload.baseline_weight_kg),
      note: "Стартовый вес при настройке нормы КБЖУ",
      source: "web",
    });
  }

  revalidateNutritionAndHome();
  return saved;
}

// ============================================================================
// 3-Tier Open Food Search, Barcode Lookup & Diary Logging
// ============================================================================

export async function searchFoodAutoLookupAction(
  query: string,
  options?: { allowRemote?: boolean; limit?: number }
): Promise<FoodDictionaryItem[]> {
  const { db, userId } = await requireOwnerSession();
  const allowRemote = options?.allowRemote ?? true;
  return searchFoodNutritionWithAutoLookup(db, userId, query, {
    allowOff: allowRemote,
    allowAiFallback: allowRemote,
    limit: options?.limit ?? 10,
  });
}

export async function lookupBarcodeFoodAction(barcode: string): Promise<{
  item: FoodDictionaryItem | null;
  offProduct: OffParsedProduct;
}> {
  const { db, userId } = await requireOwnerSession();
  return lookupBarcodeWithAutoCache(db, userId, barcode);
}

export async function logFoodDiaryEntryAction(payload: {
  logged_date: string;
  meal_slot: DiaryMealSlot;
  title?: string;
  grams?: number | null;
  servings?: number | null;
  food_item_id?: number | null;
  recipe_id?: number | null;
  barcode?: string | null;
  kcal?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  fiber_g?: number | null;
  source?: CalorieLogSource;
  cacheCustomBarcodeItem?: {
    display_name: string;
    barcode: string;
    kcal_100g: number;
    protein_100g: number;
    fat_100g: number;
    carbs_100g: number;
  } | null;
}) {
  const { db, userId } = await requireOwnerSession();

  let resolvedFoodItemId = payload.food_item_id ?? null;
  if (payload.cacheCustomBarcodeItem) {
    const cached = await cacheFoodDictionaryItem(db, userId, {
      display_name: payload.cacheCustomBarcodeItem.display_name,
      barcode: payload.cacheCustomBarcodeItem.barcode,
      kcal_100g: payload.cacheCustomBarcodeItem.kcal_100g,
      protein_100g: payload.cacheCustomBarcodeItem.protein_100g,
      fat_100g: payload.cacheCustomBarcodeItem.fat_100g,
      carbs_100g: payload.cacheCustomBarcodeItem.carbs_100g,
      source: "user",
    });
    resolvedFoodItemId = cached.id;
  }

  const created = await logFoodDiaryEntry(db, {
    user_id: userId,
    logged_date: payload.logged_date,
    meal_slot: payload.meal_slot,
    title: payload.title,
    grams: payload.grams,
    servings: payload.servings,
    food_item_id: resolvedFoodItemId,
    recipe_id: payload.recipe_id,
    barcode: payload.barcode,
    kcal: payload.kcal,
    protein_g: payload.protein_g,
    fat_g: payload.fat_g,
    carbs_g: payload.carbs_g,
    fiber_g: payload.fiber_g,
    source: payload.source ?? "web",
  });
  revalidateNutritionAndHome();
  return created;
}

export async function updateFoodDiaryEntryAction(payload: {
  id: number;
  meal_slot?: DiaryMealSlot;
  title?: string;
  grams?: number | null;
  servings?: number | null;
  kcal?: number;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
}) {
  const { db } = await requireOwnerSession();
  const updated = await updateCalorieLog(db, payload.id, {
    meal_slot: payload.meal_slot,
    title: payload.title?.trim(),
    grams: payload.grams,
    servings: payload.servings,
    kcal: payload.kcal,
    protein_g: payload.protein_g,
    fat_g: payload.fat_g,
    carbs_g: payload.carbs_g,
  });
  revalidateNutritionAndHome();
  return updated;
}

export async function deleteCalorieLogAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteCalorieLog(db, id);
  revalidateNutritionAndHome();
}

// ============================================================================
// Body Weight Logs & Combined Analytics
// ============================================================================

export async function saveBodyWeightAction(payload: {
  logged_date: string;
  weight_kg: number;
  body_fat_pct?: number | null;
  waist_cm?: number | null;
  note?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const w = Number(payload.weight_kg);
  if (!Number.isFinite(w) || w < 20 || w > 350) {
    throw new Error("Укажи корректный вес (20–350 кг)");
  }

  await upsertBodyWeightLog(db, {
    user_id: userId,
    logged_date: payload.logged_date,
    weight_kg: w,
    body_fat_pct:
      payload.body_fat_pct !== null &&
      payload.body_fat_pct !== undefined &&
      Number(payload.body_fat_pct) > 0
        ? Number(payload.body_fat_pct)
        : null,
    waist_cm:
      payload.waist_cm !== null &&
      payload.waist_cm !== undefined &&
      Number(payload.waist_cm) > 0
        ? Number(payload.waist_cm)
        : null,
    note: payload.note?.trim() || null,
    source: "web",
  });
  revalidateNutritionAndHome();
}

export async function deleteBodyWeightAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteBodyWeightLog(db, id);
  revalidateNutritionAndHome();
}

export async function fetchNutritionAndWeightAnalyticsAction(
  days: 7 | 14 | 30 | 90
): Promise<NutritionAndWeightAnalytics> {
  const { db } = await requireOwnerSession();
  return getNutritionAndWeightAnalytics(db, {
    days,
    timeZone: "Europe/Moscow",
  });
}

// ============================================================================
// Week Meal Plan Fetcher
// ============================================================================

export async function fetchNutritionWeekAction(anchorDate: string): Promise<{
  weekStart: string;
  weekEnd: string;
  weekDates: string[];
  weekMealPlan: MealPlanEntryWithRecipe[];
}> {
  const { db } = await requireOwnerSession();
  const { weekStart, weekEnd, dates } = getWeekBoundsIso(anchorDate);
  const weekMealPlan = await listMealPlanEntries(db, {
    startDate: weekStart,
    endDate: weekEnd,
  });
  return {
    weekStart,
    weekEnd,
    weekDates: dates,
    weekMealPlan,
  };
}

// ============================================================================
// Recipes & Structured Ingredients (Auto-Computes Recipe Macros!)
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
