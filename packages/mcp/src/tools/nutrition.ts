import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addDaysToIsoDate,
  addShoppingItemsBatch,
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
  findPantryItemByFuzzyQuery,
  findShoppingItemsByFuzzyQuery,
  formatIsoDate,
  generateShoppingListFromMealPlan,
  getNutritionDashboardData,
  getOffCompletenessStats,
  getOwnerBotDbClient,
  getOwnerProfile,
  getRecipeWithIngredients,
  getWeekBoundsIso,
  listCalorieLogs,
  listMealPlanEntries,
  listOffEvaluations,
  listPantryItems,
  listRecipes,
  listShoppingItems,
  lookupOpenFoodFactsBarcode,
  markMealCookedOrEaten,
  normalizeIngredientKey,
  normalizeIngredientUnit,
  normalizeTaskTitleForDedup,
  resolveRecipeByFuzzyQuery,
  searchOpenFoodFactsProducts,
  setCaloriesFeatureFlag,
  toggleShoppingItemChecked,
  updateCalorieLog,
  updateMealPlanEntry,
  updatePantryItem,
  updateRecipeWithIngredients,
  upsertPantryItem,
  type CalorieLog,
  type CalorieLogUpdate,
  type IngredientUnit,
  type MealCategory,
  type MealPlanEntryUpdate,
  type MealPlanEntryWithRecipe,
  type MealPlanStatus,
  type MealSlot,
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
  display_name: z.string().min(1).max(200).describe("Название ингредиента (например, 'Куриное филе')"),
  ingredient_key: z.string().max(200).optional().describe("Опциональный нормализованный ключ сопоставления с запасами"),
  amount: z.number().positive().describe("Количество ингредиента (> 0)"),
  unit: FlexibleIngredientUnitSchema.optional().describe("Единица измерения (по умолчанию 'g' или автоопределение)"),
  aisle_group: z
    .string()
    .max(100)
    .optional()
    .describe("Отдел магазина (например, 'Мясо и птица', 'Овощи и зелень', 'Молочное и яйца', 'Бакалея')"),
  is_optional: z.boolean().optional().describe("Опциональный ингредиент (не обязателен при автосборе покупок)"),
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

