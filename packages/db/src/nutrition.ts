import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { prepareZXingModule as prepareZXingWriterModule, writeBarcode } from "zxing-wasm/writer";
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
  AiCalculatedTargetsResult,
  BodyWeightLog,
  BodyWeightLogInsert,
  CalorieLog,
  CalorieLogInsert,
  CalorieLogSource,
  CalorieLogUpdate,
  ComputedRecipeMacrosSummary,
  DayFoodDiary,
  DayMealDiaryGroup,
  DecodedBarcodeResult,
  DiaryMealSlot,
  FoodDictionaryItem,
  FoodDictionaryItemInsert,
  FoodDictionarySource,
  FuzzyFinanceMatch,
  IngredientUnit,
  MealCategory,
  MealPlanEntry,
  MealPlanEntryInsert,
  MealPlanEntryUpdate,
  MealPlanEntryWithRecipe,
  MealPlanStatus,
  NutritionAndWeightAnalytics,
  NutritionConfiguredVia,
  NutritionGoalMode,
  NutritionSex,
  NutritionTargets,
  NutritionTargetsInsert,
  NutritionWeightDailyPoint,
  OffCompletenessStats,
  OffParsedProduct,
  OffProductEvaluation,
  PantryItem,
  PantryItemInsert,
  PantryItemUpdate,
  PortionMacros,
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

const OFF_USER_AGENT = "LifeOS/2.0 (https://life.vector-bd.top)";

export const DIARY_MEAL_SLOTS: DiaryMealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export const DIARY_MEAL_LABELS: Record<DiaryMealSlot, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус / Другое",
};

function roundQty(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function round1(val: number): number {
  return Math.round((val + Number.EPSILON) * 10) / 10;
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

export function normalizeFoodSearchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}%\s]/gu, " ")
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
// Pure Portion & Ingredient Macro Math (Universal: Browser + Node)
// ============================================================================

export function calculatePortionMacros(
  item: {
    kcal_100g: number | null | undefined;
    protein_100g: number | null | undefined;
    fat_100g: number | null | undefined;
    carbs_100g: number | null | undefined;
    fiber_100g?: number | null | undefined;
  },
  grams: number
): PortionMacros {
  const safeGrams = Math.max(0, round1(Number(grams) || 0));
  const factor = safeGrams / 100;
  return {
    grams: safeGrams,
    kcal: Math.round(Math.max(0, Number(item.kcal_100g ?? 0)) * factor),
    protein_g: round1(Math.max(0, Number(item.protein_100g ?? 0)) * factor),
    fat_g: round1(Math.max(0, Number(item.fat_100g ?? 0)) * factor),
    carbs_g: round1(Math.max(0, Number(item.carbs_100g ?? 0)) * factor),
    fiber_g: round1(Math.max(0, Number(item.fiber_100g ?? 0)) * factor),
  };
}

export function convertIngredientToGrams(
  amount: number,
  unit?: IngredientUnit | string | null,
  defaultPortionG?: number | null
): number {
  const qty = Math.max(0, Number(amount) || 0);
  const u = normalizeIngredientUnit(unit);
  if (u === "g" || u === "ml") return round1(qty);
  if (u === "kg" || u === "l") return round1(qty * 1000);
  if (u === "tbsp") return round1(qty * 15);
  if (u === "tsp") return round1(qty * 5);
  if (u === "pcs") {
    const perPiece =
      defaultPortionG && Number(defaultPortionG) > 0 && Number(defaultPortionG) !== 100
        ? Number(defaultPortionG)
        : 60;
    return round1(qty * perPiece);
  }
  if (u === "pack") {
    const perPack =
      defaultPortionG && Number(defaultPortionG) > 0 && Number(defaultPortionG) !== 100
        ? Number(defaultPortionG)
        : 200;
    return round1(qty * perPack);
  }
  return round1(qty * 100);
}

export function previewRecipeMacrosPure(
  ingredients: Array<{
    amount: number;
    unit?: IngredientUnit | string | null;
    is_optional?: boolean | null;
    grams_equivalent?: number | null;
    default_portion_g?: number | null;
    kcal_100g?: number | null;
    protein_100g?: number | null;
    fat_100g?: number | null;
    carbs_100g?: number | null;
  }>,
  defaultServings = 2
): ComputedRecipeMacrosSummary {
  const nonOptional = ingredients.filter((i) => !i.is_optional);
  const active = nonOptional.length > 0 ? nonOptional : ingredients;

  let totalWeightG = 0;
  let totalKcal = 0;
  let totalProteinG = 0;
  let totalFatG = 0;
  let totalCarbsG = 0;

  for (const ing of active) {
    const grams =
      ing.grams_equivalent !== undefined &&
      ing.grams_equivalent !== null &&
      Number(ing.grams_equivalent) > 0
        ? Number(ing.grams_equivalent)
        : convertIngredientToGrams(ing.amount, ing.unit, ing.default_portion_g);
    const factor = grams / 100;
    totalWeightG += grams;
    totalKcal += Math.max(0, Number(ing.kcal_100g ?? 0)) * factor;
    totalProteinG += Math.max(0, Number(ing.protein_100g ?? 0)) * factor;
    totalFatG += Math.max(0, Number(ing.fat_100g ?? 0)) * factor;
    totalCarbsG += Math.max(0, Number(ing.carbs_100g ?? 0)) * factor;
  }

  const servings = Math.max(1, Number(defaultServings) || 1);
  const roundedTotalWeight = round1(totalWeightG);
  const roundedTotalKcal = Math.round(totalKcal);
  const roundedTotalProtein = round1(totalProteinG);
  const roundedTotalFat = round1(totalFatG);
  const roundedTotalCarbs = round1(totalCarbsG);

  return {
    total_weight_g: roundedTotalWeight,
    total_kcal: roundedTotalKcal,
    total_protein_g: roundedTotalProtein,
    total_fat_g: roundedTotalFat,
    total_carbs_g: roundedTotalCarbs,
    kcal_per_serving: Math.round(totalKcal / servings),
    protein_g: round1(totalProteinG / servings),
    fat_g: round1(totalFatG / servings),
    carbs_g: round1(totalCarbsG / servings),
    kcal_per_100g: roundedTotalWeight > 0 ? round1((totalKcal / roundedTotalWeight) * 100) : 0,
  };
}

// ============================================================================
// Optical Barcode Decoder & Generator (zxing-wasm — Node + Browser Universal)
// ============================================================================

let zxingNodeReaderPrepared = false;
let zxingNodeWriterPrepared = false;

async function ensureNodeZxingWasmLoaded(mode: "reader" | "writer"): Promise<void> {
  if (typeof window !== "undefined") return;
  if (typeof process === "undefined" || !process.versions?.node) return;
  if (mode === "reader" && zxingNodeReaderPrepared) return;
  if (mode === "writer" && zxingNodeWriterPrepared) return;

  try {
    // Dynamic import hidden from client bundlers (Turbopack / Webpack)
    const dynamicImport = new Function("s", "return import(s)") as (
      specifier: string
    ) => Promise<Record<string, unknown>>;
    const nodeModule = (await dynamicImport("node:module")) as {
      createRequire: (url: string) => { resolve: (id: string) => string };
    };
    const nodeFs = (await dynamicImport("node:fs/promises")) as {
      readFile: (path: string) => Promise<Buffer>;
    };
    const req = nodeModule.createRequire(import.meta.url);
    const subpath =
      mode === "reader"
        ? "zxing-wasm/reader/zxing_reader.wasm"
        : "zxing-wasm/writer/zxing_writer.wasm";
    const wasmPath = req.resolve(subpath);
    const buf = await nodeFs.readFile(wasmPath);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;

    if (mode === "reader") {
      await prepareZXingModule({
        overrides: { wasmBinary: ab },
        fireImmediately: true,
      });
      zxingNodeReaderPrepared = true;
    } else {
      await prepareZXingWriterModule({
        overrides: { wasmBinary: ab },
        fireImmediately: true,
      });
      zxingNodeWriterPrepared = true;
    }
  } catch {
    // Fallback to zxing-wasm default loader if subpath resolution differs
    if (mode === "reader") zxingNodeReaderPrepared = true;
    else zxingNodeWriterPrepared = true;
  }
}

export async function decodeBarcodeFromImageBuffer(
  input: Uint8Array | ArrayBuffer | Blob
): Promise<DecodedBarcodeResult | null> {
  await ensureNodeZxingWasmLoaded("reader");

  let normalized: Blob | Uint8Array;
  if (input instanceof Blob) {
    normalized = input;
  } else if (input instanceof Uint8Array) {
    normalized = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    normalized = new Uint8Array(input);
  }

  const results = await readBarcodes(normalized, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    formats: ["EAN-13", "EAN-8", "UPC-A", "UPC-E", "Code128", "QRCode"],
    maxNumberOfSymbols: 4,
  });

  const valid = results.find((r) => r.isValid && r.text && r.text.trim().length > 0);
  if (!valid) {
    // Second pass without format restriction in case of DataBar / ITF / Code39
    const fallbackResults = await readBarcodes(normalized, {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      maxNumberOfSymbols: 4,
    });
    const anyValid = fallbackResults.find((r) => r.text && r.text.trim().length > 0);
    if (!anyValid) return null;
    return {
      barcode: anyValid.text.trim(),
      format: String(anyValid.format),
    };
  }

  return {
    barcode: valid.text.trim(),
    format: String(valid.format),
  };
}

