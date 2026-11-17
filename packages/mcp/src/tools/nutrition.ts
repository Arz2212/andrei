import fs from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addDaysToIsoDate,
  addShoppingItemsBatch,
  adjustPantryQuantity,
  cacheFoodDictionaryItem,
  calculateNutritionTargetsWithAi,
  calculatePortionMacros,
  clearCheckedShoppingItems,
  createMealPlanEntry,
  createRecipeWithIngredients,
  decodeBarcodeFromImageBuffer,
  deleteBodyWeightLog,
  deleteCalorieLog,
  deleteMealPlanEntry,
  deletePantryItem,
  deleteRecipe,
  deleteShoppingItem,
  evaluateAndSaveOffProduct,
  findCalorieLogsByFuzzyQuery,
  findPantryItemByFuzzyQuery,
  findShoppingItemsByFuzzyQuery,
  formatIsoDate,
  generateShoppingListFromMealPlan,
  getDayFoodDiary,
  getLatestBodyWeight,
  getNutritionAndWeightAnalytics,
  getNutritionDashboardData,
  getNutritionTargets,
  getOffCompletenessStats,
  getOwnerBotDbClient,
  getOwnerProfile,
  getRecipeWithIngredients,
  getWeekBoundsIso,
  listBodyWeightLogs,
  listMealPlanEntries,
  listOffEvaluations,
  listPantryItems,
  listRecipes,
  listShoppingItems,
  logFoodDiaryEntry,
  lookupBarcodeWithAutoCache,
  lookupOpenFoodFactsBarcode,
  markMealCookedOrEaten,
  normalizeIngredientKey,
  normalizeIngredientUnit,
  normalizeTaskTitleForDedup,
  recalculateAllRecipesMacros,
  resolveRecipeByFuzzyQuery,
  searchFoodNutritionWithAutoLookup,
  searchOpenFoodFactsProducts,
  setCaloriesFeatureFlag,
  toggleShoppingItemChecked,
  updateCalorieLog,
  updateMealPlanEntry,
  updatePantryItem,
  updateRecipeWithIngredients,
  upsertBodyWeightLog,
  upsertNutritionTargets,
  upsertPantryItem,
  type BodyWeightLog,
  type CalorieLog,
  type CalorieLogSource,
  type CalorieLogUpdate,
  type DiaryMealSlot,
  type FoodDictionaryItem,
  type IngredientUnit,
  type MealCategory,
  type MealPlanEntryUpdate,
  type MealPlanEntryWithRecipe,
  type MealPlanStatus,
  type MealSlot,
  type NutritionConfiguredVia,
  type NutritionGoalMode,
  type NutritionSex,
  type PantryItem,
  type PantryItemUpdate,
  type RecipeIngredientDraft,
  type RecipeUpdate,
  type RecipeWithIngredients,
  type ShoppingListItem,
  type TypedSupabaseClient,
} from "@life-os/db";
import { DEFAULT_TIMEZONE, errResult, okResult, resolveDateInput } from "../helpers";

const FlexibleIngredientUnitSchema = z
  .string()
  .max(30)
  .describe("Единица измерения: g/г, kg/кг, ml/мл, l/л, pcs/шт, tbsp/ст.л., tsp/ч.л., pack/уп");

const RecipeIngredientDraftSchema = z.object({
  display_name: z.string().min(1).max(200).describe("Название ингредиента (например, 'Куриная грудка филе')"),
  ingredient_key: z.string().max(200).optional().describe("Опциональный нормализованный ключ сопоставления с запасами"),
  amount: z.number().positive().describe("Количество ингредиента (> 0)"),
  unit: FlexibleIngredientUnitSchema.optional().describe("Единица измерения (по умолчанию 'g')"),
  aisle_group: z
    .string()
    .max(100)
    .optional()
    .describe("Отдел магазина (определяется автоматически, если не указан)"),
  is_optional: z.boolean().optional().describe("Опциональный ингредиент"),
  grams_equivalent: z.number().positive().nullable().optional().describe("Явный вес ингредиента в граммах (опционально)"),
  kcal_100g: z.number().min(0).nullable().optional().describe("Ккал на 100 г (автоматически подтягивается из открытой базы продуктов, если не указано)"),
  protein_100g: z.number().min(0).nullable().optional().describe("Белки на 100 г (автоподбор, если не указано)"),
  fat_100g: z.number().min(0).nullable().optional().describe("Жиры на 100 г (автоподбор, если не указано)"),
  carbs_100g: z.number().min(0).nullable().optional().describe("Углеводы на 100 г (автоподбор, если не указано)"),
});

const ShoppingBatchItemInputSchema = z.union([
  z.string().min(1).max(250),
  z.object({
    display_name: z.string().min(1).max(250).describe("Название продукта"),
    quantity_needed: z.number().positive().optional().describe("Количество (по умолчанию 1)"),
    unit: FlexibleIngredientUnitSchema.optional().describe("Единица измерения (pcs/шт, g/г, kg/кг, ml/мл, l/л, pack/уп)"),
    aisle_group: z.string().max(100).optional().describe("Отдел магазина (определяется автоматически, если не указан)"),
  }),
]);

const DiaryFoodBatchItemSchema = z.union([
  z.string().min(1).max(250),
  z.object({
    title: z.string().min(1).max(250).describe("Название продукта или блюда (например, 'Творог 5%', 'Жареная курица')"),
    grams: z.number().positive().max(5000).optional().describe("Вес порции в граммах"),
    servings: z.number().positive().max(30).optional().describe("Количество порций (если добавляется рецепт)"),
    meal_slot: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
    barcode: z.string().max(40).optional(),
    kcal: z.number().min(0).max(10000).optional(),
    protein_g: z.number().min(0).max(1000).optional(),
    fat_g: z.number().min(0).max(1000).optional(),
    carbs_g: z.number().min(0).max(1000).optional(),
    fiber_g: z.number().min(0).max(500).optional(),
  }),
]);

const PhotoEstimatedFoodItemSchema = z.object({
  query: z.string().min(1).max(250).describe("Распознанное название блюда или ингредиента на тарелке (например, 'Куриная грудка жареная', 'Рис отварной')"),
  grams: z.number().positive().max(5000).optional().describe("Оценённый вес на тарелке в граммах (например, 180)"),
  kcal: z.number().min(0).max(10000).optional().describe("Явная оценка ккал (если не передано — рассчитывается автоматически по 3-уровневой базе на основе grams!)"),
  protein_g: z.number().min(0).max(1000).optional(),
  fat_g: z.number().min(0).max(1000).optional(),
  carbs_g: z.number().min(0).max(1000).optional(),
});

function inferAisleGroup(name: string): string {
  const norm = name.toLowerCase().replace(/ё/g, "е");
  if (/(молок|кефир|йогурт|творог|сыр|сливк|сметан|масло сливоч|яйц)/u.test(norm)) {
    return "Молочное и яйца";
  }
  if (/(куриц|курин|индейк|говяд|свинин|фарш|лосос|семг|рыб|форел|кревет|тунец|ветчин|бекон)/u.test(norm)) {
    return "Мясо и рыба";
  }
  if (/(яблок|банан|авокад|помидор|томат|огур|броккол|салат|шпинат|зелен|лук|чеснок|морков|картоф|перец|лимон|ягод|голуб|клубник)/u.test(norm)) {
    return "Овощи и фрукты";
  }
  if (/(рис|гречк|овсян|киноа|паст|макарон|мук|сахар|соль|круп|чечевиц|нут|фасол|масло оливк|масло подсолн|орех|миндал)/u.test(norm)) {
    return "Бакалея";
  }
  if (/(хлеб|багет|лаваш|булоч|тост|тортиль)/u.test(norm)) {
    return "Хлеб и выпечка";
  }
  if (/(заморож|пельмен|морожен)/u.test(norm)) {
    return "Заморозка";
  }
  if (/(вод|сок|кофе|чай|минерал|лимонад)/u.test(norm)) {
    return "Напитки";
  }
  if (/(соус|соев|горчиц|специ|перец черн|куркум|паприк|уксус|майонез|кетчуп)/u.test(norm)) {
    return "Специи и соусы";
  }
  return "Прочее";
}

function inferMealCategoryFromTitle(title: string): MealCategory {
  const norm = title.toLowerCase().replace(/ё/g, "е");
  if (/(овсян|омлет|сырник|каша|завтрак|яичниц|скрэмбл|тост)/u.test(norm)) return "breakfast";
  if (/(впрок|заготов|боул на недел|запеканк)/u.test(norm)) return "batch_prep";
  if (/(перекус|смузи|батончик|протеин)/u.test(norm)) return "snack";
  if (/(ужин|лосос|стейк|запечен)/u.test(norm)) return "dinner";
  return "lunch";
}

function inferMealSlotFromCategory(cat?: string | null): MealSlot {
  if (cat === "breakfast") return "breakfast";
  if (cat === "dinner") return "dinner";
  if (cat === "snack") return "snack";
  if (cat === "batch_prep") return "cook_ahead";
  return "lunch";
}

function inferDiarySlotFromText(text?: string | null): DiaryMealSlot | null {
  if (!text) return null;
  const norm = text.toLowerCase().replace(/ё/g, "е");
  if (/(на завтрак|завтрак)/u.test(norm)) return "breakfast";
  if (/(на обед|обед)/u.test(norm)) return "lunch";
  if (/(на ужин|ужин)/u.test(norm)) return "dinner";
  if (/(на перекус|перекус)/u.test(norm)) return "snack";
  return null;
}

/**
 * Extracts `{ query, grams }` from natural Russian food strings like:
 * - "200 г творога 5%" -> { query: "творога 5%", grams: 200 }
 * - "куриная грудка жареная 180 г" -> { query: "куриная грудка жареная", grams: 180 }
 * - "банан" -> { query: "банан", grams: undefined }
 */
function parseNaturalFoodPortionToken(raw: string): {
  query: string;
  grams?: number;
} | null {
  let cleaned = raw
    .replace(/^[•\-*\s]+/, "")
    .replace(/^(съел[а]?|выпил[а]?|добавь|запиши)\s+/iu, "")
    .replace(/\s+на\s+(завтрак|обед|ужин|перекус)\s*$/iu, "")
    .trim();
  if (!cleaned) return null;

  // Leading weight: "200 г творога 5%", "150 мл молока 2.5%"
  const leadingMatch = /^(\d+(?:[.,]\d+)?)\s*(г|гр|грамм[аов]?|мл|кг|л)\s+(.+)$/iu.exec(cleaned);
  if (leadingMatch) {
    const num = Number(leadingMatch[1].replace(",", "."));
    const u = leadingMatch[2].toLowerCase();
    const mult = u === "кг" || u === "л" ? 1000 : 1;
    const name = leadingMatch[3].trim();
    if (name && Number.isFinite(num) && num > 0) {
      return { query: name, grams: Math.round(num * mult * 10) / 10 };
    }
  }

  // Trailing weight: "творог 5% 200 г", "рис вареный 150г"
  const trailingMatch = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(г|гр|грамм[аов]?|мл|кг|л)$/iu.exec(cleaned);
  if (trailingMatch) {
    const name = trailingMatch[1].trim();
    const num = Number(trailingMatch[2].replace(",", "."));
    const u = trailingMatch[3].toLowerCase();
    const mult = u === "кг" || u === "л" ? 1000 : 1;
    if (name && Number.isFinite(num) && num > 0) {
      return { query: name, grams: Math.round(num * mult * 10) / 10 };
    }
  }

  return { query: cleaned };
}

function splitNaturalFoodPhrase(phrase: string): Array<{ query: string; grams?: number }> {
  const parts = phrase
    .split(/[,;\n]+|\s+и\s+|\s+\+\s+/iu)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Array<{ query: string; grams?: number }> = [];
  for (const part of parts) {
    const parsed = parseNaturalFoodPortionToken(part);
    if (parsed && parsed.query) out.push(parsed);
  }
  return out;
}

function parseSingleShoppingToken(raw: string): {
  display_name: string;
  quantity_needed: number;
  unit: IngredientUnit;
  aisle_group: string;
} | null {
  const cleaned = raw.replace(/^[•\-*\s]+/, "").trim();
  if (!cleaned) return null;

  const trailingMatch =
    /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(г|гр|грамм|кг|мл|л|литр|шт|штук|уп|упак|пачк[аи]?|ст\.?\s*л\.?|ч\.?\s*л\.?|g|kg|ml|l|pcs|pack|tbsp|tsp)?$/iu.exec(
      cleaned
    );
  if (trailingMatch) {
    const name = trailingMatch[1].trim();
    const qty = Number(trailingMatch[2].replace(",", "."));
    const rawUnit = trailingMatch[3] ?? "pcs";
    if (name && Number.isFinite(qty) && qty > 0) {
      return {
        display_name: name.charAt(0).toUpperCase() + name.slice(1),
        quantity_needed: qty,
        unit: normalizeIngredientUnit(rawUnit),
        aisle_group: inferAisleGroup(name),
      };
    }
  }

  return {
    display_name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
    quantity_needed: 1,
    unit: "pcs",
    aisle_group: inferAisleGroup(cleaned),
  };
}