function parseSingleShoppingToken(raw: string): {
  display_name: string;
  quantity_needed: number;
  unit: IngredientUnit;
  aisle_group: string;
} | null {
  const cleaned = raw.replace(/^[•\-*\s]+/, "").trim();
  if (!cleaned) return null;

  // Match trailing quantity + unit like "молоко 2 л", "куриное филе 600 г", "авокадо 3 шт", "яйца 10"
  const trailingMatch = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(г|гр|грамм|кг|мл|л|литр|шт|штук|уп|упак|пачк[аи]?|ст\.?\s*л\.?|ч\.?\s*л\.?|g|kg|ml|l|pcs|pack|tbsp|tsp)?$/iu.exec(
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

function formatRecipeForMcp(recipe: RecipeWithIngredients, includeMacros = true) {
  return {
    id: recipe.id,
    title: recipe.title,
    meal_category: recipe.meal_category,
    default_servings: Number(recipe.default_servings),
    cook_time_minutes: recipe.cook_time_minutes,
    is_favorite: recipe.is_favorite,
    tags: recipe.tags ?? [],
    steps_markdown: recipe.steps_markdown,
    ...(includeMacros
      ? {
          kcal_per_serving:
            recipe.kcal_per_serving !== null ? Number(recipe.kcal_per_serving) : null,
          protein_g: recipe.protein_g !== null ? Number(recipe.protein_g) : null,
          fat_g: recipe.fat_g !== null ? Number(recipe.fat_g) : null,
          carbs_g: recipe.carbs_g !== null ? Number(recipe.carbs_g) : null,
        }
      : {}),
    ingredients: recipe.ingredients.map((ing) => ({
      id: ing.id,
      display_name: ing.display_name,
      ingredient_key: ing.ingredient_key,
      amount: Number(ing.amount),
      unit: ing.unit,
      aisle_group: ing.aisle_group,
      is_optional: ing.is_optional,
    })),
  };
}

function formatMealPlanEntryForMcp(entry: MealPlanEntryWithRecipe, includeMacros = true) {
  const title = entry.recipe?.title ?? entry.custom_meal_title ?? "Блюдо без названия";
  const servings = Number(entry.planned_servings);
  const scale = entry.recipe
    ? servings / Math.max(1, Number(entry.recipe.default_servings))
    : 1;

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
    ...(includeMacros && entry.recipe && entry.recipe.kcal_per_serving !== null
      ? {
          estimated_kcal: Math.round(Number(entry.recipe.kcal_per_serving) * servings),
          estimated_protein_g:
            entry.recipe.protein_g !== null
              ? Number((Number(entry.recipe.protein_g) * scale * Number(entry.recipe.default_servings)).toFixed(1))
              : null,
        }
      : {}),
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
      else if (hay.includes(normQ) || (normQ.length >= 4 && normQ.includes(normalizeTaskTitleForDedup(title)))) {
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
  // 1. NUTRITION OVERVIEW
  // ==========================================================================

  server.registerTool(
    "get_nutrition_overview",
    {
      title: "Обзор питания: меню недели и дня, список покупок по отделам, запасы дома и КБЖУ",
      description:
        "Возвращает полную картину модуля «Питание» вокруг anchor_date (по умолчанию сегодня по МСК): план меню на день и на неделю Пн–Вс, некупленные позиции списка покупок с группировкой по отделам магазина, заканчивающиеся или истекающие запасы дома, статистику полноты Open Food Facts и сводку КБЖУ (если включён флаг enable_calories_off).",
      inputSchema: {
        anchor_date: z
          .string()
          .optional()
          .describe("Опорная дата YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        date: z
          .string()
          .optional()
          .describe("Алиас для anchor_date (YYYY-MM-DD или today/tomorrow)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const anchorDate =
          resolveDateInput(args.anchor_date ?? args.date) ?? formatIsoDate(new Date(), DEFAULT_TIMEZONE);
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
          .map((m) => formatMealPlanEntryForMcp(m, dash.caloriesEnabled));

        const caloriesSummary = dash.caloriesEnabled
          ? {
              date: anchorDate,
              logged_count: dash.todayCalorieLogs.length,
              total_kcal: Number(
                dash.todayCalorieLogs.reduce((s, l) => s + Number(l.kcal), 0).toFixed(1)
              ),
              total_protein_g: Number(
                dash.todayCalorieLogs
                  .reduce((s, l) => s + Number(l.protein_g ?? 0), 0)
                  .toFixed(1)
              ),
              total_fat_g: Number(
                dash.todayCalorieLogs.reduce((s, l) => s + Number(l.fat_g ?? 0), 0).toFixed(1)
              ),
              total_carbs_g: Number(
                dash.todayCalorieLogs.reduce((s, l) => s + Number(l.carbs_g ?? 0), 0).toFixed(1)
              ),
              logs: dash.todayCalorieLogs,
            }
          : null;

        return okResult({
          ok: true,
          anchor_date: anchorDate,
          today_date: dash.todayDate,
          week_start: dash.weekStart,
          week_end: dash.weekEnd,
          calories_feature_enabled: dash.caloriesEnabled,
          day_meals: dayMeals,
          week_meal_plan: dash.weekMealPlan.map((m) =>
            formatMealPlanEntryForMcp(m, dash.caloriesEnabled)
          ),
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
          calories_summary: caloriesSummary,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. RECIPES & STRUCTURED INGREDIENTS
  // ==========================================================================

  server.registerTool(
    "manage_recipe",
    {
      title: "Библиотека рецептов и ингредиентов (список, просмотр, создание, изменение, удаление)",
      description:
        "Полное управление рецептами без знания внутренних ID (нечёткий поиск по названию и тегам). Поддерживает структурированные ингредиенты (display_name, amount, unit, aisle_group, is_optional), шаги приготовления, время, порции, избранное и опциональные КБЖУ.",
      inputSchema: {
        action: z
          .enum(["list", "get", "create", "update", "delete"])
          .describe("Действие: list, get, create, update, delete"),
        query: z
          .string()
          .optional()
          .describe("Нечёткий поиск рецепта по названию или тегу (для get/update/delete, а также фильтр для list)"),
        recipe_id: z.number().int().positive().optional().describe("Точный ID рецепта, если известен"),
        title: z.string().max(250).optional().describe("Название рецепта (для create или переименования в update)"),
        meal_category: z
          .enum(["breakfast", "lunch", "dinner", "snack", "batch_prep"])
          .optional()
          .describe("Категория блюда: breakfast, lunch, dinner, snack, batch_prep (готовка впрок)"),
        favorites_only: z.boolean().optional().describe("Только избранные рецепты (для action='list')"),
        default_servings: z.number().positive().max(30).optional().describe("Базовое число порций (по умолчанию 2)"),
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
          .describe("Пошаговый рецепт (Markdown / список шагов)"),
        tags: z.array(z.string().min(1).max(60)).optional().describe("Теги рецепта (например, ['быстро', 'высокобелковое'])"),
        is_favorite: z.boolean().optional().describe("Отметка избранного рецепта"),
        kcal_per_serving: z.number().min(0).nullable().optional().describe("Ккал на 1 порцию (опционально)"),
        protein_g: z.number().min(0).nullable().optional().describe("Белки на 1 порцию, г (опционально)"),
        fat_g: z.number().min(0).nullable().optional().describe("Жиры на 1 порцию, г (опционально)"),
        carbs_g: z.number().min(0).nullable().optional().describe("Углеводы на 1 порцию, г (опционально)"),
        ingredients: z
          .array(RecipeIngredientDraftSchema)
          .optional()
          .describe("Структурированный список ингредиентов рецепта"),
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
            recipes: recipes.map((r) => formatRecipeForMcp(r, true)),
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
            recipe: formatRecipeForMcp(created, true),
          });
        }

        // Resolve target recipe for get / update / delete
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
              score: m.score,
            })),
          });
        }

        if (args.action === "get") {
          return okResult({
            ok: true,
            recipe: formatRecipeForMcp(recipe, true),
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
              }))
            : undefined;

        const updated = await updateRecipeWithIngredients(db, recipe.id, patch, updatedDrafts);
        return okResult({
          ok: true,
          recipe: formatRecipeForMcp(updated, true),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. MEAL PLAN & COOKING FLOW (WITH PANTRY DEDUCTION)
  // ==========================================================================

  server.registerTool(
    "manage_meal_plan",
    {
      title: "План меню и готовка (расписание блюд, отметка приготовления со списанием запасов)",
      description:
        "Управляет планом питания на день и неделю: просмотр (list), постановка рецепта или произвольного блюда в слот (plan), редактирование (update), отметка приготовленного/съеденного блюда со списанием ингредиентов из запасов дома (mark_cooked) и удаление (delete).",
      inputSchema: {
        action: z
          .enum(["list", "plan", "update", "mark_cooked", "delete"])
          .describe("Действие: list, plan, update, mark_cooked, delete"),
        entry_id: z.number().int().positive().optional().describe("Точный ID записи плана меню, если известен"),
        query: z
          .string()
          .optional()
          .describe("Нечёткий поиск записи меню по названию блюда или слоту (для update / mark_cooked / delete)"),
        plan_date: z
          .string()
          .optional()
          .describe("Дата приёма пищи YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        start_date: z.string().optional().describe("Начало периода для action='list' YYYY-MM-DD"),
        end_date: z.string().optional().describe("Конец периода для action='list' YYYY-MM-DD"),
        meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack", "cook_ahead"])
          .optional()
          .describe("Слот приёма пищи: breakfast (завтрак), lunch (обед), dinner (ужин), snack (перекус), cook_ahead (готовка впрок)"),
        recipe: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Название рецепта (нечёткий поиск) или ID рецепта из библиотеки"),
        custom_meal_title: z
          .string()
          .max(250)
          .nullable()
          .optional()
          .describe("Произвольное название блюда без рецепта из библиотеки (например, 'Доставка боула с лососем')"),
        planned_servings: z
          .number()
          .positive()
          .max(30)
          .optional()
          .describe("Количество порций (по умолчанию берётся из рецепта или 2)"),
        status: z
          .enum(["planned", "cooked", "eaten", "skipped"])
          .optional()
          .describe("Статус блюда (по умолчанию 'planned' при создании, 'cooked' для mark_cooked)"),
        deduct_from_pantry: z
          .boolean()
          .optional()
          .describe("Списать ли ингредиенты рецепта (с учётом масштаба порций) из запасов дома при mark_cooked (по умолчанию true)"),
        notes: z.string().max(1000).nullable().optional().describe("Заметка к приёму пищи"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const anchor = resolveDateInput(args.plan_date) ?? formatIsoDate();
          const week = getWeekBoundsIso(anchor);
          const startDate = resolveDateInput(args.start_date) ?? (args.plan_date ? anchor : week.weekStart);
          const endDate = resolveDateInput(args.end_date) ?? (args.plan_date ? anchor : week.weekEnd);
          const entries = await listMealPlanEntries(db, { startDate, endDate });
          return okResult({
            ok: true,
            start_date: startDate,
            end_date: endDate,
            count: entries.length,
            entries: entries.map((e) => formatMealPlanEntryForMcp(e, true)),
          });
        }

        if (args.action === "plan") {
          const planDate = resolveDateInput(args.plan_date) ?? formatIsoDate();
          let resolvedRecipe: RecipeWithIngredients | null = null;
          let customTitle = args.custom_meal_title?.trim() || null;

          const recipeQuery = args.recipe ?? (customTitle ? null : args.query);
          if (recipeQuery !== undefined && recipeQuery !== null && String(recipeQuery).trim() !== "") {
            const { recipe } = await resolveRecipeByFuzzyQuery(db, recipeQuery);
            if (recipe) {
              resolvedRecipe = recipe;
            } else if (!customTitle && typeof recipeQuery === "string") {
              // Graceful fallback: plan as custom meal title if user named an ad-hoc dish
              customTitle = recipeQuery.trim();
            } else {
              return errResult(`Рецепт «${recipeQuery}» не найден.`);
            }
          }

          if (!resolvedRecipe && !customTitle) {
            return errResult("Для планирования меню укажи `recipe` (название рецепта) или `custom_meal_title`.");
          }

          const slot: MealSlot =
            args.meal_slot ?? inferMealSlotFromCategory(resolvedRecipe?.meal_category);
          const servings =
            args.planned_servings ?? (resolvedRecipe ? Number(resolvedRecipe.default_servings) : 2);

          const created = await createMealPlanEntry(db, {
            user_id: userId,
            plan_date: planDate,
            meal_slot: slot,
            recipe_id: resolvedRecipe ? resolvedRecipe.id : null,
            custom_meal_title: resolvedRecipe ? customTitle : customTitle,
            planned_servings: servings,
            status: args.status ?? "planned",
            notes: args.notes?.trim() || null,
          });

          return okResult({
            ok: true,
            meal_plan_entry: formatMealPlanEntryForMcp(
              { ...created, recipe: resolvedRecipe },
              true
            ),
            matched_library_recipe: Boolean(resolvedRecipe),
          });
        }

        // Resolve existing meal plan entry for update / mark_cooked / delete
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
            deleted_entry: formatMealPlanEntryForMcp(target, false),
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
            entry: formatMealPlanEntryForMcp({ ...res.entry, recipe: target.recipe }, true),
            deducted_from_pantry: deductFromPantry,
            deducted_ingredients_count: res.deductedIngredientsCount,
          });
        }

        // action === "update"
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
          entry: formatMealPlanEntryForMcp({ ...updated, recipe: updatedRecipe }, true),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. SMART SHOPPING LIST (MULTI-ITEM ADD, FUZZY CHECK, MENU GENERATION WITH PANTRY SUBTRACTION)
  // ==========================================================================

  server.registerTool(
    "manage_shopping_list",
    {
      title: "Умный список покупок (пакетное добавление, отметка купленного, автосбор по меню с вычитанием запасов дома)",
      description:
        "Управляет списком покупок без знания ID: добавляет сразу несколько позиций из одной фразы или массива (add_items), отмечает купленное нечётким поиском (check_item), автоматически собирает недостающие ингредиенты по плану меню за вычетом домашних запасов pantry_items (generate_from_menu), очищает купленное с опцией переноса прямо в запасы дома (clear_checked + move_to_pantry) и удаляет позиции (delete).",
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
          .describe(
            "Действие: list, add_items (или add), check_item (или check/uncheck), generate_from_menu, clear_checked (или move_checked_to_pantry), delete"
          ),
        include_checked: z
          .boolean()
          .optional()
          .describe("Включить уже отмеченные купленные позиции в list (по умолчанию true)"),
        items: z
          .array(ShoppingBatchItemInputSchema)
          .optional()
          .describe("Массив продуктов для добавления (строки вида 'молоко 2 л' или объекты с display_name, quantity_needed, unit, aisle_group)"),
        phrase: z
          .string()
          .max(1000)
          .optional()
          .describe("Естественная фраза со списком покупок (например, 'молоко 2 л, яйца 10 шт и авокадо 3 шт')"),
        item_name: z
          .string()
          .max(250)
          .optional()
          .describe("Одиночное название продукта (для add_items или нечёткого поиска при check_item/delete)"),
        quantity_needed: z.number().positive().optional().describe("Количество для одиночного добавления"),
        unit: FlexibleIngredientUnitSchema.optional().describe("Единица измерения для одиночного добавления"),
        aisle_group: z.string().max(100).optional().describe("Отдел магазина (автоопределяется, если не передан)"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Текстовый запрос для нечёткого поиска позиции в списке покупок без ID (check_item / delete)"),
        queries: z
          .array(z.string().min(1).max(250))
          .optional()
          .describe("Несколько названий купленных позиций сразу (например, ['молоко', 'яйца']) для пакетной отметки check_item"),
        item_id: z.number().int().positive().optional().describe("Точный ID позиции списка покупок, если известен"),
        checked: z
          .boolean()
          .optional()
          .describe("Статус отметки для check_item (по умолчанию true — куплено, false — снять галочку)"),
        start_date: z
          .string()
          .optional()
          .describe("Начало периода меню YYYY-MM-DD для generate_from_menu (по умолчанию понедельник текущей недели)"),
        end_date: z
          .string()
          .optional()
          .describe("Конец периода меню YYYY-MM-DD для generate_from_menu (по умолчанию воскресенье текущей недели)"),
        anchor_date: z
          .string()
          .optional()
          .describe("Опорная дата недели для generate_from_menu (по умолчанию сегодня по МСК)"),
        replace_unchecked_meal_plan_items: z
          .boolean()
          .optional()
          .describe("Обновить ли предыдущие некупленные авто-позиции из меню при generate_from_menu (по умолчанию true)"),
        move_to_pantry: z
          .boolean()
          .optional()
          .describe("При clear_checked: перенести ли купленные продукты в запасы дома pantry_items (по умолчанию false для clear_checked, true для move_checked_to_pantry)"),
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
            if (args.quantity_needed !== undefined || args.unit !== undefined || args.aisle_group !== undefined) {
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
              "Укажи продукты для добавления в `items`, `phrase` или `item_name` (например, phrase='молоко 2 л, яйца 10 шт и авокадо')."
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

        // check_item / check / uncheck / delete
        const desiredChecked =
          args.action === "uncheck" ? false : args.checked !== undefined ? args.checked : true;

        // Multi-query batch check support (e.g. queries=['молоко', 'яйца'])
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
            return errResult("Укажи `query` / `item_name` (название продукта) или `item_id`.");
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

        if (!targetItem) {
          return errResult("Позиция списка покупок не найдена.");
        }

        if (args.action === "delete") {
          await deleteShoppingItem(db, targetItem.id);
          return okResult({
            ok: true,
            deleted_item: targetItem,
          });
        }

        const updated = await toggleShoppingItemChecked(db, targetItem.id, desiredChecked);
        return okResult({
          ok: true,
          item: updated,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. HOME PANTRY INVENTORY
  // ==========================================================================

  server.registerTool(
    "manage_pantry",
    {
      title: "Запасы продуктов дома (инвентарь, остатки, порог пополнения и сроки годности)",
      description:
        "Управляет домашними запасами продуктов (pantry_items), которые автоматически вычитаются при формировании списка покупок по меню и синхронизируют напоминания 'pantry_expiry' при приближении срока годности.",
      inputSchema: {
        action: z
          .enum(["list", "upsert", "adjust", "delete"])
          .describe("Действие: list, upsert (создать/обновить запас), adjust (изменить остаток на +/- дельту), delete"),
        pantry_item_id: z.number().int().positive().optional().describe("Точный ID запаса, если известен"),
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Нечёткий поиск продукта в запасах дома без ID (для adjust / upsert / delete)"),
        display_name: z
          .string()
          .max(200)
          .optional()
          .describe("Название продукта (например, 'Рис басмати', 'Яйца куриные')"),
        quantity_on_hand: z
          .number()
          .min(0)
          .optional()
          .describe("Текущий остаток дома (для upsert)"),
        delta: z
          .number()
          .optional()
          .describe("Изменение остатка со знаком для action='adjust' (например, -200 чтобы списать 200 г или +500 чтобы добавить)"),
        unit: FlexibleIngredientUnitSchema.optional().describe("Единица измерения (g/г, kg/кг, ml/мл, l/л, pcs/шт, pack/уп)"),
        aisle_group: z.string().max(100).optional().describe("Категория / отдел хранения"),
        low_stock_threshold: z
          .number()
          .min(0)
          .nullable()
          .optional()
          .describe("Минимальный остаток, ниже которого продукт помечается как заканчивающийся"),
        expires_on: z
          .string()
          .nullable()
          .optional()
          .describe("Срок годности YYYY-MM-DD или today/+3d (автоматически ставит напоминание в Telegram)"),
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

          // If updating an existing item by ID or fuzzy query without full display_name
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
              if (args.quantity_on_hand !== undefined) {
                patch.quantity_on_hand = args.quantity_on_hand;
              }
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
          if (!name) {
            return errResult("Для добавления/обновления запаса укажи `display_name`.");
          }

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
            return errResult("Для action='adjust' укажи ненулевое изменение `delta` (например, -200 или +500).");
          }
          const ref = args.pantry_item_id ?? args.query ?? args.display_name;
          if (!ref) {
            return errResult("Укажи `query` / `display_name` (название запаса) или `pantry_item_id`.");
          }
          const updated = await adjustPantryQuantity(db, ref, args.delta, args.unit);
          if (!updated) {
            return errResult(
              `Продукт «${ref}» не найден в запасах дома. Используй action='upsert' для добавления нового продукта.`
            );
          }
          return okResult({ ok: true, pantry_item: updated });
        }

        // action === "delete"
        let target: PantryItem | null = null;
        if (args.pantry_item_id) {
          const all = await listPantryItems(db);
          target = all.find((p) => p.id === args.pantry_item_id) ?? null;
        } else {
          const searchStr = (args.query ?? args.display_name ?? "").trim();
          if (!searchStr) {
            return errResult("Укажи `query` / `display_name` или `pantry_item_id` для удаления.");
          }
          const matches = await findPantryItemByFuzzyQuery(db, searchStr);
          if (matches.length === 0) {
            return errResult(`Запас «${searchStr}» не найден.`);
          }
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
  // 6. OPEN FOOD FACTS BARCODE / SEARCH & COMPLETENESS LAB
  // ==========================================================================

  server.registerTool(
    "lookup_open_food_facts",
    {
      title: "Поиск продукта и КБЖУ по штрихкоду или названию в Open Food Facts",
      description:
        "Ищет продукт в открытой базе Open Food Facts по штрихкоду (`barcode`) или текстовому запросу (`search_query`), возвращает КБЖУ на 100 г и при `save_evaluation: true` сохраняет результат проверки полноты данных в таблицу off_product_evaluations.",
      inputSchema: {
        barcode: z
          .string()
          .max(40)
          .optional()
          .describe("Штрихкод продукта (EAN-13 / EAN-8 / UPC, например '4607025392408' или '3017620422003')"),
        search_query: z
          .string()
          .max(200)
          .optional()
          .describe("Текстовый поиск продукта по названию или бренду (если штрихкод не указан)"),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Количество результатов текстового поиска (по умолчанию 8)"),
        save_evaluation: z
          .boolean()
          .optional()
          .describe("Сохранить ли результат проверки штрихкода в лабораторию полноты базы off_product_evaluations"),
        query_note: z
          .string()
          .max(250)
          .nullable()
          .optional()
          .describe("Опциональная пометка при сохранении теста в off_product_evaluations"),
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
  // 7. FEATURE-FLAGGED CALORIE & MACRO LOG (`enable_calories_off`)
  // ==========================================================================

  server.registerTool(
    "manage_calorie_log",
    {
      title: "Дневник калорий и БЖУ + переключатель флага enable_calories_off",
      description:
        "Управляет дневником КБЖУ за выбранную дату (`list | log | update | delete`) и позволяет включить или скрыть учёт калорий на сайте и в сводках (`toggle_feature_flag` -> `enable_calories_off`). При передаче штрихкода `barcode` и веса `grams` умеет автоматически рассчитать КБЖУ через Open Food Facts.",
      inputSchema: {
        action: z
          .enum(["list", "log", "update", "delete", "toggle_feature_flag"])
          .describe("Действие: list, log, update, delete, toggle_feature_flag"),
        date: z
          .string()
          .optional()
          .describe("Дата дневника YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        log_id: z.number().int().positive().optional().describe("Точный ID записи КБЖУ, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск записи дневника калорий по названию блюда/продукта (для update / delete)"),
        meal_slot: z
          .enum(["breakfast", "lunch", "dinner", "snack"])
          .optional()
          .describe("Приём пищи: breakfast, lunch, dinner, snack (по умолчанию 'lunch')"),
        title: z.string().max(250).optional().describe("Название съеденного продукта или блюда"),
        grams: z.number().positive().max(5000).nullable().optional().describe("Вес порции в граммах"),
        kcal: z
          .number()
          .min(0)
          .max(10000)
          .optional()
          .describe("Калорийность порции, ккал (если не указана, но передан barcode, рассчитывается из Open Food Facts)"),
        protein_g: z.number().min(0).max(1000).nullable().optional().describe("Белки, г"),
        fat_g: z.number().min(0).max(1000).nullable().optional().describe("Жиры, г"),
        carbs_g: z.number().min(0).max(1000).nullable().optional().describe("Углеводы, г"),
        barcode: z.string().max(40).nullable().optional().describe("Опциональный штрихкод продукта"),
        enable_calories_off: z
          .boolean()
          .optional()
          .describe("Новое значение флага enable_calories_off для action='toggle_feature_flag'"),
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
          return okResult({
            ok: true,
            enable_calories_off: nextEnabled,
          });
        }

        const summarizeLogs = async (d: string) => {
          const [logs, profile] = await Promise.all([listCalorieLogs(db, d), getOwnerProfile(db)]);
          const flags =
            profile?.feature_flags && typeof profile.feature_flags === "object"
              ? (profile.feature_flags as Record<string, unknown>)
              : {};
          return {
            calories_feature_enabled: Boolean(flags.enable_calories_off),
            date: d,
            count: logs.length,
            totals: {
              kcal: Number(logs.reduce((s, l) => s + Number(l.kcal), 0).toFixed(1)),
              protein_g: Number(logs.reduce((s, l) => s + Number(l.protein_g ?? 0), 0).toFixed(1)),
              fat_g: Number(logs.reduce((s, l) => s + Number(l.fat_g ?? 0), 0).toFixed(1)),
              carbs_g: Number(logs.reduce((s, l) => s + Number(l.carbs_g ?? 0), 0).toFixed(1)),
            },
            logs,
          };
        };

        if (args.action === "list") {
          const summary = await summarizeLogs(dateStr);
          return okResult({ ok: true, ...summary });
        }

        if (args.action === "log") {
          let title = args.title?.trim() || "";
          let kcal = args.kcal;
          let protein = args.protein_g ?? null;
          let fat = args.fat_g ?? null;
          let carbs = args.carbs_g ?? null;
          const grams = args.grams ?? 100;

          if (args.barcode?.trim() && (kcal === undefined || !title)) {
            const off = await lookupOpenFoodFactsBarcode(args.barcode.trim());
            if (off.found) {
              if (!title && off.product_name) title = off.product_name;
              const factor = (grams ?? 100) / 100;
              if (kcal === undefined && off.kcal_100g !== null) {
                kcal = Number((off.kcal_100g * factor).toFixed(1));
              }
              if (protein === null && off.protein_100g !== null) {
                protein = Number((off.protein_100g * factor).toFixed(1));
              }
              if (fat === null && off.fat_100g !== null) {
                fat = Number((off.fat_100g * factor).toFixed(1));
              }
              if (carbs === null && off.carbs_100g !== null) {
                carbs = Number((off.carbs_100g * factor).toFixed(1));
              }
            }
          }

          if (!title) {
            return errResult("Для записи в дневник калорий укажи `title` (или валидный `barcode`).");
          }
          if (kcal === undefined) {
            return errResult("Укажи калорийность `kcal` (или штрихкод `barcode` из базы Open Food Facts).");
          }

          const created = await createCalorieLog(db, {
            user_id: userId,
            logged_date: dateStr,
            meal_slot: args.meal_slot ?? "lunch",
            title,
            grams: args.grams ?? null,
            kcal,
            protein_g: protein,
            fat_g: fat,
            carbs_g: carbs,
            barcode: args.barcode?.trim() || null,
          });

          const summary = await summarizeLogs(dateStr);
          return okResult({
            ok: true,
            created_log: created,
            day_totals: summary.totals,
            calories_feature_enabled: summary.calories_feature_enabled,
          });
        }

        // Resolve target log for update / delete
        const dayLogs = await listCalorieLogs(db, dateStr);
        let target: CalorieLog | undefined;
        if (args.log_id) {
          target = dayLogs.find((l) => l.id === args.log_id);
          if (!target) {
            const { data } = await db
              .from("calorie_logs")
              .select("*")
              .eq("id", args.log_id)
              .maybeSingle();
            if (data) target = data;
          }
        } else {
          const searchQ = (args.query ?? args.title ?? "").trim();
          if (!searchQ) {
            return errResult("Укажи `query` (название блюда) или `log_id`.");
          }
          const normQ = normalizeTaskTitleForDedup(searchQ);
          target = dayLogs.find((l) =>
            normalizeTaskTitleForDedup(l.title).includes(normQ)
          );
        }

        if (!target) {
          return errResult(`Запись КБЖУ не найдена за ${dateStr}.`);
        }

        if (args.action === "delete") {
          await deleteCalorieLog(db, target.id);
          const summary = await summarizeLogs(target.logged_date);
          return okResult({
            ok: true,
            deleted_log: target,
            day_totals: summary.totals,
          });
        }

        const patch: CalorieLogUpdate = {};
        if (args.date !== undefined) patch.logged_date = dateStr;
        if (args.meal_slot !== undefined) patch.meal_slot = args.meal_slot;
        if (args.title !== undefined && args.title.trim()) patch.title = args.title.trim();
        if (args.grams !== undefined) patch.grams = args.grams;
        if (args.kcal !== undefined) patch.kcal = args.kcal;
        if (args.protein_g !== undefined) patch.protein_g = args.protein_g;
        if (args.fat_g !== undefined) patch.fat_g = args.fat_g;
        if (args.carbs_g !== undefined) patch.carbs_g = args.carbs_g;
        if (args.barcode !== undefined) patch.barcode = args.barcode?.trim() || null;

        const updated = await updateCalorieLog(db, target.id, patch);
        const summary = await summarizeLogs(updated.logged_date);
        return okResult({
          ok: true,
          updated_log: updated,
          day_totals: summary.totals,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