export async function generateBarcodePngBuffer(
  text: string,
  format: "EAN-13" | "EAN-8" | "UPC-A" | "Code128" | "QRCode" = "EAN-13"
): Promise<Uint8Array> {
  await ensureNodeZxingWasmLoaded("writer");
  const result = await writeBarcode(text.trim(), {
    format,
    scale: 4,
    withQuietZones: true,
  });
  if (!result.image) {
    throw new Error(result.error || `Не удалось сгенерировать штрихкод ${text}`);
  }
  const ab = await result.image.arrayBuffer();
  return new Uint8Array(ab);
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
// 3-Tier Open Food Auto-Lookup (Curated Dictionary -> Open Food Facts -> AI)
// ============================================================================

function scoreFoodItemAgainstQuery(item: FoodDictionaryItem, normQ: string): number {
  const normItem = normalizeFoodSearchKey(item.normalized_name || item.display_name);
  const normDisplay = normalizeFoodSearchKey(item.display_name);
  const normBrand = item.brand ? normalizeFoodSearchKey(item.brand) : "";

  if (!normQ) return 0.5;
  if (item.barcode && item.barcode === normQ) return 1.0;
  if (normItem === normQ || normDisplay === normQ) return 1.0;
  if (normItem.startsWith(`${normQ} `) || normDisplay.startsWith(`${normQ} `)) return 0.94;
  if (normItem.includes(normQ) || normDisplay.includes(normQ)) return 0.88;
  if (normQ.length >= 4 && (normQ.includes(normItem) || normQ.includes(normDisplay))) {
    return 0.82;
  }

  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  if (qWords.length === 0) return 0;

  const hay = `${normItem} ${normDisplay} ${normBrand}`.trim();
  const hayWords = hay.split(" ").filter(Boolean);
  let matchedWeight = 0;

  for (const qw of qWords) {
    if (/^\d+%?$/.test(qw)) {
      if (hayWords.includes(qw)) matchedWeight += 1.0;
      continue;
    }
    const stemLen = qw.length >= 6 ? 5 : qw.length >= 4 ? 4 : qw.length;
    const stem = qw.slice(0, stemLen);
    if (hayWords.some((hw) => hw === qw)) {
      matchedWeight += 1.0;
    } else if (hayWords.some((hw) => hw.startsWith(stem) || qw.startsWith(hw.slice(0, 4)))) {
      matchedWeight += 0.86;
    } else if (stem.length >= 4 && hay.includes(stem)) {
      matchedWeight += 0.7;
    }
  }

  const ratio = matchedWeight / qWords.length;
  if (ratio <= 0) return 0;

  // Prefer concise reference entries when overlap ratio is equal
  const brevityBonus = Math.max(0, 0.05 - Math.max(0, hayWords.length - qWords.length) * 0.008);
  const curatedBonus = item.source === "open_reference" ? 0.02 : 0;
  return Math.min(0.92, roundQty(ratio * 0.85 + brevityBonus + curatedBonus));
}

export async function listFoodDictionaryHighlights(
  db: TypedSupabaseClient,
  limit = 24
): Promise<FoodDictionaryItem[]> {
  const { data, error } = await db
    .from("food_items_dictionary")
    .select("*")
    .order("user_id", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function searchFoodDictionaryLocal(
  db: TypedSupabaseClient,
  query: string,
  limit = 12
): Promise<Array<{ item: FoodDictionaryItem; score: number }>> {
  const normQ = normalizeFoodSearchKey(query);
  if (!normQ) {
    const highlights = await listFoodDictionaryHighlights(db, limit);
    return highlights.map((item) => ({ item, score: 0.5 }));
  }

  const cleanDigits = query.replace(/[^\d]/g, "");
  if (cleanDigits.length >= 8 && cleanDigits.length === query.trim().length) {
    const { data: barcodeRows, error: bcErr } = await db
      .from("food_items_dictionary")
      .select("*")
      .eq("barcode", cleanDigits)
      .limit(5);
    if (bcErr) throw bcErr;
    if (barcodeRows && barcodeRows.length > 0) {
      return barcodeRows.map((item) => ({ item, score: 1.0 }));
    }
  }

  // Build stem ilike filters so Russian inflections ("куриную грудку", "вареная гречка", "творога 5%") match cleanly
  const stems = Array.from(
    new Set(
      normQ
        .split(" ")
        .filter((w) => w.length >= 3)
        .map((w) => w.slice(0, w.length >= 6 ? 5 : w.length >= 4 ? 4 : 3))
    )
  ).slice(0, 4);

  let builder = db.from("food_items_dictionary").select("*");
  if (stems.length > 0) {
    const orClauses = stems.flatMap((s) => [
      `normalized_name.ilike.%${s}%`,
      `display_name.ilike.%${s}%`,
    ]);
    builder = builder.or(orClauses.join(","));
  } else {
    builder = builder.or(
      `normalized_name.ilike.%${normQ}%,display_name.ilike.%${normQ}%`
    );
  }

  const { data, error } = await builder.limit(80);
  if (error) throw error;

  const scored = (data ?? [])
    .map((item) => ({
      item,
      score: scoreFoodItemAgainstQuery(item, normQ),
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

export async function cacheFoodDictionaryItem(
  db: TypedSupabaseClient,
  userId: string,
  input: {
    display_name: string;
    normalized_name?: string;
    brand?: string | null;
    barcode?: string | null;
    kcal_100g: number;
    protein_100g: number;
    fat_100g: number;
    carbs_100g: number;
    fiber_100g?: number | null;
    default_portion_g?: number;
    default_unit?: string;
    source?: FoodDictionarySource;
  }
): Promise<FoodDictionaryItem> {
  const normName = normalizeFoodSearchKey(input.normalized_name || input.display_name);
  const cleanBarcode = input.barcode ? input.barcode.replace(/[^\d]/g, "") || null : null;

  if (cleanBarcode) {
    const { data: existingByCode } = await db
      .from("food_items_dictionary")
      .select("*")
      .eq("user_id", userId)
      .eq("barcode", cleanBarcode)
      .limit(1)
      .maybeSingle();

    if (existingByCode) {
      const { data: updated, error: updErr } = await db
        .from("food_items_dictionary")
        .update({
          display_name: input.display_name.trim(),
          normalized_name: normName,
          brand: input.brand ?? existingByCode.brand,
          kcal_100g: round1(Math.max(0, Number(input.kcal_100g))),
          protein_100g: round1(Math.max(0, Number(input.protein_100g))),
          fat_100g: round1(Math.max(0, Number(input.fat_100g))),
          carbs_100g: round1(Math.max(0, Number(input.carbs_100g))),
          fiber_100g: round1(Math.max(0, Number(input.fiber_100g ?? 0))),
        })
        .eq("id", existingByCode.id)
        .select("*")
        .single();
      if (updErr) throw updErr;
      return updated;
    }
  }

  const { data: existingByName } = await db
    .from("food_items_dictionary")
    .select("*")
    .eq("user_id", userId)
    .eq("normalized_name", normName)
    .limit(1)
    .maybeSingle();

  if (existingByName) {
    return existingByName;
  }

  const { data, error } = await db
    .from("food_items_dictionary")
    .insert({
      user_id: userId,
      normalized_name: normName,
      display_name: input.display_name.trim(),
      brand: input.brand?.trim() || null,
      barcode: cleanBarcode,
      kcal_100g: round1(Math.max(0, Number(input.kcal_100g))),
      protein_100g: round1(Math.max(0, Number(input.protein_100g))),
      fat_100g: round1(Math.max(0, Number(input.fat_100g))),
      carbs_100g: round1(Math.max(0, Number(input.carbs_100g))),
      fiber_100g: round1(Math.max(0, Number(input.fiber_100g ?? 0))),
      default_portion_g: round1(Math.max(5, Number(input.default_portion_g ?? 100))),
      default_unit: input.default_unit || "g",
      source: input.source ?? "user",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function estimateFoodNutritionViaDeepSeek(
  query: string
): Promise<Omit<FoodDictionaryItemInsert, "id" | "created_at"> | null> {
  const q = query.trim();
  if (!q) return null;

  const apiKey = typeof process !== "undefined" ? process.env.DEEPSEEK_API_KEY : undefined;
  if (!apiKey) return null;

  const baseUrl =
    (typeof process !== "undefined" && process.env.DEEPSEEK_BASE_URL) ||
    "https://api.deepseek.com/v1";
  const model =
    (typeof process !== "undefined" && process.env.DEEPSEEK_MODEL) || "deepseek-chat";

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты точный справочник нутрициологии и пищевой ценности продуктов (USDA / Роспотребнадзор / Скурихин). " +
              "Верни строго JSON со справочной пищевой ценностью продукта или готового блюда НА 100 ГРАММ: " +
              '{"display_name": "Чистое русское название продукта", "kcal_100g": number, "protein_100g": number, "fat_100g": number, "carbs_100g": number, "fiber_100g": number, "default_portion_g": number}. ' +
              "Калорийность на 100 г должна быть согласована с БЖУ (примерно 4*Б + 9*Ж + 4*У).",
          },
          {
            role: "user",
            content: `Продукт или блюдо: ${q}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const kcal = Number(parsed.kcal_100g);
    const protein = Number(parsed.protein_100g);
    const fat = Number(parsed.fat_100g);
    const carbs = Number(parsed.carbs_100g);
    const fiber = Number(parsed.fiber_100g ?? 0);
    const portion = Number(parsed.default_portion_g ?? 100);

    if (
      !Number.isFinite(kcal) ||
      kcal < 0 ||
      kcal > 950 ||
      !Number.isFinite(protein) ||
      !Number.isFinite(fat) ||
      !Number.isFinite(carbs)
    ) {
      return null;
    }

    const displayName = String(parsed.display_name || q).trim();
    return {
      user_id: null,
      normalized_name: normalizeFoodSearchKey(displayName),
      display_name: displayName,
      brand: null,
      barcode: null,
      kcal_100g: round1(kcal),
      protein_100g: round1(Math.max(0, protein)),
      fat_100g: round1(Math.max(0, fat)),
      carbs_100g: round1(Math.max(0, carbs)),
      fiber_100g: round1(Math.max(0, Number.isFinite(fiber) ? fiber : 0)),
      default_portion_g: round1(
        Number.isFinite(portion) && portion >= 5 && portion <= 1000 ? portion : 100
      ),
      default_unit: "g",
      source: "ai_estimated",
    };
  } catch {
    return null;
  }
}

export async function lookupBarcodeWithAutoCache(
  db: TypedSupabaseClient,
  userId: string,
  barcode: string,
  queryNote?: string | null
): Promise<{ item: FoodDictionaryItem | null; offProduct: OffParsedProduct }> {
  const cleanCode = barcode.replace(/[^\d]/g, "");
  if (!cleanCode) {
    return {
      item: null,
      offProduct: {
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
        fiber_100g: null,
        raw: null,
      },
    };
  }

  // Tier 1: Check cached dictionary first
  const { data: cached } = await db
    .from("food_items_dictionary")
    .select("*")
    .eq("barcode", cleanCode)
    .order("user_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    const offFromCache: OffParsedProduct = {
      barcode: cleanCode,
      found: true,
      product_name: cached.display_name,
      brands: cached.brand,
      quantity: `${Number(cached.default_portion_g)} ${cached.default_unit}`,
      has_complete_macros: true,
      kcal_100g: Number(cached.kcal_100g),
      protein_100g: Number(cached.protein_100g),
      fat_100g: Number(cached.fat_100g),
      carbs_100g: Number(cached.carbs_100g),
      fiber_100g: cached.fiber_100g !== null ? Number(cached.fiber_100g) : 0,
      raw: { cached_food_item_id: cached.id, source: cached.source },
    };
    return { item: cached, offProduct: offFromCache };
  }

  // Tier 2: Live Open Food Facts barcode lookup + audit record
  const offProduct = await lookupOpenFoodFactsBarcode(cleanCode);
  if (userId) {
    await db.from("off_product_evaluations").upsert(
      {
        user_id: userId,
        barcode: cleanCode,
        query_note: queryNote ?? null,
        found_in_off: offProduct.found,
        product_name: offProduct.product_name,
        brands: offProduct.brands,
        has_complete_macros: offProduct.has_complete_macros,
        kcal_100g: offProduct.kcal_100g,
        protein_100g: offProduct.protein_100g,
        fat_100g: offProduct.fat_100g,
        carbs_100g: offProduct.carbs_100g,
        raw_off_response: (offProduct.raw ?? null) as Json,
        tested_at: new Date().toISOString(),
      },
      { onConflict: "user_id,barcode" }
    );
  }

  if (offProduct.found && offProduct.product_name && offProduct.kcal_100g !== null && userId) {
    const displayTitle = offProduct.brands
      ? `${offProduct.product_name} (${offProduct.brands.split(",")[0].trim()})`
      : offProduct.product_name;
    const saved = await cacheFoodDictionaryItem(db, userId, {
      display_name: displayTitle,
      brand: offProduct.brands,
      barcode: cleanCode,
      kcal_100g: offProduct.kcal_100g,
      protein_100g: offProduct.protein_100g ?? 0,
      fat_100g: offProduct.fat_100g ?? 0,
      carbs_100g: offProduct.carbs_100g ?? 0,
      fiber_100g: offProduct.fiber_100g ?? 0,
      default_portion_g: 100,
      default_unit: "g",
      source: "openfoodfacts",
    });
    return { item: saved, offProduct };
  }

  return { item: null, offProduct };
}

export async function searchFoodNutritionWithAutoLookup(
  db: TypedSupabaseClient,
  userId: string,
  query: string,
  options: {
    allowOff?: boolean;
    allowAiFallback?: boolean;
    limit?: number;
  } = {}
): Promise<FoodDictionaryItem[]> {
  const limit = Math.max(1, Math.min(25, options.limit ?? 10));
  const trimmed = query.trim();
  if (!trimmed) {
    return listFoodDictionaryHighlights(db, limit);
  }

  // Direct numeric barcode query
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly.length >= 8 && digitsOnly.length === trimmed.length) {
    const { item } = await lookupBarcodeWithAutoCache(db, userId, digitsOnly);
    return item ? [item] : [];
  }

  // Tier 1: Local curated + cached dictionary (<20ms)
  const localScored = await searchFoodDictionaryLocal(db, trimmed, limit);
  const topScore = localScored[0]?.score ?? 0;
  if (localScored.length > 0 && topScore >= 0.74) {
    return localScored.map((s) => s.item);
  }

  const results: FoodDictionaryItem[] = localScored.map((s) => s.item);
  const seenNorm = new Set(results.map((r) => r.normalized_name));

  // Tier 2: Live Open Food Facts search
  if (options.allowOff !== false && trimmed.length >= 3) {
    const offProducts = await searchOpenFoodFactsProducts(trimmed, 6);
    const completeOff = offProducts.filter(
      (p) => p.has_complete_macros && p.product_name && p.kcal_100g !== null
    );
    for (const off of completeOff.slice(0, 3)) {
      const title = off.brands
        ? `${off.product_name!} (${off.brands.split(",")[0].trim()})`
        : off.product_name!;
      const norm = normalizeFoodSearchKey(title);
      if (seenNorm.has(norm)) continue;
      if (userId) {
        const cached = await cacheFoodDictionaryItem(db, userId, {
          display_name: title,
          normalized_name: norm,
          brand: off.brands,
          barcode: off.barcode || null,
          kcal_100g: off.kcal_100g!,
          protein_100g: off.protein_100g ?? 0,
          fat_100g: off.fat_100g ?? 0,
          carbs_100g: off.carbs_100g ?? 0,
          fiber_100g: off.fiber_100g ?? 0,
          default_portion_g: 100,
          default_unit: "g",
          source: "openfoodfacts",
        });
        results.push(cached);
        seenNorm.add(norm);
      }
    }
  }

  if (results.length > 0) {
    return results.slice(0, limit);
  }

  // Tier 3: DeepSeek AI reference nutrition fallback (guarantees 100% coverage)
  if (options.allowAiFallback !== false && userId) {
    const aiEst = await estimateFoodNutritionViaDeepSeek(trimmed);
    if (aiEst) {
      const saved = await cacheFoodDictionaryItem(db, userId, {
        display_name: aiEst.display_name,
        normalized_name: aiEst.normalized_name,
        kcal_100g: Number(aiEst.kcal_100g),
        protein_100g: Number(aiEst.protein_100g ?? 0),
        fat_100g: Number(aiEst.fat_100g ?? 0),
        carbs_100g: Number(aiEst.carbs_100g ?? 0),
        fiber_100g: Number(aiEst.fiber_100g ?? 0),
        default_portion_g: Number(aiEst.default_portion_g ?? 100),
        default_unit: aiEst.default_unit ?? "g",
        source: "ai_estimated",
      });
      return [saved];
    }
  }

  return results.slice(0, limit);
}

// ============================================================================
// Recipes & Structured Ingredients (With Auto-Computed КБЖУ)
// ============================================================================

export interface RecipeIngredientDraft {
  display_name: string;
  ingredient_key?: string;
  amount: number;
  unit?: IngredientUnit | string;
  aisle_group?: string;
  is_optional?: boolean;
  grams_equivalent?: number | null;
  kcal_100g?: number | null;
  protein_100g?: number | null;
  fat_100g?: number | null;
  carbs_100g?: number | null;
}

export async function computeRecipeMacrosFromIngredients(
  db: TypedSupabaseClient,
  userId: string,
  ingredients: RecipeIngredientDraft[],
  defaultServings = 2,
  options: { allowRemoteLookup?: boolean } = {}
): Promise<{
  enrichedIngredients: Array<{
    display_name: string;
    ingredient_key: string;
    amount: number;
    unit: IngredientUnit;
    aisle_group: string;
    is_optional: boolean;
    grams_equivalent: number;
    kcal_100g: number;
    protein_100g: number;
    fat_100g: number;
    carbs_100g: number;
  }>;
  summary: ComputedRecipeMacrosSummary;
}> {
  const validDrafts = ingredients.filter(
    (i) => i.display_name && i.display_name.trim() && Number(i.amount) > 0
  );

  const enriched: Array<{
    display_name: string;
    ingredient_key: string;
    amount: number;
    unit: IngredientUnit;
    aisle_group: string;
    is_optional: boolean;
    grams_equivalent: number;
    default_portion_g: number;
    kcal_100g: number;
    protein_100g: number;
    fat_100g: number;
    carbs_100g: number;
  }> = [];

  for (const draft of validDrafts) {
    const unit = normalizeIngredientUnit(draft.unit);
    const amount = roundQty(Number(draft.amount));
    const ingredientKey =
      draft.ingredient_key && draft.ingredient_key.trim()
        ? normalizeIngredientKey(draft.ingredient_key)
        : normalizeIngredientKey(draft.display_name);

    const hasExplicitMacros =
      draft.kcal_100g !== undefined &&
      draft.kcal_100g !== null &&
      Number.isFinite(Number(draft.kcal_100g));

    let matchedItem: FoodDictionaryItem | null = null;
    if (!hasExplicitMacros) {
      const found = await searchFoodNutritionWithAutoLookup(
        db,
        userId,
        draft.display_name,
        {
          allowOff: options.allowRemoteLookup !== false,
          allowAiFallback: options.allowRemoteLookup !== false,
          limit: 1,
        }
      );
      matchedItem = found[0] ?? null;
    }

    const defaultPortionG = matchedItem ? Number(matchedItem.default_portion_g) : 100;
    const gramsEquivalent =
      draft.grams_equivalent !== undefined &&
      draft.grams_equivalent !== null &&
      Number(draft.grams_equivalent) > 0
        ? round1(Number(draft.grams_equivalent))
        : convertIngredientToGrams(amount, unit, defaultPortionG);

    const kcal100 = hasExplicitMacros
      ? round1(Math.max(0, Number(draft.kcal_100g)))
      : round1(Number(matchedItem?.kcal_100g ?? 0));
    const protein100 =
      draft.protein_100g !== undefined && draft.protein_100g !== null
        ? round1(Math.max(0, Number(draft.protein_100g)))
        : round1(Number(matchedItem?.protein_100g ?? 0));
    const fat100 =
      draft.fat_100g !== undefined && draft.fat_100g !== null
        ? round1(Math.max(0, Number(draft.fat_100g)))
        : round1(Number(matchedItem?.fat_100g ?? 0));
    const carbs100 =
      draft.carbs_100g !== undefined && draft.carbs_100g !== null
        ? round1(Math.max(0, Number(draft.carbs_100g)))
        : round1(Number(matchedItem?.carbs_100g ?? 0));

    enriched.push({
      display_name: draft.display_name.trim(),
      ingredient_key: ingredientKey,
      amount,
      unit,
      aisle_group: draft.aisle_group?.trim() || "Прочее",
      is_optional: Boolean(draft.is_optional),
      grams_equivalent: gramsEquivalent,
      default_portion_g: defaultPortionG,
      kcal_100g: kcal100,
      protein_100g: protein100,
      fat_100g: fat100,
      carbs_100g: carbs100,
    });
  }

  const summary = previewRecipeMacrosPure(enriched, defaultServings);

  return {
    enrichedIngredients: enriched.map(({ default_portion_g: _unused, ...rest }) => rest),
    summary,
  };
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
  const defaultServings = Math.max(1, Number(recipeInput.default_servings ?? 2));
  const computed =
    ingredients.length > 0
      ? await computeRecipeMacrosFromIngredients(
          db,
          recipeInput.user_id,
          ingredients,
          defaultServings
        )
      : null;

  const preparedRecipe: RecipeInsert = computed
    ? {
        ...recipeInput,
        default_servings: defaultServings,
        total_weight_g: computed.summary.total_weight_g,
        total_kcal: computed.summary.total_kcal,
        total_protein_g: computed.summary.total_protein_g,
        total_fat_g: computed.summary.total_fat_g,
        total_carbs_g: computed.summary.total_carbs_g,
        kcal_per_serving: computed.summary.kcal_per_serving,
        protein_g: computed.summary.protein_g,
        fat_g: computed.summary.fat_g,
        carbs_g: computed.summary.carbs_g,
        kcal_per_100g: computed.summary.kcal_per_100g,
      }
    : recipeInput;

  const { data: recipe, error: recErr } = await db
    .from("recipes")
    .insert(preparedRecipe)
    .select("*")
    .single();
  if (recErr) throw recErr;

  let insertedIngs: RecipeIngredient[] = [];
  if (computed && computed.enrichedIngredients.length > 0) {
    const rows: RecipeIngredientInsert[] = computed.enrichedIngredients.map((i) => ({
      user_id: recipe.user_id,
      recipe_id: recipe.id,
      display_name: i.display_name,
      ingredient_key: i.ingredient_key,
      amount: i.amount,
      unit: i.unit,
      aisle_group: i.aisle_group,
      is_optional: i.is_optional,
      grams_equivalent: i.grams_equivalent,
      kcal_100g: i.kcal_100g,
      protein_100g: i.protein_100g,
      fat_100g: i.fat_100g,
      carbs_100g: i.carbs_100g,
    }));

    const { data: ingData, error: ingErr } = await db
      .from("recipe_ingredients")
      .insert(rows)
      .select("*");
    if (ingErr) throw ingErr;
    insertedIngs = ingData ?? [];
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
  const current = await getRecipeWithIngredients(db, id);
  if (!current) throw new Error("Рецепт не найден");

  const nextServings = Math.max(
    1,
    Number(patch.default_servings ?? current.default_servings ?? 2)
  );
  let nextPatch: RecipeUpdate = { ...patch };

  if (ingredients !== undefined) {
    const computed = await computeRecipeMacrosFromIngredients(
      db,
      current.user_id,
      ingredients,
      nextServings
    );

    if (computed.enrichedIngredients.length > 0) {
      nextPatch = {
        ...nextPatch,
        total_weight_g: computed.summary.total_weight_g,
        total_kcal: computed.summary.total_kcal,
        total_protein_g: computed.summary.total_protein_g,
        total_fat_g: computed.summary.total_fat_g,
        total_carbs_g: computed.summary.total_carbs_g,
        kcal_per_serving: computed.summary.kcal_per_serving,
        protein_g: computed.summary.protein_g,
        fat_g: computed.summary.fat_g,
        carbs_g: computed.summary.carbs_g,
        kcal_per_100g: computed.summary.kcal_per_100g,
      };
    }

    const { error: delErr } = await db
      .from("recipe_ingredients")
      .delete()
      .eq("recipe_id", id);
    if (delErr) throw delErr;

    if (computed.enrichedIngredients.length > 0) {
      const rows: RecipeIngredientInsert[] = computed.enrichedIngredients.map((i) => ({
        user_id: current.user_id,
        recipe_id: id,
        display_name: i.display_name,
        ingredient_key: i.ingredient_key,
        amount: i.amount,
        unit: i.unit,
        aisle_group: i.aisle_group,
        is_optional: i.is_optional,
        grams_equivalent: i.grams_equivalent,
        kcal_100g: i.kcal_100g,
        protein_100g: i.protein_100g,
        fat_100g: i.fat_100g,
        carbs_100g: i.carbs_100g,
      }));
      const { error: insErr } = await db.from("recipe_ingredients").insert(rows);
      if (insErr) throw insErr;
    }
  } else if (
    patch.default_servings !== undefined &&
    current.ingredients.length > 0 &&
    current.total_kcal !== null
  ) {
    const summary = previewRecipeMacrosPure(
      current.ingredients.map((i) => ({
        amount: Number(i.amount),
        unit: i.unit,
        is_optional: i.is_optional,
        grams_equivalent: i.grams_equivalent !== null ? Number(i.grams_equivalent) : null,
        kcal_100g: i.kcal_100g !== null ? Number(i.kcal_100g) : null,
        protein_100g: i.protein_100g !== null ? Number(i.protein_100g) : null,
        fat_100g: i.fat_100g !== null ? Number(i.fat_100g) : null,
        carbs_100g: i.carbs_100g !== null ? Number(i.carbs_100g) : null,
      })),
      nextServings
    );
    nextPatch = {
      ...nextPatch,
      kcal_per_serving: summary.kcal_per_serving,
      protein_g: summary.protein_g,
      fat_g: summary.fat_g,
      carbs_g: summary.carbs_g,
    };
  }

  const { error: recErr } = await db.from("recipes").update(nextPatch).eq("id", id);
  if (recErr) throw recErr;

  const full = await getRecipeWithIngredients(db, id);
  if (!full) throw new Error("Рецепт не найден после обновления");
  return full;
}

export async function recalculateAllRecipesMacros(
  db: TypedSupabaseClient,
  userId?: string
): Promise<RecipeWithIngredients[]> {
  const recipes = await listRecipes(db);
  const updated: RecipeWithIngredients[] = [];
  for (const r of recipes) {
    if (userId && r.user_id !== userId) continue;
    if (r.ingredients.length === 0) {
      updated.push(r);
      continue;
    }
    const drafts: RecipeIngredientDraft[] = r.ingredients.map((ing) => ({
      display_name: ing.display_name,
      ingredient_key: ing.ingredient_key,
      amount: Number(ing.amount),
      unit: ing.unit as IngredientUnit,
      aisle_group: ing.aisle_group,
      is_optional: ing.is_optional,
    }));
    const refreshed = await updateRecipeWithIngredients(
      db,
      r.id,
      { default_servings: r.default_servings },
      drafts
    );
    updated.push(refreshed);
  }
  return updated;
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
// Open Food Facts HTTP Client & Completeness Audit
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
  const fiber = parseNumberOrNull(nutriments.fiber_100g);

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
    fiber_100g: fiber,
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
        fiber_100g: fiber,
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
      fiber_100g: null,
      raw: null,
    };
  }

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    cleanCode
  )}?fields=code,product_name,product_name_ru,brands,quantity,nutriments`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
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
        fiber_100g: null,
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
        fiber_100g: null,
        raw: { status: json.status ?? 0 },
      };
    }

    return parseOffNutriments(cleanCode, json.product);
  } catch {
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
      fiber_100g: null,
      raw: { timeout_or_network_error: true },
    };
  }
}

export async function searchOpenFoodFactsProducts(
  query: string,
  pageSize = 8
): Promise<OffParsedProduct[]> {
  const q = query.trim();
  if (!q) return [];
  const hasCyrillic = /[а-яё]/i.test(q);
  const host = hasCyrillic ? "https://ru.openfoodfacts.org" : "https://world.openfoodfacts.org";
  const url =
    `${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=${Math.min(20, Math.max(1, pageSize))}` +
    `&fields=code,product_name,product_name_ru,brands,quantity,nutriments`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { products?: Record<string, unknown>[] };
    return (json.products ?? [])
      .filter((p) => p && p.code)
      .map((p) => parseOffNutriments(String(p.code), p));
  } catch {
    return [];
  }
}

export async function evaluateAndSaveOffProduct(
  db: TypedSupabaseClient,
  userId: string,
  barcode: string,
  queryNote?: string | null
): Promise<OffProductEvaluation> {
  const parsed = await lookupOpenFoodFactsBarcode(barcode);
  const cleanCode = parsed.barcode || barcode.trim();

  if (parsed.found && parsed.product_name && parsed.kcal_100g !== null && userId) {
    const title = parsed.brands
      ? `${parsed.product_name} (${parsed.brands.split(",")[0].trim()})`
      : parsed.product_name;
    await cacheFoodDictionaryItem(db, userId, {
      display_name: title,
      brand: parsed.brands,
      barcode: cleanCode,
      kcal_100g: parsed.kcal_100g,
      protein_100g: parsed.protein_100g ?? 0,
      fat_100g: parsed.fat_100g ?? 0,
      carbs_100g: parsed.carbs_100g ?? 0,
      fiber_100g: parsed.fiber_100g ?? 0,
      default_portion_g: 100,
      default_unit: "g",
      source: "openfoodfacts",
    });
  }

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

// ============================================================================
// Nutrition Targets & AI Primary Calorie/Macro Calculator
// ============================================================================

function buildDefaultUnconfiguredTargets(userId: string): NutritionTargets {
  return {
    user_id: userId,
    is_configured: false,
    kcal_target: 2200,
    protein_target_g: 150,
    fat_target_g: 73,
    carbs_target_g: 235,
    fiber_target_g: 28,
    goal_mode: "maintain",
    sex: null,
    age: null,
    height_cm: null,
    baseline_weight_kg: null,
    target_weight_kg: null,
    activity_level: null,
    ai_explanation: null,
    configured_via: "ai",
    updated_at: new Date().toISOString(),
  };
}

export async function getNutritionTargets(
  db: TypedSupabaseClient,
  userId?: string
): Promise<NutritionTargets> {
  let q = db.from("nutrition_targets").select("*").limit(1);
  if (userId) {
    q = q.eq("user_id", userId);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data;

  const resolvedUserId = userId ?? (await getOwnerProfile(db))?.id ?? "";
  return buildDefaultUnconfiguredTargets(resolvedUserId);
}

export async function upsertNutritionTargets(
  db: TypedSupabaseClient,
  input: NutritionTargetsInsert & { markConfigured?: boolean }
): Promise<NutritionTargets> {
  const { markConfigured, ...rest } = input;
  const isConfigured =
    markConfigured !== undefined
      ? markConfigured
      : rest.is_configured !== undefined
        ? rest.is_configured
        : true;

  const payload: NutritionTargetsInsert = {
    ...rest,
    is_configured: isConfigured,
    kcal_target: Math.min(10000, Math.max(800, Math.round(Number(rest.kcal_target ?? 2200)))),
    protein_target_g: round1(Math.max(20, Number(rest.protein_target_g ?? 150))),
    fat_target_g: round1(Math.max(15, Number(rest.fat_target_g ?? 73))),
    carbs_target_g: round1(Math.max(0, Number(rest.carbs_target_g ?? 235))),
    fiber_target_g:
      rest.fiber_target_g !== undefined && rest.fiber_target_g !== null
        ? round1(Math.max(0, Number(rest.fiber_target_g)))
        : 28,
    configured_via: (rest.configured_via ?? "ai") as NutritionConfiguredVia,
  };

  const { data, error } = await db
    .from("nutrition_targets")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function deterministicTargetsFallback(params: {
  sex?: NutritionSex | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  activityLevel?: string | null;
  goalMode?: NutritionGoalMode | null;
}): AiCalculatedTargetsResult {
  const sex: NutritionSex = params.sex === "female" ? "female" : "male";
  const age = params.age && params.age >= 14 && params.age <= 100 ? params.age : 28;
  const heightCm =
    params.heightCm && params.heightCm >= 120 && params.heightCm <= 230
      ? params.heightCm
      : sex === "male"
        ? 178
        : 165;
  const weightKg =
    params.weightKg && params.weightKg >= 35 && params.weightKg <= 250
      ? params.weightKg
      : sex === "male"
        ? 81.6
        : 62;

  const actRaw = (params.activityLevel ?? "").toLowerCase();
  let actMult = 1.45;
  if (actRaw.includes("низк") || actRaw.includes("сидяч") || actRaw.includes("sedentary")) {
    actMult = 1.25;
  } else if (actRaw.includes("высок") || actRaw.includes("5") || actRaw.includes("6")) {
    actMult = 1.65;
  } else if (actRaw.includes("3") || actRaw.includes("4") || actRaw.includes("умерен")) {
    actMult = 1.5;
  }

  let goalMode: NutritionGoalMode = params.goalMode ?? "maintain";
  if (
    !params.goalMode &&
    params.targetWeightKg &&
    params.targetWeightKg < weightKg - 1.5
  ) {
    goalMode = "lose";
  } else if (
    !params.goalMode &&
    params.targetWeightKg &&
    params.targetWeightKg > weightKg + 1.5
  ) {
    goalMode = "gain";
  }

  const bmr =
    10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
  const tdee = bmr * actMult;

  const kcalDelta =
    goalMode === "lose"
      ? -400
      : goalMode === "recomp"
        ? -180
        : goalMode === "gain"
          ? 280
          : 0;
  const kcalTarget = Math.max(1200, Math.round((tdee + kcalDelta) / 10) * 10);

  const proteinPerKg =
    goalMode === "lose" || goalMode === "recomp" ? 1.9 : goalMode === "gain" ? 1.8 : 1.6;
  const proteinG = Math.round(weightKg * proteinPerKg);
  const fatG = Math.round(weightKg * 0.9);
  const remainingKcal = Math.max(0, kcalTarget - proteinG * 4 - fatG * 9);
  const carbsG = Math.round(remainingKcal / 4);
  const fiberG = Math.max(22, Math.round((kcalTarget / 1000) * 14));

  const modeLabel =
    goalMode === "lose"
      ? "комфортного снижения веса"
      : goalMode === "recomp"
        ? "рекомпозиции тела"
        : goalMode === "gain"
          ? "набора сухой мышечной массы"
          : "поддержания формы";

  return {
    kcal_target: kcalTarget,
    protein_target_g: proteinG,
    fat_target_g: fatG,
    carbs_target_g: carbsG,
    fiber_target_g: fiberG,
    goal_mode: goalMode,
    sex,
    age,
    height_cm: heightCm,
    baseline_weight_kg: weightKg,
    target_weight_kg: params.targetWeightKg ?? null,
    activity_level: params.activityLevel ?? "Умеренная активность",
    ai_explanation:
      `Расчёт по формуле Миффлина — Сан Жеора (BMR ≈ ${Math.round(bmr)} ккал, расход ≈ ${Math.round(tdee)} ккал) ` +
      `для цели «${modeLabel}»: белок ${proteinPerKg} г/кг (${proteinG} г) защищает мышцы и даёт сытость, ` +
      `жиры 0.9 г/кг (${fatG} г) поддерживают гормональный фон, углеводы (${carbsG} г) обеспечивают энергию дня и тренировок.`,
  };
}

export async function calculateNutritionTargetsWithAi(params: {
  prompt?: string | null;
  sex?: NutritionSex | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  activityLevel?: string | null;
  goalMode?: NutritionGoalMode | null;
}): Promise<AiCalculatedTargetsResult> {
  const fallback = deterministicTargetsFallback({
    sex: params.sex,
    age: params.age,
    heightCm: params.heightCm,
    weightKg: params.weightKg,
    targetWeightKg: params.targetWeightKg,
    activityLevel: params.activityLevel,
    goalMode: params.goalMode,
  });

  const apiKey = typeof process !== "undefined" ? process.env.DEEPSEEK_API_KEY : undefined;
  if (!apiKey) return fallback;

  const baseUrl =
    (typeof process !== "undefined" && process.env.DEEPSEEK_BASE_URL) ||
    "https://api.deepseek.com/v1";
  const model =
    (typeof process !== "undefined" && process.env.DEEPSEEK_MODEL) || "deepseek-chat";

  const structuredContext = [
    params.prompt ? `Описание от пользователя: "${params.prompt.trim()}"` : null,
    params.sex ? `Пол: ${params.sex === "male" ? "мужской" : "женский"}` : null,
    params.age ? `Возраст: ${params.age} лет` : null,
    params.heightCm ? `Рост: ${params.heightCm} см` : null,
    params.weightKg ? `Текущий вес: ${params.weightKg} кг` : null,
    params.targetWeightKg ? `Целевой вес: ${params.targetWeightKg} кг` : null,
    params.activityLevel ? `Активность: ${params.activityLevel}` : null,
    params.goalMode ? `Режим цели: ${params.goalMode}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты персональный спортивный нутрициолог и врач доказательной медицины. " +
              "Рассчитай оптимальную дневную норму КБЖУ и клетчатки на основе уравнения Миффлина — Сан Жеора, " +
              "уровня бытовой и тренировочной активности и цели человека. " +
              "Белок: 1.6–2.1 г/кг (выше при дефиците/рекомпозиции/силовых), жиры: 0.8–1.0 г/кг, остаток калорий — углеводы (проверь, чтобы 4*Б + 9*Ж + 4*У ≈ kcal_target ± 25 ккал!). " +
              "Верни СТРОГО JSON со следующими полями:\n" +
              '{\n  "kcal_target": integer (1100..6000),\n  "protein_target_g": number,\n  "fat_target_g": number,\n  "carbs_target_g": number,\n  "fiber_target_g": number,\n' +
              '  "goal_mode": "lose" | "maintain" | "gain" | "recomp",\n  "sex": "male" | "female" | null,\n  "age": integer | null,\n' +
              '  "height_cm": number | null,\n  "baseline_weight_kg": number | null,\n  "target_weight_kg": number | null,\n' +
              '  "activity_level": string,\n  "ai_explanation": "Лаконичное понятное объяснение на русском (2-3 предложения): какой базовый обмен, какой дефицит/профицит выбран и почему такое соотношение БЖУ"\n}',
          },
          {
            role: "user",
            content:
              structuredContext ||
              "Мужчина, 28 лет, 178 см, 81.6 кг, умеренная активность (3 тренировки в неделю), цель — рекомпозиция и снижение веса до 78 кг.",
          },
        ],
      }),
      signal: AbortSignal.timeout(18000),
    });

    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const kcal = Math.round(Number(parsed.kcal_target));
    const protein = round1(Number(parsed.protein_target_g));
    const fat = round1(Number(parsed.fat_target_g));
    const carbs = round1(Number(parsed.carbs_target_g));
    const fiber = round1(Number(parsed.fiber_target_g ?? 28));

    if (
      !Number.isFinite(kcal) ||
      kcal < 900 ||
      kcal > 8000 ||
      !Number.isFinite(protein) ||
      !Number.isFinite(fat) ||
      !Number.isFinite(carbs)
    ) {
      return fallback;
    }

    const rawGoal = String(parsed.goal_mode || fallback.goal_mode);
    const goalMode: NutritionGoalMode =
      rawGoal === "lose" || rawGoal === "maintain" || rawGoal === "gain" || rawGoal === "recomp"
        ? rawGoal
        : fallback.goal_mode;
    const rawSex = parsed.sex === "male" || parsed.sex === "female" ? parsed.sex : fallback.sex;

    return {
      kcal_target: kcal,
      protein_target_g: protein,
      fat_target_g: fat,
      carbs_target_g: carbs,
      fiber_target_g: Number.isFinite(fiber) && fiber > 0 ? fiber : 28,
      goal_mode: goalMode,
      sex: rawSex,
      age:
        parsed.age !== null && parsed.age !== undefined && Number.isFinite(Number(parsed.age))
          ? Math.round(Number(parsed.age))
          : (params.age ?? null),
      height_cm:
        parsed.height_cm !== null &&
        parsed.height_cm !== undefined &&
        Number.isFinite(Number(parsed.height_cm))
          ? round1(Number(parsed.height_cm))
          : (params.heightCm ?? null),
      baseline_weight_kg:
        parsed.baseline_weight_kg !== null &&
        parsed.baseline_weight_kg !== undefined &&
        Number.isFinite(Number(parsed.baseline_weight_kg))
          ? roundQty(Number(parsed.baseline_weight_kg))
          : (params.weightKg ?? null),
      target_weight_kg:
        parsed.target_weight_kg !== null &&
        parsed.target_weight_kg !== undefined &&
        Number.isFinite(Number(parsed.target_weight_kg))
          ? roundQty(Number(parsed.target_weight_kg))
          : (params.targetWeightKg ?? null),
      activity_level:
        typeof parsed.activity_level === "string" && parsed.activity_level.trim()
          ? parsed.activity_level.trim()
          : (params.activityLevel ?? fallback.activity_level),
      ai_explanation:
        typeof parsed.ai_explanation === "string" && parsed.ai_explanation.trim()
          ? parsed.ai_explanation.trim()
          : fallback.ai_explanation,
    };
  } catch {
    return fallback;
  }
}

// ============================================================================
// Body Weight Logs
// ============================================================================

export async function listBodyWeightLogs(
  db: TypedSupabaseClient,
  options: {
    days?: number;
    startDate?: string;
    endDate?: string;
    limit?: number;
    timeZone?: string;
  } = {}
): Promise<BodyWeightLog[]> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const endDate = options.endDate ?? formatIsoDate(new Date(), tz);
  const startDate =
    options.startDate ??
    (options.days ? addDaysToIsoDate(endDate, -(Math.max(1, options.days) - 1)) : undefined);

  let query = db
    .from("body_weight_logs")
    .select("*")
    .order("logged_date", { ascending: false })
    .order("logged_at", { ascending: false });

  if (startDate) {
    query = query.gte("logged_date", startDate);
  }
  if (options.endDate || options.days) {
    query = query.lte("logged_date", endDate);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getLatestBodyWeight(
  db: TypedSupabaseClient
): Promise<BodyWeightLog | null> {
  const { data, error } = await db
    .from("body_weight_logs")
    .select("*")
    .order("logged_date", { ascending: false })
    .order("logged_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function upsertBodyWeightLog(
  db: TypedSupabaseClient,
  input: BodyWeightLogInsert
): Promise<BodyWeightLog> {
  const loggedDate = input.logged_date ?? formatIsoDate(new Date(), "Europe/Moscow");
  const cleanWeight = roundQty(Number(input.weight_kg));

  const { data: existing } = await db
    .from("body_weight_logs")
    .select("*")
    .eq("user_id", input.user_id)
    .eq("logged_date", loggedDate)
    .order("logged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data: updated, error: updErr } = await db
      .from("body_weight_logs")
      .update({
        weight_kg: cleanWeight,
        body_fat_pct:
          input.body_fat_pct !== undefined ? input.body_fat_pct : existing.body_fat_pct,
        waist_cm: input.waist_cm !== undefined ? input.waist_cm : existing.waist_cm,
        note: input.note !== undefined ? input.note : existing.note,
        source: input.source ?? existing.source,
        logged_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updErr) throw updErr;
    return updated;
  }

  const { data, error } = await db
    .from("body_weight_logs")
    .insert({
      ...input,
      logged_date: loggedDate,
      weight_kg: cleanWeight,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBodyWeightLog(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("body_weight_logs").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Day Food Diary & Smart Calorie Logging
// ============================================================================

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

export interface LogFoodDiaryEntryParams {
  user_id: string;
  logged_date?: string;
  meal_slot?: DiaryMealSlot;
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
  photo_note?: string | null;
}

export async function logFoodDiaryEntry(
  db: TypedSupabaseClient,
  input: LogFoodDiaryEntryParams
): Promise<CalorieLog> {
  const loggedDate = input.logged_date ?? formatIsoDate(new Date(), "Europe/Moscow");
  const mealSlot: DiaryMealSlot = input.meal_slot ?? "snack";

  // Case 1: Logging from a saved Recipe (by servings or grams)
  if (input.recipe_id) {
    const recipe = await getRecipeWithIngredients(db, input.recipe_id);
    if (!recipe) throw new Error(`Рецепт #${input.recipe_id} не найден`);

    const totalWeight = Number(recipe.total_weight_g ?? 0);
    const defaultServings = Math.max(1, Number(recipe.default_servings ?? 1));
    const perServingWeight = totalWeight > 0 ? round1(totalWeight / defaultServings) : null;

    let servings =
      input.servings !== undefined && input.servings !== null && Number(input.servings) > 0
        ? roundQty(Number(input.servings))
        : 1;
    let grams =
      input.grams !== undefined && input.grams !== null && Number(input.grams) > 0
        ? round1(Number(input.grams))
        : perServingWeight !== null
          ? round1(perServingWeight * servings)
          : null;

    let kcal: number;
    let proteinG: number;
    let fatG: number;
    let carbsG: number;

    if (
      input.grams !== undefined &&
      input.grams !== null &&
      Number(input.grams) > 0 &&
      totalWeight > 0 &&
      recipe.total_kcal !== null
    ) {
      const ratio = Number(input.grams) / totalWeight;
      servings = roundQty(ratio * defaultServings);
      kcal = Math.round(Number(recipe.total_kcal) * ratio);
      proteinG = round1(Number(recipe.total_protein_g ?? 0) * ratio);
      fatG = round1(Number(recipe.total_fat_g ?? 0) * ratio);
      carbsG = round1(Number(recipe.total_carbs_g ?? 0) * ratio);
    } else {
      kcal = Math.round(Number(recipe.kcal_per_serving ?? 0) * servings);
      proteinG = round1(Number(recipe.protein_g ?? 0) * servings);
      fatG = round1(Number(recipe.fat_g ?? 0) * servings);
      carbsG = round1(Number(recipe.carbs_g ?? 0) * servings);
    }

    return createCalorieLog(db, {
      user_id: input.user_id,
      logged_date: loggedDate,
      meal_slot: mealSlot,
      title: input.title?.trim() || recipe.title,
      recipe_id: recipe.id,
      servings,
      grams,
      kcal: input.kcal !== undefined && input.kcal !== null ? Math.round(input.kcal) : kcal,
      protein_g: input.protein_g ?? proteinG,
      fat_g: input.fat_g ?? fatG,
      carbs_g: input.carbs_g ?? carbsG,
      fiber_g: input.fiber_g ?? 0,
      source: input.source ?? "recipe",
      photo_note: input.photo_note ?? null,
    });
  }

  // Case 2: Logging from a specific food_items_dictionary row
  if (input.food_item_id) {
    const { data: item, error: itemErr } = await db
      .from("food_items_dictionary")
      .select("*")
      .eq("id", input.food_item_id)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) throw new Error(`Продукт #${input.food_item_id} не найден в справочнике`);

    const grams =
      input.grams !== undefined && input.grams !== null && Number(input.grams) > 0
        ? round1(Number(input.grams))
        : Number(item.default_portion_g || 100);
    const scaled = calculatePortionMacros(item, grams);

    return createCalorieLog(db, {
      user_id: input.user_id,
      logged_date: loggedDate,
      meal_slot: mealSlot,
      title: input.title?.trim() || item.display_name,
      food_item_id: item.id,
      barcode: input.barcode ?? item.barcode,
      grams: scaled.grams,
      kcal:
        input.kcal !== undefined && input.kcal !== null
          ? Math.round(input.kcal)
          : scaled.kcal,
      protein_g: input.protein_g ?? scaled.protein_g,
      fat_g: input.fat_g ?? scaled.fat_g,
      carbs_g: input.carbs_g ?? scaled.carbs_g,
      fiber_g: input.fiber_g ?? scaled.fiber_g,
      source: input.source ?? "web",
      photo_note: input.photo_note ?? null,
    });
  }

  // Case 3: Barcode provided without explicit kcal -> auto-lookup via OFF / dictionary
  if (input.barcode && (input.kcal === undefined || input.kcal === null)) {
    const { item, offProduct } = await lookupBarcodeWithAutoCache(
      db,
      input.user_id,
      input.barcode
    );
    if (item) {
      const grams =
        input.grams !== undefined && input.grams !== null && Number(input.grams) > 0
          ? round1(Number(input.grams))
          : Number(item.default_portion_g || 100);
      const scaled = calculatePortionMacros(item, grams);
      return createCalorieLog(db, {
        user_id: input.user_id,
        logged_date: loggedDate,
        meal_slot: mealSlot,
        title: input.title?.trim() || item.display_name,
        food_item_id: item.id,
        barcode: item.barcode ?? offProduct.barcode,
        grams: scaled.grams,
        kcal: scaled.kcal,
        protein_g: scaled.protein_g,
        fat_g: scaled.fat_g,
        carbs_g: scaled.carbs_g,
        fiber_g: scaled.fiber_g,
        source: input.source ?? "barcode",
        photo_note: input.photo_note ?? null,
      });
    }
  }

  // Case 4: Natural food title provided without explicit kcal -> 3-tier auto-lookup!
  if (input.title && (input.kcal === undefined || input.kcal === null)) {
    const matches = await searchFoodNutritionWithAutoLookup(
      db,
      input.user_id,
      input.title,
      { limit: 1 }
    );
    const best = matches[0];
    if (best) {
      const grams =
        input.grams !== undefined && input.grams !== null && Number(input.grams) > 0
          ? round1(Number(input.grams))
          : Number(best.default_portion_g || 100);
      const scaled = calculatePortionMacros(best, grams);
      return createCalorieLog(db, {
        user_id: input.user_id,
        logged_date: loggedDate,
        meal_slot: mealSlot,
        title: input.title.trim(),
        food_item_id: best.id,
        barcode: input.barcode ?? best.barcode,
        grams: scaled.grams,
        kcal: scaled.kcal,
        protein_g: input.protein_g ?? scaled.protein_g,
        fat_g: input.fat_g ?? scaled.fat_g,
        carbs_g: input.carbs_g ?? scaled.carbs_g,
        fiber_g: input.fiber_g ?? scaled.fiber_g,
        source: input.source ?? "web",
        photo_note: input.photo_note ?? null,
      });
    }
  }

  // Case 5: Direct explicit macros (e.g. photo_ai estimate or manual override)
  if (!input.title || !input.title.trim()) {
    throw new Error("Укажите название блюда или продукта для добавления в дневник");
  }

  return createCalorieLog(db, {
    user_id: input.user_id,
    logged_date: loggedDate,
    meal_slot: mealSlot,
    title: input.title.trim(),
    barcode: input.barcode ?? null,
    grams:
      input.grams !== undefined && input.grams !== null ? round1(Number(input.grams)) : null,
    servings:
      input.servings !== undefined && input.servings !== null
        ? roundQty(Number(input.servings))
        : null,
    kcal: Math.max(0, Math.round(Number(input.kcal ?? 0))),
    protein_g:
      input.protein_g !== undefined && input.protein_g !== null
        ? round1(Number(input.protein_g))
        : 0,
    fat_g:
      input.fat_g !== undefined && input.fat_g !== null ? round1(Number(input.fat_g)) : 0,
    carbs_g:
      input.carbs_g !== undefined && input.carbs_g !== null
        ? round1(Number(input.carbs_g))
        : 0,
    fiber_g:
      input.fiber_g !== undefined && input.fiber_g !== null
        ? round1(Number(input.fiber_g))
        : 0,
    source: input.source ?? "web",
    photo_note: input.photo_note ?? null,
  });
}

export async function updateCalorieLog(
  db: TypedSupabaseClient,
  id: number,
  patch: CalorieLogUpdate
): Promise<CalorieLog> {
  let nextPatch: CalorieLogUpdate = { ...patch };

  const shouldRescaleGrams =
    patch.grams !== undefined &&
    patch.grams !== null &&
    Number(patch.grams) > 0 &&
    patch.kcal === undefined;
  const shouldRescaleServings =
    patch.servings !== undefined &&
    patch.servings !== null &&
    Number(patch.servings) > 0 &&
    patch.kcal === undefined;

  if (shouldRescaleGrams || shouldRescaleServings) {
    const { data: existing } = await db
      .from("calorie_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (existing) {
      if (shouldRescaleGrams && existing.grams && Number(existing.grams) > 0) {
        const ratio = Number(patch.grams) / Number(existing.grams);
        nextPatch = {
          ...nextPatch,
          grams: round1(Number(patch.grams)),
          kcal: Math.round(Number(existing.kcal) * ratio),
          protein_g:
            existing.protein_g !== null ? round1(Number(existing.protein_g) * ratio) : null,
          fat_g: existing.fat_g !== null ? round1(Number(existing.fat_g) * ratio) : null,
          carbs_g:
            existing.carbs_g !== null ? round1(Number(existing.carbs_g) * ratio) : null,
          fiber_g:
            existing.fiber_g !== null ? round1(Number(existing.fiber_g) * ratio) : null,
        };
      } else if (shouldRescaleGrams && existing.food_item_id) {
        const { data: item } = await db
          .from("food_items_dictionary")
          .select("*")
          .eq("id", existing.food_item_id)
          .maybeSingle();
        if (item) {
          const scaled = calculatePortionMacros(item, Number(patch.grams));
          nextPatch = {
            ...nextPatch,
            grams: scaled.grams,
            kcal: scaled.kcal,
            protein_g: scaled.protein_g,
            fat_g: scaled.fat_g,
            carbs_g: scaled.carbs_g,
            fiber_g: scaled.fiber_g,
          };
        }
      } else if (shouldRescaleServings && existing.servings && Number(existing.servings) > 0) {
        const ratio = Number(patch.servings) / Number(existing.servings);
        nextPatch = {
          ...nextPatch,
          servings: roundQty(Number(patch.servings)),
          grams: existing.grams !== null ? round1(Number(existing.grams) * ratio) : null,
          kcal: Math.round(Number(existing.kcal) * ratio),
          protein_g:
            existing.protein_g !== null ? round1(Number(existing.protein_g) * ratio) : null,
          fat_g: existing.fat_g !== null ? round1(Number(existing.fat_g) * ratio) : null,
          carbs_g:
            existing.carbs_g !== null ? round1(Number(existing.carbs_g) * ratio) : null,
        };
      }
    }
  }

  const { data, error } = await db
    .from("calorie_logs")
    .update(nextPatch)
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

export async function findCalorieLogsByFuzzyQuery(
  db: TypedSupabaseClient,
  params: {
    query: string;
    dateStr?: string;
    mealSlot?: DiaryMealSlot;
    timeZone?: string;
  }
): Promise<FuzzyFinanceMatch<CalorieLog>[]> {
  const dateStr =
    params.dateStr ?? formatIsoDate(new Date(), params.timeZone ?? "Europe/Moscow");
  const logs = await listCalorieLogs(db, dateStr);
  const filtered = params.mealSlot
    ? logs.filter((l) => l.meal_slot === params.mealSlot)
    : logs;

  const normQ = normalizeFoodSearchKey(params.query);
  if (!normQ) return filtered.map((item) => ({ item, score: 0.5 }));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);

  const scored: FuzzyFinanceMatch<CalorieLog>[] = [];
  for (const log of filtered) {
    const normTitle = normalizeFoodSearchKey(log.title);
    let score = 0;
    if (normTitle === normQ) score = 1.0;
    else if (normTitle.includes(normQ) || (normQ.length >= 4 && normQ.includes(normTitle))) {
      score = 0.9;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (normTitle.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.8;
    }
    if (score >= 0.4) scored.push({ item: log, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export async function getDayFoodDiary(
  db: TypedSupabaseClient,
  dateStr?: string,
  timeZone = "Europe/Moscow"
): Promise<DayFoodDiary> {
  const effectiveDate = dateStr ?? formatIsoDate(new Date(), timeZone);
  const [targets, entries, dayWeightRows, latestWeight] = await Promise.all([
    getNutritionTargets(db),
    listCalorieLogs(db, effectiveDate),
    listBodyWeightLogs(db, { startDate: effectiveDate, endDate: effectiveDate, limit: 1 }),
    getLatestBodyWeight(db),
  ]);

  const kcalTarget = Math.max(1, Number(targets.kcal_target || 2200));
  let totalKcal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  let totalFiber = 0;

  const entriesBySlot: Record<DiaryMealSlot, CalorieLog[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };

  for (const row of entries) {
    const slot: DiaryMealSlot =
      row.meal_slot === "breakfast" ||
      row.meal_slot === "lunch" ||
      row.meal_slot === "dinner" ||
      row.meal_slot === "snack"
        ? row.meal_slot
        : "snack";
    entriesBySlot[slot].push(row);
    totalKcal += Number(row.kcal ?? 0);
    totalProtein += Number(row.protein_g ?? 0);
    totalFat += Number(row.fat_g ?? 0);
    totalCarbs += Number(row.carbs_g ?? 0);
    totalFiber += Number(row.fiber_g ?? 0);
  }

  const meals = {} as Record<DiaryMealSlot, DayMealDiaryGroup>;
  for (const slot of DIARY_MEAL_SLOTS) {
    const slotEntries = entriesBySlot[slot];
    const mealKcal = Math.round(slotEntries.reduce((s, e) => s + Number(e.kcal ?? 0), 0));
    const mealProtein = round1(
      slotEntries.reduce((s, e) => s + Number(e.protein_g ?? 0), 0)
    );
    const mealFat = round1(slotEntries.reduce((s, e) => s + Number(e.fat_g ?? 0), 0));
    const mealCarbs = round1(slotEntries.reduce((s, e) => s + Number(e.carbs_g ?? 0), 0));
    const mealFiber = round1(slotEntries.reduce((s, e) => s + Number(e.fiber_g ?? 0), 0));
    const pctOfDay =
      totalKcal > 0
        ? Math.round((mealKcal / Math.max(totalKcal, kcalTarget)) * 100)
        : 0;

    meals[slot] = {
      slot,
      label: DIARY_MEAL_LABELS[slot],
      kcal: mealKcal,
      protein_g: mealProtein,
      fat_g: mealFat,
      carbs_g: mealCarbs,
      fiber_g: mealFiber,
      pct_of_day: pctOfDay,
      entries: slotEntries,
    };
  }

  const roundedTotalKcal = Math.round(totalKcal);

  return {
    date: effectiveDate,
    targets,
    totals: {
      kcal: roundedTotalKcal,
      protein_g: round1(totalProtein),
      fat_g: round1(totalFat),
      carbs_g: round1(totalCarbs),
      fiber_g: round1(totalFiber),
      remaining_kcal: Math.round(kcalTarget - roundedTotalKcal),
      pct_of_target: Math.round((roundedTotalKcal / kcalTarget) * 100),
    },
    meals,
    mealList: DIARY_MEAL_SLOTS.map((s) => meals[s]),
    dayWeight: dayWeightRows[0] ?? null,
    latestWeight,
  };
}

// ============================================================================
// Combined Nutrition (КБЖУ) + Body Weight Analytics
// ============================================================================

export async function getNutritionAndWeightAnalytics(
  db: TypedSupabaseClient,
  options: { days?: number; endDate?: string; timeZone?: string } = {}
): Promise<NutritionAndWeightAnalytics> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const days = Math.max(1, Math.min(365, options.days ?? 14));
  const endDate = options.endDate ?? formatIsoDate(new Date(), tz);
  const startDate = addDaysToIsoDate(endDate, -(days - 1));
  const maLookbackStart = addDaysToIsoDate(startDate, -7);

  const [targets, calorieRowsRes, weightRows] = await Promise.all([
    getNutritionTargets(db),
    db
      .from("calorie_logs")
      .select("*")
      .gte("logged_date", startDate)
      .lte("logged_date", endDate)
      .order("logged_date", { ascending: true }),
    listBodyWeightLogs(db, { startDate: maLookbackStart, endDate }),
  ]);

  if (calorieRowsRes.error) throw calorieRowsRes.error;
  const calorieRows = calorieRowsRes.data ?? [];

  const calByDate = new Map<
    string,
    { kcal: number; protein_g: number; fat_g: number; carbs_g: number }
  >();
  for (const row of calorieRows) {
    const prev = calByDate.get(row.logged_date) ?? {
      kcal: 0,
      protein_g: 0,
      fat_g: 0,
      carbs_g: 0,
    };
    prev.kcal += Number(row.kcal ?? 0);
    prev.protein_g += Number(row.protein_g ?? 0);
    prev.fat_g += Number(row.fat_g ?? 0);
    prev.carbs_g += Number(row.carbs_g ?? 0);
    calByDate.set(row.logged_date, prev);
  }

  const weightByDate = new Map<string, number>();
  for (const w of weightRows) {
    if (!weightByDate.has(w.logged_date)) {
      weightByDate.set(w.logged_date, Number(w.weight_kg));
    }
  }

  const series: NutritionWeightDailyPoint[] = [];
  const kcalTarget = Number(targets.kcal_target || 2200);

  for (let i = 0; i < days; i++) {
    const d = addDaysToIsoDate(startDate, i);
    const cal = calByDate.get(d);
    const w = weightByDate.get(d) ?? null;

    // 7-day moving average over available weight readings in [d - 6, d]
    const windowWeights: number[] = [];
    for (let k = -6; k <= 0; k++) {
      const wd = weightByDate.get(addDaysToIsoDate(d, k));
      if (wd !== undefined) windowWeights.push(wd);
    }
    const ma7 =
      windowWeights.length > 0
        ? roundQty(windowWeights.reduce((a, b) => a + b, 0) / windowWeights.length)
        : null;

    series.push({
      date: d,
      kcal: cal ? Math.round(cal.kcal) : 0,
      protein_g: cal ? round1(cal.protein_g) : 0,
      fat_g: cal ? round1(cal.fat_g) : 0,
      carbs_g: cal ? round1(cal.carbs_g) : 0,
      kcal_target: kcalTarget,
      weight_kg: w,
      weight_ma7_kg: ma7,
    });
  }

  const loggedDays = series.filter((pt) => pt.kcal > 0);
  const loggedCount = loggedDays.length;
  const avgKcal =
    loggedCount > 0
      ? Math.round(loggedDays.reduce((s, p) => s + p.kcal, 0) / loggedCount)
      : 0;
  const avgProtein =
    loggedCount > 0
      ? round1(loggedDays.reduce((s, p) => s + p.protein_g, 0) / loggedCount)
      : 0;
  const avgFat =
    loggedCount > 0
      ? round1(loggedDays.reduce((s, p) => s + p.fat_g, 0) / loggedCount)
      : 0;
  const avgCarbs =
    loggedCount > 0
      ? round1(loggedDays.reduce((s, p) => s + p.carbs_g, 0) / loggedCount)
      : 0;
  const withinTargetDays = loggedDays.filter(
    (p) => Math.abs(p.kcal - kcalTarget) <= kcalTarget * 0.15
  ).length;
  const adherencePct =
    loggedCount > 0 ? Math.round((withinTargetDays / loggedCount) * 100) : 0;

  const periodWeights = series
    .filter((p) => p.weight_kg !== null)
    .map((p) => p.weight_kg as number);
  const startWeight = periodWeights.length > 0 ? periodWeights[0] : null;
  const latestWeight =
    periodWeights.length > 0 ? periodWeights[periodWeights.length - 1] : null;
  const minWeight = periodWeights.length > 0 ? Math.min(...periodWeights) : null;
  const maxWeight = periodWeights.length > 0 ? Math.max(...periodWeights) : null;
  const weightDelta =
    startWeight !== null && latestWeight !== null
      ? roundQty(latestWeight - startWeight)
      : null;

  return {
    days,
    startDate,
    endDate,
    targets,
    series,
    averages: {
      avg_kcal: avgKcal,
      avg_protein_g: avgProtein,
      avg_fat_g: avgFat,
      avg_carbs_g: avgCarbs,
      logged_days_count: loggedCount,
      target_adherence_pct: adherencePct,
    },
    weight_summary: {
      start_weight_kg: startWeight,
      latest_weight_kg: latestWeight,
      min_weight_kg: minWeight,
      max_weight_kg: maxWeight,
      weight_delta_kg: weightDelta,
      target_weight_kg:
        targets.target_weight_kg !== null ? Number(targets.target_weight_kg) : null,
    },
  };
}

// ============================================================================
// Composite Nutrition Dashboard Loader
// ============================================================================

export interface NutritionDashboardData {
  profile: UserProfile | null;
  caloriesEnabled: boolean;
  todayDate: string;
  anchorDate: string;
  weekStart: string;
  weekEnd: string;
  weekDates: string[];
  targets: NutritionTargets;
  dayDiary: DayFoodDiary;
  weightLogs: BodyWeightLog[];
  analytics14d: NutritionAndWeightAnalytics;
  dictionaryHighlights: FoodDictionaryItem[];
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
  options: { anchorDate?: string; analyticsDays?: number; timeZone?: string } = {}
): Promise<NutritionDashboardData> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const todayDate = formatIsoDate(new Date(), tz);
  const anchorDate = options.anchorDate ?? todayDate;
  const analyticsDays = options.analyticsDays ?? 14;
  const { weekStart, weekEnd, dates } = getWeekBoundsIso(anchorDate);

  const [
    profile,
    dayDiary,
    weightLogs,
    analytics14d,
    dictionaryHighlights,
    recipes,
    weekMealPlan,
    pantryItems,
    shoppingItems,
    offEvaluations,
    offStats,
  ] = await Promise.all([
    getOwnerProfile(db),
    getDayFoodDiary(db, anchorDate, tz),
    listBodyWeightLogs(db, { limit: 60, timeZone: tz }),
    getNutritionAndWeightAnalytics(db, {
      days: analyticsDays,
      endDate: todayDate,
      timeZone: tz,
    }),
    listFoodDictionaryHighlights(db, 24),
    listRecipes(db),
    listMealPlanEntries(db, { startDate: weekStart, endDate: weekEnd }),
    listPantryItems(db),
    listShoppingItems(db, true),
    listOffEvaluations(db, 30),
    getOffCompletenessStats(db),
  ]);

  const flags =
    profile?.feature_flags && typeof profile.feature_flags === "object"
      ? (profile.feature_flags as Record<string, unknown>)
      : {};

  return {
    profile,
    // Always-on by default in Nutrition v2 unless explicitly set to false
    caloriesEnabled: flags.enable_calories_off !== false,
    todayDate,
    anchorDate,
    weekStart,
    weekEnd,
    weekDates: dates,
    targets: dayDiary.targets,
    dayDiary,
    weightLogs,
    analytics14d,
    dictionaryHighlights,
    recipes,
    weekMealPlan,
    pantryItems,
    shoppingItems,
    todayCalorieLogs: dayDiary.mealList.flatMap((m) => m.entries),
    offEvaluations,
    offStats,
  };
}
