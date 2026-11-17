import type { Json } from "./database.types";
import {
  cancelEntityRemindersInQueue,
  escapeTelegramHtml,
  resolveDefaultTelegramChatId,
} from "./reminders";
import {
  addDaysToIsoDate,
  formatIsoDate,
  getOwnerProfile,
  getWeekBoundsIso,
  localClockToUtcIso,
  normalizeTaskTitleForDedup,
  updateOwnerProfile,
} from "./repositories";
import type {
  CalorieLog,
  CalorieLogInsert,
  CalorieLogUpdate,
  FuzzyFinanceMatch,
  IngredientUnit,
  MealCategory,
  MealPlanEntry,
  MealPlanEntryInsert,
  MealPlanEntryUpdate,
  MealPlanEntryWithRecipe,
  MealPlanStatus,
  OffCompletenessStats,
  OffParsedProduct,
  OffProductEvaluation,
  PantryItem,
  PantryItemInsert,
  PantryItemUpdate,
  Recipe,
  RecipeIngredient,
  RecipeIngredientInsert,
  RecipeInsert,
  RecipeUpdate,
  RecipeWithIngredients,
  ShoppingAddedFrom,
  ShoppingListItem,
  ShoppingListItemInsert,
  ShoppingListItemUpdate,
  TypedSupabaseClient,
  UserProfile,
} from "./types";

const OFF_USER_AGENT = "LifeOS/1.0 (https://life.vector-bd.top)";

function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function normalizeIngredientKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(\d+%|\d+\s*г|\d+\s*мл|с\/м|свежая|свежий|свежие)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIngredientUnit(raw?: string | null): IngredientUnit {
  const u = (raw ?? "g").trim().toLowerCase().replace(/\./g, "");
  if (u === "g" || u === "г" || u === "гр" || u === "грамм") return "g";
  if (u === "kg" || u === "кг" || u === "килограмм") return "kg";
  if (u === "ml" || u === "мл") return "ml";
  if (u === "l" || u === "л" || u === "литр") return "l";
  if (u === "pcs" || u === "шт" || u === "штук" || u === "штука") return "pcs";
  if (u === "tbsp" || u === "стл" || u === "ст л") return "tbsp";
  if (u === "tsp" || u === "чл" || u === "ч л") return "tsp";
  if (u === "pack" || u === "уп" || u === "упак" || u === "пачка") return "pack";
  return "pcs";
}

function toCanonicalUnitAmount(amount: number, unit: IngredientUnit): {
  canonicalUnit: IngredientUnit;
  canonicalAmount: number;
} {
  if (unit === "kg") return { canonicalUnit: "g", canonicalAmount: roundQty(amount * 1000) };
  if (unit === "l") return { canonicalUnit: "ml", canonicalAmount: roundQty(amount * 1000) };
  return { canonicalUnit: unit, canonicalAmount: roundQty(amount) };
}

function fromCanonicalToTargetUnit(
  canonicalAmount: number,
  canonicalUnit: IngredientUnit,
  targetUnit: IngredientUnit
): number {
  if (canonicalUnit === "g" && targetUnit === "kg") return roundQty(canonicalAmount / 1000);
  if (canonicalUnit === "ml" && targetUnit === "l") return roundQty(canonicalAmount / 1000);
  return roundQty(canonicalAmount);
}

// ============================================================================
// Pantry Expiry Reminder Sync
// ============================================================================

export async function syncPantryExpiryReminderToQueue(
  db: TypedSupabaseClient,
  item: PantryItem,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(item.id);
  await cancelEntityRemindersInQueue(db, entityId, ["pantry_expiry"]);

  if (!item.expires_on || Number(item.quantity_on_hand) <= 0) {
    return;
  }

  const warnDate = addDaysToIsoDate(item.expires_on, -1);
  const todayStr = formatIsoDate(new Date(), timeZone);
  const effectiveDate =
    warnDate >= todayStr ? warnDate : item.expires_on >= todayStr ? item.expires_on : null;
  if (!effectiveDate) return;

  const triggerAt = localClockToUtcIso(effectiveDate, "10:30", timeZone);
  const msg =
    `🥦 <b>Срок годности запаса (${escapeTelegramHtml(item.expires_on)})</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(item.display_name)}</b> — в наличии ${Number(
      item.quantity_on_hand
    )} ${escapeTelegramHtml(item.unit)}`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: item.user_id,
    entity_type: "pantry_expiry",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      pantry_item_id: item.id,
      expires_on: item.expires_on,
    } as Json,
  });
  if (error) throw error;
}

// ============================================================================
// Recipes & Structured Ingredients
// ============================================================================

export interface RecipeIngredientDraft {
  display_name: string;
  ingredient_key?: string;
  amount: number;
  unit?: IngredientUnit | string;
  aisle_group?: string;
  is_optional?: boolean;
}

