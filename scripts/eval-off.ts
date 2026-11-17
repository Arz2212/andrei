/**
 * Isolated Open Food Facts (OFF) Completeness Evaluator for Life OS.
 * Tests real everyday Russian & international grocery barcodes against
 * https://world.openfoodfacts.org/api/v2/product/{barcode} and saves
 * structured evaluation metrics in `public.off_product_evaluations`.
 *
 * Run: `node --env-file=/root/life-os/.env /root/life-os/scripts/eval-off.ts`
 */
import {
  evaluateAndSaveOffProduct,
  getOffCompletenessStats,
  getOwnerBotDbClient,
} from "../packages/db/dist/index.js";

const SAMPLE_GROCERY_BARCODES: { barcode: string; label: string }[] = [
  { barcode: "4607025392408", label: "Молоко Простоквашино / ультрапастеризованное" },
  { barcode: "4607086411223", label: "Савушкин греческий йогурт Teos 2%" },
  { barcode: "4600605019557", label: "Геркулес Традиционный (Русский Продукт)" },
  { barcode: "8076809513753", label: "Паста Barilla Spaghetti №5" },
  { barcode: "3017620422003", label: "Nutella 350g (международный эталон)" },
  { barcode: "5449000000996", label: "Coca-Cola 0.33 (международный эталон)" },
  { barcode: "4607004891465", label: "Хлебцы Dr.Korner гречневые" },
  { barcode: "7394376616228", label: "Овсяный напиток Oatly Barista" },
];

async function main() {
  const { db, userId } = await getOwnerBotDbClient();

  console.error("=== Life OS · Open Food Facts Completeness Evaluation ===");
  for (const sample of SAMPLE_GROCERY_BARCODES) {
    try {
      const row = await evaluateAndSaveOffProduct(
        db,
        userId,
        sample.barcode,
        sample.label
      );
      console.error(
        `[${row.found_in_off ? "FOUND" : "MISS "}] ${sample.barcode} (${sample.label}) -> ` +
          `${row.product_name ?? "—"} | КБЖУ полные: ${row.has_complete_macros ? "ДА" : "НЕТ"} ` +
          `(${row.kcal_100g ?? "?"} ккал / Б:${row.protein_100g ?? "?"} Ж:${row.fat_100g ?? "?"} У:${row.carbs_100g ?? "?"})`
      );
    } catch (err) {
      console.error(`[ERROR] ${sample.barcode}:`, err);
    }
  }

  const stats = await getOffCompletenessStats(db);
  console.error("\n=== Итоговая статистика полноты базы Open Food Facts ===");
  console.error(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