function parseShoppingPhraseToDrafts(phrase: string): Array<{
  display_name: string;
  quantity_needed: number;
  unit: IngredientUnit;
  aisle_group: string;
}> {
  const stripped = phrase
    .replace(/^(купить|добавь в покупки|добавить в список покупок|нужно купить)\s+/iu, "")
    .trim();
  if (!stripped) return [];

  const parts = stripped
    .split(/[,;\n]+|\s+и\s+/iu)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Array<{
    display_name: string;
    quantity_needed: number;
    unit: IngredientUnit;
    aisle_group: string;
  }> = [];
  for (const part of parts) {
    const parsed = parseSingleShoppingToken(part);
    if (parsed) out.push(parsed);
  }
  return out;
}

function formatRecipeForMcp(recipe: RecipeWithIngredients) {
  return {
    id: recipe.id,
    title: recipe.title,
    meal_category: recipe.meal_category,
    default_servings: Number(recipe.default_servings),
    cook_time_minutes: recipe.cook_time_minutes,
    is_favorite: recipe.is_favorite,
    tags: recipe.tags ?? [],
    steps_markdown: recipe.steps_markdown,
    macros: {
      total_weight_g: recipe.total_weight_g !== null ? Number(recipe.total_weight_g) : null,
      total_kcal: recipe.total_kcal !== null ? Number(recipe.total_kcal) : null,
      total_protein_g: recipe.total_protein_g !== null ? Number(recipe.total_protein_g) : null,
      total_fat_g: recipe.total_fat_g !== null ? Number(recipe.total_fat_g) : null,
      total_carbs_g: recipe.total_carbs_g !== null ? Number(recipe.total_carbs_g) : null,
      kcal_per_serving: recipe.kcal_per_serving !== null ? Number(recipe.kcal_per_serving) : null,
      protein_g: recipe.protein_g !== null ? Number(recipe.protein_g) : null,
      fat_g: recipe.fat_g !== null ? Number(recipe.fat_g) : null,
      carbs_g: recipe.carbs_g !== null ? Number(recipe.carbs_g) : null,
      kcal_per_100g: recipe.kcal_per_100g !== null ? Number(recipe.kcal_per_100g) : null,
    },
    kcal_per_serving: recipe.kcal_per_serving !== null ? Number(recipe.kcal_per_serving) : null,
    protein_g: recipe.protein_g !== null ? Number(recipe.protein_g) : null,
    fat_g: recipe.fat_g !== null ? Number(recipe.fat_g) : null,
    carbs_g: recipe.carbs_g !== null ? Number(recipe.carbs_g) : null,
    kcal_per_100g: recipe.kcal_per_100g !== null ? Number(recipe.kcal_per_100g) : null,
    ingredients: recipe.ingredients.map((ing) => ({
      id: ing.id,
      display_name: ing.display_name,
      ingredient_key: ing.ingredient_key,
      amount: Number(ing.amount),
      unit: ing.unit,
      grams_equivalent: ing.grams_equivalent !== null ? Number(ing.grams_equivalent) : null,
      kcal_100g: ing.kcal_100g !== null ? Number(ing.kcal_100g) : null,
      protein_100g: ing.protein_100g !== null ? Number(ing.protein_100g) : null,
      fat_100g: ing.fat_100g !== null ? Number(ing.fat_100g) : null,
      carbs_100g: ing.carbs_100g !== null ? Number(ing.carbs_100g) : null,
      aisle_group: ing.aisle_group,
      is_optional: ing.is_optional,
    })),
  };
}

function formatMealPlanEntryForMcp(entry: MealPlanEntryWithRecipe) {
  const title = entry.recipe?.title ?? entry.custom_meal_title ?? "Блюдо без названия";
  const servings = Number(entry.planned_servings);

  return {
    id: entry.id,
    plan_date: entry.plan_date,
    meal_slot: entry.meal_slot,
    status: entry.status,
    planned_servings: servings,
    recipe_id: entry.recipe_id,
    title,
    custom_meal_title: entry.custom_meal_title,
    notes: entry.notes,
    ...(entry.recipe && entry.recipe.kcal_per_serving !== null
      ? {
          estimated_kcal: Math.round(Number(entry.recipe.kcal_per_serving) * servings),
          estimated_protein_g:
            entry.recipe.protein_g !== null
              ? Number((Number(entry.recipe.protein_g) * servings).toFixed(1))
              : null,
          estimated_fat_g:
            entry.recipe.fat_g !== null
              ? Number((Number(entry.recipe.fat_g) * servings).toFixed(1))
              : null,
          estimated_carbs_g:
            entry.recipe.carbs_g !== null
              ? Number((Number(entry.recipe.carbs_g) * servings).toFixed(1))
              : null,
        }
      : {}),
  };
}

function formatFoodDictionaryItemWithPortion(item: FoodDictionaryItem, grams?: number) {
  const effectiveGrams =
    grams !== undefined && Number(grams) > 0
      ? Number(grams)
      : Number(item.default_portion_g || 100);
  const portion = calculatePortionMacros(item, effectiveGrams);
  return {
    id: item.id,
    display_name: item.display_name,
    brand: item.brand,
    barcode: item.barcode,
    source: item.source,
    default_portion_g: Number(item.default_portion_g),
    per_100g: {
      kcal: Number(item.kcal_100g),
      protein_g: Number(item.protein_100g),
      fat_g: Number(item.fat_100g),
      carbs_g: Number(item.carbs_100g),
      fiber_g: item.fiber_100g !== null ? Number(item.fiber_100g) : 0,
    },
    portion,
  };
}

function groupShoppingByAisle(items: ShoppingListItem[]): Record<string, ShoppingListItem[]> {
  const grouped: Record<string, ShoppingListItem[]> = {};
  for (const item of items) {
    const group = item.aisle_group || "Прочее";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(item);
  }
  return grouped;
}