export async function listRecipes(
  db: TypedSupabaseClient,
  filter: { mealCategory?: MealCategory; favoritesOnly?: boolean; searchQuery?: string } = {}
): Promise<RecipeWithIngredients[]> {
  let query = db
    .from("recipes")
    .select("*")
    .order("is_favorite", { ascending: false })
    .order("title", { ascending: true });

  if (filter.mealCategory) {
    query = query.eq("meal_category", filter.mealCategory);
  }
  if (filter.favoritesOnly) {
    query = query.eq("is_favorite", true);
  }

  const [{ data: recipes, error: recErr }, { data: allIngs, error: ingErr }] =
    await Promise.all([
      query,
      db.from("recipe_ingredients").select("*").order("id", { ascending: true }),
    ]);

  if (recErr) throw recErr;
  if (ingErr) throw ingErr;

  const ingsByRecipe = new Map<number, RecipeIngredient[]>();
  for (const ing of allIngs ?? []) {
    const arr = ingsByRecipe.get(ing.recipe_id) ?? [];
    arr.push(ing);
    ingsByRecipe.set(ing.recipe_id, arr);
  }

  let combined: RecipeWithIngredients[] = (recipes ?? []).map((r) => ({
    ...r,
    ingredients: ingsByRecipe.get(r.id) ?? [],
  }));

  if (filter.searchQuery && filter.searchQuery.trim()) {
    const normQ = normalizeTaskTitleForDedup(filter.searchQuery);
    combined = combined.filter((r) => {
      const hay = normalizeTaskTitleForDedup(
        `${r.title} ${(r.tags ?? []).join(" ")} ${r.ingredients
          .map((i) => i.display_name)
          .join(" ")}`
      );
      return hay.includes(normQ);
    });
  }

  return combined;
}

export async function getRecipeWithIngredients(
  db: TypedSupabaseClient,
  id: number
): Promise<RecipeWithIngredients | null> {
  const [{ data: recipe, error: recErr }, { data: ings, error: ingErr }] =
    await Promise.all([
      db.from("recipes").select("*").eq("id", id).maybeSingle(),
      db
        .from("recipe_ingredients")
        .select("*")
        .eq("recipe_id", id)
        .order("id", { ascending: true }),
    ]);
  if (recErr) throw recErr;
  if (ingErr) throw ingErr;
  if (!recipe) return null;
  return {
    ...recipe,
    ingredients: ings ?? [],
  };
}

export async function createRecipeWithIngredients(
  db: TypedSupabaseClient,
  recipeInput: RecipeInsert,
  ingredients: RecipeIngredientDraft[] = []
): Promise<RecipeWithIngredients> {
  const { data: recipe, error: recErr } = await db
    .from("recipes")
    .insert(recipeInput)
    .select("*")
    .single();
  if (recErr) throw recErr;

  let insertedIngs: RecipeIngredient[] = [];
  if (ingredients.length > 0) {
    const rows: RecipeIngredientInsert[] = ingredients
      .filter((i) => i.display_name.trim() && Number(i.amount) > 0)
      .map((i) => ({
        user_id: recipe.user_id,
        recipe_id: recipe.id,
        display_name: i.display_name.trim(),
        ingredient_key:
          i.ingredient_key && i.ingredient_key.trim()
            ? normalizeIngredientKey(i.ingredient_key)
            : normalizeIngredientKey(i.display_name),
        amount: roundQty(Number(i.amount)),
        unit: normalizeIngredientUnit(i.unit),
        aisle_group: i.aisle_group?.trim() || "Прочее",
        is_optional: Boolean(i.is_optional),
      }));

    if (rows.length > 0) {
      const { data: ingData, error: ingErr } = await db
        .from("recipe_ingredients")
        .insert(rows)
        .select("*");
      if (ingErr) throw ingErr;
      insertedIngs = ingData ?? [];
    }
  }

  return {
    ...recipe,
    ingredients: insertedIngs,
  };
}

export async function updateRecipeWithIngredients(
  db: TypedSupabaseClient,
  id: number,
  patch: RecipeUpdate,
  ingredients?: RecipeIngredientDraft[]
): Promise<RecipeWithIngredients> {
  const { data: recipe, error: recErr } = await db
    .from("recipes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (recErr) throw recErr;

  if (ingredients !== undefined) {
    const { error: delErr } = await db
      .from("recipe_ingredients")
      .delete()
      .eq("recipe_id", id);
    if (delErr) throw delErr;

    const rows: RecipeIngredientInsert[] = ingredients
      .filter((i) => i.display_name.trim() && Number(i.amount) > 0)
      .map((i) => ({
        user_id: recipe.user_id,
        recipe_id: id,
        display_name: i.display_name.trim(),
        ingredient_key:
          i.ingredient_key && i.ingredient_key.trim()
            ? normalizeIngredientKey(i.ingredient_key)
            : normalizeIngredientKey(i.display_name),
        amount: roundQty(Number(i.amount)),
        unit: normalizeIngredientUnit(i.unit),
        aisle_group: i.aisle_group?.trim() || "Прочее",
        is_optional: Boolean(i.is_optional),
      }));

    if (rows.length > 0) {
      const { error: insErr } = await db.from("recipe_ingredients").insert(rows);
      if (insErr) throw insErr;
    }
  }

  const full = await getRecipeWithIngredients(db, id);
  if (!full) throw new Error("Рецепт не найден после обновления");
  return full;
}

export async function deleteRecipe(db: TypedSupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

export async function resolveRecipeByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null
): Promise<{
  recipe: RecipeWithIngredients | null;
  matches: FuzzyFinanceMatch<RecipeWithIngredients>[];
}> {
  if (query === undefined || query === null || String(query).trim() === "") {
    return { recipe: null, matches: [] };
  }
  const recipes = await listRecipes(db);
  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = recipes.find((r) => r.id === id) ?? null;
    return { recipe: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 3);
  const scored: FuzzyFinanceMatch<RecipeWithIngredients>[] = [];

  for (const r of recipes) {
    const normTitle = normalizeTaskTitleForDedup(r.title);
    let score = 0;
    if (normTitle === normQ) score = 1.0;
    else if (normTitle.includes(normQ) || (normQ.length >= 4 && normQ.includes(normTitle))) {
      score = 0.92;
    } else if (qWords.length > 0) {
      const hay = `${normTitle} ${normalizeTaskTitleForDedup((r.tags ?? []).join(" "))}`;
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) scored.push({ item: r, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return { recipe: scored[0]?.item ?? null, matches: scored };
}

// ============================================================================
// Pantry Inventory (Home Stock)
// ============================================================================

export async function listPantryItems(db: TypedSupabaseClient): Promise<PantryItem[]> {
  const { data, error } = await db
    .from("pantry_items")
    .select("*")
    .order("aisle_group", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertPantryItem(
  db: TypedSupabaseClient,
  input: Omit<PantryItemInsert, "ingredient_key"> & { ingredient_key?: string }
): Promise<PantryItem> {
  const key =
    input.ingredient_key && input.ingredient_key.trim()
      ? normalizeIngredientKey(input.ingredient_key)
      : normalizeIngredientKey(input.display_name);
  const unit = normalizeIngredientUnit(input.unit);

  const { data, error } = await db
    .from("pantry_items")
    .upsert(
      {
        ...input,
        ingredient_key: key,
        unit,
        quantity_on_hand: roundQty(Math.max(0, Number(input.quantity_on_hand ?? 0))),
      },
      { onConflict: "user_id,ingredient_key,unit" }
    )
    .select("*")
    .single();
  if (error) throw error;
  await syncPantryExpiryReminderToQueue(db, data);
  return data;
}

export async function updatePantryItem(
  db: TypedSupabaseClient,
  id: number,
  patch: PantryItemUpdate
): Promise<PantryItem> {
  const prepared: PantryItemUpdate = { ...patch };
  if (prepared.display_name && !prepared.ingredient_key) {
    prepared.ingredient_key = normalizeIngredientKey(prepared.display_name);
  }
  if (prepared.unit) {
    prepared.unit = normalizeIngredientUnit(prepared.unit);
  }
  if (prepared.quantity_on_hand !== undefined) {
    prepared.quantity_on_hand = roundQty(Math.max(0, Number(prepared.quantity_on_hand)));
  }

  const { data, error } = await db
    .from("pantry_items")
    .update(prepared)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncPantryExpiryReminderToQueue(db, data);
  return data;
}

export async function adjustPantryQuantity(
  db: TypedSupabaseClient,
  idOrKey: number | string,
  delta: number,
  unit?: IngredientUnit | string
): Promise<PantryItem | null> {
  const items = await listPantryItems(db);
  let target: PantryItem | undefined;

  if (typeof idOrKey === "number" || /^\d+$/.test(String(idOrKey).trim())) {
    const id = Number(idOrKey);
    target = items.find((i) => i.id === id);
  } else {
    const normKey = normalizeIngredientKey(String(idOrKey));
    target = items.find(
      (i) =>
        i.ingredient_key === normKey ||
        normalizeIngredientKey(i.display_name) === normKey ||
        i.ingredient_key.includes(normKey) ||
        normKey.includes(i.ingredient_key)
    );
  }

  if (!target) return null;

  let adjustedDelta = delta;
  if (unit) {
    const incomingCanon = toCanonicalUnitAmount(Math.abs(delta), normalizeIngredientUnit(unit));
    const targetCanon = toCanonicalUnitAmount(1, target.unit as IngredientUnit);
    if (incomingCanon.canonicalUnit === targetCanon.canonicalUnit) {
      const inTargetUnits = fromCanonicalToTargetUnit(
        incomingCanon.canonicalAmount,
        incomingCanon.canonicalUnit,
        target.unit as IngredientUnit
      );
      adjustedDelta = delta < 0 ? -inTargetUnits : inTargetUnits;
    }
  }

  const nextQty = roundQty(Math.max(0, Number(target.quantity_on_hand) + adjustedDelta));
  return updatePantryItem(db, target.id, { quantity_on_hand: nextQty });
}

export async function deletePantryItem(db: TypedSupabaseClient, id: number): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["pantry_expiry"]);
  const { error } = await db.from("pantry_items").delete().eq("id", id);
  if (error) throw error;
}

export async function findPantryItemByFuzzyQuery(
  db: TypedSupabaseClient,
  query: string
): Promise<FuzzyFinanceMatch<PantryItem>[]> {
  const items = await listPantryItems(db);
  const normQ = normalizeIngredientKey(query);
  if (!normQ) return [];
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<PantryItem>[] = [];

  for (const p of items) {
    const hay = `${p.ingredient_key} ${normalizeIngredientKey(p.display_name)}`;
    let score = 0;
    if (p.ingredient_key === normQ || normalizeIngredientKey(p.display_name) === normQ) {
      score = 1.0;
    } else if (hay.includes(normQ) || (normQ.length >= 3 && normQ.includes(p.ingredient_key))) {
      score = 0.9;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.8;
    }
    if (score >= 0.4) scored.push({ item: p, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================================
// Meal Plan & Cooking Flow
// ============================================================================

const MEAL_SLOT_ORDER: Record<string, number> = {
  breakfast: 1,
  lunch: 2,
  dinner: 3,
  snack: 4,
  cook_ahead: 5,
};

export async function listMealPlanEntries(
  db: TypedSupabaseClient,
  params: { startDate: string; endDate: string }
): Promise<MealPlanEntryWithRecipe[]> {
  const [{ data: entries, error }, recipes] = await Promise.all([
    db
      .from("meal_plan_entries")
      .select("*")
      .gte("plan_date", params.startDate)
      .lte("plan_date", params.endDate)
      .order("plan_date", { ascending: true }),
    listRecipes(db),
  ]);
  if (error) throw error;

  const recipeMap = new Map<number, RecipeWithIngredients>(recipes.map((r) => [r.id, r]));

  return (entries ?? [])
    .map((e) => ({
      ...e,
      recipe: e.recipe_id ? recipeMap.get(e.recipe_id) ?? null : null,
    }))
    .sort((a, b) => {
      if (a.plan_date !== b.plan_date) return a.plan_date.localeCompare(b.plan_date);
      return (MEAL_SLOT_ORDER[a.meal_slot] ?? 9) - (MEAL_SLOT_ORDER[b.meal_slot] ?? 9);
    });
}

export async function createMealPlanEntry(
  db: TypedSupabaseClient,
  input: MealPlanEntryInsert
): Promise<MealPlanEntry> {
  const { data, error } = await db
    .from("meal_plan_entries")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateMealPlanEntry(
  db: TypedSupabaseClient,
  id: number,
  patch: MealPlanEntryUpdate
): Promise<MealPlanEntry> {
  const { data, error } = await db
    .from("meal_plan_entries")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function markMealCookedOrEaten(
  db: TypedSupabaseClient,
  id: number,
  status: MealPlanStatus = "cooked",
  options: { deductFromPantry?: boolean } = {}
): Promise<{ entry: MealPlanEntry; deductedIngredientsCount: number }> {
  const { data: existing, error: selErr } = await db
    .from("meal_plan_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error("Запись меню не найдена");

  let deducted = 0;
  if (
    options.deductFromPantry &&
    existing.recipe_id &&
    existing.status === "planned" &&
    (status === "cooked" || status === "eaten")
  ) {
    const recipe = await getRecipeWithIngredients(db, existing.recipe_id);
    if (recipe && recipe.ingredients.length > 0) {
      const scale =
        Number(existing.planned_servings) / Math.max(1, Number(recipe.default_servings));
      for (const ing of recipe.ingredients) {
        const res = await adjustPantryQuantity(
          db,
          ing.ingredient_key,
          -roundQty(Number(ing.amount) * scale),
          ing.unit
        );
        if (res) deducted += 1;
      }
    }
  }

  const entry = await updateMealPlanEntry(db, id, { status });
  return { entry, deductedIngredientsCount: deducted };
}

export async function deleteMealPlanEntry(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("meal_plan_entries").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Smart Shopping List (Subtracts Home Pantry Stock)
// ============================================================================

export async function listShoppingItems(
  db: TypedSupabaseClient,
  includeChecked = true
): Promise<ShoppingListItem[]> {
  let query = db
    .from("shopping_list_items")
    .select("*")
    .order("is_checked", { ascending: true })
    .order("aisle_group", { ascending: true })
    .order("display_name", { ascending: true });
  if (!includeChecked) {
    query = query.eq("is_checked", false);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function addShoppingItem(
  db: TypedSupabaseClient,
  input: Omit<ShoppingListItemInsert, "ingredient_key"> & { ingredient_key?: string | null }
): Promise<ShoppingListItem> {
  const key =
    input.ingredient_key !== undefined
      ? input.ingredient_key
      : normalizeIngredientKey(input.display_name);
  const unit = normalizeIngredientUnit(input.unit);

  // Merge into existing unchecked item if same ingredient_key + unit
  if (key) {
    const { data: existing } = await db
      .from("shopping_list_items")
      .select("*")
      .eq("user_id", input.user_id)
      .eq("ingredient_key", key)
      .eq("unit", unit)
      .eq("is_checked", false)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const nextQty = roundQty(
        Number(existing.quantity_needed) + Number(input.quantity_needed ?? 1)
      );
      return updateShoppingItem(db, existing.id, { quantity_needed: nextQty });
    }
  }

  const { data, error } = await db
    .from("shopping_list_items")
    .insert({
      ...input,
      ingredient_key: key,
      unit,
      quantity_needed: roundQty(Math.max(0.01, Number(input.quantity_needed ?? 1))),
      aisle_group: input.aisle_group?.trim() || "Прочее",
      added_from: (input.added_from ?? "manual") as ShoppingAddedFrom,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function addShoppingItemsBatch(
  db: TypedSupabaseClient,
  inputs: (Omit<ShoppingListItemInsert, "ingredient_key"> & { ingredient_key?: string | null })[]
): Promise<ShoppingListItem[]> {
  const created: ShoppingListItem[] = [];
  for (const item of inputs) {
    created.push(await addShoppingItem(db, item));
  }
  return created;
}

export async function updateShoppingItem(
  db: TypedSupabaseClient,
  id: number,
  patch: ShoppingListItemUpdate
): Promise<ShoppingListItem> {
  const { data, error } = await db
    .from("shopping_list_items")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function toggleShoppingItemChecked(
  db: TypedSupabaseClient,
  id: number,
  checked: boolean
): Promise<ShoppingListItem> {
  return updateShoppingItem(db, id, { is_checked: checked });
}

export async function deleteShoppingItem(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("shopping_list_items").delete().eq("id", id);
  if (error) throw error;
}

export async function findShoppingItemsByFuzzyQuery(
  db: TypedSupabaseClient,
  query: string,
  includeChecked = true
): Promise<FuzzyFinanceMatch<ShoppingListItem>[]> {
  const items = await listShoppingItems(db, includeChecked);
  const normQ = normalizeIngredientKey(query);
  if (!normQ) return [];
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<ShoppingListItem>[] = [];

  for (const item of items) {
    const hay = `${item.ingredient_key ?? ""} ${normalizeIngredientKey(item.display_name)}`;
    let score = 0;
    if (normalizeIngredientKey(item.display_name) === normQ || item.ingredient_key === normQ) {
      score = 1.0;
    } else if (hay.includes(normQ)) {
      score = 0.9;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.8;
    }
    if (score >= 0.4) scored.push({ item, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export async function clearCheckedShoppingItems(
  db: TypedSupabaseClient,
  options: { moveToPantry?: boolean } = {}
): Promise<{ clearedCount: number; movedToPantryCount: number }> {
  const { data: checkedItems, error: selErr } = await db
    .from("shopping_list_items")
    .select("*")
    .eq("is_checked", true);
  if (selErr) throw selErr;

  const rows = checkedItems ?? [];
  if (rows.length === 0) return { clearedCount: 0, movedToPantryCount: 0 };

  let moved = 0;
  if (options.moveToPantry) {
    const currentPantry = await listPantryItems(db);
    for (const row of rows) {
      const key = row.ingredient_key || normalizeIngredientKey(row.display_name);
      const unit = normalizeIngredientUnit(row.unit);
      const existing = currentPantry.find(
        (p) => p.ingredient_key === key && p.unit === unit
      );
      if (existing) {
        await updatePantryItem(db, existing.id, {
          quantity_on_hand: roundQty(
            Number(existing.quantity_on_hand) + Number(row.quantity_needed)
          ),
        });
      } else {
        await upsertPantryItem(db, {
          user_id: row.user_id,
          display_name: row.display_name,
          ingredient_key: key,
          quantity_on_hand: roundQty(Number(row.quantity_needed)),
          unit,
          aisle_group: row.aisle_group || "Прочее",
        });
      }
      moved += 1;
    }
  }

  const ids = rows.map((r) => r.id);
  const { error: delErr } = await db
    .from("shopping_list_items")
    .delete()
    .in("id", ids);
  if (delErr) throw delErr;

  return { clearedCount: rows.length, movedToPantryCount: moved };
}

/**
 * Generates or refreshes shopping list items for planned meals in `[startDate, endDate]`,
 * subtracting `pantry_items.quantity_on_hand` (with g/kg and ml/l unit normalization!).
 */
export async function generateShoppingListFromMealPlan(
  db: TypedSupabaseClient,
  params: {
    startDate: string;
    endDate: string;
    replaceUncheckedMealPlanItems?: boolean;
  }
): Promise<{
  items: ShoppingListItem[];
  coveredByPantryCount: number;
  partiallySubtractedCount: number;
}> {
  const [entries, pantry] = await Promise.all([
    listMealPlanEntries(db, { startDate: params.startDate, endDate: params.endDate }),
    listPantryItems(db),
  ]);

  const planned = entries.filter((e) => e.status === "planned" && e.recipe);
  const profile = await getOwnerProfile(db);
  const userId = planned[0]?.user_id ?? pantry[0]?.user_id ?? profile?.id;
  if (!userId) {
    return { items: [], coveredByPantryCount: 0, partiallySubtractedCount: 0 };
  }

  // Aggregate required amounts per (ingredient_key + canonicalUnit)
  const requiredMap = new Map<
    string,
    {
      ingredient_key: string;
      display_name: string;
      canonicalUnit: IngredientUnit;
      preferredDisplayUnit: IngredientUnit;
      requiredCanonical: number;
      aisle_group: string;
    }
  >();

  for (const mp of planned) {
    const recipe = mp.recipe!;
    const scale =
      Number(mp.planned_servings) / Math.max(1, Number(recipe.default_servings));
    for (const ing of recipe.ingredients) {
      if (ing.is_optional) continue;
      const normKey = ing.ingredient_key || normalizeIngredientKey(ing.display_name);
      const rawUnit = normalizeIngredientUnit(ing.unit);
      const scaled = Number(ing.amount) * scale;
      const { canonicalUnit, canonicalAmount } = toCanonicalUnitAmount(scaled, rawUnit);
      const mapKey = `${normKey}::${canonicalUnit}`;

      const prev = requiredMap.get(mapKey);
      if (prev) {
        prev.requiredCanonical = roundQty(prev.requiredCanonical + canonicalAmount);
      } else {
        requiredMap.set(mapKey, {
          ingredient_key: normKey,
          display_name: ing.display_name,
          canonicalUnit,
          preferredDisplayUnit: rawUnit,
          requiredCanonical: canonicalAmount,
          aisle_group: ing.aisle_group || "Прочее",
        });
      }
    }
  }

  // Aggregate pantry stock per (ingredient_key + canonicalUnit)
  const pantryStockMap = new Map<string, number>();
  for (const p of pantry) {
    const normKey = p.ingredient_key || normalizeIngredientKey(p.display_name);
    const { canonicalUnit, canonicalAmount } = toCanonicalUnitAmount(
      Number(p.quantity_on_hand),
      normalizeIngredientUnit(p.unit)
    );
    const mapKey = `${normKey}::${canonicalUnit}`;
    pantryStockMap.set(mapKey, roundQty((pantryStockMap.get(mapKey) ?? 0) + canonicalAmount));
  }

  if (params.replaceUncheckedMealPlanItems !== false) {
    const { error: cleanErr } = await db
      .from("shopping_list_items")
      .delete()
      .eq("user_id", userId)
      .eq("added_from", "meal_plan")
      .eq("is_checked", false);
    if (cleanErr) throw cleanErr;
  }

  let coveredByPantryCount = 0;
  let partiallySubtractedCount = 0;
  const toInsert: ShoppingListItemInsert[] = [];

  for (const [mapKey, req] of requiredMap.entries()) {
    const onHandCanon = pantryStockMap.get(mapKey) ?? 0;
    const missingCanon = roundQty(req.requiredCanonical - onHandCanon);
    if (missingCanon <= 0.009) {
      coveredByPantryCount += 1;
      continue;
    }
    if (onHandCanon > 0) {
      partiallySubtractedCount += 1;
    }
    const displayQty = fromCanonicalToTargetUnit(
      missingCanon,
      req.canonicalUnit,
      req.preferredDisplayUnit
    );
    toInsert.push({
      user_id: userId,
      ingredient_key: req.ingredient_key,
      display_name: req.display_name,
      quantity_needed: Math.max(0.01, displayQty),
      unit: req.preferredDisplayUnit,
      aisle_group: req.aisle_group,
      is_checked: false,
      added_from: "meal_plan",
    });
  }

  let inserted: ShoppingListItem[] = [];
  if (toInsert.length > 0) {
    const { data, error } = await db
      .from("shopping_list_items")
      .insert(toInsert)
      .select("*");
    if (error) throw error;
    inserted = data ?? [];
  }

  return {
    items: inserted,
    coveredByPantryCount,
    partiallySubtractedCount,
  };
}

// ============================================================================
// Open Food Facts (Feature-Flagged Calorie Tracker & Completeness Lab)
// ============================================================================

function parseNumberOrNull(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) ? roundQty(num) : null;
}

function parseOffNutriments(code: string, product: Record<string, unknown>): OffParsedProduct {
  const nutriments = (product.nutriments ?? {}) as Record<string, unknown>;
  const kcal =
    parseNumberOrNull(nutriments["energy-kcal_100g"]) ??
    parseNumberOrNull(nutriments["energy-kcal"]) ??
    (parseNumberOrNull(nutriments["energy-kj_100g"]) !== null
      ? roundQty(Number(nutriments["energy-kj_100g"]) / 4.184)
      : null);
  const protein = parseNumberOrNull(nutriments.proteins_100g);
  const fat = parseNumberOrNull(nutriments.fat_100g);
  const carbs = parseNumberOrNull(nutriments.carbohydrates_100g);

  const name =
    String(product.product_name_ru || product.product_name || "").trim() || null;
  const brands = String(product.brands || "").trim() || null;
  const quantity = String(product.quantity || "").trim() || null;
  const hasCompleteMacros =
    Boolean(name) && kcal !== null && protein !== null && fat !== null && carbs !== null;

  return {
    barcode: code,
    found: true,
    product_name: name,
    brands,
    quantity,
    has_complete_macros: hasCompleteMacros,
    kcal_100g: kcal,
    protein_100g: protein,
    fat_100g: fat,
    carbs_100g: carbs,
    raw: {
      code,
      product_name: name,
      brands,
      quantity,
      nutriments: {
        "energy-kcal_100g": kcal,
        proteins_100g: protein,
        fat_100g: fat,
        carbohydrates_100g: carbs,
      },
    },
  };
}

export async function lookupOpenFoodFactsBarcode(
  barcode: string
): Promise<OffParsedProduct> {
  const cleanCode = barcode.replace(/[^\d]/g, "");
  if (!cleanCode) {
    return {
      barcode,
      found: false,
      product_name: null,
      brands: null,
      quantity: null,
      has_complete_macros: false,
      kcal_100g: null,
      protein_100g: null,
      fat_100g: null,
      carbs_100g: null,
      raw: null,
    };
  }

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    cleanCode
  )}?fields=code,product_name,product_name_ru,brands,quantity,nutriments`;

  const res = await fetch(url, {
    headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) {
    return {
      barcode: cleanCode,
      found: false,
      product_name: null,
      brands: null,
      quantity: null,
      has_complete_macros: false,
      kcal_100g: null,
      protein_100g: null,
      fat_100g: null,
      carbs_100g: null,
      raw: { http_status: res.status },
    };
  }

  const json = (await res.json()) as {
    status?: number;
    product?: Record<string, unknown>;
  };

  if (json.status !== 1 || !json.product) {
    return {
      barcode: cleanCode,
      found: false,
      product_name: null,
      brands: null,
      quantity: null,
      has_complete_macros: false,
      kcal_100g: null,
      protein_100g: null,
      fat_100g: null,
      carbs_100g: null,
      raw: { status: json.status ?? 0 },
    };
  }

  return parseOffNutriments(cleanCode, json.product);
}

export async function searchOpenFoodFactsProducts(
  query: string,
  pageSize = 8
): Promise<OffParsedProduct[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=${Math.min(20, Math.max(1, pageSize))}` +
    `&fields=code,product_name,product_name_ru,brands,quantity,nutriments`;

  const res = await fetch(url, {
    headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { products?: Record<string, unknown>[] };
  return (json.products ?? [])
    .filter((p) => p && p.code)
    .map((p) => parseOffNutriments(String(p.code), p));
}

export async function evaluateAndSaveOffProduct(
  db: TypedSupabaseClient,
  userId: string,
  barcode: string,
  queryNote?: string | null
): Promise<OffProductEvaluation> {
  const parsed = await lookupOpenFoodFactsBarcode(barcode);
  const cleanCode = parsed.barcode || barcode.trim();

  const { data, error } = await db
    .from("off_product_evaluations")
    .upsert(
      {
        user_id: userId,
        barcode: cleanCode,
        query_note: queryNote ?? null,
        found_in_off: parsed.found,
        product_name: parsed.product_name,
        brands: parsed.brands,
        has_complete_macros: parsed.has_complete_macros,
        kcal_100g: parsed.kcal_100g,
        protein_100g: parsed.protein_100g,
        fat_100g: parsed.fat_100g,
        carbs_100g: parsed.carbs_100g,
        raw_off_response: (parsed.raw ?? null) as Json,
        tested_at: new Date().toISOString(),
      },
      { onConflict: "user_id,barcode" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listOffEvaluations(
  db: TypedSupabaseClient,
  limit = 50
): Promise<OffProductEvaluation[]> {
  const { data, error } = await db
    .from("off_product_evaluations")
    .select("*")
    .order("tested_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getOffCompletenessStats(
  db: TypedSupabaseClient
): Promise<OffCompletenessStats> {
  const evals = await listOffEvaluations(db, 200);
  const total = evals.length;
  if (total === 0) {
    return {
      total_tested: 0,
      found_count: 0,
      complete_macros_count: 0,
      found_rate_percent: 0,
      complete_macros_rate_percent: 0,
      recommendation: "insufficient_data",
    };
  }

  const found = evals.filter((e) => e.found_in_off).length;
  const complete = evals.filter((e) => e.has_complete_macros).length;
  const foundRate = Math.round((found / total) * 100);
  const completeRate = Math.round((complete / total) * 100);

  return {
    total_tested: total,
    found_count: found,
    complete_macros_count: complete,
    found_rate_percent: foundRate,
    complete_macros_rate_percent: completeRate,
    recommendation: completeRate >= 70 ? "recommended" : "partial",
  };
}

export async function setCaloriesFeatureFlag(
  db: TypedSupabaseClient,
  userId: string,
  enabled: boolean
): Promise<UserProfile> {
  const profile = await getOwnerProfile(db);
  const currentFlags =
    profile?.feature_flags && typeof profile.feature_flags === "object"
      ? (profile.feature_flags as Record<string, unknown>)
      : {};

  return updateOwnerProfile(db, userId, {
    feature_flags: {
      ...currentFlags,
      enable_calories_off: enabled,
    } as Json,
  });
}

export async function listCalorieLogs(
  db: TypedSupabaseClient,
  dateStr: string
): Promise<CalorieLog[]> {
  const { data, error } = await db
    .from("calorie_logs")
    .select("*")
    .eq("logged_date", dateStr)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createCalorieLog(
  db: TypedSupabaseClient,
  input: CalorieLogInsert
): Promise<CalorieLog> {
  const { data, error } = await db
    .from("calorie_logs")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCalorieLog(
  db: TypedSupabaseClient,
  id: number,
  patch: CalorieLogUpdate
): Promise<CalorieLog> {
  const { data, error } = await db
    .from("calorie_logs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCalorieLog(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("calorie_logs").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Composite Nutrition Dashboard Loader
// ============================================================================

export interface NutritionDashboardData {
  profile: UserProfile | null;
  caloriesEnabled: boolean;
  todayDate: string;
  weekStart: string;
  weekEnd: string;
  weekDates: string[];
  recipes: RecipeWithIngredients[];
  weekMealPlan: MealPlanEntryWithRecipe[];
  pantryItems: PantryItem[];
  shoppingItems: ShoppingListItem[];
  todayCalorieLogs: CalorieLog[];
  offEvaluations: OffProductEvaluation[];
  offStats: OffCompletenessStats;
}

export async function getNutritionDashboardData(
  db: TypedSupabaseClient,
  options: { anchorDate?: string; timeZone?: string } = {}
): Promise<NutritionDashboardData> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const todayDate = formatIsoDate(new Date(), tz);
  const anchorDate = options.anchorDate ?? todayDate;
  const { weekStart, weekEnd, dates } = getWeekBoundsIso(anchorDate);

  const [
    profile,
    recipes,
    weekMealPlan,
    pantryItems,
    shoppingItems,
    todayCalorieLogs,
    offEvaluations,
    offStats,
  ] = await Promise.all([
    getOwnerProfile(db),
    listRecipes(db),
    listMealPlanEntries(db, { startDate: weekStart, endDate: weekEnd }),
    listPantryItems(db),
    listShoppingItems(db, true),
    listCalorieLogs(db, anchorDate),
    listOffEvaluations(db, 30),
    getOffCompletenessStats(db),
  ]);

  const flags =
    profile?.feature_flags && typeof profile.feature_flags === "object"
      ? (profile.feature_flags as Record<string, unknown>)
      : {};

  return {
    profile,
    caloriesEnabled: Boolean(flags.enable_calories_off),
    todayDate,
    weekStart,
    weekEnd,
    weekDates: dates,
    recipes,
    weekMealPlan,
    pantryItems,
    shoppingItems,
    todayCalorieLogs,
    offEvaluations,
    offStats,
  };
}