async function loadImageBytesFromSource(params: {
  image_path?: string;
  image_base64?: string;
  image_url?: string;
}): Promise<Uint8Array> {
  if (params.image_path?.trim()) {
    const buf = await fs.readFile(params.image_path.trim());
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  if (params.image_base64?.trim()) {
    const raw = params.image_base64.trim();
    const commaIdx = raw.indexOf(",");
    const base64Clean = raw.startsWith("data:") && commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw;
    const buf = Buffer.from(base64Clean, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  if (params.image_url?.trim()) {
    const res = await fetch(params.image_url.trim(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Не удалось загрузить изображение по URL (HTTP ${res.status})`);
    }
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }

  throw new Error("Не передан источник изображения (`image_path`, `image_base64` или `image_url`).");
}

async function resolveMealPlanTarget(
  db: TypedSupabaseClient,
  params: {
    entry_id?: number;
    query?: string;
    plan_date?: string;
    meal_slot?: MealSlot;
  }
): Promise<{
  entry?: MealPlanEntryWithRecipe;
  candidates?: Array<{
    id: number;
    plan_date: string;
    meal_slot: string;
    title: string;
    status: string;
    score: number;
  }>;
  error?: string;
}> {
  const today = formatIsoDate();
  const resolvedDate = resolveDateInput(params.plan_date);
  const bounds = getWeekBoundsIso(resolvedDate ?? today);
  const startDate = resolvedDate ?? addDaysToIsoDate(bounds.weekStart, -7);
  const endDate = resolvedDate ?? addDaysToIsoDate(bounds.weekEnd, 7);

  const entries = await listMealPlanEntries(db, { startDate, endDate });
  if (params.entry_id) {
    const direct = entries.find((e) => e.id === params.entry_id);
    if (direct) return { entry: direct };
    const { data, error } = await db
      .from("meal_plan_entries")
      .select("*")
      .eq("id", params.entry_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: `Запись меню #${params.entry_id} не найдена.` };
    const rec = data.recipe_id ? await getRecipeWithIngredients(db, data.recipe_id) : null;
    return { entry: { ...data, recipe: rec } };
  }

  let pool = entries;
  if (resolvedDate) {
    pool = pool.filter((e) => e.plan_date === resolvedDate);
  }
  if (params.meal_slot) {
    pool = pool.filter((e) => e.meal_slot === params.meal_slot);
  }

  if (pool.length === 0) {
    return {
      error: "Подходящая запись в плане меню не найдена. Вызови manage_meal_plan(action='list') или get_nutrition_overview.",
    };
  }

  const q = params.query?.trim();
  if (!q) {
    if (pool.length === 1) return { entry: pool[0] };
    const plannedPool = pool.filter((e) => e.status === "planned");
    if (plannedPool.length === 1) return { entry: plannedPool[0] };
    return {
      candidates: pool.slice(0, 6).map((e) => ({
        id: e.id,
        plan_date: e.plan_date,
        meal_slot: e.meal_slot,
        title: e.recipe?.title ?? e.custom_meal_title ?? "Блюдо",
        status: e.status,
        score: 0.8,
      })),
    };
  }

  const normQ = normalizeTaskTitleForDedup(q);
  const scored = pool
    .map((e) => {
      const title = e.recipe?.title ?? e.custom_meal_title ?? "";
      const hay = normalizeTaskTitleForDedup(`${title} ${e.meal_slot} ${e.notes ?? ""}`);
      let score = 0;
      if (normalizeTaskTitleForDedup(title) === normQ) score = 1.0;
      else if (
        hay.includes(normQ) ||
        (normQ.length >= 4 && normQ.includes(normalizeTaskTitleForDedup(title)))
      ) {
        score = 0.92;
      } else {
        const words = normQ.split(" ").filter((w) => w.length >= 2);
        if (words.length > 0) {
          let hits = 0;
          for (const w of words) {
            if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
          }
          score = (hits / words.length) * 0.82;
        }
      }
      if (e.status === "planned" && score >= 0.4) {
        score = Math.min(1, score + 0.03);
      }
      return { entry: e, score: Number(score.toFixed(3)) };
    })
    .filter((m) => m.score >= 0.4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { error: `Блюдо «${q}» не найдено в плане меню.` };
  }
  if (scored.length === 1) {
    return { entry: scored[0].entry };
  }
  if (scored[0].score >= 0.88 && scored[0].score - scored[1].score >= 0.1) {
    return { entry: scored[0].entry };
  }

  return {
    candidates: scored.slice(0, 5).map((m) => ({
      id: m.entry.id,
      plan_date: m.entry.plan_date,
      meal_slot: m.entry.meal_slot,
      title: m.entry.recipe?.title ?? m.entry.custom_meal_title ?? "Блюдо",
      status: m.entry.status,
      score: m.score,
    })),
  };
}

export function registerNutritionTools(server: McpServer): void {
  // ==========================================================================
  // 1. NUTRITION OVERVIEW (DAY DIARY + TARGETS + MEAL PLAN + SHOPPING + PANTRY + WEIGHT)
  // ==========================================================================

  server.registerTool(
    "get_nutrition_overview",
    {
      title: "Полный обзор питания: дневник КБЖУ за день, норма калорий, вес, меню недели, покупки и запасы",
      description:
        "Возвращает полную картину модуля «Питание» за выбранный день (anchor_date, по умолчанию сегодня по МСК): дневник питания по 4 приёмам пищи (Завтрак / Обед / Ужин / Перекус с ккал, Б/Ж/У и % от нормы), статус настройки индивидуальной нормы КБЖУ (targets), вес за день и 14-дневный тренд, план меню недели, список покупок по отделам и запасы дома.",
      inputSchema: {
        anchor_date: z
          .string()
          .optional()
          .describe("Опорная дата YYYY-MM-DD или today/yesterday/tomorrow (по умолчанию сегодня по МСК)"),
        date: z
          .string()
          .optional()
          .describe("Алиас для anchor_date (YYYY-MM-DD или today/yesterday)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const anchorDate =
          resolveDateInput(args.anchor_date ?? args.date) ??
          formatIsoDate(new Date(), DEFAULT_TIMEZONE);
        const dash = await getNutritionDashboardData(db, {
          anchorDate,
          timeZone: DEFAULT_TIMEZONE,
        });

        const uncheckedShopping = dash.shoppingItems.filter((i) => !i.is_checked);
        const checkedShoppingCount = dash.shoppingItems.length - uncheckedShopping.length;
        const expiryHorizon = addDaysToIsoDate(dash.todayDate, 5);

        const lowStockPantry = dash.pantryItems.filter(
          (p) =>
            Number(p.quantity_on_hand) <= 0 ||
            (p.low_stock_threshold !== null &&
              Number(p.quantity_on_hand) <= Number(p.low_stock_threshold))
        );
        const expiringPantry = dash.pantryItems.filter(
          (p) =>
            Boolean(p.expires_on) &&
            Number(p.quantity_on_hand) > 0 &&
            p.expires_on! <= expiryHorizon
        );

        const dayMeals = dash.weekMealPlan
          .filter((m) => m.plan_date === anchorDate)
          .map((m) => formatMealPlanEntryForMcp(m));

        return okResult({
          ok: true,
          anchor_date: anchorDate,
          today_date: dash.todayDate,
          week_start: dash.weekStart,
          week_end: dash.weekEnd,
          targets: dash.targets,
          day_diary: {
            date: dash.dayDiary.date,
            totals: dash.dayDiary.totals,
            meals: dash.dayDiary.meals,
            day_weight: dash.dayDiary.dayWeight,
            latest_weight: dash.dayDiary.latestWeight,
          },
          calories_summary: {
            date: anchorDate,
            is_target_configured: dash.targets.is_configured,
            kcal_target: dash.targets.kcal_target,
            total_kcal: dash.dayDiary.totals.kcal,
            remaining_kcal: dash.dayDiary.totals.remaining_kcal,
            pct_of_target: dash.dayDiary.totals.pct_of_target,
            total_protein_g: dash.dayDiary.totals.protein_g,
            protein_target_g: Number(dash.targets.protein_target_g),
            total_fat_g: dash.dayDiary.totals.fat_g,
            fat_target_g: Number(dash.targets.fat_target_g),
            total_carbs_g: dash.dayDiary.totals.carbs_g,
            carbs_target_g: Number(dash.targets.carbs_target_g),
            logged_count: dash.todayCalorieLogs.length,
          },
          analytics_14d_summary: {
            averages: dash.analytics14d.averages,
            weight_summary: dash.analytics14d.weight_summary,
          },
          day_meals: dayMeals,
          week_meal_plan: dash.weekMealPlan.map((m) => formatMealPlanEntryForMcp(m)),
          shopping_list: {
            unchecked_count: uncheckedShopping.length,
            checked_count: checkedShoppingCount,
            by_aisle: groupShoppingByAisle(uncheckedShopping),
            unchecked_items: uncheckedShopping,
          },
          pantry: {
            total_items: dash.pantryItems.length,
            low_stock_items: lowStockPantry,
            expiring_soon_items: expiringPantry,
            all_items: dash.pantryItems,
          },
          recipes_count: dash.recipes.length,
          open_food_facts_stats: dash.offStats,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. PRIMARY AI CALORIE & MACRO TARGETS ONBOARDING (`configure_nutrition_targets`)
  // ==========================================================================

  server.registerTool(
    "configure_nutrition_targets",
    {
      title: "Индивидуальная норма КБЖУ и веса (просмотр, расчёт с ИИ, сохранение)",
      description:
        "Управляет персональной дневной нормой калорий, белков, жиров, углеводов и целевым весом (`get | calculate_ai | save | calculate_and_save`). Умеет рассчитывать оптимальную норму КБЖУ через ИИ по естественному описанию параметров и цели пользователя (`prompt`) или антропометрии, а при сохранении помечает онбординг завершённым (`is_configured = true`) и опционально записывает текущий вес в дневник веса.",
      inputSchema: {
        action: z
          .enum(["get", "calculate_ai", "save", "calculate_and_save"])
          .optional()
          .describe(
            "Действие: get (текущие нормы), calculate_ai (только рассчитать и показать объяснение без сохранения), save (сохранить переданные КБЖУ), calculate_and_save (рассчитать с ИИ и сразу сохранить)"
          ),
        prompt: z
          .string()
          .max(1500)
          .optional()
          .describe(
            "Описание пользователя и цели своими словами (например: 'Мужчина, 26 лет, рост 180, вес 81.6 кг, 3 силовые в неделю, хочу рекомпозицию и снизить вес до 78 кг')"
          ),
        sex: z.enum(["male", "female"]).nullable().optional().describe("Пол: male или female"),
        age: z.number().int().min(14).max(100).nullable().optional().describe("Возраст, лет"),
        height_cm: z.number().min(120).max(240).nullable().optional().describe("Рост, см"),
        baseline_weight_kg: z
          .number()
          .min(25)
          .max(350)
          .nullable()
          .optional()
          .describe("Текущий / стартовый вес, кг"),
        weight_kg: z
          .number()
          .min(25)
          .max(350)
          .nullable()
          .optional()
          .describe("Алиас для baseline_weight_kg (текущий вес, кг)"),
        target_weight_kg: z
          .number()
          .min(25)
          .max(350)
          .nullable()
          .optional()
          .describe("Целевой вес, кг"),
        activity_level: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe("Описание бытовой и тренировочной активности"),
        goal_mode: z
          .enum(["lose", "maintain", "gain", "recomp"])
          .optional()
          .describe("Режим цели: lose (снижение веса), maintain (поддержание), gain (набор массы), recomp (рекомпозиция)"),
        kcal_target: z.number().int().min(800).max(10000).optional().describe("Целевые калории в день, ккал"),
        protein_target_g: z.number().min(20).max(600).optional().describe("Целевые белки в день, г"),
        fat_target_g: z.number().min(15).max(400).optional().describe("Целевые жиры в день, г"),
        carbs_target_g: z.number().min(0).max(1200).optional().describe("Целевые углеводы в день, г"),
        fiber_target_g: z.number().min(0).max(150).nullable().optional().describe("Целевая клетчатка в день, г"),
        ai_explanation: z.string().max(2000).nullable().optional().describe("Пояснение к расчёту нормы"),
        configured_via: z
          .enum(["ai", "telegram_ai", "manual"])
          .optional()
          .describe("Источник настройки (по умолчанию 'telegram_ai' или 'manual')"),
        log_baseline_weight: z
          .boolean()
          .optional()
          .describe("Записать ли стартовый вес сразу в body_weight_logs при сохранении (по умолчанию true)"),
        is_configured: z
          .boolean()
          .optional()
          .describe("Явный флаг is_configured (по умолчанию true при сохранении)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const weightInput = args.baseline_weight_kg ?? args.weight_kg ?? undefined;

        const inferredAction =
          args.action ??
          (args.kcal_target !== undefined
            ? "save"
            : args.prompt ||
                args.age !== undefined ||
                args.height_cm !== undefined ||
                weightInput !== undefined
              ? "calculate_ai"
              : "get");

        if (inferredAction === "get") {
          const [targets, latestWeight] = await Promise.all([
            getNutritionTargets(db, userId),
            getLatestBodyWeight(db),
          ]);
          return okResult({
            ok: true,
            targets,
            latest_weight: latestWeight,
          });
        }

        if (inferredAction === "calculate_ai" || inferredAction === "calculate_and_save") {
          const latestWeight = weightInput === undefined ? await getLatestBodyWeight(db) : null;
          const aiCalc = await calculateNutritionTargetsWithAi({
            prompt: args.prompt ?? null,
            sex: args.sex ?? null,
            age: args.age ?? null,
            heightCm: args.height_cm ?? null,
            weightKg:
              weightInput ?? (latestWeight ? Number(latestWeight.weight_kg) : null),
            targetWeightKg: args.target_weight_kg ?? null,
            activityLevel: args.activity_level ?? null,
            goalMode: args.goal_mode ?? null,
          });

          if (inferredAction === "calculate_ai") {
            return okResult({
              ok: true,
              saved: false,
              calculated_targets: aiCalc,
              next_step_hint:
                "Покажи рекомендацию пользователю и при согласии вызови configure_nutrition_targets(action='save', ...).",
            });
          }

          const saved = await upsertNutritionTargets(db, {
            user_id: userId,
            markConfigured: args.is_configured ?? true,
            kcal_target: args.kcal_target ?? aiCalc.kcal_target,
            protein_target_g: args.protein_target_g ?? aiCalc.protein_target_g,
            fat_target_g: args.fat_target_g ?? aiCalc.fat_target_g,
            carbs_target_g: args.carbs_target_g ?? aiCalc.carbs_target_g,
            fiber_target_g: args.fiber_target_g ?? aiCalc.fiber_target_g,
            goal_mode: args.goal_mode ?? aiCalc.goal_mode,
            sex: args.sex !== undefined ? args.sex : aiCalc.sex,
            age: args.age !== undefined ? args.age : aiCalc.age,
            height_cm: args.height_cm !== undefined ? args.height_cm : aiCalc.height_cm,
            baseline_weight_kg:
              weightInput !== undefined ? weightInput : aiCalc.baseline_weight_kg,
            target_weight_kg:
              args.target_weight_kg !== undefined
                ? args.target_weight_kg
                : aiCalc.target_weight_kg,
            activity_level:
              args.activity_level !== undefined ? args.activity_level : aiCalc.activity_level,
            ai_explanation:
              args.ai_explanation !== undefined ? args.ai_explanation : aiCalc.ai_explanation,
            configured_via: (args.configured_via ?? "telegram_ai") as NutritionConfiguredVia,
          });

          let weightLog: BodyWeightLog | null = null;
          const bw = saved.baseline_weight_kg ? Number(saved.baseline_weight_kg) : null;
          if ((args.log_baseline_weight ?? true) && bw && bw >= 20) {
            weightLog = await upsertBodyWeightLog(db, {
              user_id: userId,
              weight_kg: bw,
              source: "mcp",
              note: "Базовый вес при настройке нормы КБЖУ",
            });
          }

          return okResult({
            ok: true,
            saved: true,
            targets: saved,
            logged_baseline_weight: weightLog,
          });
        }

        // action === "save"
        const current = await getNutritionTargets(db, userId);
        const saved = await upsertNutritionTargets(db, {
          user_id: userId,
          markConfigured: args.is_configured ?? true,
          kcal_target: args.kcal_target ?? current.kcal_target,
          protein_target_g:
            args.protein_target_g ?? Number(current.protein_target_g),
          fat_target_g: args.fat_target_g ?? Number(current.fat_target_g),
          carbs_target_g: args.carbs_target_g ?? Number(current.carbs_target_g),
          fiber_target_g:
            args.fiber_target_g !== undefined
              ? args.fiber_target_g
              : current.fiber_target_g !== null
                ? Number(current.fiber_target_g)
                : 28,
          goal_mode: (args.goal_mode ?? current.goal_mode) as NutritionGoalMode,
          sex: (args.sex !== undefined ? args.sex : current.sex) as NutritionSex | null,
          age: args.age !== undefined ? args.age : current.age,
          height_cm:
            args.height_cm !== undefined
              ? args.height_cm
              : current.height_cm !== null
                ? Number(current.height_cm)
                : null,
          baseline_weight_kg:
            weightInput !== undefined
              ? weightInput
              : current.baseline_weight_kg !== null
                ? Number(current.baseline_weight_kg)
                : null,
          target_weight_kg:
            args.target_weight_kg !== undefined
              ? args.target_weight_kg
              : current.target_weight_kg !== null
                ? Number(current.target_weight_kg)
                : null,
          activity_level:
            args.activity_level !== undefined ? args.activity_level : current.activity_level,
          ai_explanation:
            args.ai_explanation !== undefined ? args.ai_explanation : current.ai_explanation,
          configured_via: (args.configured_via ?? "manual") as NutritionConfiguredVia,
        });

        let weightLog: BodyWeightLog | null = null;
        if ((args.log_baseline_weight ?? true) && weightInput && weightInput >= 20) {
          weightLog = await upsertBodyWeightLog(db, {
            user_id: userId,
            weight_kg: weightInput,
            source: "mcp",
            note: "Обновление веса при настройке нормы КБЖУ",
          });
        }

        return okResult({
          ok: true,
          saved: true,
          targets: saved,
          logged_baseline_weight: weightLog,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. OPTICAL BARCODE SCANNER FROM IMAGE / TELEGRAM PHOTO (`scan_barcode_from_image`)
  // ==========================================================================

  server.registerTool(
    "scan_barcode_from_image",
    {
      title: "Оптический сканер штрихкода продукта по фото или коду (zxing-wasm + Open Food Facts)",
      description:
        "Распознаёт штрихкод (EAN-13, EAN-8, UPC-A, UPC-E, Code-128, QR) прямо с фотографии или картинки (`image_path` на сервере, например входящее фото в Telegram `/root/.openclaw/media/inbound/...`, `image_base64` или `image_url`), автоматически находит продукт и его КБЖУ на 100 г в Open Food Facts и локальном словаре `food_items_dictionary`, пересчитывает на порцию `grams` и (если передан `log_to_meal_slot`) сразу записывает в дневник питания!",
      inputSchema: {
        image_path: z
          .string()
          .max(1000)
          .optional()
          .describe(
            "Абсолютный путь к файлу изображения на VPS (например, путь к присланному пользователем фото в Telegram)"
          ),
        image_base64: z
          .string()
          .optional()
          .describe("Изображение штрихкода в формате Base64 или Data URI (data:image/png;base64,...)"),
        image_url: z
          .string()
          .max(2000)
          .optional()
          .describe("HTTP/HTTPS URL изображения со штрихкодом"),
        barcode: z
          .string()
          .max(40)
          .optional()
          .describe("Прямой цифровой штрихкод EAN/UPC, если цифры уже известны"),
        grams: z
          .number()
          .positive()
          .max(5000)
          .optional()
          .describe("Вес порции в граммах для расчёта КБЖУ (по умолчанию 100 г)"),
        log_to_meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack"])
          .optional()
          .describe(
            "Если указан слот (breakfast / lunch / dinner / snack) — сразу добавляет найденный продукт в дневник питания за date"
          ),
        date: z
          .string()
          .optional()
          .describe("Дата записи YYYY-MM-DD или today/yesterday (при передаче log_to_meal_slot)"),
        fallback_product_name: z
          .string()
          .max(250)
          .optional()
          .describe(
            "Если штрихкода ещё нет в Open Food Facts, а название и таблица БЖУ видны на фото этикетки — передай их для сохранения в базу"
          ),
        fallback_brand: z.string().max(150).optional(),
        fallback_kcal_100g: z.number().min(0).max(1000).optional(),
        fallback_protein_100g: z.number().min(0).max(100).optional(),
        fallback_fat_100g: z.number().min(0).max(100).optional(),
        fallback_carbs_100g: z.number().min(0).max(100).optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        let decodedBarcode = args.barcode?.replace(/[^\dA-Za-z]/g, "").trim() || null;
        let barcodeFormat = decodedBarcode ? "direct_input" : null;

        if (!decodedBarcode) {
          if (!args.image_path && !args.image_base64 && !args.image_url) {
            return errResult(
              "Передай `image_path` (путь к фото), `image_base64`, `image_url` или цифровой `barcode`."
            );
          }
          const bytes = await loadImageBytesFromSource({
            image_path: args.image_path,
            image_base64: args.image_base64,
            image_url: args.image_url,
          });
          const decoded = await decodeBarcodeFromImageBuffer(bytes);
          if (!decoded) {
            return okResult({
              ok: false,
              barcode_detected: false,
              message:
                "Не удалось оптически считать штрихкод с изображения (возможно, штрихкод размыт или обрезан). Попроси более чёткое фото штрихкода, прочитай цифры/таблицу КБЖУ визуально или используй lookup_food_nutrition по названию продукта.",
            });
          }
          decodedBarcode = decoded.barcode;
          barcodeFormat = decoded.format;
        }

        let { item, offProduct } = await lookupBarcodeWithAutoCache(
          db,
          userId,
          decodedBarcode,
          "barcode_scan"
        );

        // If barcode is absent from OFF, allow immediate label caching when Vision read the package
        if (
          !item &&
          args.fallback_product_name?.trim() &&
          args.fallback_kcal_100g !== undefined
        ) {
          item = await cacheFoodDictionaryItem(db, userId, {
            display_name: args.fallback_product_name.trim(),
            brand: args.fallback_brand?.trim() || null,
            barcode: decodedBarcode,
            kcal_100g: args.fallback_kcal_100g,
            protein_100g: args.fallback_protein_100g ?? 0,
            fat_100g: args.fallback_fat_100g ?? 0,
            carbs_100g: args.fallback_carbs_100g ?? 0,
            source: "user",
          });
        }

        const effectiveGrams = args.grams ?? (item ? Number(item.default_portion_g || 100) : 100);
        const portionMacros = item
          ? calculatePortionMacros(item, effectiveGrams)
          : offProduct.found && offProduct.kcal_100g !== null
            ? calculatePortionMacros(
                {
                  kcal_100g: offProduct.kcal_100g,
                  protein_100g: offProduct.protein_100g,
                  fat_100g: offProduct.fat_100g,
                  carbs_100g: offProduct.carbs_100g,
                  fiber_100g: offProduct.fiber_100g,
                },
                effectiveGrams
              )
            : null;

        let loggedEntry: CalorieLog | null = null;
        let updatedDiaryTotals = null;

        if (args.log_to_meal_slot && (item || portionMacros)) {
          const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
          loggedEntry = await logFoodDiaryEntry(db, {
            user_id: userId,
            logged_date: dateStr,
            meal_slot: args.log_to_meal_slot,
            food_item_id: item?.id ?? null,
            barcode: decodedBarcode,
            title: item?.display_name ?? offProduct.product_name ?? `Продукт (${decodedBarcode})`,
            grams: effectiveGrams,
            kcal: portionMacros?.kcal,
            protein_g: portionMacros?.protein_g,
            fat_g: portionMacros?.fat_g,
            carbs_g: portionMacros?.carbs_g,
            fiber_g: portionMacros?.fiber_g,
            source: "barcode",
          });
          const diary = await getDayFoodDiary(db, dateStr, DEFAULT_TIMEZONE);
          updatedDiaryTotals = diary.totals;
        }

        return okResult({
          ok: true,
          barcode_detected: true,
          barcode: decodedBarcode,
          barcode_format: barcodeFormat,
          product_found: Boolean(item || offProduct.found),
          product: item
            ? formatFoodDictionaryItemWithPortion(item, effectiveGrams)
            : offProduct.found
              ? {
                  display_name: offProduct.product_name,
                  brand: offProduct.brands,
                  barcode: decodedBarcode,
                  source: "openfoodfacts",
                  per_100g: {
                    kcal: offProduct.kcal_100g,
                    protein_g: offProduct.protein_100g,
                    fat_g: offProduct.fat_100g,
                    carbs_g: offProduct.carbs_100g,
                  },
                  portion: portionMacros,
                }
              : null,
          logged_entry: loggedEntry,
          day_diary_totals: updatedDiaryTotals,
          hint_if_not_found:
            !item && !offProduct.found
              ? "Штрихкод считан, но его ещё нет в Open Food Facts. Если на фото видна этикетка КБЖУ или название продукта — передай fallback_product_name + fallback_kcal_100g либо вызови lookup_food_nutrition по названию."
              : undefined,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. 3-TIER HYBRID FOOD NUTRITION AUTO-LOOKUP (`lookup_food_nutrition`)
  // ==========================================================================

  server.registerTool(
    "lookup_food_nutrition",
    {
      title: "Мгновенный поиск КБЖУ любого продукта или готового блюда (3-уровневая база)",
      description:
        "Находит точную пищевую ценность (ккал / Б / Ж / У на 100 г и пересчёт на `grams`) для любого сырого продукта, магазинного товара или готового блюда ('куриная грудка', 'жареная курица', 'гречка отварная', 'творог 5%') через 3-уровневую систему: 1) эталонный русский справочник food_items_dictionary (<25мс), 2) Open Food Facts, 3) справочный ИИ-расчёт с кэшированием.",
      inputSchema: {
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Название продукта или готового блюда (поддерживает и фразы с весом вроде '200 г творога 5%')"),
        barcode: z
          .string()
          .max(40)
          .optional()
          .describe("Штрихкод EAN/UPC, если ищем по штрихкоду"),
        grams: z
          .number()
          .positive()
          .max(5000)
          .optional()
          .describe("Вес порции в граммах для точного пересчёта КБЖУ (по умолчанию 100 г или стандартная порция продукта)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Максимум вариантов в ответе (по умолчанию 6)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.barcode?.trim()) {
          const { item, offProduct } = await lookupBarcodeWithAutoCache(
            db,
            userId,
            args.barcode.trim()
          );
          if (!item && !offProduct.found) {
            return okResult({
              ok: true,
              found: false,
              barcode: args.barcode.trim(),
              matches: [],
            });
          }
          const formatted = item
            ? formatFoodDictionaryItemWithPortion(item, args.grams)
            : {
                id: null,
                display_name: offProduct.product_name,
                brand: offProduct.brands,
                barcode: offProduct.barcode,
                source: "openfoodfacts",
                per_100g: {
                  kcal: offProduct.kcal_100g,
                  protein_g: offProduct.protein_100g,
                  fat_g: offProduct.fat_100g,
                  carbs_g: offProduct.carbs_100g,
                },
                portion:
                  offProduct.kcal_100g !== null
                    ? calculatePortionMacros(offProduct, args.grams ?? 100)
                    : null,
              };

          return okResult({
            ok: true,
            found: true,
            best_match: formatted,
            matches: [formatted],
          });
        }

        const rawQuery = (args.query ?? "").trim();
        if (!rawQuery) {
          return errResult("Укажи `query` (название продукта/блюда) или `barcode`.");
        }

        const parsedPortion =
          args.grams === undefined ? parseNaturalFoodPortionToken(rawQuery) : null;
        const cleanQuery = parsedPortion?.query || rawQuery;
        const effectiveGrams = args.grams ?? parsedPortion?.grams;

        const items = await searchFoodNutritionWithAutoLookup(db, userId, cleanQuery, {
          limit: args.limit ?? 6,
        });

        if (items.length === 0) {
          return okResult({
            ok: true,
            found: false,
            query: cleanQuery,
            matches: [],
          });
        }

        const formattedList = items.map((item) =>
          formatFoodDictionaryItemWithPortion(item, effectiveGrams)
        );

        return okResult({
          ok: true,
          found: true,
          query: cleanQuery,
          best_match: formattedList[0],
          matches: formattedList,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. PHOTO MEAL ESTIMATION & STAGING (`estimate_and_stage_meal_from_photo`)
  // ==========================================================================

  server.registerTool(
    "estimate_and_stage_meal_from_photo",
    {
      title: "Расчёт КБЖУ блюда по фото тарелки (превью перед записью или мгновенная запись)",
      description:
        "Для сценария фото готовой еды в Telegram: принимает распознанные на тарелке компоненты и примерную граммовку (`items`, например [{ query: 'куриная грудка жареная', grams: 180 }, { query: 'гречка отварная', grams: 150 }]), сверяет точные КБЖУ каждого компонента по 3-уровневой базе продуктов, считает суммарные ккал / Б / Ж / У тарелки и остаток дневной нормы. При `commit: false` (по умолчанию) возвращает точное превью, чтобы спросить пользователя «Добавить в Обед?»; при `commit: true` сразу сохраняет в дневник питания.",
      inputSchema: {
        items: z
          .array(PhotoEstimatedFoodItemSchema)
          .min(1)
          .max(15)
          .describe("Список распознанных на фото продуктов/блюд с оценкой веса в граммах"),
        meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack"])
          .optional()
          .describe("Приём пищи: breakfast, lunch, dinner, snack (по умолчанию 'lunch')"),
        date: z
          .string()
          .optional()
          .describe("Дата YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        photo_note: z
          .string()
          .max(500)
          .optional()
          .describe("Краткое описание фото (например, 'Фото тарелки: жареная курица с гречкой')"),
        commit: z
          .boolean()
          .optional()
          .describe(
            "false (по умолчанию) — только рассчитать и показать пользователю перед подтверждением; true — сразу записать в дневник дня"
          ),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
        const slot: DiaryMealSlot = args.meal_slot ?? "lunch";

        const breakdown: Array<{
          query: string;
          matched_name: string;
          food_item_id: number | null;
          source: string;
          grams: number;
          kcal: number;
          protein_g: number;
          fat_g: number;
          carbs_g: number;
          fiber_g: number;
        }> = [];

        for (const entry of args.items) {
          const found = await searchFoodNutritionWithAutoLookup(db, userId, entry.query, {
            limit: 1,
          });
          const best = found[0] ?? null;
          const grams =
            entry.grams ?? (best ? Number(best.default_portion_g || 150) : 150);

          if (entry.kcal !== undefined) {
            breakdown.push({
              query: entry.query,
              matched_name: best?.display_name ?? entry.query.trim(),
              food_item_id: best?.id ?? null,
              source: "vision_override",
              grams,
              kcal: Math.round(entry.kcal),
              protein_g: Number((entry.protein_g ?? 0).toFixed(1)),
              fat_g: Number((entry.fat_g ?? 0).toFixed(1)),
              carbs_g: Number((entry.carbs_g ?? 0).toFixed(1)),
              fiber_g: 0,
            });
          } else if (best) {
            const p = calculatePortionMacros(best, grams);
            breakdown.push({
              query: entry.query,
              matched_name: best.display_name,
              food_item_id: best.id,
              source: best.source,
              grams: p.grams,
              kcal: p.kcal,
              protein_g: p.protein_g,
              fat_g: p.fat_g,
              carbs_g: p.carbs_g,
              fiber_g: p.fiber_g,
            });
          }
        }

        const plateTotals = {
          grams: Number(breakdown.reduce((s, i) => s + i.grams, 0).toFixed(1)),
          kcal: Math.round(breakdown.reduce((s, i) => s + i.kcal, 0)),
          protein_g: Number(breakdown.reduce((s, i) => s + i.protein_g, 0).toFixed(1)),
          fat_g: Number(breakdown.reduce((s, i) => s + i.fat_g, 0).toFixed(1)),
          carbs_g: Number(breakdown.reduce((s, i) => s + i.carbs_g, 0).toFixed(1)),
        };

        const loggedRows: CalorieLog[] = [];
        if (args.commit) {
          for (const b of breakdown) {
            const row = await logFoodDiaryEntry(db, {
              user_id: userId,
              logged_date: dateStr,
              meal_slot: slot,
              food_item_id: b.food_item_id,
              title: b.matched_name,
              grams: b.grams,
              kcal: b.kcal,
              protein_g: b.protein_g,
              fat_g: b.fat_g,
              carbs_g: b.carbs_g,
              fiber_g: b.fiber_g,
              source: "photo_ai",
              photo_note: args.photo_note ?? null,
            });
            loggedRows.push(row);
          }
        }

        const diary = await getDayFoodDiary(db, dateStr, DEFAULT_TIMEZONE);
        return okResult({
          ok: true,
          committed: Boolean(args.commit),
          date: dateStr,
          meal_slot: slot,
          items_breakdown: breakdown,
          plate_totals: plateTotals,
          logged_entries: loggedRows,
          day_diary_totals: diary.totals,
          projected_remaining_kcal_if_added: args.commit
            ? diary.totals.remaining_kcal
            : diary.totals.remaining_kcal - plateTotals.kcal,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 6. ENHANCED DAY DIARY & CALORIE LOG (`manage_calorie_log`)
  // ==========================================================================

  server.registerTool(
    "manage_calorie_log",
    {
      title: "Дневник питания и КБЖУ за день (просмотр по слотам, авто-запись продуктов и рецептов, изменение граммовки, удаление)",
      description:
        "Управляет ежедневным дневником питания по 4 приёмам пищи (Завтрак / Обед / Ужин / Перекус) без знания внутренних ID (`list_day | add | add_from_recipe | update | delete`). При `add` автоматически подбирает КБЖУ из 3-уровневой базы по названию и весу (поддерживает и фразы вроде '200 г творога 5% и банан на завтрак'); при `add_from_recipe` записывает порцию сохранённого рецепта; при `update` нечётко находит запись и автоматически пересчитывает БЖУ при изменении граммов или порций.",
      inputSchema: {
        action: z
          .enum([
            "list_day",
            "list",
            "add",
            "log",
            "add_from_recipe",
            "update",
            "delete",
            "toggle_feature_flag",
          ])
          .describe(
            "Действие: list_day (или list), add (или log), add_from_recipe, update, delete"
          ),
        date: z
          .string()
          .optional()
          .describe("Дата дневника YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack"])
          .optional()
          .describe("Приём пищи: breakfast (завтрак), lunch (обед), dinner (ужин), snack (перекус)"),
        log_id: z.number().int().positive().optional().describe("Точный ID записи дневника, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск записи по названию продукта/блюда (для update / delete) или название рецепта (для add_from_recipe)"),
        phrase: z
          .string()
          .max(1000)
          .optional()
          .describe("Естественная фраза съеденного (например, '200 г творога 5% и банан на завтрак') для пакетного автодобавления"),
        items: z
          .array(DiaryFoodBatchItemSchema)
          .optional()
          .describe("Массив продуктов/блюд для пакетного добавления в дневник за один вызов"),
        title: z
          .string()
          .max(250)
          .optional()
          .describe("Название продукта или блюда (для одиночного add или переименования в update)"),
        food_item_id: z.number().int().positive().optional().describe("ID продукта из food_items_dictionary (опционально)"),
        recipe: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Название или ID рецепта для action='add_from_recipe' (нечёткий поиск)"),
        recipe_id: z.number().int().positive().optional().describe("Точный ID рецепта (алиас для recipe)"),
        grams: z
          .number()
          .positive()
          .max(5000)
          .nullable()
          .optional()
          .describe("Вес порции в граммах (при update автоматически пересчитывает ккал и БЖУ!)"),
        servings: z
          .number()
          .positive()
          .max(30)
          .nullable()
          .optional()
          .describe("Количество порций рецепта (по умолчанию 1 для add_from_recipe)"),
        kcal: z
          .number()
          .min(0)
          .max(10000)
          .optional()
          .describe("Явная калорийность, ккал (если не указана — вычисляется автоматически по продукту/штрихкоду/рецепту!)"),
        protein_g: z.number().min(0).max(1000).nullable().optional().describe("Белки, г"),
        fat_g: z.number().min(0).max(1000).nullable().optional().describe("Жиры, г"),
        carbs_g: z.number().min(0).max(1000).nullable().optional().describe("Углеводы, г"),
        fiber_g: z.number().min(0).max(500).nullable().optional().describe("Клетчатка, г"),
        barcode: z.string().max(40).nullable().optional().describe("Штрихкод продукта"),
        source: z
          .enum(["web", "barcode", "photo_ai", "recipe", "mcp", "openclaw"])
          .optional()
          .describe("Источник записи (по умолчанию 'mcp' или 'photo_ai')"),
        photo_note: z.string().max(500).nullable().optional().describe("Пометка о фото тарелки"),
        enable_calories_off: z.boolean().optional().describe("Для toggle_feature_flag"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const dateStr = resolveDateInput(args.date) ?? formatIsoDate();

        if (args.action === "toggle_feature_flag") {
          const profile = await getOwnerProfile(db);
          const curFlags =
            profile?.feature_flags && typeof profile.feature_flags === "object"
              ? (profile.feature_flags as Record<string, unknown>)
              : {};
          const nextEnabled =
            args.enable_calories_off !== undefined
              ? args.enable_calories_off
              : !Boolean(curFlags.enable_calories_off);
          await setCaloriesFeatureFlag(db, userId, nextEnabled);
          return okResult({ ok: true, enable_calories_off: nextEnabled });
        }

        if (args.action === "list_day" || args.action === "list") {
          const diary = await getDayFoodDiary(db, dateStr, DEFAULT_TIMEZONE);
          return okResult({
            ok: true,
            date: diary.date,
            targets: diary.targets,
            totals: diary.totals,
            meals: diary.meals,
            day_weight: diary.dayWeight,
            latest_weight: diary.latestWeight,
          });
        }

        if (args.action === "add_from_recipe") {
          const recipeRef = args.recipe_id ?? args.recipe ?? args.query ?? args.title;
          if (!recipeRef) {
            return errResult("Для action='add_from_recipe' укажи `recipe` (название рецепта) или `recipe_id`.");
          }
          const { recipe, matches } = await resolveRecipeByFuzzyQuery(db, recipeRef);
          if (!recipe) {
            return errResult(`Рецепт «${recipeRef}» не найден. Вызови manage_recipe(action='list').`);
          }
          if (
            !args.recipe_id &&
            typeof recipeRef === "string" &&
            matches.length > 1 &&
            (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
          ) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "Найдено несколько похожих рецептов. Уточни название или recipe_id.",
              candidates: matches.slice(0, 5).map((m) => ({
                id: m.item.id,
                title: m.item.title,
                kcal_per_serving: m.item.kcal_per_serving,
                score: m.score,
              })),
            });
          }

          const inferredSlot: DiaryMealSlot =
            args.meal_slot ??
            (recipe.meal_category === "breakfast" ||
            recipe.meal_category === "lunch" ||
            recipe.meal_category === "dinner" ||
            recipe.meal_category === "snack"
              ? recipe.meal_category
              : "lunch");

          const created = await logFoodDiaryEntry(db, {
            user_id: userId,
            logged_date: dateStr,
            meal_slot: inferredSlot,
            recipe_id: recipe.id,
            servings: args.servings ?? 1,
            grams: args.grams ?? null,
            source: args.source ?? "recipe",
          });

          const diary = await getDayFoodDiary(db, dateStr, DEFAULT_TIMEZONE);
          return okResult({
            ok: true,
            created_log: created,
            day_totals: diary.totals,
            meal_summary: diary.meals[inferredSlot],
          });
        }

        if (args.action === "add" || args.action === "log") {
          const phraseSource = args.phrase ?? "";
          const slotFromPhrase = inferDiarySlotFromText(phraseSource || args.title);
          const defaultSlot: DiaryMealSlot = args.meal_slot ?? slotFromPhrase ?? "lunch";

          // Multi-item batch via `items` or multi-part `phrase`
          const createdLogs: CalorieLog[] = [];

          if (args.items && args.items.length > 0) {
            for (const item of args.items) {
              if (typeof item === "string") {
                for (const p of splitNaturalFoodPhrase(item)) {
                  const log = await logFoodDiaryEntry(db, {
                    user_id: userId,
                    logged_date: dateStr,
                    meal_slot: inferDiarySlotFromText(item) ?? defaultSlot,
                    title: p.query,
                    grams: p.grams,
                    source: (args.source ?? "mcp") as CalorieLogSource,
                    photo_note: args.photo_note ?? null,
                  });
                  createdLogs.push(log);
                }
              } else {
                const log = await logFoodDiaryEntry(db, {
                  user_id: userId,
                  logged_date: dateStr,
                  meal_slot: item.meal_slot ?? defaultSlot,
                  title: item.title,
                  grams: item.grams ?? null,
                  servings: item.servings ?? null,
                  barcode: item.barcode ?? null,
                  kcal: item.kcal,
                  protein_g: item.protein_g,
                  fat_g: item.fat_g,
                  carbs_g: item.carbs_g,
                  fiber_g: item.fiber_g,
                  source: (args.source ?? "mcp") as CalorieLogSource,
                  photo_note: args.photo_note ?? null,
                });
                createdLogs.push(log);
              }
            }
          } else if (phraseSource.trim()) {
            const parts = splitNaturalFoodPhrase(phraseSource);
            for (const p of parts) {
              const log = await logFoodDiaryEntry(db, {
                user_id: userId,
                logged_date: dateStr,
                meal_slot: defaultSlot,
                title: p.query,
                grams: p.grams ?? args.grams ?? null,
                source: (args.source ?? "mcp") as CalorieLogSource,
                photo_note: args.photo_note ?? null,
              });
              createdLogs.push(log);
            }
          } else {
            // Single entry (`title` / `food_item_id` / `recipe_id` / `barcode`)
            const rawTitle = (args.title ?? args.query ?? "").trim();
            // If `rawTitle` looks like multiple items ("200 г творога 5% и банан") and no explicit kcal was set
            if (
              rawTitle &&
              args.kcal === undefined &&
              !args.food_item_id &&
              !args.recipe_id &&
              !args.barcode &&
              /[,;]|\s+и\s+/iu.test(rawTitle)
            ) {
              const parts = splitNaturalFoodPhrase(rawTitle);
              for (const p of parts) {
                const log = await logFoodDiaryEntry(db, {
                  user_id: userId,
                  logged_date: dateStr,
                  meal_slot: defaultSlot,
                  title: p.query,
                  grams: p.grams ?? args.grams ?? null,
                  source: (args.source ?? "mcp") as CalorieLogSource,
                  photo_note: args.photo_note ?? null,
                });
                createdLogs.push(log);
              }
            } else {
              const parsedSingle =
                rawTitle && args.grams === undefined && args.kcal === undefined
                  ? parseNaturalFoodPortionToken(rawTitle)
                  : null;

              const log = await logFoodDiaryEntry(db, {
                user_id: userId,
                logged_date: dateStr,
                meal_slot: defaultSlot,
                title: parsedSingle?.query || rawTitle || undefined,
                food_item_id: args.food_item_id ?? null,
                recipe_id: args.recipe_id ?? null,
                barcode: args.barcode?.trim() || null,
                grams: args.grams ?? parsedSingle?.grams ?? null,
                servings: args.servings ?? null,
                kcal: args.kcal,
                protein_g: args.protein_g,
                fat_g: args.fat_g,
                carbs_g: args.carbs_g,
                fiber_g: args.fiber_g,
                source: (args.source ?? "mcp") as CalorieLogSource,
                photo_note: args.photo_note ?? null,
              });
              createdLogs.push(log);
            }
          }

          const diary = await getDayFoodDiary(db, dateStr, DEFAULT_TIMEZONE);
          return okResult({
            ok: true,
            added_count: createdLogs.length,
            created_log: createdLogs.length === 1 ? createdLogs[0] : undefined,
            created_logs: createdLogs,
            day_totals: diary.totals,
            meal_summary: diary.meals[defaultSlot],
          });
        }

        // Resolve target log for update / delete
        let target: CalorieLog | null = null;
        if (args.log_id) {
          const { data, error } = await db
            .from("calorie_logs")
            .select("*")
            .eq("id", args.log_id)
            .maybeSingle();
          if (error) throw error;
          target = data ?? null;
        } else {
          const searchQ = (args.query ?? args.title ?? "").trim();
          if (!searchQ && !args.meal_slot) {
            return errResult("Укажи `query` (название продукта в дневнике) или `log_id`.");
          }
          const matches = await findCalorieLogsByFuzzyQuery(db, {
            query: searchQ,
            dateStr,
            mealSlot: args.meal_slot,
            timeZone: DEFAULT_TIMEZONE,
          });
          if (matches.length === 0) {
            return errResult(
              `Запись «${searchQ || args.meal_slot}» не найдена в дневнике за ${dateStr}.`
            );
          }
          if (
            matches.length > 1 &&
            searchQ &&
            (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
          ) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "В дневнике за этот день несколько похожих записей. Уточни приём пищи или log_id.",
              candidates: matches.slice(0, 5).map((m) => ({
                id: m.item.id,
                meal_slot: m.item.meal_slot,
                title: m.item.title,
                grams: m.item.grams,
                kcal: m.item.kcal,
                score: m.score,
              })),
            });
          }
          target = matches[0].item;
        }

        if (!target) {
          return errResult(`Запись КБЖУ не найдена за ${dateStr}.`);
        }

        if (args.action === "delete") {
          await deleteCalorieLog(db, target.id);
          const diary = await getDayFoodDiary(db, target.logged_date, DEFAULT_TIMEZONE);
          return okResult({
            ok: true,
            deleted_log: target,
            day_totals: diary.totals,
          });
        }

        // action === "update"
        const patch: CalorieLogUpdate = {};
        if (args.date !== undefined) patch.logged_date = dateStr;
        if (args.meal_slot !== undefined) patch.meal_slot = args.meal_slot;
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.grams !== undefined) patch.grams = args.grams;
        if (args.servings !== undefined) patch.servings = args.servings;
        if (args.kcal !== undefined) patch.kcal = args.kcal;
        if (args.protein_g !== undefined) patch.protein_g = args.protein_g;
        if (args.fat_g !== undefined) patch.fat_g = args.fat_g;
        if (args.carbs_g !== undefined) patch.carbs_g = args.carbs_g;
        if (args.fiber_g !== undefined) patch.fiber_g = args.fiber_g;
        if (args.barcode !== undefined) patch.barcode = args.barcode?.trim() || null;
        if (args.photo_note !== undefined) patch.photo_note = args.photo_note;

        const updated = await updateCalorieLog(db, target.id, patch);
        const diary = await getDayFoodDiary(db, updated.logged_date, DEFAULT_TIMEZONE);
        return okResult({
          ok: true,
          updated_log: updated,
          day_totals: diary.totals,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 7. RECIPES WITH AUTO-COMPUTED INGREDIENT КБЖУ (`manage_recipe`)
  // ==========================================================================

  server.registerTool(
    "manage_recipe",
    {
      title: "Библиотека рецептов с авторасчётом КБЖУ по ингредиентам",
      description:
        "Управляет рецептами без знания внутренних ID (`list | get | create | update | recalculate_all | delete`). При передаче `ingredients[]` автоматически подбирает КБЖУ каждого ингредиента на 100 г из открытой базы продуктов, переводит единицы измерения в граммы и рассчитывает точные `total_kcal`, `kcal_per_serving`, `protein_g`, `fat_g`, `carbs_g` и `kcal_per_100g` рецепта!",
      inputSchema: {
        action: z
          .enum(["list", "get", "create", "update", "recalculate_all", "delete"])
          .describe("Действие: list, get, create, update, recalculate_all, delete"),
        query: z
          .string()
          .optional()
          .describe("Нечёткий поиск рецепта по названию или тегу (для get/update/delete и фильтрации list)"),
        recipe_id: z.number().int().positive().optional().describe("Точный ID рецепта, если известен"),
        title: z.string().max(250).optional().describe("Название рецепта"),
        meal_category: z
          .enum(["breakfast", "lunch", "dinner", "snack", "batch_prep"])
          .optional()
          .describe("Категория блюда: breakfast, lunch, dinner, snack, batch_prep"),
        favorites_only: z.boolean().optional().describe("Только избранные рецепты (для list)"),
        default_servings: z.number().positive().max(30).optional().describe("Количество порций в рецепте (по умолчанию 2)"),
        cook_time_minutes: z
          .number()
          .int()
          .min(1)
          .max(720)
          .nullable()
          .optional()
          .describe("Время приготовления в минутах"),
        steps_markdown: z
          .string()
          .max(8000)
          .nullable()
          .optional()
          .describe("Пошаговый рецепт (Markdown)"),
        tags: z.array(z.string().min(1).max(60)).optional().describe("Теги рецепта"),
        is_favorite: z.boolean().optional().describe("Отметка избранного"),
        kcal_per_serving: z.number().min(0).nullable().optional().describe("Ручное переопределение ккал на порцию (если без ингредиентов)"),
        protein_g: z.number().min(0).nullable().optional(),
        fat_g: z.number().min(0).nullable().optional(),
        carbs_g: z.number().min(0).nullable().optional(),
        ingredients: z
          .array(RecipeIngredientDraftSchema)
          .optional()
          .describe("Структурированный список ингредиентов (КБЖУ подтягиваются автоматически!)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const recipes = await listRecipes(db, {
            mealCategory: args.meal_category as MealCategory | undefined,
            favoritesOnly: args.favorites_only,
            searchQuery: args.query,
          });
          return okResult({
            ok: true,
            count: recipes.length,
            recipes: recipes.map((r) => formatRecipeForMcp(r)),
          });
        }

        if (args.action === "recalculate_all") {
          const recalculated = await recalculateAllRecipesMacros(db, userId);
          return okResult({
            ok: true,
            recalculated_count: recalculated.length,
            recipes: recalculated.map((r) => formatRecipeForMcp(r)),
          });
        }

        if (args.action === "create") {
          const title = (args.title ?? args.query ?? "").trim();
          if (!title) {
            return errResult("Для создания рецепта укажи `title`.");
          }
          const category = args.meal_category ?? inferMealCategoryFromTitle(title);
          const drafts: RecipeIngredientDraft[] = (args.ingredients ?? []).map((ing) => ({
            display_name: ing.display_name.trim(),
            ingredient_key: ing.ingredient_key,
            amount: ing.amount,
            unit: normalizeIngredientUnit(ing.unit ?? "g"),
            aisle_group: ing.aisle_group?.trim() || inferAisleGroup(ing.display_name),
            is_optional: Boolean(ing.is_optional),
            grams_equivalent: ing.grams_equivalent ?? null,
            kcal_100g: ing.kcal_100g ?? null,
            protein_100g: ing.protein_100g ?? null,
            fat_100g: ing.fat_100g ?? null,
            carbs_100g: ing.carbs_100g ?? null,
          }));

          const created = await createRecipeWithIngredients(
            db,
            {
              user_id: userId,
              title,
              meal_category: category,
              default_servings: args.default_servings ?? 2,
              cook_time_minutes: args.cook_time_minutes ?? null,
              steps_markdown: args.steps_markdown?.trim() || null,
              tags: args.tags ?? [],
              is_favorite: args.is_favorite ?? false,
              kcal_per_serving: args.kcal_per_serving ?? null,
              protein_g: args.protein_g ?? null,
              fat_g: args.fat_g ?? null,
              carbs_g: args.carbs_g ?? null,
            },
            drafts
          );

          return okResult({
            ok: true,
            recipe: formatRecipeForMcp(created),
          });
        }

        const lookupRef =
          args.recipe_id ?? (args.action === "update" ? args.query : args.query ?? args.title);
        if (!lookupRef) {
          return errResult("Укажи `query` (название рецепта) или `recipe_id`.");
        }

        const { recipe, matches } = await resolveRecipeByFuzzyQuery(db, lookupRef);
        if (!recipe) {
          return errResult(
            `Рецепт по запросу «${lookupRef}» не найден. Вызови manage_recipe(action='list').`
          );
        }
        if (
          !args.recipe_id &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих рецептов. Уточни название или передай recipe_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              title: m.item.title,
              meal_category: m.item.meal_category,
              kcal_per_serving: m.item.kcal_per_serving,
              score: m.score,
            })),
          });
        }

        if (args.action === "get") {
          return okResult({
            ok: true,
            recipe: formatRecipeForMcp(recipe),
          });
        }

        if (args.action === "delete") {
          await deleteRecipe(db, recipe.id);
          return okResult({
            ok: true,
            deleted_recipe: { id: recipe.id, title: recipe.title },
          });
        }

        // action === "update"
        const patch: RecipeUpdate = {};
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.meal_category !== undefined) patch.meal_category = args.meal_category;
        if (args.default_servings !== undefined) patch.default_servings = args.default_servings;
        if (args.cook_time_minutes !== undefined) patch.cook_time_minutes = args.cook_time_minutes;
        if (args.steps_markdown !== undefined) {
          patch.steps_markdown = args.steps_markdown?.trim() || null;
        }
        if (args.tags !== undefined) patch.tags = args.tags;
        if (args.is_favorite !== undefined) patch.is_favorite = args.is_favorite;
        if (args.kcal_per_serving !== undefined) patch.kcal_per_serving = args.kcal_per_serving;
        if (args.protein_g !== undefined) patch.protein_g = args.protein_g;
        if (args.fat_g !== undefined) patch.fat_g = args.fat_g;
        if (args.carbs_g !== undefined) patch.carbs_g = args.carbs_g;

        const updatedDrafts =
          args.ingredients !== undefined
            ? args.ingredients.map((ing) => ({
                display_name: ing.display_name.trim(),
                ingredient_key: ing.ingredient_key,
                amount: ing.amount,
                unit: normalizeIngredientUnit(ing.unit ?? "g"),
                aisle_group: ing.aisle_group?.trim() || inferAisleGroup(ing.display_name),
                is_optional: Boolean(ing.is_optional),
                grams_equivalent: ing.grams_equivalent ?? null,
                kcal_100g: ing.kcal_100g ?? null,
                protein_100g: ing.protein_100g ?? null,
                fat_100g: ing.fat_100g ?? null,
                carbs_100g: ing.carbs_100g ?? null,
              }))
            : undefined;

        const updated = await updateRecipeWithIngredients(db, recipe.id, patch, updatedDrafts);
        return okResult({
          ok: true,
          recipe: formatRecipeForMcp(updated),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 8. MEAL PLAN & COOKING FLOW (`manage_meal_plan`)
  // ==========================================================================

  server.registerTool(
    "manage_meal_plan",
    {
      title: "План меню недели и готовка (со списанием запасов дома)",
      description:
        "Управляет планом меню на день и неделю (`list | plan | update | mark_cooked | delete`), поддерживает нечёткий поиск рецепта или произвольное название блюда и списание ингредиентов из запасов дома при приготовлении (`deduct_from_pantry`).",
      inputSchema: {
        action: z
          .enum(["list", "plan", "update", "mark_cooked", "delete"])
          .describe("Действие: list, plan, update, mark_cooked, delete"),
        entry_id: z.number().int().positive().optional().describe("Точный ID записи плана меню, если известен"),
        query: z
          .string()
          .optional()
          .describe("Нечёткий поиск записи меню по названию блюда или слоту"),
        plan_date: z
          .string()
          .optional()
          .describe("Дата приёма пищи YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        start_date: z.string().optional().describe("Начало периода для list YYYY-MM-DD"),
        end_date: z.string().optional().describe("Конец периода для list YYYY-MM-DD"),
        meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack", "cook_ahead"])
          .optional()
          .describe("Слот: breakfast, lunch, dinner, snack, cook_ahead"),
        recipe: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Название рецепта (нечёткий поиск) или ID рецепта"),
        custom_meal_title: z
          .string()
          .max(250)
          .nullable()
          .optional()
          .describe("Произвольное блюдо без рецепта"),
        planned_servings: z.number().positive().max(30).optional().describe("Количество порций"),
        status: z.enum(["planned", "cooked", "eaten", "skipped"]).optional(),
        deduct_from_pantry: z
          .boolean()
          .optional()
          .describe("Списать ли ингредиенты из запасов дома при mark_cooked (по умолчанию true)"),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const anchor = resolveDateInput(args.plan_date) ?? formatIsoDate();
          const week = getWeekBoundsIso(anchor);
          const startDate =
            resolveDateInput(args.start_date) ?? (args.plan_date ? anchor : week.weekStart);
          const endDate =
            resolveDateInput(args.end_date) ?? (args.plan_date ? anchor : week.weekEnd);
          const entries = await listMealPlanEntries(db, { startDate, endDate });
          return okResult({
            ok: true,
            start_date: startDate,
            end_date: endDate,
            count: entries.length,
            entries: entries.map((e) => formatMealPlanEntryForMcp(e)),
          });
        }

        if (args.action === "plan") {
          const planDate = resolveDateInput(args.plan_date) ?? formatIsoDate();
          let resolvedRecipe: RecipeWithIngredients | null = null;
          let customTitle = args.custom_meal_title?.trim() || null;

          const recipeQuery = args.recipe ?? (customTitle ? null : args.query);
          if (
            recipeQuery !== undefined &&
            recipeQuery !== null &&
            String(recipeQuery).trim() !== ""
          ) {
            const { recipe } = await resolveRecipeByFuzzyQuery(db, recipeQuery);
            if (recipe) {
              resolvedRecipe = recipe;
            } else if (!customTitle && typeof recipeQuery === "string") {
              customTitle = recipeQuery.trim();
            } else {
              return errResult(`Рецепт «${recipeQuery}» не найден.`);
            }
          }

          if (!resolvedRecipe && !customTitle) {
            return errResult(
              "Для планирования меню укажи `recipe` (название рецепта) или `custom_meal_title`."
            );
          }

          const slot: MealSlot =
            args.meal_slot ?? inferMealSlotFromCategory(resolvedRecipe?.meal_category);
          const servings =
            args.planned_servings ??
            (resolvedRecipe ? Number(resolvedRecipe.default_servings) : 2);

          const created = await createMealPlanEntry(db, {
            user_id: userId,
            plan_date: planDate,
            meal_slot: slot,
            recipe_id: resolvedRecipe ? resolvedRecipe.id : null,
            custom_meal_title: customTitle,
            planned_servings: servings,
            status: args.status ?? "planned",
            notes: args.notes?.trim() || null,
          });

          return okResult({
            ok: true,
            meal_plan_entry: formatMealPlanEntryForMcp({
              ...created,
              recipe: resolvedRecipe,
            }),
            matched_library_recipe: Boolean(resolvedRecipe),
          });
        }

        const resolved = await resolveMealPlanTarget(db, {
          entry_id: args.entry_id,
          query: args.query ?? (typeof args.recipe === "string" ? args.recipe : undefined),
          plan_date: args.plan_date,
          meal_slot: args.meal_slot,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько записей в меню. Уточни дату, слот, название или entry_id.",
            candidates: resolved.candidates,
          });
        }

        const target = resolved.entry!;

        if (args.action === "delete") {
          await deleteMealPlanEntry(db, target.id);
          return okResult({
            ok: true,
            deleted_entry: formatMealPlanEntryForMcp(target),
          });
        }

        if (args.action === "mark_cooked") {
          const nextStatus: MealPlanStatus =
            args.status === "eaten" || args.status === "cooked" ? args.status : "cooked";
          const deductFromPantry = args.deduct_from_pantry ?? true;
          const res = await markMealCookedOrEaten(db, target.id, nextStatus, {
            deductFromPantry,
          });
          return okResult({
            ok: true,
            entry: formatMealPlanEntryForMcp({ ...res.entry, recipe: target.recipe }),
            deducted_from_pantry: deductFromPantry,
            deducted_ingredients_count: res.deductedIngredientsCount,
          });
        }

        const patch: MealPlanEntryUpdate = {};
        if (args.plan_date !== undefined) {
          const d = resolveDateInput(args.plan_date);
          if (d) patch.plan_date = d;
        }
        if (args.meal_slot !== undefined) patch.meal_slot = args.meal_slot;
        if (args.planned_servings !== undefined) patch.planned_servings = args.planned_servings;
        if (args.status !== undefined) patch.status = args.status;
        if (args.notes !== undefined) patch.notes = args.notes?.trim() || null;
        if (args.custom_meal_title !== undefined) {
          patch.custom_meal_title = args.custom_meal_title?.trim() || null;
        }

        let updatedRecipe = target.recipe;
        if (args.recipe !== undefined) {
          if (args.recipe === null || args.recipe === "") {
            patch.recipe_id = null;
            updatedRecipe = null;
          } else {
            const { recipe } = await resolveRecipeByFuzzyQuery(db, args.recipe);
            if (!recipe) return errResult(`Рецепт «${args.recipe}» не найден.`);
            patch.recipe_id = recipe.id;
            updatedRecipe = recipe;
          }
        }

        const updated = await updateMealPlanEntry(db, target.id, patch);
        return okResult({
          ok: true,
          entry: formatMealPlanEntryForMcp({ ...updated, recipe: updatedRecipe }),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 9. SMART SHOPPING LIST (`manage_shopping_list`)
  // ==========================================================================

  server.registerTool(
    "manage_shopping_list",
    {
      title: "Умный список покупок (пакетное добавление, отметка купленного, автосбор по меню с вычитанием запасов дома)",
      description:
        "Управляет списком покупок без знания ID (`list | add_items | check_item | generate_from_menu | clear_checked | move_checked_to_pantry | delete`). Поддерживает добавление сразу нескольких позиций одной фразой, нечёткую отметку купленного и автосбор недостающих ингредиентов под меню недели за вычетом домашних запасов `pantry_items`.",
      inputSchema: {
        action: z
          .enum([
            "list",
            "add_items",
            "add",
            "check_item",
            "check",
            "uncheck",
            "generate_from_menu",
            "clear_checked",
            "move_checked_to_pantry",
            "delete",
          ])
          .describe("Действие над списком покупок"),
        include_checked: z.boolean().optional(),
        items: z.array(ShoppingBatchItemInputSchema).optional(),
        phrase: z
          .string()
          .max(1000)
          .optional()
          .describe("Естественная фраза со списком покупок ('молоко 2 л, яйца 10 шт и авокадо 3 шт')"),
        item_name: z.string().max(250).optional(),
        quantity_needed: z.number().positive().optional(),
        unit: FlexibleIngredientUnitSchema.optional(),
        aisle_group: z.string().max(100).optional(),
        query: z.string().max(250).optional(),
        queries: z.array(z.string().min(1).max(250)).optional(),
        item_id: z.number().int().positive().optional(),
        checked: z.boolean().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        anchor_date: z.string().optional(),
        replace_unchecked_meal_plan_items: z.boolean().optional(),
        move_to_pantry: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const items = await listShoppingItems(db, args.include_checked ?? true);
          const unchecked = items.filter((i) => !i.is_checked);
          return okResult({
            ok: true,
            total_count: items.length,
            unchecked_count: unchecked.length,
            checked_count: items.length - unchecked.length,
            by_aisle: groupShoppingByAisle(unchecked),
            items,
          });
        }

        if (args.action === "add_items" || args.action === "add") {
          const drafts: Array<{
            user_id: string;
            display_name: string;
            ingredient_key: string;
            quantity_needed: number;
            unit: IngredientUnit;
            aisle_group: string;
            added_from: "mcp";
          }> = [];

          if (args.items && args.items.length > 0) {
            for (const entry of args.items) {
              if (typeof entry === "string") {
                for (const p of parseShoppingPhraseToDrafts(entry)) {
                  drafts.push({
                    user_id: userId,
                    display_name: p.display_name,
                    ingredient_key: normalizeIngredientKey(p.display_name),
                    quantity_needed: p.quantity_needed,
                    unit: p.unit,
                    aisle_group: p.aisle_group,
                    added_from: "mcp",
                  });
                }
              } else {
                const name = entry.display_name.trim();
                if (!name) continue;
                drafts.push({
                  user_id: userId,
                  display_name: name,
                  ingredient_key: normalizeIngredientKey(name),
                  quantity_needed: entry.quantity_needed ?? 1,
                  unit: normalizeIngredientUnit(entry.unit ?? "pcs"),
                  aisle_group: entry.aisle_group?.trim() || inferAisleGroup(name),
                  added_from: "mcp",
                });
              }
            }
          }

          if (args.phrase?.trim()) {
            for (const p of parseShoppingPhraseToDrafts(args.phrase)) {
              drafts.push({
                user_id: userId,
                display_name: p.display_name,
                ingredient_key: normalizeIngredientKey(p.display_name),
                quantity_needed: p.quantity_needed,
                unit: p.unit,
                aisle_group: p.aisle_group,
                added_from: "mcp",
              });
            }
          }

          if (drafts.length === 0 && args.item_name?.trim()) {
            if (
              args.quantity_needed !== undefined ||
              args.unit !== undefined ||
              args.aisle_group !== undefined
            ) {
              const name = args.item_name.trim();
              drafts.push({
                user_id: userId,
                display_name: name,
                ingredient_key: normalizeIngredientKey(name),
                quantity_needed: args.quantity_needed ?? 1,
                unit: normalizeIngredientUnit(args.unit ?? "pcs"),
                aisle_group: args.aisle_group?.trim() || inferAisleGroup(name),
                added_from: "mcp",
              });
            } else {
              for (const p of parseShoppingPhraseToDrafts(args.item_name)) {
                drafts.push({
                  user_id: userId,
                  display_name: p.display_name,
                  ingredient_key: normalizeIngredientKey(p.display_name),
                  quantity_needed: p.quantity_needed,
                  unit: p.unit,
                  aisle_group: p.aisle_group,
                  added_from: "mcp",
                });
              }
            }
          }

          if (drafts.length === 0) {
            return errResult(
              "Укажи продукты для добавления в `items`, `phrase` или `item_name`."
            );
          }

          const added = await addShoppingItemsBatch(db, drafts);
          return okResult({
            ok: true,
            added_count: added.length,
            items: added,
          });
        }

        if (args.action === "generate_from_menu") {
          const anchor = resolveDateInput(args.anchor_date) ?? formatIsoDate();
          const week = getWeekBoundsIso(anchor);
          const startDate = resolveDateInput(args.start_date) ?? week.weekStart;
          const endDate = resolveDateInput(args.end_date) ?? week.weekEnd;

          const generated = await generateShoppingListFromMealPlan(db, {
            startDate,
            endDate,
            replaceUncheckedMealPlanItems: args.replace_unchecked_meal_plan_items ?? true,
          });

          const allUnchecked = await listShoppingItems(db, false);
          return okResult({
            ok: true,
            start_date: startDate,
            end_date: endDate,
            generated_count: generated.items.length,
            covered_by_pantry_count: generated.coveredByPantryCount,
            partially_subtracted_from_pantry_count: generated.partiallySubtractedCount,
            generated_items: generated.items,
            all_unchecked_by_aisle: groupShoppingByAisle(allUnchecked),
          });
        }

        if (args.action === "clear_checked" || args.action === "move_checked_to_pantry") {
          const moveToPantry =
            args.action === "move_checked_to_pantry" ? true : Boolean(args.move_to_pantry);
          const res = await clearCheckedShoppingItems(db, { moveToPantry });
          return okResult({
            ok: true,
            cleared_count: res.clearedCount,
            moved_to_pantry_count: res.movedToPantryCount,
          });
        }

        const desiredChecked =
          args.action === "uncheck" ? false : args.checked !== undefined ? args.checked : true;

        const batchQueries =
          args.queries && args.queries.length > 0
            ? args.queries
            : args.query && /[,;]|\s+и\s+/iu.test(args.query) && args.action !== "delete"
              ? args.query
                  .split(/[,;]+|\s+и\s+/iu)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : null;

        if (batchQueries && batchQueries.length > 1 && args.action !== "delete") {
          const updatedItems: ShoppingListItem[] = [];
          const notFound: string[] = [];
          for (const q of batchQueries) {
            const matches = await findShoppingItemsByFuzzyQuery(
              db,
              q,
              !desiredChecked ? true : false
            );
            const fallbackMatches =
              matches.length > 0 ? matches : await findShoppingItemsByFuzzyQuery(db, q, true);
            if (fallbackMatches.length > 0) {
              const upd = await toggleShoppingItemChecked(
                db,
                fallbackMatches[0].item.id,
                desiredChecked
              );
              updatedItems.push(upd);
            } else {
              notFound.push(q);
            }
          }
          return okResult({
            ok: true,
            checked: desiredChecked,
            updated_count: updatedItems.length,
            updated_items: updatedItems,
            not_found: notFound,
          });
        }

        let targetItem: ShoppingListItem | null = null;
        if (args.item_id) {
          const all = await listShoppingItems(db, true);
          targetItem = all.find((i) => i.id === args.item_id) ?? null;
        } else {
          const searchStr = (args.query ?? args.item_name ?? args.phrase ?? "").trim();
          if (!searchStr) {
            return errResult("Укажи `query` / `item_name` или `item_id`.");
          }
          let matches = await findShoppingItemsByFuzzyQuery(
            db,
            searchStr,
            args.action === "delete" || !desiredChecked ? true : false
          );
          if (matches.length === 0) {
            matches = await findShoppingItemsByFuzzyQuery(db, searchStr, true);
          }
          if (matches.length === 0) {
            return errResult(`Позиция «${searchStr}» не найдена в списке покупок.`);
          }
          if (
            matches.length > 1 &&
            (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
          ) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "Найдено несколько похожих позиций в списке покупок. Уточни название или item_id.",
              candidates: matches.slice(0, 5).map((m) => ({
                id: m.item.id,
                display_name: m.item.display_name,
                quantity_needed: Number(m.item.quantity_needed),
                unit: m.item.unit,
                is_checked: m.item.is_checked,
                score: m.score,
              })),
            });
          }
          targetItem = matches[0].item;
        }

        if (!targetItem) return errResult("Позиция списка покупок не найдена.");

        if (args.action === "delete") {
          await deleteShoppingItem(db, targetItem.id);
          return okResult({ ok: true, deleted_item: targetItem });
        }

        const updated = await toggleShoppingItemChecked(db, targetItem.id, desiredChecked);
        return okResult({ ok: true, item: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 10. HOME PANTRY INVENTORY (`manage_pantry`)
  // ==========================================================================

  server.registerTool(
    "manage_pantry",
    {
      title: "Запасы продуктов дома (инвентарь, остатки и сроки годности)",
      description:
        "Управляет домашними запасами продуктов (`list | upsert | adjust | delete`), которые вычитаются при сборе покупок по меню и синхронизируют напоминания `pantry_expiry` в Telegram.",
      inputSchema: {
        action: z.enum(["list", "upsert", "adjust", "delete"]),
        pantry_item_id: z.number().int().positive().optional(),
        query: z.string().max(200).optional(),
        display_name: z.string().max(200).optional(),
        quantity_on_hand: z.number().min(0).optional(),
        delta: z.number().optional(),
        unit: FlexibleIngredientUnitSchema.optional(),
        aisle_group: z.string().max(100).optional(),
        low_stock_threshold: z.number().min(0).nullable().optional(),
        expires_on: z.string().nullable().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const items = await listPantryItems(db);
          const today = formatIsoDate();
          const expiryHorizon = addDaysToIsoDate(today, 5);
          return okResult({
            ok: true,
            count: items.length,
            low_stock_count: items.filter(
              (p) =>
                Number(p.quantity_on_hand) <= 0 ||
                (p.low_stock_threshold !== null &&
                  Number(p.quantity_on_hand) <= Number(p.low_stock_threshold))
            ).length,
            expiring_soon_count: items.filter(
              (p) =>
                Boolean(p.expires_on) &&
                Number(p.quantity_on_hand) > 0 &&
                p.expires_on! <= expiryHorizon
            ).length,
            items,
          });
        }

        if (args.action === "upsert") {
          const expiresOn =
            args.expires_on === null
              ? null
              : args.expires_on !== undefined
                ? resolveDateInput(args.expires_on)
                : undefined;

          if (args.pantry_item_id || (args.query && !args.display_name)) {
            let existing: PantryItem | null = null;
            if (args.pantry_item_id) {
              const all = await listPantryItems(db);
              existing = all.find((p) => p.id === args.pantry_item_id) ?? null;
            } else if (args.query) {
              const matches = await findPantryItemByFuzzyQuery(db, args.query);
              existing = matches[0]?.item ?? null;
            }

            if (existing) {
              const patch: PantryItemUpdate = {};
              if (args.display_name?.trim()) patch.display_name = args.display_name.trim();
              if (args.quantity_on_hand !== undefined) patch.quantity_on_hand = args.quantity_on_hand;
              if (args.unit !== undefined) patch.unit = normalizeIngredientUnit(args.unit);
              if (args.aisle_group !== undefined) patch.aisle_group = args.aisle_group.trim();
              if (args.low_stock_threshold !== undefined) {
                patch.low_stock_threshold = args.low_stock_threshold;
              }
              if (expiresOn !== undefined) patch.expires_on = expiresOn;

              const updated = await updatePantryItem(db, existing.id, patch);
              return okResult({ ok: true, pantry_item: updated });
            }
          }

          const name = (args.display_name ?? args.query ?? "").trim();
          if (!name) return errResult("Укажи `display_name` для добавления запаса.");

          const item = await upsertPantryItem(db, {
            user_id: userId,
            display_name: name,
            quantity_on_hand: args.quantity_on_hand ?? 1,
            unit: normalizeIngredientUnit(args.unit ?? "pcs"),
            aisle_group: args.aisle_group?.trim() || inferAisleGroup(name),
            low_stock_threshold:
              args.low_stock_threshold !== undefined ? args.low_stock_threshold : null,
            expires_on: expiresOn ?? null,
          });
          return okResult({ ok: true, pantry_item: item });
        }

        if (args.action === "adjust") {
          if (args.delta === undefined || args.delta === 0) {
            return errResult("Для action='adjust' укажи ненулевую `delta` (например, -200 или +500).");
          }
          const ref = args.pantry_item_id ?? args.query ?? args.display_name;
          if (!ref) return errResult("Укажи `query` / `display_name` или `pantry_item_id`.");
          const updated = await adjustPantryQuantity(db, ref, args.delta, args.unit);
          if (!updated) {
            return errResult(`Продукт «${ref}» не найден в запасах дома.`);
          }
          return okResult({ ok: true, pantry_item: updated });
        }

        let target: PantryItem | null = null;
        if (args.pantry_item_id) {
          const all = await listPantryItems(db);
          target = all.find((p) => p.id === args.pantry_item_id) ?? null;
        } else {
          const searchStr = (args.query ?? args.display_name ?? "").trim();
          if (!searchStr) return errResult("Укажи `query` / `display_name` или `pantry_item_id`.");
          const matches = await findPantryItemByFuzzyQuery(db, searchStr);
          if (matches.length === 0) return errResult(`Запас «${searchStr}» не найден.`);
          target = matches[0].item;
        }

        if (!target) return errResult("Запас не найден.");
        await deletePantryItem(db, target.id);
        return okResult({ ok: true, deleted_pantry_item: target });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 11. DIRECT OPEN FOOD FACTS LOOKUP & LAB (`lookup_open_food_facts`)
  // ==========================================================================

  server.registerTool(
    "lookup_open_food_facts",
    {
      title: "Прямой запрос в Open Food Facts по штрихкоду или тексту + статистика полноты",
      description:
        "Ищет продукт напрямую в базе Open Food Facts по `barcode` или `search_query` и при `save_evaluation: true` сохраняет аудит в `off_product_evaluations`.",
      inputSchema: {
        barcode: z.string().max(40).optional(),
        search_query: z.string().max(200).optional(),
        page_size: z.number().int().min(1).max(20).optional(),
        save_evaluation: z.boolean().optional(),
        query_note: z.string().max(250).nullable().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (!args.barcode?.trim() && !args.search_query?.trim()) {
          const [stats, recentEvals] = await Promise.all([
            getOffCompletenessStats(db),
            listOffEvaluations(db, 15),
          ]);
          return okResult({
            ok: true,
            mode: "stats_only",
            completeness_stats: stats,
            recent_evaluations: recentEvals,
          });
        }

        if (args.barcode?.trim()) {
          if (args.save_evaluation) {
            const evaluation = await evaluateAndSaveOffProduct(
              db,
              userId,
              args.barcode.trim(),
              args.query_note ?? null
            );
            const stats = await getOffCompletenessStats(db);
            return okResult({
              ok: true,
              mode: "barcode_evaluated",
              found: evaluation.found_in_off,
              evaluation,
              completeness_stats: stats,
            });
          }

          const product = await lookupOpenFoodFactsBarcode(args.barcode.trim());
          return okResult({
            ok: true,
            mode: "barcode_lookup",
            product,
          });
        }

        const products = await searchOpenFoodFactsProducts(
          args.search_query!.trim(),
          args.page_size ?? 8
        );
        let savedEvaluation = null;
        if (args.save_evaluation && products.length > 0 && products[0].barcode) {
          savedEvaluation = await evaluateAndSaveOffProduct(
            db,
            userId,
            products[0].barcode,
            args.query_note ?? args.search_query!.trim()
          );
        }

        return okResult({
          ok: true,
          mode: "text_search",
          query: args.search_query!.trim(),
          count: products.length,
          products,
          saved_evaluation: savedEvaluation,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 12. BODY WEIGHT TRACKING (`manage_body_weight`)
  // ==========================================================================

  server.registerTool(
    "manage_body_weight",
    {
      title: "Дневник веса тела и антропометрии (запись, история, удаление)",
      description:
        "Управляет замерами веса тела (`list | log | delete`): сохраняет вес `weight_kg` (и опционально процент жира `body_fat_pct` и обхват талии `waist_cm`) за выбранную дату, считает прогресс относительно целевого веса `target_weight_kg` и позволяет удалить ошибочную запись по дате или ID.",
      inputSchema: {
        action: z
          .enum(["list", "log", "delete"])
          .describe("Действие: list, log, delete"),
        weight_kg: z
          .number()
          .min(20)
          .max(350)
          .optional()
          .describe("Вес тела в килограммах (например, 81.2)"),
        body_fat_pct: z
          .number()
          .min(2)
          .max(70)
          .nullable()
          .optional()
          .describe("Процент жира в организме, % (опционально)"),
        waist_cm: z
          .number()
          .min(35)
          .max(220)
          .nullable()
          .optional()
          .describe("Обхват талии, см (опционально)"),
        date: z
          .string()
          .optional()
          .describe("Дата замера YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Период в днях для action='list' (по умолчанию 30)"),
        log_id: z.number().int().positive().optional().describe("Точный ID замера веса (для delete)"),
        note: z.string().max(500).nullable().optional().describe("Заметка к замеру (например, 'Натощак утром')"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const [logs, targets] = await Promise.all([
            listBodyWeightLogs(db, { days: args.days ?? 30, timeZone: DEFAULT_TIMEZONE }),
            getNutritionTargets(db, userId),
          ]);
          const latest = logs[0] ?? null;
          const oldest = logs.length > 0 ? logs[logs.length - 1] : null;
          const deltaKg =
            latest && oldest
              ? Number((Number(latest.weight_kg) - Number(oldest.weight_kg)).toFixed(2))
              : null;

          return okResult({
            ok: true,
            count: logs.length,
            latest_weight_kg: latest ? Number(latest.weight_kg) : null,
            target_weight_kg:
              targets.target_weight_kg !== null ? Number(targets.target_weight_kg) : null,
            period_delta_kg: deltaKg,
            logs,
          });
        }

        if (args.action === "log") {
          if (args.weight_kg === undefined) {
            return errResult("Для записи веса укажи `weight_kg` (например, 81.2).");
          }
          const dateStr = resolveDateInput(args.date) ?? formatIsoDate();
          const saved = await upsertBodyWeightLog(db, {
            user_id: userId,
            logged_date: dateStr,
            weight_kg: args.weight_kg,
            body_fat_pct: args.body_fat_pct ?? null,
            waist_cm: args.waist_cm ?? null,
            note: args.note?.trim() || null,
            source: "mcp",
          });
          const targets = await getNutritionTargets(db, userId);
          const toTargetKg =
            targets.target_weight_kg !== null
              ? Number((Number(saved.weight_kg) - Number(targets.target_weight_kg)).toFixed(2))
              : null;

          return okResult({
            ok: true,
            weight_log: saved,
            target_weight_kg:
              targets.target_weight_kg !== null ? Number(targets.target_weight_kg) : null,
            diff_to_target_kg: toTargetKg,
          });
        }

        // action === "delete"
        let targetLog: BodyWeightLog | null = null;
        if (args.log_id) {
          const logs = await listBodyWeightLogs(db, { limit: 200 });
          targetLog = logs.find((l) => l.id === args.log_id) ?? null;
        } else {
          const targetDate = resolveDateInput(args.date) ?? formatIsoDate();
          const dayRows = await listBodyWeightLogs(db, {
            startDate: targetDate,
            endDate: targetDate,
            limit: 1,
          });
          targetLog = dayRows[0] ?? null;
        }

        if (!targetLog) {
          return errResult("Замер веса для удаления не найден.");
        }

        await deleteBodyWeightLog(db, targetLog.id);
        return okResult({
          ok: true,
          deleted_weight_log: targetLog,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 13. COMBINED КБЖУ + BODY WEIGHT ANALYTICS (`get_nutrition_and_weight_stats`)
  // ==========================================================================

  server.registerTool(
    "get_nutrition_and_weight_stats",
    {
      title: "Статистика и динамика КБЖУ + веса тела за 7 / 14 / 30 / 90 дней",
      description:
        "Возвращает сводную аналитику потребления калорий, БЖУ и динамики веса тела (включая 7-дневную скользящую среднюю `weight_ma7_kg`, процент попадания в целевую норму `target_adherence_pct` и изменение веса `weight_delta_kg`) за выбранный период.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(3)
          .max(365)
          .optional()
          .describe("Период статистики в днях: например 7, 14, 30 или 90 (по умолчанию 14)"),
        end_date: z
          .string()
          .optional()
          .describe("Конечная дата периода YYYY-MM-DD или today (по умолчанию сегодня по МСК)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const endDate = resolveDateInput(args.end_date) ?? formatIsoDate();
        const stats = await getNutritionAndWeightAnalytics(db, {
          days: args.days ?? 14,
          endDate,
          timeZone: DEFAULT_TIMEZONE,
        });
        return okResult({
          ok: true,
          ...stats,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
